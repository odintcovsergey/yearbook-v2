import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth, isAuthError, hashPassword, logAction } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// ============================================================
// GET /api/super — действия для superadmin
// ============================================================

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, ['superadmin'])
  if (isAuthError(auth)) return auth

  const action = req.nextUrl.searchParams.get('action')
  const tenantId = req.nextUrl.searchParams.get('tenant_id')

  // --- Список всех арендаторов со статистикой ---
  if (action === 'tenants') {
    const [tenantsRes, albumsRes, usersRes] = await Promise.all([
      supabaseAdmin
        .from('tenants')
        .select('*')
        .order('created_at', { ascending: false }),
      supabaseAdmin
        .from('albums')
        .select('id, tenant_id, archived'),
      supabaseAdmin
        .from('users')
        .select('id, tenant_id, role, is_active'),
    ])

    const albumStats: Record<string, { total: number; active: number }> = {}
    for (const a of albumsRes.data ?? []) {
      if (!a.tenant_id) continue
      if (!albumStats[a.tenant_id]) albumStats[a.tenant_id] = { total: 0, active: 0 }
      albumStats[a.tenant_id].total++
      if (!a.archived) albumStats[a.tenant_id].active++
    }

    const userStats: Record<string, number> = {}
    for (const u of usersRes.data ?? []) {
      if (!u.tenant_id || !u.is_active) continue
      userStats[u.tenant_id] = (userStats[u.tenant_id] ?? 0) + 1
    }

    const tenants = (tenantsRes.data ?? []).map(t => ({
      ...t,
      album_count: albumStats[t.id]?.total ?? 0,
      active_album_count: albumStats[t.id]?.active ?? 0,
      user_count: userStats[t.id] ?? 0,
    }))

    return NextResponse.json(tenants)
  }

  // --- Детали конкретного tenant'а ---
  if (action === 'tenant_detail' && tenantId) {
    const [tenantRes, usersRes, albumsRes] = await Promise.all([
      supabaseAdmin.from('tenants').select('*').eq('id', tenantId).single(),
      supabaseAdmin
        .from('users')
        .select('id, email, full_name, role, is_active, last_login, created_at')
        .eq('tenant_id', tenantId)
        .order('created_at'),
      supabaseAdmin
        .from('albums')
        .select('id, title, year, archived, deadline, created_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false }),
    ])

    return NextResponse.json({
      tenant: tenantRes.data,
      users: usersRes.data ?? [],
      albums: albumsRes.data ?? [],
    })
  }

  // --- Глобальная статистика ---
  if (action === 'global_stats') {
    const [tenantsCount, albumsCount, childrenCount, submittedCount] = await Promise.all([
      supabaseAdmin.from('tenants').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('albums').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('children').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('children').select('id', { count: 'exact', head: true }).not('submitted_at', 'is', null),
    ])

    return NextResponse.json({
      tenants: tenantsCount.count ?? 0,
      albums: albumsCount.count ?? 0,
      children: childrenCount.count ?? 0,
      submitted: submittedCount.count ?? 0,
    })
  }

  return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
}

