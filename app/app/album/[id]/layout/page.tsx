'use client'

import { useEffect, useState, useRef, useCallback, useMemo, Suspense } from 'react'
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
import { segmentToSpreads, findVisualSpreadForPage } from '@/lib/album-builder/segment-to-spreads'
import {
  resolveBackgrounds,
  type SpreadBackgroundInput,
  type BackgroundPoolRow,
} from '@/lib/backgrounds/resolve-background'
import { pageRoleToCategory } from '@/lib/backgrounds/page-role-to-category'
import SpreadBackgroundPicker from '../../../_components/SpreadBackgroundPicker'
import PhotoPalette from '../../../_components/PhotoPalette'
import SpreadOrderStrip from '../../../_components/SpreadOrderStrip'
import TemplatePickerModal from '../../../_components/TemplatePickerModal'
import SaveIndicator from '../../../_components/SaveIndicator'
import PhotoContextMenu from '../../../_components/PhotoContextMenu'
import PhotoTransformPanel from '../../../_components/PhotoTransformPanel'
import TextStylePanel from '../../../_components/TextStylePanel'
import AlbumTextStylesModal from '../../../_components/AlbumTextStylesModal'
import { parseScale, parseOffset, parseRotate } from '@/lib/photo-transform'
import {
  parseFontSizeMult,
  parseColor,
  parseAlbumTextStyleOverrides,
  parseHAlign,
  parseVAlign,
  parseFontFamily,
  type AlbumTextStyleOverrides,
} from '@/lib/text-style'
import { remapData } from '@/lib/template-replace'
import WarningsPill, {
  type EnrichedWarning,
} from './_components/WarningsPill'
import LayoutPreviewFullscreen from '../../../_components/LayoutPreviewFullscreen'
import {
  Eye,
  BookOpen,
  RefreshCw,
  Type,
  Image as ImageIcon,
  Sparkles,
  Camera,
  Pencil,
  Save,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'

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
  // РЭ.36.UI: предупреждения автосборки. Показываются в UI плашкой
  // WarningsPill под навигацией разворотов. Партнёр видит причины
  // пропущенных страниц / неподобранных мастеров / переполнений.
  warnings: EnrichedWarning[]
}

// ─── Тип фото для палитры (соответствует 2.4 endpoint response) ──────────
type AlbumPhoto = {
  id: string
  filename: string
  storage_path: string
  thumb_path: string | null
  // РЭ.54.e: все 8 категорий из /api/tenant?action=album_photos.
  type:
    | 'portrait'
    | 'group'
    | 'teacher'
    | 'common_spread'
    | 'common_full'
    | 'common_half'
    | 'common_quarter'
    | 'common_sixth'
    | 'common_collage'
    | null
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
        <div className="min-h-screen flex items-center justify-center text-muted-foreground">
          Загружаем редактор…
        </div>
      }
    >
      <LayoutEditorPageInner params={params} />
    </Suspense>
  )
}

/**
 * РЭ.27.4: визуальная заглушка «Форзац» для soft-альбомов.
 * Рисуется рядом с canvas на первом (слева) и последнем (справа)
 * развороте. Чисто визуальный элемент — в данных layout'а ничего
 * не появляется, существующая логика не задета.
 *
 * Размер подбирается под текущий canvas через пропс width + aspectRatio
 * (ширина/высота_мм одной страницы мастера).
 *
 * Стиль: белая страница с тонкой рамкой и водяным знаком «Форзац»
 * бледным курсивом по центру. Соответствует физической реальности —
 * это страница, просто специальная.
 */
function EndpaperPlaceholder({
  width,
  aspectRatio,
}: {
  width: number
  aspectRatio: number
}) {
  const height = width / aspectRatio
  return (
    <div
      className="bg-card rounded shadow-sm border border-border flex items-center justify-center select-none"
      style={{ width: `${width}px`, height: `${height}px` }}
      title="Физический форзац типографии — не часть макета"
    >
      <span
        className="italic text-muted-foreground"
        style={{ fontSize: `${Math.max(16, height * 0.06)}px`, letterSpacing: '0.05em' }}
      >
        Форзац
      </span>
    </div>
  )
}

/**
 * РЭ.35.Б: placeholder для пустой страницы разворота (когда у разворота
 * только одна сторона заполнена — «висящая» страница). Серый блок с
 * подписью о причине.
 */
