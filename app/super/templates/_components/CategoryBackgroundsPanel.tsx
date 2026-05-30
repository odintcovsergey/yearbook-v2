'use client'

// ─── CategoryBackgroundsPanel ─────────────────────────────────────────────
//
// Этап 4 системы категорийных фонов. Super-admin загружает пул фонов по
// категориям (intro / teacher / student / student_grid / common / final /
// cover). Внутри категории фоны крутятся по кругу (ротация) — порядок задаётся
// перетаскиванием (sort_order).
//
// Самодостаточный компонент: сам грузит /api/super/template-sets/[id]/backgrounds
// и сам шлёт upload/reorder/set_side/delete. Список категорий берётся из
// единого источника lib/backgrounds/page-role-to-category (тот же, что использует
// движок выбора фона), поэтому добавление категории = правка одного места.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import {
  BACKGROUND_CATEGORIES,
  BACKGROUND_CATEGORY_LABELS,
} from '@/lib/backgrounds/page-role-to-category'
import { supabaseBrowser } from '@/lib/supabase-browser'

const BUCKET = 'template-backgrounds'
const MAX_SIZE = 50 * 1024 * 1024 // 50 МБ — совпадает с лимитом bucket'а

type Bg = {
  id: string
  category: string
  url: string
  sort_order: number
  side: string
  public_url: string
}

type Props = {
  templateSetId: string
}

const SIDES: Array<{ value: string; label: string }> = [
  { value: 'spread', label: 'разворот' },
  { value: 'left', label: 'левая' },
  { value: 'right', label: 'правая' },
  { value: 'any', label: 'любая' },
]

