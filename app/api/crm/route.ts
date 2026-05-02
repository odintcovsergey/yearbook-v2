import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth, isAuthError, logAction, type AuthContext } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Дефолтные этапы воронки — создаются при первом обращении
const DEFAULT_STAGES = [
  { name: 'Лид',        color: '#9ca3af', sort_order: 0, is_closed: false },
  { name: 'Переговоры', color: '#3b82f6', sort_order: 1, is_closed: false },
  { name: 'Договор',    color: '#8b5cf6', sort_order: 2, is_closed: false },
  { name: 'Съёмка',     color: '#f97316', sort_order: 3, is_closed: false },
  { name: 'Отбор фото', color: '#eab308', sort_order: 4, is_closed: false },
  { name: 'Верстка',    color: '#6366f1', sort_order: 5, is_closed: false },
  { name: 'Готово',     color: '#22c55e', sort_order: 6, is_closed: false },
  { name: 'Закрыто',    color: '#6b7280', sort_order: 7, is_closed: true  },
]

// Убедиться что у tenant'а есть этапы воронки
async function ensureStages(tenantId: string): Promise<void> {
  const { count } = await supabaseAdmin
    .from('deal_stages')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
  if ((count ?? 0) === 0) {
    await supabaseAdmin.from('deal_stages').insert(
      DEFAULT_STAGES.map(s => ({ ...s, tenant_id: tenantId }))
    )
  }
}

// Проверка владения записью
async function assertOwns(
  table: string,
  id: string,
  tenantId: string
): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from(table)
    .select('tenant_id')
    .eq('id', id)
    .single()
  return data?.tenant_id === tenantId
}

// ============================================================
// GET
// ============================================================
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, ['owner', 'manager', 'viewer'])
  if (isAuthError(auth)) return auth

  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')
  const tid = auth.tenantId

  // ── clients ──────────────────────────────────────────────
  if (action === 'clients') {
    const { data, error } = await supabaseAdmin
      .from('clients')
      .select('*')
      .eq('tenant_id', tid)
      .order('name')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ clients: data })
  }

  // ── client_detail (клиент + контакты + сделки + альбомы) ──
  if (action === 'client_detail') {
    const clientId = searchParams.get('id')
    if (!clientId) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const [clientRes, contactsRes, dealsRes] = await Promise.all([
      supabaseAdmin.from('clients').select('*').eq('id', clientId).eq('tenant_id', tid).single(),
      supabaseAdmin.from('contacts').select('*').eq('client_id', clientId).eq('tenant_id', tid).order('full_name'),
      supabaseAdmin.from('deals')
        .select('*, deal_stages(name, color), albums(title, city, year)')
        .eq('client_id', clientId).eq('tenant_id', tid).order('created_at', { ascending: false }),
    ])
    if (clientRes.error) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return NextResponse.json({
      client: clientRes.data,
      contacts: contactsRes.data ?? [],
      deals: dealsRes.data ?? [],
    })
  }

  // ── stages ───────────────────────────────────────────────
  if (action === 'stages') {
    await ensureStages(tid)
    const { data, error } = await supabaseAdmin
      .from('deal_stages')
      .select('*')
      .eq('tenant_id', tid)
      .order('sort_order')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ stages: data })
  }

  // ── deals (канбан — все сделки + вложения) ───────────────
  if (action === 'deals') {
    await ensureStages(tid)
    const { data, error } = await supabaseAdmin
      .from('deals')
      .select('*, deal_stages(name, color), clients(name, city), albums(title, city, year)')
      .eq('tenant_id', tid)
      .order('created_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ deals: data })
  }

  // ── tasks ─────────────────────────────────────────────────
  if (action === 'tasks') {
    const { data, error } = await supabaseAdmin
      .from('tasks')
      .select('*, deals(title), clients(name)')
      .eq('tenant_id', tid)
      .is('completed_at', null)
      .order('due_date', { nullsFirst: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ tasks: data })
  }

  // ── albums_list (для привязки сделки к альбому) ───────────
  if (action === 'albums_list') {
    const { data, error } = await supabaseAdmin
      .from('albums')
      .select('id, title, city, year')
      .eq('tenant_id', tid)
      .eq('archived', false)
      .order('title')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ albums: data })
  }

  // ── team_members (для назначения задач/сделок) ────────────
  if (action === 'team_members') {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, full_name, role')
      .eq('tenant_id', tid)
      .eq('is_active', true)
      .neq('role', 'superadmin')
      .order('full_name')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ members: data })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}

