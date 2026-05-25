/**
 * РЭ.28.5: модалка ввода размеров для клонирования template_set'а.
 *
 * Открывается с карточки глобального дизайна в /app/templates.
 * Партнёр задаёт:
 *   • Название клона
 *   • Размеры страницы (ширина × высота в мм)
 *     — рядом подсказка «≈ NNNN px» при 300 DPI (информационная)
 *   • Опционально: припуск под обрез (bleed_mm)
 *
 * При вводе размеров в реальном времени проверяется совместимость
 * пропорций через checkAspectCompatibility из lib/template-set-clone:
 *   ok      — нейтрально (зелёное сообщение об отличии в %)
 *   warning — жёлтый блок, разрешено создать
 *   blocked — красный блок, кнопка «Создать» disabled
 *
 * При submit — POST /api/tenant action='template_set_clone'.
 * При успехе — onSuccess(newTsId) (родитель закроет модалку и
 * перезагрузит список).
 */

'use client'

import { useState, useMemo, useCallback } from 'react'
import { api } from '@/lib/api-client'
import {
  checkAspectCompatibility,
  mmToPx,
} from '@/lib/template-set-clone'

interface SourceDesign {
  id: string
  name: string
  page_width_mm: number | null
  page_height_mm: number | null
}

interface Props {
  source: SourceDesign
  /** Исходный bleed_mm (из БД, если есть). Используется как дефолт. */
  sourceBleedMm?: number | null
  onClose: () => void
  onSuccess: (newTsId: string) => void
}

// api() с auto-refresh теперь импортируется из @/lib/api-client.

