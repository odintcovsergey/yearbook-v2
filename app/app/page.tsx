'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

// ============================================================
// ТИПЫ
// ============================================================

type AuthData = {
  authenticated: boolean
  user?: { id: string; email: string; full_name: string; role: string }
  tenant?: {
    id: string
    name: string
    slug: string
    plan: string
    settings?: Record<string, unknown>
  } | null
  isLegacy?: boolean
}

type Album = {
  id: string
  title: string
  city: string | null
  year: number | null
  cover_mode: string
  cover_price: number
  deadline: string | null
  archived: boolean
  created_at: string
  template_title: string
  class_name: string | null
  classes: string[]
  stats: { total: number; submitted: number; in_progress: number }
  teacher_token: string | null
  teachers: { total: number; done: number } | null
}

type Summary = {
  albums_total: number
  albums_active: number
  albums_archived: number
  children_total: number
  children_submitted: number
  leads_total: number
  leads_new: number
}

type Child = {
  id: string
  full_name: string
  class: string
  access_token: string
  submitted_at: string | null
  started_at: string | null
  contact: { parent_name: string; phone: string } | null
  cover: { cover_option: string; surcharge: number } | null
}

type AlbumStats = {
  total: number
  submitted: number
  in_progress: number
  not_started: number
  teachers_total: number
  teachers_done: number
  surcharge_total: number
  surcharge_count: number
}

// ============================================================
// API-хелпер
// ============================================================
let _refreshing: Promise<boolean> | null = null

async function refreshAccessToken(): Promise<boolean> {
  if (_refreshing) return _refreshing
  _refreshing = fetch('/api/auth', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'refresh' }),
  }).then(r => r.ok).catch(() => false).finally(() => { _refreshing = null })
  return _refreshing
}

async function api(path: string, opts?: RequestInit): Promise<Response> {
  const res = await fetch(path, {
    ...opts,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
  })
  if (res.status === 401) {
    const ok = await refreshAccessToken()
    if (ok) {
      return fetch(path, {
        ...opts,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...opts?.headers },
      })
    }
  }
  return res
}

// ============================================================
// ОСНОВНАЯ СТРАНИЦА
// ============================================================

export default function AppPage() {
  const router = useRouter()
  const [auth, setAuth] = useState<AuthData | null>(null)
  const [loading, setLoading] = useState(true)

  const [albums, setAlbums] = useState<Album[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null)
  const [editAlbum, setEditAlbum] = useState<Album | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [filter, setFilter] = useState<'active' | 'archive'>('active')
  const [search, setSearch] = useState('')
  const [msg, setMsg] = useState<{ text: string; type: 'ok' | 'err' } | null>(null)
  const [showLeads, setShowLeads] = useState(false)
  const [showQuotes, setShowQuotes] = useState(false)
  const [showTeam, setShowTeam] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  const notify = (text: string, type: 'ok' | 'err' = 'ok') => {
    setMsg({ text, type })
    setTimeout(() => setMsg(null), 4000)
  }

  const canEdit = auth?.user?.role === 'owner' || auth?.user?.role === 'manager'
  const canManageTeam = auth?.user?.role === 'owner'
  const currentUserId = auth?.user?.id ?? null

  // --- Проверка авторизации ---
  useEffect(() => {
    api('/api/auth')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d?.authenticated || d.isLegacy) {
          router.push('/login')
          return
        }
        if (d.user?.role === 'superadmin') {
          router.push('/super')
          return
        }
        setAuth(d)
        setLoading(false)
      })
      .catch(() => router.push('/login'))
  }, [router])

  // --- Загрузка данных ---
  const loadDashboard = async () => {
    const r = await api('/api/tenant?action=dashboard')
    if (r.ok) {
      const d = await r.json()
      setAlbums(d.albums)
      setSummary(d.summary)
    }
  }

  useEffect(() => {
    if (auth) loadDashboard()
  }, [auth])

  const handleLogout = async () => {
    await api('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'logout' }) })
    router.push('/login')
  }

  const filteredAlbums = albums.filter(a => {
    const matchesFilter = filter === 'active' ? !a.archived : a.archived
    const matchesSearch =
      !search ||
      a.title.toLowerCase().includes(search.toLowerCase()) ||
      (a.city?.toLowerCase().includes(search.toLowerCase()) ?? false)
    return matchesFilter && matchesSearch
  })

  if (loading || !auth) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-400 text-sm">Загрузка...</div>
      </div>
    )
  }

  const roleLabels: Record<string, string> = {
    owner: 'Владелец',
    manager: 'Менеджер',
    viewer: 'Наблюдатель',
  }

  return (
    <div className="min-h-screen">
      {/* Шапка */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1
              className="text-xl font-semibold"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {auth.tenant?.name ?? 'Кабинет'}
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              {auth.user?.full_name} · {roleLabels[auth.user?.role ?? ''] ?? auth.user?.role}
            </p>
          </div>
          <div className="flex items-center gap-2">
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
        {/* Сводка */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <StatCard
              label="Активных альбомов"
              value={summary.albums_active}
              subValue={summary.albums_archived > 0 ? `+ ${summary.albums_archived} в архиве` : undefined}
            />
            <StatCard label="Учеников" value={summary.children_total} />
            <StatCard
              label="Завершили выбор"
              value={summary.children_submitted}
              subValue={
                summary.children_total > 0
                  ? `${Math.round((summary.children_submitted / summary.children_total) * 100)}%`
                  : undefined
              }
            />
            <StatCard
              label="Заявок"
              value={summary.leads_total}
              subValue={summary.leads_new > 0 ? `${summary.leads_new} новых` : undefined}
              highlight={summary.leads_new > 0}
              onClick={() => setShowLeads(true)}
            />
          </div>
        )}

        {/* Вкладки + действия */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
              <button
                onClick={() => setFilter('active')}
                className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                  filter === 'active' ? 'bg-white shadow-sm' : 'text-gray-500'
                }`}
              >
                Актуальные
                {summary && <span className="text-gray-400 ml-1.5">{summary.albums_active}</span>}
              </button>
              <button
                onClick={() => setFilter('archive')}
                className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                  filter === 'archive' ? 'bg-white shadow-sm' : 'text-gray-500'
                }`}
              >
                Архив
                {summary && <span className="text-gray-400 ml-1.5">{summary.albums_archived}</span>}
              </button>
            </div>

            <button
              onClick={() => setShowQuotes(true)}
              className="btn-ghost text-sm"
              type="button"
              title="Управление цитатами"
            >
              Цитаты
            </button>

            {canManageTeam && (
              <button
                onClick={() => setShowTeam(true)}
                className="btn-ghost text-sm"
                type="button"
                title="Сотрудники и приглашения"
              >
                Команда
              </button>
            )}

            <button
              onClick={() => setShowSettings(true)}
              className="btn-ghost text-sm"
              type="button"
              title="Настройки аккаунта"
            >
              Настройки
            </button>

            {canEdit && (
              <button onClick={() => setShowCreate(true)} className="btn-primary">
                + Новый альбом
              </button>
            )}
          </div>

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск альбома..."
            className="input max-w-xs"
          />
        </div>

        {/* Список альбомов */}
        {filteredAlbums.length === 0 ? (
          <div className="card p-12 text-center">
            <div className="text-gray-400 text-sm mb-3">
              {search
                ? 'Ничего не найдено'
                : filter === 'active'
                ? 'Пока нет активных альбомов'
                : 'В архиве ничего нет'}
            </div>
            {filter === 'active' && !search && canEdit && (
              <button onClick={() => setShowCreate(true)} className="btn-primary">
                Создать первый альбом
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredAlbums.map(a => (
              <AlbumCard
                key={a.id}
                album={a}
                canEdit={canEdit}
                onClick={() => setSelectedAlbum(a)}
                onEdit={() => setEditAlbum(a)}
              />
            ))}
          </div>
        )}
      </main>

      {selectedAlbum && (
        <AlbumDetailModal
          album={selectedAlbum}
          canEdit={canEdit}
          onClose={() => setSelectedAlbum(null)}
          onNotify={(msg) => notify(msg, 'ok')}
          onError={(msg) => notify(msg, 'err')}
        />
      )}

      {showCreate && (
        <AlbumFormModal
          mode="create"
          onClose={() => setShowCreate(false)}
          onSuccess={(title) => {
            setShowCreate(false)
            loadDashboard()
            notify(`Альбом «${title}» создан`, 'ok')
          }}
          onError={(text) => notify(text, 'err')}
        />
      )}

      {editAlbum && (
        <AlbumFormModal
          mode="edit"
          album={editAlbum}
          onClose={() => setEditAlbum(null)}
          onSuccess={(title) => {
            setEditAlbum(null)
            loadDashboard()
            notify(`Альбом «${title}» обновлён`, 'ok')
          }}
          onError={(text) => notify(text, 'err')}
          onArchive={() => {
            setEditAlbum(null)
            loadDashboard()
            notify('Альбом отправлен в архив', 'ok')
          }}
          onUnarchive={() => {
            setEditAlbum(null)
            loadDashboard()
            notify('Альбом возвращён из архива', 'ok')
          }}
        />
      )}

      {showLeads && (
        <LeadsModal
          canEdit={canEdit}
          onClose={() => {
            setShowLeads(false)
            loadDashboard() // пересчёт leads_new в summary
          }}
          onNotify={(text) => notify(text, 'ok')}
          onError={(text) => notify(text, 'err')}
        />
      )}

      {showQuotes && (
        <QuotesModal
          canEdit={canEdit}
          onClose={() => setShowQuotes(false)}
          onNotify={(text) => notify(text, 'ok')}
          onError={(text) => notify(text, 'err')}
        />
      )}

      {showTeam && currentUserId && (
        <TeamModal
          currentUserId={currentUserId}
          onClose={() => setShowTeam(false)}
          onNotify={(text) => notify(text, 'ok')}
          onError={(text) => notify(text, 'err')}
        />
      )}

      {showSettings && auth && (
        <SettingsModal
          userRole={auth.user?.role ?? 'viewer'}
          onClose={() => setShowSettings(false)}
          onNotify={(text) => notify(text, 'ok')}
          onError={(text) => notify(text, 'err')}
        />
      )}
    </div>
  )
}

// ============================================================
// КАРТОЧКА АЛЬБОМА
// ============================================================

