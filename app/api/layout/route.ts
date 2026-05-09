import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth, isAuthError, logAction, type AuthContext } from '@/lib/auth'
import { parseIdml } from '@/lib/idml-converter/parse'
import { uploadTemplateSetToSupabase, type UploadResult } from '@/lib/idml-converter/upload'
import type { ParsedTemplateSet } from '@/lib/idml-converter/types'
import { buildAlbum, loadTemplateSet, loadPresetBySlug, loadPresetById } from '@/lib/album-builder'
import type {
  Student,
  Subject,
  HeadTeacher,
  AlbumInput,
  Preset,
  TemplateSet,
} from '@/lib/album-builder'
import { buildAlbumInput, type SmartFillWarning } from '@/lib/smart-fill'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const TEMPLATE_SET_FIELDS =
  'id, name, slug, print_type, is_global, tenant_id, ' +
  'page_width_mm, page_height_mm, spread_width_mm, spread_height_mm, bleed_mm, ' +
  'facing_pages, page_binding, description, cover_preview_url, created_at, updated_at'

const SPREAD_TEMPLATE_FIELDS =
  'id, name, type, is_spread, width_mm, height_mm, ' +
  'placeholders, rules, sort_order, background_url, created_at'

// ============================================================
// Локальная копия assertAlbumAccess (паттерн из app/api/tenant/route.ts).
// Дублирование оправдано — импорт между route handler'ами создаёт
// циркулярные риски. Вынос в shared helper — отдельная рефакторинг-задача
// вне scope подэтапа 1.3.
// ============================================================
async function assertAlbumAccessLocal(
  auth: AuthContext,
  albumId: string,
  tenantIdOverride?: string,
): Promise<boolean> {
  if (auth.role === 'superadmin') return true

  const { data } = await supabaseAdmin
    .from('albums')
    .select('tenant_id')
    .eq('id', albumId)
    .single()

  return data?.tenant_id === (tenantIdOverride ?? auth.tenantId)
}

// ============================================================
// Классификация warning'ов: builder + smart-fill коды → level.
// Spec: docs/phase-1-spec.md строки 325-343.
// ============================================================
type WarningLevel = 'blocking' | 'degraded' | 'info'

const WARNING_LEVELS: Record<string, WarningLevel> = {
  // Builder — blocking
  master_not_found: 'blocking',
  students_empty: 'blocking',

  // Builder — degraded
  students_overflow: 'degraded',
  subjects_overflow: 'degraded',
  students_grid_no_special_master: 'degraded',
  name_mismatch: 'degraded',
  class_photo_missing: 'degraded',
  half_class_missing: 'degraded',
  students_odd_in_standard: 'degraded',
  no_right_teacher_master: 'degraded',
  fallback_used: 'degraded',
  students_too_few: 'degraded',
  adaptive_grid_fallback: 'degraded',

  // Builder — info
  no_head_teacher: 'info',

  // Smart-fill — info
  students_no_portrait: 'info',
  per_child_override_ignored: 'info',
}

type EnrichedWarning = {
  code: string
  detail: string
  level: WarningLevel
  source: 'builder' | 'smart_fill'
}

function enrichWarning(
  w: { code: string; detail: string },
  source: 'builder' | 'smart_fill',
): EnrichedWarning {
  return {
    code: w.code,
    detail: w.detail,
    level: WARNING_LEVELS[w.code] ?? 'degraded',
    source,
  }
}

