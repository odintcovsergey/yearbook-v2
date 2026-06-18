'use client'

/**
 * CoverTextStylesModal — глобальные стили текстов обложки (аналог
 * AlbumTextStylesModal для разворотов). Партнёр задаёт шрифт/размер/цвет/
 * выравнивание по смысловым группам (Заголовок, Имя выпускника, Реквизиты …)
 * — применяется ко ВСЕМ обложкам заказа. Точечный клик по тексту на холсте
 * переопределяет глобальный стиль.
 */

import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import {
  TEXT_STYLE_PALETTE,
  FONT_SIZE_MULT_MIN,
  FONT_SIZE_MULT_MAX,
  AVAILABLE_FONTS,
  type TextStyleGroupOverride,
  type TextHAlign,
  type TextVAlign,
} from '@/lib/text-style'
import {
  COVER_TEXT_GROUPS,
  COVER_GROUP_LABELS,
  COVER_GROUP_HINTS,
  type CoverTextGroup,
  type CoverTextStyleOverrides,
} from '@/lib/cover/text-styles'

type Props = {
  initialOverrides: CoverTextStyleOverrides
  onPreview: (overrides: CoverTextStyleOverrides) => void
  onSave: (overrides: CoverTextStyleOverrides) => Promise<void>
  onClose: () => void
}

