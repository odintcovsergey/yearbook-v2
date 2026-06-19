'use client'

import { useState, useEffect } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { SpreadTemplate } from '@/lib/album-builder/types'
import { humanMasterLabel } from '@/lib/album-builder/master-label'
import { MasterSchematic } from './MasterSchematic'
import CommonRequiredPagesEditor from './CommonRequiredPagesEditor'

// ─── Типы ────────────────────────────────────────────────────────────────

/**
 * РЭ.37.6: ручной сценарий transition-разворота.
 *
 * NULL в БД (и в этом типе) = OkeyBook-default. Иначе:
 *   { mode: 'custom',
 *     tail_left_master_id:  string | null,   // мастер L страницы transition
 *     tail_right_master_id: string | null,   // мастер R страницы transition
 *     closing_master_id:    string | null,   // резерв, пока не используется
 *   }
 *
 * Зеркало типа из lib/rule-engine/types.ts (TransitionScenario) —
 * дублируется здесь чтобы не тянуть rule-engine в client-bundle.
 */
export type TransitionScenario = {
  mode: 'custom'
  tail_left_master_id: string | null
  tail_right_master_id: string | null
  closing_master_id: string | null
}

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
  /**
   * РЭ.37.6: ручной сценарий transition-разворота.
   * NULL = OkeyBook-default (стандартная логика). Иначе custom-объект
   * с master_id для левой/правой страницы. Подробнее см. types.ts
   * → TransitionScenario.
   */
  transition_scenario: TransitionScenario | null
  version: string
  /**
   * РЭ.24.7: показывать ли шаблон в каталоге /app/templates для партнёров.
   * Только глобальные пресеты (tenant_id=NULL) могут быть рекомендованы.
   * См. docs/phase-Р24-spec.md §5.
   */
  is_recommended: boolean
}

/**
 * ТЗ 17.06.2026: per-section конфиг личного раздела. Зеркало
 * StudentsSectionConfig из lib/rule-engine/types.ts — дублируется здесь, чтобы
 * не тянуть rule-engine в client-bundle (как TransitionScenario выше).
 */
export type StudentsSectionConfig =
  | { mode: 'grid'; per_page: number }
  | { mode: 'page'; friends: number; quote: boolean; is_personal?: boolean }
  | {
      mode: 'spread'
      friends_min: number
      friends_max: number
      quote: boolean
      is_personal?: boolean
    }
  | {
      mode: 'multi_spread'
      spreads_per_student: number
      quote: boolean
      /** Ручной сценарий: имена мастеров по страницам (чётная длина). null = авто. */
      manual_pages?: string[] | null
      is_personal?: boolean
    }

export type Section =
  | { type: 'teachers' | 'vignette' }
  | { type: 'students'; config?: StudentsSectionConfig }
  | { type: 'soft_intro'; master_name?: string | null }   // РЭ.42
  | { type: 'soft_final'; master_name?: string | null }   // РЭ.42
  | { type: 'common'; slots: string[] }
  | { type: 'common'; mode: 'auto'; max_spreads: number }
  | { type: 'common_required'; pages?: { master_name: string }[] }
  | { type: 'common_additional'; max_spreads: number }
  | { type: 'transition'; master_name?: string | null }

// ВНИМАНИЕ: 'common' (legacy slots-режим) и 'vignette' (не реализован)
// намеренно убраны из конструктора — нельзя создавать НОВЫЕ такие секции.
// Обработчики в lib/rule-engine/build-from-section-structure.ts и тип-юнион
// Section/SECTION_LABELS оставлены, чтобы старые пресеты продолжали работать.
const ALL_SECTION_TYPES: Section['type'][] = [
  'soft_intro',
  'teachers',
  'students',
  'transition',
  'common_required',
  'common_additional',
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

// ─── Конфиг личного раздела (ТЗ 17.06.2026) ──────────────────────────────

/** Дефолтный config при создании новой секции students / переключении режима. */
function defaultStudentsConfig(mode: StudentsSectionConfig['mode']): StudentsSectionConfig {
  switch (mode) {
    case 'grid':
      return { mode: 'grid', per_page: 6 }
    case 'page':
      return { mode: 'page', friends: 0, quote: false, is_personal: false }
    case 'spread':
      return { mode: 'spread', friends_min: 0, friends_max: 4, quote: true, is_personal: false }
    case 'multi_spread':
      return { mode: 'multi_spread', spreads_per_student: 2, quote: true, is_personal: false }
  }
}

const clampInt = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Number.isFinite(v) ? Math.round(v) : lo))

