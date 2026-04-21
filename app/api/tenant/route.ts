import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth, isAuthError, logAction, hashPassword, verifyPassword, type AuthContext } from '@/lib/auth'

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
  // child_details — выбор конкретного ученика (фото, текст, контакт)
  // ----------------------------------------------------------
  if (action === 'child_details') {
    const childId = req.nextUrl.searchParams.get('child_id')
    if (!childId) return NextResponse.json({ error: 'Нет child_id' }, { status: 400 })

    // Проверяем принадлежность ребёнка tenant'у
    const { data: childCheck } = await supabaseAdmin
      .from('children')
      .select('id, albums!inner(tenant_id)')
      .eq('id', childId)
      .single()
    if (!childCheck || (auth.role !== 'superadmin' && (childCheck as any).albums?.tenant_id !== auth.tenantId)) {
      return NextResponse.json({ error: 'Ученик не найден' }, { status: 404 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const [selectionsRes, textRes, contactRes, coverRes] = await Promise.all([
      supabaseAdmin.from('selections').select('photo_id, selection_type, photos(filename, storage_path, thumb_path)').eq('child_id', childId),
      supabaseAdmin.from('student_texts').select('text').eq('child_id', childId).maybeSingle(),
      supabaseAdmin.from('parent_contacts').select('parent_name, phone').eq('child_id', childId).maybeSingle(),
      supabaseAdmin.from('cover_selections').select('cover_option, surcharge').eq('child_id', childId).maybeSingle(),
    ])

    const selections = (selectionsRes.data ?? []).map((s: any) => ({
      type: s.selection_type,
      filename: s.photos?.filename ?? '',
      url: s.photos?.storage_path ? `${supabaseUrl}/storage/v1/object/public/photos/${s.photos.storage_path}` : '',
      thumb: s.photos?.thumb_path
        ? `${supabaseUrl}/storage/v1/object/public/photos/${s.photos.thumb_path}`
        : s.photos?.storage_path ? `${supabaseUrl}/storage/v1/object/public/photos/${s.photos.storage_path}?width=400&quality=70` : '',
    }))

    return NextResponse.json({
      selections,
      text: textRes.data?.text ?? '',
      contact: contactRes.data ?? null,
      cover: coverRes.data ?? null,
    })
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

  // ----------------------------------------------------------
  // leads — список реферальных заявок tenant'а
  // Возвращает заявки с именем реферера и названием альбома
  // (чтобы понять откуда пришла заявка).
  // ----------------------------------------------------------
  if (action === 'leads') {
    let query = supabaseAdmin
      .from('referral_leads')
      .select('id, name, phone, city, school, class_name, status, created_at, referrer_child_id')
      .order('created_at', { ascending: false })

    if (auth.role !== 'superadmin') {
      query = query.eq('tenant_id', auth.tenantId)
    }

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const childIds = Array.from(
      new Set((data ?? []).map((d: any) => d.referrer_child_id).filter(Boolean))
    )

    const [childrenRes, contactsRes] = childIds.length > 0
      ? await Promise.all([
          supabaseAdmin.from('children').select('id, full_name, album_id').in('id', childIds),
          supabaseAdmin.from('parent_contacts').select('child_id, parent_name').in('child_id', childIds),
        ])
      : [{ data: [] }, { data: [] }]

    const childMap = Object.fromEntries(
      (childrenRes.data ?? []).map((c: any) => [c.id, c])
    )
    const contactMap = Object.fromEntries(
      (contactsRes.data ?? []).map((c: any) => [c.child_id, c.parent_name])
    )

    const albumIds = Array.from(
      new Set((childrenRes.data ?? []).map((c: any) => c.album_id).filter(Boolean))
    )
    const { data: albums } = albumIds.length > 0
      ? await supabaseAdmin.from('albums').select('id, title').in('id', albumIds)
      : { data: [] }
    const albumMap = Object.fromEntries((albums ?? []).map((a: any) => [a.id, a.title]))

    const leads = (data ?? []).map((d: any) => ({
      ...d,
      referrer_name:
        contactMap[d.referrer_child_id] ||
        childMap[d.referrer_child_id]?.full_name ||
        '—',
      referrer_album: albumMap[childMap[d.referrer_child_id]?.album_id] || '',
    }))

    return NextResponse.json(leads)
  }

  // ----------------------------------------------------------
  // quotes — список цитат (свои tenant + глобальные)
  // Обогащено: use_count — сколько раз цитата была выбрана
  // детьми этого tenant'а (для статистики и для owner — прежде
  // чем удалять цитату, понятно, используют ли её).
  // is_global — флаг, чтобы UI отличал глобальные (read-only)
  // от собственных (editable).
  // ----------------------------------------------------------
  if (action === 'quotes') {
    const { data: quotes, error } = await supabaseAdmin
      .from('quotes')
      .select('id, text, category, tenant_id, created_at')
      .or(`tenant_id.is.null,tenant_id.eq.${auth.tenantId}`)
      .order('category')
      .order('created_at')

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Подсчёт use_count — через JOIN с albums по tenant_id,
    // чтобы считать только выборы из альбомов этого tenant'а
    const quoteIds = (quotes ?? []).map((q: any) => q.id)
    let useCountMap: Record<string, number> = {}

    if (quoteIds.length > 0) {
      let selQuery = supabaseAdmin
        .from('quote_selections')
        .select('quote_id, albums!inner(tenant_id)')
        .in('quote_id', quoteIds)

      if (auth.role !== 'superadmin') {
        selQuery = selQuery.eq('albums.tenant_id', auth.tenantId)
      }

      const { data: sels } = await selQuery
      for (const s of sels ?? []) {
        const qid = (s as any).quote_id
        useCountMap[qid] = (useCountMap[qid] ?? 0) + 1
      }
    }

    const result = (quotes ?? []).map((q: any) => ({
      id: q.id,
      text: q.text,
      category: q.category,
      is_global: q.tenant_id === null,
      created_at: q.created_at,
      use_count: useCountMap[q.id] ?? 0,
    }))

    return NextResponse.json(result)
  }

  // ----------------------------------------------------------
  // users — список сотрудников tenant'а (только owner и superadmin)
  // ----------------------------------------------------------
  if (action === 'users') {
    if (auth.role !== 'owner' && auth.role !== 'superadmin') {
      return NextResponse.json({ error: 'Только владелец может управлять командой' }, { status: 403 })
    }

    let query = supabaseAdmin
      .from('users')
      .select('id, email, full_name, role, is_active, last_login, created_at')
      .neq('role', 'superadmin') // superadmin'ов не показываем в списке команды
      .order('created_at')

    if (auth.role !== 'superadmin') {
      query = query.eq('tenant_id', auth.tenantId)
    }

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json(data ?? [])
  }

  // ----------------------------------------------------------
  // invitations — список активных (непринятых, не просроченных) приглашений
  // ----------------------------------------------------------
  if (action === 'invitations') {
    if (auth.role !== 'owner' && auth.role !== 'superadmin') {
      return NextResponse.json({ error: 'Только владелец может управлять командой' }, { status: 403 })
    }

    let query = supabaseAdmin
      .from('invitations')
      .select('id, email, role, token, expires_at, accepted_at, created_at, invited_by')
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })

    if (auth.role !== 'superadmin') {
      query = query.eq('tenant_id', auth.tenantId)
    }

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Подтягиваем имена пригласивших для UI
    const inviterIds = Array.from(
      new Set((data ?? []).map((i: any) => i.invited_by).filter(Boolean))
    )
    const { data: inviters } = inviterIds.length > 0
      ? await supabaseAdmin.from('users').select('id, full_name, email').in('id', inviterIds)
      : { data: [] }
    const inviterMap = Object.fromEntries(
      (inviters ?? []).map((u: any) => [u.id, u])
    )

    const result = (data ?? []).map((i: any) => ({
      ...i,
      invited_by_name: inviterMap[i.invited_by]?.full_name ?? inviterMap[i.invited_by]?.email ?? null,
    }))

    return NextResponse.json(result)
  }

  // ----------------------------------------------------------
  // tenant_settings — данные своего арендатора (для формы настроек)
  // Доступно всем ролям (viewer тоже может просматривать),
  // редактирование — только owner (update_tenant_settings).
  // ----------------------------------------------------------
  if (action === 'tenant_settings') {
    if (auth.role === 'superadmin') {
      return NextResponse.json({ error: 'Superadmin использует /super' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('tenants')
      .select('id, name, slug, logo_url, city, phone, email, plan, plan_expires, max_albums, max_storage_mb, settings, is_active, created_at')
      .eq('id', auth.tenantId)
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json(data)
  }

  // Совместим со старым /api/admin?action=export по ключевым колонкам:
  // Класс, Ученик, Портрет_страница, Обложка, Портрет_обложка, Текст,
  // Фото_друзья_1..10
  // Добавлены справа: Статус, Родитель, Телефон, Доплата
  // Учителя идут в конце после пустой строки-разделителя с Класс=УЧИТЕЛЬ
  // ----------------------------------------------------------
  if (action === 'export_csv' && albumId) {
    if (!(await assertAlbumAccess(auth, albumId))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    const { data: album } = await supabaseAdmin
      .from('albums')
      .select('title, city, year')
      .eq('id', albumId)
      .single()

    const { data: children } = await supabaseAdmin
      .from('children')
      .select('id, full_name, class, submitted_at, started_at')
      .eq('album_id', albumId)
      .order('class')
      .order('full_name')

    const ids = (children ?? []).map((c: any) => c.id)

    const [selectionsRes, contactsRes, textsRes, coversRes] = ids.length > 0
      ? await Promise.all([
          supabaseAdmin.from('selections').select('child_id, photo_id, selection_type, photos(filename)').in('child_id', ids),
          supabaseAdmin.from('parent_contacts').select('child_id, parent_name, phone').in('child_id', ids),
          supabaseAdmin.from('student_texts').select('child_id, text').in('child_id', ids),
          supabaseAdmin.from('cover_selections').select('child_id, cover_option, surcharge').in('child_id', ids),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }]

    const selMap: Record<string, any[]> = {}
    for (const s of selectionsRes.data ?? []) {
      if (!selMap[(s as any).child_id]) selMap[(s as any).child_id] = []
      selMap[(s as any).child_id].push(s)
    }
    const contactMap = Object.fromEntries((contactsRes.data ?? []).map((c: any) => [c.child_id, c]))
    const textMap = Object.fromEntries((textsRes.data ?? []).map((t: any) => [t.child_id, t.text]))
    const coverMap = Object.fromEntries((coversRes.data ?? []).map((c: any) => [c.child_id, c]))

    const statusLabel = (c: any): string => {
      if (c.submitted_at) return 'Завершил'
      if (c.started_at) return 'В процессе'
      return 'Не начал'
    }

    const rows = (children ?? []).map((c: any) => {
      const sels = selMap[c.id] ?? []
      const pp = sels.find((s: any) => s.selection_type === 'portrait_page')
      const pc = sels.find((s: any) => s.selection_type === 'portrait_cover')
      const gr = sels.filter((s: any) => s.selection_type === 'group')
      const cover = coverMap[c.id]
      const contact = contactMap[c.id]

      const grCols: Record<string, string> = {}
      for (let i = 0; i < 10; i++) {
        grCols[`Фото_друзья_${i + 1}`] = gr[i] ? (gr[i] as any).photos?.filename ?? '' : ''
      }

      return {
        Класс: c.class ?? '',
        Ученик: c.full_name ?? '',
        Портрет_страница: (pp as any)?.photos?.filename ?? '',
        Обложка: cover?.cover_option ?? 'none',
        Портрет_обложка: pc
          ? (pc as any).photos?.filename
          : (cover?.cover_option === 'same' ? (pp as any)?.photos?.filename ?? '' : ''),
        Текст: textMap[c.id] ?? '',
        ...grCols,
        Статус: statusLabel(c),
        Родитель: contact?.parent_name ?? '',
        Телефон: contact?.phone ?? '',
        Доплата: cover?.surcharge ? String(cover.surcharge) : '',
      }
    })

    // Учителя
    const { data: teachers } = await supabaseAdmin
      .from('teachers')
      .select('id, full_name, position, description')
      .eq('album_id', albumId)
      .order('created_at')

    const teacherIds = (teachers ?? []).map((t: any) => t.id)
    const { data: photoLinks } = teacherIds.length > 0
      ? await supabaseAdmin
          .from('photo_teachers')
          .select('teacher_id, photos(filename)')
          .in('teacher_id', teacherIds)
      : { data: [] }

    const photoByTeacher: Record<string, any> = {}
    for (const link of photoLinks ?? []) {
      photoByTeacher[(link as any).teacher_id] = (link as any).photos
    }

    const teacherRows = (teachers ?? []).map((t: any) => {
      const photo = photoByTeacher[t.id]
      const grTeacherCols: Record<string, string> = {}
      for (let i = 0; i < 10; i++) { grTeacherCols[`Фото_друзья_${i + 1}`] = '' }
      return {
        Класс: 'УЧИТЕЛЬ',
        Ученик: t.full_name ?? '',
        Портрет_страница: photo?.filename ?? '',
        Обложка: t.position ?? '',
        Портрет_обложка: '',
        Текст: t.description ?? '',
        ...grTeacherCols,
        Статус: photo ? 'Заполнено' : 'Ожидание',
        Родитель: '',
        Телефон: '',
        Доплата: '',
      }
    })

    const allRows = [
      ...rows,
      ...(teacherRows.length > 0 ? [null as any, ...teacherRows] : []),
    ]

    const headers = Object.keys(rows[0] ?? teacherRows[0] ?? {})
    if (headers.length === 0) {
      return NextResponse.json({ error: 'Альбом пуст — нечего экспортировать' }, { status: 400 })
    }

    // META-строка для скрипта автовёрстки InDesign
    // Формат: META,город,название школы,год,,,... (пустые колонки до конца)
    const metaCols = ['META', (album as any)?.city ?? '', (album as any)?.title ?? '', String((album as any)?.year ?? '')]
    while (metaCols.length < headers.length) metaCols.push('')
    const metaRow = metaCols.map(v => `"${v.replace(/"/g, '""')}"`).join(',')

    const csv = [
      metaRow,
      headers.join(','),
      ...allRows.map(r =>
        r === null
          ? headers.map(() => '""').join(',')
          : headers.map(h => `"${String((r as any)[h] ?? '').replace(/"/g, '""')}"`).join(',')
      ),
    ].join('\n')

    // Имя файла: title-city-year.csv, со слагификацией
    const slugify = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9а-яё\s-]/gi, '')
        .trim()
        .replace(/\s+/g, '-')
        .slice(0, 60)

    const parts = [
      slugify((album as any)?.title ?? 'album'),
      (album as any)?.city ? slugify((album as any).city) : '',
      (album as any)?.year ? String((album as any).year) : '',
    ].filter(Boolean)
    const filename = parts.join('-') + '.csv'

    await logAction(auth, 'album.export_csv', 'album', albumId, {
      rows: rows.length,
      teachers: teacherRows.length,
    })

    return new NextResponse('\uFEFF' + csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      },
    })
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
  // multipart/form-data — загрузка файлов
  // Разветвление по action-полю формы:
  //   upload_photo (default) — фото альбома
  //   upload_logo — логотип tenant'а
  // ============================================================
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData()
    const formAction = (form.get('action') as string | null) ?? 'upload_photo'

    // ----------------------------------------------------------
    // upload_logo — логотип tenant'а (только owner)
    // Формат: file
    // Делает WebP 256x256 (fit=cover, attention), кладёт в
    // photos/tenants/<tenant_id>/logo.webp, перезаписывает старый,
    // сохраняет путь в tenants.logo_url.
    // ----------------------------------------------------------
    if (formAction === 'upload_logo') {
      if (auth.role !== 'owner' && auth.role !== 'superadmin') {
        return NextResponse.json(
          { error: 'Только владелец может менять логотип' },
          { status: 403 }
        )
      }

      const file = form.get('file') as File | null
      if (!file) {
        return NextResponse.json({ error: 'Файл обязателен' }, { status: 400 })
      }
      if (file.size > 5 * 1024 * 1024) {
        return NextResponse.json(
          { error: 'Размер файла не должен превышать 5 МБ' },
          { status: 400 }
        )
      }

      const sharp = (await import('sharp')).default
      const buffer = Buffer.from(await file.arrayBuffer())

      let processed: Buffer
      try {
        processed = await sharp(buffer)
          .rotate()
          .resize(256, 256, { fit: 'cover', position: 'attention' })
          .webp({ quality: 90 })
          .toBuffer()
      } catch {
        return NextResponse.json({ error: 'Не удалось обработать изображение' }, { status: 400 })
      }

      const logoPath = `tenants/${auth.tenantId}/logo.webp`

      // Старый путь может отличаться (если раньше был с timestamp или другим расширением)
      const { data: currentTenant } = await supabaseAdmin
        .from('tenants')
        .select('logo_url')
        .eq('id', auth.tenantId)
        .single()
      const oldPath = (currentTenant as any)?.logo_url
      if (oldPath && oldPath !== logoPath) {
        await supabaseAdmin.storage.from('photos').remove([oldPath])
      }

      // upsert=true, чтобы перезаписывать
      const { error: upErr } = await supabaseAdmin.storage
        .from('photos')
        .upload(logoPath, processed, {
          contentType: 'image/webp',
          upsert: true,
        })

      if (upErr) {
        return NextResponse.json({ error: upErr.message }, { status: 500 })
      }

      const { error: dbErr } = await supabaseAdmin
        .from('tenants')
        .update({ logo_url: logoPath })
        .eq('id', auth.tenantId)

      if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 })

      // Public URL (обходим кэш CDN с timestamp'ом, чтобы UI сразу увидел новый логотип)
      const publicUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/photos/${logoPath}?t=${Date.now()}`

      await logAction(auth, 'tenant.upload_logo', 'tenant', auth.tenantId, {
        size: file.size,
      })

      return NextResponse.json({ ok: true, logo_url: logoPath, public_url: publicUrl })
    }

    // ----------------------------------------------------------
    // upload_photo (default multipart action) — фото альбома
    // Формат: file, type (portrait|group|teacher), album_id
    // Делает WebP full (2048px) + thumb (400px) через sharp,
    // заливает оба в Storage, создаёт запись в photos.
    // ----------------------------------------------------------
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
      'classes', 'template_title',
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
  // delete_album — полное удаление альбома (необратимо)
  // ----------------------------------------------------------
  if (body.action === 'delete_album') {
    const { album_id } = body
    if (!album_id) {
      return NextResponse.json({ error: 'album_id обязателен' }, { status: 400 })
    }

    if (!(await assertAlbumAccess(auth, album_id))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    // 1. Удаляем файлы фото из Storage
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
      for (let i = 0; i < paths.length; i += 100) {
        await supabaseAdmin.storage.from('photos').remove(paths.slice(i, i + 100))
      }
    }

    // 2. Удаляем связанные записи (явно, без CASCADE через PostgREST)
    await supabaseAdmin.from('photos').delete().eq('album_id', album_id)
    await supabaseAdmin.from('children').delete().eq('album_id', album_id)
    await supabaseAdmin.from('teachers').delete().eq('album_id', album_id)
    await supabaseAdmin.from('responsible_parents').delete().eq('album_id', album_id)

    // 3. Удаляем сам альбом
    const { error } = await supabaseAdmin
      .from('albums')
      .delete()
      .eq('id', album_id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logAction(auth, 'album.delete', 'album', album_id, {
      photos_deleted: photos?.length ?? 0,
    })

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

  // ----------------------------------------------------------
  // update_lead_status — обновить статус заявки
  // Статусы: new / in_progress / done / rejected
  // ----------------------------------------------------------
  if (body.action === 'update_lead_status') {
    const { id, status } = body
    if (!id || !status) {
      return NextResponse.json({ error: 'id и status обязательны' }, { status: 400 })
    }

    const ALLOWED = ['new', 'in_progress', 'done', 'rejected']
    if (!ALLOWED.includes(status)) {
      return NextResponse.json({ error: 'Неверный статус' }, { status: 400 })
    }

    // Проверка, что заявка принадлежит tenant'у
    if (auth.role !== 'superadmin') {
      const { data: lead } = await supabaseAdmin
        .from('referral_leads')
        .select('tenant_id')
        .eq('id', id)
        .single()
      if (!lead || (lead as any).tenant_id !== auth.tenantId) {
        return NextResponse.json({ error: 'Заявка не найдена' }, { status: 404 })
      }
    }

    const { error } = await supabaseAdmin
      .from('referral_leads')
      .update({ status })
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await logAction(auth, 'lead.update_status', 'lead', id, { status })

    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------
  // delete_lead — удалить заявку
  // ----------------------------------------------------------
  if (body.action === 'delete_lead') {
    const { id } = body
    if (!id) {
      return NextResponse.json({ error: 'id обязателен' }, { status: 400 })
    }

    if (auth.role !== 'superadmin') {
      const { data: lead } = await supabaseAdmin
        .from('referral_leads')
        .select('tenant_id')
        .eq('id', id)
        .single()
      if (!lead || (lead as any).tenant_id !== auth.tenantId) {
        return NextResponse.json({ error: 'Заявка не найдена' }, { status: 404 })
      }
    }

    const { error } = await supabaseAdmin
      .from('referral_leads')
      .delete()
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await logAction(auth, 'lead.delete', 'lead', id)

    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------
  // invite_user — создать приглашение нового сотрудника
  // Только для owner. Возвращает ссылку приглашения.
  // ----------------------------------------------------------
  if (body.action === 'invite_user') {
    if (auth.role !== 'owner' && auth.role !== 'superadmin') {
      return NextResponse.json({ error: 'Только владелец может приглашать сотрудников' }, { status: 403 })
    }

    const email = (body.email ?? '').toString().toLowerCase().trim()
    const role = (body.role ?? 'manager').toString().trim()

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Введите корректный email' }, { status: 400 })
    }

    const ALLOWED_ROLES = ['owner', 'manager', 'viewer']
    if (!ALLOWED_ROLES.includes(role)) {
      return NextResponse.json({ error: 'Неверная роль' }, { status: 400 })
    }

    // Проверим, нет ли уже такого пользователя в этом tenant'е
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('tenant_id', auth.tenantId)
      .eq('email', email)
      .maybeSingle()

    if (existingUser) {
      return NextResponse.json(
        { error: 'Пользователь с таким email уже есть в вашей команде' },
        { status: 409 }
      )
    }

    // Есть ли активное приглашение на этот email?
    const { data: existingInvite } = await supabaseAdmin
      .from('invitations')
      .select('id, token, expires_at')
      .eq('tenant_id', auth.tenantId)
      .eq('email', email)
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()

    if (existingInvite) {
      return NextResponse.json(
        {
          error: 'На этот email уже есть активное приглашение',
          token: (existingInvite as any).token,
          existing: true,
        },
        { status: 409 }
      )
    }

    // Создаём приглашение. Token и expires_at генерирует БД (default'ы).
    const { data: invitation, error } = await supabaseAdmin
      .from('invitations')
      .insert({
        tenant_id: auth.tenantId,
        email,
        role,
        invited_by: auth.userId,
      })
      .select('id, email, role, token, expires_at, created_at')
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await logAction(auth, 'user.invite', 'invitation', (invitation as any).id, {
      email,
      role,
    })

    return NextResponse.json(invitation)
  }

  // ----------------------------------------------------------
  // revoke_invitation — отозвать активное приглашение
  // ----------------------------------------------------------
  if (body.action === 'revoke_invitation') {
    if (auth.role !== 'owner' && auth.role !== 'superadmin') {
      return NextResponse.json({ error: 'Только владелец может отзывать приглашения' }, { status: 403 })
    }

    const { id } = body
    if (!id) {
      return NextResponse.json({ error: 'id обязателен' }, { status: 400 })
    }

    // Проверка владения
    if (auth.role !== 'superadmin') {
      const { data: inv } = await supabaseAdmin
        .from('invitations')
        .select('tenant_id')
        .eq('id', id)
        .single()
      if (!inv || (inv as any).tenant_id !== auth.tenantId) {
        return NextResponse.json({ error: 'Приглашение не найдено' }, { status: 404 })
      }
    }

    const { error } = await supabaseAdmin
      .from('invitations')
      .delete()
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await logAction(auth, 'user.revoke_invitation', 'invitation', id)

    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------
  // remove_user — удалить/отключить сотрудника
  // Нельзя удалить себя. Нельзя удалить последнего owner'а.
  // Действие — hard delete (вместе с сессиями), т.к. users внутри tenant'а
  // немного. Если передать soft=true — только is_active=false.
  // ----------------------------------------------------------
  if (body.action === 'remove_user') {
    if (auth.role !== 'owner' && auth.role !== 'superadmin') {
      return NextResponse.json({ error: 'Только владелец может удалять сотрудников' }, { status: 403 })
    }

    const { user_id, soft } = body
    if (!user_id) {
      return NextResponse.json({ error: 'user_id обязателен' }, { status: 400 })
    }

    if (user_id === auth.userId) {
      return NextResponse.json({ error: 'Нельзя удалить самого себя' }, { status: 400 })
    }

    // Проверка принадлежности tenant'у
    const { data: target } = await supabaseAdmin
      .from('users')
      .select('tenant_id, role, full_name, email')
      .eq('id', user_id)
      .single()

    if (!target) {
      return NextResponse.json({ error: 'Пользователь не найден' }, { status: 404 })
    }
    if ((target as any).role === 'superadmin') {
      return NextResponse.json({ error: 'Нельзя удалить superadmin' }, { status: 403 })
    }
    if (auth.role !== 'superadmin' && (target as any).tenant_id !== auth.tenantId) {
      return NextResponse.json({ error: 'Пользователь не найден' }, { status: 404 })
    }

    // Защита от удаления последнего owner'а
    if ((target as any).role === 'owner') {
      const { count: ownersCount } = await supabaseAdmin
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', (target as any).tenant_id)
        .eq('role', 'owner')
        .eq('is_active', true)

      if ((ownersCount ?? 0) <= 1) {
        return NextResponse.json(
          { error: 'Нельзя удалить последнего владельца. Сначала назначьте другого owner.' },
          { status: 400 }
        )
      }
    }

    if (soft) {
      const { error } = await supabaseAdmin
        .from('users')
        .update({ is_active: false })
        .eq('id', user_id)

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    } else {
      // Hard delete — явно сносим связанные данные
      await supabaseAdmin.from('sessions').delete().eq('user_id', user_id)
      // Приглашения invited_by ON DELETE SET NULL — не трогаем
      const { error } = await supabaseAdmin
        .from('users')
        .delete()
        .eq('id', user_id)

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logAction(auth, soft ? 'user.deactivate' : 'user.delete', 'user', user_id, {
      full_name: (target as any).full_name,
      email: (target as any).email,
      role: (target as any).role,
    })

    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------
  // change_role — сменить роль сотрудника
  // Нельзя сменить свою собственную роль.
  // Нельзя оставить tenant без owner'ов.
  // ----------------------------------------------------------
  if (body.action === 'change_role') {
    if (auth.role !== 'owner' && auth.role !== 'superadmin') {
      return NextResponse.json({ error: 'Только владелец может менять роли' }, { status: 403 })
    }

    const { user_id, role } = body
    if (!user_id || !role) {
      return NextResponse.json({ error: 'user_id и role обязательны' }, { status: 400 })
    }

    const ALLOWED = ['owner', 'manager', 'viewer']
    if (!ALLOWED.includes(role)) {
      return NextResponse.json({ error: 'Неверная роль' }, { status: 400 })
    }

    if (user_id === auth.userId) {
      return NextResponse.json(
        { error: 'Нельзя сменить свою собственную роль' },
        { status: 400 }
      )
    }

    const { data: target } = await supabaseAdmin
      .from('users')
      .select('tenant_id, role')
      .eq('id', user_id)
      .single()

    if (!target) {
      return NextResponse.json({ error: 'Пользователь не найден' }, { status: 404 })
    }
    if ((target as any).role === 'superadmin') {
      return NextResponse.json({ error: 'Роль superadmin нельзя менять' }, { status: 403 })
    }
    if (auth.role !== 'superadmin' && (target as any).tenant_id !== auth.tenantId) {
      return NextResponse.json({ error: 'Пользователь не найден' }, { status: 404 })
    }

    if ((target as any).role === role) {
      return NextResponse.json({ ok: true, unchanged: true })
    }

    // Если понижаем последнего owner'а — блокируем
    if ((target as any).role === 'owner' && role !== 'owner') {
      const { count: ownersCount } = await supabaseAdmin
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', (target as any).tenant_id)
        .eq('role', 'owner')
        .eq('is_active', true)

      if ((ownersCount ?? 0) <= 1) {
        return NextResponse.json(
          { error: 'Нельзя понизить последнего владельца. Сначала назначьте другого owner.' },
          { status: 400 }
        )
      }
    }

    const { error } = await supabaseAdmin
      .from('users')
      .update({ role })
      .eq('id', user_id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await logAction(auth, 'user.change_role', 'user', user_id, {
      from: (target as any).role,
      to: role,
    })

    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------
  // update_tenant_settings — обновить базовые настройки tenant'а
  // Только для owner. Обновляемые поля: name, city, phone, email.
  // Логотип, брендинг, план, лимиты — НЕ здесь (логотип в 3.5.b,
  // план и лимиты меняет только superadmin через /super).
  // ----------------------------------------------------------
  if (body.action === 'update_tenant_settings') {
    if (auth.role !== 'owner' && auth.role !== 'superadmin') {
      return NextResponse.json({ error: 'Только владелец может менять настройки' }, { status: 403 })
    }

    const update: Record<string, any> = {}

    if (body.name !== undefined) {
      const name = body.name.toString().trim()
      if (!name) {
        return NextResponse.json({ error: 'Название не может быть пустым' }, { status: 400 })
      }
      if (name.length > 100) {
        return NextResponse.json({ error: 'Название слишком длинное (макс. 100 символов)' }, { status: 400 })
      }
      update.name = name
    }

    if (body.city !== undefined) {
      update.city = body.city ? body.city.toString().trim() : null
    }

    if (body.phone !== undefined) {
      update.phone = body.phone ? body.phone.toString().trim() : null
    }

    if (body.email !== undefined) {
      const email = body.email ? body.email.toString().trim().toLowerCase() : null
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json({ error: 'Неверный формат email' }, { status: 400 })
      }
      update.email = email
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ ok: true, unchanged: true })
    }

    const { error } = await supabaseAdmin
      .from('tenants')
      .update(update)
      .eq('id', auth.tenantId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await logAction(auth, 'tenant.update_settings', 'tenant', auth.tenantId, {
      fields: Object.keys(update),
    })

    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------
  // change_password — смена пароля текущего пользователя
  // Доступно всем ролям (owner, manager, viewer).
  // Требует текущий пароль для подтверждения.
  // ----------------------------------------------------------
  if (body.action === 'change_password') {
    if (!auth.userId) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
    }

    const current = (body.current_password ?? '').toString()
    const next = (body.new_password ?? '').toString()

    if (!current || !next) {
      return NextResponse.json({ error: 'Укажите текущий и новый пароль' }, { status: 400 })
    }
    if (next.length < 8) {
      return NextResponse.json({ error: 'Новый пароль должен быть не короче 8 символов' }, { status: 400 })
    }
    if (next === current) {
      return NextResponse.json({ error: 'Новый пароль совпадает с текущим' }, { status: 400 })
    }

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, password_hash')
      .eq('id', auth.userId)
      .single()

    if (!user) {
      return NextResponse.json({ error: 'Пользователь не найден' }, { status: 404 })
    }

    const valid = await verifyPassword(current, (user as any).password_hash)
    if (!valid) {
      return NextResponse.json({ error: 'Неверный текущий пароль' }, { status: 401 })
    }

    const newHash = await hashPassword(next)

    const { error } = await supabaseAdmin
      .from('users')
      .update({ password_hash: newHash })
      .eq('id', auth.userId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Выкидываем все остальные сессии (кроме текущей —
    // чтобы не разлогинить пользователя, который только что сменил пароль).
    // Упрощение: выкидываем все, пользователь заново залогинится
    // на всех устройствах. Это безопаснее.
    await supabaseAdmin.from('sessions').delete().eq('user_id', auth.userId)

    await logAction(auth, 'user.change_password', 'user', auth.userId)

    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------
  // update_branding — обновить брендинг tenant'а
  // Только для owner. Хранит:
  //   tenants.logo_url — в колонке (строка)
  //   tenants.settings — JSONB с ключами:
  //     brand_color — hex-цвет (#rrggbb)
  //     welcome_text — текст приветствия для родителей
  //     footer_text — подпись в письмах
  // ----------------------------------------------------------
  if (body.action === 'update_branding') {
    if (auth.role !== 'owner' && auth.role !== 'superadmin') {
      return NextResponse.json({ error: 'Только владелец может менять брендинг' }, { status: 403 })
    }

    // Сначала читаем текущие settings чтобы мержить
    const { data: current } = await supabaseAdmin
      .from('tenants')
      .select('settings')
      .eq('id', auth.tenantId)
      .single()

    const existingSettings = ((current as any)?.settings ?? {}) as Record<string, any>
    const newSettings = { ...existingSettings }

    // brand_color — hex-цвет
    if (body.brand_color !== undefined) {
      const color = body.brand_color ? body.brand_color.toString().trim() : ''
      if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
        return NextResponse.json(
          { error: 'Цвет должен быть в формате #RRGGBB' },
          { status: 400 }
        )
      }
      if (color) {
        newSettings.brand_color = color.toLowerCase()
      } else {
        delete newSettings.brand_color
      }
    }

    // welcome_text
    if (body.welcome_text !== undefined) {
      const text = body.welcome_text ? body.welcome_text.toString() : ''
      if (text.length > 1000) {
        return NextResponse.json(
          { error: 'Текст приветствия слишком длинный (макс. 1000 символов)' },
          { status: 400 }
        )
      }
      if (text.trim()) {
        newSettings.welcome_text = text
      } else {
        delete newSettings.welcome_text
      }
    }

    // footer_text
    if (body.footer_text !== undefined) {
      const text = body.footer_text ? body.footer_text.toString() : ''
      if (text.length > 500) {
        return NextResponse.json(
          { error: 'Подпись слишком длинная (макс. 500 символов)' },
          { status: 400 }
        )
      }
      if (text.trim()) {
        newSettings.footer_text = text
      } else {
        delete newSettings.footer_text
      }
    }

    const update: Record<string, any> = { settings: newSettings }

    // Удаление логотипа — передают logo_url: null
    if (body.logo_url === null) {
      // Читаем текущий logo_url чтобы удалить файл
      const { data: tenantRow } = await supabaseAdmin
        .from('tenants')
        .select('logo_url')
        .eq('id', auth.tenantId)
        .single()
      const oldPath = (tenantRow as any)?.logo_url
      if (oldPath) {
        // oldPath — это путь в bucket'е photos, удаляем файл
        await supabaseAdmin.storage.from('photos').remove([oldPath])
      }
      update.logo_url = null
    }

    const { error } = await supabaseAdmin
      .from('tenants')
      .update(update)
      .eq('id', auth.tenantId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await logAction(auth, 'tenant.update_branding', 'tenant', auth.tenantId, {
      fields: Object.keys(body).filter(k => k !== 'action'),
    })

    return NextResponse.json({ ok: true, settings: newSettings })
  }

  // ----------------------------------------------------------
  // create_quote — создать свою цитату
  // ----------------------------------------------------------
  if (body.action === 'create_quote') {
    const text = (body.text ?? '').toString().trim()
    const category = (body.category ?? 'general').toString().trim() || 'general'

    if (!text) {
      return NextResponse.json({ error: 'Текст цитаты обязателен' }, { status: 400 })
    }
    if (text.length > 500) {
      return NextResponse.json({ error: 'Цитата слишком длинная (макс. 500 символов)' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('quotes')
      .insert({
        tenant_id: auth.tenantId,
        text,
        category,
      })
      .select('id, text, category, tenant_id, created_at')
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await logAction(auth, 'quote.create', 'quote', (data as any).id, { category })

    return NextResponse.json({
      id: (data as any).id,
      text: (data as any).text,
      category: (data as any).category,
      is_global: false,
      created_at: (data as any).created_at,
      use_count: 0,
    })
  }

  // ----------------------------------------------------------
  // update_quote — обновить свою цитату
  // Глобальные цитаты (tenant_id=null) редактировать нельзя.
  // ----------------------------------------------------------
  if (body.action === 'update_quote') {
    const { id } = body
    const text = (body.text ?? '').toString().trim()
    const category = (body.category ?? 'general').toString().trim() || 'general'

    if (!id) {
      return NextResponse.json({ error: 'id обязателен' }, { status: 400 })
    }
    if (!text) {
      return NextResponse.json({ error: 'Текст цитаты обязателен' }, { status: 400 })
    }
    if (text.length > 500) {
      return NextResponse.json({ error: 'Цитата слишком длинная (макс. 500 символов)' }, { status: 400 })
    }

    // Проверяем владение
    const { data: existing } = await supabaseAdmin
      .from('quotes')
      .select('tenant_id')
      .eq('id', id)
      .single()

    if (!existing) {
      return NextResponse.json({ error: 'Цитата не найдена' }, { status: 404 })
    }
    if ((existing as any).tenant_id === null) {
      return NextResponse.json({ error: 'Глобальные цитаты нельзя редактировать' }, { status: 403 })
    }
    if (auth.role !== 'superadmin' && (existing as any).tenant_id !== auth.tenantId) {
      return NextResponse.json({ error: 'Цитата не найдена' }, { status: 404 })
    }

    const { error } = await supabaseAdmin
      .from('quotes')
      .update({ text, category })
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await logAction(auth, 'quote.update', 'quote', id, { category })

    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------
  // delete_quote — удалить свою цитату
  // Глобальные цитаты удалить нельзя через /api/tenant.
  // Если цитата уже выбрана детьми — возвращаем 409 с use_count.
  // ----------------------------------------------------------
  if (body.action === 'delete_quote') {
    const { id, force } = body
    if (!id) {
      return NextResponse.json({ error: 'id обязателен' }, { status: 400 })
    }

    const { data: existing } = await supabaseAdmin
      .from('quotes')
      .select('tenant_id')
      .eq('id', id)
      .single()

    if (!existing) {
      return NextResponse.json({ error: 'Цитата не найдена' }, { status: 404 })
    }
    if ((existing as any).tenant_id === null) {
      return NextResponse.json({ error: 'Глобальные цитаты нельзя удалять' }, { status: 403 })
    }
    if (auth.role !== 'superadmin' && (existing as any).tenant_id !== auth.tenantId) {
      return NextResponse.json({ error: 'Цитата не найдена' }, { status: 404 })
    }

    // Проверим, выбрана ли цитата где-то
    const { count: useCount } = await supabaseAdmin
      .from('quote_selections')
      .select('id', { count: 'exact', head: true })
      .eq('quote_id', id)

    if ((useCount ?? 0) > 0 && !force) {
      return NextResponse.json(
        {
          error: `Цитата уже выбрана ${useCount} учениками. Передайте force=true для принудительного удаления — у них выбор сбросится.`,
          use_count: useCount,
          requires_force: true,
        },
        { status: 409 }
      )
    }

    // force=true → удаляем selections каскадно
    if ((useCount ?? 0) > 0) {
      await supabaseAdmin.from('quote_selections').delete().eq('quote_id', id)
    }

    const { error } = await supabaseAdmin
      .from('quotes')
      .delete()
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await logAction(auth, 'quote.delete', 'quote', id, {
      had_selections: useCount ?? 0,
      force: !!force,
    })

    return NextResponse.json({ ok: true, reset_selections: useCount ?? 0 })
  }

  return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
}