export default function CoverTextStylesModal({ initialOverrides, onPreview, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<CoverTextStyleOverrides>(initialOverrides)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function updateGroup(
    group: CoverTextGroup,
    patch: {
      size_pct?: number | null
      color?: string | null
      halign?: TextHAlign | null
      valign?: TextVAlign | null
      font_family?: string | null
    },
  ) {
    setDraft((prev) => {
      const cur = prev[group] ?? { size_pct: null, color: null, halign: null, valign: null, font_family: null }
      const next: TextStyleGroupOverride = {
        size_pct: 'size_pct' in patch ? patch.size_pct ?? null : cur.size_pct ?? null,
        color: 'color' in patch ? patch.color ?? null : cur.color ?? null,
        halign: 'halign' in patch ? patch.halign ?? null : cur.halign ?? null,
        valign: 'valign' in patch ? patch.valign ?? null : cur.valign ?? null,
        font_family: 'font_family' in patch ? patch.font_family ?? null : cur.font_family ?? null,
      }
      const newDraft = { ...prev }
      if (next.size_pct === null && next.color === null && next.halign === null && next.valign === null && next.font_family === null) {
        delete newDraft[group]
      } else {
        newDraft[group] = next
      }
      onPreview(newDraft)
      return newDraft
    })
  }

  function resetGroup(group: CoverTextGroup) {
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
    onPreview(initialOverrides)
    onClose()
  }

  const hasAnyOverride = Object.keys(draft).length > 0

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4" onClick={handleCancel}>
      <div className="bg-card rounded-lg shadow-xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div>
            <h3 className="text-base font-semibold">Стили текстов обложек</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Настраивается для группы — применяется ко всем обложкам.
              Точечный клик по тексту переопределяет глобальный стиль.
            </p>
          </div>
          <button onClick={handleCancel} className="text-muted-foreground hover:text-foreground text-2xl leading-none ml-2" aria-label="Закрыть">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {COVER_TEXT_GROUPS.map((group) => {
              const ov = draft[group] ?? null
              const size = ov?.size_pct ?? 100
              const color = ov?.color ?? null
              const isModified = ov !== null
              return (
                <div key={group} className={`border rounded-lg p-2.5 ${isModified ? 'border-brand-300 bg-brand-50' : 'border-border'}`}>
                  <div className="flex items-baseline justify-between mb-1.5">
                    <div className="font-medium text-foreground text-sm truncate">{COVER_GROUP_LABELS[group]}</div>
                    {isModified && (
                      <button type="button" onClick={() => resetGroup(group)} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground whitespace-nowrap ml-2">
                        <RotateCcw size={11} /> сброс
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground font-mono mb-2 truncate" title={COVER_GROUP_HINTS[group]}>{COVER_GROUP_HINTS[group]}</p>

                  {/* Шрифт */}
                  <div className="mb-2">
                    <div className="text-[11px] text-muted-foreground mb-0.5">
                      Шрифт {!ov?.font_family && <span className="text-muted-foreground">(из шаблона)</span>}
                    </div>
                    <select
                      value={ov?.font_family ?? ''}
                      onChange={(e) => updateGroup(group, { font_family: e.target.value === '' ? null : e.target.value })}
                      className="w-full px-2 py-1 text-[11px] border border-border rounded bg-card focus:outline-none focus:ring-2 focus:ring-brand-200"
                      style={{ fontFamily: ov?.font_family ? `'${ov.font_family}', serif` : 'inherit' }}
                    >
                      <option value="">Из шаблона</option>
                      {AVAILABLE_FONTS.map((f) => (
                        <option key={f.family} value={f.family} style={{ fontFamily: `'${f.family}', serif` }}>{f.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Размер */}
                  <div className="mb-2">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[11px] text-muted-foreground">Размер</span>
                      <span className="text-[11px] text-foreground font-mono tabular-nums">
                        {ov?.size_pct !== null && ov?.size_pct !== undefined ? `${size}%` : 'из шаблона'}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={FONT_SIZE_MULT_MIN * 100}
                      max={FONT_SIZE_MULT_MAX * 100}
                      step={5}
                      value={size}
                      onChange={(e) => { const pct = Number(e.target.value); updateGroup(group, { size_pct: pct === 100 ? null : pct }) }}
                      className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Цвет */}
                  <div className="mb-2">
                    <div className="text-[11px] text-muted-foreground mb-1">
                      Цвет {color === null && <span className="text-muted-foreground">(из шаблона)</span>}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {TEXT_STYLE_PALETTE.map(({ hex, name }) => {
                        const isActive = color !== null && color.toUpperCase() === hex.toUpperCase()
                        return (
                          <button
                            key={hex}
                            type="button"
                            onClick={() => updateGroup(group, { color: isActive ? null : hex.toUpperCase() })}
                            title={`${name} (${hex})`}
                            aria-label={name}
                            className={`w-6 h-6 rounded border transition-all ${isActive ? 'border-brand-600 ring-2 ring-brand-200' : 'border-border hover:border-border'}`}
                            style={{ backgroundColor: hex }}
                          >
                            {isActive && (
                              <span className="block text-center leading-none text-[10px] font-bold" style={{ color: isLightColor(hex) ? '#000' : '#FFF' }}>✓</span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Выравнивание */}
                  <div>
                    <div className="text-[11px] text-muted-foreground mb-1">
                      Выравнивание {ov?.halign == null && ov?.valign == null && <span className="text-muted-foreground">(из шаблона)</span>}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="inline-flex rounded border border-border overflow-hidden">
                        {(['left', 'center', 'right'] as const).map((v) => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => updateGroup(group, { halign: ov?.halign === v ? null : v })}
                            className={`px-1.5 py-0.5 text-[11px] leading-none border-r border-border last:border-r-0 ${ov?.halign === v ? 'bg-brand-600 text-white' : 'bg-card text-foreground hover:bg-muted'}`}
                            title={v === 'left' ? 'По левому краю' : v === 'center' ? 'По центру (горизонталь)' : 'По правому краю'}
                            aria-label={`hAlign-${v}`}
                          >
                            {v === 'left' ? '⇤' : v === 'center' ? '⇔' : '⇥'}
                          </button>
                        ))}
                      </div>
                      <div className="inline-flex rounded border border-border overflow-hidden">
                        {(['top', 'middle', 'bottom'] as const).map((v) => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => updateGroup(group, { valign: ov?.valign === v ? null : v })}
                            className={`px-1.5 py-0.5 text-[11px] leading-none border-r border-border last:border-r-0 ${ov?.valign === v ? 'bg-brand-600 text-white' : 'bg-card text-foreground hover:bg-muted'}`}
                            title={v === 'top' ? 'По верху' : v === 'middle' ? 'По центру (вертикаль)' : 'По низу'}
                            aria-label={`vAlign-${v}`}
                          >
                            {v === 'top' ? '⤒' : v === 'middle' ? '↕' : '⤓'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {error && (
          <div className="px-4 py-2 bg-red-50 border-t border-red-200 text-red-700 text-sm">{error}</div>
        )}

        <div className="border-t px-3 py-2 flex items-center justify-between gap-2 bg-muted">
          <button type="button" onClick={resetAll} disabled={!hasAnyOverride || saving} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:text-muted-foreground disabled:cursor-not-allowed">
            <RotateCcw size={12} /> Сбросить всё
          </button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleCancel} disabled={saving} className="px-3 py-1.5 bg-card border border-border hover:bg-muted text-foreground rounded text-sm disabled:opacity-50">Отмена</button>
            <button type="button" onClick={handleSave} disabled={saving} className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded text-sm disabled:opacity-50">
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