export default function CategoryBackgroundsPanel({ templateSetId }: Props) {
  const [backgrounds, setBackgrounds] = useState<Bg[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const base = `/api/super/template-sets/${templateSetId}/backgrounds`

  const reload = useCallback(async () => {
    setError(null)
    try {
      const r = await fetch(base, { credentials: 'include' })
      const data = await r.json()
      if (!r.ok) {
        setError(data.error ?? `Ошибка загрузки (HTTP ${r.status})`)
        return
      }
      setBackgrounds(data.backgrounds as Bg[])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Сетевая ошибка')
    } finally {
      setLoading(false)
    }
  }, [base])

  useEffect(() => {
    reload()
  }, [reload])

  // Группировка по категориям (в порядке прихода — уже отсортировано API).
  const byCategory = useMemo(() => {
    const map = new Map<string, Bg[]>()
    for (const cat of BACKGROUND_CATEGORIES) map.set(cat, [])
    for (const bg of backgrounds) {
      if (!map.has(bg.category)) map.set(bg.category, [])
      map.get(bg.category)!.push(bg)
    }
    return map
  }, [backgrounds])

  return (
    <div className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
      <h3 className="font-medium text-sm mb-1">Категорийные фоны (ротация)</h3>
      <p className="text-xs text-gray-500 mb-4">
        Несколько фонов на раздел — движок подставляет их по роли страницы и
        крутит по кругу внутри раздела. Порядок ротации задаётся перетаскиванием.
        Если в категории пусто — используется общий фон набора выше.
        JPG/PNG до 50 МБ, размер под разворот.
      </p>

      {error && <div className="mb-3 text-sm text-red-600">{error}</div>}

      {loading ? (
        <div className="text-sm text-gray-400">Загрузка…</div>
      ) : (
        <div className="space-y-5">
          {BACKGROUND_CATEGORIES.map((cat) => (
            <CategorySection
              key={cat}
              category={cat}
              label={BACKGROUND_CATEGORY_LABELS[cat]}
              items={byCategory.get(cat) ?? []}
              base={base}
              onChanged={reload}
              onError={setError}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── CategorySection ──────────────────────────────────────────────────────
// Одна категория: заголовок, сортируемый ряд миниатюр, зона загрузки.

function CategorySection({
  category,
  label,
  items,
  base,
  onChanged,
  onError,
}: {
  category: string
  label: string
  items: Bg[]
  base: string
  onChanged: () => void
  onError: (msg: string | null) => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  // Локальный порядок для мгновенного отклика dnd до ответа сервера.
  const [order, setOrder] = useState<Bg[]>(items)

  // Синхронизируем локальный порядок при изменении входных items.
  useEffect(() => {
    setOrder(items)
  }, [items])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const ids = useMemo(() => order.map((b) => b.id), [order])

  const upload = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      onError(null)

      // Клиентская валидация до запроса подписи.
      for (const f of files) {
        if (!['image/jpeg', 'image/png'].includes(f.type)) {
          onError('Допустимы только JPG и PNG')
          return
        }
        if (f.size > MAX_SIZE) {
          onError('Файл больше 50 МБ')
          return
        }
      }

      setUploading(true)
      try {
        // Шаг 1 — попросить у сервера подписанные ссылки на загрузку.
        const signRes = await fetch(base, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'sign',
            category,
            files: files.map((f) => ({ ext: f.type === 'image/png' ? 'png' : 'jpg' })),
          }),
        })
        const signData = await signRes.json().catch(() => ({}))
        if (!signRes.ok) {
          onError(signData.error ?? `Ошибка подписи (HTTP ${signRes.status})`)
          return
        }
        const uploads: Array<{ path: string; token: string }> = signData.uploads

        // Шаг 2 — залить файлы НАПРЯМУЮ в Storage (мимо нашего сервера,
        // поэтому лимит тела Vercel не действует).
        for (let i = 0; i < files.length; i++) {
          const { path, token } = uploads[i]
          const { error: upErr } = await supabaseBrowser.storage
            .from(BUCKET)
            .uploadToSignedUrl(path, token, files[i], { contentType: files[i].type })
          if (upErr) {
            onError(`Не удалось загрузить файл: ${upErr.message}`)
            return
          }
        }

        // Шаг 3 — зафиксировать записи в БД.
        const commitRes = await fetch(base, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'commit',
            category,
            paths: uploads.map((u) => u.path),
          }),
        })
        const commitData = await commitRes.json().catch(() => ({}))
        if (!commitRes.ok) {
          onError(commitData.error ?? `Ошибка сохранения (HTTP ${commitRes.status})`)
          return
        }
        onChanged()
      } catch (e) {
        onError(e instanceof Error ? e.message : 'Сетевая ошибка')
      } finally {
        setUploading(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    },
    [base, category, onChanged, onError],
  )

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = order.findIndex((b) => b.id === active.id)
    const newIdx = order.findIndex((b) => b.id === over.id)
    if (oldIdx === -1 || newIdx === -1) return
    const next = arrayMove(order, oldIdx, newIdx)
    setOrder(next) // мгновенно
    try {
      const r = await fetch(base, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reorder', category, ids: next.map((b) => b.id) }),
      })
      if (!r.ok) {
        const data = await r.json().catch(() => ({}))
        onError(data.error ?? 'Не удалось сохранить порядок')
        onChanged() // откат к серверному состоянию
      }
    } catch {
      onError('Сетевая ошибка при сохранении порядка')
      onChanged()
    }
  }

  async function changeSide(id: string, side: string) {
    onError(null)
    try {
      const r = await fetch(base, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_side', id, side }),
      })
      if (!r.ok) {
        const data = await r.json().catch(() => ({}))
        onError(data.error ?? 'Не удалось изменить сторону')
      }
      onChanged()
    } catch {
      onError('Сетевая ошибка')
    }
  }

  async function remove(id: string) {
    if (!confirm('Удалить этот фон?')) return
    onError(null)
    try {
      const r = await fetch(`${base}?bg=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!r.ok) {
        const data = await r.json().catch(() => ({}))
        onError(data.error ?? 'Не удалось удалить')
        return
      }
      onChanged()
    } catch {
      onError('Сетевая ошибка')
    }
  }

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-sm font-medium text-gray-800">{label}</span>
        <span className="text-xs text-gray-400">
          {order.length > 0 ? `${order.length} фон(ов)` : 'пусто'}
        </span>
      </div>

      <div className="flex items-start gap-2 flex-wrap">
        {order.length > 0 && (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
              <div className="flex items-start gap-2 flex-wrap">
                {order.map((bg, i) => (
                  <SortableThumb
                    key={bg.id}
                    bg={bg}
                    position={i + 1}
                    onChangeSide={(side) => changeSide(bg.id, side)}
                    onDelete={() => remove(bg.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        {/* Зона загрузки */}
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            const files = Array.from(e.dataTransfer.files).filter((f) =>
              ['image/jpeg', 'image/png'].includes(f.type),
            )
            upload(files)
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`w-28 h-20 flex flex-col items-center justify-center text-center rounded border border-dashed cursor-pointer text-xs transition-colors ${
            dragOver
              ? 'border-blue-400 bg-blue-50 text-blue-600'
              : 'border-gray-300 bg-white text-gray-400 hover:border-blue-400 hover:text-blue-500'
          }`}
        >
          {uploading ? 'Загружаю…' : (
            <>
              <span className="text-lg leading-none">+</span>
              <span>перетащите<br />или выберите</span>
            </>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            upload(files)
          }}
        />
      </div>
    </div>
  )
}

// ─── SortableThumb ────────────────────────────────────────────────────────
// Миниатюра одного фона: drag-сортировка, выбор стороны, удаление.

function SortableThumb({
  bg,
  position,
  onChangeSide,
  onDelete,
}: {
  bg: Bg
  position: number
  onChangeSide: (side: string) => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: bg.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="relative w-28 border border-gray-200 rounded bg-white overflow-hidden"
    >
      {/* Превью + drag-handle (вся картинка тянется) */}
      <div
        {...attributes}
        {...listeners}
        className="relative h-20 bg-gray-100 cursor-grab active:cursor-grabbing"
        title="Перетащите для изменения порядка ротации"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={bg.public_url}
          alt={`${bg.category} фон ${position}`}
          className="w-full h-full object-cover pointer-events-none"
        />
        <span className="absolute top-0.5 left-0.5 text-[10px] bg-black/55 text-white rounded px-1">
          {position}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute top-0.5 right-0.5 w-5 h-5 flex items-center justify-center text-white bg-black/55 hover:bg-red-600 rounded text-sm leading-none"
          title="Удалить фон"
          aria-label="Удалить"
        >
          ×
        </button>
      </div>

      {/* Сторона */}
      <select
        value={bg.side}
        onChange={(e) => onChangeSide(e.target.value)}
        onPointerDown={(e) => e.stopPropagation()}
        className="w-full text-[11px] border-t border-gray-200 px-1 py-0.5 bg-white text-gray-600 focus:outline-none"
        title="На какой части разворота применять фон"
      >
        {SIDES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  )
}
