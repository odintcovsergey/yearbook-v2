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
// РЭ.35.Д.2 — Strip миниатюр с гибридной моделью «развороты + страницы»:
//
//  - Визуально страницы СГРУППИРОВАНЫ в карточки-развороты (тонкий
//    разделитель между left/right, общая рамка-разворот)
//  - Но DRAG&DROP работает ПОСТРАНИЧНО — каждая страница отдельный
//    sortable item. Это даёт фотографу гибкость переставлять отдельные
//    страницы внутри/между разворотов.
//  - Удаление одиночной страницы (✕ на её половинке миниатюры) ведёт
//    к СДВИГУ всех последующих страниц на одну — для этого confirm
//    с предупреждением «это сместит весь дальнейший альбом».
//  - Удаление целого разворота (✕ в углу карточки) удаляет обе
//    страницы вместе — без сдвига.
//
// Под капотом spreads[] остаётся плоским массивом страниц (legacy
// формат). segmentToSpreads используется только для визуальной
// группировки.

type Props = {
  spreads: SpreadInstance[]
  templates: SpreadTemplate[]
  currentIdx: number
  onSelect: (idx: number) => void
  onReorder: (newSpreads: SpreadInstance[]) => void
  // Удалить страницы — родитель получает массив pageIndices и убирает их.
  // При одной странице — confirm с предупреждением о сдвиге; при двух
  // (целый разворот) — обычный confirm.
  onDelete?: (pageIndices: number[]) => void
  // Добавить новую страницу после указанной.
  onAddRequest?: (insertAfterPageIdx: number) => void
  readOnly?: boolean
  /**
   * РЭ.35.Е.5: для soft-альбомов сдвиг визуальной нумерации так, чтобы
   * первая физическая страница массива стала ПРАВОЙ первого разворота
   * (левая = форзац), а последняя — ЛЕВОЙ последнего (правая = форзац).
   */
  softShift?: boolean
}

const PAGE_THUMB_WIDTH = 96 // одна страница (~140px высоты для книжной пропорции)
const SPREAD_THUMB_WIDTH = 192 // двух-страничный мастер (is_spread)

