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
import {
  segmentToSpreads,
  findVisualSpreadForPage,
  type VisualSpread,
} from '@/lib/album-builder/segment-to-spreads'

// AlbumSpreadCanvas — Konva, SSR-incompatible
const AlbumSpreadCanvas = dynamic(() => import('./AlbumSpreadCanvas'), {
  ssr: false,
  loading: () => null,
})

// ─── SpreadOrderStrip ─────────────────────────────────────────────────────
//
// РЭ.35.Д — Горизонтальная strip миниатюр РАЗВОРОТОВ внизу редактора.
//
// Под капотом: spreads[] это массив страниц (legacy формат, 1 элемент =
// 1 страница). Здесь мы группируем их попарно в визуальные развороты
// через segmentToSpreads helper и показываем каждый разворот как ОДНУ
// карточку с двумя миниатюрами рядом (или одной для is_spread мастеров).
//
// Операции:
//  - Клик на левую/правую миниатюру → переключение currentIdx на
//    соответствующую страницу
//  - Drag&drop карточки → переупорядочивание пар страниц (обе двигаются
//    вместе)
//  - Удаление → удаление обеих страниц разворота (родитель решает что
//    делать с висящими)
//  - Активный разворот (тот в котором сейчас currentIdx) подсвечен синей
//    рамкой; внутри него та страница которая currentIdx — отдельной
//    светлой обводкой

type Props = {
  spreads: SpreadInstance[]
  templates: SpreadTemplate[]
  currentIdx: number
  onSelect: (idx: number) => void
  onReorder: (newSpreads: SpreadInstance[]) => void
  // Удалить РАЗВОРОТ — родитель должен удалить все страницы разворота.
  // pageIndices — массив индексов страниц в spreads[] (1 для is_spread,
  // 1 для висящего, 2 для обычного).
  onDelete?: (pageIndices: number[]) => void
  // Добавить новый разворот после указанной страницы.
  onAddRequest?: (insertAfterPageIdx: number) => void
  readOnly?: boolean
}

const PAGE_THUMB_WIDTH = 48 // одна страница (половина разворота)
const SPREAD_THUMB_WIDTH = 96 // полный разворот (двух-страничный)

