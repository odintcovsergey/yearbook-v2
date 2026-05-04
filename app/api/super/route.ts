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
  // ── okeybook_managers — сотрудники OkeyBook для назначения ─────────────────
  if (action === 'okeybook_managers') {
    const mainTenantId = process.env.DEFAULT_TENANT_ID
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, full_name, email, role')
      .eq('tenant_id', mainTenantId)
      .eq('is_active', true)
      .neq('role', 'superadmin')
      .order('full_name')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ managers: data ?? [] })
  }

  // ── tenant_albums — список альбомов тенанта для менеджера ───────────────────
  if (action === 'tenant_albums' && tenantId) {
    const { data, error } = await supabaseAdmin
      .from('albums')
      .select('id, title, city, year, archived, workflow_status, deadline')
      .eq('tenant_id', tenantId)
      .eq('archived', false)
      .order('created_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ albums: data ?? [] })
  }

  // ── album_detail — статистика по альбому для менеджера ────────────────────
  if (action === 'album_detail') {
    const albumId = req.nextUrl.searchParams.get('album_id')
    if (!albumId) return NextResponse.json({ error: 'album_id required' }, { status: 400 })

    const { data: children } = await supabaseAdmin
      .from('children')
      .select('id, full_name, class, submitted_at, started_at')
      .eq('album_id', albumId)
      .order('class').order('full_name')

    const total = children?.length ?? 0
    const submitted = children?.filter(c => c.submitted_at).length ?? 0
    const in_progress = children?.filter(c => !c.submitted_at && c.started_at).length ?? 0
    const not_started = total - submitted - in_progress

    return NextResponse.json({ total, submitted, in_progress, not_started, children: children ?? [] })
  }

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
  // superadmin — полный доступ
  // owner/manager main тенанта — только create_owner и create_tenant (создание партнёров)
  const auth = await requireAuth(req, ['superadmin', 'owner', 'manager'])
  if (isAuthError(auth)) return auth

  // Проверяем что non-superadmin — из main тенанта
  if (auth.role !== 'superadmin') {
    const { data: t } = await supabaseAdmin.from('tenants').select('slug').eq('id', auth.tenantId).single()
    if (t?.slug !== 'main') {
      return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 })
    }
  }

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

    // Если создаётся из ЛК менеджера — автоматически назначаем его ответственным
    if (body.assign_manager_after_create && auth.role !== 'superadmin') {
      await supabaseAdmin
        .from('tenants')
        .update({ assigned_manager_id: auth.userId })
        .eq('id', tenant.id)
    }

    return NextResponse.json({ tenant, owner })
  }

  // --- Создать owner'а в существующем tenant'е ---
  // Используется superadmin'ом для выдачи доступа. Например, для
  // создания первого owner'а в tenant'е, который был создан раньше
  // без owner'а, или для выдачи запасного доступа.
  if (body.action === 'create_owner') {
    const { tenant_id, email, password, full_name, role = 'owner' } = body

    if (!tenant_id || !email || !password || !full_name) {
      return NextResponse.json(
        { error: 'Обязательные поля: tenant_id, email, password, full_name' },
        { status: 400 }
      )
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Пароль должен быть не короче 8 символов' },
        { status: 400 }
      )
    }

    if (!['owner', 'manager', 'viewer'].includes(role)) {
      return NextResponse.json({ error: 'Неверная роль' }, { status: 400 })
    }

    const normalizedEmail = email.toLowerCase().trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return NextResponse.json({ error: 'Неверный формат email' }, { status: 400 })
    }

    // Проверяем что tenant существует
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('id, name')
      .eq('id', tenant_id)
      .maybeSingle()

    if (!tenant) {
      return NextResponse.json({ error: 'Арендатор не найден' }, { status: 404 })
    }

    // Проверяем что email ещё не занят (в любом tenant'е — email глобально уникален)
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id, tenant_id')
      .eq('email', normalizedEmail)
      .maybeSingle()

    if (existingUser) {
      return NextResponse.json(
        { error: 'Пользователь с таким email уже существует' },
        { status: 409 }
      )
    }

    const passwordHash = await hashPassword(password)

    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .insert({
        tenant_id,
        email: normalizedEmail,
        password_hash: passwordHash,
        full_name: full_name.trim(),
        role,
        is_active: true,
      })
      .select('id, email, full_name, role')
      .single()

    if (userError) {
      return NextResponse.json({ error: userError.message }, { status: 500 })
    }

    await logAction(auth, 'superadmin.create_owner', 'user', (user as any).id, {
      tenant_id,
      tenant_name: (tenant as any).name,
      email: normalizedEmail,
      role,
    })

    return NextResponse.json({ user })
  }

  // --- Обновить tenant ---
  // ── assign_manager — назначить менеджера фотографу ─────────────────────────
  if (body.action === 'assign_manager') {
    const { tenant_id, manager_id } = body
    if (!tenant_id) return NextResponse.json({ error: 'tenant_id required' }, { status: 400 })
    const { error } = await supabaseAdmin
      .from('tenants')
      .update({ assigned_manager_id: manager_id || null })
      .eq('id', tenant_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

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

  // --- ПОЛНОЕ УДАЛЕНИЕ арендатора (опасное действие) ---
  if (body.action === 'delete_tenant') {
    const { tenant_id, confirm_slug } = body
    if (!tenant_id || !confirm_slug) {
      return NextResponse.json(
        { error: 'tenant_id и confirm_slug обязательны' },
        { status: 400 }
      )
    }

    // Получаем арендатора
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('id, slug, name')
      .eq('id', tenant_id)
      .single()

    if (!tenant) {
      return NextResponse.json({ error: 'Арендатор не найден' }, { status: 404 })
    }

    // Защита от удаления дефолтного tenant'а
    if (tenant.slug === 'main') {
      return NextResponse.json(
        { error: 'Главный арендатор не может быть удалён' },
        { status: 403 }
      )
    }

    // Проверка подтверждения: введённый slug должен совпадать
    if (confirm_slug !== tenant.slug) {
      return NextResponse.json(
        { error: 'Slug для подтверждения не совпадает' },
        { status: 400 }
      )
    }

    // Подсчитаем, что будет удалено (для audit log)
    const [{ count: albumsCount }, { count: usersCount }] = await Promise.all([
      supabaseAdmin.from('albums').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant_id),
      supabaseAdmin.from('users').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant_id),
    ])

    // Получаем ID пользователей, чтобы удалить их сессии
    const { data: tenantUsers } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('tenant_id', tenant_id)

    const userIds = (tenantUsers ?? []).map(u => u.id)

    // ЯВНОЕ ПОСЛЕДОВАТЕЛЬНОЕ УДАЛЕНИЕ
    // Не полагаемся только на CASCADE — делаем каждый шаг проверяемым
    // Порядок: от листьев к корню

    // 1. Сессии пользователей этого tenant'а
    if (userIds.length > 0) {
      await supabaseAdmin.from('sessions').delete().in('user_id', userIds)
    }

    // 2. Пользователи tenant'а
    await supabaseAdmin.from('users').delete().eq('tenant_id', tenant_id)

    // 3. Приглашения
    await supabaseAdmin.from('invitations').delete().eq('tenant_id', tenant_id)

    // 4. Audit log этого tenant'а (оставляем запись об удалении через superadmin ниже)
    await supabaseAdmin.from('audit_log').delete().eq('tenant_id', tenant_id)

    // 5. Обнуляем referrer_child_id в лидах (до удаления альбомов/детей)
    const { data: albumIds } = await supabaseAdmin
      .from('albums').select('id').eq('tenant_id', tenant_id)
    if (albumIds && albumIds.length > 0) {
      const ids = albumIds.map((a: any) => a.id)
      const { data: childIds } = await supabaseAdmin
        .from('children').select('id').in('album_id', ids)
      if (childIds && childIds.length > 0) {
        await supabaseAdmin
          .from('referral_leads')
          .update({ referrer_child_id: null })
          .in('referrer_child_id', childIds.map((c: any) => c.id))
      }
    }

    // 6. Альбомы (каскадно удалят children, photos, selections и т.д.)
    await supabaseAdmin.from('albums').delete().eq('tenant_id', tenant_id)

    // 7. Шаблоны и цитаты этого tenant'а
    await supabaseAdmin.from('album_templates').delete().eq('tenant_id', tenant_id)
    await supabaseAdmin.from('quotes').delete().eq('tenant_id', tenant_id)

    // 8. Лиды
    await supabaseAdmin.from('referral_leads').delete().eq('tenant_id', tenant_id)

    // 8. Наконец — сам tenant
    const { error } = await supabaseAdmin
      .from('tenants')
      .delete()
      .eq('id', tenant_id)

    if (error) {
      return NextResponse.json(
        { error: 'Не удалось удалить арендатора: ' + error.message },
        { status: 500 }
      )
    }

    // Audit log — tenant_id=null чтобы запись не удалилась вместе с tenant'ом
    await logAction(auth, 'tenant.delete', 'tenant', tenant_id, {
      name: tenant.name,
      slug: tenant.slug,
      albums_deleted: albumsCount ?? 0,
      users_deleted: usersCount ?? 0,
    })

    return NextResponse.json({
      ok: true,
      deleted: {
        tenant_id,
        name: tenant.name,
        albums: albumsCount ?? 0,
        users: usersCount ?? 0,
      },
    })
  }

  return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
}
