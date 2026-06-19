'use client'

/**
 * Панель «Видимость элементов» редактора обложек. РУЧНОЕ скрытие/показ любого
 * элемента (QR, лого, фото, текст, декор) поверх авто-скрытия пустых слотов.
 *
 * Хранится как `__hidden__<label>`='1' в cover_edits (см. lib/cover/editor-merge,
 * hiddenOverridesFromData). Контекст применения — как у фона: для портретной
 * (ученик) поштучно, иначе шаблонно; чекбокс «ко всем такого типа» переключает.
 */

import { useState } from 'react'
import { X, Eye, EyeOff } from 'lucide-react'

export type CoverElement = {
  label: string
  name: string
  hidden: boolean
}

type Props = {
  elements: CoverElement[]
  isPerStudent: boolean
  typeLabel: string
  /** hidden=true → скрыть, false → показать. applyToAll → шаблонно на весь тип. */
  onToggle: (label: string, hidden: boolean, applyToAll: boolean) => void
  onClose: () => void
}

export default function CoverVisibilityPanel({ elements, isPerStudent, typeLabel, onToggle, onClose }: Props) {
  const [applyToAll, setApplyToAll] = useState(false)
  const visible = elements.filter((e) => !e.hidden)
  const hidden = elements.filter((e) => e.hidden)

  const Row = ({ el }: { el: CoverElement }) => (
    <div className="flex items-center justify-between gap-2 py-1.5 px-2 rounded hover:bg-muted">
      <span className={`text-sm truncate ${el.hidden ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{el.name}</span>
      <button
        type="button"
        onClick={() => onToggle(el.label, !el.hidden, applyToAll)}
        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-border bg-card hover:bg-muted transition-colors shrink-0"
        title={el.hidden ? 'Показать элемент' : 'Скрыть элемент'}
      >
        {el.hidden ? <><Eye size={14} /> Показать</> : <><EyeOff size={14} /> Скрыть</>}
      </button>
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card p-5 w-full max-w-md max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold" style={{ fontFamily: 'var(--font-display)' }}>Видимость элементов</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Закрыть"><X size={18} /></button>
        </div>

        {isPerStudent && (
          <label className="flex items-center gap-2 mb-2 text-sm cursor-pointer">
            <input type="checkbox" checked={applyToAll} onChange={(e) => setApplyToAll(e.target.checked)} />
            Применить ко всем обложкам типа «{typeLabel}»
          </label>
        )}
        <div className="text-xs text-muted-foreground mb-3">
          Скрытый элемент не удаляется — его можно вернуть. Пустые слоты прячутся автоматически.
        </div>

        {elements.length === 0 && (
          <div className="text-sm text-muted-foreground py-4 text-center">Нет элементов для настройки.</div>
        )}

        {visible.length > 0 && (
          <div className="mb-3">
            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">На обложке</div>
            <div>{visible.map((el) => <Row key={el.label} el={el} />)}</div>
          </div>
        )}

        {hidden.length > 0 && (
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Скрытые ({hidden.length})</div>
            <div>{hidden.map((el) => <Row key={el.label} el={el} />)}</div>
          </div>
        )}
      </div>
    </div>
  )
}
