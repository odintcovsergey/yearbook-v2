'use client'

import { useState, useEffect } from 'react'
import Papa from 'papaparse'

const secret = () => typeof window !== 'undefined' ? localStorage.getItem('admin_secret') ?? '' : ''

const api = (path: string, opts?: RequestInit) =>
  fetch(path, { ...opts, headers: { 'x-admin-secret': secret(), 'Content-Type': 'application/json', ...opts?.headers } })

type Tab = 'overview' | 'children' | 'upload' | 'import' | 'surcharges' | 'contacts' | 'teachers'
type Album = { id: string; title: string; classes: string[]; cover_mode: string; cover_price: number; deadline: string | null; city: string | null; year: number | null; group_enabled: boolean; group_min: number; group_max: number; group_exclusive: boolean; text_enabled: boolean; text_max_chars: number; stats?: { total: number; submitted: number; in_progress: number } }
type Template = { id: string; title: string; cover_mode: string; cover_price: number; group_enabled: boolean; group_min: number; group_max: number; group_exclusive: boolean; text_enabled: boolean; text_max_chars: number }
type Stats = { total: number; submitted: number; in_progress: number; not_started: number; teachers_total: number; teachers_done: number; surcharge_total: number; surcharge_count: number }
type Child = { id: string; full_name: string; class: string; access_token: string; submitted_at: string | null; started_at: string | null; contact: any; cover: any }

