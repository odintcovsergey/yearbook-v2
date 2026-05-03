'use client'

import { useState, useEffect, FormEvent } from 'react'
import { useRouter } from 'next/navigation'

type AuthData = {
  authenticated: boolean
  user?: { id: string; email: string; full_name: string; role: string }
  isLegacy?: boolean
}

type Tenant = {
  id: string
  name: string
  slug: string
  plan: string
  city: string | null
  phone: string | null
  email: string | null
  max_albums: number
  max_storage_mb: number
  is_active: boolean
  created_at: string
  plan_expires: string | null
  album_count: number
  active_album_count: number
  user_count: number
}

type GlobalStats = {
  tenants: number
  albums: number
  children: number
  submitted: number
}

const api = (path: string, opts?: RequestInit) =>
  fetch(path, {
    ...opts,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
  })

const planLabels: Record<string, string> = {
  free: 'Free',
  basic: 'Basic',
  pro: 'Pro',
  enterprise: 'Enterprise',
}

const planColors: Record<string, string> = {
  free: 'badge-gray',
  basic: 'badge-blue',
  pro: 'badge-green',
  enterprise: 'badge-amber',
}

export default function SuperPage() {
  const router = useRouter()
  const [auth, setAuth] = useState<AuthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [stats, setStats] = useState<GlobalStats | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null)
  const [search, setSearch] = useState('')
  const [msg, setMsg] = useState<{ text: string; type: 'ok' | 'err' } | null>(null)
  const [superTab, setSuperTab] = useState<'tenants' | 'partners' | 'queue'>('tenants')
  const [selectedPartnerTenant, setSelectedPartnerTenant] = useState<Tenant | null>(null)
  const [queue, setQueue] = useState<any[]>([])
  const [queueLoading, setQueueLoading] = useState(false)
  const [selectedQueueAlbum, setSelectedQueueAlbum] = useState<any | null>(null)

  const notify = (text: string, type: 'ok' | 'err' = 'ok') => {
    setMsg({ text, type })
    setTimeout(() => setMsg(null), 4000)
  }

  useEffect(() => {
    api('/api/auth')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d?.authenticated || d.isLegacy) {
          router.push('/login')
          return
        }
        if (d.user?.role !== 'superadmin') {
          router.push('/app')
          return
        }
        setAuth(d)
        setLoading(false)
      })
      .catch(() => router.push('/login'))
  }, [router])

  const loadTenants = async () => {
    const r = await api('/api/super?action=tenants')
    if (r.ok) setTenants(await r.json())
  }

  const loadStats = async () => {
    const r = await api('/api/super?action=global_stats')
    if (r.ok) setStats(await r.json())
  }

  useEffect(() => {
    if (auth) {
      loadTenants()
      loadStats()
    }
  }, [auth])

  const loadQueue = async () => {
    setQueueLoading(true)
    const r = await api('/api/workflow?action=queue&status=submitted,in_production,delivered')
    if (r.ok) setQueue(await r.json().then((d: any) => d.albums ?? []))
    setQueueLoading(false)
  }

  useEffect(() => {
    if (auth && superTab === 'queue') loadQueue()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth, superTab])

  const handleLogout = async () => {
    await api('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'logout' }) })
    router.push('/login')
  }

  const filtered = tenants.filter(t =>
    !search ||
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.slug.toLowerCase().includes(search.toLowerCase()) ||
    (t.email?.toLowerCase().includes(search.toLowerCase()) ?? false)
  )

  if (loading || !auth) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-400 text-sm">Загрузка...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1
              className="text-xl font-semibold"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Панель суперадминистратора
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              {auth.user?.full_name} · {auth.user?.email}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a href="/admin" className="btn-ghost">Старая админка</a>
            <button onClick={handleLogout} className="btn-secondary">Выйти</button>
          </div>
        </div>
      </header>

      {msg && (
        <div
          className={`fixed top-20 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl text-sm font-medium shadow-lg ${
            msg.type === 'ok'
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {msg.text}
        </div>
      )}

      <main className="max-w-6xl mx-auto px-6 py-8">
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <StatCard label="Арендаторов" value={stats.tenants} />
            <StatCard label="Альбомов" value={stats.albums} />
            <StatCard label="Учеников" value={stats.children} />
            <StatCard
              label="Завершили"
              value={stats.submitted}
              subValue={stats.children > 0 ? `${Math.round((stats.submitted / stats.children) * 100)}%` : undefined}
            />
          </div>
        )}

        {/* Таб-бар */}
        <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1 w-fit">
          {([
            { key: 'tenants' as const, label: '🏢 Арендаторы' },
            { key: 'partners' as const, label: '📸 Партнёры' },
            { key: 'queue' as const, label: `🚀 Очередь работ${queue.filter(a => a.workflow_status === 'submitted').length > 0 ? ` · ${queue.filter(a => a.workflow_status === 'submitted').length} новых` : ''}` },
          ]).map(t => (
            <button key={t.key} onClick={() => setSuperTab(t.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${superTab === t.key ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {superTab === 'partners' && (
          <PartnersView
            tenants={tenants}
            onSelectTenant={setSelectedPartnerTenant}
            selectedTenant={selectedPartnerTenant}
          />
        )}

        {superTab === 'queue' && (
          <QueueView
            queue={queue}
            loading={queueLoading}
            selected={selectedQueueAlbum}
            onSelect={setSelectedQueueAlbum}
            onRefresh={loadQueue}
            onNotify={notify}
          />
        )}

        {superTab === 'tenants' && (<>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Арендаторы</h2>
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            + Новый арендатор
          </button>
        </div>

        <div className="mb-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по названию, slug или email..."
            className="input max-w-md"
          />
        </div>

        <div className="card overflow-hidden">
          {filtered.length === 0 ? (
            <div className="p-12 text-center text-gray-400 text-sm">
              {search ? 'Ничего не найдено' : 'Пока нет арендаторов. Создайте первого.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr className="text-left text-xs font-medium text-gray-500 uppercase">
                    <th className="px-5 py-3">Название</th>
                    <th className="px-5 py-3">Slug</th>
                    <th className="px-5 py-3">Тариф</th>
                    <th className="px-5 py-3 text-center">Альбомов</th>
                    <th className="px-5 py-3 text-center">Сотрудников</th>
                    <th className="px-5 py-3">Создан</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map(t => (
                    <tr
                      key={t.id}
                      onClick={() => setSelectedTenant(t)}
                      className={`hover:bg-gray-50 transition-colors cursor-pointer ${!t.is_active ? 'opacity-50' : ''}`}
                    >
                      <td className="px-5 py-3">
                        <div className="font-medium text-gray-900">{t.name}</div>
                        {t.city && <div className="text-xs text-gray-500">{t.city}</div>}
                      </td>
                      <td className="px-5 py-3">
                        <code className="text-xs bg-gray-100 px-2 py-0.5 rounded">{t.slug}</code>
                      </td>
                      <td className="px-5 py-3">
                        <span className={planColors[t.plan] ?? 'badge-gray'}>
                          {planLabels[t.plan] ?? t.plan}
                        </span>
                        {!t.is_active && (
                          <span className="badge-gray ml-2">Отключён</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-center">
                        <span className="font-medium">{t.active_album_count}</span>
                        <span className="text-gray-400"> / {t.album_count}</span>
                      </td>
                      <td className="px-5 py-3 text-center">{t.user_count}</td>
                      <td className="px-5 py-3 text-gray-500 text-xs">
                        {new Date(t.created_at).toLocaleDateString('ru-RU')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </>)}
      </main>

      {showCreate && (
        <CreateTenantModal
          onClose={() => setShowCreate(false)}
          onSuccess={(tenant) => {
            setShowCreate(false)
            loadTenants()
            loadStats()
            notify(`Арендатор «${tenant.name}» создан. Логин: ${tenant.owner_email}`, 'ok')
          }}
        />
      )}

      {selectedTenant && (
        <TenantDetailModal
          tenant={selectedTenant}
          onClose={() => setSelectedTenant(null)}
          onUpdate={() => {
            loadTenants()
            loadStats()
          }}
          onDeleted={(name) => {
            setSelectedTenant(null)
            loadTenants()
            loadStats()
            notify(`Арендатор «${name}» удалён`, 'ok')
          }}
          onError={(msg) => notify(msg, 'err')}
          onNotify={(msg) => notify(msg, 'ok')}
        />
      )}
    </div>
  )
}

function StatCard({ label, value, subValue }: { label: string; value: number; subValue?: string }) {
  return (
    <div className="card p-5">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="flex items-baseline gap-2">
        <div className="text-2xl font-semibold text-gray-900">{value}</div>
        {subValue && <div className="text-sm text-gray-400">{subValue}</div>}
      </div>
    </div>
  )
}

type CreateFormData = {
  name: string
  slug: string
  plan: string
  city: string
  email: string
  phone: string
  owner_email: string
  owner_password: string
  owner_full_name: string
}

function CreateTenantModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void
  onSuccess: (data: { name: string; owner_email: string }) => void
}) {
  // Защита от случайного закрытия: backdrop закрывает только если mousedown
  // начался и завершился именно на backdrop (не на карточке)
  const [backdropStart, setBackdropStart] = useState(false)

  const handleBackdropMouseDown = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) setBackdropStart(true)
  }
  const handleBackdropMouseUp = (e: React.MouseEvent) => {
    if (backdropStart && e.target === e.currentTarget) onClose()
    setBackdropStart(false)
  }

  const [form, setForm] = useState<CreateFormData>({
    name: '',
    slug: '',
    plan: 'basic',
    city: '',
    email: '',
    phone: '',
    owner_email: '',
    owner_password: '',
    owner_full_name: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof CreateFormData>(k: K, v: CreateFormData[K]) =>
    setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    if (!form.name) return
    const map: Record<string, string> = {
      'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh',
      'з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o',
      'п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'ts',
      'ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya',
    }
    const autoSlug = form.name
      .toLowerCase()
      .split('')
      .map(c => map[c] ?? c)
      .join('')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
    set('slug', autoSlug)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.name])

  const genPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
    let pwd = ''
    const bytes = new Uint8Array(14)
    crypto.getRandomValues(bytes)
    for (let i = 0; i < 14; i++) pwd += chars[bytes[i] % chars.length]
    set('owner_password', pwd)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const r = await api('/api/super', {
        method: 'POST',
        body: JSON.stringify({ action: 'create_tenant', ...form }),
      })

      const data = await r.json()

      if (!r.ok) {
        setError(data.error ?? 'Ошибка создания')
        setLoading(false)
        return
      }

      onSuccess({ name: form.name, owner_email: form.owner_email })
    } catch {
      setError('Не удалось связаться с сервером')
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-40 flex items-start justify-center py-8 px-4 overflow-y-auto"
      onMouseDown={handleBackdropMouseDown}
      onMouseUp={handleBackdropMouseUp}
    >
      <div
        className="bg-white rounded-2xl max-w-2xl w-full shadow-xl my-auto"
      >
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Новый арендатор</h3>
          <button onClick={onClose} type="button" className="text-gray-400 hover:text-gray-700 text-xl leading-none">
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <h4 className="text-xs font-medium text-gray-400 uppercase mb-3">Арендатор</h4>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Название <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  className="input"
                  placeholder="Фотостудия Солнышко"
                  required
                  disabled={loading}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Slug (для URL) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.slug}
                  onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  className="input"
                  placeholder="solnyshko"
                  required
                  disabled={loading}
                  pattern="[a-z0-9-]+"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Латинские буквы, цифры, дефис. Генерируется автоматически из названия.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Тариф</label>
                  <select
                    value={form.plan}
                    onChange={(e) => set('plan', e.target.value)}
                    className="input"
                    disabled={loading}
                  >
                    <option value="free">Free — 5 альбомов, 2GB</option>
                    <option value="basic">Basic — 30 альбомов, 20GB</option>
                    <option value="pro">Pro — 100 альбомов, 100GB</option>
                    <option value="enterprise">Enterprise — без лимитов</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Город</label>
                  <input
                    type="text"
                    value={form.city}
                    onChange={(e) => set('city', e.target.value)}
                    className="input"
                    placeholder="Москва"
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Email арендатора</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => set('email', e.target.value)}
                    className="input"
                    placeholder="contact@studio.ru"
                    disabled={loading}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Телефон</label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={(e) => set('phone', e.target.value)}
                    className="input"
                    placeholder="+7 999 999-99-99"
                    disabled={loading}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-5">
            <h4 className="text-xs font-medium text-gray-400 uppercase mb-3">Владелец аккаунта</h4>
            <p className="text-xs text-gray-500 mb-3">
              Этот пользователь получит роль owner и сможет управлять арендатором.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  ФИО <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.owner_full_name}
                  onChange={(e) => set('owner_full_name', e.target.value)}
                  className="input"
                  placeholder="Иванов Иван Иванович"
                  required
                  disabled={loading}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Email для входа <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  value={form.owner_email}
                  onChange={(e) => set('owner_email', e.target.value)}
                  className="input"
                  placeholder="ivan@studio.ru"
                  required
                  disabled={loading}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Пароль <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={form.owner_password}
                    onChange={(e) => set('owner_password', e.target.value)}
                    className="input font-mono text-sm"
                    placeholder="Минимум 8 символов"
                    required
                    minLength={8}
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={genPassword}
                    className="btn-secondary whitespace-nowrap"
                    disabled={loading}
                  >
                    Сгенерировать
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Обязательно передайте пароль владельцу. После создания его можно будет сменить.
                </p>
              </div>
            </div>
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn-primary flex-1" disabled={loading}>
              {loading ? 'Создаём...' : 'Создать арендатора'}
            </button>
            <button type="button" onClick={onClose} className="btn-secondary" disabled={loading}>
              Отмена
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ============================================================
// МОДАЛКА ДЕТАЛЕЙ АРЕНДАТОРА
// ============================================================

type EditFormData = {
  name: string
  plan: string
  city: string
  email: string
  phone: string
  max_albums: number
  max_storage_mb: number
  plan_expires: string  // YYYY-MM-DD или пусто
}

function TenantDetailModal({
  tenant,
  onClose,
  onUpdate,
  onDeleted,
  onError,
  onNotify,
}: {
  tenant: Tenant
  onClose: () => void
  onUpdate: () => void
  onDeleted: (name: string) => void
  onError: (msg: string) => void
  onNotify: (msg: string) => void
}) {
  const [mode, setMode] = useState<'view' | 'edit' | 'delete' | 'create_user'>('view')
  const [backdropStart, setBackdropStart] = useState(false)

  const handleBackdropMouseDown = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) setBackdropStart(true)
  }
  const handleBackdropMouseUp = (e: React.MouseEvent) => {
    if (backdropStart && e.target === e.currentTarget) onClose()
    setBackdropStart(false)
  }

  const [form, setForm] = useState<EditFormData>({
    name: tenant.name,
    plan: tenant.plan,
    city: tenant.city ?? '',
    email: tenant.email ?? '',
    phone: tenant.phone ?? '',
    max_albums: tenant.max_albums,
    max_storage_mb: tenant.max_storage_mb,
    plan_expires: tenant.plan_expires ? tenant.plan_expires.slice(0, 10) : '',
  })
  const [loading, setLoading] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')

  const set = <K extends keyof EditFormData>(k: K, v: EditFormData[K]) =>
    setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    setLoading(true)
    const updates: Record<string, unknown> = {
      name: form.name,
      plan: form.plan,
      city: form.city || null,
      email: form.email || null,
      phone: form.phone || null,
      max_albums: form.max_albums,
      max_storage_mb: form.max_storage_mb,
      plan_expires: form.plan_expires ? new Date(form.plan_expires).toISOString() : null,
    }

    const r = await api('/api/super', {
      method: 'POST',
      body: JSON.stringify({ action: 'update_tenant', tenant_id: tenant.id, updates }),
    })

    if (r.ok) {
      onNotify('Изменения сохранены')
      onUpdate()
      setMode('view')
    } else {
      const d = await r.json().catch(() => ({}))
      onError(d.error ?? 'Не удалось сохранить')
    }
    setLoading(false)
  }

  const handleToggleActive = async () => {
    setLoading(true)
    const action = tenant.is_active ? 'deactivate_tenant' : 'activate_tenant'
    const r = await api('/api/super', {
      method: 'POST',
      body: JSON.stringify({ action, tenant_id: tenant.id }),
    })
    if (r.ok) {
      onNotify(tenant.is_active ? 'Арендатор заблокирован' : 'Арендатор разблокирован')
      onUpdate()
      onClose()
    } else {
      const d = await r.json().catch(() => ({}))
      onError(d.error ?? 'Не удалось изменить статус')
    }
    setLoading(false)
  }

  // Форма создания нового пользователя в существующем tenant'е
  const [userForm, setUserForm] = useState({
    email: '',
    password: '',
    full_name: '',
    role: 'owner' as 'owner' | 'manager' | 'viewer',
  })
  const [createdUser, setCreatedUser] = useState<{ email: string; password: string } | null>(null)

  const handleCreateUser = async () => {
    if (!userForm.email || !userForm.password || !userForm.full_name) {
      onError('Заполните email, пароль и имя')
      return
    }
    if (userForm.password.length < 8) {
      onError('Пароль должен быть не короче 8 символов')
      return
    }
    setLoading(true)
    const r = await api('/api/super', {
      method: 'POST',
      body: JSON.stringify({
        action: 'create_owner',
        tenant_id: tenant.id,
        email: userForm.email,
        password: userForm.password,
        full_name: userForm.full_name,
        role: userForm.role,
      }),
    })
    if (r.ok) {
      // Показываем carousel-карточку с данными для передачи пользователю
      setCreatedUser({ email: userForm.email.trim(), password: userForm.password })
      setUserForm({ email: '', password: '', full_name: '', role: 'owner' })
      onNotify('Пользователь создан')
      onUpdate()
    } else {
      const d = await r.json().catch(() => ({}))
      onError(d.error ?? 'Не удалось создать пользователя')
    }
    setLoading(false)
  }

  const handleDelete = async () => {
    if (deleteConfirm !== tenant.slug) {
      onError('Slug для подтверждения не совпадает')
      return
    }
    setLoading(true)
    const r = await api('/api/super', {
      method: 'POST',
      body: JSON.stringify({
        action: 'delete_tenant',
        tenant_id: tenant.id,
        confirm_slug: deleteConfirm,
      }),
    })
    if (r.ok) {
      onDeleted(tenant.name)
    } else {
      const d = await r.json().catch(() => ({}))
      onError(d.error ?? 'Не удалось удалить')
      setLoading(false)
    }
  }

  const isMainTenant = tenant.slug === 'main'

  return (
    <div
      className="fixed inset-0 bg-black/40 z-40 flex items-start justify-center py-8 px-4 overflow-y-auto"
      onMouseDown={handleBackdropMouseDown}
      onMouseUp={handleBackdropMouseUp}
    >
      <div className="bg-white rounded-2xl max-w-2xl w-full shadow-xl my-auto">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">{tenant.name}</h3>
            <div className="text-xs text-gray-500 mt-0.5">
              <code className="bg-gray-100 px-1.5 py-0.5 rounded">{tenant.slug}</code>
              {!tenant.is_active && <span className="ml-2 text-red-600">Заблокирован</span>}
            </div>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="text-gray-400 hover:text-gray-700 text-xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-6">
          {mode === 'view' && (
            <div className="space-y-5">
              {/* Статистика */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-gray-50 rounded-xl p-4">
                  <div className="text-xs text-gray-500">Альбомов</div>
                  <div className="text-xl font-semibold mt-1">
                    {tenant.active_album_count}
                    <span className="text-gray-400 text-sm"> / {tenant.album_count}</span>
                  </div>
                </div>
                <div className="bg-gray-50 rounded-xl p-4">
                  <div className="text-xs text-gray-500">Сотрудников</div>
                  <div className="text-xl font-semibold mt-1">{tenant.user_count}</div>
                </div>
                <div className="bg-gray-50 rounded-xl p-4">
                  <div className="text-xs text-gray-500">Тариф</div>
                  <div className="mt-1">
                    <span className={planColors[tenant.plan] ?? 'badge-gray'}>
                      {planLabels[tenant.plan] ?? tenant.plan}
                    </span>
                  </div>
                </div>
              </div>

              {/* Информация */}
              <div className="space-y-2 text-sm">
                <InfoRow label="Город" value={tenant.city} />
                <InfoRow label="Email" value={tenant.email} />
                <InfoRow label="Телефон" value={tenant.phone} />
                <InfoRow label="Лимит альбомов" value={tenant.max_albums.toString()} />
                <InfoRow
                  label="Лимит хранилища"
                  value={
                    tenant.max_storage_mb >= 1024
                      ? `${(tenant.max_storage_mb / 1024).toFixed(1)} GB`
                      : `${tenant.max_storage_mb} MB`
                  }
                />
                <InfoRow
                  label="Срок тарифа"
                  value={
                    tenant.plan_expires
                      ? new Date(tenant.plan_expires).toLocaleDateString('ru-RU')
                      : 'Без ограничения'
                  }
                />
                <InfoRow label="Создан" value={new Date(tenant.created_at).toLocaleDateString('ru-RU')} />
              </div>

              {/* Действия */}
              <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
                <button onClick={() => setMode('edit')} className="btn-primary">
                  Редактировать
                </button>
                <button onClick={() => setMode('create_user')} className="btn-secondary">
                  + Создать пользователя
                </button>
                {!isMainTenant && (
                  <>
                    <button
                      onClick={handleToggleActive}
                      className="btn-secondary"
                      disabled={loading}
                    >
                      {tenant.is_active ? 'Заблокировать' : 'Разблокировать'}
                    </button>
                    <button
                      onClick={() => setMode('delete')}
                      className="btn-secondary text-red-600 hover:bg-red-50"
                    >
                      Удалить
                    </button>
                  </>
                )}
                {isMainTenant && (
                  <div className="text-xs text-gray-400 self-center">
                    Главный арендатор — защищён от блокировки и удаления
                  </div>
                )}
              </div>
            </div>
          )}

          {mode === 'edit' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Название</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  className="input"
                  disabled={loading}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Тариф</label>
                  <select
                    value={form.plan}
                    onChange={(e) => set('plan', e.target.value)}
                    className="input"
                    disabled={loading}
                  >
                    <option value="free">Free</option>
                    <option value="basic">Basic</option>
                    <option value="pro">Pro</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Срок действия тарифа
                  </label>
                  <input
                    type="date"
                    value={form.plan_expires}
                    onChange={(e) => set('plan_expires', e.target.value)}
                    className="input"
                    disabled={loading}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Пусто = без ограничения
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Лимит альбомов
                  </label>
                  <input
                    type="number"
                    value={form.max_albums}
                    onChange={(e) => set('max_albums', parseInt(e.target.value) || 0)}
                    className="input"
                    min={1}
                    disabled={loading}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Лимит хранилища (МБ)
                  </label>
                  <input
                    type="number"
                    value={form.max_storage_mb}
                    onChange={(e) => set('max_storage_mb', parseInt(e.target.value) || 0)}
                    className="input"
                    min={1}
                    disabled={loading}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Город</label>
                <input
                  type="text"
                  value={form.city}
                  onChange={(e) => set('city', e.target.value)}
                  className="input"
                  disabled={loading}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => set('email', e.target.value)}
                    className="input"
                    disabled={loading}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Телефон</label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={(e) => set('phone', e.target.value)}
                    className="input"
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-4 border-t border-gray-100">
                <button onClick={handleSave} className="btn-primary flex-1" disabled={loading}>
                  {loading ? 'Сохраняем...' : 'Сохранить'}
                </button>
                <button
                  onClick={() => setMode('view')}
                  className="btn-secondary"
                  disabled={loading}
                >
                  Отмена
                </button>
              </div>
            </div>
          )}

          {mode === 'create_user' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">
                Создать сотрудника в «{tenant.name}». Пользователь сможет войти в кабинет /app
                с указанными email и паролем. Укажите свой email если создаёте аккаунт для себя.
              </p>

              {createdUser && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-2">
                  <div className="text-sm font-medium text-green-800">Пользователь создан</div>
                  <div className="text-sm text-green-700">
                    <div><strong>Email:</strong> <code className="bg-white px-1.5 py-0.5 rounded text-xs">{createdUser.email}</code></div>
                    <div className="mt-1"><strong>Пароль:</strong> <code className="bg-white px-1.5 py-0.5 rounded text-xs">{createdUser.password}</code></div>
                  </div>
                  <div className="text-xs text-green-700 pt-2">
                    Пароль больше не будет показан. Запишите его или передайте сотруднику прямо сейчас.
                    Пользователь сможет сменить пароль после входа в /app → Настройки.
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
                <input
                  type="email"
                  value={userForm.email}
                  onChange={e => setUserForm(f => ({ ...f, email: e.target.value }))}
                  className="input"
                  placeholder="user@example.com"
                  disabled={loading}
                  autoComplete="off"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Имя</label>
                <input
                  type="text"
                  value={userForm.full_name}
                  onChange={e => setUserForm(f => ({ ...f, full_name: e.target.value }))}
                  className="input"
                  placeholder="Иван Иванов"
                  disabled={loading}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Пароль <span className="text-gray-400 font-normal">(не короче 8 символов)</span>
                </label>
                <input
                  type="text"
                  value={userForm.password}
                  onChange={e => setUserForm(f => ({ ...f, password: e.target.value }))}
                  className="input font-mono"
                  placeholder="Минимум 8 символов"
                  disabled={loading}
                  autoComplete="off"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Показан открытым, чтобы вы его запомнили. Пользователь сможет его сменить после входа.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Роль</label>
                <div className="flex gap-2 flex-wrap">
                  {(['owner', 'manager', 'viewer'] as const).map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setUserForm(f => ({ ...f, role: r }))}
                      disabled={loading}
                      className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${
                        userForm.role === r
                          ? 'border-gray-900 bg-gray-900 text-white'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {r === 'owner' ? 'Владелец' : r === 'manager' ? 'Менеджер' : 'Наблюдатель'}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  Владелец — полный доступ, включая команду и настройки. Менеджер — работа с альбомами.
                  Наблюдатель — только просмотр.
                </p>
              </div>

              <div className="flex gap-2 pt-2 border-t border-gray-100">
                <button
                  onClick={handleCreateUser}
                  className="btn-primary"
                  disabled={loading || !userForm.email || !userForm.password || !userForm.full_name}
                >
                  {loading ? 'Создаю...' : 'Создать пользователя'}
                </button>
                <button
                  onClick={() => { setMode('view'); setCreatedUser(null) }}
                  className="btn-secondary"
                  disabled={loading}
                >
                  {createdUser ? 'Закрыть' : 'Отмена'}
                </button>
              </div>
            </div>
          )}

          {mode === 'delete' && (
            <div className="space-y-4">
              <div className="bg-red-50 border border-red-100 rounded-xl p-4">
                <div className="font-medium text-red-700 mb-2">⚠ Опасное действие</div>
                <p className="text-sm text-red-600">
                  Вместе с арендатором <strong>«{tenant.name}»</strong> будут удалены:
                </p>
                <ul className="text-sm text-red-600 mt-2 ml-5 list-disc space-y-1">
                  <li>Все альбомы арендатора ({tenant.album_count} шт.)</li>
                  <li>Все сотрудники ({tenant.user_count} чел.)</li>
                  <li>Все ученики, фото, выборы, заявки</li>
                  <li>Вся история действий</li>
                </ul>
                <p className="text-sm text-red-700 font-medium mt-3">
                  Это действие необратимо.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Для подтверждения введите slug арендатора:{' '}
                  <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">{tenant.slug}</code>
                </label>
                <input
                  type="text"
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  className="input font-mono"
                  placeholder={tenant.slug}
                  disabled={loading}
                  autoFocus
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleDelete}
                  className="btn-primary flex-1 bg-red-600 hover:bg-red-700"
                  disabled={loading || deleteConfirm !== tenant.slug}
                >
                  {loading ? 'Удаляем...' : 'Удалить безвозвратно'}
                </button>
                <button
                  onClick={() => {
                    setMode('view')
                    setDeleteConfirm('')
                  }}
                  className="btn-secondary"
                  disabled={loading}
                >
                  Отмена
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 font-medium">{value || <span className="text-gray-300">—</span>}</span>
    </div>
  )
}

// ============================================================
// ОЧЕРЕДЬ РАБОТ (OkeyBook Production Queue)
// ============================================================

const WORKFLOW_LABELS: Record<string, { label: string; color: string }> = {
  submitted:     { label: 'Новый',     color: 'badge-blue' },
  in_production: { label: 'В работе',  color: 'badge-amber' },
  delivered:     { label: 'Готов',     color: 'badge-green' },
}

function QueueView({ queue, loading, selected, onSelect, onRefresh, onNotify }: {
  queue: any[]
  loading: boolean
  selected: any | null
  onSelect: (a: any | null) => void
  onRefresh: () => void
  onNotify: (text: string, type?: 'ok' | 'err') => void
}) {
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [taking, setTaking] = useState(false)
  const [notes, setNotes] = useState('')
  const [uploadingDelivery, setUploadingDelivery] = useState(false)
  const [deliveryLabel, setDeliveryLabel] = useState('Готовый файл вёрстки')
  const [deliveryFiles, setDeliveryFiles] = useState<any[]>([])

  const filtered = statusFilter === 'all'
    ? queue
    : queue.filter(a => a.workflow_status === statusFilter)

  const counts = {
    all: queue.length,
    submitted: queue.filter(a => a.workflow_status === 'submitted').length,
    in_production: queue.filter(a => a.workflow_status === 'in_production').length,
    delivered: queue.filter(a => a.workflow_status === 'delivered').length,
  }

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/workflow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return res.json()
  }

  const handleTake = async () => {
    if (!selected) return
    setTaking(true)
    const res = await post({ action: 'take', album_id: selected.id, notes: notes || null })
    if (res.album) {
      onNotify('Альбом взят в работу')
      onRefresh()
      onSelect({ ...selected, workflow_status: 'in_production' })
    } else {
      onNotify(res.error ?? 'Ошибка', 'err')
    }
    setTaking(false)
  }

  const handleUploadDelivery = async (file: File) => {
    setUploadingDelivery(true)
    const fd = new FormData()
    fd.append('album_id', selected.id)
    fd.append('upload_type', 'delivery')
    fd.append('file', file)
    fd.append('label', deliveryLabel)
    const res = await fetch('/api/workflow', { method: 'POST', body: fd })
    const data = await res.json()
    if (data.record) {
      setDeliveryFiles(prev => [...prev, data.record])
      onNotify('Файл загружен, статус → Готов')
      onRefresh()
    } else {
      onNotify(data.error ?? 'Ошибка загрузки', 'err')
    }
    setUploadingDelivery(false)
  }

  // Загружаем delivery файлы при выборе альбома
  useEffect(() => {
    if (!selected) return
    fetch(`/api/workflow?action=album_workflow&album_id=${selected.id}`)
      .then(r => r.json())
      .then(d => setDeliveryFiles(d.delivery ?? []))
  }, [selected?.id])

  const formatDate = (iso?: string) => iso
    ? new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
    : '—'

  if (loading) return <div className="text-center py-12 text-gray-400">Загрузка...</div>

  return (
    <div className="flex gap-4" style={{ minHeight: '60vh' }}>
      {/* Список альбомов */}
      <div className="w-80 flex-shrink-0">
        {/* Фильтры */}
        <div className="flex gap-1 mb-3 flex-wrap">
          {([
            { k: 'all', l: `Все (${counts.all})` },
            { k: 'submitted', l: `Новые (${counts.submitted})` },
            { k: 'in_production', l: `В работе (${counts.in_production})` },
            { k: 'delivered', l: `Готовы (${counts.delivered})` },
          ]).map(({ k, l }) => (
            <button key={k} onClick={() => setStatusFilter(k)}
              className={`text-xs px-2 py-1 rounded-lg border transition-colors ${
                statusFilter === k ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-500 hover:border-gray-400'
              }`}>
              {l}
            </button>
          ))}
        </div>

        <div className="flex justify-end mb-2">
          <button onClick={onRefresh} className="text-xs text-gray-400 hover:text-gray-600">↻ Обновить</button>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-300 text-sm">Нет альбомов</div>
        ) : (
          <div className="space-y-2">
            {filtered.map(album => {
              const si = WORKFLOW_LABELS[album.workflow_status]
              return (
                <button
                  key={album.id}
                  onClick={() => { onSelect(album); setNotes('') }}
                  className={`w-full text-left p-3 rounded-xl border-2 transition-all ${
                    selected?.id === album.id ? 'border-gray-900 bg-gray-50' : 'border-gray-100 hover:border-gray-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{album.title}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {album.tenants?.name} · {album.student_count} уч.
                      </p>
                    </div>
                    <span className={`badge-${si?.color?.replace('badge-', '') ?? 'gray'} text-xs flex-shrink-0`}>
                      {si?.label}
                    </span>
                  </div>
                  {album.workflow_submitted_at && (
                    <p className="text-xs text-gray-300 mt-1">
                      Передан {formatDate(album.workflow_submitted_at)}
                    </p>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Детали выбранного альбома */}
      <div className="flex-1 border-l border-gray-100 pl-6">
        {!selected ? (
          <div className="flex items-center justify-center h-full text-gray-300 text-sm">
            Выберите альбом из списка
          </div>
        ) : (
          <div className="space-y-5">
            {/* Заголовок */}
            <div>
              <h3 className="text-xl font-bold text-gray-900">{selected.title}</h3>
              <p className="text-sm text-gray-400 mt-0.5">
                {selected.tenants?.name} · {selected.city && `${selected.city} · `}{selected.year} · {selected.student_count} учеников
              </p>
            </div>

            {/* Статус и действия */}
            {selected.workflow_status === 'submitted' && (
              <div className="bg-blue-50 rounded-xl p-4 space-y-3">
                <p className="text-sm font-medium text-blue-800">Новый альбом — возьмите в работу</p>
                <textarea
                  className="input w-full resize-none text-sm"
                  rows={2}
                  placeholder="Комментарий партнёру (необязательно)"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                />
                <button
                  className="btn-primary w-full"
                  onClick={handleTake}
                  disabled={taking}
                >
                  {taking ? 'Берём...' : '✓ Взять в работу'}
                </button>
              </div>
            )}

            {selected.workflow_status === 'in_production' && (
              <div className="bg-amber-50 rounded-xl p-4 space-y-3">
                <p className="text-sm font-medium text-amber-800">В работе — загрузите готовый файл</p>
                <input
                  className="input w-full text-sm"
                  placeholder="Название файла (напр. «Вёрстка PDF»)"
                  value={deliveryLabel}
                  onChange={e => setDeliveryLabel(e.target.value)}
                />
                <label className={`btn-primary w-full flex items-center justify-center gap-2 cursor-pointer ${uploadingDelivery ? 'opacity-60 pointer-events-none' : ''}`}>
                  <input type="file" className="hidden"
                    accept=".pdf,.zip,.rar,.7z,.jpg,.jpeg,.png,.tif,.tiff"
                    onChange={e => e.target.files?.[0] && handleUploadDelivery(e.target.files[0])} />
                  {uploadingDelivery ? 'Загружаем...' : '⬆ Загрузить готовый файл'}
                </label>
              </div>
            )}

            {selected.workflow_status === 'delivered' && (
              <div className="bg-green-50 rounded-xl p-4">
                <p className="text-sm font-medium text-green-800">✓ Готово — файлы переданы партнёру</p>
              </div>
            )}

            {/* Загруженные delivery файлы */}
            {deliveryFiles.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">Переданные файлы</p>
                {deliveryFiles.map(f => (
                  <div key={f.id} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg">
                    <div>
                      <p className="text-sm">{f.label || f.filename}</p>
                      <p className="text-xs text-gray-400">{f.downloaded_at ? '✓ скачан партнёром' : 'ещё не скачан'}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Действия */}
            <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
              <a
                href={`/api/tenant?action=export_csv&album_id=${selected.id}`}
                className="btn-secondary text-sm inline-flex items-center gap-2"
                target="_blank"
              >
                ⬇ CSV
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================
// ПАРТНЁРЫ — просмотр альбомов и статистики каждого тенанта
// ============================================================

function PartnersView({ tenants, selectedTenant, onSelectTenant }: {
  tenants: Tenant[]
  selectedTenant: Tenant | null
  onSelectTenant: (t: Tenant | null) => void
}) {
  const [albums, setAlbums] = useState<any[]>([])
  const [albumsLoading, setAlbumsLoading] = useState(false)
  const [selectedAlbum, setSelectedAlbum] = useState<any | null>(null)
  const [albumDetail, setAlbumDetail] = useState<any | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [search, setSearch] = useState('')

  // Не показываем главный тенант (OkeyBook)
  const partners = tenants.filter(t => t.slug !== 'main' && t.is_active)

  const loadAlbums = async (tenant: Tenant) => {
    setAlbumsLoading(true)
    setSelectedAlbum(null)
    setAlbumDetail(null)
    try {
      // Запрашиваем альбомы через super API
      const r = await fetch(`/api/super?action=tenant_albums&tenant_id=${tenant.id}`)
      const d = await r.json()
      setAlbums(d.albums ?? [])
    } finally {
      setAlbumsLoading(false)
    }
  }

  const loadAlbumDetail = async (album: any) => {
    setSelectedAlbum(album)
    setDetailLoading(true)
    setAlbumDetail(null)
    try {
      const [statsRes, workflowRes] = await Promise.all([
        fetch(`/api/super?action=album_detail&album_id=${album.id}`),
        fetch(`/api/workflow?action=album_workflow&album_id=${album.id}`),
      ])
      const stats = await statsRes.json()
      const workflow = await workflowRes.json()
      setAlbumDetail({ ...stats, workflow: workflow.workflow, originals: workflow.originals ?? [] })
    } finally {
      setDetailLoading(false)
    }
  }

  const selectTenant = (t: Tenant) => {
    onSelectTenant(t)
    loadAlbums(t)
    setSearch('')
  }

  const filteredAlbums = albums.filter(a =>
    !search || a.title?.toLowerCase().includes(search.toLowerCase()) ||
    a.city?.toLowerCase().includes(search.toLowerCase())
  )

  const wfLabel = (s?: string) => ({
    active: '🔵 Отбор', ready: '🟡 Готов', submitted: '🟣 Передан',
    in_production: '🟠 В работе', delivered: '🟢 Готов к получению',
  }[s ?? 'active'] ?? s)

  return (
    <div className="flex gap-4" style={{ minHeight: '70vh' }}>
      {/* Список партнёров */}
      <div className="w-56 flex-shrink-0 border-r border-gray-100 pr-4">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
          Фотографы ({partners.length})
        </h3>
        {partners.length === 0 && (
          <p className="text-sm text-gray-300">Нет активных партнёров</p>
        )}
        <div className="space-y-1">
          {partners.map(t => (
            <button
              key={t.id}
              onClick={() => selectTenant(t)}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${
                selectedTenant?.id === t.id
                  ? 'bg-gray-900 text-white'
                  : 'hover:bg-gray-50 text-gray-700'
              }`}
            >
              <p className="font-medium truncate">{t.name}</p>
              {t.city && <p className={`text-xs truncate ${selectedTenant?.id === t.id ? 'text-gray-300' : 'text-gray-400'}`}>{t.city}</p>}
            </button>
          ))}
        </div>
      </div>

      {/* Список альбомов партнёра */}
      {selectedTenant && (
        <div className="w-64 flex-shrink-0 border-r border-gray-100 pr-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              Альбомы
            </h3>
            <span className="text-xs text-gray-400">{albums.length}</span>
          </div>

          <input
            className="input w-full text-sm mb-3"
            placeholder="Поиск..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />

          {albumsLoading ? (
            <p className="text-sm text-gray-300 text-center py-6">Загрузка...</p>
          ) : filteredAlbums.length === 0 ? (
            <p className="text-sm text-gray-300 text-center py-6">Нет альбомов</p>
          ) : (
            <div className="space-y-1 overflow-y-auto" style={{ maxHeight: '60vh' }}>
              {filteredAlbums.map(a => (
                <button
                  key={a.id}
                  onClick={() => loadAlbumDetail(a)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    selectedAlbum?.id === a.id
                      ? 'bg-gray-900 text-white'
                      : 'hover:bg-gray-50 text-gray-700'
                  }`}
                >
                  <p className="font-medium truncate">{a.title}</p>
                  <p className={`text-xs ${selectedAlbum?.id === a.id ? 'text-gray-300' : 'text-gray-400'}`}>
                    {a.city && `${a.city} · `}{a.year}
                    {a.workflow_status && ` · ${wfLabel(a.workflow_status)}`}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Детали альбома */}
      <div className="flex-1 overflow-y-auto">
        {!selectedTenant && (
          <div className="flex items-center justify-center h-full text-gray-300 text-sm">
            Выберите фотографа слева
          </div>
        )}
        {selectedTenant && !selectedAlbum && (
          <div className="flex items-center justify-center h-full text-gray-300 text-sm">
            Выберите альбом
          </div>
        )}
        {selectedAlbum && (
          <div className="space-y-4">
            {/* Заголовок */}
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-xl font-bold text-gray-900">{selectedAlbum.title}</h3>
                <p className="text-sm text-gray-400">
                  {selectedTenant?.name} · {selectedAlbum.city} · {selectedAlbum.year}
                </p>
              </div>
              <div className="flex gap-2">
                <a
                  href={`/api/workflow?action=album_workflow&album_id=${selectedAlbum.id}`}
                  className="btn-secondary text-xs"
                  onClick={e => { e.preventDefault(); loadAlbumDetail(selectedAlbum) }}
                >
                  ↻
                </a>
                <a
                  href={`/api/tenant?action=export_csv&album_id=${selectedAlbum.id}`}
                  className="btn-secondary text-xs"
                  target="_blank"
                >
                  ⬇ CSV
                </a>
              </div>
            </div>

            {detailLoading ? (
              <p className="text-sm text-gray-400">Загрузка...</p>
            ) : albumDetail ? (
              <>
                {/* Статистика */}
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { l: 'Учеников', v: albumDetail.total ?? 0, c: 'bg-gray-50' },
                    { l: 'Завершили', v: albumDetail.submitted ?? 0, c: 'bg-green-50 text-green-700' },
                    { l: 'В процессе', v: albumDetail.in_progress ?? 0, c: 'bg-blue-50 text-blue-700' },
                    { l: 'Не начали', v: albumDetail.not_started ?? 0, c: 'bg-amber-50 text-amber-700' },
                  ].map(s => (
                    <div key={s.l} className={`rounded-xl p-3 ${s.c}`}>
                      <p className="text-xl font-bold">{s.v}</p>
                      <p className="text-xs opacity-70 mt-0.5">{s.l}</p>
                    </div>
                  ))}
                </div>

                {/* Прогресс */}
                {(albumDetail.total ?? 0) > 0 && (
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden flex">
                    <div className="bg-green-500 h-full" style={{ width: `${Math.round((albumDetail.submitted ?? 0) / albumDetail.total * 100)}%` }} />
                    <div className="bg-blue-400 h-full" style={{ width: `${Math.round((albumDetail.in_progress ?? 0) / albumDetail.total * 100)}%` }} />
                  </div>
                )}

                {/* Workflow статус */}
                <div className="bg-gray-50 rounded-xl p-4">
                  <p className="text-sm font-semibold text-gray-700 mb-1">Статус производства</p>
                  <p className="text-sm text-gray-600">{wfLabel(albumDetail.workflow?.workflow_status)}</p>
                  {albumDetail.workflow?.workflow_notes && (
                    <p className="text-xs text-amber-700 mt-2 bg-amber-50 rounded p-2">{albumDetail.workflow.workflow_notes}</p>
                  )}
                  {albumDetail.originals?.length > 0 && (
                    <p className="text-xs text-gray-400 mt-2">📁 Оригиналов загружено: {albumDetail.originals.length}</p>
                  )}
                </div>

                {/* Список учеников */}
                {albumDetail.children && albumDetail.children.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold text-gray-700 mb-2">Ученики</p>
                    <div className="space-y-1 max-h-64 overflow-y-auto">
                      {albumDetail.children.map((c: any) => (
                        <div key={c.id} className="flex items-center justify-between py-1.5 px-3 bg-gray-50 rounded-lg text-sm">
                          <span className="text-gray-800">{c.full_name}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-gray-400">{c.class}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                              c.submitted_at ? 'bg-green-100 text-green-700' :
                              c.started_at ? 'bg-blue-100 text-blue-700' :
                              'bg-gray-100 text-gray-500'
                            }`}>
                              {c.submitted_at ? 'Завершил' : c.started_at ? 'В процессе' : 'Не начал'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
