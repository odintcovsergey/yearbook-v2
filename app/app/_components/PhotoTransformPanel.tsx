'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  parseScale,
  parseOffset,
  serializeScale,
  serializeOffset,
  hasCustomTransform,
  SCALE_MIN,
  SCALE_MAX,
  OFFSET_MIN,
  OFFSET_MAX,
} from '@/lib/photo-transform'

// PhotoTransformPanel — popover с инструментами кадрирования фото.
//
// Появляется при клике на photo placeholder в редакторе (КЭ.5).
// Позиционируется по координатам клика (clientX/clientY), всплывает
// над фреймом. Закрывается по клику вне, Esc, или кнопке «Готово».
//
// Состав (per ТЗ КЭ v1.1):
//   1. Slider масштаба 100..200% (step 1%, default 100%)
//   2. Touchpad 120×120 для drag позиции в диапазоне (-1..1)
//   3. Два numeric input'а X/Y (для точной правки)
//   4. Кнопка «Сброс» — удаляет __scale__/__offset__ ключи
//   5. Кнопка «Готово» — закрытие panel
//
// Стратегия записи:
//   - При движении слайдера / touchpad'а → optimistic UI update
//     через onChange callback (parent применяет к layout state)
//   - С debounce 300мс → fetch на /api/layout?action=update_data
//   - При неудаче сервера — rollback (parent делает revert)
//
// Touch/mouse поддержка: используем pointer events (универсально для
// мыши и iPad пальцем).

type Props = {
  label: string
  /** Текущие scale из data[__scale__<label>] */
  scale: number
  /** Текущий offset из data[__offset__<label>] */
  offsetX: number
  offsetY: number
  /** Координаты клика для позиционирования popover */
  clientX: number
  clientY: number
  /**
   * Применить локально (optimistic). null = удалить ключ.
   * Parent делает setLayout с новыми значениями для realtime preview.
   * При scale=1 и offset=(0,0) parent должен УДАЛИТЬ ключи (через null).
   */
  onChange: (updates: {
    scale?: string | null
    offset?: string | null
  }) => void
  /** Закрытие panel */
  onClose: () => void
}

const PANEL_WIDTH = 280
const PANEL_HEIGHT = 320
const TOUCHPAD_SIZE = 120
const TOUCHPAD_DOT_SIZE = 14

