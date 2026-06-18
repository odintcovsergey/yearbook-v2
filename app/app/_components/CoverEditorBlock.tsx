'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { BookImage, X } from 'lucide-react'
import { layoutCover } from '@/lib/cover/layout'
import { renderCoverPreviewSvg } from '@/lib/cover/preview-svg'
import type { RenderPlaceholder } from '@/lib/album-builder/types'
import type { CropHandlers } from './AlbumSpreadCanvas'
import type { CoverCanvasMaster } from './CoverCanvas'

const CoverCanvas = dynamic(() => import('./CoverCanvas'), { ssr: false, loading: () => null })

type CoverType = 'portrait_photo' | 'common_photo' | 'design_only'
type Master = CoverCanvasMaster
type Item = {
  key: string
  child_id: string | null
  child_name: string | null
  cover_id: string | null
  cover_type: CoverType
  cover_name: string | null
  has_cover: boolean
  master: Master | null
  data: Record<string, string | null>
  base: Record<string, string | null>
}
type EditorData = {
  items: Item[]
  spine_width_mm: number | null
  editsByType: Record<string, Record<string, string | null>>
  editsByChild: Record<string, Record<string, string | null>>
  common_photos: Array<{ id: string; url: string }>
  warnings: string[]
}

const TYPE_LABEL: Record<CoverType, string> = {
  portrait_photo: 'Портрет', common_photo: 'Общая', design_only: 'Дизайн',
}

function num(v: number | null): number { return typeof v === 'number' && Number.isFinite(v) ? v : 0 }

/** Миниатюра обложки (SVG, как в превью): фон+слоты+декор, пустые скрыты. */
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

export default function CoverEditorBlock({ albumId }: { albumId: string }) {
  const [data, setData] = useState<EditorData | null>(null)
  const [loading, setLoading] = useState(true)
  const [openKey, setOpenKey] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/tenant?action=cover_editor&album_id=${albumId}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: EditorData | null) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [albumId])

  useEffect(() => { load() }, [load])

  if (loading) return null
  if (!data || data.items.length === 0) return null

  const openItem = data.items.find((i) => i.key === openKey) ?? null

  return (
    <div className="bg-muted rounded-xl p-4 mb-6">
      <div className="flex items-center gap-2 text-sm font-medium mb-1">
        <BookImage size={16} /> Редактор обложек
      </div>
      <div className="text-xs text-muted-foreground mb-3">
        Все обложки заказа. Клик — открыть холст: кроп фото (у портретных — индивидуально по ученику),
        тексты, замена общего фото. Стили/шрифты/фон — в следующем обновлении.
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {data.items.map((item) => (
          <button
            key={item.key}
            type="button"
            className="text-left border border-border rounded-lg p-2 bg-card hover:ring-2 hover:ring-brand-200 disabled:opacity-50"
            disabled={!item.has_cover}
            onClick={() => setOpenKey(item.key)}
          >
            <div className="w-full bg-muted rounded overflow-hidden mb-1" style={{ aspectRatio: '3 / 2' }}
              dangerouslySetInnerHTML={{ __html: itemSvg(item, data.spine_width_mm) }} />
            <div className="text-xs font-medium truncate">{item.child_name ?? TYPE_LABEL[item.cover_type]}</div>
            <div className="text-[11px] text-muted-foreground">
              {TYPE_LABEL[item.cover_type]}{item.child_name ? '' : ' · одна на всех'}
            </div>
          </button>
        ))}
      </div>

      {openItem && openItem.master && (
        <CoverEditorModal
          albumId={albumId}
          item={openItem}
          initialTypePatch={data.editsByType[openItem.cover_type] ?? {}}
          initialStudentPatch={openItem.child_id ? (data.editsByChild[openItem.child_id] ?? {}) : {}}
          spineWidthMm={data.spine_width_mm}
          commonPhotos={data.common_photos}
          onClose={() => { setOpenKey(null); load() }}
        />
      )}
    </div>
  )
}

// ─── Модалка холста одной обложки ───────────────────────────────────────────