// ============================================================
// GET /api/layout — read-only endpoints для template_sets
// ============================================================
// Действия:
// - ?action=template_sets — список доступных tenant'у шаблонов.
// - ?action=template_set_detail&id=<uuid> — один template_set + его spread_templates.
//
// Видимость:
// - superadmin без ?tenant_id — видит ВСЕ template_sets.
// - superadmin с ?tenant_id=<uuid> — global + указанный tenant.
// - owner/manager/viewer — global + свой tenant. ?tenant_id молча игнорируется.
//
// Audit log на read-операции не пишем (договорённость по проекту).
// ============================================================

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, ['superadmin', 'owner', 'manager', 'viewer'])
  if (isAuthError(auth)) return auth

  const action = req.nextUrl.searchParams.get('action')
  if (!action) {
    return NextResponse.json({ error: 'action required' }, { status: 400 })
  }

  if (action === 'template_sets') {
    const overrideTenantId = req.nextUrl.searchParams.get('tenant_id')

    let query = supabaseAdmin
      .from('template_sets')
      .select(TEMPLATE_SET_FIELDS + ', spread_templates(count)')
      .order('is_global', { ascending: false })
      .order('name', { ascending: true })
      .limit(500)

    if (auth.role === 'superadmin') {
      if (overrideTenantId) {
        if (!UUID_REGEX.test(overrideTenantId)) {
          return NextResponse.json({ error: 'invalid tenant_id' }, { status: 400 })
        }
        query = query.or(`tenant_id.is.null,tenant_id.eq.${overrideTenantId}`)
      }
    } else {
      query = query.or(`tenant_id.is.null,tenant_id.eq.${auth.tenantId}`)
    }

    const { data, error } = await query
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json(data ?? [])
  }

  if (action === 'template_set_detail') {
    const id = req.nextUrl.searchParams.get('id')
    if (!id || !UUID_REGEX.test(id)) {
      return NextResponse.json({ error: 'valid id required' }, { status: 400 })
    }

    let setQuery = supabaseAdmin
      .from('template_sets')
      .select(TEMPLATE_SET_FIELDS)
      .eq('id', id)

    if (auth.role !== 'superadmin') {
      setQuery = setQuery.or(`tenant_id.is.null,tenant_id.eq.${auth.tenantId}`)
    }

    const { data: templateSet, error: setError } = await setQuery.maybeSingle()
    if (setError) {
      return NextResponse.json({ error: setError.message }, { status: 500 })
    }
    if (!templateSet) {
      return NextResponse.json({ error: 'Template set not found' }, { status: 404 })
    }

    const { data: spreadTemplates, error: spreadsError } = await supabaseAdmin
      .from('spread_templates')
      .select(SPREAD_TEMPLATE_FIELDS)
      .eq('template_set_id', id)
      .order('sort_order', { ascending: true })

    if (spreadsError) {
      return NextResponse.json({ error: spreadsError.message }, { status: 500 })
    }

    return NextResponse.json({
      template_set: templateSet,
      spread_templates: spreadTemplates ?? [],
    })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}

// ============================================================
// POST /api/layout?action=import_idml — multipart upload
// ============================================================
// Только superadmin: импорт template_set влияет на всех пользователей
// (global = все tenant'ы; tenant-shared = весь tenant).
//
// Form fields:
//   file         — IDML (обязательный)
//   name         — отображаемое имя
//   slug         — обязательный, regex проверит uploadTemplateSetToSupabase
//   print_type   — 'layflat' | 'soft'
//   tenant_id    — '' | 'global' → null; UUID → конкретный tenant
//   description  — optional, пустая строка → null
//   force        — литерал 'true'; any value other than literal 'true'
//                  is treated as false
//
// Размер тела не валидируем: Vercel platform limit ~4.5 MB сработает
// сам. Реальные IDML 1-2 MB. Если упрёмся — отдельным коммитом перейти
// на Storage upload + reference.
// ============================================================

