'use client'
import { useState, useEffect, useCallback } from 'react'

// ─── Типы ─────────────────────────────────────────────────────────────────────

interface Client {
  id: string
  name: string
  city?: string
  address?: string
  website?: string
  notes?: string
  tags: string[]
  created_at: string
}

interface Contact {
  id: string
  client_id?: string
  full_name: string
  role?: string
  phone?: string
  email?: string
  notes?: string
  birthday?: string
}

interface Stage {
  id: string
  name: string
  color: string
  sort_order: number
  is_closed: boolean
}

interface Deal {
  id: string
  title: string
  client_id?: string
  stage_id: string
  album_id?: string
  amount?: number
  deadline?: string
  assigned_to?: string
  notes?: string
  created_at: string
  closed_at?: string
  deal_stages?: { name: string; color: string }
  clients?: { name: string; city?: string }
  albums?: { title: string; city?: string; year?: number }
}

interface Task {
  id: string
  title: string
  deal_id?: string
  client_id?: string
  due_date?: string
  assigned_to?: string
  completed_at?: string
  created_at: string
  deals?: { title: string }
  clients?: { name: string }
}

interface TeamMember {
  id: string
  full_name: string
  role: string
}

interface AlbumOption {
  id: string
  title: string
  city?: string
  year?: number
}

// ─── Хелперы ──────────────────────────────────────────────────────────────────

function formatDate(iso?: string) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function isOverdue(due?: string) {
  if (!due) return false
  return new Date(due) < new Date()
}

// ─── Компонент ────────────────────────────────────────────────────────────────

