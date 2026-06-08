'use client'

import React, { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import {
  Camera,
  Contact,
  LayoutTemplate,
  Quote,
  Users,
  Settings,
  Gift,
  Ruler,
  Upload,
  Loader2,
  AlertTriangle,
  X,
  Check,
  Bell,
  Link2,
  Copy,
  Send,
  Info,
  Trash2,
  Download,
  Maximize2,
  Eye,
} from 'lucide-react'
import CRMModal from './CRMModal'
// РЭ.21.7.3: drag-and-drop секций в редакторе пресета.
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const LayoutPreviewStrip = dynamic(
  () => import('./_components/LayoutPreviewStrip'),
  { ssr: false, loading: () => null },
)

const ExportPanel = dynamic(
  () => import('./_components/ExportPanel'),
  { ssr: false, loading: () => null },
)

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
  print_type?: string | null
  config_preset_id?: string | null
  config_preset_slug?: string | null
  config_preset_name?: string | null
  vignettes_enabled?: boolean | null  // А.3.4: null=дефолт пресета, true/false=override
  common_section_max_spreads?: number | null  // А.4.3: null=без лимита, 0=отключён, >0=лимит
  rules_preset_id?: string | null  // РЭ.21.8.чистка-1: deprecated, оставлено для совместимости со старыми ответами API
  section_structure_preset_id?: string | null  // РЭ.21.8.7: если задан, build_album использует
                                                // buildFromSectionStructure
  include_non_purchasers?: boolean  // РЭ.25: включать ли не-заказчиков в личный раздел
  student_distribution?: 'auto' | 'equalize' | 'greedy'  // РЭ.40: стратегия grid-распределения
  symmetrize_students_tail_override?: boolean | null  // РЭ.46: override симметризации
                                                       // хвоста students (NULL=из пресета).
  referral_program_id?: string | null  // Реферальная программа заказа (uuid|null).
  stats: { total: number; submitted: number; in_progress: number; purchased?: number }
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
  config_preset_id?: string | null
  config_preset_slug?: string | null
  config_preset_name?: string | null
  is_purchased?: boolean  // РЭ.25: заказывает ли ребёнок альбом (default true)
}

