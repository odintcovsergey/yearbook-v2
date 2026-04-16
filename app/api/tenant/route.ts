import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth, isAuthError, logAction, type AuthContext } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// ============================================================
// Хелпер: проверка, что альбом принадлежит tenant'у
// ============================================================
async function assertAlbumAccess(auth: AuthContext, albumId: string): Promise<boolean> {
  if (auth.role === 'superadmin') return true

  const { data } = await supabaseAdmin
    .from('albums')
    .select('tenant_id')
    .eq('id', albumId)
    .single()

  return data?.tenant_id === auth.tenantId
}

// ============================================================
// Хелпер: проверка, что ребёнок принадлежит альбому tenant'а
// ============================================================
async function assertChildAccess(auth: AuthContext, childId: string): Promise<boolean> {
  if (auth.role === 'superadmin') return true

  const { data } = await supabaseAdmin
    .from('children')
    .select('albums!inner(tenant_id)')
    .eq('id', childId)
    .single()

  return (data as any)?.albums?.tenant_id === auth.tenantId
}

// ============================================================
// Хелпер: проверка, что учитель принадлежит альбому tenant'а
// ============================================================
async function assertTeacherAccess(auth: AuthContext, teacherId: string): Promise<boolean> {
  if (auth.role === 'superadmin') return true

  const { data } = await supabaseAdmin
    .from('teachers')
    .select('albums!inner(tenant_id)')
    .eq('id', teacherId)
    .single()

  return (data as any)?.albums?.tenant_id === auth.tenantId
}

// ============================================================
// Хелпер: проверка, что фото принадлежит альбому tenant'а
// Возвращает saved photo row (вместе с storage_path и thumb_path), либо null
// ============================================================
async function getOwnedPhoto(auth: AuthContext, photoId: string) {
  const { data } = await supabaseAdmin
    .from('photos')
    .select('id, album_id, storage_path, thumb_path, filename, type, albums!inner(tenant_id)')
    .eq('id', photoId)
    .single()

  if (!data) return null
  if (auth.role === 'superadmin') return data as any
  if ((data as any).albums?.tenant_id !== auth.tenantId) return null
  return data as any
}

// ============================================================
// Хелпер: проверка, что ответственный родитель принадлежит альбому tenant'а
// ============================================================
async function assertResponsibleAccess(auth: AuthContext, responsibleId: string): Promise<boolean> {
  if (auth.role === 'superadmin') return true

  const { data } = await supabaseAdmin
    .from('responsible_parents')
    .select('albums!inner(tenant_id)')
    .eq('id', responsibleId)
    .single()

  return (data as any)?.albums?.tenant_id === auth.tenantId
}

