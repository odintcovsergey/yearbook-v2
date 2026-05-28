import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth, isAuthError, logAction } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

const BUCKET = 'template-backgrounds'
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png'])
const MAX_SIZE = 50 * 1024 * 1024 // 50 MB

function extFromMime(mime: string): 'jpg' | 'png' | null {
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/png') return 'png'
  return null
}

function buildPaths(templateSetId: string): { jpg: string; png: string } {
  return {
    jpg: `${templateSetId}/default.jpg`,
    png: `${templateSetId}/default.png`,
  }
}

// ============================================================
// POST /api/super/template-sets/[id]/background
// Загрузить общий фон для набора. Один фон рендерится на каждом
// развороте альбома, использующего этот template_set.
// ============================================================
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth(req, ['superadmin'])
  if (isAuthError(auth)) return auth

  const templateSetId = params.id
  if (!templateSetId) {
    return NextResponse.json({ error: 'template_set id обязателен' }, { status: 400 })
  }

  const { data: set } = await supabaseAdmin
    .from('template_sets')
    .select('id, name, default_background_url')
    .eq('id', templateSetId)
    .single()

  if (!set) {
    return NextResponse.json({ error: 'Набор не найден' }, { status: 404 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Неверный формат запроса' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file) {
    return NextResponse.json({ error: 'Нет файла' }, { status: 400 })
  }

  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: 'Допустимы только JPG и PNG' },
      { status: 400 }
    )
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: 'Файл больше 50 МБ' },
      { status: 400 }
    )
  }

  const ext = extFromMime(file.type)!
  const paths = buildPaths(templateSetId)
  const newPath = ext === 'jpg' ? paths.jpg : paths.png
  const otherPath = ext === 'jpg' ? paths.png : paths.jpg

  // Удаляем старый файл с другим расширением, чтобы не остался сиротой
  await supabaseAdmin.storage.from(BUCKET).remove([otherPath])

  const buffer = Buffer.from(await file.arrayBuffer())
  const { error: upErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(newPath, buffer, {
      contentType: file.type,
      upsert: true,
    })

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 })
  }

  const { error: dbErr } = await supabaseAdmin
    .from('template_sets')
    .update({ default_background_url: newPath })
    .eq('id', templateSetId)

  if (dbErr) {
    return NextResponse.json({ error: dbErr.message }, { status: 500 })
  }

  await logAction(auth, 'template_set.upload_background', 'template_set', templateSetId, {
    name: set.name,
    size: file.size,
    mime: file.type,
  })

  const publicUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${newPath}?t=${Date.now()}`

  return NextResponse.json({
    ok: true,
    default_background_url: newPath,
    public_url: publicUrl,
  })
}

// ============================================================
// DELETE /api/super/template-sets/[id]/background
// Удалить общий фон набора. Чистит обе версии (.jpg и .png),
// чтобы не оставались сироты в bucket'е.
// ============================================================
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth(req, ['superadmin'])
  if (isAuthError(auth)) return auth

  const templateSetId = params.id
  if (!templateSetId) {
    return NextResponse.json({ error: 'template_set id обязателен' }, { status: 400 })
  }

  const { data: set } = await supabaseAdmin
    .from('template_sets')
    .select('id, name')
    .eq('id', templateSetId)
    .single()

  if (!set) {
    return NextResponse.json({ error: 'Набор не найден' }, { status: 404 })
  }

  const paths = buildPaths(templateSetId)
  await supabaseAdmin.storage.from(BUCKET).remove([paths.jpg, paths.png])

  const { error: dbErr } = await supabaseAdmin
    .from('template_sets')
    .update({ default_background_url: null })
    .eq('id', templateSetId)

  if (dbErr) {
    return NextResponse.json({ error: dbErr.message }, { status: 500 })
  }

  await logAction(auth, 'template_set.delete_background', 'template_set', templateSetId, {
    name: set.name,
  })

  return NextResponse.json({ ok: true })
}
