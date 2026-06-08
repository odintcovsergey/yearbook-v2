'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { RotateCcw } from 'lucide-react'
import {
  parseFontSizeMult,
  serializeFontSizeMult,
  serializeColor,
  isColorInPalette,
  hasCustomTextStyle,
  TEXT_STYLE_PALETTE,
  FONT_SIZE_MULT_MIN,
  FONT_SIZE_MULT_MAX,
  AVAILABLE_FONTS,
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
   * РЭ.54: точечные align overrides ('left'|'center'|'right' / 'top'|'middle'|'bottom').
   * null если override отсутствует — fallback на placeholder.align / 'top'.
   */
  hAlignOverride: 'left' | 'center' | 'right' | null
  vAlignOverride: 'top' | 'middle' | 'bottom' | null
  /**
   * РЭ.55: точечный override шрифта — каноническое имя из AVAILABLE_FONTS
   * или null если override отсутствует (используется placeholder.font_family
   * из IDML).
   */
  fontFamilyOverride: string | null
  /**
   * РЭ.55: placeholder.font_family из IDML — показываем в селекте как
   * disabled-опцию 'Из шаблона: <name>' если шрифт там не в curated
   * списке. Иначе используем для подсветки активной строки.
   */
  templateFontFamily: string | null
  /**
   * РЭ.52.c: границы placeholder'а в client координатах. Panel сам
   * решает «справа от rightEdge» если место есть или «слева от leftEdge».
   * topEdge — верх placeholder'а (для выравнивания шапки панели).
   */
  rightEdge: number
  topEdge: number
  leftEdge: number
  /**
   * Применить локально (optimistic). null = удалить соответствующий ключ.
   * Parent делает setLayout с новыми значениями для realtime preview.
   */
  onChange: (updates: {
    fontSize?: string | null
    color?: string | null
    halign?: string | null
    valign?: string | null
    font?: string | null
  }) => void
  /** Закрытие panel (явное «Готово» или Esc). */
  onClose: () => void
}

const PANEL_WIDTH = 260
const PANEL_HEIGHT = 380

