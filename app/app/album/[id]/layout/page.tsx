'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
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
import SaveIndicator from '../../../_components/SaveIndicator'

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
export default function LayoutEditorPage({
  params,
}: {
  params: { id: string }
}) {
  const router = useRouter()
  const albumId = params.id

  const [layout, setLayout] = useState<LayoutData | null>(null)
  const [templates, setTemplates] = useState<SpreadTemplate[]>([])
  const [photos, setPhotos] = useState<AlbumPhoto[]>([])
  const [albumTitle, setAlbumTitle] = useState<string>('')
  const [currentIdx, setCurrentIdx] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viewport, setViewport] = useState({ width: 1440, height: 900 })
  const [activeDrag, setActiveDrag] = useState<AlbumPhoto | null>(null)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'pending' | 'saving' | 'error'>('saved')
  const [lastSavedSpreads, setLastSavedSpreads] = useState<SpreadInstance[] | null>(null)
  const saveCounterRef = useRef(0)

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
        // 1. Загружаем layout (получаем template_set_id)
        const layoutRes = await api(
          `/api/layout?action=album_layout&album_id=${albumId}`,
        )
        if (!layoutRes.ok) {
          throw new Error(`layout load failed: ${layoutRes.status}`)
        }
        const layoutJson = await layoutRes.json()
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
            `/api/layout?action=template_set_detail&id=${loadedLayout.template_set_id}`,
          ),
          api(`/api/tenant?action=album_photos&album_id=${albumId}`),
          api(`/api/tenant?action=album&album_id=${albumId}`),
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
  useEffect(() => {
    if (!layout || lastSavedSpreads === null) return
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
  }, [layout?.spreads, lastSavedSpreads])

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

  function handleDragStart(event: DragStartEvent) {
    const sourceData = event.active.data.current as
      | { type?: string; photo?: AlbumPhoto; url?: string | null }
      | undefined
    if (sourceData?.type === 'palette' && sourceData.photo) {
      setActiveDrag(sourceData.photo)
      return
    }
    if (sourceData?.type === 'placeholder' && sourceData.url) {
      // Найти photo по URL для DragOverlay (если в палитре есть)
      const photo = photos.find((p) => p.url === sourceData.url)
      if (photo) setActiveDrag(photo)
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDrag(null)
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
        </div>
        <SaveIndicator status={saveStatus} />
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
                  mode="edit"
                />
              </div>

              {/* Навигация */}
              <div className="mt-4 flex items-center gap-3">
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
              </div>
            </>
          ) : (
            <p className="text-gray-500">Шаблон не найден для текущего разворота</p>
          )}
        </main>

        {/* ─── Правая колонка: палитра ─── */}
        <PhotoPalette spreads={spreads} photos={photos} />
      </div>
        <DragOverlay>
          {activeDrag && (
            <div className="aspect-[3/4] w-[120px] bg-gray-100 rounded overflow-hidden border-2 border-blue-500 shadow-xl">
              <img
                src={activeDrag.thumb_url}
                alt={activeDrag.filename}
                draggable={false}
                className="w-full h-full object-cover pointer-events-none"
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
