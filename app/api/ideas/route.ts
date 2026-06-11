import { NextRequest, NextResponse } from 'next/server'
import { serverError } from '@/lib/api-error'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth, isAuthError, logAction, type AuthContext } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

// ============================================================
// Раздел «Идеи и предложения» с голосованием (по мотивам wfolio).
// ТЗ: docs/tz-community-ideas (постановка 2026-06-11).
//
// ГЛОБАЛЬНЫЙ модуль — ИСКЛЮЧЕНИЕ из tenant-aware паттерна:
//   • идеи и голоса общие для всего сообщества, БЕЗ фильтра по tenant_id;
//   • доступ только через supabaseAdmin (service role), RLS без политик;
//   • голос привязан к user_id, не к тенанту.
//
// Анонимность: публичные ответы (вкладки кабинета) НИКОГДА не содержат
// author_user_id и контактов автора. Контакты автора отдаются ТОЛЬКО в
// superadmin-ответах (admin) — джойн users + tenants по author_user_id.
//
// Премодерация: новая идея → status='pending', в ленте не видна, пока
// суперадмин не одобрит (approve → 'published').
// ============================================================

// Антиспам и валидация create.
const MAX_IDEAS_PER_DAY = 5
const BODY_MIN = 10
const BODY_MAX = 2000
const TITLE_MAX = 120

type IdeaRow = {
  id: string
  title: string | null
  body: string
  status: string
  votes_count: number
  created_at: string
  published_at: string | null
  done_at: string | null
  author_user_id: string
}

// Публичная форма — без автора (анонимность для партнёров).
type PublicIdea = {
  id: string
  title: string | null
  body: string
  status: string
  votes_count: number
  created_at: string
  voted: boolean
}

function toPublic(row: IdeaRow, votedIds: Set<string>): PublicIdea {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    status: row.status,
    votes_count: row.votes_count,
    created_at: row.created_at,
    voted: votedIds.has(row.id),
  }
}

// Какие из переданных идей текущий пользователь уже лайкнул.
async function votedSetFor(userId: string | null, ideaIds: string[]): Promise<Set<string>> {
  if (!userId || ideaIds.length === 0) return new Set()
  const { data } = await supabaseAdmin
    .from('idea_votes')
    .select('idea_id')
    .eq('user_id', userId)
    .in('idea_id', ideaIds)
  return new Set((data ?? []).map((v: { idea_id: string }) => v.idea_id))
}

// ============================================================
// GET — чтение
// ============================================================
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (isAuthError(auth)) return auth

  const action = req.nextUrl.searchParams.get('action') ?? 'list'

  try {
    if (action === 'list') return await handleList(req, auth)
    if (action === 'admin') return await handleAdmin(auth)
    return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
  } catch (err) {
    return serverError(err, 'ideas:get')
  }
}

// Лента кабинета: tab = voting | done | mine_votes; q — поиск по тексту.
async function handleList(req: NextRequest, auth: AuthContext): Promise<NextResponse> {
  const tab = req.nextUrl.searchParams.get('tab') ?? 'voting'
  // q уходит в PostgREST .or()-фильтр строкой — вычищаем символы, которые там
  // имеют синтаксическое значение (запятая, скобки, бэкслеш, звёздочка),
  // иначе пользователь мог бы подмешать свои условия. Длину тоже ограничиваем.
  const q = (req.nextUrl.searchParams.get('q') ?? '')
    .trim()
    .replace(/[,()\\*%]/g, ' ')
    .slice(0, 100)
    .trim()

  let ideaIdFilter: string[] | null = null
  if (tab === 'mine_votes') {
    // Идеи, за которые проголосовал текущий пользователь.
    const { data: myVotes } = await supabaseAdmin
      .from('idea_votes')
      .select('idea_id')
      .eq('user_id', auth.userId)
    ideaIdFilter = (myVotes ?? []).map((v: { idea_id: string }) => v.idea_id)
    if (ideaIdFilter.length === 0) return NextResponse.json({ ideas: [] })
  }

  let query = supabaseAdmin
    .from('ideas')
    .select('id, title, body, status, votes_count, created_at, published_at, done_at, author_user_id')

  if (tab === 'done') {
    query = query.eq('status', 'done').order('done_at', { ascending: false })
  } else if (tab === 'mine_votes') {
    // Свои голоса — показываем только живые идеи (опубликованные/сделанные).
    query = query.in('status', ['published', 'done']).order('votes_count', { ascending: false })
  } else {
    // voting (по умолчанию) — опубликованные по убыванию голосов.
    query = query.eq('status', 'published').order('votes_count', { ascending: false })
  }
  query = query.order('created_at', { ascending: false })

  if (ideaIdFilter) query = query.in('id', ideaIdFilter)
  if (q) query = query.or(`body.ilike.%${q}%,title.ilike.%${q}%`)

  const { data, error } = await query.limit(200)
  if (error) return serverError(error, 'ideas:list')

  const rows = (data ?? []) as IdeaRow[]
  const votedIds = await votedSetFor(auth.userId, rows.map(r => r.id))
  return NextResponse.json({ ideas: rows.map(r => toPublic(r, votedIds)) })
}

