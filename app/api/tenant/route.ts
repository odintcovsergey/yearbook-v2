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

  return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
}

// ============================================================
// POST /api/tenant — мутации (создание/редактирование альбомов)
// ============================================================

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req, ['superadmin', 'owner', 'manager'])
  if (isAuthError(auth)) return auth

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

  return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
}
