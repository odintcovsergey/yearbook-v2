'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  parseFontSizeMult,
  serializeFontSizeMult,
  serializeColor,
  isColorInPalette,
  hasCustomTextStyle,
  TEXT_STYLE_PALETTE,
  FONT_SIZE_MULT_MIN,
  FONT_SIZE_MULT_MAX,
} from '@/lib/text-style'

// TextStylePanel — popover с инструментами стилизации текста (Р.3).
//
// Появляется рядом с активным TextInlineEditor — партнёр видит сразу
// два инструмента: textarea для содержимого и компактную панель для
// размера и цвета.
//
// Состав:
//   1. Slider размера 50..200% (step 5%, default 100%) — мультипликатор
//      от placeholder.font_size_pt.
//   2. Палитра 10 фиксированных цветов (TEXT_STYLE_PALETTE) с подсветкой
//      активного.
//   3. Кнопка «По умолчанию» — удаляет __fontSize__ и __color__ ключи,
//      возвращая стиль к placeholder defaults.
//   4. Кнопка «Готово» — закрывает панель (textarea остаётся открытым
//      пока пользователь не зафиксирует текст).
//
// Зачем мультипликатор, а не абсолют:
//   - При смене мастера новые placeholder'ы имеют свой font_size_pt;
//     мультипликатор «50% от базового» осмысленно мигрирует, а абсолютные
//     значения дают сюрпризы.
//   - См. lib/text-style/index.ts и Р.1 (миграция __fontSize__/__color__
//     при смене мастера).
//
// UX закрытия: клик вне панели НЕ закрывает её сразу — иначе любое
// движение к textarea/canvas закрывает popover. Закрытие через Esc,
// явную кнопку «Готово», или закрытие самого TextInlineEditor (через
// parent).

type Props = {
  label: string
  /** Текущий мультипликатор размера из data[__fontSize__<label>]. */
  fontSizeMult: number
  /**
   * Текущий override цвета (нормализованный HEX) или null если override
   * отсутствует и используется placeholder.color.
   */
  colorOverride: string | null
  /**
   * Координаты для позиционирования popover'а. Передаются из page.tsx —
   * обычно центр placeholder'а или клик-координаты.
   */
  clientX: number
  clientY: number
  /**
   * Применить локально (optimistic). null = удалить соответствующий ключ.
   * Parent делает setLayout с новыми значениями для realtime preview.
   */
  onChange: (updates: {
    fontSize?: string | null
    color?: string | null
  }) => void
  /** Закрытие panel (явное «Готово» или Esc). */
  onClose: () => void
}

const PANEL_WIDTH = 260
const PANEL_HEIGHT = 240