// ============================================================
// POST /api/super — мутации
// ============================================================

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req, ['superadmin'])
  if (isAuthError(auth)) return auth

  const body = await req.json()

  // --- Создать нового tenant'а вместе с owner'ом ---
  if (body.action === 'create_tenant') {
    const {
      name,
      slug,
      plan = 'basic',
      city,
      phone,
      email: tenantEmail,
      owner_email,
      owner_password,
      owner_full_name,
      max_albums,
      max_storage_mb,
    } = body

    // Валидация обязательных полей
    if (!name || !slug || !owner_email || !owner_password || !owner_full_name) {
      return NextResponse.json(
        { error: 'Поля обязательны: name, slug, owner_email, owner_password, owner_full_name' },
        { status: 400 }
      )
    }

    // Валидация slug (только буквы, цифры, дефис)
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return NextResponse.json(
        { error: 'Slug может содержать только латинские буквы в нижнем регистре, цифры и дефис' },
        { status: 400 }
      )
    }

    if (slug.length < 2 || slug.length > 40) {
      return NextResponse.json(
        { error: 'Slug должен быть от 2 до 40 символов' },
        { status: 400 }
      )
    }

    // Защищённые slug'и
    if (['admin', 'api', 'app', 'super', 'login', 'auth', 'main', 'www'].includes(slug)) {
      return NextResponse.json(
        { error: 'Этот slug зарезервирован, выберите другой' },
        { status: 400 }
      )
    }

    // Проверка уникальности slug
    const { data: existingSlug } = await supabaseAdmin
      .from('tenants')
      .select('id')
      .eq('slug', slug)
      .maybeSingle()

    if (existingSlug) {
      return NextResponse.json({ error: 'Этот slug уже занят' }, { status: 409 })
    }

    // Проверка уникальности email owner'а
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', owner_email.toLowerCase().trim())
      .maybeSingle()

    if (existingUser) {
      return NextResponse.json(
        { error: 'Пользователь с таким email уже существует' },
        { status: 409 }
      )
    }

    // Значения по умолчанию для тарифов
    const planDefaults: Record<string, { max_albums: number; max_storage_mb: number }> = {
      free: { max_albums: 5, max_storage_mb: 2048 },
      basic: { max_albums: 30, max_storage_mb: 20480 },
      pro: { max_albums: 100, max_storage_mb: 102400 },
      enterprise: { max_albums: 9999, max_storage_mb: 999999 },
    }
    const planLimits = planDefaults[plan] ?? planDefaults.basic

    // Создаём tenant
    const { data: tenant, error: tenantError } = await supabaseAdmin
      .from('tenants')
      .insert({
        name,
        slug,
        plan,
        city: city ?? null,
        phone: phone ?? null,
        email: tenantEmail ?? null,
        max_albums: max_albums ?? planLimits.max_albums,
        max_storage_mb: max_storage_mb ?? planLimits.max_storage_mb,
        is_active: true,
      })
      .select('*')
      .single()

    if (tenantError || !tenant) {
      return NextResponse.json(
        { error: 'Не удалось создать арендатора: ' + (tenantError?.message ?? 'unknown') },
        { status: 500 }
      )
    }

    // Создаём owner'а
    const passwordHash = await hashPassword(owner_password)
    const { data: owner, error: ownerError } = await supabaseAdmin
      .from('users')
      .insert({
        tenant_id: tenant.id,
        email: owner_email.toLowerCase().trim(),
        password_hash: passwordHash,
        full_name: owner_full_name,
        role: 'owner',
        is_active: true,
      })
      .select('id, email, full_name, role')
      .single()

    if (ownerError || !owner) {
      // Откатываем создание tenant'а
      await supabaseAdmin.from('tenants').delete().eq('id', tenant.id)
      return NextResponse.json(
        { error: 'Не удалось создать владельца: ' + (ownerError?.message ?? 'unknown') },
        { status: 500 }
      )
    }

    await logAction(auth, 'tenant.create', 'tenant', tenant.id, {
      name: tenant.name,
      slug: tenant.slug,
      plan: tenant.plan,
      owner_email: owner.email,
    })

    return NextResponse.json({ tenant, owner })
  }

  // --- Обновить tenant ---
  if (body.action === 'update_tenant') {
    const { tenant_id, updates } = body
    if (!tenant_id || !updates) {
      return NextResponse.json({ error: 'tenant_id и updates обязательны' }, { status: 400 })
    }

    // Разрешённые для обновления поля
    const allowedFields = [
      'name', 'city', 'phone', 'email', 'plan',
      'plan_expires', 'max_albums', 'max_storage_mb',
      'settings', 'is_active',
    ]
    const safeUpdates: Record<string, unknown> = {}
    for (const key of allowedFields) {
      if (key in updates) safeUpdates[key] = updates[key]
    }

    if (Object.keys(safeUpdates).length === 0) {
      return NextResponse.json({ error: 'Нет допустимых полей для обновления' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('tenants')
      .update(safeUpdates)
      .eq('id', tenant_id)
      .select('*')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logAction(auth, 'tenant.update', 'tenant', tenant_id, { fields: Object.keys(safeUpdates) })

    return NextResponse.json(data)
  }

  // --- Деактивировать tenant (мягкое удаление) ---
  if (body.action === 'deactivate_tenant') {
    const { tenant_id } = body
    if (!tenant_id) {
      return NextResponse.json({ error: 'tenant_id обязателен' }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from('tenants')
      .update({ is_active: false })
      .eq('id', tenant_id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logAction(auth, 'tenant.deactivate', 'tenant', tenant_id)

    return NextResponse.json({ ok: true })
  }

  // --- Активировать tenant ---
  if (body.action === 'activate_tenant') {
    const { tenant_id } = body
    if (!tenant_id) {
      return NextResponse.json({ error: 'tenant_id обязателен' }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from('tenants')
      .update({ is_active: true })
      .eq('id', tenant_id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logAction(auth, 'tenant.activate', 'tenant', tenant_id)

    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
}
