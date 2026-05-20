'use client'

import { useState, useEffect } from 'react'

// ─── Типы ────────────────────────────────────────────────────────────────

export interface Preset {
  id: string
  display_name: string
  tenant_id: string | null
  print_type: 'layflat' | 'soft' | null
  density: 'standard' | 'universal' | 'medium' | 'light' | 'mini' | null
  sheet_type: 'hard' | 'soft' | null
  min_pages: number | null
  max_pages: number | null
  template_set_id: string | null
  section_structure: Section[] | null
  /** РЭ.21.8.15 (одно-осевая модель, DEPRECATED в РЭ.22.1). */
  student_pages_per_student: 1 | 2 | null
  student_friend_photos: number | null
  student_has_quote: boolean | null
  /** РЭ.22.1: двух-осевая модель. См. docs/phase-Р22-spec.md §3. */
  student_layout_mode: 'page' | 'spread' | 'grid' | null
  student_grid_size: number | null
  version: string
}

export type Section =
  | { type: 'soft_intro' | 'teachers' | 'students' | 'vignette' | 'soft_final' }
  | { type: 'common'; slots: string[] }
  | { type: 'common'; mode: 'auto'; max_spreads: number }
  | { type: 'common_required' }
  | { type: 'common_additional'; max_spreads: number }
  | { type: 'transition' }

const ALL_SECTION_TYPES: Section['type'][] = [
  'soft_intro',
  'teachers',
  'students',
  'transition',
  'common_required',
  'common_additional',
  'common',
  'vignette',
  'soft_final',
]

const SECTION_LABELS: Record<Section['type'], string> = {
  soft_intro: 'Вступительная страница (мягкие)',
  teachers: 'Учительский разворот',
  students: 'Личный раздел',
  transition: 'Переходная страница',
  common_required: 'Обязательный общий раздел',
  common_additional: 'Дополнительный общий раздел (платный)',
  common: 'Общий раздел (старый/manual)',
  vignette: 'Виньетка',
  soft_final: 'Финальная страница (мягкие)',
}

const SECTION_DESCRIPTIONS: Partial<Record<Section['type'], string>> = {
  common_required:
    'Структура по эталонной таблице OkeyBook. Параметров нет — engine выбирает страницы по density × sheet_type × число учеников.',
  common_additional:
    'Платная допуслуга. Партнёр выставляет max_spreads — сколько доп. разворотов готов добавить (0 = не строить).',
  transition:
    'Достраивает правую страницу переходного разворота когда у students нечётное количество страниц.',
  common:
    'Старая форма с явным указанием слотов H/Q/FULL/flex_A/B/C или mode=auto. Используйте common_required/additional.',
}

const api = (path: string, opts?: RequestInit) =>
  fetch(path, {
    ...opts,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
  })

// ─── Modal ───────────────────────────────────────────────────────────────

