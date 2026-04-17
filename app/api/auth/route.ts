import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  verifyPassword,
  hashPassword,
  createAccessToken,
  createRefreshToken,
  validateRefreshToken,
  setAuthCookies,
  clearAuthCookies,
  getAuth,
  logAction,
} from '@/lib/auth'

export const dynamic = 'force-dynamic'

// ============================================================
// POST /api/auth — action-based routing
// ============================================================

export async function POST(req: NextRequest) {
  const body = await req.json()
  const action = body.action

  // ----------------------------------------------------------
  // LOGIN — вход по email + пароль
  // ----------------------------------------------------------
  if (action === 'login') {
    const { email, password } = body
    if (!email || !password) {
      return NextResponse.json({ error: 'Email и пароль обязательны' }, { status: 400 })
    }

    // Ищем пользователя
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, email, password_hash, full_name, role, tenant_id, is_active')
      .eq('email', email.toLowerCase().trim())
      .single()

    if (!user || !user.is_active) {
      return NextResponse.json({ error: 'Неверный email или пароль' }, { status: 401 })
    }

    // Проверяем пароль
    const valid = await verifyPassword(password, user.password_hash)
    if (!valid) {
      return NextResponse.json({ error: 'Неверный email или пароль' }, { status: 401 })
    }

    // Создаём токены
    const tenantId = user.tenant_id ?? ''
    const accessToken = await createAccessToken(user.id, tenantId, user.role)
    const refreshToken = await createRefreshToken(user.id, req)

    // Обновляем last_login
    await supabaseAdmin
      .from('users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', user.id)

    // Получаем данные tenant'а
    let tenant = null
    if (user.tenant_id) {
      const { data: t } = await supabaseAdmin
        .from('tenants')
        .select('id, name, slug, plan, settings')
        .eq('id', user.tenant_id)
        .single()
      tenant = t
    }

    const response = NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
      },
      tenant,
    })

    return setAuthCookies(response, accessToken, refreshToken)
  }

  // ----------------------------------------------------------
  // REFRESH — обновление access token по refresh token
  // ----------------------------------------------------------
  if (action === 'refresh') {
    const refreshCookie = req.cookies.get('refresh_token')?.value
    if (!refreshCookie) {
      return NextResponse.json({ error: 'Refresh token отсутствует' }, { status: 401 })
    }

    const session = await validateRefreshToken(refreshCookie)
    if (!session) {
      const response = NextResponse.json({ error: 'Сессия истекла, войдите заново' }, { status: 401 })
      return clearAuthCookies(response)
    }

    // Получаем пользователя
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, role, tenant_id, is_active')
      .eq('id', session.user_id)
      .single()

    if (!user || !user.is_active) {
      const response = NextResponse.json({ error: 'Аккаунт деактивирован' }, { status: 401 })
      return clearAuthCookies(response)
    }

    const tenantId = user.tenant_id ?? ''
    const newAccessToken = await createAccessToken(user.id, tenantId, user.role)

    const response = NextResponse.json({ ok: true })
    response.cookies.set('auth_token', newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 15 * 60,
    })

    return response
  }

  // ----------------------------------------------------------
  // LOGOUT — выход, удаление сессии
  // ----------------------------------------------------------
  if (action === 'logout') {
    const refreshCookie = req.cookies.get('refresh_token')?.value
    if (refreshCookie) {
      await supabaseAdmin.from('sessions').delete().eq('token', refreshCookie)
    }

    const response = NextResponse.json({ ok: true })
    return clearAuthCookies(response)
  }

  // ----------------------------------------------------------
  // SETUP — одноразовое создание superadmin-аккаунта
  // ----------------------------------------------------------
  // ----------------------------------------------------------
  // ACCEPT_INVITATION — принять приглашение и создать аккаунт
  // Создаёт user в правильном tenant_id с ролью из invitation.
  // Помечает invitation как accepted_at и сразу логинит пользователя.
  // ----------------------------------------------------------
  if (action === 'accept_invitation') {
    const { token, password, full_name } = body
    if (!token || !password || !full_name) {
      return NextResponse.json({ error: 'token, password и full_name обязательны' }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Пароль должен быть не короче 8 символов' }, { status: 400 })
    }

    // Проверяем токен
    const { data: invitation } = await supabaseAdmin
      .from('invitations')
      .select('id, tenant_id, email, role, expires_at, accepted_at')
      .eq('token', token)
      .maybeSingle()

    if (!invitation) {
      return NextResponse.json({ error: 'Приглашение не найдено' }, { status: 404 })
    }
    if ((invitation as any).accepted_at) {
      return NextResponse.json({ error: 'Приглашение уже использовано' }, { status: 410 })
    }
    if (new Date((invitation as any).expires_at) < new Date()) {
      return NextResponse.json({ error: 'Приглашение просрочено' }, { status: 410 })
    }

    // На всякий случай — не создаём дубликат пользователя
    const { data: existing } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('tenant_id', (invitation as any).tenant_id)
      .eq('email', (invitation as any).email)
      .maybeSingle()

    if (existing) {
      return NextResponse.json(
        { error: 'Пользователь с таким email уже существует в этой команде. Войдите через /login' },
        { status: 409 }
      )
    }

    const passwordHash = await hashPassword(password)

    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .insert({
        tenant_id: (invitation as any).tenant_id,
        email: (invitation as any).email,
        password_hash: passwordHash,
        full_name: full_name.trim(),
        role: (invitation as any).role,
        is_active: true,
      })
      .select('id, email, full_name, role, tenant_id')
      .single()

    if (userError) {
      return NextResponse.json({ error: userError.message }, { status: 500 })
    }

    // Помечаем приглашение как принятое
    await supabaseAdmin
      .from('invitations')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', (invitation as any).id)

    // Сразу логиним пользователя
    const accessToken = await createAccessToken(
      (user as any).id,
      (user as any).tenant_id,
      (user as any).role,
    )
    const refreshToken = await createRefreshToken((user as any).id, req)

    await supabaseAdmin
      .from('users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', (user as any).id)

    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('id, name, slug, plan, settings')
      .eq('id', (user as any).tenant_id)
      .single()

    const response = NextResponse.json({
      user: {
        id: (user as any).id,
        email: (user as any).email,
        full_name: (user as any).full_name,
        role: (user as any).role,
      },
      tenant,
    })

    return setAuthCookies(response, accessToken, refreshToken)
  }

  if (action === 'setup') {
    // Защита: работает только если superadmin ещё не создан
    const { count } = await supabaseAdmin
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'superadmin')

    if (count && count > 0) {
      return NextResponse.json({ error: 'Superadmin уже существует' }, { status: 409 })
    }

    // Дополнительная защита: требуем ADMIN_SECRET
    const adminSecret = req.headers.get('x-admin-secret')
    if (adminSecret !== process.env.ADMIN_SECRET) {
      return NextResponse.json({ error: 'Нет доступа' }, { status: 401 })
    }

    const { email, password, full_name } = body
    if (!email || !password || !full_name) {
      return NextResponse.json({ error: 'email, password и full_name обязательны' }, { status: 400 })
    }

    const passwordHash = await hashPassword(password)

    const { data: user, error } = await supabaseAdmin
      .from('users')
      .insert({
        email: email.toLowerCase().trim(),
        password_hash: passwordHash,
        full_name,
        role: 'superadmin',
        tenant_id: null,
      })
      .select('id, email, full_name, role')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, user })
  }

  return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
}

