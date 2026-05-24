'use client'

import { useState, useEffect } from 'react'
import type { SpreadTemplate } from '@/lib/album-builder/types'
import CommonRequiredPagesEditor from './CommonRequiredPagesEditor'

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
  /**
   * РЭ.37.5: симметризация хвоста students-секции.
   * Когда true И комплектация = Мини (grid=12) / Лайт (grid=6) И хвост=1
   * — engine забирает 1 ученика с предыдущей полной страницы. Для других
   * комплектаций (grid≠6,12) флаг игнорируется. По умолчанию false (опт-ин).
   */
  symmetrize_students_tail: boolean | null
  version: string
  /**
   * РЭ.24.7: показывать ли шаблон в каталоге /app/templates для партнёров.
   * Только глобальные пресеты (tenant_id=NULL) могут быть рекомендованы.
   * См. docs/phase-Р24-spec.md §5.
   */
  is_recommended: boolean
}

export type Section =
  | { type: 'soft_intro' | 'teachers' | 'students' | 'vignette' | 'soft_final' }
  | { type: 'common'; slots: string[] }
  | { type: 'common'; mode: 'auto'; max_spreads: number }
  | { type: 'common_required'; pages?: { master_name: string }[] }
  | { type: 'common_additional'; max_spreads: number }
  | { type: 'transition'; master_name?: string | null }

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
    'Партнёр сам собирает упорядоченный список страниц общего раздела из доступных в шаблоне J-мастеров. Engine при сборке альбома кладёт страницы строго по этому списку (если фото не хватает — страница пропускается с предупреждением).',
  common_additional:
    'Платная допуслуга. Партнёр выставляет max_spreads — сколько доп. разворотов готов добавить (0 = не строить).',
  transition:
    'Достраивает правую страницу переходного разворота когда у students нечётное количество страниц. По умолчанию engine выбирает мастер по своим правилам.',
  common:
    'Старая форма с явным указанием слотов H/Q/FULL/flex_A/B/C или mode=auto. Используйте common_required/additional.',
}

const api = (path: string, opts?: RequestInit) =>
  fetch(path, {
    ...opts,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
  })

// ─── Initial state для нового пресета (РЭ.30.5) ──────────────────────────
//
// До РЭ.30 эти хелперы fallback'или по `density / preset.id`, чтобы
// зашевелить UI у legacy-пресетов где `student_layout_mode` ещё NULL.
// После РЭ.30 все 7 глобальных пресетов мигрированы (есть layout_mode +
// grid_size), а новые пресеты создаются сразу в семантической модели —
// необходимость в density-fallback'ах отпала. Оставлен минимальный
// дефолт: page + grid_size=4 (стартовая точка для пустых партнёрских
// записей).

function computeInitialLayoutMode(preset: Preset): 'page' | 'spread' | 'grid' {
  return preset.student_layout_mode ?? 'page'
}

