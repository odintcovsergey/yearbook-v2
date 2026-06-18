'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Printer } from 'lucide-react'

type AuthData = { authenticated: boolean; user?: { role: string }; isLegacy?: boolean }

type SpineRange = { min_spreads: number; max_spreads: number; spine_mm: number }
type SheetType = { id: string; name: string; spine_ranges: SpineRange[] }
type PrinterRow = { id: string; name: string; config: { sheet_types: SheetType[] } }

const api = (path: string, opts?: RequestInit) =>
  fetch(path, { ...opts, credentials: 'include', headers: { 'Content-Type': 'application/json', ...opts?.headers } })

export default function PrintersPage() {
  const router = useRouter()
  const [authChecked, setAuthChecked] = useState(false)
  const [printers, setPrinters] = useState<PrinterRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    api('/api/auth')
      .then(r => (r.ok ? r.json() : null))
      .then((d: AuthData | null) => {
        if (!d?.authenticated || d.isLegacy) { router.push('/login'); return }
        if (d.user?.role !== 'superadmin') { router.push('/app'); return }
        setAuthChecked(true)
      })
      .catch(() => router.push('/login'))
  }, [router])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await api('/api/super/printers')
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`)
      setPrinters((await r.json()).printers ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { if (authChecked) load() }, [authChecked, load])

  const create = async () => {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    try {
      const r = await api('/api/super/printers?action=create', { method: 'POST', body: JSON.stringify({ name }) })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`)
      setNewName('')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally { setCreating(false) }
  }

  if (!authChecked) return null

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center gap-2 mb-1">
          <Printer size={22} />
          <h1 className="text-2xl font-semibold" style={{ fontFamily: 'var(--font-display)' }}>Печать — типографии</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          Корешок обложки задаётся по типографии: внутри — типы листов, внутри типа — диапазоны
          «от N до M разворотов → корешок (мм)». Спросите у типографии: какой корешок при таком числе разворотов.
        </p>

        <div className="card p-4 mb-6 flex items-end gap-2">
          <label className="flex-1">
            <span className="block text-xs text-muted-foreground mb-1">Новая типография</span>
            <input className="input" placeholder="Название (напр. «Фотолаб»)" value={newName}
              onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') create() }} />
          </label>
          <button className="btn-primary" onClick={create} disabled={creating || !newName.trim()}>
            {creating ? 'Добавляю…' : 'Добавить типографию'}
          </button>
        </div>

        {error && <div className="text-sm text-red-600 mb-3">{error}</div>}
        {loading ? (
          <div className="text-sm text-muted-foreground">Загрузка…</div>
        ) : printers.length === 0 ? (
          <div className="text-sm text-muted-foreground">Пока нет типографий. Добавь первую выше.</div>
        ) : (
          <div className="space-y-4">
            {printers.map((p) => <PrinterCard key={p.id} printer={p} onChanged={load} />)}
          </div>
        )}
      </div>
    </div>
  )
}

function PrinterCard({ printer, onChanged }: { printer: PrinterRow; onChanged: () => void }) {
  const [name, setName] = useState(printer.name)
  const [sheets, setSheets] = useState<SheetType[]>(printer.config?.sheet_types ?? [])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const addSheet = () => setSheets((s) => [...s, { id: crypto.randomUUID(), name: '', spine_ranges: [] }])
  const removeSheet = (id: string) => setSheets((s) => s.filter((x) => x.id !== id))
  const editSheetName = (id: string, v: string) => setSheets((s) => s.map((x) => x.id === id ? { ...x, name: v } : x))
  const addRange = (id: string) => setSheets((s) => s.map((x) => x.id === id
    ? { ...x, spine_ranges: [...x.spine_ranges, { min_spreads: 0, max_spreads: 0, spine_mm: 0 }] } : x))
  const editRange = (id: string, i: number, patch: Partial<SpineRange>) => setSheets((s) => s.map((x) => x.id === id
    ? { ...x, spine_ranges: x.spine_ranges.map((r, j) => j === i ? { ...r, ...patch } : r) } : x))
  const removeRange = (id: string, i: number) => setSheets((s) => s.map((x) => x.id === id
    ? { ...x, spine_ranges: x.spine_ranges.filter((_, j) => j !== i) } : x))

  const save = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await api('/api/super/printers?action=update', {
        method: 'POST',
        body: JSON.stringify({ id: printer.id, name, config: { sheet_types: sheets } }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`)
      onChanged()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Ошибка') } finally { setBusy(false) }
  }

  const remove = async () => {
    if (!confirm(`Удалить типографию «${printer.name}»?`)) return
    setBusy(true); setErr(null)
    try {
      const r = await api('/api/super/printers?action=delete', { method: 'POST', body: JSON.stringify({ id: printer.id }) })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`)
      onChanged()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Ошибка') } finally { setBusy(false) }
  }

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <input className="input flex-1 font-medium" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="text-xs text-red-600 hover:underline" onClick={remove} disabled={busy}>удалить типографию</button>
      </div>

      <div className="space-y-4">
        {sheets.map((st) => (
          <div key={st.id} className="border border-border rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <input className="input flex-1" placeholder="Тип листа (напр. «с подложкой, плотные»)"
                value={st.name} onChange={(e) => editSheetName(st.id, e.target.value)} />
              <button className="text-xs text-red-600 hover:underline" onClick={() => removeSheet(st.id)}>удалить тип</button>
            </div>

            <div className="text-xs text-muted-foreground mb-1 flex items-center gap-4 pl-1">
              <span className="w-20">от (разв.)</span>
              <span className="w-20">до (разв.)</span>
              <span className="w-24">корешок, мм</span>
            </div>
            {st.spine_ranges.map((r, i) => (
              <div key={i} className="flex items-center gap-4 mb-1 pl-1">
                <input className="input w-20" type="number" value={Number.isFinite(r.min_spreads) ? r.min_spreads : ''}
                  onChange={(e) => editRange(st.id, i, { min_spreads: parseInt(e.target.value, 10) })} />
                <input className="input w-20" type="number" value={Number.isFinite(r.max_spreads) ? r.max_spreads : ''}
                  onChange={(e) => editRange(st.id, i, { max_spreads: parseInt(e.target.value, 10) })} />
                <input className="input w-24" type="number" step="0.1" value={Number.isFinite(r.spine_mm) ? r.spine_mm : ''}
                  onChange={(e) => editRange(st.id, i, { spine_mm: parseFloat(e.target.value) })} />
                <button className="text-xs text-red-600 hover:underline" onClick={() => removeRange(st.id, i)}>×</button>
              </div>
            ))}
            <button className="text-xs text-brand hover:underline mt-1" onClick={() => addRange(st.id)}>+ диапазон</button>
          </div>
        ))}
        <button className="text-sm text-brand hover:underline" onClick={addSheet}>+ добавить тип листа</button>
      </div>

      {err && <div className="text-sm text-red-600 mt-2">{err}</div>}
      <div className="mt-3">
        <button className="btn-primary text-sm" onClick={save} disabled={busy}>{busy ? 'Сохраняю…' : 'Сохранить'}</button>
      </div>
    </div>
  )
}
