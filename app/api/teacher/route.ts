import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, getPhotoUrl } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'Токен не указан' }, { status: 400 })

  const { data: resp } = await supabaseAdmin
    .from('responsible_parents')
    .select('id, album_id, submitted_at')
    .eq('access_token', token)
    .single()

  if (!resp) return NextResponse.json({ error: 'Ссылка недействительна' }, { status: 404 })

  // Все фото учителей альбома
  const { data: allPhotos } = await supabaseAdmin
    .from('photos')
    .select('id, filename, storage_path')
    .eq('album_id', resp.album_id)
    .eq('type', 'teacher')
    .order('filename')

  const photos = (allPhotos ?? []).map((p: any) => ({
    ...p,
    url: getPhotoUrl(p.storage_path)
  }))

  // Уже созданные карточки учителей
  const { data: teachers } = await supabaseAdmin
    .from('teachers')
    .select('id, full_name, position, description, submitted_at')
    .eq('album_id', resp.album_id)
    .order('created_at')

  const teacherIds = (teachers ?? []).map((t: any) => t.id)

  const { data: photoLinks } = teacherIds.length > 0
    ? await supabaseAdmin
        .from('photo_teachers')
        .select('teacher_id, photo_id')
        .in('teacher_id', teacherIds)
    : { data: [] }

  const photoByTeacher: Record<string, string> = {}
  for (const link of photoLinks ?? []) {
    photoByTeacher[(link as any).teacher_id] = (link as any).photo_id
  }

  const teachersWithPhoto = (teachers ?? []).map((t: any) => ({
    ...t,
    photo_id: photoByTeacher[t.id] ?? null,
  }))

  const { data: album } = await supabaseAdmin
    .from('albums').select('title').eq('id', resp.album_id).single()

  return NextResponse.json({
    photos,
    teachers: teachersWithPhoto,
    album,
    responsibleId: resp.id,
    albumId: resp.album_id,
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { token, action } = body

  const { data: resp } = await supabaseAdmin
    .from('responsible_parents')
    .select('id, album_id')
    .eq('access_token', token)
    .single()

  if (!resp) return NextResponse.json({ error: 'Токен не найден' }, { status: 404 })

  // Создать новую карточку учителя
  if (action === 'create') {
    const { data: teacher } = await supabaseAdmin
      .from('teachers')
      .insert({ album_id: resp.album_id, full_name: '', position: '' })
      .select()
      .single()
    return NextResponse.json(teacher)
  }

  // Сохранить карточку учителя
  if (action === 'save') {
    const { teacher_id, full_name, position, description, photo_id } = body
    await supabaseAdmin.from('teachers').update({
      full_name: full_name?.trim() ?? '',
      position: position?.trim() ?? '',
      description: description?.trim() ?? '',
      submitted_at: new Date().toISOString(),
    }).eq('id', teacher_id)

    await supabaseAdmin.from('photo_teachers').delete().eq('teacher_id', teacher_id)
    if (photo_id) {
      await supabaseAdmin.from('photo_teachers').insert({ photo_id, teacher_id })
    }
    return NextResponse.json({ ok: true })
  }

  // Удалить карточку учителя
  if (action === 'delete') {
    const { teacher_id } = body
    await supabaseAdmin.from('photo_teachers').delete().eq('teacher_id', teacher_id)
    await supabaseAdmin.from('teachers').delete().eq('id', teacher_id)
    return NextResponse.json({ ok: true })
  }

  // Финальное подтверждение
  if (action === 'submit') {
    await supabaseAdmin.from('responsible_parents')
      .update({ submitted_at: new Date().toISOString() }).eq('id', resp.id)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
}
