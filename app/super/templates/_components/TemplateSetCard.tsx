'use client'

import type { TemplateSet } from './types'

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

export default function TemplateSetCard({
  template,
  onOpen,
}: {
  template: TemplateSet
  onOpen: () => void
}) {
  return (
    <button
      onClick={onOpen}
      className="card p-5 text-left hover:shadow-md transition-shadow w-full"
    >
      <div className="flex gap-2 mb-3">
        {template.is_global ? (
          <span className="badge-blue">🌍 Global</span>
        ) : (
          <span className="badge-gray">Tenant</span>
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

      <div className="text-xs text-gray-500 font-mono mb-3">{template.slug}</div>

      {template.description && (
        <div className="text-sm text-gray-600 mb-3 line-clamp-2">
          {template.description}
        </div>
      )}

      <div className="text-xs text-gray-500 space-y-0.5">
        <div>
          {template.spread_count} разворотов · {Math.round(template.page_width_mm)}×
          {Math.round(template.page_height_mm)} мм ·{' '}
          {template.facing_pages ? 'разворот' : 'одиночные'}
        </div>
        <div>Создан {formatDate(template.created_at)}</div>
      </div>

      <div className="mt-3 text-sm text-blue-600 font-medium">Открыть →</div>
    </button>
  )
}
