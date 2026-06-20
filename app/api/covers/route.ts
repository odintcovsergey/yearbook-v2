/**
 * API библиотеки обложек (ТЗ tz-cover-connect-to-order, ранее tz-cover-design).
 *
 * Только для супер-админа. Загрузка cover-IDML в таблицу covers, список с
 * SVG-превью, публикация/снятие, удаление, фон при обложке.
 *
 * Обложки бывают двух видов:
 *   - родные обложки дизайна: template_set_id заполнен, is_global=false;
 *   - библиотечные (дизайнерские): template_set_id=null, is_global=true.
 *
 * Загрузка IDML — двумя путями:
 *   - JSON { storage_key } (presigned): большой IDML (~8 МБ) уже залит напрямую
 *     в хранилище, сервер скачивает по ключу и парсит (обход лимита Vercel 413);
 *   - multipart/form-data (legacy/мелкие файлы и скрипты).
 */
import { NextRequest, NextResponse } from 'next/server'
import { serverError } from '@/lib/api-error'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth, isAuthError, logAction, type AuthContext } from '@/lib/auth'
import { parseIdml } from '@/lib/idml-converter/parse'
import type { ParsedTemplateSet } from '@/lib/idml-converter/types'
import { uploadCoversToSupabase } from '@/lib/cover/upload-covers'
import { layoutCover } from '@/lib/cover/layout'
import { renderCoverPreviewSvg } from '@/lib/cover/preview-svg'
import { ycGetObjectBuffer, ycDelete, stripYcPrefix } from '@/lib/storage'
import { createUploadTarget, resolveReadUrl, storedValue } from '@/lib/blob-storage'
import type { RenderPlaceholder } from '@/lib/album-builder/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Фон обложки — тот же bucket, что у фонов внутрянки (template-backgrounds).
const BG_ALLOWED_EXT = new Set(['jpg', 'png'])

// ─── GET: список обложек с превью ───────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, ['superadmin'])
  if (isAuthError(auth)) return auth

  const action = req.nextUrl.searchParams.get('action')
  if (action !== 'list') {
    return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  }

  // Фильтр области:
  //   template_set_id=<uuid> → родные обложки этого дизайна (карточка дизайна);
  //   scope=library          → только дизайнерская библиотека (template_set_id IS NULL);
  //   без параметров         → все обложки (полный список администратора).
  const templateSetId = req.nextUrl.searchParams.get('template_set_id')
  const scope = req.nextUrl.searchParams.get('scope')

  let query = supabaseAdmin
    .from('covers')
    .select('*')
    .order('created_at', { ascending: false })
  if (templateSetId && UUID_REGEX.test(templateSetId)) {
    query = query.eq('template_set_id', templateSetId)
  } else if (scope === 'library') {
    query = query.is('template_set_id', null)
  }

  const { data, error } = await query
  if (error) {
    return serverError(error, 'covers')
  }

  const covers = await Promise.all((data ?? []).map(async (row: Record<string, unknown>) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    cover_type: row.cover_type,
    gender_hint: row.gender_hint,
    is_global: row.is_global,
    tenant_id: row.tenant_id,
    template_set_id: row.template_set_id,
    is_published: row.is_published,
    back_width_mm: row.back_width_mm,
    front_width_mm: row.front_width_mm,
    height_mm: row.height_mm,
    nominal_spine_width_mm: row.nominal_spine_width_mm,
    background_url: await resolveReadUrl('template-backgrounds', row.background_url as string | null),
    preview_svg: coverPreviewSvg(row),
  })))

  return NextResponse.json({ covers })
}

// ─── POST: загрузка IDML / публикация / удаление / фон ──────────────────────
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req, ['superadmin'])
  if (isAuthError(auth)) return auth

  const action = req.nextUrl.searchParams.get('action')

  if (action === 'import') return handleImportCovers(req, auth)
  if (action === 'set_published') return handleSetPublished(req)
  if (action === 'delete') return handleDelete(req, auth)
  if (action === 'bg_sign') return handleBgSign(req)
  if (action === 'bg_commit') return handleBgCommit(req, auth)
  if (action === 'bg_clear') return handleBgClear(req, auth)

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}

