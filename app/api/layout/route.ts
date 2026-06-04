import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, getPhotoUrl } from '@/lib/supabase'
import { ycUpload, ycPhotoUrl } from '@/lib/storage'
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
import { loadBundle } from '@/lib/album-builder'
import { resolvePrintType, printTypeToSheetType } from '@/lib/album-builder'
import { buildFromSectionStructure } from '@/lib/rule-engine/build-from-section-structure'
import type {
  RulesAlbumInput,
  RulesStudentInput,
  RulesSubjectInput,
  RulesHeadTeacherInput,
} from '@/lib/album-builder'
import { adaptLegacyAlbumInput } from '@/lib/rule-engine/legacy-adapter'
import { adaptAlbumLayoutToBuildResult } from '@/lib/rule-engine/layout-to-buildresult'
import { buildAlbumInput, type SmartFillWarning } from '@/lib/smart-fill'
import {
  exportAlbumPdf,
  type AlbumExportInput,
  type ExportProfile,
  type OriginalPhoto,
} from '@/lib/pdf-export'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const TEMPLATE_SET_FIELDS =
  'id, name, slug, print_type, is_global, is_published, tenant_id, ' +
  'page_width_mm, page_height_mm, spread_width_mm, spread_height_mm, bleed_mm, ' +
  'facing_pages, page_binding, description, cover_preview_url, ' +
  'default_background_url, created_at, updated_at'