/** Человекочитаемая подпись режима личного раздела (для карточки секции). */
function humanStudentsConfigLabel(cfg: StudentsSectionConfig | undefined): string {
  if (!cfg) return 'Настройки берутся из шаблона (старый формат) — задайте режим'
  const q = (b: boolean) => (b ? 'с цитатой' : 'без цитаты')
  switch (cfg.mode) {
    case 'grid':
      return `Сетка: ${cfg.per_page} учеников на страницу`
    case 'page':
      return `1 ученик на страницу · фото с друзьями: ${cfg.friends} · ${q(cfg.quote)}`
    case 'spread':
      return `1 ученик на разворот · фото с друзьями: ${cfg.friends_min}–${cfg.friends_max} · ${q(cfg.quote)}`
    case 'multi_spread':
      if (cfg.manual_pages && cfg.manual_pages.length > 0) {
        return `1 ученик на несколько разворотов · вручную (${cfg.manual_pages.length / 2} разворота) · ${q(cfg.quote)}`
      }
      return `1 ученик на ${cfg.spreads_per_student} разворота · авто · ${q(cfg.quote)}`
  }
}

// ─── Классификация мастеров личного раздела (по реальным плейсхолдерам) ────
// Те же правила, что в движке (lib/rule-engine/sections/students.ts): парадная
// = есть портрет; коллаж = есть фото-слоты, нет портрета/имени/цитаты.
function masterHasPlaceholder(t: SpreadTemplate, re: RegExp): boolean {
  return (t.placeholders ?? []).some((p) => re.test((p.label ?? '').toLowerCase()))
}
function isParadeMaster(t: SpreadTemplate): boolean {
  return masterHasPlaceholder(t, /^studentportrait(_\d+)?$/)
}
function isCollageMaster(t: SpreadTemplate): boolean {
  const hasPhoto = masterHasPlaceholder(t, /^(?:studentphoto|friendphoto)_?\d+$/)
  return (
    hasPhoto &&
    !masterHasPlaceholder(t, /^studentportrait(_\d+)?$/) &&
    !masterHasPlaceholder(t, /^studentname(_\d+)?$/) &&
    !masterHasPlaceholder(t, /^studentquote(_\d+)?$/)
  )
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

  // ТЗ 17.06.2026: настройки личного раздела перенесены из глобальной шапки
  // ВНУТРЬ каждой записи students в структуре альбома (см. SortableSectionItem
  // → StudentsConfigEditor). Глобальные поля пресета (student_layout_mode и
  // т.п.) больше не редактируются здесь; в БД остаются как есть (legacy-фолбэк
  // движка для секций без config + откат Vercel). PATCH без этих ключей их
  // не трогает.

  // РЭ.49: state симметризации удалён из шаблона. Настройка перенесена
  // на уровень альбома (РЭ.46 — SymmetrizeTailControl на 'Обзоре').
  // Поле preset.symmetrize_students_tail в БД остаётся для обратной
  // совместимости (engine читает его при отсутствии override на альбоме),
  // но партнёру в UI шаблона не показывается. См. также РЭ.49.

  // РЭ.37.6: ручной сценарий transition-разворота.
  // 'default' (default) = OkeyBook логика, NULL в БД.
  // 'custom' = партнёр выбрал master_id для левой/правой страницы.
  const [transitionMode, setTransitionMode] = useState<'default' | 'custom'>(
    preset.transition_scenario === null ? 'default' : 'custom'
  )
  const [transitionTailLeftId, setTransitionTailLeftId] = useState<string | null>(
    preset.transition_scenario?.tail_left_master_id ?? null
  )
  const [transitionTailRightId, setTransitionTailRightId] = useState<string | null>(
    preset.transition_scenario?.tail_right_master_id ?? null
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
      // ТЗ 17.06.2026: настройки личного раздела теперь живут в section_structure
      // (config записи students). Глобальные поля student_* больше НЕ
      // отправляем — API делает partial update, существующие значения в БД
      // остаются (legacy-фолбэк движка + откат Vercel).
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
        // РЭ.49: symmetrize_students_tail убран из формы шаблона.
        // Настройка перенесена на уровень альбома (РЭ.46).
        // Существующее значение в БД сохраняется как есть (PATCH без поля
        // не трогает его). Engine читает БД-значение при отсутствии
        // album.symmetrize_students_tail_override.
        // РЭ.37.6: ручной сценарий transition-разворота.
        // 'default' → null (старое поведение OkeyBook).
        // 'custom' → объект с master_id для tail_left / tail_right.
        // API сам нормализует mode='default' в null (см. rule_preset_update).
        transition_scenario:
          transitionMode === 'default'
            ? null
            : {
                mode: 'custom',
                tail_left_master_id: transitionTailLeftId,
                tail_right_master_id: transitionTailRightId,
                closing_master_id: null,
              },
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
    } else if (type === 'students') {
      // ТЗ 17.06.2026: новая секция личного раздела создаётся с дефолтным
      // config (можно добавить несколько с разными режимами).
      newSection = { type: 'students', config: defaultStudentsConfig('page') }
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
  // РЭ.45: drag-and-drop переупорядочивание секций. Принимает oldIdx/newIdx
  // (как от arrayMove из @dnd-kit/sortable) и применяет к sections массиву.
  const reorderSections = (oldIdx: number, newIdx: number) => {
    if (oldIdx === newIdx) return
    if (oldIdx < 0 || oldIdx >= sections.length) return
    if (newIdx < 0 || newIdx >= sections.length) return
    setSections(arrayMove(sections, oldIdx, newIdx))
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
        className="bg-card rounded-lg w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">{preset.display_name}</h2>
            <div className="text-xs text-muted-foreground font-mono mt-0.5">
              {preset.id}
              {preset.tenant_id === null && (
                <span className="ml-2 bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                  глобальный
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-2xl leading-none">
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* ─── Базовые поля ─── */}
          <section className="space-y-3">
            <h3 className="font-semibold text-sm text-foreground uppercase tracking-wide">
              Базовые параметры
            </h3>

            <div>
              <label className="text-sm text-muted-foreground block mb-1">Название</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="input"
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
                    <span className="font-medium text-foreground">
                      Показывать в каталоге для партнёров
                    </span>
                    <span className="text-muted-foreground block text-xs mt-0.5">
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
                <label className="text-sm text-muted-foreground block mb-1">Мин. страниц</label>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={minPages}
                  onChange={(e) =>
                    setMinPages(e.target.value === '' ? '' : Number(e.target.value))
                  }
                  className="input"
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground block mb-1">Макс. страниц</label>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={maxPages}
                  onChange={(e) =>
                    setMaxPages(e.target.value === '' ? '' : Number(e.target.value))
                  }
                  className="input"
                />
              </div>
            </div>
          </section>

          {/* ТЗ 17.06.2026: настройки личного раздела перенесены в каждую
              запись «Личный раздел» списка «Структура альбома» ниже (можно
              добавить несколько личных разделов с разными режимами). */}

          {/* ─── РЭ.37.6: ручной сценарий transition-разворота ─── */}
          <section className="space-y-3 border-t pt-6">
            <div>
              <h3 className="font-semibold text-sm text-foreground uppercase tracking-wide">
                Переходный разворот
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                Что engine кладёт на переходном развороте после раздела
                учеников. По умолчанию — автоматически (OkeyBook-логика).
                Можно задать вручную, если стандартный результат не
                устраивает.
              </p>
            </div>

            <div className="space-y-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="transition-mode"
                  value="default"
                  checked={transitionMode === 'default'}
                  onChange={() => setTransitionMode('default')}
                  className="mt-0.5"
                />
                <span className="text-sm">
                  <span className="font-medium">По умолчанию</span>
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    Engine сам подбирает мастера для левой/правой страницы по
                    OkeyBook-правилам: combo-мастер на хвосте, J-цепочка для
                    закрытия. Подходит в 90% случаев.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="transition-mode"
                  value="custom"
                  checked={transitionMode === 'custom'}
                  onChange={() => setTransitionMode('custom')}
                  className="mt-0.5"
                />
                <span className="text-sm">
                  <span className="font-medium">Вручную — мой сценарий</span>
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    Выберите мастера для левой и правой страницы.
                    Симметризация хвоста при этом не применяется
                    (вы сами решили что класть).
                  </span>
                </span>
              </label>
            </div>

            {transitionMode === 'custom' && (
              <div className="rounded border border-blue-200 bg-blue-50/40 p-3 space-y-3">
                {templates.length === 0 ? (
                  <p className="text-xs text-amber-700">
                    {preset.template_set_id === null
                      ? 'Сначала выберите дизайн шаблона (template_set), чтобы появился список мастеров.'
                      : 'Загрузка мастеров...'}
                  </p>
                ) : (
                  <>
                    <div>
                      <label className="text-sm text-foreground block mb-1">
                        Левая страница перехода
                      </label>
                      <select
                        value={transitionTailLeftId ?? ''}
                        onChange={(e) =>
                          setTransitionTailLeftId(
                            e.target.value === '' ? null : e.target.value,
                          )
                        }
                        className="w-full border rounded px-3 py-2 text-sm bg-card"
                      >
                        <option value="">
                          — (оставить хвост раздела учеников как есть)
                        </option>
                        {templates.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-muted-foreground mt-1">
                        Engine положит этот мастер вместо последней страницы
                        раздела учеников. Если мастер содержит portrait-слоты
                        — хвостовые ученики попадут туда. Иначе — биндятся
                        общие фото по типу мастера (J-Half / J-Collage / J-Full).
                      </p>
                    </div>

                    <div>
                      <label className="text-sm text-foreground block mb-1">
                        Правая страница перехода
                      </label>
                      <select
                        value={transitionTailRightId ?? ''}
                        onChange={(e) =>
                          setTransitionTailRightId(
                            e.target.value === '' ? null : e.target.value,
                          )
                        }
                        className="w-full border rounded px-3 py-2 text-sm bg-card"
                      >
                        <option value="">
                          — (закрыть как обычно — J-цепочка)
                        </option>
                        {templates.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-muted-foreground mt-1">
                        Если левая страница transition оказалась на левой
                        развороте — правая будет «висеть». Этот мастер закроет
                        её. Если не выбрано — engine закроет автоматически
                        через стандартную J-цепочку.
                      </p>
                    </div>

                    {transitionTailLeftId === null && transitionTailRightId === null && (
                      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                        Оба поля пустые — это равнозначно «По умолчанию».
                        Выберите хотя бы один мастер либо переключитесь
                        на «По умолчанию».
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </section>

          {/* ─── section_structure редактор ─── */}
          <section className="space-y-3 border-t pt-6">
            <div>
              <h3 className="font-semibold text-sm text-foreground uppercase tracking-wide">
                Структура альбома (section_structure)
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                Порядок секций сверху вниз. Engine собирает альбом следуя этому
                списку. Перетащите секцию за ⋮⋮ слева чтобы изменить порядок
                (или используйте стрелки ▲▼).
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
              onReorder={reorderSections}
            />

            <AddSectionPicker
              onAdd={addSection}
              existingTypes={new Set(sections.map((s) => s.type))}
            />
          </section>
        </div>

        {/* ─── Footer: save / cancel ─── */}
        <div className="px-6 py-4 border-t bg-muted">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm mb-3">
              {error}
            </div>
          )}
          <div className="flex items-center justify-end gap-3">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-sm text-foreground hover:bg-muted rounded"
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
  onReorder,
}: {
  sections: Section[]
  templates: SpreadTemplate[]
  templatesLoading: boolean
  hasTemplateSet: boolean
  onUpdate: (idx: number, patch: Partial<Section>) => void
  onRemove: (idx: number) => void
  onMove: (idx: number, dir: -1 | 1) => void
  onReorder: (oldIdx: number, newIdx: number) => void
}) {
  // РЭ.45: DnD для секций. Используем тот же паттерн что в
  // CommonRequiredPagesEditor — @dnd-kit с verticalListSortingStrategy.
  // ID секции = `section-${idx}-${type}` (синтетический, поскольку
  // одна секция типа common может встречаться 2+ раз — section.type
  // не уникален. См. ALL_SECTION_TYPES.MULTIPLE_ALLOWED).
  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Чтобы кнопки внутри карточки секции (▲▼, × и т.д.) работали
      // без случайного захвата DnD, требуется минимальное смещение
      // курсора перед началом drag.
      activationConstraint: { distance: 5 },
    }),
  )

  const itemIds = sections.map((s, idx) => `section-${idx}-${s.type}`)

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = itemIds.indexOf(String(active.id))
    const newIdx = itemIds.indexOf(String(over.id))
    if (oldIdx === -1 || newIdx === -1) return
    onReorder(oldIdx, newIdx)
  }

  if (sections.length === 0) {
    return (
      <div className="text-sm text-muted-foreground italic border border-dashed rounded p-4">
        Структура пустая. Добавьте секции через кнопки ниже.
      </div>
    )
  }
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {sections.map((s, idx) => (
            <SortableSectionItem
              key={itemIds[idx]}
              id={itemIds[idx]}
              section={s}
              index={idx}
              totalSections={sections.length}
              templates={templates}
              templatesLoading={templatesLoading}
              hasTemplateSet={hasTemplateSet}
              onUpdate={onUpdate}
              onRemove={onRemove}
              onMove={onMove}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}

// ─── SortableSectionItem ──────────────────────────────────────────────────
// РЭ.45: одна секция-карточка в DnD-сортируемом списке. Извлекли в отдельный
// компонент потому что useSortable не может вызываться внутри map напрямую
// (хук должен быть вызван в компоненте). Логика рендера (форма для каждой
// секции по типу) — та же что была inline в SectionsEditor до РЭ.45.
function SortableSectionItem({
  id,
  section: s,
  index: idx,
  totalSections,
  templates,
  templatesLoading,
  hasTemplateSet,
  onUpdate,
  onRemove,
  onMove,
}: {
  id: string
  section: Section
  index: number
  totalSections: number
  templates: SpreadTemplate[]
  templatesLoading: boolean
  hasTemplateSet: boolean
  onUpdate: (idx: number, patch: Partial<Section>) => void
  onRemove: (idx: number) => void
  onMove: (idx: number, dir: -1 | 1) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // При перетаскивании поднимаем карточку над соседями и слегка
    // делаем её полупрозрачной для визуального фидбека.
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-muted border rounded px-3 py-2 flex items-start gap-2"
    >
      {/* Drag-handle ⋮⋮ — слушатели DnD только на нём, чтобы кнопки
          ▲▼ и × внутри карточки работали обычным кликом. */}
      <div
        {...attributes}
        {...listeners}
        className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing select-none px-1 pt-1"
        aria-label="Перетащите чтобы изменить порядок"
        title="Перетащите чтобы изменить порядок"
      >
        ⋮⋮
      </div>
      <div className="flex flex-col gap-0.5 pt-0.5">
        <button
          onClick={() => onMove(idx, -1)}
          disabled={idx === 0}
          className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 px-1"
          aria-label="Вверх"
        >
          ▲
        </button>
        <button
          onClick={() => onMove(idx, 1)}
          disabled={idx === totalSections - 1}
          className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 px-1"
          aria-label="Вниз"
        >
          ▼
        </button>
      </div>
      <div className="flex-1">
        <div className="font-medium text-sm">{SECTION_LABELS[s.type]}</div>
        <div className="text-xs text-muted-foreground font-mono">{s.type}</div>
        {SECTION_DESCRIPTIONS[s.type] && (
          <div className="text-xs text-muted-foreground mt-1">
            {SECTION_DESCRIPTIONS[s.type]}
          </div>
        )}
        {/* ТЗ 17.06.2026 — students: per-section настройки личного раздела */}
        {s.type === 'students' && (
          <StudentsConfigEditor
            config={s.config}
            templates={templates}
            hasTemplateSet={hasTemplateSet}
            templatesLoading={templatesLoading}
            onChange={(cfg) => onUpdate(idx, { config: cfg } as Partial<Section>)}
          />
        )}
        {/* common_additional: max_spreads */}
        {s.type === 'common_additional' && (
          <div className="mt-2 flex items-center gap-2">
            <label className="text-xs text-muted-foreground">max_spreads:</label>
            <input
              type="number"
              min={0}
              max={20}
              value={s.max_spreads}
              onChange={(e) =>
                onUpdate(idx, { max_spreads: Number(e.target.value) } as Partial<Section>)
              }
              className="border border-input rounded px-2 py-0.5 text-xs w-20 bg-card text-foreground dark:bg-background"
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
              <p className="text-xs text-muted-foreground italic">
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
              <p className="text-xs text-muted-foreground italic">
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
        {/* РЭ.42.c — soft_intro / soft_final: опциональный мастер.
            Партнёр может вместо автоматического classphoto положить
            любой мастер template_set (учителя, классный руководитель,
            воспитатели детсада и т.д.). */}
        {(s.type === 'soft_intro' || s.type === 'soft_final') && (
          <div className="mt-3">
            {!hasTemplateSet ? (
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                Выберите дизайн (template_set) у шаблона, чтобы выбрать
                мастер вступительной/финальной страницы.
              </p>
            ) : templatesLoading ? (
              <p className="text-xs text-muted-foreground italic">
                Загрузка мастеров…
              </p>
            ) : (
              <SoftSectionMasterPicker
                sectionType={s.type}
                value={s.master_name ?? null}
                templates={templates}
                onChange={(name) =>
                  onUpdate(idx, { master_name: name } as Partial<Section>)
                }
              />
            )}
          </div>
        )}
        {/* Старая common: max_spreads */}
        {s.type === 'common' && 'mode' in s && s.mode === 'auto' && (
          <div className="mt-2 flex items-center gap-2">
            <label className="text-xs text-muted-foreground">max_spreads:</label>
            <input
              type="number"
              min={0}
              max={20}
              value={s.max_spreads}
              onChange={(e) =>
                onUpdate(idx, { max_spreads: Number(e.target.value) } as Partial<Section>)
              }
              className="border border-input rounded px-2 py-0.5 text-xs w-20 bg-card text-foreground dark:bg-background"
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
  )
}

// ─── StudentsConfigEditor (ТЗ 17.06.2026) ─────────────────────────────────
// Настройки личного раздела внутри записи students списка структуры альбома.
// Перенесены сюда из глобальной шапки — у каждого личного раздела свои.
function StudentsConfigEditor({
  config,
  templates,
  hasTemplateSet,
  templatesLoading,
  onChange,
}: {
  config: StudentsSectionConfig | undefined
  templates: SpreadTemplate[]
  hasTemplateSet: boolean
  templatesLoading: boolean
  onChange: (cfg: StudentsSectionConfig) => void
}) {
  const cfg: StudentsSectionConfig = config ?? defaultStudentsConfig('page')

  const numField = (
    label: string,
    value: number,
    min: number,
    max: number,
    apply: (v: number) => void,
  ) => (
    <div>
      <label className="text-xs text-muted-foreground block mb-0.5">{label}</label>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => apply(clampInt(Number(e.target.value), min, max))}
        className="border border-input rounded px-2 py-0.5 text-xs w-28 bg-card text-foreground dark:bg-background"
      />
    </div>
  )

  const quoteField = (value: boolean, apply: (v: boolean) => void) => (
    <div>
      <label className="text-xs text-muted-foreground block mb-0.5">Цитата</label>
      <select
        value={String(value)}
        onChange={(e) => apply(e.target.value === 'true')}
        className="border border-input rounded px-2 py-0.5 text-xs bg-card text-foreground dark:bg-background"
      >
        <option value="true">есть</option>
        <option value="false">нет</option>
      </select>
    </div>
  )

  // ТЗ 19.06.2026: галочка «персональный раздел» — секция вычленяется в тонкую
  // книгу ученика. Только для режимов, где на печатном листе ОДИН ребёнок
  // (page/spread/multi_spread); в режиме grid не показываем (нельзя нарезать).
  const personalField = (value: boolean, apply: (v: boolean) => void) => (
    <label className="flex items-center gap-2 cursor-pointer text-xs">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => apply(e.target.checked)}
        className="rounded"
      />
      <span className="text-muted-foreground">
        Персональный раздел (сохранять отдельно по ученику)
      </span>
    </label>
  )

  return (
    <div className="mt-2 space-y-2">
      <div>
        <label className="text-xs text-muted-foreground block mb-0.5">Режим</label>
        <select
          value={cfg.mode}
          onChange={(e) =>
            onChange(defaultStudentsConfig(e.target.value as StudentsSectionConfig['mode']))
          }
          className="border border-input rounded px-2 py-0.5 text-xs bg-card text-foreground dark:bg-background"
        >
          <option value="page">1 ученик на страницу</option>
          <option value="spread">1 ученик на разворот</option>
          <option value="multi_spread">1 ученик на несколько разворотов</option>
          <option value="grid">Сетка из N учеников</option>
        </select>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {cfg.mode === 'grid' &&
          numField('Человек на странице', cfg.per_page, 2, 16, (v) =>
            onChange({ mode: 'grid', per_page: v }),
          )}
        {cfg.mode === 'page' && (
          <>
            {numField('Фото с друзьями', cfg.friends, 0, 50, (v) =>
              onChange({ ...cfg, friends: v }),
            )}
            {quoteField(cfg.quote, (q) => onChange({ ...cfg, quote: q }))}
          </>
        )}
        {cfg.mode === 'spread' && (
          <>
            {numField('Фото с друзьями: мин', cfg.friends_min, 0, 50, (v) =>
              onChange({ ...cfg, friends_min: Math.min(v, cfg.friends_max) }),
            )}
            {numField('макс', cfg.friends_max, 0, 50, (v) =>
              onChange({ ...cfg, friends_max: Math.max(v, cfg.friends_min) }),
            )}
            {quoteField(cfg.quote, (q) => onChange({ ...cfg, quote: q }))}
          </>
        )}
        {cfg.mode === 'multi_spread' && (
          <>
            <div>
              <label className="text-xs text-muted-foreground block mb-0.5">Раскладка</label>
              <select
                value={cfg.manual_pages && cfg.manual_pages.length > 0 ? 'manual' : 'auto'}
                onChange={(e) => {
                  if (e.target.value === 'manual') {
                    // Включаем ручной: дефолт — один разворот, ЛЕВАЯ парадная
                    // (портрет), ПРАВАЯ коллаж. Если таких нет — первые из E-*.
                    const ePool = templates.filter((t) => t.name.startsWith('E-'))
                    const parade = ePool.find(isParadeMaster) ?? ePool[0]
                    const collage =
                      ePool.find(isCollageMaster) ?? ePool[1] ?? ePool[0]
                    onChange({
                      ...cfg,
                      manual_pages:
                        parade && collage ? [parade.name, collage.name] : [],
                    })
                  } else {
                    onChange({ ...cfg, manual_pages: null })
                  }
                }}
                className="border border-input rounded px-2 py-0.5 text-xs bg-card text-foreground dark:bg-background"
              >
                <option value="auto">Авто (система сама)</option>
                <option value="manual">Вручную — мои раскладки</option>
              </select>
            </div>
            {!(cfg.manual_pages && cfg.manual_pages.length > 0) &&
              numField('Разворотов на ученика (макс)', cfg.spreads_per_student, 2, 4, (v) =>
                onChange({ ...cfg, spreads_per_student: v }),
              )}
            {quoteField(cfg.quote, (q) => onChange({ ...cfg, quote: q }))}
          </>
        )}
      </div>

      {cfg.mode !== 'grid' && (
        <div className="pt-1">
          {personalField(cfg.is_personal ?? false, (v) =>
            onChange({ ...cfg, is_personal: v }),
          )}
        </div>
      )}

      {cfg.mode === 'multi_spread' && cfg.manual_pages && cfg.manual_pages.length > 0 && (
        <div className="mt-2">
          {!hasTemplateSet ? (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              Выберите дизайн (template_set) у шаблона, чтобы выбирать раскладки личного раздела.
            </p>
          ) : templatesLoading ? (
            <p className="text-xs text-muted-foreground italic">Загрузка мастеров…</p>
          ) : (
            <MultiSpreadManualEditor
              pages={cfg.manual_pages}
              templates={templates}
              onChange={(pages) => onChange({ ...cfg, manual_pages: pages })}
            />
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground italic">{humanStudentsConfigLabel(cfg)}</p>
    </div>
  )
}

// ─── MultiSpreadManualEditor (ТЗ 17.06.2026) ──────────────────────────────
//
// Ручной сценарий личного раздела «несколько разворотов»: партнёр сам строит
// шаблон блока ученика разворот за разворотом, выбирая мастер левой и правой
// страницы из доступных мастеров личного раздела (имена E-*). Этот шаблон
// применяется к КАЖДОМУ ученику; фото текут по страницам слева направо.
//
// pages — плоский список имён мастеров чётной длины [s1L, s1R, s2L, s2R, ...].
// Показываем разворотами (пары), чтобы гарантировать целые развороты.
//
// Список мастеров не фильтруем по -Right (в отличие от Soft/Common picker):
// у личного раздела коллажная страница может называться …-Right
// (например E-Standard-Right «Аква меч» = коллаж на 3 фото).
function MultiSpreadManualEditor({
  pages,
  templates,
  onChange,
}: {
  pages: string[]
  templates: SpreadTemplate[]
  onChange: (pages: string[]) => void
}) {
  // Доступные мастера личного раздела (по конвенции имени E-*).
  const ePool = templates
    .filter((t) => t.name.startsWith('E-'))
    .sort((a, b) => a.name.localeCompare(b.name))

  if (ePool.length === 0) {
    return (
      <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
        В выбранном дизайне нет мастеров личного раздела (E-*). Заказать страницы
        у дизайнера или выбрать другой дизайн.
      </p>
    )
  }

  // Гарантируем чётную длину для отображения парами.
  const safe = pages.length % 2 === 0 ? pages : [...pages, ePool[0].name]
  const spreadCount = safe.length / 2

  // Какая страница сейчас выбирается (индекс в safe) — для модалки-пикера.
  const [pickFor, setPickFor] = useState<number | null>(null)

  const setPage = (pageIdx: number, name: string) => {
    const next = [...safe]
    next[pageIdx] = name
    onChange(next)
  }
  // Новый разворот — по умолчанию обе страницы коллажные (парад только на 1-м).
  const collagePool = ePool.filter(isCollageMaster)
  const addSpread = () => {
    const c1 = collagePool[0]?.name ?? ePool[0].name
    const c2 = collagePool[1]?.name ?? c1
    onChange([...safe, c1, c2])
  }
  const removeSpread = (spreadIdx: number) => {
    const next = safe.filter((_, i) => i < spreadIdx * 2 || i >= spreadIdx * 2 + 2)
    onChange(next)
  }

  // Визуальная карточка страницы: мини-эскиз раскладки + человекочитаемая подпись.
  const pageCard = (pageIdx: number, sideLabel: string) => {
    const value = safe[pageIdx]
    const master = ePool.find((t) => t.name === value)
    return (
      <button
        type="button"
        onClick={() => setPickFor(pageIdx)}
        className="flex-1 flex flex-col items-center gap-1 border border-input rounded p-1.5 bg-card hover:border-purple-400 transition-colors"
        title="Выбрать раскладку страницы"
      >
        <span className="text-[10px] text-muted-foreground">{sideLabel}</span>
        {master ? (
          <MasterSchematic master={master} />
        ) : (
          <div className="w-[56px] h-[78px] rounded border border-dashed border-border flex items-center justify-center text-muted-foreground text-lg">
            ?
          </div>
        )}
        <span className="text-[11px] text-center leading-tight text-foreground">
          {master ? humanMasterLabel(master) : value ? `${value} (нет в дизайне)` : '— выбрать —'}
        </span>
      </button>
    )
  }

  return (
    <div className="space-y-2 border border-border rounded p-2 bg-muted/30">
      <p className="text-xs text-muted-foreground">
        Постройте блок одного ученика по разворотам. Первая страница обычно
        парадная (портрет+ФИО+цитата), остальные — коллажи. Нажмите на страницу,
        чтобы выбрать раскладку. Применится ко всем ученикам; фото распределятся
        слева направо.
      </p>
      {Array.from({ length: spreadCount }, (_, s) => (
        <div key={s} className="flex items-stretch gap-2">
          <span className="text-xs text-muted-foreground w-20 shrink-0 self-center">
            Разворот {s + 1}
          </span>
          {pageCard(s * 2, 'левая')}
          {pageCard(s * 2 + 1, 'правая')}
          <button
            onClick={() => removeSpread(s)}
            disabled={spreadCount <= 1}
            className="text-xs text-red-500 hover:text-red-700 px-1 self-center disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Удалить разворот"
            title={spreadCount <= 1 ? 'Нужен хотя бы один разворот' : 'Удалить разворот'}
          >
            ×
          </button>
        </div>
      ))}
      <button
        onClick={addSpread}
        className="text-xs px-3 py-1 rounded border border-purple-300 text-purple-700 hover:bg-purple-50"
      >
        + Добавить разворот
      </button>

      {/* Модалка-пикер: сетка мастеров личного раздела с эскизами. */}
      {pickFor !== null && (
        <div
          className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4"
          onClick={() => setPickFor(null)}
        >
          <div
            className="bg-card text-foreground border border-border rounded-lg p-4 max-w-2xl w-full max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium">Выберите раскладку страницы</h4>
              <button
                onClick={() => setPickFor(null)}
                className="text-muted-foreground hover:text-foreground text-lg leading-none"
                aria-label="Закрыть"
              >
                ×
              </button>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {ePool.map((t) => {
                const selected = safe[pickFor] === t.name
                return (
                  <button
                    key={t.id}
                    onClick={() => {
                      setPage(pickFor, t.name)
                      setPickFor(null)
                    }}
                    className={`flex flex-col items-center gap-1 border rounded p-2 bg-card hover:border-purple-400 transition-colors ${
                      selected ? 'border-purple-500 ring-1 ring-purple-500' : 'border-border'
                    }`}
                  >
                    <MasterSchematic master={t} />
                    <span className="text-[11px] text-center leading-tight">
                      {humanMasterLabel(t)}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono">{t.name}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
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
  // ТЗ 17.06.2026: несколько личных разделов (students) с разными режимами.
  const MULTIPLE_ALLOWED = new Set<Section['type']>([
    'common',
    'common_additional',
    'students',
  ])

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
                ? 'border-border text-muted-foreground cursor-not-allowed'
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
//     sixthphoto_* / collagephoto_* / spreadphoto) ИЛИ page_role='common'
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
        l.match(/^sixthphoto_\d+$/) ||
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
      <label className="text-xs text-muted-foreground">Мастер переходной страницы:</label>
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

// ─── SoftSectionMasterPicker ─────────────────────────────────────────────
//
// РЭ.42.c — выбор мастера для soft_intro / soft_final.
//
// Опциональный select: «По умолчанию (общее фото класса)» или конкретный
// мастер из template_set'а. Используется когда партнёр хочет вместо
// автоматического classphoto положить учителей / классного руководителя /
// воспитателей / любой другой мастер на вступительной (правая 1-го разворота)
// или финальной странице soft-альбома.
//
// Фильтрация: показываем ВСЕ мастера template_set без -Right вариантов
// (зеркальные дубликаты для зеркальных пресетов). Партнёр сам решает что
// положить — у мастера могут быть placeholder'ы любых типов (classphoto,
// teacher, half, subjects). Engine при override автоматически связывает
// все известные placeholder'ы (см. bindOverrideMasterPlaceholders, РЭ.42.b.2).

function SoftSectionMasterPicker({
  sectionType,
  value,
  templates,
  onChange,
}: {
  sectionType: 'soft_intro' | 'soft_final'
  value: string | null
  templates: SpreadTemplate[]
  onChange: (masterName: string | null) => void
}) {
  // -Right варианты не показываем — это зеркальные дубликаты, engine
  // подставит их сам если потребуется (см. tryRightMirror в common-required).
  const candidates = templates.filter((t) => !t.name.endsWith('-Right'))

  const selectedExists =
    value === null || candidates.some((t) => t.name === value)

  const sectionLabel =
    sectionType === 'soft_intro' ? 'вступительной' : 'финальной'
  const defaultLabel =
    sectionType === 'soft_intro'
      ? 'По умолчанию (общее фото класса)'
      : 'По умолчанию (общее фото класса / прощание)'

  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">
        Мастер {sectionLabel} страницы:
      </label>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        className="w-full border rounded px-2 py-1 text-sm"
      >
        <option value="">{defaultLabel}</option>
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
      <p className="text-xs text-muted-foreground">
        {sectionType === 'soft_intro'
          ? 'Выберите свой мастер (учителя, классный руководитель, воспитатели и т.д.) или оставьте по умолчанию — engine положит общее фото класса.'
          : 'Выберите свой мастер для финальной страницы или оставьте по умолчанию — engine положит общее фото класса / прощание.'}
      </p>
    </div>
  )
}