export default function SpreadOrderStrip({
  spreads,
  templates,
  currentIdx,
  onSelect,
  onReorder,
  onDelete,
  onAddRequest,
  readOnly = false,
  softShift = false,
}: Props) {
  const templateMap = useMemo(() => {
    const map = new Map<string, SpreadTemplate>()
    for (const t of templates) map.set(t.id, t)
    return map
  }, [templates])

  // Сегментация — только для визуальной группировки.
  const visualSpreads = useMemo(
    () => segmentToSpreads(spreads, templateMap, { softShift }),
    [spreads, templateMap, softShift],
  )

  // Активный разворот — pair в котором сейчас currentIdx.
  const currentPairIdx = useMemo(
    () => findVisualSpreadForPage(visualSpreads, currentIdx),
    [visualSpreads, currentIdx],
  )

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  )

  // ID-based sortable: каждая СТРАНИЦА — отдельный sortable item.
  // ID = `page-${spread_index}` стабильное.
  const itemIds = useMemo(
    () => spreads.map((s) => `page-${s.spread_index}`),
    [spreads],
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = spreads.findIndex((s) => `page-${s.spread_index}` === active.id)
    const newIdx = spreads.findIndex((s) => `page-${s.spread_index}` === over.id)
    if (oldIdx === -1 || newIdx === -1) return
    const reordered = arrayMove(spreads, oldIdx, newIdx)
    const renumbered = reordered.map((s, i) => ({ ...s, spread_index: i }))
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

  function handleDeleteSinglePage(pageIdx: number) {
    if (!onDelete) return
    if (
      !confirm(
        `⚠ Удалить ОДНУ страницу?\n\nЭто сдвинет все последующие страницы на одну позицию. Левая страница следующего разворота станет правой текущего, и так далее. Композиция альбома может измениться.\n\nЕсли вы хотите удалить целый разворот (2 страницы), используйте кнопку ✕ в правом верхнем углу карточки.\n\nПродолжить?`,
      )
    ) {
      return
    }
    onDelete([pageIdx])
  }

  function handleDeleteSpread(pageIndices: number[]) {
    if (!onDelete || pageIndices.length === 0) return
    if (!confirm(`Удалить разворот целиком (${pageIndices.length === 1 ? '1 страница' : '2 страницы'})?`)) {
      return
    }
    onDelete(pageIndices)
  }

  return (
    <div className="bg-white border-t border-gray-200 px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-gray-500">
          Развороты ({visualSpreads.length}){' '}
          <span className="text-gray-400">· страниц: {spreads.length}</span>{' '}
          {!readOnly && (
            <span className="text-gray-400">— перетащите страницу чтобы изменить порядок</span>
          )}
        </p>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        autoScroll={{ threshold: { x: 0.2, y: 0 } }}
      >
        <SortableContext items={itemIds} strategy={horizontalListSortingStrategy}>
          <div className="flex gap-2 overflow-x-auto pb-1 items-stretch">
            {visualSpreads.map((pair, pairIdx) => {
              const leftPage =
                pair.leftIdx !== undefined ? spreads[pair.leftIdx] : null
              const rightPage =
                pair.rightIdx !== undefined ? spreads[pair.rightIdx] : null
              const leftTemplate = leftPage ? templateMap.get(leftPage.template_id) : null
              const rightTemplate = rightPage ? templateMap.get(rightPage.template_id) : null
              const pairPageIndices: number[] = []
              if (pair.leftIdx !== undefined) pairPageIndices.push(pair.leftIdx)
              if (
                pair.rightIdx !== undefined &&
                pair.rightIdx !== pair.leftIdx
              ) {
                pairPageIndices.push(pair.rightIdx)
              }
              return (
                <SpreadCard
                  key={`pair-${pairIdx}`}
                  pair={pair}
                  leftPage={leftPage}
                  rightPage={rightPage}
                  leftTemplate={leftTemplate ?? null}
                  rightTemplate={rightTemplate ?? null}
                  position={pairIdx + 1}
                  isActive={pairIdx === currentPairIdx}
                  currentPageIdx={currentIdx}
                  onSelect={onSelect}
                  onDeletePage={!readOnly && onDelete ? handleDeleteSinglePage : undefined}
                  onDeleteSpread={
                    !readOnly && onDelete && spreads.length > pairPageIndices.length
                      ? () => handleDeleteSpread(pairPageIndices)
                      : undefined
                  }
                  disabled={readOnly}
                />
              )
            })}

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

// ─── SpreadCard — карточка-разворот с двумя draggable половинками ────────

function SpreadCard({
  pair,
  leftPage,
  rightPage,
  leftTemplate,
  rightTemplate,
  position,
  isActive,
  currentPageIdx,
  onSelect,
  onDeletePage,
  onDeleteSpread,
  disabled,
}: {
  pair: VisualSpread
  leftPage: SpreadInstance | null
  rightPage: SpreadInstance | null
  leftTemplate: SpreadTemplate | null
  rightTemplate: SpreadTemplate | null
  position: number
  isActive: boolean
  currentPageIdx: number
  onSelect: (idx: number) => void
  onDeletePage?: (pageIdx: number) => void
  onDeleteSpread?: () => void
  disabled: boolean
}) {
  // Является ли разворот двух-страничным мастером (J-Spread)?
  // Тогда обе страницы — это ОДНА запись SpreadInstance с одним
  // spread_index и одним sortable-item. Drag берёт всю карточку.
  const isSpreadMaster = pair.isSpread && pair.leftIdx !== undefined

  return (
    <div
      className={`group flex-shrink-0 relative rounded border-2 transition-colors ${
        isActive
          ? 'border-blue-500 ring-2 ring-blue-200'
          : 'border-gray-200 hover:border-gray-400'
      }`}
      title={`Разворот ${position}`}
    >
      <div className="flex" style={{ width: SPREAD_THUMB_WIDTH }}>
        {isSpreadMaster && leftPage && leftTemplate ? (
          // Spread-мастер: одна draggable страница на всю ширину
          <DraggablePage
            pageIdx={pair.leftIdx!}
            page={leftPage}
            template={leftTemplate}
            width={SPREAD_THUMB_WIDTH}
            isCurrent={currentPageIdx === pair.leftIdx}
            onSelect={onSelect}
            onDeletePage={onDeletePage}
            disabled={disabled}
          />
        ) : (
          <>
            {/* Левая половина */}
            {leftPage && leftTemplate ? (
              <DraggablePage
                pageIdx={pair.leftIdx!}
                page={leftPage}
                template={leftTemplate}
                width={PAGE_THUMB_WIDTH}
                isCurrent={currentPageIdx === pair.leftIdx}
                onSelect={onSelect}
                onDeletePage={onDeletePage}
                disabled={disabled}
              />
            ) : (
              <EmptySideThumb width={PAGE_THUMB_WIDTH} />
            )}
            {/* Разделитель между страницами разворота */}
            <div className="w-px bg-gray-300" />
            {/* Правая половина */}
            {rightPage && rightTemplate ? (
              <DraggablePage
                pageIdx={pair.rightIdx!}
                page={rightPage}
                template={rightTemplate}
                width={PAGE_THUMB_WIDTH}
                isCurrent={currentPageIdx === pair.rightIdx}
                onSelect={onSelect}
                onDeletePage={onDeletePage}
                disabled={disabled}
              />
            ) : (
              <EmptySideThumb width={PAGE_THUMB_WIDTH} />
            )}
          </>
        )}
      </div>

      {/* Номер разворота — в углу */}
      <span
        className={`absolute top-0 left-0 px-1.5 py-0.5 text-[10px] font-medium rounded-br pointer-events-none ${
          isActive ? 'bg-blue-500 text-white' : 'bg-white/90 text-gray-700'
        }`}
      >
        {position}
      </span>

      {/* Кнопка удаления ВСЕГО разворота (видна при hover) */}
      {onDeleteSpread && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDeleteSpread()
          }}
          className="absolute top-0 right-0 w-5 h-5 flex items-center justify-center bg-red-500 text-white rounded-bl opacity-0 group-hover:opacity-100 transition-opacity text-xs hover:bg-red-600"
          title="Удалить разворот целиком"
        >
          ✕
        </button>
      )}
    </div>
  )
}

