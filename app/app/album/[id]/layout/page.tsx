'use client'

import { useEffect, useState, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import type {
  SpreadInstance,
  SpreadTemplate,
} from '@/lib/album-builder/types'
import PhotoPalette from '../../../_components/PhotoPalette'
import SpreadOrderStrip from '../../../_components/SpreadOrderStrip'
import TemplatePickerModal from '../../../_components/TemplatePickerModal'
import SaveIndicator from '../../../_components/SaveIndicator'
import PhotoContextMenu from '../../../_components/PhotoContextMenu'
import PhotoTransformPanel from '../../../_components/PhotoTransformPanel'
import { parseScale, parseOffset } from '@/lib/photo-transform'

// Konva-компонент: SSR-incompatible (использует window.Image).
const AlbumSpreadCanvas = dynamic(
  () => import('../../../_components/AlbumSpreadCanvas'),
  { ssr: false, loading: () => null },
)

// ─── Тип loadable layout (минимальный shape для редактора) ───────────────
type LayoutData = {
  layout_id: string
  template_set_id: string
  spreads: SpreadInstance[]
}

// ─── Тип фото для палитры (соответствует 2.4 endpoint response) ──────────
type AlbumPhoto = {
  id: string
  filename: string
  storage_path: string
  thumb_path: string | null
  type: 'portrait' | 'group' | 'teacher' | null
  source: 'selections' | 'originals'
  child_ids: string[]
  teacher_ids: string[]
  selection_types: string[]
  has_original?: boolean  // Л.2: чтобы UI «Заменить оригинал» знал доступно ли действие
  url: string
  thumb_url: string
  created_at: string
}

// ─── Refresh-aware api() — копия из app/app/page.tsx ─────────────────────
//
// При 401 пытается отрефрешить access token через /api/auth и
// повторить исходный запрос. Дедупликация одновременных refresh'ей
// через module-scope `_refreshing`.
//
// Изначально в 2.6.1 я не копировал эту логику (надеясь, что редактор
// не нужна), но визуальная проверка 2.6.2 показала: партнёр открывает
// редактор после нескольких часов простоя → 401 → пустой экран. Не
// годится для долгих editing-сессий. См. 2.6.2.1.
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
    headers: { 'Content-Type': 'application/json', ...(opts?.headers ?? {}) },
  })
  if (res.status === 401) {
    const ok = await refreshAccessToken()
    if (ok) {
      return fetch(path, {
        ...opts,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(opts?.headers ?? {}) },
      })
    }
  }
  return res
}

// ═════════════════════════════════════════════════════════════════════════
// LayoutEditorPage — fullscreen редактор layout'а альбома (фаза 2.6).
//
// В подэтапе 2.6.1 — только скелет: header, левая колонка с одним
// spread в edit-режиме, правая колонка-заглушка, навигация ◀▶ между
// разворотами. Drag-and-drop, палитра, auto-save — в подэтапах 2.6.2-4.
// ═════════════════════════════════════════════════════════════════════════
// Suspense-обёртка для default export. useSearchParams в Next 14
// требует client-side render и Suspense boundary для SSG/build.
// Inner-компонент содержит всю логику.
export default function LayoutEditorPage({
  params,
}: {
  params: { id: string }
}) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-gray-500">
          Загружаем редактор…
        </div>
      }
    >
      <LayoutEditorPageInner params={params} />
    </Suspense>
  )
}