/** Нормализует tenant_id: '', 'global', null → null; UUID → строка; иначе ошибка. */
function normalizeTenantId(raw: unknown): { ok: true; value: string | null } | { ok: false } {
  if (raw === null || raw === undefined || raw === '' || raw === 'global') {
    return { ok: true, value: null }
  }
  if (typeof raw === 'string' && UUID_REGEX.test(raw)) return { ok: true, value: raw }
  return { ok: false }
}

/** Нормализует template_set_id: '', null → null (библиотечная); UUID → строка. */
function normalizeTemplateSetId(raw: unknown): { ok: true; value: string | null } | { ok: false } {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null }
  if (typeof raw === 'string' && UUID_REGEX.test(raw)) return { ok: true, value: raw }
  return { ok: false }
}

async function handleImportCovers(req: NextRequest, auth: AuthContext): Promise<NextResponse> {
  const reqCt = req.headers.get('content-type') ?? ''
  let buffer: Buffer
  let tenantRaw: unknown
  let templateSetRaw: unknown
  let isPublished: boolean
  let force: boolean

  if (reqCt.includes('application/json')) {
    // Presigned-путь: файл уже в хранилище, пришёл только ключ (обход 413).
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body.storage_key !== 'string') {
      return NextResponse.json({ error: 'storage_key is required' }, { status: 400 })
    }
    const key = stripYcPrefix(body.storage_key)
    if (!key.startsWith('template-imports/')) {
      return NextResponse.json({ error: 'invalid storage_key' }, { status: 400 })
    }
    tenantRaw = body.tenant_id
    templateSetRaw = body.template_set_id
    isPublished = body.is_published === true
    force = body.force === true
    try {
      buffer = await ycGetObjectBuffer(key)
    } catch {
      return NextResponse.json(
        { error: 'storage_read_failed', message: 'Не удалось прочитать загруженный файл из хранилища' },
        { status: 400 },
      )
    }
    // Временный файл больше не нужен — чистим (best-effort).
    ycDelete(key).catch(() => {})
  } else {
    let formData: FormData
    try {
      formData = await req.formData()
    } catch {
      return NextResponse.json({ error: 'invalid multipart body' }, { status: 400 })
    }
    const file = formData.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 })
    }
    tenantRaw = formData.get('tenant_id')
    templateSetRaw = formData.get('template_set_id')
    isPublished = formData.get('is_published') === 'true'
    force = formData.get('force') === 'true'
    buffer = Buffer.from(await file.arrayBuffer())
  }

  const t = normalizeTenantId(tenantRaw)
  if (!t.ok) return NextResponse.json({ error: 'invalid tenant_id' }, { status: 400 })
  const ts = normalizeTemplateSetId(templateSetRaw)
  if (!ts.ok) return NextResponse.json({ error: 'invalid template_set_id' }, { status: 400 })

  // Парсинг IDML.
  let parsed: ParsedTemplateSet
  try {
    parsed = await parseIdml(buffer)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'parse failed'
    return NextResponse.json({ error: 'idml_parse_failed', message }, { status: 400 })
  }

  try {
    const result = await uploadCoversToSupabase(
      parsed,
      { tenantId: t.value, templateSetId: ts.value, isPublished, force },
      supabaseAdmin,
    )
    await logAction(auth, 'cover.import_idml', 'cover', result.cover_ids[0] ?? null, {
      tenant_id: t.value,
      template_set_id: ts.value,
      cover_count: result.cover_count,
      names: result.names,
    })
    return NextResponse.json({
      cover_count: result.cover_count,
      names: result.names,
      warnings: [...(parsed.warnings ?? []).map((w) => w.message), ...result.warnings],
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'upload failed'
    // Конфликт уникальности slug без force.
    if (/duplicate key|unique/i.test(message)) {
      return NextResponse.json(
        { error: 'slug_exists', message, requires_force: true },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: 'upload_failed', message }, { status: 500 })
  }
}

async function handleSetPublished(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}))
  const id = body.id
  const isPublished = body.is_published === true
  if (typeof id !== 'string') {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }
  const { error } = await supabaseAdmin
    .from('covers')
    .update({ is_published: isPublished })
    .eq('id', id)
  if (error) return serverError(error, 'covers')
  return NextResponse.json({ ok: true })
}

