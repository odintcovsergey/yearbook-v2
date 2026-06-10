'use client'

import { useEffect, useRef, useState } from 'react'
import type { SpreadTemplate } from './types'
import SpreadCanvas from './SpreadCanvas'

type Props = {
  spread: SpreadTemplate
  onClose: () => void
}

export default function SpreadDetailModal({ spread, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState<number>(800)
  const downOnBackdrop = useRef(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width ?? 800
      setContainerWidth(Math.min(Math.floor(w), 800))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 overflow-auto"
      onMouseDown={e => { downOnBackdrop.current = e.target === e.currentTarget }}
      onMouseUp={e => {
        if (downOnBackdrop.current && e.target === e.currentTarget) onClose()
        downOnBackdrop.current = false
      }}
    >
      <div className="bg-card rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-auto">
        <div className="flex items-start justify-between p-4 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold">{spread.name}</h2>
            <p className="text-xs text-muted-foreground mt-1">
              {spread.type}
              {' · '}
              {Math.round(spread.width_mm)} × {Math.round(spread.height_mm)} mm
              {spread.is_spread && ' · spread'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-muted-foreground text-xl leading-none px-2"
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>
        <div ref={containerRef} className="p-4">
          <SpreadCanvas spread={spread} containerWidth={containerWidth} />
        </div>
      </div>
    </div>
  )
}
