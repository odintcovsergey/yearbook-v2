'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Printer } from 'lucide-react'

type AuthData = { authenticated: boolean; user?: { role: string }; isLegacy?: boolean }

type SpineRange = { min_spreads: number; max_spreads: number; spine_mm: number }
type SpineMode = 'ranges' | 'formula' | 'fixed'
type SpineFormula = { base_mm: number; step_mm: number; per_spreads: number }
type Spine = { mode: SpineMode; ranges?: SpineRange[]; formula?: SpineFormula; fixed_mm?: number }
type SheetType = { id: string; name: string; spine?: Spine; spine_ranges?: SpineRange[] }
type FormatFamily = 'vertical_rect' | 'square' | 'horizontal'
type PrinterFormat = {
  id: string; name: string; family: FormatFamily
  page_w_mm: number; page_h_mm: number; spread_w_px: number; spread_h_px: number
  work_w_mm: number; work_h_mm: number; bleed_mm: number; safe_mm: number
}
type CoverFlaps = { flap_lr_mm: number; flap_tb_mm: number }
type PrinterConfig = {
  sheet_types: SheetType[]
  formats?: PrinterFormat[]
  accept_mode?: 'spread' | 'page'
  file_format?: 'jpeg' | 'pdf'
  color?: string
  cover?: CoverFlaps
}
type PrinterRow = { id: string; name: string; config: PrinterConfig }

const FAMILY_LABEL: Record<FormatFamily, string> = {
  vertical_rect: 'вертикальный прямоугольник',
  square: 'квадрат',
  horizontal: 'горизонтальный',
}
const SPINE_MODE_LABEL: Record<SpineMode, string> = {
  ranges: 'диапазоны',
  formula: 'формула',
  fixed: 'фикс. ширина',
}

const api = (path: string, opts?: RequestInit) =>
  fetch(path, { ...opts, credentials: 'include', headers: { 'Content-Type': 'application/json', ...opts?.headers } })

/** Приводит тип листа к актуальной форме spine (legacy spine_ranges → ranges). */
function normalizeSheet(st: SheetType): Spine {
  if (st.spine) return st.spine
  if (st.spine_ranges) return { mode: 'ranges', ranges: st.spine_ranges }
  return { mode: 'ranges', ranges: [] }
}

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
          Профиль типографии: форматы блока, режим приёма, формат файла, загибы обложки и типы листов
          с режимом расчёта корешка (диапазоны / формула / фикс.). Данные печати — со справочника типографии.
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

const NUM = (v: string) => (v === '' ? NaN : parseFloat(v))
const numVal = (n: number | undefined) => (typeof n === 'number' && Number.isFinite(n) ? n : '')