export default function PresetEditorModal({
  preset,
  onClose,
  onSaved,
}: {
  preset: Preset
  onClose: () => void
  onSaved: () => void
}) {
  // Локальные стейты — копия пресета.
  const [displayName, setDisplayName] = useState(preset.display_name)
  const [density, setDensity] = useState<Preset['density']>(preset.density)
  const [sheetType, setSheetType] = useState<Preset['sheet_type']>(preset.sheet_type)
  const [minPages, setMinPages] = useState<number | ''>(preset.min_pages ?? '')
  const [maxPages, setMaxPages] = useState<number | ''>(preset.max_pages ?? '')
  const [sections, setSections] = useState<Section[]>(
    Array.isArray(preset.section_structure) ? preset.section_structure : []
  )
  const [studentPages, setStudentPages] = useState<1 | 2 | null>(
    preset.student_pages_per_student
  )
  const [studentFriendPhotos, setStudentFriendPhotos] = useState<number | ''>(
    preset.student_friend_photos ?? ''
  )
  const [studentHasQuote, setStudentHasQuote] = useState<boolean | null>(
    preset.student_has_quote
  )

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ─── Сохранить ─────────────────────────────────────────────
  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        action: 'rule_preset_update',
        preset_id: preset.id,
        display_name: displayName,
        density,
        sheet_type: sheetType,
        section_structure: sections,
        student_pages_per_student: studentPages,
        student_friend_photos:
          studentFriendPhotos === '' ? null : studentFriendPhotos,
        student_has_quote: studentHasQuote,
      }
      if (minPages !== '') body.min_pages = minPages
      if (maxPages !== '') body.max_pages = maxPages

      const r = await api('/api/tenant', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        throw new Error(d.error ?? `HTTP ${r.status}`)
      }
      onSaved()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  // ─── Esc закрывает modal ─────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // ─── Действия с секциями ─────────────────────────────────────
  const addSection = (type: Section['type']) => {
    let newSection: Section
    if (type === 'common_additional') {
      newSection = { type, max_spreads: 2 }
    } else if (type === 'common') {
      newSection = { type, slots: [] }
    } else {
      newSection = { type } as Section
    }
    setSections([...sections, newSection])
  }
  const removeSection = (idx: number) => {
    setSections(sections.filter((_, i) => i !== idx))
  }
  const moveSection = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= sections.length) return
    const copy = [...sections]
    const tmp = copy[idx]
    copy[idx] = copy[newIdx]
    copy[newIdx] = tmp
    setSections(copy)
  }
  const updateSection = (idx: number, patch: Partial<Section>) => {
    const copy = [...sections]
    copy[idx] = { ...copy[idx], ...patch } as Section
    setSections(copy)
  }

  // ─── Рендер ─────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">{preset.display_name}</h2>
            <div className="text-xs text-gray-500 font-mono mt-0.5">
              {preset.id}
              {preset.tenant_id === null && (
                <span className="ml-2 bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                  глобальный
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* ─── Базовые поля ─── */}
          <section className="space-y-3">
            <h3 className="font-semibold text-sm text-gray-700 uppercase tracking-wide">
              Базовые параметры
            </h3>

            <div>
              <label className="text-sm text-gray-600 block mb-1">Название</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-gray-600 block mb-1">Плотность портретов</label>
                <select
                  value={density ?? ''}
                  onChange={(e) =>
                    setDensity((e.target.value || null) as Preset['density'])
                  }
                  className="w-full border rounded px-3 py-2 text-sm"
                >
                  <option value="">— (для Максимум/Индивидуальной)</option>
                  <option value="standard">standard</option>
                  <option value="universal">universal</option>
                  <option value="medium">medium</option>
                  <option value="light">light</option>
                  <option value="mini">mini</option>
                </select>
              </div>
              <div>
                <label className="text-sm text-gray-600 block mb-1">Тип листов</label>
                <select
                  value={sheetType ?? ''}
                  onChange={(e) =>
                    setSheetType((e.target.value || null) as Preset['sheet_type'])
                  }
                  className="w-full border rounded px-3 py-2 text-sm"
                >
                  <option value="">— (не задано)</option>
                  <option value="hard">плотные (hard)</option>
                  <option value="soft">мягкие (soft)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-gray-600 block mb-1">Мин. страниц</label>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={minPages}
                  onChange={(e) =>
                    setMinPages(e.target.value === '' ? '' : Number(e.target.value))
                  }
                  className="w-full border rounded px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-sm text-gray-600 block mb-1">Макс. страниц</label>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={maxPages}
                  onChange={(e) =>
                    setMaxPages(e.target.value === '' ? '' : Number(e.target.value))
                  }
                  className="w-full border rounded px-3 py-2 text-sm"
                />
              </div>
            </div>
          </section>

          {/* ─── Личный раздел (РЭ.21.8.15) ─── */}
          <section className="space-y-3 border-t pt-6">
            <div>
              <h3 className="font-semibold text-sm text-gray-700 uppercase tracking-wide">
                Личный раздел (семантический поиск мастера)
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                Если заполнены все 3 поля — engine ищет в template_set мастер
                с подходящим slot_capacity. Иначе fallback на жёсткие имена
                E-Standard / E-Universal / E-Max.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-sm text-gray-600 block mb-1">Страниц на ученика</label>
                <select
                  value={studentPages ?? ''}
                  onChange={(e) => {
                    const v = e.target.value
                    setStudentPages(v === '' ? null : (Number(v) as 1 | 2))
                  }}
                  className="w-full border rounded px-3 py-2 text-sm"
                >
                  <option value="">— (не задано)</option>
                  <option value="1">1 страница</option>
                  <option value="2">2 страницы (разворот)</option>
                </select>
              </div>
              <div>
                <label className="text-sm text-gray-600 block mb-1">Фото с друзьями</label>
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={studentFriendPhotos}
                  onChange={(e) =>
                    setStudentFriendPhotos(
                      e.target.value === '' ? '' : Number(e.target.value)
                    )
                  }
                  className="w-full border rounded px-3 py-2 text-sm"
                  placeholder="0..10"
                />
              </div>
              <div>
                <label className="text-sm text-gray-600 block mb-1">Цитата</label>
                <select
                  value={studentHasQuote === null ? '' : String(studentHasQuote)}
                  onChange={(e) => {
                    const v = e.target.value
                    setStudentHasQuote(v === '' ? null : v === 'true')
                  }}
                  className="w-full border rounded px-3 py-2 text-sm"
                >
                  <option value="">— (не задано)</option>
                  <option value="true">да, есть слот</option>
                  <option value="false">нет</option>
                </select>
              </div>
            </div>
          </section>

          {/* ─── section_structure редактор ─── */}
          <section className="space-y-3 border-t pt-6">
            <div>
              <h3 className="font-semibold text-sm text-gray-700 uppercase tracking-wide">
                Структура альбома (section_structure)
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                Порядок секций сверху вниз. Engine собирает альбом следуя этому
                списку. Используйте стрелки чтобы изменить порядок.
              </p>
            </div>

            <SectionsEditor
              sections={sections}
              onUpdate={updateSection}
              onRemove={removeSection}
              onMove={moveSection}
            />

            <AddSectionPicker
              onAdd={addSection}
              existingTypes={new Set(sections.map((s) => s.type))}
            />
          </section>
        </div>

        {/* ─── Footer: save / cancel ─── */}
        <div className="px-6 py-4 border-t bg-gray-50">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm mb-3">
              {error}
            </div>
          )}
          <div className="flex items-center justify-end gap-3">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded"
            >
              Отмена
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-2 text-sm bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white rounded"
            >
              {saving ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Sections editor ─────────────────────────────────────────────────────

function SectionsEditor({
  sections,
  onUpdate,
  onRemove,
  onMove,
}: {
  sections: Section[]
  onUpdate: (idx: number, patch: Partial<Section>) => void
  onRemove: (idx: number) => void
  onMove: (idx: number, dir: -1 | 1) => void
}) {
  if (sections.length === 0) {
    return (
      <div className="text-sm text-gray-500 italic border border-dashed rounded p-4">
        Структура пустая. Добавьте секции через кнопки ниже.
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {sections.map((s, idx) => (
        <div
          key={`${s.type}-${idx}`}
          className="bg-gray-50 border rounded px-3 py-2 flex items-start gap-2"
        >
          <div className="flex flex-col gap-0.5 pt-0.5">
            <button
              onClick={() => onMove(idx, -1)}
              disabled={idx === 0}
              className="text-xs text-gray-500 hover:text-gray-900 disabled:opacity-30 px-1"
              aria-label="Вверх"
            >
              ▲
            </button>
            <button
              onClick={() => onMove(idx, 1)}
              disabled={idx === sections.length - 1}
              className="text-xs text-gray-500 hover:text-gray-900 disabled:opacity-30 px-1"
              aria-label="Вниз"
            >
              ▼
            </button>
          </div>
          <div className="flex-1">
            <div className="font-medium text-sm">{SECTION_LABELS[s.type]}</div>
            <div className="text-xs text-gray-500 font-mono">{s.type}</div>
            {SECTION_DESCRIPTIONS[s.type] && (
              <div className="text-xs text-gray-600 mt-1">
                {SECTION_DESCRIPTIONS[s.type]}
              </div>
            )}
            {/* common_additional: max_spreads */}
            {s.type === 'common_additional' && (
              <div className="mt-2 flex items-center gap-2">
                <label className="text-xs text-gray-600">max_spreads:</label>
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={s.max_spreads}
                  onChange={(e) =>
                    onUpdate(idx, { max_spreads: Number(e.target.value) } as Partial<Section>)
                  }
                  className="border rounded px-2 py-0.5 text-xs w-20"
                />
              </div>
            )}
            {/* common manual: slots — пока read-only (партнёры используют new секции) */}
            {s.type === 'common' && 'slots' in s && (
              <div className="mt-2">
                <span className="text-xs text-gray-600">slots:</span>{' '}
                <span className="text-xs font-mono">[{s.slots.join(', ')}]</span>
                <div className="text-xs text-amber-600 mt-1">
                  Старая форма. Рекомендуется common_required + common_additional.
                </div>
              </div>
            )}
            {s.type === 'common' && 'mode' in s && (
              <div className="mt-2 flex items-center gap-2">
                <label className="text-xs text-gray-600">auto, max_spreads:</label>
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={s.max_spreads}
                  onChange={(e) =>
                    onUpdate(idx, { max_spreads: Number(e.target.value) } as Partial<Section>)
                  }
                  className="border rounded px-2 py-0.5 text-xs w-20"
                />
              </div>
            )}
          </div>
          <button
            onClick={() => onRemove(idx)}
            className="text-xs text-red-500 hover:text-red-700 px-2"
            aria-label="Удалить"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

// ─── AddSection picker ───────────────────────────────────────────────────

function AddSectionPicker({
  onAdd,
  existingTypes,
}: {
  onAdd: (type: Section['type']) => void
  existingTypes: Set<Section['type']>
}) {
  // Секции которые можно добавить несколько раз: common, common_additional
  const MULTIPLE_ALLOWED = new Set<Section['type']>(['common', 'common_additional'])

  return (
    <div className="flex flex-wrap gap-2 pt-2">
      {ALL_SECTION_TYPES.map((type) => {
        const isAdded = existingTypes.has(type)
        const disabled = isAdded && !MULTIPLE_ALLOWED.has(type)
        return (
          <button
            key={type}
            onClick={() => onAdd(type)}
            disabled={disabled}
            className={`text-xs px-3 py-1.5 rounded border ${
              disabled
                ? 'border-gray-200 text-gray-400 cursor-not-allowed'
                : 'border-purple-300 text-purple-700 hover:bg-purple-50'
            }`}
            title={SECTION_LABELS[type]}
          >
            + {type}
          </button>
        )
      })}
    </div>
  )
}