// ============================================================
// GET /api/auth — информация о текущем пользователе
// либо валидация приглашения по токену
// ============================================================

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get('action')

  // ----------------------------------------------------------
  // invitation — валидация токена (для страницы /invite/[token])
  // Возвращает только email и название tenant'а — никаких секретов.
  // ----------------------------------------------------------
  if (action === 'invitation') {
    const token = req.nextUrl.searchParams.get('token')
    if (!token) {
      return NextResponse.json({ error: 'Нет токена' }, { status: 400 })
    }

    const { data: invitation } = await supabaseAdmin
      .from('invitations')
      .select('id, tenant_id, email, role, expires_at, accepted_at')
      .eq('token', token)
      .maybeSingle()

    if (!invitation) {
      return NextResponse.json({ error: 'Приглашение не найдено' }, { status: 404 })
    }
    if ((invitation as any).accepted_at) {
      return NextResponse.json({ error: 'Приглашение уже использовано' }, { status: 410 })
    }
    if (new Date((invitation as any).expires_at) < new Date()) {
      return NextResponse.json({ error: 'Приглашение просрочено' }, { status: 410 })
    }

    // Подтягиваем название tenant'а
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('name')
      .eq('id', (invitation as any).tenant_id)
      .single()

    return NextResponse.json({
      email: (invitation as any).email,
      role: (invitation as any).role,
      tenant_name: (tenant as any)?.name ?? '',
    })
  }

  const auth = await getAuth(req)

  if (!auth) {
    return NextResponse.json({ authenticated: false }, { status: 401 })
  }

  // Legacy-режим — отдаём минимальную информацию
  if (auth.isLegacy) {
    return NextResponse.json({
      authenticated: true,
      user: { role: 'superadmin', full_name: 'Admin (legacy)' },
      tenant: null,
      isLegacy: true,
    })
  }

  // JWT-режим — полные данные
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, email, full_name, role')
    .eq('id', auth.userId!)
    .single()

  let tenant = null
  if (auth.tenantId) {
    const { data: t } = await supabaseAdmin
      .from('tenants')
      .select('id, name, slug, plan, settings, max_albums, max_storage_mb')
      .eq('id', auth.tenantId)
      .single()
    tenant = t
  }

  return NextResponse.json({
    authenticated: true,
    user,
    tenant,
    isLegacy: false,
  })
}