function PrinterCard({ printer, onChanged }: { printer: PrinterRow; onChanged: () => void }) {
  const cfg = printer.config ?? { sheet_types: [] }
  const [name, setName] = useState(printer.name)
  const [sheets, setSheets] = useState<SheetType[]>(
    (cfg.sheet_types ?? []).map((st) => ({ id: st.id, name: st.name, spine: normalizeSheet(st) })),
  )
  const [formats, setFormats] = useState<PrinterFormat[]>(cfg.formats ?? [])
  const [acceptMode, setAcceptMode] = useState<'spread' | 'page'>(cfg.accept_mode ?? 'spread')
  const [fileFormat, setFileFormat] = useState<'jpeg' | 'pdf'>(cfg.file_format ?? 'jpeg')
  const [color, setColor] = useState(cfg.color ?? 'srgb')
  const [coverLr, setCoverLr] = useState<number | undefined>(cfg.cover?.flap_lr_mm)
  const [coverTb, setCoverTb] = useState<number | undefined>(cfg.cover?.flap_tb_mm)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // ── Типы листов ──
  const addSheet = () => setSheets((s) => [...s, { id: crypto.randomUUID(), name: '', spine: { mode: 'ranges', ranges: [] } }])
  const removeSheet = (id: string) => setSheets((s) => s.filter((x) => x.id !== id))
  const patchSheet = (id: string, patch: Partial<SheetType>) =>
    setSheets((s) => s.map((x) => x.id === id ? { ...x, ...patch } : x))
  const patchSpine = (id: string, patch: Partial<Spine>) =>
    setSheets((s) => s.map((x) => x.id === id ? { ...x, spine: { ...normalizeSheet(x), ...patch } } : x))
  const addRange = (id: string) => setSheets((s) => s.map((x) => {
    if (x.id !== id) return x
    const sp = normalizeSheet(x)
    return { ...x, spine: { ...sp, ranges: [...(sp.ranges ?? []), { min_spreads: 0, max_spreads: 0, spine_mm: 0 }] } }
  }))
  const editRange = (id: string, i: number, patch: Partial<SpineRange>) => setSheets((s) => s.map((x) => {
    if (x.id !== id) return x
    const sp = normalizeSheet(x)
    return { ...x, spine: { ...sp, ranges: (sp.ranges ?? []).map((r, j) => j === i ? { ...r, ...patch } : r) } }
  }))
  const removeRange = (id: string, i: number) => setSheets((s) => s.map((x) => {
    if (x.id !== id) return x
    const sp = normalizeSheet(x)
    return { ...x, spine: { ...sp, ranges: (sp.ranges ?? []).filter((_, j) => j !== i) } }
  }))

  // ── Форматы ──
  const addFormat = () => setFormats((f) => [...f, {
    id: crypto.randomUUID(), name: '', family: 'vertical_rect',
    page_w_mm: 0, page_h_mm: 0, spread_w_px: 0, spread_h_px: 0,
    work_w_mm: 0, work_h_mm: 0, bleed_mm: 0, safe_mm: 0,
  }])
  const removeFormat = (id: string) => setFormats((f) => f.filter((x) => x.id !== id))
  const patchFormat = (id: string, patch: Partial<PrinterFormat>) =>
    setFormats((f) => f.map((x) => x.id === id ? { ...x, ...patch } : x))

  const save = async () => {
    setBusy(true); setErr(null)
    try {
      const cover = (typeof coverLr === 'number' || typeof coverTb === 'number')
        ? { flap_lr_mm: coverLr ?? 0, flap_tb_mm: coverTb ?? 0 } : undefined
      const config: PrinterConfig = {
        sheet_types: sheets.map((st) => ({ id: st.id, name: st.name, spine: normalizeSheet(st) })),
        formats, accept_mode: acceptMode, file_format: fileFormat, color, cover,
      }
      const r = await api('/api/super/printers?action=update', {
        method: 'POST', body: JSON.stringify({ id: printer.id, name, config }),
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

  const SectionTitle = ({ children }: { children: React.ReactNode }) => (
    <div className="text-sm font-medium mt-4 mb-2">{children}</div>
  )

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-1">
        <input className="input flex-1 font-medium" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="text-xs text-red-600 hover:underline" onClick={remove} disabled={busy}>удалить типографию</button>
      </div>

      {/* ── Форматы ── */}
      <SectionTitle>Форматы блока</SectionTitle>
      <div className="space-y-3">
        {formats.map((fmt) => (
          <div key={fmt.id} className="border border-border rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <input className="input w-32" placeholder="Имя (21x30)" value={fmt.name}
                onChange={(e) => patchFormat(fmt.id, { name: e.target.value })} />
              <select className="input w-56" value={fmt.family}
                onChange={(e) => patchFormat(fmt.id, { family: e.target.value as FormatFamily })}>
                {(Object.keys(FAMILY_LABEL) as FormatFamily[]).map((f) => (
                  <option key={f} value={f}>{FAMILY_LABEL[f]}</option>
                ))}
              </select>
              <button className="text-xs text-red-600 hover:underline ml-auto" onClick={() => removeFormat(fmt.id)}>удалить</button>
            </div>
            <div className="grid grid-cols-4 gap-2 text-xs">
              {([
                ['page_w_mm', 'стр. Ш, мм'], ['page_h_mm', 'стр. В, мм'],
                ['spread_w_px', 'разв. Ш, px'], ['spread_h_px', 'разв. В, px'],
                ['work_w_mm', 'раб. Ш, мм'], ['work_h_mm', 'раб. В, мм'],
                ['bleed_mm', 'bleed, мм'], ['safe_mm', 'safe, мм'],
              ] as [keyof PrinterFormat, string][]).map(([k, label]) => (
                <label key={k} className="flex flex-col gap-1">
                  <span className="text-muted-foreground">{label}</span>
                  <input className="input" type="number" step="0.1" value={numVal(fmt[k] as number)}
                    onChange={(e) => patchFormat(fmt.id, { [k]: NUM(e.target.value) } as Partial<PrinterFormat>)} />
                </label>
              ))}
            </div>
          </div>
        ))}
        <button className="text-sm text-brand hover:underline" onClick={addFormat}>+ добавить формат</button>
      </div>

      {/* ── Приём / Файл / Цвет ── */}
      <SectionTitle>Приём и файл</SectionTitle>
      <div className="flex flex-wrap gap-4 items-end">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Приём</span>
          <select className="input w-44" value={acceptMode} onChange={(e) => setAcceptMode(e.target.value as 'spread' | 'page')}>
            <option value="spread">разворотами</option>
            <option value="page">постранично</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Формат файла</span>
          <select className="input w-32" value={fileFormat} onChange={(e) => setFileFormat(e.target.value as 'jpeg' | 'pdf')}>
            <option value="jpeg">JPEG</option>
            <option value="pdf">PDF</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Цвет</span>
          <input className="input w-32" value={color} onChange={(e) => setColor(e.target.value)} placeholder="srgb" />
        </label>
      </div>

      {/* ── Обложка ── */}
      <SectionTitle>Обложка — загибы</SectionTitle>
      <div className="flex gap-4 items-end">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">загиб Л/П, мм</span>
          <input className="input w-28" type="number" step="0.1" value={numVal(coverLr)}
            onChange={(e) => setCoverLr(Number.isFinite(NUM(e.target.value)) ? NUM(e.target.value) : undefined)} />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">загиб В/Н, мм</span>
          <input className="input w-28" type="number" step="0.1" value={numVal(coverTb)}
            onChange={(e) => setCoverTb(Number.isFinite(NUM(e.target.value)) ? NUM(e.target.value) : undefined)} />
        </label>
      </div>

      {/* ── Типы листов → корешок ── */}
      <SectionTitle>Типы листов → корешок</SectionTitle>
      <div className="space-y-4">
        {sheets.map((st) => {
          const sp = normalizeSheet(st)
          return (
            <div key={st.id} className="border border-border rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <input className="input flex-1" placeholder="Тип листа (напр. «с подложкой, плотные»)"
                  value={st.name} onChange={(e) => patchSheet(st.id, { name: e.target.value })} />
                <select className="input w-44" value={sp.mode}
                  onChange={(e) => patchSpine(st.id, { mode: e.target.value as SpineMode })}>
                  {(Object.keys(SPINE_MODE_LABEL) as SpineMode[]).map((m) => (
                    <option key={m} value={m}>{SPINE_MODE_LABEL[m]}</option>
                  ))}
                </select>
                <button className="text-xs text-red-600 hover:underline" onClick={() => removeSheet(st.id)}>удалить</button>
              </div>

              {sp.mode === 'ranges' && (
                <>
                  <div className="text-xs text-muted-foreground mb-1 flex items-center gap-4 pl-1">
                    <span className="w-20">от (разв.)</span>
                    <span className="w-20">до (разв.)</span>
                    <span className="w-24">корешок, мм</span>
                  </div>
                  {(sp.ranges ?? []).map((r, i) => (
                    <div key={i} className="flex items-center gap-4 mb-1 pl-1">
                      <input className="input w-20" type="number" value={numVal(r.min_spreads)}
                        onChange={(e) => editRange(st.id, i, { min_spreads: parseInt(e.target.value, 10) })} />
                      <input className="input w-20" type="number" value={numVal(r.max_spreads)}
                        onChange={(e) => editRange(st.id, i, { max_spreads: parseInt(e.target.value, 10) })} />
                      <input className="input w-24" type="number" step="0.1" value={numVal(r.spine_mm)}
                        onChange={(e) => editRange(st.id, i, { spine_mm: parseFloat(e.target.value) })} />
                      <button className="text-xs text-red-600 hover:underline" onClick={() => removeRange(st.id, i)}>×</button>
                    </div>
                  ))}
                  <button className="text-xs text-brand hover:underline mt-1" onClick={() => addRange(st.id)}>+ диапазон</button>
                </>
              )}

              {sp.mode === 'formula' && (
                <div className="flex flex-wrap gap-3 items-end text-xs pl-1">
                  <label className="flex flex-col gap-1">
                    <span className="text-muted-foreground">база, мм</span>
                    <input className="input w-24" type="number" step="0.1" value={numVal(sp.formula?.base_mm)}
                      onChange={(e) => patchSpine(st.id, { formula: { base_mm: NUM(e.target.value), step_mm: sp.formula?.step_mm ?? 1, per_spreads: sp.formula?.per_spreads ?? 1 } })} />
                  </label>
                  <span className="pb-2">+</span>
                  <label className="flex flex-col gap-1">
                    <span className="text-muted-foreground">шаг, мм</span>
                    <input className="input w-24" type="number" step="0.1" value={numVal(sp.formula?.step_mm)}
                      onChange={(e) => patchSpine(st.id, { formula: { base_mm: sp.formula?.base_mm ?? 0, step_mm: NUM(e.target.value), per_spreads: sp.formula?.per_spreads ?? 1 } })} />
                  </label>
                  <span className="pb-2">× разворотов /</span>
                  <label className="flex flex-col gap-1">
                    <span className="text-muted-foreground">на N разв.</span>
                    <input className="input w-24" type="number" step="1" value={numVal(sp.formula?.per_spreads)}
                      onChange={(e) => patchSpine(st.id, { formula: { base_mm: sp.formula?.base_mm ?? 0, step_mm: sp.formula?.step_mm ?? 1, per_spreads: NUM(e.target.value) } })} />
                  </label>
                </div>
              )}

              {sp.mode === 'fixed' && (
                <label className="flex flex-col gap-1 text-xs pl-1 w-40">
                  <span className="text-muted-foreground">корешок, мм (0 = нет)</span>
                  <input className="input" type="number" step="0.1" value={numVal(sp.fixed_mm)}
                    onChange={(e) => patchSpine(st.id, { fixed_mm: NUM(e.target.value) })} />
                </label>
              )}
            </div>
          )
        })}
        <button className="text-sm text-brand hover:underline" onClick={addSheet}>+ добавить тип листа</button>
      </div>

      {err && <div className="text-sm text-red-600 mt-2">{err}</div>}
      <div className="mt-4">
        <button className="btn-primary text-sm" onClick={save} disabled={busy}>{busy ? 'Сохраняю…' : 'Сохранить'}</button>
      </div>
    </div>
  )
}
