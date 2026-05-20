/**
 * РЭ.23.4: страница admin-tool каталога мастеров /super/master-catalog.
 *
 * Назначение:
 * - Сергей (superadmin) видит все свои мастера в template_set OkeyBook
 *   с автогенерированными SVG-превью.
 * - Может проставить display_label (человеко-читаемое название) для
 *   каждого мастера через inline-редактор.
 * - Фильтр по page_role позволяет сосредоточиться на одной группе
 *   мастеров (cover, student_grid, teacher_left и т.д.).
 *
 * Что показывает карточка:
 * - SVG-превью (через dangerouslySetInnerHTML)
 * - name (технический, мелким серым)
 * - display_label — input для inline-редактирования (placeholder=name)
 * - page_role (badge)
 * - slot_capacity (компактно — students=4, photos_full=1, etc.)
 *
 * Сохранение display_label: при потере фокуса (onBlur) делаем POST
 * template_set_update_display_label. Если значение не изменилось —
 * запрос не отправляется. Лоадер на карточке во время запроса.
 */

'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'

// ─── Типы (синхронны с API ответом template_set_list_with_previews) ────────

interface SlotCapacity {
  students?: number
  teachers?: number
  head_teacher?: number
  photos_full?: number
  photos_half?: number
  has_quote?: boolean
  has_portrait?: boolean
  has_name?: boolean
  [k: string]: unknown
}

interface MasterEntry {
  id: string
  name: string
  display_label: string | null
  template_set_id: string
  page_role: string | null
  slot_capacity: SlotCapacity | null
  is_spread: boolean
  preview_svg: string
}

interface TemplateSetEntry {
  id: string
  name: string
  slug: string
  tenant_id: string | null
}

interface AuthData {
  authenticated: boolean
  user?: { id: string; email: string; full_name: string; role: string }
  isLegacy?: boolean
}

const api = (path: string, opts?: RequestInit) =>
  fetch(path, {
    ...opts,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
  })

// ─── Главный компонент ─────────────────────────────────────────────────────