function CoverEditorModal({
  albumId, item, initialTypePatch, initialStudentPatch, spineWidthMm, commonPhotos, onClose,
}: {
  albumId: string
  item: Item
  initialTypePatch: Record<string, string | null>
  initialStudentPatch: Record<string, string | null>
  spineWidthMm: number | null
  commonPhotos: Array<{ id: string; url: string }>
  onClose: () => void
}) {
  const [typePatch, setTypePatch] = useState<Record<string, string | null>>(initialTypePatch)
  const [studentPatch, setStudentPatch] = useState<Record<string, string | null>>(initialStudentPatch)
  const [editingTextLabel, setEditingTextLabel] = useState<string | null>(null)
  const [cropLabel, setCropLabel] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const wrapRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(820)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => setContainerWidth(Math.max(320, el.clientWidth))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const data = { ...item.base, ...typePatch, ...studentPatch }
  const hasCommon = (item.master?.placeholders ?? []).some((p) => p.label === 'cover_common_photo')

  // Дебаунс-сохранение по области.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const persist = useCallback((scope: 'type' | 'student', patch: Record<string, string | null>) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setSaving(true)
    saveTimer.current = setTimeout(async () => {
      const body = scope === 'type'
        ? { action: 'cover_save_edit', album_id: albumId, scope, cover_type: item.cover_type, data: patch }
        : { action: 'cover_save_edit', album_id: albumId, scope, child_id: item.child_id, data: patch }
      try {
        await fetch('/api/tenant', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      } finally { setSaving(false) }
    }, 700)
  }, [albumId, item.cover_type, item.child_id])

  const setTypeKey = (key: string, val: string | null) => {
    setTypePatch((p) => { const n = { ...p }; if (val === null) delete n[key]; else n[key] = val; persist('type', n); return n })
  }
  const setStudentKey = (patch: Record<string, string | null>) => {
    setStudentPatch((p) => { const n = { ...p, ...patch }; persist('student', n); return n })
  }

  // Кроп: портрет per-student у портретных, иначе шаблонный (общее фото).
  const cropToStudent = cropLabel === 'cover_portrait' && !!item.child_id
  const cropHandlers: CropHandlers = {
    onChange: (u) => {
      if (!cropLabel) return
      const patch: Record<string, string | null> = {}
      if (u.scale !== undefined) patch[`__scale__${cropLabel}`] = u.scale
      if (u.offset !== undefined) patch[`__offset__${cropLabel}`] = u.offset
      if (u.rotate !== undefined) patch[`__rotate__${cropLabel}`] = u.rotate
      if (cropToStudent) setStudentKey(patch)
      else setTypePatch((p) => { const n = { ...p }; for (const k of Object.keys(patch)) { if (patch[k] === null) delete n[k]; else n[k] = patch[k] } persist('type', n); return n })
    },
    onClose: () => setCropLabel(null),
    onGestureStart: () => {},
    onGestureEnd: () => {},
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center py-6 px-4 overflow-y-auto" onClick={onClose}>
      <div className="card p-4 w-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold">
            {item.child_name ?? TYPE_LABEL[item.cover_type]}
            <span className="text-xs text-muted-foreground ml-2">{item.cover_name}</span>
            {saving && <span className="text-xs text-muted-foreground ml-2">сохраняю…</span>}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><X size={18} /></button>
        </div>

        <div ref={wrapRef} className="w-full">
          {item.master && (
            <CoverCanvas
              master={item.master}
              data={data}
              spineWidthMm={spineWidthMm}
              containerWidth={containerWidth}
              mode="edit"
              editingTextLabel={editingTextLabel}
              onTextClick={(label) => setEditingTextLabel(label)}
              onTextSubmit={(label, val) => { setTypeKey(label, val); setEditingTextLabel(null) }}
              onTextCancel={() => setEditingTextLabel(null)}
              onPhotoClick={(label) => setCropLabel(label)}
              croppingLabel={cropLabel}
              cropHandlers={cropHandlers}
            />
          )}
        </div>

        {hasCommon && commonPhotos.length > 0 && (
          <div className="mt-3">
            <div className="text-xs text-muted-foreground mb-1">Общее фото класса (клик — заменить):</div>
            <div className="flex gap-2 flex-wrap">
              {commonPhotos.map((p) => {
                const active = data['cover_common_photo'] === p.url
                return (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={p.id} src={p.url} alt="" onClick={() => setTypeKey('cover_common_photo', p.url)}
                    className={`w-20 h-14 object-cover rounded cursor-pointer border-2 ${active ? 'border-brand' : 'border-transparent'}`} />
                )
              })}
            </div>
          </div>
        )}

        <div className="text-xs text-muted-foreground mt-3">
          {item.child_id
            ? 'Кроп портрета сохраняется для этого ученика. Тексты — общие для всех обложек этого типа.'
            : 'Правки применяются ко всем обложкам этого типа в заказе.'}
        </div>
      </div>
    </div>
  )
}
