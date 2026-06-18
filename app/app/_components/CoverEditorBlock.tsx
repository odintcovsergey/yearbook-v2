'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { layoutCover } from '@/lib/cover/layout'
import { renderCoverPreviewSvg } from '@/lib/cover/preview-svg'
import type { RenderPlaceholder } from '@/lib/album-builder/types'
import type { CoverCanvasMaster } from './CoverCanvas'

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
}
type EditorData = { items: Item[]; spine_width_mm: number | null }

const TYPE_LABEL: Record<CoverType, string> = {
  portrait_photo: 'Портрет', common_photo: 'Общая', design_only: 'Дизайн',
}
function num(v: number | null): number { return typeof v === 'number' && Number.isFinite(v) ? v : 0 }

function itemSvg(item: Item, spine: number | null): string {
  const m = item.master
  if (!m) return ''
  const nominal = num(m.nominal_spine_width_mm)
  const laid = layoutCover(
    { backWidthMm: num(m.back_width_mm), frontWidthMm: num(m.front_width_mm), heightMm: num(m.height_mm), nominalSpineWidthMm: nominal, realSpineWidthMm: spine ?? nominal },
    m.placeholders as Array<RenderPlaceholder & { zone?: 'back' | 'spine' | 'front' }>,
  )
  let width = laid.width_mm, height = num(m.height_mm)
  if (width <= 0 || height <= 0) {
    for (const p of m.placeholders) { width = Math.max(width, (p.x_mm ?? 0) + (p.width_mm ?? 0)); height = Math.max(height, (p.y_mm ?? 0) + (p.height_mm ?? 0)) }
  }
  return renderCoverPreviewSvg({
    width_mm: width || 100, height_mm: height || 100,
    spine_left_mm: laid.spine_left_mm, spine_right_mm: laid.spine_right_mm,
    placeholders: laid.placeholders, data: item.data,
    background_url: m.background_url, hide_empty_slots: true,
  })
}

/**
 * Компактная лента обложек заказа в «Обзоре» — одна строка с горизонтальным
 * скроллом (как «Превью разворотов») + кнопка «Открыть редактор». Сам редактор
 * — отдельная страница /app/album/[id]/cover.
 */
export default function CoverEditorBlock({ albumId }: { albumId: string }) {
  const router = useRouter()
  const [data, setData] = useState<EditorData | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/tenant?action=cover_editor&album_id=${albumId}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: EditorData | null) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [albumId])

  useEffect(() => { load() }, [load])

  if (loading || !data || data.items.length === 0) return null

  return (
    <div className="bg-muted rounded-lg p-3 mb-4">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="text-xs text-muted-foreground uppercase tracking-wide">
          Обложки ({data.items.length})
        </div>
        <button
          type="button"
          onClick={() => router.push(`/app/album/${albumId}/cover`)}
          className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700"
        >
          Открыть редактор
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2">
        {data.items.map((item) => (
          <div key={item.key} className="flex-shrink-0">
            <div
              className="bg-card rounded shadow-sm border border-border overflow-hidden"
              style={{ width: 150, aspectRatio: '3 / 2' }}
              dangerouslySetInnerHTML={{ __html: itemSvg(item, data.spine_width_mm) }}
            />
            <div className="text-[10px] text-center text-muted-foreground mt-1 truncate" style={{ width: 150 }}>
              {item.child_name ?? TYPE_LABEL[item.cover_type]}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
