'use client'

import { useState } from 'react'
import {
  TEXT_STYLE_GROUPS,
  TEXT_STYLE_PALETTE,
  FONT_SIZE_MULT_MIN,
  FONT_SIZE_MULT_MAX,
  type TextStyleGroup,
  type AlbumTextStyleOverrides,
} from '@/lib/text-style'

// РЭ.53.c: модалка глобальных стилей текста альбома.
//
// 6 секций по группам. В каждой:
//   - Slider размера (50..200%) с подписью '... %'
//   - Палитра 10 фиксированных цветов из TEXT_STYLE_PALETTE
//   - Кнопка '↺ По умолчанию' (очищает группу)
//
// Кнопки внизу:
//   - 'Сохранить' — POST update_album с новым text_style_overrides
//   - 'Отмена'    — закрыть без сохранения
//   - 'Сбросить всё' — очистить все группы (text_style_overrides = null)
//
// Применение оптимистичное: parent сразу видит изменения в canvas.

const GROUP_LABELS: Record<TextStyleGroup, string> = {
  studentname: 'Имена учеников',
  studentquote: 'Цитаты учеников',
  teachername: 'ФИО учителей',
  teacherrole: 'Должности учителей',
  headteachername: 'ФИО классного руководителя',
  headtextframe: 'Текст-обращение классного руководителя',
}

const GROUP_HINTS: Record<TextStyleGroup, string> = {
  studentname: 'Применяется ко всем placeholder\'ам studentname_N.',
  studentquote: 'Применяется ко всем placeholder\'ам studentquote_N.',
  teachername: 'ФИО основного учителя + учителей-предметников (teachername_N, subjectname_N).',
  teacherrole: 'Должности всех учителей (teacherrole_N, subjectrole_N, headteacherrole).',
  headteachername: 'Отдельная группа потому что обычно крупнее остальных учителей.',
  headtextframe: 'Длинный текст-обращение от классного руководителя.',
}

type Props = {
  initialOverrides: AlbumTextStyleOverrides
  /**
   * Optimistic preview: каждое изменение в UI сразу шлёт callback —
   * parent обновляет state и canvas рендерит изменения live.
   */
  onPreview: (overrides: AlbumTextStyleOverrides) => void
  /**
   * Сохранение в БД. Parent делает POST update_album, при ошибке
   * откатывает state. Модалка остаётся открытой пока promise не
   * resolved (showing loading state).
   */
  onSave: (overrides: AlbumTextStyleOverrides) => Promise<void>
  onClose: () => void
}

