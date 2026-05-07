import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth, isAuthError, logAction, type AuthContext } from '@/lib/auth'
import { parseIdml } from '@/lib/idml-converter/parse'
import { uploadTemplateSetToSupabase, type UploadResult } from '@/lib/idml-converter/upload'
import type { ParsedTemplateSet } from '@/lib/idml-converter/types'
import { buildAlbum } from '@/lib/album-builder/build'
import { loadTemplateSet } from '@/lib/album-builder/load-template-set'
import type {
  Student,
  Subject,
  HeadTeacher,
  AlbumInput,
  Config,
  ConfigType,
  PrintType,
  TemplateSet,
} from '@/lib/album-builder/types'

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
  const auth = await requireAuth(req, ['superadmin'])
  if (isAuthError(auth)) return auth

  const action = req.nextUrl.searchParams.get('action')

  if (action === 'build_album_test') {
    return handleBuildAlbumTest(req)
  }

  if (action === 'import_idml') {
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

const VALID_CONFIG_TYPES: ConfigType[] = [
  'standard', 'universal', 'maximum', 'medium',
  'light', 'mini', 'individual',
]

const VALID_PRINT_TYPES: PrintType[] = ['layflat', 'soft']

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

  const configType = b.config_type
  if (typeof configType !== 'string' || !VALID_CONFIG_TYPES.includes(configType as ConfigType)) {
    return NextResponse.json(
      { error: `config_type must be one of ${VALID_CONFIG_TYPES.join(', ')}` },
      { status: 400 },
    )
  }

  const printType = b.print_type
  if (typeof printType !== 'string' || !VALID_PRINT_TYPES.includes(printType as PrintType)) {
    return NextResponse.json(
      { error: 'print_type must be layflat or soft' },
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

  const input: AlbumInput = {
    template_set_id: templateSet.id,
    head_teacher: headTeacher,
    subjects,
    students,
    common_photos: commonPhotos,
  }
  const config: Config = {
    config_type: configType as ConfigType,
    print_type: printType as PrintType,
    template_set: templateSet,
  }

  const result = buildAlbum(input, config)

  return NextResponse.json({
    spreads: result.spreads,
    warnings: result.warnings,
    summary: {
      total_spreads: result.spreads.length,
      total_warnings: result.warnings.length,
      config_type: config.config_type,
      print_type: config.print_type,
      students_count: studentsCount,
      subjects_count: subjectsCount,
    },
  })
}
