'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { uploadViaSignedTarget } from '@/lib/blob-upload-client'

// ============================================================
// Общий конструктор реферальных программ (ТЗ docs/tz-referral-programs.md).
// Используется и в супер-админке, и в кабинете партнёра — отличается только
// бэкендом (apiBase) и правами, которые приходят с сервера:
//   editable    — можно ли редактировать конкретную программу;
//   canSetGlobal — может ли пользователь делать программы глобальными.
// Партнёр видит глобальные программы read-only и может «Дублировать себе».
// ============================================================

export type Program = {
  id: string
  tenant_id: string | null
  is_global: boolean
  name: string
  is_active: boolean
  referrer_reward_text: string | null
  referrer_image_url: string | null
  invitee_reward_text: string | null
  invitee_description: string | null
  invitee_image_url: string | null
  created_at: string
  album_count: number
  editable: boolean
}

const api = (path: string, opts?: RequestInit) =>
  fetch(path, {
    ...opts,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
  })

export default function ReferralProgramsManager({ apiBase }: { apiBase: string }) {
  const [view, setView] = useState<'programs' | 'analytics'>('programs')
  const [programs, setPrograms] = useState<Program[]>([])
  const [canSetGlobal, setCanSetGlobal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Program | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await api(apiBase)
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`)
      setPrograms(d.programs ?? [])
      setCanSetGlobal(!!d.canSetGlobal)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить программы')
    } finally {
      setLoading(false)
    }
  }, [apiBase])

  useEffect(() => { load() }, [load])

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      const r = await api(apiBase, { method: 'POST', body: JSON.stringify(body) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`)
      return d
    },
    [apiBase],
  )

  const run = async (id: string, fn: () => Promise<void>) => {
    setBusyId(id)
    try { await fn() } catch (e) { alert(e instanceof Error ? e.message : 'Ошибка') } finally { setBusyId(null) }
  }

  const handleCreate = () => run('new', async () => {
    const d = await post({ action: 'create_program', name: 'Новая программа', is_active: false })
    await load()
    if (d.program) setEditing(d.program)
  })

  const handleToggleActive = (p: Program) => run(p.id, async () => {
    await post({ action: 'toggle_active', id: p.id, is_active: !p.is_active }); await load()
  })

  const handleToggleGlobal = (p: Program) => run(p.id, async () => {
    await post({ action: 'set_global', id: p.id, make_global: !p.is_global }); await load()
  })

  const handleDuplicate = (p: Program) => run(p.id, async () => {
    await post({ action: 'duplicate_program', id: p.id }); await load()
    setNotice(`Создана копия «${p.name} (копия)» — отредактируйте и включите.`)
  })

  const handleDelete = (p: Program) => run(p.id, async () => {
    const warn = p.album_count > 0
      ? `Программа используется в ${p.album_count} заказ(ах). После удаления у них будет дефолтный текст. Удалить?`
      : `Удалить программу «${p.name}»?`
    if (!confirm(warn)) return
    const r = await api(`${apiBase}?id=${encodeURIComponent(p.id)}`, { method: 'DELETE' })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`)
    await load()
  })

  return (
    <>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {([
            { key: 'programs' as const, label: 'Программы' },
            { key: 'analytics' as const, label: 'Аналитика' },
          ]).map((t) => (
            <button
              key={t.key}
              onClick={() => setView(t.key)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${view === t.key ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {view === 'programs' && (
          <button onClick={handleCreate} disabled={busyId === 'new'} className="btn-primary whitespace-nowrap">
            {busyId === 'new' ? 'Создаю…' : '+ Создать программу'}
          </button>
        )}
      </div>

      {view === 'analytics' && <AnalyticsView apiBase={apiBase} />}

      {view === 'programs' && (
      <>{/* — вкладка «Программы» — */}

      {notice && (
        <div className="bg-green-50 border border-green-100 text-green-700 rounded-lg p-3 text-sm mb-4">{notice}</div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-100 text-red-600 rounded-lg p-3 text-sm mb-4">{error}</div>
      )}

      {loading ? (
        <div className="text-center text-gray-400 py-12">Загрузка…</div>
      ) : programs.length === 0 ? (
        <div className="text-center text-gray-400 py-12">Программ пока нет. Нажмите «Создать программу».</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {programs.map((p) => (
            <div key={p.id} className="card p-4 flex flex-col">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="font-medium text-gray-900 break-words">{p.name}</div>
                <div className="flex gap-1 flex-shrink-0">
                  {p.is_global ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">
                      {p.editable ? 'глобальная' : 'готовая'}
                    </span>
                  ) : (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">своя</span>
                  )}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${p.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
                    {p.is_active ? 'активна' : 'выкл'}
                  </span>
                </div>
              </div>

              <div className="flex gap-2 mb-3">
                <ImgThumb url={p.referrer_image_url} label="реферер" />
                <ImgThumb url={p.invitee_image_url} label="реферал" />
              </div>

              <div className="text-xs text-gray-500 space-y-1 mb-3 flex-1">
                <div><span className="text-gray-400">Реферер:</span> {p.referrer_reward_text || '—'}</div>
                <div><span className="text-gray-400">Реферал:</span> {p.invitee_reward_text || '—'}</div>
                {p.album_count > 0 && <div className="text-amber-600">В {p.album_count} заказ(ах)</div>}
              </div>

              <div className="flex flex-wrap gap-2 text-xs">
                {p.editable ? (
                  <>
                    <button onClick={() => setEditing(p)} disabled={busyId === p.id} className="px-2 py-1 border border-gray-300 rounded hover:bg-gray-50">Редактировать</button>
                    <button onClick={() => handleToggleActive(p)} disabled={busyId === p.id} className="px-2 py-1 border border-gray-300 rounded hover:bg-gray-50">{p.is_active ? 'Выключить' : 'Включить'}</button>
                    {canSetGlobal && (
                      <button onClick={() => handleToggleGlobal(p)} disabled={busyId === p.id} className="px-2 py-1 border border-gray-300 rounded hover:bg-gray-50">{p.is_global ? '→ okeybook' : '→ глобальная'}</button>
                    )}
                    <button onClick={() => handleDuplicate(p)} disabled={busyId === p.id} className="px-2 py-1 border border-gray-300 rounded hover:bg-gray-50">Дублировать</button>
                    <button onClick={() => handleDelete(p)} disabled={busyId === p.id} className="px-2 py-1 border border-red-200 text-red-600 rounded hover:bg-red-50">Удалить</button>
                  </>
                ) : (
                  // Готовая (глобальная) программа — read-only, можно забрать себе.
                  <button onClick={() => handleDuplicate(p)} disabled={busyId === p.id} className="px-2 py-1 border border-gray-300 rounded hover:bg-gray-50">Дублировать себе</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      </>
      )}

      {editing && (
        <ProgramForm
          program={editing}
          onClose={() => setEditing(null)}
          onSaved={(msg) => { setNotice(msg); load() }}
          post={post}
        />
      )}
    </>
  )
}

// ============================================================
// Вкладка «Аналитика»: воронка переходы → заявки → заказы по программам,
// с разрезом по сегменту. Данные скоупятся на сервере по роли.
// ============================================================
const SEGMENT_LABELS: Record<string, string> = {
  garden: 'Детский сад',
  grade4: '4 класс',
  grade11: '9–11 класс',
  free: 'Свободный',
}

type Funnel = { visits: number; leads: number; conversions: number }
type AnalyticsRow = {
  program_id: string | null
  name: string
  totals: Funnel
  segments: Record<string, Funnel>
}

function pct(part: number, whole: number): string {
  if (!whole) return '—'
  return `${Math.round((part / whole) * 100)}%`
}

function AnalyticsView({ apiBase }: { apiBase: string }) {
  const [rows, setRows] = useState<AnalyticsRow[]>([])
  const [segments, setSegments] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api(`${apiBase}?analytics=1`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (cancelled) return
        if (!ok) { setError(d.error ?? 'Ошибка загрузки'); return }
        setRows(d.analytics ?? [])
        setSegments(d.segments ?? [])
      })
      .catch(() => { if (!cancelled) setError('Ошибка сети') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [apiBase])

  if (loading) return <div className="text-center text-gray-400 py-12">Загрузка…</div>
  if (error) return <div className="bg-red-50 border border-red-100 text-red-600 rounded-lg p-3 text-sm">{error}</div>

  const hasAny = rows.some((r) => r.totals.visits + r.totals.leads > 0)
  if (!hasAny) {
    return (
      <div className="text-center text-gray-400 py-12">
        Пока нет данных. Цифры появятся, когда родители начнут переходить по реф-ссылкам и оставлять заявки.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">
        Воронка: переходы по ссылке → заявки → заказы. «% заявок» — из переходов, «% заказов» — из заявок.
        Нажмите на программу, чтобы увидеть разрез по сегментам.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
              <th className="py-2 pr-3">Программа</th>
              <th className="py-2 px-3 text-right">Переходы</th>
              <th className="py-2 px-3 text-right">Заявки</th>
              <th className="py-2 px-3 text-right">% заявок</th>
              <th className="py-2 px-3 text-right">Заказы</th>
              <th className="py-2 pl-3 text-right">% заказов</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const key = r.program_id ?? '__none__'
              const open = openId === key
              const segRows = segments.filter((s) => {
                const f = r.segments[s]
                return f && (f.visits + f.leads) > 0
              })
              return (
                <FragmentRow
                  key={key}
                  row={r}
                  open={open}
                  onToggle={() => setOpenId(open ? null : key)}
                  segRows={segRows}
                />
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function FunnelCells({ f }: { f: Funnel }) {
  return (
    <>
      <td className="py-2 px-3 text-right tabular-nums">{f.visits}</td>
      <td className="py-2 px-3 text-right tabular-nums">{f.leads}</td>
      <td className="py-2 px-3 text-right tabular-nums text-gray-500">{pct(f.leads, f.visits)}</td>
      <td className="py-2 px-3 text-right tabular-nums font-medium text-green-700">{f.conversions}</td>
      <td className="py-2 pl-3 text-right tabular-nums text-gray-500">{pct(f.conversions, f.leads)}</td>
    </>
  )
}

function FragmentRow({
  row,
  open,
  onToggle,
  segRows,
}: {
  row: AnalyticsRow
  open: boolean
  onToggle: () => void
  segRows: string[]
}) {
  return (
    <>
      <tr className="border-b border-gray-100 cursor-pointer hover:bg-gray-50" onClick={onToggle}>
        <td className="py-2 pr-3 font-medium text-gray-800">
          <span className="text-gray-400 mr-1">{segRows.length > 0 ? (open ? '▾' : '▸') : ' '}</span>
          {row.name}
        </td>
        <FunnelCells f={row.totals} />
      </tr>
      {open && segRows.map((s) => (
        <tr key={s} className="border-b border-gray-100 bg-gray-50/50 text-xs">
          <td className="py-1.5 pr-3 pl-6 text-gray-500">{SEGMENT_LABELS[s] ?? s}</td>
          <FunnelCells f={row.segments[s]} />
        </tr>
      ))}
    </>
  )
}

function ImgThumb({ url, label }: { url: string | null; label: string }) {
  return (
    <div className="flex-1">
      <div className="text-[10px] text-gray-400 mb-0.5">{label}</div>
      {url ? (
        <img src={url} alt="" className="w-full h-16 object-cover rounded border border-gray-200" />
      ) : (
        <div className="w-full h-16 rounded border border-dashed border-gray-200 flex items-center justify-center text-[10px] text-gray-300">нет</div>
      )}
    </div>
  )
}

function ProgramForm({
  program,
  onClose,
  onSaved,
  post,
}: {
  program: Program
  onClose: () => void
  onSaved: (msg: string) => void
  post: (body: Record<string, unknown>) => Promise<any>
}) {
  const [name, setName] = useState(program.name)
  const [referrerReward, setReferrerReward] = useState(program.referrer_reward_text ?? '')
  const [inviteeReward, setInviteeReward] = useState(program.invitee_reward_text ?? '')
  const [inviteeDescription, setInviteeDescription] = useState(program.invitee_description ?? '')
  const [referrerImg, setReferrerImg] = useState(program.referrer_image_url)
  const [inviteeImg, setInviteeImg] = useState(program.invitee_image_url)
  const [saving, setSaving] = useState(false)
  const [uploadingSide, setUploadingSide] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const referrerInputRef = useRef<HTMLInputElement>(null)
  const inviteeInputRef = useRef<HTMLInputElement>(null)

  const handleSave = async () => {
    if (!name.trim()) { setErr('Укажите название'); return }
    setSaving(true)
    setErr(null)
    try {
      await post({
        action: 'update_program',
        id: program.id,
        name: name.trim(),
        referrer_reward_text: referrerReward.trim() || null,
        invitee_reward_text: inviteeReward.trim() || null,
        invitee_description: inviteeDescription.trim() || null,
      })
      onSaved(`Программа «${name.trim()}» сохранена.`)
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  const handleUpload = async (side: 'referrer' | 'invitee', file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!['jpg', 'jpeg', 'png'].includes(ext)) { setErr('Только JPG или PNG'); return }
    setUploadingSide(side)
    setErr(null)
    try {
      const signed = await post({ action: 'sign', program_id: program.id, side, ext })
      await uploadViaSignedTarget('referral-images', signed, file)
      const d = await post({ action: 'commit', program_id: program.id, side, path: signed.path })
      if (side === 'referrer') setReferrerImg(d.program?.referrer_image_url ?? null)
      else setInviteeImg(d.program?.invitee_image_url ?? null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка загрузки')
    } finally {
      setUploadingSide(null)
    }
  }

  const handleRemoveImage = async (side: 'referrer' | 'invitee') => {
    setUploadingSide(side)
    try {
      await post({ action: 'remove_image', program_id: program.id, side })
      if (side === 'referrer') setReferrerImg(null)
      else setInviteeImg(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setUploadingSide(null)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center p-4 z-50 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-4xl w-full my-8 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold">Программа</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="p-5 grid gap-6 lg:grid-cols-2">
          <div className="space-y-5">
            {err && <div className="bg-red-50 border border-red-100 text-red-600 rounded p-2 text-sm">{err}</div>}

            <div>
              <label className="block text-xs text-gray-500 mb-1">Название (внутреннее)</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Котики" />
            </div>

            <div className="border border-gray-200 rounded-xl p-4">
              <div className="text-sm font-medium text-gray-800 mb-3">Реферер (кто рекомендует)</div>
              <label className="block text-xs text-gray-500 mb-1">Награда</label>
              <textarea className="input mb-3" rows={2} value={referrerReward} onChange={(e) => setReferrerReward(e.target.value)} placeholder="50% на копию альбома для бабушки" />
              <ImageField label="Картинка (на странице «Спасибо»)" url={referrerImg} uploading={uploadingSide === 'referrer'} inputRef={referrerInputRef} onPick={(f) => handleUpload('referrer', f)} onRemove={() => handleRemoveImage('referrer')} />
            </div>

            <div className="border border-gray-200 rounded-xl p-4">
              <div className="text-sm font-medium text-gray-800 mb-3">Реферал (кто приходит)</div>
              <p className="text-xs text-gray-400 mb-3">Имя того, кто поделился ссылкой, подставится автоматически («Вас рекомендует …»).</p>
              <label className="block text-xs text-gray-500 mb-1">Награда</label>
              <textarea className="input mb-3" rows={2} value={inviteeReward} onChange={(e) => setInviteeReward(e.target.value)} placeholder="Скидка 500₽ на первый заказ" />
              <label className="block text-xs text-gray-500 mb-1">Описание / условия</label>
              <textarea className="input mb-3" rows={3} value={inviteeDescription} onChange={(e) => setInviteeDescription(e.target.value)} placeholder="Подробности предложения" />
              <ImageField label="Картинка (на лендинге)" url={inviteeImg} uploading={uploadingSide === 'invitee'} inputRef={inviteeInputRef} onPick={(f) => handleUpload('invitee', f)} onRemove={() => handleRemoveImage('invitee')} />
            </div>
          </div>

          <div className="space-y-4">
            <div className="text-xs text-gray-400 uppercase">Превью</div>

            <div className="bg-gradient-to-b from-blue-50 to-gray-50 rounded-xl p-4">
              <div className="text-[11px] text-gray-400 mb-2">Реферер — страница «Спасибо»</div>
              <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
                {referrerImg && <img src={referrerImg} alt="" className="max-h-64 w-auto max-w-full mx-auto block rounded-xl mb-3" />}
                <p className="text-sm font-medium text-blue-800 mb-1">🎁 {referrerReward || 'Получите скидку 50%'}</p>
                <p className="text-sm text-blue-700">Поделитесь ссылкой с друзьями — когда они оставят заявку, мы применим вашу награду.</p>
              </div>
            </div>

            <div className="bg-gradient-to-b from-blue-50 to-gray-50 rounded-xl p-4">
              <div className="text-[11px] text-gray-400 mb-2">Реферал — лендинг по ссылке</div>
              <div className="bg-blue-50 border border-blue-100 rounded-2xl p-3 mb-3 text-center">
                <p className="text-sm text-blue-700">Вас рекомендует <strong>Елена</strong></p>
              </div>
              <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
                {inviteeImg && <img src={inviteeImg} alt="" className="max-h-64 w-auto max-w-full mx-auto block" />}
                <div className="p-4">
                  {inviteeReward && <p className="text-base font-semibold text-gray-800 mb-1">🎁 {inviteeReward}</p>}
                  {inviteeDescription && <p className="text-sm text-gray-600 whitespace-pre-wrap">{inviteeDescription}</p>}
                  {!inviteeReward && !inviteeDescription && <p className="text-sm text-gray-300">Награда и описание появятся здесь</p>}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 p-5 border-t border-gray-100">
          <button onClick={onClose} className="btn-ghost">Отмена</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary">{saving ? 'Сохраняю…' : 'Сохранить'}</button>
        </div>
      </div>
    </div>
  )
}

function ImageField({
  label,
  url,
  uploading,
  inputRef,
  onPick,
  onRemove,
}: {
  label: string
  url: string | null
  uploading: boolean
  inputRef: React.RefObject<HTMLInputElement>
  onPick: (file: File) => void
  onRemove: () => void
}) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      {url && <img src={url} alt="" className="max-h-64 w-auto max-w-full mx-auto block rounded-lg border border-gray-200 mb-2" />}
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onPick(f)
            e.target.value = ''
          }}
        />
        <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading} className="text-sm px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50">
          {uploading ? 'Загрузка…' : url ? 'Заменить' : 'Загрузить'}
        </button>
        {url && (
          <button type="button" onClick={onRemove} disabled={uploading} className="text-sm px-3 py-1 border border-red-200 text-red-600 rounded hover:bg-red-50 disabled:opacity-50">Удалить</button>
        )}
      </div>
    </div>
  )
}
