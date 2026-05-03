import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, isAuthError, logAction } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { ycUpload } from '@/lib/storage'

export const runtime = 'nodejs'

const ALLOWED_TYPES = ['portrait', 'group', 'teacher']

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req, ['superadmin', 'owner', 'manager'])
  if (isAuthError(auth)) return auth

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Неверный формат запроса' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  const albumId = formData.get('album_id') as string | null
  const type = formData.get('type') as string | null
  // original_name — оригинальное имя файла до конвертации (DSC08521.jpg)
  // file?.name может прийти как DSC08521.webp если клиент переименовал при компрессии
  const rawOriginalName = (formData.get('original_name') as string) || file?.name || 'photo'
  // На случай если original_name тоже пришёл с .webp — убираем и возвращаем оригинал
  const originalName = rawOriginalName

  if (!file || !albumId || !type) {
    return NextResponse.json({ error: 'Нет file, album_id или type' }, { status: 400 })
  }

  if (!ALLOWED_TYPES.includes(type)) {
    return NextResponse.json({ error: 'Недопустимый тип фото' }, { status: 400 })
  }

  // Проверяем принадлежность альбома tenant'у
  const { data: album } = await supabaseAdmin
    .from('albums')
    .select('id, tenant_id, archived')
    .eq('id', albumId)
    .single()

  if (!album) return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
  if (auth.role !== 'superadmin' && album.tenant_id !== auth.tenantId) {
    return NextResponse.json({ error: 'Нет доступа' }, { status: 403 })
  }
  if (album.archived) {
    return NextResponse.json({ error: 'Альбом архивирован' }, { status: 400 })
  }

  // Формируем путь — префикс yc: означает Yandex Object Storage
  const cleanName = originalName.replace(/\.[^.]+$/, '').replace(/[^\w.\-]/g, '_')
  const storagePath = `yc:${albumId}/${type}/${Date.now()}_${cleanName}.webp`
  const ycKey = storagePath.slice(3) // без префикса yc:

  // Загружаем в YC
  const buffer = Buffer.from(await file.arrayBuffer())
  try {
    await ycUpload(ycKey, buffer, 'image/webp')
  } catch (err: any) {
    console.error('YC upload error:', err)
    return NextResponse.json({ error: `Ошибка хранилища: ${err.message}` }, { status: 502 })
  }

  // Регистрируем в БД
  const filename = originalName  // сохраняем оригинальное имя как есть
  const { error: dbErr } = await supabaseAdmin
    .from('photos')
    .insert({
      album_id: albumId,
      filename,
      storage_path: storagePath,
      thumb_path: null,
      type,
    })

  if (dbErr) {
    // Откатываем файл из YC если БД упала
    try { await ycUpload(ycKey, Buffer.alloc(0)) } catch {}
    return NextResponse.json({ error: dbErr.message }, { status: 500 })
  }

  await logAction(auth, 'photo.upload_yc', 'album', albumId, { filename, type })

  return NextResponse.json({ ok: true, storage_path: storagePath })
}