export default function TextStylePanel({
  label,
  fontSizeMult: initialMult,
  colorOverride: initialColor,
  clientX,
  clientY,
  onChange,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)

  // Локальное состояние — optimistic.
  const [mult, setMult] = useState(initialMult)
  const [color, setColor] = useState<string | null>(initialColor)

  // Закрытие по Esc. Клик «вне» НЕ закрывает — иначе любое движение к
  // textarea (которая снаружи) дёргает onClose.
  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  // Helper — отправить изменение parent'у. При default значениях → null
  // (parent удалит соответствующий ключ).
  const emitChange = useCallback(
    (newMult: number, newColor: string | null) => {
      onChange({
        fontSize: newMult === 1 ? null : serializeFontSizeMult(newMult),
        color: newColor === null ? null : serializeColor(newColor),
      })
    },
    [onChange],
  )

  // ─── Size slider ─────────────────────────────────────────────────
  function handleSizeSlider(e: React.ChangeEvent<HTMLInputElement>) {
    // value в % — конвертируем в мультипликатор.
    const pct = Number(e.target.value)
    const v = parseFontSizeMult(pct / 100)
    setMult(v)
    emitChange(v, color)
  }

  // ─── Color swatch click ─────────────────────────────────────────
  function handleColorClick(hex: string) {
    // Повторный клик по уже-активному цвету → сброс override (null).
    const normalized = hex.toUpperCase()
    const isActive = color !== null && color.toUpperCase() === normalized
    const next = isActive ? null : normalized
    setColor(next)
    emitChange(mult, next)
  }

  // ─── Reset (по умолчанию) ─────────────────────────────────────
  function handleReset() {
    setMult(1)
    setColor(null)
    emitChange(1, null)
  }

  // РЭ.52.b: умное позиционирование рядом с кликом.
  // Если клик в ЛЕВОЙ половине экрана → панель появляется СПРАВА от
  // клика. Если клик в ПРАВОЙ половине → панель появляется СЛЕВА от
  // клика. По вертикали — выравнивается чуть ниже клика с защитой
  // от выхода за viewport.
  // Это решает feedback Сергея: top-right требует «искать панель»,
  // тогда как панель рядом с placeholder'ом — естественнее.
  let left = clientX
  let top = clientY
  if (typeof window !== 'undefined') {
    const w = window.innerWidth
    const h = window.innerHeight
    const GAP = 30 // отступ от точки клика
    // Горизонталь: если клик в левой половине → панель справа, иначе слева.
    if (clientX < w / 2) {
      left = clientX + GAP
    } else {
      left = clientX - PANEL_WIDTH - GAP
    }
    // Вертикаль: чуть ниже клика, но не вылезая.
    top = clientY - 20 // немного выше курсора чтобы шапка панели была видна
    // Защита от выхода.
    if (left + PANEL_WIDTH > w - 8) left = w - PANEL_WIDTH - 8
    if (left < 8) left = 8
    if (top + PANEL_HEIGHT > h - 8) top = Math.max(8, h - PANEL_HEIGHT - 8)
    if (top < 8) top = 8
  }

  const isDefault = !hasCustomTextStyle(mult, color)
  // Активный цвет для подсветки — либо override, либо null (тогда
  // подсвечивается только если он есть в палитре, иначе — никакой).
  const activeHex = color && isColorInPalette(color) ? color.toUpperCase() : null

  return (
    <div
      ref={ref}
      data-text-style-panel="true"
      className="fixed bg-white rounded-lg shadow-xl border border-gray-200 p-3 z-50 select-none"
      style={{
        left: `${left}px`,
        top: `${top}px`,
        width: `${PANEL_WIDTH}px`,
      }}
      // РЭ.52.b: НЕ используем preventDefault на mouseDown — это
      // блокировало начало drag на input range (#1 был не починен в
      // РЭ.52). Вместо этого blur textarea различает «куда ушёл
      // фокус» через relatedTarget: если в нашу панель (data-attribute
      // text-style-panel) — игнорируем blur.
      // stopPropagation остаётся — клик в панели не должен пузыриться
      // на canvas (избегаем повторного открытия text-editor).
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-gray-400 truncate" title={label}>
          Шрифт: {label}
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

      {/* Slider размера */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-gray-600">Размер</span>
          <span className="text-xs text-gray-900 font-mono tabular-nums">
            {Math.round(mult * 100)}%
          </span>
        </div>
        <input
          type="range"
          min={FONT_SIZE_MULT_MIN * 100}
          max={FONT_SIZE_MULT_MAX * 100}
          step={5}
          value={mult * 100}
          onChange={handleSizeSlider}
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
        />
      </div>

      {/* Палитра цветов */}
      <div className="mb-3">
        <div className="text-xs text-gray-600 mb-1">
          Цвет {color === null && <span className="text-gray-400">(по умолчанию)</span>}
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {TEXT_STYLE_PALETTE.map(({ hex, name }) => {
            const isActive = activeHex === hex.toUpperCase()
            return (
              <button
                key={hex}
                type="button"
                onClick={() => handleColorClick(hex)}
                title={`${name} (${hex})`}
                aria-label={name}
                className={`w-9 h-9 rounded border transition-all ${
                  isActive
                    ? 'border-blue-600 ring-2 ring-blue-200'
                    : 'border-gray-300 hover:border-gray-400'
                }`}
                style={{ backgroundColor: hex }}
              >
                {/* Галочка на активном цвете. Цвет галочки — белый или
                    чёрный в зависимости от яркости фона. */}
                {isActive && (
                  <span
                    className="block text-center leading-none text-sm font-bold"
                    style={{ color: isLightColor(hex) ? '#000' : '#FFF' }}
                  >
                    ✓
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-100">
        <button
          type="button"
          onClick={handleReset}
          disabled={isDefault}
          className="text-xs text-gray-600 hover:text-gray-900 disabled:text-gray-300 disabled:cursor-not-allowed"
          title="Вернуть размер и цвет к настройкам шаблона"
        >
          ↺ По умолчанию
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

/**
 * Простая эвристика: цвет «светлый» если luminance > 0.6.
 * Используется только для выбора цвета галочки на swatch'е, не
 * критично к точности.
 */
function isLightColor(hex: string): boolean {
  const cleaned = hex.replace('#', '')
  if (cleaned.length !== 6) return true
  const r = parseInt(cleaned.slice(0, 2), 16) / 255
  const g = parseInt(cleaned.slice(2, 4), 16) / 255
  const b = parseInt(cleaned.slice(4, 6), 16) / 255
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return lum > 0.6
}