export default function AdminPage() {
  const [authed, setAuthed] = useState(false)
  const [pwd, setPwd] = useState('')
  const [albums, setAlbums] = useState<Album[]>([])
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [children, setChildren] = useState<Child[]>([])
  const [tab, setTab] = useState<Tab>('overview')
  const [msg, setMsg] = useState<{ text: string; type: 'ok' | 'err' } | null>(null)
  const [loading, setLoading] = useState(false)

  const notify = (text: string, type: 'ok' | 'err' = 'ok') => {
    setMsg({ text, type })
    setTimeout(() => setMsg(null), 3500)
  }

  const loadAlbums = async () => {
    const r = await api('/api/admin?action=albums_with_stats')
    if (r.ok) setAlbums(await r.json())
  }

  const loadAlbumData = async (album: Album) => {
    setLoading(true)
    const [s, c] = await Promise.all([
      api(`/api/admin?action=stats&album_id=${album.id}`).then(r => r.json()),
      api(`/api/admin?action=children&album_id=${album.id}`).then(r => r.json()),
    ])
    setStats(s)
    setChildren(c)
    setLoading(false)
  }

  useEffect(() => {
    const saved = localStorage.getItem('admin_secret')
    if (saved) { setPwd(saved); setAuthed(true); loadAlbums() }
  }, [])

  const login = () => {
    localStorage.setItem('admin_secret', pwd)
    setAuthed(true)
    loadAlbums()
  }

  const selectAlbum = (album: Album) => {
    setSelectedAlbum(album)
    loadAlbumData(album)
  }

  if (!authed) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="card p-8 w-full max-w-sm">
        <h1 className="text-xl font-medium text-gray-800 mb-6">Панель администратора</h1>
        <input
          type="password"
          placeholder="Пароль"
          value={pwd}
          onChange={e => setPwd(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && login()}
          className="input mb-4"
        />
        <button onClick={login} className="btn-primary w-full">Войти</button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Топбар */}
      <div className="bg-white border-b border-gray-100 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="font-medium text-gray-800">Выпускные альбомы</span>
            {selectedAlbum && (
              <>
                <span className="text-gray-300">/</span>
                <span className="text-blue-600 text-sm">{selectedAlbum.title}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {selectedAlbum && (
              <button onClick={() => { setSelectedAlbum(null); setStats(null); loadAlbums() }} className="btn-ghost text-xs">
                ← Все альбомы
              </button>
            )}
            {selectedAlbum && (
              <button onClick={() => loadAlbumData(selectedAlbum)} className="btn-ghost text-xs">
                ↻ Обновить
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Уведомление */}
      {msg && (
        <div className={`fixed top-16 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl text-sm shadow-lg
          ${msg.type === 'ok' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {msg.text}
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 py-6">

        {/* Выбор альбома */}
        {!selectedAlbum && (
          <AlbumsView albums={albums} onSelect={selectAlbum} onRefresh={loadAlbums} notify={notify} />
        )}

        {/* Основная панель */}
        {selectedAlbum && (
          <>
            {/* Tabs */}
            <div className="flex gap-1 mb-6 overflow-x-auto pb-1">
              {([
                { id: 'overview', label: '📊 Обзор' },
                { id: 'children', label: '👤 Ученики' },
                { id: 'upload', label: '📤 Фото' },
                { id: 'import', label: '📋 CSV' },
                { id: 'surcharges', label: '💰 Доплаты' },
                { id: 'contacts', label: '📞 Контакты' },
                { id: 'teachers', label: '🎓 Учителя' },

              ] as { id: Tab; label: string }[]).map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors
                    ${tab === t.id ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {loading && <div className="text-center py-12 text-gray-400 text-sm">Загрузка...</div>}

            {!loading && tab === 'overview' && stats && (
              <OverviewTab stats={stats} album={selectedAlbum} children={children} notify={notify} onRefresh={() => loadAlbumData(selectedAlbum)} />
            )}
            {!loading && tab === 'children' && (
              <ChildrenTab children={children} album={selectedAlbum} notify={notify} onRefresh={() => loadAlbumData(selectedAlbum)} />
            )}
            {!loading && tab === 'upload' && (
              <UploadTab album={selectedAlbum} notify={notify} />
            )}
            {!loading && tab === 'import' && (
              <ImportTab album={selectedAlbum} notify={notify} />
            )}
            {!loading && tab === 'surcharges' && (
              <SurchargesTab album={selectedAlbum} notify={notify} />
            )}
            {!loading && tab === 'contacts' && (
              <ContactsTab album={selectedAlbum} notify={notify} />
            )}
            {!loading && tab === 'teachers' && (
              <TeachersTab album={selectedAlbum} notify={notify} />
            )}

          </>
        )}
      </div>
    </div>
  )
}

// ─── Список альбомов ──────────────────────────────────────────────────────────

function AlbumsView({ albums, onSelect, onRefresh, notify }: any) {
  const [creating, setCreating] = useState(false)
  const [templates, setTemplates] = useState<Template[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<string>('')
  const emptyForm = { title: '', classes: '', cover_mode: 'none', cover_price: '0', deadline: '', city: '', year: String(new Date().getFullYear()), group_enabled: true, group_min: '2', group_max: '2', group_exclusive: true, text_enabled: true, text_max_chars: '500' }
  const [form, setForm] = useState(emptyForm)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'done' | 'pending'>('all')
  const [sortBy, setSortBy] = useState<'created' | 'deadline' | 'progress'>('created')
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [showTemplatesModal, setShowTemplatesModal] = useState(false)

  const deleteAlbum = async (id: string, title: string) => {
    if (!confirm(`Удалить альбом «${title}»?

Будут удалены все ученики, фотографии и выборы. Это действие нельзя отменить.`)) return
    if (!confirm(`Подтвердите ещё раз: удалить «${title}» безвозвратно?`)) return
    const res = await api('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'delete_album', album_id: id }) })
    const data = await res.json()
    if (data.ok) { notify('Альбом удалён'); onRefresh() }
    else notify(data.error || 'Ошибка', 'err')
  }

  const renameAlbum = async (id: string, title: string) => {
    if (!title.trim()) return
    const res = await api('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'rename_album', album_id: id, title: title.trim() }) })
    const data = await res.json()
    if (data.ok) { notify('Название обновлено'); onRefresh() }
    else notify(data.error || 'Ошибка', 'err')
  }

  useEffect(() => {
    api('/api/admin?action=templates').then(r => r.json()).then(setTemplates)
  }, [])

  const applyTemplate = (id: string) => {
    setSelectedTemplate(id)
    if (!id) { setForm(emptyForm); return }
    const t = templates.find(t => t.id === id)
    if (!t) return
    setForm(f => ({
      ...f,
      cover_mode: t.cover_mode,
      cover_price: String(t.cover_price),
      group_enabled: t.group_enabled,
      group_min: String(t.group_min),
      group_max: String(t.group_max),
      group_exclusive: t.group_exclusive,
      text_enabled: t.text_enabled,
      text_max_chars: String(t.text_max_chars),
    }))
  }

  const create = async () => {
    const res = await api('/api/admin', {
      method: 'POST',
      body: JSON.stringify({
        action: 'create_album',
        title: form.title,
        classes: form.classes.split(',').map((s: string) => s.trim()).filter(Boolean),
        cover_mode: form.cover_mode,
        cover_price: form.cover_mode === 'optional' || form.cover_mode === 'required' ? parseInt(form.cover_price) : 0,
        deadline: form.deadline || null,
        group_enabled: form.group_enabled,
        group_min: form.group_enabled ? parseInt(form.group_min) : 0,
        group_max: form.group_enabled ? parseInt(form.group_max) : 0,
        group_exclusive: form.group_exclusive,
        text_enabled: form.text_enabled,
        text_max_chars: parseInt(form.text_max_chars),
        city: form.city || null,
        year: parseInt(form.year),
      }),
    })
    if (res.ok) { notify('Альбом создан!'); setCreating(false); setForm(emptyForm); setSelectedTemplate(''); onRefresh() }
    else notify('Ошибка создания', 'err')
  }

  const filtered = albums
    .filter((a: Album) => {
      if (search && !a.title.toLowerCase().includes(search.toLowerCase())) return false
      const s = a.stats ?? { total: 0, submitted: 0, in_progress: 0 }
      if (filterStatus === 'done' && (s.total === 0 || s.submitted < s.total)) return false
      if (filterStatus === 'pending' && s.total > 0 && s.submitted === s.total) return false
      return true
    })
    .sort((a: Album, b: Album) => {
      if (sortBy === 'deadline') {
        if (!a.deadline && !b.deadline) return 0
        if (!a.deadline) return 1
        if (!b.deadline) return -1
        return new Date(a.deadline).getTime() - new Date(b.deadline).getTime()
      }
      if (sortBy === 'progress') {
        const pctA = (a.stats?.total ?? 0) ? (a.stats!.submitted / a.stats!.total) : 0
        const pctB = (b.stats?.total ?? 0) ? (b.stats!.submitted / b.stats!.total) : 0
        return pctB - pctA
      }
      return 0
    })

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-2xl font-medium text-gray-900">Альбомы</h2>
          {albums.length > 0 && <p className="text-sm text-gray-400 mt-0.5">{albums.length} {albums.length === 1 ? 'альбом' : albums.length < 5 ? 'альбома' : 'альбомов'}</p>}
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowTemplatesModal(true)} className="px-3 py-2 text-sm text-gray-500 hover:text-gray-800 border border-gray-200 rounded-xl hover:bg-gray-50 transition-all">
            Шаблоны
          </button>
          <button onClick={() => { setCreating(!creating); setSelectedTemplate(''); setForm(emptyForm) }} className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-xl hover:bg-gray-700 transition-all">
            + Новый альбом
          </button>
        </div>
      </div>

      {showTemplatesModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowTemplatesModal(false)}>
          <div className="card p-6 w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-gray-800">Шаблоны альбомов</h3>
              <button onClick={() => setShowTemplatesModal(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
            </div>
            <TemplatesTab notify={notify} />
          </div>
        </div>
      )}

      {creating && (
        <div className="card p-5 mb-6 space-y-5">
          <h3 className="font-medium text-gray-800">Новый альбом</h3>

          {/* Шаблон */}
          {templates.length > 0 && (
            <div>
              <label className="text-xs text-gray-500 block mb-2">Шаблон (необязательно)</label>
              <div className="flex flex-wrap gap-2">
                {templates.map(t => (
                  <button
                    key={t.id}
                    onClick={() => applyTemplate(selectedTemplate === t.id ? '' : t.id)}
                    className={`px-3 py-1.5 rounded-xl text-sm border transition-colors ${selectedTemplate === t.id ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                  >
                    {t.title}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Основные поля */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Название *</label>
              <input className="input" placeholder="Школа 72, 11А" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Классы (через запятую) *</label>
              <input className="input" placeholder="11А, 11Б" value={form.classes} onChange={e => setForm(f => ({ ...f, classes: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Дедлайн</label>
              <input className="input" type="datetime-local" value={form.deadline} onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Город</label>
              <input className="input" placeholder="Москва" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Год выпуска</label>
              <select className="input" value={form.year} onChange={e => setForm(f => ({ ...f, year: e.target.value }))}>
                {Array.from({ length: 15 }, (_, i) => 2026 + i).map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Обложка */}
          <div className="border border-gray-100 rounded-xl p-4 space-y-3">
            <p className="text-sm font-medium text-gray-700">Портрет на обложку</p>
            <div className="flex flex-wrap gap-2">
              {[
                { v: 'none', l: 'Без портрета' },
                { v: 'same', l: 'Тот же (бесплатно)' },
                { v: 'optional', l: 'Другой (доплата)' },
                { v: 'required', l: 'Обязателен (все платят)' },
              ].map(({ v, l }) => (
                <button key={v} onClick={() => setForm(f => ({ ...f, cover_mode: v }))}
                  className={`px-3 py-1.5 rounded-xl text-sm border transition-colors ${form.cover_mode === v ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  {l}
                </button>
              ))}
            </div>
            {(form.cover_mode === 'optional' || form.cover_mode === 'required') && (
              <div className="flex items-center gap-3">
                <label className="text-xs text-gray-500">Доплата (₽)</label>
                <input className="input w-28" type="number" value={form.cover_price} onChange={e => setForm(f => ({ ...f, cover_price: e.target.value }))} />
              </div>
            )}
          </div>

          {/* Групповые фото */}
          <div className="border border-gray-100 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700">Групповые фото</p>
              <button onClick={() => setForm(f => ({ ...f, group_enabled: !f.group_enabled }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.group_enabled ? 'bg-blue-500' : 'bg-gray-200'}`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.group_enabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
            {form.group_enabled && (
              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Минимум фото</label>
                    <input className="input w-20" type="number" min="0" value={form.group_min} onChange={e => setForm(f => ({ ...f, group_min: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Максимум фото</label>
                    <input className="input w-20" type="number" min="1" value={form.group_max} onChange={e => setForm(f => ({ ...f, group_max: e.target.value }))} />
                  </div>
                  {form.group_min === form.group_max && (
                    <p className="text-xs text-blue-500 mt-4">Фиксированное: ровно {form.group_min} фото</p>
                  )}
                  {form.group_min !== form.group_max && (
                    <p className="text-xs text-blue-500 mt-4">От {form.group_min} до {form.group_max} фото</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => setForm(f => ({ ...f, group_exclusive: !f.group_exclusive }))}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${form.group_exclusive ? 'bg-blue-500' : 'bg-gray-200'}`}>
                    <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${form.group_exclusive ? 'translate-x-5' : 'translate-x-1'}`} />
                  </button>
                  <span className="text-sm text-gray-600">Эксклюзивный выбор — одно фото нельзя выбрать дважды</span>
                </div>
              </div>
            )}
          </div>

          {/* Текст */}
          <div className="border border-gray-100 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700">Текст от ученика</p>
              <button onClick={() => setForm(f => ({ ...f, text_enabled: !f.text_enabled }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.text_enabled ? 'bg-blue-500' : 'bg-gray-200'}`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.text_enabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
            {form.text_enabled && (
              <div className="flex items-center gap-3">
                <label className="text-xs text-gray-500">Макс. символов</label>
                <input className="input w-24" type="number" value={form.text_max_chars} onChange={e => setForm(f => ({ ...f, text_max_chars: e.target.value }))} />
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button className="btn-primary" onClick={create} disabled={!form.title || !form.classes}>Создать</button>
            <button className="btn-secondary" onClick={() => { setCreating(false); setForm(emptyForm); setSelectedTemplate('') }}>Отмена</button>
          </div>
        </div>
      )}

      {/* Поиск и фильтры */}
      {albums.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          <input type="text" placeholder="Поиск по названию..." value={search} onChange={e => setSearch(e.target.value)} className="input flex-1 min-w-[200px] text-sm bg-white" />
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)} className="input text-sm w-auto bg-white">
            <option value="all">Все статусы</option>
            <option value="done">Все готовы</option>
            <option value="pending">Есть незавершённые</option>
          </select>
          <select value={sortBy} onChange={e => setSortBy(e.target.value as any)} className="input text-sm w-auto bg-white">
            <option value="created">По дате создания</option>
            <option value="deadline">По дедлайну</option>
            <option value="progress">По % готовности</option>
          </select>
        </div>
      )}

      {albums.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-200 p-16 text-center text-gray-400 text-sm">Нет альбомов. Создайте первый.</div>
      )}
      {albums.length > 0 && filtered.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-200 p-16 text-center text-gray-400 text-sm">Ничего не найдено.</div>
      )}

      <div className="grid gap-2">
        {filtered.map((a: Album) => {
          const s = a.stats ?? { total: 0, submitted: 0, in_progress: 0 }
          const pct = s.total ? Math.round(s.submitted / s.total * 100) : 0
          const allDone = s.total > 0 && s.submitted === s.total
          const now = new Date()
          const deadline = a.deadline ? new Date(a.deadline) : null
          const daysLeft = deadline ? Math.ceil((deadline.getTime() - now.getTime()) / 86400000) : null
          const deadlineOverdue = daysLeft !== null && daysLeft < 0
          const deadlineSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 3
          const teachers = (a as any).teachers

          return (
            <div key={a.id} className="bg-white rounded-2xl border border-gray-100 hover:border-gray-200 transition-all">
              <div className="flex items-center gap-4 p-5">
                {/* Иконка-кружок */}
                <div className={`w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center ${allDone ? 'bg-green-50' : 'bg-blue-50'}`}>
                  <div className={`w-5 h-1.5 rounded-full ${allDone ? 'bg-green-400' : 'bg-blue-400'}`} />
                </div>

                {/* Основная инфа */}
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onSelect(a)}>
                  <div className="flex items-center gap-2 flex-wrap">
                    {editingTitleId === a.id ? (
                      <input
                        className="input text-sm font-medium py-0.5 px-2 w-48"
                        value={editingTitle}
                        autoFocus
                        onChange={e => setEditingTitle(e.target.value)}
                        onKeyDown={async e => {
                          if (e.key === 'Enter') { await renameAlbum(a.id, editingTitle); setEditingTitleId(null) }
                          if (e.key === 'Escape') setEditingTitleId(null)
                        }}
                        onClick={e => e.stopPropagation()}
                      />
                    ) : (
                      <span className="font-medium text-gray-900 text-[15px]">{a.title}</span>
                    )}
                    {allDone && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-600">✓ Все готовы</span>}
                    {!allDone && s.total > 0 && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-600">{s.total - s.submitted} не завершили</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-xs text-gray-400">{a.classes.join(', ')}{a.city ? ` · ${a.city}` : ''}{a.year ? ` · ${a.year}` : ''}</span>
                    {deadline && (
                      <span className={`text-xs ${deadlineOverdue ? 'text-red-400' : deadlineSoon ? 'text-amber-500' : 'text-gray-300'}`}>
                        · {deadlineOverdue ? `просрочен ${Math.abs(daysLeft!)} дн.` : daysLeft === 0 ? 'сегодня дедлайн' : daysLeft === 1 ? 'завтра дедлайн' : `${deadline.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`}
                      </span>
                    )}
                    {teachers && (() => {
                      const done = teachers.total > 0 && teachers.done === teachers.total
                      const none = teachers.done === 0
                      return <span className={`text-xs ${done ? 'text-green-400' : none ? 'text-amber-400' : 'text-blue-400'}`}>
                        · {done ? 'учителя ✓' : none ? `учителя ⚠` : `учителя ${teachers.done}/${teachers.total}`}
                      </span>
                    })()}
                  </div>
                  {s.total > 0 && (
                    <div className="mt-2.5 flex items-center gap-3">
                      <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${allDone ? 'bg-green-400' : 'bg-blue-400'}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className={`text-xs font-medium tabular-nums ${allDone ? 'text-green-500' : 'text-blue-500'}`}>{pct}%</span>
                    </div>
                  )}
                </div>

                {/* Действия */}
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => { setEditingTitleId(a.id); setEditingTitle(a.title) }} className="p-1.5 text-gray-300 hover:text-gray-500 transition-colors rounded-lg hover:bg-gray-50" title="Переименовать">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  <button onClick={() => { navigator.clipboard.writeText(`${location.origin}/album/${a.id}`); notify('Ссылка класса скопирована') }} className="px-2.5 py-1 text-xs text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors">Класс</button>
                  {(a as any).teacher_token && <button onClick={() => { navigator.clipboard.writeText(`${location.origin}/teacher/${(a as any).teacher_token}`); notify('Ссылка учителей скопирована') }} className="px-2.5 py-1 text-xs text-violet-500 hover:text-violet-700 hover:bg-violet-50 rounded-lg transition-colors">Учителя</button>}
                  <button onClick={() => deleteAlbum(a.id, a.title)} className="px-2.5 py-1 text-xs text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">Удалить</button>
                  <button onClick={() => onSelect(a)} className="p-1.5 text-gray-300 hover:text-gray-600 transition-colors rounded-lg hover:bg-gray-50">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
// ─── Обзор ────────────────────────────────────────────────────────────────────

function OverviewTab({ stats, album, children, notify, onRefresh }: any) {
  const [showReminder, setShowReminder] = useState(false)
  const pct = stats.total ? Math.round(stats.submitted / stats.total * 100) : 0

  // Дедлайн
  const toLocalDatetime = (iso: string | null) => {
    if (!iso) return ''
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  const [deadlineVal, setDeadlineVal] = useState(toLocalDatetime(album.deadline))
  const [savingDeadline, setSavingDeadline] = useState(false)

  const saveDeadline = async () => {
    setSavingDeadline(true)
    const res = await api('/api/admin', {
      method: 'POST',
      body: JSON.stringify({ action: 'update_deadline', album_id: album.id, deadline: deadlineVal || null }),
    })
    setSavingDeadline(false)
    if (res.ok) { notify('Дедлайн обновлён!'); onRefresh() }
    else notify('Ошибка', 'err')
  }

  const now = new Date()
  const deadlineDate = deadlineVal ? new Date(deadlineVal) : null
  const daysLeft = deadlineDate ? Math.ceil((deadlineDate.getTime() - now.getTime()) / 86400000) : null
  const isOverdue = daysLeft !== null && daysLeft < 0
  const isSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 3

  const archiveAlbum = async () => {
    if (!confirm(`Архивировать альбом «${album.title}»?\n\nВсе фотографии будут удалены из хранилища. Данные о выборе, тексты и контакты останутся. CSV экспорт сохранит имена файлов.\n\nЭто действие нельзя отменить.`)) return
    const res = await api('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'archive_album', album_id: album.id }) })
    const data = await res.json()
    if (data.ok) { notify(`Архивировано! Удалено ${data.deleted} фото из хранилища.`); onRefresh() }
    else notify(data.error || 'Ошибка', 'err')
  }

  const exportCsv = async () => {
    const res = await api(`/api/admin?action=export&album_id=${album.id}`)
    if (!res.ok) { notify('Ошибка экспорта', 'err'); return }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `album-${album.id}.csv`; a.click()
    notify('CSV скачан!')
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Всего учеников" value={stats.total} />
        <StatCard label="Подтвердили" value={stats.submitted} accent="green" note={`${pct}%`} />
        <StatCard label="В процессе" value={stats.in_progress} accent="amber" />
        <StatCard label="Не начали" value={stats.not_started} />
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="font-medium text-gray-700">Общий прогресс</span>
          <span className="text-sm text-gray-400">{stats.submitted} из {stats.total} подтвердили</span>
        </div>
        <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-gray-100">
          <MiniStat label="Учителя" value={`${stats.teachers_done}/${stats.teachers_total}`} />
          <MiniStat label="Доплаты" value={`${stats.surcharge_count} чел.`} />
          <MiniStat label="Сумма доплат" value={`${stats.surcharge_total} ₽`} accent />
        </div>
      </div>

      {/* Дедлайн */}
      <div className="card p-5">
        <p className="font-medium text-gray-700 mb-3">Дедлайн</p>
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="datetime-local"
            value={deadlineVal}
            onChange={e => setDeadlineVal(e.target.value)}
            className="input w-auto"
          />
          <button onClick={saveDeadline} disabled={savingDeadline} className="btn-primary text-sm">
            {savingDeadline ? 'Сохраняю...' : 'Сохранить'}
          </button>
          {deadlineVal && (
            <button onClick={() => setDeadlineVal('')} className="btn-ghost text-xs text-gray-400">
              Убрать дедлайн
            </button>
          )}
        </div>
        {daysLeft !== null && (
          <p className={`text-sm mt-2 ${isOverdue ? 'text-red-500' : isSoon ? 'text-amber-600' : 'text-gray-400'}`}>
            {isOverdue
              ? `⚠ Дедлайн просрочен ${Math.abs(daysLeft)} дн. назад — ссылки заблокированы`
              : daysLeft === 0 ? '⏰ Сегодня последний день'
              : daysLeft === 1 ? '⏰ Завтра истекает'
              : `📅 До дедлайна ${daysLeft} дн.`}
          </p>
        )}
      </div>

      <div className="flex gap-3 flex-wrap">
        <button onClick={exportCsv} className="btn-primary">
          ⬇ Экспорт для вёрстки (CSV)
        </button>
        <button
          onClick={() => {
            navigator.clipboard.writeText(`${location.origin}/album/${album.id}`)
            notify('Ссылка на класс скопирована!')
          }}
          className="btn-secondary"
        >
          🔗 Скопировать ссылку класса
        </button>
        <button onClick={archiveAlbum} className="btn-secondary text-amber-600 border-amber-200 hover:bg-amber-50">
          🗄 Архивировать (удалить фото)
        </button>
        {(stats.in_progress > 0 || stats.not_started > 0) && (
          <button onClick={() => setShowReminder(true)} className="btn-secondary text-blue-600 border-blue-200 hover:bg-blue-50">
            🔔 Напоминание ({stats.in_progress + stats.not_started} чел.)
          </button>
        )}
      </div>

      {showReminder && (() => {
        const unfinished = (children ?? []).filter((c: any) => !c.submitted_at)
        const lines = unfinished.map((c: any) => `${c.full_name} — ${location.origin}/${c.access_token}`).join('\n')
        const text = `Уважаемые родители, напоминаем о необходимости выбрать фотографии для альбома «${album.title}».\n\nПожалуйста, перейдите по своей ссылке и подтвердите выбор:\n\n${lines}`
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowReminder(false)}>
            <div className="card p-6 w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-medium text-gray-800">Напоминание — {unfinished.length} незавершивших</h3>
                <button onClick={() => setShowReminder(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
              </div>
              <p className="text-sm text-gray-500 mb-3">Скопируйте текст и отправьте в общий чат класса:</p>
              <textarea
                className="input resize-none flex-1 font-mono text-xs"
                style={{minHeight: '300px'}}
                value={text}
                readOnly
                onClick={e => (e.target as HTMLTextAreaElement).select()}
              />
              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => { navigator.clipboard.writeText(text); notify('Текст скопирован!') }}
                  className="btn-primary flex-1"
                >
                  📋 Скопировать текст
                </button>
                <button onClick={() => setShowReminder(false)} className="btn-secondary">Закрыть</button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

function StatCard({ label, value, accent, note }: any) {
  const color = accent === 'green' ? 'text-green-600' : accent === 'amber' ? 'text-amber-600' : 'text-gray-800'
  return (
    <div className="card p-4">
      <div className={`text-3xl font-medium ${color}`}>{value}</div>
      {note && <div className="text-xs text-gray-400">{note}</div>}
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  )
}

function MiniStat({ label, value, accent }: any) {
  return (
    <div>
      <div className={`text-base font-medium ${accent ? 'text-green-600' : 'text-gray-800'}`}>{value}</div>
      <div className="text-xs text-gray-400">{label}</div>
    </div>
  )
}

// ─── Ученики ─────────────────────────────────────────────────────────────────

function ChildrenTab({ children, album, notify, onRefresh }: any) {
  const [newName, setNewName] = useState(''); const [newClass, setNewClass] = useState('')
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkLoading, setBulkLoading] = useState(false)
  const [detailChild, setDetailChild] = useState<any>(null)
  const [detailData, setDetailData] = useState<any>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const addChild = async () => {
    if (!newName || !newClass) return
    const res = await api('/api/admin', {
      method: 'POST',
      body: JSON.stringify({ action: 'add_child', album_id: album.id, full_name: newName, class: newClass }),
    })
    if (res.ok) { notify(`Добавлен: ${newName}`); setNewName(''); onRefresh() }
    else notify('Ошибка', 'err')
  }

  const importCsv = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (result) => {
        const rows = result.data as { full_name: string; class: string }[]
        let added = 0, skipped = 0
        for (const row of rows) {
          if (!row.full_name?.trim()) { skipped++; continue }
          const res = await api('/api/admin', {
            method: 'POST',
            body: JSON.stringify({
              action: 'add_child',
              album_id: album.id,
              full_name: row.full_name.trim(),
              class: (row.class ?? newClass ?? '').trim(),
            }),
          })
          if (res.ok) added++; else skipped++
        }
        notify(skipped > 0 ? `Импортировано: ${added}, пропущено: ${skipped} (дубликаты или ошибки)` : `Импортировано: ${added} учеников`)
        onRefresh()
        e.target.value = ''
      }
    })
  }

  const resetChild = async (id: string, name: string) => {
    if (!confirm(`Сбросить выбор ${name}? Все выборы фото, текст и контакты будут удалены. Ученик останется в списке.`)) return
    const res = await api('/api/admin', {
      method: 'POST',
      body: JSON.stringify({ action: 'reset_child', child_id: id }),
    })
    const data = await res.json()
    if (data.ok) { notify(`Выбор ${name} сброшен`); onRefresh() }
    else notify(data.error || 'Ошибка', 'err')
  }

  const deleteChild = async (id: string, name: string, submitted: boolean) => {
    const msg = submitted
      ? `Внимание! ${name} уже провёл отбор фотографий. Удалить его и освободить выбранные фото?`
      : `Удалить ${name}? Это действие нельзя отменить.`
    if (!confirm(msg)) return
    const res = await api('/api/admin', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete_child', child_id: id }),
    })
    const data = await res.json()
    if (data.ok) { notify(`${name} удалён`); onRefresh() }
    else notify(data.error || 'Ошибка', 'err')
  }

  const copyLink = (token: string, name: string) => {
    navigator.clipboard.writeText(`${location.origin}/${token}`)
    notify(`Ссылка для ${name} скопирована`)
  }

  const openDetail = async (c: Child) => {
    setDetailChild(c)
    setDetailData(null)
    setDetailLoading(true)
    const res = await api(`/api/admin?action=child_details&child_id=${c.id}`)
    const data = await res.json()
    setDetailData(data)
    setDetailLoading(false)
  }

  const filtered = children.filter((c: Child) =>
    c.full_name.toLowerCase().includes(filter.toLowerCase()) ||
    c.class.toLowerCase().includes(filter.toLowerCase())
  )

  return (
    <div className="space-y-4">
      <div className="card p-4 flex gap-3 items-end flex-wrap">
        <div className="flex-1 min-w-40">
          <label className="text-xs text-gray-500 block mb-1">Имя ученика</label>
          <input className="input" placeholder="Иванов Иван" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addChild()} />
        </div>
        <div className="w-24">
          <label className="text-xs text-gray-500 block mb-1">Класс</label>
          <input className="input" placeholder="11А" value={newClass} onChange={e => setNewClass(e.target.value)} />
        </div>
        <button className="btn-primary" onClick={addChild}>Добавить</button>
        <label className="btn-secondary cursor-pointer">
          📋 Импорт CSV
          <input type="file" accept=".csv" onChange={importCsv} className="hidden" />
        </label>
      </div>
      <div className="bg-gray-50 rounded-xl px-4 py-3 text-xs text-gray-500">
        Формат CSV для импорта: <code className="bg-white px-1 rounded">full_name,class</code> — два столбца, первая строка заголовок
      </div>

      <input className="input bg-white" placeholder="Поиск по имени или классу..." value={filter} onChange={e => setFilter(e.target.value)} />

      {selected.size > 0 && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
          <span className="text-sm text-blue-700 font-medium flex-1">Выбрано: {selected.size} учеников</span>
          <button
            disabled={bulkLoading}
            onClick={async () => {
              if (!confirm(`Сбросить выбор у ${selected.size} учеников?`)) return
              setBulkLoading(true)
              for (const id of Array.from(selected)) {
                await api('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'reset_child', child_id: id }) })
              }
              setBulkLoading(false)
              setSelected(new Set())
              notify(`Сброшено ${selected.size} учеников`)
              onRefresh()
            }}
            className="btn-secondary text-sm text-amber-600 border-amber-200 hover:bg-amber-50"
          >
            {bulkLoading ? 'Сбрасываю...' : 'Сбросить выбранных'}
          </button>
          <button
            disabled={bulkLoading}
            onClick={async () => {
              if (!confirm(`Удалить ${selected.size} учеников? Это действие нельзя отменить.`)) return
              setBulkLoading(true)
              for (const id of Array.from(selected)) {
                await api('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'delete_child', child_id: id }) })
              }
              setBulkLoading(false)
              setSelected(new Set())
              notify(`Удалено ${selected.size} учеников`)
              onRefresh()
            }}
            className="btn-secondary text-sm text-red-500 border-red-200 hover:bg-red-50"
          >
            {bulkLoading ? 'Удаляю...' : 'Удалить выбранных'}
          </button>
          <button onClick={() => setSelected(new Set())} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
        </div>
      )}

      <div className="flex gap-4">
      <div className="card overflow-hidden flex-1 min-w-0">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left">
              <th className="px-4 py-3 w-8">
                <input type="checkbox"
                  checked={filtered.length > 0 && filtered.every((c: Child) => selected.has(c.id))}
                  onChange={e => setSelected(e.target.checked ? new Set(filtered.map((c: Child) => c.id)) : new Set())}
                  className="rounded"
                />
              </th>
              <th className="px-4 py-3 text-xs text-gray-500 font-medium">Ученик</th>
              <th className="px-4 py-3 text-xs text-gray-500 font-medium">Класс</th>
              <th className="px-4 py-3 text-xs text-gray-500 font-medium">Статус</th>
              <th className="px-4 py-3 text-xs text-gray-500 font-medium">Дата</th>
              <th className="px-4 py-3 text-xs text-gray-500 font-medium">Родитель</th>
              <th className="px-4 py-3 text-xs text-gray-500 font-medium">Обложка</th>
              <th className="px-4 py-3 text-xs text-gray-500 font-medium">Ссылка</th>
              <th className="px-4 py-3 text-xs text-gray-500 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((c: Child) => (
              <tr key={c.id} onClick={() => openDetail(c)} className={`hover:bg-gray-50 cursor-pointer ${selected.has(c.id) ? 'bg-blue-50/50' : ''} ${detailChild?.id === c.id ? 'bg-blue-50 border-l-2 border-blue-400' : ''}`}>
                <td className="px-4 py-3 w-8" onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={selected.has(c.id)}
                    onChange={e => setSelected(prev => { const s = new Set(prev); e.target.checked ? s.add(c.id) : s.delete(c.id); return s })}
                    className="rounded"
                  />
                </td>
                <td className="px-4 py-3 font-medium text-gray-800">{c.full_name}</td>
                <td className="px-4 py-3 text-gray-500">{c.class}</td>
                <td className="px-4 py-3">
                  {c.submitted_at
                    ? <span className="badge-green">✓ Готово</span>
                    : c.started_at
                      ? <span className="badge-amber">В процессе</span>
                      : <span className="badge-gray">Не начал</span>}
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs">
                  {c.submitted_at
                    ? new Date(c.submitted_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                    : '—'}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">{c.contact?.parent_name ?? '—'}</td>
                <td className="px-4 py-3 text-xs">
                  {c.cover?.surcharge > 0
                    ? <span className="text-green-600 font-medium">+{c.cover.surcharge} ₽</span>
                    : <span className="text-gray-400">—</span>}
                </td>
                <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => copyLink(c.access_token, c.full_name)}
                    className="text-blue-500 hover:text-blue-700 text-xs hover:underline"
                  >
                    Копировать ссылку
                  </button>
                </td>
                <td className="px-4 py-3 flex gap-3 items-center" onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => resetChild(c.id, c.full_name)}
                    className="text-amber-500 hover:text-amber-700 text-xs hover:underline"
                  >
                    Сбросить
                  </button>
                  <button
                    onClick={() => deleteChild(c.id, c.full_name, !!c.submitted_at)}
                    className="text-red-400 hover:text-red-600 text-xs hover:underline"
                  >
                    Удалить
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="text-center text-gray-400 text-sm py-8">Ничего не найдено</p>
        )}
      </div>

      {/* Панель деталей */}
      {detailChild && (
        <div className="w-80 shrink-0 card p-4 self-start sticky top-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium text-gray-800 text-sm truncate">{detailChild.full_name}</h4>
            <button onClick={() => { setDetailChild(null); setDetailData(null) }} className="text-gray-400 hover:text-gray-600 text-lg leading-none ml-2">×</button>
          </div>
          {detailLoading ? (
            <p className="text-xs text-gray-400 py-4 text-center">Загрузка...</p>
          ) : detailData ? (
            <div className="space-y-3">
              {/* Портрет */}
              {detailData.selections?.filter((s: any) => s.type === 'portrait_page').map((s: any) => (
                <div key={s.type}>
                  <p className="text-xs text-gray-400 mb-1">Портрет</p>
                  <img src={s.thumb || s.url} alt="" className="w-full rounded-lg object-cover aspect-square" />
                </div>
              ))}
              {/* Обложка */}
              {detailData.cover?.cover_option === 'other' && detailData.selections?.filter((s: any) => s.type === 'portrait_cover').map((s: any) => (
                <div key={s.type}>
                  <p className="text-xs text-gray-400 mb-1">Обложка <span className="text-green-600">+{detailData.cover.surcharge} ₽</span></p>
                  <img src={s.thumb || s.url} alt="" className="w-full rounded-lg object-cover aspect-square" />
                </div>
              ))}
              {detailData.cover?.cover_option === 'same' && <p className="text-xs text-gray-500">Обложка: тот же портрет</p>}
              {/* Фото с друзьями */}
              {detailData.selections?.filter((s: any) => s.type === 'group').length > 0 && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">Фото с друзьями</p>
                  <div className="grid grid-cols-2 gap-1">
                    {detailData.selections.filter((s: any) => s.type === 'group').map((s: any, i: number) => (
                      <img key={i} src={s.thumb || s.url} alt="" className="w-full rounded-lg object-cover aspect-square" />
                    ))}
                  </div>
                </div>
              )}
              {/* Текст */}
              {detailData.text && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">Текст</p>
                  <p className="text-xs text-gray-700 bg-gray-50 rounded-lg p-2">{detailData.text}</p>
                </div>
              )}
              {/* Контакт */}
              {detailData.contact && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">Контакт</p>
                  <p className="text-xs text-gray-700">{detailData.contact.parent_name}</p>
                  <p className="text-xs text-gray-500">{detailData.contact.phone}</p>
                </div>
              )}
              {!detailData.selections?.length && !detailData.text && !detailData.contact && (
                <p className="text-xs text-gray-400 text-center py-2">Ученик ещё не начал выбор</p>
              )}
            </div>
          ) : null}
        </div>
      )}
      </div>
    </div>
  )
}

// ─── Загрузка фото ────────────────────────────────────────────────────────────

const UPLOAD_CONCURRENCY = 5 // сколько файлов загружать параллельно

async function uploadFiles(files: File[], type: string, albumId: string, onProgress: (done: number) => void) {
  const { createClient } = await import('@supabase/supabase-js')
  const imageCompression = (await import('browser-image-compression')).default
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

  let done = 0
  const queue = [...files]

  const worker = async () => {
    while (queue.length > 0) {
      const file = queue.shift()!
      let compressed = file
      try {
        compressed = await imageCompression(file, {
          maxSizeMB: 1.2,
          maxWidthOrHeight: 2048,
          useWebWorker: true,
          initialQuality: 0.85,
          fileType: 'image/webp',
        })
      } catch (e) {}
      const path = `${albumId}/${type}/${Date.now()}_${file.name.replace(/\.[^.]+$/, '')}.webp`
      const { error } = await sb.storage.from('photos').upload(path, compressed, { contentType: 'image/webp', upsert: false })
      if (!error) {
        await fetch('/api/admin/register-photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret() },
          body: JSON.stringify({ album_id: albumId, filename: file.name, storage_path: path, type }),
        })
      }
      done++
      onProgress(done)
    }
  }

  await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, files.length) }, worker))
}

function UploadTab({ album, notify }: any) {
  const [activeTab, setActiveTab] = useState<'portrait' | 'group' | 'teacher'>('portrait')
  const [photos, setPhotos] = useState<any[]>([])
  const [loadingPhotos, setLoadingPhotos] = useState(false)

  // Состояние для каждого типа
  const [state, setState] = useState<Record<string, { files: File[]; uploading: boolean; done: number }>>({
    portrait: { files: [], uploading: false, done: 0 },
    group:    { files: [], uploading: false, done: 0 },
    teacher:  { files: [], uploading: false, done: 0 },
  })

  const setTypeState = (type: string, patch: Partial<{ files: File[]; uploading: boolean; done: number }>) =>
    setState(prev => ({ ...prev, [type]: { ...prev[type], ...patch } }))

  const loadPhotos = async (t: string) => {
    setLoadingPhotos(true)
    const res = await fetch(`/api/admin?action=photos&album_id=${album.id}&photo_type=${t}`, {
      headers: { 'x-admin-secret': secret() }
    })
    const data = await res.json()
    setPhotos(data.photos ?? [])
    setLoadingPhotos(false)
  }

  useEffect(() => { loadPhotos(activeTab) }, [activeTab, album.id])

  const upload = async (type: string) => {
    const files = state[type].files
    if (!files.length) return
    setTypeState(type, { uploading: true, done: 0 })
    await uploadFiles(files, type, album.id, done => setTypeState(type, { done }))
    setTypeState(type, { uploading: false, files: [], done: 0 })
    notify(`✓ Загружено ${files.length} фото (${typeLabel(type)})`)
    if (activeTab === type) loadPhotos(type)
  }

  // Запустить загрузку всех трёх типов параллельно
  const uploadAll = () => {
    const types = ['portrait', 'group', 'teacher'].filter(t => state[t].files.length > 0)
    types.forEach(t => upload(t))
  }

  const deletePhoto = async (photo: any) => {
    if (!confirm(`Удалить фото "${photo.filename}"?`)) return
    await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret() },
      body: JSON.stringify({ action: 'delete_photo', photo_id: photo.id, storage_path: photo.storage_path }),
    })
    setPhotos(prev => prev.filter(p => p.id !== photo.id))
    notify('Фото удалено')
  }

  const typeLabel = (t: string) => ({ portrait: 'Портреты', group: 'Групповые', teacher: 'Учителя' }[t] ?? t)
  const totalFiles = Object.values(state).reduce((s, v) => s + v.files.length, 0)
  const anyUploading = Object.values(state).some(v => v.uploading)

  return (
    <div className="space-y-6">
      {/* Форма загрузки */}
      <div className="card p-6 space-y-5">
        <h3 className="font-medium text-gray-800">Загрузка фотографий</h3>
        <p className="text-sm text-gray-400">Выберите файлы для каждого типа — все загрузятся параллельно</p>

        <div className="space-y-4">
          {(['portrait', 'group', 'teacher'] as const).map(t => {
            const s = state[t]
            const pct = s.files.length > 0 && s.uploading ? Math.round(s.done / s.files.length * 100) : 0
            return (
              <div key={t} className="border border-gray-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">{typeLabel(t)}</span>
                  {s.files.length > 0 && !s.uploading && (
                    <span className="text-xs text-blue-600">{s.files.length} файлов выбрано</span>
                  )}
                  {s.uploading && (
                    <span className="text-xs text-blue-600">{s.done} / {s.files.length} загружено</span>
                  )}
                </div>
                {s.uploading ? (
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                ) : (
                  <input
                    type="file" multiple accept="image/*"
                    onChange={e => setTypeState(t, { files: Array.from(e.target.files ?? []) })}
                    className="block w-full text-sm text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:bg-blue-50 file:text-blue-600 hover:file:bg-blue-100"
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
        >
          {anyUploading
            ? `Загружаю... (${Object.values(state).reduce((s, v) => s + v.done, 0)} / ${totalFiles})`
            : totalFiles > 0 ? `▶ Загрузить все (${totalFiles} фото)` : 'Выберите файлы выше'}
        </button>
      </div>

      {/* Галерея */}
      <div className="card p-6">
        <div className="flex gap-3 mb-4">
          {(['portrait', 'group', 'teacher'] as const).map(t => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors
                ${activeTab === t ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {typeLabel(t)}
            </button>
          ))}
        </div>

        {loadingPhotos ? (
          <p className="text-sm text-gray-400">Загрузка...</p>
        ) : photos.length === 0 ? (
          <p className="text-sm text-gray-400">Нет загруженных фото</p>
        ) : (
          <>
            <p className="text-xs text-gray-400 mb-3">{photos.length} фото</p>
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
              {photos.map(photo => (
                <div key={photo.id} className="relative group aspect-square">
                  <img src={photo.url} alt={photo.filename} className="w-full h-full object-cover rounded-lg" loading="lazy" />
                  <button onClick={() => deletePhoto(photo)}
                    className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 text-xs items-center justify-center hidden group-hover:flex"
                    title="Удалить">✕</button>
                  <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[9px] px-1 py-0.5 rounded-b-lg truncate opacity-0 group-hover:opacity-100">
                    {photo.filename}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
// ─── Импорт CSV ───────────────────────────────────────────────────────────────

function ImportTab({ album, notify }: any) {
  const handle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    Papa.parse(file, {
      header: true,
      complete: async (result) => {
        const rows = result.data as { child_name: string; photo_filename: string }[]
        const res = await api('/api/admin', {
          method: 'POST',
          body: JSON.stringify({ action: 'import_tags', rows, album_id: album.id }),
        })
        const data = await res.json()
        notify(`Импортировано: ${data.linked}, пропущено: ${data.skipped}`)
      }
    })
  }

  return (
    <div className="card p-6 max-w-lg space-y-5">
      <h3 className="font-medium text-gray-800">Импорт разметки из CSV</h3>
      <div className="bg-gray-50 rounded-xl p-4 text-sm">
        <p className="font-medium text-gray-700 mb-2">Формат файла:</p>
        <pre className="bg-white border border-gray-200 rounded-lg p-3 text-xs overflow-auto text-gray-700">
{`child_name,photo_filename
Иванов Иван,IMG_001.jpg
Иванов Иван,IMG_045.jpg
Петрова Маша,IMG_001.jpg`}
        </pre>
        <p className="text-gray-500 text-xs mt-2">
          Имена должны точно совпадать с базой. Одно фото может быть у нескольких детей.
        </p>
      </div>
      <input
        type="file"
        accept=".csv"
        onChange={handle}
        className="block w-full text-sm text-gray-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-600 hover:file:bg-blue-100"
      />
    </div>
  )
}

// ─── Доплаты ──────────────────────────────────────────────────────────────────

function SurchargesTab({ album, notify }: any) {
  const [data, setData] = useState<any[]>([])

  useEffect(() => {
    api(`/api/admin?action=surcharges&album_id=${album.id}`)
      .then(r => r.json()).then(setData)
  }, [album.id])

  const total = data.reduce((s, r) => s + (r.surcharge ?? 0), 0)

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="card p-5">
        <div className="flex items-center justify-between mb-1">
          <span className="font-medium text-gray-800">Итого доплат</span>
          <span className="text-2xl font-medium text-green-600">{total} ₽</span>
        </div>
        <p className="text-xs text-gray-400">{data.length} учеников выбрали портрет на обложку</p>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Ученик</th>
              <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Родитель</th>
              <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Телефон</th>
              <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Вариант</th>
              <th className="px-4 py-3 text-right text-xs text-gray-500 font-medium">Сумма</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.map((r, i) => (
              <tr key={i}>
                <td className="px-4 py-3 font-medium text-gray-800">{r.child_name}</td>
                <td className="px-4 py-3 text-gray-500">{r.parent_name ?? '—'}</td>
                <td className="px-4 py-3 text-gray-500">{r.phone ?? '—'}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{r.cover_option === 'same' ? 'Тот же' : 'Другой'}</td>
                <td className="px-4 py-3 text-right text-green-600 font-medium">{r.surcharge} ₽</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.length === 0 && <p className="text-center py-8 text-gray-400 text-sm">Нет доплат</p>}
      </div>
    </div>
  )
}

// ─── Контакты ─────────────────────────────────────────────────────────────────

function ContactsTab({ album, notify }: any) {
  const [contacts, setContacts] = useState<any[]>([])

  useEffect(() => {
    api(`/api/admin?action=children&album_id=${album.id}`)
      .then(r => r.json())
      .then(data => setContacts(data.filter((c: any) => c.contact)))
  }, [album.id])

  const exportCsv = () => {
    const rows = contacts.map(c => [
      c.full_name, c.class,
      c.contact?.parent_name ?? '',
      c.contact?.phone ?? '',
      (c.referral ?? '').replace(/"/g, '""'),
    ].map(v => `"${v}"`).join(','))
    const csv = 'Ученик,Класс,Родитель,Телефон,Рекомендации\n' + rows.join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'contacts.csv'; a.click()
    notify('Контакты скачаны!')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{contacts.length} родителей оставили контакты</p>
        <button onClick={exportCsv} className="btn-primary text-sm">⬇ Скачать CSV</button>
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Ученик</th>
              <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Класс</th>
              <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Родитель</th>
              <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Телефон</th>
              <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Рекомендации 🎁</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {contacts.map((c: any) => (
              <tr key={c.id}>
                <td className="px-4 py-3 font-medium text-gray-800">{c.full_name}</td>
                <td className="px-4 py-3 text-gray-500">{c.class}</td>
                <td className="px-4 py-3 text-gray-500">{c.contact?.parent_name}</td>
                <td className="px-4 py-3 text-blue-600 whitespace-nowrap">{c.contact?.phone}</td>
                <td className="px-4 py-3 text-gray-600 whitespace-pre-wrap">{c.referral || <span className="text-gray-300">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {contacts.length === 0 && <p className="text-center py-8 text-gray-400 text-sm">Нет контактов</p>}
      </div>
    </div>
  )
}

// ─── Учителя ─────────────────────────────────────────────────────────────────

function TeachersTab({ album, notify }: any) {
  const [teachers, setTeachers] = useState<any[]>([])
  const [responsible, setResponsible] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const load = async (autoCreate = false) => {
    setLoading(true)
    const [t, r] = await Promise.all([
      api(`/api/admin?action=teachers&album_id=${album.id}`).then(r => r.json()),
      api(`/api/admin?action=responsible&album_id=${album.id}`).then(r => r.json()),
    ])
    setTeachers(Array.isArray(t) ? t : [])
    if (r?.id) {
      setResponsible(r)
      setLoading(false)
    } else {
      // Автоматически создаём ответственного если нет
      const res = await api('/api/admin', {
        method: 'POST',
        body: JSON.stringify({ action: 'create_responsible', album_id: album.id, full_name: 'Ответственный родитель', phone: '' }),
      })
      const created = await res.json()
      setResponsible(created?.id ? created : null)
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [album.id])

  const addTeacher = async () => {
    await api('/api/admin', {
      method: 'POST',
      body: JSON.stringify({ action: 'add_teacher', album_id: album.id }),
    })
    notify('Учитель добавлен')
    load()
  }

  const createResponsible = async () => {
    const res = await api('/api/admin', {
      method: 'POST',
      body: JSON.stringify({ action: 'create_responsible', album_id: album.id, full_name: 'Ответственный родитель', phone: '' }),
    })
    const data = await res.json()
    if (data.id) { notify('Ответственный создан'); load() }
    else notify('Ошибка', 'err')
  }

  const copyLink = (token: string) => {
    navigator.clipboard.writeText(`${location.origin}/teacher/${token}`)
    notify('Ссылка скопирована!')
  }

  if (loading) return <div className="text-center py-12 text-gray-400 text-sm">Загрузка...</div>

  return (
    <div className="space-y-6 max-w-2xl">

      {/* Ответственный родитель */}
      <div className="card p-5">
        <h3 className="font-medium text-gray-800 mb-3">Ответственный родитель</h3>
        {responsible ? (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-700">{responsible.full_name}</p>
              <p className="text-xs text-gray-400 mt-0.5">{responsible.phone || 'Телефон не указан'}</p>
              {responsible.submitted_at && <span className="badge-green mt-1">✓ Заполнил</span>}
            </div>
            <button onClick={() => copyLink(responsible.access_token)} className="btn-secondary text-sm">
              Копировать ссылку
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-400">Ответственный не создан</p>
            <button onClick={createResponsible} className="btn-primary text-sm">+ Создать</button>
          </div>
        )}
      </div>

      {/* Учителя */}
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-gray-800">Учителя ({teachers.length})</h3>
        <button onClick={addTeacher} className="btn-primary text-sm">+ Добавить учителя</button>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">№</th>
              <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">ФИО</th>
              <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Должность</th>
              <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Статус</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {teachers.map((t: any, i: number) => (
              <tr key={t.id}>
                <td className="px-4 py-3 text-gray-400">{i + 1}</td>
                <td className="px-4 py-3 font-medium text-gray-800">{t.full_name || <span className="text-gray-300 italic">не заполнено</span>}</td>
                <td className="px-4 py-3 text-gray-500">{t.position || '—'}</td>
                <td className="px-4 py-3">
                  {t.submitted_at
                    ? <span className="badge-green">✓ Готово</span>
                    : <span className="badge-gray">Ожидает</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {teachers.length === 0 && <p className="text-center py-8 text-gray-400 text-sm">Нет учителей</p>}
      </div>
    </div>
  )
}

// ─── Шаблоны ─────────────────────────────────────────────────────────────────

function TemplatesTab({ notify }: any) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [creating, setCreating] = useState(false)
  const emptyForm = { title: '', cover_mode: 'none', cover_price: '0', group_enabled: true, group_min: '2', group_max: '2', group_exclusive: true, text_enabled: true, text_max_chars: '500' }
  const [form, setForm] = useState(emptyForm)

  const load = () => api('/api/admin?action=templates').then(r => r.json()).then(setTemplates)
  useEffect(() => { load() }, [])

  const create = async () => {
    const res = await api('/api/admin', {
      method: 'POST',
      body: JSON.stringify({
        action: 'create_template',
        title: form.title,
        cover_mode: form.cover_mode,
        cover_price: parseInt(form.cover_price),
        group_enabled: form.group_enabled,
        group_min: form.group_enabled ? parseInt(form.group_min) : 0,
        group_max: form.group_enabled ? parseInt(form.group_max) : 0,
        group_exclusive: form.group_exclusive,
        text_enabled: form.text_enabled,
        text_max_chars: parseInt(form.text_max_chars),
      }),
    })
    if (res.ok) { notify('Шаблон создан!'); setCreating(false); setForm(emptyForm); load() }
    else notify('Ошибка', 'err')
  }

  const del = async (id: string, title: string) => {
    if (!confirm(`Удалить шаблон «${title}»?`)) return
    await api('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'delete_template', id }) })
    notify('Шаблон удалён')
    load()
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">Шаблоны ускоряют создание альбомов — параметры заполняются автоматически</p>
        <button onClick={() => setCreating(!creating)} className="btn-primary text-sm">+ Новый шаблон</button>
      </div>

      {creating && (
        <div className="card p-5 space-y-4">
          <h3 className="font-medium text-gray-800">Новый шаблон</h3>

          <div>
            <label className="text-xs text-gray-500 block mb-1">Название шаблона *</label>
            <input className="input" placeholder="Универсал" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </div>

          {/* Обложка */}
          <div className="border border-gray-100 rounded-xl p-4 space-y-3">
            <p className="text-sm font-medium text-gray-700">Портрет на обложку</p>
            <div className="flex flex-wrap gap-2">
              {[{ v: 'none', l: 'Без портрета' }, { v: 'same', l: 'Тот же (бесплатно)' }, { v: 'optional', l: 'Другой (доплата)' }, { v: 'required', l: 'Обязателен' }].map(({ v, l }) => (
                <button key={v} onClick={() => setForm(f => ({ ...f, cover_mode: v }))}
                  className={`px-3 py-1.5 rounded-xl text-sm border transition-colors ${form.cover_mode === v ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>{l}</button>
              ))}
            </div>
            {(form.cover_mode === 'optional' || form.cover_mode === 'required') && (
              <div className="flex items-center gap-3">
                <label className="text-xs text-gray-500">Доплата (₽)</label>
                <input className="input w-28" type="number" value={form.cover_price} onChange={e => setForm(f => ({ ...f, cover_price: e.target.value }))} />
              </div>
            )}
          </div>

          {/* Групповые */}
          <div className="border border-gray-100 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700">Групповые фото</p>
              <button onClick={() => setForm(f => ({ ...f, group_enabled: !f.group_enabled }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.group_enabled ? 'bg-blue-500' : 'bg-gray-200'}`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.group_enabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
            {form.group_enabled && (
              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Минимум</label>
                    <input className="input w-20" type="number" min="0" value={form.group_min} onChange={e => setForm(f => ({ ...f, group_min: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Максимум</label>
                    <input className="input w-20" type="number" min="1" value={form.group_max} onChange={e => setForm(f => ({ ...f, group_max: e.target.value }))} />
                  </div>
                  <p className="text-xs text-blue-500 mt-4">
                    {form.group_min === form.group_max ? `Ровно ${form.group_min} фото` : `От ${form.group_min} до ${form.group_max}`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => setForm(f => ({ ...f, group_exclusive: !f.group_exclusive }))}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${form.group_exclusive ? 'bg-blue-500' : 'bg-gray-200'}`}>
                    <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${form.group_exclusive ? 'translate-x-5' : 'translate-x-1'}`} />
                  </button>
                  <span className="text-sm text-gray-600">Эксклюзивный выбор</span>
                </div>
              </div>
            )}
          </div>

          {/* Текст */}
          <div className="border border-gray-100 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700">Текст от ученика</p>
              <button onClick={() => setForm(f => ({ ...f, text_enabled: !f.text_enabled }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.text_enabled ? 'bg-blue-500' : 'bg-gray-200'}`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.text_enabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
            {form.text_enabled && (
              <div className="flex items-center gap-3">
                <label className="text-xs text-gray-500">Макс. символов</label>
                <input className="input w-24" type="number" value={form.text_max_chars} onChange={e => setForm(f => ({ ...f, text_max_chars: e.target.value }))} />
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button className="btn-primary" onClick={create} disabled={!form.title}>Создать</button>
            <button className="btn-secondary" onClick={() => { setCreating(false); setForm(emptyForm) }}>Отмена</button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Шаблон</th>
              <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Групповые</th>
              <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Текст</th>
              <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Обложка</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {templates.map(t => (
              <tr key={t.id}>
                <td className="px-4 py-3 font-medium text-gray-800">{t.title}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {t.group_enabled
                    ? t.group_min === t.group_max ? `${t.group_min} фото${t.group_exclusive ? ' · эксклюзив' : ''}` : `${t.group_min}–${t.group_max} фото${t.group_exclusive ? ' · эксклюзив' : ''}`
                    : '—'}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">{t.text_enabled ? `до ${t.text_max_chars} симв.` : '—'}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {t.cover_mode === 'none' ? '—' : t.cover_mode === 'same' ? 'Тот же' : `Доплата ${t.cover_price} ₽`}
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => del(t.id, t.title)} className="text-red-400 hover:text-red-600 text-xs hover:underline">Удалить</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {templates.length === 0 && <p className="text-center py-8 text-gray-400 text-sm">Нет шаблонов</p>}
      </div>
    </div>
  )
}