export async function POST(req: NextRequest) {
  // Расширили роли — build_album должен быть доступен для owner/manager/viewer.
  // Существующие superadmin-only хендлеры (import_idml, build_album_test)
  // защищены явным guard'ом внутри.
  const auth = await requireAuth(req, ['superadmin', 'owner', 'manager', 'viewer'])
  if (isAuthError(auth)) return auth

  const action = req.nextUrl.searchParams.get('action')

  if (action === 'build_album') {
    return handleBuildAlbum(req, auth)
  }

  if (action === 'build_album_test') {
    if (auth.role !== 'superadmin') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
    return handleBuildAlbumTest(req)
  }

  if (action === 'import_idml') {
    if (auth.role !== 'superadmin') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
    return handleImportIdml(req, auth)
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}

async function handleImportIdml(
  req: NextRequest,
  auth: AuthContext,
): Promise<NextResponse> {
  // ─── Parse multipart ────────────────────────────────────────────
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'invalid multipart body' }, { status: 400 })
  }

  const file = formData.get('file')
  const name = formData.get('name')
  const slug = formData.get('slug')
  const printType = formData.get('print_type')
  const tenantIdRaw = formData.get('tenant_id')
  const descriptionRaw = formData.get('description')
  const forceRaw = formData.get('force')

  // ─── Минимальная валидация (regex slug, UUID tenantId, name non-empty,
  //     duplicate master spread names, printType — это всё ловит upload.ts) ──
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 })
  }
  if (typeof name !== 'string' || name.trim() === '') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (typeof slug !== 'string' || slug === '') {
    return NextResponse.json({ error: 'slug is required' }, { status: 400 })
  }
  if (printType !== 'layflat' && printType !== 'soft') {
    return NextResponse.json(
      { error: 'print_type must be layflat or soft' },
      { status: 400 },
    )
  }

  let tenantId: string | null
  if (tenantIdRaw === null || tenantIdRaw === '' || tenantIdRaw === 'global') {
    tenantId = null
  } else if (typeof tenantIdRaw === 'string' && UUID_REGEX.test(tenantIdRaw)) {
    tenantId = tenantIdRaw
  } else {
    return NextResponse.json({ error: 'invalid tenant_id' }, { status: 400 })
  }

  const force = forceRaw === 'true'
  const description =
    typeof descriptionRaw === 'string' && descriptionRaw.length > 0
      ? descriptionRaw
      : null

  // ─── Парсинг IDML (битый IDML = клиентская проблема → 400) ──────
  const buffer = Buffer.from(await file.arrayBuffer())
  let parsed: ParsedTemplateSet
  try {
    parsed = await parseIdml(buffer)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'parse failed'
    return NextResponse.json(
      { error: 'idml_parse_failed', message },
      { status: 400 },
    )
  }

  // ─── Upload + маппинг ошибок на статусы ─────────────────────────
  // NOTE: string-matching хрупкий. Если в lib/idml-converter/upload.ts
  //  меняется текст брошенных Error — НЕ ЗАБЫТЬ обновить паттерны здесь.
  //  Альтернатива: typed UploadError в lib/idml-converter/upload.ts
  //  (рассмотрим в 0.13 когда будет второй call-site).
  let result: UploadResult
  try {
    result = await uploadTemplateSetToSupabase(
      parsed,
      { name, slug, tenantId, printType, description, force },
      supabaseAdmin,
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : 'upload failed'

    if (message.includes('already exists')) {
      return NextResponse.json(
        { error: 'slug_exists', message, requires_force: true },
        { status: 409 },
      )
    }

    const isValidation =
      message.startsWith('invalid ') ||
      message.includes('must be') ||
      message.includes('IDML contains duplicate') ||
      message.includes('non-empty')

    return NextResponse.json(
      { error: isValidation ? 'validation_failed' : 'upload_failed', message },
      { status: isValidation ? 400 : 500 },
    )
  }

  // ─── Audit log (logAction сам ловит ошибки — handler не упадёт) ──
  await logAction(
    auth,
    'template_set.import_idml',
    'template_set',
    result.template_set_id,
    {
      name,
      slug,
      tenant_id: tenantId,
      print_type: printType,
      force,
      warnings_count: parsed.warnings?.length ?? 0,
    },
  )

  return NextResponse.json({
    template_set_id: result.template_set_id,
    spread_count: result.spread_count,
    warnings: parsed.warnings ?? [],
  })
}

// ============================================================
// POST /api/layout?action=build_album_test
// ============================================================
// Только superadmin. Принимает JSON. Собирает синтетический альбом через
// buildAlbum() поверх template_set 'okeybook-default' и возвращает spreads
// + warnings + summary. Реальные альбомы из БД здесь не используются —
// это инструмент проверки сценариев автовёрстки на UI.
// ============================================================

