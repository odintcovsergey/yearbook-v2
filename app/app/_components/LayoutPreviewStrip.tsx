'use client'

import { useEffect, useState, useMemo } from 'react'
import dynamic from 'next/dynamic'
import type { SpreadInstance, SpreadTemplate } from '@/lib/album-builder/types'

// Dynamic import: AlbumSpreadCanvas использует window.Image (Konva), SSR-incompatible.
const AlbumSpreadCanvas = dynamic(
  () => import('./AlbumSpreadCanvas'),
  { ssr: false, loading: () => null },
)

// ─── Минимальный publicный contract layout'а (не SmartFillLayout) ────────
// Принимаем layout с конкретными полями которые нужны компоненту, без
// необходимости тащить SmartFillLayout (он определён в page.tsx).
type LayoutShape = {
  template_set_id: string
  spreads: unknown[]  // narrowing к SpreadInstance[] делаем внутри
}

type Props = {
  layout: LayoutShape
  onOpenEditor: () => void
}

type TemplateDetailResponse = {
  template_set: { id: string; spread_width_mm: number; spread_height_mm: number }
  spread_templates: SpreadTemplate[]
}

const TARGET_HEIGHT_PX = 175  // см. инструкцию 2.3 «Размер миниатюр»

// ─── Хелпер: API-fetch (тот же стиль что в page.tsx — credentials: include) ──
async function fetchTemplateDetail(templateSetId: string): Promise<TemplateDetailResponse> {
  const r = await fetch(
    `/api/layout?action=template_set_detail&id=${templateSetId}`,
    { credentials: 'include', headers: { 'Content-Type': 'application/json' } },
  )
  if (!r.ok) {
    throw new Error(`template_set_detail failed: ${r.status}`)
  }
  return r.json()
}

export default function LayoutPreviewStrip({ layout, onOpenEditor }: Props) {
  const [detail, setDetail] = useState<TemplateDetailResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchTemplateDetail(layout.template_set_id)
      .then((d) => {
        if (!cancelled) setDetail(d)
      })
      .catch(() => {
        if (!cancelled) setError('Не удалось загрузить шаблон')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [layout.template_set_id])

  // Map id → SpreadTemplate для O(1) lookup'а внутри map'а миниатюр.
  const templateById = useMemo(() => {
    const m = new Map<string, SpreadTemplate>()
    if (!detail) return m
    for (const t of detail.spread_templates) m.set(t.id, t)
    return m
  }, [detail])

  const spreads = layout.spreads as SpreadInstance[]

  return (
    <div className="bg-gray-50 rounded-lg p-3 mb-4">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="text-xs text-gray-500 uppercase">
          Превью разворотов ({spreads.length})
        </div>
        <button
          type="button"
          onClick={onOpenEditor}
          disabled
          className="text-xs px-3 py-1.5 rounded border border-gray-300 bg-white text-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Редактор скоро будет доступен (подэтап 2.6)"
        >
          Открыть редактор
        </button>
      </div>

      {loading && (
        <div className="text-xs text-gray-400 py-4">Загружаем шаблон…</div>
      )}

      {error && (
        <div className="text-xs text-red-600 py-4">{error}</div>
      )}

      {!loading && !error && detail && (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {spreads.map((s) => {
            const tmpl = templateById.get(s.template_id)
            if (!tmpl) {
              return (
                <div
                  key={s.spread_index}
                  className="flex-shrink-0 w-[175px] h-[175px] border border-red-200 bg-red-50 flex items-center justify-center text-xs text-red-500"
                >
                  Шаблон не найден
                </div>
              )
            }
            const containerWidth = (tmpl.width_mm / tmpl.height_mm) * TARGET_HEIGHT_PX
            return (
              <div key={s.spread_index} className="flex-shrink-0">
                <div className="bg-white rounded shadow-sm border border-gray-200">
                  <AlbumSpreadCanvas
                    instance={s}
                    template={tmpl}
                    containerWidth={containerWidth}
                    mode="preview"
                  />
                </div>
                <div className="text-[10px] text-center text-gray-500 mt-1">
                  {s.spread_index}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
