'use client'

/**
 * LayoutPreviewFullscreen (Блок UX.4) — полноэкранный просмотр готового
 * макета без интерфейса редактора. Кнопка-«глаз» в шапке редактора
 * открывает этот оверлей, чтобы партнёр оценил результат перед отправкой
 * клиенту.
 *
 * Переиспользует реальный рендер страницы — AlbumSpreadCanvas в режиме
 * 'preview' (без хэндлов/панелей/обводки). Логика вёрстки НЕ дублируется:
 * вся геометрия живёт в AlbumSpreadCanvas, здесь только раскладка пары
 * (spread / две страницы / форзацы) и листание.
 *
 * Размер разворота считается тем же fit-to-screen приёмом, что и в
 * редакторе (Блок UX.2): измеряем рабочую зону ResizeObserver'ом и
 * вписываем разворот по высоте и ширине.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import dynamic from 'next/dynamic'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import type { SpreadInstance, SpreadTemplate } from '@/lib/album-builder/types'
import type { VisualSpread } from '@/lib/album-builder/segment-to-spreads'
import type { AlbumTextStyleOverrides } from '@/lib/text-style'

const AlbumSpreadCanvas = dynamic(() => import('./AlbumSpreadCanvas'), {
  ssr: false,
  loading: () => null,
})

type Props = {
  visualSpreads: VisualSpread[]
  spreads: SpreadInstance[]
  templatesById: Map<string, SpreadTemplate>
  isSoftAlbum: boolean
  /** Public URL фона для каждого визуального разворота (по индексу пары). */
  bgUrlByPairIdx: (string | null)[]
  textStyleOverrides?: AlbumTextStyleOverrides
  initialPairIdx: number
  onClose: () => void
}

// Простой нейтральный «лист» для пустой страницы висящего разворота или
// форзаца soft-альбома. В просмотре не нужны кнопки добавления — только вид.
function BlankPage({
  width,
  aspectRatio,
  label,
}: {
  width: number
  aspectRatio: number
  label?: string
}) {
  return (
    <div
      className="bg-card border border-dashed border-border flex items-center justify-center"
      style={{ width, height: width / aspectRatio }}
    >
      {label && (
        <span className="text-[11px] text-muted-foreground select-none">
          {label}
        </span>
      )}
    </div>
  )
}