const SPREAD_TEMPLATE_FIELDS =
  'id, name, type, is_spread, width_mm, height_mm, ' +
  'placeholders, rules, sort_order, background_url, created_at, ' +
  // Нужны редактору для категорийных фонов с ротацией: page_role → категория,
  // background_override_url → фон конкретного мастера (приоритет над ротацией).
  'page_role, background_override_url'

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

  // РЭ.32 (конструктор общего раздела) + РЭ.35.Ж — common_required коды
  common_required_master_missing: 'degraded',
  common_required_no_category: 'degraded',
  common_required_page_skipped: 'degraded',
  common_required_empty: 'info',
  common_required_spread_misaligned: 'info',
  // РЭ.38.1 — fallback использован: страница построилась запасным мастером
  // (вместо изначально выбранного партнёром). Это успешный исход, не сбой.
  common_required_fallback_used: 'info',

  // РЭ.37 — transition коды
  // transition_complectation_unknown — это нормальный исход для legacy-шаблонов
  // (когда students.ts кладёт мастер с именем, которое engine не распознаёт).
  // Разворот при этом всё равно корректно закрывается через J-цепочку.
  transition_complectation_unknown: 'info',
  // РЭ.37.4: симметризация хвоста выполнена (опт-ин фича) — это успешный
  // info-исход, не сбой.
  transition_symmetrized: 'info',
  // transition_skipped — настоящая проблема (правая страница не закрылась)
  transition_skipped: 'degraded',
  // transition_combo_master_missing — combo не найден в template_set, но
  // разворот может быть закрыт через closing-цепочку — degraded.
  transition_combo_master_missing: 'degraded',
  transition_custom_master_missing: 'degraded',
  transition_custom_master_invalid: 'degraded',
  transition_custom_skipped: 'degraded',
  transition_custom_no_tail_page: 'degraded',
  transition_master_missing: 'degraded',
  transition_no_tail_page: 'degraded',

  // Generic engine коды — informational. rule_engine_partial всегда
  // сопровождает другие warnings (status='partial' iff warnings.length>0),
  // поэтому не должен сам по себе акцентироваться — это просто шум,
  // дубль факта «есть warnings». Реальная серьёзность — у конкретных
  // warnings в списке.
  rule_engine_partial: 'info',
  rule_engine_warning: 'info',

  // РЭ.21.8 — common (auto/manual) коды
  slot_skipped: 'degraded',
  common_no_spread_master: 'info',
  common_autopack_underflow: 'info',
  common_autopack_disabled: 'info',

  // Builder — info
  no_head_teacher: 'info',

  // Smart-fill — info
  students_no_portrait: 'info',
  per_child_override_ignored: 'info',
  // РЭ.37.9: fallback на мастер без цитат — info-уровень, секция всё-таки
  // построена, просто без цитат.
  students_quote_fallback: 'info',
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

  if (action === 'album_layout') {
    return handleGetAlbumLayout(req, auth)
  }

  if (action === 'list_export_profiles') {
    return handleListExportProfiles(req, auth)
  }

  if (action === 'list_album_exports') {
    return handleListAlbumExports(req, auth)
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

    // Пул категорийных фонов набора (для ротации в редакторе/PDF). Партнёру
    // super-admin API недоступно по роли, поэтому отдаём пул здесь.
    const { data: backgrounds, error: bgError } = await supabaseAdmin
      .from('template_set_backgrounds')
      .select('id, category, url, sort_order, side')
      .eq('template_set_id', id)
      .order('category', { ascending: true })
      .order('sort_order', { ascending: true })

    if (bgError) {
      return NextResponse.json({ error: bgError.message }, { status: 500 })
    }

    return NextResponse.json({
      template_set: templateSet,
      spread_templates: spreadTemplates ?? [],
      backgrounds: backgrounds ?? [],
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

  if (action === 'save_album_layout') {
    return handleSaveAlbumLayout(req, auth)
  }

  if (action === 'update_data') {
    // КЭ.3 — точечный PATCH ключей data одного spread'а. Используется
    // PhotoTransformPanel для записи __scale__<label> / __offset__<label>
    // при движении слайдера/touchpad'а (с debounce 300мс).
    return handleUpdateData(req, auth)
  }

  if (action === 'export') {
    return handleExportPdf(req, auth)
  }

  if (action === 'build_album_test') {
    if (auth.role !== 'superadmin') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
    return handleBuildAlbumTest(req)
  }

  if (action === 'build_album_test_section_structure') {
    if (auth.role !== 'superadmin') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
    return handleBuildAlbumTestSectionStructure(req)
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
    spread: makeUrls(Number(commonPhotosInput.spread ?? 0), 'spread'),
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

async function handleBuildAlbumTestSectionStructure(
  req: NextRequest,
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
  const b = body as Record<string, unknown>

  const presetId = b.preset_id
  if (typeof presetId !== 'string' || presetId.length === 0) {
    return NextResponse.json(
      { error: 'preset_id is required' },
      { status: 400 },
    )
  }

  const studentsCount = b.students_count
  if (
    typeof studentsCount !== 'number' ||
    studentsCount < 0 ||
    studentsCount > 100
  ) {
    return NextResponse.json(
      { error: 'students_count must be number 0-100' },
      { status: 400 },
    )
  }

  const subjectsCount = b.subjects_count
  if (
    typeof subjectsCount !== 'number' ||
    subjectsCount < 0 ||
    subjectsCount > 30
  ) {
    return NextResponse.json(
      { error: 'subjects_count must be number 0-30' },
      { status: 400 },
    )
  }

  const withHeadTeacher = b.with_head_teacher === true
  const commonPhotosInput = (b.common_photos ?? {}) as Record<string, unknown>
  const friendPhotosPerStudent = (b.friend_photos_per_student ?? []) as unknown[]

  const students: RulesStudentInput[] = []
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

  const subjects: RulesSubjectInput[] = Array.from(
    { length: subjectsCount },
    (_, i) => ({
      name: `Предметник ${i + 1}`,
      role: 'учитель',
      photo: `https://fake/subject-${i + 1}.jpg`,
    }),
  )

  const headTeacher: RulesHeadTeacherInput = withHeadTeacher
    ? {
        name: 'Иванова Мария Петровна',
        role: 'классный руководитель',
        photo: 'https://fake/head.jpg',
        text: 'Дорогие выпускники, желаю вам успехов.',
      }
    : { name: '', role: '', photo: null, text: '' }

  const makeUrls = (n: number, prefix: string): string[] =>
    Array.from({ length: n }, (_, i) => `https://fake/${prefix}-${i + 1}.jpg`)

  const input: RulesAlbumInput = {
    students,
    subjects,
    head_teacher: headTeacher,
    common_photos: {
      full_class: makeUrls(Number(commonPhotosInput.full_class ?? 0), 'class'),
      half_class: makeUrls(
        Number(commonPhotosInput.half_class ?? commonPhotosInput.half ?? 0),
        'half',
      ),
      spread: makeUrls(Number(commonPhotosInput.spread ?? 0), 'spread'),
      quarter: makeUrls(Number(commonPhotosInput.quarter ?? 0), 'quarter'),
      sixth: makeUrls(Number(commonPhotosInput.sixth ?? 0), 'sixth'),
      collage: makeUrls(Number(commonPhotosInput.collage ?? 0), 'collage'),
    },
  }

  let bundle
  try {
    bundle = await loadBundle(supabaseAdmin, presetId, null)
  } catch (e) {
    return NextResponse.json(
      {
        error: `failed to load bundle for preset '${presetId}': ${(e as Error).message}`,
      },
      { status: 400 },
    )
  }

  // Сборка через section-structure engine. buildFromSectionStructure не бросает;
  // ошибки уровня "section_structure=NULL" возвращаются как status='failed'.
  const layout = buildFromSectionStructure(bundle, input)

  // Map master_id → name для UI: в spreads PageInstance.master_id это UUID,
  // а пользователю нужно видеть имя мастера ("E-Universal-Left").
  // Используется только для отображения; legacy build-test и rules-test
  // прячут имя в bindings.__master_name__, у нового engine этой метки нет.
  const mastersById: Record<string, string> = {}
  bundle.mastersByName.forEach((m) => { mastersById[m.id] = m.name })

  // Снапшот section_structure пресета — полезен в UI для отладки
  // (понять что именно engine видел при сборке).
  return NextResponse.json({
    engine: 'section_structure',
    status: layout.status,
    spreads: layout.spreads,
    decision_trace: layout.decision_trace,
    warnings: layout.warnings,
    rules_version: layout.rules_version,
    preset_section_structure: bundle.preset.section_structure ?? null,
    masters_by_id: mastersById,
    summary: {
      total_spreads: layout.spreads.length,
      total_warnings: layout.warnings.length,
      total_decisions: layout.decision_trace.length,
      preset_id: bundle.preset.id,
      preset_name: bundle.preset.display_name,
      preset_density: bundle.preset.density ?? null,
      preset_sheet_type: bundle.preset.sheet_type ?? null,
      students_count: studentsCount,
      subjects_count: subjectsCount,
      template_set_slug: bundle.templateSet.slug,
    },
  })
}


type RulesBuildOk = {
  ok: true
  response: NextResponse
}

type RulesBuildSkip = {
  ok: false
  reason: string
}


// ============================================================
// РЭ.21.8.7b — Сборка альбома через section structure engine
// ============================================================
// Альтернативный путь handleBuildAlbum. Вызывается когда
// album.section_structure_preset_id IS NOT NULL. При сбое —
// fallthrough на legacy buildAlbum.
//
// Smart-fill общий с legacy buildAlbum. Отличается тем что после
// smart-fill используется adaptLegacyAlbumInput → buildFromSectionStructure
// вместо legacy buildAlbum.
//
// РЭ.21.8.чистка-1 (20.05.2026): удалён движок 2 (buildFromRules),
// раньше здесь была промежуточная ветка tryBuildViaRules. Теперь только
// 2 движка: section_structure (если включён) → legacy фолбэк.
// ============================================================

async function tryBuildViaSectionStructure(
  supabase: typeof supabaseAdmin,
  albumId: string,
  sectionStructurePresetId: string,
  tenantId: string,
  auth: AuthContext,
): Promise<RulesBuildOk | RulesBuildSkip> {
  // 1. Smart-fill — та же функция что у legacy/rules.
  let smartFillResult: { input: AlbumInput; warnings: SmartFillWarning[] }
  try {
    smartFillResult = await buildAlbumInput(supabase, albumId)
  } catch (e) {
    return { ok: false, reason: `smart-fill failed: ${(e as Error).message}` }
  }

  // 2. Адаптируем legacy AlbumInput → RulesAlbumInput.
  // Новый engine принимает тот же тип входа что rule engine.
  const rulesInput = adaptLegacyAlbumInput(smartFillResult.input)

  // 3. Загружаем bundle — тот же loadBundle, новый engine использует
  // bundle.preset.section_structure (заполняется в loaders.ts на РЭ.21.8.1).
  let bundle
  try {
    bundle = await loadBundle(supabase, sectionStructurePresetId, tenantId)
  } catch (e) {
    return {
      ok: false,
      reason: `loadBundle('${sectionStructurePresetId}') failed: ${(e as Error).message}`,
    }
  }

  // РЭ.27.3: переопределяем print_type из альбома если задан.
  // Это даёт engine читать тип переплёта из albums.print_type
  // (новый путь после фазы РЭ.27) с fallback на preset.print_type
  // (бэк-совместимость для альбомов до миграции 27.7).
  // Engine использует два связанных поля — print_type (legacy) и
  // sheet_type (новый формат), оба обновляем синхронно.
  //
  // РЭ.46: override симметризации хвоста из альбома
  // (albums.symmetrize_students_tail_override). NULL = используем
  // значение пресета, true/false = принудительно переключаем.
  try {
    const { data: albumRow } = await supabase
      .from('albums')
      .select('print_type, symmetrize_students_tail_override')
      .eq('id', albumId)
      .single()
    const albumPrintType = (albumRow?.print_type ?? null) as
      | 'layflat'
      | 'soft'
      | null
    const presetPrintType = (bundle.preset.print_type ?? null) as
      | 'layflat'
      | 'soft'
      | null
    const effective = resolvePrintType(albumPrintType, presetPrintType)
    // mutating bundle.preset — это локальная копия, не БД-объект.
    // loadBundle не кэширует, каждый build получает свежий bundle.
    ;(bundle.preset as { print_type: 'layflat' | 'soft' }).print_type = effective
    ;(bundle.preset as { sheet_type: 'hard' | 'soft' }).sheet_type =
      printTypeToSheetType(effective)

    // РЭ.46: применяем override симметризации, если задан.
    const symOverride = albumRow?.symmetrize_students_tail_override
    if (symOverride === true || symOverride === false) {
      ;(bundle.preset as { symmetrize_students_tail: boolean }).symmetrize_students_tail =
        symOverride
    }
  } catch (e) {
    // Не падаем — если SELECT не удался, оставляем bundle как пришёл
    // (poka работает старое поведение, читаем из пресета).
    console.error('[РЭ.27.3] print_type resolve failed, fallback to preset:', e)
  }

  // 3.5. Дополнительная проверка: если у пресета пустой section_structure —
  // engine вернёт status='failed' с конкретным warning. Поймаем это явно,
  // чтобы caller сделал fallthrough вместо отдачи пустого layout.
  if (!bundle.preset.section_structure) {
    return {
      ok: false,
      reason: `preset '${sectionStructurePresetId}' has no section_structure (NULL or missing)`,
    }
  }

  // 4. Прогон через buildFromSectionStructure. Не бросает, status в результате.
  const layout = buildFromSectionStructure(bundle, rulesInput)

  if (layout.status === 'failed') {
    return {
      ok: false,
      reason: `section_structure engine status=failed: ${layout.warnings.join('; ') || 'no warnings'}`,
    }
  }

  // 5. Адаптация — тот же adapter что у rules. AlbumLayout → BuildResult.
  let adapted
  try {
    adapted = adaptAlbumLayoutToBuildResult(layout)
  } catch (e) {
    return {
      ok: false,
      reason: `layout adapter failed: ${(e as Error).message}`,
    }
  }

  // 6. Enrichment warnings.
  const enrichedWarnings: EnrichedWarning[] = [
    ...adapted.result.warnings.map((w) => enrichWarning(w, 'builder')),
    ...smartFillResult.warnings.map((w) => enrichWarning(w, 'smart_fill')),
  ]

  const warningsByLevel = {
    blocking: enrichedWarnings.filter((w) => w.level === 'blocking').length,
    degraded: enrichedWarnings.filter((w) => w.level === 'degraded').length,
    info: enrichedWarnings.filter((w) => w.level === 'info').length,
  }

  // 7. Upsert в album_layouts. config_preset_id NULL — тот же подход
  // что у rules-ветки.
  const { data: layoutRow, error: upsertErr } = await supabase
    .from('album_layouts')
    .upsert(
      {
        album_id: albumId,
        template_set_id: bundle.templateSet.id,
        config_preset_id: null,
        spreads: adapted.result.spreads,
        warnings: enrichedWarnings,
        has_user_edits: false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'album_id' },
    )
    .select('id')
    .single()

  if (upsertErr || !layoutRow) {
    return {
      ok: false,
      reason: `album_layouts upsert failed: ${upsertErr?.message ?? 'no row'}`,
    }
  }

  // 8. Audit log с пометкой engine='section_structure'.
  await logAction(auth, 'album_layout.build', 'album', albumId, {
    engine: 'section_structure',
    template_set_id: bundle.templateSet.id,
    section_structure_preset_id: sectionStructurePresetId,
    rules_version: layout.rules_version,
    rules_status: layout.status,
    total_spreads: adapted.result.spreads.length,
    total_warnings: enrichedWarnings.length,
    warnings_by_level: warningsByLevel,
  })

  return {
    ok: true,
    response: NextResponse.json({
      engine: 'section_structure',
      spreads: adapted.result.spreads,
      warnings: enrichedWarnings,
      layout_id: layoutRow.id,
      template_set_id: bundle.templateSet.id,
      rules_meta: adapted.rules_meta,
      summary: {
        total_spreads: adapted.result.spreads.length,
        total_warnings: enrichedWarnings.length,
        warnings_by_level: warningsByLevel,
        preset_slug: bundle.preset.id,
        preset_name: bundle.preset.display_name,
        // РЭ.43.B: фронт нужен для корректного отображения форзацев в превью.
        // bundle.preset.sheet_type здесь уже после resolvePrintType
        // (см. tryBuildViaSectionStructure выше), т.е. эффективный.
        sheet_type: bundle.preset.sheet_type ?? null,
      },
    }),
  }
}

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
    .select('id, config_preset_id, section_structure_preset_id, template_set_id, vignettes_enabled, print_type')
    .eq('id', albumId)
    .single()

  if (albumErr || !album) {
    return NextResponse.json({ error: 'album not found' }, { status: 404 })
  }

  // ─── РЭ.21.8.7b / РЭ.21.8.чистка-1: развилка section_structure vs legacy ───
  // Приоритет:
  //  1. section_structure_preset_id  → buildFromSectionStructure (РЭ.21.8.3-5)
  //  2. config_preset_id             → buildAlbum               (legacy)
  //
  // При сбое нового engine — fallthrough на legacy. Партнёр не остаётся
  // без layout'а, даже если новый engine упадёт.
  //
  // Smart-fill общий для обоих путей (читает реальные данные из БД).
  // Адаптация AlbumLayout → BuildResult — общий adapter (layout-to-buildresult.ts).
  //
  // Раньше было 3 движка: legacy → buildFromRules (РЭ.16.2) →
  // buildFromSectionStructure (РЭ.21.8). buildFromRules удалён в
  // РЭ.21.8.чистка-1 (20.05.2026) — он не использовался в боевом
  // workflow ни одним пресетом, был фолбэк фолбэка.

  if (album.section_structure_preset_id) {
    const ssResult = await tryBuildViaSectionStructure(
      supabaseAdmin,
      albumId,
      album.section_structure_preset_id,
      tid,
      auth,
    )
    if (ssResult.ok) return ssResult.response
    // fallthrough на legacy при сбое нового engine
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

  // РЭ.27.3: переопределяем print_type из альбома если задан.
  // Engine читает preset.print_type — обновляем его значением из
  // albums.print_type через resolvePrintType (с fallback на preset
  // для бэк-совместимости со старыми альбомами до миграции 27.7).
  // Mutating preset безопасно — loadPresetById возвращает свежую
  // копию из БД, не кэширует.
  {
    const albumPrintType = (album.print_type ?? null) as
      | 'layflat'
      | 'soft'
      | null
    const presetPrintType = (preset.print_type ?? null) as
      | 'layflat'
      | 'soft'
      | null
    const effective = resolvePrintType(albumPrintType, presetPrintType)
    preset.print_type = effective
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

  // А.3.3 — Override настройки виньеток на уровне альбома.
  // Если albums.vignettes_enabled IS NOT NULL, перезаписываем
  // preset.config.student_section.thumbnails_section перед buildAlbum.
  //   true  → {enabled: true, preferred_grid_size: 12} — включаем
  //           виньеточный раздел в комплектации где его нет по дефолту
  //   false → null — отключаем виньетки в Индивидуальной если фотограф
  //           хочет нестандартную конфигурацию
  //   NULL  → не трогаем (дефолт пресета)
  //
  // Безопасно мутировать preset — loadPresetById возвращает свежую копию
  // из БД, не кэширует.
  if (album.vignettes_enabled === true) {
    preset.config.student_section.thumbnails_section = {
      enabled: true,
      preferred_grid_size: 12,
    }
  } else if (album.vignettes_enabled === false) {
    preset.config.student_section.thumbnails_section = null
  }
  // album.vignettes_enabled === null → ничего не делаем, читаем дефолт пресета

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
  // has_user_edits явно сбрасывается в false: build_album = "обнулить
  // layout до автосборки", флаг правок — часть состояния layout'а.
  const { data: layoutRow, error: upsertErr } = await supabaseAdmin
    .from('album_layouts')
    .upsert(
      {
        album_id: albumId,
        template_set_id: templateSet.id,
        config_preset_id: preset.id,
        spreads: result.spreads,
        warnings: enrichedWarnings,
        has_user_edits: false,
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
    template_set_id: templateSet.id,
    summary: {
      total_spreads: result.spreads.length,
      total_warnings: enrichedWarnings.length,
      warnings_by_level: warningsByLevel,
      preset_slug: preset.slug,
      preset_name: preset.name,
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────
// handleSaveAlbumLayout — POST ?action=save_album_layout
//
// Сохраняет ручные правки партнёра в layout альбома (drag-and-drop фото
// в placeholder'ах из палитры редактора). Всегда ставит
// has_user_edits=true; флаг сбрасывается обратно в false при следующем
// build_album (см. handleBuildAlbum / 2.1).
//
// Body: { album_id: uuid, spreads: SpreadInstance[] }
// Авторизация: owner/manager/viewer тенанта-владельца + view_as как
// у handleBuildAlbum (тот же паттерн).
//
// 404 если layout для альбома ещё не существует (нужно сначала
// build_album). 400 если body невалидный.
// ─────────────────────────────────────────────────────────────────────────
async function handleSaveAlbumLayout(
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

  const spreads = (body as Record<string, unknown>).spreads
  if (!Array.isArray(spreads)) {
    return NextResponse.json(
      { error: 'spreads is required (array)' },
      { status: 400 },
    )
  }

  // view_as: тот же паттерн что у handleBuildAlbum.
  const viewAsTenantId = req.nextUrl.searchParams.get('view_as')
  const { data: currentTenantData } = viewAsTenantId
    ? await supabaseAdmin.from('tenants').select('slug').eq('id', auth.tenantId).single()
    : { data: null }
  const canViewAs = auth.role === 'superadmin' || currentTenantData?.slug === 'main'
  const tid = (canViewAs && viewAsTenantId) ? viewAsTenantId : auth.tenantId

  if (!(await assertAlbumAccessLocal(auth, albumId, tid))) {
    return NextResponse.json({ error: 'access denied' }, { status: 403 })
  }

  // Фаза Л.4a — серверная защита read-only режима.
  // Зеркалирует логику can_edit из handleGetAlbumLayout — клиент тоже
  // блокирует save, но защита на сервере критична: запрос мог прийти
  // от багнутого/устаревшего клиента.
  //
  // - viewer не может save
  // - view_as (просмотр от имени партнёра) не может save
  // - submitted/in_production/delivered — только superadmin
  if (auth.role !== 'superadmin') {
    if (auth.role === 'viewer') {
      return NextResponse.json(
        { error: 'Viewer не может редактировать макет' },
        { status: 403 },
      )
    }
    if (canViewAs && viewAsTenantId) {
      return NextResponse.json(
        { error: 'Сохранение от имени партнёра запрещено — только просмотр' },
        { status: 403 },
      )
    }
    const { data: albumRow } = await supabaseAdmin
      .from('albums')
      .select('workflow_status')
      .eq('id', albumId)
      .maybeSingle()
    const ws = albumRow?.workflow_status as string | undefined
    if (ws && ['submitted', 'in_production', 'delivered'].includes(ws)) {
      return NextResponse.json(
        {
          error:
            'Альбом передан в работу — редактирование заблокировано. Обратитесь к OkeyBook если нужны изменения.',
        },
        { status: 403 },
      )
    }
  }

  // UPDATE с has_user_edits=true. Если строки нет (rowsAffected=0) →
  // layout ещё не строился, нужно сначала build_album.
  const { data: layoutRow, error } = await supabaseAdmin
    .from('album_layouts')
    .update({
      spreads,
      has_user_edits: true,
      updated_at: new Date().toISOString(),
    })
    .eq('album_id', albumId)
    .select('id')
    .maybeSingle()

  if (error) {
    return NextResponse.json(
      { error: `save failed: ${error.message}` },
      { status: 500 },
    )
  }

  if (!layoutRow) {
    return NextResponse.json(
      { error: 'layout not found for this album, run build_album first' },
      { status: 404 },
    )
  }

  return NextResponse.json({
    success: true,
    layout_id: layoutRow.id,
  })
}

// ============================================================
// POST /api/layout?action=update_data
// ============================================================
// КЭ.3 — точечный PATCH одного spread'а в album_layouts.spreads.
//
// Используется PhotoTransformPanel UI (КЭ.4-КЭ.5) для записи
// __scale__<label> / __offset__<label> при движении слайдера/touchpad'а.
// Также может использоваться для любых других точечных правок data
// (текстовые значения, замена URL фото, и т.д.) — endpoint generic.
//
// В отличие от save_album_layout который записывает ВЕСЬ spreads array,
// этот endpoint:
//   - Загружает текущий spreads из БД
//   - Находит spread по spread_index
//   - Применяет data_updates (null = delete key, иначе set)
//   - Сохраняет обновлённый spreads назад
//
// Это безопаснее race-conditions: если параллельно делается другая
// правка другого spread'а, она не теряется.
//
// Request body:
//   {
//     album_id: string (uuid),
//     spread_index: number,
//     data_updates: Record<string, string | null>,  // null = remove key
//   }
//
// Response:
//   { success: true, spread: SpreadInstance } — обновлённый spread
//
// Доступ: тот же что save_album_layout (owner/manager на своём тенанте,
// no view_as save, no save для submitted/in_production/delivered).
// ============================================================

async function handleUpdateData(
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

  const spreadIndex = (body as Record<string, unknown>).spread_index
  if (typeof spreadIndex !== 'number' || !Number.isInteger(spreadIndex) || spreadIndex < 0) {
    return NextResponse.json(
      { error: 'spread_index is required (non-negative integer)' },
      { status: 400 },
    )
  }

  const dataUpdates = (body as Record<string, unknown>).data_updates
  if (typeof dataUpdates !== 'object' || dataUpdates === null || Array.isArray(dataUpdates)) {
    return NextResponse.json(
      { error: 'data_updates is required (object)' },
      { status: 400 },
    )
  }

  // Валидация ключей и значений в data_updates.
  // Whitelist префиксов: __scale__, __offset__, __hidden__, __pos__ + plain.
  // Plain ключи (label) — snake_case, начинается с буквы.
  // Значения — string up to 4096 chars или null.
  const KEY_RE = /^(__scale__|__offset__|__hidden__|__pos__)?[a-z][a-z0-9_]*$/
  for (const [k, v] of Object.entries(dataUpdates)) {
    if (!KEY_RE.test(k)) {
      return NextResponse.json(
        { error: `invalid data key: '${k}' (allowed: snake_case label with optional __scale__/__offset__/__hidden__/__pos__ prefix)` },
        { status: 400 },
      )
    }
    if (v !== null && (typeof v !== 'string' || v.length > 4096)) {
      return NextResponse.json(
        { error: `invalid data value for '${k}': must be string ≤4096 chars or null` },
        { status: 400 },
      )
    }
  }

  // view_as: тот же паттерн что у handleSaveAlbumLayout.
  const viewAsTenantId = req.nextUrl.searchParams.get('view_as')
  const { data: currentTenantData } = viewAsTenantId
    ? await supabaseAdmin.from('tenants').select('slug').eq('id', auth.tenantId).single()
    : { data: null }
  const canViewAs = auth.role === 'superadmin' || currentTenantData?.slug === 'main'
  const tid = (canViewAs && viewAsTenantId) ? viewAsTenantId : auth.tenantId

  if (!(await assertAlbumAccessLocal(auth, albumId, tid))) {
    return NextResponse.json({ error: 'access denied' }, { status: 403 })
  }

  // Read-only защита — те же правила что save_album_layout.
  if (auth.role !== 'superadmin') {
    if (auth.role === 'viewer') {
      return NextResponse.json(
        { error: 'Viewer не может редактировать макет' },
        { status: 403 },
      )
    }
    if (canViewAs && viewAsTenantId) {
      return NextResponse.json(
        { error: 'Сохранение от имени партнёра запрещено — только просмотр' },
        { status: 403 },
      )
    }
    const { data: albumRow } = await supabaseAdmin
      .from('albums')
      .select('workflow_status')
      .eq('id', albumId)
      .maybeSingle()
    const ws = albumRow?.workflow_status as string | undefined
    if (ws && ['submitted', 'in_production', 'delivered'].includes(ws)) {
      return NextResponse.json(
        {
          error:
            'Альбом передан в работу — редактирование заблокировано. Обратитесь к OkeyBook если нужны изменения.',
        },
        { status: 403 },
      )
    }
  }

  // ─── Загрузить текущий spreads ─────────────────────────────────────
  const { data: layoutRow, error: loadError } = await supabaseAdmin
    .from('album_layouts')
    .select('id, spreads')
    .eq('album_id', albumId)
    .maybeSingle()

  if (loadError) {
    return NextResponse.json(
      { error: `load failed: ${loadError.message}` },
      { status: 500 },
    )
  }

  if (!layoutRow) {
    return NextResponse.json(
      { error: 'layout not found for this album, run build_album first' },
      { status: 404 },
    )
  }

  const spreads = layoutRow.spreads as Array<{
    spread_index: number
    data: Record<string, string | null>
    [k: string]: unknown
  }>

  if (!Array.isArray(spreads)) {
    return NextResponse.json(
      { error: 'invalid spreads in DB (not an array)' },
      { status: 500 },
    )
  }

  // ─── Найти spread и применить data_updates ─────────────────────────
  const spreadIdx = spreads.findIndex((s) => s.spread_index === spreadIndex)
  if (spreadIdx === -1) {
    return NextResponse.json(
      { error: `spread_index ${spreadIndex} not found in layout` },
      { status: 404 },
    )
  }

  const target = spreads[spreadIdx]
  const newData = { ...(target.data ?? {}) }
  for (const [k, v] of Object.entries(dataUpdates as Record<string, string | null>)) {
    if (v === null) {
      delete newData[k]
    } else {
      newData[k] = v
    }
  }
  const updatedSpread = { ...target, data: newData }
  const newSpreads = [...spreads]
  newSpreads[spreadIdx] = updatedSpread

  // ─── Сохранить ─────────────────────────────────────────────────────
  const { error: updateError } = await supabaseAdmin
    .from('album_layouts')
    .update({
      spreads: newSpreads,
      has_user_edits: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', layoutRow.id)

  if (updateError) {
    return NextResponse.json(
      { error: `update failed: ${updateError.message}` },
      { status: 500 },
    )
  }

  // Audit log. Фиксируем какие именно ключи менялись (без значений —
  // чтобы лог не разрастался на каждое движение слайдера).
  await logAction(auth, 'album_layout.update_data', 'album', albumId, {
    spread_index: spreadIndex,
    keys: Object.keys(dataUpdates),
  })

  return NextResponse.json({
    success: true,
    spread: updatedSpread,
  })
}

// ============================================================
// GET /api/layout?action=album_layout&album_id=<uuid>
// ============================================================
// Загружает existing layout из album_layouts. Используется в UI 1.4 для
// persisted state — при открытии Обзора в AlbumDetailModal.
//
// Возвращает:
//   { layout: null } — записи нет (альбом ещё не собирали)
//   { layout: { layout_id, spreads, warnings, summary } } — есть запись
//
// Доступ: тот же что у build_album (owner/manager/viewer + view_as).
// ============================================================

async function handleGetAlbumLayout(
  req: NextRequest,
  auth: AuthContext,
): Promise<NextResponse> {
  const albumId = req.nextUrl.searchParams.get('album_id')
  if (!albumId || !UUID_REGEX.test(albumId)) {
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

  const { data: layoutRow, error } = await supabaseAdmin
    .from('album_layouts')
    .select(`
      id, template_set_id, spreads, warnings, has_user_edits,
      config_presets ( slug, name )
    `)
    .eq('album_id', albumId)
    .maybeSingle()

  if (error) {
    return NextResponse.json(
      { error: `album_layouts load failed: ${error.message}` },
      { status: 500 },
    )
  }

  // Фаза Л.4a — для read-only логики возвращаем workflow_status
  // и вычисляем can_edit. Загружаем рядом с layout — один запрос
  // экономит сетевой round-trip.
  const { data: albumRow } = await supabaseAdmin
    .from('albums')
    .select('workflow_status')
    .eq('id', albumId)
    .maybeSingle()

  const workflowStatus = (albumRow?.workflow_status ?? 'active') as
    | 'active' | 'ready' | 'submitted' | 'in_production' | 'delivered'

  // can_edit логика (Л.4a):
  // - superadmin может всегда (даже после submitted — для исправлений)
  // - viewer не может никогда
  // - view_as (просмотр от имени партнёра сотрудником OkeyBook) → read-only
  // - workflow_status submitted/in_production/delivered → read-only
  //   (партнёр УЖЕ передал альбом в работу, защита от случайной правки)
  let canEdit = true
  let editBlockReason: 'role' | 'view_as' | 'submitted' | null = null

  if (auth.role === 'superadmin') {
    canEdit = true
  } else if (auth.role === 'viewer') {
    canEdit = false
    editBlockReason = 'role'
  } else if (canViewAs && viewAsTenantId) {
    // Сотрудник OkeyBook смотрит альбом партнёра — только просмотр
    canEdit = false
    editBlockReason = 'view_as'
  } else if (['submitted', 'in_production', 'delivered'].includes(workflowStatus)) {
    canEdit = false
    editBlockReason = 'submitted'
  }

  if (!layoutRow) {
    return NextResponse.json({
      layout: null,
      workflow_status: workflowStatus,
      can_edit: canEdit,
      edit_block_reason: editBlockReason,
    })
  }

  const spreads = (layoutRow.spreads ?? []) as Array<Record<string, unknown>>
  const warnings = (layoutRow.warnings ?? []) as EnrichedWarning[]

  const warningsByLevel = {
    blocking: warnings.filter((w) => w.level === 'blocking').length,
    degraded: warnings.filter((w) => w.level === 'degraded').length,
    info: warnings.filter((w) => w.level === 'info').length,
  }

  const presetData = (layoutRow as unknown as { config_presets: { slug?: string; name?: string } | null }).config_presets

  return NextResponse.json({
    layout: {
      layout_id: layoutRow.id,
      template_set_id: layoutRow.template_set_id,
      spreads,
      warnings,
      has_user_edits: layoutRow.has_user_edits ?? false,
      summary: {
        total_spreads: spreads.length,
        total_warnings: warnings.length,
        warnings_by_level: warningsByLevel,
        preset_slug: presetData?.slug ?? null,
        preset_name: presetData?.name ?? null,
      },
    },
    // Фаза Л.4a — read-only сигналы для клиента
    workflow_status: workflowStatus,
    can_edit: canEdit,
    edit_block_reason: editBlockReason,
  })
}

// ============================================================
// PDF Export handlers (фаза 3.6)
// ============================================================
//
// 3 endpoint'а, тесно связанных:
//
//   GET  ?action=list_export_profiles
//   GET  ?action=list_album_exports&album_id=<UUID>
//   POST ?action=export                         body: { album_id, profile_slug }
//
// list_export_profiles — для UI dropdown'а (фаза 3.7 ExportPanel).
// list_album_exports — для UI истории экспортов в Обзоре альбома.
// export — собственно генерация PDF + upload в YC + запись в БД.
//
// Авторизация: owner/manager/viewer тенанта, или superadmin/staff main
// с view_as. Тот же паттерн что в handleBuildAlbum.
//
// Лимиты: spreads.length <= 80 (Vercel sync timeout 60-300 сек).
// Для большего размера — async pipeline с polling, фаза 3.X.
//
// Profile.pages_mode != 'all_common' → 501. Per-student pipeline = фаза 3.A.
//
// Связь со спекой: docs/phase-3-spec.md §4.5, §4.6.
// ============================================================

/**
 * Маппинг строки из БД export_profiles в типизированный объект.
 * Изолирует кодирующий снаружи модуль (lib/pdf-export) от формата БД.
 */
function mapExportProfile(row: Record<string, unknown>): ExportProfile {
  return {
    id: String(row.id),
    tenant_id: row.tenant_id ? String(row.tenant_id) : null,
    slug: String(row.slug),
    name: String(row.name),
    is_default: Boolean(row.is_default),
    purpose: row.purpose as ExportProfile['purpose'],
    format: row.format as ExportProfile['format'],
    quality: row.quality as ExportProfile['quality'],
    include_bleed: Boolean(row.include_bleed),
    color_mode: row.color_mode as ExportProfile['color_mode'],
    dpi: Number(row.dpi),
    jpeg_quality: Number(row.jpeg_quality),
    filename_template: String(row.filename_template),
    pages_mode: row.pages_mode as ExportProfile['pages_mode'],
    target_size_mb: row.target_size_mb != null ? Number(row.target_size_mb) : null,
    enabled: Boolean(row.enabled),
    spread_export: Boolean(row.spread_export),
  }
}

/**
 * Slugify имя альбома для filename. Удаляет спецсимволы запрещённые
 * в Windows/macOS/Linux file systems, заменяет пробелы на _.
 * Кириллица сохраняется (современные FS поддерживают).
 *
 * Если результат пустой — возвращает 'album'.
 */
function slugifyForFilename(name: string): string {
  const cleaned = name.replace(/[\\/:"*?<>|]/g, '').replace(/\s+/g, '_').trim()
  return cleaned || 'album'
}

/**
 * Подстановка переменных в filename_template из export_profiles.
 *
 * Поддерживаемые переменные:
 *   {album_name} {date} {datetime} {ext} {student_name}
 *
 * Неподдержанные — оставляются как есть (для отладки).
 */
function renderFilename(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`)
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/layout?action=list_export_profiles
//
// Возвращает enabled профили доступные текущему тенанту: глобальные
// (tenant_id IS NULL) + кастомные тенанта (фаза 3.X — пока их нет).
// Сортировка: is_default=true первым, потом по имени.
// ─────────────────────────────────────────────────────────────────────────
async function handleListExportProfiles(
  _req: NextRequest,
  auth: AuthContext,
): Promise<NextResponse> {
  let query = supabaseAdmin
    .from('export_profiles')
    .select('*')
    .eq('enabled', true)
    .order('is_default', { ascending: false })
    .order('name', { ascending: true })

  if (auth.role !== 'superadmin') {
    query = query.or(`tenant_id.is.null,tenant_id.eq.${auth.tenantId}`)
  }

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const profiles = (data ?? []).map((row) => mapExportProfile(row as Record<string, unknown>))
  return NextResponse.json({ profiles })
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/layout?action=list_album_exports&album_id=<UUID>
//
// Последние 10 экспортов альбома с download_url'ами. Используется UI
// ExportPanel для отображения истории.
//
// Поддерживает view_as как в handleBuildAlbum.
// ─────────────────────────────────────────────────────────────────────────
async function handleListAlbumExports(
  req: NextRequest,
  auth: AuthContext,
): Promise<NextResponse> {
  const albumId = req.nextUrl.searchParams.get('album_id')
  if (!albumId || !UUID_REGEX.test(albumId)) {
    return NextResponse.json({ error: 'album_id (uuid) required' }, { status: 400 })
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

  const { data, error } = await supabaseAdmin
    .from('album_exports')
    .select(
      'id, profile_id, filename, storage_path, file_size, page_count, ' +
      'warnings, created_at, expires_at, ' +
      'export_profiles ( slug, name, format, purpose )'
    )
    .eq('album_id', albumId)
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Обогащаем download_url для каждой записи (presigned URL не делаем —
  // bucket public-read, security through obscurity через UUID в имени).
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>
  const enriched = rows.map((row) => ({
    ...row,
    download_url: ycPhotoUrl(String(row.storage_path)),
  }))

  return NextResponse.json({ exports: enriched })
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/layout?action=export
// Body: { album_id: uuid, profile_slug: string }
//
// Главный endpoint фазы 3.6 — генерация PDF из layout'а альбома.
//
// Алгоритм:
// 1. Validate body и доступ к альбому (с view_as)
// 2. Load profile by slug (глобальный или текущего тенанта)
// 3. Validate profile.enabled, pages_mode='all_common' (иначе 501)
// 4. Load layout from album_layouts (404 если нет)
// 5. Validate spreads.length: 0 < N <= 80
// 6. Сборка AlbumExportInput:
//    - album metadata
//    - layout.spreads + has_user_edits
//    - templateSet через loadTemplateSet
//    - albumInput через buildAlbumInput (smart-fill)
//    - originals[] из original_photos
//    - urlToFilename мапа из photos
// 7. exportAlbumPdf → pdfBytes + pageCount + warnings
// 8. ycUpload в album_id/exports/<ts>_<slug>.pdf
// 9. Insert album_exports с layout_snapshot
// 10. logAction('album_export.create')
// 11. Response с download_url
// ─────────────────────────────────────────────────────────────────────────
async function handleExportPdf(
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
  const profileSlug = (body as Record<string, unknown>).profile_slug

  if (typeof albumId !== 'string' || !UUID_REGEX.test(albumId)) {
    return NextResponse.json({ error: 'album_id (uuid) required' }, { status: 400 })
  }
  if (typeof profileSlug !== 'string' || profileSlug.length === 0) {
    return NextResponse.json({ error: 'profile_slug required' }, { status: 400 })
  }

  // view_as поддержка
  const viewAsTenantId = req.nextUrl.searchParams.get('view_as')
  const { data: currentTenantData } = viewAsTenantId
    ? await supabaseAdmin.from('tenants').select('slug').eq('id', auth.tenantId).single()
    : { data: null }
  const canViewAs = auth.role === 'superadmin' || currentTenantData?.slug === 'main'
  const tid = (canViewAs && viewAsTenantId) ? viewAsTenantId : auth.tenantId

  if (!(await assertAlbumAccessLocal(auth, albumId, tid))) {
    return NextResponse.json({ error: 'access denied' }, { status: 403 })
  }

  // 1. Load album + tenant_id для записи в album_exports.
  // ВАЖНО: в schema.sql колонка названия — `title`, не `name`.
  const { data: album, error: albumErr } = await supabaseAdmin
    .from('albums')
    .select('id, title, tenant_id')
    .eq('id', albumId)
    .single()

  if (albumErr || !album) {
    return NextResponse.json({ error: 'album not found' }, { status: 404 })
  }

  // 2. Load profile by slug. Доступны: глобальные + текущего tenant'а
  // (фаза 3 — кастомных тенант-профилей не существует, но архитектура
  // готова).
  let profileQuery = supabaseAdmin
    .from('export_profiles')
    .select('*')
    .eq('slug', profileSlug)
    .eq('enabled', true)

  if (auth.role !== 'superadmin') {
    profileQuery = profileQuery.or(
      `tenant_id.is.null,tenant_id.eq.${auth.tenantId}`,
    )
  }

  const { data: profileRow, error: profileErr } = await profileQuery.maybeSingle()
  if (profileErr) {
    return NextResponse.json(
      { error: `profile load failed: ${profileErr.message}` },
      { status: 500 },
    )
  }
  if (!profileRow) {
    return NextResponse.json(
      { error: `Профиль экспорта "${profileSlug}" не найден или отключён` },
      { status: 404 },
    )
  }

  const profile = mapExportProfile(profileRow as Record<string, unknown>)

  // 3. Per-student режим — пока не реализован (фаза 3.A)
  if (profile.pages_mode !== 'all_common') {
    return NextResponse.json(
      {
        error:
          'Per-student режим экспорта в разработке (фаза 3.A). ' +
          'Используйте профиль "okeybook-print" или "okeybook-client-preview".',
        code: 'pages_mode_not_implemented',
      },
      { status: 501 },
    )
  }

  // jpg-pages driver — пока не реализован (фаза 3.X)
  if (profile.format !== 'pdf') {
    return NextResponse.json(
      {
        error: `Формат "${profile.format}" в разработке. В фазе 3 поддерживается только PDF.`,
        code: 'format_not_implemented',
      },
      { status: 501 },
    )
  }

  // 4. Load layout from album_layouts
  const { data: layoutRow, error: layoutErr } = await supabaseAdmin
    .from('album_layouts')
    .select('id, spreads, has_user_edits')
    .eq('album_id', albumId)
    .maybeSingle()

  if (layoutErr) {
    return NextResponse.json(
      { error: `layout load failed: ${layoutErr.message}` },
      { status: 500 },
    )
  }
  if (!layoutRow) {
    return NextResponse.json(
      {
        error:
          'Layout альбома не собран. Сначала нажмите "Собрать автоматически" в Обзоре альбома.',
      },
      { status: 404 },
    )
  }

  const spreads = (layoutRow.spreads ?? []) as Array<Record<string, unknown>>
  if (spreads.length === 0) {
    return NextResponse.json(
      { error: 'Layout пустой. Пересоберите его.' },
      { status: 400 },
    )
  }
  if (spreads.length > 80) {
    return NextResponse.json(
      {
        error: `Альбом слишком большой для синхронного экспорта: ${spreads.length} разворотов (лимит 80). Обратитесь в поддержку.`,
        code: 'too_many_spreads',
      },
      { status: 400 },
    )
  }

  // 5. Сборка AlbumExportInput
  // 5a. albumInput через smart-fill
  let smartFillResult: { input: AlbumInput; warnings: SmartFillWarning[] }
  try {
    smartFillResult = await buildAlbumInput(supabaseAdmin, albumId)
  } catch (e) {
    return NextResponse.json(
      { error: `smart-fill failed: ${(e as Error).message}` },
      { status: 500 },
    )
  }

  // 5b. template_set
  let templateSet: TemplateSet
  try {
    templateSet = await loadTemplateSet(supabaseAdmin)
  } catch (e) {
    return NextResponse.json(
      { error: `template_set load failed: ${(e as Error).message}` },
      { status: 500 },
    )
  }

  // 5c. originals — два источника, объединяются с приоритетом нового (Б.2).
  //
  // Источник 1 (Б.1, 11.05.2026): photos.original_path — заполняется
  // автоматически при загрузке фото через uploadFilesParallel в PhotosTab.
  // Это новый основной механизм.
  //
  // Источник 2 (legacy): original_photos таблица — заполнялась через
  // вкладку «Производство → Загрузка оригиналов». Этот механизм потерял
  // актуальность с переходом системы от инструмента отбора к полноценной
  // автовёрстке (комментарий Сергея 11.05.2026). UI вкладки можно будет
  // удалить отдельной задачей; backend оставлен работать чтобы не сломать
  // существующие альбомы.
  //
  // Объединяем: photos.original_path в начале массива → выигрывает в
  // .find(filename) lookup'е в photo-embed.ts при коллизии.
  const { data: legacyOriginalsData, error: legacyOriginalsErr } = await supabaseAdmin
    .from('original_photos')
    .select('id, filename, storage_path')
    .eq('album_id', albumId)

  if (legacyOriginalsErr) {
    return NextResponse.json(
      { error: `legacy originals load failed: ${legacyOriginalsErr.message}` },
      { status: 500 },
    )
  }
  const legacyOriginals: OriginalPhoto[] = (legacyOriginalsData ?? []).map((row) => ({
    id: String(row.id),
    filename: String(row.filename),
    storage_path: String(row.storage_path),
  }))

  // 5d. urlToFilename мапа + photos.original_path для originals[].
  // Один запрос: тянем сразу всё нужное.
  const { data: photosData, error: photosErr } = await supabaseAdmin
    .from('photos')
    .select('id, filename, storage_path, original_path')
    .eq('album_id', albumId)

  if (photosErr) {
    return NextResponse.json(
      { error: `photos load failed: ${photosErr.message}` },
      { status: 500 },
    )
  }
  const urlToFilename: Record<string, string> = {}
  // Оригиналы из photos.original_path. Кладём в начало originals[] чтобы
  // выиграть в .find() lookup'е при коллизии filename'ов с legacy таблицей.
  // storage_path может прийти с префиксом 'yc:' (норма) или без (на всякий
  // случай). photo-embed.ts:buildYcUrl ожидает БЕЗ префикса, поэтому
  // нормализуем: убираем 'yc:' если есть.
  const inlineOriginals: OriginalPhoto[] = []
  for (const p of photosData ?? []) {
    const row = p as Record<string, unknown>
    const storagePath = String(row.storage_path)
    const url = getPhotoUrl(storagePath)
    const filename = String(row.filename)
    if (url) urlToFilename[url] = filename

    const originalPath = row.original_path
    if (typeof originalPath === 'string' && originalPath.length > 0) {
      const cleanPath = originalPath.startsWith('yc:')
        ? originalPath.slice(3)
        : originalPath
      inlineOriginals.push({
        id: String(row.id),
        filename,
        storage_path: cleanPath,
      })
    }
  }

  // Финальный массив: новые (photos.original_path) → legacy (original_photos).
  // При коллизии filename'ов выиграет первый — то есть новый.
  const originals: OriginalPhoto[] = [...inlineOriginals, ...legacyOriginals]

  // 5e. Пул категорийных фонов набора (template_set_backgrounds) — для
  // ротации фонов в PDF (тот же резолвер, что в редакторе/превью).
  const { data: bgPool } = await supabaseAdmin
    .from('template_set_backgrounds')
    .select('category, url, sort_order')
    .eq('template_set_id', templateSet.id)
    .order('category', { ascending: true })
    .order('sort_order', { ascending: true })

  // 6. exportAlbumPdf
  const exportInput: AlbumExportInput = {
    album: {
      id: String(album.id),
      // В БД поле называется title (см. schema.sql).
      // В AlbumExportInput.album.name — оставлено name как унифицированное
      // поле для PDF metadata (PDFDocument.setTitle), маппинг здесь.
      name: String(album.title),
      tenant_id: String(album.tenant_id),
    },
    layout: {
      spreads: spreads as unknown as AlbumExportInput['layout']['spreads'],
      has_user_edits: Boolean(layoutRow.has_user_edits),
    },
    templateSet,
    albumInput: smartFillResult.input,
    originals,
    urlToFilename,
    profile,
    backgrounds: bgPool ?? [],
  }

  let pdfResult: Awaited<ReturnType<typeof exportAlbumPdf>>
  try {
    pdfResult = await exportAlbumPdf(exportInput)
  } catch (e) {
    return NextResponse.json(
      { error: `pdf generation failed: ${(e as Error).message}` },
      { status: 500 },
    )
  }

  // 7. Render filename + storage_path
  const slugAlbum = slugifyForFilename(String(album.title))
  const now = new Date()
  const date = now.toISOString().slice(0, 10) // YYYY-MM-DD
  const datetime = `${now.toISOString().slice(0, 10)}_${now
    .toISOString()
    .slice(11, 16)
    .replace(':', '-')}` // YYYY-MM-DD_HH-MM
  const ext = profile.format === 'pdf' ? 'pdf' : 'jpg'

  const filename = renderFilename(profile.filename_template, {
    album_name: slugAlbum,
    date,
    datetime,
    ext,
    student_name: '', // не используется в all_common, оставлено для будущего 3.A
  })

  const ts = Math.floor(now.getTime() / 1000)
  const storagePath = `${albumId}/exports/${ts}_${profile.slug}.${ext}`

  // 8. Upload в YC
  try {
    await ycUpload(
      storagePath,
      Buffer.from(pdfResult.pdfBytes),
      'application/pdf',
    )
  } catch (e) {
    return NextResponse.json(
      { error: `yc upload failed: ${(e as Error).message}` },
      { status: 500 },
    )
  }

  // 9. Insert в album_exports
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 90)

  const { data: insertedRow, error: insertErr } = await supabaseAdmin
    .from('album_exports')
    .insert({
      album_id: albumId,
      tenant_id: album.tenant_id,
      profile_id: profile.id,
      storage_path: storagePath,
      filename,
      file_size: pdfResult.pdfBytes.length,
      page_count: pdfResult.pageCount,
      layout_snapshot: spreads,
      warnings: pdfResult.warnings,
      created_by: auth.userId,
      expires_at: expiresAt.toISOString(),
    })
    .select('id')
    .single()

  if (insertErr || !insertedRow) {
    return NextResponse.json(
      { error: `album_exports insert failed: ${insertErr?.message ?? 'no row'}` },
      { status: 500 },
    )
  }

  // 10. Audit log
  await logAction(auth, 'album_export.create', 'album', albumId, {
    profile_slug: profile.slug,
    page_count: pdfResult.pageCount,
    file_size: pdfResult.pdfBytes.length,
    warnings_count: pdfResult.warnings.length,
    smart_fill_warnings_count: smartFillResult.warnings.length,
  })

  // 11. Response
  return NextResponse.json({
    export_id: insertedRow.id,
    download_url: ycPhotoUrl(storagePath),
    filename,
    file_size: pdfResult.pdfBytes.length,
    page_count: pdfResult.pageCount,
    warnings: pdfResult.warnings,
  })
}
