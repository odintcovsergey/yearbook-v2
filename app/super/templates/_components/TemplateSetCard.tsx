'use client'

import { useState, useRef, useEffect } from 'react'
import { Pencil, Copy, Lock, Globe, Download, Upload, Trash2, Ruler, Shapes } from 'lucide-react'
import type { TemplateSet } from './types'
import { resolveDesignFamily, FAMILY_LABELS } from '@/lib/format-adapt'

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

export type CardAction =
  | 'rename'
  | 'duplicate'
  | 'toggle_global'
  | 'toggle_published'
  | 'spine_margin'
  | 'format_family'
  | 'delete'

export default function TemplateSetCard({
  template,
  onOpen,
  onAction,
  busy,
}: {
  template: TemplateSet
  onOpen: () => void
  onAction: (action: CardAction) => void
  busy?: boolean
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Закрытие меню по клику вне него.
  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])

  const pick = (action: CardAction) => {
    setMenuOpen(false)
    onAction(action)
  }

  return (
    <div className="card p-5 relative w-full hover:shadow-md transition-shadow">
      {/* Меню действий (⋮) — поверх карточки, отдельно от области «Открыть». */}
      <div ref={menuRef} className="absolute top-3 right-3 z-10">
        <button
          type="button"
          aria-label="Действия с дизайном"
          disabled={busy}
          onClick={() => setMenuOpen(o => !o)}
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-muted text-muted-foreground disabled:opacity-40"
        >
          <span className="text-xl leading-none">⋮</span>
        </button>
        {menuOpen && (
          <div className="absolute right-0 mt-1 w-56 bg-card border rounded-lg shadow-lg py-1 text-sm">
            <button
              onClick={() => pick('rename')}
              className="w-full text-left px-3 py-2 hover:bg-muted"
            >
              <Pencil size={14} /> Переименовать
            </button>
            <button
              onClick={() => pick('duplicate')}
              className="w-full text-left px-3 py-2 hover:bg-muted"
            >
              <Copy size={14} /> Дублировать
            </button>
            <button
              onClick={() => pick('toggle_global')}
              className="w-full text-left px-3 py-2 hover:bg-muted"
            >
              {template.is_global ? <><Lock size={14} /> Убрать из глобальных</> : <><Globe size={14} /> Сделать глобальным</>}
            </button>
            <button
              onClick={() => pick('toggle_published')}
              className="w-full text-left px-3 py-2 hover:bg-muted"
            >
              {template.is_published ? <><Download size={14} /> В черновик</> : <><Upload size={14} /> Опубликовать</>}
            </button>
            <button
              onClick={() => pick('spine_margin')}
              className="w-full text-left px-3 py-2 hover:bg-muted"
            >
              <Ruler size={14} /> Отступ от корешка
            </button>
            <button
              onClick={() => pick('format_family')}
              className="w-full text-left px-3 py-2 hover:bg-muted"
            >
              <Shapes size={14} /> Семейство формата
            </button>
            <div className="border-t my-1" />
            <button
              onClick={() => pick('delete')}
              className="w-full text-left px-3 py-2 hover:bg-red-50 text-red-600"
            >
              <Trash2 size={14} /> Удалить
            </button>
          </div>
        )}
      </div>

      {/* Кликабельная область — открыть дизайн. */}
      <button
        type="button"
        onClick={onOpen}
        className="text-left w-full pr-8"
      >
        <div className="flex flex-wrap gap-2 mb-3">
          {template.is_global ? (
            <span className="badge-blue inline-flex items-center gap-1"><Globe size={12} /> Global</span>
          ) : (
            <span className="badge-gray">Локальный</span>
          )}
          {template.is_published ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
              Опубликован
            </span>
          ) : (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
              Черновик
            </span>
          )}
          <span className="badge-gray">
            {template.print_type === 'layflat' ? 'Layflat' : 'Soft'}
          </span>
        </div>

        <h3
          className="text-lg mb-1 leading-tight"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {template.name}
        </h3>

        <div className="text-xs text-muted-foreground font-mono mb-3">{template.slug}</div>

        {template.description && (
          <div className="text-sm text-muted-foreground mb-3 line-clamp-2">
            {template.description}
          </div>
        )}

        <div className="text-xs text-muted-foreground space-y-0.5">
          <div>
            {template.spread_count} разворотов · {Math.round(template.page_width_mm)}×
            {Math.round(template.page_height_mm)} мм ·{' '}
            {template.facing_pages ? 'разворот' : 'одиночные'}
          </div>
          <div>
            Семейство: {FAMILY_LABELS[resolveDesignFamily(template)]}
            {template.format_family == null && ' (авто)'}
          </div>
          <div>Создан {formatDate(template.created_at)}</div>
        </div>

        <div className="mt-3 text-sm text-blue-600 font-medium">Открыть →</div>
      </button>
    </div>
  )
}
