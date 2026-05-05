import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth, isAuthError, logAction } from '@/lib/auth'
import { parseIdml } from '@/lib/idml-converter/parse'
import { uploadTemplateSetToSupabase, type UploadResult } from '@/lib/idml-converter/upload'
import type { ParsedTemplateSet } from '@/lib/idml-converter/types'

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
  if (action !== 'import_idml') {
    return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  }

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