export default function MasterCatalogPage() {
  const router = useRouter()
  const [authChecked, setAuthChecked] = useState(false)
  const [masters, setMasters] = useState<MasterEntry[]>([])
  const [templateSets, setTemplateSets] = useState<TemplateSetEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [roleFilter, setRoleFilter] = useState<string>('all')

  useEffect(() => {
    api('/api/auth')
      .then(r => r.ok ? r.json() : null)
      .then((d: AuthData | null) => {
        if (!d?.authenticated || d.isLegacy) { router.push('/login'); return }
        if (d.user?.role !== 'superadmin') { router.push('/app'); return }
        setAuthChecked(true)
      })
      .catch(() => router.push('/login'))
  }, [router])

  const loadMasters = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await api('/api/tenant?action=template_set_list_with_previews')
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        throw new Error(d.error ?? `HTTP ${r.status}`)
      }
      const data = await r.json()
      setMasters(data.masters ?? [])
      setTemplateSets(data.template_sets ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authChecked) loadMasters()
  }, [authChecked, loadMasters])

  // Список уникальных page_role для фильтра.
  const availableRoles = useMemo(() => {
    const set = new Set<string>()
    masters.forEach(m => {
      if (m.page_role) set.add(m.page_role)
    })
    return Array.from(set).sort()
  }, [masters])

  // Отфильтрованные мастера.
  const filtered = useMemo(() => {
    if (roleFilter === 'all') return masters
    if (roleFilter === 'unassigned') return masters.filter(m => !m.page_role)
    return masters.filter(m => m.page_role === roleFilter)
  }, [masters, roleFilter])

  // Группировка по template_set для подсветки.
  const tsById = useMemo(() => {
    const m = new Map<string, TemplateSetEntry>()
    templateSets.forEach(ts => m.set(ts.id, ts))
    return m
  }, [templateSets])

  const handleSaveLabel = useCallback(
    async (templateId: string, newLabel: string | null) => {
      // Оптимистичное обновление локального state.
      setMasters(prev =>
        prev.map(m =>
          m.id === templateId ? { ...m, display_label: newLabel } : m,
        ),
      )

      try {
        const r = await api('/api/tenant', {
          method: 'POST',
          body: JSON.stringify({
            action: 'template_set_update_display_label',
            template_id: templateId,
            display_label: newLabel,
          }),
        })
        if (!r.ok) {
          const d = await r.json().catch(() => ({}))
          throw new Error(d.error ?? `HTTP ${r.status}`)
        }
      } catch (e: unknown) {
        // Откат если ошибка.
        await loadMasters()
        setError(e instanceof Error ? e.message : 'Ошибка сохранения')
      }
    },
    [loadMasters],
  )

  if (!authChecked) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Заголовок */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Каталог мастеров</h1>
            <p className="text-sm text-gray-600 mt-1">
              Все шаблоны страниц с превью. Можно проставить
              человеко-читаемое название для каждого, чтобы партнёры в
              конструкторе видели «Вариант 4: четыре ученика» вместо
              технического имени.
            </p>
          </div>
          <button
            onClick={() => router.push('/super')}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            ← К панели
          </button>
        </div>

        {/* Фильтр по page_role */}
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <span className="text-sm text-gray-600">Роль:</span>
          <button
            onClick={() => setRoleFilter('all')}
            className={`px-3 py-1 rounded text-sm ${
              roleFilter === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            Все ({masters.length})
          </button>
          <button
            onClick={() => setRoleFilter('unassigned')}
            className={`px-3 py-1 rounded text-sm ${
              roleFilter === 'unassigned'
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            Без роли ({masters.filter(m => !m.page_role).length})
          </button>
          {availableRoles.map(role => {
            const count = masters.filter(m => m.page_role === role).length
            return (
              <button
                key={role}
                onClick={() => setRoleFilter(role)}
                className={`px-3 py-1 rounded text-sm ${
                  roleFilter === role
                    ? 'bg-blue-600 text-white'
                    : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {role} ({count})
              </button>
            )
          })}
        </div>

        {loading && <div className="text-gray-500">Загрузка...</div>}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="text-gray-500 text-sm">
            Нет мастеров с такой ролью.
          </div>
        )}

        {/* Грид карточек */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map(master => (
            <MasterCard
              key={master.id}
              master={master}
              templateSetName={tsById.get(master.template_set_id)?.name ?? ''}
              onSaveLabel={handleSaveLabel}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Карточка мастера ───────────────────────────────────────────────────────

interface MasterCardProps {
  master: MasterEntry
  templateSetName: string
  onSaveLabel: (templateId: string, newLabel: string | null) => Promise<void>
}

function MasterCard({ master, templateSetName, onSaveLabel }: MasterCardProps) {
  const [labelValue, setLabelValue] = useState(master.display_label ?? '')
  const [saving, setSaving] = useState(false)

  // Синхронизация когда master.display_label обновляется снаружи (оптимистично).
  useEffect(() => {
    setLabelValue(master.display_label ?? '')
  }, [master.display_label])

  const handleBlur = async () => {
    const trimmed = labelValue.trim()
    const newValue = trimmed === '' ? null : trimmed
    if (newValue === master.display_label) return // не изменилось
    setSaving(true)
    await onSaveLabel(master.id, newValue)
    setSaving(false)
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow">
      {/* SVG-превью */}
      <div
        className="w-full bg-gray-50 border border-gray-200 rounded mb-3 overflow-hidden flex items-center justify-center"
        style={{ aspectRatio: master.is_spread ? '2 / 1.4' : '1 / 1.4' }}
        dangerouslySetInnerHTML={{ __html: master.preview_svg }}
      />

      {/* Inline-редактор display_label */}
      <input
        type="text"
        value={labelValue}
        onChange={e => setLabelValue(e.target.value)}
        onBlur={handleBlur}
        placeholder={master.name}
        disabled={saving}
        className="w-full px-2 py-1 text-sm border border-gray-300 rounded mb-2 focus:outline-none focus:border-blue-500 disabled:bg-gray-100"
      />

      {/* Технический name (мелкий, серый) */}
      <div className="text-xs text-gray-400 mb-2 truncate" title={master.name}>
        {master.name}
        {templateSetName ? ` · ${templateSetName}` : ''}
      </div>

      {/* page_role + slot_capacity badges */}
      <div className="flex flex-wrap gap-1">
        {master.page_role ? (
          <span className="inline-block px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">
            {master.page_role}
          </span>
        ) : (
          <span className="inline-block px-2 py-0.5 bg-gray-100 text-gray-500 text-xs rounded">
            нет роли
          </span>
        )}
        {master.is_spread && (
          <span className="inline-block px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded">
            разворот
          </span>
        )}
        {formatCapacity(master.slot_capacity).map((cap, i) => (
          <span
            key={i}
            className="inline-block px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded"
          >
            {cap}
          </span>
        ))}
      </div>
    </div>
  )
}

// ─── Хелперы ────────────────────────────────────────────────────────────────

/**
 * Форматирует slot_capacity в читаемые badge-строки.
 * Опускает поля со значением 0/false (не информативно).
 */
function formatCapacity(cap: SlotCapacity | null): string[] {
  if (!cap) return []
  const out: string[] = []
  if (typeof cap.students === 'number' && cap.students > 0)
    out.push(`students=${cap.students}`)
  if (typeof cap.teachers === 'number' && cap.teachers > 0)
    out.push(`teachers=${cap.teachers}`)
  if (typeof cap.head_teacher === 'number' && cap.head_teacher > 0)
    out.push(`head_teacher=${cap.head_teacher}`)
  if (typeof cap.photos_full === 'number' && cap.photos_full > 0)
    out.push(`photos_full=${cap.photos_full}`)
  if (typeof cap.photos_half === 'number' && cap.photos_half > 0)
    out.push(`photos_half=${cap.photos_half}`)
  if (cap.has_quote === true) out.push('quote')
  if (cap.has_portrait === true) out.push('portrait')
  if (cap.has_name === true) out.push('name')
  return out
}