// Superadmin: очередь модерации + опубликованные + сделанные, с контактами автора.
async function handleAdmin(auth: AuthContext): Promise<NextResponse> {
  if (auth.role !== 'superadmin') {
    return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 })
  }

  const { data, error } = await supabaseAdmin
    .from('ideas')
    .select('id, title, body, status, votes_count, created_at, published_at, done_at, author_user_id')
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) return serverError(error, 'ideas:admin')

  const rows = (data ?? []) as IdeaRow[]

  // Карточка автора: users (full_name, email, tenant_id) → tenants (name, phone).
  const authorIds = Array.from(new Set(rows.map(r => r.author_user_id)))
  const { data: users } = await supabaseAdmin
    .from('users')
    .select('id, full_name, email, tenant_id')
    .in('id', authorIds.length ? authorIds : ['00000000-0000-0000-0000-000000000000'])
  const userMap = new Map((users ?? []).map((u: { id: string }) => [u.id, u]))

  const tenantIds = Array.from(new Set(
    (users ?? []).map((u: { tenant_id: string | null }) => u.tenant_id).filter(Boolean) as string[]
  ))
  const { data: tenants } = await supabaseAdmin
    .from('tenants')
    .select('id, name, phone, email')
    .in('id', tenantIds.length ? tenantIds : ['00000000-0000-0000-0000-000000000000'])
  const tenantMap = new Map((tenants ?? []).map((t: { id: string }) => [t.id, t]))

  const withAuthor = rows.map(r => {
    const u = userMap.get(r.author_user_id) as
      { full_name: string | null; email: string | null; tenant_id: string | null } | undefined
    const t = u?.tenant_id
      ? (tenantMap.get(u.tenant_id) as { name: string | null; phone: string | null; email: string | null } | undefined)
      : undefined
    return {
      id: r.id,
      title: r.title,
      body: r.body,
      status: r.status,
      votes_count: r.votes_count,
      created_at: r.created_at,
      published_at: r.published_at,
      done_at: r.done_at,
      author: {
        full_name: u?.full_name ?? null,
        email: u?.email ?? null,
        phone: t?.phone ?? null,
        org: t?.name ?? null,
      },
    }
  })

  return NextResponse.json({
    pending: withAuthor.filter(i => i.status === 'pending'),
    published: withAuthor.filter(i => i.status === 'published'),
    done: withAuthor.filter(i => i.status === 'done'),
    counts: {
      pending: withAuthor.filter(i => i.status === 'pending').length,
      published: withAuthor.filter(i => i.status === 'published').length,
      done: withAuthor.filter(i => i.status === 'done').length,
    },
  })
}

// ============================================================
// POST — мутации
// ============================================================
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (isAuthError(auth)) return auth

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Некорректное тело запроса' }, { status: 400 })
  }
  const action = String(body.action ?? '')

  try {
    switch (action) {
      case 'create':    return await handleCreate(body, auth)
      case 'vote':      return await handleVote(body, auth, true)
      case 'unvote':    return await handleVote(body, auth, false)
      // — superadmin —
      case 'approve':   return await handleModerate(body, auth, 'approve')
      case 'reject':    return await handleModerate(body, auth, 'reject')
      case 'mark_done': return await handleModerate(body, auth, 'mark_done')
      case 'hide':      return await handleModerate(body, auth, 'hide')
      default:
        return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
    }
  } catch (err) {
    return serverError(err, `ideas:${action}`)
  }
}