// ============================================================
// GET /api/tenant — данные своего арендатора
// ============================================================
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, ['superadmin', 'owner', 'manager', 'viewer'])
  if (isAuthError(auth)) return auth

  const action = req.nextUrl.searchParams.get('action')
  const albumId = req.nextUrl.searchParams.get('album_id')

  // ----------------------------------------------------------
  // dashboard — общая информация для главного экрана
  // ----------------------------------------------------------
  if (action === 'dashboard') {
    // Альбомы tenant'а со статистикой
    const [albumsRes, childrenRes, teacherTokensRes, teachersRes, leadsRes] = await Promise.all([
      supabaseAdmin
        .from('albums')
        .select('*')
        .eq('tenant_id', auth.tenantId)
        .order('created_at', { ascending: false }),
      supabaseAdmin
        .from('children')
        .select('album_id, submitted_at, started_at, albums!inner(tenant_id)')
        .eq('albums.tenant_id', auth.tenantId),
      supabaseAdmin
        .from('responsible_parents')
        .select('album_id, access_token, albums!inner(tenant_id)')
        .eq('albums.tenant_id', auth.tenantId),
      supabaseAdmin
        .from('teachers')
        .select('album_id, submitted_at, albums!inner(tenant_id)')
        .eq('albums.tenant_id', auth.tenantId),
      supabaseAdmin
        .from('referral_leads')
        .select('id, status')
        .eq('tenant_id', auth.tenantId),
    ])

    const albums = albumsRes.data ?? []

    // Статистика по альбомам
    const statsMap: Record<string, { total: number; submitted: number; in_progress: number }> = {}
    for (const c of childrenRes.data ?? []) {
      if (!statsMap[c.album_id]) statsMap[c.album_id] = { total: 0, submitted: 0, in_progress: 0 }
      statsMap[c.album_id].total++
      if (c.submitted_at) statsMap[c.album_id].submitted++
      else if (c.started_at) statsMap[c.album_id].in_progress++
    }

    const tokenMap: Record<string, string> = {}
    for (const t of teacherTokensRes.data ?? []) tokenMap[t.album_id] = t.access_token

    const teacherMap: Record<string, { total: number; done: number }> = {}
    for (const t of teachersRes.data ?? []) {
      if (!teacherMap[t.album_id]) teacherMap[t.album_id] = { total: 0, done: 0 }
      teacherMap[t.album_id].total++
      if (t.submitted_at) teacherMap[t.album_id].done++
    }

    // Глобальные цифры
    const albumsActive = albums.filter(a => !a.archived).length
    const totalChildren = (childrenRes.data ?? []).length
    const totalSubmitted = (childrenRes.data ?? []).filter(c => c.submitted_at).length
    const leads = leadsRes.data ?? []
    const newLeads = leads.filter(l => l.status === 'new').length

    return NextResponse.json({
      albums: albums.map(a => ({
        ...a,
        stats: statsMap[a.id] ?? { total: 0, submitted: 0, in_progress: 0 },
        teacher_token: tokenMap[a.id] ?? null,
        teachers: teacherMap[a.id] ?? null,
      })),
      summary: {
        albums_total: albums.length,
        albums_active: albumsActive,
        albums_archived: albums.length - albumsActive,
        children_total: totalChildren,
        children_submitted: totalSubmitted,
        leads_total: leads.length,
        leads_new: newLeads,
      },
    })
  }

  // ----------------------------------------------------------
  // album — данные конкретного альбома (с проверкой доступа)
  // ----------------------------------------------------------
  if (action === 'album' && albumId) {
    if (!(await assertAlbumAccess(auth, albumId))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    const { data: album } = await supabaseAdmin
      .from('albums')
      .select('*')
      .eq('id', albumId)
      .single()

    return NextResponse.json(album)
  }

  // ----------------------------------------------------------
  // album_stats — детальная статистика по альбому
  // ----------------------------------------------------------
  if (action === 'album_stats' && albumId) {
    if (!(await assertAlbumAccess(auth, albumId))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    const [children, teachers, surcharges] = await Promise.all([
      supabaseAdmin.from('children').select('id, submitted_at, started_at').eq('album_id', albumId),
      supabaseAdmin.from('teachers').select('id, submitted_at').eq('album_id', albumId),
      supabaseAdmin
        .from('cover_selections')
        .select('surcharge, child_id, children!inner(album_id)')
        .eq('children.album_id', albumId)
        .gt('surcharge', 0),
    ])

    const ch = children.data ?? []
    const tch = teachers.data ?? []
    const surch = surcharges.data ?? []

    return NextResponse.json({
      total: ch.length,
      submitted: ch.filter((c: any) => c.submitted_at).length,
      in_progress: ch.filter((c: any) => !c.submitted_at && c.started_at).length,
      not_started: ch.filter((c: any) => !c.submitted_at && !c.started_at).length,
      teachers_total: tch.length,
      teachers_done: tch.filter((t: any) => t.submitted_at).length,
      surcharge_total: surch.reduce((sum: number, s: any) => sum + (s.surcharge ?? 0), 0),
      surcharge_count: surch.length,
    })
  }

  // ----------------------------------------------------------
  // children — список учеников альбома
  // ----------------------------------------------------------
  if (action === 'children' && albumId) {
    if (!(await assertAlbumAccess(auth, albumId))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    const { data: children } = await supabaseAdmin
      .from('children')
      .select('id, full_name, class, access_token, submitted_at, started_at')
      .eq('album_id', albumId)
      .order('class')
      .order('full_name')

    const ids = (children ?? []).map((c: any) => c.id)

    if (ids.length === 0) {
      return NextResponse.json([])
    }

    const [contacts, covers] = await Promise.all([
      supabaseAdmin
        .from('parent_contacts')
        .select('child_id, parent_name, phone')
        .in('child_id', ids),
      supabaseAdmin
        .from('cover_selections')
        .select('child_id, cover_option, surcharge')
        .in('child_id', ids),
    ])

    const contactMap = Object.fromEntries((contacts.data ?? []).map((c: any) => [c.child_id, c]))
    const coverMap = Object.fromEntries((covers.data ?? []).map((c: any) => [c.child_id, c]))

    return NextResponse.json(
      (children ?? []).map((c: any) => ({
        ...c,
        contact: contactMap[c.id] ?? null,
        cover: coverMap[c.id] ?? null,
      }))
    )
  }

  // ----------------------------------------------------------
  // templates — шаблоны альбомов (свои + глобальные)
  // ----------------------------------------------------------
  if (action === 'templates') {
    const { data } = await supabaseAdmin
      .from('album_templates')
      .select('*')
      .or(`tenant_id.is.null,tenant_id.eq.${auth.tenantId}`)
      .order('created_at')

    return NextResponse.json(data ?? [])
  }

  // ----------------------------------------------------------
  // teachers — список учителей альбома
  // ----------------------------------------------------------
  if (action === 'teachers' && albumId) {
    if (!(await assertAlbumAccess(auth, albumId))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    const { data } = await supabaseAdmin
      .from('teachers')
      .select('id, full_name, position, description, access_token, submitted_at, created_at')
      .eq('album_id', albumId)
      .order('created_at')

    return NextResponse.json(data ?? [])
  }

  // ----------------------------------------------------------
  // responsible — ответственный родитель альбома
  // ----------------------------------------------------------
  if (action === 'responsible' && albumId) {
    if (!(await assertAlbumAccess(auth, albumId))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    const { data } = await supabaseAdmin
      .from('responsible_parents')
      .select('id, full_name, phone, access_token, submitted_at, created_at')
      .eq('album_id', albumId)
      .maybeSingle()

    return NextResponse.json(data ?? null)
  }

  // ----------------------------------------------------------
  // photos — список фото альбома (с опциональным фильтром по типу и тегами)
  // ----------------------------------------------------------
  if (action === 'photos' && albumId) {
    if (!(await assertAlbumAccess(auth, albumId))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    const photoType = req.nextUrl.searchParams.get('photo_type')

    let query = supabaseAdmin
      .from('photos')
      .select('id, filename, storage_path, thumb_path, type, created_at')
      .eq('album_id', albumId)
      .order('created_at')

    if (photoType) query = query.eq('type', photoType)

    const { data: photos, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const base = process.env.NEXT_PUBLIC_SUPABASE_URL + '/storage/v1/object/public/photos/'

    // Привязки фото к детям (только для portrait/group)
    let tagsByPhoto: Record<string, string[]> = {}
    if (!photoType || photoType === 'portrait' || photoType === 'group') {
      const photoIds = (photos ?? []).map((p: any) => p.id)
      if (photoIds.length > 0) {
        const { data: links } = await supabaseAdmin
          .from('photo_children')
          .select('photo_id, children(full_name)')
          .in('photo_id', photoIds)
        for (const link of links ?? []) {
          const name = (link as any).children?.full_name ?? ''
          if (!tagsByPhoto[(link as any).photo_id]) tagsByPhoto[(link as any).photo_id] = []
          tagsByPhoto[(link as any).photo_id].push(name)
        }
      }
    }

    const result = (photos ?? []).map((p: any) => ({
      id: p.id,
      filename: p.filename,
      storage_path: p.storage_path,
      thumb_path: p.thumb_path,
      type: p.type,
      url: base + p.storage_path,
      thumb_url: p.thumb_path
        ? base + p.thumb_path
        : base + p.storage_path + '?width=400&quality=70',
      tags: tagsByPhoto[p.id] ?? [],
    }))

    return NextResponse.json({ photos: result })
  }

  return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
}

// ============================================================
// POST /api/tenant — мутации (создание/редактирование альбомов)
// ============================================================

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req, ['superadmin', 'owner', 'manager'])
  if (isAuthError(auth)) return auth

  const contentType = req.headers.get('content-type') ?? ''

  // ============================================================
  // multipart/form-data — загрузка фото (upload_photo)
  // Формат: file, type (portrait|group|teacher), album_id
  // Делает WebP full (2048px) + thumb (400px) через sharp,
  // заливает оба в Storage, создаёт запись в photos.
  // ============================================================
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData()
    const file = form.get('file') as File | null
    const type = form.get('type') as string | null
    const albumId = form.get('album_id') as string | null

    if (!file || !type || !albumId) {
      return NextResponse.json({ error: 'Не хватает данных (file, type, album_id)' }, { status: 400 })
    }

    if (!['portrait', 'group', 'teacher'].includes(type)) {
      return NextResponse.json({ error: 'Неверный type' }, { status: 400 })
    }

    if (!(await assertAlbumAccess(auth, albumId))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    // Проверим, что альбом не в архиве
    const { data: album } = await supabaseAdmin
      .from('albums')
      .select('archived')
      .eq('id', albumId)
      .single()
    if ((album as any)?.archived) {
      return NextResponse.json({ error: 'Нельзя загружать фото в архивный альбом' }, { status: 403 })
    }

    const sharp = (await import('sharp')).default
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

    if (fullUpload.error) {
      return NextResponse.json({ error: fullUpload.error.message }, { status: 500 })
    }

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

    await logAction(auth, 'photo.upload', 'photo', (photo as any).id, {
      album_id: albumId,
      type,
      filename: file.name,
    })

    return NextResponse.json(photo)
  }

  const body = await req.json()

  // ----------------------------------------------------------
  // create_album — создание нового альбома (с проверкой лимита)
  // ----------------------------------------------------------
  if (body.action === 'create_album') {
    // Проверяем лимит по тарифу
    if (auth.role !== 'superadmin') {
      const [{ count: currentCount }, { data: tenant }] = await Promise.all([
        supabaseAdmin
          .from('albums')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', auth.tenantId)
          .eq('archived', false),
        supabaseAdmin
          .from('tenants')
          .select('max_albums, is_active, plan_expires')
          .eq('id', auth.tenantId)
          .single(),
      ])

      if (!tenant?.is_active) {
        return NextResponse.json(
          { error: 'Аккаунт заблокирован. Обратитесь в поддержку.' },
          { status: 403 }
        )
      }

      if (tenant.plan_expires && new Date(tenant.plan_expires) < new Date()) {
        return NextResponse.json(
          { error: 'Срок действия тарифа истёк. Обратитесь в поддержку.' },
          { status: 403 }
        )
      }

      if ((currentCount ?? 0) >= tenant.max_albums) {
        return NextResponse.json(
          {
            error: `Достигнут лимит тарифа: ${tenant.max_albums} активных альбомов. Архивируйте ненужные или обновите тариф.`,
          },
          { status: 403 }
        )
      }
    }

    if (!body.title || typeof body.title !== 'string' || !body.title.trim()) {
      return NextResponse.json({ error: 'Название обязательно' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('albums')
      .insert({
        tenant_id: auth.tenantId,
        title: body.title.trim(),
        classes: body.classes ?? [],
        cover_mode: body.cover_mode ?? 'none',
        cover_price: body.cover_price ?? 0,
        deadline: body.deadline ?? null,
        group_enabled: body.group_enabled ?? true,
        group_min: body.group_min ?? 2,
        group_max: body.group_max ?? 2,
        group_exclusive: body.group_exclusive ?? true,
        text_enabled: body.text_enabled ?? true,
        text_max_chars: body.text_max_chars ?? 500,
        text_type: body.text_type ?? 'free',
        template_title: body.template_title ?? null,
        city: body.city ?? null,
        year: body.year ?? new Date().getFullYear(),
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logAction(auth, 'album.create', 'album', data.id, {
      title: data.title,
      city: data.city,
      template: data.template_title,
    })

    return NextResponse.json(data)
  }

  // ----------------------------------------------------------
  // update_album — редактирование настроек альбома
  // ----------------------------------------------------------
  if (body.action === 'update_album') {
    const { album_id } = body
    if (!album_id) {
      return NextResponse.json({ error: 'album_id обязателен' }, { status: 400 })
    }

    if (!(await assertAlbumAccess(auth, album_id))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    // Список разрешённых полей
    const allowedFields = [
      'title', 'city', 'year', 'deadline',
      'cover_mode', 'cover_price',
      'group_enabled', 'group_min', 'group_max', 'group_exclusive',
      'text_enabled', 'text_max_chars', 'text_type',
    ]
    const updates: Record<string, unknown> = {}
    for (const key of allowedFields) {
      if (key in body) updates[key] = body[key]
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Нет полей для обновления' }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from('albums')
      .update(updates)
      .eq('id', album_id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logAction(auth, 'album.update', 'album', album_id, { fields: Object.keys(updates) })

    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------
  // archive_album — в архив + удаление файлов фото
  // ----------------------------------------------------------
  if (body.action === 'archive_album') {
    const { album_id } = body
    if (!album_id) {
      return NextResponse.json({ error: 'album_id обязателен' }, { status: 400 })
    }

    if (!(await assertAlbumAccess(auth, album_id))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    // Удаляем файлы фото из Storage (экономим место)
    const { data: photos } = await supabaseAdmin
      .from('photos')
      .select('storage_path, thumb_path')
      .eq('album_id', album_id)

    if (photos && photos.length > 0) {
      const paths: string[] = []
      for (const p of photos as any[]) {
        if (p.storage_path) paths.push(p.storage_path)
        if (p.thumb_path) paths.push(p.thumb_path)
      }
      // Батчами по 100
      for (let i = 0; i < paths.length; i += 100) {
        await supabaseAdmin.storage.from('photos').remove(paths.slice(i, i + 100))
      }
    }

    // Удаляем записи photos (selections удалятся каскадно через album_id)
    await supabaseAdmin.from('photos').delete().eq('album_id', album_id)

    // Ставим флаг архива
    const { error } = await supabaseAdmin
      .from('albums')
      .update({ archived: true })
      .eq('id', album_id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logAction(auth, 'album.archive', 'album', album_id, {
      photos_deleted: photos?.length ?? 0,
    })

    return NextResponse.json({ ok: true, deleted: photos?.length ?? 0 })
  }

  // ----------------------------------------------------------
  // unarchive_album — вернуть из архива
  // ----------------------------------------------------------
  if (body.action === 'unarchive_album') {
    const { album_id } = body
    if (!album_id) {
      return NextResponse.json({ error: 'album_id обязателен' }, { status: 400 })
    }

    if (!(await assertAlbumAccess(auth, album_id))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    // Проверяем лимит (возврат из архива считается как новый активный)
    if (auth.role !== 'superadmin') {
      const [{ count: currentCount }, { data: tenant }] = await Promise.all([
        supabaseAdmin
          .from('albums')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', auth.tenantId)
          .eq('archived', false),
        supabaseAdmin
          .from('tenants')
          .select('max_albums')
          .eq('id', auth.tenantId)
          .single(),
      ])

      if ((currentCount ?? 0) >= (tenant?.max_albums ?? 0)) {
        return NextResponse.json(
          {
            error: `Достигнут лимит активных альбомов (${tenant?.max_albums}). Архивируйте другой или обновите тариф.`,
          },
          { status: 403 }
        )
      }
    }

    const { error } = await supabaseAdmin
      .from('albums')
      .update({ archived: false })
      .eq('id', album_id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logAction(auth, 'album.unarchive', 'album', album_id)

    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------
  // add_child — добавить одного ученика
  // ----------------------------------------------------------
  if (body.action === 'add_child') {
    const { album_id, full_name, class: childClass } = body
    if (!album_id || !full_name?.trim() || !childClass?.trim()) {
      return NextResponse.json({ error: 'album_id, ФИО и класс обязательны' }, { status: 400 })
    }

    if (!(await assertAlbumAccess(auth, album_id))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    const { data, error } = await supabaseAdmin
      .from('children')
      .insert({
        album_id,
        full_name: full_name.trim(),
        class: childClass.trim(),
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logAction(auth, 'child.create', 'child', data.id, {
      album_id,
      full_name: data.full_name,
      class: data.class,
    })

    return NextResponse.json(data)
  }

  // ----------------------------------------------------------
  // import_children — массовый импорт учеников из CSV
  // ----------------------------------------------------------
  if (body.action === 'import_children') {
    const { album_id, rows } = body
    if (!album_id || !Array.isArray(rows)) {
      return NextResponse.json({ error: 'album_id и rows обязательны' }, { status: 400 })
    }

    if (!(await assertAlbumAccess(auth, album_id))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    // Валидация и нормализация
    const toInsert: Array<{ album_id: string; full_name: string; class: string }> = []
    let skipped = 0
    for (const row of rows) {
      const full_name = String(row.full_name ?? row.name ?? '').trim()
      const childClass = String(row.class ?? row['класс'] ?? '').trim()
      if (!full_name || !childClass) {
        skipped++
        continue
      }
      toInsert.push({ album_id, full_name, class: childClass })
    }

    if (toInsert.length === 0) {
      return NextResponse.json(
        { error: 'Нет корректных строк для импорта', skipped },
        { status: 400 }
      )
    }

    // Получим существующих детей чтобы не дублировать
    const { data: existing } = await supabaseAdmin
      .from('children')
      .select('full_name, class')
      .eq('album_id', album_id)

    const existingSet = new Set(
      (existing ?? []).map((c: any) => `${c.full_name.toLowerCase()}|${c.class.toLowerCase()}`)
    )

    const filtered = toInsert.filter(c => {
      const key = `${c.full_name.toLowerCase()}|${c.class.toLowerCase()}`
      if (existingSet.has(key)) {
        skipped++
        return false
      }
      existingSet.add(key)
      return true
    })

    if (filtered.length === 0) {
      return NextResponse.json({ added: 0, skipped })
    }

    const { data, error } = await supabaseAdmin
      .from('children')
      .insert(filtered)
      .select('id, full_name, class, access_token')

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logAction(auth, 'child.import', 'album', album_id, {
      added: data?.length ?? 0,
      skipped,
    })

    return NextResponse.json({ added: data?.length ?? 0, skipped, children: data })
  }

  // ----------------------------------------------------------
  // reset_child — сбросить выбор ученика (без удаления)
  // ----------------------------------------------------------
  if (body.action === 'reset_child') {
    const { child_id } = body
    if (!child_id) {
      return NextResponse.json({ error: 'child_id обязателен' }, { status: 400 })
    }

    if (!(await assertChildAccess(auth, child_id))) {
      return NextResponse.json({ error: 'Ученик не найден' }, { status: 404 })
    }

    await Promise.all([
      supabaseAdmin.from('selections').delete().eq('child_id', child_id),
      supabaseAdmin.from('photo_locks').delete().eq('child_id', child_id),
      supabaseAdmin.from('cover_selections').delete().eq('child_id', child_id),
      supabaseAdmin.from('student_texts').delete().eq('child_id', child_id),
      supabaseAdmin.from('parent_contacts').delete().eq('child_id', child_id),
      supabaseAdmin.from('drafts').delete().eq('child_id', child_id),
      supabaseAdmin.from('quote_selections').delete().eq('child_id', child_id),
    ])

    await supabaseAdmin
      .from('children')
      .update({ submitted_at: null, started_at: null })
      .eq('id', child_id)

    await logAction(auth, 'child.reset', 'child', child_id)

    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------
  // delete_child — полностью удалить ученика
  // ----------------------------------------------------------
  if (body.action === 'delete_child') {
    const { child_id } = body
    if (!child_id) {
      return NextResponse.json({ error: 'child_id обязателен' }, { status: 400 })
    }

    if (!(await assertChildAccess(auth, child_id))) {
      return NextResponse.json({ error: 'Ученик не найден' }, { status: 404 })
    }

    // Получим данные ребёнка для audit log
    const { data: child } = await supabaseAdmin
      .from('children')
      .select('full_name, class, album_id')
      .eq('id', child_id)
      .single()

    // Удаляем всё связанное
    await Promise.all([
      supabaseAdmin.from('photo_locks').delete().eq('child_id', child_id),
      supabaseAdmin.from('selections').delete().eq('child_id', child_id),
      supabaseAdmin.from('parent_contacts').delete().eq('child_id', child_id),
      supabaseAdmin.from('cover_selections').delete().eq('child_id', child_id),
      supabaseAdmin.from('quote_selections').delete().eq('child_id', child_id),
      supabaseAdmin.from('student_texts').delete().eq('child_id', child_id),
      supabaseAdmin.from('drafts').delete().eq('child_id', child_id),
      supabaseAdmin.from('photo_children').delete().eq('child_id', child_id),
    ])

    await supabaseAdmin.from('children').delete().eq('id', child_id)

    await logAction(auth, 'child.delete', 'child', child_id, {
      full_name: child?.full_name,
      class: child?.class,
    })

    return NextResponse.json({ ok: true })
  }

  // ============================================================
  // УЧИТЕЛЯ
  // ============================================================

  // ----------------------------------------------------------
  // add_teacher — добавить учителя (ФИО и должность опциональны)
  // ----------------------------------------------------------
  if (body.action === 'add_teacher') {
    const { album_id, full_name, position } = body
    if (!album_id) {
      return NextResponse.json({ error: 'album_id обязателен' }, { status: 400 })
    }

    if (!(await assertAlbumAccess(auth, album_id))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    const { data, error } = await supabaseAdmin
      .from('teachers')
      .insert({
        album_id,
        full_name: full_name?.trim() || null,
        position: position?.trim() || null,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logAction(auth, 'teacher.create', 'teacher', data.id, {
      album_id,
      full_name: data.full_name,
    })

    return NextResponse.json(data)
  }

  // ----------------------------------------------------------
  // update_teacher — редактирование данных учителя
  // ----------------------------------------------------------
  if (body.action === 'update_teacher') {
    const { teacher_id, full_name, position, description } = body
    if (!teacher_id) {
      return NextResponse.json({ error: 'teacher_id обязателен' }, { status: 400 })
    }

    if (!(await assertTeacherAccess(auth, teacher_id))) {
      return NextResponse.json({ error: 'Учитель не найден' }, { status: 404 })
    }

    const updates: Record<string, unknown> = {}
    if (full_name !== undefined) updates.full_name = full_name?.trim() || null
    if (position !== undefined) updates.position = position?.trim() || null
    if (description !== undefined) updates.description = description?.trim() || ''

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Нет полей для обновления' }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from('teachers')
      .update(updates)
      .eq('id', teacher_id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logAction(auth, 'teacher.update', 'teacher', teacher_id, {
      fields: Object.keys(updates),
    })

    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------
  // delete_teacher — удаление учителя
  // ----------------------------------------------------------
  if (body.action === 'delete_teacher') {
    const { teacher_id } = body
    if (!teacher_id) {
      return NextResponse.json({ error: 'teacher_id обязателен' }, { status: 400 })
    }

    if (!(await assertTeacherAccess(auth, teacher_id))) {
      return NextResponse.json({ error: 'Учитель не найден' }, { status: 404 })
    }

    await supabaseAdmin.from('photo_teachers').delete().eq('teacher_id', teacher_id)
    await supabaseAdmin.from('teachers').delete().eq('id', teacher_id)

    await logAction(auth, 'teacher.delete', 'teacher', teacher_id)

    return NextResponse.json({ ok: true })
  }

  // ============================================================
  // ОТВЕТСТВЕННЫЙ РОДИТЕЛЬ
  // ============================================================

  // ----------------------------------------------------------
  // create_responsible — создать ответственного родителя (один на альбом)
  // ----------------------------------------------------------
  if (body.action === 'create_responsible') {
    const { album_id, full_name, phone } = body
    if (!album_id) {
      return NextResponse.json({ error: 'album_id обязателен' }, { status: 400 })
    }

    if (!(await assertAlbumAccess(auth, album_id))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    // Проверяем, что нет уже существующего
    const { data: existing } = await supabaseAdmin
      .from('responsible_parents')
      .select('id')
      .eq('album_id', album_id)
      .maybeSingle()

    if (existing) {
      return NextResponse.json(
        { error: 'Ответственный родитель для этого альбома уже создан' },
        { status: 409 }
      )
    }

    const { data, error } = await supabaseAdmin
      .from('responsible_parents')
      .insert({
        album_id,
        full_name: full_name?.trim() || null,
        phone: phone?.trim() || null,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logAction(auth, 'responsible.create', 'responsible', data.id, { album_id })

    return NextResponse.json(data)
  }

  // ----------------------------------------------------------
  // update_responsible — обновить данные ответственного
  // ----------------------------------------------------------
  if (body.action === 'update_responsible') {
    const { responsible_id, full_name, phone } = body
    if (!responsible_id) {
      return NextResponse.json({ error: 'responsible_id обязателен' }, { status: 400 })
    }

    if (!(await assertResponsibleAccess(auth, responsible_id))) {
      return NextResponse.json({ error: 'Ответственный не найден' }, { status: 404 })
    }

    const updates: Record<string, unknown> = {}
    if (full_name !== undefined) updates.full_name = full_name?.trim() || null
    if (phone !== undefined) updates.phone = phone?.trim() || null

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Нет полей для обновления' }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from('responsible_parents')
      .update(updates)
      .eq('id', responsible_id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logAction(auth, 'responsible.update', 'responsible', responsible_id, {
      fields: Object.keys(updates),
    })

    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------
  // delete_responsible — удалить ответственного
  // ----------------------------------------------------------
  if (body.action === 'delete_responsible') {
    const { responsible_id } = body
    if (!responsible_id) {
      return NextResponse.json({ error: 'responsible_id обязателен' }, { status: 400 })
    }

    if (!(await assertResponsibleAccess(auth, responsible_id))) {
      return NextResponse.json({ error: 'Ответственный не найден' }, { status: 404 })
    }

    await supabaseAdmin.from('responsible_parents').delete().eq('id', responsible_id)

    await logAction(auth, 'responsible.delete', 'responsible', responsible_id)

    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------
  // register_photo — регистрация уже загруженного файла в БД
  // Используется при клиентской компрессии (быстрая параллельная загрузка).
  // Клиент сам заливает файл в Storage под путём album_id/type/ts_name.webp,
  // затем вызывает этот endpoint для создания записи в photos.
  // ----------------------------------------------------------
  if (body.action === 'register_photo') {
    const { album_id, filename, storage_path, thumb_path, type } = body

    if (!album_id || !filename || !storage_path || !type) {
      return NextResponse.json({ error: 'Не хватает данных' }, { status: 400 })
    }

    if (!['portrait', 'group', 'teacher'].includes(type)) {
      return NextResponse.json({ error: 'Неверный type' }, { status: 400 })
    }

    if (!(await assertAlbumAccess(auth, album_id))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    // Защита: клиент не может подсунуть чужой путь — требуем,
    // чтобы storage_path начинался с album_id/
    if (!storage_path.startsWith(`${album_id}/`)) {
      return NextResponse.json({ error: 'Недопустимый storage_path' }, { status: 400 })
    }
    if (thumb_path && !thumb_path.startsWith(`${album_id}/`)) {
      return NextResponse.json({ error: 'Недопустимый thumb_path' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('photos')
      .insert({
        album_id,
        filename,
        storage_path,
        thumb_path: thumb_path ?? null,
        type,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await logAction(auth, 'photo.register', 'photo', (data as any).id, {
      album_id,
      type,
      filename,
    })

    return NextResponse.json(data)
  }

  // ----------------------------------------------------------
  // delete_photo — удалить фото (+ thumb из Storage, + связи из БД)
  // Автоматически сбрасывает submitted_at у детей, которые выбрали это фото.
  // ----------------------------------------------------------
  if (body.action === 'delete_photo') {
    const { photo_id } = body
    if (!photo_id) {
      return NextResponse.json({ error: 'photo_id обязателен' }, { status: 400 })
    }

    const photo = await getOwnedPhoto(auth, photo_id)
    if (!photo) {
      return NextResponse.json({ error: 'Фото не найдено' }, { status: 404 })
    }

    // Кто выбирал это фото — им надо сбросить submitted_at
    const { data: affectedSelections } = await supabaseAdmin
      .from('selections').select('child_id').eq('photo_id', photo_id)
    const affectedChildIds = Array.from(
      new Set((affectedSelections ?? []).map((s: any) => s.child_id))
    )

    // Удалить файлы из Storage
    const pathsToDelete: string[] = []
    if (photo.storage_path) pathsToDelete.push(photo.storage_path)
    if (photo.thumb_path) pathsToDelete.push(photo.thumb_path)
    if (pathsToDelete.length > 0) {
      await supabaseAdmin.storage.from('photos').remove(pathsToDelete)
    }

    // Удалить все связи
    await supabaseAdmin.from('selections').delete().eq('photo_id', photo_id)
    await supabaseAdmin.from('photo_teachers').delete().eq('photo_id', photo_id)
    await supabaseAdmin.from('photo_children').delete().eq('photo_id', photo_id)
    await supabaseAdmin.from('photo_locks').delete().eq('photo_id', photo_id)
    await supabaseAdmin.from('photos').delete().eq('id', photo_id)

    // Сбросить submitted_at у затронутых
    if (affectedChildIds.length > 0) {
      await supabaseAdmin.from('children')
        .update({ submitted_at: null })
        .in('id', affectedChildIds)
    }

    await logAction(auth, 'photo.delete', 'photo', photo_id, {
      album_id: photo.album_id,
      filename: photo.filename,
      reset_children: affectedChildIds.length,
    })

    return NextResponse.json({ ok: true, resetChildren: affectedChildIds.length })
  }

  // ----------------------------------------------------------
  // tag_photo — привязать фото к ребёнку
  // ----------------------------------------------------------
  if (body.action === 'tag_photo') {
    const { photo_id, child_id } = body
    if (!photo_id || !child_id) {
      return NextResponse.json({ error: 'photo_id и child_id обязательны' }, { status: 400 })
    }

    const photo = await getOwnedPhoto(auth, photo_id)
    if (!photo) return NextResponse.json({ error: 'Фото не найдено' }, { status: 404 })
    if (!(await assertChildAccess(auth, child_id))) {
      return NextResponse.json({ error: 'Ученик не найден' }, { status: 404 })
    }

    const { error } = await supabaseAdmin
      .from('photo_children')
      .upsert({ photo_id, child_id }, { onConflict: 'photo_id,child_id' })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await logAction(auth, 'photo.tag', 'photo', photo_id, { child_id })

    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------
  // untag_photo — убрать привязку фото от ребёнка
  // ----------------------------------------------------------
  if (body.action === 'untag_photo') {
    const { photo_id, child_id } = body
    if (!photo_id || !child_id) {
      return NextResponse.json({ error: 'photo_id и child_id обязательны' }, { status: 400 })
    }

    const photo = await getOwnedPhoto(auth, photo_id)
    if (!photo) return NextResponse.json({ error: 'Фото не найдено' }, { status: 404 })

    await supabaseAdmin
      .from('photo_children')
      .delete()
      .eq('photo_id', photo_id)
      .eq('child_id', child_id)

    await logAction(auth, 'photo.untag', 'photo', photo_id, { child_id })

    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------
  // import_tags — массовая разметка из CSV
  // rows: [{ child_name, photo_filename }]
  // Имена и имена файлов матчатся по ilike (регистронезависимо).
  // Возвращает { linked, skipped, skipped_rows } для отладки.
  // ----------------------------------------------------------
  if (body.action === 'import_tags') {
    const { album_id, rows } = body
    if (!album_id || !Array.isArray(rows)) {
      return NextResponse.json({ error: 'album_id и rows обязательны' }, { status: 400 })
    }

    if (!(await assertAlbumAccess(auth, album_id))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    // Подтягиваем всех детей и все фото альбома одним запросом —
    // так намного быстрее чем по одному запросу на строку CSV.
    const [childrenRes, photosRes] = await Promise.all([
      supabaseAdmin.from('children').select('id, full_name').eq('album_id', album_id),
      supabaseAdmin.from('photos').select('id, filename').eq('album_id', album_id),
    ])

    const childByName: Record<string, string> = {}
    for (const c of childrenRes.data ?? []) {
      childByName[(c as any).full_name.trim().toLowerCase()] = (c as any).id
    }

    const photoByFilename: Record<string, string> = {}
    for (const p of photosRes.data ?? []) {
      photoByFilename[(p as any).filename.trim().toLowerCase()] = (p as any).id
    }

    let linked = 0
    let skipped = 0
    const skippedRows: Array<{ child_name: string; photo_filename: string; reason: string }> = []
    const inserts: Array<{ photo_id: string; child_id: string }> = []

    for (const row of rows) {
      const childName = (row?.child_name ?? '').toString().trim().toLowerCase()
      const photoName = (row?.photo_filename ?? '').toString().trim().toLowerCase()

      if (!childName || !photoName) { skipped++; continue }

      const childId = childByName[childName]
      const photoId = photoByFilename[photoName]

      if (!childId && !photoId) {
        skipped++
        skippedRows.push({ child_name: row.child_name, photo_filename: row.photo_filename, reason: 'не найдены ни ученик, ни фото' })
        continue
      }
      if (!childId) {
        skipped++
        skippedRows.push({ child_name: row.child_name, photo_filename: row.photo_filename, reason: 'ученик не найден' })
        continue
      }
      if (!photoId) {
        skipped++
        skippedRows.push({ child_name: row.child_name, photo_filename: row.photo_filename, reason: 'фото не найдено' })
        continue
      }

      inserts.push({ photo_id: photoId, child_id: childId })
    }

    // Пачкой делаем upsert (onConflict — игнор дубликатов)
    if (inserts.length > 0) {
      const { error } = await supabaseAdmin
        .from('photo_children')
        .upsert(inserts, { onConflict: 'photo_id,child_id', ignoreDuplicates: true })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      linked = inserts.length
    }

    await logAction(auth, 'photo.import_tags', 'album', album_id, { linked, skipped })

    return NextResponse.json({ linked, skipped, skipped_rows: skippedRows.slice(0, 50) })
  }

  return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
}