export default function SpreadOrderStrip({
  spreads,
  templates,
  currentIdx,
  onSelect,
  onReorder,
  onDelete,
  onAddRequest,
  readOnly = false,
}: Props) {
  const templateMap = useMemo(() => {
    const map = new Map<string, SpreadTemplate>()
    for (const t of templates) map.set(t.id, t)
    return map
  }, [templates])

  // Сегментация страниц в визуальные развороты.
  const visualSpreads = useMemo(
    () => segmentToSpreads(spreads, templateMap),
    [spreads, templateMap],
  )

  // Текущий активный разворот — pair в котором сейчас находится currentIdx.
  const currentPairIdx = useMemo(
    () => findVisualSpreadForPage(visualSpreads, currentIdx),
    [visualSpreads, currentIdx],
  )

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  )

  // ID-based sortable: используем pair-index. При reorder пары мы
  // пересчитываем массив страниц с нуля.
  const itemIds = useMemo(
    () => visualSpreads.map((_, i) => `pair-${i}`),
    [visualSpreads],
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldPairIdx = visualSpreads.findIndex((_, i) => `pair-${i}` === active.id)
    const newPairIdx = visualSpreads.findIndex((_, i) => `pair-${i}` === over.id)
    if (oldPairIdx === -1 || newPairIdx === -1) return

    // Переставляем pair'ы. Каждый pair → 1 или 2 страницы; собираем
    // плоский массив страниц в новом порядке.
    const reorderedPairs = arrayMove(visualSpreads, oldPairIdx, newPairIdx)
    const newSpreads: SpreadInstance[] = []
    for (const pair of reorderedPairs) {
      if (pair.isSpread && pair.leftIdx !== undefined) {
        // is_spread занимает оба места но в массиве это ОДИН элемент
        // SpreadInstance (см. layout-to-buildresult adapter).
        newSpreads.push(spreads[pair.leftIdx])
      } else {
        if (pair.leftIdx !== undefined) newSpreads.push(spreads[pair.leftIdx])
        if (pair.rightIdx !== undefined) newSpreads.push(spreads[pair.rightIdx])
      }
    }
    const renumbered = newSpreads.map((s, i) => ({ ...s, spread_index: i }))
    onReorder(renumbered)

    // Преследуем активную страницу (по reference equality).
    const currentPage = spreads[currentIdx]
    if (currentPage) {
      const newPos = renumbered.findIndex((s) => s === currentPage)
      if (newPos !== -1 && newPos !== currentIdx) {
        onSelect(newPos)
      }
    }
  }

  return (
    <div className="bg-white border-t border-gray-200 px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-gray-500">
          Развороты ({visualSpreads.length}){' '}
          {!readOnly && (
            <span className="text-gray-400">— перетащите чтобы изменить порядок</span>
          )}
        </p>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={itemIds} strategy={horizontalListSortingStrategy}>
          <div className="flex gap-2 overflow-x-auto pb-1 items-stretch">
            {visualSpreads.map((pair, pairIdx) => {
              const leftPage =
                pair.leftIdx !== undefined ? spreads[pair.leftIdx] : null
              const rightPage =
                pair.rightIdx !== undefined ? spreads[pair.rightIdx] : null
              const leftTemplate = leftPage ? templateMap.get(leftPage.template_id) : null
              const rightTemplate = rightPage ? templateMap.get(rightPage.template_id) : null
              return (
                <SortablePairThumb
                  key={`pair-${pairIdx}`}
                  id={`pair-${pairIdx}`}
                  pair={pair}
                  leftPage={leftPage}
                  rightPage={rightPage}
                  leftTemplate={leftTemplate ?? null}
                  rightTemplate={rightTemplate ?? null}
                  position={pairIdx + 1}
                  isActive={pairIdx === currentPairIdx}
                  currentPageIdx={currentIdx}
                  onSelect={onSelect}
                  onDelete={
                    !readOnly && onDelete && visualSpreads.length > 1
                      ? () => {
                          const indices: number[] = []
                          if (pair.leftIdx !== undefined) indices.push(pair.leftIdx)
                          if (
                            pair.rightIdx !== undefined &&
                            pair.rightIdx !== pair.leftIdx
                          ) {
                            indices.push(pair.rightIdx)
                          }
                          onDelete(indices)
                        }
                      : undefined
                  }
                  disabled={readOnly}
                />
              )
            })}

            {/* Кнопка «➕ Добавить разворот» в конце strip. Вставляет
                новую страницу после текущего активного разворота. */}
            {!readOnly && onAddRequest && (
              <button
                type="button"
                onClick={() => {
                  const currentPair = visualSpreads[currentPairIdx]
                  const insertAfter =
                    currentPair?.rightIdx ??
                    currentPair?.leftIdx ??
                    spreads.length - 1
                  onAddRequest(insertAfter)
                }}
                className="flex-shrink-0 flex flex-col items-center justify-center w-24 border-2 border-dashed border-gray-300 hover:border-blue-400 hover:bg-blue-50/30 rounded text-gray-400 hover:text-blue-600 transition-colors"
                title="Добавить разворот после текущего"
              >
                <span className="text-2xl leading-none">➕</span>
                <span className="text-[10px] mt-1">Добавить</span>
              </button>
            )}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}

