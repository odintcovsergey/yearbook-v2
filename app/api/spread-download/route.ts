import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth, isAuthError } from '@/lib/auth'
import { stripYcPrefix } from '@/lib/storage'
import JSZip from 'jszip'

export const dynamic = 'force-dynamic'
// Увеличиваем лимит времени — ZIP может создаваться долго при большом числе фото
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, ['owner', 'manager', 'viewer'])
  if (isAuthError(auth)) return auth

  const albumId = req.nextUrl.searchParams.get('album_id')
  if (!albumId) return NextResponse.json({ error: 'album_id required' }, { status: 400 })

  // Проверяем принадлежность альбома
  const { data: album } = await supabaseAdmin
    .from('albums')
    .select('id, title, tenant_id')
    .eq('id', albumId)
    .single()

  if (!album || (auth.role !== 'superadmin' && album.tenant_id !== auth.tenantId)) {
    return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
  }

  // Загружаем все фото личного разворота с именами учеников
  const { data: photos } = await supabaseAdmin
    .from('personal_spread_photos')
    .select('id, filename, storage_path, sort_order, child_id, children(full_name, class)')
    .eq('album_id', albumId)
    .order('sort_order')

  if (!photos || photos.length === 0) {
    return NextResponse.json({ error: 'Нет фото для скачивания' }, { status: 404 })
  }

  const YC_BASE = `https://storage.yandexcloud.net/${process.env.YC_BUCKET_NAME ?? 'yearbook-photos'}/`

  // Создаём ZIP
  const zip = new JSZip()

  // Скачиваем фото параллельно (батчами по 5)
  const batchSize = 5
  for (let i = 0; i < photos.length; i += batchSize) {
    const batch = photos.slice(i, i + batchSize)
    await Promise.all(batch.map(async (p: any) => {
      try {
        const url = YC_BASE + stripYcPrefix(p.storage_path)
        const res = await fetch(url)
        if (!res.ok) return
        const buffer = await res.arrayBuffer()
        const child = p.children
        const className = child?.class ? String(child.class).replace(/[^a-zA-Z0-9а-яА-ЯёЁ]/g, '_') : 'без_класса'
        const childName = child?.full_name ? String(child.full_name).replace(/[^a-zA-Z0-9а-яА-ЯёЁ ]/g, '_') : 'ученик'
        const zipFilename = `${className}_${childName}_${p.filename}`
        zip.file(zipFilename, buffer)
      } catch {
        // Пропускаем файл при ошибке
      }
    }))
  }

  const zipBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 1 }, // Быстрее, фото и так сжаты
  })

  const safeTitle = album.title.replace(/[^a-zA-Z0-9а-яА-ЯёЁ]/g, '_')
  const filename = `разворот_${safeTitle}.zip`

  return new NextResponse(zipBuffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Content-Length': String(zipBuffer.length),
    },
  })
}
