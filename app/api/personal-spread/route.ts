import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { ycUpload, ycDelete, stripYcPrefix } from '@/lib/storage'
import sharp from 'sharp'

export const dynamic = 'force-dynamic'

const MAX_FILE_SIZE = 10 * 1024 * 1024  // 10 MB
const WARN_MIN_WIDTH = 800
const WARN_MIN_HEIGHT = 1200

// Проверяем токен ребёнка и возвращаем child + album
async function getChildAndAlbum(token: string) {
  const { data: child } = await supabaseAdmin
    .from('children')
    .select('id, album_id, albums(personal_spread_enabled, personal_spread_min, personal_spread_max, personal_spread_price, tenant_id, archived)')
    .eq('access_token', token)
    .single()
  return child
}

// GET — список фото личного разворота ребёнка
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 })

  const child = await getChildAndAlbum(token)
  if (!child) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const { data, error } = await supabaseAdmin
    .from('personal_spread_photos')
    .select('id, filename, storage_path, width, height, file_size, sort_order')
    .eq('child_id', child.id)
    .order('sort_order')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const alb = (child as any).albums
  return NextResponse.json({
    photos: data ?? [],
    settings: {
      enabled: alb?.personal_spread_enabled ?? false,
      min: alb?.personal_spread_min ?? 4,
      max: alb?.personal_spread_max ?? 12,
      price: alb?.personal_spread_price ?? 300,
    },
  })
}

// POST — загрузить фото (multipart) или удалить (JSON action=delete)
export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') ?? ''

  // ── Удаление ──────────────────────────────────────────────
  if (contentType.includes('application/json')) {
    const body = await req.json()
    const { action, token, photo_id } = body

    if (action !== 'delete') return NextResponse.json({ error: 'unknown action' }, { status: 400 })
    if (!token || !photo_id) return NextResponse.json({ error: 'token and photo_id required' }, { status: 400 })

    const child = await getChildAndAlbum(token)
    if (!child) return NextResponse.json({ error: 'not found' }, { status: 404 })

    // Проверяем что фото принадлежит этому ребёнку
    const { data: photo } = await supabaseAdmin
      .from('personal_spread_photos')
      .select('id, storage_path')
      .eq('id', photo_id)
      .eq('child_id', child.id)
      .single()

    if (!photo) return NextResponse.json({ error: 'photo not found' }, { status: 404 })

    // Удаляем из YC и БД
    await ycDelete(stripYcPrefix(photo.storage_path))
    await supabaseAdmin.from('personal_spread_photos').delete().eq('id', photo_id)

    return NextResponse.json({ ok: true })
  }

  // ── Загрузка ──────────────────────────────────────────────
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json({ error: 'multipart required' }, { status: 400 })
  }

  const formData = await req.formData()
  const token = formData.get('token') as string
  const file = formData.get('file') as File | null

  if (!token || !file) return NextResponse.json({ error: 'token and file required' }, { status: 400 })

  const child = await getChildAndAlbum(token)
  if (!child) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const alb = (child as any).albums
  if (!alb?.personal_spread_enabled) {
    return NextResponse.json({ error: 'Личный разворот не включён для этого альбома' }, { status: 403 })
  }
  if (alb?.archived) {
    return NextResponse.json({ error: 'Альбом архивирован' }, { status: 403 })
  }

  // Проверяем лимит
  const { count } = await supabaseAdmin
    .from('personal_spread_photos')
    .select('*', { count: 'exact', head: true })
    .eq('child_id', child.id)

  if ((count ?? 0) >= (alb?.personal_spread_max ?? 12)) {
    return NextResponse.json({ error: `Максимум ${alb?.personal_spread_max ?? 12} фото` }, { status: 400 })
  }

  // Проверяем размер файла
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: `Файл слишком большой (максимум 10 МБ)` }, { status: 400 })
  }

  // Читаем файл
  const buffer = Buffer.from(await file.arrayBuffer())

  // Определяем размеры через sharp
  let width = 0, height = 0
  let warning: string | null = null
  try {
    const meta = await sharp(buffer).metadata()
    width = meta.width ?? 0
    height = meta.height ?? 0
    // Предупреждение о низком разрешении (10×15 при 200 dpi = 787×1181px)
    if (width < WARN_MIN_WIDTH || height < WARN_MIN_HEIGHT) {
      warning = `Низкое разрешение (${width}×${height}px) — фото может получиться нечётким при печати`
    }
  } catch {
    // Если sharp не смог прочитать — не блокируем, просто нет размеров
  }

  // Формируем имя файла — сохраняем оригинальное расширение
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  const safeExt = ['jpg', 'jpeg', 'png', 'heic', 'heif'].includes(ext) ? ext : 'jpg'
  const filename = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const storagePath = `${child.album_id}/personal/${child.id}/${filename}`
  const ycPath = `yc:${storagePath}`

  // Загружаем в YC (оригинал без конвертации — важно для качества печати)
  const mimeType = file.type || 'image/jpeg'
  await ycUpload(storagePath, buffer, mimeType)

  // Определяем sort_order
  const { data: existing } = await supabaseAdmin
    .from('personal_spread_photos')
    .select('sort_order')
    .eq('child_id', child.id)
    .order('sort_order', { ascending: false })
    .limit(1)
  const sort_order = ((existing?.[0]?.sort_order ?? -1) + 1)

  // Записываем в БД
  const { data: photo, error: dbErr } = await supabaseAdmin
    .from('personal_spread_photos')
    .insert({
      child_id: child.id,
      album_id: child.album_id,
      tenant_id: alb.tenant_id,
      storage_path: ycPath,
      filename,
      width,
      height,
      file_size: file.size,
      sort_order,
    })
    .select()
    .single()

  if (dbErr) {
    // Откатываем загрузку
    await ycDelete(storagePath)
    return NextResponse.json({ error: dbErr.message }, { status: 500 })
  }

  return NextResponse.json({ photo, warning })
}
