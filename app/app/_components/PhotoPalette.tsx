'use client'

import { useMemo, useState } from 'react'
import type { SpreadInstance } from '@/lib/album-builder/types'

// ─── Тип AlbumPhoto (соответствует /api/tenant?action=album_photos) ──────
// Дубликат из app/app/album/[id]/layout/page.tsx — оба файла должны
// держать тип в синхроне. Альтернатива: вынести в общий types.ts при
// появлении третьего consumer'а.
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
  return (
    <div
      className="relative aspect-[3/4] bg-gray-100 rounded overflow-hidden border border-gray-200 hover:ring-2 hover:ring-blue-300 transition cursor-default"
      title={photo.filename}
    >
      <img
        src={photo.thumb_url}
        alt={photo.filename}
        loading="lazy"
        className="w-full h-full object-cover"
        onError={(e) => {
          // Битая картинка → серая заливка с filename как fallback
          ;(e.target as HTMLImageElement).style.display = 'none'
        }}
      />
      <UsageBadge usage={usage} />
      {/* Filename overlay при hover */}
      <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1 text-[10px] bg-black/60 text-white opacity-0 hover:opacity-100 transition truncate">
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

// ═════════════════════════════════════════════════════════════════════════
// PhotoPalette — правая панель редактора со всеми фото альбома (2.6.2).
//
// В подэтапе 2.6.2 — read-only отображение: миниатюры, поиск, фильтр
// по originals, бейджи использования. Drag-and-drop появится в 2.6.3.
// ═════════════════════════════════════════════════════════════════════════
export default function PhotoPalette({ spreads, photos }: Props) {
  const [query, setQuery] = useState('')
  const [showOriginals, setShowOriginals] = useState(false)

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

  // Группировка по source/type.
  const portraits = filtered.filter(
    (p) => p.source === 'selections' && p.type === 'portrait',
  )
  const groups = filtered.filter(
    (p) => p.source === 'selections' && p.type === 'group',
  )
  const teachers = filtered.filter(
    (p) => p.source === 'selections' && p.type === 'teacher',
  )
  const originals = filtered.filter((p) => p.source === 'originals')

  // Счётчик originals по полному пулу (не filtered) — для лейбла checkbox'а.
  const totalOriginals = photos.filter((p) => p.source === 'originals').length

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
        {totalOriginals > 0 && (
          <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer mt-2">
            <input
              type="checkbox"
              checked={showOriginals}
              onChange={(e) => setShowOriginals(e.target.checked)}
              className="accent-blue-600"
            />
            Показать оригиналы ({totalOriginals})
          </label>
        )}
      </div>

      <div className="p-3">
        {filtered.length === 0 ? (
          <p className="text-xs text-gray-500 text-center py-8">
            {query ? 'Ничего не найдено' : 'Нет фото в альбоме'}
          </p>
        ) : (
          <>
            <Section title="Портреты" photos={portraits} usageMap={usageMap} />
            <Section title="Группы" photos={groups} usageMap={usageMap} />
            <Section title="Учителя" photos={teachers} usageMap={usageMap} />
            {showOriginals && (
              <Section
                title="Оригиналы"
                photos={originals}
                usageMap={usageMap}
              />
            )}
          </>
        )}
      </div>
    </aside>
  )
}
