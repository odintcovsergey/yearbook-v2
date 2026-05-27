'use client'

import { useMemo, useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import type { SpreadInstance } from '@/lib/album-builder/types'

// ─── Тип AlbumPhoto (соответствует /api/tenant?action=album_photos) ──────
// Дубликат из app/app/album/[id]/layout/page.tsx — оба файла должны
// держать тип в синхроне. Альтернатива: вынести в общий types.ts при
// появлении третьего consumer'а.
//
// РЭ.54.e: расширен на все 8 категорий из API. До этого знали только
// portrait/group/teacher и общие фото 'common_*' были смешаны в null
// или общем 'group' табе. См. /api/tenant?action=album_photos в
// app/api/tenant/route.ts — `type` оттуда уже отдаёт все варианты.
type AlbumPhoto = {
  id: string
  filename: string
  storage_path: string
  thumb_path: string | null
  type:
    | 'portrait'
    | 'group'
    | 'teacher'
    | 'common_spread'
    | 'common_full'
    | 'common_half'
    | 'common_quarter'
    | 'common_sixth'
    | 'common_collage'
    | null
  source: 'selections' | 'originals'
  child_ids: string[]
  teacher_ids: string[]
  selection_types: string[]
  url: string
  thumb_url: string
  created_at: string
}

type Props = {
  spreads: SpreadInstance[]
  photos: AlbumPhoto[]
}

// ─── Найти все spread_index'ы где фото используется ──────────────────────
function findUsage(
  photo: AlbumPhoto,
  spreads: SpreadInstance[],
): number[] {
  const used: number[] = []
  for (const spread of spreads) {
    if (Object.values(spread.data).some((v) => v === photo.url)) {
      used.push(spread.spread_index)
    }
  }
  return used
}

// ─── Бейдж использования ──────────────────────────────────────────────────
function UsageBadge({ usage }: { usage: number[] }) {
  if (usage.length === 0) return null
  const text = usage.length === 1
    ? `✓ ${usage[0] + 1}`
    : usage.length === 2
    ? `✓ ${usage[0] + 1}, ${usage[1] + 1}`
    : `✓ ×${usage.length}`
  return (
    <div className="absolute top-1 right-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-600 text-white shadow">
      {text}
    </div>
  )
}

// ─── Миниатюра одного фото ────────────────────────────────────────────────
function PhotoTile({
  photo,
  usage,
}: {
  photo: AlbumPhoto
  usage: number[]
}) {
  // useDraggable: id=photo.id, data содержит сам photo чтобы handleDragEnd
  // мог сразу взять url без поиска по id.
  const { attributes, listeners, setNodeRef, isDragging } =
    useDraggable({
      id: photo.id,
      data: { type: 'palette', photo },
    })
  // transform из useDraggable не используем: визуал drag'а рендерится
  // в <DragOverlay> в LayoutEditorPage (см. 2.6.3.1).

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`relative aspect-[3/4] bg-gray-100 rounded overflow-hidden border border-gray-200 hover:ring-2 hover:ring-blue-300 transition cursor-grab active:cursor-grabbing ${
        isDragging ? 'opacity-40' : ''
      }`}
      title={photo.filename}
    >
      <img
        src={photo.thumb_url}
        alt={photo.filename}
        loading="lazy"
        draggable={false}
        className="w-full h-full object-cover pointer-events-none"
        onError={(e) => {
          // Битая картинка → серая заливка с filename как fallback
          ;(e.target as HTMLImageElement).style.display = 'none'
        }}
      />
      <UsageBadge usage={usage} />
      {/* Filename overlay при hover */}
      <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1 text-[10px] bg-black/60 text-white opacity-0 hover:opacity-100 transition truncate pointer-events-none">
        {photo.filename}
      </div>
    </div>
  )
}

// ─── Секция (заголовок + grid) ────────────────────────────────────────────
function Section({
  title,
  photos,
  usageMap,
}: {
  title: string
  photos: AlbumPhoto[]
  usageMap: Map<string, number[]>
}) {
  if (photos.length === 0) return null
  return (
    <div className="mb-4">
      <h3 className="text-xs font-semibold text-gray-700 mb-2 sticky top-[88px] bg-white py-1 z-[5]">
        {title} ({photos.length})
      </h3>
      <div className="grid grid-cols-3 gap-2">
        {photos.map((p) => (
          <PhotoTile key={p.id} photo={p} usage={usageMap.get(p.id) ?? []} />
        ))}
      </div>
    </div>
  )
}

