'use client'

import { useMemo } from 'react'
import dynamic from 'next/dynamic'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  arrayMove,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { SpreadInstance, SpreadTemplate } from '@/lib/album-builder/types'

// AlbumSpreadCanvas — Konva, SSR-incompatible
const AlbumSpreadCanvas = dynamic(() => import('./AlbumSpreadCanvas'), {
  ssr: false,
  loading: () => null,
})

// ─── SpreadOrderStrip ─────────────────────────────────────────────────────
//
// М.1 — Горизонтальная strip миниатюр разворотов внизу редактора с
// drag-and-drop переупорядочиванием.
//
// - Клик по миниатюре → переход к этому развороту (setCurrentIdx)
// - Drag миниатюры → переупорядочивание spreads[]
// - Активный разворот подсвечен синей рамкой
// - Read-only режим: drag disabled, только клик-навигация
//
// ВАЖНО про spread_index: после reorder поле spread_index у каждого
// SpreadInstance обновляется чтобы соответствовать новой позиции в
// массиве (это нужно для backend'а который полагается на spread_index
// для сортировки при render'е PDF и для следующей пересборки).

type Props = {
  spreads: SpreadInstance[]
  templates: SpreadTemplate[]
  currentIdx: number
  onSelect: (idx: number) => void
  onReorder: (newSpreads: SpreadInstance[]) => void
  readOnly?: boolean
}

const THUMB_WIDTH = 96  // компактные миниатюры

export default function SpreadOrderStrip({
  spreads,
  templates,
  currentIdx,
  onSelect,
  onReorder,
  readOnly = false,
}: Props) {
  // Map template_id → template для быстрого lookup'а
  const templateMap = useMemo(() => {
    const map = new Map<string, SpreadTemplate>()
    for (const t of templates) map.set(t.id, t)
    return map
  }, [templates])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Drag активируется после смещения 5px — клик-навигация работает
      // нормально (быстрый press → click handler), а drag нужно явно начать
      activationConstraint: { distance: 5 },
    }),
  )

  // ID-based sortable: используем spread_index как стабильный ID.
  // (template_id не уникален — несколько разворотов могут использовать
  // один template, например портретные D-D-D.)
  const itemIds = useMemo(
    () => spreads.map((s) => `spread-${s.spread_index}`),
    [spreads],
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = spreads.findIndex((s) => `spread-${s.spread_index}` === active.id)
    const newIdx = spreads.findIndex((s) => `spread-${s.spread_index}` === over.id)
    if (oldIdx === -1 || newIdx === -1) return
    const reordered = arrayMove(spreads, oldIdx, newIdx)
    // Переписываем spread_index чтобы соответствовать новой позиции —
    // backend ориентируется на это поле при render'е и пересборке.
    const renumbered = reordered.map((s, i) => ({ ...s, spread_index: i }))
    onReorder(renumbered)

    // После reorder активный разворот может оказаться на другой позиции —
    // сохраняем «преследование» того же разворота через onSelect.
    // Если двигали именно активный — он теперь на newIdx.
    // Если двигали другой, а активный сдвинулся — пересчитаем.
    const currentSpreadIdx = spreads[currentIdx]?.spread_index
    if (currentSpreadIdx !== undefined) {
      const newPos = renumbered.findIndex((s) => {
        // Найти тот же разворот по data (после ре-номерации spread_index
        // изменён, поэтому ищем по комбинации template_id + старого data
        // через reference equality — после arrayMove ссылки сохранены).
        return s === reordered[oldIdx === currentIdx ? newIdx : currentIdx]
      })
      if (newPos !== -1 && newPos !== currentIdx) {
        onSelect(newPos)
      }
    }
  }

  return (
    <div className="bg-white border-t border-gray-200 px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-gray-500">
          Развороты ({spreads.length}) {!readOnly && <span className="text-gray-400">— перетащите чтобы изменить порядок</span>}
        </p>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={itemIds} strategy={horizontalListSortingStrategy}>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {spreads.map((spread, idx) => {
              const template = templateMap.get(spread.template_id)
              if (!template) return null
              return (
                <SortableSpreadThumb
                  key={`spread-${spread.spread_index}`}
                  id={`spread-${spread.spread_index}`}
                  spread={spread}
                  template={template}
                  position={idx + 1}
                  isActive={idx === currentIdx}
                  onClick={() => onSelect(idx)}
                  disabled={readOnly}
                />
              )
            })}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}

// ─── SortableSpreadThumb — одна миниатюра ────────────────────────────────
function SortableSpreadThumb({
  id,
  spread,
  template,
  position,
  isActive,
  onClick,
  disabled,
}: {
  id: string
  spread: SpreadInstance
  template: SpreadTemplate
  position: number
  isActive: boolean
  onClick: () => void
  disabled: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={`flex-shrink-0 relative cursor-pointer rounded border-2 transition-colors ${
        isActive
          ? 'border-blue-500 ring-2 ring-blue-200'
          : 'border-gray-200 hover:border-gray-400'
      } ${disabled ? 'cursor-default' : ''}`}
      title={`Разворот ${position}: ${template.name}`}
    >
      {/* Маленькая Konva-копия разворота */}
      <div className="overflow-hidden rounded bg-white" style={{ width: THUMB_WIDTH }}>
        <AlbumSpreadCanvas
          instance={spread}
          template={template}
          containerWidth={THUMB_WIDTH}
          mode="preview"
        />
      </div>
      {/* Номер разворота — поверх в углу */}
      <span
        className={`absolute top-0 left-0 px-1.5 py-0.5 text-[10px] font-medium rounded-br ${
          isActive ? 'bg-blue-500 text-white' : 'bg-white/90 text-gray-700'
        }`}
      >
        {position}
      </span>
    </div>
  )
}
