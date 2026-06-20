import { NextRequest, NextResponse } from 'next/server'
import { serverError } from '@/lib/api-error'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth, isAuthError, logAction } from '@/lib/auth'
import { createUploadTarget, resolveReadUrl, removeBlobs, type UploadTarget } from '@/lib/blob-storage'

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

const ALLOWED_EXT = new Set(['jpg', 'png'])
const ALLOWED_SIDES = new Set(['spread', 'left', 'right', 'any'])

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
    return serverError(error, 'super/template-sets/[id]/backgrounds')
  }

  const backgrounds = await Promise.all((data ?? []).map(async (row) => ({
    ...row,
    public_url: await resolveReadUrl('template-backgrounds', row.url),
  })))

  return NextResponse.json({ ok: true, backgrounds })
}

// ============================================================
// POST — двухшаговая загрузка фонов (обход лимита тела Vercel ~4.5 МБ).
// Файл НЕ проходит через сервер: клиент льёт его прямо в Storage по
// подписанной ссылке.
//
//   { action: 'sign',   category, files: [{ ext: 'jpg'|'png' }] }
//     → создаём пути <set>/<category>/<uuid>.<ext> и подписанные upload-URL.
//       Записи в БД ещё НЕ создаём.
//   { action: 'commit', category, side, paths: string[] }
//     → после успешной заливки клиентом создаём строки template_set_backgrounds,
//       sort_order дописывается в конец категории.
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

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Неверный формат запроса' }, { status: 400 })
  }

  const category = String(body.category ?? '').trim()
  if (!category) {
    return NextResponse.json({ error: 'Категория обязательна' }, { status: 400 })
  }

  // ── Шаг 1: выдать подписанные ссылки на загрузку ───────────────────────
  if (body.action === 'sign') {
    const files = Array.isArray(body.files) ? body.files : []
    if (files.length === 0) {
      return NextResponse.json({ error: 'Нет файлов' }, { status: 400 })
    }

    const uploads: UploadTarget[] = []
    for (const f of files) {
      const ext = String((f as { ext?: unknown })?.ext ?? '')
      if (!ALLOWED_EXT.has(ext)) {
        return NextResponse.json({ error: 'Допустимы только JPG и PNG' }, { status: 400 })
      }
      const path = `${templateSetId}/${category}/${crypto.randomUUID()}.${ext}`
      try {
        uploads.push(await createUploadTarget('template-backgrounds', path, `image/${ext === 'jpg' ? 'jpeg' : ext}`))
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : 'Не удалось подписать загрузку' },
          { status: 500 },
        )
      }
    }

    return NextResponse.json({ ok: true, uploads })
  }

  // ── Шаг 2: зафиксировать записи после заливки ──────────────────────────
  if (body.action === 'commit') {
    const sideRaw = String(body.side ?? 'spread')
    const side = ALLOWED_SIDES.has(sideRaw) ? sideRaw : 'spread'

    const paths = Array.isArray(body.paths) ? (body.paths as unknown[]).map(String) : []
    if (paths.length === 0) {
      return NextResponse.json({ error: 'Нет путей' }, { status: 400 })
    }

    // Защита: путь должен лежать в каталоге этого набора и категории.
    const prefix = `${templateSetId}/${category}/`
    for (const p of paths) {
      if (!p.startsWith(prefix)) {
        return NextResponse.json({ error: 'Недопустимый путь файла' }, { status: 400 })
      }
    }

    // Текущий максимум sort_order — дописываем новые в конец категории.
    const { data: existing } = await supabaseAdmin
      .from('template_set_backgrounds')
      .select('sort_order')
      .eq('template_set_id', templateSetId)
      .eq('category', category)
      .order('sort_order', { ascending: false })
      .limit(1)

    let nextOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0

    const created: Array<Record<string, unknown>> = []
    for (const path of paths) {
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
        return NextResponse.json(
          { error: dbErr?.message ?? 'Не удалось создать запись фона' },
          { status: 500 },
        )
      }
      created.push({ ...row, public_url: await resolveReadUrl('template-backgrounds', row.url) })
      nextOrder += 1
    }

    await logAction(auth, 'template_set.upload_category_background', 'template_set', templateSetId, {
      name: set.name,
      category,
      count: created.length,
    })

    return NextResponse.json({ ok: true, created })
  }

  return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
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
        return serverError(error, 'super/template-sets/[id]/backgrounds')
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
      return serverError(error, 'super/template-sets/[id]/backgrounds')
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

  await removeBlobs('template-backgrounds', [row.url])

  const { error: dbErr } = await supabaseAdmin
    .from('template_set_backgrounds')
    .delete()
    .eq('id', bgId)
    .eq('template_set_id', templateSetId)

  if (dbErr) {
    return serverError(dbErr, 'super/template-sets/[id]/backgrounds')
  }

  await logAction(auth, 'template_set.delete_category_background', 'template_set', templateSetId, {
    category: row.category,
  })

  return NextResponse.json({ ok: true })
}