export default function CRMModal({ onClose, currentUserId }: {
  onClose: () => void
  currentUserId: string
}) {
  const [tab, setTab] = useState<'clients' | 'kanban' | 'tasks' | 'stages'>('kanban')

  // данные
  const [clients, setClients] = useState<Client[]>([])
  const [stages, setStages] = useState<Stage[]>([])
  const [deals, setDeals] = useState<Deal[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [members, setMembers] = useState<TeamMember[]>([])
  const [albums, setAlbums] = useState<AlbumOption[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // backdrop
  const [backdropStart, setBackdropStart] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [stagesRes, dealsRes, clientsRes, tasksRes, membersRes, albumsRes] = await Promise.all([
        fetch('/api/crm?action=stages').then(r => r.json()),
        fetch('/api/crm?action=deals').then(r => r.json()),
        fetch('/api/crm?action=clients').then(r => r.json()),
        fetch('/api/crm?action=tasks').then(r => r.json()),
        fetch('/api/crm?action=team_members').then(r => r.json()),
        fetch('/api/crm?action=albums_list').then(r => r.json()),
      ])
      setStages(stagesRes.stages ?? [])
      setDeals(dealsRes.deals ?? [])
      setClients(clientsRes.clients ?? [])
      setTasks(tasksRes.tasks ?? [])
      setMembers(membersRes.members ?? [])
      setAlbums(albumsRes.albums ?? [])
    } catch {
      setError('Не удалось загрузить данные')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/crm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return res.json()
  }

  // ── Канбан: перемещение сделки ──────────────────────────────
  const moveDeal = async (dealId: string, stageId: string) => {
    setDeals(prev => prev.map(d => d.id === dealId ? { ...d, stage_id: stageId } : d))
    await post({ action: 'move_deal', id: dealId, stage_id: stageId })
  }

  const overdueTasks = tasks.filter(t => isOverdue(t.due_date) && !t.completed_at)

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-6 pb-6 px-4 overflow-y-auto"
      onMouseDown={e => { if (e.target === e.currentTarget) setBackdropStart(true) }}
      onMouseUp={e => { if (backdropStart && e.target === e.currentTarget) onClose(); setBackdropStart(false) }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-7xl min-h-[80vh] flex flex-col">
        {/* Шапка */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>CRM</h2>
            {/* Вкладки */}
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              {([
                { key: 'kanban', label: '📋 Воронка' },
                { key: 'clients', label: '🏫 Клиенты' },
                { key: 'tasks', label: `✅ Задачи${overdueTasks.length ? ` · ${overdueTasks.length}` : ''}` },
                { key: 'stages', label: '⚙️ Этапы' },
              ] as const).map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`px-3 py-1.5 text-sm rounded-md font-medium transition-all ${
                    tab === t.key ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        {/* Контент */}
        <div className="flex-1 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-64 text-gray-400">Загрузка...</div>
          ) : error ? (
            <div className="flex items-center justify-center h-64 text-red-500">{error}</div>
          ) : tab === 'kanban' ? (
            <KanbanView
              stages={stages} deals={deals} clients={clients}
              members={members} albums={albums}
              onMoveDeal={moveDeal}
              onCreateDeal={async (deal) => {
                const res = await post({ action: 'create_deal', ...deal })
                if (res.deal) setDeals(prev => [res.deal, ...prev])
              }}
              onUpdateDeal={async (deal) => {
                const res = await post({ action: 'update_deal', ...deal })
                if (res.deal) setDeals(prev => prev.map(d => d.id === res.deal.id ? res.deal : d))
              }}
              onDeleteDeal={async (id) => {
                await post({ action: 'delete_deal', id })
                setDeals(prev => prev.filter(d => d.id !== id))
              }}
              onAlbumCreated={(dealId, albumId) => {
                setDeals(prev => prev.map(d => d.id === dealId ? { ...d, album_id: albumId } : d))
              }}
            />
          ) : tab === 'clients' ? (
            <ClientsView
              clients={clients} deals={deals}
              onCreateClient={async (c) => {
                const res = await post({ action: 'create_client', ...c })
                if (res.client) setClients(prev => [...prev, res.client].sort((a, b) => a.name.localeCompare(b.name)))
              }}
              onUpdateClient={async (c) => {
                const res = await post({ action: 'update_client', ...c })
                if (res.client) setClients(prev => prev.map(cl => cl.id === res.client.id ? res.client : cl))
              }}
              onDeleteClient={async (id) => {
                if (!confirm('Удалить клиента? Связанные сделки останутся.')) return
                await post({ action: 'delete_client', id })
                setClients(prev => prev.filter(c => c.id !== id))
              }}
            />
          ) : tab === 'tasks' ? (
            <TasksView
              tasks={tasks} members={members} clients={clients} deals={deals}
              currentUserId={currentUserId}
              onCreateTask={async (t) => {
                const res = await post({ action: 'create_task', ...t })
                if (res.task) setTasks(prev => [...prev, res.task])
              }}
              onCompleteTask={async (id) => {
                await post({ action: 'complete_task', id })
                setTasks(prev => prev.filter(t => t.id !== id))
              }}
              onDeleteTask={async (id) => {
                await post({ action: 'delete_task', id })
                setTasks(prev => prev.filter(t => t.id !== id))
              }}
            />
          ) : (
            <StagesView
              stages={stages}
              onSave={async (updated) => {
                const res = await post({ action: 'update_stages', stages: updated })
                if (res.stages) setStages(res.stages)
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Канбан ───────────────────────────────────────────────────────────────────

function KanbanView({
  stages, deals, clients, members, albums,
  onMoveDeal, onCreateDeal, onUpdateDeal, onDeleteDeal, onAlbumCreated,
}: {
  stages: Stage[]
  deals: Deal[]
  clients: Client[]
  members: TeamMember[]
  albums: AlbumOption[]
  onMoveDeal: (dealId: string, stageId: string) => void
  onCreateDeal: (d: Record<string, unknown>) => Promise<void>
  onUpdateDeal: (d: Record<string, unknown>) => Promise<void>
  onDeleteDeal: (id: string) => Promise<void>
  onAlbumCreated: (dealId: string, albumId: string) => void
}) {
  const [editDeal, setEditDeal] = useState<Deal | null | 'new'>(null)
  const [newStageId, setNewStageId] = useState('')

  const openNew = (stageId: string) => {
    setNewStageId(stageId)
    setEditDeal('new')
  }

  return (
    <div className="h-full overflow-x-auto overflow-y-hidden">
      <div className="flex gap-3 p-4 h-full" style={{ minWidth: `${stages.length * 260}px` }}>
        {stages.map(stage => {
          const stageDeals = deals.filter(d => d.stage_id === stage.id)
          const total = stageDeals.reduce((s, d) => s + (d.amount ?? 0), 0)
          return (
            <div key={stage.id} className="flex flex-col w-60 flex-shrink-0 bg-gray-50 rounded-xl overflow-hidden">
              {/* Заголовок колонки */}
              <div className="px-3 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: stage.color }} />
                  <span className="text-sm font-semibold text-gray-700">{stage.name}</span>
                  <span className="text-xs text-gray-400 bg-gray-200 rounded-full px-1.5">{stageDeals.length}</span>
                </div>
                {total > 0 && (
                  <span className="text-xs text-gray-400">{total.toLocaleString('ru-RU')} ₽</span>
                )}
              </div>

              {/* Карточки */}
              <div className="flex-1 overflow-y-auto px-2 pb-2 flex flex-col gap-2">
                {stageDeals.map(deal => (
                  <DealCard
                    key={deal.id}
                    deal={deal}
                    stages={stages}
                    clients={clients}
                    onMove={onMoveDeal}
                    onEdit={() => setEditDeal(deal)}
                    onDelete={() => onDeleteDeal(deal.id)}
                    onAlbumCreated={(albumId) => onAlbumCreated(deal.id, albumId)}
                  />
                ))}
                <button
                  onClick={() => openNew(stage.id)}
                  className="w-full py-1.5 text-sm text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors text-left px-2"
                >
                  + Сделка
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Форма создания/редактирования сделки */}
      {editDeal !== null && (
        <DealFormModal
          deal={editDeal === 'new' ? null : editDeal}
          defaultStageId={editDeal === 'new' ? newStageId : undefined}
          stages={stages}
          clients={clients}
          members={members}
          albums={albums}
          onSave={async (data) => {
            if (editDeal === 'new') await onCreateDeal(data)
            else await onUpdateDeal({ id: (editDeal as Deal).id, ...data })
            setEditDeal(null)
          }}
          onClose={() => setEditDeal(null)}
        />
      )}
    </div>
  )
}

function DealCard({ deal, stages, clients, onMove, onEdit, onDelete, onAlbumCreated }: {
  deal: Deal
  stages: Stage[]
  clients: Client[]
  onMove: (id: string, stageId: string) => void
  onEdit: () => void
  onDelete: () => void
  onAlbumCreated: (albumId: string) => void
}) {
  const [showMove, setShowMove] = useState(false)
  const [showAlbumForm, setShowAlbumForm] = useState(false)
  const isOverdueFlag = deal.deadline && new Date(deal.deadline) < new Date() && !deal.closed_at
  const clientForDeal = clients.find(c => c.id === deal.client_id)

  return (
    <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-100 hover:border-gray-200 transition-all group cursor-pointer"
      onClick={onEdit}>
      <div className="flex items-start justify-between gap-1">
        <p className="text-sm font-medium text-gray-900 leading-snug flex-1">{deal.title}</p>
        <button
          className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 text-lg leading-none flex-shrink-0"
          onClick={e => { e.stopPropagation(); if (confirm('Удалить сделку?')) onDelete() }}
        >×</button>
      </div>
      {deal.clients && (
        <p className="text-xs text-gray-400 mt-1">{deal.clients.name}</p>
      )}
      {deal.albums && (
        <p className="text-xs text-blue-400 mt-0.5">📚 {deal.albums.title}</p>
      )}
      <div className="flex items-center justify-between mt-2 gap-2">
        {deal.amount ? (
          <span className="text-xs font-medium text-gray-600">{deal.amount.toLocaleString('ru-RU')} ₽</span>
        ) : <span />}
        {deal.deadline && (
          <span className={`text-xs ${isOverdueFlag ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
            {isOverdueFlag ? '⚠️ ' : ''}{formatDate(deal.deadline)}
          </span>
        )}
      </div>
      {/* Быстрое перемещение */}
      <div className="mt-2 relative">
        <div className="flex gap-2 items-center">
          <button
            className="text-xs text-gray-300 hover:text-gray-500 transition-colors"
            onClick={e => { e.stopPropagation(); setShowMove(!showMove) }}
          >
            Переместить ▾
          </button>
          {!deal.album_id && (
            <button
              className="text-xs text-blue-300 hover:text-blue-500 transition-colors ml-auto"
              onClick={e => { e.stopPropagation(); setShowAlbumForm(true) }}
            >
              + Альбом
            </button>
          )}
          {deal.albums && (
            <span className="text-xs text-green-500 ml-auto">✓ Альбом</span>
          )}
        </div>
        {showMove && (
          <div className="absolute top-5 left-0 z-10 bg-white rounded-lg shadow-lg border border-gray-100 py-1 min-w-[180px]">
            {stages.filter(s => s.id !== deal.stage_id).map(s => (
              <button
                key={s.id}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-2"
                onClick={e => { e.stopPropagation(); onMove(deal.id, s.id); setShowMove(false) }}
              >
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
                {s.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {showAlbumForm && (
        <QuickAlbumModal
          dealId={deal.id}
          suggestedTitle={deal.title}
          suggestedCity={clientForDeal?.city ?? ''}
          onCreated={(albumId) => { onAlbumCreated(albumId); setShowAlbumForm(false) }}
          onClose={() => setShowAlbumForm(false)}
        />
      )}
    </div>
  )
}

// ─── Форма сделки ─────────────────────────────────────────────────────────────

function DealFormModal({ deal, defaultStageId, stages, clients, members, albums, onSave, onClose }: {
  deal: Deal | null
  defaultStageId?: string
  stages: Stage[]
  clients: Client[]
  members: TeamMember[]
  albums: AlbumOption[]
  onSave: (data: Record<string, unknown>) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState({
    title: deal?.title ?? '',
    stage_id: deal?.stage_id ?? defaultStageId ?? stages[0]?.id ?? '',
    client_id: deal?.client_id ?? '',
    album_id: deal?.album_id ?? '',
    amount: deal?.amount ? String(deal.amount) : '',
    deadline: deal?.deadline ? deal.deadline.slice(0, 10) : '',
    assigned_to: deal?.assigned_to ?? '',
    notes: deal?.notes ?? '',
  })
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!form.title.trim()) return
    setBusy(true)
    await onSave({
      ...form,
      amount: form.amount ? parseFloat(form.amount) : null,
      client_id: form.client_id || null,
      album_id: form.album_id || null,
      assigned_to: form.assigned_to || null,
      deadline: form.deadline || null,
    })
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-60 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h3 className="font-bold text-lg mb-4">{deal ? 'Редактировать сделку' : 'Новая сделка'}</h3>
        <div className="space-y-3">
          <input className="input w-full" placeholder="Название сделки *" value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))} autoFocus />

          <select className="input w-full" value={form.stage_id} onChange={e => setForm(f => ({ ...f, stage_id: e.target.value }))}>
            {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          <select className="input w-full" value={form.client_id} onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}>
            <option value="">— Клиент (необязательно)</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}{c.city ? ` · ${c.city}` : ''}</option>)}
          </select>

          <select className="input w-full" value={form.album_id} onChange={e => setForm(f => ({ ...f, album_id: e.target.value }))}>
            <option value="">— Альбом (необязательно)</option>
            {albums.map(a => <option key={a.id} value={a.id}>{a.title}{a.city ? ` · ${a.city}` : ''}{a.year ? ` ${a.year}` : ''}</option>)}
          </select>

          <div className="flex gap-2">
            <input className="input flex-1" placeholder="Сумма ₽" type="number" value={form.amount}
              onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
            <input className="input flex-1" type="date" value={form.deadline}
              onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))} />
          </div>

          {members.length > 1 && (
            <select className="input w-full" value={form.assigned_to} onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))}>
              <option value="">— Ответственный</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </select>
          )}

          <textarea className="input w-full resize-none" rows={2} placeholder="Заметки"
            value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </div>
        <div className="flex gap-2 mt-4">
          <button className="btn-secondary flex-1" onClick={onClose}>Отмена</button>
          <button className="btn-primary flex-1" onClick={save} disabled={busy || !form.title.trim()}>
            {busy ? 'Сохраняем...' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Клиенты ──────────────────────────────────────────────────────────────────

function ClientsView({ clients, deals, onCreateClient, onUpdateClient, onDeleteClient }: {
  clients: Client[]
  deals: Deal[]
  onCreateClient: (c: Record<string, unknown>) => Promise<void>
  onUpdateClient: (c: Record<string, unknown>) => Promise<void>
  onDeleteClient: (id: string) => Promise<void>
}) {
  const [selected, setSelected] = useState<Client | null>(null)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [contactsLoading, setContactsLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editClient, setEditClient] = useState<Client | null>(null)
  const [search, setSearch] = useState('')

  const filtered = clients.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.city?.toLowerCase().includes(search.toLowerCase())
  )

  const clientDeals = (clientId: string) => deals.filter(d => d.client_id === clientId)

  const selectClient = async (client: Client) => {
    setSelected(client)
    setContactsLoading(true)
    try {
      const res = await fetch(`/api/crm?action=client_detail&id=${client.id}`)
      const data = await res.json()
      setContacts(data.contacts ?? [])
    } finally {
      setContactsLoading(false)
    }
  }

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/crm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return res.json()
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Список */}
      <div className="w-80 border-r border-gray-100 flex flex-col">
        <div className="p-3 border-b border-gray-100 flex gap-2">
          <input className="input flex-1 text-sm" placeholder="Поиск клиента..." value={search}
            onChange={e => setSearch(e.target.value)} />
          <button className="btn-primary text-sm px-3" onClick={() => { setEditClient(null); setShowForm(true) }}>+</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="p-6 text-center text-gray-400 text-sm">
              {clients.length === 0 ? 'Нет клиентов. Добавьте первого.' : 'Не найдено'}
            </div>
          )}
          {filtered.map(client => {
            const dCount = clientDeals(client.id).length
            return (
              <button
                key={client.id}
                onClick={() => selectClient(client)}
                className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors ${selected?.id === client.id ? 'bg-gray-50 border-l-2 border-l-gray-900' : ''}`}
              >
                <p className="font-medium text-sm text-gray-900">{client.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {client.city && `${client.city} · `}{dCount} сделок
                </p>
              </button>
            )
          })}
        </div>
      </div>

      {/* Детали */}
      <div className="flex-1 overflow-y-auto p-6">
        {selected ? (
          <ClientDetail
            client={selected}
            deals={clientDeals(selected.id)}
            contacts={contacts}
            contactsLoading={contactsLoading}
            onEdit={() => { setEditClient(selected); setShowForm(true) }}
            onDelete={() => { onDeleteClient(selected.id); setSelected(null) }}
            onCreateContact={async (data) => {
              const res = await post({ action: 'create_contact', client_id: selected.id, ...data })
              if (res.contact) setContacts(prev => [...prev, res.contact])
            }}
            onUpdateContact={async (data) => {
              const res = await post({ action: 'update_contact', ...data })
              if (res.contact) setContacts(prev => prev.map(c => c.id === res.contact.id ? res.contact : c))
            }}
            onDeleteContact={async (id) => {
              await post({ action: 'delete_contact', id })
              setContacts(prev => prev.filter(c => c.id !== id))
            }}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-300 text-sm">
            Выберите клиента из списка
          </div>
        )}
      </div>

      {/* Форма клиента */}
      {showForm && (
        <ClientFormModal
          client={editClient}
          onSave={async (data) => {
            if (editClient) {
              await onUpdateClient({ id: editClient.id, ...data })
              setSelected({ ...editClient, ...data } as Client)
            } else {
              await onCreateClient(data)
            }
            setShowForm(false)
          }}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  )
}

function ClientDetail({ client, deals, contacts, contactsLoading, onEdit, onDelete, onCreateContact, onUpdateContact, onDeleteContact }: {
  client: Client
  deals: Deal[]
  contacts: Contact[]
  contactsLoading: boolean
  onEdit: () => void
  onDelete: () => void
  onCreateContact: (data: Record<string, unknown>) => Promise<void>
  onUpdateContact: (data: Record<string, unknown>) => Promise<void>
  onDeleteContact: (id: string) => Promise<void>
}) {
  const [showContactForm, setShowContactForm] = useState(false)
  const [editContact, setEditContact] = useState<Contact | null>(null)

  return (
    <div>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-xl font-bold text-gray-900">{client.name}</h3>
          {client.city && <p className="text-gray-500 text-sm mt-0.5">{client.city}</p>}
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary text-sm" onClick={onEdit}>Изменить</button>
          <button className="btn-ghost text-sm text-red-400 hover:text-red-600" onClick={onDelete}>Удалить</button>
        </div>
      </div>

      {client.address && <p className="text-sm text-gray-600 mb-2">📍 {client.address}</p>}
      {client.website && (
        <p className="text-sm mb-2">
          🌐 <a href={client.website} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">{client.website}</a>
        </p>
      )}
      {client.notes && <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3 mb-4">{client.notes}</p>}

      {client.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {client.tags.map(tag => (
            <span key={tag} className="badge-blue text-xs px-2 py-0.5 rounded-full">{tag}</span>
          ))}
        </div>
      )}

      {/* Контакты */}
      <div className="flex items-center justify-between mb-2 mt-5">
        <h4 className="font-semibold text-sm text-gray-700">
          Контакты {!contactsLoading && `(${contacts.length})`}
        </h4>
        <button
          className="text-xs text-gray-400 hover:text-gray-700 border border-gray-200 rounded px-2 py-0.5"
          onClick={() => { setEditContact(null); setShowContactForm(true) }}
        >
          + Добавить
        </button>
      </div>
      {contactsLoading ? (
        <p className="text-xs text-gray-300">Загрузка...</p>
      ) : contacts.length === 0 ? (
        <p className="text-sm text-gray-400 mb-4">Нет контактов</p>
      ) : (
        <div className="space-y-2 mb-4">
          {contacts.map(c => (
            <div key={c.id} className="flex items-start gap-3 py-2 px-3 bg-gray-50 rounded-lg group">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800">{c.full_name}</p>
                {c.role && <p className="text-xs text-gray-500">{c.role}</p>}
                <div className="flex gap-3 mt-0.5">
                  {c.phone && <a href={`tel:${c.phone}`} className="text-xs text-blue-500 hover:underline">{c.phone}</a>}
                  {c.email && <a href={`mailto:${c.email}`} className="text-xs text-blue-500 hover:underline">{c.email}</a>}
                </div>
                {c.notes && <p className="text-xs text-gray-400 mt-0.5">{c.notes}</p>}
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button className="text-xs text-gray-400 hover:text-gray-700 px-1"
                  onClick={() => { setEditContact(c); setShowContactForm(true) }}>✏️</button>
                <button className="text-xs text-gray-300 hover:text-red-400 px-1"
                  onClick={() => { if (confirm('Удалить контакт?')) onDeleteContact(c.id) }}>×</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Сделки клиента */}
      <h4 className="font-semibold text-sm text-gray-700 mb-2 mt-2">Сделки ({deals.length})</h4>
      {deals.length === 0 ? (
        <p className="text-sm text-gray-400">Нет сделок</p>
      ) : (
        <div className="space-y-2">
          {deals.map(d => (
            <div key={d.id} className="flex items-center gap-3 py-2 px-3 bg-gray-50 rounded-lg">
              {d.deal_stages && (
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: d.deal_stages.color }} />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{d.title}</p>
                <p className="text-xs text-gray-400">{d.deal_stages?.name}</p>
              </div>
              {d.amount && <span className="text-sm text-gray-600 flex-shrink-0">{d.amount.toLocaleString('ru-RU')} ₽</span>}
            </div>
          ))}
        </div>
      )}

      {showContactForm && (
        <ContactFormModal
          contact={editContact}
          onSave={async (data) => {
            if (editContact) await onUpdateContact({ id: editContact.id, ...data })
            else await onCreateContact(data)
            setShowContactForm(false)
            setEditContact(null)
          }}
          onClose={() => { setShowContactForm(false); setEditContact(null) }}
        />
      )}
    </div>
  )
}

function ContactFormModal({ contact, onSave, onClose }: {
  contact: Contact | null
  onSave: (data: Record<string, unknown>) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState({
    full_name: contact?.full_name ?? '',
    role: contact?.role ?? '',
    phone: contact?.phone ?? '',
    email: contact?.email ?? '',
    notes: contact?.notes ?? '',
  })
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!form.full_name.trim()) return
    setBusy(true)
    await onSave({
      full_name: form.full_name.trim(),
      role: form.role || null,
      phone: form.phone || null,
      email: form.email || null,
      notes: form.notes || null,
    })
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-60 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
        <h3 className="font-bold text-lg mb-4">{contact ? 'Редактировать контакт' : 'Новый контакт'}</h3>
        <div className="space-y-3">
          <input className="input w-full" placeholder="ФИО *" value={form.full_name}
            onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} autoFocus />
          <input className="input w-full" placeholder="Должность (директор, завуч...)" value={form.role}
            onChange={e => setForm(f => ({ ...f, role: e.target.value }))} />
          <input className="input w-full" placeholder="Телефон" value={form.phone}
            onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
          <input className="input w-full" placeholder="Email" type="email" value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          <textarea className="input w-full resize-none" rows={2} placeholder="Заметки"
            value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </div>
        <div className="flex gap-2 mt-4">
          <button className="btn-secondary flex-1" onClick={onClose}>Отмена</button>
          <button className="btn-primary flex-1" onClick={save} disabled={busy || !form.full_name.trim()}>
            {busy ? 'Сохраняем...' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ClientFormModal({ client, onSave, onClose }: {
  client: Client | null
  onSave: (data: Record<string, unknown>) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState({
    name: client?.name ?? '',
    city: client?.city ?? '',
    address: client?.address ?? '',
    website: client?.website ?? '',
    notes: client?.notes ?? '',
    tagsInput: client?.tags?.join(', ') ?? '',
  })
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!form.name.trim()) return
    setBusy(true)
    await onSave({
      name: form.name.trim(),
      city: form.city || null,
      address: form.address || null,
      website: form.website || null,
      notes: form.notes || null,
      tags: form.tagsInput ? form.tagsInput.split(',').map(t => t.trim()).filter(Boolean) : [],
    })
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-60 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h3 className="font-bold text-lg mb-4">{client ? 'Редактировать клиента' : 'Новый клиент'}</h3>
        <div className="space-y-3">
          <input className="input w-full" placeholder="Название школы / организации *" value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus />
          <input className="input w-full" placeholder="Город" value={form.city}
            onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
          <input className="input w-full" placeholder="Адрес" value={form.address}
            onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
          <input className="input w-full" placeholder="Сайт" value={form.website}
            onChange={e => setForm(f => ({ ...f, website: e.target.value }))} />
          <input className="input w-full" placeholder="Теги через запятую (напр: vip, постоянный)" value={form.tagsInput}
            onChange={e => setForm(f => ({ ...f, tagsInput: e.target.value }))} />
          <textarea className="input w-full resize-none" rows={3} placeholder="Заметки"
            value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </div>
        <div className="flex gap-2 mt-4">
          <button className="btn-secondary flex-1" onClick={onClose}>Отмена</button>
          <button className="btn-primary flex-1" onClick={save} disabled={busy || !form.name.trim()}>
            {busy ? 'Сохраняем...' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Задачи ───────────────────────────────────────────────────────────────────

function TasksView({ tasks, members, clients, deals, currentUserId, onCreateTask, onCompleteTask, onDeleteTask }: {
  tasks: Task[]
  members: TeamMember[]
  clients: Client[]
  deals: Deal[]
  currentUserId: string
  onCreateTask: (t: Record<string, unknown>) => Promise<void>
  onCompleteTask: (id: string) => Promise<void>
  onDeleteTask: (id: string) => Promise<void>
}) {
  const [showForm, setShowForm] = useState(false)
  const [filter, setFilter] = useState<'all' | 'mine'>('mine')

  const filtered = tasks.filter(t => filter === 'all' || t.assigned_to === currentUserId || !t.assigned_to)

  const overdue = filtered.filter(t => isOverdue(t.due_date))
  const today = filtered.filter(t => {
    if (!t.due_date) return false
    const d = new Date(t.due_date)
    const now = new Date()
    return !isOverdue(t.due_date) && d.toDateString() === now.toDateString()
  })
  const upcoming = filtered.filter(t => {
    if (!t.due_date) return true
    return !isOverdue(t.due_date) && new Date(t.due_date).toDateString() !== new Date().toDateString()
  })

  const TaskRow = ({ task }: { task: Task }) => (
    <div className="flex items-start gap-3 py-2.5 px-4 hover:bg-gray-50 rounded-lg group">
      <button
        onClick={() => onCompleteTask(task.id)}
        className="mt-0.5 w-5 h-5 rounded-full border-2 border-gray-300 hover:border-green-500 hover:bg-green-50 flex-shrink-0 transition-colors"
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-900">{task.title}</p>
        <p className="text-xs text-gray-400 mt-0.5">
          {task.deals?.title && `📋 ${task.deals.title} · `}
          {task.clients?.name && `🏫 ${task.clients.name} · `}
          {task.due_date && (
            <span className={isOverdue(task.due_date) ? 'text-red-500 font-medium' : ''}>
              {formatDate(task.due_date)}
            </span>
          )}
        </p>
      </div>
      <button
        className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 text-lg"
        onClick={() => onDeleteTask(task.id)}
      >×</button>
    </div>
  )

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {([['mine', 'Мои'], ['all', 'Все']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)}
              className={`px-3 py-1 text-sm rounded-md ${filter === k ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>
              {l}
            </button>
          ))}
        </div>
        <button className="btn-primary text-sm" onClick={() => setShowForm(true)}>+ Задача</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {filtered.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">
            Нет активных задач 🎉
          </div>
        )}

        {overdue.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-red-500 uppercase tracking-wide px-4 mb-1">Просрочено ({overdue.length})</p>
            {overdue.map(t => <TaskRow key={t.id} task={t} />)}
          </div>
        )}
        {today.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 mb-1">Сегодня</p>
            {today.map(t => <TaskRow key={t.id} task={t} />)}
          </div>
        )}
        {upcoming.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 mb-1">Предстоящие</p>
            {upcoming.map(t => <TaskRow key={t.id} task={t} />)}
          </div>
        )}
      </div>

      {showForm && (
        <TaskFormModal
          members={members} clients={clients} deals={deals} currentUserId={currentUserId}
          onSave={async (data) => { await onCreateTask(data); setShowForm(false) }}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  )
}