function computeInitialGridSize(
  preset: Preset,
  mode: 'page' | 'spread' | 'grid',
): number | null {
  // Если режим — не grid, размер сетки не нужен.
  if (mode !== 'grid') return null
  // Если в БД уже есть — используем; иначе дефолт 4.
  return preset.student_grid_size ?? 4
}

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
  // РЭ.30.5: state density/sheetType удалены вместе с UI селектами.
  // Поля в БД остаются (через тип Preset), но больше не редактируются
  // через эту модалку — для глобальных мигрированы в Б.1, для новых
  // партнёрских пресетов остаются NULL.
  const [minPages, setMinPages] = useState<number | ''>(preset.min_pages ?? '')
  const [maxPages, setMaxPages] = useState<number | ''>(preset.max_pages ?? '')
  const [sections, setSections] = useState<Section[]>(
    Array.isArray(preset.section_structure) ? preset.section_structure : []
  )

  // РЭ.22.3 + РЭ.30.5: двух-осевая модель «режим × параметры».
  // См. docs/phase-Р22-spec.md §5 и docs/phase-Р30-spec.md.
  //
  // Если у пресета `student_layout_mode` уже задан (после Б.1 — у всех
  // глобальных) — UI открывается на этом значении. Если NULL (новые
  // пустые партнёрские пресеты) — дефолтит на 'page'.
  const initialMode = computeInitialLayoutMode(preset)
  const initialGridSize = computeInitialGridSize(preset, initialMode)

  const [studentLayoutMode, setStudentLayoutMode] = useState<
    'page' | 'spread' | 'grid'
  >(initialMode)
  const [studentGridSize, setStudentGridSize] = useState<number | ''>(
    initialGridSize ?? ''
  )
  const [studentFriendPhotos, setStudentFriendPhotos] = useState<number | ''>(
    preset.student_friend_photos ?? ''
  )
  const [studentHasQuote, setStudentHasQuote] = useState<boolean>(
    preset.student_has_quote ?? false
  )
  // РЭ.37.5: галка «симметризировать хвост». Активна (enabled в UI) только
  // когда mode='grid' И grid_size ∈ {6, 12} — соответствует Light/Mini
  // комплектациям. Для остальных значений UI показывает её disabled.
  const [symmetrizeStudentsTail, setSymmetrizeStudentsTail] = useState<boolean>(
    preset.symmetrize_students_tail ?? false
  )

  // РЭ.24.7: галка «рекомендовать в каталоге партнёров».
  // Применима только к глобальным пресетам — для тенантских скрыта в UI.
  const [isRecommended, setIsRecommended] = useState<boolean>(
    preset.is_recommended ?? false
  )

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // РЭ.32.Б.3 — templates для конструктора общего раздела.
  // Загружаются один раз при открытии модалки если template_set_id задан.
  // Если template_set_id NULL — массив пустой (партнёр не выбрал дизайн —
  // CommonRequiredPagesEditor покажет «выберите дизайн чтобы добавить мастера»).
  const [templates, setTemplates] = useState<SpreadTemplate[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(false)
  useEffect(() => {
    if (!preset.template_set_id) {
      setTemplates([])
      return
    }
    let cancelled = false
    setTemplatesLoading(true)
    fetch(
      `/api/tenant?action=template_set_masters&template_set_id=${encodeURIComponent(preset.template_set_id)}`,
      { credentials: 'include' },
    )
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        if (Array.isArray(data?.masters)) {
          setTemplates(data.masters as SpreadTemplate[])
        }
      })
      .catch(() => {
        // Молча — UI покажет пустой список
      })
      .finally(() => {
        if (!cancelled) setTemplatesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [preset.template_set_id])

  // ─── Сохранить ─────────────────────────────────────────────
  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      // РЭ.22.3: пишем в новые поля + дублируем в legacy для отката Vercel
      // (см. spec §3). Маппинг режима в legacy student_pages_per_student:
      //   page  → 1 страница на ученика
      //   spread → 2 страницы (разворот)
      //   grid  → null (legacy не знает про сетку, для grid Section Structure
      //           engine использует buildGrid с density)
      const legacyPagesPerStudent: 1 | 2 | null =
        studentLayoutMode === 'page'
          ? 1
          : studentLayoutMode === 'spread'
            ? 2
            : null

      // friend_photos и grid_size актуальны только для своих режимов —
      // для остальных пишем null чтобы в БД не оставался мусор.
      const effectiveFriendPhotos =
        studentLayoutMode === 'page' || studentLayoutMode === 'spread'
          ? studentFriendPhotos === ''
            ? null
            : studentFriendPhotos
          : null
      const effectiveGridSize =
        studentLayoutMode === 'grid'
          ? studentGridSize === ''
            ? null
            : studentGridSize
          : null

      const body: Record<string, unknown> = {
        action: 'rule_preset_update',
        preset_id: preset.id,
        display_name: displayName,
        // РЭ.30.2: density и sheet_type больше НЕ записываются при
        // сохранении пресета. Тип переплёта живёт на уровне альбома
        // (РЭ.27 — albums.print_type) и template_set, а density полностью
        // заменён семантической моделью student_layout_mode + параметры.
        // API делает partial update — при отсутствии ключей существующие
        // значения в БД не трогаются (для legacy-пресетов остаются как
        // были; чистка смешанных делается отдельной миграцией Б.3).
        // UI селекты «Плотность портретов» и «Тип листов» ещё остаются —
        // будут удалены в В.2 (этой же фазы).
        section_structure: sections,
        // Новые поля (РЭ.22.2).
        student_layout_mode: studentLayoutMode,
        student_grid_size: effectiveGridSize,
        // РЭ.37.5: симметризация хвоста. Сохраняем фактическое значение
        // галки — engine сам игнорирует флаг если комплектация не Mini/Light.
        symmetrize_students_tail: symmetrizeStudentsTail,
        // Legacy (дублирование для отката).
        student_pages_per_student: legacyPagesPerStudent,
        student_friend_photos: effectiveFriendPhotos,
        student_has_quote: studentHasQuote,
        // РЭ.24.7: рекомендованность в каталоге (только для глобальных).
        is_recommended: isRecommended,
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

            {/* РЭ.24.7: галка «рекомендовать в каталоге партнёров».
                Показываем только для глобальных пресетов (tenant_id=NULL).
                Тенантские пресеты не могут быть recommended — в каталоге
                /app/templates показываются только глобальные. */}
            {preset.tenant_id === null && (
              <div className="bg-blue-50 border border-blue-200 rounded p-3">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isRecommended}
                    onChange={(e) => setIsRecommended(e.target.checked)}
                    className="mt-0.5"
                  />
                  <div className="text-sm">
                    <span className="font-medium text-gray-800">
                      Показывать в каталоге для партнёров
                    </span>
                    <span className="text-gray-600 block text-xs mt-0.5">
                      Если включено — этот шаблон появится в разделе
                      «Шаблоны» у партнёров (внутри своего дизайна). Партнёры
                      смогут клонировать его в свою личную библиотеку.
                    </span>
                  </div>
                </label>
              </div>
            )}

            {/* РЭ.30.5: блок «Плотность портретов» + «Тип листов»
                удалён. Density больше не редактируется через UI (все
                глобальные мигрированы в Б.1, новые пресеты сразу на
                семантической модели). Тип листов живёт на уровне
                альбома (РЭ.27 — albums.print_type) и template_set. */}

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

          {/* ─── Личный раздел (РЭ.22.3 — двух-осевая модель) ─── */}
          <section className="space-y-3 border-t pt-6">
            <div>
              <h3 className="font-semibold text-sm text-gray-700 uppercase tracking-wide">
                Личный раздел
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                Выберите режим: одна страница на ученика, разворот на ученика
                или сетка из нескольких. Engine ищет в template_set мастер
                с подходящим slot_capacity по этим параметрам.
              </p>
            </div>

            <div>
              <label className="text-sm text-gray-600 block mb-1">Режим</label>
              <select
                value={studentLayoutMode}
                onChange={(e) =>
                  setStudentLayoutMode(e.target.value as 'page' | 'spread' | 'grid')
                }
                className="w-full border rounded px-3 py-2 text-sm"
              >
                <option value="page">1 ученик на страницу</option>
                <option value="spread">1 ученик на разворот (2 страницы)</option>
                <option value="grid">Сетка из N учеников на страницу</option>
              </select>
            </div>

            {/* Параметры зависят от режима */}
            {(studentLayoutMode === 'page' || studentLayoutMode === 'spread') && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-gray-600 block mb-1">
                    Фото с друзьями
                  </label>
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
                    value={String(studentHasQuote)}
                    onChange={(e) => setStudentHasQuote(e.target.value === 'true')}
                    className="w-full border rounded px-3 py-2 text-sm"
                  >
                    <option value="true">да, есть слот</option>
                    <option value="false">нет</option>
                  </select>
                </div>
              </div>
            )}

            {studentLayoutMode === 'grid' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm text-gray-600 block mb-1">
                      Учеников на страницу
                    </label>
                    <input
                      type="number"
                      min={2}
                      max={12}
                      value={studentGridSize}
                      onChange={(e) =>
                        setStudentGridSize(
                          e.target.value === '' ? '' : Number(e.target.value)
                        )
                      }
                      className="w-full border rounded px-3 py-2 text-sm"
                      placeholder="2..12"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Базовый размер сетки. Адаптивный хвост (последняя
                      неполная страница) подбирается engine'ом автоматически
                      из доступных мастеров template_set.
                    </p>
                  </div>
                  <div>
                    <label className="text-sm text-gray-600 block mb-1">Цитата</label>
                    <select
                      value={String(studentHasQuote)}
                      onChange={(e) => setStudentHasQuote(e.target.value === 'true')}
                      className="w-full border rounded px-3 py-2 text-sm"
                    >
                      <option value="true">да, под каждым учеником</option>
                      <option value="false">нет</option>
                    </select>
                  </div>
                </div>

                {/* РЭ.37.5: галка симметризации хвоста.
                    Применима только для grid_size ∈ {6, 12} — это
                    соответствует комплектациям Light / Mini в spec §3.4.
                    Для других значений показываем disabled+ explanation. */}
                {(() => {
                  const numericGridSize =
                    studentGridSize === '' ? null : Number(studentGridSize)
                  const isApplicable =
                    numericGridSize === 6 || numericGridSize === 12
                  return (
                    <div
                      className={
                        'rounded border px-3 py-2 ' +
                        (isApplicable
                          ? 'bg-blue-50/40 border-blue-200'
                          : 'bg-gray-50 border-gray-200')
                      }
                    >
                      <label
                        className={
                          'flex items-start gap-2 text-sm ' +
                          (isApplicable
                            ? 'cursor-pointer text-gray-800'
                            : 'cursor-not-allowed text-gray-400')
                        }
                      >
                        <input
                          type="checkbox"
                          checked={symmetrizeStudentsTail}
                          disabled={!isApplicable}
                          onChange={(e) =>
                            setSymmetrizeStudentsTail(e.target.checked)
                          }
                          className="mt-0.5"
                        />
                        <span>
                          <span className="font-medium">
                            Симметризировать хвост
                          </span>
                          {!isApplicable && (
                            <span className="text-xs ml-1.5 text-gray-500">
                              (только для 6 или 12 учеников на страницу)
                            </span>
                          )}
                          <span className="block text-xs text-gray-600 mt-0.5">
                            Если в хвосте остался один ученик, движок возьмёт
                            ещё одного с предыдущей страницы — чтобы хвост был
                            парным, без одиночного портрета с краю.
                          </span>
                        </span>
                      </label>
                    </div>
                  )
                })()}
              </>
            )}

            {preset.student_layout_mode === null && (
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                Режим личного раздела ещё не задан в БД (дефолт «page»).
                Проверьте параметры и нажмите «Сохранить», чтобы зафиксировать.
              </p>
            )}
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
              templates={templates}
              templatesLoading={templatesLoading}
              hasTemplateSet={preset.template_set_id !== null}
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
  templates,
  templatesLoading,
  hasTemplateSet,
  onUpdate,
  onRemove,
  onMove,
}: {
  sections: Section[]
  templates: SpreadTemplate[]
  templatesLoading: boolean
  hasTemplateSet: boolean
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
            {/* РЭ.32.Б.3 — common_required: конструктор страниц */}
            {s.type === 'common_required' && (
              <div className="mt-3">
                {!hasTemplateSet ? (
                  <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                    Выберите дизайн (template_set) у шаблона, чтобы добавлять
                    мастера общего раздела.
                  </p>
                ) : templatesLoading ? (
                  <p className="text-xs text-gray-400 italic">
                    Загрузка мастеров…
                  </p>
                ) : (
                  <CommonRequiredPagesEditor
                    pages={Array.isArray(s.pages) ? s.pages : []}
                    templates={templates}
                    onChange={(newPages) =>
                      onUpdate(idx, { pages: newPages } as Partial<Section>)
                    }
                  />
                )}
              </div>
            )}
            {/* РЭ.32.Б.4 — transition: опциональный мастер */}
            {s.type === 'transition' && (
              <div className="mt-3">
                {!hasTemplateSet ? (
                  <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                    Выберите дизайн (template_set) у шаблона, чтобы выбрать
                    переходный мастер.
                  </p>
                ) : templatesLoading ? (
                  <p className="text-xs text-gray-400 italic">
                    Загрузка мастеров…
                  </p>
                ) : (
                  <TransitionMasterSelector
                    value={s.master_name ?? null}
                    templates={templates}
                    onChange={(name) =>
                      onUpdate(idx, { master_name: name } as Partial<Section>)
                    }
                  />
                )}
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

// ─── TransitionMasterSelector ────────────────────────────────────────────
//
// РЭ.32.Б.4 — выбор мастера для переходной страницы.
//
// Опциональный селект: «По умолчанию (engine решит)» или конкретный
// J-мастер из template_set'а. Применяется когда у students секция
// заканчивается нечётным количеством страниц — для достраивания правой
// страницы переходного разворота.
//
// Фильтрация мастеров — та же что в JMasterPicker:
//   - имеет J-категорию (classphotoframe / halfphoto_* / quarterphoto_* /
//     collagephoto_* / spreadphoto) ИЛИ page_role='common'
//   - НЕ -Right вариант (engine сам подставит при position='right')

function TransitionMasterSelector({
  value,
  templates,
  onChange,
}: {
  value: string | null
  templates: SpreadTemplate[]
  onChange: (masterName: string | null) => void
}) {
  // Тот же фильтр что в JMasterPicker (РЭ.32.Б.5):
  //   1. blacklist по page_role (студенческие/учительские/обложечные)
  //   2. отсекаем мастера с studentportrait_*/teacherphoto_*
  //   3. оставляем только page_role='common' или с J-категорией
  //   4. без -Right вариантов
  const NON_COMMON_ROLES = new Set([
    'student', 'student_grid', 'student_grid_left', 'student_grid_right',
    'student_left', 'student_right', 'student_overflow', 'student_last',
    'teacher_left', 'teacher_right', 'intro', 'cover',
  ])
  const candidates = templates.filter((t) => {
    if (t.name.endsWith('-Right')) return false
    if (t.page_role && NON_COMMON_ROLES.has(t.page_role)) return false
    let hasJCategory = false
    let hasNonCommonPlaceholder = false
    for (const ph of t.placeholders ?? []) {
      const l = ph.label.toLowerCase()
      if (
        l.match(/^studentportrait_\d+$/) ||
        l.match(/^studentname_\d+$/) ||
        l.match(/^teacherphoto_\d+$/) ||
        l.match(/^teachername_\d+$/) ||
        l === 'headteacherphoto' ||
        l === 'headteachername'
      ) {
        hasNonCommonPlaceholder = true
        break
      }
      if (
        l === 'classphotoframe' ||
        l === 'spreadphoto' ||
        l.match(/^halfphoto_\d+$/) ||
        l.match(/^quarterphoto_\d+$/) ||
        l.match(/^collagephoto_\d+$/)
      ) {
        hasJCategory = true
      }
    }
    if (hasNonCommonPlaceholder) return false
    return t.page_role === 'common' || hasJCategory
  })

  const selectedExists = value === null || candidates.some((t) => t.name === value)

  return (
    <div className="space-y-1">
      <label className="text-xs text-gray-600">Мастер переходной страницы:</label>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        className="w-full border rounded px-2 py-1 text-sm"
      >
        <option value="">По умолчанию (engine решит)</option>
        {candidates
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((t) => (
            <option key={t.id} value={t.name}>
              {t.name}
            </option>
          ))}
      </select>
      {!selectedExists && value && (
        <p className="text-xs text-amber-600">
          Мастер «{value}» не найден в текущем дизайне (был переименован
          или удалён). Engine применит правило по умолчанию.
        </p>
      )}
    </div>
  )
}