// ─── DraggablePage — одна draggable страница в карточке-развороте ────────

function DraggablePage({
  pageIdx,
  page,
  template,
  width,
  isCurrent,
  onSelect,
  onDeletePage,
  disabled,
}: {
  pageIdx: number
  page: SpreadInstance
  template: SpreadTemplate
  width: number
  isCurrent: boolean
  onSelect: (idx: number) => void
  onDeletePage?: (pageIdx: number) => void
  disabled: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `page-${page.spread_index}`, disabled })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative group/page overflow-hidden bg-white ${
        isCurrent ? 'ring-1 ring-blue-300' : ''
      }`}
    >
      {/* Drag-handle на всей странице. Click переключает currentIdx. */}
      <div
        {...attributes}
        {...listeners}
        onClick={(e) => {
          e.stopPropagation()
          onSelect(pageIdx)
        }}
        className={disabled ? 'cursor-default' : 'cursor-grab'}
        style={{ width }}
      >
        <AlbumSpreadCanvas
          instance={page}
          template={template}
          containerWidth={width}
          mode="preview"
        />
      </div>

      {/* Маленькая кнопка удаления одной страницы — нижний правый угол.
          Видна при hover именно на странице (group/page). */}
      {onDeletePage && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDeletePage(pageIdx)
          }}
          className="absolute bottom-0 right-0 w-4 h-4 flex items-center justify-center bg-gray-600 text-white rounded-tl opacity-0 group-hover/page:opacity-100 transition-opacity text-[9px] hover:bg-red-600"
          title="Удалить только эту страницу (сместит остальные)"
        >
          –
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
