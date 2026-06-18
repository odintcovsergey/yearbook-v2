'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, BookImage } from 'lucide-react'

type CoverType = 'portrait_photo' | 'common_photo' | 'design_only'

type Row = {
  child_id: string
  full_name: string
  cover_type: CoverType | null
  photo_option: 'same' | 'other' | null
  cover_portrait_url: string | null
  paid: boolean
  status: 'ok' | 'no_choice' | 'needs_photo'
}

type Summary = {
  mode: string | null
  default_type: CoverType | null
  counts: { portrait: number; common: number; design: number; none: number; total: number }
  print: { portrait: number; common: number; design: number; total: number }
  rows: Row[]
  warnings: string[]
}

const TYPE_LABEL: Record<CoverType, string> = {
  portrait_photo: 'Портрет',
  common_photo: 'Общая',
  design_only: 'Дизайн',
}

const STATUS_LABEL: Record<Row['status'], string> = {
  ok: 'выбрано',
  no_choice: 'не выбрано',
  needs_photo: 'нужно фото',
}

/**
 * Сводка обложек заказа (только просмотр): кто что выбрал, сколько обложек
 * пойдёт в печать, предупреждения. Источник — /api/tenant?action=cover_summary.
 */
export default function CoversSummaryBlock({ albumId }: { albumId: string }) {
  const [data, setData] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    fetch(`/api/tenant?action=cover_summary&album_id=${albumId}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Summary | null) => { if (alive) setData(d) })
      .catch(() => { if (alive) setData(null) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [albumId])

  if (loading || !data) return null

  // Обложка не настроена в заказе — показываем спокойную подсказку.
  if (!data.mode) {
    return (
      <div className="bg-muted rounded-xl p-4 mb-6">
        <div className="flex items-center gap-2 text-sm font-medium mb-1">
          <BookImage size={16} /> Обложки
        </div>
        <div className="text-xs text-muted-foreground">
          Обложка для этого заказа не настроена — задай режим и обложки в настройках заказа.
        </div>
      </div>
    )
  }

  return (
    <div className="bg-muted rounded-xl p-4 mb-6">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <BookImage size={16} /> Обложки заказа
        </div>
        <div className="text-sm">
          На печать: <b>{data.print.total}</b>
          <span className="text-muted-foreground text-xs">
            {' '}({data.print.portrait} портр.{data.print.common ? ' + 1 общая' : ''}{data.print.design ? ' + 1 дизайн' : ''})
          </span>
        </div>
      </div>

      {/* Агрегаты */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        <Stat label="Портрет" value={data.counts.portrait} />
        <Stat label="Общая" value={data.counts.common} />
        <Stat label="Дизайн" value={data.counts.design} />
        <Stat label="Не выбрали" value={data.counts.none} warn={data.counts.none > 0} />
      </div>

      {/* Предупреждения */}
      {data.warnings.length > 0 && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-2 mb-3 text-xs text-amber-800 space-y-0.5">
          {data.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* Список учеников */}
      <div className="max-h-72 overflow-y-auto rounded-lg border border-border bg-card divide-y divide-border">
        {data.rows.map((r) => (
          <div key={r.child_id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
            <span className="flex-1 truncate">{r.full_name}</span>
            <span className="text-xs text-muted-foreground w-16 text-right">
              {r.cover_type ? TYPE_LABEL[r.cover_type] : '—'}
            </span>
            {r.cover_type === 'portrait_photo' && (
              <span className="text-xs text-muted-foreground w-20 text-right">
                {r.photo_option === 'other' ? 'другое фото' : 'то же фото'}
              </span>
            )}
            {r.paid && <span className="text-xs text-brand">доплата</span>}
            <span className={`text-xs w-20 text-right ${r.status === 'ok' ? 'text-muted-foreground' : 'text-amber-700'}`}>
              {STATUS_LABEL[r.status]}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="bg-card rounded-lg p-2 text-center">
      <div className={`text-lg font-semibold ${warn ? 'text-amber-700' : ''}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}
