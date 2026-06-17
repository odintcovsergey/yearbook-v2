'use client'

import type { SpreadTemplate } from '@/lib/album-builder/types'

/**
 * Мини-эскиз раскладки мастера (ТЗ 17.06.2026, пункт C живого прогона):
 * партнёр выбирает раскладку личного раздела ВИЗУАЛЬНО, а не по техимени
 * `E-Collage-2`. Рисуем схему по реальным плейсхолдерам мастера:
 *   - портрет (studentportrait) — мятный прямоугольник;
 *   - фото (studentphoto/friendphoto и пр. фото-слоты) — голубой прямоугольник;
 *   - текст (имя/цитата) — серая полоска.
 * Видно сразу: сколько фото, их ориентация (верт/гор), где портрет и текст.
 * Декор не рисуем (он не влияет на смысл выбора).
 */
export function MasterSchematic({
  master,
  width = 56,
  height = 78,
}: {
  master: SpreadTemplate
  width?: number
  height?: number
}) {
  const pageW = master.width_mm && master.width_mm > 0 ? master.width_mm : 100
  const pageH = master.height_mm && master.height_mm > 0 ? master.height_mm : 140
  const scale = Math.min(width / pageW, height / pageH)
  const vw = Math.round(pageW * scale)
  const vh = Math.round(pageH * scale)

  // В master.placeholders по типу только photo/text (декор хранится отдельно),
  // но в рантайме из БД может прийти и декор — рисуем только фото/текст.
  const slots = (master.placeholders ?? []).filter(
    (p) => p.type === 'photo' || p.type === 'text',
  )

  return (
    <svg
      width={vw}
      height={vh}
      viewBox={`0 0 ${pageW} ${pageH}`}
      className="rounded border border-border bg-card shrink-0"
      preserveAspectRatio="xMidYMid meet"
    >
      {slots.map((p, i) => {
        const l = p.label.toLowerCase()
        const isPortrait = /^studentportrait(_\d+)?$/.test(l)
        const isText = p.type === 'text'
        if (isText) {
          // Текст — тонкая серая полоска по центру слота.
          const barH = Math.min(p.height_mm, 6)
          return (
            <rect
              key={i}
              x={p.x_mm}
              y={p.y_mm + (p.height_mm - barH) / 2}
              width={p.width_mm}
              height={barH}
              rx={1}
              fill="#9ca3af"
              opacity={0.6}
            />
          )
        }
        return (
          <rect
            key={i}
            x={p.x_mm}
            y={p.y_mm}
            width={p.width_mm}
            height={p.height_mm}
            rx={2}
            fill={isPortrait ? '#5eead4' : '#93c5fd'}
            stroke={isPortrait ? '#14b8a6' : '#3b82f6'}
            strokeWidth={1}
          />
        )
      })}
    </svg>
  )
}