async function handleBuildAlbumTest(req: NextRequest): Promise<NextResponse> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'body must be object' }, { status: 400 })
  }
  const b = body as Record<string, unknown>

  const presetSlug = b.preset_slug
  if (typeof presetSlug !== 'string' || presetSlug.length === 0) {
    return NextResponse.json(
      { error: 'preset_slug is required (e.g. "standard-layflat")' },
      { status: 400 },
    )
  }

  const studentsCount = b.students_count
  if (typeof studentsCount !== 'number' || studentsCount < 0 || studentsCount > 100) {
    return NextResponse.json({ error: 'students_count must be number 0-100' }, { status: 400 })
  }

  const subjectsCount = b.subjects_count
  if (typeof subjectsCount !== 'number' || subjectsCount < 0 || subjectsCount > 30) {
    return NextResponse.json({ error: 'subjects_count must be number 0-30' }, { status: 400 })
  }

  const withHeadTeacher = b.with_head_teacher === true
  const commonPhotosInput = (b.common_photos ?? {}) as Record<string, unknown>
  const friendPhotosPerStudent = (b.friend_photos_per_student ?? []) as unknown[]

  // Сборка синтетических данных
  const students: Student[] = []
  for (let i = 0; i < studentsCount; i++) {
    const friendCount =
      typeof friendPhotosPerStudent[i] === 'number'
        ? Math.min(4, Math.max(0, friendPhotosPerStudent[i] as number))
        : 0
    students.push({
      full_name: `Ученик ${i + 1}`,
      quote: `Цитата ${i + 1}`,
      portrait: `https://fake/student-${i + 1}.jpg`,
      friend_photos: Array.from(
        { length: friendCount },
        (_, j) => `https://fake/student-${i + 1}-friend-${j + 1}.jpg`,
      ),
    })
  }

  const subjects: Subject[] = Array.from({ length: subjectsCount }, (_, i) => ({
    name: `Предметник ${i + 1}`,
    role: 'учитель',
    photo: `https://fake/subject-${i + 1}.jpg`,
  }))

  const headTeacher: HeadTeacher | null = withHeadTeacher
    ? {
        name: 'Иванова Мария Петровна',
        role: 'классный руководитель',
        photo: 'https://fake/head.jpg',
        text: 'Дорогие выпускники, желаю вам успехов.',
      }
    : null

  const makeUrls = (n: number, prefix: string): string[] =>
    Array.from({ length: n }, (_, i) => `https://fake/${prefix}-${i + 1}.jpg`)

  const commonPhotos = {
    full_class: makeUrls(Number(commonPhotosInput.full_class ?? 0), 'class'),
    half: makeUrls(Number(commonPhotosInput.half ?? 0), 'half'),
    quarter: makeUrls(Number(commonPhotosInput.quarter ?? 0), 'quarter'),
    sixth: makeUrls(Number(commonPhotosInput.sixth ?? 0), 'sixth'),
    collage: makeUrls(Number(commonPhotosInput.collage ?? 0), 'collage'),
  }

  let templateSet: TemplateSet
  try {
    templateSet = await loadTemplateSet(supabaseAdmin)
  } catch (e) {
    return NextResponse.json(
      { error: `failed to load template_set: ${(e as Error).message}` },
      { status: 500 },
    )
  }

  let preset: Preset
  try {
    preset = await loadPresetBySlug(supabaseAdmin, presetSlug)
  } catch (e) {
    return NextResponse.json(
      { error: `preset_slug ${presetSlug} not found: ${(e as Error).message}` },
      { status: 400 },
    )
  }

  const input: AlbumInput = {
    template_set_id: templateSet.id,
    head_teacher: headTeacher,
    subjects,
    students,
    common_photos: commonPhotos,
  }

  const result = buildAlbum(input, preset, templateSet)

  return NextResponse.json({
    spreads: result.spreads,
    warnings: result.warnings,
    summary: {
      total_spreads: result.spreads.length,
      total_warnings: result.warnings.length,
      preset_slug: preset.slug,
      preset_name: preset.name,
      students_count: studentsCount,
      subjects_count: subjectsCount,
    },
  })
}

// ============================================================
// POST /api/layout?action=build_album
// ============================================================
// Smart-fill endpoint: читает реальный альбом из БД, прогоняет через
// builder, сохраняет результат в album_layouts (upsert), возвращает
// spreads + классифицированные warnings.
//
// Body: { album_id: string }
//
// Доступ: owner/manager/viewer тенанта-владельца альбома, OkeyBook staff
// через ?view_as=<tenant_id>, superadmin без ограничений.
// ============================================================

