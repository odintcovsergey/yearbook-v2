import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import sharp from 'sharp'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function checkAdmin(req: NextRequest) {
  return req.headers.get('x-admin-secret') === process.env.ADMIN_SECRET
}

export async function POST(req: NextRequest) {
  if (!checkAdmin(req)) return NextResponse.json({ error: 'Нет доступа' }, { status: 401 })

  const form = await req.formData()
  const file = form.get('file') as File
  const type = form.get('type') as string
  const albumId = form.get('album_id') as string

  if (!file || !type || !albumId)
    return NextResponse.json({ error: 'Не хватает данных' }, { status: 400 })

  const buffer = Buffer.from(await file.arrayBuffer())
  const originalName = file.name.replace(/\.[^.]+$/, '')

  const sharpInstance = sharp(buffer).rotate()

  const [fullBuffer, thumbBuffer] = await Promise.all([
    sharpInstance.clone()
      .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer(),
    sharpInstance.clone()
      .resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer(),
  ])

  const timestamp = Date.now()
  const fullPath  = `${albumId}/${type}/${timestamp}_${originalName}.webp`
  const thumbPath = `${albumId}/${type}/thumbs/${timestamp}_${originalName}.webp`

  const [fullUpload, thumbUpload] = await Promise.all([
    supabaseAdmin.storage.from('photos').upload(fullPath, fullBuffer, { contentType: 'image/webp', upsert: false }),
    supabaseAdmin.storage.from('photos').upload(thumbPath, thumbBuffer, { contentType: 'image/webp', upsert: false }),
  ])

  if (fullUpload.error)
    return NextResponse.json({ error: fullUpload.error.message }, { status: 500 })

  const { data: photo, error: dbError } = await supabaseAdmin
    .from('photos')
    .insert({
      album_id: albumId,
      filename: file.name,
      storage_path: fullPath,
      thumb_path: thumbUpload.error ? null : thumbPath,
      type,
    })
    .select()
    .single()

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })

  return NextResponse.json(photo)
}
