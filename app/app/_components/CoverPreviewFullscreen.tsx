'use client'

/**
 * CoverPreviewFullscreen — полноэкранный просмотр готовых обложек без
 * интерфейса редактора (аналог LayoutPreviewFullscreen, но для обложек).
 * Кнопка «Вид» в шапке редактора обложек открывает этот оверлей, чтобы
 * партнёр оценил результат.
 *
 * Переиспользует реальный рендер обложки — CoverCanvas в режиме 'preview'
 * (без хэндлов/панелей/обводки). Листание ← / → / свайп, Esc закрывает.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import type { CoverTextStyleOverrides } from '@/lib/cover/text-styles'
import type { CoverCanvasMaster } from './CoverCanvas'
import type { FormatFamily, PrinterFormat } from '@/lib/printers/types'

const CoverCanvas = dynamic(() => import('./CoverCanvas'), { ssr: false, loading: () => null })

export type CoverPreviewItem = {
  master: CoverCanvasMaster
  data: Record<string, string | null>
  name: string
}

type Props = {
  items: CoverPreviewItem[]
  spineWidthMm: number | null
  initialIdx: number
  coverTextStyles?: CoverTextStyleOverrides | null
  onClose: () => void
  /** ТЗ 19.06.2026: формат заказа + семейство дизайна для адаптации обложки. */
  targetFormat?: PrinterFormat | null
  designFamily?: FormatFamily | null
}

function num(v: number | null): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

export default function CoverPreviewFullscreen({ items, spineWidthMm, initialIdx, coverTextStyles, onClose, targetFormat, designFamily }: Props) {
  const total = items.length
  const clampIdx = useCallback((i: number) => Math.max(0, Math.min(total - 1, i)), [total])
  const [idx, setIdx] = useState(() => clampIdx(initialIdx))

  const goPrev = useCallback(() => setIdx((i) => clampIdx(i - 1)), [clampIdx])
  const goNext = useCallback(() => setIdx((i) => clampIdx(i + 1)), [clampIdx])

  // Клавиатура: ← / → листают, Esc закрывает (capture-фаза — раньше навигации
  // самого редактора, иначе стрелки конкурируют).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); goPrev() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); goNext() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, goPrev, goNext])

  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => { rootRef.current?.focus() }, [])

  // Свайп пальцем (моб/тачпад) — порог 50px по горизонтали.
  const touchStartX = useRef<number | null>(null)
  const onTouchStart = (e: React.TouchEvent) => { touchStartX.current = e.touches[0]?.clientX ?? null }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return
    const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current
    if (dx > 50) goPrev(); else if (dx < -50) goNext()
    touchStartX.current = null
  }

  // Измеряемая рабочая зона (fit-to-screen по высоте и ширине).
  const [area, setArea] = useState({ width: 0, height: 0 })
  const observer = useRef<ResizeObserver | null>(null)
  const setAreaRef = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect()
    if (!el) { observer.current = null; return }
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect
      if (cr) setArea({ width: cr.width, height: cr.height })
    })
    ro.observe(el)
    observer.current = ro
  }, [])

  const cur = items[idx] ?? null
  const m = cur?.master ?? null
  // Аспект полотна обложки: (задняя + корешок + передняя) / высота.
  const spine = spineWidthMm ?? num(m?.nominal_spine_width_mm ?? null)
  const widthMm = m ? num(m.back_width_mm) + num(m.front_width_mm) + spine : 1
  const heightMm = m ? num(m.height_mm) : 1
  const aspect = heightMm > 0 ? widthMm / heightMm : 1
  const availW = area.width > 0 ? Math.max(240, area.width - 24) : 800
  const availH = area.height > 0 ? Math.max(240, area.height - 24) : 600
  const containerWidth = Math.min(availH * aspect, availW)

  const isFirst = idx === 0
  const isLast = idx === total - 1

  return (
    <div ref={rootRef} tabIndex={-1} className="fixed inset-0 z-50 bg-neutral-900 flex flex-col outline-none">
      {/* Верхняя панель: имя + счётчик + закрыть. */}
      <div className="flex items-center justify-between px-4 py-2.5 text-white/90">
        <span className="text-sm font-medium truncate">{cur?.name ?? 'Просмотр обложек'}</span>
        <span className="text-sm text-white/70">Обложка {total > 0 ? idx + 1 : 0} из {total}</span>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm bg-white/10 hover:bg-white/20 transition-colors"
          title="Закрыть просмотр (Esc)"
          aria-label="Закрыть просмотр"
        >
          <X size={16} /> Закрыть
        </button>
      </div>

      {/* Рабочая зона: стрелки по краям + обложка по центру. */}
      <div
        ref={setAreaRef}
        className="relative flex-1 min-h-0 flex items-center justify-center px-14"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <button
          type="button"
          onClick={goPrev}
          disabled={isFirst}
          className="absolute left-3 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center w-11 h-11 rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Предыдущая обложка (←)"
          aria-label="Предыдущая обложка"
        >
          <ChevronLeft size={24} />
        </button>

        {cur && m ? (
          <div className="shadow-2xl">
            <CoverCanvas
              master={m}
              data={cur.data}
              spineWidthMm={spineWidthMm}
              containerWidth={containerWidth}
              mode="preview"
              targetFormat={targetFormat}
              designFamily={designFamily}
              coverTextStyles={coverTextStyles}
            />
          </div>
        ) : (
          <p className="text-white/60 text-sm">Нет обложек для просмотра</p>
        )}

        <button
          type="button"
          onClick={goNext}
          disabled={isLast}
          className="absolute right-3 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center w-11 h-11 rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Следующая обложка (→)"
          aria-label="Следующая обложка"
        >
          <ChevronRight size={24} />
        </button>
      </div>
    </div>
  )
}
