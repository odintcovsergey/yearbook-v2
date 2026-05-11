import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, isAuthError } from '@/lib/auth'
import { getYcUploadUrl } from '@/lib/storage'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Получить presigned URL для прямой загрузки в YC.
// Используется для больших файлов (delivery, originals) в обход Vercel 4.5МБ лимита.
//
// upload_type:
//   'delivery'  → album_id/delivery/{ts}_{name}.{ext} (готовые файлы от OkeyBook, 6 мес)
//   'originals' → album_id/originals/{ts}_{name}.{ext} (оригиналы для печати, Б.1.1)
//   default     → originals (backward-compat)
//
// Клиент сам заливает файл PUT'ом по upload_url, затем регистрирует
// в БД через соответствующий endpoint:
//   - delivery  → POST /api/workflow action=register_delivery
//   - originals → POST /api/tenant action=register_original (Б.1.2)
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req, ['owner', 'manager', 'superadmin'])
  if (isAuthError(auth)) return auth

  const { album_id, filename, content_type, upload_type } = await req.json()

  if (!album_id || !filename || !content_type || !upload_type) {
    return NextResponse.json({ error: 'album_id, filename, content_type, upload_type required' }, { status: 400 })
  }

  // Проверяем доступ
  const { data: album } = await supabaseAdmin
    .from('albums').select('id, tenant_id').eq('id', album_id).single()
  if (!album) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (auth.role !== 'superadmin' && album.tenant_id !== auth.tenantId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Cleanup имени файла — пробелы и спецсимволы → underscores. Расширение
  // сохраняется (для originals критично — pdf-export по нему различает
  // JPEG/PNG). Извлекаем последнюю точку как делитель name/ext.
  const lastDot = filename.lastIndexOf('.')
  const baseName = lastDot > 0 ? filename.slice(0, lastDot) : filename
  const ext = lastDot > 0 ? filename.slice(lastDot) : ''
  const cleanBase = baseName.replace(/[^\w\-]/g, '_')
  const cleanExt = ext.replace(/[^\w.]/g, '').toLowerCase()
  const cleanFilename = `${cleanBase}${cleanExt}`

  const folder = upload_type === 'delivery' ? 'delivery' : 'originals'
  const key = `${album_id}/${folder}/${Date.now()}_${cleanFilename}`

  const uploadUrl = await getYcUploadUrl(key, content_type)

  return NextResponse.json({ upload_url: uploadUrl, key, storage_path: `yc:${key}` })
}
