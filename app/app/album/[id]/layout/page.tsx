'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import type {
  SpreadInstance,
  SpreadTemplate,
} from '@/lib/album-builder/types'
import PhotoPalette from '../../../_components/PhotoPalette'

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

// ─── Хелпер api() — копия из app/app/page.tsx, но без refresh-loop'а ─────
// (refresh-логика тут не нужна: при истёкшем токене страница редактора
// просто покажет ошибку и партнёр откроет её заново из /app)
async function api(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(path, {
    ...opts,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts?.headers ?? {}) },
  })
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
          onClick={() => router.push('/app')}
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
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* ═══ Header ═══ */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => router.push('/app')}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            ← К альбому
          </button>
          <h1 className="text-base font-semibold text-gray-900">
            {albumTitle || 'Альбом'}
          </h1>
          <span className="text-xs text-gray-400">— Layout редактор</span>
        </div>
        {/* SaveIndicator появится в 2.6.4 */}
      </header>

      {/* ═══ Main: левая колонка (canvas) + правая (палитра) ═══ */}
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
    </div>
  )
}