// РЭ.54.c/e: табы по категориям фото.
// 'all' рендерит все секции под общим заголовком (текущий вид).
// Конкретный таб — только эту категорию (без заголовка секции).
type PaletteTab =
  | 'all'
  | 'portrait'
  | 'group'
  | 'teacher'
  | 'common_spread'
  | 'common_full'
  | 'common_half'
  | 'common_quarter'
  | 'common_sixth'
  | 'common_collage'
  | 'originals'

// Лейблы повторяют названия из /app/album/[id]/photos
// (страница загрузки фото — там партнёр выбирает категорию для каждого
// файла). Если переименуем там — здесь нужно синхронить.
const TAB_LABELS: Record<PaletteTab, string> = {
  all: 'Все',
  portrait: 'Портреты',
  group: 'Группы',
  teacher: 'Учителя',
  common_spread: 'На разворот',
  common_full: 'Класс',
  common_half: 'Полкласса',
  common_quarter: '1/4',
  common_sixth: '1/6',
  common_collage: 'Коллаж',
  originals: 'Оригиналы',
}

// ═════════════════════════════════════════════════════════════════════════
// PhotoPalette — правая панель редактора со всеми фото альбома (2.6.2).
//
// В подэтапе 2.6.2 — read-only отображение: миниатюры, поиск, фильтр
// по originals, бейджи использования. Drag-and-drop появится в 2.6.3.
//
// РЭ.54.c: добавлены табы по категориям. Раньше всё рендерилось одним
// длинным столбиком с заголовками секций — для альбома с 25 учениками
// (~37 портретов) экран забивался портретами и приходилось скроллить
// чтобы добраться до групповых/учителей. Теперь партнёр может выбрать
// 'Групповые' и видеть только их.
// ═════════════════════════════════════════════════════════════════════════
export default function PhotoPalette({ spreads, photos }: Props) {
  const [query, setQuery] = useState('')
  const [activeTab, setActiveTab] = useState<PaletteTab>('all')

  // Карта использования для O(1) lookup'а в каждой миниатюре.
  const usageMap = useMemo(() => {
    const m = new Map<string, number[]>()
    for (const p of photos) {
      m.set(p.id, findUsage(p, spreads))
    }
    return m
  }, [photos, spreads])

  // Фильтр по запросу (clientside).
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return photos
    return photos.filter((p) => p.filename.toLowerCase().includes(q))
  }, [photos, query])

  // Группировка по source/type + сортировка по filename внутри каждой
  // группы (DSC_xxxx.jpg → лексический порядок, см. 2.6.4.1).
  const byFilename = (a: AlbumPhoto, b: AlbumPhoto) =>
    a.filename.localeCompare(b.filename)

  const portraits = filtered
    .filter((p) => p.source === 'selections' && p.type === 'portrait')
    .sort(byFilename)
  const groups = filtered
    .filter((p) => p.source === 'selections' && p.type === 'group')
    .sort(byFilename)
  const teachers = filtered
    .filter((p) => p.source === 'selections' && p.type === 'teacher')
    .sort(byFilename)
  // РЭ.54.e: общий раздел альбома — 5 подкатегорий из /album/[id]/photos.
  const commonSpread = filtered
    .filter((p) => p.source === 'selections' && p.type === 'common_spread')
    .sort(byFilename)
  const commonFull = filtered
    .filter((p) => p.source === 'selections' && p.type === 'common_full')
    .sort(byFilename)
  const commonHalf = filtered
    .filter((p) => p.source === 'selections' && p.type === 'common_half')
    .sort(byFilename)
  const commonQuarter = filtered
    .filter((p) => p.source === 'selections' && p.type === 'common_quarter')
    .sort(byFilename)
  const commonSixth = filtered
    .filter((p) => p.source === 'selections' && p.type === 'common_sixth')
    .sort(byFilename)
  const commonCollage = filtered
    .filter((p) => p.source === 'selections' && p.type === 'common_collage')
    .sort(byFilename)
  const originals = filtered
    .filter((p) => p.source === 'originals')
    .sort(byFilename)

  // Счётчики ПО ПОЛНОМУ ПУЛУ (не filtered) — чтобы лейбл таба показывал
  // сколько всего фото в категории, независимо от поиска.
  const counts = useMemo(() => {
    const byType = (typeFilter: AlbumPhoto['type']) =>
      photos.filter((x) => x.source === 'selections' && x.type === typeFilter).length
    const p = byType('portrait')
    const g = byType('group')
    const t = byType('teacher')
    const cs = byType('common_spread')
    const cf = byType('common_full')
    const ch = byType('common_half')
    const cq = byType('common_quarter')
    const cx = byType('common_sixth')
    const cc = byType('common_collage')
    const o = photos.filter((x) => x.source === 'originals').length
    return {
      portrait: p,
      group: g,
      teacher: t,
      common_spread: cs,
      common_full: cf,
      common_half: ch,
      common_quarter: cq,
      common_sixth: cx,
      common_collage: cc,
      originals: o,
      all: p + g + t + cs + cf + ch + cq + cx + cc + o,
    }
  }, [photos])

  // РЭ.54.e: список табов с count > 0 (плюс 'all' всегда).
  // Пустые табы скрываем — не загромождаем UI категориями без фото.
  // Если партнёр не загружал 'фото 1/4 класса' — таб не появится.
  const visibleTabs: PaletteTab[] = ['all']
  for (const tab of [
    'portrait',
    'group',
    'teacher',
    'common_spread',
    'common_full',
    'common_half',
    'common_quarter',
    'common_sixth',
    'common_collage',
    'originals',
  ] as const) {
    if (counts[tab] > 0) visibleTabs.push(tab)
  }

  return (
    <aside className="w-[30%] min-w-[300px] max-w-[440px] bg-white border-l border-gray-200 overflow-y-auto">
      <div className="p-3 sticky top-0 bg-white z-10 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-900 mb-2">
          Палитра фото
        </h2>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по имени файла…"
          className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
        {/* РЭ.54.c: табы по категориям. */}
        <div className="flex flex-wrap gap-1 mt-2">
          {visibleTabs.map((tab) => {
            const isActive = activeTab === tab
            const count = counts[tab]
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`px-2 py-1 text-[11px] rounded border transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {TAB_LABELS[tab]} <span className={isActive ? 'opacity-90' : 'text-gray-400'}>({count})</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="p-3">
        {filtered.length === 0 ? (
          <p className="text-xs text-gray-500 text-center py-8">
            {query ? 'Ничего не найдено' : 'Нет фото в альбоме'}
          </p>
        ) : activeTab === 'all' ? (
          // РЭ.54.c/e: вкладка 'Все' — секции одна под другой.
          // Каждая секция рендерится только если в ней есть фото
          // (Section сам возвращает null для пустого массива).
          <>
            <Section title="Портреты" photos={portraits} usageMap={usageMap} />
            <Section title="Группы" photos={groups} usageMap={usageMap} />
            <Section title="Учителя" photos={teachers} usageMap={usageMap} />
            <Section title="На разворот" photos={commonSpread} usageMap={usageMap} />
            <Section title="Класс" photos={commonFull} usageMap={usageMap} />
            <Section title="Полкласса" photos={commonHalf} usageMap={usageMap} />
            <Section title="1/4 класса" photos={commonQuarter} usageMap={usageMap} />
            <Section title="1/6 класса" photos={commonSixth} usageMap={usageMap} />
            <Section title="Оригиналы" photos={originals} usageMap={usageMap} />
          </>
        ) : (
          // Конкретный таб — только эта категория, без заголовка-плашки.
          (() => {
            const tabPhotos = (() => {
              switch (activeTab) {
                case 'portrait': return portraits
                case 'group': return groups
                case 'teacher': return teachers
                case 'common_spread': return commonSpread
                case 'common_full': return commonFull
                case 'common_half': return commonHalf
                case 'common_quarter': return commonQuarter
                case 'common_sixth': return commonSixth
                case 'common_collage': return commonCollage
                case 'originals': return originals
                default: return []
              }
            })()
            return (
              <div className="grid grid-cols-3 gap-2">
                {tabPhotos.map((p) => (
                  <PhotoTile key={p.id} photo={p} usage={usageMap.get(p.id) ?? []} />
                ))}
              </div>
            )
          })()
        )}
      </div>
    </aside>
  )
}
