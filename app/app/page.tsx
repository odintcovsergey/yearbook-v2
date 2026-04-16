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
  const [filter, setFilter] = useState<'active' | 'archive'>('active')
  const [search, setSearch] = useState('')

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

        {/* Вкладки + поиск */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
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
            <div className="text-gray-400 text-sm mb-2">
              {search
                ? 'Ничего не найдено'
                : filter === 'active'
                ? 'Пока нет активных альбомов'
                : 'В архиве ничего нет'}
            </div>
            {filter === 'active' && !search && (
              <p className="text-xs text-gray-400">
                Создание альбомов появится на следующем этапе.
                <br />
                Пока для создания используйте{' '}
                <a href="/admin" className="text-blue-600 hover:underline">
                  старую админку
                </a>
                .
              </p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredAlbums.map(a => (
              <AlbumCard
                key={a.id}
                album={a}
                onClick={() => setSelectedAlbum(a)}
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
    </div>
  )
}

// ============================================================
// КАРТОЧКА АЛЬБОМА
// ============================================================

function AlbumCard({ album, onClick }: { album: Album; onClick: () => void }) {
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
      className="card p-5 cursor-pointer hover:border-gray-300 transition-colors"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
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
        <div className="text-right flex-shrink-0">
          <div className="text-2xl font-semibold text-gray-900">{progress}%</div>
        </div>
      </div>

      {/* Прогресс-бар */}
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-3">
        <div
          className="h-full bg-gray-900 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
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