// ============================================================
// POST
// ============================================================
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req, ['owner', 'manager'])
  if (isAuthError(auth)) return auth

  const body = await req.json()
  const { action } = body
  const tid = auth.tenantId

  // ── create_client ─────────────────────────────────────────
  if (action === 'create_client') {
    const { name, city, address, website, notes, tags } = body
    if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })
    const { data, error } = await supabaseAdmin
      .from('clients')
      .insert({ tenant_id: tid, name: name.trim(), city, address, website, notes, tags: tags ?? [] })
      .select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await logAction(auth, 'crm.create_client', 'client', data.id, { name })
    return NextResponse.json({ client: data })
  }

  // ── update_client ─────────────────────────────────────────
  if (action === 'update_client') {
    const { id, name, city, address, website, notes, tags } = body
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    if (!await assertOwns('clients', id, tid)) return NextResponse.json({ error: 'not found' }, { status: 404 })
    const { data, error } = await supabaseAdmin
      .from('clients').update({ name, city, address, website, notes, tags }).eq('id', id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ client: data })
  }

  // ── delete_client ─────────────────────────────────────────
  if (action === 'delete_client') {
    const { id } = body
    if (!await assertOwns('clients', id, tid)) return NextResponse.json({ error: 'not found' }, { status: 404 })
    // Обнуляем client_id в deals/contacts вместо cascade
    await supabaseAdmin.from('deals').update({ client_id: null }).eq('client_id', id).eq('tenant_id', tid)
    await supabaseAdmin.from('contacts').update({ client_id: null }).eq('client_id', id).eq('tenant_id', tid)
    const { error } = await supabaseAdmin.from('clients').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await logAction(auth, 'crm.delete_client', 'client', id, {})
    return NextResponse.json({ ok: true })
  }

  // ── create_contact ────────────────────────────────────────
  if (action === 'create_contact') {
    const { full_name, client_id, role, phone, email, notes, birthday } = body
    if (!full_name?.trim()) return NextResponse.json({ error: 'full_name required' }, { status: 400 })
    const { data, error } = await supabaseAdmin
      .from('contacts')
      .insert({ tenant_id: tid, full_name: full_name.trim(), client_id: client_id || null, role, phone, email, notes, birthday: birthday || null })
      .select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ contact: data })
  }

  // ── update_contact ────────────────────────────────────────
  if (action === 'update_contact') {
    const { id, full_name, role, phone, email, notes, birthday } = body
    if (!await assertOwns('contacts', id, tid)) return NextResponse.json({ error: 'not found' }, { status: 404 })
    const { data, error } = await supabaseAdmin
      .from('contacts').update({ full_name, role, phone, email, notes, birthday: birthday || null }).eq('id', id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ contact: data })
  }

  // ── delete_contact ────────────────────────────────────────
  if (action === 'delete_contact') {
    const { id } = body
    if (!await assertOwns('contacts', id, tid)) return NextResponse.json({ error: 'not found' }, { status: 404 })
    const { error } = await supabaseAdmin.from('contacts').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // ── create_deal ───────────────────────────────────────────
  if (action === 'create_deal') {
    const { title, client_id, stage_id, album_id, amount, deadline, assigned_to, notes } = body
    if (!title?.trim()) return NextResponse.json({ error: 'title required' }, { status: 400 })
    if (!stage_id) return NextResponse.json({ error: 'stage_id required' }, { status: 400 })
    const { data, error } = await supabaseAdmin
      .from('deals')
      .insert({
        tenant_id: tid, title: title.trim(),
        client_id: client_id || null, stage_id,
        album_id: album_id || null,
        amount: amount || null, deadline: deadline || null,
        assigned_to: assigned_to || null, notes,
      })
      .select('*, deal_stages(name, color), clients(name, city), albums(title, city, year)')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await logAction(auth, 'crm.create_deal', 'deal', data.id, { title })
    return NextResponse.json({ deal: data })
  }

  // ── update_deal ───────────────────────────────────────────
  if (action === 'update_deal') {
    const { id, title, client_id, stage_id, album_id, amount, deadline, assigned_to, notes } = body
    if (!await assertOwns('deals', id, tid)) return NextResponse.json({ error: 'not found' }, { status: 404 })
    const update: Record<string, unknown> = { title, stage_id, amount: amount || null, deadline: deadline || null, assigned_to: assigned_to || null, notes }
    if (client_id !== undefined) update.client_id = client_id || null
    if (album_id !== undefined) update.album_id = album_id || null
    // Если переводим в закрытый этап — ставим closed_at
    const { data: stage } = await supabaseAdmin.from('deal_stages').select('is_closed').eq('id', stage_id).single()
    if (stage?.is_closed) update.closed_at = new Date().toISOString()
    else update.closed_at = null
    const { data, error } = await supabaseAdmin
      .from('deals').update(update).eq('id', id)
      .select('*, deal_stages(name, color), clients(name, city), albums(title, city, year)')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ deal: data })
  }

  // ── move_deal (смена этапа с канбана) ─────────────────────
  if (action === 'move_deal') {
    const { id, stage_id } = body
    if (!await assertOwns('deals', id, tid)) return NextResponse.json({ error: 'not found' }, { status: 404 })
    const { data: stage } = await supabaseAdmin.from('deal_stages').select('is_closed').eq('id', stage_id).single()
    const closed_at = stage?.is_closed ? new Date().toISOString() : null
    const { data, error } = await supabaseAdmin
      .from('deals').update({ stage_id, closed_at }).eq('id', id)
      .select('*, deal_stages(name, color), clients(name, city), albums(title, city, year)')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ deal: data })
  }

  // ── delete_deal ───────────────────────────────────────────
  if (action === 'delete_deal') {
    const { id } = body
    if (!await assertOwns('deals', id, tid)) return NextResponse.json({ error: 'not found' }, { status: 404 })
    await supabaseAdmin.from('tasks').delete().eq('deal_id', id)
    const { error } = await supabaseAdmin.from('deals').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await logAction(auth, 'crm.delete_deal', 'deal', id, {})
    return NextResponse.json({ ok: true })
  }

  // ── create_task ───────────────────────────────────────────
  if (action === 'create_task') {
    const { title, deal_id, client_id, due_date, assigned_to } = body
    if (!title?.trim()) return NextResponse.json({ error: 'title required' }, { status: 400 })
    const { data, error } = await supabaseAdmin
      .from('tasks')
      .insert({
        tenant_id: tid, title: title.trim(),
        deal_id: deal_id || null, client_id: client_id || null,
        due_date: due_date || null, assigned_to: assigned_to || null,
        created_by: auth.userId,
      })
      .select('*, deals(title), clients(name)')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ task: data })
  }

  // ── complete_task ─────────────────────────────────────────
  if (action === 'complete_task') {
    const { id } = body
    if (!await assertOwns('tasks', id, tid)) return NextResponse.json({ error: 'not found' }, { status: 404 })
    const { data, error } = await supabaseAdmin
      .from('tasks').update({ completed_at: new Date().toISOString() }).eq('id', id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ task: data })
  }

  // ── delete_task ───────────────────────────────────────────
  if (action === 'delete_task') {
    const { id } = body
    if (!await assertOwns('tasks', id, tid)) return NextResponse.json({ error: 'not found' }, { status: 404 })
    const { error } = await supabaseAdmin.from('tasks').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // ── update_stages (сохранить порядок/цвета этапов) ────────
  if (action === 'update_stages') {
    const { stages } = body // [{ id, name, color, sort_order, is_closed }]
    if (!Array.isArray(stages)) return NextResponse.json({ error: 'stages array required' }, { status: 400 })
    for (const s of stages) {
      await supabaseAdmin.from('deal_stages')
        .update({ name: s.name, color: s.color, sort_order: s.sort_order, is_closed: s.is_closed })
        .eq('id', s.id).eq('tenant_id', tid)
    }
    const { data } = await supabaseAdmin.from('deal_stages').select('*').eq('tenant_id', tid).order('sort_order')
    return NextResponse.json({ stages: data })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