function EmptyPagePlaceholder({
  width,
  aspectRatio,
  label,
  onClick,
}: {
  width: number
  aspectRatio: number
  label: string
  onClick?: () => void
}) {
  const height = width / aspectRatio
  const isClickable = typeof onClick === 'function'
  return (
    <div
      className={
        'rounded border border-dashed flex items-center justify-center select-none transition-colors ' +
        (isClickable
          ? 'border-brand-300 bg-brand-50 hover:bg-brand-50 hover:border-brand-400 cursor-pointer'
          : 'border-border bg-muted')
      }
      style={{ width: `${width}px`, height: `${height}px` }}
      title={isClickable ? `${label} — нажмите чтобы выбрать шаблон` : label}
      onClick={onClick}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={
        isClickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick?.()
              }
            }
          : undefined
      }
    >
      <span
        className={
          'text-center px-4 ' + (isClickable ? 'text-brand-500' : 'text-muted-foreground')
        }
        style={{ fontSize: `${Math.max(11, height * 0.025)}px` }}
      >
        {isClickable ? `${label}\n— выберите шаблон` : label}
      </span>
    </div>
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
  // Public URL фона набора (template_sets.default_background_url).
  // null если фон не загружен — канвас рисует без подложки (старое поведение).
  // Используется как fallback для категорийной ротации (если категория пуста).
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null)
  // Путь default-фона (НЕ public URL) — отдаём в resolveBackgrounds как fallback.
  const [defaultBgPath, setDefaultBgPath] = useState<string | null>(null)
  // Пул категорийных фонов набора (template_set_backgrounds) для ротации.
  const [categoryBackgrounds, setCategoryBackgrounds] = useState<BackgroundPoolRow[]>([])
  // Открыта ли модалка «Сменить фон» текущего разворота (Этап 6).
  const [bgPickerOpen, setBgPickerOpen] = useState(false)
  const [photos, setPhotos] = useState<AlbumPhoto[]>([])
  const [albumTitle, setAlbumTitle] = useState<string>('')
  // РЭ.27.4: тип переплёта альбома (вычисляется на сервере через
  // resolvePrintType). Используется для визуализации форзацев
  // на первом/последнем развороте soft-альбомов.
  const [effectivePrintType, setEffectivePrintType] = useState<'layflat' | 'soft'>('layflat')
  // РЭ.53: глобальные стили текста на уровне альбома.
  // Парсится из albums.text_style_overrides, применяется в canvas
  // как fallback когда нет точечного __fontSize__/__color__ override'а.
  // null = нет глобальных стилей (legacy альбомы или партнёр не настраивал).
  const [textStyleOverrides, setTextStyleOverrides] = useState<AlbumTextStyleOverrides>({})
  // РЭ.53.c: открыта ли модалка 'Стили текста альбома'.
  const [textStylesModalOpen, setTextStylesModalOpen] = useState(false)
  // Блок UX.4: открыт ли полноэкранный просмотр макета («Вид»).
  const [fullscreenOpen, setFullscreenOpen] = useState(false)
  const [currentIdx, setCurrentIdx] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viewport, setViewport] = useState({ width: 1440, height: 900 })
  // Блок UX.1 — сворачивание панелей редактора (правая палитра + нижняя
  // полоса миниатюр) чтобы высвободить место под вёрстку на ноутбуках.
  // Состояние запоминается в localStorage. Чисто визуально — на данные
  // макета не влияет.
  const [paletteCollapsed, setPaletteCollapsed] = useState(false)
  const [stripCollapsed, setStripCollapsed] = useState(false)
  useEffect(() => {
    try {
      setPaletteCollapsed(
        window.localStorage.getItem('yearbook_editor_palette_collapsed') === '1',
      )
      setStripCollapsed(
        window.localStorage.getItem('yearbook_editor_strip_collapsed') === '1',
      )
    } catch {
      // ignore (приватный режим и т.п.)
    }
  }, [])
  const togglePaletteCollapsed = useCallback(() => {
    setPaletteCollapsed((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(
          'yearbook_editor_palette_collapsed',
          next ? '1' : '0',
        )
      } catch {
        // ignore
      }
      return next
    })
  }, [])
  const toggleStripCollapsed = useCallback(() => {
    setStripCollapsed((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(
          'yearbook_editor_strip_collapsed',
          next ? '1' : '0',
        )
      } catch {
        // ignore
      }
      return next
    })
  }, [])
  // Блок UX.2 — фактический размер рабочей зоны холста (между плашками
  // сверху и навигацией снизу). Меряется ResizeObserver'ом через callback-ref
  // ниже. Из него считается canvasContainerWidth — холст всегда вписан в
  // доступное место по высоте и ширине, без вертикального скролла. Реагирует
  // на resize окна и на сворачивание панелей (Блок UX.1) автоматически.
  const [canvasArea, setCanvasArea] = useState({ width: 0, height: 0 })
  const canvasAreaObserver = useRef<ResizeObserver | null>(null)
  const setCanvasAreaRef = useCallback((el: HTMLDivElement | null) => {
    canvasAreaObserver.current?.disconnect()
    if (!el) {
      canvasAreaObserver.current = null
      return
    }
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect
      if (cr) setCanvasArea({ width: cr.width, height: cr.height })
    })
    ro.observe(el)
    canvasAreaObserver.current = ro
  }, [])
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
    | {
        mode: 'swap'
        photo: AlbumPhoto
        label: string
        // РЭ.35.Е.3: spread_index страницы откуда тащат — чтобы скрывать
        // Konva-копию только на ней, а не на обеих сторонах разворота.
        instanceKey: number
      }
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
  // РЭ.52.c: rightEdge / topEdge / leftEdge — границы placeholder'а
  // в client координатах. PhotoTransformPanel сам решает: справа от
  // rightEdge если место есть, иначе слева от leftEdge.
  const [photoTransformPanel, setPhotoTransformPanel] = useState<
    | null
    | {
        spreadIndex: number
        label: string
        rightEdge: number
        topEdge: number
        leftEdge: number
      }
  >(null)
  // Блок UX.3 — интерактивный кроп на холсте: какое фото сейчас кадрируется.
  const [cropEditor, setCropEditor] = useState<
    | null
    | {
        spreadIndex: number
        label: string
      }
  >(null)
  // Р.3 — panel стилизации текста (размер + цвет).
  // Открывается одновременно с TextInlineEditor (handleTextClick).
  // Закрывается вместе с фиксацией текста (handleTextSubmit/Cancel)
  // либо явно кнопкой «Готово»/Esc — тогда textarea остаётся открытым.
  // РЭ.52.c: rightEdge / topEdge / leftEdge — границы placeholder'а.
  const [textStylePanel, setTextStylePanel] = useState<
    | null
    | {
        spreadIndex: number
        label: string
        rightEdge: number
        topEdge: number
        leftEdge: number
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
  // Блок UX.3 — коалесинг истории для непрерывного жеста кропа (pan/zoom/
  // rotate): пока жест активен, промежуточные изменения НЕ пишут историю;
  // на конце жеста пишем ОДНУ запись (снимок до жеста). Иначе один drag дал
  // бы десятки шагов undo.
  const suspendHistoryRef = useRef(false)
  const gestureStartSpreadsRef = useRef<SpreadInstance[] | null>(null)

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
          // РЭ.36.UI: warnings из album_layouts.warnings (см.
          // app/api/layout/route.ts handleGetAlbumLayout). API уже
          // возвращает их в формате EnrichedWarning.
          warnings: (layoutJson.layout.warnings ?? []) as EnrichedWarning[],
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
        let printType: 'layflat' | 'soft' = 'layflat'
        let textStyleOv: AlbumTextStyleOverrides = {}
        if (albumRes.ok) {
          const albumJson = await albumRes.json()
          title = (Array.isArray(albumJson) ? albumJson[0]?.title : albumJson?.title) ?? ''
          // РЭ.27.4: effective_print_type вычислен на сервере.
          const ept = Array.isArray(albumJson)
            ? albumJson[0]?.effective_print_type
            : albumJson?.effective_print_type
          if (ept === 'soft' || ept === 'layflat') printType = ept
          // РЭ.53: глобальные стили текста.
          const rawTextStyle = Array.isArray(albumJson)
            ? albumJson[0]?.text_style_overrides
            : albumJson?.text_style_overrides
          textStyleOv = parseAlbumTextStyleOverrides(rawTextStyle)
        }

        if (cancelled) return
        setLayout(loadedLayout)
        setLastSavedSpreads(loadedLayout.spreads)
        setTemplates(templateJson.spread_templates ?? [])
        const bgPath = templateJson.template_set?.default_background_url ?? null
        setDefaultBgPath(bgPath)
        setBackgroundUrl(
          bgPath
            ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/template-backgrounds/${bgPath}`
            : null
        )
        setCategoryBackgrounds((templateJson.backgrounds ?? []) as BackgroundPoolRow[])
        setPhotos(photosJson.photos ?? [])
        setAlbumTitle(title)
        setEffectivePrintType(printType)
        setTextStyleOverrides(textStyleOv)
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
      if (suspendHistoryRef.current) {
        // Блок UX.3 — внутри жеста кропа: не пишем промежуточные шаги.
        // Запись истории сделает onCropGestureEnd (один шаг на жест).
      } else if (skipNextHistoryRef.current) {
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
    setTextStylePanel(null)       // и панель стилей текста (Р.3)
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
    setTextStylePanel(null) // Р.3
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
      // Блок UX.4 — когда открыт полноэкранный «Вид», стрелки листают ЕГО
      // (он сам обрабатывает их в capture-фазе), редактор не вмешивается.
      if (fullscreenOpen) return
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
  }, [layout?.spreads.length, fullscreenOpen])

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
      // Konva-копию фото и избежать двойного отображения. РЭ.35.Е.3:
      // вместе с label передаётся instanceKey — какой spread_index
      // страницы является источником.
      const photo = photos.find((p) => p.url === sourceData.url)
      if (!photo) return
      const sIK =
        typeof (sourceData as { instanceKey?: number }).instanceKey === 'number'
          ? (sourceData as { instanceKey?: number }).instanceKey!
          : currentIdx
      setDragState({
        mode: 'swap',
        photo,
        label: sourceData.label,
        instanceKey: sIK,
      })
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    setDragState(null)
    if (isReadOnly) return  // Л.4a — drop не применяется в read-only
    const { active, over } = event
    if (!over) return  // drop вне drop-зоны

    const sourceData = active.data.current as
      | {
          type?: string
          photo?: AlbumPhoto
          label?: string
          url?: string | null
          instanceKey?: number
        }
      | undefined
    // РЭ.35.Е.3 — id формата 'label@spreadIndex'. Парсим обратно
    // чтобы знать на какую страницу разворота дропнули. Если '@' нет —
    // legacy id (только label), instanceKey = currentIdx как раньше.
    const rawOverId = String(over.id)
    const atIdx = rawOverId.lastIndexOf('@')
    const targetLabel = atIdx === -1 ? rawOverId : rawOverId.slice(0, atIdx)
    const targetInstanceKey =
      atIdx === -1 ? currentIdx : Number(rawOverId.slice(atIdx + 1))

    if (sourceData?.type === 'palette') {
      // Палитра → placeholder: вставить URL фото на ту страницу
      // куда был дроп (учитываем targetInstanceKey, не только currentIdx).
      const photo = sourceData.photo
      if (!photo) return
      setLayout((prev) => {
        if (!prev) return prev
        const newSpreads = prev.spreads.map((s, idx) =>
          idx === targetInstanceKey
            ? { ...s, data: { ...s.data, [targetLabel]: photo.url } }
            : s,
        )
        return { ...prev, spreads: newSpreads }
      })
      // Активируем страницу куда добавили
      if (targetInstanceKey !== currentIdx) setCurrentIdx(targetInstanceKey)
      return
    }

    if (sourceData?.type === 'placeholder') {
      // Swap между placeholder'ами.
      const sourceLabel = sourceData.label
      const sourceInstanceKey = sourceData.instanceKey ?? currentIdx
      if (!sourceLabel) return
      // Тот же placeholder на той же странице — drop отменён
      if (sourceLabel === targetLabel && sourceInstanceKey === targetInstanceKey) {
        return
      }
      setLayout((prev) => {
        if (!prev) return prev
        const newSpreads = prev.spreads.map((s, idx) => {
          // Swap внутри одной страницы
          if (sourceInstanceKey === targetInstanceKey && idx === sourceInstanceKey) {
            const valueA = s.data[sourceLabel] ?? null
            const valueB = s.data[targetLabel] ?? null
            return {
              ...s,
              data: { ...s.data, [sourceLabel]: valueB, [targetLabel]: valueA },
            }
          }
          // Swap МЕЖДУ страницами разворота (баг 4.A от Сергея 23.05)
          if (sourceInstanceKey !== targetInstanceKey) {
            if (idx === sourceInstanceKey) {
              // Со страницы-источника забираем targetValue (пришёл от target)
              const targetValueRaw = prev.spreads[targetInstanceKey]?.data[targetLabel] ?? null
              return {
                ...s,
                data: { ...s.data, [sourceLabel]: targetValueRaw },
              }
            }
            if (idx === targetInstanceKey) {
              const sourceValueRaw = prev.spreads[sourceInstanceKey]?.data[sourceLabel] ?? null
              return {
                ...s,
                data: { ...s.data, [targetLabel]: sourceValueRaw },
              }
            }
          }
          return s
        })
        return { ...prev, spreads: newSpreads }
      })
    }
  }

  // ─── Фаза Л.1: handlers для редактирования текста ───────────────────────

  function handleTextClick(
    label: string,
    _currentValue: string | null,
    rightEdge: number,
    topEdge: number,
    leftEdge: number,
    instanceKey: number,
  ) {
    // РЭ.54.d: если клик пришёл с НЕвыделенной страницы разворота —
    // сначала переключаем currentIdx на эту страницу, потом открываем
    // редактор. Без этого партнёру приходилось делать «лишний клик»
    // по пустому месту правой страницы чтобы её активировать.
    if (instanceKey !== currentIdx) {
      setCurrentIdx(instanceKey)
    }
    // Если уже что-то редактируется — сначала закрываем (с сохранением
    // через onBlur эффект textarea), потом открываем новое.
    // setEditingTextLabel'у одного значения достаточно: textarea со
    // старым label получает unmount → onBlur → handleTextSubmit → cleanup.
    setEditingTextLabel(label)
    // Р.3 — параллельно открываем TextStylePanel для размера и цвета.
    // РЭ.52.c: координаты — границы placeholder'а (а не точка клика).
    // Panel сам решит «справа или слева» так чтобы не перекрыть текст.
    setTextStylePanel({
      spreadIndex: instanceKey,
      label,
      rightEdge,
      topEdge,
      leftEdge,
    })
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
    setTextStylePanel(null) // Р.3 — закрываем стиль-панель вместе с текстом
  }

  function handleTextCancel() {
    setEditingTextLabel(null)
    setTextStylePanel(null) // Р.3 — закрываем стиль-панель
  }

  // Р.3 — изменение стиля текста (размер + цвет) из TextStylePanel.
  // Аналогично handleTransformChange: optimistic update layout state →
  // saveStatus='pending' → существующий debounce save_album_layout
  // подхватит изменения. При default значениях (mult=1, color=null)
  // соответствующие служебные ключи __fontSize__/__color__ удаляются.
  function handleTextStyleChange(updates: {
    fontSize?: string | null
    color?: string | null
    halign?: string | null
    valign?: string | null
    font?: string | null
  }) {
    if (!textStylePanel) return
    const { label, spreadIndex } = textStylePanel
    setLayout((prev) => {
      if (!prev) return prev
      const newSpreads = prev.spreads.map((s, idx) => {
        if (idx !== spreadIndex) return s
        const newData = { ...s.data }
        const fontSizeKey = `__fontSize__${label}`
        const colorKey = `__color__${label}`
        const hAlignKey = `__halign__${label}`
        const vAlignKey = `__valign__${label}`
        const fontKey = `__font__${label}`
        if (updates.fontSize !== undefined) {
          if (updates.fontSize === null) delete newData[fontSizeKey]
          else newData[fontSizeKey] = updates.fontSize
        }
        if (updates.color !== undefined) {
          if (updates.color === null) delete newData[colorKey]
          else newData[colorKey] = updates.color
        }
        // РЭ.54: align overrides.
        if (updates.halign !== undefined) {
          if (updates.halign === null) delete newData[hAlignKey]
          else newData[hAlignKey] = updates.halign
        }
        if (updates.valign !== undefined) {
          if (updates.valign === null) delete newData[vAlignKey]
          else newData[vAlignKey] = updates.valign
        }
        // РЭ.55: font_family override.
        if (updates.font !== undefined) {
          if (updates.font === null) delete newData[fontKey]
          else newData[fontKey] = updates.font
        }
        return { ...s, data: newData }
      })
      return { ...prev, spreads: newSpreads }
    })
  }

  function handleTextStylePanelClose() {
    setTextStylePanel(null)
  }

  // РЭ.53.c — handler сохранения глобальных стилей текста.
  // Модалка AlbumTextStylesModal делает onPreview оптимистически
  // (parent state обновляется → canvas live-rendrer'ит). Затем onSave →
  // POST update_album. При успехе модалка закрывается, при ошибке
  // откатываем preview к initialOverrides и показываем сообщение.
  async function handleSaveTextStyles(next: AlbumTextStyleOverrides) {
    const va = viewAsTenantId ? `&view_as=${viewAsTenantId}` : ''
    // Если next пустой объект — отправляем null (это семантика
    // 'нет override'ов', хранится как NULL в БД).
    const apiValue =
      Object.keys(next).length === 0 ? null : next
    const res = await api(`/api/tenant?${va.slice(1) || ''}`, {
      method: 'POST',
      body: JSON.stringify({
        action: 'update_album',
        album_id: albumId,
        text_style_overrides: apiValue,
      }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error ?? `update_album failed: ${res.status}`)
    }
  }

  // При смене разворота — закрываем текущий редактор текста (если открыт).
  // Auto-save от useEffect выше всё равно сохранит текст если он был
  // изменён до переключения (через onBlur → handleTextSubmit).
  useEffect(() => {
    setEditingTextLabel(null)
    setPhotoContextMenu(null)
    setPhotoTransformPanel(null)  // КЭ.5 — закрываем кадрирование при смене разворота
    setCropEditor(null)           // Блок UX.3 — закрываем кроп на холсте
    setTextStylePanel(null)       // Р.3 — закрываем стилизацию текста
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
  // РЭ.52.c: координаты — границы placeholder'а (а не точка клика).
  function handlePhotoClick(
    label: string,
    _url: string,
    _rightEdge: number,
    _topEdge: number,
    _leftEdge: number,
    instanceKey: number,
  ) {
    // РЭ.54.d: переключаем активную страницу разворота если клик пришёл
    // с другой стороны (см. handleTextClick для контекста).
    if (instanceKey !== currentIdx) {
      setCurrentIdx(instanceKey)
    }
    // Блок UX.3 — одинарный клик по фото открывает интерактивный кроп прямо
    // на холсте (а не панель-ползунки). Панель доступна как «точная
    // настройка» из тулбара кропа. Закрываем панель, если была открыта.
    setPhotoTransformPanel(null)
    setCropEditor({ spreadIndex: instanceKey, label })
  }

  // Блок UX.3 — колбэки интерактивного кропа (для AlbumSpreadCanvas.cropHandlers).
  const cropHandlers = useMemo(
    () => ({
      onChange: handleCropChange,
      onClose: () => setCropEditor(null),
      // «Точно» — открыть старую панель-ползунки как запасной точный способ.
      onOpenPanel: (rightEdge: number, topEdge: number, leftEdge: number) => {
        if (!cropEditor) return
        setPhotoTransformPanel({
          spreadIndex: cropEditor.spreadIndex,
          label: cropEditor.label,
          rightEdge,
          topEdge,
          leftEdge,
        })
      },
      // Обрамляют один непрерывный жест → один шаг undo (см. suspendHistoryRef).
      onGestureStart: () => {
        gestureStartSpreadsRef.current = layout?.spreads ?? null
        suspendHistoryRef.current = true
      },
      onGestureEnd: () => {
        suspendHistoryRef.current = false
        const snapshot = gestureStartSpreadsRef.current
        gestureStartSpreadsRef.current = null
        // Пишем ОДНУ запись истории — снимок ДО жеста, если что-то изменилось.
        const cur = layout?.spreads ?? null
        if (
          snapshot &&
          cur &&
          snapshot !== cur &&
          JSON.stringify(snapshot) !== JSON.stringify(cur)
        ) {
          setHistory((h) => ({
            past: [...h.past.slice(-49), snapshot],
            future: [],
          }))
        }
      },
    }),
    // handleCropChange/layout читаются через замыкание; зависим от cropEditor
    // (для onOpenPanel) и layout (для snapshot). eslint-disable: функции
    // стабильны в рамках рендера.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cropEditor, layout],
  )

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
  // Блок UX.3 — параметризованное ядро (label/spreadIndex явно), чтобы его
  // могли звать и панель-ползунки (через photoTransformPanel), и
  // интерактивный кроп на холсте (через cropEditor).
  function applyTransformUpdate(
    spreadIndex: number,
    label: string,
    updates: {
      scale?: string | null
      offset?: string | null
      rotate?: string | null
    },
  ) {
    setLayout((prev) => {
      if (!prev) return prev
      const newSpreads = prev.spreads.map((s, idx) => {
        if (idx !== spreadIndex) return s
        const newData = { ...s.data }
        const scaleKey = `__scale__${label}`
        const offsetKey = `__offset__${label}`
        const rotateKey = `__rotate__${label}`
        if (updates.scale !== undefined) {
          if (updates.scale === null) delete newData[scaleKey]
          else newData[scaleKey] = updates.scale
        }
        if (updates.offset !== undefined) {
          if (updates.offset === null) delete newData[offsetKey]
          else newData[offsetKey] = updates.offset
        }
        // Р.2 — поворот фото (горизонт). null = удалить ключ (default 0°).
        if (updates.rotate !== undefined) {
          if (updates.rotate === null) delete newData[rotateKey]
          else newData[rotateKey] = updates.rotate
        }
        return { ...s, data: newData }
      })
      return { ...prev, spreads: newSpreads }
    })
  }

  // КЭ.5 — изменение transform из PhotoTransformPanel (ползунки).
  function handleTransformChange(updates: {
    scale?: string | null
    offset?: string | null
    rotate?: string | null
  }) {
    if (!photoTransformPanel) return
    applyTransformUpdate(photoTransformPanel.spreadIndex, photoTransformPanel.label, updates)
  }

  // Блок UX.3 — изменение transform из интерактивного кропа на холсте.
  function handleCropChange(updates: {
    scale?: string | null
    offset?: string | null
    rotate?: string | null
  }) {
    if (!cropEditor) return
    applyTransformUpdate(cropEditor.spreadIndex, cropEditor.label, updates)
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

  // М.2 + РЭ.35.Д: удалить РАЗВОРОТ (1-2 страницы по indices).
  // Защиты:
  //   - confirm для подтверждения
  //   - не позволяем удалить последний разворот (нужно хотя бы одна страница)
  //   - если удалили страницу содержащую активный currentIdx — переключаем
  //     на ближайшую существующую
  //   - реномерация spread_index у оставшихся
  function handleDeleteSpread(pageIndices: number[]) {
    if (!layout || layout.spreads.length <= pageIndices.length) return
    if (pageIndices.length === 0) return
    const sortedIndices = [...pageIndices].sort((a, b) => a - b)
    const firstIdx = sortedIndices[0]
    const template = templates.find(
      (t) => t.id === layout.spreads[firstIdx]?.template_id,
    )
    const label = template?.name ?? `Разворот`
    if (
      !confirm(
        `Удалить разворот «${label}»?\n\nЕго содержимое (фото и текст) будет потеряно — это действие можно отменить через Ctrl+Z.`,
      )
    ) {
      return
    }
    const toDelete = new Set(pageIndices)
    const newSpreads = layout.spreads
      .filter((_, i) => !toDelete.has(i))
      .map((s, i) => ({ ...s, spread_index: i }))
    setLayout({ ...layout, spreads: newSpreads })
    // Корректируем currentIdx: сколько удалённых страниц стояли до него
    const removedBefore = sortedIndices.filter((i) => i < currentIdx).length
    const removedActive = toDelete.has(currentIdx)
    if (removedActive) {
      // активный удалён — переключаемся на следующую существующую страницу
      // (или предыдущую если активный был последним)
      const newIdx = Math.min(currentIdx - removedBefore, newSpreads.length - 1)
      setCurrentIdx(Math.max(0, newIdx))
    } else if (removedBefore > 0) {
      setCurrentIdx(currentIdx - removedBefore)
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

    // Р.1 — умное автозаполнение. Каскад стратегий:
    //   EXACT       — точное совпадение label+type
    //   NORMALIZED  — нестрогое (lowercase + non-alphanumeric):
    //                  studentphoto1 ≈ student_photo_1 ≈ Student Photo 1
    //   BY_TYPE     — fallback по типу placeholder в порядке появления
    // Служебные ключи __scale__/__offset__/__rotate__/__fontSize__/__color__
    // мигрируют вместе с фото/текстом. __hidden__/__pos__ привязаны к
    // рамкам старого мастера и отбрасываются.
    // Для умного remap'а нужны placeholders старого мастера. Если
    // старый шаблон по template_id не найден в локальном массиве
    // templates — fallback на пустой список (тогда работает только
    // EXACT через oldData keys, поведение деградирует до старого).
    const oldTemplate = templates.find((t) => t.id === oldSpread.template_id)
    const oldPlaceholders = oldTemplate?.placeholders ?? []
    const { newData, stats } = remapData(
      oldSpread.data,
      oldPlaceholders,
      newTemplate.placeholders,
    )

    if (stats.lost > 0) {
      const word =
        stats.lost === 1
          ? 'значение не помещается'
          : stats.lost < 5
            ? 'значения не помещаются'
            : 'значений не помещаются'
      const labelsHint =
        stats.lostLabels.length > 0
          ? ` (${stats.lostLabels.slice(0, 5).join(', ')}${stats.lostLabels.length > 5 ? '…' : ''})`
          : ''
      const ok = confirm(
        `При смене мастера ${stats.lost} ${word} в новый шаблон${labelsHint}.\n\n` +
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
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
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
          className="text-sm px-4 py-2 rounded border border-border hover:bg-muted"
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

  // ─── РЭ.35.Б/В — Визуальные развороты ────────────────────────────────────
  //
  // layout.spreads хранит МАССИВ СТРАНИЦ (legacy формат, 1 элемент = 1 стр).
  // Партнёр в UI хочет видеть РАЗВОРОТЫ — пары страниц как раскрытая книга.
  // segmentToSpreads сегментирует страницы в VisualSpread[] с учётом
  // is_spread мастеров (J-Spread занимает обе стороны разворота сразу).
  //
  // currentIdx (page-based) → currentPairIdx (визуальный разворот).
  // Это computed-связь, но НЕ через useMemo — useMemo здесь вызывался
  // бы условно (после early returns выше), что нарушает Rules of Hooks.
  // Расчёт дешёвый (Map + один проход), считаем при каждом ререндере.
  const templatesById = new Map<string, SpreadTemplate>()
  for (const t of templates) templatesById.set(t.id, t)
  // РЭ.35.Е.5: для soft-альбомов первая страница массива становится
  // ПРАВОЙ первого визуального разворота (левая = форзац типографии),
  // последняя — ЛЕВОЙ последнего разворота (правая = форзац). Это
  // соответствует физической реальности мягкого переплёта.
  const isSoftAlbum = effectivePrintType === 'soft'
  const visualSpreads = segmentToSpreads(spreads, templatesById, {
    softShift: isSoftAlbum,
  })
  const currentPairIdx = findVisualSpreadForPage(visualSpreads, currentIdx)
  const currentPair = visualSpreads[currentPairIdx] ?? null
  const leftPage =
    currentPair?.leftIdx !== undefined ? spreads[currentPair.leftIdx] : null
  const rightPage =
    currentPair?.rightIdx !== undefined ? spreads[currentPair.rightIdx] : null
  const leftTemplate = leftPage ? templatesById.get(leftPage.template_id) : null
  const rightTemplate = rightPage
    ? templatesById.get(rightPage.template_id)
    : null

  // ─── Категорийные фоны: фон текущего разворота ──────────────────────────
  // Ротация считается по ВСЕМ визуальным разворотам (зависит от позиции внутри
  // раздела), затем берём фон текущего. Категория — по ведущей странице
  // (левая, иначе правая). Приоритет: album override (__bg__) → master override
  // → ротация категории → default_background_url → без фона. Расчёт дешёвый,
  // считаем при каждом ререндере (как visualSpreads выше — нельзя useMemo после
  // ранних return'ов).
  const bgInputs: SpreadBackgroundInput[] = visualSpreads.map((vs) => {
    const leadIdx = vs.leftIdx ?? vs.rightIdx
    const page = leadIdx !== undefined ? spreads[leadIdx] : undefined
    const master = page ? templatesById.get(page.template_id) : undefined
    return {
      leadingPageRole: master?.page_role ?? null,
      sectionType: page?.section_type ?? null,
      masterOverrideUrl: master?.background_override_url ?? null,
      albumOverrideUrl: page?.data?.['__bg__'] ?? null,
    }
  })
  const bgPaths = resolveBackgrounds(bgInputs, categoryBackgrounds, defaultBgPath)
  const toBgPublicUrl = (p: string | null): string | null => {
    if (!p) return null
    if (p.startsWith('http')) return p
    return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/template-backgrounds/${p}`
  }
  // Фон текущего разворота. Если индекс не найден — старый общий backgroundUrl.
  const currentSpreadBgUrl =
    currentPairIdx >= 0 ? toBgPublicUrl(bgPaths[currentPairIdx]) : backgroundUrl

  // Карта «индекс страницы → public URL фона его разворота» — для ленты
  // миниатюр (SpreadOrderStrip), чтобы ротация была видна на всех разворотах.
  const bgUrlByPageIdx = new Map<number, string | null>()
  visualSpreads.forEach((vs, i) => {
    const url = toBgPublicUrl(bgPaths[i])
    if (vs.leftIdx !== undefined) bgUrlByPageIdx.set(vs.leftIdx, url)
    if (vs.rightIdx !== undefined) bgUrlByPageIdx.set(vs.rightIdx, url)
  })

  // ─── Этап 6: ручной фон текущего разворота («Сменить фон») ──────────────
  // Ведущая страница разворота (левая, иначе правая) — там хранится __bg__.
  const bgLeadIdx = currentPair
    ? currentPair.leftIdx ?? currentPair.rightIdx
    : undefined
  const bgLeadingPage =
    bgLeadIdx !== undefined ? spreads[bgLeadIdx] : null
  const bgLeadingMaster = bgLeadingPage
    ? templatesById.get(bgLeadingPage.template_id)
    : null
  const currentSpreadCategory = pageRoleToCategory(
    bgLeadingMaster?.page_role ?? null,
  )
  const currentBgOverride = bgLeadingPage?.data?.['__bg__'] ?? null

  function applyBgOverride(path: string | null) {
    if (bgLeadIdx === undefined) return
    setLayout((prev) => {
      if (!prev) return prev
      const newSpreads = prev.spreads.map((s, idx) => {
        if (idx !== bgLeadIdx) return s
        const newData = { ...s.data }
        if (path === null) {
          if (newData['__bg__'] === undefined) return s
          delete newData['__bg__']
        } else {
          if (newData['__bg__'] === path) return s
          newData['__bg__'] = path
        }
        return { ...s, data: newData }
      })
      return { ...prev, spreads: newSpreads }
    })
    setBgPickerOpen(false)
  }

  // Динамический расчёт canvas: вписываем РАЗВОРОТ в доступное пространство
  // с сохранением аспекта. Для is_spread мастера ширина = ширина одной
  // страницы (потому что мастер уже двухстраничный, у него width_mm
  // = ширина всего разворота). Для обычного разворота = ширина двух
  // страниц рядом (basePage * 2).
  // Блок UX.2 — размер холста.
  // Приоритет: фактически измеренная рабочая зона (canvasArea) даёт точное
  // вписывание без скролла и сама реагирует на сворачивание панелей (Блок
  // UX.1) и resize. Фоллбэк (до первого замера / SSR) — эвристика от viewport
  // с поправкой на свёрнутые панели, чтобы не было «прыжка» при загрузке.
  // -8px — небольшой зазор под тени/обводку активной страницы.
  const widthFactor = paletteCollapsed ? 0.96 : 0.7
  const heightFactor = stripCollapsed ? 0.82 : 0.7
  // Блок UX.1 (плавность) — развёрнутая ширина правой палитры (как было в
  // w-[30%] min 300 max 440). Анимируем ширину внешней обёртки 0↔это,
  // внутреннюю палитру держим фиксированной ширины (не «плющим» при
  // сворачивании). Канвас сам растёт через ResizeObserver (Блок UX.2).
  const paletteExpandedPx = Math.round(
    Math.min(440, Math.max(300, viewport.width * 0.3)),
  )
  const fallbackWidth = Math.max(400, viewport.width * widthFactor - 80)
  const fallbackHeight = Math.max(400, viewport.height * heightFactor)
  const availableWidth =
    canvasArea.width > 0 ? Math.max(280, canvasArea.width - 8) : fallbackWidth
  const availableHeight =
    canvasArea.height > 0 ? Math.max(280, canvasArea.height - 8) : fallbackHeight
  const basePageTemplate = leftTemplate ?? rightTemplate ?? currentTemplate ?? null
  const isPairSpread = currentPair?.isSpread === true
  const aspectRatio = basePageTemplate
    ? (isPairSpread
        ? basePageTemplate.width_mm / basePageTemplate.height_mm
        : (basePageTemplate.width_mm * 2) / basePageTemplate.height_mm)
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
    <div className="h-screen flex flex-col bg-muted">
      {/* ═══ Header ═══ */}
      <header className="bg-card border-b border-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => router.push(`/app?album=${albumId}`)}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← К альбому
          </button>
          <h1 className="text-base font-semibold text-foreground">
            {albumTitle || 'Альбом'}
          </h1>
          <span className="text-xs text-muted-foreground">— Layout редактор</span>
          {/* Л.4a — бейдж режима когда нельзя редактировать */}
          {isReadOnly && (
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                readOnlyReason === 'submitted'
                  ? 'bg-orange-100 text-orange-700'
                  : readOnlyReason === 'view_as'
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-muted text-foreground'
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
              <Eye size={14} className="inline" /> {
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
          {/* Блок UX.4 — полноэкранный просмотр макета. Доступен всегда
              (и в read-only) — это и есть «оценить результат». */}
          <button
            type="button"
            onClick={() => setFullscreenOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-border bg-card hover:bg-muted text-foreground transition-colors"
            title="Полноэкранный просмотр готового макета"
          >
            <Eye size={16} /> Вид
          </button>
          {/* Л.3 — кнопки Undo/Redo. Скрыты в read-only. */}
          {!isReadOnly && (
            <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleUndo}
              disabled={history.past.length === 0}
              className="px-2.5 py-1 text-sm rounded border border-border bg-card hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title={
                typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')
                  ? 'Отменить (⌘Z)'
                  : 'Отменить (Ctrl+Z)'
              }
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
              title={
                typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')
                  ? 'Повторить (⌘⇧Z)'
                  : 'Повторить (Ctrl+Shift+Z)'
              }
            >
              ↷ Повторить
              {history.future.length > 0 && (
                <span className="ml-1 text-xs text-muted-foreground">({history.future.length})</span>
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
        <main className="flex-1 flex flex-col p-6 overflow-hidden">
          {/* РЭ.35.Е.4 + РЭ.36.UI: компактные pill-индикаторы под навигацией
              разворотов — «Мягкий переплёт» (для soft-альбомов) и
              «N предупреждений» (если engine при сборке оставил warnings).
              Обе плашки в одном ряду, рендерятся только при наличии
              соответствующего условия — если ничего нет, ряд не виден.
              Раньше большая amber-плашка занимала место под навигацией и
              съедала рабочую зону canvas (Сергей 23.05). */}
          {(effectivePrintType === 'soft' ||
            (layout && layout.warnings.length > 0)) && (
            <div className="mb-2 flex justify-center items-start gap-2">
              {effectivePrintType === 'soft' && (
                <button
                  type="button"
                  className="group inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-900 hover:bg-amber-100 cursor-help relative"
                  tabIndex={0}
                >
                  <span><BookOpen size={14} /></span>
                  <span className="font-medium">Мягкий переплёт</span>
                  <span className="text-amber-700 text-[10px]">подробнее</span>
                  <span
                    className="invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus:visible group-focus:opacity-100 transition-opacity absolute left-1/2 top-full mt-1 -translate-x-1/2 z-20 w-80 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow-lg"
                    role="tooltip"
                  >
                    На первом и последнем разворотах одна страница — это физический
                    форзац типографии (показан как «Форзац» с водяным знаком).
                    Содержательная вёрстка начинается с правой страницы первого
                    разворота и заканчивается на левой странице последнего.
                  </span>
                </button>
              )}
              {layout && layout.warnings.length > 0 && (
                <WarningsPill warnings={layout.warnings} />
              )}
            </div>
          )}

          {/* Блок UX.2 — измеряемая рабочая зона. Холст вписывается в
              место, оставшееся после плашек (сверху) и навигации (снизу):
              flex-1 + min-h-0, без вертикального скролла. Размер зоны меряет
              ResizeObserver (setCanvasAreaRef) → из него canvasContainerWidth. */}
          <div
            ref={setCanvasAreaRef}
            className="flex-1 min-h-0 w-full flex items-center justify-center overflow-hidden"
          >
          {currentPair && (leftTemplate || rightTemplate) ? (
            <>
              {/* РЭ.35.Б: рендер разворота.
                  - isSpread → один canvas во всю ширину (J-Spread)
                  - иначе → две canvas рядом (left + right), каждая половина ширины
                  - если одна сторона пуста → placeholder (висящий разворот) */}
              {(() => {
                const isFirstPair = currentPairIdx === 0
                const isLastPair = currentPairIdx === visualSpreads.length - 1
                // РЭ.35.Е.5: для soft форзацы рисуем НЕ как дополнительные
                // блоки рядом, а ВМЕСТО пустых страниц первого/последнего
                // разворота (через softShift segmentToSpreads уже сделал
                // leftIdx=undefined в первом и rightIdx=undefined в
                // последнем для soft). Это убирает «3-страничный» вид
                // первого разворота и делает его симметричным с финальным.
                const showLeftEndpaper = isSoftAlbum && isFirstPair
                const showRightEndpaper = isSoftAlbum && isLastPair
                const halfWidth = currentPair.isSpread
                  ? canvasContainerWidth
                  : canvasContainerWidth / 2
                return (
                  <div className="flex items-stretch gap-1">
                    {currentPair.isSpread && leftPage && leftTemplate ? (
                      // Spread-мастер: один canvas, полная ширина
                      <div
                        className={`bg-card rounded shadow-sm border ${
                          currentIdx === currentPair.leftIdx
                            ? 'border-brand-400 ring-2 ring-brand-200'
                            : 'border-border'
                        }`}
                        onClick={() => {
                          if (currentPair.leftIdx !== undefined)
                            setCurrentIdx(currentPair.leftIdx)
                        }}
                      >
                        <AlbumSpreadCanvas
                          instance={leftPage}
                          template={leftTemplate}
                          containerWidth={halfWidth}
                          mode={isReadOnly ? 'preview' : 'edit'}
                          draggingLabel={
                            dragState?.mode === 'swap' &&
                            dragState.instanceKey === leftPage.spread_index
                              ? dragState.label
                              : null
                          }
                          editingTextLabel={editingTextLabel}
                          onTextClick={isReadOnly ? undefined : handleTextClick}
                          onTextSubmit={isReadOnly ? undefined : handleTextSubmit}
                          onTextCancel={isReadOnly ? undefined : handleTextCancel}
                          onPhotoContextMenu={isReadOnly ? undefined : handlePhotoContextMenu}
                          onPhotoClick={isReadOnly ? undefined : handlePhotoClick}
                          textStyleOverrides={textStyleOverrides}
                          backgroundUrl={currentSpreadBgUrl}
                          pageSide="spread"
                          croppingLabel={
                            leftPage && cropEditor?.spreadIndex === leftPage.spread_index
                              ? cropEditor.label
                              : null
                          }
                          cropHandlers={cropHandlers}
                        />
                      </div>
                    ) : (
                      // Обычный разворот: две страницы рядом
                      <>
                        {leftPage && leftTemplate ? (
                          <div
                            className={`bg-card rounded shadow-sm border cursor-pointer ${
                              currentIdx === currentPair.leftIdx
                                ? 'border-brand-400 ring-2 ring-brand-200'
                                : 'border-border'
                            }`}
                            onClick={() => {
                              if (currentPair.leftIdx !== undefined)
                                setCurrentIdx(currentPair.leftIdx)
                            }}
                          >
                            <AlbumSpreadCanvas
                              instance={leftPage}
                              template={leftTemplate}
                              containerWidth={halfWidth}
                              mode={isReadOnly ? 'preview' : 'edit'}
                              draggingLabel={
                                dragState?.mode === 'swap' &&
                                dragState.instanceKey === leftPage.spread_index
                                  ? dragState.label
                                  : null
                              }
                              editingTextLabel={
                                currentIdx === currentPair.leftIdx ? editingTextLabel : null
                              }
                              onTextClick={isReadOnly ? undefined : handleTextClick}
                              onTextSubmit={isReadOnly ? undefined : handleTextSubmit}
                              onTextCancel={isReadOnly ? undefined : handleTextCancel}
                              onPhotoContextMenu={isReadOnly ? undefined : handlePhotoContextMenu}
                              onPhotoClick={isReadOnly ? undefined : handlePhotoClick}
                          textStyleOverrides={textStyleOverrides}
                          backgroundUrl={currentSpreadBgUrl}
                          pageSide="left"
                          croppingLabel={
                            leftPage && cropEditor?.spreadIndex === leftPage.spread_index
                              ? cropEditor.label
                              : null
                          }
                          cropHandlers={cropHandlers}
                            />
                          </div>
                        ) : showLeftEndpaper ? (
                          <EndpaperPlaceholder
                            width={halfWidth}
                            aspectRatio={
                              rightTemplate
                                ? rightTemplate.width_mm / rightTemplate.height_mm
                                : 0.7
                            }
                          />
                        ) : (
                          <EmptyPagePlaceholder
                            width={halfWidth}
                            aspectRatio={
                              rightTemplate
                                ? rightTemplate.width_mm / rightTemplate.height_mm
                                : 0.7
                            }
                            label="Левая страница пуста"
                            onClick={
                              isReadOnly
                                ? undefined
                                : () => {
                                    // РЭ.38.2 (25.05.2026): пустая левая
                                    // страница разворота — добавляем новую
                                    // запись ПЕРЕД существующей правой.
                                    // handleAddSpread вставляет на позицию
                                    // afterIdx+1; чтобы новая стала левой
                                    // текущего разворота, передаём afterIdx
                                    // = rightIdx - 1 (т.е. вставка прямо
                                    // перед rightIdx).
                                    if (currentPair.rightIdx !== undefined) {
                                      setAddAfterIdx(currentPair.rightIdx - 1)
                                    }
                                  }
                            }
                          />
                        )}
                        {rightPage && rightTemplate ? (
                          <div
                            className={`bg-card rounded shadow-sm border cursor-pointer ${
                              currentIdx === currentPair.rightIdx
                                ? 'border-brand-400 ring-2 ring-brand-200'
                                : 'border-border'
                            }`}
                            onClick={() => {
                              if (currentPair.rightIdx !== undefined)
                                setCurrentIdx(currentPair.rightIdx)
                            }}
                          >
                            <AlbumSpreadCanvas
                              instance={rightPage}
                              template={rightTemplate}
                              containerWidth={halfWidth}
                              mode={isReadOnly ? 'preview' : 'edit'}
                              draggingLabel={
                                dragState?.mode === 'swap' &&
                                dragState.instanceKey === rightPage.spread_index
                                  ? dragState.label
                                  : null
                              }
                              editingTextLabel={
                                currentIdx === currentPair.rightIdx ? editingTextLabel : null
                              }
                              onTextClick={isReadOnly ? undefined : handleTextClick}
                              onTextSubmit={isReadOnly ? undefined : handleTextSubmit}
                              onTextCancel={isReadOnly ? undefined : handleTextCancel}
                              onPhotoContextMenu={isReadOnly ? undefined : handlePhotoContextMenu}
                              onPhotoClick={isReadOnly ? undefined : handlePhotoClick}
                          textStyleOverrides={textStyleOverrides}
                          backgroundUrl={currentSpreadBgUrl}
                          pageSide="right"
                          croppingLabel={
                            rightPage && cropEditor?.spreadIndex === rightPage.spread_index
                              ? cropEditor.label
                              : null
                          }
                          cropHandlers={cropHandlers}
                            />
                          </div>
                        ) : showRightEndpaper ? (
                          <EndpaperPlaceholder
                            width={halfWidth}
                            aspectRatio={
                              leftTemplate
                                ? leftTemplate.width_mm / leftTemplate.height_mm
                                : 0.7
                            }
                          />
                        ) : (
                          <EmptyPagePlaceholder
                            width={halfWidth}
                            aspectRatio={
                              leftTemplate
                                ? leftTemplate.width_mm / leftTemplate.height_mm
                                : 0.7
                            }
                            label="Правая страница пуста"
                            onClick={
                              isReadOnly
                                ? undefined
                                : () => {
                                    // РЭ.38.2 (25.05.2026): пустая правая
                                    // страница разворота — добавляем новую
                                    // запись ПОСЛЕ существующей левой
                                    // (handleAddSpread вставляет на позицию
                                    // afterIdx + 1).
                                    if (currentPair.leftIdx !== undefined) {
                                      setAddAfterIdx(currentPair.leftIdx)
                                    }
                                  }
                            }
                          />
                        )}
                      </>
                    )}
                  </div>
                )
              })()}
            </>
          ) : (
            <p className="text-muted-foreground">Шаблон не найден для текущего разворота</p>
          )}
          </div>

          {/* Навигация — теперь по разворотам (Блок UX.2: вынесена из
              измеряемой зоны холста, занимает свою высоту под ним). */}
          {currentPair && (leftTemplate || rightTemplate) && (
            <div className="mt-4 flex items-center gap-3 flex-wrap self-center justify-center">
                <button
                  type="button"
                  onClick={() => {
                    // Прыжок на предыдущий разворот: на его leftIdx (или rightIdx если левая пуста)
                    const prevPair = visualSpreads[currentPairIdx - 1]
                    if (prevPair) {
                      const targetIdx = prevPair.leftIdx ?? prevPair.rightIdx
                      if (targetIdx !== undefined) setCurrentIdx(targetIdx)
                    }
                  }}
                  disabled={currentPairIdx <= 0}
                  className="px-3 py-1.5 text-sm rounded border border-border bg-card hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  ◀ Назад
                </button>
                <span className="text-sm text-muted-foreground">
                  Разворот {currentPairIdx + 1} из {visualSpreads.length}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const nextPair = visualSpreads[currentPairIdx + 1]
                    if (nextPair) {
                      const targetIdx = nextPair.leftIdx ?? nextPair.rightIdx
                      if (targetIdx !== undefined) setCurrentIdx(targetIdx)
                    }
                  }}
                  disabled={currentPairIdx >= visualSpreads.length - 1}
                  className="px-3 py-1.5 text-sm rounded border border-border bg-card hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Вперёд ▶
                </button>
                {/* РЭ.35.Г — заменить шаблон выделенной страницы разворота.
                    Если выделена левая — заменяем left, если правая — right.
                    Visual cue: синяя обводка показывает какую страницу
                    редактируем. */}
                {!isReadOnly && currentTemplate && (
                  <button
                    type="button"
                    onClick={() => setReplaceTemplateForIdx(currentIdx)}
                    className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-border bg-card hover:bg-muted text-foreground"
                    title={`Текущий шаблон: ${currentTemplate.name}. Заменить на другой.`}
                  >
                    <RefreshCw size={16} /> Заменить шаблон{' '}
                    {currentPair && !currentPair.isSpread
                      ? currentIdx === currentPair.leftIdx
                        ? '(левой страницы)'
                        : '(правой страницы)'
                      : ''}
                  </button>
                )}
                {/* РЭ.53.c — глобальные стили текста альбома. */}
                {!isReadOnly && (
                  <button
                    type="button"
                    onClick={() => setTextStylesModalOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-border bg-card hover:bg-muted text-foreground"
                    title="Размер и цвет имён, цитат, ФИО, должностей — для всего альбома сразу"
                  >
                    <Type size={16} /> Стили текстов
                  </button>
                )}
                {/* Этап 6 — ручной фон этого разворота. Показываем только если
                    у набора вообще есть категорийные фоны. */}
                {!isReadOnly && categoryBackgrounds.length > 0 && bgLeadIdx !== undefined && (
                  <button
                    type="button"
                    onClick={() => setBgPickerOpen(true)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border bg-card hover:bg-muted ${
                      currentBgOverride
                        ? 'border-brand-400 text-brand-700'
                        : 'border-border text-foreground'
                    }`}
                    title="Выбрать конкретный фон для этого разворота (перебить авторотацию)"
                  >
                    <ImageIcon size={16} /> Фон разворота{currentBgOverride ? ' •' : ''}
                  </button>
                )}
            </div>
          )}
        </main>

        {/* ─── Правая колонка: рейка сворачивания + палитра (Блок UX.1) ─── */}
        {/* Рейка-шеврон сворачивает правую панель, освобождая место под холст.
            Сворачивание ПЛАВНОЕ: внешняя обёртка анимирует ширину 0↔развёрнутая
            (overflow-hidden), внутренняя палитра фиксированной ширины — её
            просто «задвигает», без сплющивания контента. Канвас растёт следом
            через ResizeObserver (Блок UX.2). На мобильном (md:) обе скрыты. */}
        <button
          type="button"
          onClick={togglePaletteCollapsed}
          className="hidden md:flex w-6 shrink-0 items-center justify-center bg-card border-l border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title={paletteCollapsed ? 'Развернуть панель фото' : 'Свернуть панель фото'}
          aria-label={paletteCollapsed ? 'Развернуть панель фото' : 'Свернуть панель фото'}
        >
          {paletteCollapsed ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        </button>
        {(() => {
          const innerWidth = isReadOnly ? 320 : paletteExpandedPx
          return (
            <div
              className="hidden md:block shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out"
              style={{ width: paletteCollapsed ? 0 : innerWidth }}
            >
              {/* Фиксированная внутренняя ширина — палитра не «плющится». */}
              <div style={{ width: innerWidth, height: '100%' }}>
                {/* Л.4a — палитра видна только в edit-режиме.
                    В read-only отображается компактный баннер. */}
                {!isReadOnly ? (
                  <PhotoPalette spreads={spreads} photos={photos} />
                ) : (
                  <aside className="flex h-full w-full bg-muted border-l border-border flex-col items-center justify-center p-6 text-center">
                    <div className="mb-2 flex justify-center text-muted-foreground"><Eye size={40} /></div>
                    <p className="text-sm font-medium text-foreground mb-1">Только просмотр</p>
                    <p className="text-xs text-muted-foreground">
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
            </div>
          )
        })()}
      </div>

      {/* М.1 — strip миниатюр с drag-to-reorder.
          В read-only режиме доступна только клик-навигация.
          М.2 — кнопки удаления (✕ при hover) и добавления (➕ в конце).
          Блок UX.1 — полосу можно свернуть, освобождая высоту под холст.
          Сворачивание ПЛАВНОЕ через grid-template-rows 1fr↔0fr (анимирует
          авто-высоту без замеров). Когда свёрнута — тонкая полоска-кнопка. */}
      {layout && (
        <>
          {stripCollapsed && (
            <button
              type="button"
              onClick={toggleStripCollapsed}
              className="w-full flex items-center justify-center gap-2 bg-card border-t border-border py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Развернуть полосу разворотов"
            >
              <ChevronUp size={14} /> Развороты ({visualSpreads.length})
            </button>
          )}
          <div
            className="grid transition-[grid-template-rows] duration-300 ease-in-out"
            style={{ gridTemplateRows: stripCollapsed ? '0fr' : '1fr' }}
          >
            <div className="overflow-hidden min-h-0">
              <div className="relative">
                <button
                  type="button"
                  onClick={toggleStripCollapsed}
                  className="absolute top-2.5 right-3 z-10 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  title="Свернуть полосу разворотов"
                >
                  Свернуть <ChevronDown size={14} />
                </button>
                <SpreadOrderStrip
                  spreads={spreads}
                  templates={templates}
                  currentIdx={currentIdx}
                  onSelect={setCurrentIdx}
                  onReorder={handleReorderSpreads}
                  onDelete={isReadOnly ? undefined : handleDeleteSpread}
                  onAddRequest={isReadOnly ? undefined : handleAddRequest}
                  readOnly={isReadOnly}
                  softShift={isSoftAlbum}
                  backgroundUrl={backgroundUrl}
                  pageBackgroundUrl={(idx) => bgUrlByPageIdx.get(idx) ?? null}
                />
              </div>
            </div>
          </div>
        </>
      )}

      {/* Этап 6 — модалка выбора ручного фона текущего разворота */}
      {bgPickerOpen && (
        <SpreadBackgroundPicker
          backgrounds={categoryBackgrounds}
          category={currentSpreadCategory}
          currentOverride={currentBgOverride}
          onSelect={(path) => applyBgOverride(path)}
          onReset={() => applyBgOverride(null)}
          onClose={() => setBgPickerOpen(false)}
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
          printType={effectivePrintType}
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
            printType={effectivePrintType}
          />
        )
      })()}

        <DragOverlay dropAnimation={null}>
          {dragState?.mode === 'palette' ? (
            // Палитра → placeholder: фикс 120px overlay (миниатюра палитры
            // и так маленькая, фикс размер уместен).
            <div className="aspect-[3/4] w-[120px] bg-muted rounded overflow-hidden border-2 border-brand-500 shadow-xl">
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

      {/* ─── PhotoTransformPanel (КЭ.5 + Р.2) — кадрирование + поворот фото ─── */}
      {photoTransformPanel && (() => {
        // Извлекаем текущие значения transform из layout state.
        // Если ключей __scale__/__offset__/__rotate__ нет → defaults (1, 0, 0, 0).
        const spread = layout?.spreads[photoTransformPanel.spreadIndex]
        const data = spread?.data ?? {}
        const sc = parseScale(data[`__scale__${photoTransformPanel.label}`])
        const [ox, oy] = parseOffset(data[`__offset__${photoTransformPanel.label}`])
        const rot = parseRotate(data[`__rotate__${photoTransformPanel.label}`])
        return (
          <PhotoTransformPanel
            label={photoTransformPanel.label}
            scale={sc}
            offsetX={ox}
            offsetY={oy}
            rotateDeg={rot}
            rightEdge={photoTransformPanel.rightEdge}
            topEdge={photoTransformPanel.topEdge}
            leftEdge={photoTransformPanel.leftEdge}
            onChange={handleTransformChange}
            onClose={handleTransformPanelClose}
          />
        )
      })()}

      {/* ─── TextStylePanel (Р.3 + РЭ.54) — override стиля текста ─── */}
      {textStylePanel && !isReadOnly && (() => {
        // Извлекаем текущие overrides из data.
        // Если ключей нет → mult=1, color=null → palette default,
        // slider в центре.
        const spread = layout?.spreads[textStylePanel.spreadIndex]
        const data = spread?.data ?? {}
        const mult = parseFontSizeMult(data[`__fontSize__${textStylePanel.label}`])
        const colorOv = parseColor(data[`__color__${textStylePanel.label}`])
        // РЭ.54: align overrides.
        const hAlignOv = parseHAlign(data[`__halign__${textStylePanel.label}`])
        const vAlignOv = parseVAlign(data[`__valign__${textStylePanel.label}`])
        // РЭ.55: font override + templateFontFamily для подсказки.
        const fontOv = parseFontFamily(data[`__font__${textStylePanel.label}`])
        // Берём template placeholder.font_family — может быть НЕ из curated списка
        // (например, дизайнерский шрифт). Показываем как 'Из шаблона (...)'.
        const spreadTpl = spread
          ? templates.find((t) => t.id === spread.template_id)
          : null
        const phForLabel = spreadTpl?.placeholders.find(
          (p) => p.label === textStylePanel.label,
        )
        const templateFontFamily =
          phForLabel && phForLabel.type === 'text' ? phForLabel.font_family : null
        return (
          <TextStylePanel
            label={textStylePanel.label}
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
            onClose={handleTextStylePanelClose}
          />
        )
      })()}

      {/* РЭ.53.c — модалка глобальных стилей текста. */}
      {textStylesModalOpen && !isReadOnly && (
        <AlbumTextStylesModal
          initialOverrides={textStyleOverrides}
          onPreview={(next) => setTextStyleOverrides(next)}
          onSave={handleSaveTextStyles}
          onClose={() => setTextStylesModalOpen(false)}
        />
      )}

      {/* Блок UX.4 — полноэкранный просмотр готового макета («Вид»). */}
      {fullscreenOpen && layout && (
        <LayoutPreviewFullscreen
          visualSpreads={visualSpreads}
          spreads={spreads}
          templatesById={templatesById}
          isSoftAlbum={isSoftAlbum}
          bgUrlByPairIdx={bgPaths.map(toBgPublicUrl)}
          textStyleOverrides={textStyleOverrides}
          initialPairIdx={currentPairIdx >= 0 ? currentPairIdx : 0}
          onClose={() => setFullscreenOpen(false)}
        />
      )}

      {/* Toast «заменяем оригинал» — поверх редактора, blocking */}
      {replacingOriginal && (
        <div className="fixed bottom-4 right-4 bg-card border border-blue-200 rounded-lg shadow-lg px-4 py-3 z-50">
          <div className="flex items-center gap-3 text-sm">
            <span className="animate-spin">⏳</span>
            <span className="text-foreground">
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
            className="bg-card rounded-xl shadow-2xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-foreground mb-4">
              <Sparkles size={20} className="inline" /> Добро пожаловать в редактор макета
            </h2>
            <ul className="space-y-3 text-sm text-foreground">
              <li className="flex gap-3">
                <span className="text-brand-500 flex-shrink-0"><Camera size={18} /></span>
                <span>
                  <b>Фото:</b> перетащите из правой палитры в макет. Чтобы поменять
                  местами — перетащите одно фото на другое. Правый клик —
                  очистить или заменить.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="text-brand-500 flex-shrink-0"><Pencil size={18} /></span>
                <span>
                  <b>Текст:</b> кликните на ФИО, цитату или любой текст
                  в макете чтобы исправить. Enter — подтвердить, Esc — отменить.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="text-brand-500 flex-shrink-0">↶</span>
                <span>
                  <b>Отмена действий:</b> Ctrl+Z (⌘Z на Mac) или кнопка
                  «↶ Отменить» в шапке. До 50 шагов назад.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="text-brand-500 flex-shrink-0">◀▶</span>
                <span>
                  <b>Навигация:</b> стрелки ← / → на клавиатуре или кнопки внизу.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="text-green-500 flex-shrink-0"><Save size={18} /></span>
                <span>
                  <b>Автосохранение:</b> все изменения сохраняются автоматически.
                  Индикатор статуса в шапке справа.
                </span>
              </li>
            </ul>
            <button
              type="button"
              onClick={dismissOnboarding}
              className="mt-6 w-full bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
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
