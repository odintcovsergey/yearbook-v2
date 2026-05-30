import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth, isAuthError, logAction } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

// ============================================================
// Категорийные фоны набора (template_set_backgrounds).
//
// В отличие от одиночного default_background_url (см. соседний
// background/route.ts), здесь пул нескольких фонов по категориям с
// ротацией. Один файл = одна строка template_set_backgrounds.
//
// Хранилище: тот же bucket template-backgrounds, путь
//   <template_set_id>/<category>/<uuid>.<ext>
// чтобы не конфликтовать с default.jpg/png.
// ============================================================

const BUCKET = 'template-backgrounds'
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png'])
const MAX_SIZE = 50 * 1024 * 1024 // 50 MB
const ALLOWED_SIDES = new Set(['spread', 'left', 'right', 'any'])

function extFromMime(mime: string): 'jpg' | 'png' | null {
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/png') return 'png'
  return null
}

function publicUrl(path: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`
}

async function loadSet(templateSetId: string) {
  const { data } = await supabaseAdmin
    .from('template_sets')
    .select('id, name')
    .eq('id', templateSetId)
    .single()
  return data
}

// ============================================================
// GET — список всех категорийных фонов набора.
// ============================================================
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req, ['superadmin'])
  if (isAuthError(auth)) return auth

  const templateSetId = params.id
  if (!templateSetId) {
    return NextResponse.json({ error: 'template_set id обязателен' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('template_set_backgrounds')
    .select('id, category, url, sort_order, side, created_at')
    .eq('template_set_id', templateSetId)
    .order('category', { ascending: true })
    .order('sort_order', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const backgrounds = (data ?? []).map((row) => ({
    ...row,
    public_url: publicUrl(row.url),
  }))

  return NextResponse.json({ ok: true, backgrounds })
}

// ============================================================
// POST — загрузить один или несколько фонов в категорию.
// multipart/form-data: file (один или несколько), category, side (опц).
// Каждый файл становится отдельной строкой, sort_order дописывается в конец.
// ============================================================
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req, ['superadmin'])
  if (isAuthError(auth)) return auth

  const templateSetId = params.id
  if (!templateSetId) {
    return NextResponse.json({ error: 'template_set id обязателен' }, { status: 400 })
  }

  const set = await loadSet(templateSetId)
  if (!set) {
    return NextResponse.json({ error: 'Набор не найден' }, { status: 404 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Неверный формат запроса' }, { status: 400 })
  }

  const category = String(formData.get('category') ?? '').trim()
  if (!category) {
    return NextResponse.json({ error: 'Категория обязательна' }, { status: 400 })
  }

  const sideRaw = String(formData.get('side') ?? 'spread')
  const side = ALLOWED_SIDES.has(sideRaw) ? sideRaw : 'spread'

  const files = formData.getAll('file').filter((f): f is File => f instanceof File)
  if (files.length === 0) {
    return NextResponse.json({ error: 'Нет файлов' }, { status: 400 })
  }

  for (const file of files) {
    if (!ALLOWED_MIME.has(file.type)) {
      return NextResponse.json({ error: 'Допустимы только JPG и PNG' }, { status: 400 })
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'Файл больше 50 МБ' }, { status: 400 })
    }
  }

  // Текущий максимум sort_order в категории — дописываем новые в конец.
  const { data: existing } = await supabaseAdmin
    .from('template_set_backgrounds')
    .select('sort_order')
    .eq('template_set_id', templateSetId)
    .eq('category', category)
    .order('sort_order', { ascending: false })
    .limit(1)

  let nextOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0

  const created: Array<Record<string, unknown>> = []

  for (const file of files) {
    const ext = extFromMime(file.type)!
    const path = `${templateSetId}/${category}/${crypto.randomUUID()}.${ext}`

    const buffer = Buffer.from(await file.arrayBuffer())
    const { error: upErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: file.type, upsert: true })

    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 })
    }

    const { data: row, error: dbErr } = await supabaseAdmin
      .from('template_set_backgrounds')
      .insert({
        template_set_id: templateSetId,
        category,
        url: path,
        sort_order: nextOrder,
        side,
      })
      .select('id, category, url, sort_order, side, created_at')
      .single()

    if (dbErr || !row) {
      // Откатываем загруженный файл, чтобы не плодить сирот.
      await supabaseAdmin.storage.from(BUCKET).remove([path])
      return NextResponse.json(
        { error: dbErr?.message ?? 'Не удалось создать запись фона' },
        { status: 500 },
      )
    }

    created.push({ ...row, public_url: publicUrl(row.url) })
    nextOrder += 1
  }

  await logAction(auth, 'template_set.upload_category_background', 'template_set', templateSetId, {
    name: set.name,
    category,
    count: created.length,
  })

  return NextResponse.json({ ok: true, created })
}

// ============================================================
// PATCH — изменить порядок ротации или сторону (side).
//   { action: 'reorder', category, ids: string[] }  — sort_order = индекс
//   { action: 'set_side', id, side }                — сменить side фона
// ============================================================
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req, ['superadmin'])
  if (isAuthError(auth)) return auth

  const templateSetId = params.id
  if (!templateSetId) {
    return NextResponse.json({ error: 'template_set id обязателен' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Неверный формат запроса' }, { status: 400 })
  }

  if (body.action === 'reorder') {
    const ids = Array.isArray(body.ids) ? (body.ids as unknown[]).map(String) : []
    if (ids.length === 0) {
      return NextResponse.json({ error: 'Пустой список ids' }, { status: 400 })
    }
    // Применяем новый порядок: sort_order = позиция в массиве.
    // Только в пределах этого набора (защита от чужих id).
    for (let i = 0; i < ids.length; i++) {
      const { error } = await supabaseAdmin
        .from('template_set_backgrounds')
        .update({ sort_order: i })
        .eq('id', ids[i])
        .eq('template_set_id', templateSetId)
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
    }
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'set_side') {
    const id = String(body.id ?? '')
    const side = String(body.side ?? '')
    if (!id || !ALLOWED_SIDES.has(side)) {
      return NextResponse.json({ error: 'Неверные id или side' }, { status: 400 })
    }
    const { error } = await supabaseAdmin
      .from('template_set_backgrounds')
      .update({ side })
      .eq('id', id)
      .eq('template_set_id', templateSetId)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
}

// ============================================================
// DELETE — удалить один фон по id (?bg=<uuid>).
// Чистит файл в bucket и строку в БД.
// ============================================================
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req, ['superadmin'])
  if (isAuthError(auth)) return auth

  const templateSetId = params.id
  const bgId = req.nextUrl.searchParams.get('bg')
  if (!templateSetId || !bgId) {
    return NextResponse.json({ error: 'template_set id и bg обязательны' }, { status: 400 })
  }

  // Берём строку (и проверяем принадлежность набору) чтобы знать путь файла.
  const { data: row } = await supabaseAdmin
    .from('template_set_backgrounds')
    .select('id, url, category')
    .eq('id', bgId)
    .eq('template_set_id', templateSetId)
    .single()

  if (!row) {
    return NextResponse.json({ error: 'Фон не найден' }, { status: 404 })
  }

  await supabaseAdmin.storage.from(BUCKET).remove([row.url])

  const { error: dbErr } = await supabaseAdmin
    .from('template_set_backgrounds')
    .delete()
    .eq('id', bgId)
    .eq('template_set_id', templateSetId)

  if (dbErr) {
    return NextResponse.json({ error: dbErr.message }, { status: 500 })
  }

  await logAction(auth, 'template_set.delete_category_background', 'template_set', templateSetId, {
    category: row.category,
  })

  return NextResponse.json({ ok: true })
}