export default function AlbumTextStylesModal({
  initialOverrides,
  onPreview,
  onSave,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<AlbumTextStyleOverrides>(initialOverrides)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Обновить значение в группе + сразу preview parent'у.
  function updateGroup(
    group: TextStyleGroup,
    patch: { size_pct?: number | null; color?: string | null },
  ) {
    setDraft((prev) => {
      const cur = prev[group] ?? { size_pct: null, color: null }
      const next = {
        size_pct: 'size_pct' in patch ? patch.size_pct ?? null : cur.size_pct,
        color: 'color' in patch ? patch.color ?? null : cur.color,
      }
      // Если оба null → удаляем группу.
      const newDraft = { ...prev }
      if (next.size_pct === null && next.color === null) {
        delete newDraft[group]
      } else {
        newDraft[group] = next
      }
      onPreview(newDraft)
      return newDraft
    })
  }

  function resetGroup(group: TextStyleGroup) {
    setDraft((prev) => {
      const newDraft = { ...prev }
      delete newDraft[group]
      onPreview(newDraft)
      return newDraft
    })
  }

  function resetAll() {
    setDraft({})
    onPreview({})
  }

  async function handleSave() {
    setError(null)
    setSaving(true)
    try {
      await onSave(draft)
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  function handleCancel() {
    // Откат preview: возвращаем initial state в parent.
    onPreview(initialOverrides)
    onClose()
  }

  const hasAnyOverride = Object.keys(draft).length > 0

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4"
      onClick={handleCancel}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Шапка */}
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h3 className="text-lg font-semibold">Стили текстов альбома</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Один раз настраиваете для группы — применяется ко всем
              соответствующим placeholder&apos;ам. Точечные правки
              (клик на текст) переопределяют глобальные.
            </p>
          </div>
          <button
            onClick={handleCancel}
            className="text-gray-400 hover:text-gray-700 text-2xl leading-none"
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>

        {/* Содержимое — список групп */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {TEXT_STYLE_GROUPS.map((group) => {
            const ov = draft[group] ?? null
            const size = ov?.size_pct ?? 100
            const color = ov?.color ?? null
            const isModified = ov !== null
            return (
              <div
                key={group}
                className={`border rounded-lg p-3 ${
                  isModified ? 'border-blue-300 bg-blue-50/30' : 'border-gray-200'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="font-medium text-gray-900 text-sm">
                    {GROUP_LABELS[group]}
                  </div>
                  {isModified && (
                    <button
                      type="button"
                      onClick={() => resetGroup(group)}
                      className="text-xs text-gray-500 hover:text-gray-900"
                    >
                      ↺ По умолчанию
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-500 mb-2">{GROUP_HINTS[group]}</p>

                {/* Slider размера */}
                <div className="mb-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-600">Размер</span>
                    <span className="text-xs text-gray-900 font-mono tabular-nums">
                      {ov?.size_pct !== null && ov?.size_pct !== undefined
                        ? `${size}%`
                        : 'из шаблона'}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={FONT_SIZE_MULT_MIN * 100}
                    max={FONT_SIZE_MULT_MAX * 100}
                    step={5}
                    value={size}
                    onChange={(e) => {
                      const pct = Number(e.target.value)
                      // Если ставят 100% — удаляем (это default).
                      updateGroup(group, {
                        size_pct: pct === 100 ? null : pct,
                      })
                    }}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                {/* Палитра цветов */}
                <div>
                  <div className="text-xs text-gray-600 mb-1">
                    Цвет{' '}
                    {color === null && (
                      <span className="text-gray-400">(из шаблона)</span>
                    )}
                  </div>
                  <div className="grid grid-cols-10 gap-1.5">
                    {TEXT_STYLE_PALETTE.map(({ hex, name }) => {
                      const isActive =
                        color !== null && color.toUpperCase() === hex.toUpperCase()
                      return (
                        <button
                          key={hex}
                          type="button"
                          onClick={() =>
                            updateGroup(group, {
                              color: isActive ? null : hex.toUpperCase(),
                            })
                          }
                          title={`${name} (${hex})`}
                          aria-label={name}
                          className={`w-7 h-7 rounded border transition-all ${
                            isActive
                              ? 'border-blue-600 ring-2 ring-blue-200'
                              : 'border-gray-300 hover:border-gray-400'
                          }`}
                          style={{ backgroundColor: hex }}
                        >
                          {isActive && (
                            <span
                              className="block text-center leading-none text-xs font-bold"
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
              </div>
            )
          })}
        </div>

        {error && (
          <div className="px-4 py-2 bg-red-50 border-t border-red-200 text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Подвал */}
        <div className="border-t p-4 flex items-center justify-between gap-2 bg-gray-50">
          <button
            type="button"
            onClick={resetAll}
            disabled={!hasAnyOverride || saving}
            className="text-sm text-gray-600 hover:text-gray-900 disabled:text-gray-300 disabled:cursor-not-allowed"
          >
            ↺ Сбросить всё
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCancel}
              disabled={saving}
              className="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-100 text-gray-700 rounded text-sm disabled:opacity-50"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm disabled:opacity-50"
            >
              {saving ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function isLightColor(hex: string): boolean {
  const cleaned = hex.replace('#', '')
  if (cleaned.length !== 6) return true
  const r = parseInt(cleaned.slice(0, 2), 16) / 255
  const g = parseInt(cleaned.slice(2, 4), 16) / 255
  const b = parseInt(cleaned.slice(4, 6), 16) / 255
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return lum > 0.6
}
