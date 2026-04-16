import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth, isAuthError, type AuthContext } from '@/lib/auth'

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

  return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
}