// Создание идеи → pending (премодерация). Антиспам: лимит в сутки + длина.
async function handleCreate(body: Record<string, unknown>, auth: AuthContext): Promise<NextResponse> {
  const text = String(body.body ?? '').trim()
  const titleRaw = body.title != null ? String(body.title).trim() : ''
  const title = titleRaw ? titleRaw.slice(0, TITLE_MAX) : null

  if (text.length < BODY_MIN) {
    return NextResponse.json({ error: `Опишите идею подробнее (минимум ${BODY_MIN} символов)` }, { status: 400 })
  }
  if (text.length > BODY_MAX) {
    return NextResponse.json({ error: `Слишком длинно (максимум ${BODY_MAX} символов)` }, { status: 400 })
  }

  // Лимит: не больше MAX_IDEAS_PER_DAY за последние 24 часа на пользователя.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count } = await supabaseAdmin
    .from('ideas')
    .select('id', { count: 'exact', head: true })
    .eq('author_user_id', auth.userId)
    .gt('created_at', since)
  if ((count ?? 0) >= MAX_IDEAS_PER_DAY) {
    return NextResponse.json(
      { error: `Можно отправить не больше ${MAX_IDEAS_PER_DAY} идей в сутки. Попробуйте завтра.` },
      { status: 429 },
    )
  }

  const { error } = await supabaseAdmin
    .from('ideas')
    .insert({ title, body: text, author_user_id: auth.userId, status: 'pending' })
  if (error) return serverError(error, 'ideas:create')

  await logAction(auth, 'idea_create')
  return NextResponse.json({ ok: true, message: 'Идея отправлена на модерацию — появится в ленте после проверки.' })
}

// Голос / снятие голоса. Идемпотентно через unique(idea_id,user_id).
async function handleVote(body: Record<string, unknown>, auth: AuthContext, on: boolean): Promise<NextResponse> {
  const ideaId = String(body.idea_id ?? '')
  if (!ideaId) return NextResponse.json({ error: 'idea_id обязателен' }, { status: 400 })

  // Голосовать можно только за живые идеи (опубликованные/сделанные).
  const { data: idea } = await supabaseAdmin
    .from('ideas')
    .select('id, status')
    .eq('id', ideaId)
    .maybeSingle()
  if (!idea) return NextResponse.json({ error: 'Идея не найдена' }, { status: 404 })
  if (!['published', 'done'].includes((idea as { status: string }).status)) {
    return NextResponse.json({ error: 'За эту идею голосовать нельзя' }, { status: 400 })
  }

  if (on) {
    // INSERT ... ON CONFLICT DO NOTHING — повторный голос ничего не делает.
    const { error } = await supabaseAdmin
      .from('idea_votes')
      .upsert({ idea_id: ideaId, user_id: auth.userId }, { onConflict: 'idea_id,user_id', ignoreDuplicates: true })
    if (error) return serverError(error, 'ideas:vote')
  } else {
    const { error } = await supabaseAdmin
      .from('idea_votes')
      .delete()
      .eq('idea_id', ideaId)
      .eq('user_id', auth.userId)
    if (error) return serverError(error, 'ideas:unvote')
  }

  // Свежий счётчик (ведёт триггер).
  const { data: fresh } = await supabaseAdmin
    .from('ideas')
    .select('votes_count')
    .eq('id', ideaId)
    .maybeSingle()
  return NextResponse.json({ ok: true, voted: on, votes_count: (fresh as { votes_count: number } | null)?.votes_count ?? 0 })
}

// Модерация — только superadmin.
async function handleModerate(
  body: Record<string, unknown>,
  auth: AuthContext,
  op: 'approve' | 'reject' | 'mark_done' | 'hide',
): Promise<NextResponse> {
  if (auth.role !== 'superadmin') {
    return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 })
  }
  const ideaId = String(body.idea_id ?? '')
  if (!ideaId) return NextResponse.json({ error: 'idea_id обязателен' }, { status: 400 })

  const patch: Record<string, unknown> = { moderated_by: auth.userId }
  if (op === 'approve')   { patch.status = 'published'; patch.published_at = new Date().toISOString() }
  if (op === 'reject')    { patch.status = 'rejected' }
  if (op === 'hide')      { patch.status = 'rejected' }
  if (op === 'mark_done') { patch.status = 'done'; patch.done_at = new Date().toISOString() }

  const { error } = await supabaseAdmin
    .from('ideas')
    .update(patch)
    .eq('id', ideaId)
  if (error) return serverError(error, `ideas:${op}`)

  await logAction(auth, `idea_${op}`, 'idea', ideaId)
  return NextResponse.json({ ok: true })
}
