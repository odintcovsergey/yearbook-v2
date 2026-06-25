'use client'

/**
 * Модалка «Сменить дизайн» в редакторе альбома (Этап 3 ТЗ docs/tz-design-switch.md).
 *
 * Партнёр выбирает другой дизайн → проверка совместимости (design_switch_check) →
 * если ОК, применяем перенос (design_switch_apply, remap). Текущий дизайн помечен
 * «Текущий» и недоступен для выбора (смена на тот же ничего не даст).
 *
 * Несохранённые правки редактора досылаются перед применением (onBeforeApply),
 * иначе remap взял бы устаревшую сохранённую вёрстку.
 */

import { useEffect, useState } from 'react'
import { X, Check, AlertTriangle } from 'lucide-react'

type Design = { id: string; name: string; slug?: string }

export default function DesignSwitchModal({
  albumId,
  currentTemplateSetId,
  api,
  viewAsSuffix = '',
  onClose,
  onBeforeApply,
  onApplied,
}: {
  albumId: string
  currentTemplateSetId: string | null
  api: (path: string, opts?: RequestInit) => Promise<Response>
  viewAsSuffix?: string
  onClose: () => void
  /** Дослать несохранённые правки перед применением. */
  onBeforeApply: () => Promise<void>
  /** Дизайн применён — перезагрузить редактор. */
  onApplied: () => void
}) {
  const [designs, setDesigns] = useState<Design[] | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [selected, setSelected] = useState<Design | null>(null)
  const [checking, setChecking] = useState(false)
  const [check, setCheck] = useState<{ ok: boolean; message: string | null } | null>(null)
  const [applying, setApplying] = useState(false)
  const [applyErr, setApplyErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await api('/api/tenant?action=designs_list')
        const d = await r.json().catch(() => ({}))
        if (!alive) return
        if (!r.ok) {
          setLoadErr(d.error || 'Не удалось загрузить список дизайнов')
          return
        }
        setDesigns((d.designs ?? []) as Design[])
      } catch {
        if (alive) setLoadErr('Не удалось загрузить список дизайнов')
      }
    })()
    return () => {
      alive = false
    }
  }, [api])

  async function selectDesign(d: Design) {
    if (d.id === currentTemplateSetId) return
    setSelected(d)
    setCheck(null)
    setApplyErr(null)
    setChecking(true)
    try {
      const r = await api(`/api/layout?action=design_switch_check${viewAsSuffix}`, {
        method: 'POST',
        body: JSON.stringify({ album_id: albumId, target_template_set_id: d.id }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        setCheck({ ok: false, message: j.error || 'Не удалось проверить совместимость' })
        return
      }
      setCheck({ ok: !!j.ok, message: (j.message as string | null) ?? null })
    } catch {
      setCheck({ ok: false, message: 'Не удалось проверить совместимость' })
    } finally {
      setChecking(false)
    }
  }

  async function apply() {
    if (!selected || !check?.ok || applying) return
    setApplying(true)
    setApplyErr(null)
    try {
      await onBeforeApply() // дослать несохранённые правки
      const r = await api(`/api/layout?action=design_switch_apply${viewAsSuffix}`, {
        method: 'POST',
        body: JSON.stringify({ album_id: albumId, target_template_set_id: selected.id }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) {
        setApplyErr(j.message || j.error || 'Не удалось сменить дизайн')
        setApplying(false)
        return
      }
      onApplied()
    } catch {
      setApplyErr('Не удалось сменить дизайн')
      setApplying(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-2xl shadow-xl max-w-lg w-full max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-lg font-semibold text-foreground">Сменить дизайн</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto">
          <p className="text-sm text-muted-foreground mb-4">
            Оформление (шрифты, цвета, рамки, фоны) сменится на выбранный дизайн.
            Ваши тексты и кадрирование фотографий сохранятся.
          </p>

          {loadErr && <div className="text-sm text-red-600">{loadErr}</div>}
          {!designs && !loadErr && (
            <div className="text-sm text-muted-foreground">Загрузка дизайнов…</div>
          )}

          <div className="space-y-2">
            {(designs ?? []).map((d) => {
              const isCurrent = d.id === currentTemplateSetId
              const isSel = selected?.id === d.id
              return (
                <button
                  key={d.id}
                  type="button"
                  disabled={isCurrent}
                  onClick={() => selectDesign(d)}
                  className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                    isCurrent
                      ? 'border-border bg-muted cursor-default'
                      : isSel
                        ? 'border-brand-300 bg-brand-50'
                        : 'border-border bg-card hover:bg-muted'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">{d.name}</span>
                    {isCurrent && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-background text-muted-foreground border border-border">
                        Текущий
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>

          {selected && (
            <div className="mt-4">
              {checking && (
                <div className="text-sm text-muted-foreground">Проверяем совместимость…</div>
              )}
              {!checking && check && !check.ok && (
                <div className="flex gap-2 text-sm text-orange-700 bg-orange-50 rounded-lg p-3">
                  <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                  <span>{check.message}</span>
                </div>
              )}
              {!checking && check?.ok && (
                <div className="flex gap-2 text-sm text-brand-700 bg-brand-50 rounded-lg p-3">
                  <Check size={18} className="shrink-0 mt-0.5 text-brand-600" />
                  <span>
                    Можно перейти на «{selected.name}». Тексты и кадрирование сохранятся,
                    оформление обновится.
                  </span>
                </div>
              )}
              {applyErr && <div className="text-sm text-red-600 mt-2">{applyErr}</div>}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-border bg-card hover:bg-muted text-foreground"
          >
            Отмена
          </button>
          <button
            onClick={apply}
            disabled={!check?.ok || applying}
            className="px-4 py-2 text-sm rounded-lg bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {applying ? 'Применяем…' : 'Сменить дизайн'}
          </button>
        </div>
      </div>
    </div>
  )
}
