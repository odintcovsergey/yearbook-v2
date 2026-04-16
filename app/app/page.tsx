'use client'

import { useState, useEffect } from 'react'
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
const api = (path: string, opts?: RequestInit) =>
  fetch(path, {
    ...opts,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
  })

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

  const notify = (text: string, type: 'ok' | 'err' = 'ok') => {
    setMsg({ text, type })
    setTimeout(() => setMsg(null), 4000)
  }

  const canEdit = auth?.user?.role === 'owner' || auth?.user?.role === 'manager'

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
          onClose={() => setSelectedAlbum(null)}
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
}: {
  label: string
  value: number
  subValue?: string
  highlight?: boolean
}) {
  return (
    <div className={`card p-5 ${highlight ? 'border-blue-200 bg-blue-50' : ''}`}>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="flex items-baseline gap-2">
        <div className="text-2xl font-semibold text-gray-900">{value}</div>
        {subValue && (
          <div className={`text-sm ${highlight ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>
            {subValue}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================
// МОДАЛКА ДЕТАЛЕЙ АЛЬБОМА (read-only)
// ============================================================

function AlbumDetailModal({ album, onClose }: { album: Album; onClose: () => void }) {
  const [stats, setStats] = useState<AlbumStats | null>(null)
  const [children, setChildren] = useState<Child[]>([])
  const [loading, setLoading] = useState(true)
  const [backdropStart, setBackdropStart] = useState(false)

  const handleBackdropMouseDown = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) setBackdropStart(true)
  }
  const handleBackdropMouseUp = (e: React.MouseEvent) => {
    if (backdropStart && e.target === e.currentTarget) onClose()
    setBackdropStart(false)
  }

  useEffect(() => {
    Promise.all([
      api(`/api/tenant?action=album_stats&album_id=${album.id}`).then(r => r.json()),
      api(`/api/tenant?action=children&album_id=${album.id}`).then(r => r.json()),
    ])
      .then(([s, c]) => {
        setStats(s)
        setChildren(Array.isArray(c) ? c : [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [album.id])

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
          <button
            onClick={onClose}
            type="button"
            className="text-gray-400 hover:text-gray-700 text-xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="text-center text-gray-400 text-sm py-8">Загружаем данные...</div>
          ) : (
            <>
              {/* Статистика */}
              {stats && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                  <MiniStat label="Всего" value={stats.total} />
                  <MiniStat label="Завершили" value={stats.submitted} tone="green" />
                  <MiniStat label="В процессе" value={stats.in_progress} tone="amber" />
                  <MiniStat label="Не начали" value={stats.not_started} tone="gray" />
                </div>
              )}

              {stats && (stats.teachers_total > 0 || stats.surcharge_count > 0) && (
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

              {/* Ученики */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-medium">Ученики</h4>
                  <div className="text-xs text-gray-400">
                    Просмотр. Редактирование — на следующем этапе.
                  </div>
                </div>

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
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {children.map(c => (
                            <tr key={c.id} className="hover:bg-gray-50">
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
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
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
      }
    }
    return emptyForm()
  })

  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(false)
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false)
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
    }

    if (mode === 'create') {
      payload.action = 'create_album'
      payload.template_title = form.template_title || null
    } else {
      payload.action = 'update_album'
      payload.album_id = album!.id
    }

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
          {/* Шаблон — только при создании */}
          {mode === 'create' && templates.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Шаблон
              </label>
              <div className="flex flex-wrap gap-2">
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
              <p className="text-xs text-gray-500 mt-1">
                Применяет все настройки шаблона. Их потом можно поменять.
              </p>
            </div>
          )}

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
                <button
                  type="button"
                  onClick={handleUnarchive}
                  className="btn-secondary"
                  disabled={loading}
                >
                  Вернуть из архива
                </button>
              )}
            </div>
          )}
        </form>
      </div>
    </div>
  )
}
