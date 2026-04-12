import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, getPhotoUrl } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function checkAdmin(req: NextRequest) {
  return req.headers.get('x-admin-secret') === process.env.ADMIN_SECRET
}

export async function GET(req: NextRequest) {
  if (!checkAdmin(req)) return NextResponse.json({ error: 'Нет доступа' }, { status: 401 })

  const action = req.nextUrl.searchParams.get('action')
  const albumId = req.nextUrl.searchParams.get('album_id')

  // Список альбомов
  if (action === 'albums') {
    const { data } = await supabaseAdmin.from('albums').select('*').order('created_at', { ascending: false })
    return NextResponse.json(data ?? [])
  }

  // Шаблоны
  if (action === 'templates') {
    const { data } = await supabaseAdmin.from('album_templates').select('*').order('created_at')
    return NextResponse.json(data ?? [])
  }

  // Список альбомов со статистикой (один запрос)
  if (action === 'albums_with_stats') {
    const [albumsRes, childrenRes, teacherTokenRes] = await Promise.all([
      supabaseAdmin.from('albums').select('*').order('created_at', { ascending: false }),
      supabaseAdmin.from('children').select('album_id, submitted_at, started_at'),
      supabaseAdmin.from('responsible_parents').select('album_id, access_token'),
    ])
    const albums = albumsRes.data ?? []
    const children = childrenRes.data ?? []
    const tokenMap: Record<string, string> = {}
    for (const t of teacherTokenRes.data ?? []) tokenMap[t.album_id] = t.access_token
    const statsMap: Record<string, { total: number; submitted: number; in_progress: number }> = {}
    for (const c of children) {
      if (!statsMap[c.album_id]) statsMap[c.album_id] = { total: 0, submitted: 0, in_progress: 0 }
      statsMap[c.album_id].total++
      if (c.submitted_at) statsMap[c.album_id].submitted++
      else if (c.started_at) statsMap[c.album_id].in_progress++
    }
    return NextResponse.json(albums.map(a => ({
      ...a,
      stats: statsMap[a.id] ?? { total: 0, submitted: 0, in_progress: 0 },
      teacher_token: tokenMap[a.id] ?? null,
    })))
  }

  // Статистика по альбому
  if (action === 'stats' && albumId) {
    const [children, teachers, surcharges] = await Promise.all([
      supabaseAdmin.from('children').select('id, submitted_at, started_at').eq('album_id', albumId),
      supabaseAdmin.from('teachers').select('id, submitted_at').eq('album_id', albumId),
      supabaseAdmin.from('cover_selections')
        .select('surcharge, child_id, children(album_id)')
        .gt('surcharge', 0),
    ])

    const ch = children.data ?? []
    const tch = teachers.data ?? []
    const surch = (surcharges.data ?? []).filter((s: any) => s.children?.album_id === albumId)

    return NextResponse.json({
      total: ch.length,
      submitted: ch.filter((c: any) => c.submitted_at).length,
      in_progress: ch.filter((c: any) => !c.submitted_at && c.started_at).length,
      not_started: ch.filter((c: any) => !c.submitted_at && !c.started_at).length,
      teachers_total: tch.length,
      teachers_done: tch.filter(t => t.submitted_at).length,
      surcharge_total: surch.reduce((sum: number, s: any) => sum + (s.surcharge ?? 0), 0),
      surcharge_count: surch.length,
    })
  }

  // Список детей с деталями
  if (action === 'children' && albumId) {
    const { data: children } = await supabaseAdmin
      .from('children')
      .select('id, full_name, class, access_token, submitted_at, started_at')
      .eq('album_id', albumId)
      .order('class').order('full_name')

    const ids = (children ?? []).map((c: any) => c.id)
    const [contacts, covers] = await Promise.all([
      supabaseAdmin.from('parent_contacts').select('child_id, parent_name, phone, referral').in('child_id', ids),
      supabaseAdmin.from('cover_selections').select('child_id, cover_option, surcharge').in('child_id', ids),
    ])

    const contactMap = Object.fromEntries((contacts.data ?? []).map((c: any) => [c.child_id, c]))
    const coverMap = Object.fromEntries((covers.data ?? []).map((c: any) => [c.child_id, c]))

    return NextResponse.json((children ?? []).map((c: any) => ({
      ...c,
      contact: contactMap[c.id] ?? null,
      cover: coverMap[c.id] ?? null,
      referral: contactMap[c.id]?.referral ?? null,
    })))
  }

  // Детали одного ученика с выборами и фото
  if (action === 'child_details') {
    const childId = url.searchParams.get('child_id')
    if (!childId) return NextResponse.json({ error: 'Нет child_id' }, { status: 400 })

    const [selectionsRes, textRes, contactRes, coverRes] = await Promise.all([
      supabaseAdmin.from('selections').select('photo_id, selection_type, photos(filename, storage_path, thumb_path)').eq('child_id', childId),
      supabaseAdmin.from('student_texts').select('text').eq('child_id', childId).maybeSingle(),
      supabaseAdmin.from('parent_contacts').select('parent_name, phone, referral').eq('child_id', childId).maybeSingle(),
      supabaseAdmin.from('cover_selections').select('cover_option, surcharge').eq('child_id', childId).maybeSingle(),
    ])

    const selections = (selectionsRes.data ?? []).map((s: any) => ({
      type: s.selection_type,
      filename: s.photos?.filename ?? '',
      url: s.photos?.storage_path ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/photos/${s.photos.storage_path}` : '',
      thumb: s.photos?.thumb_path
        ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/photos/${s.photos.thumb_path}`
        : s.photos?.storage_path ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/photos/${s.photos.storage_path}?width=400&quality=70` : '',
    }))

    return NextResponse.json({
      selections,
      text: textRes.data?.text ?? '',
      contact: contactRes.data ?? null,
      cover: coverRes.data ?? null,
    })
  }

  // Список учителей
  if (action === 'teachers' && albumId) {
    const { data } = await supabaseAdmin
      .from('teachers')
      .select('id, full_name, position, submitted_at')
      .eq('album_id', albumId)
      .order('created_at')
    return NextResponse.json(data ?? [])
  }

  // Ответственный родитель
  if (action === 'responsible' && albumId) {
    const { data } = await supabaseAdmin
      .from('responsible_parents')
      .select('id, full_name, phone, access_token, submitted_at')
      .eq('album_id', albumId)
      .maybeSingle()
    return NextResponse.json(data ?? {})
  }

  // Доплаты
  if (action === 'surcharges' && albumId) {
    const { data } = await supabaseAdmin
      .from('cover_selections')
      .select('surcharge, cover_option, children(id, full_name, class, album_id)')
      .gt('surcharge', 0)

    const filtered = (data ?? []).filter((s: any) => s.children?.album_id === albumId)

    const childIds = filtered.map((s: any) => s.children?.id).filter(Boolean)
    const { data: contacts } = await supabaseAdmin
      .from('parent_contacts').select('child_id, parent_name, phone').in('child_id', childIds)
    const contactMap = Object.fromEntries((contacts ?? []).map((c: any) => [c.child_id, c]))

    return NextResponse.json(filtered.map((s: any) => ({
      child_name: s.children?.full_name,
      class: s.children?.class,
      cover_option: s.cover_option,
      surcharge: s.surcharge,
      parent_name: contactMap[s.children?.id]?.parent_name,
      phone: contactMap[s.children?.id]?.phone,
    })))
  }

  // Список фото альбома по типу
  if (action === 'photos' && albumId) {
    const photoType = req.nextUrl.searchParams.get('photo_type')
    let query = supabaseAdmin.from('photos').select('id, filename, storage_path, type').eq('album_id', albumId).order('created_at')
    if (photoType) query = (query as any).eq('type', photoType)
    const { data: photos } = await query
    const result = (photos ?? []).map((p: any) => ({
      ...p,
      url: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/photos/${p.storage_path}`,
    }))
    return NextResponse.json({ photos: result })
  }

  // Экспорт CSV для вёрстки
  if (action === 'export' && albumId) {
    const { data: children } = await supabaseAdmin
      .from('children').select('id, full_name, class').eq('album_id', albumId).order('class').order('full_name')

    const ids = (children ?? []).map((c: any) => c.id)

    const [selectionsRes, contactsRes, textsRes, coversRes] = await Promise.all([
      supabaseAdmin.from('selections').select('child_id, photo_id, selection_type, photos(filename, storage_path)').in('child_id', ids),
      supabaseAdmin.from('parent_contacts').select('child_id, parent_name, phone').in('child_id', ids),
      supabaseAdmin.from('student_texts').select('child_id, text').in('child_id', ids),
      supabaseAdmin.from('cover_selections').select('child_id, cover_option, surcharge').in('child_id', ids),
    ])

    const selMap: Record<string, any[]> = {}
    for (const s of selectionsRes.data ?? []) {
      if (!selMap[(s as any).child_id]) selMap[(s as any).child_id] = []
      selMap[(s as any).child_id].push(s)
    }
    const contactMap = Object.fromEntries((contactsRes.data ?? []).map((c: any) => [c.child_id, c]))
    const textMap = Object.fromEntries((textsRes.data ?? []).map((t: any) => [t.child_id, t.text]))
    const coverMap = Object.fromEntries((coversRes.data ?? []).map((c: any) => [c.child_id, c]))

    const rows = (children ?? []).map((c: any) => {
      const sels = selMap[c.id] ?? []
      const pp = sels.find((s: any) => s.selection_type === 'portrait_page')
      const pc = sels.find((s: any) => s.selection_type === 'portrait_cover')
      const gr = sels.filter((s: any) => s.selection_type === 'group')
      const cover = coverMap[c.id]
      const contact = contactMap[c.id]

      const ppUrl = pp ? getPhotoUrl((pp as any).photos?.storage_path ?? '') : ''
      const pcUrl = pc ? getPhotoUrl((pc as any).photos?.storage_path ?? '') : (cover?.cover_option === 'same' ? ppUrl : '')

      // Динамические колонки для групповых фото (до 10)
      const grCols: Record<string, string> = {}
      for (let i = 0; i < 10; i++) {
        grCols[`Фото_друзья_${i + 1}`] = gr[i] ? (gr[i] as any).photos?.filename ?? '' : ''
        grCols[`URL_фото_${i + 1}`] = gr[i] ? getPhotoUrl((gr[i] as any).photos?.storage_path ?? '') : ''
      }

      return {
        Класс: c.class,
        Ученик: c.full_name,
        Портрет_страница: (pp as any)?.photos?.filename ?? '',
        URL_портрет_страница: ppUrl,
        Обложка: cover?.cover_option ?? 'none',
        Портрет_обложка: pc ? (pc as any).photos?.filename : (cover?.cover_option === 'same' ? (pp as any)?.photos?.filename ?? '' : ''),
        URL_портрет_обложка: pcUrl,
        Текст: textMap[c.id] ?? '',
        ...grCols,
      }
    })

    // Учителя
    const { data: teachers } = await supabaseAdmin
      .from('teachers')
      .select('id, full_name, position')
      .eq('album_id', albumId)
      .order('created_at')

    const teacherIds = (teachers ?? []).map((t: any) => t.id)
    const { data: photoLinks } = teacherIds.length > 0
      ? await supabaseAdmin.from('photo_teachers').select('teacher_id, photos(filename, storage_path)').in('teacher_id', teacherIds)
      : { data: [] }

    const photoByTeacher: Record<string, any> = {}
    for (const link of photoLinks ?? []) {
      photoByTeacher[(link as any).teacher_id] = (link as any).photos
    }

    const teacherRows = (teachers ?? []).map((t: any) => {
      const photo = photoByTeacher[t.id]
      const grTeacherCols: Record<string, string> = {}
      for (let i = 0; i < 10; i++) { grTeacherCols[`Фото_друзья_${i+1}`] = ''; grTeacherCols[`URL_фото_${i+1}`] = '' }
      return {
        Класс: 'УЧИТЕЛЬ',
        Ученик: t.full_name,
        Портрет_страница: photo?.filename ?? '',
        URL_портрет_страница: photo?.storage_path ? getPhotoUrl(photo.storage_path) : '',
        Обложка: t.position ?? '', Портрет_обложка: '', URL_портрет_обложка: '',
        Текст: '',
        ...grTeacherCols,
      }
    })

    const allRows = [...rows, ...(teacherRows.length > 0 ? [null, ...teacherRows] : [])]
    const headers = Object.keys(rows[0] ?? teacherRows[0] ?? {})
    const csv = [
      headers.join(','),
      ...allRows.map(r => r === null
        ? headers.map(() => '""').join(',')
        : headers.map(h => `"${String((r as any)[h] ?? '').replace(/"/g, '""')}"`).join(','))
    ].join('\n')

    return new NextResponse('\uFEFF' + csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="album-${albumId}.csv"`,
      }
    })
  }

  return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  if (!checkAdmin(req)) return NextResponse.json({ error: 'Нет доступа' }, { status: 401 })

  const contentType = req.headers.get('content-type') ?? ''

  // Загрузка фото
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData()
    const file = form.get('file') as File
    const type = form.get('type') as string
    const albumId = form.get('album_id') as string

    if (!file || !type || !albumId)
      return NextResponse.json({ error: 'Нет файла, типа или album_id' }, { status: 400 })

    const path = `${albumId}/${type}/${Date.now()}_${file.name}`
    const { error: upErr } = await supabaseAdmin.storage
      .from('photos').upload(path, file, { upsert: false })

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

    const { data: photo } = await supabaseAdmin.from('photos')
      .insert({ album_id: albumId, filename: file.name, storage_path: path, type })
      .select().single()

    return NextResponse.json(photo)
  }

  const body = await req.json()

  // Удалить фото
  if (body.action === 'delete_photo') {
    const { photo_id, storage_path } = body
    // Найти детей, у которых было выбрано это фото — им нужно сбросить submitted_at
    const { data: affectedSelections } = await supabaseAdmin
      .from('selections').select('child_id').eq('photo_id', photo_id)
    const affectedChildIds = Array.from(new Set((affectedSelections ?? []).map((s: any) => s.child_id)))
    // Удалить фото и миниатюру из хранилища
    const { data: photoData } = await supabaseAdmin.from('photos').select('thumb_path').eq('id', photo_id).single()
    const pathsToDelete = [storage_path]
    if ((photoData as any)?.thumb_path) pathsToDelete.push((photoData as any).thumb_path)
    await supabaseAdmin.storage.from('photos').remove(pathsToDelete)
    await supabaseAdmin.from('selections').delete().eq('photo_id', photo_id)
    await supabaseAdmin.from('photo_teachers').delete().eq('photo_id', photo_id)
    await supabaseAdmin.from('photo_children').delete().eq('photo_id', photo_id)
    await supabaseAdmin.from('photo_locks').delete().eq('photo_id', photo_id)
    await supabaseAdmin.from('photos').delete().eq('id', photo_id)
    // Сбросить submitted_at у затронутых детей
    if (affectedChildIds.length > 0) {
      await supabaseAdmin.from('children')
        .update({ submitted_at: null })
        .in('id', affectedChildIds)
    }
    return NextResponse.json({ ok: true, resetChildren: affectedChildIds.length })
  }

  // Удалить альбом полностью
  if (body.action === 'delete_album') {
    const { album_id } = body
    const { data: childIds } = await supabaseAdmin.from('children').select('id').eq('album_id', album_id)
    const ids = (childIds ?? []).map((c: any) => c.id)
    if (ids.length > 0) {
      await supabaseAdmin.from('selections').delete().in('child_id', ids)
      await supabaseAdmin.from('photo_locks').delete().in('child_id', ids)
      await supabaseAdmin.from('cover_selections').delete().in('child_id', ids)
      await supabaseAdmin.from('student_texts').delete().in('child_id', ids)
      await supabaseAdmin.from('parent_contacts').delete().in('child_id', ids)
      await supabaseAdmin.from('drafts').delete().in('child_id', ids)
      await supabaseAdmin.from('photo_children').delete().in('child_id', ids)
    }
    await supabaseAdmin.from('children').delete().eq('album_id', album_id)
    const { data: teacherIds } = await supabaseAdmin.from('teachers').select('id').eq('album_id', album_id)
    const tids = (teacherIds ?? []).map((t: any) => t.id)
    if (tids.length > 0) await supabaseAdmin.from('photo_teachers').delete().in('teacher_id', tids)
    await supabaseAdmin.from('teachers').delete().eq('album_id', album_id)
    // Удалить файлы из Storage
    const { data: photos } = await supabaseAdmin.from('photos').select('storage_path').eq('album_id', album_id)
    if (photos && photos.length > 0) {
      const paths = photos.map((p: any) => p.storage_path)
      await supabaseAdmin.storage.from('photos').remove(paths)
    }
    await supabaseAdmin.from('photos').delete().eq('album_id', album_id)
    await supabaseAdmin.from('responsible_parents').delete().eq('album_id', album_id)
    await supabaseAdmin.from('albums').delete().eq('id', album_id)
    return NextResponse.json({ ok: true })
  }

  // Архивировать альбом — удалить все фото из Storage, оставить данные в базе
  if (body.action === 'archive_album') {
    const { album_id } = body
    const { data: photos } = await supabaseAdmin.from('photos').select('storage_path').eq('album_id', album_id)
    if (photos && photos.length > 0) {
      const paths = photos.map((p: any) => p.storage_path)
      // Удаляем батчами по 100
      for (let i = 0; i < paths.length; i += 100) {
        await supabaseAdmin.storage.from('photos').remove(paths.slice(i, i + 100))
      }
    }
    await supabaseAdmin.from('photos').delete().eq('album_id', album_id)
    await supabaseAdmin.from('albums').update({ archived: true }).eq('id', album_id)
    return NextResponse.json({ ok: true, deleted: photos?.length ?? 0 })
  }

  // Переименовать альбом
  if (body.action === 'rename_album') {
    await supabaseAdmin.from('albums').update({ title: body.title }).eq('id', body.album_id)
    return NextResponse.json({ ok: true })
  }

  // Создать альбом
  if (body.action === 'create_album') {
    const { data, error } = await supabaseAdmin.from('albums')
      .insert({
        title: body.title,
        classes: body.classes,
        cover_mode: body.cover_mode,
        cover_price: body.cover_price ?? 0,
        deadline: body.deadline ?? null,
        group_enabled: body.group_enabled ?? true,
        group_min: body.group_min ?? 2,
        group_max: body.group_max ?? 2,
        group_exclusive: body.group_exclusive ?? true,
        text_enabled: body.text_enabled ?? true,
        text_max_chars: body.text_max_chars ?? 500,
        city: body.city ?? null,
        year: body.year ?? new Date().getFullYear(),
      })
      .select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  // Шаблоны — получить список
  if (body.action === 'get_templates') {
    const { data } = await supabaseAdmin.from('album_templates').select('*').order('created_at')
    return NextResponse.json(data ?? [])
  }

  // Шаблоны — создать
  if (body.action === 'create_template') {
    const { data, error } = await supabaseAdmin.from('album_templates')
      .insert({
        title: body.title,
        cover_mode: body.cover_mode,
        cover_price: body.cover_price ?? 0,
        group_enabled: body.group_enabled ?? true,
        group_min: body.group_min ?? 2,
        group_max: body.group_max ?? 2,
        group_exclusive: body.group_exclusive ?? true,
        text_enabled: body.text_enabled ?? true,
        text_max_chars: body.text_max_chars ?? 500,
      })
      .select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  // Шаблоны — удалить
  if (body.action === 'delete_template') {
    await supabaseAdmin.from('album_templates').delete().eq('id', body.id)
    return NextResponse.json({ ok: true })
  }

  // Добавить ученика
  if (body.action === 'add_child') {
    const { data, error } = await supabaseAdmin.from('children')
      .insert({ album_id: body.album_id, full_name: body.full_name, class: body.class })
      .select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  // Добавить учителя
  if (body.action === 'add_teacher') {
    const { data, error } = await supabaseAdmin.from('teachers')
      .insert({ album_id: body.album_id })
      .select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  // Создать ответственного родителя
  if (body.action === 'create_responsible') {
    const { data, error } = await supabaseAdmin.from('responsible_parents')
      .insert({ album_id: body.album_id, full_name: body.full_name, phone: body.phone })
      .select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  // Обновить дедлайн альбома
  if (body.action === 'update_deadline') {
    const { error } = await supabaseAdmin
      .from('albums')
      .update({ deadline: body.deadline ?? null })
      .eq('id', body.album_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // Удалить ученика
  // Одноразовая очистка: сбросить submitted_at у детей с битыми selections
  if (body.action === 'fix_broken_selections') {
    const { data: orphaned } = await supabaseAdmin.from('selections').select('child_id, photo_id')
    const photoIds = Array.from(new Set((orphaned ?? []).map((s: any) => s.photo_id)))
    const { data: existingPhotos } = await supabaseAdmin.from('photos').select('id').in('id', photoIds)
    const existingIds = new Set((existingPhotos ?? []).map((p: any) => p.id))
    const broken = (orphaned ?? []).filter((s: any) => !existingIds.has(s.photo_id))
    const brokenChildIds = Array.from(new Set(broken.map((s: any) => s.child_id)))
    if (brokenChildIds.length > 0) {
      await supabaseAdmin.from('children').update({ submitted_at: null }).in('id', brokenChildIds)
    }
    return NextResponse.json({ fixed: brokenChildIds.length, children: brokenChildIds })
  }

  // Сбросить выбор ребёнка (без удаления)
  if (body.action === 'reset_child') {
    const { child_id } = body
    await supabaseAdmin.from('selections').delete().eq('child_id', child_id)
    await supabaseAdmin.from('photo_locks').delete().eq('child_id', child_id)
    await supabaseAdmin.from('cover_selections').delete().eq('child_id', child_id)
    await supabaseAdmin.from('student_texts').delete().eq('child_id', child_id)
    await supabaseAdmin.from('parent_contacts').delete().eq('child_id', child_id)
    await supabaseAdmin.from('drafts').delete().eq('child_id', child_id)
    await supabaseAdmin.from('children').update({ submitted_at: null, started_at: null }).eq('id', child_id)
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'delete_child') {
    // Разблокировать все фото которые он выбрал
    await supabaseAdmin.from('photo_locks').delete().eq('child_id', body.child_id)
    await supabaseAdmin.from('selections').delete().eq('child_id', body.child_id)
    await supabaseAdmin.from('parent_contacts').delete().eq('child_id', body.child_id)
    await supabaseAdmin.from('cover_selections').delete().eq('child_id', body.child_id)
    await supabaseAdmin.from('student_texts').delete().eq('child_id', body.child_id)
    await supabaseAdmin.from('drafts').delete().eq('child_id', body.child_id)
    await supabaseAdmin.from('photo_children').delete().eq('child_id', body.child_id)
    await supabaseAdmin.from('children').delete().eq('id', body.child_id)
    return NextResponse.json({ ok: true })
  }

  // Привязать фото к ребёнку
  if (body.action === 'tag_photo') {
    const { error } = await supabaseAdmin.from('photo_children')
      .upsert({ photo_id: body.photo_id, child_id: body.child_id }, { onConflict: 'photo_id,child_id' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // Массовый импорт разметки из CSV
  if (body.action === 'import_tags') {
    const { rows, album_id } = body
    let linked = 0, skipped = 0
    for (const row of rows) {
      const { data: child } = await supabaseAdmin
        .from('children').select('id').eq('album_id', album_id).ilike('full_name', row.child_name).maybeSingle()
      const { data: photo } = await supabaseAdmin
        .from('photos').select('id').eq('album_id', album_id).ilike('filename', row.photo_filename).maybeSingle()
      if (!child || !photo) { skipped++; continue }
      await supabaseAdmin.from('photo_children')
        .upsert({ photo_id: photo.id, child_id: child.id }, { onConflict: 'photo_id,child_id' })
      linked++
    }
    return NextResponse.json({ linked, skipped })
  }

  return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
}