function TaskFormModal({ members, clients, deals, currentUserId, onSave, onClose }: {
  members: TeamMember[]
  clients: Client[]
  deals: Deal[]
  currentUserId: string
  onSave: (data: Record<string, unknown>) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState({
    title: '',
    deal_id: '',
    client_id: '',
    due_date: '',
    assigned_to: currentUserId,
  })
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!form.title.trim()) return
    setBusy(true)
    await onSave({
      ...form,
      deal_id: form.deal_id || null,
      client_id: form.client_id || null,
      assigned_to: form.assigned_to || null,
      due_date: form.due_date || null,
    })
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-60 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h3 className="font-bold text-lg mb-4">Новая задача</h3>
        <div className="space-y-3">
          <input className="input w-full" placeholder="Что нужно сделать? *" value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))} autoFocus />
          <input className="input w-full" type="datetime-local" value={form.due_date}
            onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
          {deals.length > 0 && (
            <select className="input w-full" value={form.deal_id} onChange={e => setForm(f => ({ ...f, deal_id: e.target.value }))}>
              <option value="">— Привязать к сделке</option>
              {deals.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select>
          )}
          {clients.length > 0 && (
            <select className="input w-full" value={form.client_id} onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}>
              <option value="">— Привязать к клиенту</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          {members.length > 1 && (
            <select className="input w-full" value={form.assigned_to} onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))}>
              <option value="">— Ответственный</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </select>
          )}
        </div>
        <div className="flex gap-2 mt-4">
          <button className="btn-secondary flex-1" onClick={onClose}>Отмена</button>
          <button className="btn-primary flex-1" onClick={save} disabled={busy || !form.title.trim()}>
            {busy ? 'Создаём...' : 'Создать'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Быстрое создание альбома из сделки ──────────────────────────────────────

function QuickAlbumModal({ dealId, suggestedTitle, suggestedCity, onCreated, onClose }: {
  dealId: string
  suggestedTitle: string
  suggestedCity: string
  onCreated: (albumId: string) => void
  onClose: () => void
}) {
  const [form, setForm] = useState({
    title: suggestedTitle,
    city: suggestedCity,
    year: new Date().getFullYear(),
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    if (!form.title.trim()) return
    setBusy(true)
    setError('')
    try {
      // Создаём альбом через /api/tenant
      const albumRes = await fetch('/api/tenant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_album',
          title: form.title.trim(),
          city: form.city || '',
          year: form.year,
          cover_mode: 'none',
        }),
      })
      const albumData = await albumRes.json()
      if (!albumData.album?.id) {
        setError(albumData.error ?? 'Не удалось создать альбом')
        setBusy(false)
        return
      }
      // Привязываем к сделке
      await fetch('/api/crm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_deal', id: dealId, album_id: albumData.album.id }),
      })
      onCreated(albumData.album.id)
    } catch {
      setError('Ошибка сети')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
        <h3 className="font-bold text-lg mb-1">Создать альбом</h3>
        <p className="text-sm text-gray-400 mb-4">Альбом будет привязан к сделке</p>
        {error && <p className="text-sm text-red-500 mb-3">{error}</p>}
        <div className="space-y-3">
          <input className="input w-full" placeholder="Название альбома *" value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))} autoFocus />
          <div className="flex gap-2">
            <input className="input flex-1" placeholder="Город" value={form.city}
              onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
            <input className="input w-24" placeholder="Год" type="number" value={form.year}
              onChange={e => setForm(f => ({ ...f, year: parseInt(e.target.value) || new Date().getFullYear() }))} />
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button className="btn-secondary flex-1" onClick={onClose}>Отмена</button>
          <button className="btn-primary flex-1" onClick={save} disabled={busy || !form.title.trim()}>
            {busy ? 'Создаём...' : 'Создать альбом'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Настройка этапов ─────────────────────────────────────────────────────────

const STAGE_COLORS = [
  '#9ca3af', '#3b82f6', '#8b5cf6', '#f97316',
  '#eab308', '#6366f1', '#22c55e', '#ef4444',
  '#06b6d4', '#ec4899', '#14b8a6', '#f59e0b',
]

function StagesView({ stages, onSave }: {
  stages: Stage[]
  onSave: (stages: Stage[]) => Promise<void>
}) {
  const [local, setLocal] = useState<Stage[]>(() => [...stages].sort((a, b) => a.sort_order - b.sort_order))
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  const update = (id: string, patch: Partial<Stage>) => {
    setLocal(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s))
    setSaved(false)
  }

  const moveUp = (idx: number) => {
    if (idx === 0) return
    const next = [...local]
    ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
    setLocal(next.map((s, i) => ({ ...s, sort_order: i })))
    setSaved(false)
  }

  const moveDown = (idx: number) => {
    if (idx === local.length - 1) return
    const next = [...local]
    ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
    setLocal(next.map((s, i) => ({ ...s, sort_order: i })))
    setSaved(false)
  }

  const save = async () => {
    setBusy(true)
    await onSave(local.map((s, i) => ({ ...s, sort_order: i })))
    setBusy(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="max-w-lg mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-bold text-gray-900">Этапы воронки</h3>
          <p className="text-xs text-gray-400 mt-0.5">Переименуйте, поменяйте цвет или порядок</p>
        </div>
        <button
          className="btn-primary text-sm"
          onClick={save}
          disabled={busy}
        >
          {saved ? '✓ Сохранено' : busy ? 'Сохраняем...' : 'Сохранить'}
        </button>
      </div>

      <div className="space-y-2">
        {local.map((stage, idx) => (
          <div key={stage.id} className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2.5">
            {/* Порядок */}
            <div className="flex flex-col gap-0.5">
              <button onClick={() => moveUp(idx)} disabled={idx === 0}
                className="text-gray-300 hover:text-gray-600 disabled:opacity-20 text-xs leading-none">▲</button>
              <button onClick={() => moveDown(idx)} disabled={idx === local.length - 1}
                className="text-gray-300 hover:text-gray-600 disabled:opacity-20 text-xs leading-none">▼</button>
            </div>

            {/* Цвет */}
            <div className="relative flex-shrink-0">
              <span className="w-5 h-5 rounded-full block cursor-pointer border-2 border-white shadow"
                style={{ background: stage.color }}
                title="Выбрать цвет" />
              <input
                type="color"
                value={stage.color}
                onChange={e => update(stage.id, { color: e.target.value })}
                className="absolute inset-0 opacity-0 cursor-pointer w-5 h-5"
              />
            </div>

            {/* Название */}
            <input
              className="flex-1 text-sm bg-transparent border-b border-transparent hover:border-gray-200 focus:border-gray-400 outline-none py-0.5"
              value={stage.name}
              onChange={e => update(stage.id, { name: e.target.value })}
            />

            {/* Палитра */}
            <div className="flex gap-1">
              {STAGE_COLORS.map(c => (
                <button key={c} onClick={() => update(stage.id, { color: c })}
                  className="w-3.5 h-3.5 rounded-full border border-white shadow-sm hover:scale-110 transition-transform"
                  style={{ background: c }} />
              ))}
            </div>

            {/* Закрытый этап */}
            <label className="flex items-center gap-1 text-xs text-gray-400 flex-shrink-0 cursor-pointer">
              <input type="checkbox" checked={stage.is_closed}
                onChange={e => update(stage.id, { is_closed: e.target.checked })}
                className="rounded" />
              закрыт
            </label>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-300 mt-4">
        «Закрыт» — сделки в этом этапе считаются завершёнными и получают дату закрытия
      </p>
    </div>
  )
}
