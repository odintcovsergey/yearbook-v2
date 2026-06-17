'use client'

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { X } from 'lucide-react'
import type { SpreadTemplate } from '@/lib/album-builder/types'

const AlbumSpreadCanvas = dynamic(() => import('./AlbumSpreadCanvas'), {
  ssr: false,
  loading: () => null,
})

// ─── TemplatePickerModal ──────────────────────────────────────────────────
//
// М.2/М.3 — модал выбора шаблона разворота. Используется для:
//   1. Добавления нового пустого разворота (М.2): партнёр выбирает шаблон,
//      создаётся spread с data={} и вставляется в layout.spreads.
//   2. Замены шаблона существующего разворота (М.3): партнёр меняет
//      шаблон, data перепривязывается к новым placeholder'ам.
//
// Группировка шаблонов:
//   - По page_role (student, teacher, common, intro)
//   - Внутри группы — по sort_order
//   - Поиск по name + audit_notes
//
// Превью каждого шаблона рисуется через AlbumSpreadCanvas с пустым
// instance (data={}) — это показывает структуру placeholder'ов.

import { isMasterAllowedForPrintType } from '@/lib/album-builder'
import { humanMasterLabel } from '@/lib/album-builder/master-label'

type Props = {
  templates: SpreadTemplate[]
  title: string
  description?: string
  onSelect: (template: SpreadTemplate) => void
  onClose: () => void
  /**
   * РЭ.27.5: тип переплёта альбома. Если 'soft' — spread-мастера
   * (фото на разворот) показываются disabled с подсказкой
   * «недоступно для мягких листов». Если 'layflat' (или undefined
   * для обратной совместимости) — все мастера доступны.
   */
  printType?: 'layflat' | 'soft'
}

const PREVIEW_WIDTH = 200

// Метки для page_role (RU)
const ROLE_LABELS: Record<string, string> = {
  student: 'Портреты',
  student_grid: 'Сетка портретов',
  student_overflow: 'Дополнительные портреты',
  student_last: 'Последний портретный',
  teacher_left: 'Учителя (левый)',
  teacher_right: 'Учителя (правый)',
  common: 'Общий раздел',
  intro: 'Заглавный',
  cover: 'Обложка',
}

export default function TemplatePickerModal({
  templates,
  title,
  description,
  onSelect,
  onClose,
  printType,
}: Props) {
  const [query, setQuery] = useState('')

  // Esc закрывает модал
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Фильтрация + группировка
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = templates.filter((t) => {
      if (!q) return true
      const haystack = [
        t.name,
        t.page_role ?? '',
        t.audit_notes ?? '',
      ].join(' ').toLowerCase()
      return haystack.includes(q)
    })

    // Группируем по page_role
    const byRole = new Map<string, SpreadTemplate[]>()
    for (const t of filtered) {
      const role = t.page_role ?? 'other'
      if (!byRole.has(role)) byRole.set(role, [])
      byRole.get(role)!.push(t)
    }

    // Сортируем внутри группы
    Array.from(byRole.values()).forEach((list) => {
      list.sort((a: SpreadTemplate, b: SpreadTemplate) => a.sort_order - b.sort_order)
    })

    // Стабильный порядок групп
    const orderHint = [
      'student', 'student_grid', 'student_overflow', 'student_last',
      'teacher_left', 'teacher_right', 'common', 'intro', 'cover', 'other',
    ]
    const result: { role: string; label: string; list: SpreadTemplate[] }[] = []
    for (const role of orderHint) {
      const list = byRole.get(role)
      if (list && list.length > 0) {
        result.push({
          role,
          label: ROLE_LABELS[role] ?? role,
          list,
        })
      }
    }
    // Невошедшие роли (если появятся новые) — в конец
    Array.from(byRole.entries()).forEach(([role, list]) => {
      if (!orderHint.includes(role)) {
        result.push({ role, label: ROLE_LABELS[role] ?? role, list })
      }
    })
    return result
  }, [templates, query])

  // Пустой instance для preview (data={})
  function emptyInstance(template: SpreadTemplate) {
    return {
      spread_index: 0,
      template_id: template.id,
      template_name: template.name,
      data: {} as Record<string, string | null>,
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-xl shadow-2xl max-w-5xl w-full max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
            {description && (
              <p className="text-xs text-muted-foreground mt-1">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground leading-none"
            title="Закрыть (Esc)"
          >
            <X size={20} />
          </button>
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b border-border">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по названию шаблона…"
            className="w-full px-3 py-2 text-sm border border-border rounded focus:outline-none focus:border-brand-400"
            autoFocus
          />
        </div>

        {/* Templates grid */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Не найдено шаблонов по запросу «{query}»
            </p>
          ) : (
            groups.map(({ role, label, list }) => (
              <div key={role} className="mb-6 last:mb-0">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  {label} <span className="text-muted-foreground ml-1">({list.length})</span>
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {list.map((t) => {
                    // РЭ.27.5: для soft-альбомов spread-мастера запрещены.
                    // Делаем кнопку disabled с visual cue и tooltip.
                    const allowed = printType
                      ? isMasterAllowedForPrintType(t, printType)
                      : true
                    return (
                    <button
                      key={t.id}
                      type="button"
                      disabled={!allowed}
                      onClick={() => {
                        if (!allowed) return
                        onSelect(t)
                        onClose()
                      }}
                      className={
                        allowed
                          ? 'text-left border border-border rounded-lg overflow-hidden hover:border-brand-400 hover:shadow-md transition-all bg-card'
                          : 'text-left border border-border rounded-lg overflow-hidden bg-card opacity-40 cursor-not-allowed'
                      }
                      title={
                        !allowed
                          ? 'Недоступно для мягких листов — мастер «фото на разворот» пересёк бы корешок'
                          : t.audit_notes ?? t.name
                      }
                    >
                      <div className="bg-muted">
                        <AlbumSpreadCanvas
                          instance={emptyInstance(t)}
                          template={t}
                          containerWidth={PREVIEW_WIDTH}
                          mode="preview"
                        />
                      </div>
                      <div className="px-2 py-1.5">
                        <p className="text-xs font-medium text-foreground truncate">
                          {humanMasterLabel(t)}
                        </p>
                        {humanMasterLabel(t) !== t.name && (
                          <p className="text-[10px] text-muted-foreground truncate">
                            {t.name}
                          </p>
                        )}
                        {t.is_fallback && (
                          <p className="text-[10px] text-amber-600 mt-0.5">fallback</p>
                        )}
                        {!allowed && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            не для мягких листов
                          </p>
                        )}
                      </div>
                    </button>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
