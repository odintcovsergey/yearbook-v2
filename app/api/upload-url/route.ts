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

  // ─── IDML-импорт шаблонов: без album_id, только superadmin ─────────────
  // Большие IDML (с встроенной графикой/фонами) не пролезают в тело
  // serverless-функции (лимит Vercel ~4.5 МБ) → клиент заливает напрямую в
  // хранилище по presigned URL, затем /api/layout?action=import_idml скачивает
  // и парсит по storage_key. Кладём во временный префикс template-imports/.
  if (upload_type === 'idml') {
    if (auth.role !== 'superadmin') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
    if (!filename || !content_type) {
      return NextResponse.json(
        { error: 'filename, content_type required' },
        { status: 400 },
      )
    }
    // IDML = zip-пакет; браузер обычно отдаёт octet-stream. Подписываем строго
    // под тот же content_type, что клиент пришлёт в PUT.
    const ct = String(content_type).toLowerCase()
    if (
      ct !== 'application/octet-stream' &&
      ct !== 'application/zip' &&
      ct !== 'application/x-zip-compressed' &&
      ct !== 'application/vnd.adobe.indesign-idml-package'
    ) {
      return NextResponse.json(
        { error: 'Недопустимый тип файла для IDML' },
        { status: 400 },
      )
    }
    const lastDot = String(filename).lastIndexOf('.')
    const baseName = lastDot > 0 ? String(filename).slice(0, lastDot) : String(filename)
    const cleanBase = baseName.replace(/[^\w\-]/g, '_').slice(0, 80) || 'master'
    const key = `template-imports/${Date.now()}_${cleanBase}.idml`
    const uploadUrl = await getYcUploadUrl(key, content_type)
    return NextResponse.json({ upload_url: uploadUrl, key, storage_path: `yc:${key}` })
  }

  if (!album_id || !filename || !content_type || !upload_type) {
    return NextResponse.json({ error: 'album_id, filename, content_type, upload_type required' }, { status: 400 })
  }

  // D3: presign доверяет content_type клиента — ограничиваем белым списком.
  // originals = картинки; delivery = готовые файлы (PDF/ZIP/картинки).
  const ct = String(content_type).toLowerCase()
  const allowed = ct.startsWith('image/')
    || ct === 'application/pdf'
    || ct === 'application/zip'
    || ct === 'application/x-zip-compressed'
  if (!allowed) {
    return NextResponse.json({ error: 'Недопустимый тип файла' }, { status: 400 })
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