function AlbumCard({
  album,
  canEdit,
  onClick,
  onEdit,
}: {
  album: Album
  canEdit: boolean
  onClick: () => void
  onEdit: () => void
}) {
  const progress =
    album.stats.total > 0
      ? Math.round((album.stats.submitted / album.stats.total) * 100)
      : 0

  const deadline = album.deadline ? new Date(album.deadline) : null
  const deadlinePassed = deadline && deadline < new Date()
  const daysLeft = deadline
    ? Math.ceil((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null

  return (
    <div
      onClick={onClick}
      className="card p-5 cursor-pointer hover:border-gray-300 transition-colors relative"
    >
      {canEdit && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
          className="absolute top-4 right-4 w-8 h-8 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 flex items-center justify-center transition-colors"
          title="Настройки альбома"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      )}

      <div className="flex items-start justify-between gap-3 mb-3 pr-8">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-gray-900 truncate">{album.title}</h3>
          <div className="flex items-center gap-2 mt-1 text-xs text-gray-500 flex-wrap">
            {album.city && <span>{album.city}</span>}
            {album.year && (
              <>
                {album.city && <span>·</span>}
                <span>{album.year}</span>
              </>
            )}
            {album.classes && album.classes.length > 0 && (
              <>
                <span>·</span>
                <span className="font-medium text-gray-700">{album.classes.join(', ')}</span>
              </>
            )}
            {deadline && (
              <>
                <span>·</span>
                <span className={deadlinePassed ? 'text-red-600' : daysLeft && daysLeft < 7 ? 'text-amber-600' : ''}>
                  {deadlinePassed
                    ? 'дедлайн прошёл'
                    : daysLeft === 0
                    ? 'дедлайн сегодня'
                    : `осталось ${daysLeft} дн.`}
                </span>
              </>
            )}
          </div>
          {album.template_title && (
            <div className="mt-1 text-xs text-gray-400">
              {album.template_title}
            </div>
          )}
        </div>
      </div>

      {/* Прогресс-бар с процентом */}
      <div className="flex items-center gap-3 mb-3">
        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gray-900 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="text-sm font-semibold text-gray-900 flex-shrink-0 w-10 text-right">
          {progress}%
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>
          <span className="font-medium text-gray-900">{album.stats.submitted}</span>
          {' из '}
          <span className="text-gray-700">{album.stats.total}</span>
          {' учеников'}
        </span>
        {album.stats.in_progress > 0 && (
          <span className="badge-amber">{album.stats.in_progress} в процессе</span>
        )}
      </div>

      {album.teachers && album.teachers.total > 0 && (
        <div className="mt-2 text-xs text-gray-500 pt-2 border-t border-gray-100">
          Учителя:{' '}
          <span className="text-gray-700">
            {album.teachers.done} / {album.teachers.total}
          </span>
        </div>
      )}
    </div>
  )
}

// ============================================================
// СТАТИСТИКА — карточка
// ============================================================

function StatCard({
  label,
  value,
  subValue,
  highlight,
  onClick,
}: {
  label: string
  value: number
  subValue?: string
  highlight?: boolean
  onClick?: () => void
}) {
  const baseClass = `card p-5 ${highlight ? 'border-blue-200 bg-blue-50' : ''}`
  const content = (
    <>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="flex items-baseline gap-2">
        <div className="text-2xl font-semibold text-gray-900">{value}</div>
        {subValue && (
          <div className={`text-sm ${highlight ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>
            {subValue}
          </div>
        )}
      </div>
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${baseClass} text-left hover:border-gray-300 transition-colors cursor-pointer w-full`}
      >
        {content}
      </button>
    )
  }

  return <div className={baseClass}>{content}</div>
}

// ============================================================
// МОДАЛКА ДЕТАЛЕЙ АЛЬБОМА (с управлением учениками)
// ============================================================

function AlbumDetailModal({
  album,
  canEdit,
  onClose,
  onNotify,
  onError,
}: {
  album: Album
  canEdit: boolean
  onClose: () => void
  onNotify: (msg: string) => void
  onError: (msg: string) => void
}) {
  const [stats, setStats] = useState<AlbumStats | null>(null)
  const [children, setChildren] = useState<Child[]>([])
  const [loading, setLoading] = useState(true)
  const [backdropStart, setBackdropStart] = useState(false)
  const [tab, setTab] = useState<'overview' | 'children' | 'teachers' | 'responsible' | 'photos'>('overview')

  // UI состояние для добавления/импорта
  const [showAddForm, setShowAddForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [addName, setAddName] = useState('')
  const [addClass, setAddClass] = useState('')
  const [busy, setBusy] = useState(false)
  const [selectedChild, setSelectedChild] = useState<Child | null>(null)
  const [childDetails, setChildDetails] = useState<Record<string, any>>({})
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null)

  const loadChildDetails = async (childId: string) => {
    if (childDetails[childId]) return
    setLoadingDetail(childId)
    try {
      const r = await api(`/api/tenant?action=child_details&child_id=${childId}`)
      if (r.ok) {
        const d = await r.json()
        setChildDetails(prev => ({ ...prev, [childId]: d }))
      }
    } finally {
      setLoadingDetail(null)
    }
  }
  const [exporting, setExporting] = useState(false)
  const [showReminder, setShowReminder] = useState(false)

  const handleBackdropMouseDown = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) setBackdropStart(true)
  }
  const handleBackdropMouseUp = (e: React.MouseEvent) => {
    if (backdropStart && e.target === e.currentTarget) onClose()
    setBackdropStart(false)
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const res = await api(`/api/tenant?action=export_csv&album_id=${album.id}`)
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        onError(d.error ?? 'Не удалось экспортировать')
        return
      }
      const blob = await res.blob()

      // имя файла из Content-Disposition (url-encoded)
      const cd = res.headers.get('Content-Disposition') ?? ''
      const m = cd.match(/filename="([^"]+)"/)
      const filename = m ? decodeURIComponent(m[1]) : `album-${album.id}.csv`

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      onNotify('CSV скачан')
    } catch (e: any) {
      onError(e?.message ?? 'Ошибка экспорта')
    } finally {
      setExporting(false)
    }
  }

  const load = async () => {
    const [s, c] = await Promise.all([
      api(`/api/tenant?action=album_stats&album_id=${album.id}`).then(r => r.json()),
      api(`/api/tenant?action=children&album_id=${album.id}`).then(r => r.json()),
    ])
    setStats(s)
    setChildren(Array.isArray(c) ? c : [])
    setLoading(false)
  }

  useEffect(() => {
    load().catch(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [album.id])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!addName.trim() || !addClass.trim()) return
    setBusy(true)
    const r = await api('/api/tenant', {
      method: 'POST',
      body: JSON.stringify({
        action: 'add_child',
        album_id: album.id,
        full_name: addName,
        class: addClass,
      }),
    })
    if (r.ok) {
      onNotify(`Добавлен: ${addName.trim()}`)
      setAddName('')
      // Класс оставляем — удобно добавлять подряд
      await load()
    } else {
      const d = await r.json().catch(() => ({}))
      onError(d.error ?? 'Не удалось добавить')
    }
    setBusy(false)
  }

  const handleReset = async (child: Child) => {
    if (!confirm(`Сбросить выбор у «${child.full_name}»? Все выбранные фото и контакты будут удалены.`)) return
    setBusy(true)
    const r = await api('/api/tenant', {
      method: 'POST',
      body: JSON.stringify({ action: 'reset_child', child_id: child.id }),
    })
    if (r.ok) {
      onNotify(`Выбор сброшен: ${child.full_name}`)
      await load()
      setSelectedChild(null)
    } else {
      const d = await r.json().catch(() => ({}))
      onError(d.error ?? 'Не удалось сбросить')
    }
    setBusy(false)
  }

  const handleDelete = async (child: Child) => {
    if (!confirm(`Полностью удалить «${child.full_name}»? Это действие необратимо.`)) return
    setBusy(true)
    const r = await api('/api/tenant', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete_child', child_id: child.id }),
    })
    if (r.ok) {
      onNotify(`Удалён: ${child.full_name}`)
      await load()
      setSelectedChild(null)
    } else {
      const d = await r.json().catch(() => ({}))
      onError(d.error ?? 'Не удалось удалить')
    }
    setBusy(false)
  }

  const copyChildLink = async (child: Child) => {
    const url = `${window.location.origin}/${child.access_token}`
    try {
      await navigator.clipboard.writeText(url)
      onNotify(`Ссылка скопирована для ${child.full_name}`)
    } catch {
      onError('Не удалось скопировать. Ссылка: ' + url)
    }
  }

  const handleImportComplete = async (added: number, skipped: number) => {
    setShowImport(false)
    if (added > 0) {
      onNotify(`Добавлено: ${added}${skipped > 0 ? `, пропущено: ${skipped}` : ''}`)
      await load()
    } else if (skipped > 0) {
      onNotify(`Все ${skipped} строк пропущены (дубликаты)`)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-40 flex items-start justify-center py-8 px-4 overflow-y-auto"
      onMouseDown={handleBackdropMouseDown}
      onMouseUp={handleBackdropMouseUp}
    >
      <div className="bg-white rounded-2xl max-w-3xl w-full shadow-xl my-auto">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white rounded-t-2xl">
          <div>
            <h3 className="text-lg font-semibold">{album.title}</h3>
            <div className="text-xs text-gray-500 mt-0.5">
              {album.city && `${album.city} · `}
              {album.year && `${album.year} · `}
              {album.deadline && `до ${new Date(album.deadline).toLocaleDateString('ru-RU')}`}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {(() => {
              const unfinished = children.filter(c => !c.submitted_at).length
              if (unfinished === 0) return null
              return (
                <button
                  onClick={() => setShowReminder(true)}
                  type="button"
                  className="btn-secondary text-xs px-3 py-1.5"
                  title="Сгенерировать текст напоминания"
                >
                  🔔 Напомнить · {unfinished}
                </button>
              )
            })()}
            <button
              onClick={handleExport}
              type="button"
              disabled={exporting}
              className="btn-secondary text-xs px-3 py-1.5"
              title="Скачать CSV для вёрстки"
            >
              {exporting ? 'Готовим…' : '⬇ CSV'}
            </button>
            <button
              onClick={onClose}
              type="button"
              className="text-gray-400 hover:text-gray-700 text-xl leading-none"
            >
              ×
            </button>
          </div>
        </div>

        {/* Вкладки */}
        <div className="px-6 pt-4 border-b border-gray-100 flex gap-1 overflow-x-auto">
          {([
            { id: 'overview', label: 'Обзор' },
            { id: 'children', label: 'Ученики' },
            { id: 'photos', label: 'Фото' },
            { id: 'teachers', label: 'Учителя' },
            { id: 'responsible', label: 'Ответственный' },
          ] as const).map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                tab === t.id
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-6">
          {loading ? (
            <div className="text-center text-gray-400 text-sm py-8">Загружаем данные...</div>
          ) : (
            <>
              {/* Вкладка Обзор */}
              {tab === 'overview' && stats && (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                    <MiniStat label="Всего" value={stats.total} />
                    <MiniStat label="Завершили" value={stats.submitted} tone="green" />
                    <MiniStat label="В процессе" value={stats.in_progress} tone="amber" />
                    <MiniStat label="Не начали" value={stats.not_started} tone="gray" />
                  </div>

                  {(stats.teachers_total > 0 || stats.surcharge_count > 0) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
                      {stats.teachers_total > 0 && (
                        <div className="bg-gray-50 rounded-xl p-4">
                          <div className="text-xs text-gray-500">Учителя</div>
                          <div className="text-lg font-semibold mt-1">
                            {stats.teachers_done}
                            <span className="text-gray-400"> / {stats.teachers_total}</span>
                          </div>
                        </div>
                      )}
                      {stats.surcharge_count > 0 && (
                        <div className="bg-gray-50 rounded-xl p-4">
                          <div className="text-xs text-gray-500">Доплаты за обложку</div>
                          <div className="text-lg font-semibold mt-1">
                            {stats.surcharge_total}₽
                            <span className="text-gray-400 text-sm"> · {stats.surcharge_count} чел.</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* Вкладка Ученики */}
              {tab === 'children' && (
              <div>
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <h4 className="font-medium">
                    Ученики
                    <span className="text-gray-400 font-normal ml-2">{children.length}</span>
                  </h4>
                  {canEdit && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowImport(false)
                          setShowAddForm(s => !s)
                        }}
                        className="btn-secondary text-xs px-3 py-1.5"
                      >
                        {showAddForm ? 'Скрыть' : '+ Добавить'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddForm(false)
                          setShowImport(s => !s)
                        }}
                        className="btn-secondary text-xs px-3 py-1.5"
                      >
                        {showImport ? 'Скрыть' : 'Импорт CSV'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Форма добавления одного ученика */}
                {canEdit && showAddForm && (
                  <form
                    onSubmit={handleAdd}
                    className="bg-gray-50 rounded-xl p-4 mb-3 flex gap-2 flex-wrap"
                  >
                    <input
                      type="text"
                      value={addName}
                      onChange={(e) => setAddName(e.target.value)}
                      placeholder="Фамилия Имя"
                      className="input flex-1 min-w-[180px]"
                      autoFocus
                      required
                      disabled={busy}
                    />
                    <input
                      type="text"
                      value={addClass}
                      onChange={(e) => setAddClass(e.target.value)}
                      placeholder="11А"
                      className="input w-24"
                      required
                      disabled={busy}
                    />
                    <button type="submit" className="btn-primary" disabled={busy}>
                      {busy ? '...' : 'Добавить'}
                    </button>
                  </form>
                )}

                {/* Импорт CSV */}
                {canEdit && showImport && (
                  <CSVImportBlock
                    albumId={album.id}
                    onDone={handleImportComplete}
                    onError={onError}
                  />
                )}

                {children.length === 0 ? (
                  <div className="text-center text-gray-400 text-sm py-8 bg-gray-50 rounded-xl">
                    В альбоме пока нет учеников
                  </div>
                ) : (
                  <div className="border border-gray-100 rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 border-b border-gray-100">
                          <tr className="text-left text-xs font-medium text-gray-500 uppercase">
                            <th className="px-4 py-2.5">ФИО</th>
                            <th className="px-4 py-2.5">Класс</th>
                            <th className="px-4 py-2.5">Статус</th>
                            <th className="px-4 py-2.5">Телефон</th>
                            <th className="px-4 py-2.5 text-right">Действия</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {children.map(c => (
                            <React.Fragment key={c.id}>
                              <tr
                                className={`hover:bg-gray-50 cursor-pointer ${
                                  selectedChild?.id === c.id ? 'bg-gray-50' : ''
                                }`}
                                onClick={() => {
                                  const next = selectedChild?.id === c.id ? null : c
                                  setSelectedChild(next)
                                  if (next && next.submitted_at) loadChildDetails(next.id)
                                }}
                              >
                                <td className="px-4 py-2.5 font-medium text-gray-900">
                                  {c.full_name}
                                </td>
                                <td className="px-4 py-2.5 text-gray-500">{c.class}</td>
                                <td className="px-4 py-2.5">
                                  {c.submitted_at ? (
                                    <span className="badge-green">Завершил</span>
                                  ) : c.started_at ? (
                                    <span className="badge-amber">В процессе</span>
                                  ) : (
                                    <span className="badge-gray">Не начал</span>
                                  )}
                                </td>
                                <td className="px-4 py-2.5 text-gray-500 text-xs">
                                  {c.contact?.phone ?? '—'}
                                </td>
                                <td className="px-4 py-2.5 text-right">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      copyChildLink(c)
                                    }}
                                    className="text-xs text-blue-600 hover:text-blue-800 px-2 py-1"
                                    title="Скопировать ссылку"
                                  >
                                    Ссылка
                                  </button>
                                </td>
                              </tr>
                              {selectedChild?.id === c.id && (
                                <tr className="bg-gray-50">
                                  <td colSpan={5} className="px-4 py-3 border-t border-gray-100">
                                    {/* Кнопки действий — только для canEdit */}
                                    {canEdit && (
                                      <div className="flex flex-wrap gap-2 items-center mb-3">
                                        <span className="text-xs text-gray-500 mr-2">
                                          Действия для {c.full_name}:
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => copyChildLink(c)}
                                          className="text-xs btn-secondary px-3 py-1.5"
                                        >
                                          Скопировать ссылку
                                        </button>
                                        {(c.submitted_at || c.started_at) && (
                                          <button
                                            type="button"
                                            onClick={() => handleReset(c)}
                                            className="text-xs btn-secondary px-3 py-1.5 text-amber-700"
                                            disabled={busy}
                                          >
                                            Сбросить выбор
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          onClick={() => handleDelete(c)}
                                          className="text-xs btn-secondary px-3 py-1.5 text-red-600"
                                          disabled={busy}
                                        >
                                          Удалить ученика
                                        </button>
                                      </div>
                                    )}
                                    {/* Детали выбора — если завершил */}
                                    {c.submitted_at && (() => {
                                      const det = childDetails[c.id]
                                      if (loadingDetail === c.id) return (
                                        <p className="text-xs text-gray-400 py-1">Загружаем выбор…</p>
                                      )
                                      if (!det) return null
                                      const portrait = det.selections?.find((s: any) => s.type === 'portrait_page')
                                      const cover = det.selections?.find((s: any) => s.type === 'portrait_cover')
                                      const groups = det.selections?.filter((s: any) => s.type === 'group') ?? []
                                      return (
                                        <div className="flex flex-wrap gap-4 items-start">
                                          {portrait && (
                                            <div className="flex flex-col gap-1 items-center">
                                              <img src={portrait.thumb || portrait.url} alt="Портрет"
                                                className="w-20 h-20 object-cover rounded-lg border border-gray-200" />
                                              <span className="text-xs text-gray-400">Портрет</span>
                                            </div>
                                          )}
                                          {cover && (
                                            <div className="flex flex-col gap-1 items-center">
                                              <img src={cover.thumb || cover.url} alt="Обложка"
                                                className="w-20 h-20 object-cover rounded-lg border border-gray-200" />
                                              <span className="text-xs text-amber-600">Обложка +{det.cover?.surcharge ?? 0} ₽</span>
                                            </div>
                                          )}
                                          {groups.map((g: any, i: number) => (
                                            <div key={i} className="flex flex-col gap-1 items-center">
                                              <img src={g.thumb || g.url} alt={`Фото ${i+1}`}
                                                className="w-20 h-20 object-cover rounded-lg border border-gray-200" />
                                              <span className="text-xs text-gray-400">С друзьями {i+1}</span>
                                            </div>
                                          ))}
                                          <div className="flex flex-col gap-1 text-xs text-gray-600 justify-center min-w-0">
                                            {det.text && (
                                              <div className="italic text-gray-500 max-w-xs">«{det.text}»</div>
                                            )}
                                            {det.contact && (
                                              <div className="text-gray-500">
                                                {det.contact.parent_name && <div>{det.contact.parent_name}</div>}
                                                {det.contact.phone && <div>{det.contact.phone}</div>}
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      )
                                    })()}
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
              )}

              {/* Вкладка Фото */}
              {tab === 'photos' && (
                <PhotosTab
                  albumId={album.id}
                  archived={album.archived}
                  canEdit={canEdit}
                  children={children}
                  onNotify={onNotify}
                  onError={onError}
                />
              )}

              {/* Вкладка Учителя */}
              {tab === 'teachers' && (
                <TeachersTab
                  albumId={album.id}
                  canEdit={canEdit}
                  onNotify={onNotify}
                  onError={onError}
                />
              )}

              {/* Вкладка Ответственный родитель */}
              {tab === 'responsible' && (
                <ResponsibleTab
                  albumId={album.id}
                  canEdit={canEdit}
                  onNotify={onNotify}
                  onError={onError}
                />
              )}
            </>
          )}
        </div>
      </div>

      {showReminder && (
        <ReminderModal
          album={album}
          childList={children}
          onClose={() => setShowReminder(false)}
          onNotify={onNotify}
          onError={onError}
        />
      )}
    </div>
  )
}

function MiniStat({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: number
  tone?: 'default' | 'green' | 'amber' | 'gray'
}) {
  const tones: Record<string, string> = {
    default: 'bg-gray-50 text-gray-900',
    green: 'bg-green-50 text-green-700',
    amber: 'bg-amber-50 text-amber-700',
    gray: 'bg-gray-50 text-gray-500',
  }
  return (
    <div className={`rounded-xl p-4 ${tones[tone]}`}>
      <div className="text-xs opacity-70 mb-0.5">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  )
}

// ============================================================
// МОДАЛКА СОЗДАНИЯ / РЕДАКТИРОВАНИЯ АЛЬБОМА
// ============================================================

type Template = {
  id: string
  title: string
  cover_mode: string
  cover_price: number
  group_enabled: boolean
  group_min: number
  group_max: number
  group_exclusive: boolean
  text_enabled: boolean
  text_max_chars: number
  text_type?: string
}

type FormData = {
  title: string
  city: string
  year: string
  deadline: string
  cover_mode: string
  cover_price: string
  group_enabled: boolean
  group_min: string
  group_max: string
  group_exclusive: boolean
  text_enabled: boolean
  text_max_chars: string
  text_type: string
  template_title: string
  class_name: string
}

const textTypeOptions = [
  { v: 'free', l: 'Свободный' },
  { v: 'garden', l: 'Детский сад' },
  { v: 'grade4', l: '4 класс' },
  { v: 'grade11', l: '9-11 класс' },
]

function emptyForm(): FormData {
  return {
    title: '',
    city: '',
    year: String(new Date().getFullYear()),
    deadline: '',
    cover_mode: 'optional',
    cover_price: '300',
    group_enabled: true,
    group_min: '2',
    group_max: '2',
    group_exclusive: true,
    text_enabled: true,
    text_max_chars: '500',
    text_type: 'free',
    template_title: '',
    class_name: '',
  }
}

function AlbumFormModal({
  mode,
  album,
  onClose,
  onSuccess,
  onError,
  onArchive,
  onUnarchive,
}: {
  mode: 'create' | 'edit'
  album?: Album
  onClose: () => void
  onSuccess: (title: string) => void
  onError: (msg: string) => void
  onArchive?: () => void
  onUnarchive?: () => void
}) {
  const [form, setForm] = useState<FormData>(() => {
    if (mode === 'edit' && album) {
      return {
        title: album.title,
        city: album.city ?? '',
        year: String(album.year ?? new Date().getFullYear()),
        deadline: album.deadline ? album.deadline.slice(0, 10) : '',
        cover_mode: album.cover_mode,
        cover_price: String(album.cover_price ?? 0),
        group_enabled: (album as any).group_enabled ?? true,
        group_min: String((album as any).group_min ?? 2),
        group_max: String((album as any).group_max ?? 2),
        group_exclusive: (album as any).group_exclusive ?? true,
        text_enabled: (album as any).text_enabled ?? true,
        text_max_chars: String((album as any).text_max_chars ?? 500),
        text_type: (album as any).text_type ?? 'free',
        template_title: (album as any).template_title ?? '',
        class_name: ((album as any).classes ?? []).join(', '),
      }
    }
    return emptyForm()
  })

  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(false)
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [backdropStart, setBackdropStart] = useState(false)

  const handleBackdropMouseDown = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) setBackdropStart(true)
  }
  const handleBackdropMouseUp = (e: React.MouseEvent) => {
    if (backdropStart && e.target === e.currentTarget) onClose()
    setBackdropStart(false)
  }

  const set = <K extends keyof FormData>(k: K, v: FormData[K]) =>
    setForm(f => ({ ...f, [k]: v }))

  // Загружаем шаблоны (только для create)
  useEffect(() => {
    if (mode === 'create') {
      api('/api/tenant?action=templates')
        .then(r => r.ok ? r.json() : [])
        .then(setTemplates)
        .catch(() => setTemplates([]))
    }
  }, [mode])

  const applyTemplate = (t: Template) => {
    setForm(f => ({
      ...f,
      cover_mode: t.cover_mode,
      cover_price: String(t.cover_price ?? 0),
      group_enabled: t.group_enabled,
      group_min: String(t.group_min),
      group_max: String(t.group_max),
      group_exclusive: t.group_exclusive,
      text_enabled: t.text_enabled,
      text_max_chars: String(t.text_max_chars),
      text_type: t.text_type ?? 'free',
      template_title: t.title,
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) {
      onError('Название обязательно')
      return
    }

    setLoading(true)

    const payload: Record<string, unknown> = {
      title: form.title.trim(),
      city: form.city.trim() || null,
      year: parseInt(form.year) || new Date().getFullYear(),
      deadline: form.deadline ? new Date(form.deadline + 'T23:59:59').toISOString() : null,
      cover_mode: form.cover_mode,
      cover_price: parseInt(form.cover_price) || 0,
      group_enabled: form.group_enabled,
      group_min: parseInt(form.group_min) || 0,
      group_max: parseInt(form.group_max) || 0,
      group_exclusive: form.group_exclusive,
      text_enabled: form.text_enabled,
      text_max_chars: parseInt(form.text_max_chars) || 500,
      text_type: form.text_type,
      classes: form.class_name.trim()
        ? form.class_name.split(',').map(s => s.trim()).filter(Boolean)
        : [],
    }

    if (mode === 'create') {
      payload.action = 'create_album'
    } else {
      payload.action = 'update_album'
      payload.album_id = album!.id
    }
    payload.template_title = form.template_title || null

    const r = await api('/api/tenant', {
      method: 'POST',
      body: JSON.stringify(payload),
    })

    if (r.ok) {
      onSuccess(form.title.trim())
    } else {
      const d = await r.json().catch(() => ({}))
      onError(d.error ?? 'Ошибка сохранения')
      setLoading(false)
    }
  }

  const handleArchive = async () => {
    if (!album) return
    setLoading(true)
    const r = await api('/api/tenant', {
      method: 'POST',
      body: JSON.stringify({ action: 'archive_album', album_id: album.id }),
    })
    if (r.ok) {
      onArchive?.()
    } else {
      const d = await r.json().catch(() => ({}))
      onError(d.error ?? 'Не удалось архивировать')
      setLoading(false)
    }
  }

  const handleUnarchive = async () => {
    if (!album) return
    setLoading(true)
    const r = await api('/api/tenant', {
      method: 'POST',
      body: JSON.stringify({ action: 'unarchive_album', album_id: album.id }),
    })
    if (r.ok) {
      onUnarchive?.()
    } else {
      const d = await r.json().catch(() => ({}))
      onError(d.error ?? 'Не удалось вернуть из архива')
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!album) return
    setLoading(true)
    const r = await api('/api/tenant', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete_album', album_id: album.id }),
    })
    if (r.ok) {
      onArchive?.() // reuse callback — обновляет список
    } else {
      const d = await r.json().catch(() => ({}))
      onError(d.error ?? 'Не удалось удалить альбом')
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-40 flex items-start justify-center py-8 px-4 overflow-y-auto"
      onMouseDown={handleBackdropMouseDown}
      onMouseUp={handleBackdropMouseUp}
    >
      <div className="bg-white rounded-2xl max-w-2xl w-full shadow-xl my-auto">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white rounded-t-2xl">
          <h3 className="text-lg font-semibold">
            {mode === 'create' ? 'Новый альбом' : 'Настройки альбома'}
          </h3>
          <button
            onClick={onClose}
            type="button"
            className="text-gray-400 hover:text-gray-700 text-xl leading-none"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Класс */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Класс
            </label>
            <input
              type="text"
              value={form.class_name}
              onChange={(e) => set('class_name', e.target.value)}
              className="input"
              placeholder="11А или 4Б, 4В"
              disabled={loading}
            />
            <p className="text-xs text-gray-400 mt-1">
              Отображается на карточке проекта. Несколько классов — через запятую.
            </p>
          </div>

          {/* Комплектация */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Комплектация
            </label>
            {mode === 'create' && templates.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {templates.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => applyTemplate(t)}
                    className={`px-3 py-1.5 rounded-xl text-sm border transition-colors ${
                      form.template_title === t.title
                        ? 'border-gray-900 bg-gray-900 text-white'
                        : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {t.title}
                  </button>
                ))}
              </div>
            )}
            <input
              type="text"
              value={form.template_title}
              onChange={(e) => set('template_title', e.target.value)}
              className="input"
              placeholder="Стандарт, Расширенный..."
              disabled={loading}
            />
            {mode === 'create'
              ? <p className="text-xs text-gray-500 mt-1">Выберите шаблон выше — он заполнит все настройки автоматически.</p>
              : <p className="text-xs text-gray-400 mt-1">Смена комплектации не сбрасывает уже сделанные выборы.</p>
            }
          </div>

          {/* Название */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Название <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              className="input"
              placeholder="Выпускной 11А, Школа 42"
              required
              disabled={loading}
            />
          </div>

          {/* Город и год */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Город
              </label>
              <input
                type="text"
                value={form.city}
                onChange={(e) => set('city', e.target.value)}
                className="input"
                placeholder="Москва"
                disabled={loading}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Год выпуска
              </label>
              <input
                type="number"
                value={form.year}
                onChange={(e) => set('year', e.target.value)}
                className="input"
                min={2020}
                max={2099}
                disabled={loading}
              />
            </div>
          </div>

          {/* Дедлайн */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Дедлайн выбора фотографий
            </label>
            <input
              type="date"
              value={form.deadline}
              onChange={(e) => set('deadline', e.target.value)}
              className="input"
              disabled={loading}
            />
            <p className="text-xs text-gray-500 mt-1">
              После этой даты родители не смогут открыть ссылки
            </p>
          </div>

          {/* Обложка */}
          <div className="border-t border-gray-100 pt-5">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Обложка (второе портретное фото)
            </label>
            <div className="flex flex-wrap gap-2 mb-3">
              {[
                { v: 'required', l: 'Обязательна (все платят)' },
                { v: 'optional', l: 'На выбор (+ доплата)' },
              ].map(({ v, l }) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => set('cover_mode', v)}
                  className={`px-3 py-1.5 rounded-xl text-sm border transition-colors ${
                    form.cover_mode === v
                      ? 'border-gray-900 bg-gray-900 text-white'
                      : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}
                  disabled={loading}
                >
                  {l}
                </button>
              ))}
            </div>
            {form.cover_mode === 'optional' && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Доплата за другое фото на обложку (₽)
                </label>
                <input
                  type="number"
                  value={form.cover_price}
                  onChange={(e) => set('cover_price', e.target.value)}
                  className="input"
                  min={0}
                  disabled={loading}
                />
              </div>
            )}
          </div>

          {/* Групповые фото */}
          <div className="border-t border-gray-100 pt-5">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3">
              <input
                type="checkbox"
                checked={form.group_enabled}
                onChange={(e) => set('group_enabled', e.target.checked)}
                className="rounded"
                disabled={loading}
              />
              Групповые фото (с друзьями)
            </label>
            {form.group_enabled && (
              <div className="space-y-3 pl-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      Минимум фото
                    </label>
                    <input
                      type="number"
                      value={form.group_min}
                      onChange={(e) => set('group_min', e.target.value)}
                      className="input"
                      min={0}
                      disabled={loading}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      Максимум фото
                    </label>
                    <input
                      type="number"
                      value={form.group_max}
                      onChange={(e) => set('group_max', e.target.value)}
                      className="input"
                      min={0}
                      disabled={loading}
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={form.group_exclusive}
                    onChange={(e) => set('group_exclusive', e.target.checked)}
                    className="rounded"
                    disabled={loading}
                  />
                  Эксклюзивность: если ученик выбрал групповое фото — оно резервируется
                </label>
              </div>
            )}
          </div>

          {/* Текст от ученика */}
          <div className="border-t border-gray-100 pt-5">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3">
              <input
                type="checkbox"
                checked={form.text_enabled}
                onChange={(e) => set('text_enabled', e.target.checked)}
                className="rounded"
                disabled={loading}
              />
              Текст от ученика
            </label>
            {form.text_enabled && (
              <div className="space-y-3 pl-6">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    Тип текста
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {textTypeOptions.map(({ v, l }) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => set('text_type', v)}
                        className={`px-3 py-1.5 rounded-xl text-sm border transition-colors ${
                          form.text_type === v
                            ? 'border-gray-900 bg-gray-900 text-white'
                            : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                        }`}
                        disabled={loading}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    Максимум символов
                  </label>
                  <input
                    type="number"
                    value={form.text_max_chars}
                    onChange={(e) => set('text_max_chars', e.target.value)}
                    className="input"
                    min={50}
                    max={5000}
                    disabled={loading}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Действия */}
          <div className="flex gap-3 pt-4 border-t border-gray-100">
            <button type="submit" className="btn-primary flex-1" disabled={loading}>
              {loading
                ? 'Сохраняем...'
                : mode === 'create'
                ? 'Создать альбом'
                : 'Сохранить изменения'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
              disabled={loading}
            >
              Отмена
            </button>
          </div>

          {/* Архив — только при редактировании */}
          {mode === 'edit' && album && (
            <div className="pt-5 border-t border-gray-100">
              {!album.archived ? (
                !showArchiveConfirm ? (
                  <button
                    type="button"
                    onClick={() => setShowArchiveConfirm(true)}
                    className="text-sm text-gray-500 hover:text-red-600 transition-colors"
                    disabled={loading}
                  >
                    Отправить альбом в архив
                  </button>
                ) : (
                  <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                    <div className="font-medium text-amber-800 mb-2 text-sm">
                      Подтвердите архивирование
                    </div>
                    <p className="text-sm text-amber-700 mb-3">
                      Все фотографии альбома будут{' '}
                      <strong>удалены с сервера</strong> для освобождения места.
                      Ссылки для родителей перестанут работать. Статистика, выборы,
                      контакты и тексты сохранятся.
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleArchive}
                        className="btn-primary bg-amber-600 hover:bg-amber-700 text-sm px-3 py-1.5"
                        disabled={loading}
                      >
                        {loading ? 'Архивируем...' : 'Да, в архив'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowArchiveConfirm(false)}
                        className="btn-secondary text-sm px-3 py-1.5"
                        disabled={loading}
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                )
              ) : (
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={handleUnarchive}
                    className="btn-secondary"
                    disabled={loading}
                  >
                    Вернуть из архива
                  </button>
                </div>
              )}

              {/* Удаление — всегда в режиме edit */}
              {!showDeleteConfirm ? (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="text-sm text-gray-400 hover:text-red-600 transition-colors mt-3 block"
                  disabled={loading}
                >
                  Удалить альбом навсегда
                </button>
              ) : (
                <div className="bg-red-50 border border-red-100 rounded-xl p-4 mt-3">
                  <div className="font-medium text-red-800 mb-2 text-sm">
                    Удаление необратимо
                  </div>
                  <p className="text-sm text-red-700 mb-3">
                    Альбом, все ученики, фотографии, выборы и контакты будут{' '}
                    <strong>удалены без возможности восстановления</strong>.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleDelete}
                      className="px-3 py-1.5 rounded-xl text-sm bg-red-600 hover:bg-red-700 text-white transition-colors"
                      disabled={loading}
                    >
                      {loading ? 'Удаляем...' : 'Удалить навсегда'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(false)}
                      className="btn-secondary text-sm px-3 py-1.5"
                      disabled={loading}
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </form>
      </div>
    </div>
  )
}

// ============================================================
// БЛОК ИМПОРТА CSV
// ============================================================

function CSVImportBlock({
  albumId,
  onDone,
  onError,
}: {
  albumId: string
  onDone: (added: number, skipped: number) => void
  onError: (msg: string) => void
}) {
  const [rawText, setRawText] = useState('')
  const [preview, setPreview] = useState<Array<{ full_name: string; class: string }>>([])
  const [busy, setBusy] = useState(false)

  // Парсинг текста в режиме реального времени
  useEffect(() => {
    if (!rawText.trim()) {
      setPreview([])
      return
    }
    // Папа-парсер работает с тем что есть: либо таб/запятая/точка с запятой
    // Автоопределение разделителя
    import('papaparse').then((Papa: any) => {
      const result = Papa.parse(rawText.trim(), {
        header: false,
        skipEmptyLines: true,
      })

      const rows: Array<{ full_name: string; class: string }> = []
      for (const row of result.data as any[]) {
        if (!Array.isArray(row)) continue
        // Если первая ячейка — заголовок вроде "ФИО", пропускаем
        const first = String(row[0] ?? '').trim().toLowerCase()
        if (
          first === 'фио' ||
          first === 'name' ||
          first === 'full_name' ||
          first === 'имя'
        ) {
          continue
        }
        const full_name = String(row[0] ?? '').trim()
        const childClass = String(row[1] ?? '').trim()
        if (full_name && childClass) {
          rows.push({ full_name, class: childClass })
        }
      }
      setPreview(rows)
    })
  }, [rawText])

  const handleImport = async () => {
    if (preview.length === 0) return
    setBusy(true)
    const r = await api('/api/tenant', {
      method: 'POST',
      body: JSON.stringify({
        action: 'import_children',
        album_id: albumId,
        rows: preview,
      }),
    })
    if (r.ok) {
      const d = await r.json()
      onDone(d.added ?? 0, d.skipped ?? 0)
    } else {
      const d = await r.json().catch(() => ({}))
      onError(d.error ?? 'Не удалось импортировать')
    }
    setBusy(false)
  }

  return (
    <div className="bg-gray-50 rounded-xl p-4 mb-3 space-y-3">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Вставьте список учеников
        </label>
        <p className="text-xs text-gray-500 mb-2">
          Формат: <code className="bg-white px-1 py-0.5 rounded">ФИО</code>{' '}
          <span className="text-gray-400">(таб/запятая)</span>{' '}
          <code className="bg-white px-1 py-0.5 rounded">Класс</code>. Одна строка — один ученик.
          Скопируйте из Excel или Google Таблиц.
        </p>
        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          rows={6}
          className="input font-mono text-xs"
          placeholder={`Иванов Иван\t11А\nПетров Пётр\t11А\nСидорова Мария\t11Б`}
          disabled={busy}
        />
      </div>

      {preview.length > 0 && (
        <div>
          <div className="text-xs text-gray-500 mb-2">
            Распознано: <span className="font-semibold text-gray-900">{preview.length}</span>{' '}
            {preview.length === 1 ? 'строка' : preview.length < 5 ? 'строки' : 'строк'}
          </div>
          <div className="bg-white border border-gray-200 rounded-lg max-h-40 overflow-y-auto">
            <table className="w-full text-xs">
              <tbody>
                {preview.slice(0, 20).map((r, i) => (
                  <tr key={i} className="border-b border-gray-100 last:border-0">
                    <td className="px-3 py-1.5">{r.full_name}</td>
                    <td className="px-3 py-1.5 text-gray-500 w-20">{r.class}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.length > 20 && (
              <div className="text-center text-xs text-gray-400 py-1.5 border-t border-gray-100">
                ... и ещё {preview.length - 20}
              </div>
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={handleImport}
        className="btn-primary"
        disabled={busy || preview.length === 0}
      >
        {busy ? 'Импортируем...' : `Импортировать ${preview.length || ''}`}
      </button>
    </div>
  )
}

// ============================================================
// ВКЛАДКА «УЧИТЕЛЯ»
// ============================================================

type Teacher = {
  id: string
  full_name: string | null
  position: string | null
  description: string | null
  access_token: string
  submitted_at: string | null
}

function TeachersTab({
  albumId,
  canEdit,
  onNotify,
  onError,
}: {
  albumId: string
  canEdit: boolean
  onNotify: (msg: string) => void
  onError: (msg: string) => void
}) {
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<{ full_name: string; position: string; description: string }>({
    full_name: '',
    position: '',
    description: '',
  })

  const load = async () => {
    const r = await api(`/api/tenant?action=teachers&album_id=${albumId}`)
    if (r.ok) {
      setTeachers(await r.json())
    }
    setLoading(false)
  }

  useEffect(() => {
    load().catch(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albumId])

  const handleAdd = async () => {
    setBusy(true)
    const r = await api('/api/tenant', {
      method: 'POST',
      body: JSON.stringify({ action: 'add_teacher', album_id: albumId }),
    })
    if (r.ok) {
      onNotify('Добавлен учитель. Данные заполнит ответственный родитель или вы через редактирование.')
      await load()
    } else {
      const d = await r.json().catch(() => ({}))
      onError(d.error ?? 'Не удалось добавить')
    }
    setBusy(false)
  }

  const startEdit = (t: Teacher) => {
    setEditingId(t.id)
    setEditForm({
      full_name: t.full_name ?? '',
      position: t.position ?? '',
      description: t.description ?? '',
    })
  }

  const saveEdit = async () => {
    if (!editingId) return
    setBusy(true)
    const r = await api('/api/tenant', {
      method: 'POST',
      body: JSON.stringify({
        action: 'update_teacher',
        teacher_id: editingId,
        full_name: editForm.full_name,
        position: editForm.position,
        description: editForm.description,
      }),
    })
    if (r.ok) {
      onNotify('Данные учителя сохранены')
      setEditingId(null)
      await load()
    } else {
      const d = await r.json().catch(() => ({}))
      onError(d.error ?? 'Не удалось сохранить')
    }
    setBusy(false)
  }

  const handleDelete = async (t: Teacher) => {
    const name = t.full_name || 'учителя без имени'
    if (!confirm(`Удалить «${name}»?`)) return
    setBusy(true)
    const r = await api('/api/tenant', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete_teacher', teacher_id: t.id }),
    })
    if (r.ok) {
      onNotify('Учитель удалён')
      await load()
    } else {
      const d = await r.json().catch(() => ({}))
      onError(d.error ?? 'Не удалось удалить')
    }
    setBusy(false)
  }

  const copyLink = async (_t: Teacher) => {
    // Устарело — у учителей нет отдельной ссылки.
    // Ссылка для заполнения данных учителей = ссылка ответственного родителя (вкладка «Ответственный»)
    onError('У учителя нет отдельной ссылки. Данные заполняет ответственный родитель.')
  }
  void copyLink

  if (loading) {
    return <div className="text-center text-gray-400 text-sm py-8">Загрузка...</div>
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h4 className="font-medium">
          Учителя
          <span className="text-gray-400 font-normal ml-2">{teachers.length}</span>
        </h4>
        {canEdit && (
          <button type="button" onClick={handleAdd} className="btn-secondary text-xs px-3 py-1.5" disabled={busy}>
            + Добавить учителя
          </button>
        )}
      </div>

      <div className="bg-gray-50 rounded-xl p-4 mb-4 text-sm text-gray-600">
        Данные учителей (ФИО, должность, текст от кл. руководителя) заполняет <strong>ответственный родитель</strong> через свою ссылку. Создайте нужное количество карточек здесь — и отправьте ссылку ответственного из соседней вкладки.
      </div>

      {teachers.length === 0 ? (
        <div className="text-center text-gray-400 text-sm py-8 bg-gray-50 rounded-xl">
          В альбоме пока нет учителей.
          {canEdit && (
            <>
              <br />
              Нажмите «+ Добавить учителя», чтобы создать карточку. Данные может заполнить ответственный родитель по своей ссылке.
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {teachers.map((t, i) => (
            <div key={t.id} className="border border-gray-100 rounded-xl p-4">
              {editingId === t.id ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">ФИО</label>
                    <input
                      type="text"
                      value={editForm.full_name}
                      onChange={(e) => setEditForm(f => ({ ...f, full_name: e.target.value }))}
                      className="input"
                      placeholder="Иванова Мария Петровна"
                      disabled={busy}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Должность / предмет</label>
                    <input
                      type="text"
                      value={editForm.position}
                      onChange={(e) => setEditForm(f => ({ ...f, position: e.target.value }))}
                      className="input"
                      placeholder="Учитель математики"
                      disabled={busy}
                    />
                  </div>
                  {i === 0 && (
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">
                        Текст от классного руководителя
                      </label>
                      <textarea
                        value={editForm.description}
                        onChange={(e) => setEditForm(f => ({ ...f, description: e.target.value }))}
                        rows={4}
                        className="input"
                        placeholder="Напутствие, пожелания выпускникам..."
                        disabled={busy}
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        Отображается только у первого учителя (классного руководителя)
                      </p>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button type="button" onClick={saveEdit} className="btn-primary" disabled={busy}>
                      {busy ? 'Сохраняем...' : 'Сохранить'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="btn-secondary"
                      disabled={busy}
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="font-medium">
                          {t.full_name || <span className="text-gray-400">Имя не заполнено</span>}
                        </div>
                        {i === 0 && (
                          <span className="badge-blue">Классный руководитель</span>
                        )}
                        {t.submitted_at ? (
                          <span className="badge-green">Заполнено</span>
                        ) : (
                          <span className="badge-gray">Ожидание</span>
                        )}
                      </div>
                      {t.position && (
                        <div className="text-sm text-gray-500 mt-0.5">{t.position}</div>
                      )}
                      {i === 0 && t.description && (
                        <div className="text-sm text-gray-700 mt-2 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap">
                          {t.description}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {canEdit && (
                        <>
                          <button
                            type="button"
                            onClick={() => startEdit(t)}
                            className="btn-secondary text-xs px-3 py-1.5"
                          >
                            Редактировать
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(t)}
                            className="btn-secondary text-xs px-3 py-1.5 text-red-600"
                            disabled={busy}
                          >
                            Удалить
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================
// ВКЛАДКА «ОТВЕТСТВЕННЫЙ РОДИТЕЛЬ»
// ============================================================

type Responsible = {
  id: string
  full_name: string | null
  phone: string | null
  access_token: string
  submitted_at: string | null
}

function ResponsibleTab({
  albumId,
  canEdit,
  onNotify,
  onError,
}: {
  albumId: string
  canEdit: boolean
  onNotify: (msg: string) => void
  onError: (msg: string) => void
}) {
  const [responsible, setResponsible] = useState<Responsible | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({ full_name: '', phone: '' })

  const load = async () => {
    const r = await api(`/api/tenant?action=responsible&album_id=${albumId}`)
    if (r.ok) {
      const data = await r.json()
      setResponsible(data)
    }
    setLoading(false)
  }

  useEffect(() => {
    load().catch(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albumId])

  const handleCreate = async () => {
    setBusy(true)
    const r = await api('/api/tenant', {
      method: 'POST',
      body: JSON.stringify({ action: 'create_responsible', album_id: albumId }),
    })
    if (r.ok) {
      onNotify('Ответственный создан. Скопируйте ссылку и отправьте родителю.')
      await load()
    } else {
      const d = await r.json().catch(() => ({}))
      onError(d.error ?? 'Не удалось создать')
    }
    setBusy(false)
  }

  const startEdit = () => {
    if (!responsible) return
    setEditForm({
      full_name: responsible.full_name ?? '',
      phone: responsible.phone ?? '',
    })
    setEditing(true)
  }

  const saveEdit = async () => {
    if (!responsible) return
    setBusy(true)
    const r = await api('/api/tenant', {
      method: 'POST',
      body: JSON.stringify({
        action: 'update_responsible',
        responsible_id: responsible.id,
        full_name: editForm.full_name,
        phone: editForm.phone,
      }),
    })
    if (r.ok) {
      onNotify('Данные сохранены')
      setEditing(false)
      await load()
    } else {
      const d = await r.json().catch(() => ({}))
      onError(d.error ?? 'Не удалось сохранить')
    }
    setBusy(false)
  }

  const handleDelete = async () => {
    if (!responsible) return
    if (!confirm('Удалить ответственного родителя? Его ссылка перестанет работать. Данные учителей сохранятся.')) return
    setBusy(true)
    const r = await api('/api/tenant', {
      method: 'POST',
      body: JSON.stringify({
        action: 'delete_responsible',
        responsible_id: responsible.id,
      }),
    })
    if (r.ok) {
      onNotify('Ответственный удалён')
      await load()
    } else {
      const d = await r.json().catch(() => ({}))
      onError(d.error ?? 'Не удалось удалить')
    }
    setBusy(false)
  }

  const copyLink = async () => {
    if (!responsible) return
    // В текущей системе /teacher/<token> — это страница ОТВЕТСТВЕННОГО РОДИТЕЛЯ
    // (он заполняет данные учителей). У учителей отдельных ссылок нет.
    const url = `${window.location.origin}/teacher/${responsible.access_token}`
    try {
      await navigator.clipboard.writeText(url)
      onNotify('Ссылка ответственного скопирована')
    } catch {
      onError('Не удалось скопировать. Ссылка: ' + url)
    }
  }

  if (loading) {
    return <div className="text-center text-gray-400 text-sm py-8">Загрузка...</div>
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h4 className="font-medium">Ответственный родитель</h4>
      </div>

      <div className="bg-gray-50 rounded-xl p-4 mb-4 text-sm text-gray-600">
        Один из родителей помогает с организацией. По своей ссылке он заполняет данные учителей (ФИО, должность, текст от кл. руководителя).
      </div>

      {!responsible ? (
        <div className="text-center py-8">
          <div className="text-gray-400 text-sm mb-4">
            Ответственный родитель не назначен
          </div>
          {canEdit && (
            <button type="button" onClick={handleCreate} className="btn-primary" disabled={busy}>
              {busy ? 'Создаём...' : 'Назначить ответственного'}
            </button>
          )}
        </div>
      ) : (
        <div className="border border-gray-100 rounded-xl p-4">
          {editing ? (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">ФИО</label>
                <input
                  type="text"
                  value={editForm.full_name}
                  onChange={(e) => setEditForm(f => ({ ...f, full_name: e.target.value }))}
                  className="input"
                  placeholder="Иванова Ольга Сергеевна"
                  disabled={busy}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Телефон</label>
                <input
                  type="tel"
                  value={editForm.phone}
                  onChange={(e) => setEditForm(f => ({ ...f, phone: e.target.value }))}
                  className="input"
                  placeholder="+7 999 000-00-00"
                  disabled={busy}
                />
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={saveEdit} className="btn-primary" disabled={busy}>
                  {busy ? 'Сохраняем...' : 'Сохранить'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="btn-secondary"
                  disabled={busy}
                >
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="font-medium">
                      {responsible.full_name || (
                        <span className="text-gray-400">Имя не указано</span>
                      )}
                    </div>
                    {responsible.submitted_at ? (
                      <span className="badge-green">Заполнил данные</span>
                    ) : (
                      <span className="badge-amber">Ожидает заполнения</span>
                    )}
                  </div>
                  {responsible.phone && (
                    <div className="text-sm text-gray-500 mt-0.5">{responsible.phone}</div>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={copyLink}
                  className="btn-secondary text-xs px-3 py-1.5"
                >
                  Скопировать ссылку
                </button>
                {canEdit && (
                  <>
                    <button
                      type="button"
                      onClick={startEdit}
                      className="btn-secondary text-xs px-3 py-1.5"
                    >
                      Редактировать
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      className="btn-secondary text-xs px-3 py-1.5 text-red-600"
                      disabled={busy}
                    >
                      Удалить
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================
// Вкладка Фото — загрузка, галерея, удаление, теги
// ============================================================

type Photo = {
  id: string
  filename: string
  storage_path: string
  thumb_path: string | null
  type: 'portrait' | 'group' | 'teacher'
  url: string
  thumb_url: string
  tags: string[]
}

type PhotoKind = 'portrait' | 'group' | 'teacher'

const UPLOAD_CONCURRENCY = 5

function photoKindLabel(k: PhotoKind): string {
  return k === 'portrait' ? 'Портреты' : k === 'group' ? 'Групповые' : 'Учителя'
}

/**
 * Параллельная клиентская загрузка:
 * 1. browser-image-compression → WebP ~2048px
 * 2. Прямая заливка в Supabase Storage под путём album_id/type/ts_name.webp
 * 3. POST register_photo для создания записи в БД
 *
 * Thumb генерируется Supabase on-the-fly через ?width=400 (серверная
 * трансформация). Это компромисс: зато загрузка быстрее.
 *
 * Для принудительной генерации настоящего thumb_path через sharp
 * используется серверный upload_photo (multipart) — fallback, если
 * клиентская компрессия упала.
 */
async function uploadFilesParallel(
  files: File[],
  type: PhotoKind,
  albumId: string,
  onProgress: (done: number) => void,
  onFileError: (name: string, msg: string) => void,
) {
  const { createClient } = await import('@supabase/supabase-js')
  const imageCompression = (await import('browser-image-compression')).default
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

  let done = 0
  const queue = [...files]

  const worker = async () => {
    while (queue.length > 0) {
      const file = queue.shift()!
      try {
        let compressed: File | Blob = file
        try {
          compressed = await imageCompression(file, {
            maxSizeMB: 1.2,
            maxWidthOrHeight: 2048,
            useWebWorker: true,
            initialQuality: 0.85,
            fileType: 'image/webp',
          })
        } catch {
          // если компрессия упала — заливаем оригинал
        }

        const cleanName = file.name.replace(/\.[^.]+$/, '').replace(/[^\w.\-]/g, '_')
        const path = `${albumId}/${type}/${Date.now()}_${cleanName}.webp`

        const { error: upErr } = await sb.storage
          .from('photos')
          .upload(path, compressed, { contentType: 'image/webp', upsert: false })

        if (upErr) {
          onFileError(file.name, upErr.message)
        } else {
          const res = await fetch('/api/tenant', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'register_photo',
              album_id: albumId,
              filename: file.name,
              storage_path: path,
              type,
            }),
          })
          if (!res.ok) {
            const d = await res.json().catch(() => ({}))
            onFileError(file.name, d.error ?? 'Ошибка регистрации')
          }
        }
      } catch (e: any) {
        onFileError(file.name, e?.message ?? 'Неизвестная ошибка')
      }
      done++
      onProgress(done)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(UPLOAD_CONCURRENCY, files.length) }, worker),
  )
}

function PhotosTab({
  albumId,
  archived,
  canEdit,
  children: childList,
  onNotify,
  onError,
}: {
  albumId: string
  archived: boolean
  canEdit: boolean
  children: Child[]
  onNotify: (msg: string) => void
  onError: (msg: string) => void
}) {
  const [activeKind, setActiveKind] = useState<PhotoKind>('portrait')
  const [photos, setPhotos] = useState<Photo[]>([])
  const [loading, setLoading] = useState(true)
  const [showImportTags, setShowImportTags] = useState(false)

  // состояние загрузки по каждому типу
  const [upload, setUpload] = useState<
    Record<PhotoKind, { files: File[]; uploading: boolean; done: number; errors: string[] }>
  >({
    portrait: { files: [], uploading: false, done: 0, errors: [] },
    group:    { files: [], uploading: false, done: 0, errors: [] },
    teacher:  { files: [], uploading: false, done: 0, errors: [] },
  })

  const setUploadState = (
    type: PhotoKind,
    patch: Partial<{ files: File[]; uploading: boolean; done: number; errors: string[] }>,
  ) => setUpload(prev => ({ ...prev, [type]: { ...prev[type], ...patch } }))

  const load = async (kind: PhotoKind) => {
    setLoading(true)
    const r = await api(`/api/tenant?action=photos&album_id=${albumId}&photo_type=${kind}`)
    if (r.ok) {
      const d = await r.json()
      setPhotos(d.photos ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    load(activeKind).catch(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albumId, activeKind])

  const runUpload = async (type: PhotoKind) => {
    const files = upload[type].files
    if (!files.length) return
    setUploadState(type, { uploading: true, done: 0, errors: [] })
    const errors: string[] = []
    await uploadFilesParallel(
      files,
      type,
      albumId,
      done => setUploadState(type, { done }),
      (name, msg) => errors.push(`${name}: ${msg}`),
    )
    setUploadState(type, { uploading: false, files: [], done: 0, errors })
    const ok = files.length - errors.length
    if (errors.length === 0) {
      onNotify(`Загружено ${ok} фото (${photoKindLabel(type)})`)
    } else if (ok === 0) {
      onError(`Не удалось загрузить ни одно фото. Первая ошибка: ${errors[0]}`)
    } else {
      onNotify(`Загружено ${ok} из ${files.length}. Ошибок: ${errors.length}`)
    }
    if (activeKind === type) load(type)
  }

  const uploadAll = () => {
    ;(['portrait', 'group', 'teacher'] as PhotoKind[])
      .filter(t => upload[t].files.length > 0)
      .forEach(t => runUpload(t))
  }

  const deletePhoto = async (photo: Photo) => {
    if (!confirm(`Удалить фото «${photo.filename}»?\n\nБудет удалено из всех выборов учеников. Если его уже выбрали — таких учеников вернут в статус «В процессе».`)) return
    const r = await api('/api/tenant', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete_photo', photo_id: photo.id }),
    })
    if (r.ok) {
      const d = await r.json()
      setPhotos(prev => prev.filter(p => p.id !== photo.id))
      if (d.resetChildren > 0) {
        onNotify(`Фото удалено. Сброшено учеников: ${d.resetChildren}`)
      } else {
        onNotify('Фото удалено')
      }
    } else {
      const d = await r.json().catch(() => ({}))
      onError(d.error ?? 'Не удалось удалить')
    }
  }

  const totalFiles = Object.values(upload).reduce((s, v) => s + v.files.length, 0)
  const anyUploading = Object.values(upload).some(v => v.uploading)
  const totalDone = Object.values(upload).reduce((s, v) => s + v.done, 0)

  if (archived) {
    return (
      <div className="text-center text-gray-500 text-sm py-12">
        Альбом в архиве — фотографии удалены из хранилища при архивировании.
        <br />
        Верните альбом из архива, чтобы снова загрузить фото.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Загрузка — только для редакторов */}
      {canEdit && (
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h4 className="font-medium text-gray-800">Загрузка фотографий</h4>
              <p className="text-xs text-gray-400 mt-0.5">
                Выберите файлы для каждого типа — загружаются параллельно, сжимаются в WebP
              </p>
            </div>
            <button
              onClick={() => setShowImportTags(true)}
              className="btn-ghost text-xs"
              type="button"
            >
              Импорт тегов CSV
            </button>
          </div>

          <div className="space-y-3">
            {(['portrait', 'group', 'teacher'] as PhotoKind[]).map(t => {
              const s = upload[t]
              const pct = s.files.length > 0 && s.uploading ? Math.round(s.done / s.files.length * 100) : 0
              return (
                <div key={t} className="border border-gray-200 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2 gap-2">
                    <span className="text-sm font-medium text-gray-700">{photoKindLabel(t)}</span>
                    {s.files.length > 0 && !s.uploading && (
                      <span className="text-xs text-gray-500">{s.files.length} файлов выбрано</span>
                    )}
                    {s.uploading && (
                      <span className="text-xs text-blue-600">{s.done} / {s.files.length}</span>
                    )}
                  </div>
                  {s.uploading ? (
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  ) : (
                    <input
                      type="file"
                      multiple
                      accept="image/*"
                      onChange={e => setUploadState(t, { files: Array.from(e.target.files ?? []) })}
                      className="block w-full text-xs text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
                    />
                  )}
                </div>
              )
            })}
          </div>

          <button
            className="btn-primary w-full"
            onClick={uploadAll}
            disabled={totalFiles === 0 || anyUploading}
            type="button"
          >
            {anyUploading
              ? `Загружаю... (${totalDone} / ${totalFiles})`
              : totalFiles > 0
                ? `▶ Загрузить все (${totalFiles} фото)`
                : 'Выберите файлы выше'}
          </button>
        </div>
      )}

      {/* Галерея */}
      <div className="card p-5">
        <div className="flex gap-1 mb-4 border-b border-gray-100">
          {(['portrait', 'group', 'teacher'] as PhotoKind[]).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setActiveKind(t)}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeKind === t
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {photoKindLabel(t)}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-sm text-gray-400 py-8 text-center">Загрузка...</div>
        ) : photos.length === 0 ? (
          <div className="text-sm text-gray-400 py-8 text-center">
            Нет загруженных фото{canEdit ? ' — загрузите выше' : ''}
          </div>
        ) : (
          <>
            <p className="text-xs text-gray-400 mb-3">{photos.length} фото</p>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
              {photos.map(photo => (
                <div key={photo.id} className="relative group aspect-square bg-gray-100 rounded-lg overflow-hidden">
                  <img
                    src={photo.thumb_url}
                    alt={photo.filename}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => deletePhoto(photo)}
                      className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 text-xs items-center justify-center hidden group-hover:flex"
                      title="Удалить"
                    >
                      ✕
                    </button>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1.5 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="truncate">{photo.filename}</div>
                    {photo.tags.length > 0 && (
                      <div className="truncate text-green-200 mt-0.5">
                        {photo.tags.length === 1 ? photo.tags[0] : `${photo.tags.length} привязок`}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Модалка импорта тегов */}
      {showImportTags && (
        <ImportTagsModal
          albumId={albumId}
          childList={childList}
          onClose={() => setShowImportTags(false)}
          onDone={result => {
            setShowImportTags(false)
            if (result.skipped === 0) {
              onNotify(`Привязано: ${result.linked}`)
            } else {
              onNotify(`Привязано: ${result.linked}, пропущено: ${result.skipped}`)
            }
            // перезагрузить текущую вкладку чтобы обновить tags
            load(activeKind)
          }}
          onError={onError}
        />
      )}
    </div>
  )
}

// ============================================================
// Модалка импорта CSV-тегов
// ============================================================

function ImportTagsModal({
  albumId,
  childList,
  onClose,
  onDone,
  onError,
}: {
  albumId: string
  childList: Child[]
  onClose: () => void
  onDone: (result: { linked: number; skipped: number; skipped_rows: any[] }) => void
  onError: (msg: string) => void
}) {
  const [csv, setCsv] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ linked: number; skipped: number; skipped_rows: any[] } | null>(null)

  const handleImport = async () => {
    if (!csv.trim()) return
    setBusy(true)

    const Papa = (await import('papaparse')).default
    const parsed = Papa.parse<Record<string, string>>(csv.trim(), {
      header: true,
      skipEmptyLines: true,
      transformHeader: h => h.trim().toLowerCase().replace(/\s+/g, '_'),
    })

    const rows = (parsed.data ?? [])
      .map(row => ({
        child_name: row.child_name ?? row['фио'] ?? row['имя'] ?? row['ученик'] ?? '',
        photo_filename: row.photo_filename ?? row['файл'] ?? row['фото'] ?? '',
      }))
      .filter(r => r.child_name && r.photo_filename)

    if (rows.length === 0) {
      onError('Не найдено ни одной строки. Проверьте формат CSV.')
      setBusy(false)
      return
    }

    const r = await api('/api/tenant', {
      method: 'POST',
      body: JSON.stringify({ action: 'import_tags', album_id: albumId, rows }),
    })

    if (r.ok) {
      const d = await r.json()
      setResult(d)
      if (d.skipped === 0) {
        onDone(d)
      }
      // если есть пропуски — показываем детали, пользователь закроет сам
    } else {
      const d = await r.json().catch(() => ({}))
      onError(d.error ?? 'Не удалось импортировать')
    }
    setBusy(false)
  }

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">Импорт тегов из CSV</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none" type="button">×</button>
          </div>

          <div className="bg-gray-50 rounded-xl p-4 text-sm">
            <p className="font-medium text-gray-700 mb-2">Формат:</p>
            <pre className="bg-white border border-gray-200 rounded-lg p-3 text-xs overflow-auto text-gray-700 whitespace-pre">{`child_name,photo_filename
Иванов Иван,IMG_001.jpg
Иванов Иван,IMG_045.jpg
Петрова Маша,IMG_001.jpg`}</pre>
            <p className="text-gray-500 text-xs mt-2">
              Имена и имена файлов матчатся без учёта регистра. В альбоме сейчас {childList.length} учеников.
              Одно фото можно привязать к нескольким детям.
            </p>
          </div>

          <textarea
            value={csv}
            onChange={e => setCsv(e.target.value)}
            placeholder="Вставьте CSV..."
            rows={10}
            className="input w-full font-mono text-xs"
            disabled={busy || !!result}
          />

          {result && (
            <div className="space-y-2">
              <div className={`rounded-xl p-3 text-sm ${result.skipped === 0 ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>
                Привязано: {result.linked}, пропущено: {result.skipped}
              </div>
              {result.skipped_rows.length > 0 && (
                <div className="border border-gray-200 rounded-xl p-3 max-h-40 overflow-auto">
                  <p className="text-xs text-gray-500 mb-2">Пропущенные строки (первые 50):</p>
                  <ul className="text-xs space-y-1 text-gray-700">
                    {result.skipped_rows.map((r, i) => (
                      <li key={i} className="font-mono">
                        <span className="text-gray-400">[{r.reason}]</span>{' '}
                        {r.child_name} → {r.photo_filename}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2">
            {!result ? (
              <>
                <button
                  onClick={handleImport}
                  disabled={!csv.trim() || busy}
                  className="btn-primary flex-1"
                  type="button"
                >
                  {busy ? 'Импортирую...' : 'Импортировать'}
                </button>
                <button
                  onClick={onClose}
                  disabled={busy}
                  className="btn-secondary"
                  type="button"
                >
                  Отмена
                </button>
              </>
            ) : (
              <button
                onClick={() => onDone(result)}
                className="btn-primary flex-1"
                type="button"
              >
                Готово
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// МОДАЛКА ЗАЯВОК (referral_leads)
// ============================================================

type Lead = {
  id: string
  name: string
  phone: string
  city: string | null
  school: string | null
  class_name: string | null
  status: 'new' | 'in_progress' | 'done' | 'rejected'
  created_at: string
  referrer_child_id: string | null
  referrer_name: string
  referrer_album: string
}

type LeadStatus = 'new' | 'in_progress' | 'done' | 'rejected'

const LEAD_STATUSES: { id: LeadStatus; label: string; badge: string; btn: string }[] = [
  { id: 'new',         label: 'Новая',   badge: 'bg-blue-100 text-blue-700',   btn: 'text-blue-700' },
  { id: 'in_progress', label: 'В работе', badge: 'bg-amber-100 text-amber-700', btn: 'text-amber-700' },
  { id: 'done',        label: 'Заказ',   badge: 'bg-green-100 text-green-700', btn: 'text-green-700' },
  { id: 'rejected',    label: 'Отказ',   badge: 'bg-gray-100 text-gray-500',   btn: 'text-gray-500' },
]

function LeadsModal({
  canEdit,
  onClose,
  onNotify,
  onError,
}: {
  canEdit: boolean
  onClose: () => void
  onNotify: (msg: string) => void
  onError: (msg: string) => void
}) {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | LeadStatus>('all')
  const [backdropStart, setBackdropStart] = useState(false)

  const handleBackdropMouseDown = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) setBackdropStart(true)
  }
  const handleBackdropMouseUp = (e: React.MouseEvent) => {
    if (backdropStart && e.target === e.currentTarget) onClose()
    setBackdropStart(false)
  }

  const load = async () => {
    setLoading(true)
    const r = await api('/api/tenant?action=leads')
    if (r.ok) {
      const d = await r.json()
      setLeads(Array.isArray(d) ? d : [])
    } else {
      onError('Не удалось загрузить заявки')
    }
    setLoading(false)
  }

  useEffect(() => {
    load().catch(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateStatus = async (id: string, status: LeadStatus) => {
    const prev = leads
    // оптимистично
    setLeads(p => p.map(l => (l.id === id ? { ...l, status } : l)))
    const r = await api('/api/tenant', {
      method: 'POST',
      body: JSON.stringify({ action: 'update_lead_status', id, status }),
    })
    if (r.ok) {
      const st = LEAD_STATUSES.find(s => s.id === status)
      onNotify(`Статус: ${st?.label ?? status}`)
    } else {
      setLeads(prev) // откат
      const d = await r.json().catch(() => ({}))
      onError(d.error ?? 'Не удалось обновить статус')
    }
  }

  const deleteLead = async (lead: Lead) => {
    if (!confirm(`Удалить заявку от ${lead.name}?\n\nЭто действие нельзя отменить.`)) return
    const r = await api('/api/tenant', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete_lead', id: lead.id }),
    })
    if (r.ok) {
      setLeads(p => p.filter(l => l.id !== lead.id))
      onNotify('Заявка удалена')
    } else {
      const d = await r.json().catch(() => ({}))
      onError(d.error ?? 'Не удалось удалить')
    }
  }

  const counts = {
    all: leads.length,
    new: leads.filter(l => l.status === 'new').length,
    in_progress: leads.filter(l => l.status === 'in_progress').length,
    done: leads.filter(l => l.status === 'done').length,
    rejected: leads.filter(l => l.status === 'rejected').length,
  }

  const visible = filter === 'all' ? leads : leads.filter(l => l.status === filter)

  return (
    <div
      className="fixed inset-0 bg-black/40 z-40 flex items-start justify-center py-8 px-4 overflow-y-auto"
      onMouseDown={handleBackdropMouseDown}
      onMouseUp={handleBackdropMouseUp}
    >
      <div className="bg-white rounded-2xl max-w-3xl w-full shadow-xl my-auto">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white rounded-t-2xl">
          <div>
            <h3 className="text-lg font-semibold">Заявки</h3>
            <div className="text-xs text-gray-500 mt-0.5">
              Реферальные заявки от родителей других классов
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

        {/* Фильтр по статусу */}
        <div className="px-6 pt-4 border-b border-gray-100 flex gap-1 overflow-x-auto">
          {([
            { id: 'all' as const, label: 'Все' },
            ...LEAD_STATUSES.map(s => ({ id: s.id, label: s.label })),
          ]).map(t => {
            const c = counts[t.id as keyof typeof counts] ?? 0
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setFilter(t.id)}
                className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  filter === t.id
                    ? 'border-gray-900 text-gray-900'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.label}
                <span className="text-gray-400 font-normal ml-1.5">{c}</span>
              </button>
            )
          })}
        </div>

        <div className="p-6">
          {loading ? (
            <div className="text-center text-gray-400 text-sm py-8">Загружаем заявки...</div>
          ) : visible.length === 0 ? (
            <div className="text-center text-gray-400 text-sm py-8">
              {filter === 'all' ? 'Заявок пока нет' : 'Нет заявок в этом статусе'}
            </div>
          ) : (
            <div className="space-y-3">
              {visible.map(lead => {
                const st = LEAD_STATUSES.find(s => s.id === lead.status) ?? LEAD_STATUSES[0]
                return (
                  <div key={lead.id} className="border border-gray-200 rounded-xl p-4">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-gray-900">{lead.name}</p>
                        <a
                          href={`tel:${lead.phone.replace(/\s+/g, '')}`}
                          className="text-sm text-gray-600 hover:text-gray-900"
                        >
                          {lead.phone}
                        </a>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap ${st.badge}`}>
                        {st.label}
                      </span>
                    </div>

                    {(lead.city || lead.school || lead.class_name) && (
                      <p className="text-sm text-gray-600 mb-2">
                        {[lead.city, lead.school, lead.class_name].filter(Boolean).join(' · ')}
                      </p>
                    )}

                    <p className="text-xs text-gray-400 mb-3">
                      От: <strong className="text-gray-500">{lead.referrer_name}</strong>
                      {lead.referrer_album && ` · ${lead.referrer_album}`}
                      {' · '}
                      {new Date(lead.created_at).toLocaleDateString('ru-RU', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </p>

                    {canEdit && (
                      <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-gray-100">
                        {LEAD_STATUSES.map(s => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => updateStatus(lead.id, s.id)}
                            disabled={lead.status === s.id}
                            className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${
                              lead.status === s.id
                                ? 'border-gray-400 bg-gray-50 text-gray-700 font-medium cursor-default'
                                : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700'
                            }`}
                          >
                            {s.label}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => deleteLead(lead)}
                          className="text-xs text-red-500 hover:text-red-700 ml-auto"
                        >
                          Удалить
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// МОДАЛКА ЦИТАТ (quotes)
// Свои цитаты tenant'а + глобальные (глобальные read-only)
// ============================================================

type Quote = {
  id: string
  text: string
  category: string
  is_global: boolean
  created_at: string
  use_count: number
}

function QuotesModal({
  canEdit,
  onClose,
  onNotify,
  onError,
}: {
  canEdit: boolean
  onClose: () => void
  onNotify: (msg: string) => void
  onError: (msg: string) => void
}) {
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'own' | 'global'>('all')
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingQuote, setEditingQuote] = useState<Quote | null>(null)
  const [formText, setFormText] = useState('')
  const [formCategory, setFormCategory] = useState('general')
  const [busy, setBusy] = useState(false)
  const [backdropStart, setBackdropStart] = useState(false)

  const handleBackdropMouseDown = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) setBackdropStart(true)
  }
  const handleBackdropMouseUp = (e: React.MouseEvent) => {
    if (backdropStart && e.target === e.currentTarget) onClose()
    setBackdropStart(false)
  }

  const load = async () => {
    setLoading(true)
    const r = await api('/api/tenant?action=quotes')
    if (r.ok) {
      const d = await r.json()
      setQuotes(Array.isArray(d) ? d : [])
    } else {
      onError('Не удалось загрузить цитаты')
    }
    setLoading(false)
  }

  useEffect(() => {
    load().catch(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startCreate = () => {
    setEditingQuote(null)
    setFormText('')
    setFormCategory('general')
    setShowForm(true)
  }

  const startEdit = (q: Quote) => {
    setEditingQuote(q)
    setFormText(q.text)
    setFormCategory(q.category)
    setShowForm(true)
  }

  const cancelForm = () => {
    setShowForm(false)
    setEditingQuote(null)
    setFormText('')
    setFormCategory('general')
  }

  const saveForm = async () => {
    const text = formText.trim()
    const category = formCategory.trim() || 'general'
    if (!text) return
    if (text.length > 500) {
      onError('Цитата слишком длинная (макс. 500 символов)')
      return
    }

    setBusy(true)
    const action = editingQuote ? 'update_quote' : 'create_quote'
    const payload: any = { action, text, category }
    if (editingQuote) payload.id = editingQuote.id

    const r = await api('/api/tenant', {
      method: 'POST',
      body: JSON.stringify(payload),
    })

    if (r.ok) {
      onNotify(editingQuote ? 'Цитата обновлена' : 'Цитата добавлена')
      cancelForm()
      await load()
    } else {
      const d = await r.json().catch(() => ({}))
      onError(d.error ?? 'Не удалось сохранить')
    }
    setBusy(false)
  }

  const deleteQuote = async (q: Quote, force = false) => {
    if (!force) {
      const txt = q.text.length > 60 ? q.text.slice(0, 60) + '...' : q.text
      if (!confirm(`Удалить цитату «${txt}»?`)) return
    }

    const r = await api('/api/tenant', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete_quote', id: q.id, force }),
    })

    if (r.ok) {
      const d = await r.json()
      setQuotes(prev => prev.filter(x => x.id !== q.id))
      if (d.reset_selections > 0) {
        onNotify(`Цитата удалена. Сброшено выборов: ${d.reset_selections}`)
      } else {
        onNotify('Цитата удалена')
      }
    } else {
      const d = await r.json().catch(() => ({}))
      if (d.requires_force) {
        if (confirm(`${d.error}\n\nПродолжить?`)) {
          await deleteQuote(q, true)
        }
      } else {
        onError(d.error ?? 'Не удалось удалить')
      }
    }
  }

  const categories = Array.from(new Set(quotes.map(q => q.category))).sort()

  const visible = quotes.filter(q => {
    if (filter === 'own' && q.is_global) return false
    if (filter === 'global' && !q.is_global) return false
    if (search && !q.text.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const counts = {
    all: quotes.length,
    own: quotes.filter(q => !q.is_global).length,
    global: quotes.filter(q => q.is_global).length,
  }

  // Группируем по категории
  const byCategory: Record<string, Quote[]> = {}
  for (const q of visible) {
    if (!byCategory[q.category]) byCategory[q.category] = []
    byCategory[q.category].push(q)
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-40 flex items-start justify-center py-8 px-4 overflow-y-auto"
      onMouseDown={handleBackdropMouseDown}
      onMouseUp={handleBackdropMouseUp}
    >
      <div className="bg-white rounded-2xl max-w-3xl w-full shadow-xl my-auto">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white rounded-t-2xl z-10">
          <div>
            <h3 className="text-lg font-semibold">Цитаты</h3>
            <div className="text-xs text-gray-500 mt-0.5">
              Свои цитаты + глобальные (общие для всех арендаторов)
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canEdit && !showForm && (
              <button
                type="button"
                onClick={startCreate}
                className="btn-primary text-xs px-3 py-1.5"
              >
                + Добавить
              </button>
            )}
            <button
              onClick={onClose}
              type="button"
              className="text-gray-400 hover:text-gray-700 text-xl leading-none"
            >
              ×
            </button>
          </div>
        </div>

        {/* Фильтр + поиск */}
        {!showForm && (
          <div className="px-6 pt-4 pb-3 border-b border-gray-100 flex items-center gap-3 flex-wrap">
            <div className="flex gap-1 overflow-x-auto">
              {([
                { id: 'all' as const, label: 'Все' },
                { id: 'own' as const, label: 'Свои' },
                { id: 'global' as const, label: 'Глобальные' },
              ]).map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setFilter(t.id)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                    filter === t.id
                      ? 'bg-gray-900 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {t.label}
                  <span className={`font-normal ml-1.5 ${filter === t.id ? 'text-gray-300' : 'text-gray-400'}`}>
                    {counts[t.id]}
                  </span>
                </button>
              ))}
            </div>

            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Поиск по тексту..."
              className="input text-sm max-w-xs ml-auto"
            />
          </div>
        )}

        <div className="p-6">
          {/* Форма создания/редактирования */}
          {showForm && (
            <div className="space-y-4">
              <h4 className="font-medium text-gray-800">
                {editingQuote ? 'Редактирование цитаты' : 'Новая цитата'}
              </h4>

              <div>
                <label className="text-xs text-gray-500 block mb-1">
                  Текст цитаты
                  <span className="text-gray-400 ml-2">
                    {formText.length} / 500
                  </span>
                </label>
                <textarea
                  value={formText}
                  onChange={e => setFormText(e.target.value)}
                  rows={4}
                  maxLength={500}
                  className="input w-full"
                  placeholder="Введите текст цитаты..."
                  disabled={busy}
                  autoFocus
                />
              </div>

              <div>
                <label className="text-xs text-gray-500 block mb-1">
                  Категория
                </label>
                <input
                  type="text"
                  value={formCategory}
                  onChange={e => setFormCategory(e.target.value)}
                  className="input w-full"
                  placeholder="general"
                  disabled={busy}
                  autoComplete="off"
                />
                {categories.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {categories.map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setFormCategory(c)}
                        disabled={busy}
                        className={`text-xs px-2 py-1 rounded-lg border transition-colors ${
                          formCategory === c
                            ? 'border-gray-900 bg-gray-900 text-white'
                            : 'border-gray-200 text-gray-600 hover:border-gray-300'
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-xs text-gray-400 mt-2">
                  Например: мотивация, юмор, дружба. Можно выбрать из существующих выше или ввести новую.
                </p>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={saveForm}
                  disabled={!formText.trim() || busy}
                  className="btn-primary"
                >
                  {busy ? 'Сохраняю...' : (editingQuote ? 'Сохранить' : 'Добавить')}
                </button>
                <button
                  type="button"
                  onClick={cancelForm}
                  disabled={busy}
                  className="btn-secondary"
                >
                  Отмена
                </button>
              </div>
            </div>
          )}

          {/* Список цитат */}
          {!showForm && (
            <>
              {loading ? (
                <div className="text-center text-gray-400 text-sm py-8">Загружаем...</div>
              ) : visible.length === 0 ? (
                <div className="text-center text-gray-400 text-sm py-8">
                  {search
                    ? 'Ничего не найдено'
                    : filter === 'own'
                    ? 'У вас пока нет своих цитат'
                    : filter === 'global'
                    ? 'Нет глобальных цитат'
                    : 'Нет цитат'}
                  {!search && filter !== 'global' && canEdit && (
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={startCreate}
                        className="btn-primary text-sm"
                      >
                        + Добавить первую
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-5">
                  {Object.keys(byCategory).sort().map(cat => (
                    <div key={cat}>
                      <h5 className="text-xs uppercase tracking-wide text-gray-400 mb-2">
                        {cat}
                        <span className="ml-2 normal-case">{byCategory[cat].length}</span>
                      </h5>
                      <div className="space-y-2">
                        {byCategory[cat].map(q => (
                          <div
                            key={q.id}
                            className="border border-gray-200 rounded-xl p-3 group hover:border-gray-300 transition-colors"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <p className="text-sm text-gray-800 flex-1 whitespace-pre-wrap">
                                {q.text}
                              </p>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                {q.is_global && (
                                  <span className="text-[10px] uppercase tracking-wide text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                                    глобальная
                                  </span>
                                )}
                                {q.use_count > 0 && (
                                  <span
                                    className="text-[10px] text-gray-500 bg-green-50 px-1.5 py-0.5 rounded"
                                    title={`Выбрана ${q.use_count} учениками`}
                                  >
                                    ✓ {q.use_count}
                                  </span>
                                )}
                              </div>
                            </div>
                            {canEdit && !q.is_global && (
                              <div className="flex items-center gap-3 mt-2 pt-2 border-t border-gray-100 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  type="button"
                                  onClick={() => startEdit(q)}
                                  className="text-xs text-gray-500 hover:text-gray-800"
                                >
                                  Изменить
                                </button>
                                <button
                                  type="button"
                                  onClick={() => deleteQuote(q)}
                                  className="text-xs text-red-500 hover:text-red-700 ml-auto"
                                >
                                  Удалить
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// МОДАЛКА НАПОМИНАНИЙ РОДИТЕЛЯМ
// Генерирует текст-шаблон из списка незавершивших детей
// с персональными ссылками, для рассылки в чат класса
// ============================================================

type ReminderFilter = 'all' | 'not_started' | 'in_progress'

function ReminderModal({
  album,
  childList,
  onClose,
  onNotify,
  onError,
}: {
  album: Album
  childList: Child[]
  onClose: () => void
  onNotify: (msg: string) => void
  onError: (msg: string) => void
}) {
  const [filter, setFilter] = useState<ReminderFilter>('all')
  const [groupByClass, setGroupByClass] = useState(true)
  const [backdropStart, setBackdropStart] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleBackdropMouseDown = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) setBackdropStart(true)
  }
  const handleBackdropMouseUp = (e: React.MouseEvent) => {
    if (backdropStart && e.target === e.currentTarget) onClose()
    setBackdropStart(false)
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  // Фильтруем детей
  const targets = childList.filter(c => {
    if (c.submitted_at) return false
    if (filter === 'not_started') return !c.started_at
    if (filter === 'in_progress') return !!c.started_at
    return true
  })

  const counts = {
    all: childList.filter(c => !c.submitted_at).length,
    not_started: childList.filter(c => !c.submitted_at && !c.started_at).length,
    in_progress: childList.filter(c => !c.submitted_at && !!c.started_at).length,
  }

  // Проверим, есть ли смысл в groupByClass (больше одного класса среди целей)
  const uniqueClasses = Array.from(new Set(targets.map(c => c.class ?? ''))).sort()
  const hasMultipleClasses = uniqueClasses.length > 1

  // Строим текст
  const buildText = (): string => {
    if (targets.length === 0) return ''

    const header: string[] = []
    header.push(
      `Здравствуйте! Напоминаем: нужно выбрать фотографии для выпускного альбома.`,
    )
    const albumLine = [album.title]
    if (album.city) albumLine.push(album.city)
    if (album.year) albumLine.push(String(album.year))
    header.push(`Альбом: ${albumLine.join(', ')}`)
    if (album.deadline) {
      header.push(
        `Срок: до ${new Date(album.deadline).toLocaleDateString('ru-RU')}`,
      )
    }
    header.push('')
    header.push(
      `Ваша персональная ссылка — не пересылайте её, она привязана к конкретному ученику:`,
    )
    header.push('')

    const lines: string[] = []

    if (groupByClass && hasMultipleClasses) {
      // Группируем по классу
      for (const cls of uniqueClasses) {
        const group = targets.filter(c => (c.class ?? '') === cls)
        if (group.length === 0) continue
        lines.push(cls ? `— ${cls} —` : '— без класса —')
        for (const c of group) {
          lines.push(`${c.full_name} → ${origin}/${c.access_token}`)
        }
        lines.push('')
      }
    } else {
      for (const c of targets) {
        lines.push(`${c.full_name} → ${origin}/${c.access_token}`)
      }
    }

    lines.push('Спасибо!')

    return [...header, ...lines].join('\n')
  }

  const text = buildText()

  const handleCopy = async () => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      onNotify('Текст скопирован в буфер обмена')
    } catch {
      // Fallback: выделяем в textarea
      if (textareaRef.current) {
        textareaRef.current.select()
        try {
          document.execCommand('copy')
          onNotify('Текст скопирован в буфер обмена')
        } catch {
          onError('Не удалось скопировать. Выделите текст вручную.')
        }
      } else {
        onError('Не удалось скопировать. Выделите текст вручную.')
      }
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center py-8 px-4 overflow-y-auto"
      onMouseDown={handleBackdropMouseDown}
      onMouseUp={handleBackdropMouseUp}
    >
      <div className="bg-white rounded-2xl max-w-2xl w-full shadow-xl my-auto">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Напоминание родителям</h3>
            <div className="text-xs text-gray-500 mt-0.5">
              Скопируйте текст и отправьте в чат класса
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

        <div className="p-6 space-y-4">
          {/* Фильтр кого включить */}
          <div>
            <label className="text-xs text-gray-500 block mb-2">
              Кого включить
            </label>
            <div className="flex gap-1 flex-wrap">
              {([
                { id: 'all' as const,         label: 'Все незавершившие' },
                { id: 'not_started' as const, label: 'Не начали' },
                { id: 'in_progress' as const, label: 'В процессе' },
              ]).map(f => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  disabled={counts[f.id] === 0}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${
                    filter === f.id
                      ? 'border-gray-900 bg-gray-900 text-white font-medium'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300 disabled:opacity-40 disabled:cursor-not-allowed'
                  }`}
                >
                  {f.label}
                  <span className={`font-normal ml-1.5 ${filter === f.id ? 'text-gray-300' : 'text-gray-400'}`}>
                    {counts[f.id]}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Группировка */}
          {hasMultipleClasses && (
            <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-600">
              <input
                type="checkbox"
                checked={groupByClass}
                onChange={e => setGroupByClass(e.target.checked)}
                className="rounded"
              />
              Группировать по классу ({uniqueClasses.length})
            </label>
          )}

          {/* Превью */}
          {targets.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">
              Нет учеников для напоминания в выбранном фильтре
            </div>
          ) : (
            <>
              <div>
                <label className="text-xs text-gray-500 block mb-1">
                  Текст · {targets.length} учеников
                </label>
                <textarea
                  ref={textareaRef}
                  value={text}
                  readOnly
                  rows={14}
                  className="input w-full font-mono text-xs resize-none"
                  onClick={e => (e.target as HTMLTextAreaElement).select()}
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="btn-primary flex-1"
                >
                  Скопировать
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-secondary"
                >
                  Закрыть
                </button>
              </div>

              <p className="text-xs text-gray-400">
                Ссылки персональные: каждая привязана к конкретному ученику.
                Рекомендуем отправлять в личные сообщения, а не в общий чат —
                чтобы родители не перепутали и не открыли чужую ссылку.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// МОДАЛКА УПРАВЛЕНИЯ КОМАНДОЙ (users + invitations)
// Доступна только для owner
// ============================================================

type TeamUser = {
  id: string
  email: string
  full_name: string
  role: 'owner' | 'manager' | 'viewer'
  is_active: boolean
  last_login: string | null
  created_at: string
}

type Invitation = {
  id: string
  email: string
  role: 'owner' | 'manager' | 'viewer'
  token: string
  expires_at: string
  accepted_at: string | null
  created_at: string
  invited_by: string | null
  invited_by_name: string | null
}

const ROLE_LABELS: Record<string, string> = {
  owner:   'Владелец',
  manager: 'Менеджер',
  viewer:  'Наблюдатель',
}

const ROLE_DESCRIPTIONS: Record<string, string> = {
  owner:   'Полный доступ, включая команду и настройки',
  manager: 'Управление альбомами и учениками',
  viewer:  'Только просмотр',
}

function TeamModal({
  currentUserId,
  onClose,
  onNotify,
  onError,
}: {
  currentUserId: string
  onClose: () => void
  onNotify: (msg: string) => void
  onError: (msg: string) => void
}) {
  const [tab, setTab] = useState<'users' | 'invitations'>('users')
  const [users, setUsers] = useState<TeamUser[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [backdropStart, setBackdropStart] = useState(false)

  // Форма приглашения
  const [showInviteForm, setShowInviteForm] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'owner' | 'manager' | 'viewer'>('manager')
  const [busy, setBusy] = useState(false)

  const handleBackdropMouseDown = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) setBackdropStart(true)
  }
  const handleBackdropMouseUp = (e: React.MouseEvent) => {
    if (backdropStart && e.target === e.currentTarget) onClose()
    setBackdropStart(false)
  }

  const load = async () => {
    setLoading(true)
    const [ur, ir] = await Promise.all([
      api('/api/tenant?action=users').then(r => r.ok ? r.json() : []),
      api('/api/tenant?action=invitations').then(r => r.ok ? r.json() : []),
    ])
    setUsers(Array.isArray(ur) ? ur : [])
    setInvitations(Array.isArray(ir) ? ir : [])
    setLoading(false)
  }

  useEffect(() => {
    load().catch(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submitInvite = async () => {
    const email = inviteEmail.trim().toLowerCase()
    if (!email) return
    setBusy(true)
    const r = await api('/api/tenant', {
      method: 'POST',
      body: JSON.stringify({
        action: 'invite_user',
        email,
        role: inviteRole,
      }),
    })
    if (r.ok) {
      const inv = await r.json()
      setInviteEmail('')
      setInviteRole('manager')
      setShowInviteForm(false)
      onNotify(`Приглашение создано. Отправьте ссылку ${email}.`)
      // Автоматически копируем ссылку
      const url = `${window.location.origin}/invite/${inv.token}`
      try { await navigator.clipboard.writeText(url) } catch {}
      await load()
      setTab('invitations')
    } else {
      const d = await r.json().catch(() => ({}))
      if (d.existing && d.token) {
        // Уже было — копируем старую ссылку
        const url = `${window.location.origin}/invite/${d.token}`
        try {
          await navigator.clipboard.writeText(url)
          onNotify(`${d.error}. Ссылка скопирована.`)
        } catch {
          onError(d.error)
        }
        await load()
      } else {
        onError(d.error ?? 'Не удалось создать приглашение')
      }
    }
    setBusy(false)
  }

  const copyInviteLink = async (inv: Invitation) => {
    const url = `${window.location.origin}/invite/${inv.token}`
    try {
      await navigator.clipboard.writeText(url)
      onNotify(`Ссылка скопирована: отправьте ${inv.email}`)
    } catch {
      onError('Не удалось скопировать. Ссылка: ' + url)
    }
  }

  const revokeInvitation = async (inv: Invitation) => {
    if (!confirm(`Отозвать приглашение для ${inv.email}?`)) return
    const r = await api('/api/tenant', {
      method: 'POST',
      body: JSON.stringify({ action: 'revoke_invitation', id: inv.id }),
    })
    if (r.ok) {
      setInvitations(prev => prev.filter(x => x.id !== inv.id))
      onNotify('Приглашение отозвано')
    } else {
      const d = await r.json().catch(() => ({}))
      onError(d.error ?? 'Не удалось отозвать')
    }
  }

  const changeRole = async (u: TeamUser, newRole: 'owner' | 'manager' | 'viewer') => {
    if (newRole === u.role) return
    const prev = users
    // оптимистично
    setUsers(p => p.map(x => x.id === u.id ? { ...x, role: newRole } : x))
    const r = await api('/api/tenant', {
      method: 'POST',
      body: JSON.stringify({ action: 'change_role', user_id: u.id, role: newRole }),
    })
    if (r.ok) {
      onNotify(`${u.full_name || u.email}: роль изменена на «${ROLE_LABELS[newRole]}»`)
    } else {
      setUsers(prev) // откат
      const d = await r.json().catch(() => ({}))
      onError(d.error ?? 'Не удалось сменить роль')
    }
  }

  const removeUser = async (u: TeamUser) => {
    if (!confirm(`Удалить ${u.full_name || u.email} из команды?\n\nДоступ будет отозван немедленно. Это действие нельзя отменить.`)) return
    const r = await api('/api/tenant', {
      method: 'POST',
      body: JSON.stringify({ action: 'remove_user', user_id: u.id }),
    })
    if (r.ok) {
      setUsers(p => p.filter(x => x.id !== u.id))
      onNotify(`${u.full_name || u.email} удалён из команды`)
    } else {
      const d = await r.json().catch(() => ({}))
      onError(d.error ?? 'Не удалось удалить')
    }
  }

  const formatDate = (s: string | null) => {
    if (!s) return '—'
    return new Date(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  const formatLastLogin = (s: string | null) => {
    if (!s) return 'никогда'
    const d = new Date(s)
    const diff = Date.now() - d.getTime()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    if (days === 0) return 'сегодня'
    if (days === 1) return 'вчера'
    if (days < 7) return `${days} дн. назад`
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-40 flex items-start justify-center py-8 px-4 overflow-y-auto"
      onMouseDown={handleBackdropMouseDown}
      onMouseUp={handleBackdropMouseUp}
    >
      <div className="bg-white rounded-2xl max-w-3xl w-full shadow-xl my-auto">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white rounded-t-2xl z-10">
          <div>
            <h3 className="text-lg font-semibold">Команда</h3>
            <div className="text-xs text-gray-500 mt-0.5">
              Сотрудники вашего аккаунта и активные приглашения
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!showInviteForm && (
              <button
                type="button"
                onClick={() => setShowInviteForm(true)}
                className="btn-primary text-xs px-3 py-1.5"
              >
                + Пригласить
              </button>
            )}
            <button
              onClick={onClose}
              type="button"
              className="text-gray-400 hover:text-gray-700 text-xl leading-none"
            >
              ×
            </button>
          </div>
        </div>

        {/* Табы */}
        {!showInviteForm && (
          <div className="px-6 pt-4 border-b border-gray-100 flex gap-1">
            <button
              type="button"
              onClick={() => setTab('users')}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === 'users'
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Сотрудники
              <span className="text-gray-400 font-normal ml-1.5">{users.length}</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('invitations')}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === 'invitations'
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Приглашения
              <span className="text-gray-400 font-normal ml-1.5">{invitations.length}</span>
            </button>
          </div>
        )}

        <div className="p-6">
          {/* Форма приглашения */}
          {showInviteForm ? (
            <div className="space-y-4">
              <h4 className="font-medium text-gray-800">Новое приглашение</h4>

              <div>
                <label className="text-xs text-gray-500 block mb-1">Email</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="colleague@example.com"
                  className="input w-full"
                  disabled={busy}
                  autoFocus
                />
              </div>

              <div>
                <label className="text-xs text-gray-500 block mb-2">Роль</label>
                <div className="space-y-2">
                  {(['owner', 'manager', 'viewer'] as const).map(r => (
                    <label
                      key={r}
                      className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                        inviteRole === r
                          ? 'border-gray-900 bg-gray-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="role"
                        checked={inviteRole === r}
                        onChange={() => setInviteRole(r)}
                        className="mt-0.5"
                      />
                      <div>
                        <div className="text-sm font-medium text-gray-900">{ROLE_LABELS[r]}</div>
                        <div className="text-xs text-gray-500">{ROLE_DESCRIPTIONS[r]}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700">
                После создания вы получите ссылку-приглашение — отправьте её
                сотруднику любым удобным способом (мессенджер, email).
                Ссылка действует 7 дней.
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={submitInvite}
                  disabled={!inviteEmail.trim() || busy}
                  className="btn-primary"
                >
                  {busy ? 'Создаю...' : 'Создать приглашение'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowInviteForm(false)
                    setInviteEmail('')
                    setInviteRole('manager')
                  }}
                  disabled={busy}
                  className="btn-secondary"
                >
                  Отмена
                </button>
              </div>
            </div>
          ) : loading ? (
            <div className="text-center text-gray-400 text-sm py-8">Загружаем...</div>
          ) : tab === 'users' ? (
            // ========== СОТРУДНИКИ ==========
            users.length === 0 ? (
              <div className="text-center text-gray-400 text-sm py-8">
                Кроме вас пока никого.
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setShowInviteForm(true)}
                    className="btn-primary text-sm"
                  >
                    + Пригласить первого сотрудника
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {users.map(u => {
                  const isSelf = u.id === currentUserId
                  return (
                    <div
                      key={u.id}
                      className={`border rounded-xl p-4 ${
                        isSelf ? 'border-gray-300 bg-gray-50' : 'border-gray-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium text-gray-900 truncate">
                              {u.full_name || u.email}
                            </p>
                            {isSelf && (
                              <span className="text-[10px] uppercase tracking-wide text-gray-500 bg-white border border-gray-200 px-1.5 py-0.5 rounded">
                                это вы
                              </span>
                            )}
                            {!u.is_active && (
                              <span className="text-[10px] uppercase tracking-wide text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
                                отключён
                              </span>
                            )}
                          </div>
                          {u.full_name && (
                            <p className="text-sm text-gray-500 truncate">{u.email}</p>
                          )}
                        </div>
                        <div className="text-xs text-gray-400 whitespace-nowrap">
                          {formatLastLogin(u.last_login)}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-gray-100">
                        {(['owner', 'manager', 'viewer'] as const).map(r => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => !isSelf && changeRole(u, r)}
                            disabled={isSelf || u.role === r}
                            title={isSelf ? 'Нельзя сменить свою роль' : ''}
                            className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${
                              u.role === r
                                ? 'border-gray-400 bg-white text-gray-800 font-medium cursor-default'
                                : isSelf
                                ? 'border-gray-200 text-gray-300 cursor-not-allowed'
                                : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700'
                            }`}
                          >
                            {ROLE_LABELS[r]}
                          </button>
                        ))}
                        {!isSelf && (
                          <button
                            type="button"
                            onClick={() => removeUser(u)}
                            className="text-xs text-red-500 hover:text-red-700 ml-auto"
                          >
                            Удалить
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          ) : (
            // ========== ПРИГЛАШЕНИЯ ==========
            invitations.length === 0 ? (
              <div className="text-center text-gray-400 text-sm py-8">
                Нет активных приглашений
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setShowInviteForm(true)}
                    className="btn-primary text-sm"
                  >
                    + Пригласить
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {invitations.map(inv => {
                  const expiresIn = Math.ceil(
                    (new Date(inv.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
                  )
                  return (
                    <div key={inv.id} className="border border-gray-200 rounded-xl p-4">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-gray-900 truncate">{inv.email}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            Роль: <strong>{ROLE_LABELS[inv.role]}</strong>
                            {inv.invited_by_name && (
                              <> · пригласил(а) {inv.invited_by_name}</>
                            )}
                            {' · создано '}
                            {formatDate(inv.created_at)}
                          </p>
                        </div>
                        <span
                          className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${
                            expiresIn <= 1
                              ? 'bg-red-50 text-red-600'
                              : expiresIn <= 3
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {expiresIn <= 0
                            ? 'истекает'
                            : expiresIn === 1
                            ? 'ещё 1 день'
                            : `ещё ${expiresIn} дн.`}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                        <button
                          type="button"
                          onClick={() => copyInviteLink(inv)}
                          className="text-xs text-gray-600 hover:text-gray-900 font-medium"
                        >
                          Скопировать ссылку
                        </button>
                        <button
                          type="button"
                          onClick={() => revokeInvitation(inv)}
                          className="text-xs text-red-500 hover:text-red-700 ml-auto"
                        >
                          Отозвать
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// МОДАЛКА НАСТРОЕК (профиль + аккаунт tenant'а)
// - Вкладка "Пароль" — для всех ролей
// - Вкладка "Аккаунт" — только для owner (название, контакты tenant'а)
// ============================================================

type TenantSettings = {
  id: string
  name: string
  slug: string
  logo_url: string | null
  city: string | null
  phone: string | null
  email: string | null
  plan: string
  plan_expires: string | null
  max_albums: number
  is_active: boolean
  created_at: string
  settings: {
    brand_color?: string
    welcome_text?: string
    footer_text?: string
    [k: string]: any
  }
}

function SettingsModal({
  userRole,
  onClose,
  onNotify,
  onError,
}: {
  userRole: string
  onClose: () => void
  onNotify: (msg: string) => void
  onError: (msg: string) => void
}) {
  const isOwner = userRole === 'owner'
  const [tab, setTab] = useState<'password' | 'account' | 'branding'>(isOwner ? 'account' : 'password')
  const [backdropStart, setBackdropStart] = useState(false)

  // Аккаунт
  const [tenant, setTenant] = useState<TenantSettings | null>(null)
  const [loadingTenant, setLoadingTenant] = useState(true)
  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [savingAccount, setSavingAccount] = useState(false)

  // Пароль
  const [current, setCurrent] = useState('')
  const [next1, setNext1] = useState('')
  const [next2, setNext2] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  // Брендинг
  const [brandColor, setBrandColor] = useState('')
  const [welcomeText, setWelcomeText] = useState('')
  const [footerText, setFooterText] = useState('')
  const [logoPreviewKey, setLogoPreviewKey] = useState(0) // для сброса кэша img
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [savingBranding, setSavingBranding] = useState(false)

  const handleBackdropMouseDown = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) setBackdropStart(true)
  }
  const handleBackdropMouseUp = (e: React.MouseEvent) => {
    if (backdropStart && e.target === e.currentTarget) onClose()
    setBackdropStart(false)
  }

  const loadTenant = async () => {
    setLoadingTenant(true)
    const r = await api('/api/tenant?action=tenant_settings')
    if (r.ok) {
      const d = await r.json()
      setTenant(d)
      setName(d.name ?? '')
      setCity(d.city ?? '')
      setPhone(d.phone ?? '')
      setEmail(d.email ?? '')
      setBrandColor(d.settings?.brand_color ?? '')
      setWelcomeText(d.settings?.welcome_text ?? '')
      setFooterText(d.settings?.footer_text ?? '')
      setLogoPreviewKey(k => k + 1) // обновить превью
    } else {
      onError('Не удалось загрузить настройки аккаунта')
    }
    setLoadingTenant(false)
  }

  useEffect(() => {
    if (isOwner) loadTenant().catch(() => setLoadingTenant(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveAccount = async () => {
    if (!name.trim()) {
      onError('Название не может быть пустым')
      return
    }
    setSavingAccount(true)
    const r = await api('/api/tenant', {
      method: 'POST',
      body: JSON.stringify({
        action: 'update_tenant_settings',
        name: name.trim(),
        city: city.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
      }),
    })
    if (r.ok) {
      onNotify('Настройки аккаунта сохранены')
      await loadTenant()
    } else {
      const d = await r.json().catch(() => ({}))
      onError(d.error ?? 'Не удалось сохранить')
    }
    setSavingAccount(false)
  }

  const savePassword = async () => {
    setPasswordError(null)

    if (!current || !next1 || !next2) {
      setPasswordError('Заполните все поля')
      return
    }
    if (next1.length < 8) {
      setPasswordError('Новый пароль должен быть не короче 8 символов')
      return
    }
    if (next1 !== next2) {
      setPasswordError('Новые пароли не совпадают')
      return
    }
    if (next1 === current) {
      setPasswordError('Новый пароль совпадает с текущим')
      return
    }

    setSavingPassword(true)
    const r = await api('/api/tenant', {
      method: 'POST',
      body: JSON.stringify({
        action: 'change_password',
        current_password: current,
        new_password: next1,
      }),
    })
    if (r.ok) {
      onNotify('Пароль изменён. На других устройствах потребуется войти заново.')
      setCurrent('')
      setNext1('')
      setNext2('')
    } else {
      const d = await r.json().catch(() => ({}))
      setPasswordError(d.error ?? 'Не удалось сменить пароль')
    }
    setSavingPassword(false)
  }

  const saveBranding = async () => {
    setSavingBranding(true)
    const r = await api('/api/tenant', {
      method: 'POST',
      body: JSON.stringify({
        action: 'update_branding',
        brand_color: brandColor.trim() || '',
        welcome_text: welcomeText,
        footer_text: footerText,
      }),
    })
    if (r.ok) {
      onNotify('Брендинг сохранён')
      await loadTenant()
    } else {
      const d = await r.json().catch(() => ({}))
      onError(d.error ?? 'Не удалось сохранить')
    }
    setSavingBranding(false)
  }

  const uploadLogo = async (file: File) => {
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      onError('Размер файла не должен превышать 5 МБ')
      return
    }

    setUploadingLogo(true)
    const form = new FormData()
    form.append('action', 'upload_logo')
    form.append('file', file)

    const res = await fetch('/api/tenant', {
      method: 'POST',
      credentials: 'include',
      body: form,
    })

    if (res.ok) {
      onNotify('Логотип загружен')
      await loadTenant()
    } else {
      const d = await res.json().catch(() => ({}))
      onError(d.error ?? 'Не удалось загрузить логотип')
    }
    setUploadingLogo(false)
  }

  const deleteLogo = async () => {
    if (!confirm('Удалить логотип?')) return
    const r = await api('/api/tenant', {
      method: 'POST',
      body: JSON.stringify({ action: 'update_branding', logo_url: null }),
    })
    if (r.ok) {
      onNotify('Логотип удалён')
      await loadTenant()
    } else {
      const d = await r.json().catch(() => ({}))
      onError(d.error ?? 'Не удалось удалить')
    }
  }

  const PLAN_LABELS: Record<string, string> = {
    free:       'Free',
    basic:      'Basic',
    pro:        'Pro',
    enterprise: 'Enterprise',
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-40 flex items-start justify-center py-8 px-4 overflow-y-auto"
      onMouseDown={handleBackdropMouseDown}
      onMouseUp={handleBackdropMouseUp}
    >
      <div className="bg-white rounded-2xl max-w-xl w-full shadow-xl my-auto">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white rounded-t-2xl z-10">
          <div>
            <h3 className="text-lg font-semibold">Настройки</h3>
            <div className="text-xs text-gray-500 mt-0.5">
              Параметры аккаунта и пароль
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

        {/* Табы — показываем только если есть доступ к обоим */}
        {isOwner && (
          <div className="px-6 pt-4 border-b border-gray-100 flex gap-1">
            <button
              type="button"
              onClick={() => setTab('account')}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === 'account'
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Аккаунт
            </button>
            <button
              type="button"
              onClick={() => setTab('branding')}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === 'branding'
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Брендинг
            </button>
            <button
              type="button"
              onClick={() => setTab('password')}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === 'password'
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Пароль
            </button>
          </div>
        )}

        <div className="p-6">
          {/* ========== Вкладка АККАУНТ ========== */}
          {isOwner && tab === 'account' && (
            loadingTenant ? (
              <div className="text-center text-gray-400 text-sm py-8">Загружаем...</div>
            ) : tenant ? (
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">
                    Название <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="input w-full"
                    maxLength={100}
                    disabled={savingAccount}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Город</label>
                    <input
                      type="text"
                      value={city}
                      onChange={e => setCity(e.target.value)}
                      className="input w-full"
                      disabled={savingAccount}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Телефон</label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      placeholder="+7 ..."
                      className="input w-full"
                      disabled={savingAccount}
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs text-gray-500 block mb-1">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="hello@example.com"
                    className="input w-full"
                    disabled={savingAccount}
                  />
                </div>

                <button
                  type="button"
                  onClick={saveAccount}
                  disabled={savingAccount || !name.trim()}
                  className="btn-primary"
                >
                  {savingAccount ? 'Сохраняю...' : 'Сохранить'}
                </button>

                {/* Read-only блок: план, лимиты, slug */}
                <div className="mt-6 pt-4 border-t border-gray-100 space-y-2">
                  <h5 className="text-xs uppercase tracking-wide text-gray-400">
                    Тариф
                  </h5>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-xs text-gray-500">План</div>
                      <div className="font-medium text-gray-800">
                        {PLAN_LABELS[tenant.plan] ?? tenant.plan}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Лимит альбомов</div>
                      <div className="font-medium text-gray-800">
                        {tenant.max_albums}
                      </div>
                    </div>
                    {tenant.plan_expires && (
                      <div className="col-span-2">
                        <div className="text-xs text-gray-500">Действует до</div>
                        <div className="font-medium text-gray-800">
                          {new Date(tenant.plan_expires).toLocaleDateString('ru-RU', {
                            day: 'numeric', month: 'long', year: 'numeric',
                          })}
                        </div>
                      </div>
                    )}
                    <div>
                      <div className="text-xs text-gray-500">Идентификатор</div>
                      <div className="font-mono text-xs text-gray-700">
                        {tenant.slug}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Создан</div>
                      <div className="text-xs text-gray-700">
                        {new Date(tenant.created_at).toLocaleDateString('ru-RU')}
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 mt-2">
                    Для смены тарифа или лимитов обратитесь в поддержку.
                  </p>
                </div>
              </div>
            ) : (
              <div className="text-center text-gray-400 text-sm py-8">Нет данных</div>
            )
          )}

          {/* ========== Вкладка БРЕНДИНГ ========== */}
          {isOwner && tab === 'branding' && (
            loadingTenant ? (
              <div className="text-center text-gray-400 text-sm py-8">Загружаем...</div>
            ) : tenant ? (
              <div className="space-y-5">
                {/* Логотип */}
                <div>
                  <label className="text-xs text-gray-500 block mb-2">
                    Логотип
                    <span className="text-gray-400 ml-2">PNG или JPG до 5 МБ · будет обрезан до квадрата</span>
                  </label>
                  <div className="flex items-center gap-4">
                    {tenant.logo_url ? (
                      <img
                        key={logoPreviewKey}
                        src={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/photos/${tenant.logo_url}?t=${logoPreviewKey}`}
                        alt="Логотип"
                        className="w-16 h-16 rounded-lg object-cover border border-gray-200"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400 text-xs border border-gray-200">
                        Нет
                      </div>
                    )}
                    <div className="flex-1 flex items-center gap-2 flex-wrap">
                      <label className="btn-secondary text-sm cursor-pointer">
                        {uploadingLogo ? 'Загружаю...' : (tenant.logo_url ? 'Заменить' : 'Загрузить')}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={uploadingLogo}
                          onChange={async e => {
                            const f = e.target.files?.[0]
                            if (f) {
                              await uploadLogo(f)
                              setLogoPreviewKey(k => k + 1)
                            }
                            e.target.value = ''
                          }}
                        />
                      </label>
                      {tenant.logo_url && (
                        <button
                          type="button"
                          onClick={deleteLogo}
                          disabled={uploadingLogo}
                          className="text-sm text-red-500 hover:text-red-700"
                        >
                          Удалить
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Цвет бренда */}
                <div>
                  <label className="text-xs text-gray-500 block mb-1">
                    Фирменный цвет
                    <span className="text-gray-400 ml-2">HEX вида #RRGGBB</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={brandColor || '#3b82f6'}
                      onChange={e => setBrandColor(e.target.value)}
                      className="h-10 w-14 rounded border border-gray-200 cursor-pointer"
                      disabled={savingBranding}
                    />
                    <input
                      type="text"
                      value={brandColor}
                      onChange={e => setBrandColor(e.target.value)}
                      placeholder="#3b82f6"
                      className="input flex-1 font-mono text-sm"
                      disabled={savingBranding}
                    />
                    {brandColor && (
                      <button
                        type="button"
                        onClick={() => setBrandColor('')}
                        className="text-xs text-gray-500 hover:text-gray-800"
                        disabled={savingBranding}
                      >
                        Сбросить
                      </button>
                    )}
                  </div>
                </div>

                {/* Welcome-text */}
                <div>
                  <label className="text-xs text-gray-500 block mb-1">
                    Приветствие для родителей
                    <span className="text-gray-400 ml-2">
                      {welcomeText.length} / 1000 · показывается на первом шаге
                    </span>
                  </label>
                  <textarea
                    value={welcomeText}
                    onChange={e => setWelcomeText(e.target.value)}
                    rows={4}
                    maxLength={1000}
                    className="input w-full"
                    placeholder="Здравствуйте! Выберите, пожалуйста, 5–7 портретов для альбома..."
                    disabled={savingBranding}
                  />
                </div>

                {/* Footer-text */}
                <div>
                  <label className="text-xs text-gray-500 block mb-1">
                    Подпись внизу страницы
                    <span className="text-gray-400 ml-2">
                      {footerText.length} / 500
                    </span>
                  </label>
                  <textarea
                    value={footerText}
                    onChange={e => setFooterText(e.target.value)}
                    rows={2}
                    maxLength={500}
                    className="input w-full"
                    placeholder="По вопросам: фотограф Сергей, +7 900 000-00-00"
                    disabled={savingBranding}
                  />
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={saveBranding}
                    disabled={savingBranding}
                    className="btn-primary"
                  >
                    {savingBranding ? 'Сохраняю...' : 'Сохранить брендинг'}
                  </button>
                  <p className="text-xs text-gray-400">
                    Логотип сохраняется сразу при загрузке
                  </p>
                </div>
              </div>
            ) : (
              <div className="text-center text-gray-400 text-sm py-8">Нет данных</div>
            )
          )}

          {/* ========== Вкладка ПАРОЛЬ ========== */}
          {tab === 'password' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">
                При смене пароля вы будете разлогинены на других устройствах.
              </p>

              <div>
                <label className="text-xs text-gray-500 block mb-1">
                  Текущий пароль
                </label>
                <input
                  type="password"
                  value={current}
                  onChange={e => setCurrent(e.target.value)}
                  className="input w-full"
                  disabled={savingPassword}
                  autoComplete="current-password"
                />
              </div>

              <div>
                <label className="text-xs text-gray-500 block mb-1">
                  Новый пароль <span className="text-gray-400">(не короче 8 символов)</span>
                </label>
                <input
                  type="password"
                  value={next1}
                  onChange={e => setNext1(e.target.value)}
                  className="input w-full"
                  minLength={8}
                  disabled={savingPassword}
                  autoComplete="new-password"
                />
              </div>

              <div>
                <label className="text-xs text-gray-500 block mb-1">
                  Повторите новый пароль
                </label>
                <input
                  type="password"
                  value={next2}
                  onChange={e => setNext2(e.target.value)}
                  className="input w-full"
                  disabled={savingPassword}
                  autoComplete="new-password"
                />
              </div>

              {passwordError && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  {passwordError}
                </div>
              )}

              <button
                type="button"
                onClick={savePassword}
                disabled={savingPassword || !current || !next1 || !next2}
                className="btn-primary"
              >
                {savingPassword ? 'Меняю...' : 'Сменить пароль'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
