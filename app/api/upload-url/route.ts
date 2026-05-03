import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, isAuthError } from '@/lib/auth'
import { getYcUploadUrl } from '@/lib/storage'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Получить presigned URL для прямой загрузки в YC
// Используется для больших файлов (delivery, originals) в обход Vercel 4.5МБ лимита
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

  const folder = upload_type === 'delivery' ? 'delivery' : 'originals'
  const key = `${album_id}/${folder}/${Date.now()}_${filename}`

  const uploadUrl = await getYcUploadUrl(key, content_type)

  return NextResponse.json({ upload_url: uploadUrl, key, storage_path: `yc:${key}` })
}
