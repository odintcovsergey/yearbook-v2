'use client'

import { useMemo, useState } from 'react'
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
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { SpreadTemplate } from '@/lib/album-builder/types'
import JMasterPicker from './JMasterPicker'

// ─── CommonRequiredPagesEditor ────────────────────────────────────────────
//
// РЭ.32.Б.2 — Конструктор списка страниц общего раздела в редакторе шаблона.
//
// Партнёр видит упорядоченный список страниц общего раздела (по умолчанию
// пустой). Каждая страница — это запись { master_name: string } которая
// при сборке альбома превратится в реальный page_instance с тем мастером.
//
// Операции:
//   • + Добавить страницу → открыть JMasterPicker, выбор → запись в конец
//   • Drag-n-drop вертикально → переупорядочивание
//   • × у каждой страницы → удалить эту запись
//
// Engine при сборке альбома проходит список и для каждой записи кладёт
// страницу с указанным мастером. Если мастер не найден в template_set
// (например после смены template_set'а пресета) — engine выдаёт warning.
//
// ВАЖНО: компонент UI-only. Не делает API-запросов сам — отдаёт изменения
// через onChange callback. Родительский PresetEditorModal сохраняет
// изменения в section_structure целиком вместе со всем пресетом.

export interface CommonRequiredPage {
  master_name: string
}

type Props = {
  /** Текущий упорядоченный список страниц. */
  pages: CommonRequiredPage[]
  /** Доступные мастера template_set'а (передаются из PresetEditorModal). */
  templates: SpreadTemplate[]
  /** Колбэк изменения — родитель применяет новый массив. */
  onChange: (pages: CommonRequiredPage[]) => void
  /** Заблокировать редактирование (например при сохранении). */
  disabled?: boolean
}

/**
 * Стабильный ID для drag-n-drop. master_name не уникален (можно положить
 * 5 раз подряд J-Full), поэтому генерируем синтетический индекс ID.
 *
 * При reorder/delete ID меняются — это нормально, @dnd-kit перерисует.
 */
function pageId(index: number, page: CommonRequiredPage): string {
  return `page-${index}-${page.master_name}`
}

export default function CommonRequiredPagesEditor({
  pages,
  templates,
  onChange,
  disabled = false,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false)

  // Map для быстрого поиска мастера по имени (для рендера каждой страницы).
  const templateByName = useMemo(() => {
    const m = new Map<string, SpreadTemplate>()
    for (const t of templates) m.set(t.name, t)
    return m
  }, [templates])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  )

  const itemIds = useMemo(
    () => pages.map((p, i) => pageId(i, p)),
    [pages],
  )

  function handleAdd(template: SpreadTemplate) {
    onChange([...pages, { master_name: template.name }])
  }

  function handleDelete(index: number) {
    onChange(pages.filter((_, i) => i !== index))
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = pages.findIndex((p, i) => pageId(i, p) === active.id)
    const newIdx = pages.findIndex((p, i) => pageId(i, p) === over.id)
    if (oldIdx === -1 || newIdx === -1) return
    onChange(arrayMove(pages, oldIdx, newIdx))
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500">
        Партнёрам этого шаблона при автосборке общий раздел будет собираться
        строго по этому списку. Если каких-то фотографий клиента не хватит —
        engine пропустит страницу с предупреждением (партнёр сможет удалить
        страницу или загрузить ещё фото).
      </p>

      {pages.length === 0 ? (
        <div className="text-sm text-gray-400 text-center py-6 border border-dashed border-gray-300 rounded">
          Общий раздел пуст. Добавьте страницы кнопкой ниже.
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
            <ul className="space-y-1">
              {pages.map((p, idx) => {
                const template = templateByName.get(p.master_name) ?? null
                return (
                  <SortablePageRow
                    key={pageId(idx, p)}
                    id={pageId(idx, p)}
                    position={idx + 1}
                    page={p}
                    template={template}
                    onDelete={() => handleDelete(idx)}
                    disabled={disabled}
                  />
                )
              })}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        disabled={disabled}
        className="w-full px-3 py-2 text-sm border border-dashed border-gray-300 hover:border-blue-400 hover:bg-blue-50/30 rounded text-gray-500 hover:text-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        + Добавить страницу общего раздела
      </button>

      {pickerOpen && (
        <JMasterPicker
          templates={templates}
          onSelect={handleAdd}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}

// ─── SortablePageRow ──────────────────────────────────────────────────────
// Одна строка списка с drag-handle и кнопкой удалить.

type RowProps = {
  id: string
  position: number
  page: CommonRequiredPage
  template: SpreadTemplate | null
  onDelete: () => void
  disabled: boolean
}

function SortablePageRow({ id, position, page, template, onDelete, disabled }: RowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  // Описание содержимого мастера (по placeholders) — короткий ярлык.
  const summary = useMemo(() => {
    if (!template) return 'мастер не найден в текущем дизайне'
    let halfCount = 0
    let quarterCount = 0
    let collageCount = 0
    let hasFull = false
    let hasSpread = false
    for (const ph of template.placeholders ?? []) {
      const l = ph.label.toLowerCase()
      if (l === 'classphotoframe') hasFull = true
      else if (l.match(/^halfphoto_\d+$/)) halfCount++
      else if (l.match(/^quarterphoto_\d+$/)) quarterCount++
      else if (l.match(/^collagephoto_\d+$/)) collageCount++
      else if (l === 'spreadphoto') hasSpread = true
    }
    if (hasSpread) return 'на разворот'
    if (collageCount > 0) return `${collageCount} коллаж`
    if (quarterCount > 0) return `${quarterCount} × 1/4`
    if (halfCount > 0) return `${halfCount} × 1/2`
    if (hasFull) return '1 общая'
    return 'прочее'
  }, [template])

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 px-3 py-2 bg-white border rounded ${
        template === null
          ? 'border-amber-300 bg-amber-50/40'
          : 'border-gray-200'
      }`}
    >
      {/* Drag handle */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        disabled={disabled}
        className="text-gray-300 hover:text-gray-600 cursor-grab disabled:cursor-not-allowed"
        title="Перетащите для изменения порядка"
        aria-label="Drag handle"
      >
        ⋮⋮
      </button>

      {/* Position */}
      <span className="text-xs text-gray-400 w-6 flex-shrink-0">{position}.</span>

      {/* Master name + summary */}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-gray-900 truncate">{page.master_name}</div>
        <div
          className={`text-xs truncate ${
            template === null ? 'text-amber-700' : 'text-gray-500'
          }`}
        >
          {summary}
        </div>
      </div>

      {/* Delete */}
      <button
        type="button"
        onClick={onDelete}
        disabled={disabled}
        className="text-gray-400 hover:text-red-600 text-lg leading-none px-1 disabled:opacity-50 disabled:cursor-not-allowed"
        title="Удалить страницу"
        aria-label="Удалить"
      >
        ×
      </button>
    </li>
  )
}
