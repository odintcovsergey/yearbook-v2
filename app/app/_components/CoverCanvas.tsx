'use client'

/**
 * CoverCanvas — тонкая обёртка над AlbumSpreadCanvas для обложки (ТЗ
 * tz-cover-editor). Полотно задняя|корешок|передняя приводится к «развороту»:
 * placeholders раскладываются layoutCover (плавающий корешок), фон/декор/кроп/
 * тексты наследуются от AlbumSpreadCanvas без дублирования логики.
 */

import dynamic from 'next/dynamic'
import { layoutCover } from '@/lib/cover/layout'
import { hiddenOverridesFromData } from '@/lib/cover/editor-merge'
import type { SpreadInstance, SpreadTemplate, RenderPlaceholder } from '@/lib/album-builder/types'
import type { CropHandlers } from './AlbumSpreadCanvas'

const AlbumSpreadCanvas = dynamic(() => import('./AlbumSpreadCanvas'), { ssr: false, loading: () => null })

export type CoverCanvasMaster = {
  placeholders: RenderPlaceholder[]
  back_width_mm: number | null
  front_width_mm: number | null
  height_mm: number | null
  nominal_spine_width_mm: number | null
  background_url: string | null
}

type Props = {
  master: CoverCanvasMaster
  data: Record<string, string | null>
  spineWidthMm: number | null
  containerWidth: number
  mode?: 'preview' | 'edit'
  editingTextLabel?: string | null
  onTextClick?: (label: string, currentValue: string | null, rightEdge: number, topEdge: number, leftEdge: number, instanceKey: number) => void
  onTextSubmit?: (label: string, newValue: string | null) => void
  onTextCancel?: () => void
  onPhotoClick?: (label: string, url: string, rightEdge: number, topEdge: number, leftEdge: number, instanceKey: number) => void
  croppingLabel?: string | null
  cropHandlers?: CropHandlers
}

function num(v: number | null): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

export default function CoverCanvas({
  master, data, spineWidthMm, containerWidth, mode = 'edit',
  editingTextLabel, onTextClick, onTextSubmit, onTextCancel, onPhotoClick, croppingLabel, cropHandlers,
}: Props) {
  const back = num(master.back_width_mm)
  const front = num(master.front_width_mm)
  const heightMm = num(master.height_mm)
  const nominal = num(master.nominal_spine_width_mm)
  const real = spineWidthMm ?? nominal

  const laid = layoutCover(
    { backWidthMm: back, frontWidthMm: front, heightMm, nominalSpineWidthMm: nominal, realSpineWidthMm: real },
    master.placeholders as Array<RenderPlaceholder & { zone?: 'back' | 'spine' | 'front' }>,
  )

  let width = laid.width_mm
  let height = heightMm
  if (width <= 0 || height <= 0) {
    for (const p of master.placeholders) {
      width = Math.max(width, (p.x_mm ?? 0) + (p.width_mm ?? 0))
      height = Math.max(height, (p.y_mm ?? 0) + (p.height_mm ?? 0))
    }
  }

  const template = {
    id: 'cover',
    name: 'cover',
    type: 'common',
    is_spread: true,
    width_mm: width || 100,
    height_mm: height || 100,
    placeholders: laid.placeholders,
    rules: null,
    sort_order: 0,
    applies_to_configs: [],
    default_for_configs: [],
    page_role: null,
    slot_capacity: null,
    is_fallback: false,
    mirror_for_soft: false,
    audit_notes: null,
  } as unknown as SpreadTemplate

  const instance: SpreadInstance = { spread_index: 0, template_id: 'cover', template_name: 'cover', data }

  // Пустые ФОТО-слоты скрываем на холсте (как в превью): на задней обложке
  // рамки общего фото/QR не нужны, пока туда ничего не подставлено. Текстовые
  // слоты не трогаем (их можно заполнить). Ручное скрытие — через __hidden__.
  const overrides: Record<string, { hidden?: boolean }> = { ...hiddenOverridesFromData(data) }
  for (const p of laid.placeholders) {
    if (p.type === 'photo' && !data[p.label]) overrides[p.label] = { hidden: true }
  }

  return (
    <AlbumSpreadCanvas
      instance={instance}
      template={template}
      containerWidth={containerWidth}
      mode={mode}
      backgroundUrl={master.background_url}
      pageSide="spread"
      spineMarginMm={null}
      placeholderOverrides={overrides}
      editingTextLabel={editingTextLabel}
      onTextClick={onTextClick}
      onTextSubmit={onTextSubmit}
      onTextCancel={onTextCancel}
      onPhotoClick={onPhotoClick}
      croppingLabel={croppingLabel}
      cropHandlers={cropHandlers}
    />
  )
}