async function handleBuildAlbum(
  req: NextRequest,
  auth: AuthContext,
): Promise<NextResponse> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'body must be object' }, { status: 400 })
  }
  const albumId = (body as Record<string, unknown>).album_id
  if (typeof albumId !== 'string' || !UUID_REGEX.test(albumId)) {
    return NextResponse.json(
      { error: 'album_id is required (uuid)' },
      { status: 400 },
    )
  }

  const viewAsTenantId = req.nextUrl.searchParams.get('view_as')
  const { data: currentTenantData } = viewAsTenantId
    ? await supabaseAdmin.from('tenants').select('slug').eq('id', auth.tenantId).single()
    : { data: null }
  const canViewAs = auth.role === 'superadmin' || currentTenantData?.slug === 'main'
  const tid = (canViewAs && viewAsTenantId) ? viewAsTenantId : auth.tenantId

  if (!(await assertAlbumAccessLocal(auth, albumId, tid))) {
    return NextResponse.json({ error: 'access denied' }, { status: 403 })
  }

  const { data: album, error: albumErr } = await supabaseAdmin
    .from('albums')
    .select('id, config_preset_id, template_set_id')
    .eq('id', albumId)
    .single()

  if (albumErr || !album) {
    return NextResponse.json({ error: 'album not found' }, { status: 404 })
  }

  if (!album.config_preset_id) {
    return NextResponse.json(
      { error: 'album has no config_preset_id (выберите пресет вёрстки в форме редактирования)' },
      { status: 400 },
    )
  }

  let smartFillResult: { input: AlbumInput; warnings: SmartFillWarning[] }
  try {
    smartFillResult = await buildAlbumInput(supabaseAdmin, albumId)
  } catch (e) {
    return NextResponse.json(
      { error: `smart-fill failed: ${(e as Error).message}` },
      { status: 500 },
    )
  }

  let preset: Preset
  try {
    preset = await loadPresetById(supabaseAdmin, album.config_preset_id)
  } catch (e) {
    return NextResponse.json(
      { error: `preset load failed: ${(e as Error).message}` },
      { status: 500 },
    )
  }

  let templateSet: TemplateSet
  try {
    templateSet = await loadTemplateSet(supabaseAdmin)
  } catch (e) {
    return NextResponse.json(
      { error: `template_set load failed: ${(e as Error).message}` },
      { status: 500 },
    )
  }

  const result = buildAlbum(smartFillResult.input, preset, templateSet)

  const enrichedWarnings: EnrichedWarning[] = [
    ...result.warnings.map((w) => enrichWarning(w, 'builder')),
    ...smartFillResult.warnings.map((w) => enrichWarning(w, 'smart_fill')),
  ]

  const warningsByLevel = {
    blocking: enrichedWarnings.filter((w) => w.level === 'blocking').length,
    degraded: enrichedWarnings.filter((w) => w.level === 'degraded').length,
    info: enrichedWarnings.filter((w) => w.level === 'info').length,
  }

  // status намеренно не передаётся: при INSERT default='draft', при UPDATE
  // существующее значение сохраняется (см. docs/phase-1-spec.md:49).
  const { data: layoutRow, error: upsertErr } = await supabaseAdmin
    .from('album_layouts')
    .upsert(
      {
        album_id: albumId,
        template_set_id: templateSet.id,
        config_preset_id: preset.id,
        spreads: result.spreads,
        warnings: enrichedWarnings,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'album_id' },
    )
    .select('id')
    .single()

  if (upsertErr || !layoutRow) {
    return NextResponse.json(
      { error: `album_layouts upsert failed: ${upsertErr?.message ?? 'no row'}` },
      { status: 500 },
    )
  }

  await logAction(auth, 'album_layout.build', 'album', albumId, {
    template_set_id: templateSet.id,
    preset_slug: preset.slug,
    total_spreads: result.spreads.length,
    total_warnings: enrichedWarnings.length,
    warnings_by_level: warningsByLevel,
  })

  return NextResponse.json({
    spreads: result.spreads,
    warnings: enrichedWarnings,
    layout_id: layoutRow.id,
    summary: {
      total_spreads: result.spreads.length,
      total_warnings: enrichedWarnings.length,
      warnings_by_level: warningsByLevel,
      preset_slug: preset.slug,
      preset_name: preset.name,
    },
  })
}