function LayoutEditorPageInner({
  params,
}: {
  params: { id: string }
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const viewAsTenantId = searchParams?.get('view_as') ?? null
  const albumId = params.id

  const [layout, setLayout] = useState<LayoutData | null>(null)
  const [templates, setTemplates] = useState<SpreadTemplate[]>([])
  const [photos, setPhotos] = useState<AlbumPhoto[]>([])
  const [albumTitle, setAlbumTitle] = useState<string>('')
  const [currentIdx, setCurrentIdx] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viewport, setViewport] = useState({ width: 1440, height: 900 })
  // Drag-состояние:
  // - mode='palette': drag фото из правой колонки. DragOverlay используется
  //   с дефолтным 120px thumbnail (палитра маленькая, фикс размер уместен).
  // - mode='swap': drag фото между placeholder'ами в canvas. DragOverlay
  //   НЕ используется — DropZone сам рендерит img-copy с CSS transform.
  //   Это гарантирует что точка клика остаётся под курсором. label
  //   нужен чтобы AlbumSpreadCanvas скрыл Konva-копию (избежать двойного
  //   отображения).
  type DragState =
    | { mode: 'palette'; photo: AlbumPhoto }
    | { mode: 'swap'; photo: AlbumPhoto; label: string }
    | null
  const [dragState, setDragState] = useState<DragState>(null)
  // Фаза Л.1 — редактирование текста.
  // editingTextLabel: label сейчас редактируемого text-placeholder'а
  // (или null если ничего не редактируется). При смене разворота
  // автоматически сбрасывается (см. useEffect ниже).
  const [editingTextLabel, setEditingTextLabel] = useState<string | null>(null)
  // Л.2 — контекстное меню photo placeholder.
  // null = меню закрыто. Когда открыто — храним label, url, координаты клика.
  const [photoContextMenu, setPhotoContextMenu] = useState<
    | null
    | { label: string; url: string | null; clientX: number; clientY: number }
  >(null)
  // КЭ.5 — panel кадрирования фото (scale + offset).
  // Открывается одинарным кликом на photo placeholder с фото.
  // spreadIndex нужен для адресации в /api/layout?action=update_data.
  const [photoTransformPanel, setPhotoTransformPanel] = useState<
    | null
    | {
        spreadIndex: number
        label: string
        clientX: number
        clientY: number
      }
  >(null)
  // Идёт ли сейчас загрузка нового оригинала через replace_original.
  // Показывается toast в header'е чтобы партнёр видел что процесс идёт.
  const [replacingOriginal, setReplacingOriginal] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'pending' | 'saving' | 'error'>('saved')
  const [lastSavedSpreads, setLastSavedSpreads] = useState<SpreadInstance[] | null>(null)
  const saveCounterRef = useRef(0)

  // ─── Фаза Л.3 — Undo/Redo history ────────────────────────────────────
  // Храним past + future стэки snapshot'ов spreads. Лимит 50 шагов
  // (старые забываются). История сбрасывается при загрузке layout'а.
  //
  // skipNextHistoryRef = true чтобы изменения через undo/redo не
  // попадали в past заново (иначе одно нажатие Ctrl+Z создавало бы
  // новую entry и Ctrl+Shift+Z не работал).
  const [history, setHistory] = useState<{
    past: SpreadInstance[][]
    future: SpreadInstance[][]
  }>({ past: [], future: [] })
  const skipNextHistoryRef = useRef(false)
  const prevSpreadsRef = useRef<SpreadInstance[] | null>(null)

  // Фаза Л.4a — read-only режим.
  // canEdit: false если backend сказал can_edit=false (workflow submitted,
  // view_as, viewer role). isMobile: true для экранов <768px — мобильный
  // редактор это view-only по UX причинам (drag и edit неудобны).
  // Эффективный isReadOnly = !canEdit || isMobile.
  const [canEdit, setCanEdit] = useState<boolean>(true)
  const [editBlockReason, setEditBlockReason] = useState<
    'role' | 'view_as' | 'submitted' | null
  >(null)
  const [workflowStatus, setWorkflowStatus] = useState<string>('active')
  const [isMobile, setIsMobile] = useState<boolean>(false)

  // Подписка на изменение размера экрана для mobile detection.
  // Используем matchMedia вместо resize event — он реактивно
  // срабатывает только на пересечении breakpoint'а.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(max-width: 767px)')
    setIsMobile(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const isReadOnly = !canEdit || isMobile

  // Л.5 — onboarding tooltip при первом открытии редактора.
  // localStorage флаг `yearbook_layout_editor_seen` — если уже видели
  // (true), tooltip не показываем. Чтобы партнёр мог вернуться к
  // подсказке — есть кнопка «?» в header (но shortcuts modal мы
  // решили не делать, поэтому пока убрана).
  //
  // Не показываем в read-only — там и так есть баннер с пояснением.
  const [showOnboarding, setShowOnboarding] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (isReadOnly) return
    if (loading || error || !layout) return
    try {
      const seen = window.localStorage.getItem('yearbook_layout_editor_seen')
      if (!seen) {
        setShowOnboarding(true)
      }
    } catch {
      // localStorage отключён (приватный режим) — пропускаем
    }
  }, [loading, error, layout, isReadOnly])

  function dismissOnboarding() {
    setShowOnboarding(false)
    try {
      window.localStorage.setItem('yearbook_layout_editor_seen', '1')
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    const update = () => setViewport({
      width: window.innerWidth,
      height: window.innerHeight,
    })
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  // ─── Загрузка данных при монтировании ──────────────────────────────────
  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        // Helper для добавления view_as к URL если нужно
        const va = viewAsTenantId ? `&view_as=${viewAsTenantId}` : ''

        // 1. Загружаем layout (получаем template_set_id + can_edit + workflow_status)
        const layoutRes = await api(
          `/api/layout?action=album_layout&album_id=${albumId}${va}`,
        )
        if (!layoutRes.ok) {
          throw new Error(`layout load failed: ${layoutRes.status}`)
        }
        const layoutJson = await layoutRes.json()
        // Сохраняем read-only сигналы независимо от того есть ли layout
        if (!cancelled) {
          setCanEdit(layoutJson.can_edit ?? true)
          setEditBlockReason(layoutJson.edit_block_reason ?? null)
          setWorkflowStatus(layoutJson.workflow_status ?? 'active')
        }
        if (!layoutJson.layout) {
          throw new Error(
            'Layout ещё не построен. Откройте альбом в кабинете и нажмите «Собрать автоматически».',
          )
        }
        const loadedLayout: LayoutData = {
          layout_id: layoutJson.layout.layout_id,
          template_set_id: layoutJson.layout.template_set_id,
          spreads: layoutJson.layout.spreads as SpreadInstance[],
        }

        // 2. Параллельно: template_set_detail + album_photos + album title
        const [templateRes, photosRes, albumRes] = await Promise.all([
          api(
            `/api/layout?action=template_set_detail&id=${loadedLayout.template_set_id}${va}`,
          ),
          api(`/api/tenant?action=album_photos&album_id=${albumId}${va}`),
          api(`/api/tenant?action=album&album_id=${albumId}${va}`),
        ])

        if (!templateRes.ok) {
          throw new Error(`template load failed: ${templateRes.status}`)
        }
        if (!photosRes.ok) {
          throw new Error(`photos load failed: ${photosRes.status}`)
        }

        const templateJson = await templateRes.json()
        const photosJson = await photosRes.json()
        // album endpoint можно проигнорировать если упал — это не блокер
        let title = ''
        if (albumRes.ok) {
          const albumJson = await albumRes.json()
          title = (Array.isArray(albumJson) ? albumJson[0]?.title : albumJson?.title) ?? ''
        }

        if (cancelled) return
        setLayout(loadedLayout)
        setLastSavedSpreads(loadedLayout.spreads)
        setTemplates(templateJson.spread_templates ?? [])
        setPhotos(photosJson.photos ?? [])
        setAlbumTitle(title)
        setLoading(false)
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message)
          setLoading(false)
        }
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [albumId])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  async function saveLayout(spreads: SpreadInstance[]) {
    const myCounter = ++saveCounterRef.current
    setSaveStatus('saving')
    try {
      const res = await api('/api/layout?action=save_album_layout', {
        method: 'POST',
        body: JSON.stringify({ album_id: albumId, spreads }),
      })
      // Игнорируем устаревший ответ (если за время запроса начался ещё один)
      if (myCounter !== saveCounterRef.current) return
      if (res.ok) {
        setLastSavedSpreads(spreads)
        setSaveStatus('saved')
      } else {
        setSaveStatus('error')
      }
    } catch {
      if (myCounter !== saveCounterRef.current) return
      setSaveStatus('error')
    }
  }

  // Debounce auto-save: при изменении layout.spreads ждём 2с тишины,
  // потом отправляем POST. При новом изменении старый таймер отменяется.
  // Read-only режим (Л.4a) полностью отключает auto-save.
  useEffect(() => {
    if (!layout || lastSavedSpreads === null) return
    if (isReadOnly) return  // Л.4a — в read-only не сохраняем
    const isUnchanged =
      JSON.stringify(layout.spreads) === JSON.stringify(lastSavedSpreads)
    if (isUnchanged) {
      // Изменения откатились (например swap туда-обратно) — статус saved
      if (saveStatus !== 'saved' && saveStatus !== 'saving') {
        setSaveStatus('saved')
      }
      return
    }
    setSaveStatus('pending')
    const timer = setTimeout(() => {
      saveLayout(layout.spreads)
    }, 2000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout?.spreads, lastSavedSpreads, isReadOnly])

  // Предупреждение перед закрытием вкладки если есть несохранённые изменения
  useEffect(() => {
    if (saveStatus === 'saved') return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [saveStatus])

  // ─── Фаза Л.3 — History tracking ──────────────────────────────────────
  //
  // Push в past каждый раз когда layout.spreads меняется через пользовательское
  // действие (drag, text edit, clear). При undo/redo мы ставим
  // skipNextHistoryRef = true чтобы их собственные setLayout вызовы НЕ
  // создавали новые entries в past.
  useEffect(() => {
    if (!layout) return
    const current = layout.spreads
    const prev = prevSpreadsRef.current
    if (prev && prev !== current) {
      if (skipNextHistoryRef.current) {
        skipNextHistoryRef.current = false
      } else {
        // Игнорируем no-op изменения (deep equal через JSON.stringify
        // достаточно — spreads — простая структура).
        const prevStr = JSON.stringify(prev)
        const currStr = JSON.stringify(current)
        if (prevStr !== currStr) {
          setHistory(h => ({
            past: [...h.past.slice(-49), prev],  // лимит 50
            future: [],  // любое новое действие сбрасывает future
          }))
        }
      }
    }
    prevSpreadsRef.current = current
  }, [layout?.spreads])

  // При успешной первичной загрузке layout инициализируем prevSpreadsRef
  // и очищаем history (на случай если редактор открывали раньше в этой
  // же сессии — но это не должно случаться, page mount = новый layout).
  useEffect(() => {
    if (layout && !prevSpreadsRef.current) {
      prevSpreadsRef.current = layout.spreads
      setHistory({ past: [], future: [] })
    }
  }, [layout])

  function handleUndo() {
    setEditingTextLabel(null)  // если редактируется текст — закрываем
    setPhotoContextMenu(null)  // и контекстное меню
    setPhotoTransformPanel(null)  // и панель кадрирования (КЭ.5)
    setHistory(h => {
      if (h.past.length === 0) return h
      const last = h.past[h.past.length - 1]
      if (!layout) return h
      const currentSpreads = layout.spreads
      skipNextHistoryRef.current = true
      setLayout({ ...layout, spreads: last })
      return {
        past: h.past.slice(0, -1),
        future: [currentSpreads, ...h.future].slice(0, 50),
      }
    })
  }

  function handleRedo() {
    setEditingTextLabel(null)
    setPhotoContextMenu(null)
    setPhotoTransformPanel(null)
    setHistory(h => {
      if (h.future.length === 0) return h
      const next = h.future[0]
      if (!layout) return h
      const currentSpreads = layout.spreads
      skipNextHistoryRef.current = true
      setLayout({ ...layout, spreads: next })
      return {
        past: [...h.past.slice(-49), currentSpreads],
        future: h.future.slice(1),
      }
    })
  }

  // Force-save немедленно (обходит debounce). Используется через Ctrl+S.
  function handleForceSave() {
    if (!layout) return
    const isUnchanged =
      lastSavedSpreads !== null &&
      JSON.stringify(layout.spreads) === JSON.stringify(lastSavedSpreads)
    if (isUnchanged) return  // нечего сохранять
    void saveLayout(layout.spreads)
  }

  // Global keyboard handlers: Ctrl+Z / Cmd+Z / Ctrl+Shift+Z / Ctrl+S
  // Игнорируется когда фокус в INPUT/TEXTAREA — там работает нативный
  // undo браузера (важно для inline text editor'a).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isReadOnly) return  // Л.4a — Ctrl+Z/Ctrl+S отключены в read-only
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }
      const ctrlOrCmd = e.ctrlKey || e.metaKey
      if (!ctrlOrCmd) return

      if (e.key === 'z' || e.key === 'Z' || e.key === 'я' || e.key === 'Я') {
        e.preventDefault()
        if (e.shiftKey) {
          handleRedo()
        } else {
          handleUndo()
        }
      } else if (e.key === 's' || e.key === 'S' || e.key === 'ы' || e.key === 'Ы') {
        e.preventDefault()
        handleForceSave()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, layout, lastSavedSpreads, isReadOnly])

  // Л.5 — стрелки ← / → для навигации между разворотами.
  // Работают всегда (даже в read-only — это просмотр, не редактирование).
  // Игнорируются если фокус в input/textarea (стрелки внутри textarea
  // нужны для перемещения курсора в тексте) или если editingText активен.
  useEffect(() => {
    function onArrow(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }
      // Игнорируем если есть зажатые модификаторы — Ctrl+← / Cmd+← это
      // обычно «назад в истории браузера», не наша область
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return

      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setCurrentIdx((i) => Math.max(0, i - 1))
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        const total = layout?.spreads.length ?? 0
        setCurrentIdx((i) => Math.min(total - 1, i + 1))
      }
    }
    window.addEventListener('keydown', onArrow)
    return () => window.removeEventListener('keydown', onArrow)
  }, [layout?.spreads.length])

  function handleDragStart(event: DragStartEvent) {
    if (isReadOnly) return  // Л.4a — drag заблокирован в read-only
    const sourceData = event.active.data.current as
      | { type?: string; photo?: AlbumPhoto; url?: string | null; label?: string }
      | undefined

    if (sourceData?.type === 'palette' && sourceData.photo) {
      setDragState({ mode: 'palette', photo: sourceData.photo })
      return
    }

    if (sourceData?.type === 'placeholder' && sourceData.url && sourceData.label) {
      // Для swap-режима НЕ используем DragOverlay (он рендерится через
      // portal и в нашем layout @dnd-kit неправильно позиционирует его —
      // курсор оказывается у левого-верхнего угла независимо от точки
      // клика). Вместо этого DropZone сам рендерит img-copy с CSS
      // transform — это гарантированно сохраняет точку клика под
      // курсором (базовое поведение translate).
      //
      // draggingLabel передаётся в AlbumSpreadCanvas чтобы скрыть
      // Konva-копию фото и избежать двойного отображения.
      const photo = photos.find((p) => p.url === sourceData.url)
      if (!photo) return
      setDragState({
        mode: 'swap',
        photo,
        label: sourceData.label,
      })
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    setDragState(null)
    if (isReadOnly) return  // Л.4a — drop не применяется в read-only
    const { active, over } = event
    if (!over) return  // drop вне drop-зоны

    const sourceData = active.data.current as
      | { type?: string; photo?: AlbumPhoto; label?: string; url?: string | null }
      | undefined
    const targetLabel = String(over.id)

    if (sourceData?.type === 'palette') {
      // Палитра → placeholder: вставить URL фото
      const photo = sourceData.photo
      if (!photo) return
      setLayout((prev) => {
        if (!prev) return prev
        const newSpreads = prev.spreads.map((s, idx) =>
          idx === currentIdx
            ? { ...s, data: { ...s.data, [targetLabel]: photo.url } }
            : s,
        )
        return { ...prev, spreads: newSpreads }
      })
      return
    }

    if (sourceData?.type === 'placeholder') {
      // Swap между placeholder'ами в текущем спреде
      const sourceLabel = sourceData.label
      if (!sourceLabel || sourceLabel === targetLabel) return
      setLayout((prev) => {
        if (!prev) return prev
        const newSpreads = prev.spreads.map((s, idx) => {
          if (idx !== currentIdx) return s
          const valueA = s.data[sourceLabel] ?? null
          const valueB = s.data[targetLabel] ?? null
          return {
            ...s,
            data: { ...s.data, [sourceLabel]: valueB, [targetLabel]: valueA },
          }
        })
        return { ...prev, spreads: newSpreads }
      })
    }
  }

  // ─── Фаза Л.1: handlers для редактирования текста ───────────────────────

  function handleTextClick(label: string, _currentValue: string | null) {
    // Если уже что-то редактируется — сначала закрываем (с сохранением
    // через onBlur эффект textarea), потом открываем новое.
    // setEditingTextLabel'у одного значения достаточно: textarea со
    // старым label получает unmount → onBlur → handleTextSubmit → cleanup.
    setEditingTextLabel(label)
  }

  function handleTextSubmit(label: string, newValue: string | null) {
    setLayout((prev) => {
      if (!prev) return prev
      const newSpreads = prev.spreads.map((s, idx) => {
        if (idx !== currentIdx) return s
        const oldValue = s.data[label] ?? null
        if (oldValue === newValue) return s  // ничего не изменилось
        return { ...s, data: { ...s.data, [label]: newValue } }
      })
      return { ...prev, spreads: newSpreads }
    })
    setEditingTextLabel(null)
  }

  function handleTextCancel() {
    setEditingTextLabel(null)
  }

  // При смене разворота — закрываем текущий редактор текста (если открыт).
  // Auto-save от useEffect выше всё равно сохранит текст если он был
  // изменён до переключения (через onBlur → handleTextSubmit).
  useEffect(() => {
    setEditingTextLabel(null)
    setPhotoContextMenu(null)
    setPhotoTransformPanel(null)  // КЭ.5 — закрываем кадрирование при смене разворота
  }, [currentIdx])

  // ─── Фаза Л.2: handlers для photo context menu ──────────────────────────

  function handlePhotoContextMenu(
    label: string,
    url: string | null,
    clientX: number,
    clientY: number,
  ) {
    setPhotoContextMenu({ label, url, clientX, clientY })
  }

  // КЭ.5 — одинарный клик на фото открывает кадрирование (scale + offset).
  // Срабатывает только если есть фото (DropZone проверяет url != null).
  function handlePhotoClick(
    label: string,
    _url: string,
    clientX: number,
    clientY: number,
  ) {
    // Если уже открыта panel для этого же label — не дёргаем (избегаем
    // случайного двойного клика). Иначе показываем для нового.
    if (
      photoTransformPanel &&
      photoTransformPanel.label === label &&
      photoTransformPanel.spreadIndex === currentIdx
    ) {
      return
    }
    setPhotoTransformPanel({
      spreadIndex: currentIdx,
      label,
      clientX,
      clientY,
    })
  }

  // КЭ.5 — изменение transform из PhotoTransformPanel.
  // Стратегия:
  //   1. Optimistic update layout state (мгновенный rerender canvas)
  //   2. saveStatus='pending' → существующий debounce-механизм save_album_layout
  //      (Л.4) подхватит изменения. Использовать /api/layout?action=update_data
  //      специально для transform — overkill; save_album_layout уже
  //      реализован и отлажен. Этим путём:
  //        - Один и тот же UI для пользователя ('Сохранено')
  //        - Одна логика undo/redo
  //        - Один rate-limit на debounce
  //   3. При scale=1 и offset=(0,0) → ключи удаляются (null значение
  //      в data). save_album_layout пишет весь spreads массив, так что
  //      удаление работает natively.
  //
  // ПРИМЕЧАНИЕ: action=update_data из КЭ.3 в итоге может пригодиться для
  // realtime collaboration (если/когда добавим), но в одинарном-юзер
  // сценарии save_album_layout проще и dедупликует логику.
  function handleTransformChange(updates: {
    scale?: string | null
    offset?: string | null
  }) {
    if (!photoTransformPanel) return
    const { label, spreadIndex } = photoTransformPanel
    setLayout((prev) => {
      if (!prev) return prev
      const newSpreads = prev.spreads.map((s, idx) => {
        if (idx !== spreadIndex) return s
        const newData = { ...s.data }
        const scaleKey = `__scale__${label}`
        const offsetKey = `__offset__${label}`
        if (updates.scale !== undefined) {
          if (updates.scale === null) delete newData[scaleKey]
          else newData[scaleKey] = updates.scale
        }
        if (updates.offset !== undefined) {
          if (updates.offset === null) delete newData[offsetKey]
          else newData[offsetKey] = updates.offset
        }
        return { ...s, data: newData }
      })
      return { ...prev, spreads: newSpreads }
    })
  }

  function handleTransformPanelClose() {
    setPhotoTransformPanel(null)
  }

  function handleClearPhoto(label: string) {
    setLayout((prev) => {
      if (!prev) return prev
      const newSpreads = prev.spreads.map((s, idx) => {
        if (idx !== currentIdx) return s
        if (s.data[label] === null || s.data[label] === undefined) return s
        return { ...s, data: { ...s.data, [label]: null } }
      })
      return { ...prev, spreads: newSpreads }
    })
  }

  // М.1 — переупорядочивание разворотов через drag-and-drop strip.
  // SpreadOrderStrip уже:
  //   1. Перевычислил spread_index в новых позициях
  //   2. Сохранил ссылку на текущий активный разворот (передаёт onSelect
  //      с новым idx если активный сдвинулся)
  // Здесь просто применяем новый порядок к layout.spreads.
  function handleReorderSpreads(newSpreads: SpreadInstance[]) {
    setLayout((prev) => {
      if (!prev) return prev
      return { ...prev, spreads: newSpreads }
    })
  }

  // М.2 — удалить разворот по индексу. Защиты:
  //   - confirm для подтверждения
  //   - не позволяем удалить последний разворот (нужно хотя бы один)
  //   - если удалили активный — переключаемся на предыдущий
  //   - реномерация spread_index у оставшихся
  function handleDeleteSpread(idx: number) {
    if (!layout || layout.spreads.length <= 1) return
    const template = templates.find((t) => t.id === layout.spreads[idx]?.template_id)
    const label = template?.name ?? `Разворот ${idx + 1}`
    if (!confirm(`Удалить разворот «${label}»?\n\nЕго содержимое (фото и текст) будет потеряно — это действие можно отменить через Ctrl+Z.`)) {
      return
    }
    const newSpreads = layout.spreads
      .filter((_, i) => i !== idx)
      .map((s, i) => ({ ...s, spread_index: i }))
    setLayout({ ...layout, spreads: newSpreads })
    // Активный разворот сдвигается если удалили его или предшествующий
    if (currentIdx >= newSpreads.length) {
      setCurrentIdx(Math.max(0, newSpreads.length - 1))
    } else if (currentIdx > idx) {
      setCurrentIdx(currentIdx - 1)
    }
  }

  // М.2 — открытие picker'а для добавления нового разворота.
  // insertAfterIdx запоминается чтобы после выбора шаблона знать куда
  // вставить (после текущего активного на момент клика).
  const [addAfterIdx, setAddAfterIdx] = useState<number | null>(null)

  function handleAddRequest(insertAfterIdx: number) {
    setAddAfterIdx(insertAfterIdx)
  }

  function handleAddSpread(template: SpreadTemplate) {
    if (!layout || addAfterIdx === null) {
      setAddAfterIdx(null)
      return
    }
    // Новый spread с пустыми данными — placeholder'ы будут пустые,
    // партнёр заполнит drag'ом из палитры или редактированием текста.
    const newSpread: SpreadInstance = {
      spread_index: 0,  // будет переписан ниже
      template_id: template.id,
      template_name: template.name,
      data: {},
    }
    const before = layout.spreads.slice(0, addAfterIdx + 1)
    const after = layout.spreads.slice(addAfterIdx + 1)
    const merged = [...before, newSpread, ...after].map((s, i) => ({
      ...s,
      spread_index: i,
    }))
    setLayout({ ...layout, spreads: merged })
    setCurrentIdx(addAfterIdx + 1)  // переходим на только что добавленный
    setAddAfterIdx(null)
  }

  // М.3 — замена шаблона существующего разворота.
  // replaceTemplateForIdx === null когда picker закрыт.
  // Mapping старых данных в новые placeholder'ы:
  //   - Сравниваем по label (e.g. 'studentphoto', 'studentname')
  //   - Если есть в новом шаблоне → переносим значение
  //   - Иначе данные теряются (партнёр получит warning + Ctrl+Z восстановит)
  // Это безопасно для типовых сценариев (поменяли E-Student-Standard
  // на E-Student-Quote — labels пересекаются на 80-90%), но для
  // несовместимых шаблонов часть данных пропадёт.
  const [replaceTemplateForIdx, setReplaceTemplateForIdx] = useState<number | null>(null)

  function handleReplaceTemplate(newTemplate: SpreadTemplate) {
    if (!layout || replaceTemplateForIdx === null) {
      setReplaceTemplateForIdx(null)
      return
    }
    const idx = replaceTemplateForIdx
    const oldSpread = layout.spreads[idx]
    if (!oldSpread) {
      setReplaceTemplateForIdx(null)
      return
    }

    // Перенос данных: новые placeholder'ы получают значения от старых
    // если label совпадает. Лишние данные (label которых нет в новом
    // шаблоне) отбрасываются.
    const newData: Record<string, string | null> = {}
    let preserved = 0
    let lost = 0
    for (const ph of newTemplate.placeholders) {
      if (ph.label in oldSpread.data) {
        newData[ph.label] = oldSpread.data[ph.label] ?? null
        if (oldSpread.data[ph.label]) preserved++
      } else {
        newData[ph.label] = null
      }
    }
    for (const label of Object.keys(oldSpread.data)) {
      if (!newTemplate.placeholders.some((p) => p.label === label)) {
        if (oldSpread.data[label]) lost++
      }
    }

    if (lost > 0) {
      const ok = confirm(
        `Перенесено ${preserved} значений, потеряется ${lost} (фото/текст которых нет в новом шаблоне).\n\n` +
        `Это можно отменить через Ctrl+Z. Заменить?`,
      )
      if (!ok) {
        setReplaceTemplateForIdx(null)
        return
      }
    }

    const newSpreads = layout.spreads.map((s, i) => {
      if (i !== idx) return s
      return {
        ...s,
        template_id: newTemplate.id,
        template_name: newTemplate.name,
        data: newData,
      }
    })
    setLayout({ ...layout, spreads: newSpreads })
    setReplaceTemplateForIdx(null)
  }

  // Замена оригинала фото без смены WebP. WebP в макете не меняется,
  // PDF-экспорт при следующем рендере возьмёт новый оригинал.
  // Реиспользует action rebind_retouched из К.3 (фаза К workflow).
  async function handleReplaceOriginal(photoId: string) {
    // Открываем file picker программно
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/jpeg,image/jpg,image/png,image/tiff'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return

      setReplacingOriginal(file.name)
      try {
        // 1. Получаем presigned URL для нового оригинала в YC
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

        // 2. PUT файла в YC (минуя Vercel 4.5МБ лимит)
        const putRes = await fetch(upload_url, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
        })
        if (!putRes.ok) {
          throw new Error(`PUT в YC: HTTP ${putRes.status}`)
        }

        // 3. Привязываем новый оригинал к photo через rebind_retouched
        // (action из К.3). Старый оригинал удаляется внутри endpoint'а.
        const rebindRes = await api('/api/workflow', {
          method: 'POST',
          body: JSON.stringify({
            action: 'rebind_retouched',
            album_id: albumId,
            photo_id: photoId,
            storage_path,
          }),
        })
        if (!rebindRes.ok) {
          const d = await rebindRes.json().catch(() => ({}))
          throw new Error(d.error ?? `rebind HTTP ${rebindRes.status}`)
        }

        // Обновляем локальный photos чтобы has_original всё ещё был true
        // (а если у photo раньше его не было — стал true).
        setPhotos((prev) =>
          prev.map((p) => (p.id === photoId ? { ...p, has_original: true } : p)),
        )

        alert(`Оригинал для "${file.name}" заменён. PDF-экспорт будет использовать новую версию.`)
      } catch (e: any) {
        alert(`Не удалось заменить оригинал: ${e?.message ?? 'неизвестная ошибка'}`)
      } finally {
        setReplacingOriginal(null)
      }
    }
    input.click()
  }

  // Замена фото целиком: загружаем новый файл, сжимаем в WebP,
  // регистрируем как photo, в фоне грузим оригинал, ставим в слот.
  // Этот flow — то что обычно ожидает партнёр при «загрузить другое фото».
  //
  // photo_type для нового photo наследуется от текущего фото в слоте
  // (если есть). Если слот пуст — fallback на 'portrait'. Партнёр потом
  // может перенастроить через PhotoTab если нужно.
  async function handleReplaceFullPhoto(label: string, currentUrl: string | null) {
    // Определяем type для нового photo по текущему в слоте
    const currentPhoto = currentUrl ? photos.find((p) => p.url === currentUrl) : null
    const photoType =
      (currentPhoto?.type as 'portrait' | 'group' | 'teacher' | null) || 'portrait'

    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return

      setReplacingOriginal(`${file.name} (новое фото)`)
      try {
        // 1. Сжать в WebP клиентом (тот же flow что в PhotoTab.uploadFilesParallel)
        const imageCompression = (await import('browser-image-compression')).default
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
          // компрессия упала — загружаем оригинал как WebP
        }

        // 2. Загружаем WebP через /api/upload (создаёт photos запись)
        const formData = new FormData()
        const webpFile = new File(
          [compressed],
          file.name.replace(/\.[^.]+$/, '.webp'),
          { type: 'image/webp' },
        )
        formData.append('file', webpFile)
        formData.append('album_id', albumId)
        formData.append('type', photoType)
        formData.append('original_name', file.name)

        const uploadRes = await fetch('/api/upload', {
          method: 'POST',
          credentials: 'include',
          body: formData,
        })
        if (!uploadRes.ok) {
          const d = await uploadRes.json().catch(() => ({}))
          throw new Error(d.error ?? `upload HTTP ${uploadRes.status}`)
        }
        const uploadData = await uploadRes.json()
        const newPhotoId = uploadData.photo_id
        if (!newPhotoId) throw new Error('upload не вернул photo_id')

        // 3. Reload photos чтобы найти новое фото и узнать его URL
        // (URL формируется в backend через getPhotoUrl, проще получить готовым).
        const photosRes = await api(`/api/tenant?action=album_photos&album_id=${albumId}`)
        if (!photosRes.ok) {
          throw new Error(`reload photos HTTP ${photosRes.status}`)
        }
        const photosData = await photosRes.json()
        const newPhotos = (photosData.photos ?? []) as AlbumPhoto[]
        setPhotos(newPhotos)
        const newPhoto = newPhotos.find((p) => p.id === newPhotoId)
        if (!newPhoto) {
          throw new Error('новое фото не найдено в палитре после загрузки')
        }

        // 4. Ставим новое фото в слот — обновляем layout.spreads.
        // History trackingу это нормальное действие, popадёт в past.
        setLayout((prev) => {
          if (!prev) return prev
          const newSpreads = prev.spreads.map((s, idx) =>
            idx === currentIdx
              ? { ...s, data: { ...s.data, [label]: newPhoto.url } }
              : s,
          )
          return { ...prev, spreads: newSpreads }
        })

        // 5. В фоне — загружаем оригинал через presigned URL.
        // Не блокируем UI (партнёр уже видит новое фото в макете).
        void (async () => {
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
            if (!urlRes.ok) return
            const { upload_url, storage_path: origPath } = await urlRes.json()

            const putRes = await fetch(upload_url, {
              method: 'PUT',
              body: file,
              headers: { 'Content-Type': file.type || 'application/octet-stream' },
            })
            if (!putRes.ok) return

            await api('/api/tenant', {
              method: 'POST',
              body: JSON.stringify({
                action: 'register_original',
                photo_id: newPhotoId,
                original_path: origPath,
              }),
            })
            // Обновляем has_original в photos state
            setPhotos((prev) =>
              prev.map((p) => (p.id === newPhotoId ? { ...p, has_original: true } : p)),
            )
          } catch {
            // Не критично — WebP уже стоит в слоте, оригинал можно
            // догрузить отдельно (PhotoTab «📤 Догрузить оригинал»).
          }
        })()
      } catch (e: any) {
        alert(`Не удалось загрузить фото: ${e?.message ?? 'неизвестная ошибка'}`)
      } finally {
        setReplacingOriginal(null)
      }
    }
    input.click()
  }

  // ─── Loading / error состояния ──────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        Загружаем редактор…
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6">
        <p className="text-red-600 max-w-md text-center">{error}</p>
        <button
          type="button"
          onClick={() => router.push(`/app?album=${albumId}`)}
          className="text-sm px-4 py-2 rounded border border-gray-300 hover:bg-gray-50"
        >
          ← В кабинет
        </button>
      </div>
    )
  }

  if (!layout) {
    // Не должно случиться (loading=false + error=null = layout есть),
    // но TypeScript narrowing требует явной проверки.
    return null
  }

  // ─── Текущий spread + его template ──────────────────────────────────────
  const spreads = layout.spreads
  const currentSpread = spreads[currentIdx]
  const currentTemplate = templates.find(
    (t) => t.id === currentSpread?.template_id,
  )

  // Динамический расчёт canvas: вписываем spread в доступное пространство
  // с сохранением аспекта. Если по ширине шире чем доступно (двустраничный
  // на узком окне) — limiting factor становится ширина.
  const availableWidth = Math.max(400, viewport.width * 0.7 - 80)
  const availableHeight = Math.max(400, viewport.height * 0.7)
  const aspectRatio = currentTemplate
    ? currentTemplate.width_mm / currentTemplate.height_mm
    : 1
  const widthByHeight = availableHeight * aspectRatio
  const canvasContainerWidth = Math.min(widthByHeight, availableWidth)

  // Вычисляем причину read-only для UX подсказки
  const readOnlyReason = (() => {
    if (isMobile) return 'mobile'
    if (!canEdit) return editBlockReason
    return null
  })()

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* ═══ Header ═══ */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => router.push(`/app?album=${albumId}`)}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            ← К альбому
          </button>
          <h1 className="text-base font-semibold text-gray-900">
            {albumTitle || 'Альбом'}
          </h1>
          <span className="text-xs text-gray-400">— Layout редактор</span>
          {/* Л.4a — бейдж режима когда нельзя редактировать */}
          {isReadOnly && (
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                readOnlyReason === 'submitted'
                  ? 'bg-orange-100 text-orange-700'
                  : readOnlyReason === 'view_as'
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-gray-100 text-gray-700'
              }`}
              title={
                readOnlyReason === 'submitted'
                  ? 'Альбом передан в работу — редактирование заблокировано. Обратитесь в OkeyBook если нужны изменения.'
                  : readOnlyReason === 'view_as'
                    ? 'Просмотр от имени партнёра — изменения сохранять нельзя'
                    : readOnlyReason === 'mobile'
                      ? 'Редактирование доступно с компьютера, на мобильном — только просмотр'
                      : 'Только просмотр'
              }
            >
              👁 {
                readOnlyReason === 'submitted'
                  ? 'Передан в работу'
                  : readOnlyReason === 'view_as'
                    ? 'Просмотр партнёра'
                    : readOnlyReason === 'mobile'
                      ? 'Только просмотр (моб)'
                      : 'Только просмотр'
              }
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* Л.3 — кнопки Undo/Redo. Скрыты в read-only. */}
          {!isReadOnly && (
            <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleUndo}
              disabled={history.past.length === 0}
              className="px-2.5 py-1 text-sm rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title={
                typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')
                  ? 'Отменить (⌘Z)'
                  : 'Отменить (Ctrl+Z)'
              }
            >
              ↶ Отменить
              {history.past.length > 0 && (
                <span className="ml-1 text-xs text-gray-400">({history.past.length})</span>
              )}
            </button>
            <button
              type="button"
              onClick={handleRedo}
              disabled={history.future.length === 0}
              className="px-2.5 py-1 text-sm rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title={
                typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')
                  ? 'Повторить (⌘⇧Z)'
                  : 'Повторить (Ctrl+Shift+Z)'
              }
            >
              ↷ Повторить
              {history.future.length > 0 && (
                <span className="ml-1 text-xs text-gray-400">({history.future.length})</span>
              )}
            </button>
            </div>
          )}
          {!isReadOnly && <SaveIndicator status={saveStatus} />}
        </div>
      </header>

      {/* ═══ Main: левая колонка (canvas) + правая (палитра) ═══ */}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
      <div className="flex-1 flex overflow-hidden">
        {/* ─── Левая колонка: canvas + навигация ─── */}
        <main className="flex-1 flex flex-col items-center justify-center p-6 overflow-auto">
          {currentSpread && currentTemplate ? (
            <>
              <div className="bg-white rounded shadow-sm border border-gray-200">
                <AlbumSpreadCanvas
                  instance={currentSpread}
                  template={currentTemplate}
                  containerWidth={canvasContainerWidth}
                  mode={isReadOnly ? 'preview' : 'edit'}
                  draggingLabel={dragState?.mode === 'swap' ? dragState.label : null}
                  editingTextLabel={editingTextLabel}
                  onTextClick={isReadOnly ? undefined : handleTextClick}
                  onTextSubmit={isReadOnly ? undefined : handleTextSubmit}
                  onTextCancel={isReadOnly ? undefined : handleTextCancel}
                  onPhotoContextMenu={isReadOnly ? undefined : handlePhotoContextMenu}
                  onPhotoClick={isReadOnly ? undefined : handlePhotoClick}
                />
              </div>

              {/* Навигация */}
              <div className="mt-4 flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
                  disabled={currentIdx === 0}
                  className="px-3 py-1.5 text-sm rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  ◀ Назад
                </button>
                <span className="text-sm text-gray-600">
                  Разворот {currentIdx + 1} из {spreads.length}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setCurrentIdx((i) => Math.min(spreads.length - 1, i + 1))
                  }
                  disabled={currentIdx >= spreads.length - 1}
                  className="px-3 py-1.5 text-sm rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Вперёд ▶
                </button>
                {/* М.3 — заменить шаблон текущего разворота */}
                {!isReadOnly && currentTemplate && (
                  <button
                    type="button"
                    onClick={() => setReplaceTemplateForIdx(currentIdx)}
                    className="ml-auto px-3 py-1.5 text-sm rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-700"
                    title={`Текущий шаблон: ${currentTemplate.name}. Заменить на другой.`}
                  >
                    🔄 Заменить шаблон
                  </button>
                )}
              </div>
            </>
          ) : (
            <p className="text-gray-500">Шаблон не найден для текущего разворота</p>
          )}
        </main>

        {/* ─── Правая колонка: палитра ─── */}
        {/* Л.4a — палитра видна только в edit-режиме.
            В read-only / mobile отображается компактный баннер. */}
        {!isReadOnly ? (
          <PhotoPalette spreads={spreads} photos={photos} />
        ) : (
          <aside className="hidden md:flex w-80 bg-gray-50 border-l border-gray-200 flex-col items-center justify-center p-6 text-center">
            <div className="text-4xl mb-2">👁</div>
            <p className="text-sm font-medium text-gray-700 mb-1">Только просмотр</p>
            <p className="text-xs text-gray-500">
              {readOnlyReason === 'submitted'
                ? 'Альбом передан в работу — изменения заблокированы. Обратитесь в OkeyBook если нужны правки.'
                : readOnlyReason === 'view_as'
                  ? 'Вы смотрите альбом партнёра. Сохранение от его имени запрещено.'
                  : readOnlyReason === 'mobile'
                    ? 'Откройте на компьютере для редактирования макета.'
                    : 'Редактирование заблокировано'}
            </p>
          </aside>
        )}
      </div>

      {/* М.1 — strip миниатюр с drag-to-reorder.
          В read-only режиме доступна только клик-навигация.
          М.2 — кнопки удаления (✕ при hover) и добавления (➕ в конце). */}
      {layout && (
        <SpreadOrderStrip
          spreads={spreads}
          templates={templates}
          currentIdx={currentIdx}
          onSelect={setCurrentIdx}
          onReorder={handleReorderSpreads}
          onDelete={isReadOnly ? undefined : handleDeleteSpread}
          onAddRequest={isReadOnly ? undefined : handleAddRequest}
          readOnly={isReadOnly}
        />
      )}

      {/* М.2 — модал выбора шаблона при добавлении нового разворота */}
      {addAfterIdx !== null && (
        <TemplatePickerModal
          templates={templates}
          title="Добавить разворот"
          description={`Новый разворот будет вставлен после позиции ${addAfterIdx + 1}. Выберите шаблон.`}
          onSelect={handleAddSpread}
          onClose={() => setAddAfterIdx(null)}
        />
      )}

      {/* М.3 — модал замены шаблона существующего разворота */}
      {replaceTemplateForIdx !== null && (() => {
        const oldName = layout?.spreads[replaceTemplateForIdx]?.template_name ?? ''
        return (
          <TemplatePickerModal
            templates={templates}
            title={`Заменить шаблон разворота ${replaceTemplateForIdx + 1}`}
            description={
              oldName
                ? `Текущий шаблон: ${oldName}. Данные будут перенесены по совпадающим placeholder'ам — несовместимые потеряются (можно отменить Ctrl+Z).`
                : 'Выберите новый шаблон. Несовместимые данные могут потеряться.'
            }
            onSelect={handleReplaceTemplate}
            onClose={() => setReplaceTemplateForIdx(null)}
          />
        )
      })()}

        <DragOverlay dropAnimation={null}>
          {dragState?.mode === 'palette' ? (
            // Палитра → placeholder: фикс 120px overlay (миниатюра палитры
            // и так маленькая, фикс размер уместен).
            <div className="aspect-[3/4] w-[120px] bg-gray-100 rounded overflow-hidden border-2 border-blue-500 shadow-xl">
              <img
                src={dragState.photo.thumb_url}
                alt={dragState.photo.filename}
                draggable={false}
                className="w-full h-full object-cover pointer-events-none"
              />
            </div>
          ) : null}
          {/* swap-mode не использует DragOverlay — DropZone сам рендерит
              preview через CSS transform (см. AlbumSpreadCanvas.DropZone). */}
        </DragOverlay>
      </DndContext>

      {/* ─── Контекстное меню photo (Л.2) ─── */}
      {photoContextMenu && (
        <PhotoContextMenu
          label={photoContextMenu.label}
          url={photoContextMenu.url}
          clientX={photoContextMenu.clientX}
          clientY={photoContextMenu.clientY}
          photoInfo={(() => {
            // Находим photo в загруженном photos по url. Это нужно
            // чтобы PhotoContextMenu знал can-do для каждого action'a
            // (например «Заменить оригинал» disabled если нет original).
            if (!photoContextMenu.url) return null
            const p = photos.find((ph) => ph.url === photoContextMenu.url)
            if (!p) return null
            return {
              id: p.id,
              album_id: albumId,
              has_original: !!p.has_original,
            }
          })()}
          onClear={() => handleClearPhoto(photoContextMenu.label)}
          onReplaceFull={() =>
            handleReplaceFullPhoto(photoContextMenu.label, photoContextMenu.url)
          }
          onReplaceOriginal={() => {
            const p = photos.find((ph) => ph.url === photoContextMenu.url)
            if (p) void handleReplaceOriginal(p.id)
          }}
          onClose={() => setPhotoContextMenu(null)}
        />
      )}

      {/* ─── PhotoTransformPanel (КЭ.5) — кадрирование фото (scale + offset) ─── */}
      {photoTransformPanel && (() => {
        // Извлекаем текущие значения transform из layout state.
        // Если ключей __scale__/__offset__ нет → defaults (1, 0, 0).
        const spread = layout?.spreads[photoTransformPanel.spreadIndex]
        const data = spread?.data ?? {}
        const sc = parseScale(data[`__scale__${photoTransformPanel.label}`])
        const [ox, oy] = parseOffset(data[`__offset__${photoTransformPanel.label}`])
        return (
          <PhotoTransformPanel
            label={photoTransformPanel.label}
            scale={sc}
            offsetX={ox}
            offsetY={oy}
            clientX={photoTransformPanel.clientX}
            clientY={photoTransformPanel.clientY}
            onChange={handleTransformChange}
            onClose={handleTransformPanelClose}
          />
        )
      })()}

      {/* Toast «заменяем оригинал» — поверх редактора, blocking */}
      {replacingOriginal && (
        <div className="fixed bottom-4 right-4 bg-white border border-blue-200 rounded-lg shadow-lg px-4 py-3 z-50">
          <div className="flex items-center gap-3 text-sm">
            <span className="animate-spin">⏳</span>
            <span className="text-gray-700">
              Загружаем: <span className="font-medium">{replacingOriginal}</span>
            </span>
          </div>
        </div>
      )}

      {/* Л.5 — onboarding tooltip при первом открытии редактора.
          Модальный backdrop + центрированная карточка с подсказками.
          Закрывается по «Понятно» или Esc. */}
      {showOnboarding && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={dismissOnboarding}
          onKeyDown={(e) => {
            if (e.key === 'Escape') dismissOnboarding()
          }}
          role="dialog"
        >
          <div
            className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              👋 Добро пожаловать в редактор макета
            </h2>
            <ul className="space-y-3 text-sm text-gray-700">
              <li className="flex gap-3">
                <span className="text-blue-500 flex-shrink-0">📷</span>
                <span>
                  <b>Фото:</b> перетащите из правой палитры в макет. Чтобы поменять
                  местами — перетащите одно фото на другое. Правый клик —
                  очистить или заменить.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="text-blue-500 flex-shrink-0">✏️</span>
                <span>
                  <b>Текст:</b> кликните на ФИО, цитату или любой текст
                  в макете чтобы исправить. Enter — подтвердить, Esc — отменить.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="text-blue-500 flex-shrink-0">↶</span>
                <span>
                  <b>Отмена действий:</b> Ctrl+Z (⌘Z на Mac) или кнопка
                  «↶ Отменить» в шапке. До 50 шагов назад.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="text-blue-500 flex-shrink-0">◀▶</span>
                <span>
                  <b>Навигация:</b> стрелки ← / → на клавиатуре или кнопки внизу.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="text-green-500 flex-shrink-0">💾</span>
                <span>
                  <b>Автосохранение:</b> все изменения сохраняются автоматически.
                  Индикатор статуса в шапке справа.
                </span>
              </li>
            </ul>
            <button
              type="button"
              onClick={dismissOnboarding}
              className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
              autoFocus
            >
              Понятно, начинаем
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