export default function PhotoTransformPanel({
  label,
  scale: initialScale,
  offsetX: initialOffsetX,
  offsetY: initialOffsetY,
  clientX,
  clientY,
  onChange,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const touchpadRef = useRef<HTMLDivElement>(null)

  // Локальное состояние panel — оптимистичное.
  // При drag/slider меняется мгновенно → onChange parent'а →
  // setLayout(...) → AlbumSpreadCanvas видит новое значение.
  const [scale, setScale] = useState(initialScale)
  const [offsetX, setOffsetX] = useState(initialOffsetX)
  const [offsetY, setOffsetY] = useState(initialOffsetY)
  const [dragging, setDragging] = useState(false)

  // Закрытие по клику вне panel и по Esc.
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  // Helper — отправить изменение parent'у с правильным serialize.
  // При default значениях (1, 0, 0) → null (удалить ключ).
  const emitChange = useCallback(
    (newScale: number, newOx: number, newOy: number) => {
      const updates: { scale?: string | null; offset?: string | null } = {}
      updates.scale = newScale === 1 ? null : serializeScale(newScale)
      updates.offset =
        newOx === 0 && newOy === 0 ? null : serializeOffset(newOx, newOy)
      onChange(updates)
    },
    [onChange],
  )

  // ─── Scale slider handlers ─────────────────────────────────────────
  function handleScaleSlider(e: React.ChangeEvent<HTMLInputElement>) {
    const v = parseScale(e.target.value)
    setScale(v)
    emitChange(v, offsetX, offsetY)
  }

  // ─── Numeric inputs для X/Y ───────────────────────────────────────
  function handleOffsetXInput(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.trim()
    if (raw === '' || raw === '-') {
      // Промежуточное значение — не пишем пока пользователь печатает.
      return
    }
    const [nx] = parseOffset(`${raw},${offsetY}`)
    setOffsetX(nx)
    emitChange(scale, nx, offsetY)
  }

  function handleOffsetYInput(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.trim()
    if (raw === '' || raw === '-') return
    const [, ny] = parseOffset(`${offsetX},${raw}`)
    setOffsetY(ny)
    emitChange(scale, offsetX, ny)
  }

  // ─── Touchpad: pointer events (универсально для мыши и сенсора) ───
  // Принцип: при pointerdown в touchpad area — захватываем drag и
  // следим за pointermove. Координаты pointer relative к touchpad
  // нормализуем в диапазон (-1..1).

  const handleTouchpadPointer = useCallback(
    (clientPx: number, clientPy: number) => {
      const pad = touchpadRef.current
      if (!pad) return
      const rect = pad.getBoundingClientRect()
      // Центр touchpad = (rect.width/2, rect.height/2)
      // Точка в touchpad: (clientPx - rect.left, clientPy - rect.top)
      // Нормализация в (-1..1): pos = 2 * (px - center) / size
      // Считаем что touchpad квадратный (TOUCHPAD_SIZE × TOUCHPAD_SIZE).
      const px = clientPx - rect.left
      const py = clientPy - rect.top
      const halfW = rect.width / 2
      const halfH = rect.height / 2
      let nx = (px - halfW) / halfW
      let ny = (py - halfH) / halfH
      nx = Math.max(-1, Math.min(1, nx))
      ny = Math.max(-1, Math.min(1, ny))
      // Округляем до 0.001 чтобы не плодить мусор в JSON.
      nx = Math.round(nx * 1000) / 1000
      ny = Math.round(ny * 1000) / 1000
      setOffsetX(nx)
      setOffsetY(ny)
      emitChange(scale, nx, ny)
    },
    [emitChange, scale],
  )

  function handleTouchpadDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
    handleTouchpadPointer(e.clientX, e.clientY)
  }

  function handleTouchpadMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return
    handleTouchpadPointer(e.clientX, e.clientY)
  }

  function handleTouchpadUp(e: React.PointerEvent<HTMLDivElement>) {
    setDragging(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  function handleTouchpadDoubleClick() {
    // Двойной клик в центр — reset offset (но scale оставляем как есть).
    setOffsetX(0)
    setOffsetY(0)
    emitChange(scale, 0, 0)
  }

  // ─── Сброс — удалить оба ключа ────────────────────────────────────
  function handleReset() {
    setScale(1)
    setOffsetX(0)
    setOffsetY(0)
    emitChange(1, 0, 0)
  }

  // Корректируем позицию popover'а если вылазит за viewport.
  let left = clientX
  let top = clientY
  if (typeof window !== 'undefined') {
    if (left + PANEL_WIDTH > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - PANEL_WIDTH - 8)
    }
    if (top + PANEL_HEIGHT > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - PANEL_HEIGHT - 8)
    }
    if (left < 8) left = 8
    if (top < 8) top = 8
  }

  // Координаты точки в touchpad (UI отображение позиции).
  // (-1..1) → (0..TOUCHPAD_SIZE)
  const dotX = ((offsetX + 1) / 2) * TOUCHPAD_SIZE - TOUCHPAD_DOT_SIZE / 2
  const dotY = ((offsetY + 1) / 2) * TOUCHPAD_SIZE - TOUCHPAD_DOT_SIZE / 2

  const isDefault = !hasCustomTransform(scale, offsetX, offsetY)

  return (
    <div
      ref={ref}
      className="fixed bg-white rounded-lg shadow-xl border border-gray-200 p-3 z-50 select-none"
      style={{
        left: `${left}px`,
        top: `${top}px`,
        width: `${PANEL_WIDTH}px`,
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-gray-400 truncate" title={label}>
          Кадрирование: {label}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-base leading-none px-1"
          title="Закрыть (Esc)"
          aria-label="Закрыть"
        >
          ×
        </button>
      </div>

      {/* Slider масштаба */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-gray-600">Масштаб</span>
          <span className="text-xs text-gray-900 font-mono tabular-nums">
            {Math.round(scale * 100)}%
          </span>
        </div>
        <input
          type="range"
          min={SCALE_MIN * 100}
          max={SCALE_MAX * 100}
          step={1}
          value={scale * 100}
          onChange={(e) => {
            const pct = Number(e.target.value)
            const v = pct / 100
            setScale(v)
            emitChange(v, offsetX, offsetY)
          }}
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
        />
      </div>

      {/* Touchpad + numeric inputs */}
      <div className="mb-3">
        <div className="text-xs text-gray-600 mb-1">Позиция</div>
        <div className="flex items-start gap-2">
          <div
            ref={touchpadRef}
            onPointerDown={handleTouchpadDown}
            onPointerMove={handleTouchpadMove}
            onPointerUp={handleTouchpadUp}
            onPointerCancel={handleTouchpadUp}
            onDoubleClick={handleTouchpadDoubleClick}
            className="relative bg-gray-100 rounded border border-gray-300 cursor-crosshair touch-none"
            style={{
              width: `${TOUCHPAD_SIZE}px`,
              height: `${TOUCHPAD_SIZE}px`,
            }}
            title="Перетащите чтобы сдвинуть фото. Двойной клик — центр."
          >
            {/* Cross lines в центре */}
            <div
              className="absolute bg-gray-300"
              style={{
                left: '50%',
                top: '0',
                width: '1px',
                height: '100%',
              }}
            />
            <div
              className="absolute bg-gray-300"
              style={{
                left: '0',
                top: '50%',
                width: '100%',
                height: '1px',
              }}
            />
            {/* Dot — текущая позиция */}
            <div
              className="absolute bg-blue-600 rounded-full border-2 border-white shadow"
              style={{
                left: `${dotX}px`,
                top: `${dotY}px`,
                width: `${TOUCHPAD_DOT_SIZE}px`,
                height: `${TOUCHPAD_DOT_SIZE}px`,
                pointerEvents: 'none',
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5 flex-1">
            <label className="text-xs text-gray-500 flex items-center gap-1">
              <span className="w-3">X</span>
              <input
                type="number"
                min={OFFSET_MIN}
                max={OFFSET_MAX}
                step={0.05}
                value={offsetX}
                onChange={handleOffsetXInput}
                className="flex-1 text-xs px-1.5 py-0.5 border border-gray-300 rounded font-mono"
              />
            </label>
            <label className="text-xs text-gray-500 flex items-center gap-1">
              <span className="w-3">Y</span>
              <input
                type="number"
                min={OFFSET_MIN}
                max={OFFSET_MAX}
                step={0.05}
                value={offsetY}
                onChange={handleOffsetYInput}
                className="flex-1 text-xs px-1.5 py-0.5 border border-gray-300 rounded font-mono"
              />
            </label>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-100">
        <button
          type="button"
          onClick={handleReset}
          disabled={isDefault}
          className="text-xs text-gray-600 hover:text-gray-900 disabled:text-gray-300 disabled:cursor-not-allowed"
          title="Сбросить к умолчанию (центрирование, 100%)"
        >
          ↺ Сбросить
        </button>
        <button
          type="button"
          onClick={onClose}
          className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Готово
        </button>
      </div>
    </div>
  )
}
