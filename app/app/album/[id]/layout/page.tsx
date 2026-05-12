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
import PhotoContextMenu from '../../../_components/PhotoContextMenu'

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
  // Идёт ли сейчас загрузка нового оригинала через replace_original.
  // Показывается toast в header'е чтобы партнёр видел что процесс идёт.
  const [replacingOriginal, setReplacingOriginal] = useState<string | null>(null)
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
                  draggingLabel={dragState?.mode === 'swap' ? dragState.label : null}
                  editingTextLabel={editingTextLabel}
                  onTextClick={handleTextClick}
                  onTextSubmit={handleTextSubmit}
                  onTextCancel={handleTextCancel}
                  onPhotoContextMenu={handlePhotoContextMenu}
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
          onReplaceOriginal={() => {
            const p = photos.find((ph) => ph.url === photoContextMenu.url)
            if (p) void handleReplaceOriginal(p.id)
          }}
          onClose={() => setPhotoContextMenu(null)}
        />
      )}

      {/* Toast «заменяем оригинал» — поверх редактора, blocking */}
      {replacingOriginal && (
        <div className="fixed bottom-4 right-4 bg-white border border-blue-200 rounded-lg shadow-lg px-4 py-3 z-50">
          <div className="flex items-center gap-3 text-sm">
            <span className="animate-spin">⏳</span>
            <span className="text-gray-700">
              Заменяем оригинал: <span className="font-medium">{replacingOriginal}</span>
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