export default function TextStylePanel({
  label,
  fontSizeMult: initialMult,
  colorOverride: initialColor,
  hAlignOverride: initialHAlign,
  vAlignOverride: initialVAlign,
  fontFamilyOverride: initialFontFamily,
  templateFontFamily,
  rightEdge,
  topEdge,
  leftEdge,
  onChange,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)

  // Локальное состояние — optimistic.
  const [mult, setMult] = useState(initialMult)
  const [color, setColor] = useState<string | null>(initialColor)
  const [hAlign, setHAlign] = useState<'left' | 'center' | 'right' | null>(initialHAlign)
  const [vAlign, setVAlign] = useState<'top' | 'middle' | 'bottom' | null>(initialVAlign)
  // РЭ.55: точечный override шрифта.
  const [fontFamily, setFontFamily] = useState<string | null>(initialFontFamily)

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
    (
      newMult: number,
      newColor: string | null,
      newHAlign: 'left' | 'center' | 'right' | null,
      newVAlign: 'top' | 'middle' | 'bottom' | null,
      newFontFamily: string | null,
    ) => {
      onChange({
        fontSize: newMult === 1 ? null : serializeFontSizeMult(newMult),
        color: newColor === null ? null : serializeColor(newColor),
        halign: newHAlign,
        valign: newVAlign,
        font: newFontFamily,
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
    emitChange(v, color, hAlign, vAlign, fontFamily)
  }

  // ─── Color swatch click ─────────────────────────────────────────
  function handleColorClick(hex: string) {
    // Повторный клик по уже-активному цвету → сброс override (null).
    const normalized = hex.toUpperCase()
    const isActive = color !== null && color.toUpperCase() === normalized
    const next = isActive ? null : normalized
    setColor(next)
    emitChange(mult, next, hAlign, vAlign, fontFamily)
  }

  // ─── РЭ.54: Align buttons ───────────────────────────────────────
  function handleHAlign(value: 'left' | 'center' | 'right') {
    // Повторный клик на активном → сброс (null).
    const next = hAlign === value ? null : value
    setHAlign(next)
    emitChange(mult, color, next, vAlign, fontFamily)
  }

  function handleVAlign(value: 'top' | 'middle' | 'bottom') {
    const next = vAlign === value ? null : value
    setVAlign(next)
    emitChange(mult, color, hAlign, next, fontFamily)
  }

  // ─── РЭ.55: Font select ─────────────────────────────────────────
  function handleFontSelect(value: string) {
    // value = '' означает 'из шаблона' (сброс override).
    const next = value === '' ? null : value
    setFontFamily(next)
    emitChange(mult, color, hAlign, vAlign, next)
  }

  // ─── Reset (по умолчанию) ─────────────────────────────────────
  function handleReset() {
    setMult(1)
    setColor(null)
    setHAlign(null)
    setVAlign(null)
    setFontFamily(null)
    emitChange(1, null, null, null, null)
  }

  // РЭ.52.c: позиционирование ОТНОСИТЕЛЬНО ГРАНИЦ placeholder'а
  // (а не точки клика). Пытаемся положить справа от элемента
  // (left = rightEdge + GAP). Если справа места нет — слева от
  // элемента (left = leftEdge - PANEL_WIDTH - GAP). По вертикали
  // выравниваемся по topEdge.
  // Это решает feedback Сергея: панель НЕ перекрывает редактируемый
  // объект.
  let left: number
  let top = topEdge
  const GAP = 16
  if (typeof window !== 'undefined') {
    const w = window.innerWidth
    const h = window.innerHeight
    // Сначала пробуем справа от placeholder'а.
    if (rightEdge + GAP + PANEL_WIDTH <= w - 8) {
      left = rightEdge + GAP
    } else {
      // Справа не помещается → ставим слева от placeholder'а.
      left = leftEdge - PANEL_WIDTH - GAP
      // Если и слева не помещается (placeholder сам у левого края) —
      // прижимаемся к левому краю экрана.
      if (left < 8) left = 8
    }
    // Защита от выхода вниз.
    if (top + PANEL_HEIGHT > h - 8) top = Math.max(8, h - PANEL_HEIGHT - 8)
    if (top < 8) top = 8
  } else {
    left = rightEdge + GAP
  }

  const isDefault =
    !hasCustomTextStyle(mult, color) &&
    hAlign === null &&
    vAlign === null &&
    fontFamily === null
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

      {/* РЭ.55: Селект шрифта */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-gray-600">Шрифт</span>
          {fontFamily !== null && (
            <button
              type="button"
              onClick={() => handleFontSelect('')}
              className="text-[10px] text-gray-500 hover:text-gray-900"
              title="Сбросить к шрифту из шаблона"
            >
              <RotateCcw size={12} />
            </button>
          )}
        </div>
        <select
          value={fontFamily ?? ''}
          onChange={(e) => handleFontSelect(e.target.value)}
          className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-brand-200 bg-white"
          style={{
            // Применяем выбранный шрифт прямо в select-боксе для preview.
            fontFamily: fontFamily ? `'${fontFamily}', serif` : 'inherit',
          }}
        >
          <option value="">
            {templateFontFamily
              ? `Из шаблона (${templateFontFamily})`
              : 'Из шаблона'}
          </option>
          {AVAILABLE_FONTS.map((f) => (
            <option key={f.family} value={f.family} style={{ fontFamily: `'${f.family}', serif` }}>
              {f.label}
            </option>
          ))}
        </select>
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
                    ? 'border-brand-600 ring-2 ring-brand-200'
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

      {/* РЭ.54: Выравнивание во фрейме */}
      <div className="mb-3">
        <div className="text-xs text-gray-600 mb-1">Выравнивание</div>
        <div className="flex items-center gap-2">
          {/* Горизонтальное */}
          <div className="inline-flex rounded border border-gray-300 overflow-hidden">
            {(['left', 'center', 'right'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => handleHAlign(v)}
                className={`px-2 py-1 text-sm leading-none border-r border-gray-300 last:border-r-0 ${
                  hAlign === v
                    ? 'bg-brand-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-100'
                }`}
                title={
                  v === 'left'
                    ? 'По левому краю'
                    : v === 'center'
                      ? 'По центру (горизонталь)'
                      : 'По правому краю'
                }
                aria-label={`hAlign-${v}`}
              >
                {v === 'left' ? '⇤' : v === 'center' ? '⇔' : '⇥'}
              </button>
            ))}
          </div>
          {/* Вертикальное */}
          <div className="inline-flex rounded border border-gray-300 overflow-hidden">
            {(['top', 'middle', 'bottom'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => handleVAlign(v)}
                className={`px-2 py-1 text-sm leading-none border-r border-gray-300 last:border-r-0 ${
                  vAlign === v
                    ? 'bg-brand-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-100'
                }`}
                title={
                  v === 'top'
                    ? 'По верху'
                    : v === 'middle'
                      ? 'По центру (вертикаль)'
                      : 'По низу'
                }
                aria-label={`vAlign-${v}`}
              >
                {v === 'top' ? '⤒' : v === 'middle' ? '↕' : '⤓'}
              </button>
            ))}
          </div>
          {(hAlign !== null || vAlign !== null) && (
            <button
              type="button"
              onClick={() => {
                setHAlign(null)
                setVAlign(null)
                emitChange(mult, color, null, null, fontFamily)
              }}
              className="text-[10px] text-gray-500 hover:text-gray-900 ml-auto"
              title="Сбросить выравнивание к шаблону"
            >
              <RotateCcw size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-100">
        <button
          type="button"
          onClick={handleReset}
          disabled={isDefault}
          className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 disabled:text-gray-300 disabled:cursor-not-allowed"
          title="Вернуть размер и цвет к настройкам шаблона"
        >
          <RotateCcw size={12} /> По умолчанию
        </button>
        <button
          type="button"
          onClick={onClose}
          className="text-xs px-3 py-1 bg-brand-600 text-white rounded hover:bg-brand-700"
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
