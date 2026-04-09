'use client'

import { useState, useEffect } from 'react'
import Papa from 'papaparse'

const secret = () => typeof window !== 'undefined' ? localStorage.getItem('admin_secret') ?? '' : ''

const api = (path: string, opts?: RequestInit) =>
  fetch(path, { ...opts, headers: { 'x-admin-secret': secret(), 'Content-Type': 'application/json', ...opts?.headers } })

type Tab = 'overview' | 'children' | 'upload' | 'import' | 'surcharges' | 'contacts' | 'teachers'
type Album = { id: string; title: string; classes: string[]; cover_mode: string; cover_price: number; deadline: string | null; stats?: { total: number; submitted: number; in_progress: number } }
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
              <button onClick={() => { setSelectedAlbum(null); setStats(null) }} className="btn-ghost text-xs">
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
              <OverviewTab stats={stats} album={selectedAlbum} notify={notify} />
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
  const [form, setForm] = useState({ title: '', classes: '', cover_mode: 'optional', cover_price: '300', deadline: '' })
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'done' | 'pending'>('all')
  const [sortBy, setSortBy] = useState<'created' | 'deadline' | 'progress'>('created')

  const create = async () => {
    const res = await api('/api/admin', {
      method: 'POST',
      body: JSON.stringify({
        action: 'create_album',
        title: form.title,
        classes: form.classes.split(',').map(s => s.trim()).filter(Boolean),
        cover_mode: form.cover_mode,
        cover_price: parseInt(form.cover_price),
        deadline: form.deadline || null,
      }),
    })
    if (res.ok) { notify('Альбом создан!'); setCreating(false); onRefresh() }
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
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-medium text-gray-800">Альбомы</h2>
        <button onClick={() => setCreating(!creating)} className="btn-primary text-sm">
          + Новый альбом
        </button>
      </div>

      {creating && (
        <div className="card p-5 mb-6">
          <h3 className="font-medium text-gray-800 mb-4">Новый альбом</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Название</label>
              <input className="input" placeholder="Выпускной 11А 2025" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Классы (через запятую)</label>
              <input className="input" placeholder="11А, 11Б" value={form.classes} onChange={e => setForm(f => ({ ...f, classes: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Режим обложки</label>
              <select className="input" value={form.cover_mode} onChange={e => setForm(f => ({ ...f, cover_mode: e.target.value }))}>
                <option value="none">Без портрета на обложке</option>
                <option value="same">Тот же портрет (авто)</option>
                <option value="optional">Выбор родителя (с доплатой)</option>
                <option value="required">Обязателен (все платят)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Доплата за обложку (₽)</label>
              <input className="input" type="number" value={form.cover_price} onChange={e => setForm(f => ({ ...f, cover_price: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Дедлайн (необязательно)</label>
              <input className="input" type="datetime-local" value={form.deadline} onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))} />
            </div>
          </div>
          <div className="flex gap-3">
            <button className="btn-primary" onClick={create} disabled={!form.title || !form.classes}>Создать</button>
            <button className="btn-secondary" onClick={() => setCreating(false)}>Отмена</button>
          </div>
        </div>
      )}

      {/* Поиск и фильтры */}
      {albums.length > 0 && (
        <div className="flex flex-wrap gap-3 mb-4">
          <input
            type="text"
            placeholder="🔍 Поиск по названию..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input flex-1 min-w-[200px] text-sm"
          />
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)} className="input text-sm w-auto">
            <option value="all">Все статусы</option>
            <option value="done">Все готовы</option>
            <option value="pending">Есть незавершённые</option>
          </select>
          <select value={sortBy} onChange={e => setSortBy(e.target.value as any)} className="input text-sm w-auto">
            <option value="created">По дате создания</option>
            <option value="deadline">По дедлайну</option>
            <option value="progress">По % готовности</option>
          </select>
        </div>
      )}

      {albums.length === 0 && (
        <div className="card p-12 text-center text-gray-400 text-sm">Нет альбомов. Создайте первый.</div>
      )}

      {albums.length > 0 && filtered.length === 0 && (
        <div className="card p-12 text-center text-gray-400 text-sm">Ничего не найдено. Попробуйте изменить фильтры.</div>
      )}

      <div className="grid gap-3">
        {filtered.map((a: Album) => {
          const s = a.stats ?? { total: 0, submitted: 0, in_progress: 0 }
          const pct = s.total ? Math.round(s.submitted / s.total * 100) : 0
          const allDone = s.total > 0 && s.submitted === s.total

          const now = new Date()
          const deadline = a.deadline ? new Date(a.deadline) : null
          const daysLeft = deadline ? Math.ceil((deadline.getTime() - now.getTime()) / 86400000) : null
          const deadlineOverdue = daysLeft !== null && daysLeft < 0
          const deadlineSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 3

          return (
            <button
              key={a.id}
              onClick={() => onSelect(a)}
              className="card p-5 text-left hover:border-blue-200 hover:shadow-md transition-all"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-gray-800">{a.title}</p>
                    {allDone && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">✓ Все готовы</span>
                    )}
                    {!allDone && s.total > 0 && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                        {s.total - s.submitted} не завершили
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    <p className="text-sm text-gray-400">{a.classes.join(', ')}</p>
                    {deadline && (
                      <span className={`text-xs font-medium ${deadlineOverdue ? 'text-red-500' : deadlineSoon ? 'text-amber-600' : 'text-gray-400'}`}>
                        {deadlineOverdue
                          ? `⚠ Просрочен ${Math.abs(daysLeft!)} дн. назад`
                          : daysLeft === 0 ? '⏰ Сегодня дедлайн'
                          : daysLeft === 1 ? '⏰ Завтра дедлайн'
                          : `📅 ${deadline.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} · ещё ${daysLeft} дн.`}
                      </span>
                    )}
                  </div>

                  {s.total > 0 && (
                    <div className="mt-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-gray-400">
                          {s.submitted} из {s.total} подтвердили
                          {s.in_progress > 0 && ` · ${s.in_progress} в процессе`}
                        </span>
                        <span className={`text-xs font-semibold ${allDone ? 'text-green-600' : 'text-blue-600'}`}>{pct}%</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${allDone ? 'bg-green-500' : 'bg-blue-500'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {s.total === 0 && <p className="text-xs text-gray-300 mt-2">Нет учеников</p>}
                </div>
                <span className="text-blue-400 mt-1 shrink-0">→</span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Обзор ────────────────────────────────────────────────────────────────────

function OverviewTab({ stats, album, notify }: any) {
  const pct = stats.total ? Math.round(stats.submitted / stats.total * 100) : 0

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
      </div>
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
        notify(`Импортировано: ${added}, пропущено: ${skipped}`)
        onRefresh()
        e.target.value = ''
      }
    })
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

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left">
              <th className="px-4 py-3 text-xs text-gray-500 font-medium">Ученик</th>
              <th className="px-4 py-3 text-xs text-gray-500 font-medium">Класс</th>
              <th className="px-4 py-3 text-xs text-gray-500 font-medium">Статус</th>
              <th className="px-4 py-3 text-xs text-gray-500 font-medium">Родитель</th>
              <th className="px-4 py-3 text-xs text-gray-500 font-medium">Обложка</th>
              <th className="px-4 py-3 text-xs text-gray-500 font-medium">Ссылка</th>
              <th className="px-4 py-3 text-xs text-gray-500 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((c: Child) => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-800">{c.full_name}</td>
                <td className="px-4 py-3 text-gray-500">{c.class}</td>
                <td className="px-4 py-3">
                  {c.submitted_at
                    ? <span className="badge-green">✓ Готово</span>
                    : c.started_at
                      ? <span className="badge-amber">В процессе</span>
                      : <span className="badge-gray">Не начал</span>}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">{c.contact?.parent_name ?? '—'}</td>
                <td className="px-4 py-3 text-xs">
                  {c.cover?.surcharge > 0
                    ? <span className="text-green-600 font-medium">+{c.cover.surcharge} ₽</span>
                    : <span className="text-gray-400">—</span>}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => copyLink(c.access_token, c.full_name)}
                    className="text-blue-500 hover:text-blue-700 text-xs hover:underline"
                  >
                    Копировать ссылку
                  </button>
                </td>
                <td className="px-4 py-3">
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
    </div>
  )
}

// ─── Загрузка фото ────────────────────────────────────────────────────────────

function UploadTab({ album, notify }: any) {
  const [type, setType] = useState('portrait')
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)

  const upload = async () => {
    setUploading(true)
    const { createClient } = await import('@supabase/supabase-js')
    const imageCompression = (await import('browser-image-compression')).default
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      let compressed = file
      try {
        compressed = await imageCompression(file, {
          maxSizeMB: 1.5,
          maxWidthOrHeight: 2048,
          useWebWorker: true,
        })
      } catch (e) {}
      const path = `${album.id}/${type}/${Date.now()}_${file.name}`
      const { error: upErr } = await sb.storage.from('photos').upload(path, compressed, { upsert: false })
      if (!upErr) {
        await fetch('/api/admin/register-photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret() },
          body: JSON.stringify({ album_id: album.id, filename: file.name, storage_path: path, type }),
        })
      }
      setProgress(Math.round(((i + 1) / files.length) * 100))
    }
    setUploading(false)
    setFiles([])
    setProgress(0)
    notify(`Загружено ${files.length} фото (${type})`)
  }

  return (
    <div className="card p-6 space-y-5 max-w-lg">
      <h3 className="font-medium text-gray-800">Загрузка фотографий</h3>

      <div>
        <label className="text-xs text-gray-500 block mb-2">Тип фотографий</label>
        <div className="flex gap-3">
          {[['portrait', 'Портреты учеников'], ['group', 'Групповые / с друзьями'], ['teacher', 'Учителя']].map(([v, l]) => (
            <button
              key={v}
              onClick={() => setType(v)}
              className={`px-4 py-2 rounded-xl border text-sm transition-colors
                ${type === v ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs text-gray-500 block mb-2">Выберите файлы</label>
        <input
          type="file"
          multiple
          accept="image/*"
          onChange={e => setFiles(Array.from(e.target.files ?? []))}
          className="block w-full text-sm text-gray-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:bg-blue-50 file:text-blue-600 hover:file:bg-blue-100"
        />
      </div>

      {files.length > 0 && (
        <p className="text-sm text-gray-500">Выбрано: {files.length} файлов</p>
      )}

      {uploading && (
        <div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-xs text-gray-400 mt-1">{progress}%</p>
        </div>
      )}

      <button
        className="btn-primary"
        onClick={upload}
        disabled={files.length === 0 || uploading}
      >
        {uploading ? 'Загружаю...' : `Загрузить ${files.length} фото`}
      </button>
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
    const rows = contacts.map(c => `"${c.full_name}","${c.class}","${c.contact?.parent_name ?? ''}","${c.contact?.phone ?? ''}"`)
    const csv = 'Ученик,Класс,Родитель,Телефон\n' + rows.join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'contacts.csv'; a.click()
    notify('Контакты скачаны!')
  }

  return (
    <div className="space-y-4 max-w-2xl">
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
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {contacts.map((c: any) => (
              <tr key={c.id}>
                <td className="px-4 py-3 font-medium text-gray-800">{c.full_name}</td>
                <td className="px-4 py-3 text-gray-500">{c.class}</td>
                <td className="px-4 py-3 text-gray-500">{c.contact?.parent_name}</td>
                <td className="px-4 py-3 text-blue-600">{c.contact?.phone}</td>
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

  const load = async () => {
    setLoading(true)
    const [t, r] = await Promise.all([
      api(`/api/admin?action=teachers&album_id=${album.id}`).then(r => r.json()),
      api(`/api/admin?action=responsible&album_id=${album.id}`).then(r => r.json()),
    ])
    setTeachers(Array.isArray(t) ? t : [])
    setResponsible(r?.id ? r : null)
    setLoading(false)
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