type AlbumStats = {
  total: number
  submitted: number
  in_progress: number
  not_started: number
  purchased?: number  // РЭ.25: N учеников с is_purchased!==false
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
// AlbumDeepLinkHandler — обрабатывает ?album=<UUID> в URL.
// Вынесен в отдельный компонент чтобы локально обернуть useSearchParams
// в Suspense (требование Next.js 14+ для CSR-bailout). См. 2.6.5.1.
// ============================================================
function AlbumDeepLinkHandler({
  albums,
  setSelectedAlbum,
}: {
  albums: Album[]
  setSelectedAlbum: (a: Album) => void
}) {
  const searchParams = useSearchParams()
  useEffect(() => {
    const queryAlbumId = searchParams.get('album')
    if (!queryAlbumId || albums.length === 0) return
    const found = albums.find((a) => a.id === queryAlbumId)
    if (found) setSelectedAlbum(found)
  }, [searchParams, albums, setSelectedAlbum])
  return null
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
  const [showCRM, setShowCRM] = useState(false)
  const [showPartners, setShowPartners] = useState(false)
  const [showPresets, setShowPresets] = useState(false)

  const notify = (text: string, type: 'ok' | 'err' = 'ok') => {
    setMsg({ text, type })
    setTimeout(() => setMsg(null), 4000)
  }

  const canEdit = auth?.user?.role === 'owner' || auth?.user?.role === 'manager'
  const canManageTeam = auth?.user?.role === 'owner'
  const [isMainTenant, setIsMainTenant] = useState(false)
  const currentUserId = auth?.user?.id ?? null

  // Техдолг#4 — Lift originalsProgress в AppPage чтобы:
  // 1. beforeunload protection работал когда модал альбома закрыт
  //    (раньше state жил в PhotosTab → unmount при закрытии модала
  //    → useEffect cleanup → handler удалён → потеря защиты)
  // 2. Глобальный индикатор «📤 Грузим N» виден везде в кабинете
  //    (а не только когда открыта вкладка Фото)
  //
  // PhotosTab получает state и setter через props, использует тот же
  // tracking что раньше.
  const [originalsProgress, setOriginalsProgress] = useState<
    | null
    | {
        total: number
        done: number
        failed: number
        // UX#2 — счётчик сейчас активно загружающихся (started но не done).
        // Помогает партнёру понять что 'после WebP=100%' процесс не завис,
        // а оригиналы реально идут network'ом в фоне.
        inProgress: number
        totalBytes: number
        doneBytes: number
        failedFilenames: string[]
        completed: boolean
      }
  >(null)

  // beforeunload protection живёт на уровне AppPage — пока вкладка
  // открыта и есть pending оригиналы, partнёр получит предупреждение
  // независимо от того открыт ли модал альбома или закрыт.
  useEffect(() => {
    if (!originalsProgress || originalsProgress.completed) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue =
        'Идёт загрузка оригиналов для печати. Если закрыть сейчас — фотографии не будут в высоком качестве в PDF.'
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [originalsProgress])

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
      if (d.isMainTenant !== undefined) setIsMainTenant(d.isMainTenant)
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
      <Suspense fallback={null}>
        <AlbumDeepLinkHandler
          albums={albums}
          setSelectedAlbum={setSelectedAlbum}
        />
      </Suspense>
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
            {/* Техдолг#4 — глобальный индикатор фоновой загрузки оригиналов.
                Виден везде в кабинете (даже когда модал альбома закрыт),
                клик не нужен — только информирующий бейдж. Цвет зависит
                от состояния: blue=идёт, green=всё ок, amber=есть упавшие. */}
            {originalsProgress && (
              <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium ${
                  !originalsProgress.completed
                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                    : originalsProgress.failed > 0
                      ? 'bg-amber-50 text-amber-700 border border-amber-200'
                      : 'bg-green-50 text-green-700 border border-green-200'
                }`}
                title={
                  !originalsProgress.completed
                    ? 'Идёт загрузка оригиналов для печати. Не закрывайте вкладку.'
                    : originalsProgress.failed > 0
                      ? `${originalsProgress.failed} оригиналов не загрузились — можно догрузить вручную через карточку фото`
                      : 'Все оригиналы успешно загружены'
                }
              >
                {!originalsProgress.completed ? (
                  <>
                    <span className="animate-pulse"><Upload size={14} /></span>
                    <span>
                      Оригиналы: {originalsProgress.done}/{originalsProgress.total}
                      {originalsProgress.inProgress > 0 && originalsProgress.done < originalsProgress.total && (
                        <span className="text-blue-500 ml-1">
                          (<Loader2 size={14} className="inline animate-spin" />{originalsProgress.inProgress})
                        </span>
                      )}
                    </span>
                  </>
                ) : originalsProgress.failed > 0 ? (
                  <>
                    <span><AlertTriangle size={14} className="inline" /></span>
                    <span>
                      Оригиналы: {originalsProgress.done - originalsProgress.failed}/{originalsProgress.total}
                    </span>
                    <button
                      type="button"
                      onClick={() => setOriginalsProgress(null)}
                      className="ml-1 text-amber-600 hover:text-amber-800"
                      title="Скрыть"
                    >
                      <X size={14} />
                    </button>
                  </>
                ) : (
                  <>
                    <span><Check size={14} className="inline" /></span>
                    <span>Оригиналы загружены</span>
                    <button
                      type="button"
                      onClick={() => setOriginalsProgress(null)}
                      className="ml-1 text-green-600 hover:text-green-800"
                      title="Скрыть"
                    >
                      <X size={14} />
                    </button>
                  </>
                )}
              </div>
            )}
            <button
              onClick={() => router.push('/app/templates')}
              className="btn-secondary"
              title="Готовые шаблоны и моя библиотека"
            >
              <Ruler size={16} /> Шаблоны
            </button>
            <button
              onClick={() => router.push('/app/referral-programs')}
              className="btn-secondary"
              title="Реферальные программы: готовые и свои"
            >
              <Gift size={16} /> Рефералки
            </button>
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
                  filter === 'active' ? 'bg-white shadow-sm text-brand-700' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Актуальные
                {summary && <span className="text-gray-400 ml-1.5">{summary.albums_active}</span>}
              </button>
              <button
                onClick={() => setFilter('archive')}
                className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                  filter === 'archive' ? 'bg-white shadow-sm text-brand-700' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Архив
                {summary && <span className="text-gray-400 ml-1.5">{summary.albums_archived}</span>}
              </button>
            </div>

{isMainTenant && (
              <button
                onClick={() => setShowPartners(true)}
                className="btn-ghost text-sm"
                type="button"
              >
                <Camera size={16} /> Партнёры
              </button>
            )}

            <button
              onClick={() => setShowCRM(true)}
              className="btn-ghost text-sm"
              type="button"
              title="CRM — клиенты и сделки"
            >
              <Contact size={16} /> CRM
            </button>

            <button
              onClick={() => setShowPresets(true)}
              className="btn-ghost text-sm"
              type="button"
              title="Пресеты — структура альбома"
            >
              <LayoutTemplate size={16} /> Пресеты
            </button>

            <button
              onClick={() => setShowQuotes(true)}
              className="btn-ghost text-sm"
              type="button"
              title="Управление цитатами"
            >
              <Quote size={16} /> Цитаты
            </button>

            {canManageTeam && (
              <button
                onClick={() => setShowTeam(true)}
                className="btn-ghost text-sm"
                type="button"
                title="Сотрудники и приглашения"
              >
                <Users size={16} /> Команда
              </button>
            )}

            <button
              onClick={() => setShowSettings(true)}
              className="btn-ghost text-sm"
              type="button"
              title="Настройки аккаунта"
            >
              <Settings size={16} /> Настройки
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
          onClose={() => {
            setSelectedAlbum(null)
            // Очистка ?album=UUID из URL — если модал был открыт через
            // deep link (возврат из редактора, фаза 2.6.5), query параметр
            // остаётся в URL после закрытия. Без replace на /app модал
            // переоткроется при F5. См. фазу 3.0 hygiene.
            if (typeof window !== 'undefined' && window.location.search.includes('album=')) {
              router.replace('/app', { scroll: false })
            }
          }}
          onNotify={(msg) => notify(msg, 'ok')}
          onError={(msg) => notify(msg, 'err')}
          originalsProgress={originalsProgress}
          setOriginalsProgress={setOriginalsProgress}
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

      {showPresets && (
        <PresetsModal
          onClose={() => setShowPresets(false)}
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

{showCRM && currentUserId && (
        <CRMModal
          onClose={() => setShowCRM(false)}
          currentUserId={currentUserId}
        />
      )}

      {showPartners && (
        <PartnersDashboardModal
          onClose={() => setShowPartners(false)}
          onNotify={(t) => notify(t)}
          onError={(t) => notify(t, 'err')}
          originalsProgress={originalsProgress}
          setOriginalsProgress={setOriginalsProgress}
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
      className="card p-5 cursor-pointer hover:shadow-card-hover hover:-translate-y-0.5 hover:border-gray-300 transition-all duration-150 relative"
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
          <div className="mt-1">
            {album.config_preset_name ? (
              <span
                className="text-xs text-gray-500"
                title={album.config_preset_slug ?? ''}
              >
                {album.config_preset_name}
              </span>
            ) : (
              <span
                className="text-xs text-amber-600"
                title="Пресет не выбран — отредактируйте альбом"
              >
                <AlertTriangle size={14} className="inline" /> пресет не выбран
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Прогресс-бар с процентом */}
      <div className="flex items-center gap-3 mb-3">
        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${progress >= 100 ? 'bg-brand-600' : 'bg-brand-400'}`}
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

      {/* РЭ.25: счётчик заказчиков. Показываем только если есть не-заказчики
          и альбом НЕ в мягком режиме (include_non_purchasers=true делает
          цифры бессмысленными — в альбоме все). Если все заказали или
          0 учеников — блок скрыт, чтобы не загромождать карточку. */}
      {!album.include_non_purchasers &&
        album.stats.total > 0 &&
        typeof album.stats.purchased === 'number' &&
        album.stats.purchased < album.stats.total && (
          <div className="mt-2 text-xs text-gray-500 pt-2 border-t border-gray-100">
            Заказали альбом:{' '}
            <span className="text-gray-700 font-medium">
              {album.stats.purchased}
            </span>
            {' из '}
            <span className="text-gray-700">{album.stats.total}</span>
            <span className="text-gray-400">
              {' '}
              ({album.stats.total - album.stats.purchased} без личной страницы)
            </span>
          </div>
        )}

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
  const baseClass = `card p-5 ${highlight ? 'border-brand-200 bg-brand-50' : ''}`
  const content = (
    <>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="flex items-baseline gap-2">
        <div className="text-2xl font-semibold text-gray-900">{value}</div>
        {subValue && (
          <div className={`text-sm ${highlight ? 'text-brand-600 font-medium' : 'text-gray-400'}`}>
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
        className={`${baseClass} text-left hover:shadow-card-hover hover:-translate-y-0.5 hover:border-brand-300 transition-all duration-150 cursor-pointer w-full`}
      >
        {content}
      </button>
    )
  }

  return <div className={baseClass}>{content}</div>
}

// ─── Smart-fill (фаза 1.4) ──────────────────────────────────────────────
type WarningLevel = 'blocking' | 'degraded' | 'info'

type EnrichedWarning = {
  code: string
  detail: string
  level: WarningLevel
  source: 'builder' | 'smart_fill'
}

type SmartFillSummary = {
  total_spreads: number
  total_warnings: number
  warnings_by_level: { blocking: number; degraded: number; info: number }
  preset_slug: string | null
  preset_name: string | null
  // РЭ.43.B: эффективный sheet_type альбома (после resolvePrintType
  // на сервере). Используется LayoutPreviewStrip чтобы корректно
  // показывать форзацы для soft binding.
  sheet_type?: 'hard' | 'soft' | null
}

type SmartFillLayout = {
  layout_id: string
  template_set_id: string
  spreads: unknown[]
  warnings: EnrichedWarning[]
  summary: SmartFillSummary
  has_user_edits: boolean
}

// ─── Категоризированный warning блок (фаза 1.4) ────────────────────────────
function CollapseSection({
  level,
  warnings,
}: {
  level: WarningLevel
  warnings: EnrichedWarning[]
}) {
  if (warnings.length === 0) return null

  const config = {
    blocking: {
      label: 'Критично',
      classes: 'bg-red-50 text-red-700 border-red-200',
      summaryClasses: 'text-red-700',
    },
    degraded: {
      label: 'Требует внимания',
      classes: 'bg-amber-50 text-amber-700 border-amber-200',
      summaryClasses: 'text-amber-700',
    },
    info: {
      label: 'К сведению',
      classes: 'bg-gray-50 text-gray-700 border-gray-200',
      summaryClasses: 'text-gray-700',
    },
  }[level]

  return (
    <details className={`rounded border ${config.classes}`}>
      <summary className={`px-3 py-1.5 text-sm cursor-pointer select-none ${config.summaryClasses}`}>
        {config.label} ({warnings.length})
      </summary>
      <ul className="px-3 py-2 text-xs space-y-1">
        {warnings.map((w, i) => (
          <li key={`${w.code}-${i}`} className="leading-relaxed">
            <span className="font-mono opacity-70">[{w.code}]</span>{' '}
            <span>{w.detail}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}

// А.3.4 — Dropdown override настройки виньеток на уровне альбома.
// Inline-обновление через POST update_album. Локальный state позволяет
// показывать выбор без перезагрузки родительского компонента.
// Effective значение применится при следующей пересборке альбома
// (Сборка/Пересобрать кнопка выше).
function VignettesControl({
  album,
  apiVA,
  onNotify,
  onError,
}: {
  album: Album
  apiVA: (url: string, opts?: RequestInit) => Promise<Response>
  onNotify: (msg: string) => void
  onError: (msg: string) => void
}) {
  // Локальный state — оптимистичный update сразу, rollback при ошибке.
  const [value, setValue] = useState<boolean | null>(album.vignettes_enabled ?? null)
  const [saving, setSaving] = useState(false)

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value
    const newValue: boolean | null = v === 'on' ? true : v === 'off' ? false : null
    const prevValue = value
    setValue(newValue)
    setSaving(true)
    try {
      const r = await apiVA('/api/tenant', {
        method: 'POST',
        body: JSON.stringify({
          action: 'update_album',
          album_id: album.id,
          vignettes_enabled: newValue,
        }),
      })
      if (r.ok) {
        onNotify(
          newValue === true
            ? 'Виньетки включены. Пересоберите альбом чтобы применить.'
            : newValue === false
              ? 'Виньетки выключены. Пересоберите альбом чтобы применить.'
              : 'Виньетки: дефолт пресета. Пересоберите альбом чтобы применить.'
        )
      } else {
        // Rollback
        setValue(prevValue)
        const d = await r.json().catch(() => ({}))
        onError(d.error ?? 'Не удалось сохранить настройку')
      }
    } catch (err: unknown) {
      setValue(prevValue)
      onError(err instanceof Error ? err.message : 'Ошибка сети')
    } finally {
      setSaving(false)
    }
  }

  const selectValue = value === true ? 'on' : value === false ? 'off' : 'auto'
  const description =
    value === null
      ? '«Авто» использует дефолт комплектации: в Индивидуальной — включено, в остальных — выключено.'
      : value
        ? 'Виньеточный разворот добавится в конце альбома.'
        : 'Виньеточный разворот не будет создан.'

  return (
    <div className="mt-3 pt-3 border-t border-gray-200 flex items-center gap-3 flex-wrap">
      <div className="text-xs text-gray-500 uppercase">Виньетки класса</div>
      <select
        value={selectValue}
        onChange={handleChange}
        disabled={saving}
        className="text-sm px-2 py-1 border border-gray-300 rounded bg-white disabled:opacity-50"
      >
        <option value="auto">Авто (по комплектации)</option>
        <option value="on">Включить</option>
        <option value="off">Выключить</option>
      </select>
      <div className="text-xs text-gray-400 flex-1 min-w-[200px]">{description}</div>
    </div>
  )
}


// РЭ.30.4: компонент `SectionStructurePresetControl` удалён.
// До РЭ.30 в обзоре альбома был селект «🧱 Section Structure» с 7
// захардкоженными ID (standard, universal, maximum, individual,
// medium, light, mini-soft) — параллельный путь задания структуры
// сборки рядом с выбором Шаблона в форме альбома. Эту лишнюю развилку
// убрали — структура теперь задаётся только через Шаблон.
// Поле `albums.section_structure_preset_id` в БД остаётся
// (заполняется в форме создания/редактирования альбома виджетом
// «Шаблон»). Старые альбомы продолжают использовать его как раньше.

// А.4.3 — Числовой инпут лимита разворотов в общем разделе альбома.
// null = без ограничения (builder вставляет всё), 0 = раздел отключён,
// >0 = жёсткий лимит. Применяется при следующей пересборке альбома.
function CommonSectionLimitControl({
  album,
  apiVA,
  onNotify,
  onError,
}: {
  album: Album
  apiVA: (url: string, opts?: RequestInit) => Promise<Response>
  onNotify: (msg: string) => void
  onError: (msg: string) => void
}) {
  // Локальный state — оптимистичный update + rollback. Храним как string
  // чтобы пользователь мог временно очистить поле прежде чем ввести
  // новое число; null = пустая строка в инпуте.
  const initialString =
    album.common_section_max_spreads === null || album.common_section_max_spreads === undefined
      ? ''
      : String(album.common_section_max_spreads)
  const [value, setValue] = useState<string>(initialString)
  const [saving, setSaving] = useState(false)

  const persist = async (newValue: number | null) => {
    setSaving(true)
    try {
      const r = await apiVA('/api/tenant', {
        method: 'POST',
        body: JSON.stringify({
          action: 'update_album',
          album_id: album.id,
          common_section_max_spreads: newValue,
        }),
      })
      if (r.ok) {
        onNotify(
          newValue === null
            ? 'Лимит снят (без ограничения). Пересоберите альбом чтобы применить.'
            : newValue === 0
              ? 'Общий раздел отключён. Пересоберите альбом чтобы применить.'
              : `Лимит ${newValue} разворотов установлен. Пересоберите альбом чтобы применить.`
        )
      } else {
        const d = await r.json().catch(() => ({}))
        onError(d.error ?? 'Не удалось сохранить настройку')
      }
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : 'Ошибка сети')
    } finally {
      setSaving(false)
    }
  }

  const handleBlur = () => {
    // Парсим значение из input. Пустая строка → null. Число < 0 → 0.
    const trimmed = value.trim()
    let newValue: number | null
    if (trimmed === '') {
      newValue = null
    } else {
      const n = parseInt(trimmed, 10)
      if (isNaN(n) || n < 0) {
        newValue = 0
        setValue('0')
      } else {
        newValue = n
        setValue(String(n))
      }
    }
    // Если значение не изменилось — не дёргаем API.
    const currentDbValue = album.common_section_max_spreads ?? null
    if (currentDbValue === newValue) return
    void persist(newValue)
  }

  const description =
    value.trim() === ''
      ? 'Без ограничения — builder вставит все загруженные фото общего раздела.'
      : parseInt(value, 10) === 0
        ? 'Общий раздел не будет создан.'
        : `Не более ${parseInt(value, 10)} разворотов. Приоритет: крупные фото (full → half → quarter → sixth).`

  return (
    <div className="mt-3 pt-3 border-t border-gray-200 flex items-center gap-3 flex-wrap">
      <div className="text-xs text-gray-500 uppercase">Разворотов в общем разделе</div>
      <input
        type="number"
        min={0}
        max={50}
        step={1}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
        disabled={saving}
        placeholder="без ограничения"
        className="text-sm px-2 py-1 border border-gray-300 rounded bg-white disabled:opacity-50 w-32"
      />
      <div className="text-xs text-gray-400 flex-1 min-w-[200px]">{description}</div>
    </div>
  )
}


// РЭ.41.a — Inline-контрол для albums.student_distribution.
// Перенесён из формы редактирования на Обзор для быстрых переключений
// при тестировании. Сохраняет через update_album, пересборка по кнопке.
// Применяется только к шаблонам с сеткой (Mini 12, Light 6).
function StudentDistributionControl({
  album,
  apiVA,
  onNotify,
  onError,
}: {
  album: Album
  apiVA: (url: string, opts?: RequestInit) => Promise<Response>
  onNotify: (msg: string) => void
  onError: (msg: string) => void
}) {
  type Mode = 'auto' | 'equalize' | 'greedy'
  const initial: Mode =
    album.student_distribution === 'equalize' || album.student_distribution === 'greedy'
      ? album.student_distribution
      : 'auto'
  const [value, setValue] = useState<Mode>(initial)
  const [saving, setSaving] = useState(false)

  const handleChange = async (newValue: Mode) => {
    const prevValue = value
    setValue(newValue)
    setSaving(true)
    try {
      const r = await apiVA('/api/tenant', {
        method: 'POST',
        body: JSON.stringify({
          action: 'update_album',
          album_id: album.id,
          student_distribution: newValue,
        }),
      })
      if (r.ok) {
        const label =
          newValue === 'auto' ? 'Авто' : newValue === 'equalize' ? 'Равномерно' : 'Жадно'
        onNotify(`Распределение учеников: ${label}. Пересоберите альбом чтобы применить.`)
      } else {
        setValue(prevValue)
        const d = await r.json().catch(() => ({}))
        onError(d.error ?? 'Не удалось сохранить настройку')
      }
    } catch (err: unknown) {
      setValue(prevValue)
      onError(err instanceof Error ? err.message : 'Ошибка сети')
    } finally {
      setSaving(false)
    }
  }

  const description =
    value === 'auto'
      ? 'Если делится ровно — полные страницы. Если хвост маленький и есть свободное общее фото — комбо-страница. Иначе равномерно (30 = 10+10+10).'
      : value === 'equalize'
        ? 'Всегда делит поровну, без комбо-страниц.'
        : 'Заполняет полные сетки, остаток — на последнюю (30 = 12+12+6). Старое поведение.'

  return (
    <div className="mt-3 pt-3 border-t border-gray-200">
      <div className="flex items-center gap-3 flex-wrap mb-2">
        <div className="text-xs text-gray-500 uppercase">Распределение учеников</div>
        <div className="flex gap-1 flex-wrap">
          {(['auto', 'equalize', 'greedy'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => handleChange(mode)}
              disabled={saving}
              className={`text-sm px-3 py-1 border rounded transition disabled:opacity-50 disabled:cursor-not-allowed ${
                value === mode
                  ? 'bg-blue-50 border-blue-400 text-blue-700 font-medium'
                  : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {mode === 'auto' ? 'Авто' : mode === 'equalize' ? 'Равномерно' : 'Жадно'}
            </button>
          ))}
        </div>
      </div>
      <div className="text-xs text-gray-400">{description}</div>
      <div className="text-xs text-gray-400 mt-1">
        Влияет только на шаблоны с сеткой (Mini 12, Light 6). Для других комплектаций
        игнорируется.
      </div>
    </div>
  )
}


// Реферальная программа заказа (ТЗ docs/tz-referral-programs.md, Этап 1).
// Партнёр выбирает одну из доступных программ (свои + глобальные активные)
// или «без программы». Что увидят родители на «Спасибо»/лендинге — берётся
// из выбранной программы. Награды применяются вручную, без автоскидок.
function ReferralProgramControl({
  album,
  apiVA,
  onNotify,
  onError,
}: {
  album: Album
  apiVA: (url: string, opts?: RequestInit) => Promise<Response>
  onNotify: (msg: string) => void
  onError: (msg: string) => void
}) {
  type Program = {
    id: string
    name: string
    is_global: boolean
    referrer_reward_text: string | null
    invitee_reward_text: string | null
  }
  const [programs, setPrograms] = useState<Program[]>([])
  const [value, setValue] = useState<string>(album.referral_program_id ?? '')
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    apiVA('/api/tenant?action=list_referral_programs')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        setPrograms(Array.isArray(d.programs) ? d.programs : [])
        setLoaded(true)
      })
      .catch(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [apiVA])

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value
    const prevValue = value
    setValue(v)
    setSaving(true)
    try {
      const r = await apiVA('/api/tenant', {
        method: 'POST',
        body: JSON.stringify({
          action: 'update_album',
          album_id: album.id,
          referral_program_id: v === '' ? null : v,
        }),
      })
      if (r.ok) {
        const prog = programs.find((p) => p.id === v)
        onNotify(
          v === ''
            ? 'Реферальная программа отключена — родители увидят дефолтный текст.'
            : `Реферальная программа: «${prog?.name ?? v}».`,
        )
      } else {
        setValue(prevValue)
        const d = await r.json().catch(() => ({}))
        onError(d.error ?? 'Не удалось сохранить программу')
      }
    } catch (err: unknown) {
      setValue(prevValue)
      onError(err instanceof Error ? err.message : 'Ошибка сети')
    } finally {
      setSaving(false)
    }
  }

  // Назначенная программа исчезла из активных (выключена/удалена) — покажем
  // подсказку, что родители видят дефолт.
  const assignedMissing =
    loaded && value !== '' && !programs.some((p) => p.id === value)
  const selected = programs.find((p) => p.id === value)

  return (
    <div className="mt-3 pt-3 border-t border-gray-200">
      <div className="flex items-center gap-3 flex-wrap mb-2">
        <div className="text-xs text-gray-500 uppercase">Реферальная программа</div>
        <select
          value={value}
          onChange={handleChange}
          disabled={saving || !loaded}
          className="text-sm px-3 py-1 border border-gray-300 rounded bg-white text-gray-700 disabled:opacity-50"
        >
          <option value="">Без программы (дефолтный текст)</option>
          {programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}{p.is_global ? ' · глобальная' : ''}
            </option>
          ))}
        </select>
      </div>
      {assignedMissing ? (
        <div className="text-xs text-amber-600">
          Назначенная программа сейчас недоступна (выключена или удалена) — родители
          видят дефолтный текст. Выберите другую или «Без программы».
        </div>
      ) : selected ? (
        <div className="text-xs text-gray-400">
          Реферер: {selected.referrer_reward_text || '—'}. Реферал: {selected.invitee_reward_text || '—'}.
          Награды применяются вручную.
        </div>
      ) : (
        <div className="text-xs text-gray-400">
          Что увидят родители на странице «Спасибо» и по реф-ссылке. «Без программы» —
          дефолтный текст про скидку 50%.
        </div>
      )}
    </div>
  )
}

// РЭ.41.b — Inline-контрол для типа листов (layflat / soft).
// Перенесён из формы редактирования на Обзор для быстрых переключений
// при тестировании. На мягких листах недоступен мастер «фото на разворот».
// Пустая строка ('') = «из шаблона», engine берёт print_type пресета.
function PrintTypeOverrideControl({
  album,
  apiVA,
  onNotify,
  onError,
}: {
  album: Album
  apiVA: (url: string, opts?: RequestInit) => Promise<Response>
  onNotify: (msg: string) => void
  onError: (msg: string) => void
}) {
  type Value = '' | 'layflat' | 'soft'
  const initial: Value =
    album.print_type === 'layflat' || album.print_type === 'soft' ? album.print_type : ''
  const [value, setValue] = useState<Value>(initial)
  const [saving, setSaving] = useState(false)

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value as Value
    const prevValue = value
    setValue(v)
    setSaving(true)
    try {
      // Если выбрано '' (из шаблона) — отправляем print_type=null чтобы
      // engine брал из пресета. API trim'ает 'layflat'/'soft' иначе.
      const body: Record<string, unknown> = {
        action: 'update_album',
        album_id: album.id,
      }
      if (v === 'layflat' || v === 'soft') {
        body.print_type = v
      } else {
        // Сброс — отправляем null чтобы print_type вернулся к 'из пресета'.
        body.print_type = null
      }
      const r = await apiVA('/api/tenant', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      if (r.ok) {
        const label =
          v === 'layflat'
            ? 'Твёрдые листы (layflat)'
            : v === 'soft'
              ? 'Мягкие листы (soft)'
              : 'Из шаблона'
        onNotify(`Тип листов: ${label}. Пересоберите альбом чтобы применить.`)
      } else {
        setValue(prevValue)
        const d = await r.json().catch(() => ({}))
        onError(d.error ?? 'Не удалось сохранить настройку')
      }
    } catch (err: unknown) {
      setValue(prevValue)
      onError(err instanceof Error ? err.message : 'Ошибка сети')
    } finally {
      setSaving(false)
    }
  }

  const description =
    value === 'layflat'
      ? 'Твёрдые листы. Доступен мастер «фото на разворот».'
      : value === 'soft'
        ? 'Мягкие листы. Мастер «фото на разворот» отключён (пересекает корешок).'
        : 'Тип переплёта берётся из шаблона.'

  return (
    <div className="mt-3 pt-3 border-t border-gray-200 flex items-center gap-3 flex-wrap">
      <div className="text-xs text-gray-500 uppercase">Тип листов</div>
      <select
        value={value}
        onChange={handleChange}
        disabled={saving}
        className="text-sm px-2 py-1 border border-gray-300 rounded bg-white disabled:opacity-50"
      >
        <option value="">Из шаблона</option>
        <option value="layflat">Твёрдые (layflat)</option>
        <option value="soft">Мягкие (soft)</option>
      </select>
      <div className="text-xs text-gray-400 flex-1 min-w-[200px]">{description}</div>
    </div>
  )
}


// РЭ.41.c — Inline-контрол для include_non_purchasers.
// Галка: личную страницу получают только заказчики (default) или
// все ученики класса. Перенесён из формы редактирования на Обзор.
function IncludeNonPurchasersControl({
  album,
  apiVA,
  onNotify,
  onError,
}: {
  album: Album
  apiVA: (url: string, opts?: RequestInit) => Promise<Response>
  onNotify: (msg: string) => void
  onError: (msg: string) => void
}) {
  const [value, setValue] = useState<boolean>(album.include_non_purchasers === true)
  const [saving, setSaving] = useState(false)

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.checked
    const prevValue = value
    setValue(newValue)
    setSaving(true)
    try {
      const r = await apiVA('/api/tenant', {
        method: 'POST',
        body: JSON.stringify({
          action: 'update_album',
          album_id: album.id,
          include_non_purchasers: newValue,
        }),
      })
      if (r.ok) {
        onNotify(
          newValue
            ? 'Личная страница для всех учеников. Пересоберите альбом чтобы применить.'
            : 'Личная страница только для заказчиков. Пересоберите альбом чтобы применить.'
        )
      } else {
        setValue(prevValue)
        const d = await r.json().catch(() => ({}))
        onError(d.error ?? 'Не удалось сохранить настройку')
      }
    } catch (err: unknown) {
      setValue(prevValue)
      onError(err instanceof Error ? err.message : 'Ошибка сети')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-3 pt-3 border-t border-gray-200">
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={value}
          onChange={handleChange}
          disabled={saving}
          className="mt-0.5 disabled:opacity-50"
        />
        <div className="flex-1">
          <span className="text-sm font-medium text-gray-700">
            Включить в личный раздел всех учеников
          </span>
          <p className="text-xs text-gray-500 mt-0.5">
            По умолчанию выключено — личную страницу получают только те ученики, у
            которых проставлена галка «Заказывает альбом». Включите, если хотите дать
            страницу всему классу независимо от заказа.
          </p>
        </div>
      </label>
    </div>
  )
}

// РЭ.46 — Inline-контрол для albums.symmetrize_students_tail_override.
// По запросу Сергея: простой чекбокс boolean (без 'по шаблону').
// БД-схема осталась boolean|null:
//   - null → галка снята (legacy альбомы где override не трогали)
//   - true → галка стоит, симметризация принудительно ВКЛ
//   - false → галка снята, симметризация принудительно ВЫКЛ
// Engine применяет override в любом случае (true/false), null → пресет.
// Для партнёра это выглядит как простой выбор «вкл/выкл», без размышлений
// о шаблоне.
function SymmetrizeTailControl({
  album,
  apiVA,
  onNotify,
  onError,
}: {
  album: Album
  apiVA: (url: string, opts?: RequestInit) => Promise<Response>
  onNotify: (msg: string) => void
  onError: (msg: string) => void
}) {
  // null → false по умолчанию (показываем галку снятой для legacy альбомов).
  const [value, setValue] = useState<boolean>(
    album.symmetrize_students_tail_override === true,
  )
  const [saving, setSaving] = useState(false)

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.checked
    const prevValue = value
    setValue(newValue)
    setSaving(true)
    try {
      const r = await apiVA('/api/tenant', {
        method: 'POST',
        body: JSON.stringify({
          action: 'update_album',
          album_id: album.id,
          symmetrize_students_tail_override: newValue,
        }),
      })
      if (r.ok) {
        onNotify(
          newValue
            ? 'Симметризация хвоста включена. Пересоберите альбом чтобы применить.'
            : 'Симметризация хвоста выключена. Пересоберите альбом чтобы применить.',
        )
      } else {
        setValue(prevValue)
        const d = await r.json().catch(() => ({}))
        onError(d.error ?? 'Не удалось сохранить настройку')
      }
    } catch (err: unknown) {
      setValue(prevValue)
      onError(err instanceof Error ? err.message : 'Ошибка сети')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-3 pt-3 border-t border-gray-200">
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={value}
          onChange={handleChange}
          disabled={saving}
          className="mt-0.5 disabled:opacity-50"
        />
        <div className="flex-1">
          <span className="text-sm font-medium text-gray-700">
            Симметризировать хвост
          </span>
          <p className="text-xs text-gray-500 mt-0.5">
            Если в хвосте students-секции остался 1 ученик, движок возьмёт ещё
            одного с предыдущей страницы — чтобы хвост был парным, без
            одиночного портрета с краю. Действует только для сеточных
            комплектаций (Mini 12, Light 6).
          </p>
        </div>
      </label>
    </div>
  )
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
  viewAsTenantId,
  // Техдолг#4 — state поднят в AppPage. Пробрасываем через модал
  // в PhotosTab. Если модал закроется во время загрузки —
  // beforeunload и индикатор останутся живы в AppPage.
  originalsProgress,
  setOriginalsProgress,
}: {
  album: Album
  canEdit: boolean
  onClose: () => void
  onNotify: (msg: string) => void
  onError: (msg: string) => void
  viewAsTenantId?: string
  originalsProgress: React.ComponentProps<typeof PhotosTab>['originalsProgress']
  setOriginalsProgress: React.ComponentProps<typeof PhotosTab>['setOriginalsProgress']
}) {
  // Хелпер для запросов с поддержкой view_as (просмотр альбомов партнёра)
  const apiVA = (url: string, opts?: RequestInit) => {
    const sep = url.includes('?') ? '&' : '?'
    const fullUrl = viewAsTenantId ? `${url}${sep}view_as=${viewAsTenantId}` : url
    return api(fullUrl, opts)
  }
  const router = useRouter()
  const [stats, setStats] = useState<AlbumStats | null>(null)
  const [spreadData, setSpreadData] = useState<{child_id:string;full_name:string;class:string;photos:{id:string;filename:string;storage_path:string;sort_order:number}[]}[]>([])
  const [workflow, setWorkflow] = useState<{workflow_status:string;workflow_submitted_at?:string;workflow_taken_at?:string;workflow_delivered_at?:string;workflow_notes?:string} | null>(null)
  const [originals, setOriginals] = useState<{id:string;filename:string;storage_path:string;file_size:number}[]>([])
  const [delivery, setDelivery] = useState<{id:string;filename:string;storage_path:string;file_size:number;label:string;expires_at:string;downloaded_at?:string}[]>([])
  const [daily, setDaily] = useState<{date:string;submitted:number;started:number}[]>([])
  const [children, setChildren] = useState<Child[]>([])
  const [presets, setPresets] = useState<PresetOption[]>([])
  const [layout, setLayout] = useState<SmartFillLayout | null>(null)
  const [smartFillBusy, setSmartFillBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [backdropStart, setBackdropStart] = useState(false)
  const [tab, setTab] = useState<'overview' | 'children' | 'teachers' | 'responsible' | 'photos' | 'surcharges' | 'spread' | 'production'>('overview')

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
      const r = await apiVA(`/api/tenant?action=child_details&child_id=${childId}`)
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
      const res = await apiVA(`/api/tenant?action=export_csv&album_id=${album.id}`)
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
    const [s, c, an, p, lay] = await Promise.all([
      apiVA(`/api/tenant?action=album_stats&album_id=${album.id}`).then(r => r.json()),
      apiVA(`/api/tenant?action=children&album_id=${album.id}`).then(r => r.json()),
      apiVA(`/api/tenant?action=analytics&album_id=${album.id}`).then(r => r.json()),
      apiVA('/api/tenant?action=presets_list').then(r => r.ok ? r.json() : { presets: [] }).catch(() => ({ presets: [] })),
      apiVA(`/api/layout?action=album_layout&album_id=${album.id}`)
        .then(r => r.ok ? r.json() : { layout: null })
        .catch(() => ({ layout: null })),
    ])
    setStats(s)
    setChildren(Array.isArray(c) ? c : [])
    setDaily(an.daily ?? [])
    setPresets(p.presets ?? [])
    setLayout(lay.layout ?? null)
    setLoading(false)
  }

  useEffect(() => {
    load().catch(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [album.id])

  const runSmartFill = async () => {
    // РЭ.30 hot-fix: после В.3 новые альбомы пишут только
    // section_structure_preset_id; legacy-альбомы — config_preset_id.
    // Сборка возможна при наличии любого из них.
    if ((!album.config_preset_id && !album.section_structure_preset_id) || smartFillBusy) return

    // Защита: если в layout есть несохранённые ручные правки партнёра —
    // подтверждаем destructive-операцию. has_user_edits=true появляется
    // после save_album_layout (2.5) и сбрасывается в false после
    // build_album (2.1).
    if (layout?.has_user_edits) {
      const ok = window.confirm(
        'У вас есть ручные правки в редакторе. Пересборка их сотрёт. Продолжить?'
      )
      if (!ok) return
    }

    setSmartFillBusy(true)
    try {
      const r = await apiVA('/api/layout?action=build_album', {
        method: 'POST',
        body: JSON.stringify({ album_id: album.id }),
      })
      if (r.ok) {
        const data = await r.json()
        setLayout({
          layout_id: data.layout_id,
          template_set_id: data.template_set_id,
          spreads: data.spreads,
          warnings: data.warnings,
          summary: data.summary,
          has_user_edits: false,  // build_album сбрасывает флаг (см. 2.1)
        })
        onNotify(`Layout собран: ${data.summary.total_spreads} элементов, ${data.summary.total_warnings} предупреждений`)
      } else {
        const d = await r.json().catch(() => ({}))
        onError(d.error ?? 'Сборка не удалась')
      }
    } catch {
      onError('Ошибка сети при сборке')
    } finally {
      setSmartFillBusy(false)
    }
  }

  const copyLayoutJson = async () => {
    if (!layout) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(layout, null, 2))
      onNotify('Layout JSON скопирован')
    } catch {
      onError('Не удалось скопировать (нет доступа к буферу обмена)')
    }
  }

  useEffect(() => {
    if ((tab === 'spread' || tab === 'surcharges') && (album as any).personal_spread_enabled) {
      apiVA(`/api/tenant?action=personal_spread_stats&album_id=${album.id}`)
        .then(r => r.json())
        .then(d => setSpreadData(d.children ?? []))
    }
    if (tab === 'production') {
      apiVA(`/api/workflow?action=album_workflow&album_id=${album.id}`)
        .then(r => r.json())
        .then(d => {
          setWorkflow(d.workflow)
          setOriginals(d.originals ?? [])
          setDelivery(d.delivery ?? [])
        })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, album.id])

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
      className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4"
      onMouseDown={handleBackdropMouseDown}
      onMouseUp={handleBackdropMouseUp}
    >
      <div className="bg-white rounded-2xl max-w-3xl w-full shadow-xl flex flex-col" style={{ height: '90vh' }}>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0 rounded-t-2xl">
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
                  <Bell size={16} /> Напомнить · {unfinished}
                </button>
              )
            })()}
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(`${location.origin}/album/${album.id}`)
                onNotify('Ссылка на класс скопирована')
              }}
              className="btn-secondary text-xs px-3 py-1.5"
              title="Общая ссылка — родитель выбирает ребёнка из списка"
            >
              <Link2 size={16} /> Класс
            </button>
            <button
              onClick={handleExport}
              type="button"
              disabled={exporting}
              className="btn-secondary text-xs px-3 py-1.5"
              title="Скачать CSV для вёрстки"
            >
              {exporting ? 'Готовим…' : <><Download size={14} /> CSV</>}
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
        <div className="px-6 pt-4 border-b border-gray-100 flex gap-1 overflow-x-auto flex-shrink-0">
          {([
            { id: 'overview', label: 'Обзор' },
            { id: 'children', label: 'Ученики' },
            { id: 'photos', label: 'Фото' },
            { id: 'teachers', label: 'Учителя' },
            { id: 'responsible', label: 'Ответственный' },
            { id: 'surcharges', label: 'Доплаты' },
            ...((album as any).personal_spread_enabled ? [{ id: 'spread' as const, label: 'Разворот' }] : []),
            { id: 'production' as const, label: 'Производство' },
          ] as const).map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                tab === t.id
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {loading ? (
            <div className="text-center text-gray-400 text-sm py-8">Загружаем данные...</div>
          ) : (
            <>
              {/* Вкладка Обзор */}
              {tab === 'overview' && stats && (
                <>
                  <div className="bg-gray-50 rounded-lg p-3 text-sm mb-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <div className="text-xs text-gray-500 uppercase mb-1">Пресет вёрстки</div>
                        {/* РЭ.30 hot-fix: после В.3 новые альбомы не пишут
                            config_preset_id, а пишут section_structure_preset_id.
                            Плашка и кнопка должны учитывать оба источника. */}
                        {album.config_preset_name ? (
                          <>
                            <div className="font-medium text-gray-900">{album.config_preset_name}</div>
                            <div className="text-xs text-gray-400 font-mono">{album.config_preset_slug}</div>
                          </>
                        ) : album.section_structure_preset_id ? (
                          <div className="text-gray-700">
                            <span className="font-medium">Шаблон выбран</span>{' '}
                            <span className="text-gray-400 text-xs font-mono">
                              ({album.section_structure_preset_id.slice(0, 8)}…)
                            </span>
                          </div>
                        ) : (
                          <div className="text-amber-600">
                            Не выбран. Откройте «Редактировать» → выберите шаблон в каталоге.
                          </div>
                        )}
                      </div>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={runSmartFill}
                          disabled={
                            (!album.config_preset_id && !album.section_structure_preset_id) ||
                            smartFillBusy
                          }
                          className="btn-primary text-sm px-4 py-2 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                          title={
                            !album.config_preset_id && !album.section_structure_preset_id
                              ? 'Сначала выберите шаблон в форме редактирования альбома'
                              : layout
                                ? 'Запустить сборку заново — текущий layout будет перезаписан'
                                : 'Запустить автосборку альбома'
                          }
                        >
                          {smartFillBusy
                            ? 'Сборка...'
                            : layout
                              ? 'Пересобрать'
                              : 'Собрать автоматически'}
                        </button>
                      )}
                    </div>

                    {/* А.3.4 — Override виньеток на уровне альбома.
                        NULL = дефолт пресета (виньетки в Индивидуальной,
                        выключены в остальных). true/false = принудительно. */}
                    {canEdit && album.config_preset_id && (
                      <VignettesControl
                        album={album}
                        apiVA={apiVA}
                        onNotify={onNotify}
                        onError={onError}
                      />
                    )}

                    {/* РЭ.30.4 — Селектор «Section Structure» удалён.
                        Структура альбома задаётся только через выбор
                        Шаблона в форме альбома (виджет «Шаблон»). */}

                    {/* А.4.3 — Лимит разворотов общего раздела.
                        NULL = без лимита (builder вставит всё), 0 = отключить,
                        >0 = жёсткий лимит с приоритетом крупных фото. */}
                    {canEdit && album.config_preset_id && (
                      <CommonSectionLimitControl
                        album={album}
                        apiVA={apiVA}
                        onNotify={onNotify}
                        onError={onError}
                      />
                    )}

                    {/* РЭ.41.a — Распределение учеников по grid-страницам.
                        Показывается для альбомов с любым шаблоном (legacy
                        config_preset_id или новый section_structure_preset_id).
                        Применяется только к grid-режимам (Mini/Light), но
                        UI показываем всегда — пусть партнёр видит настройку. */}
                    {canEdit && (album.config_preset_id || album.section_structure_preset_id) && (
                      <StudentDistributionControl
                        album={album}
                        apiVA={apiVA}
                        onNotify={onNotify}
                        onError={onError}
                      />
                    )}

                    {/* РЭ.41.b — Тип листов (layflat/soft/из шаблона). */}
                    {canEdit && (album.config_preset_id || album.section_structure_preset_id) && (
                      <PrintTypeOverrideControl
                        album={album}
                        apiVA={apiVA}
                        onNotify={onNotify}
                        onError={onError}
                      />
                    )}

                    {/* РЭ.41.c — Включить в личный раздел всех учеников. */}
                    {canEdit && (album.config_preset_id || album.section_structure_preset_id) && (
                      <IncludeNonPurchasersControl
                        album={album}
                        apiVA={apiVA}
                        onNotify={onNotify}
                        onError={onError}
                      />
                    )}

                    {/* РЭ.46 — Симметризация хвоста students-секции. */}
                    {canEdit && (album.config_preset_id || album.section_structure_preset_id) && (
                      <SymmetrizeTailControl
                        album={album}
                        apiVA={apiVA}
                        onNotify={onNotify}
                        onError={onError}
                      />
                    )}


                    {layout && (
                      <div className="mt-3 pt-3 border-t border-gray-200">
                        <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                          <div className="text-sm">
                            <span className="text-green-600 font-medium"><Check size={14} className="inline" /> Layout собран</span>
                            <span className="text-gray-500"> · {layout.summary.total_spreads} элементов</span>
                            {layout.summary.total_warnings > 0 && (
                              <span className="text-gray-500"> · {layout.summary.total_warnings} предупреждений</span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={copyLayoutJson}
                            className="text-xs text-gray-500 hover:text-gray-700 underline"
                          >
                            Скопировать JSON
                          </button>
                        </div>

                        <div className="space-y-1.5 mt-2">
                          <CollapseSection
                            level="blocking"
                            warnings={layout.warnings.filter(w => w.level === 'blocking')}
                          />
                          <CollapseSection
                            level="degraded"
                            warnings={layout.warnings.filter(w => w.level === 'degraded')}
                          />
                          <CollapseSection
                            level="info"
                            warnings={layout.warnings.filter(w => w.level === 'info')}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {layout && (
                    <LayoutPreviewStrip
                      layout={layout}
                      albumPrintType={
                        album.print_type === 'soft'
                          ? 'soft'
                          : album.print_type === 'layflat' || album.print_type === 'hard'
                            ? 'hard'
                            : null
                      }
                      onOpenEditor={() => {
                        router.push(`/app/album/${album.id}/layout`)
                      }}
                    />
                  )}

                  <ExportPanel
                    albumId={album.id}
                    hasLayout={Boolean(layout && layout.spreads.length > 0)}
                    viewAsTenantId={viewAsTenantId}
                  />

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                    <MiniStat label="Всего" value={stats.total} />
                    <MiniStat label="Завершили" value={stats.submitted} tone="green" />
                    <MiniStat label="В процессе" value={stats.in_progress} tone="amber" />
                    <MiniStat label="Не начали" value={stats.not_started} tone="gray" />
                  </div>

                  {/* РЭ.25: блок заказчиков. Показываем только если есть
                      не-заказчики и альбом НЕ в мягком режиме. */}
                  {!album.include_non_purchasers &&
                    stats.total > 0 &&
                    typeof stats.purchased === 'number' &&
                    stats.purchased < stats.total && (
                      <div className="bg-gray-50 rounded-xl p-4 mb-6">
                        <div className="text-xs text-gray-500">Заказали альбом</div>
                        <div className="text-lg font-semibold mt-1">
                          {stats.purchased}
                          <span className="text-gray-400"> / {stats.total}</span>
                        </div>
                        <div className="text-xs text-gray-400 mt-1">
                          {stats.total - stats.purchased} без личной страницы.
                          Снять/поставить галки — на вкладке «Ученики».
                        </div>
                      </div>
                    )}

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

                  {/* График динамики */}
                  {daily.length > 0 && (
                    <div className="mt-2">
                      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                        Динамика отбора
                      </div>
                      <AlbumDailyChart daily={daily} />
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
                            <th className="px-4 py-2.5 text-center" title="Заказывает ли ученик альбом (РЭ.25)">Заказ</th>
                            <th className="px-4 py-2.5">Статус</th>
                            <th className="px-4 py-2.5">Телефон</th>
                            <th className="px-4 py-2.5 text-right">Обложка</th>
                            <th className="px-4 py-2.5 text-right">Действия</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {children.map(c => {
                            // РЭ.25: визуальный маркер для не-заказчиков.
                            // is_purchased===false → приглушённая строка
                            // + бейдж рядом с ФИО.
                            const isNonPurchaser = c.is_purchased === false
                            return (
                            <React.Fragment key={c.id}>
                              <tr
                                className={`hover:bg-gray-50 cursor-pointer ${
                                  selectedChild?.id === c.id ? 'bg-gray-50' : ''
                                } ${isNonPurchaser ? 'opacity-60' : ''}`}
                                onClick={() => {
                                  const next = selectedChild?.id === c.id ? null : c
                                  setSelectedChild(next)
                                  if (next && next.submitted_at) loadChildDetails(next.id)
                                }}
                              >
                                <td className="px-4 py-2.5 font-medium text-gray-900">
                                  {c.full_name}
                                  {isNonPurchaser && (
                                    <span
                                      className="ml-2 text-xs px-2 py-0.5 rounded bg-gray-200 text-gray-600 font-normal"
                                      title="Этот ученик не заказывает альбом — в личном разделе его не будет"
                                    >
                                      не заказывает
                                    </span>
                                  )}
                                  {c.config_preset_name && (
                                    <span
                                      className="ml-2 text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-700 font-normal"
                                      title={`Override: ${c.config_preset_slug}`}
                                    >
                                      {c.config_preset_name}
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-2.5 text-gray-500">{c.class}</td>
                                <td className="px-4 py-2.5 text-center">
                                  {canEdit ? (
                                    <input
                                      type="checkbox"
                                      checked={c.is_purchased !== false}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={async (e) => {
                                        e.stopPropagation()
                                        const newValue = e.target.checked
                                        try {
                                          const r = await apiVA('/api/tenant', {
                                            method: 'POST',
                                            body: JSON.stringify({
                                              action: 'update_child',
                                              child_id: c.id,
                                              is_purchased: newValue,
                                            }),
                                          })
                                          if (!r.ok) {
                                            const err = await r.json().catch(() => ({ error: 'unknown' }))
                                            onError(err.error ?? 'Ошибка обновления галки')
                                            return
                                          }
                                          setChildren(prev => prev.map(ch =>
                                            ch.id === c.id ? { ...ch, is_purchased: newValue } : ch
                                          ))
                                          onNotify(
                                            newValue
                                              ? `${c.full_name} — заказывает альбом`
                                              : `${c.full_name} — не заказывает альбом`
                                          )
                                        } catch (err) {
                                          onError(err instanceof Error ? err.message : 'network error')
                                        }
                                      }}
                                      className="cursor-pointer"
                                      title={
                                        c.is_purchased === false
                                          ? 'Не заказывает альбом (нет личной страницы)'
                                          : 'Заказывает альбом'
                                      }
                                    />
                                  ) : (
                                    <span className={c.is_purchased === false ? 'text-gray-400' : 'text-green-600'}>
                                      {c.is_purchased === false ? '—' : <Check size={14} className="inline" />}
                                    </span>
                                  )}
                                </td>
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
                                <td className="px-4 py-2.5 text-right text-xs">
                                  {c.cover?.cover_option === 'other' ? (
                                    <span className="text-amber-600 font-medium">+{c.cover.surcharge ?? 0} ₽</span>
                                  ) : c.cover?.cover_option === 'same' ? (
                                    <span className="text-gray-400">тот же</span>
                                  ) : (
                                    <span className="text-gray-300">—</span>
                                  )}
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
                                  <td colSpan={7} className="px-4 py-3 border-t border-gray-100">
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
                                    {/* РЭ.25: галка «Заказывает альбом» перенесена в столбец
                                        таблицы (выше) для быстрого переключения без раскрытия строки. */}
                                    {/* Override пресета вёрстки для ученика */}
                                    {canEdit && (
                                      <div className="flex flex-wrap items-center gap-2 mb-3 pt-3 border-t border-gray-200">
                                        <span className="text-xs text-gray-500 mr-1">
                                          Пресет вёрстки:
                                        </span>
                                        <ChildPresetSelect
                                          child={c}
                                          presets={presets}
                                          albumPresetName={album.config_preset_name ?? null}
                                          onChange={async (newSlug) => {
                                            try {
                                              const r = await apiVA('/api/tenant', {
                                                method: 'POST',
                                                body: JSON.stringify({
                                                  action: 'update_child_preset',
                                                  child_id: c.id,
                                                  preset_slug: newSlug,
                                                }),
                                              })
                                              if (!r.ok) {
                                                const err = await r.json().catch(() => ({ error: 'unknown' }))
                                                onError(err.error ?? 'Ошибка обновления пресета')
                                                return
                                              }
                                              setChildren(prev => prev.map(ch => {
                                                if (ch.id !== c.id) return ch
                                                if (newSlug === '') {
                                                  return { ...ch, config_preset_id: null, config_preset_slug: null, config_preset_name: null }
                                                }
                                                const found = presets.find(p => p.slug === newSlug)
                                                return {
                                                  ...ch,
                                                  config_preset_id: found?.id ?? null,
                                                  config_preset_slug: found?.slug ?? null,
                                                  config_preset_name: found?.name ?? null,
                                                }
                                              }))
                                              onNotify(`Пресет обновлён для ${c.full_name}`)
                                            } catch (e) {
                                              onError(e instanceof Error ? e.message : 'network error')
                                            }
                                          }}
                                        />
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
                                      const PhotoThumb = ({ src, fullSrc, label, sub, subClass }: { src: string; fullSrc: string; label: string; sub?: string; subClass?: string }) => (
                                        <div className="flex flex-col gap-1 items-center w-28">
                                          <div className="relative group cursor-zoom-in" onClick={() => window.open(fullSrc, '_blank')}>
                                            <img src={src} alt={label}
                                              className="w-28 h-28 object-cover rounded-lg border border-gray-200 group-hover:opacity-90 transition-opacity" />
                                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                              <span className="bg-black/50 text-white text-xs px-2 py-1 rounded-full"><Maximize2 size={12} className="inline" /> открыть</span>
                                            </div>
                                          </div>
                                          <span className={`text-xs ${subClass ?? 'text-gray-500'}`}>{label}</span>
                                          {sub && <span className="text-xs text-gray-400 truncate w-full text-center" title={sub}>{sub}</span>}
                                        </div>
                                      )
                                      return (
                                        <div className="flex flex-wrap gap-4 items-start">
                                          {portrait && (
                                            <PhotoThumb
                                              src={portrait.thumb || portrait.url}
                                              fullSrc={portrait.url}
                                              label="Портрет"
                                              sub={portrait.filename}
                                            />
                                          )}
                                          {cover && (
                                            <PhotoThumb
                                              src={cover.thumb || cover.url}
                                              fullSrc={cover.url}
                                              label={`Обложка${det.cover?.surcharge ? ` +${det.cover.surcharge} ₽` : ''}`}
                                              subClass={det.cover?.surcharge ? 'text-amber-600 font-medium' : 'text-gray-500'}
                                              sub={cover.filename}
                                            />
                                          )}
                                          {groups.map((g: any, i: number) => (
                                            <PhotoThumb
                                              key={i}
                                              src={g.thumb || g.url}
                                              fullSrc={g.url}
                                              label={`С друзьями ${i + 1}`}
                                              sub={g.filename}
                                            />
                                          ))}
                                          {(det.spreadPhotos ?? []).length > 0 && (det.spreadPhotos as any[]).map((p: any, i: number) => (
                                            <PhotoThumb
                                              key={`sp-${i}`}
                                              src={p.url}
                                              fullSrc={p.url}
                                              label={`Разворот ${i + 1}`}
                                              sub={p.width && p.height ? `${p.width}×${p.height}` : p.filename}
                                            />
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
                          )})}
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
                  originalsProgress={originalsProgress}
                  setOriginalsProgress={setOriginalsProgress}
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

              {/* Вкладка Доплаты */}
              {tab === 'surcharges' && (() => {
                const surchargeChildren = children.filter(c => c.cover?.cover_option === 'other')
                const coverTotal = surchargeChildren.reduce((sum, c) => sum + (c.cover?.surcharge ?? 0), 0)
                const spreadPrice = (album as any).personal_spread_price ?? 300
                const spreadChildren = spreadData.filter(c => c.photos.length > 0)
                const spreadTotal = spreadChildren.length * spreadPrice
                const grandTotal = coverTotal + spreadTotal
                return (
                  <div className="space-y-6">
                    {grandTotal === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-8">Доплат нет</p>
                    ) : (
                      <>
                        {/* Доплаты за обложку */}
                        {surchargeChildren.length > 0 && (
                          <div>
                            <h4 className="text-sm font-semibold text-gray-600 mb-3">Другой портрет на обложку</h4>
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                                  <th className="pb-2 pr-4">Ученик</th>
                                  <th className="pb-2 pr-4">Класс</th>
                                  <th className="pb-2 text-right">Сумма</th>
                                </tr>
                              </thead>
                              <tbody>
                                {surchargeChildren.map(c => (
                                  <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                                    <td className="py-2.5 pr-4 font-medium">{c.full_name}</td>
                                    <td className="py-2.5 pr-4 text-gray-500">{c.class ?? '—'}</td>
                                    <td className="py-2.5 text-right text-amber-600 font-medium">+{c.cover?.surcharge ?? 0} ₽</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {/* Доплаты за личный разворот */}
                        {spreadChildren.length > 0 && (
                          <div>
                            <h4 className="text-sm font-semibold text-gray-600 mb-3">Личный разворот</h4>
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                                  <th className="pb-2 pr-4">Ученик</th>
                                  <th className="pb-2 pr-4">Класс</th>
                                  <th className="pb-2 pr-4">Фото</th>
                                  <th className="pb-2 text-right">Сумма</th>
                                </tr>
                              </thead>
                              <tbody>
                                {spreadChildren.map(c => (
                                  <tr key={c.child_id} className="border-b border-gray-50 hover:bg-gray-50">
                                    <td className="py-2.5 pr-4 font-medium">{c.full_name}</td>
                                    <td className="py-2.5 pr-4 text-gray-500">{c.class ?? '—'}</td>
                                    <td className="py-2.5 pr-4 text-gray-400">{c.photos.length} шт.</td>
                                    <td className="py-2.5 text-right text-amber-600 font-medium">+{spreadPrice} ₽</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {/* Итого */}
                        <div className="flex justify-end pt-2 border-t-2 border-gray-200">
                          <span className="font-bold text-lg text-amber-600">{grandTotal} ₽</span>
                        </div>
                      </>
                    )}
                  </div>
                )
              })()}

              {/* Вкладка Ответственный родитель */}
              {tab === 'responsible' && (
                <ResponsibleTab
                  albumId={album.id}
                  canEdit={canEdit}
                  onNotify={onNotify}
                  onError={onError}
                />
              )}

              {/* Вкладка Личный разворот */}
              {tab === 'spread' && (
                <SpreadTab
                  spreadData={spreadData}
                  album={album}
                />
              )}

              {/* Вкладка Производство */}
              {tab === 'production' && (
                <ProductionTab
                  album={album}
                  workflow={workflow}
                  originals={originals}
                  delivery={delivery}
                  canEdit={canEdit}
                  isSuperAdmin={false}
                  viewAsTenantId={viewAsTenantId}
                  onWorkflowUpdate={(w) => setWorkflow(w)}
                  onOriginalsUpdate={(o) => setOriginals(o)}
                  onDeliveryUpdate={(d) => setDelivery(d)}
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
  personal_spread_enabled: boolean
  personal_spread_price: number
  personal_spread_min: number
  personal_spread_max: number
  text_enabled: boolean
  text_max_chars: number
  text_type?: string
}

type PresetOption = {
  id: string
  slug: string
  name: string
  print_type: string
}

type FormData = {
  title: string
  city: string
  year: string
  school_name: string
  deadline: string
  cover_mode: string
  cover_price: string
  group_enabled: boolean
  group_min: string
  group_max: string
  group_exclusive: boolean
  personal_spread_enabled: boolean
  personal_spread_price: string
  personal_spread_price_mode: string
  personal_spread_min: string
  personal_spread_max: string
  text_enabled: boolean
  text_max_chars: string
  text_type: string
  template_title: string
  class_name: string
  config_type: string
  print_type: string
  /**
   * РЭ.24.6: id выбранного шаблона из каталога /app/templates.
   * Если задан — engine использует buildFromSectionStructure,
   * template_set_id и print_type берутся из preset'а.
   * Если NULL — старая логика через preset_slug (legacy).
   */
  section_structure_preset_id: string | null
  /** Для отображения в кнопке — название выбранного шаблона. */
  section_structure_preset_name: string | null
  /** Для отображения в кнопке — название дизайна выбранного шаблона. */
  section_structure_design_name: string | null
  // ── Обложка (НОВАЯ система, Этап 7 ТЗ обложки). Не путать с cover_mode. ──
  cover_portrait_charge: string      // 'none'|'different_photo'|'any_portrait' — доплата за портрет на обложке
  cover_layout_mode: string | null   // 'fixed'|'default_editable'|'parent_choice'|null
  cover_default_type: string | null  // 'portrait_photo'|'common_photo'|'design_only'|null
  cover_available_ids: string[]      // какие обложки показывать родителю
  print_preset_id: string | null     // пресет печати (расчёт корешка)
  sheet_type_id: string | null       // тип листа внутри пресета
}

const textTypeOptions = [
  { v: 'free', l: 'Свободный' },
  { v: 'garden', l: 'Детский сад' },
  { v: 'grade4', l: '4 класс' },
  { v: 'grade11', l: '9-11 класс' },
]

// Обложка (Этап 7): подписи типов обложки для блока «Обложка альбома».
const COVER_TYPE_LABEL: Record<string, string> = {
  portrait_photo: 'Портрет ученика',
  common_photo: 'Общее фото',
  design_only: 'Дизайн без фото',
}

// Обложка-объединение (Этап 2): единая настройка доплаты за портрет на обложке
// (cover_portrait_charge) — но СТАРЫЙ родительский поток ещё живёт на cover_mode
// (см. app/[token]/page.tsx). Чтобы он работал консистентно, выводим cover_mode
// из cover_portrait_charge при сохранении, и наоборот при инициализации.
// none → optional_blind (выбор без цен), different_photo → optional (другое +доплата),
// any_portrait → required (все платят). Удалим связку на этапе 4 (снос старой системы).
const CHARGE_TO_COVER_MODE: Record<string, string> = {
  none: 'optional_blind',
  different_photo: 'optional',
  any_portrait: 'required',
}
const COVER_MODE_TO_CHARGE: Record<string, string> = {
  optional_blind: 'none',
  same: 'none',
  none: 'none',
  optional: 'different_photo',
  required: 'any_portrait',
}
const coverModeToCharge = (m: string | null | undefined): string =>
  (m && COVER_MODE_TO_CHARGE[m]) || 'different_photo'

function emptyForm(): FormData {
  return {
    title: '',
    city: '',
    year: String(new Date().getFullYear()),
    school_name: '',
    deadline: '',
    cover_mode: 'optional',
    cover_price: '300',
    group_enabled: true,
    group_min: '2',
    group_max: '2',
    group_exclusive: true,
    personal_spread_enabled: false,
    personal_spread_price: '300',
    personal_spread_price_mode: 'paid',
    personal_spread_min: '4',
    personal_spread_max: '12',
    text_enabled: true,
    text_max_chars: '500',
    text_type: 'free',
    template_title: '',
    class_name: '',
    config_type: 'standard',
    print_type: 'layflat',
    section_structure_preset_id: null,
    section_structure_preset_name: null,
    section_structure_design_name: null,
    cover_portrait_charge: 'different_photo',
    cover_layout_mode: null,
    cover_default_type: null,
    cover_available_ids: [],
    print_preset_id: null,
    sheet_type_id: null,
  }
}

// ─── Override пресета per-child (используется в expanded row AlbumDetailModal)
function ChildPresetSelect({
  child,
  presets,
  albumPresetName,
  onChange,
}: {
  child: Child
  presets: PresetOption[]
  albumPresetName: string | null
  onChange: (newSlug: string) => Promise<void>
}) {
  const currentSlug = child.config_preset_slug ?? ''
  const [draftSlug, setDraftSlug] = useState<string>(currentSlug)
  const [busy, setBusy] = useState(false)

  // Синхронизация если child обновлён извне (после save или другого edit'а)
  useEffect(() => {
    setDraftSlug(child.config_preset_slug ?? '')
  }, [child.config_preset_slug])

  const dirty = draftSlug !== currentSlug

  return (
    <>
      <select
        value={draftSlug}
        onChange={(e) => setDraftSlug(e.target.value)}
        disabled={busy}
        className="text-xs px-2 py-1 border border-gray-300 rounded"
      >
        <option value="">
          Использовать пресет альбома
          {albumPresetName ? ` (${albumPresetName})` : ' (не задан)'}
        </option>
        {presets.map(p => (
          <option key={p.slug} value={p.slug}>
            {p.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!dirty || busy}
        onClick={async () => {
          setBusy(true)
          try {
            await onChange(draftSlug)
          } finally {
            setBusy(false)
          }
        }}
        className="text-xs btn-secondary px-3 py-1.5 disabled:opacity-50"
      >
        {busy ? '...' : 'Применить'}
      </button>
      {dirty && (
        <span className="text-xs text-amber-600">Не сохранено</span>
      )}
    </>
  )
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
      const presetSlug = album.config_preset_slug ?? null
      // Если у альбома пресет не задан (config_preset_id=NULL) — стартуем с
      // пустыми значениями, чтобы пользователь явно выбрал. Sentinel-опция
      // disabled в <select> покажет «— выберите —».
      const [cfgType, prtType] = presetSlug
        ? (presetSlug.split('-') as [string, string])
        : ['', '']
      return {
        title: album.title,
        city: album.city ?? '',
        year: String(album.year ?? new Date().getFullYear()),
        school_name: (album as any).school_name ?? '',
        deadline: album.deadline ? album.deadline.slice(0, 10) : '',
        cover_mode: album.cover_mode,
        cover_price: String(album.cover_price ?? 0),
        group_enabled: (album as any).group_enabled ?? true,
        group_min: String((album as any).group_min ?? 2),
        group_max: String((album as any).group_max ?? 2),
        group_exclusive: (album as any).group_exclusive ?? true,
        personal_spread_enabled: (album as any).personal_spread_enabled ?? false,
        personal_spread_price: String((album as any).personal_spread_price ?? 300),
        personal_spread_price_mode: ((album as any).personal_spread_price ?? 300) === 0 ? 'free' : 'paid',
        personal_spread_min: String((album as any).personal_spread_min ?? 4),
        personal_spread_max: String((album as any).personal_spread_max ?? 12),
        text_enabled: (album as any).text_enabled ?? true,
        text_max_chars: String((album as any).text_max_chars ?? 500),
        text_type: (album as any).text_type ?? 'free',
        template_title: (album as any).template_title ?? '',
        class_name: ((album as any).classes ?? []).join(', '),
        config_type: cfgType,
        print_type: prtType,
        // РЭ.24.6: подхватываем выбранный шаблон если у альбома он был.
        // Названия (preset_name + design_name) подгружаются асинхронно
        // в useEffect ниже — для отображения на кнопке.
        section_structure_preset_id: (album as any).section_structure_preset_id ?? null,
        section_structure_preset_name: null,
        section_structure_design_name: null,
        // cover_portrait_charge: если в БД пусто (старый альбом) — выводим из cover_mode.
        cover_portrait_charge: (album as any).cover_portrait_charge ?? coverModeToCharge(album.cover_mode),
        cover_layout_mode: (album as any).cover_layout_mode ?? null,
        cover_default_type: (album as any).cover_default_type ?? null,
        cover_available_ids: (album as any).cover_available_ids ?? [],
        print_preset_id: (album as any).print_preset_id ?? null,
        sheet_type_id: (album as any).sheet_type_id ?? null,
      }
    }
    return emptyForm()
  })

  const [templates, setTemplates] = useState<Template[]>([])
  // РЭ.30.6: state `presets` удалён — он питал dropdown'ы «Комплектация»
  // и «Тип печати» в блоке «Пресет вёрстки», которого больше нет в форме.
  const [loading, setLoading] = useState(false)
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  // РЭ.39.b: state модалки подтверждения клонирования альбома.
  const [showCloneConfirm, setShowCloneConfirm] = useState(false)
  const [backdropStart, setBackdropStart] = useState(false)
  // РЭ.24.6: модалка выбора шаблона + диалог смены/снятия шаблона.
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false)
  const [pendingTemplateChange, setPendingTemplateChange] = useState<{
    newId: string | null
    newName: string | null
    newDesignName: string | null
  } | null>(null)
  // Обложка (Этап 7): библиотека обложек + пресеты печати для блока «Обложка».
  const [coverLibrary, setCoverLibrary] = useState<Array<{
    id: string; name: string; cover_type: string
    gender_hint: string | null; variant_label: string | null; is_global: boolean
  }>>([])
  const [printPresets, setPrintPresets] = useState<Array<{
    id: string; name: string
    print_spec: { sheet_types?: Array<{ id: string; label: string }> } | null
  }>>([])
  // Превью собранной обложки на альбом (edit mode).
  const [coverPreviewOpen, setCoverPreviewOpen] = useState(false)
  const [coverPreviewLoading, setCoverPreviewLoading] = useState(false)
  const [coverPreviewData, setCoverPreviewData] = useState<{
    previews: Array<{ child_id: string | null; child_name: string | null; cover_name: string | null; cover_type: string; has_cover: boolean; svg: string }>
    spine_width_mm: number | null
    warnings: string[]
  } | null>(null)

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

  // Обложка (Этап 7): библиотека обложек + пресеты печати — в обоих режимах.
  useEffect(() => {
    api('/api/tenant?action=covers_list')
      .then(r => r.ok ? r.json() : { covers: [] })
      .then(d => setCoverLibrary(d.covers ?? []))
      .catch(() => setCoverLibrary([]))
    api('/api/tenant?action=print_presets_list')
      .then(r => r.ok ? r.json() : { presets: [] })
      .then(d => setPrintPresets(d.presets ?? []))
      .catch(() => setPrintPresets([]))
  }, [])

  // Загрузить превью собранной обложки на текущий альбом (edit).
  const loadCoverPreview = async () => {
    if (!album?.id) return
    setCoverPreviewOpen(true)
    setCoverPreviewLoading(true)
    setCoverPreviewData(null)
    try {
      const r = await api(`/api/tenant?action=cover_album_preview&album_id=${album.id}`)
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`)
      setCoverPreviewData({ previews: d.previews ?? [], spine_width_mm: d.spine_width_mm ?? null, warnings: d.warnings ?? [] })
    } catch (e) {
      setCoverPreviewData({ previews: [], spine_width_mm: null, warnings: [e instanceof Error ? e.message : 'Ошибка'] })
    } finally {
      setCoverPreviewLoading(false)
    }
  }

  // РЭ.30.6: useEffect для загрузки presets_list удалён —
  // он питал dropdown'ы блока «Пресет вёрстки», которого больше нет.

  // РЭ.24.6: если форма открыта в режиме редактирования и у альбома
  // уже задан section_structure_preset_id — подгружаем его название
  // и название дизайна для отображения на кнопке-бейдже.
  // Делаем один запрос (rule_presets_list возвращает все доступные)
  // и сразу второй на designs_list для названия дизайна.
  useEffect(() => {
    const psId = form.section_structure_preset_id
    if (!psId) return
    if (form.section_structure_preset_name && form.section_structure_design_name) {
      return // уже подгружено
    }
    let cancelled = false
    Promise.all([
      api('/api/tenant?action=rule_presets_list').then(r => r.ok ? r.json() : null),
      api('/api/tenant?action=designs_list').then(r => r.ok ? r.json() : null),
    ]).then(([presetsData, designsData]) => {
      if (cancelled) return
      const preset = (presetsData?.presets ?? []).find((p: any) => p.id === psId)
      if (!preset) return
      const design = (designsData?.designs ?? []).find(
        (d: any) => d.id === preset.template_set_id,
      )
      setForm(f => ({
        ...f,
        section_structure_preset_name: preset.display_name ?? '?',
        section_structure_design_name: design?.name ?? null,
      }))
    }).catch(() => { /* молча — кнопка покажет id */ })
    return () => { cancelled = true }
  }, [form.section_structure_preset_id])

  const applyTemplate = (t: Template) => {
    setForm(f => ({
      ...f,
      cover_mode: t.cover_mode,
      cover_price: String(t.cover_price ?? 0),
      cover_portrait_charge: coverModeToCharge(t.cover_mode),
      group_enabled: t.group_enabled,
      group_min: String(t.group_min),
      group_max: String(t.group_max),
      group_exclusive: t.group_exclusive,
      personal_spread_enabled: t.personal_spread_enabled ?? false,
      personal_spread_price: String(t.personal_spread_price ?? 300),
      personal_spread_price_mode: (t.personal_spread_price ?? 300) === 0 ? 'free' : 'paid',
      personal_spread_min: String(t.personal_spread_min ?? 4),
      personal_spread_max: String(t.personal_spread_max ?? 12),
      text_enabled: t.text_enabled,
      text_max_chars: String(t.text_max_chars),
      text_type: t.text_type ?? 'free',
      template_title: t.title,
    }))
  }

  // РЭ.24.6: обработчик выбора шаблона в TemplatePickerModal.
  // Если у альбома уже был шаблон — показываем диалог подтверждения
  // (есть риск потерять drafts из редактора, см. spec §6 пункт 4).
  // Иначе — применяем сразу.
  const handleTemplatePicked = (
    newId: string | null,
    newName: string | null,
    newDesignName: string | null,
  ) => {
    setTemplatePickerOpen(false)
    const currentId = form.section_structure_preset_id
    if (currentId && currentId !== newId) {
      // Смена/снятие существующего — нужен confirm
      setPendingTemplateChange({ newId, newName, newDesignName })
    } else {
      // Нет существующего шаблона или тот же самый — применяем сразу
      setForm(f => ({
        ...f,
        section_structure_preset_id: newId,
        section_structure_preset_name: newName,
        section_structure_design_name: newDesignName,
      }))
    }
  }

  const handleTemplateClear = () => {
    // Снятие шаблона — тоже через confirm если шаблон уже был
    if (form.section_structure_preset_id) {
      setPendingTemplateChange({
        newId: null,
        newName: null,
        newDesignName: null,
      })
    }
  }

  const confirmTemplateChange = () => {
    if (!pendingTemplateChange) return
    setForm(f => ({
      ...f,
      section_structure_preset_id: pendingTemplateChange.newId,
      section_structure_preset_name: pendingTemplateChange.newName,
      section_structure_design_name: pendingTemplateChange.newDesignName,
    }))
    setPendingTemplateChange(null)
  }
  const cancelTemplateChange = () => setPendingTemplateChange(null)

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
      school_name: form.school_name.trim() || null,
      deadline: form.deadline ? new Date(form.deadline + 'T23:59:59').toISOString() : null,
      // cover_mode выводим из единой настройки cover_portrait_charge, чтобы
      // живой старый родительский поток ([token]) работал консистентно.
      cover_mode: CHARGE_TO_COVER_MODE[form.cover_portrait_charge] ?? form.cover_mode,
      cover_price: parseInt(form.cover_price) || 0,
      // Обложка (НОВАЯ система, Этап 7 ТЗ обложки).
      cover_portrait_charge: form.cover_portrait_charge,
      cover_layout_mode: form.cover_layout_mode,
      cover_default_type: form.cover_default_type,
      cover_available_ids: form.cover_available_ids,
      print_preset_id: form.print_preset_id,
      sheet_type_id: form.sheet_type_id,
      group_enabled: form.group_enabled,
      group_min: parseInt(form.group_min) || 0,
      group_max: parseInt(form.group_max) || 0,
      group_exclusive: form.group_exclusive,
      personal_spread_enabled: form.personal_spread_enabled,
      personal_spread_price: parseInt(form.personal_spread_price) || 300,
      personal_spread_min: parseInt(form.personal_spread_min) || 4,
      personal_spread_max: parseInt(form.personal_spread_max) || 12,
      text_enabled: form.text_enabled,
      text_max_chars: parseInt(form.text_max_chars) || 500,
      text_type: form.text_type,
      classes: form.class_name.trim()
        ? form.class_name.split(',').map(s => s.trim()).filter(Boolean)
        : [],
      // РЭ.41.c: include_non_purchasers перенесён из формы на Обзор
      // (IncludeNonPurchasersControl). При сохранении формы поле
      // НЕ отправляется — БД сохраняет существующее значение.
      // РЭ.41.b: print_type override перенесён из формы на Обзор
      // (PrintTypeOverrideControl). При сохранении формы print_type
      // НЕ отправляется — БД сохраняет существующее значение.
      // РЭ.24.6 + РЭ.30.6: единственный путь задания структуры альбома —
      // выбор Шаблона в каталоге (section_structure_preset_id). Engine
      // через buildFromSectionStructure получает template_set_id и
      // print_type из выбранного preset'а.
      //
      // legacy preset_slug ('standard', 'universal' и т.д.) больше НЕ
      // отправляется. Колонка albums.config_preset_id остаётся в БД
      // (legacy-альбомы), но новые альбомы её не заполняют — поэтому при
      // create_album приходит section_structure_preset_id или ничего.
      // При update_album ВСЕГДА отправляем section_structure_preset_id —
      // в т.ч. null, чтобы корректно снять шаблон с существующего альбома.
      ...(mode === 'create'
        ? form.section_structure_preset_id
          ? { section_structure_preset_id: form.section_structure_preset_id }
          : {}
        : { section_structure_preset_id: form.section_structure_preset_id }),
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

  // РЭ.39.b: клонирование альбома. Создаёт копию со всеми заполненными
  // данными (ученики, учителя, фото, выбор фото, тексты от родителей).
  // Layout не копируется — engine пересоберёт при первом просмотре копии.
  // Ссылки родителей в копии новые (старые продолжают работать с оригиналом).
  const handleClone = async () => {
    if (!album) return
    setLoading(true)
    const r = await api('/api/tenant', {
      method: 'POST',
      body: JSON.stringify({
        action: 'album_clone',
        source_album_id: album.id,
      }),
    })
    if (r.ok) {
      const data = await r.json().catch(() => ({}))
      const newId = (data as { id?: string }).id
      // Возвращаемся в список с обновлёнными данными. Используем
      // существующий onSuccess колбэк — он закроет модалку и обновит
      // список альбомов. Партнёр увидит копию в списке и сам её откроет.
      onSuccess?.(`Создана копия: ${(data as { title?: string }).title ?? 'без названия'}`)
      // Closure-safe — пользователю не нужно ничего делать, копия видна
      // в списке. Если в будущем понадобится auto-redirect — берём newId.
      void newId
    } else {
      const d = await r.json().catch(() => ({}))
      onError(d.error ?? 'Не удалось клонировать альбом')
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-40 flex items-start justify-center py-8 px-4 overflow-y-auto"
      onMouseDown={handleBackdropMouseDown}
      onMouseUp={handleBackdropMouseUp}
    >
      {coverPreviewOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center py-8 px-4 overflow-y-auto"
          onMouseDown={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
          onClick={(e) => { if (e.target === e.currentTarget) setCoverPreviewOpen(false) }}
        >
          <div className="bg-white rounded-2xl max-w-5xl w-full shadow-xl my-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Превью обложки</h3>
              <button type="button" onClick={() => setCoverPreviewOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl"><X size={18} /></button>
            </div>
            {coverPreviewLoading && <div className="text-center py-8 text-gray-400">Собираю обложку…</div>}
            {!coverPreviewLoading && coverPreviewData && (
              <>
                <div className="text-sm text-gray-500 mb-3">
                  Корешок: {coverPreviewData.spine_width_mm != null
                    ? `${coverPreviewData.spine_width_mm.toFixed(1)} мм`
                    : 'не посчитан (нет пресета печати или сохранённого макета альбома)'}
                </div>
                {coverPreviewData.warnings.length > 0 && (
                  <div className="card p-3 bg-amber-50 border-amber-200 text-xs text-amber-800 mb-3">
                    <ul className="list-disc pl-4 space-y-0.5">
                      {coverPreviewData.warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                )}
                {coverPreviewData.previews.length === 0 ? (
                  <div className="text-center py-8 text-gray-400">
                    Нет собранных обложек. Проверьте режим, тип и отмеченные доступные обложки.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[70vh] overflow-y-auto">
                    {coverPreviewData.previews.map((p, i) => (
                      <div key={i} className="card p-3">
                        <div
                          className="w-full bg-gray-50 border border-gray-200 rounded mb-2 overflow-hidden flex items-center justify-center"
                          style={{ aspectRatio: '2 / 1', minHeight: '80px' }}
                          dangerouslySetInnerHTML={{ __html: p.has_cover ? p.svg : '' }}
                        />
                        <div className="text-sm font-medium truncate">{p.child_name ?? 'Общая обложка'}</div>
                        <div className="text-xs text-gray-400 truncate">
                          {p.cover_name ?? '—'}{p.has_cover ? '' : ' · обложка не назначена'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
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

          {/* Учебное заведение (для подписи на обложке) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Учебное заведение <span className="font-normal text-gray-400 text-xs">(для подписи на обложке)</span>
            </label>
            <input
              type="text"
              value={form.school_name}
              onChange={(e) => set('school_name', e.target.value)}
              className="input"
              placeholder="Гимназия №1"
              disabled={loading}
            />
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

          {/* РЭ.24.6: выбор шаблона из каталога — новый путь.
              Если выбран — section_structure_preset_id заполняется и
              приоритетнее, чем legacy селекты ниже (комплектация + тип печати).
              Опциональное поле: партнёр может создать альбом без шаблона
              и добавить позже когда согласует дизайн с школой. */}
          <div className="border-t-2 border-gray-200 pt-5 mt-1">
            <p className="text-sm font-semibold text-blue-700 mb-2">
              Шаблон <span className="font-normal text-gray-400 text-xs">(опционально — можно выбрать позже)</span>
            </p>
            {form.section_structure_preset_id ? (
              <div className="inline-flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded text-sm">
                <span className="text-blue-700 font-medium">
                  {form.section_structure_preset_name ?? form.section_structure_preset_id}
                </span>
                {form.section_structure_design_name && (
                  <span className="text-blue-500 text-xs">
                    · {form.section_structure_design_name}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setTemplatePickerOpen(true)}
                  disabled={loading}
                  className="text-blue-600 hover:text-blue-800 text-xs underline ml-1"
                >
                  сменить
                </button>
                <button
                  type="button"
                  onClick={handleTemplateClear}
                  disabled={loading}
                  className="text-red-500 hover:text-red-700 text-lg leading-none ml-1"
                  title="Снять шаблон"
                >
                  ×
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setTemplatePickerOpen(true)}
                disabled={loading}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded text-sm text-gray-700"
              >
                Выбрать шаблон (опционально)
              </button>
            )}
            <p className="text-xs text-gray-500 mt-2">
              Шаблон из каталога задаёт структуру альбома (дизайн +
              секции + тип листов). Без шаблона автосборка не сработает —
              выберите шаблон, чтобы запустить «Собрать автоматически».
            </p>
          </div>

          {/* РЭ.41.b: блок «Тип листов в альбоме» перенесён из формы
              на вкладку «Обзор» альбома (PrintTypeOverrideControl). */}

          {/* РЭ.41.c: галка «Включить в личный раздел всех учеников»
              перенесена из формы на вкладку «Обзор» альбома
              (IncludeNonPurchasersControl). */}

          {/* РЭ.41.a: блок «Распределение учеников по страницам»
              перенесён из формы на вкладку «Обзор» альбома
              (StudentDistributionControl рядом с превью). Это часто
              меняемая при тестировании настройка — на Обзоре переключать
              быстрее. */}

          {/* РЭ.30.6: блок «Пресет вёрстки» (Комплектация + Тип печати)
              удалён. Это была legacy-альтернатива выбору Шаблона из
              каталога, которая писала config_preset_id напрямую. После
              РЭ.30 единственный путь — выбор Шаблона выше (виджет
              section_structure_preset_id). Колонка albums.config_preset_id
              остаётся в БД (legacy-альбомы продолжают её использовать
              через старый движок buildAlbum), но новые альбомы её
              больше не заполняют. */}

          {/* Обложка альбома — ЕДИНАЯ система (объединение, Этап 2).
              Один раздел: (1) кто выбирает обложку + галерея,
              (2) портрет на обложке + доплата (бывший блок «второе фото»). */}
          <div className="border-t-2 border-gray-200 pt-5 mt-1">
            <p className="text-sm font-semibold text-blue-700 mb-1">
              Обложка альбома <span className="font-normal text-gray-400 text-xs">(твёрдый переплёт)</span>
            </p>
            <p className="text-xs text-gray-400 mb-4">
              Какая обложка у альбома, кто её выбирает и доплата за портрет на обложке. Деньги считаются вне системы.
            </p>

            <label className="block text-xs text-gray-500 mb-1">Кто выбирает обложку</label>
            <div className="flex flex-wrap gap-2 mb-3">
              {[
                { v: '', l: 'Не настраивать' },
                { v: 'fixed', l: 'Партнёр фиксирует одну' },
                { v: 'default_editable', l: 'Дефолт, родитель может сменить' },
                { v: 'parent_choice', l: 'Родитель выбирает' },
              ].map(({ v, l }) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => set('cover_layout_mode', v || null)}
                  className={`px-3 py-1.5 rounded-xl text-sm border transition-colors ${
                    (form.cover_layout_mode ?? '') === v
                      ? 'border-gray-900 bg-gray-900 text-white'
                      : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}
                  disabled={loading}
                >
                  {l}
                </button>
              ))}
            </div>

            {form.cover_layout_mode && (
              <>
                <label className="block text-xs text-gray-500 mb-1">Тип обложки по умолчанию</label>
                <div className="flex flex-wrap gap-2 mb-3">
                  {(['portrait_photo', 'common_photo', 'design_only'] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => set('cover_default_type', v)}
                      className={`px-3 py-1.5 rounded-xl text-sm border transition-colors ${
                        form.cover_default_type === v
                          ? 'border-gray-900 bg-gray-900 text-white'
                          : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                      }`}
                      disabled={loading}
                    >
                      {COVER_TYPE_LABEL[v]}
                    </button>
                  ))}
                </div>

                <label className="block text-xs text-gray-500 mb-1">
                  Какие обложки показывать родителю {form.cover_layout_mode === 'fixed' && '(при «жёстко» родитель не выбирает)'}
                </label>
                {coverLibrary.length === 0 ? (
                  <div className="text-xs text-gray-400 mb-3">
                    Обложки ещё не загружены — раздел заработает после загрузки (Обложки в супер-админке).
                  </div>
                ) : (
                  <div className="flex flex-col gap-1 mb-3 max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-2">
                    {coverLibrary.map((c) => {
                      const checked = form.cover_available_ids.includes(c.id)
                      return (
                        <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={loading}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...form.cover_available_ids, c.id]
                                : form.cover_available_ids.filter((id) => id !== c.id)
                              set('cover_available_ids', next)
                            }}
                          />
                          <span>{c.name}</span>
                          <span className="text-xs text-gray-400">
                            {COVER_TYPE_LABEL[c.cover_type] ?? c.cover_type}
                            {c.gender_hint ? ` · ${c.gender_hint}` : ''}
                            {c.is_global ? '' : ' · своя'}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                )}

                <label className="block text-xs text-gray-500 mb-1">Пресет печати (для расчёта корешка)</label>
                <select
                  value={form.print_preset_id ?? ''}
                  disabled={loading}
                  onChange={(e) => {
                    set('print_preset_id', e.target.value || null)
                    set('sheet_type_id', null)
                  }}
                  className="input mb-2"
                >
                  <option value="">Не выбран</option>
                  {printPresets.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                {printPresets.length === 0 && (
                  <div className="text-xs text-gray-400 mb-2">
                    Пресетов печати пока нет (нужны параметры корешка в пресете).
                  </div>
                )}

                {(() => {
                  const preset = printPresets.find((p) => p.id === form.print_preset_id)
                  const sheets = preset?.print_spec?.sheet_types ?? []
                  if (!form.print_preset_id || sheets.length === 0) return null
                  return (
                    <select
                      value={form.sheet_type_id ?? ''}
                      disabled={loading}
                      onChange={(e) => set('sheet_type_id', e.target.value || null)}
                      className="input"
                    >
                      <option value="">Тип листа по умолчанию</option>
                      {sheets.map((s) => (
                        <option key={s.id} value={s.id}>{s.label}</option>
                      ))}
                    </select>
                  )
                })()}

                {mode === 'edit' && album?.id && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={loadCoverPreview}
                      className="btn-secondary text-sm"
                      disabled={loading}
                    >
                      <Eye size={16} /> Превью обложки
                    </button>
                    <div className="text-xs text-gray-400 mt-1">
                      Соберёт обложку с реальными ФИО/городом/годом и посчитанным корешком.
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ── Портрет на обложке: доплата (бывший блок «второе фото»). ──
                Показываем когда обложка ещё не настроена (живёт старый поток
                родителя) ИЛИ когда среди обложек есть портретная. */}
            {(() => {
              const newActive = !!form.cover_layout_mode && form.cover_available_ids.length > 0
              const portraitInAvail = form.cover_available_ids.some(
                (id) => coverLibrary.find((c) => c.id === id)?.cover_type === 'portrait_photo'
              )
              const show = !newActive || form.cover_default_type === 'portrait_photo' || portraitInAvail
              if (!show) return null
              return (
                <div className="border-t border-gray-100 pt-4 mt-4">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Портрет на обложке</label>
                  <p className="text-xs text-gray-400 mb-2">
                    Когда брать доплату, если на обложке портрет ученика.
                  </p>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {[
                      { v: 'none', l: 'Бесплатно' },
                      { v: 'different_photo', l: 'Только за другое фото' },
                      { v: 'any_portrait', l: 'За любой портрет' },
                    ].map(({ v, l }) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => set('cover_portrait_charge', v)}
                        className={`px-3 py-1.5 rounded-xl text-sm border transition-colors ${
                          form.cover_portrait_charge === v
                            ? 'border-gray-900 bg-gray-900 text-white'
                            : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                        }`}
                        disabled={loading}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                  {form.cover_portrait_charge !== 'none' && (
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">
                        {form.cover_portrait_charge === 'any_portrait'
                          ? 'Доплата за портрет на обложке (₽)'
                          : 'Доплата за другое фото на обложку (₽)'}
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
              )
            })()}
          </div>

          {/* Групповые фото */}
          <div className="border-t-2 border-gray-200 pt-5 mt-1">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3">
              <input
                type="checkbox"
                checked={form.group_enabled}
                onChange={(e) => set('group_enabled', e.target.checked)}
                className="rounded"
                disabled={loading}
              />
              <span className="font-semibold text-blue-700">Групповые фото</span> <span className="text-gray-400 font-normal text-xs">(с друзьями)</span>
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

          {/* Личный разворот */}
          <div className="border-t-2 border-gray-200 pt-5 mt-1">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3">
              <input
                type="checkbox"
                checked={form.personal_spread_enabled}
                onChange={(e) => set('personal_spread_enabled', e.target.checked)}
                className="rounded"
                disabled={loading}
              />
              <span className="font-semibold text-blue-700">Личный разворот</span> <span className="text-gray-400 font-normal text-xs">(родитель загружает свои фото)</span>
            </label>
            {form.personal_spread_enabled && (
              <div className="space-y-3 pl-6">
                {/* Режим цены */}
                <div className="flex flex-wrap gap-2">
                  {[
                    { v: 'paid', l: 'С доплатой' },
                    { v: 'free', l: 'Без цены' },
                  ].map(({ v, l }) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => set('personal_spread_price_mode', v)}
                      className={`px-4 py-1.5 rounded-full text-sm border transition-colors ${
                        (form.personal_spread_price_mode ?? 'paid') === v
                          ? 'bg-gray-900 text-white border-gray-900'
                          : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
                      }`}
                      disabled={loading}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Мин. фото</label>
                    <input type="number" value={form.personal_spread_min}
                      onChange={(e) => set('personal_spread_min', e.target.value)}
                      className="input" min={1} max={12} disabled={loading} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Макс. фото</label>
                    <input type="number" value={form.personal_spread_max}
                      onChange={(e) => set('personal_spread_max', e.target.value)}
                      className="input" min={1} max={12} disabled={loading} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Цена (₽)</label>
                    <input type="number" value={form.personal_spread_price}
                      onChange={(e) => set('personal_spread_price', e.target.value)}
                      className="input" min={0} disabled={loading} />
                  </div>
                </div>
                <p className="text-xs text-gray-400">
                  Родитель загружает до {form.personal_spread_max} своих фото (10×15 см, до 10 МБ каждое).
                  Доплата +{form.personal_spread_price} ₽ —
                  {(form.personal_spread_price_mode ?? 'paid') === 'paid'
                    ? ' родитель видит сумму.'
                    : ' родитель суммы не видит (скрытая доплата).'}
                </p>
              </div>
            )}
          </div>

          {/* Текст от ученика */}
          <div className="border-t-2 border-gray-200 pt-5 mt-1">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3">
              <input
                type="checkbox"
                checked={form.text_enabled}
                onChange={(e) => set('text_enabled', e.target.checked)}
                className="rounded"
                disabled={loading}
              />
              <span className="font-semibold text-blue-700">Текст от ученика</span>
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

          {/* Реферальная программа заказа. Доступна при редактировании
              (нужен существующий album.id). Самосохраняется при выборе —
              не зависит от кнопки «Сохранить изменения». */}
          {mode === 'edit' && album && (
            <div className="border-t-2 border-gray-200 pt-5 mt-1">
              <span className="font-semibold text-blue-700"><Gift size={14} /> Реферальная программа</span>
              <ReferralProgramControl
                album={album}
                apiVA={api}
                onNotify={() => {}}
                onError={onError}
              />
            </div>
          )}

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
              {/* РЭ.39.b: Клонировать — полезное действие, не деструктивное.
                  Ставим первым. */}
              {!album.archived && (
                !showCloneConfirm ? (
                  <button
                    type="button"
                    onClick={() => setShowCloneConfirm(true)}
                    className="text-sm text-blue-600 hover:text-blue-800 transition-colors mb-4 block"
                    disabled={loading}
                  >
                    <Copy size={16} /> Клонировать альбом
                  </button>
                ) : (
                  <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-4">
                    <div className="font-medium text-blue-800 mb-2 text-sm">
                      Создать копию альбома?
                    </div>
                    <p className="text-sm text-blue-700 mb-3">
                      Будет создан альбом <strong>«{album.title} — копия»</strong> со
                      всеми фотографиями, выбором фото, текстами от родителей,
                      учителями и настройками. <strong>Layout пересоберётся</strong>{' '}
                      при первом просмотре копии. <strong>Ссылки родителей</strong>{' '}
                      в копии будут новыми (старые продолжат работать с оригиналом).
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleClone}
                        className="px-3 py-1.5 rounded-xl text-sm bg-blue-600 hover:bg-blue-700 text-white transition-colors"
                        disabled={loading}
                      >
                        {loading ? 'Клонируем...' : 'Да, создать копию'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowCloneConfirm(false)}
                        className="btn-secondary text-sm px-3 py-1.5"
                        disabled={loading}
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                )
              )}

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
      {/* РЭ.24.6: модалка выбора шаблона */}
      {templatePickerOpen && (
        <TemplatePickerModal
          currentPresetId={form.section_structure_preset_id}
          onPick={handleTemplatePicked}
          onClose={() => setTemplatePickerOpen(false)}
        />
      )}
      {/* РЭ.24.6: диалог подтверждения смены/снятия шаблона */}
      {pendingTemplateChange && (
        <div
          className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4"
          onClick={cancelTemplateChange}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-3">
              {pendingTemplateChange.newId ? 'Сменить шаблон?' : 'Снять шаблон?'}
            </h3>
            <div className="text-sm text-gray-700 space-y-2 mb-4">
              <p>Это пересоздаст структуру альбома:</p>
              <ul className="list-disc pl-5 text-gray-600 text-sm space-y-1">
                <li>Все вёрстки которые ты делал вручную в редакторе — сохранятся как drafts, но могут некорректно отобразиться в новом шаблоне.</li>
                <li>Если в новом дизайне другие пропорции — фото могут потребовать повторного кропа.</li>
              </ul>
              <p className="text-xs text-gray-500 mt-2">
                Если ты ещё не вёрстал альбом в редакторе — ничего не потеряешь.
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={cancelTemplateChange}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-sm"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={confirmTemplateChange}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
              >
                {pendingTemplateChange.newId ? 'Сменить шаблон' : 'Снять шаблон'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================
// РЭ.24.6: TemplatePickerModal — выбор шаблона при создании/редактировании
// альбома. Показывает «Мои шаблоны» + «Готовые от OkeyBook» с
// группировкой по дизайнам. Невалидные → disabled с пометкой 'Доработай'.
// ============================================================

type PickerDesign = {
  id: string
  name: string
}

type PickerTemplate = {
  id: string
  display_name: string
  description: string
  template_set_id: string | null
  valid: boolean
  errors: string[]
  previews: { students: string | null }
  kind: 'global' | 'my'
}

function TemplatePickerModal({
  currentPresetId,
  onPick,
  onClose,
}: {
  currentPresetId: string | null
  onPick: (
    newId: string | null,
    newName: string | null,
    newDesignName: string | null,
  ) => void
  onClose: () => void
}) {
  const [designs, setDesigns] = useState<PickerDesign[]>([])
  const [globals, setGlobals] = useState<PickerTemplate[]>([])
  const [mine, setMine] = useState<PickerTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [designFilter, setDesignFilter] = useState<string>('') // '' = все
  // РЭ.48: двухуровневая навигация. Шаг 1 — выбор дизайна
  // (если дизайнов > 1). Шаг 2 — шаблоны выбранного дизайна.
  // Если только один дизайн (или не выбран) — сразу идём в 'templates'
  // (как раньше: все шаблоны / по фильтру).
  type Step = 'design' | 'templates'
  const [step, setStep] = useState<Step>('design')

  // Когда данные загрузились — решаем стартовый step.
  // Если у партнёра только один дизайн, нет смысла показывать выбор дизайна.
  // Если currentPresetId уже задан — открываемся сразу в templates с
  // дизайном выбранного пресета (чтобы он мог быстро поменять).
  useEffect(() => {
    if (loading) return
    if (designs.length <= 1) {
      setStep('templates')
      if (designs.length === 1) setDesignFilter(designs[0].id)
      return
    }
    if (currentPresetId) {
      const cur =
        globals.find((t) => t.id === currentPresetId) ??
        mine.find((t) => t.id === currentPresetId)
      if (cur && cur.template_set_id) {
        setDesignFilter(cur.template_set_id)
        setStep('templates')
        return
      }
    }
    // Иначе стартуем с выбора дизайна.
    setStep('design')
  }, [loading, designs, currentPresetId, globals, mine])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      api('/api/tenant?action=designs_list'),
      api('/api/tenant?action=templates_list_global'),
      api('/api/tenant?action=templates_list_my'),
    ])
      .then(async ([dResp, gResp, mResp]) => {
        if (cancelled) return
        if (!dResp.ok || !gResp.ok || !mResp.ok) {
          throw new Error('Не удалось загрузить шаблоны')
        }
        const dData = await dResp.json()
        const gData = await gResp.json()
        const mData = await mResp.json()
        setDesigns(
          (dData.designs ?? []).map((d: any) => ({ id: d.id, name: d.name })),
        )
        setGlobals(
          (gData.templates ?? []).map((t: any) => ({
            id: t.id,
            display_name: t.display_name,
            description: t.description ?? '',
            template_set_id: t.template_set_id,
            valid: true,
            errors: [],
            previews: { students: t.previews?.students ?? null },
            kind: 'global' as const,
          })),
        )
        setMine(
          (mData.templates ?? []).map((t: any) => ({
            id: t.id,
            display_name: t.display_name,
            description: t.description ?? '',
            template_set_id: t.template_set_id,
            valid: t.valid ?? false,
            errors: t.errors ?? [],
            previews: { students: t.previews?.students ?? null },
            kind: 'my' as const,
          })),
        )
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Ошибка')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const designNameById = (id: string | null): string | null => {
    if (!id) return null
    const d = designs.find((x) => x.id === id)
    return d?.name ?? null
  }

  const pick = (t: PickerTemplate) => {
    if (!t.valid) return
    onPick(t.id, t.display_name, designNameById(t.template_set_id))
  }

  // Фильтрация по дизайну (если выбран)
  const filteredGlobals = designFilter
    ? globals.filter((t) => t.template_set_id === designFilter)
    : globals
  const filteredMine = designFilter
    ? mine.filter((t) => t.template_set_id === designFilter)
    : mine

  // РЭ.48: после введения двухуровневой навигации (шаг design → templates)
  // глобальные шаблоны просто фильтруем по designFilter, группировка
  // по дизайнам уже не нужна — внутри шага 2 всегда один дизайн.

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[55] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Шапка */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-3 min-w-0">
            {/* РЭ.48: кнопка ← на шаге templates, чтобы вернуться к выбору
                дизайна. Показываем только если дизайнов > 1. */}
            {step === 'templates' && designs.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  setStep('design')
                  setDesignFilter('')
                }}
                className="text-gray-600 hover:text-gray-900 text-sm whitespace-nowrap"
                title="Назад к выбору дизайна"
              >
                ← К дизайнам
              </button>
            )}
            <div className="min-w-0">
              <h3 className="text-lg font-semibold truncate">
                {step === 'design'
                  ? 'Выберите дизайн'
                  : designFilter
                    ? `Шаблоны: ${designNameById(designFilter) ?? ''}`
                    : 'Выбрать шаблон'}
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {step === 'design'
                  ? 'Сначала выберите дизайн альбома, затем шаблон внутри него.'
                  : 'Шаблон описывает структуру альбома: дизайн + секции + тип листов.'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-2xl leading-none"
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>

        {/* Содержимое */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {loading && (
            <div className="text-center text-gray-500 py-8">Загрузка...</div>
          )}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          {/* РЭ.48: ШАГ 1 — Выбор дизайна */}
          {!loading && !error && step === 'design' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {designs.map((d) => {
                const count =
                  globals.filter((t) => t.template_set_id === d.id).length +
                  mine.filter((t) => t.template_set_id === d.id).length
                // Превью дизайна — берём первое доступное превью из любого
                // шаблона этого дизайна (предпочитаем глобальные).
                const preview =
                  globals.find((t) => t.template_set_id === d.id)?.previews
                    .students ??
                  mine.find((t) => t.template_set_id === d.id)?.previews
                    .students ??
                  null
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => {
                      setDesignFilter(d.id)
                      setStep('templates')
                    }}
                    className="text-left p-3 rounded-lg border bg-white border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all flex flex-col gap-2 cursor-pointer"
                  >
                    <div
                      className="w-full bg-gray-50 border border-gray-200 rounded overflow-hidden flex items-center justify-center"
                      style={{ aspectRatio: '1 / 1.4', minHeight: '90px' }}
                      dangerouslySetInnerHTML={{
                        __html:
                          preview ??
                          '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#9ca3af;font-size:10px;">нет превью</div>',
                      }}
                    />
                    <div
                      className="text-sm font-medium text-gray-900 truncate"
                      title={d.name}
                    >
                      {d.name}
                    </div>
                    <div className="text-xs text-gray-500">
                      {count > 0 ? `${count} шаблон${count === 1 ? '' : count < 5 ? 'а' : 'ов'}` : 'нет шаблонов'}
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {/* ШАГ 2 — Шаблоны выбранного дизайна */}
          {!loading && !error && step === 'templates' && (
            <>
              {/* Мои шаблоны */}
              <section>
                <h4 className="text-sm font-semibold text-gray-700 mb-2">
                  Мои шаблоны ({filteredMine.length})
                </h4>
                {filteredMine.length === 0 ? (
                  <div className="text-xs text-gray-400 italic">
                    У вас пока нет своих шаблонов в этом дизайне.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                    {filteredMine.map((t) => (
                      <PickerCard
                        key={t.id}
                        template={t}
                        designName={designNameById(t.template_set_id)}
                        isCurrent={t.id === currentPresetId}
                        onPick={() => pick(t)}
                      />
                    ))}
                  </div>
                )}
              </section>

              {/* Готовые от OkeyBook — простой грид (уже отфильтровано
                  по выбранному дизайну в шаге 1, группировка не нужна). */}
              <section>
                <h4 className="text-sm font-semibold text-gray-700 mb-2">
                  Готовые от OkeyBook ({filteredGlobals.length})
                </h4>
                {filteredGlobals.length === 0 ? (
                  <div className="text-xs text-gray-400 italic">
                    Нет рекомендованных шаблонов от OkeyBook в этом дизайне.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                    {filteredGlobals.map((t) => (
                      <PickerCard
                        key={t.id}
                        template={t}
                        designName={designNameById(t.template_set_id)}
                        isCurrent={t.id === currentPresetId}
                        onPick={() => pick(t)}
                      />
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>

        {/* Подвал */}
        <div className="border-t p-4 flex items-center justify-between gap-2 bg-gray-50">
          <button
            type="button"
            onClick={() => onPick(null, null, null)}
            className="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-100 text-gray-700 rounded text-sm"
          >
            Создать без шаблона
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-100 text-gray-700 rounded text-sm"
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  )
}

function PickerCard({
  template,
  designName,
  isCurrent,
  onPick,
}: {
  template: PickerTemplate
  designName: string | null
  isCurrent: boolean
  onPick: () => void
}) {
  const disabled = !template.valid
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onPick}
      disabled={disabled}
      className={`text-left p-3 rounded-lg border transition-all flex flex-col gap-2 ${
        disabled
          ? 'bg-gray-50 border-gray-200 opacity-60 cursor-not-allowed'
          : isCurrent
          ? 'bg-blue-50 border-blue-400 ring-2 ring-blue-200'
          : 'bg-white border-gray-200 hover:border-blue-300 hover:shadow-sm cursor-pointer'
      }`}
    >
      {/* Превью */}
      <div
        className="w-full bg-gray-50 border border-gray-200 rounded overflow-hidden flex items-center justify-center"
        style={{ aspectRatio: '1 / 1.4', minHeight: '90px' }}
        dangerouslySetInnerHTML={{
          __html:
            template.previews.students ??
            '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#9ca3af;font-size:10px;">нет превью</div>',
        }}
      />
      <div className="text-sm font-medium text-gray-900 truncate" title={template.display_name}>
        {template.display_name}
      </div>
      {designName && (
        <div className="text-xs text-gray-500 truncate">{designName}</div>
      )}
      {template.description && (
        <div className="text-xs text-gray-500 line-clamp-2">{template.description}</div>
      )}
      {disabled && (
        <div className="text-xs text-red-600 font-medium">
          Доработай в «Шаблонах»
        </div>
      )}
      {isCurrent && !disabled && (
        <div className="text-xs text-blue-700 font-medium">Выбран сейчас</div>
      )}
    </button>
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
  is_head_teacher: boolean
  photo_storage_path: string | null
  photo_filename: string | null
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
  const [editForm, setEditForm] = useState<{
    full_name: string
    position: string
    description: string
    is_head_teacher: boolean
  }>({
    full_name: '',
    position: '',
    description: '',
    is_head_teacher: false,
  })

  const ycBase = 'https://storage.yandexcloud.net/yearbook-photos/'
  const photoUrl = (path: string) => ycBase + path.replace('yc:', '')

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
      is_head_teacher: t.is_head_teacher,
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
        is_head_teacher: editForm.is_head_teacher,
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
          {teachers.map((t) => (
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
                  <div>
                    <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={editForm.is_head_teacher}
                        onChange={(e) => setEditForm(f => ({ ...f, is_head_teacher: e.target.checked }))}
                        disabled={busy}
                        className="w-4 h-4"
                      />
                      <span>Классный руководитель</span>
                    </label>
                    <p className="text-xs text-gray-400 mt-1 ml-6">
                      На альбом отмечается один. При установке этого флага у других учителей альбома он автоматически снимется.
                    </p>
                  </div>
                  {editForm.is_head_teacher && (
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
                        Отображается только у классного руководителя
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
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      {t.photo_storage_path ? (
                        <div className="flex flex-col items-center w-24 flex-shrink-0">
                          <a
                            href={photoUrl(t.photo_storage_path)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block w-24 h-24 rounded-xl overflow-hidden bg-gray-100"
                            title={t.photo_filename ?? 'Открыть оригинал'}
                          >
                            <img
                              src={photoUrl(t.photo_storage_path)}
                              alt=""
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          </a>
                          {t.photo_filename && (
                            <div
                              className="text-xs text-gray-500 mt-1 truncate w-full text-center"
                              title={t.photo_filename}
                            >
                              {t.photo_filename.replace(/\.[^.]+$/, '')}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div
                          className="w-24 h-24 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0 text-gray-300 text-3xl"
                          title="Фото не выбрано"
                        >
                          ?
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="font-medium">
                            {t.full_name || <span className="text-gray-400">Имя не заполнено</span>}
                          </div>
                          {t.is_head_teacher && (
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
                        {t.is_head_teacher && t.description && (
                          <div className="text-sm text-gray-700 mt-2 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap">
                            {t.description}
                          </div>
                        )}
                      </div>
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
  type: PhotoKind
  has_original?: boolean  // П.3 — для бейджика «нет оригинала» в галерее
  url: string
  thumb_url: string
  tags: string[]
}

type PhotoKind =
  | 'portrait'
  | 'group'
  | 'teacher'
  // А.1.1 — общий раздел альбома (фото класса разной величины):
  | 'common_spread'
  | 'common_full'
  | 'common_half'
  | 'common_quarter'
  | 'common_sixth'
  // РЭ.59: коллаж — отдельная категория для коллажных вариаций
  // (3-8 фото на странице). Мастера для отображения добавятся позже.
  | 'common_collage'

// Порядок отображения в UI (загрузка + табы галереи). Сначала
// личные категории, затем общий раздел. Между группами в UI
// рендерится разделитель.
const PHOTO_KINDS_PERSONAL: PhotoKind[] = ['portrait', 'group', 'teacher']
const PHOTO_KINDS_COMMON: PhotoKind[] = [
  'common_spread',
  'common_full',
  'common_half',
  'common_quarter',
  'common_sixth',
  'common_collage',
]
const PHOTO_KINDS_ALL: PhotoKind[] = [...PHOTO_KINDS_PERSONAL, ...PHOTO_KINDS_COMMON]

const UPLOAD_CONCURRENCY = 5

function photoKindLabel(k: PhotoKind): string {
  switch (k) {
    case 'portrait': return 'Портреты'
    case 'group': return 'Групповые'
    case 'teacher': return 'Учителя'
    case 'common_spread': return 'Общее фото на разворот'
    case 'common_full': return 'Общие фото класса'
    case 'common_half': return 'Фото по полкласса'
    case 'common_quarter': return 'Фото 1/4 класса'
    case 'common_sixth': return 'Фото 1/6 класса'
    case 'common_collage': return 'Коллаж'
  }
}

/**
 * Параллельная клиентская загрузка фото.
 *
 * Двойная загрузка каждого файла (Б.1.3 — 11.05.2026):
 *   1. browser-image-compression → WebP ~2048px (~0.5-1 МБ)
 *   2. POST /api/upload c WebP → { photo_id, storage_path }
 *      (фото сразу появляется в БД и UI с WebP версией)
 *   3. ПАРАЛЛЕЛЬНО с шагом 2 (точнее: после получения photo_id):
 *      a. POST /api/upload-url upload_type='originals' →
 *         { upload_url, storage_path }
 *      b. PUT upload_url с оригинальным File body → YC
 *      c. POST /api/tenant action=register_original → UPDATE photos
 *
 * Шаг 3 нужен для PDF-экспорта в типографию (Б.2). Если упал на любом
 * этапе — фото остаётся с WebP-only, photos.original_path IS NULL,
 * PDF-export сделает fallback на storage_path. Не критичная ошибка,
 * пишем как warning а не error.
 *
 * Прогресс: один файл = один done. Шаг 3 идёт фоном после шага 2,
 * прогресс инкрементится сразу после шага 2 (UX-причина: фотограф
 * видит что WebP загрузился, не ждёт лишний раз пока 5+ МБ оригинал
 * докачается). Если оригинал упал — увидит в errors.
 *
 * Размер оригинала: лимита нет в этой версии (фотограф несёт
 * ответственность). YC принимает до 5 ТБ на объект. На практике
 * 5-10 МБ JPEG из камеры. Если в будущем понадобится — добавим
 * проверку на клиенте + серверный re-compress через sharp.
 */
async function uploadFilesParallel(
  files: File[],
  type: PhotoKind,
  albumId: string,
  onProgress: (done: number) => void,
  onFileError: (name: string, msg: string) => void,
  // П.1 — tracking фоновой загрузки оригиналов:
  // - onOriginalsStart: вызывается ОДИН РАЗ когда WebP-фаза стартует;
  //   передаёт сколько оригиналов ожидается и общий размер в байтах.
  //   ВАЖНО: вызывается ДО первого compression'а — UI сразу показывает
  //   '0 / N' блок чтобы партнёр понял что фоновая загрузка предстоит.
  // - onOriginalStarted: вызывается когда конкретный оригинал реально
  //   стартовал network-запрос (presigned URL получен). UI показывает
  //   '⏳ в работе K' активных upload'ов.
  // - onOriginalProgress: каждый раз когда один оригинал докачался
  //   (успешно или с ошибкой). filename + bytes (file.size) + ok.
  // - onOriginalsAllDone: вызывается когда ВСЕ фоновые upload'ы
  //   завершены (resolved/rejected все Promise'ы).
  callbacks?: {
    onOriginalsStart?: (total: number, totalBytes: number) => void
    onOriginalStarted?: (filename: string) => void
    onOriginalProgress?: (filename: string, bytes: number, ok: boolean) => void
    onOriginalsAllDone?: () => void
  },
) {
  const imageCompression = (await import('browser-image-compression')).default

  let done = 0
  const queue = [...files]

  // П.1 — собираем promise'ы фоновых upload'ов чтобы дождаться их в конце
  // и вызвать onOriginalsAllDone. Без этого Promise.all не понимает
  // когда фон закончился.
  const originalPromises: Promise<void>[] = []

  // Уведомляем UI сколько оригиналов будет грузиться. Total bytes для
  // прогресс-бара (показывает «X МБ из Y МБ»).
  const totalOriginalBytes = files.reduce((sum, f) => sum + f.size, 0)
  callbacks?.onOriginalsStart?.(files.length, totalOriginalBytes)

  // Фоновая загрузка оригинала — не блокирует прогресс-бар, ошибки идут
  // в onFileError со суффиксом '(оригинал)' чтобы фотограф мог различить.
  // Файл уже виден в галерее как WebP, оригинал просто докачивается.
  const uploadOriginalBackground = async (file: File, photoId: string) => {
    // П.1 — уведомляем UI что upload реально начался (network-запрос).
    // Между push'ем в originalPromises и реальным стартом fetch'a может
    // быть пауза если event loop занят WebP-compression'ами других файлов.
    // onOriginalStarted позволит UI показать '⏳ в работе K' активных.
    callbacks?.onOriginalStarted?.(file.name)
    try {
      // 1. Получаем presigned URL
      const urlRes = await fetch('/api/upload-url', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          album_id: albumId,
          filename: file.name,
          content_type: file.type || 'application/octet-stream',
          upload_type: 'originals',
        }),
      })
      if (!urlRes.ok) {
        const d = await urlRes.json().catch(() => ({}))
        throw new Error(d.error ?? `HTTP ${urlRes.status}`)
      }
      const { upload_url, storage_path } = await urlRes.json()

      // 2. PUT оригинала прямо в YC (минуя Vercel 4.5МБ limit)
      const putRes = await fetch(upload_url, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      })
      if (!putRes.ok) {
        throw new Error(`PUT в YC: HTTP ${putRes.status}`)
      }

      // 3. Регистрируем путь в БД
      const regRes = await fetch('/api/tenant', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'register_original',
          photo_id: photoId,
          original_path: storage_path,
        }),
      })
      if (!regRes.ok) {
        const d = await regRes.json().catch(() => ({}))
        throw new Error(d.error ?? `register_original HTTP ${regRes.status}`)
      }
      // П.1 — успех: уведомляем UI чтобы прогресс-бар двинулся вперёд
      callbacks?.onOriginalProgress?.(file.name, file.size, true)
    } catch (e: any) {
      // Не критично: WebP уже залит, фото видно в галерее. Просто оригинала
      // для печати нет. Сообщаем фотографу чтобы знал.
      onFileError(`${file.name} (оригинал)`, e?.message ?? 'Не удалось загрузить оригинал для печати')
      // П.1 — fail: всё равно уведомляем UI (счётчик «failed» инкрементируется)
      callbacks?.onOriginalProgress?.(file.name, file.size, false)
    }
  }

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

        // Загружаем WebP через сервер → Yandex Object Storage
        const formData = new FormData()
        const webpFile = new File([compressed], file.name.replace(/\.[^.]+$/, '.webp'), { type: 'image/webp' })
        formData.append('file', webpFile)
        formData.append('album_id', albumId)
        formData.append('type', type)
        formData.append('original_name', file.name)

        const res = await fetch('/api/upload', {
          method: 'POST',
          credentials: 'include',
          body: formData,
        })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          onFileError(file.name, d.error ?? 'Ошибка загрузки')
          // П.1 — для упавшего WebP оригинал не запускаем, но счётчик
          // уже total включает этот файл. Уведомляем чтобы он не «висел».
          callbacks?.onOriginalProgress?.(file.name, file.size, false)
        } else {
          // Шаг 3 — параллельная загрузка оригинала в фоне.
          // Прогресс-бар (WebP) инкрементится прямо сейчас (после успешной
          // загрузки WebP), пользователь видит что фото готово как WebP.
          // Сам upload оригинала продолжает работать фоном.
          const data = await res.json().catch(() => ({}))
          if (data?.photo_id) {
            // П.1 — собираем promise чтобы дождаться в конце.
            // uploadOriginalBackground никогда не throw'ит (имеет
            // внутренний try-catch), поэтому Promise всегда resolved.
            originalPromises.push(uploadOriginalBackground(file, data.photo_id))
          } else {
            // photo_id не вернулся — оригинал не запустится, уведомляем
            callbacks?.onOriginalProgress?.(file.name, file.size, false)
          }
        }
      } catch (e: any) {
        onFileError(file.name, e?.message ?? 'Неизвестная ошибка')
        // П.1 — упавший WebP, оригинал не запустится
        callbacks?.onOriginalProgress?.(file.name, file.size, false)
      }
      done++
      onProgress(done)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(UPLOAD_CONCURRENCY, files.length) }, worker),
  )

  // П.1 — после завершения всех WebP-workers'ов ждём завершения всех
  // фоновых upload'ов оригиналов. Это может занять много минут для
  // больших альбомов, но UI partнёра уже виден прогресс-бар. После
  // завершения вызываем onOriginalsAllDone — UI скрывает прогресс
  // (или показывает «готово» / «N ошибок»).
  if (originalPromises.length > 0) {
    await Promise.all(originalPromises)
  }
  callbacks?.onOriginalsAllDone?.()
}

function PhotosTab({
  albumId,
  archived,
  canEdit,
  children: childList,
  onNotify,
  onError,
  // Техдолг#4 — state поднят в AppPage чтобы beforeunload работал
  // независимо от модала альбома, и для глобального индикатора в header.
  originalsProgress,
  setOriginalsProgress,
}: {
  albumId: string
  archived: boolean
  canEdit: boolean
  children: Child[]
  onNotify: (msg: string) => void
  onError: (msg: string) => void
  originalsProgress:
    | null
    | {
        total: number
        done: number
        failed: number
        inProgress: number
        totalBytes: number
        doneBytes: number
        failedFilenames: string[]
        completed: boolean
      }
  setOriginalsProgress: React.Dispatch<
    React.SetStateAction<
      | null
      | {
          total: number
          done: number
          failed: number
          inProgress: number
          totalBytes: number
          doneBytes: number
          failedFilenames: string[]
          completed: boolean
        }
    >
  >
}) {
  const [activeKind, setActiveKind] = useState<PhotoKind>('portrait')
  const [photos, setPhotos] = useState<Photo[]>([])
  const [loading, setLoading] = useState(true)
  const [showImportTags, setShowImportTags] = useState(false)

  // П.1 / Техдолг#4 — state originalsProgress теперь в AppPage,
  // PhotosTab получает его через props. beforeunload protection
  // также живёт в AppPage.

  // состояние загрузки по каждому типу
  const [upload, setUpload] = useState<
    Record<PhotoKind, { files: File[]; uploading: boolean; done: number; errors: string[] }>
  >({
    portrait:       { files: [], uploading: false, done: 0, errors: [] },
    group:          { files: [], uploading: false, done: 0, errors: [] },
    teacher:        { files: [], uploading: false, done: 0, errors: [] },
    common_spread:  { files: [], uploading: false, done: 0, errors: [] },
    common_full:    { files: [], uploading: false, done: 0, errors: [] },
    common_half:    { files: [], uploading: false, done: 0, errors: [] },
    common_quarter: { files: [], uploading: false, done: 0, errors: [] },
    common_sixth:   { files: [], uploading: false, done: 0, errors: [] },
    common_collage: { files: [], uploading: false, done: 0, errors: [] },
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
      {
        // П.1 — агрегируем прогресс оригиналов в общий state.
        // Если уже идёт другая сессия (партнёр запустил upload подряд
        // в нескольких категориях) — мерджим: total/totalBytes складываем.
        onOriginalsStart: (total, totalBytes) => {
          setOriginalsProgress(prev => {
            if (prev && !prev.completed) {
              // Продолжаем существующую сессию
              return {
                ...prev,
                total: prev.total + total,
                totalBytes: prev.totalBytes + totalBytes,
              }
            }
            // Новая сессия
            return {
              total,
              done: 0,
              failed: 0,
              inProgress: 0,
              totalBytes,
              doneBytes: 0,
              failedFilenames: [],
              completed: false,
            }
          })
        },
        // UX#2 — реальный старт upload'а оригинала (network-фаза).
        // Между добавлением в originalPromises и реальным fetch'ем
        // может быть пауза из-за CPU-bottleneck (WebP compression).
        // inProgress показывает 'сколько прямо сейчас активно'.
        onOriginalStarted: (_filename) => {
          setOriginalsProgress(prev => {
            if (!prev) return prev
            return { ...prev, inProgress: prev.inProgress + 1 }
          })
        },
        onOriginalProgress: (filename, bytes, ok) => {
          setOriginalsProgress(prev => {
            if (!prev) return prev
            return {
              ...prev,
              done: prev.done + 1,
              failed: prev.failed + (ok ? 0 : 1),
              inProgress: Math.max(0, prev.inProgress - 1),
              doneBytes: prev.doneBytes + bytes,
              failedFilenames: ok ? prev.failedFilenames : [...prev.failedFilenames, filename],
            }
          })
        },
        onOriginalsAllDone: () => {
          setOriginalsProgress(prev => prev ? { ...prev, completed: true } : null)
        },
      },
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
    PHOTO_KINDS_ALL
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

  // П.3 — догрузить оригинал для photo которое его не имеет.
  // Открывает file picker → presigned URL → PUT в YC → register_original
  // (то же что фоновая загрузка в uploadFilesParallel.uploadOriginalBackground,
  // но через UI кнопку для recovery после catastrophic fail).
  //
  // Для повторной загрузки (если оригинал уже есть) используется
  // rebind_retouched в редакторе макета (PhotoContextMenu).
  const [uploadingOriginalFor, setUploadingOriginalFor] = useState<string | null>(null)
  const uploadOriginalForPhoto = async (photo: Photo) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/jpeg,image/jpg,image/png,image/tiff'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      setUploadingOriginalFor(photo.id)
      try {
        // 1. Presigned URL
        const urlRes = await api('/api/upload-url', {
          method: 'POST',
          body: JSON.stringify({
            album_id: albumId,
            filename: file.name,
            content_type: file.type || 'application/octet-stream',
            upload_type: 'originals',
          }),
        })
        if (!urlRes.ok) {
          const d = await urlRes.json().catch(() => ({}))
          throw new Error(d.error ?? `presigned URL HTTP ${urlRes.status}`)
        }
        const { upload_url, storage_path } = await urlRes.json()

        // 2. PUT в YC
        const putRes = await fetch(upload_url, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
        })
        if (!putRes.ok) throw new Error(`PUT в YC: HTTP ${putRes.status}`)

        // 3. register_original
        const regRes = await api('/api/tenant', {
          method: 'POST',
          body: JSON.stringify({
            action: 'register_original',
            photo_id: photo.id,
            original_path: storage_path,
          }),
        })
        if (!regRes.ok) {
          const d = await regRes.json().catch(() => ({}))
          throw new Error(d.error ?? `register_original HTTP ${regRes.status}`)
        }

        // Обновляем локальный state: бейджик «нет оригинала» пропадает
        setPhotos(prev => prev.map(p =>
          p.id === photo.id ? { ...p, has_original: true } : p,
        ))
        onNotify(`Оригинал для «${photo.filename}» загружен`)
      } catch (e: any) {
        onError(`Не удалось загрузить оригинал: ${e?.message ?? 'unknown'}`)
      } finally {
        setUploadingOriginalFor(null)
      }
    }
    input.click()
  }

  // Техдолг#4-bulk — массовая догрузка оригиналов для photo которые
  // их не имеют. Партнёр выбирает несколько файлов (или папку), система
  // матчит по filename и загружает через тот же pipeline.
  //
  // Use cases:
  //   - После catastrophic fail при первой загрузке (сеть, лимит YC и т.д.)
  //   - Бэкфилл оригиналов для старых альбомов (до CORS-фикса 11.05)
  //
  // Прогресс показывается через тот же originalsProgress (lifted в AppPage,
  // глобальный индикатор в header'е + блок наверху PhotoTab).
  const uploadOriginalsBulk = async () => {
    // Photos которым нужен оригинал
    const photosNeedingOriginal = photos.filter(p => p.has_original === false)
    if (photosNeedingOriginal.length === 0) {
      onNotify('Все фото уже имеют оригиналы')
      return
    }

    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/jpeg,image/jpg,image/png,image/tiff'
    input.multiple = true
    input.onchange = async () => {
      const files = Array.from(input.files ?? [])
      if (files.length === 0) return

      // Матчинг по filename. Photo.filename — это оригинальное имя файла
      // (DSC08521.jpg), сохранённое при первоначальной загрузке.
      // Сравниваем case-insensitive чтобы не было сюрпризов с macOS vs Windows.
      const photoByFilename = new Map<string, Photo>()
      for (const p of photosNeedingOriginal) {
        photoByFilename.set(p.filename.toLowerCase(), p)
      }

      const matched: { file: File; photo: Photo }[] = []
      const unmatched: string[] = []
      for (const f of files) {
        const photo = photoByFilename.get(f.name.toLowerCase())
        if (photo) {
          matched.push({ file: f, photo })
        } else {
          unmatched.push(f.name)
        }
      }

      if (matched.length === 0) {
        onError(
          `Ни один из ${files.length} файлов не совпал по имени с фото без оригиналов. ` +
          `Проверьте имена файлов — они должны совпадать с тем что было загружено изначально.`,
        )
        return
      }

      // Подтверждение если есть несовпадения (партнёр должен понимать
      // что часть файлов пропускается).
      if (unmatched.length > 0) {
        const preview = unmatched.slice(0, 5).join(', ')
        const more = unmatched.length > 5 ? `, и ещё ${unmatched.length - 5}` : ''
        if (!confirm(
          `Найдено ${matched.length} совпадений из ${files.length} файлов.\n\n` +
          `Не совпали (будут пропущены): ${preview}${more}\n\n` +
          `Продолжить?`,
        )) {
          return
        }
      } else {
        onNotify(`Найдено ${matched.length} совпадений, начинаем загрузку`)
      }

      // Инициализируем прогресс (тот же state что используется при
      // обычной загрузке — глобальный индикатор подхватит).
      const totalBytes = matched.reduce((sum, m) => sum + m.file.size, 0)
      setOriginalsProgress({
        total: matched.length,
        done: 0,
        failed: 0,
        inProgress: 0,
        totalBytes,
        doneBytes: 0,
        failedFilenames: [],
        completed: false,
      })

      // Параллельная загрузка с ограничением concurrency.
      const CONCURRENCY = 5
      const queue = [...matched]

      const uploadOne = async ({ file, photo }: { file: File; photo: Photo }) => {
        // UX#2 — отмечаем что началось network для этого файла
        setOriginalsProgress(prev => prev ? { ...prev, inProgress: prev.inProgress + 1 } : prev)
        try {
          const urlRes = await api('/api/upload-url', {
            method: 'POST',
            body: JSON.stringify({
              album_id: albumId,
              filename: file.name,
              content_type: file.type || 'application/octet-stream',
              upload_type: 'originals',
            }),
          })
          if (!urlRes.ok) {
            const d = await urlRes.json().catch(() => ({}))
            throw new Error(d.error ?? `presigned URL HTTP ${urlRes.status}`)
          }
          const { upload_url, storage_path } = await urlRes.json()

          const putRes = await fetch(upload_url, {
            method: 'PUT',
            body: file,
            headers: { 'Content-Type': file.type || 'application/octet-stream' },
          })
          if (!putRes.ok) throw new Error(`PUT в YC: HTTP ${putRes.status}`)

          const regRes = await api('/api/tenant', {
            method: 'POST',
            body: JSON.stringify({
              action: 'register_original',
              photo_id: photo.id,
              original_path: storage_path,
            }),
          })
          if (!regRes.ok) {
            const d = await regRes.json().catch(() => ({}))
            throw new Error(d.error ?? `register_original HTTP ${regRes.status}`)
          }

          setPhotos(prev => prev.map(p =>
            p.id === photo.id ? { ...p, has_original: true } : p,
          ))
          setOriginalsProgress(prev => prev ? {
            ...prev,
            done: prev.done + 1,
            inProgress: Math.max(0, prev.inProgress - 1),
            doneBytes: prev.doneBytes + file.size,
          } : prev)
        } catch {
          setOriginalsProgress(prev => prev ? {
            ...prev,
            done: prev.done + 1,
            failed: prev.failed + 1,
            inProgress: Math.max(0, prev.inProgress - 1),
            doneBytes: prev.doneBytes + file.size,
            failedFilenames: [...prev.failedFilenames, file.name],
          } : prev)
        }
      }

      const worker = async () => {
        while (queue.length > 0) {
          const item = queue.shift()
          if (!item) return
          await uploadOne(item)
        }
      }

      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, matched.length) }, worker),
      )

      setOriginalsProgress(prev => prev ? { ...prev, completed: true } : prev)
    }
    input.click()
  }

  // Массовое удаление всех фото текущей категории.
  // Требует ввода слова «УДАЛИТЬ» — операция необратима, удаляются
  // файлы из YC, связи, сбрасывается submitted_at у затронутых учеников.
  const [deletingAll, setDeletingAll] = useState(false)
  const deleteAllOfKind = async () => {
    if (photos.length === 0) return
    const label = photoKindLabel(activeKind).toLowerCase()
    const typed = window.prompt(
      `Удалить ВСЕ ${photos.length} фото в категории «${label}»?\n\n` +
      `Будут удалены файлы из хранилища и все привязки. ` +
      `Если фото были выбраны учениками — те ученики вернутся в статус «В процессе».\n\n` +
      `Введите УДАЛИТЬ заглавными буквами для подтверждения:`
    )
    if (typed !== 'УДАЛИТЬ') {
      if (typed !== null) onError('Удаление отменено — слово введено неверно')
      return
    }

    setDeletingAll(true)
    try {
      const r = await api('/api/tenant', {
        method: 'POST',
        body: JSON.stringify({
          action: 'delete_photos_by_type',
          album_id: albumId,
          photo_type: activeKind,
        }),
      })
      if (r.ok) {
        const d = await r.json()
        setPhotos([])
        if (d.resetChildren > 0) {
          onNotify(`Удалено ${d.deleted} фото. Сброшено учеников: ${d.resetChildren}`)
        } else {
          onNotify(`Удалено ${d.deleted} фото`)
        }
      } else {
        const d = await r.json().catch(() => ({}))
        onError(d.error ?? 'Не удалось удалить')
      }
    } catch (e: any) {
      onError(e?.message || 'Ошибка удаления')
    } finally {
      setDeletingAll(false)
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
                Выберите файлы для каждого типа. Сначала загрузятся превью (быстро), затем — оригиналы для печати (дольше).
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

          {/* П.1+техдолг#4 — прогресс загрузки оригиналов.
              Перемещён НАВЕРХ загрузочного блока (между заголовком и
              файловыми инпутами) — это главное что партнёр должен видеть.
              Оригиналы — узкое место по времени; превью (WebP) проходит
              быстро и его прогресс не важен в общем UI. */}
          {originalsProgress && (
            <div
              className={`rounded-lg border-2 p-4 ${
                originalsProgress.completed
                  ? originalsProgress.failed > 0
                    ? 'border-amber-400 bg-amber-50'
                    : 'border-green-400 bg-green-50'
                  : 'border-blue-400 bg-blue-50'
              }`}
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex-1 min-w-0">
                  {!originalsProgress.completed ? (
                    <>
                      <p className="text-base font-semibold text-blue-900 flex items-center gap-2">
                        <span className="animate-pulse"><Upload size={14} /></span>
                        Загружаем оригиналы для печати
                      </p>
                      <p className="text-xs text-blue-700 mt-1">
                        {originalsProgress.inProgress > 0 ? (
                          <><Loader2 size={14} className="inline animate-spin" /> В работе сейчас: {originalsProgress.inProgress}. Не закрывайте вкладку.</>
                        ) : originalsProgress.done === 0 ? (
                          <>Подготовка к загрузке оригиналов… Не закрывайте вкладку.</>
                        ) : (
                          <>Не закрывайте вкладку до завершения — оригиналы нужны для качества печати в типографии.</>
                        )}
                      </p>
                    </>
                  ) : originalsProgress.failed > 0 ? (
                    <>
                      <p className="text-base font-semibold text-amber-900 flex items-center gap-2">
                        <span><AlertTriangle size={14} className="inline" /></span>
                        Загружено {originalsProgress.done - originalsProgress.failed} из {originalsProgress.total}, ошибок: {originalsProgress.failed}
                      </p>
                      <p className="text-xs text-amber-800 mt-1">
                        У фото без оригинала будет бейджик в галерее — можно догрузить вручную.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-base font-semibold text-green-900 flex items-center gap-2">
                        <span><Check size={14} className="inline" /></span>
                        Все оригиналы загружены ({originalsProgress.total} шт)
                      </p>
                      <p className="text-xs text-green-800 mt-1">
                        Теперь PDF-экспорт будет в высоком качестве для печати.
                      </p>
                    </>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-2xl font-bold tabular-nums text-gray-900">
                    {originalsProgress.done}
                    <span className="text-gray-400 mx-1">/</span>
                    {originalsProgress.total}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5 tabular-nums">
                    {(originalsProgress.doneBytes / (1024 * 1024)).toFixed(0)}
                    {' / '}
                    {(originalsProgress.totalBytes / (1024 * 1024)).toFixed(0)} МБ
                  </p>
                </div>
              </div>

              {/* Прогресс-бар — главный визуальный элемент */}
              <div className="h-3 bg-white rounded-full overflow-hidden border border-gray-200">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    originalsProgress.completed
                      ? originalsProgress.failed > 0
                        ? 'bg-amber-500'
                        : 'bg-green-500'
                      : 'bg-blue-500'
                  }`}
                  style={{
                    width: `${originalsProgress.total > 0
                      ? Math.round((originalsProgress.done / originalsProgress.total) * 100)
                      : 0}%`,
                  }}
                />
              </div>

              {/* Список упавших файлов */}
              {originalsProgress.completed && originalsProgress.failed > 0 && (
                <details className="mt-3 text-xs">
                  <summary className="cursor-pointer text-amber-800 hover:text-amber-900 font-medium">
                    Показать {originalsProgress.failed} файлов которые не загрузились
                  </summary>
                  <ul className="mt-2 max-h-40 overflow-y-auto bg-white/60 rounded p-2 space-y-1">
                    {originalsProgress.failedFilenames.map((name, i) => (
                      <li key={i} className="text-gray-700 truncate" title={name}>
                        {name}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {/* Кнопка «Скрыть» только когда завершено */}
              {originalsProgress.completed && (
                <div className="flex justify-end mt-3">
                  <button
                    type="button"
                    onClick={() => setOriginalsProgress(null)}
                    className="text-xs text-gray-500 hover:text-gray-700"
                  >
                    Скрыть
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="space-y-3">
            {(() => {
              const renderUploadCard = (t: PhotoKind) => {
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
              }
              return (
                <>
                  {PHOTO_KINDS_PERSONAL.map(renderUploadCard)}
                  <div className="pt-3 mt-1 border-t border-gray-200">
                    <h5 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Общий раздел альбома
                    </h5>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      Фото класса для конца альбома — родители их не выбирают, builder сам раскладывает по разворотам
                    </p>
                  </div>
                  {PHOTO_KINDS_COMMON.map(renderUploadCard)}
                </>
              )
            })()}
          </div>

          {/* UX#1 — кнопка показывает общее состояние загрузки:
              1. WebP фаза: 'Загружаю превью (X/N)'
              2. Оригиналы: блокирована, но текст 'Идёт загрузка оригиналов'
                 (детали в прогресс-баре выше)
              3. Готова: '▶ Загрузить все' / 'Выберите файлы выше'
              Кнопка disabled пока идёт ЛЮБАЯ фаза — нельзя начать новую
              загрузку поверх текущей (могут пересечься сессии). */}
          <button
            className="btn-primary w-full"
            onClick={uploadAll}
            disabled={
              totalFiles === 0 ||
              anyUploading ||
              (originalsProgress !== null && !originalsProgress.completed)
            }
            type="button"
          >
            {anyUploading
              ? `Подготовка превью... (${totalDone} / ${totalFiles})`
              : originalsProgress && !originalsProgress.completed
                ? `Идёт загрузка оригиналов (${originalsProgress.done} / ${originalsProgress.total})`
                : totalFiles > 0
                  ? `▶ Загрузить все (${totalFiles} фото)`
                  : 'Выберите файлы выше'}
          </button>
        </div>
      )}

      {/* Галерея */}
      <div className="card p-5 min-h-[420px]">
        <div className="flex flex-wrap gap-1 mb-4 border-b border-gray-100">
          {PHOTO_KINDS_ALL.map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setActiveKind(t)}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeKind === t
                  ? 'border-brand-600 text-brand-700'
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
            <div className="flex items-center justify-between mb-3 gap-3">
              <p className="text-xs text-gray-400">
                {photos.length} фото
                {/* Подсказка сколько без оригинала */}
                {(() => {
                  const missingCount = photos.filter(p => p.has_original === false).length
                  if (missingCount === 0) return null
                  return (
                    <span className="ml-2 text-amber-600">
                      · {missingCount} без оригинала
                    </span>
                  )
                })()}
              </p>
              <div className="flex items-center gap-3">
                {/* Техдолг#4-bulk — массовая догрузка оригиналов */}
                {canEdit && photos.some(p => p.has_original === false) && (
                  <button
                    type="button"
                    onClick={uploadOriginalsBulk}
                    disabled={originalsProgress !== null && !originalsProgress.completed}
                    className="text-xs px-2 py-1 rounded bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Выберите все оригиналы папкой — система найдёт совпадения по имени файла и догрузит только отсутствующие"
                  >
                    <Upload size={16} /> Догрузить оригиналы
                  </button>
                )}
                {canEdit && (
                  <button
                    type="button"
                    onClick={deleteAllOfKind}
                    disabled={deletingAll}
                    className="text-xs text-gray-400 hover:text-red-500 disabled:opacity-50 disabled:cursor-wait"
                    title={`Удалить все фото в категории «${photoKindLabel(activeKind)}»`}
                  >
                    {deletingAll ? 'Удаляем…' : <><Trash2 size={16} /> Удалить все ({photos.length})</>}
                  </button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
              {photos.map(photo => {
                const missingOriginal = photo.has_original === false
                const uploadingThis = uploadingOriginalFor === photo.id
                return (
                  <div key={photo.id} className="relative group aspect-square bg-gray-100 rounded-lg overflow-hidden">
                    <img
                      src={photo.thumb_url}
                      alt={photo.filename}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                    {/* П.3 — бейджик «нет оригинала» */}
                    {missingOriginal && (
                      <div
                        className="absolute top-1 left-1 bg-amber-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-medium shadow-sm pointer-events-none"
                        title="У фото нет оригинала для печати — PDF будет в WebP качестве. Наведите для кнопки «Догрузить»."
                      >
                        <AlertTriangle size={14} className="inline" /> нет оригинала
                      </div>
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => deletePhoto(photo)}
                        className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 text-xs items-center justify-center hidden group-hover:flex"
                        title="Удалить"
                      >
                        <X size={14} />
                      </button>
                    )}
                    {/* П.3 — кнопка «Догрузить оригинал» при hover, если оригинала нет */}
                    {canEdit && missingOriginal && (
                      <button
                        type="button"
                        onClick={() => uploadOriginalForPhoto(photo)}
                        disabled={uploadingThis}
                        className="absolute inset-x-1 bottom-1 bg-amber-600 hover:bg-amber-700 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50 disabled:cursor-wait"
                      >
                        {uploadingThis ? <><Loader2 size={14} className="inline animate-spin" /> Загружаем…</> : <><Upload size={14} /> Догрузить оригинал</>}
                      </button>
                    )}
                    <div className={`absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1.5 py-1 ${missingOriginal && canEdit ? 'opacity-0 group-hover:opacity-0' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
                      <div className="truncate">{photo.filename}</div>
                      {photo.tags.length > 0 && (
                        <div className="truncate text-green-200 mt-0.5">
                          {photo.tags.length === 1 ? photo.tags[0] : `${photo.tags.length} привязок`}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
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
  program_name: string
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
                    ? 'border-brand-600 text-brand-700'
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

                    {lead.program_name && (
                      <p className="text-xs mb-1">
                        <span className="inline-block px-2 py-0.5 rounded bg-purple-50 text-purple-700">
                          <Gift size={14} /> {lead.program_name}
                        </span>
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
                                    <Check size={14} className="inline" /> {q.use_count}
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
                  ? 'border-brand-600 text-brand-700'
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
                  ? 'border-brand-600 text-brand-700'
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
                  ? 'border-brand-600 text-brand-700'
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
                  ? 'border-brand-600 text-brand-700'
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
                  ? 'border-brand-600 text-brand-700'
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

// ─── График динамики отбора (встроен в AlbumDetailModal → Обзор) ──────────────

function AlbumDailyChart({ daily }: { daily: { date: string; submitted: number; started: number }[] }) {
  const maxVal = Math.max(...daily.map(d => Math.max(d.submitted, d.started)), 1)
  const W = 600
  const H = 140
  const PAD = { top: 14, right: 12, bottom: 28, left: 28 }
  const chartW = W - PAD.left - PAD.right
  const chartH = H - PAD.top - PAD.bottom

  const x = (i: number) => PAD.left + (i / (daily.length - 1 || 1)) * chartW
  const y = (v: number) => PAD.top + chartH - (v / maxVal) * chartH

  const line = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => {
      if (i === 0) return `M ${p.x} ${p.y}`
      const prev = pts[i - 1]
      const cpx = (prev.x + p.x) / 2
      return `C ${cpx} ${prev.y} ${cpx} ${p.y} ${p.x} ${p.y}`
    }).join(' ')

  const sPts = daily.map((d, i) => ({ x: x(i), y: y(d.submitted) }))
  const oPts = daily.map((d, i) => ({ x: x(i), y: y(d.started) }))

  const areaPath = daily.length < 2 ? '' :
    line(sPts) +
    ` L ${sPts[sPts.length - 1].x} ${PAD.top + chartH} L ${sPts[0].x} ${PAD.top + chartH} Z`

  const gridYs = [0, 0.5, 1].map(f => ({
    y: PAD.top + chartH * (1 - f),
    label: Math.round(maxVal * f),
  }))

  const formatD = (iso: string) => {
    const d = new Date(iso + 'T00:00:00')
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
  }

  return (
    <div className="bg-gray-50 rounded-xl p-4 overflow-x-auto">
      <div className="flex gap-4 mb-2 text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-0.5 bg-green-500 rounded" />Завершили
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-0.5 bg-blue-400 rounded" />Открыли
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 280 }}>
        <defs>
          <linearGradient id="ag2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridYs.map(g => (
          <g key={g.y}>
            <line x1={PAD.left} y1={g.y} x2={W - PAD.right} y2={g.y} stroke="#e5e7eb" strokeWidth="1" />
            <text x={PAD.left - 4} y={g.y + 4} textAnchor="end" fontSize="8" fill="#9ca3af">{g.label || ''}</text>
          </g>
        ))}
        {daily.length >= 2 && <path d={areaPath} fill="url(#ag2)" />}
        {daily.length >= 2 && (
          <path d={line(oPts)} fill="none" stroke="#60a5fa" strokeWidth="1.5" strokeDasharray="4 3" strokeLinecap="round" />
        )}
        {daily.length >= 2 && (
          <path d={line(sPts)} fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" />
        )}
        {daily.map((d, i) => {
          const showLabel = daily.length <= 10 || i % Math.ceil(daily.length / 10) === 0 || i === daily.length - 1
          return (
            <g key={d.date}>
              <circle cx={x(i)} cy={y(d.submitted)} r="3" fill="#22c55e" />
              {d.submitted > 0 && (
                <text x={x(i)} y={y(d.submitted) - 5} textAnchor="middle" fontSize="8" fill="#16a34a" fontWeight="600">
                  {d.submitted}
                </text>
              )}
              {showLabel && (
                <text x={x(i)} y={H - 4} textAnchor="middle" fontSize="8" fill="#9ca3af">
                  {formatD(d.date)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ============================================================
// ВКЛАДКА ЛИЧНЫЙ РАЗВОРОТ
// ============================================================

function SpreadTab({ spreadData, album }: {
  spreadData: {
    child_id: string
    full_name: string
    class: string
    photos: { id: string; filename: string; storage_path: string; sort_order: number }[]
  }[]
  album: Album
}) {
  const price = (album as any).personal_spread_price ?? 300
  const min = (album as any).personal_spread_min ?? 4
  const max = (album as any).personal_spread_max ?? 12
  const [expanded, setExpanded] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  const withPhotos = spreadData.filter(c => c.photos.length > 0)
  const totalPhotos = withPhotos.reduce((s, c) => s + c.photos.length, 0)

  const ycBase = 'https://storage.yandexcloud.net/yearbook-photos/'
  const photoUrl = (storagePath: string) => ycBase + storagePath.replace('yc:', '')

  // Скачать ZIP через браузер — открываем ссылки по одной через <a download>
  const downloadAll = () => {
    if (!withPhotos.length) return
    setDownloading(true)
    const a = document.createElement('a')
    a.href = `/api/spread-download?album_id=${(album as any).id}`
    a.download = ''
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => setDownloading(false), 3000)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-800">
          Личный разворот
          {withPhotos.length > 0 && (
            <span className="ml-2 text-sm font-normal text-gray-400">
              {withPhotos.length} чел. · {totalPhotos} фото
            </span>
          )}
        </h3>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">{min}–{max} фото · +{price} ₽</span>
          {withPhotos.length > 0 && (
            <button
              onClick={downloadAll}
              disabled={downloading}
              className="btn-secondary text-xs px-3 py-1.5"
            >
              {downloading ? 'Создаём архив...' : <><Download size={16} /> Скачать всё</>}
            </button>
          )}
        </div>
      </div>

      {withPhotos.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">
          Пока никто не загружал фото для личного разворота
        </p>
      ) : (
        <div className="space-y-3">
          {withPhotos.map(c => (
            <div key={c.child_id} className="border border-gray-100 rounded-xl overflow-hidden">
              {/* Строка ученика */}
              <button
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 text-left"
                onClick={() => setExpanded(expanded === c.child_id ? null : c.child_id)}
              >
                <div className="flex items-center gap-3">
                  <span className="font-medium text-sm">{c.full_name}</span>
                  <span className="text-xs text-gray-400">{c.class}</span>
                  <span className={`text-xs font-medium ${c.photos.length < min ? 'text-amber-500' : 'text-green-600'}`}>
                    {c.photos.length} фото{c.photos.length < min ? ` (мало, нужно ${min})` : ''}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-amber-600 text-sm font-medium">+{price} ₽</span>
                  <span className="text-gray-400 text-xs">{expanded === c.child_id ? '▲' : '▼'}</span>
                </div>
              </button>

              {/* Превью фото */}
              {expanded === c.child_id && (
                <div className="px-4 pb-4 border-t border-gray-50">
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 mt-3">
                    {c.photos.map((p, i) => (
                      <a
                        key={p.id}
                        href={photoUrl(p.storage_path)}
                        target="_blank"
                        rel="noopener noreferrer"
                        download={p.filename}
                        title={p.filename}
                        className="relative aspect-square block rounded-lg overflow-hidden border border-gray-100 hover:border-blue-300 transition-colors group"
                      >
                        <img
                          src={photoUrl(p.storage_path)}
                          alt={p.filename}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                          <span className="text-white text-lg opacity-0 group-hover:opacity-100"><Download size={18} className="inline" /></span>
                        </div>
                        <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs text-center py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          {i + 1}
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Итого */}
          <div className="flex justify-end pt-2 border-t border-gray-100">
            <span className="text-sm font-semibold text-gray-700">
              Итого доплата за разворот:&nbsp;
              <span className="text-amber-600">{withPhotos.length * price} ₽</span>
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================
// ВКЛАДКА ПРОИЗВОДСТВО
// ============================================================

const WORKFLOW_LABELS: Record<string, { label: string; color: string }> = {
  active:        { label: 'Отбор идёт',       color: 'bg-blue-100 text-blue-700' },
  ready:         { label: 'Готов к передаче',  color: 'bg-amber-100 text-amber-700' },
  submitted:     { label: 'Передан в OkeyBook', color: 'bg-purple-100 text-purple-700' },
  in_production: { label: 'В работе',          color: 'bg-orange-100 text-orange-700' },
  delivered:     { label: 'Готов',             color: 'bg-green-100 text-green-700' },
}

function ProductionTab({ album, workflow, originals, delivery, canEdit, isSuperAdmin, viewAsTenantId, onWorkflowUpdate, onOriginalsUpdate, onDeliveryUpdate, onNotify, onError }: {
  album: Album
  workflow: any
  originals: any[]
  delivery: any[]
  canEdit: boolean
  isSuperAdmin: boolean
  viewAsTenantId?: string
  onWorkflowUpdate: (w: any) => void
  onOriginalsUpdate: (o: any[]) => void
  onDeliveryUpdate: (d: any[]) => void
  onNotify: (msg: string) => void
  onError: (msg: string) => void
}) {
  const [submitting, setSubmitting] = useState(false)
  const [uploadingOriginals, setUploadingOriginals] = useState(false)
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 })
  // Фаза К.2 — скачивание оригиналов для ретуши
  const [downloadingOriginalsZip, setDownloadingOriginalsZip] = useState(false)
  // По умолчанию false — выгружаем только выбранные родителями portrait/group
  // + все teacher/common_*. Чекбокс позволяет фотографу запросить весь архив
  // (например, чтобы отретушировать заранее, до завершения отбора).
  const [includeUnselected, setIncludeUnselected] = useState(false)
  const [bigAlbumOptions, setBigAlbumOptions] = useState<
    | null
    | {
        total_count: number
        max_per_request: number
        by_category: Record<string, number>
      }
  >(null)
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set())

  // Фаза К.4 — загрузка обработанных оригиналов
  const [uploadingRetouched, setUploadingRetouched] = useState(false)
  const [retouchedProgress, setRetouchedProgress] = useState({ done: 0, total: 0 })
  const [retouchedSummary, setRetouchedSummary] = useState<
    | null
    | {
        matched: number
        unmatched_count: number
        unmatched: { filename: string; storage_path: string }[]
        replaced: { photo_id: string; filename: string; type: string }[]
      }
  >(null)

  // Фаза К.5 — ручная привязка unmatched файлов к photo_id
  const [albumPhotos, setAlbumPhotos] = useState<
    null | { id: string; filename: string; type: string }[]
  >(null)
  const [rebindSelections, setRebindSelections] = useState<Record<string, string>>({})
  const [rebindingPaths, setRebindingPaths] = useState<Set<string>>(new Set())

  const status = workflow?.workflow_status ?? (album as any).workflow_status ?? 'active'
  const statusInfo = WORKFLOW_LABELS[status] ?? { label: status, color: 'bg-gray-100 text-gray-700' }

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/workflow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return res.json()
  }

  const handleSubmit = async () => {
    if (!confirm('Передать альбом в OkeyBook на вёрстку? После этого отбор будет завершён.')) return
    setSubmitting(true)
    const res = await post({ action: 'submit', album_id: (album as any).id })
    if (res.album) {
      onWorkflowUpdate(res.album)
      onNotify('Альбом передан в OkeyBook')
    } else {
      onError(res.error ?? 'Ошибка')
    }
    setSubmitting(false)
  }

  const handleMarkReady = async () => {
    const res = await post({ action: 'mark_ready', album_id: (album as any).id })
    if (res.album) {
      onWorkflowUpdate(res.album)
      onNotify('Статус обновлён')
    }
  }

  const handleUnsubmit = async () => {
    const isFromInProduction = status === 'in_production'
    const confirmText = isFromInProduction
      ? 'Снять альбом с работы и вернуть в статус "Передан"?\n\nВНИМАНИЕ: вёрстка уже могла начаться. Действие изменит статус, но не отменит проделанную работу.'
      : 'Отменить передачу альбома в OkeyBook и вернуть в работу?\n\nЭтого делать обычно не нужно — но если передали по ошибке или нашли неточность в данных, можно вернуть.'
    if (!confirm(confirmText)) return

    const res = await post({ action: 'unsubmit', album_id: (album as any).id })
    if (res.album) {
      onWorkflowUpdate(res.album)
      onNotify(
        isFromInProduction
          ? 'Альбом снят с работы. Статус: Передан в OkeyBook.'
          : 'Передача отменена. Альбом снова в работе.',
      )
    } else {
      onError(res.error ?? 'Не удалось снять с работы')
    }
  }

  const handleUploadOriginals = async (files: FileList) => {
    const arr = Array.from(files)
    setUploadingOriginals(true)
    setUploadProgress({ done: 0, total: arr.length })
    const newOriginals: any[] = []
    let done = 0
    for (const file of arr) {
      const fd = new FormData()
      fd.append('album_id', (album as any).id)
      fd.append('upload_type', 'original')
      fd.append('file', file)
      try {
        const res = await fetch('/api/workflow', { method: 'POST', body: fd })
        const data = await res.json()
        if (data.record) newOriginals.push(data.record)
      } catch { /* skip */ }
      done++
      setUploadProgress({ done, total: arr.length })
    }
    onOriginalsUpdate([...originals, ...newOriginals])
    setUploadingOriginals(false)
    setUploadProgress({ done: 0, total: 0 })
    if (newOriginals.length) onNotify(`Загружено ${newOriginals.length} файлов`)
  }

  const handleDeleteOriginal = async (fileId: string) => {
    if (!confirm('Удалить файл?')) return
    await post({ action: 'delete_original', album_id: (album as any).id, file_id: fileId })
    onOriginalsUpdate(originals.filter(o => o.id !== fileId))
  }

  const handleDownload = async (file: any) => {
    const url = `https://storage.yandexcloud.net/yearbook-photos/${file.storage_path.replace('yc:', '')}`
    await post({ action: 'mark_downloaded', album_id: (album as any).id, file_id: file.id })
    window.open(url, '_blank')
  }

  // Фаза К.2 — скачивание ZIP оригиналов для ретуши
  const handleDownloadOriginalsZip = async (categories?: string[]) => {
    setDownloadingOriginalsZip(true)
    try {
      const params = new URLSearchParams({ album_id: (album as any).id })
      if (categories && categories.length > 0) params.set('categories', categories.join(','))
      if (viewAsTenantId) params.set('view_as', viewAsTenantId)
      if (includeUnselected) params.set('include_unselected', '1')
      const res = await fetch(`/api/workflow/originals-zip?${params.toString()}`)
      if (!res.ok) {
        // Пробуем разобрать JSON-ошибку (404, 413, 500)
        let data: any = null
        try { data = await res.json() } catch { /* not json */ }
        if (res.status === 413 && data) {
          // Альбом слишком большой — предлагаем частичную выгрузку.
          setBigAlbumOptions({
            total_count: data.total_count,
            max_per_request: data.max_per_request,
            by_category: data.by_category || {},
          })
          setSelectedCategories(new Set())
          return
        }
        // 404 с filtered_out > 0 — есть фото, но никто не выбрал. Подсказываем
        // про чекбокс «Включить невыбранные».
        if (res.status === 404 && data?.filtered_out > 0) {
          onError(
            `${data.error}. ${data.hint || ''} Включите «Скачать также невыбранные фото» и попробуйте снова.`
          )
          return
        }
        onError(data?.error || data?.hint || `Не удалось скачать оригиналы (HTTP ${res.status})`)
        return
      }
      // Сбрасываем панель частичной выгрузки если она была открыта
      setBigAlbumOptions(null)

      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      // Имя файла из Content-Disposition (UTF-8 encoded)
      const cd = res.headers.get('Content-Disposition') || ''
      const m = cd.match(/filename\*=UTF-8''([^;]+)/i)
      const filename = m ? decodeURIComponent(m[1]) : `оригиналы_${(album as any).id}.zip`

      const a = document.createElement('a')
      a.href = objectUrl
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      // Освобождаем blob через секунду чтобы браузер успел инициировать скачивание
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)

      const downloaded = res.headers.get('X-Originals-Downloaded')
      const failed = res.headers.get('X-Originals-Failed')
      const failedNum = failed ? Number(failed) : 0
      onNotify(
        `Скачано ${downloaded ?? '?'} оригиналов${failedNum > 0 ? ` (${failedNum} не докачались, см. manifest.json)` : ''}`
      )
    } catch (e: any) {
      onError(e?.message || 'Не удалось скачать оригиналы')
    } finally {
      setDownloadingOriginalsZip(false)
    }
  }

  const toggleCategory = (cat: string) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  // Сумма выбранных категорий для UI
  const selectedSum = bigAlbumOptions
    ? Array.from(selectedCategories).reduce(
        (s, c) => s + (bigAlbumOptions.by_category[c] ?? 0),
        0
      )
    : 0

  // Фаза К.4 — загрузка обработанных оригиналов
  const handleUploadRetouched = async (files: FileList) => {
    const arr = Array.from(files)
    if (arr.length === 0) return
    setUploadingRetouched(true)
    setRetouchedProgress({ done: 0, total: arr.length })
    setRetouchedSummary(null)

    // Шаг 1: для каждого файла — presigned URL + PUT прямо в YC.
    // Это обходит Vercel 4.5 МБ лимит. uploadedFiles накапливаются
    // независимо от результата матчинга (К.3 сам решит что куда).
    const uploadedFiles: { filename: string; storage_path: string }[] = []
    const failedToUpload: string[] = []
    let done = 0
    for (const file of arr) {
      try {
        const urlRes = await fetch('/api/upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            album_id: (album as any).id,
            filename: file.name,
            content_type: file.type || 'application/octet-stream',
            upload_type: 'originals',
          }),
        })
        if (!urlRes.ok) throw new Error(`presigned URL ${urlRes.status}`)
        const urlData = await urlRes.json()
        if (!urlData.upload_url || !urlData.storage_path) {
          throw new Error('no upload URL in response')
        }

        const putRes = await fetch(urlData.upload_url, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        })
        if (!putRes.ok) throw new Error(`PUT ${putRes.status}`)

        uploadedFiles.push({ filename: file.name, storage_path: urlData.storage_path })
      } catch {
        failedToUpload.push(file.name)
      }
      done++
      setRetouchedProgress({ done, total: arr.length })
    }

    if (uploadedFiles.length === 0) {
      onError(
        failedToUpload.length > 0
          ? `Не удалось загрузить ни один файл (${failedToUpload.length})`
          : 'Не удалось загрузить файлы'
      )
      setUploadingRetouched(false)
      setRetouchedProgress({ done: 0, total: 0 })
      return
    }

    // Шаг 2: регистрация → матчинг + замена original_path.
    try {
      const res = await fetch('/api/workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'register_retouched',
          album_id: (album as any).id,
          files: uploadedFiles,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        onError(data.error || `Ошибка регистрации (HTTP ${res.status})`)
      } else {
        setRetouchedSummary({
          matched: data.matched ?? 0,
          unmatched_count: data.unmatched_count ?? 0,
          unmatched: data.unmatched ?? [],
          replaced: data.replaced ?? [],
        })
        const matched = data.matched ?? 0
        const unmatched = data.unmatched_count ?? 0
        onNotify(
          unmatched > 0
            ? `Обновлено ${matched} · ${unmatched} не найдено`
            : `Обновлено ${matched} оригиналов`
        )
      }
    } catch (e: any) {
      onError(e?.message || 'Ошибка регистрации')
    } finally {
      setUploadingRetouched(false)
      setRetouchedProgress({ done: 0, total: 0 })
    }
  }

  // Фаза К.5 — ручная привязка unmatched
  const ensureAlbumPhotos = async () => {
    if (albumPhotos !== null) return
    try {
      const sep = viewAsTenantId ? `&view_as=${viewAsTenantId}` : ''
      const res = await fetch(
        `/api/tenant?action=album_photos&album_id=${(album as any).id}${sep}`
      )
      const data = await res.json()
      const photos: { id: string; filename: string; type: string }[] = (data.photos ?? []).map(
        (p: any) => ({ id: p.id, filename: p.filename, type: p.type })
      )
      setAlbumPhotos(photos)
    } catch {
      setAlbumPhotos([])
    }
  }

  const handleRebindRetouched = async (storage_path: string) => {
    const photoId = rebindSelections[storage_path]
    if (!photoId) {
      onError('Сначала выберите фото из списка')
      return
    }
    setRebindingPaths((prev) => new Set(prev).add(storage_path))
    try {
      const res = await fetch('/api/workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'rebind_retouched',
          album_id: (album as any).id,
          photo_id: photoId,
          storage_path,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        onError(data.error || 'Не удалось привязать')
        return
      }
      // Убираем из unmatched, инкрементим matched
      setRetouchedSummary((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          matched: prev.matched + 1,
          unmatched_count: Math.max(0, prev.unmatched_count - 1),
          unmatched: prev.unmatched.filter((u) => u.storage_path !== storage_path),
        }
      })
      setRebindSelections((prev) => {
        const next = { ...prev }
        delete next[storage_path]
        return next
      })
      onNotify('Файл привязан к фото')
    } catch (e: any) {
      onError(e?.message || 'Ошибка привязки')
    } finally {
      setRebindingPaths((prev) => {
        const next = new Set(prev)
        next.delete(storage_path)
        return next
      })
    }
  }

  const handleDiscardRetouched = async (storage_path: string) => {
    if (!confirm('Удалить этот файл из системы?')) return
    setRebindingPaths((prev) => new Set(prev).add(storage_path))
    try {
      const res = await fetch('/api/workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'discard_retouched',
          album_id: (album as any).id,
          storage_path,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        onError(data.error || 'Не удалось удалить')
        return
      }
      setRetouchedSummary((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          unmatched_count: Math.max(0, prev.unmatched_count - 1),
          unmatched: prev.unmatched.filter((u) => u.storage_path !== storage_path),
        }
      })
      onNotify('Файл удалён')
    } catch (e: any) {
      onError(e?.message || 'Ошибка удаления')
    } finally {
      setRebindingPaths((prev) => {
        const next = new Set(prev)
        next.delete(storage_path)
        return next
      })
    }
  }

  // Резолв filename из datalist в photo_id (input value === filename)
  const resolvePhotoIdByFilename = (filename: string): string | undefined => {
    if (!albumPhotos) return undefined
    const match = albumPhotos.find((p) => p.filename === filename)
    return match?.id
  }

  const formatSize = (bytes: number) => {
    if (!bytes) return ''
    if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
    return `${Math.round(bytes / 1024)} КБ`
  }

  return (
    <div className="space-y-6">
      {/* Статус */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusInfo.color}`}>
            {statusInfo.label}
          </span>
          {workflow?.workflow_submitted_at && (
            <span className="text-xs text-gray-400">
              Передан {new Date(workflow.workflow_submitted_at).toLocaleDateString('ru-RU')}
            </span>
          )}
        </div>

        {/* Кнопки действий */}
        <div className="flex gap-2">
          {status === 'active' && canEdit && (
            <button className="btn-secondary text-sm" onClick={handleMarkReady}>
              <Check size={14} className="inline" /> Завершить отбор досрочно
            </button>
          )}
          {(status === 'active' || status === 'ready') && canEdit && (
            <button className="btn-primary text-sm" onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Передаём...' : <><Send size={16} /> Передать в OkeyBook</>}
            </button>
          )}
          {/* unsubmit: submitted → ready (партнёр + superadmin) */}
          {status === 'submitted' && canEdit && (
            <button
              className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700"
              onClick={handleUnsubmit}
            >
              ↩ Отменить передачу
            </button>
          )}
          {/* unsubmit: in_production → submitted (только superadmin) */}
          {status === 'in_production' && isSuperAdmin && (
            <button
              className="text-sm px-3 py-1.5 rounded-lg border border-orange-300 bg-orange-50 hover:bg-orange-100 text-orange-700"
              onClick={handleUnsubmit}
              title="Только для superadmin — отзывает альбом из вёрстки обратно в submitted"
            >
              ↩ Снять с работы
            </button>
          )}
        </div>
      </div>

      {/* Подсказка для партнёра когда альбом уже в работе */}
      {status === 'in_production' && canEdit && !isSuperAdmin && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
          <Info size={14} className="inline" /> Альбом уже взят в работу. Если нужно отменить — свяжитесь с OkeyBook.
        </div>
      )}

      {/* Заметки от OkeyBook */}
      {workflow?.workflow_notes && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          <p className="font-medium mb-1">Комментарий от OkeyBook:</p>
          <p>{workflow.workflow_notes}</p>
        </div>
      )}

      {/* Цветокор и ретушь (фаза К) ─────────────────────────────────────── */}
      {canEdit && (
        <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-4">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <h4 className="font-semibold text-gray-800">Цветокор и ретушь</h4>
              <p className="text-xs text-gray-500 mt-0.5">
                Скачайте оригиналы для обработки в Lightroom/Photoshop, затем загрузите
                обратно — система заменит фото в макете
              </p>
            </div>
            <button
              className="btn-secondary text-sm whitespace-nowrap"
              onClick={() => handleDownloadOriginalsZip()}
              disabled={downloadingOriginalsZip}
              title={
                includeUnselected
                  ? 'Скачать все оригиналы альбома (включая невыбранные)'
                  : 'Скачать оригиналы выбранных родителями фото + учителей + общего раздела'
              }
            >
              {downloadingOriginalsZip ? 'Собираем ZIP…' : <><Download size={16} /> Скачать оригиналы</>}
            </button>
          </div>

          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none mt-1">
            <input
              type="checkbox"
              checked={includeUnselected}
              onChange={(e) => setIncludeUnselected(e.target.checked)}
              className="w-3.5 h-3.5"
            />
            <span>
              Скачать также невыбранные фото
              <span className="text-gray-400 ml-1">
                (по умолчанию только выбранные родителями портреты и групповые; учителя и общий раздел всегда включены)
              </span>
            </span>
          </label>

          {/* Панель частичной выгрузки — показывается когда альбом слишком большой */}
          {bigAlbumOptions && (
            <div className="mt-3 p-3 bg-white border border-blue-200 rounded-lg space-y-2">
              <p className="text-sm text-gray-700">
                В альбоме <span className="font-medium">{bigAlbumOptions.total_count} фото</span> с
                оригиналами, это больше лимита одной выгрузки ({bigAlbumOptions.max_per_request}).
                Выберите категории для частичной выгрузки:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                {Object.entries(bigAlbumOptions.by_category)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([cat, count]) => {
                    const label =
                      cat === 'portrait' ? 'Портреты' :
                      cat === 'group' ? 'Групповые фото' :
                      cat === 'teacher' ? 'Учителя' :
                      cat === 'common_spread' ? 'Общий: на разворот' :
                      cat === 'common_full' ? 'Общий: фото класса' :
                      cat === 'common_half' ? 'Общий: полкласса' :
                      cat === 'common_quarter' ? 'Общий: 1/4 класса' :
                      cat === 'common_sixth' ? 'Общий: 1/6 класса' :
                      cat === 'common_collage' ? 'Общий: коллаж' :
                      cat
                    return (
                      <label
                        key={cat}
                        className="flex items-center gap-2 px-2 py-1 hover:bg-blue-50 rounded cursor-pointer text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={selectedCategories.has(cat)}
                          onChange={() => toggleCategory(cat)}
                        />
                        <span className="text-gray-700">{label}</span>
                        <span className="text-gray-400 text-xs ml-auto">{count}</span>
                      </label>
                    )
                  })}
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-blue-100">
                <span className="text-xs text-gray-500">
                  Выбрано: {selectedSum} из {bigAlbumOptions.total_count}
                  {selectedSum > bigAlbumOptions.max_per_request && (
                    <span className="text-red-500 ml-1">
                      — больше лимита ({bigAlbumOptions.max_per_request})
                    </span>
                  )}
                </span>
                <div className="flex gap-2">
                  <button
                    className="btn-secondary text-xs"
                    onClick={() => setBigAlbumOptions(null)}
                  >
                    Отмена
                  </button>
                  <button
                    className="btn-primary text-xs"
                    onClick={() => handleDownloadOriginalsZip(Array.from(selectedCategories))}
                    disabled={
                      downloadingOriginalsZip ||
                      selectedCategories.size === 0 ||
                      selectedSum > bigAlbumOptions.max_per_request
                    }
                  >
                    {downloadingOriginalsZip ? 'Собираем…' : 'Скачать выбранные'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Загрузка обработанных оригиналов (фаза К.4) */}
          <div className="mt-3 pt-3 border-t border-blue-100">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-gray-500 flex-1">
                После ретуши загрузите файлы обратно — система заменит оригиналы по имени файла.
                Имена должны совпадать с теми, что были в скачанном ZIP.
              </p>
              <label
                className={`btn-secondary text-sm cursor-pointer whitespace-nowrap ${
                  uploadingRetouched ? 'opacity-50 cursor-wait pointer-events-none' : ''
                }`}
              >
                <input
                  type="file"
                  className="hidden"
                  multiple
                  accept="image/jpeg,image/jpg,image/png,image/tiff"
                  onChange={(e) => {
                    if (e.target.files) handleUploadRetouched(e.target.files)
                    // Сброс input чтобы можно было выбрать те же файлы снова
                    e.target.value = ''
                  }}
                  disabled={uploadingRetouched}
                />
                {uploadingRetouched
                  ? `Загружаем ${retouchedProgress.done}/${retouchedProgress.total}…`
                  : <><Upload size={14} /> Загрузить обработанные</>}
              </label>
            </div>

            {uploadingRetouched && retouchedProgress.total > 0 && (
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden mt-2">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all"
                  style={{
                    width: `${
                      (retouchedProgress.done / retouchedProgress.total) * 100
                    }%`,
                  }}
                />
              </div>
            )}

            {retouchedSummary && (
              <div className="mt-3 space-y-2">
                {retouchedSummary.matched > 0 && (
                  <div className="p-2 bg-green-50 border border-green-200 rounded text-sm text-green-800 flex items-start justify-between gap-2">
                    <span>
                      <Check size={14} className="inline" /> Обновлено {retouchedSummary.matched} оригиналов — новые версии
                      будут использованы при следующем экспорте PDF
                    </span>
                    <button
                      className="text-green-700 hover:text-green-900 text-xs"
                      onClick={() => setRetouchedSummary(null)}
                      title="Скрыть"
                    >
                      ×
                    </button>
                  </div>
                )}
                {retouchedSummary.unmatched_count > 0 && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <span>
                        <AlertTriangle size={14} className="inline" /> Не найдено {retouchedSummary.unmatched_count} файлов — имена не
                        совпадают с оригиналами. Привяжите их вручную или удалите:
                      </span>
                      <button
                        className="text-amber-700 hover:text-amber-900 text-xs"
                        onClick={() => setRetouchedSummary(null)}
                        title="Скрыть"
                      >
                        ×
                      </button>
                    </div>
                    <datalist id={`album-photos-${(album as any).id}`}>
                      {(albumPhotos ?? []).map((p) => {
                        const typeLabel =
                          p.type === 'portrait' ? 'портрет' :
                          p.type === 'group' ? 'группа' :
                          p.type === 'teacher' ? 'учитель' :
                          p.type.startsWith('common_') ? 'общий' :
                          p.type
                        return (
                          <option key={p.id} value={p.filename}>
                            {typeLabel}
                          </option>
                        )
                      })}
                    </datalist>
                    <ul className="space-y-1.5 max-h-64 overflow-y-auto">
                      {retouchedSummary.unmatched.map((u) => {
                        const selectedFilename = rebindSelections[u.storage_path] ?? ''
                        const resolvedId = resolvePhotoIdByFilename(selectedFilename)
                        const isProcessing = rebindingPaths.has(u.storage_path)
                        return (
                          <li
                            key={u.storage_path}
                            className="flex items-center gap-2 bg-white border border-amber-100 rounded px-2 py-1.5"
                          >
                            <span className="text-xs text-gray-700 truncate flex-1 min-w-0" title={u.filename}>
                              {u.filename}
                            </span>
                            <span className="text-gray-400 text-xs">→</span>
                            <input
                              type="text"
                              list={`album-photos-${(album as any).id}`}
                              className="text-xs border border-gray-300 rounded px-2 py-0.5 flex-1 min-w-0"
                              placeholder="Начните вводить имя оригинала…"
                              value={selectedFilename}
                              onFocus={ensureAlbumPhotos}
                              onChange={(e) =>
                                setRebindSelections((prev) => ({
                                  ...prev,
                                  [u.storage_path]: e.target.value,
                                }))
                              }
                              disabled={isProcessing}
                            />
                            <button
                              className="text-xs px-2 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                              onClick={() => handleRebindRetouched(u.storage_path)}
                              disabled={!resolvedId || isProcessing}
                              title={resolvedId ? `Привязать к photo ${resolvedId.slice(0, 8)}` : 'Выберите фото из списка'}
                            >
                              {isProcessing ? '…' : 'Привязать'}
                            </button>
                            <button
                              className="text-xs px-1 text-gray-400 hover:text-red-500"
                              onClick={() => handleDiscardRetouched(u.storage_path)}
                              disabled={isProcessing}
                              title="Удалить файл"
                            >
                              <Trash2 size={16} />
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Оригинальные фото */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-semibold text-gray-800">
            Оригинальные фото
            {originals.length > 0 && <span className="text-gray-400 font-normal text-sm ml-2">{originals.length} файлов</span>}
          </h4>
          {canEdit && (
            <label className={`btn-secondary text-sm cursor-pointer ${uploadingOriginals ? 'opacity-50' : ''}`}>
              <input
                type="file"
                className="hidden"
                multiple
                accept="image/jpeg,image/jpg,image/png,image/tiff"
                onChange={e => e.target.files && handleUploadOriginals(e.target.files)}
                disabled={uploadingOriginals}
              />
              {uploadingOriginals
                ? `Загружаем ${uploadProgress.done}/${uploadProgress.total}...`
                : '+ Загрузить оригиналы'}
            </label>
          )}
        </div>

        {uploadingOriginals && (
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-3">
            <div
              className="h-full bg-blue-500 rounded-full transition-all"
              style={{ width: `${uploadProgress.total ? (uploadProgress.done / uploadProgress.total) * 100 : 0}%` }}
            />
          </div>
        )}

        {originals.length === 0 ? (
          <p className="text-sm text-gray-400">Оригиналы не загружены</p>
        ) : (
          <div className="space-y-1">
            {originals.map(o => (
              <div key={o.id} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg group">
                <div>
                  <span className="text-sm text-gray-800">{o.filename}</span>
                  {o.file_size && <span className="text-xs text-gray-400 ml-2">{formatSize(o.file_size)}</span>}
                </div>
                {canEdit && (
                  <button
                    className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 text-lg"
                    onClick={() => handleDeleteOriginal(o.id)}
                  >×</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Готовые файлы от OkeyBook */}
      {delivery.length > 0 && (
        <div>
          <h4 className="font-semibold text-gray-800 mb-3">
            Готовые файлы
            <span className="text-xs font-normal text-gray-400 ml-2">доступны для скачивания</span>
          </h4>
          <div className="space-y-2">
            {delivery.map(f => (
              <div key={f.id} className="flex items-center justify-between py-3 px-4 bg-green-50 border border-green-200 rounded-xl">
                <div>
                  <p className="text-sm font-medium text-gray-800">{f.label || f.filename}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {f.filename}
                    {f.file_size ? ` · ${formatSize(f.file_size)}` : ''}
                    {f.expires_at ? ` · до ${new Date(f.expires_at).toLocaleDateString('ru-RU')}` : ''}
                    {f.downloaded_at ? ' · скачан' : ''}
                  </p>
                </div>
                <button
                  className="btn-primary text-sm"
                  onClick={() => handleDownload(f)}
                >
                  <Download size={16} /> Скачать
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {status === 'submitted' && delivery.length === 0 && (
        <div className="bg-gray-50 rounded-xl p-6 text-center text-gray-400 text-sm">
          Альбом в очереди у OkeyBook. Файлы появятся здесь когда вёрстка будет готова.
        </div>
      )}
    </div>
  )
}

// ============================================================
// ПАРТНЁРСКИЙ ДАШБОРД — полноценный просмотр кабинета партнёра
// ============================================================

function PartnersDashboardModal({ onClose, onNotify, onError, originalsProgress, setOriginalsProgress }: {
  onClose: () => void
  onNotify: (msg: string) => void
  onError: (msg: string) => void
  originalsProgress: React.ComponentProps<typeof AlbumDetailModal>['originalsProgress']
  setOriginalsProgress: React.ComponentProps<typeof AlbumDetailModal>['setOriginalsProgress']
}) {
  const [tenants, setTenants] = useState<any[]>([])
  const [selectedTenant, setSelectedTenant] = useState<any | null>(null)
  const [dashboard, setDashboard] = useState<any | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null)
  const [backdropStart, setBackdropStart] = useState(false)
  const [search, setSearch] = useState('')

  const [showCreatePartner, setShowCreatePartner] = useState(false)

  const reloadTenants = () => {
    fetch('/api/tenant?action=partners_list')
      .then(r => r.json())
      .then(d => setTenants(d.tenants ?? []))
  }

  useEffect(() => { reloadTenants() }, [])

  const loadPartnerDashboard = async (tenant: any) => {
    setSelectedTenant(tenant)
    setLoading(true)
    setDashboard(null)
    setSelectedAlbum(null)
    try {
      // Используем тот же dashboard endpoint с view_as — получаем полные данные партнёра
      const res = await fetch(`/api/tenant?action=dashboard&view_as=${tenant.id}`)
      const data = await res.json()
      // childrenStats уже включены в albums[].stats
      setDashboard(data)
    } finally {
      setLoading(false)
    }
  }

  const filtered = tenants.filter(t =>
    !search || t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.city?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-6 pb-6 px-4 overflow-y-auto"
      onMouseDown={e => { if (e.target === e.currentTarget) setBackdropStart(true) }}
      onMouseUp={e => { if (backdropStart && e.target === e.currentTarget) onClose(); setBackdropStart(false) }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-7xl min-h-[80vh] flex flex-col">
        {/* Шапка */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
              <Camera size={16} /> Партнёры
            </h2>
            <button
              onClick={() => setShowCreatePartner(true)}
              className="btn-primary text-sm px-3 py-1.5"
            >
              + Партнёр
            </button>
          </div>
            {selectedTenant && (
              <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1">
                <span className="text-xs text-amber-700">Просматриваете как:</span>
                <span className="text-sm font-semibold text-amber-900">{selectedTenant.name}</span>
                <button
                  onClick={() => { setSelectedTenant(null); setDashboard(null) }}
                  className="text-amber-400 hover:text-amber-700 ml-1 text-xs"
                >×</button>
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Список партнёров */}
          <div className="w-56 border-r border-gray-100 flex flex-col flex-shrink-0">
            <div className="p-3 border-b border-gray-50">
              <input className="input w-full text-sm" placeholder="Поиск..."
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="flex-1 overflow-y-auto">
              {filtered.map(t => (
                <button
                  key={t.id}
                  onClick={() => loadPartnerDashboard(t)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors ${
                    selectedTenant?.id === t.id ? 'bg-gray-50 border-l-2 border-l-gray-900' : ''
                  }`}
                >
                  <p className="text-sm font-medium text-gray-900 truncate">{t.name}</p>
                  {t.city && <p className="text-xs text-gray-400">{t.city}</p>}
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-8">Нет партнёров</p>
              )}
            </div>
          </div>

          {/* Дашборд партнёра */}
          <div className="flex-1 overflow-y-auto p-6">
            {!selectedTenant && (
              <div className="flex items-center justify-center h-full text-gray-300">
                Выберите партнёра слева
              </div>
            )}
            {selectedTenant && loading && (
              <div className="flex items-center justify-center h-full text-gray-400">
                Загрузка...
              </div>
            )}
            {selectedTenant && dashboard && !loading && (
              <PartnerDashboardContent
                tenant={selectedTenant}
                dashboard={dashboard}
                onOpenAlbum={setSelectedAlbum}
                onNotify={onNotify}
                onError={onError}
              />
            )}
          </div>
        </div>
      </div>

      {/* Модалка альбома партнёра — передаём view_as для загрузки данных партнёра */}
      {selectedAlbum && selectedTenant && (
        <AlbumDetailModal
          album={selectedAlbum}
          canEdit={true}
          onClose={() => setSelectedAlbum(null)}
          onNotify={onNotify}
          onError={onError}
          viewAsTenantId={selectedTenant.id}
          originalsProgress={originalsProgress}
          setOriginalsProgress={setOriginalsProgress}
        />
      )}

      {/* Создание нового партнёра */}
      {showCreatePartner && (
        <CreatePartnerModal
          onClose={() => setShowCreatePartner(false)}
          onSuccess={(tenant) => {
            reloadTenants()
            setShowCreatePartner(false)
            onNotify(`Партнёр «${tenant.name}» создан`)
          }}
        />
      )}
    </div>
  )
}

function PartnerDashboardContent({ tenant, dashboard, onOpenAlbum, onNotify, onError }: {
  tenant: any
  dashboard: any
  onOpenAlbum: (album: Album) => void
  onNotify: (msg: string) => void
  onError: (msg: string) => void
}) {
  const albums: Album[] = dashboard.albums ?? []
  const active = albums.filter(a => !a.archived)

  // Статистика уже в albums[].stats (из dashboard endpoint)
  const summary = dashboard.summary ?? {}
  const totalChildren = summary.children_total ?? 0
  const submittedCount = summary.children_submitted ?? 0
  const inProgressCount = active.reduce((s: number, a: any) => s + (a.stats?.in_progress ?? 0), 0)

  const getAlbumStats = (album: any) => {
    const s = album.stats ?? {}
    const total = s.total ?? 0
    const submitted = s.submitted ?? 0
    const inProgress = s.in_progress ?? 0
    return { total, submitted, inProgress, pct: total ? Math.round(submitted / total * 100) : 0 }
  }

  return (
    <div>
      {/* Шапка партнёра */}
      <div className="mb-6">
        <h3 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>{tenant.name}</h3>
        {tenant.city && <p className="text-gray-500 text-sm">{tenant.city}</p>}
      </div>

      {/* Сводные карточки */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="card p-4">
          <p className="text-xs text-gray-500 mb-1">Активных альбомов</p>
          <p className="text-2xl font-bold">{active.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500 mb-1">Учеников</p>
          <p className="text-2xl font-bold">{totalChildren}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500 mb-1">Завершили выбор</p>
          <p className="text-2xl font-bold text-green-600">
            {submittedCount}
            {totalChildren > 0 && <span className="text-sm font-normal text-gray-400 ml-1">{Math.round(submittedCount / totalChildren * 100)}%</span>}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500 mb-1">В процессе</p>
          <p className="text-2xl font-bold text-blue-500">{inProgressCount}</p>
        </div>
      </div>

      {/* Карточки альбомов */}
      {active.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-12">Нет активных альбомов</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {active.map(album => {
            const stats = getAlbumStats(album.id)
            return (
              <button
                key={album.id}
                onClick={() => onOpenAlbum(album)}
                className="card p-4 text-left hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-semibold text-gray-900">{album.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {album.city && `${album.city} · `}{album.year}
                      {(album as any).classes && ` · ${(album as any).classes}`}
                    </p>
                    {(album as any).template_title && (
                      <p className="text-xs text-gray-400">{(album as any).template_title}</p>
                    )}
                  </div>
                  <span className={`text-sm font-bold ${
                    stats.pct === 100 ? 'text-green-600' : 'text-gray-700'
                  }`}>{stats.pct}%</span>
                </div>

                {/* Прогресс-бар */}
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-2">
                  <div
                    className="h-full bg-green-500 rounded-full"
                    style={{ width: `${stats.pct}%` }}
                  />
                </div>

                <p className="text-xs text-gray-400">
                  {stats.submitted} из {stats.total} учеников
                  {stats.inProgress > 0 && (
                    <span className="ml-2 text-blue-400">{stats.inProgress} в процессе</span>
                  )}
                </p>

                {/* Статус производства */}
                {(album as any).workflow_status && (album as any).workflow_status !== 'active' && (
                  <div className="mt-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      (album as any).workflow_status === 'delivered' ? 'bg-green-100 text-green-700' :
                      (album as any).workflow_status === 'in_production' ? 'bg-amber-100 text-amber-700' :
                      'bg-purple-100 text-purple-700'
                    }`}>
                      {(album as any).workflow_status === 'ready' ? <><span className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1.5 align-middle" />Готов к передаче</> :
                       (album as any).workflow_status === 'submitted' ? <><span className="inline-block w-2 h-2 rounded-full bg-violet-500 mr-1.5 align-middle" />Передан в OkeyBook</> :
                       (album as any).workflow_status === 'in_production' ? <><span className="inline-block w-2 h-2 rounded-full bg-orange-500 mr-1.5 align-middle" />В работе</> :
                       <><span className="inline-block w-2 h-2 rounded-full bg-brand-500 mr-1.5 align-middle" />Готов</>}
                    </span>
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ============================================================
// СОЗДАНИЕ ПАРТНЁРА (полная форма = Новый арендатор из /super)
// ============================================================

function CreatePartnerModal({ onClose, onSuccess }: {
  onClose: () => void
  onSuccess: (tenant: { name: string }) => void
}) {
  const PLANS = [
    { value: 'basic', label: 'Basic — 30 альбомов, 20GB' },
    { value: 'pro', label: 'Pro — 100 альбомов, 100GB' },
    { value: 'unlimited', label: 'Unlimited — без ограничений' },
  ]

  const [form, setForm] = useState({
    name: '', slug: '', city: '', email: '', phone: '',
    plan: 'basic', max_albums: '30',
    owner_name: '', owner_email: '', owner_password: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [backdropStart, setBackdropStart] = useState(false)

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  // Автогенерация slug из названия
  const handleNameChange = (v: string) => {
    set('name', v)
    const auto = v.toLowerCase()
      .replace(/[аa]/g, 'a').replace(/[бb]/g, 'b').replace(/[вv]/g, 'v')
      .replace(/[гg]/g, 'g').replace(/[дd]/g, 'd').replace(/[еe]/g, 'e')
      .replace(/[её]/g, 'e').replace(/[жzh]/g, 'zh').replace(/[зz]/g, 'z')
      .replace(/[иi]/g, 'i').replace(/[йy]/g, 'y').replace(/[кk]/g, 'k')
      .replace(/[лl]/g, 'l').replace(/[мm]/g, 'm').replace(/[нn]/g, 'n')
      .replace(/[оo]/g, 'o').replace(/[пp]/g, 'p').replace(/[рr]/g, 'r')
      .replace(/[сs]/g, 's').replace(/[тt]/g, 't').replace(/[уu]/g, 'u')
      .replace(/[фf]/g, 'f').replace(/[хkh]/g, 'kh').replace(/[цts]/g, 'ts')
      .replace(/[чch]/g, 'ch').replace(/[шsh]/g, 'sh').replace(/[щsh]/g, 'sh')
      .replace(/[ъь]/g, '').replace(/[ыy]/g, 'y').replace(/[эe]/g, 'e')
      .replace(/[юyu]/g, 'yu').replace(/[яya]/g, 'ya')
      .replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
      .slice(0, 30)
    set('slug', auto)
  }

  const generatePassword = () => {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#'
    set('owner_password', Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''))
  }

  const handleSubmit = async () => {
    if (!form.name || !form.slug || !form.owner_name || !form.owner_email || !form.owner_password) {
      setError('Заполните все обязательные поля')
      return
    }
    if (form.owner_password.length < 8) {
      setError('Пароль минимум 8 символов')
      return
    }
    setLoading(true)
    setError('')
    const res = await fetch('/api/super', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_tenant',
        name: form.name,
        slug: form.slug,
        city: form.city,
        email: form.email,
        phone: form.phone,
        plan: form.plan,
        max_albums: parseInt(form.max_albums) || 30,
        owner_full_name: form.owner_name,
        owner_email: form.owner_email,
        owner_password: form.owner_password,
        assign_manager_after_create: true,
      }),
    })
    const data = await res.json()
    setLoading(false)
    if (data.tenant) {
      onSuccess(data.tenant)
    } else {
      setError(data.error ?? 'Ошибка создания')
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 overflow-y-auto"
      onMouseDown={e => { if (e.target === e.currentTarget) setBackdropStart(true) }}
      onMouseUp={e => { if (backdropStart && e.target === e.currentTarget) onClose(); setBackdropStart(false) }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 my-4">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold">Новый партнёр</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        {error && <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3 mb-4">{error}</div>}

        <div className="space-y-4">
          {/* Данные тенанта */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Арендатор</p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Название <span className="text-red-500">*</span></label>
                <input className="input w-full" placeholder="Фотостудия Солнышко"
                  value={form.name} onChange={e => handleNameChange(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Slug (для URL) <span className="text-red-500">*</span></label>
                <input className="input w-full" placeholder="solnyshko"
                  value={form.slug} onChange={e => set('slug', e.target.value)} />
                <p className="text-xs text-gray-400 mt-1">Латинские буквы, цифры, дефис. Генерируется автоматически.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Тариф</label>
                  <select className="input w-full" value={form.plan} onChange={e => set('plan', e.target.value)}>
                    {PLANS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Город</label>
                  <input className="input w-full" placeholder="Москва"
                    value={form.city} onChange={e => set('city', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Email арендатора</label>
                  <input className="input w-full" type="email" placeholder="contact@studio.ru"
                    value={form.email} onChange={e => set('email', e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Телефон</label>
                  <input className="input w-full" placeholder="+7 999 999-99-99"
                    value={form.phone} onChange={e => set('phone', e.target.value)} />
                </div>
              </div>
            </div>
          </div>

          {/* Владелец аккаунта */}
          <div className="border-t border-gray-100 pt-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Владелец аккаунта</p>
            <p className="text-xs text-gray-400 mb-3">Получит роль owner и сможет управлять арендатором.</p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">ФИО <span className="text-red-500">*</span></label>
                <input className="input w-full" placeholder="Иванов Иван Иванович"
                  value={form.owner_name} onChange={e => set('owner_name', e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Email для входа <span className="text-red-500">*</span></label>
                <input className="input w-full" type="email" placeholder="ivan@studio.ru"
                  value={form.owner_email} onChange={e => set('owner_email', e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Пароль <span className="text-red-500">*</span></label>
                <div className="flex gap-2">
                  <input className="input flex-1" placeholder="Минимум 8 символов"
                    value={form.owner_password} onChange={e => set('owner_password', e.target.value)} />
                  <button type="button" onClick={generatePassword} className="btn-secondary text-sm whitespace-nowrap">
                    Сгенерировать
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1">Передайте пароль владельцу.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={handleSubmit} disabled={loading} className="btn-primary flex-1">
            {loading ? 'Создаём...' : 'Создать партнёра'}
          </button>
          <button onClick={onClose} className="btn-secondary">Отмена</button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// РЭ.21.3: PresetsModal — просмотр пресетов rule engine
// ============================================================
// Список пресетов из таблицы `presets` (новая, для rule engine).
// Показывает структуру альбома в человеко-читаемом виде. Только просмотр —
// редактирование добавим следующим шагом, когда поймём что хотим менять.
//
// ВАЖНО: в системе ДВЕ таблицы пресетов:
//   - config_presets — legacy движок
//   - presets — rule engine + section_structure (РЭ.21)
// Этот модал показывает только `presets`.

type RulePresetRow = {
  id: string
  display_name: string
  print_type: string | null
  density: string | null
  sheet_type: string | null
  min_pages: number | null
  max_pages: number | null
  template_set_id: string | null
  section_structure: SectionStructureEntry[] | null
  tenant_id: string | null
  version: string | null
}

// РЭ.21.6.3: минимальный тип template_set'а для UI селекта в форме
// создания пресета. GET /api/layout?action=template_sets возвращает
// больше полей, но нам нужны только эти.
type TemplateSetRow = {
  id: string
  name: string
  slug: string | null
  is_global: boolean
  tenant_id: string | null
}

type SectionStructureEntry =
  | { type: 'soft_intro' | 'teachers' | 'students' | 'vignette' | 'soft_final' }
  | { type: 'common'; slots: string[] }

// РЭ.21.7.3: справочники типов секций и слотов для UI редактора.
// Должны совпадать с серверным валидатором (validateSectionStructure)
// в app/api/tenant/route.ts.
const SECTION_TYPE_LABELS: Record<SectionStructureEntry['type'], string> = {
  soft_intro: 'Вступительная страница (мягкие)',
  teachers: 'Учителя',
  students: 'Портреты учеников',
  common: 'Общий раздел',
  vignette: 'Виньетка детских фото',
  soft_final: 'Финальная страница (мягкие)',
}
const SECTION_TYPE_ORDER: SectionStructureEntry['type'][] = [
  'soft_intro', 'teachers', 'students', 'common', 'vignette', 'soft_final',
]
const SLOT_LABELS: Record<string, string> = {
  H: 'H (полкласса)',
  Q: 'Q (четверть)',
  FULL: 'FULL (общее фото)',
  flex_A: 'flex_A (крупный приоритет)',
  flex_B: 'flex_B (всё попробовать)',
  flex_C: 'flex_C (правая нечётная)',
}
const SLOT_TYPE_ORDER: string[] = ['H', 'Q', 'FULL', 'flex_A', 'flex_B', 'flex_C']

// РЭ.21.7.5.2: справочник density (плотности портретов).
// Whitelist синхронизирован с серверным валидатором validateDensity
// в app/api/tenant/route.ts и с PresetDensity в lib/rule-engine/types.ts.
// null = «по умолчанию» — означает «не задано», build engine упадёт на
// фолбэк (sub-density выбирается алгоритмом или используется без него).
type PresetDensityValue = 'standard' | 'universal' | 'medium' | 'light' | 'mini'
const DENSITY_LABELS: Record<PresetDensityValue, string> = {
  standard: 'Стандарт',
  universal: 'Универсал',
  medium: 'Медиум',
  light: 'Лайт',
  mini: 'Мини',
}
const DENSITY_ORDER: PresetDensityValue[] = [
  'standard', 'universal', 'medium', 'light', 'mini',
]

// Создание новой секции по типу. Для common — пустой массив слотов
// (партнёр добавляет слоты в редакторе 21.7.4).
function makeSection(type: SectionStructureEntry['type']): SectionStructureEntry {
  if (type === 'common') return { type: 'common', slots: [] }
  return { type }
}

// РЭ.21.7.3: drag-and-drop редактор секций пресета. Используется в
// PresetForm в обоих режимах (create и edit). Снаружи получает sections +
// onChange — родитель хранит state и шлёт в submit. Редактирование слотов
// внутри common будет в РЭ.21.7.4 (сейчас слоты read-only с подсказкой).
//
// РЭ.21.7.5.2: density + onDensityChange — параметр секции students.
// На уровне БД density атрибут пресета, но UX подаёт его как параметр
// секции (см. комментарий в server-side validateDensity). При наличии
// нескольких секций students все они показывают одно значение density
// и любая из них может его менять.
function SectionEditor({
  sections,
  onChange,
  density,
  onDensityChange,
  disabled,
}: {
  sections: SectionStructureEntry[]
  onChange: (next: SectionStructureEntry[]) => void
  /** Текущая плотность пресета. null = «по умолчанию» (не задано). */
  density: PresetDensityValue | null
  onDensityChange: (next: PresetDensityValue | null) => void
  disabled?: boolean
}) {
  // DnD id'ы стабильны на время сессии — не используем sections[i].type
  // как ключ (дубликаты разрешены, поэтому нужен синтетический id).
  // Простейший вариант: index в строке. При reorder обновляем массив,
  // ключи пересоздаются — это ок, элементов мало.
  const items = sections.map((_, i) => `s-${i}`)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  )

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIdx = items.indexOf(String(active.id))
    const newIdx = items.indexOf(String(over.id))
    if (oldIdx < 0 || newIdx < 0) return
    onChange(arrayMove(sections, oldIdx, newIdx))
  }

  const removeAt = (i: number) => {
    onChange(sections.filter((_, idx) => idx !== i))
  }
  const addSection = (type: SectionStructureEntry['type']) => {
    onChange([...sections, makeSection(type)])
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-sm font-medium text-gray-700">
          Структура секций
        </label>
        {!disabled && (
          <AddSectionButton onPick={addSection} />
        )}
      </div>

      {sections.length === 0 ? (
        <div className="text-xs text-gray-400 italic border border-dashed rounded-md p-3">
          Секций нет. Добавьте хотя бы «Портреты учеников» — без них альбом
          собирать нечего.
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={items} strategy={verticalListSortingStrategy}>
            <ol className="space-y-1.5">
              {sections.map((section, i) => (
                <SortableSectionItem
                  key={items[i]}
                  id={items[i]}
                  index={i}
                  section={section}
                  onRemove={() => removeAt(i)}
                  onSlotsChange={
                    section.type === 'common'
                      ? (nextSlots) =>
                          onChange(
                            sections.map((s, j) =>
                              j === i ? { type: 'common', slots: nextSlots } : s,
                            ),
                          )
                      : undefined
                  }
                  density={section.type === 'students' ? density : undefined}
                  onDensityChange={
                    section.type === 'students' ? onDensityChange : undefined
                  }
                  disabled={disabled}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}

      <div className="text-xs text-gray-500 italic mt-2">
        Перетаскивайте секции для изменения порядка. Внутри «Общего раздела»
        можно так же редактировать слоты.
      </div>
    </div>
  )
}

function SortableSectionItem({
  id,
  index,
  section,
  onRemove,
  onSlotsChange,
  density,
  onDensityChange,
  disabled,
}: {
  id: string
  index: number
  section: SectionStructureEntry
  onRemove: () => void
  /** Только для common-секций. Игнорируется для остальных. */
  onSlotsChange?: (next: string[]) => void
  /** Только для students-секций. Текущая плотность пресета. */
  density?: PresetDensityValue | null
  /** Только для students-секций. Изменяет density пресета. */
  onDensityChange?: (next: PresetDensityValue | null) => void
  disabled?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const label = SECTION_TYPE_LABELS[section.type] ?? section.type

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-start gap-2 bg-white border rounded-md px-2 py-2"
    >
      {/* Drag handle — отдельная зона, чтобы клик по «удалить» не цеплял drag */}
      <button
        type="button"
        className="text-gray-400 hover:text-gray-700 cursor-grab active:cursor-grabbing px-1 select-none"
        aria-label="Перетащить"
        {...attributes}
        {...listeners}
      >
        ⋮⋮
      </button>
      <span className="text-gray-400 font-mono text-xs w-5 shrink-0 pt-1">
        {index + 1}.
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-medium text-sm">{label}</div>
        {section.type === 'common' && (
          // РЭ.21.7.4: вложенный редактор слотов с собственным DndContext.
          // Внешний DndContext (секций) и внутренний (слотов) работают
          // независимо — события привязаны к ближайшему контексту через
          // React Context @dnd-kit.
          <SlotEditor
            slots={section.slots}
            onChange={(next) => onSlotsChange?.(next)}
            disabled={disabled}
          />
        )}
        {section.type === 'students' && onDensityChange && (
          // РЭ.21.7.5.2: параметр density показан внутри карточки секции
          // students. Хранится физически в preset.density (одно значение на
          // пресет, см. validateDensity на сервере). Если в structure есть
          // несколько секций students — все они показывают одно значение
          // и любая может его менять.
          <DensityPicker
            density={density ?? null}
            onChange={onDensityChange}
            disabled={disabled}
          />
        )}
      </div>
      {!disabled && (
        <button
          type="button"
          onClick={onRemove}
          className="text-gray-400 hover:text-red-600 text-sm shrink-0 px-1"
          aria-label="Удалить секцию"
        >
          ×
        </button>
      )}
    </li>
  )
}

// РЭ.21.7.5.2: компактный dropdown плотности портретов внутри секции
// students. Шесть опций: «По умолчанию» (null) + 5 значений из
// PresetDensityValue.
function DensityPicker({
  density,
  onChange,
  disabled,
}: {
  density: PresetDensityValue | null
  onChange: (next: PresetDensityValue | null) => void
  disabled?: boolean
}) {
  return (
    <div className="mt-2 flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-md px-2 py-1.5">
      <span className="text-xs text-gray-600 shrink-0">Плотность</span>
      <select
        value={density ?? ''}
        onChange={(e) => {
          const v = e.target.value
          onChange(v === '' ? null : (v as PresetDensityValue))
        }}
        disabled={disabled}
        className="text-xs px-2 py-1 border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
        aria-label="Плотность портретов"
      >
        <option value="">по умолчанию</option>
        {DENSITY_ORDER.map((d) => (
          <option key={d} value={d}>
            {DENSITY_LABELS[d]}
          </option>
        ))}
      </select>
    </div>
  )
}

// РЭ.21.7.4: редактор слотов внутри common-секции. DnD-список с
// поддержкой добавления/удаления.
function SlotEditor({
  slots,
  onChange,
  disabled,
}: {
  slots: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
}) {
  const items = slots.map((_, i) => `slot-${i}`)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  )

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIdx = items.indexOf(String(active.id))
    const newIdx = items.indexOf(String(over.id))
    if (oldIdx < 0 || newIdx < 0) return
    onChange(arrayMove(slots, oldIdx, newIdx))
  }

  const removeAt = (i: number) => {
    onChange(slots.filter((_, idx) => idx !== i))
  }
  const addSlot = (slot: string) => {
    onChange([...slots, slot])
  }

  return (
    <div className="mt-1.5">
      {slots.length === 0 ? (
        <div className="text-xs text-gray-400 italic mb-1.5">
          Слотов пока нет — общий раздел не будет генерироваться.
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={items} strategy={verticalListSortingStrategy}>
            <ol className="space-y-1">
              {slots.map((slot, i) => (
                <SortableSlotItem
                  key={items[i]}
                  id={items[i]}
                  slot={slot}
                  onRemove={() => removeAt(i)}
                  disabled={disabled}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
      {!disabled && (
        <div className="mt-1.5">
          <AddSlotButton onPick={addSlot} />
        </div>
      )}
    </div>
  )
}

function SortableSlotItem({
  id,
  slot,
  onRemove,
  disabled,
}: {
  id: string
  slot: string
  onRemove: () => void
  disabled?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded px-1.5 py-1"
    >
      <button
        type="button"
        className="text-gray-400 hover:text-gray-700 cursor-grab active:cursor-grabbing select-none text-xs"
        aria-label="Перетащить слот"
        {...attributes}
        {...listeners}
      >
        ⋮
      </button>
      <span className="text-xs text-gray-700 flex-1">
        {SLOT_LABELS[slot] ?? slot}
      </span>
      {!disabled && (
        <button
          type="button"
          onClick={onRemove}
          className="text-gray-400 hover:text-red-600 text-xs shrink-0 px-1"
          aria-label="Удалить слот"
        >
          ×
        </button>
      )}
    </li>
  )
}

function AddSlotButton({
  onPick,
}: {
  onPick: (slot: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs px-2 py-0.5 border border-gray-300 rounded text-gray-700 hover:bg-gray-100"
      >
        + Слот
      </button>
      {open && (
        <div className="absolute left-0 mt-1 z-10 bg-white border border-gray-200 rounded-md shadow-md py-1 min-w-[220px]">
          {SLOT_TYPE_ORDER.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                onPick(s)
                setOpen(false)
              }}
              className="block w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100"
            >
              {SLOT_LABELS[s] ?? s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function AddSectionButton({
  onPick,
}: {
  onPick: (type: SectionStructureEntry['type']) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  // Закрываем dropdown по клику вне.
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs px-2 py-1 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
      >
        + Секция
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-10 bg-white border border-gray-200 rounded-md shadow-md py-1 min-w-[220px]">
          {SECTION_TYPE_ORDER.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                onPick(t)
                setOpen(false)
              }}
              className="block w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100"
            >
              {SECTION_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function PresetsModal({
  onClose,
  onError,
}: {
  onClose: () => void
  onError: (msg: string) => void
}) {
  const [presets, setPresets] = useState<RulePresetRow[]>([])
  const [templateSets, setTemplateSets] = useState<TemplateSetRow[]>([])
  const [loading, setLoading] = useState(true)
  const [backdropStart, setBackdropStart] = useState(false)
  const [showCreate, setShowCreate] = useState(false)

  const handleBackdropMouseDown = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) setBackdropStart(true)
  }
  const handleBackdropMouseUp = (e: React.MouseEvent) => {
    if (backdropStart && e.target === e.currentTarget) onClose()
    setBackdropStart(false)
  }

  const load = async () => {
    setLoading(true)
    // Параллельно: список пресетов + список доступных template_sets.
    // Второй список нужен и для формы создания (селект «Дизайн»),
    // и для карточек (показать название дизайна по uuid).
    const [presetsRes, templateSetsRes] = await Promise.all([
      api('/api/tenant?action=rule_presets_list'),
      api('/api/layout?action=template_sets'),
    ])
    if (presetsRes.ok) {
      const d = await presetsRes.json()
      setPresets(Array.isArray(d.presets) ? d.presets : [])
    } else {
      onError('Не удалось загрузить пресеты')
    }
    if (templateSetsRes.ok) {
      const d = await templateSetsRes.json()
      // GET /api/layout возвращает массив напрямую (не {template_sets: [...]}).
      setTemplateSets(Array.isArray(d) ? d : [])
    } else {
      // Не критично — форма деградирует на «По умолчанию», карточки
      // покажут uuid как fallback. Молча, не зовём onError.
    }
    setLoading(false)
  }

  useEffect(() => {
    load().catch(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onMouseDown={handleBackdropMouseDown}
      onMouseUp={handleBackdropMouseUp}
    >
      <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">Пресеты вёрстки</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Структура альбома для нового движка сборки. Редактирование структуры появится в следующих обновлениях.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!showCreate && (
              <button
                onClick={() => setShowCreate(true)}
                className="btn-primary text-sm"
                type="button"
              >
                + Новый пресет
              </button>
            )}
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-700 text-2xl leading-none"
              type="button"
              aria-label="Закрыть"
            >
              ×
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {showCreate && (
            <PresetForm
              mode="create"
              templateSets={templateSets}
              onCancel={() => setShowCreate(false)}
              onSaved={async () => {
                setShowCreate(false)
                await load()
              }}
              onError={onError}
            />
          )}
          {loading ? (
            <div className="text-gray-500 text-sm">Загрузка…</div>
          ) : presets.length === 0 ? (
            <div className="text-gray-500 text-sm">Пресетов пока нет.</div>
          ) : (
            <div className="space-y-4">
              {presets.map((p) => (
                <PresetCard
                  key={p.id}
                  preset={p}
                  templateSets={templateSets}
                  onSaved={load}
                  onError={onError}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// РЭ.21.7.2: обобщённая форма пресета. mode='create' — пустые поля,
// POST rule_preset_create. mode='edit' — предзаполнение из existing,
// POST rule_preset_update с partial-патчем.
function PresetForm({
  mode,
  existing,
  templateSets,
  onCancel,
  onSaved,
  onError,
}: {
  mode: 'create' | 'edit'
  /** В режиме edit — пресет для редактирования. В create — undefined. */
  existing?: RulePresetRow
  templateSets: TemplateSetRow[]
  onCancel: () => void
  onSaved: () => void | Promise<void>
  onError: (msg: string) => void
}) {
  const [displayName, setDisplayName] = useState(existing?.display_name ?? '')
  const [printType, setPrintType] = useState<'layflat' | 'soft'>(
    existing?.print_type === 'soft' ? 'soft' : 'layflat',
  )
  const [minPages, setMinPages] = useState(existing?.min_pages ?? 24)
  const [maxPages, setMaxPages] = useState(existing?.max_pages ?? 24)
  // РЭ.21.6.3: '' = «По умолчанию (okeybook-default)», отправляем null.
  // uuid = конкретный template_set из списка.
  const [templateSetId, setTemplateSetId] = useState<string>(existing?.template_set_id ?? '')
  // РЭ.21.7.3: структура секций.
  // В режиме edit берём из existing (если NULL — пустой массив).
  // В create — серверный default (синхронизирован с rule_preset_create).
  const [sections, setSections] = useState<SectionStructureEntry[]>(() => {
    if (mode === 'edit') return existing?.section_structure ?? []
    return [
      { type: 'soft_intro' },
      { type: 'teachers' },
      { type: 'students' },
      { type: 'common', slots: ['H', 'flex_A', 'flex_A', 'flex_B'] },
      { type: 'soft_final' },
    ]
  })
  // РЭ.21.7.5.2: density — параметр секции students в UI, физически
  // preset.density. Нормализуем existing.density через whitelist — если
  // в БД лежит мусорное значение (например, старый 'maximum' до РЭ.20.5),
  // показываем «по умолчанию» вместо падения.
  const [density, setDensity] = useState<PresetDensityValue | null>(() => {
    const v = existing?.density
    if (v && DENSITY_ORDER.includes(v as PresetDensityValue)) {
      return v as PresetDensityValue
    }
    return null
  })
  const [busy, setBusy] = useState(false)

  const rangeError =
    minPages < 1 || maxPages < 1 || minPages > 200 || maxPages > 200
      ? 'Страницы от 1 до 200'
      : minPages > maxPages
        ? 'Минимум не может быть больше максимума'
        : null

  const submit = async () => {
    const name = displayName.trim()
    if (!name) {
      onError('Введите название')
      return
    }
    if (rangeError) {
      onError(rangeError)
      return
    }
    setBusy(true)
    // В режиме edit отправляем все поля (server-side patch отфильтрует
    // через partial-логику — undefined-поля не обновляются). Так проще,
    // чем диффить — а для UI это всё равно одна форма, все поля
    // потенциально изменены.
    const body =
      mode === 'create'
        ? {
            action: 'rule_preset_create',
            display_name: name,
            print_type: printType,
            min_pages: minPages,
            max_pages: maxPages,
            template_set_id: templateSetId || null,
            section_structure: sections,
            density: density,
          }
        : {
            action: 'rule_preset_update',
            preset_id: existing!.id,
            display_name: name,
            print_type: printType,
            min_pages: minPages,
            max_pages: maxPages,
            template_set_id: templateSetId || null,
            section_structure: sections,
            density: density,
          }
    const r = await api('/api/tenant', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    setBusy(false)
    if (!r.ok) {
      const d = await r.json().catch(() => ({}))
      onError(d?.error ?? (mode === 'create' ? 'Не удалось создать пресет' : 'Не удалось сохранить'))
      return
    }
    await onSaved()
  }

  return (
    <div className="mb-6 border-2 border-blue-200 rounded-xl p-5 bg-blue-50/40">
      <h3 className="text-base font-semibold mb-4">
        {mode === 'create' ? 'Новый пресет' : 'Редактирование пресета'}
      </h3>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Название
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
            placeholder="Например: Мой пресет для школ"
            autoFocus
            disabled={busy}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Тип печати
          </label>
          <div className="flex gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="print_type"
                value="layflat"
                checked={printType === 'layflat'}
                onChange={() => setPrintType('layflat')}
                disabled={busy}
              />
              <span className="text-sm">Layflat (плотные листы)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="print_type"
                value="soft"
                checked={printType === 'soft'}
                onChange={() => setPrintType('soft')}
                disabled={busy}
              />
              <span className="text-sm">Soft (мягкие листы)</span>
            </label>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Дизайн
          </label>
          <select
            value={templateSetId}
            onChange={(e) => setTemplateSetId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
            disabled={busy || templateSets.length === 0}
          >
            <option value="">По умолчанию (okeybook-default)</option>
            {templateSets.map((ts) => (
              <option key={ts.id} value={ts.id}>
                {ts.name}
                {ts.is_global ? ' (глобальный)' : ''}
              </option>
            ))}
          </select>
          <div className="text-xs text-gray-500 mt-1">
            Набор шаблонов (мастеров), по которым будет вёрстаться альбом.
            Оставьте «По умолчанию», если не уверены.
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Диапазон страниц
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={200}
              value={minPages}
              onChange={(e) => setMinPages(Number(e.target.value) || 0)}
              className="w-24 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
              disabled={busy}
              aria-label="Минимум страниц"
            />
            <span className="text-gray-400">–</span>
            <input
              type="number"
              min={1}
              max={200}
              value={maxPages}
              onChange={(e) => setMaxPages(Number(e.target.value) || 0)}
              className="w-24 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
              disabled={busy}
              aria-label="Максимум страниц"
            />
            <span className="text-sm text-gray-500">страниц</span>
          </div>
          <div className="text-xs text-gray-500 mt-1">
            Если число страниц фиксировано (например, Мини всегда 6) — поставьте одинаковые значения.
          </div>
          {rangeError && (
            <div className="text-xs text-red-600 mt-1">{rangeError}</div>
          )}
        </div>

        <SectionEditor
          sections={sections}
          onChange={setSections}
          density={density}
          onDensityChange={setDensity}
          disabled={busy}
        />

        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={submit}
            disabled={busy || !displayName.trim() || !!rangeError}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {busy
              ? mode === 'create' ? 'Создание…' : 'Сохранение…'
              : mode === 'create' ? 'Создать пресет' : 'Сохранить'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="btn-ghost text-sm"
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  )
}

function PresetCard({
  preset,
  templateSets,
  onSaved,
  onError,
}: {
  preset: RulePresetRow
  templateSets: TemplateSetRow[]
  onSaved: () => void | Promise<void>
  onError: (msg: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const isGlobal = preset.tenant_id === null
  const sheetLabel = preset.sheet_type === 'soft' ? 'мягкие листы' : preset.sheet_type === 'hard' ? 'плотные листы' : '—'

  // РЭ.21.5.3: показываем диапазон min..max. total_pages удалена из БД,
  // фолбэка больше нет — но мы оставляем NULL-обработку для безопасности
  // (например, custom-vrfxcuqi остался с NULL после РЭ.21.5.3 миграции).
  const pagesLabel = (() => {
    const min = preset.min_pages
    const max = preset.max_pages
    if (min != null && max != null) {
      return min === max ? `${min} стр.` : `${min}–${max} стр.`
    }
    return '— стр.'
  })()

  // РЭ.21.6.3: показываем название дизайна (template_set). Если у пресета
  // template_set_id = NULL → «по умолчанию» (loadBundle подставит
  // okeybook-default). Если uuid не найден в списке (template_set удалён
  // или нет доступа) → показываем сокращённый uuid как fallback.
  const templateSetLabel = (() => {
    if (!preset.template_set_id) return 'по умолчанию'
    const ts = templateSets.find((t) => t.id === preset.template_set_id)
    if (!ts) return preset.template_set_id.slice(0, 8) + '…'
    return ts.name
  })()

  // РЭ.21.7.2: режим редактирования. Карточка раскрывается, рендерим
  // ту же форму что для создания, но с mode='edit' и existing=preset.
  if (editing) {
    return (
      <div className="border rounded-xl">
        <PresetForm
          mode="edit"
          existing={preset}
          templateSets={templateSets}
          onCancel={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false)
            await onSaved()
          }}
          onError={onError}
        />
      </div>
    )
  }

  return (
    <div className="border rounded-xl p-4 hover:border-gray-300 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-medium">{preset.display_name}</h3>
            {isGlobal ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                глобальный
              </span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                мой
              </span>
            )}
          </div>
          <div className="text-sm text-gray-500 mt-1">
            {sheetLabel} · {pagesLabel}
            {preset.print_type && (
              <>
                {' · '}
                <span className="font-mono text-xs">{preset.print_type}</span>
              </>
            )}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            Дизайн: <span className="text-gray-700">{templateSetLabel}</span>
          </div>
        </div>
        {/* РЭ.21.7.2: кнопка «Редактировать» — только для своих пресетов.
            Глобальные сейчас редактируется только суперадмином (UI в
            /super планируется отдельно). */}
        {!isGlobal && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-sm text-blue-600 hover:text-blue-800 hover:underline shrink-0"
          >
            Редактировать
          </button>
        )}
      </div>

      <div className="mt-3">
        <SectionStructureDisplay
          structure={preset.section_structure}
          density={preset.density}
        />
      </div>
    </div>
  )
}

function SectionStructureDisplay({
  structure,
  density,
}: {
  structure: SectionStructureEntry[] | null
  /**
   * РЭ.21.7.5.3: density показываем как параметр секции students,
   * а не отдельной строкой meta пресета. null = «по умолчанию».
   * Мусорные значения (вне whitelist) трактуем как «по умолчанию».
   */
  density: string | null
}) {
  if (!structure || structure.length === 0) {
    return (
      <div className="text-xs text-gray-400 italic">
        Структура не задана (используется legacy-логика rule engine).
      </div>
    )
  }

  const sectionLabel: Record<string, string> = {
    soft_intro: 'Вступительная страница (мягкие)',
    teachers: 'Учителя',
    students: 'Портреты учеников',
    common: 'Общий раздел',
    vignette: 'Виньетка детских фото',
    soft_final: 'Финальная страница (мягкие)',
  }

  const slotLabel: Record<string, string> = {
    H: 'H (полкласса)',
    Q: 'Q (четверть)',
    FULL: 'FULL (общее фото)',
    flex_A: 'flex_A (крупный приоритет)',
    flex_B: 'flex_B (всё попробовать)',
    flex_C: 'flex_C (правая нечётная)',
  }

  // РЭ.21.7.5.3: красивое имя плотности из whitelist. null/мусор → null.
  const densityLabel = (() => {
    if (!density) return null
    if (DENSITY_ORDER.includes(density as PresetDensityValue)) {
      return DENSITY_LABELS[density as PresetDensityValue]
    }
    return null
  })()

  return (
    <ol className="space-y-1.5 text-sm">
      {structure.map((section, idx) => (
        <li key={idx} className="flex gap-2">
          <span className="text-gray-400 font-mono text-xs w-5 shrink-0 pt-0.5">
            {idx + 1}.
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-medium">
              {sectionLabel[section.type] ?? section.type}
            </div>
            {section.type === 'common' && Array.isArray((section as { slots?: string[] }).slots) && (
              <div className="text-xs text-gray-500 mt-0.5">
                {(section as { slots: string[] }).slots
                  .map((s) => slotLabel[s] ?? s)
                  .join(' · ')}
              </div>
            )}
            {section.type === 'students' && (
              <div className="text-xs text-gray-500 mt-0.5">
                Плотность: {densityLabel ?? 'по умолчанию'}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}