export function CloneTemplateSetModal({
  source,
  sourceBleedMm,
  onClose,
  onSuccess,
}: Props) {
  // Дефолты из источника. Если у источника нет размеров — A4.
  const defaultW = source.page_width_mm ?? 210
  const defaultH = source.page_height_mm ?? 297
  const defaultBleed = sourceBleedMm ?? 3

  // Поля формы.
  const [name, setName] = useState(`${source.name} (копия)`)
  const [widthStr, setWidthStr] = useState(String(Math.round(defaultW)))
  const [heightStr, setHeightStr] = useState(String(Math.round(defaultH)))
  const [bleedStr, setBleedStr] = useState(String(defaultBleed))

  // Состояние запроса.
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Парсим числа из строк (поля могут быть пустыми во время ввода).
  const widthNum = useMemo(() => {
    const n = parseFloat(widthStr.replace(',', '.'))
    return Number.isFinite(n) ? n : NaN
  }, [widthStr])
  const heightNum = useMemo(() => {
    const n = parseFloat(heightStr.replace(',', '.'))
    return Number.isFinite(n) ? n : NaN
  }, [heightStr])
  const bleedNum = useMemo(() => {
    if (bleedStr.trim() === '') return NaN
    const n = parseFloat(bleedStr.replace(',', '.'))
    return Number.isFinite(n) ? n : NaN
  }, [bleedStr])

  // Real-time check совместимости пропорций.
  const aspectCheck = useMemo(() => {
    if (
      !Number.isFinite(widthNum) ||
      !Number.isFinite(heightNum) ||
      widthNum <= 0 ||
      heightNum <= 0
    ) {
      return null
    }
    return checkAspectCompatibility(defaultW, defaultH, widthNum, heightNum)
  }, [defaultW, defaultH, widthNum, heightNum])

  // Валидация формы.
  const validation = useMemo(() => {
    const errors: string[] = []
    if (name.trim().length === 0) errors.push('Введите название')
    if (!Number.isFinite(widthNum) || widthNum < 50 || widthNum > 500) {
      errors.push('Ширина должна быть числом 50-500 мм')
    }
    if (!Number.isFinite(heightNum) || heightNum < 50 || heightNum > 500) {
      errors.push('Высота должна быть числом 50-500 мм')
    }
    // bleed: пусто = OK (не передаём в API), число = должно быть 0-20
    if (bleedStr.trim() !== '') {
      if (!Number.isFinite(bleedNum) || bleedNum < 0 || bleedNum > 20) {
        errors.push('Припуск должен быть числом 0-20 мм или пустым')
      }
    }
    if (aspectCheck?.level === 'blocked') {
      errors.push('Пропорции несовместимы — выберите другие размеры')
    }
    return { ok: errors.length === 0, errors }
  }, [name, widthNum, heightNum, bleedStr, bleedNum, aspectCheck])

  const handleSubmit = useCallback(async () => {
    if (!validation.ok) return
    setSubmitting(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        action: 'template_set_clone',
        source_template_set_id: source.id,
        new_name: name.trim(),
        new_page_width_mm: widthNum,
        new_page_height_mm: heightNum,
      }
      // bleed_mm: только если поле заполнено, иначе пусть API возьмёт
      // из source (см. РЭ.28.2 prepareTemplateSetClone).
      if (bleedStr.trim() !== '' && Number.isFinite(bleedNum)) {
        body.new_bleed_mm = bleedNum
      }

      const r = await api('/api/tenant', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        throw new Error(data.error ?? `HTTP ${r.status}`)
      }
      // Успех — пробрасываем новый ID родителю.
      onSuccess(String(data.template_set_id))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка создания клона')
    } finally {
      setSubmitting(false)
    }
  }, [
    validation.ok,
    source.id,
    name,
    widthNum,
    heightNum,
    bleedStr,
    bleedNum,
    onSuccess,
  ])

  // Цвет рамки aspect-блока по уровню.
  const aspectBoxClass =
    aspectCheck === null
      ? 'border-gray-200 bg-gray-50 text-gray-500'
      : aspectCheck.level === 'ok'
        ? 'border-green-200 bg-green-50 text-green-800'
        : aspectCheck.level === 'warning'
          ? 'border-amber-300 bg-amber-50 text-amber-800'
          : 'border-red-300 bg-red-50 text-red-800'

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Шапка */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            Создать дизайн на основе «{source.name}»
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-xl leading-none"
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>

        {/* Тело */}
        <div className="px-5 py-4 space-y-4">
          {/* Название */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Название
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Например: Мой Стандарт 21×30"
            />
          </div>

          {/* Размеры страницы */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Ширина страницы, мм
              </label>
              <input
                type="number"
                value={widthStr}
                onChange={(e) => setWidthStr(e.target.value)}
                disabled={submitting}
                min={50}
                max={500}
                step={1}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="text-xs text-gray-500 mt-1">
                {Number.isFinite(widthNum) && widthNum > 0
                  ? `≈ ${mmToPx(widthNum)} px (при 300 DPI)`
                  : '\u00a0'}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Высота страницы, мм
              </label>
              <input
                type="number"
                value={heightStr}
                onChange={(e) => setHeightStr(e.target.value)}
                disabled={submitting}
                min={50}
                max={500}
                step={1}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="text-xs text-gray-500 mt-1">
                {Number.isFinite(heightNum) && heightNum > 0
                  ? `≈ ${mmToPx(heightNum)} px (при 300 DPI)`
                  : '\u00a0'}
              </div>
            </div>
          </div>

          {/* Bleed */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Припуск под обрез, мм
              <span className="font-normal text-gray-400 ml-1">(опционально)</span>
            </label>
            <input
              type="number"
              value={bleedStr}
              onChange={(e) => setBleedStr(e.target.value)}
              disabled={submitting}
              min={0}
              max={20}
              step={0.5}
              placeholder={`по умолчанию ${defaultBleed}`}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="text-xs text-gray-500 mt-1">
              {Number.isFinite(bleedNum) && bleedNum >= 0
                ? `≈ ${mmToPx(bleedNum)} px (при 300 DPI)`
                : 'Будет использовано значение из исходного дизайна'}
            </div>
          </div>

          {/* Aspect-check блок */}
          {aspectCheck && (
            <div
              className={`px-3 py-2 border rounded text-xs ${aspectBoxClass}`}
            >
              <div className="font-medium mb-0.5">
                {aspectCheck.level === 'ok' && '✓ Пропорции подходят'}
                {aspectCheck.level === 'warning' && '⚠ Проверьте пропорции'}
                {aspectCheck.level === 'blocked' && '⛔ Пропорции несовместимы'}
              </div>
              <div>{aspectCheck.message}</div>
            </div>
          )}

          {/* Описание ниже формы */}
          <div className="text-xs text-gray-500 leading-relaxed border-t border-gray-100 pt-3">
            При клонировании создастся независимая копия исходного дизайна
            с пересчётом всех мастеров и placeholder&apos;ов под новые размеры.
            Все mm-значения округляются до целых пикселей при 300 DPI —
            это даёт точную геометрию для типографии.
          </div>

          {/* Ошибки */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Футер */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200 bg-gray-50 rounded-b-lg">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm text-gray-700 hover:text-gray-900 disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !validation.ok}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Создание...' : 'Создать'}
          </button>
        </div>
      </div>
    </div>
  )
}
