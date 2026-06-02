/**
 * API библиотеки обложек — Этап 6б (ТЗ docs/tz-cover-design.md).
 *
 * Только для супер-админа. Загрузка cover-IDML в таблицу covers, список с
 * SVG-превью, публикация/снятие, удаление.
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth, isAuthError, logAction, type AuthContext } from '@/lib/auth'
import { parseIdml } from '@/lib/idml-converter/parse'
import type { ParsedTemplateSet } from '@/lib/idml-converter/types'
import { uploadCoversToSupabase } from '@/lib/cover/upload-covers'
import { layoutCover } from '@/lib/cover/layout'
import { renderCoverPreviewSvg } from '@/lib/cover/preview-svg'
import type { Placeholder } from '@/lib/album-builder/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ─── GET: список обложек с превью ───────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, ['superadmin'])
  if (isAuthError(auth)) return auth

  const action = req.nextUrl.searchParams.get('action')
  if (action !== 'list') {
    return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('covers')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const covers = (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    cover_type: row.cover_type,
    gender_hint: row.gender_hint,
    is_global: row.is_global,
    tenant_id: row.tenant_id,
    is_published: row.is_published,
    back_width_mm: row.back_width_mm,
    front_width_mm: row.front_width_mm,
    height_mm: row.height_mm,
    nominal_spine_width_mm: row.nominal_spine_width_mm,
    preview_svg: coverPreviewSvg(row),
  }))

  return NextResponse.json({ covers })
}

// ─── POST: загрузка IDML / публикация / удаление ────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req, ['superadmin'])
  if (isAuthError(auth)) return auth

  const action = req.nextUrl.searchParams.get('action')

  if (action === 'import') return handleImportCovers(req, auth)
  if (action === 'set_published') return handleSetPublished(req)
  if (action === 'delete') return handleDelete(req, auth)

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}

async function handleImportCovers(req: NextRequest, auth: AuthContext): Promise<NextResponse> {
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'invalid multipart body' }, { status: 400 })
  }

  const file = formData.get('file')
  const tenantIdRaw = formData.get('tenant_id')
  const isPublishedRaw = formData.get('is_published')
  const forceRaw = formData.get('force')

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 })
  }

  let tenantId: string | null
  if (tenantIdRaw === null || tenantIdRaw === '' || tenantIdRaw === 'global') {
    tenantId = null
  } else if (typeof tenantIdRaw === 'string' && UUID_REGEX.test(tenantIdRaw)) {
    tenantId = tenantIdRaw
  } else {
    return NextResponse.json({ error: 'invalid tenant_id' }, { status: 400 })
  }

  const isPublished = isPublishedRaw === 'true'
  const force = forceRaw === 'true'

  // Парсинг IDML.
  const buffer = Buffer.from(await file.arrayBuffer())
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
      { tenantId, isPublished, force },
      supabaseAdmin,
    )
    await logAction(auth, 'cover.import_idml', 'cover', result.cover_ids[0] ?? null, {
      tenant_id: tenantId,
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
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

async function handleDelete(req: NextRequest, auth: AuthContext): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}))
  const id = body.id
  if (typeof id !== 'string') {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }
  const { error } = await supabaseAdmin.from('covers').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await logAction(auth, 'cover.delete', 'cover', id, {})
  return NextResponse.json({ ok: true })
}

// ─── Превью обложки из строки covers ────────────────────────────────────────
function coverPreviewSvg(row: Record<string, unknown>): string {
  const back = num(row.back_width_mm)
  const front = num(row.front_width_mm)
  const nominal = num(row.nominal_spine_width_mm)
  let height = num(row.height_mm)
  const placeholders = (Array.isArray(row.placeholders) ? row.placeholders : []) as Array<
    Placeholder & { zone?: 'back' | 'spine' | 'front' }
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
  })
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : 0
  return Number.isFinite(n) ? n : 0
}