// ─── SortablePairThumb — карточка одного визуального разворота ──────────
function SortablePairThumb({
  id,
  pair,
  leftPage,
  rightPage,
  leftTemplate,
  rightTemplate,
  position,
  isActive,
  currentPageIdx,
  onSelect,
  onDelete,
  disabled,
}: {
  id: string
  pair: VisualSpread
  leftPage: SpreadInstance | null
  rightPage: SpreadInstance | null
  leftTemplate: SpreadTemplate | null
  rightTemplate: SpreadTemplate | null
  position: number
  isActive: boolean
  currentPageIdx: number
  onSelect: (idx: number) => void
  onDelete?: () => void
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
      className={`group flex-shrink-0 relative rounded border-2 transition-colors ${
        isActive
          ? 'border-blue-500 ring-2 ring-blue-200'
          : 'border-gray-200 hover:border-gray-400'
      }`}
      title={`Разворот ${position}`}
    >
      {/* Двойная миниатюра. attributes/listeners — на внешнем контейнере
          чтобы drag начинался с любой стороны разворота; клики по
          левой/правой направляют setCurrentIdx на нужную страницу. */}
      <div
        {...attributes}
        {...listeners}
        className={`flex ${disabled ? 'cursor-default' : 'cursor-grab'}`}
        style={{ width: SPREAD_THUMB_WIDTH }}
      >
        {pair.isSpread && leftPage && leftTemplate ? (
          // Spread-мастер: один canvas на всю ширину
          <div
            onClick={(e) => {
              e.stopPropagation()
              if (pair.leftIdx !== undefined) onSelect(pair.leftIdx)
            }}
            className={`overflow-hidden rounded ${
              currentPageIdx === pair.leftIdx ? 'ring-1 ring-blue-300' : ''
            }`}
            style={{ width: SPREAD_THUMB_WIDTH }}
          >
            <AlbumSpreadCanvas
              instance={leftPage}
              template={leftTemplate}
              containerWidth={SPREAD_THUMB_WIDTH}
              mode="preview"
            />
          </div>
        ) : (
          <>
            {/* Левая половина */}
            <div
              onClick={(e) => {
                e.stopPropagation()
                if (pair.leftIdx !== undefined) onSelect(pair.leftIdx)
              }}
              className={`overflow-hidden bg-white ${
                currentPageIdx === pair.leftIdx ? 'ring-1 ring-blue-300' : ''
              }`}
              style={{ width: PAGE_THUMB_WIDTH }}
            >
              {leftPage && leftTemplate ? (
                <AlbumSpreadCanvas
                  instance={leftPage}
                  template={leftTemplate}
                  containerWidth={PAGE_THUMB_WIDTH}
                  mode="preview"
                />
              ) : (
                <EmptySideThumb width={PAGE_THUMB_WIDTH} />
              )}
            </div>
            {/* Правая половина */}
            <div
              onClick={(e) => {
                e.stopPropagation()
                if (pair.rightIdx !== undefined) onSelect(pair.rightIdx)
              }}
              className={`overflow-hidden bg-white ${
                currentPageIdx === pair.rightIdx ? 'ring-1 ring-blue-300' : ''
              }`}
              style={{ width: PAGE_THUMB_WIDTH }}
            >
              {rightPage && rightTemplate ? (
                <AlbumSpreadCanvas
                  instance={rightPage}
                  template={rightTemplate}
                  containerWidth={PAGE_THUMB_WIDTH}
                  mode="preview"
                />
              ) : (
                <EmptySideThumb width={PAGE_THUMB_WIDTH} />
              )}
            </div>
          </>
        )}
      </div>

      {/* Номер разворота — поверх в углу */}
      <span
        className={`absolute top-0 left-0 px-1.5 py-0.5 text-[10px] font-medium rounded-br pointer-events-none ${
          isActive ? 'bg-blue-500 text-white' : 'bg-white/90 text-gray-700'
        }`}
      >
        {position}
      </span>

      {/* Кнопка удаления (видна при hover) */}
      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="absolute top-0 right-0 w-5 h-5 flex items-center justify-center bg-red-500 text-white rounded-bl opacity-0 group-hover:opacity-100 transition-opacity text-xs hover:bg-red-600"
          title="Удалить разворот"
        >
          ✕
        </button>
      )}
    </div>
  )
}

// Пустая половина миниатюры (для висящих разворотов с одной заполненной стороной).
function EmptySideThumb({ width }: { width: number }) {
  const height = width * 1.4
  return (
    <div
      className="bg-gray-50 border border-dashed border-gray-300"
      style={{ width, height }}
      title="Пустая страница"
    />
  )
}