export default function LayoutPreviewFullscreen({
  visualSpreads,
  spreads,
  templatesById,
  isSoftAlbum,
  bgUrlByPairIdx,
  textStyleOverrides,
  initialPairIdx,
  onClose,
}: Props) {
  const total = visualSpreads.length
  const clampIdx = useCallback(
    (i: number) => Math.max(0, Math.min(total - 1, i)),
    [total],
  )
  const [pairIdx, setPairIdx] = useState(() => clampIdx(initialPairIdx))

  const goPrev = useCallback(
    () => setPairIdx((i) => clampIdx(i - 1)),
    [clampIdx],
  )
  const goNext = useCallback(
    () => setPairIdx((i) => clampIdx(i + 1)),
    [clampIdx],
  )

  // Клавиатура: ← / → листают, Esc закрывает.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') goPrev()
      else if (e.key === 'ArrowRight') goNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, goPrev, goNext])

  // Свайп пальцем (моб/тачпад) — порог 50px по горизонтали.
  const touchStartX = useRef<number | null>(null)
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return
    const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current
    if (dx > 50) goPrev()
    else if (dx < -50) goNext()
    touchStartX.current = null
  }

  // Измеряемая рабочая зона (как Блок UX.2).
  const [area, setArea] = useState({ width: 0, height: 0 })
  const observer = useRef<ResizeObserver | null>(null)
  const setAreaRef = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect()
    if (!el) {
      observer.current = null
      return
    }
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect
      if (cr) setArea({ width: cr.width, height: cr.height })
    })
    ro.observe(el)
    observer.current = ro
  }, [])

  const pair = visualSpreads[pairIdx] ?? null
  const leftPage =
    pair?.leftIdx !== undefined ? spreads[pair.leftIdx] : null
  const rightPage =
    pair?.rightIdx !== undefined ? spreads[pair.rightIdx] : null
  const leftTemplate = leftPage ? templatesById.get(leftPage.template_id) : null
  const rightTemplate = rightPage
    ? templatesById.get(rightPage.template_id)
    : null
  const basePageTemplate = leftTemplate ?? rightTemplate ?? null
  const isPairSpread = pair?.isSpread === true

  const aspectRatio = basePageTemplate
    ? isPairSpread
      ? basePageTemplate.width_mm / basePageTemplate.height_mm
      : (basePageTemplate.width_mm * 2) / basePageTemplate.height_mm
    : 1
  // Вписывание: ширина = min(доступная ширина, доступная высота * аспект).
  const availW = area.width > 0 ? Math.max(240, area.width - 24) : 800
  const availH = area.height > 0 ? Math.max(240, area.height - 24) : 600
  const canvasContainerWidth = Math.min(availH * aspectRatio, availW)
  const halfWidth = isPairSpread
    ? canvasContainerWidth
    : canvasContainerWidth / 2

  const bgUrl = bgUrlByPairIdx[pairIdx] ?? null
  const isFirstPair = pairIdx === 0
  const isLastPair = pairIdx === total - 1
  const showLeftEndpaper = isSoftAlbum && isFirstPair
  const showRightEndpaper = isSoftAlbum && isLastPair
  const placeholderAspect = aspectRatio / (isPairSpread ? 1 : 2)

  return (
    <div className="fixed inset-0 z-50 bg-neutral-900 flex flex-col">
      {/* Верхняя панель: закрыть + счётчик. */}
      <div className="flex items-center justify-between px-4 py-2.5 text-white/90">
        <span className="text-sm font-medium">Просмотр макета</span>
        <span className="text-sm text-white/70">
          Разворот {total > 0 ? pairIdx + 1 : 0} из {total}
        </span>
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

      {/* Рабочая зона: стрелки по краям + разворот по центру. */}
      <div
        ref={setAreaRef}
        className="relative flex-1 min-h-0 flex items-center justify-center px-14"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <button
          type="button"
          onClick={goPrev}
          disabled={isFirstPair}
          className="absolute left-3 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center w-11 h-11 rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Предыдущий разворот (←)"
          aria-label="Предыдущий разворот"
        >
          <ChevronLeft size={24} />
        </button>

        {pair && (leftTemplate || rightTemplate) ? (
          <div className="flex items-stretch gap-1 shadow-2xl">
            {isPairSpread && leftPage && leftTemplate ? (
              <AlbumSpreadCanvas
                instance={leftPage}
                template={leftTemplate}
                containerWidth={halfWidth}
                mode="preview"
                textStyleOverrides={textStyleOverrides}
                backgroundUrl={bgUrl}
                pageSide="spread"
              />
            ) : (
              <>
                {leftPage && leftTemplate ? (
                  <AlbumSpreadCanvas
                    instance={leftPage}
                    template={leftTemplate}
                    containerWidth={halfWidth}
                    mode="preview"
                    textStyleOverrides={textStyleOverrides}
                    backgroundUrl={bgUrl}
                    pageSide="left"
                  />
                ) : (
                  <BlankPage
                    width={halfWidth}
                    aspectRatio={placeholderAspect}
                    label={showLeftEndpaper ? 'Форзац' : undefined}
                  />
                )}
                {rightPage && rightTemplate ? (
                  <AlbumSpreadCanvas
                    instance={rightPage}
                    template={rightTemplate}
                    containerWidth={halfWidth}
                    mode="preview"
                    textStyleOverrides={textStyleOverrides}
                    backgroundUrl={bgUrl}
                    pageSide="right"
                  />
                ) : (
                  <BlankPage
                    width={halfWidth}
                    aspectRatio={placeholderAspect}
                    label={showRightEndpaper ? 'Форзац' : undefined}
                  />
                )}
              </>
            )}
          </div>
        ) : (
          <p className="text-white/60 text-sm">Нет разворотов для просмотра</p>
        )}

        <button
          type="button"
          onClick={goNext}
          disabled={isLastPair}
          className="absolute right-3 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center w-11 h-11 rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Следующий разворот (→)"
          aria-label="Следующий разворот"
        >
          <ChevronRight size={24} />
        </button>
      </div>
    </div>
  )
}