async function handleDelete(req: NextRequest, auth: AuthContext): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}))
  const id = body.id
  if (typeof id !== 'string') {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }
  const { error } = await supabaseAdmin.from('covers').delete().eq('id', id)
  if (error) return serverError(error, 'covers')
  await logAction(auth, 'cover.delete', 'cover', id, {})
  return NextResponse.json({ ok: true })
}

// ─── Фон при обложке (covers.background_url) ─────────────────────────────────

/** Шаг 1: подписанная ссылка на прямую заливку фона в storage. */
async function handleBgSign(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}))
  const id = body.id
  const ext = String(body.ext ?? '')
  if (typeof id !== 'string' || !UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }
  if (!BG_ALLOWED_EXT.has(ext)) {
    return NextResponse.json({ error: 'Допустимы только JPG и PNG' }, { status: 400 })
  }
  const { data: cover } = await supabaseAdmin.from('covers').select('id').eq('id', id).single()
  if (!cover) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const path = `covers/${id}/${crypto.randomUUID()}.${ext}`
  try {
    const target = await createUploadTarget('template-backgrounds', path, `image/${ext === 'jpg' ? 'jpeg' : ext}`)
    return NextResponse.json({ ok: true, ...target })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'sign failed' }, { status: 500 })
  }
}

/** Шаг 2: зафиксировать background_url после заливки. */
async function handleBgCommit(req: NextRequest, auth: AuthContext): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}))
  const id = body.id
  const path = String(body.path ?? '')
  if (typeof id !== 'string' || !UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }
  if (!path.startsWith(`covers/${id}/`)) {
    return NextResponse.json({ error: 'invalid path' }, { status: 400 })
  }
  const stored = storedValue('template-backgrounds', path)
  const { error } = await supabaseAdmin.from('covers').update({ background_url: stored }).eq('id', id)
  if (error) return serverError(error, 'covers')
  await logAction(auth, 'cover.set_background', 'cover', id, { path })
  return NextResponse.json({ ok: true, background_url: await resolveReadUrl('template-backgrounds', stored) })
}

/** Снять фон у обложки. */
async function handleBgClear(req: NextRequest, auth: AuthContext): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}))
  const id = body.id
  if (typeof id !== 'string' || !UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }
  const { error } = await supabaseAdmin.from('covers').update({ background_url: null }).eq('id', id)
  if (error) return serverError(error, 'covers')
  await logAction(auth, 'cover.clear_background', 'cover', id, {})
  return NextResponse.json({ ok: true })
}

// ─── Превью обложки из строки covers ────────────────────────────────────────
function coverPreviewSvg(row: Record<string, unknown>): string {
  const back = num(row.back_width_mm)
  const front = num(row.front_width_mm)
  const nominal = num(row.nominal_spine_width_mm)
  let height = num(row.height_mm)
  const placeholders = (Array.isArray(row.placeholders) ? row.placeholders : []) as Array<
    RenderPlaceholder & { zone?: 'back' | 'spine' | 'front' }
  >

  // Превью библиотечной обложки рисуем «как нарисовано»: реальный корешок =
  // номинальному (нет альбома → нет числа листов).
  const laid = layoutCover(
    {
      backWidthMm: back,
      frontWidthMm: front,
      heightMm: height,
      nominalSpineWidthMm: nominal,
      realSpineWidthMm: nominal,
    },
    placeholders,
  )

  let width = laid.width_mm
  // Фолбэк, если зоны не распознались (нет 3 страниц): оценим по плейсхолдерам.
  if (width <= 0 || height <= 0) {
    for (const p of placeholders) {
      width = Math.max(width, (p.x_mm ?? 0) + (p.width_mm ?? 0))
      height = Math.max(height, (p.y_mm ?? 0) + (p.height_mm ?? 0))
    }
  }

  return renderCoverPreviewSvg({
    width_mm: width || 100,
    height_mm: height || 100,
    spine_left_mm: laid.spine_left_mm,
    spine_right_mm: laid.spine_right_mm,
    placeholders: laid.placeholders,
    background_url: typeof row.background_url === 'string' ? row.background_url : null,
  })
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : 0
  return Number.isFinite(n) ? n : 0
}
