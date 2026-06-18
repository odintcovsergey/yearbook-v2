'use client'

/**
 * Полностраничный редактор обложек (ТЗ tz-cover-editor, итерация «как развороты»).
 * Корпус один-в-один с редактором разворотов: палитра фото справа, холст по
 * центру, лента обложек снизу. Холст — CoverCanvas (обёртка AlbumSpreadCanvas).
 *
 * Правки двух глубин: шаблонные на тип (cover_type) и поштучный кроп портрета
 * на ученика (child_id). Перетаскивание фото из палитры заменяет фото в слоте.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { ChevronLeft, PanelRightClose, PanelRightOpen, Eye, Type } from 'lucide-react'
import { layoutCover } from '@/lib/cover/layout'
import { renderCoverPreviewSvg } from '@/lib/cover/preview-svg'
import { parseFontSizeMult, parseColor, parseHAlign, parseVAlign, parseFontFamily } from '@/lib/text-style'
import { mergeCoverData, PER_STUDENT_COVER_LABELS } from '@/lib/cover/editor-merge'
import type { CoverTextStyleOverrides } from '@/lib/cover/text-styles'
import type { RenderPlaceholder } from '@/lib/album-builder/types'
import TextStylePanel from '../../../_components/TextStylePanel'
import CoverPreviewFullscreen, { type CoverPreviewItem } from '../../../_components/CoverPreviewFullscreen'
import CoverTextStylesModal from '../../../_components/CoverTextStylesModal'
import type { AlbumPhoto } from '../../../_components/PhotoPalette'
import type { CropHandlers } from '../../../_components/AlbumSpreadCanvas'
import type { CoverCanvasMaster } from '../../../_components/CoverCanvas'

const PhotoPalette = dynamic(() => import('../../../_components/PhotoPalette'), { ssr: false, loading: () => null })
const CoverCanvas = dynamic(() => import('../../../_components/CoverCanvas'), { ssr: false, loading: () => null })

type CoverType = 'portrait_photo' | 'common_photo' | 'design_only'
type Item = {
  key: string
  child_id: string | null
  child_name: string | null
  cover_type: CoverType
  cover_name: string | null
  has_cover: boolean
  master: CoverCanvasMaster | null
  data: Record<string, string | null>
  base: Record<string, string | null>
}
type EditorData = {
  items: Item[]
  spine_width_mm: number | null
  editsByType: Record<string, Record<string, string | null>>
  editsByChild: Record<string, Record<string, string | null>>
  coverTextStyles: CoverTextStyleOverrides
  common_photos: Array<{ id: string; url: string }>
  warnings: string[]
}

const TYPE_LABEL: Record<CoverType, string> = {
  portrait_photo: 'Портрет', common_photo: 'Общая', design_only: 'Дизайн',
}

export default function CoverEditorPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const albumId = params.id

  const [editor, setEditor] = useState<EditorData | null>(null)
  const [photos, setPhotos] = useState<AlbumPhoto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentIdx, setCurrentIdx] = useState(0)
  const [paletteCollapsed, setPaletteCollapsed] = useState(false)

  // Патчи правок: по типу обложки и по ученику. Инициализируются из БД.
  const [typePatches, setTypePatches] = useState<Record<string, Record<string, string | null>>>({})
  const [studentPatches, setStudentPatches] = useState<Record<string, Record<string, string | null>>>({})

  const [editingTextLabel, setEditingTextLabel] = useState<string | null>(null)
  // Панель стилей текста (шрифт/размер/цвет/выравнивание). Открывается вместе
  // с инлайн-редактором текста; rightEdge/topEdge/leftEdge — границы слота для
  // позиционирования панели (как в редакторе разворотов).
  const [textStylePanel, setTextStylePanel] = useState<
    | null
    | { label: string; rightEdge: number; topEdge: number; leftEdge: number }
  >(null)
  const [cropLabel, setCropLabel] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Полноэкранный просмотр готовых обложек («Вид»).
  const [fullscreenOpen, setFullscreenOpen] = useState(false)
  // Глобальные стили текстов обложек + модалка «Стили текстов».
  const [coverTextStyles, setCoverTextStyles] = useState<CoverTextStyleOverrides>({})
  const [textStylesModalOpen, setTextStylesModalOpen] = useState(false)

  // ── Undo/Redo: история снимков правок (typePatches + studentPatches) ──────
  type Snapshot = {
    typePatches: Record<string, Record<string, string | null>>
    studentPatches: Record<string, Record<string, string | null>>
  }
  const [history, setHistory] = useState<{ past: Snapshot[]; future: Snapshot[] }>({ past: [], future: [] })
  // Во время непрерывного жеста (кроп) не пишем шаг на каждый тик.
  const suspendHistoryRef = useRef(false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  // Загрузка данных редактора + фото для палитры.
  useEffect(() => {
    let alive = true
    Promise.all([
      fetch(`/api/tenant?action=cover_editor&album_id=${albumId}`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
      fetch(`/api/tenant?action=album_photos&album_id=${albumId}`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([ed, ph]: [EditorData, AlbumPhoto[] | { photos?: AlbumPhoto[] }]) => {
        if (!alive) return
        setEditor(ed)
        // Личные метки (имя/класс) из шаблонных правок выкидываем сразу при
        // загрузке: они не должны жить на уровне типа (иначе перетирают всех).
        // Чистим и состояние, чтобы при следующем сохранении типа не вернулись.
        const cleanByType: Record<string, Record<string, string | null>> = {}
        for (const [ct, d] of Object.entries(ed.editsByType ?? {})) {
          const copy = { ...d }
          for (const lbl of PER_STUDENT_COVER_LABELS) delete copy[lbl]
          cleanByType[ct] = copy
        }
        setTypePatches(cleanByType)
        setStudentPatches(ed.editsByChild ?? {})
        setCoverTextStyles(ed.coverTextStyles ?? {})
        setHistory({ past: [], future: [] })
        setPhotos(Array.isArray(ph) ? ph : (ph.photos ?? []))
      })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Ошибка загрузки') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [albumId])

  // Редактируемые обложки (есть мастер).
  const items = useMemo(() => (editor?.items ?? []).filter((i) => i.has_cover && i.master), [editor])
  const item = items[currentIdx] ?? null

  const data = useMemo(() => {
    if (!item) return {}
    return mergeCoverData(item.base, typePatches[item.cover_type] ?? {}, item.child_id ? studentPatches[item.child_id] ?? {} : {})
  }, [item, typePatches, studentPatches])

  // ── Сохранение (дебаунс по области) ──────────────────────────────────────
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const saveDebounced = useCallback((saveKey: string, body: Record<string, unknown>) => {
    if (timers.current[saveKey]) clearTimeout(timers.current[saveKey])
    setSaving(true)
    timers.current[saveKey] = setTimeout(async () => {
      try {
        await fetch('/api/tenant', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      } finally { setSaving(false) }
    }, 700)
  }, [])

  // Снимок текущих правок (через refs — всегда актуально, без устаревания в
  // замыканиях). Перед каждым действием кладём его в past.
  const typePatchesRef = useRef(typePatches)
  typePatchesRef.current = typePatches
  const studentPatchesRef = useRef(studentPatches)
  studentPatchesRef.current = studentPatches
  const snapshot = useCallback((): Snapshot => ({
    typePatches: typePatchesRef.current,
    studentPatches: studentPatchesRef.current,
  }), [])
  const pushHistory = useCallback(() => {
    if (suspendHistoryRef.current) return
    setHistory((h) => ({ past: [...h.past, snapshot()].slice(-100), future: [] }))
  }, [snapshot])

  const setTypeKey = useCallback((coverType: CoverType, label: string, val: string | null) => {
    pushHistory()
    setTypePatches((prev) => {
      const cur = { ...(prev[coverType] ?? {}) }
      if (val === null) delete cur[label]; else cur[label] = val
      saveDebounced(`type:${coverType}`, { action: 'cover_save_edit', album_id: albumId, scope: 'type', cover_type: coverType, data: cur })
      return { ...prev, [coverType]: cur }
    })
  }, [albumId, saveDebounced, pushHistory])

  const setStudentKeys = useCallback((childId: string, patch: Record<string, string | null>) => {
    pushHistory()
    setStudentPatches((prev) => {
      const cur = { ...(prev[childId] ?? {}), ...patch }
      saveDebounced(`student:${childId}`, { action: 'cover_save_edit', album_id: albumId, scope: 'student', child_id: childId, data: cur })
      return { ...prev, [childId]: cur }
    })
  }, [albumId, saveDebounced, pushHistory])

  // Сохраняет на сервер все области (тип/ученик), различающиеся между снимками.
  // Используется при undo/redo: восстановленное состояние нужно записать в БД.
  const saveChangedScopes = useCallback((from: Snapshot, to: Snapshot) => {
    const types = Array.from(new Set([...Object.keys(from.typePatches), ...Object.keys(to.typePatches)]))
    for (const ct of types) {
      const a = from.typePatches[ct] ?? {}
      const b = to.typePatches[ct] ?? {}
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        saveDebounced(`type:${ct}`, { action: 'cover_save_edit', album_id: albumId, scope: 'type', cover_type: ct, data: b })
      }
    }
    const kids = Array.from(new Set([...Object.keys(from.studentPatches), ...Object.keys(to.studentPatches)]))
    for (const cid of kids) {
      const a = from.studentPatches[cid] ?? {}
      const b = to.studentPatches[cid] ?? {}
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        saveDebounced(`student:${cid}`, { action: 'cover_save_edit', album_id: albumId, scope: 'student', child_id: cid, data: b })
      }
    }
  }, [albumId, saveDebounced])

  const handleUndo = useCallback(() => {
    setHistory((h) => {
      if (h.past.length === 0) return h
      const prev = h.past[h.past.length - 1]
      const cur = snapshot()
      setTypePatches(prev.typePatches)
      setStudentPatches(prev.studentPatches)
      saveChangedScopes(cur, prev)
      return { past: h.past.slice(0, -1), future: [...h.future, cur] }
    })
  }, [snapshot, saveChangedScopes])

  const handleRedo = useCallback(() => {
    setHistory((h) => {
      if (h.future.length === 0) return h
      const next = h.future[h.future.length - 1]
      const cur = snapshot()
      setTypePatches(next.typePatches)
      setStudentPatches(next.studentPatches)
      saveChangedScopes(cur, next)
      return { past: [...h.past, cur], future: h.future.slice(0, -1) }
    })
  }, [snapshot, saveChangedScopes])

  // ── Стиль текста: служебные ключи __fontSize__/__color__/__halign__/
  //    __valign__/__font__ на уровне типа обложки (шаблонные правки) ─────────
  const handleTextStyleChange = useCallback((updates: {
    fontSize?: string | null
    color?: string | null
    halign?: string | null
    valign?: string | null
    font?: string | null
  }) => {
    if (!textStylePanel || !item) return
    pushHistory()
    const label = textStylePanel.label
    const coverType = item.cover_type
    setTypePatches((prev) => {
      const cur = { ...(prev[coverType] ?? {}) }
      const apply = (key: string, val?: string | null) => {
        if (val === undefined) return
        if (val === null) delete cur[key]
        else cur[key] = val
      }
      apply(`__fontSize__${label}`, updates.fontSize)
      apply(`__color__${label}`, updates.color)
      apply(`__halign__${label}`, updates.halign)
      apply(`__valign__${label}`, updates.valign)
      apply(`__font__${label}`, updates.font)
      saveDebounced(`type:${coverType}`, { action: 'cover_save_edit', album_id: albumId, scope: 'type', cover_type: coverType, data: cur })
      return { ...prev, [coverType]: cur }
    })
  }, [textStylePanel, item, albumId, saveDebounced, pushHistory])

  // ── Глобальные стили текстов обложек (модалка «Стили текстов») ────────────
  const handleSaveCoverTextStyles = useCallback(async (next: CoverTextStyleOverrides) => {
    const res = await fetch('/api/tenant', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cover_save_text_styles', album_id: albumId, cover_text_style_overrides: next }),
    })
    if (!res.ok) throw new Error('Не удалось сохранить стили')
    setCoverTextStyles(next)
  }, [albumId])

  // ── Кроп: портрет per-student у портретных, иначе шаблонно ───────────────
  const cropHandlers: CropHandlers = useMemo(() => ({
    onChange: (u) => {
      if (!cropLabel || !item) return
      const patch: Record<string, string | null> = {}
      if (u.scale !== undefined) patch[`__scale__${cropLabel}`] = u.scale
      if (u.offset !== undefined) patch[`__offset__${cropLabel}`] = u.offset
      if (u.rotate !== undefined) patch[`__rotate__${cropLabel}`] = u.rotate
      if (cropLabel === 'cover_portrait' && item.child_id) setStudentKeys(item.child_id, patch)
      else for (const k of Object.keys(patch)) setTypeKey(item.cover_type, k, patch[k])
    },
    onClose: () => setCropLabel(null),
    // Непрерывный жест кропа → один шаг undo: снимок один раз в начале,
    // далее не пишем историю до конца жеста.
    onGestureStart: () => { pushHistory(); suspendHistoryRef.current = true },
    onGestureEnd: () => { suspendHistoryRef.current = false },
  }), [cropLabel, item, setStudentKeys, setTypeKey, pushHistory])

  // ── Drag фото из палитры на слот ─────────────────────────────────────────
  const handleDragEnd = useCallback((e: DragEndEvent) => {
    const { active, over } = e
    if (!over || !item) return
    const photo = (active.data.current as { photo?: AlbumPhoto } | undefined)?.photo
    if (!photo) return
    const overId = String(over.id)
    const at = overId.lastIndexOf('@')
    const label = at === -1 ? overId : overId.slice(0, at)
    if (label === 'cover_portrait' && item.child_id) setStudentKeys(item.child_id, { cover_portrait: photo.url })
    else setTypeKey(item.cover_type, label, photo.url)
  }, [item, setStudentKeys, setTypeKey])

  // ── Размер холста ────────────────────────────────────────────────────────
  const canvasRef = useRef<HTMLDivElement>(null)
  const [canvasWidth, setCanvasWidth] = useState(800)
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const update = () => setCanvasWidth(Math.max(320, el.clientWidth - 32))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [loading, paletteCollapsed])

  // Переход к обложке N со сбросом активных режимов (кроп/текст/панель).
  const goToIdx = useCallback((i: number) => {
    setCurrentIdx(Math.max(0, Math.min(items.length - 1, i)))
    setCropLabel(null)
    setEditingTextLabel(null)
    setTextStylePanel(null)
  }, [items.length])

  // Клавиатура: Ctrl/Cmd+Z — отменить, Ctrl/Cmd+Shift+Z — повторить.
  // Во время инлайн-редактирования текста и в полноэкранном «Виде» не
  // перехватываем (там свой undo / своя навигация).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (fullscreenOpen || editingTextLabel) return
      const mod = e.metaKey || e.ctrlKey
      if (!mod || e.key.toLowerCase() !== 'z') return
      e.preventDefault()
      if (e.shiftKey) handleRedo(); else handleUndo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreenOpen, editingTextLabel, handleUndo, handleRedo])

  if (loading) return <div className="p-8 text-sm text-muted-foreground">Загрузка редактора обложек…</div>
  if (error) return <div className="p-8 text-sm text-red-600">{error}</div>
  if (items.length === 0) return (
    <div className="p-8 text-sm text-muted-foreground">
      Нет обложек для редактирования. Настрой обложку в заказе.
      <button className="ml-2 text-brand hover:underline" onClick={() => router.back()}>Назад</button>
    </div>
  )

  return (
    <div className="h-screen flex flex-col bg-muted">
      {/* Шапка */}
      <header className="shrink-0 flex items-center justify-between gap-2 bg-card border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={() => router.back()} className="btn-secondary !px-2 !py-1.5" title="Назад">
            <ChevronLeft size={18} />
          </button>
          <h1 className="font-semibold truncate" style={{ fontFamily: 'var(--font-display)' }}>Редактор обложек</h1>
          <span className="text-xs text-muted-foreground truncate">
            {item ? (item.child_name ?? TYPE_LABEL[item.cover_type]) : ''} · {item?.cover_name}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Глобальные стили текстов всех обложек. */}
          <button
            type="button"
            onClick={() => setTextStylesModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-border bg-card hover:bg-muted text-foreground transition-colors"
            title="Шрифт, размер, цвет и выравнивание текстов — для всех обложек сразу"
          >
            <Type size={16} /> Стили текстов
          </button>
          {/* Полноэкранный просмотр готовых обложек. */}
          <button
            type="button"
            onClick={() => setFullscreenOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-border bg-card hover:bg-muted text-foreground transition-colors"
            title="Полноэкранный просмотр готовых обложек"
          >
            <Eye size={16} /> Вид
          </button>
          {/* Отменить / Повторить. */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleUndo}
              disabled={history.past.length === 0}
              className="px-2.5 py-1 text-sm rounded border border-border bg-card hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="Отменить (Ctrl/⌘+Z)"
            >
              ↶ Отменить
              {history.past.length > 0 && (
                <span className="ml-1 text-xs text-muted-foreground">({history.past.length})</span>
              )}
            </button>
            <button
              type="button"
              onClick={handleRedo}
              disabled={history.future.length === 0}
              className="px-2.5 py-1 text-sm rounded border border-border bg-card hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="Повторить (Ctrl/⌘+Shift+Z)"
            >
              ↷ Повторить
              {history.future.length > 0 && (
                <span className="ml-1 text-xs text-muted-foreground">({history.future.length})</span>
              )}
            </button>
          </div>
          <div className="text-xs text-muted-foreground">{saving ? 'Сохраняю…' : '✓ Сохранено'}</div>
        </div>
      </header>

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="flex-1 flex overflow-hidden">
          {/* Холст */}
          <main className="flex-1 flex flex-col min-w-0">
            <div ref={canvasRef} className="flex-1 min-h-0 flex items-center justify-center p-4 overflow-auto">
              {item && item.master && (
                <CoverCanvas
                  master={item.master}
                  data={data}
                  spineWidthMm={editor?.spine_width_mm ?? null}
                  containerWidth={canvasWidth}
                  mode="edit"
                  coverTextStyles={coverTextStyles}
                  editingTextLabel={editingTextLabel}
                  onTextClick={(label, _currentValue, rightEdge, topEdge, leftEdge) => {
                    setEditingTextLabel(label)
                    setTextStylePanel({ label, rightEdge, topEdge, leftEdge })
                  }}
                  onTextSubmit={(label, val) => {
                    if (item) {
                      // Имя/класс — личные: пишем в область ученика. Остальное — на тип.
                      if ((PER_STUDENT_COVER_LABELS as readonly string[]).includes(label.toLowerCase()) && item.child_id) {
                        setStudentKeys(item.child_id, { [label]: val })
                      } else {
                        setTypeKey(item.cover_type, label, val)
                      }
                    }
                    setEditingTextLabel(null); setTextStylePanel(null)
                  }}
                  onTextCancel={() => { setEditingTextLabel(null); setTextStylePanel(null) }}
                  onPhotoClick={(label) => { setEditingTextLabel(null); setTextStylePanel(null); setCropLabel(label) }}
                  croppingLabel={cropLabel}
                  cropHandlers={cropHandlers}
                />
              )}
            </div>
            {item?.child_id && (
              <div className="shrink-0 text-center text-xs text-muted-foreground pb-2">
                Имя и класс — индивидуальны для ученика; кроп портрета тоже. Остальные тексты (заголовок, год, школа…) — общие для всех обложек типа «{TYPE_LABEL[item.cover_type]}».
              </div>
            )}
            {/* Навигация между обложками. */}
            <div className="shrink-0 flex items-center justify-center gap-3 pb-3">
              <button
                type="button"
                onClick={() => goToIdx(currentIdx - 1)}
                disabled={currentIdx <= 0}
                className="px-3 py-1.5 text-sm rounded border border-border bg-card hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
              >
                ◀ Назад
              </button>
              <span className="text-sm text-muted-foreground">
                Обложка {currentIdx + 1} из {items.length}
              </span>
              <button
                type="button"
                onClick={() => goToIdx(currentIdx + 1)}
                disabled={currentIdx >= items.length - 1}
                className="px-3 py-1.5 text-sm rounded border border-border bg-card hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Вперёд ▶
              </button>
            </div>
          </main>

          {/* Палитра фото */}
          <button
            onClick={() => setPaletteCollapsed((v) => !v)}
            className="shrink-0 w-6 bg-card border-l border-border flex items-center justify-center text-muted-foreground hover:text-foreground"
            title={paletteCollapsed ? 'Показать фото' : 'Скрыть фото'}
          >
            {paletteCollapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
          </button>
          <div className="hidden md:block shrink-0 overflow-hidden transition-[width]" style={{ width: paletteCollapsed ? 0 : 360 }}>
            <PhotoPalette spreads={[]} photos={photos} />
          </div>
        </div>

        {/* Лента обложек */}
        <div className="shrink-0 bg-card border-t border-border px-4 py-3">
          <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Обложки ({items.length})</div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {items.map((it, idx) => (
              <button
                key={it.key}
                onClick={() => goToIdx(idx)}
                className={`flex-shrink-0 text-left rounded border-2 p-1 bg-card ${idx === currentIdx ? 'border-brand-500 ring-2 ring-brand-200' : 'border-border'}`}
                style={{ width: 110 }}
              >
                <div className="w-full bg-muted rounded overflow-hidden" style={{ aspectRatio: '3 / 2' }}
                  dangerouslySetInnerHTML={{ __html: it.master ? coverThumb(it, editor?.spine_width_mm ?? null, typePatches, studentPatches) : '' }} />
                <div className="text-[10px] truncate mt-0.5">{it.child_name ?? TYPE_LABEL[it.cover_type]}</div>
              </button>
            ))}
          </div>
        </div>
      </DndContext>

      {/* Панель стилей текста — шрифт/размер/цвет/выравнивание (как в разворотах). */}
      {textStylePanel && item && (() => {
        const label = textStylePanel.label
        const mult = parseFontSizeMult(data[`__fontSize__${label}`])
        const colorOv = parseColor(data[`__color__${label}`])
        const hAlignOv = parseHAlign(data[`__halign__${label}`])
        const vAlignOv = parseVAlign(data[`__valign__${label}`])
        const fontOv = parseFontFamily(data[`__font__${label}`])
        const ph = item.master?.placeholders.find((p) => p.label === label)
        const templateFontFamily = ph && ph.type === 'text' ? ph.font_family : null
        return (
          <TextStylePanel
            label={label}
            fontSizeMult={mult}
            colorOverride={colorOv}
            hAlignOverride={hAlignOv}
            vAlignOverride={vAlignOv}
            fontFamilyOverride={fontOv}
            templateFontFamily={templateFontFamily}
            rightEdge={textStylePanel.rightEdge}
            topEdge={textStylePanel.topEdge}
            leftEdge={textStylePanel.leftEdge}
            onChange={handleTextStyleChange}
            onClose={() => setTextStylePanel(null)}
          />
        )
      })()}

      {/* Полноэкранный просмотр готовых обложек («Вид»). */}
      {fullscreenOpen && (
        <CoverPreviewFullscreen
          items={items.reduce<CoverPreviewItem[]>((acc, it) => {
            if (!it.master) return acc
            const merged = mergeCoverData(it.base, typePatches[it.cover_type] ?? {}, it.child_id ? studentPatches[it.child_id] ?? {} : {})
            acc.push({ master: it.master, data: merged, name: it.child_name ?? TYPE_LABEL[it.cover_type] })
            return acc
          }, [])}
          spineWidthMm={editor?.spine_width_mm ?? null}
          initialIdx={currentIdx}
          coverTextStyles={coverTextStyles}
          onClose={() => setFullscreenOpen(false)}
        />
      )}

      {/* Модалка глобальных стилей текстов обложек. */}
      {textStylesModalOpen && (
        <CoverTextStylesModal
          initialOverrides={coverTextStyles}
          onPreview={setCoverTextStyles}
          onSave={handleSaveCoverTextStyles}
          onClose={() => setTextStylesModalOpen(false)}
        />
      )}
    </div>
  )
}

// Миниатюра ленты со слитыми правками (pure-рендер SVG).
function coverThumb(
  it: Item,
  spine: number | null,
  typePatches: Record<string, Record<string, string | null>>,
  studentPatches: Record<string, Record<string, string | null>>,
): string {
  const m = it.master
  if (!m) return ''
  const n = (v: number | null) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const data = mergeCoverData(it.base, typePatches[it.cover_type] ?? {}, it.child_id ? studentPatches[it.child_id] ?? {} : {})
  const laid = layoutCover(
    { backWidthMm: n(m.back_width_mm), frontWidthMm: n(m.front_width_mm), heightMm: n(m.height_mm), nominalSpineWidthMm: n(m.nominal_spine_width_mm), realSpineWidthMm: spine ?? n(m.nominal_spine_width_mm) },
    m.placeholders as Array<RenderPlaceholder & { zone?: 'back' | 'spine' | 'front' }>,
  )
  let width = laid.width_mm, height = n(m.height_mm)
  if (width <= 0 || height <= 0) { width = 100; height = 67 }
  return renderCoverPreviewSvg({
    width_mm: width || 100, height_mm: height || 100,
    spine_left_mm: laid.spine_left_mm, spine_right_mm: laid.spine_right_mm,
    placeholders: laid.placeholders, data, background_url: m.background_url, hide_empty_slots: true,
  })
}
