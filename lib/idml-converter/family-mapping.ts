/**
 * family-mapping.ts — определение метаданных rule engine из имени мастера.
 *
 * При загрузке IDML в template_sets / spread_templates через
 * `uploadTemplateSetToSupabase` нужно проставить в каждую строку
 * spread_templates новые поля (введённые миграцией РЭ.1):
 *   - family_id      → template_families.id ('head-teacher', 'student-section', ...)
 *   - page_type      → 'page-left' | 'page-right' | 'page-any' | 'spread'
 *   - density        → для student-section мастеров: max/universal/standard/medium/light/mini
 *   - params         → произвольный jsonb, сейчас используется:
 *                        - parametric: true (для M/L/N-Grid-Page — диапазон слотов)
 *                        - has_class_photo_bottom: true (для M/L/N-Combined-Page)
 *
 * РЭ.58: ТАКЖЕ заполняем legacy-поля по которым ищут движки (engine'ы):
 *   - page_role            → 'student_left' | 'student_right' | 'student_grid' |
 *                            'teacher_left' | 'teacher_right' | 'common' |
 *                            'intro' | 'final' (см. types.ts:188-203 PageRole)
 *   - slot_capacity        → jsonb { students, photos_friend, has_quote,
 *                            has_portrait, has_name, ... }
 *   - applies_to_configs   → массив комплектаций для фильтра в findStudentMaster
 *                            (пустой массив = универсальный мастер,
 *                            применим везде)
 *
 * Раньше эти поля оставались NULL после загрузки IDML — поэтому движок
 * учеников (lib/rule-engine/sections/students.ts → findStudentMaster)
 * не мог найти ни одного мастера и выдавал warning 'students_master_
 * not_found'. Personal section вообще не собирался у партнёров.
 *
 * Маппинг основан на:
 *   - ТЗ дизайнеру v1.5 (docs/templates/designer-tz-2026-05-16-v1.5.md)
 *   - spec rule engine v1.3 (docs/rule-engine-spec.md), §3.1 список семейств
 *   - tests fixtures (lib/rule-engine/__tests__/sections-students-page-
 *     semantic.test.ts:115-175) — образец какие значения движок ожидает
 *
 * Принцип: жёсткая таблица + правила-исключения. Если имя мастера НЕ
 * матчится ни с одним правилом — возвращаем null (загрузка продолжится,
 * но `family_id` останется NULL и мастер не попадёт в правила rule engine
 * пока админ не проставит вручную через SQL).
 */

import type { Density, PageType } from '../rule-engine/types';
import type { PageRole, SlotCapacity } from '../album-builder/types';

export interface FamilyMapping {
  family_id: string;
  page_type: PageType;
  density?: Density;
  params: Record<string, unknown>;
  /** РЭ.58: legacy-поле для движков (page_role в lib/album-builder/types.ts). */
  page_role: PageRole | null;
  /** РЭ.58: семантическая ёмкость (students, photos_friend, has_quote, ...). */
  slot_capacity: SlotCapacity | null;
  /**
   * РЭ.58: applies_to_configs — список комплектаций где мастер уместен.
   * Пустой массив [] = универсальный (применим везде).
   */
  applies_to_configs: string[];
}

/**
 * Жёсткая таблица соответствия имени мастера → метаданным rule engine.
 *
 * Имена синхронизированы с ТЗ v1.5. Если дизайнер переименует мастер
 * в IDML — нужно либо вернуть имя ТЗ, либо обновить эту таблицу.
 *
 * Не покрывает все возможные варианты — только текущий набор (30 мастеров).
 */
const MAPPING: Record<string, FamilyMapping> = {
  // ─── F: head-teacher ─────────────────────────────────────────────
  // Учительская страница с классруком. В layflat может быть слева
  // или справа (page-any), в soft — единственная страница разворота.
  // F-Head-WithClassPhoto-L жёстко слева (там общее фото внизу
  // привязано к левой композиции).
  'F-Head-WithPhoto': {
    family_id: 'head-teacher',
    page_type: 'page-any',
    params: {},
    page_role: 'teacher_left',
    slot_capacity: { head_teacher: 1, teachers: 0 },
    applies_to_configs: [],
  },
  'F-Head-SmallGrid': {
    family_id: 'head-teacher',
    page_type: 'page-any',
    params: {},
    page_role: 'teacher_left',
    slot_capacity: { head_teacher: 1, teachers: 4 },
    applies_to_configs: [],
  },
  'F-Head-LargeGrid': {
    family_id: 'head-teacher',
    page_type: 'page-any',
    params: {},
    page_role: 'teacher_left',
    slot_capacity: { head_teacher: 1, teachers: 8 },
    applies_to_configs: [],
  },
  'F-Head-WithClassPhoto-L': {
    family_id: 'head-teacher',
    page_type: 'page-left',
    params: {},
    page_role: 'teacher_left',
    slot_capacity: { head_teacher: 1, photos_full: 1 },
    applies_to_configs: [],
  },

  // ─── G: subject-teachers (правая страница при subjects ≥ 9) ──────
  'G-Teachers-3x3': {
    family_id: 'subject-teachers',
    page_type: 'page-right',
    params: { parametric: true, grid_modes: [{ slot_count: 9, rows: 3, cols: 3 }] },
    page_role: 'teacher_right',
    slot_capacity: { teachers: 9 },
    applies_to_configs: [],
  },
  'G-Teachers-3x4': {
    family_id: 'subject-teachers',
    page_type: 'page-right',
    params: { parametric: true, grid_modes: [{ slot_count: 12, rows: 3, cols: 4 }] },
    page_role: 'teacher_right',
    slot_capacity: { teachers: 12 },
    applies_to_configs: [],
  },
  'G-Teachers-4x4': {
    family_id: 'subject-teachers',
    page_type: 'page-right',
    params: { parametric: true, grid_modes: [{ slot_count: 16, rows: 4, cols: 4 }] },
    page_role: 'teacher_right',
    slot_capacity: { teachers: 16 },
    applies_to_configs: [],
  },

  // ─── G: class-photo ──────────────────────────────────────────────
  'G-FullClass': {
    family_id: 'class-photo',
    page_type: 'page-any',
    params: {},
    page_role: 'teacher_right',
    slot_capacity: { photos_full: 1 },
    applies_to_configs: [],
  },
  'G-HalfClass': {
    family_id: 'class-photo',
    page_type: 'page-any',
    params: {},
    page_role: 'teacher_right',
    slot_capacity: { photos_half: 2 },
    applies_to_configs: [],
  },

  // ─── E: student-section (max / universal / standard) ─────────────
  // Каждая страница — отдельный ученик. capacity_per_spread = 2.
  // photos_friend: E-Max-Right=4 (фото с друзьями), E-Universal=2 (на странице),
  // E-Standard=0. has_quote: E-Max-Left=false (только портрет+ФИО),
  // остальные true. has_portrait: true для всех кроме E-Max-Right
  // (там только фото с друзьями + цитата, портрет на Left).
  'E-Max-Left': {
    family_id: 'student-section',
    page_type: 'page-left',
    density: 'maximum',
    params: {},
    page_role: 'student_left',
    slot_capacity: {
      students: 1,
      photos_friend: 0,
      has_quote: false,
      has_portrait: true,
      has_name: true,
    },
    applies_to_configs: [],
  },
  'E-Max-Right': {
    family_id: 'student-section',
    page_type: 'page-right',
    density: 'maximum',
    params: {},
    page_role: 'student_right',
    slot_capacity: {
      students: 1,
      photos_friend: 4,
      has_quote: true,
      has_portrait: false,
      has_name: false,
    },
    applies_to_configs: [],
  },
  'E-Universal-Left': {
    family_id: 'student-section',
    page_type: 'page-left',
    density: 'universal',
    params: {},
    page_role: 'student_left',
    slot_capacity: {
      students: 1,
      photos_friend: 2,
      has_quote: true,
      has_portrait: true,
      has_name: true,
    },
    applies_to_configs: [],
  },
  'E-Universal-Right': {
    family_id: 'student-section',
    page_type: 'page-right',
    density: 'universal',
    params: {},
    page_role: 'student_right',
    slot_capacity: {
      students: 1,
      photos_friend: 2,
      has_quote: true,
      has_portrait: true,
      has_name: true,
    },
    applies_to_configs: [],
  },
  'E-Standard-Left': {
    family_id: 'student-section',
    page_type: 'page-left',
    density: 'standard',
    params: {},
    page_role: 'student_left',
    slot_capacity: {
      students: 1,
      photos_friend: 0,
      has_quote: true,
      has_portrait: true,
      has_name: true,
    },
    applies_to_configs: [],
  },
  'E-Standard-Right': {
    family_id: 'student-section',
    page_type: 'page-right',
    density: 'standard',
    params: {},
    page_role: 'student_right',
    slot_capacity: {
      students: 1,
      photos_friend: 0,
      has_quote: true,
      has_portrait: true,
      has_name: true,
    },
    applies_to_configs: [],
  },

  // ─── M/L/N: student-section сетки (параметрические) ──────────────
  // students = максимум что мастер вмещает. Движок ищет с match='exact'
  // для базы сетки и 'min_fit' для адаптивного хвоста.
  'M-Grid-Page': {
    family_id: 'student-section',
    page_type: 'page-any',
    density: 'medium',
    params: { parametric: true, grid_modes: gridModes(1, 4) },
    page_role: 'student_grid',
    slot_capacity: {
      students: 4,
      photos_full: 0,
      has_quote: true,
      has_portrait: true,
      has_name: true,
    },
    applies_to_configs: [],
  },
  'L-Grid-Page': {
    family_id: 'student-section',
    page_type: 'page-any',
    density: 'light',
    params: { parametric: true, grid_modes: gridModes(1, 6) },
    page_role: 'student_grid',
    slot_capacity: {
      students: 6,
      photos_full: 0,
      has_quote: false,
      has_portrait: true,
      has_name: true,
    },
    applies_to_configs: [],
  },
  'N-Grid-Page': {
    family_id: 'student-section',
    page_type: 'page-any',
    density: 'mini',
    params: { parametric: true, grid_modes: gridModes(1, 12) },
    page_role: 'student_grid',
    slot_capacity: {
      students: 12,
      photos_full: 0,
      has_quote: false,
      has_portrait: true,
      has_name: true,
    },
    applies_to_configs: [],
  },

  // ─── M/L/N: Combined мастера (маленький остаток + общее фото) ────
  // has_class_photo_bottom: true — флаг для правил rule engine.
  // photos_full: 1 — отличает Combined от обычных Grid в findStudentGrid.
  'M-Combined-Page': {
    family_id: 'student-section',
    page_type: 'page-any',
    density: 'medium',
    params: {
      parametric: true,
      has_class_photo_bottom: true,
      grid_modes: gridModes(1, 2),
    },
    page_role: 'student_grid',
    slot_capacity: {
      students: 2,
      photos_full: 1,
      has_quote: true,
      has_portrait: true,
      has_name: true,
    },
    applies_to_configs: [],
  },
  'L-Combined-Page': {
    family_id: 'student-section',
    page_type: 'page-any',
    density: 'light',
    params: {
      parametric: true,
      has_class_photo_bottom: true,
      grid_modes: gridModes(1, 3),
    },
    page_role: 'student_grid',
    slot_capacity: {
      students: 3,
      photos_full: 1,
      has_quote: false,
      has_portrait: true,
      has_name: true,
    },
    applies_to_configs: [],
  },
  'N-Combined-Page': {
    family_id: 'student-section',
    page_type: 'page-any',
    density: 'mini',
    params: {
      parametric: true,
      has_class_photo_bottom: true,
      grid_modes: gridModes(1, 4),
    },
    page_role: 'student_grid',
    slot_capacity: {
      students: 4,
      photos_full: 1,
      has_quote: false,
      has_portrait: true,
      has_name: true,
    },
    applies_to_configs: [],
  },

  // ─── J: common-section ───────────────────────────────────────────
  'J-Spread': {
    family_id: 'common-section',
    page_type: 'spread',
    params: {},
    page_role: 'common',
    slot_capacity: { photos_full: 1 },
    applies_to_configs: [],
  },
  'J-Full': {
    family_id: 'common-section',
    page_type: 'page-any',
    params: {},
    page_role: 'common',
    slot_capacity: { photos_full: 1 },
    applies_to_configs: [],
  },
  'J-Half': {
    family_id: 'common-section',
    page_type: 'page-any',
    params: {},
    page_role: 'common',
    slot_capacity: { photos_half: 2 },
    applies_to_configs: [],
  },
  'J-Quarter-Left': {
    family_id: 'common-section',
    page_type: 'page-left',
    params: {},
    page_role: 'common',
    slot_capacity: { photos_quarter: 2 },
    applies_to_configs: [],
  },
  'J-Quarter-Right': {
    family_id: 'common-section',
    page_type: 'page-right',
    params: {},
    page_role: 'common',
    slot_capacity: { photos_quarter: 2 },
    applies_to_configs: [],
  },
  'J-Collage-4': {
    family_id: 'common-section',
    page_type: 'page-any',
    params: {},
    page_role: 'common',
    slot_capacity: { photos_collage: 4 },
    applies_to_configs: [],
  },
  'J-Sixth-6': {
    family_id: 'common-section',
    page_type: 'page-any',
    params: {},
    page_role: 'common',
    slot_capacity: { photos_sixth: 6 },
    applies_to_configs: [],
  },

  // ─── S: intro / final (только soft) ──────────────────────────────
  'S-Intro': {
    family_id: 'intro',
    page_type: 'page-right',
    params: {},
    page_role: 'intro',
    slot_capacity: { photos_full: 1 },
    applies_to_configs: [],
  },
  'S-Final-Soft-L': {
    family_id: 'final',
    page_type: 'page-left',
    params: {},
    page_role: 'final',
    slot_capacity: { photos_full: 1 },
    applies_to_configs: [],
  },

  // ─── J-Combined-Tail-* (transition combo, см. РЭ.37) ────────────
  // Стабы в БД (РЭ.37.3); InDesign арт ещё не нарисован (РЭ.37.8).
  // Эти мастера попадают в IDML загрузку как зарегистрированные имена,
  // поэтому маппинг должен присутствовать чтобы при упоминании в IDML
  // (или при upserting через SQL) поля page_role/slot_capacity
  // заполнялись. Если в IDML их нет — не страшно, маппинг не используется.
  'J-Combined-Tail-2': {
    family_id: 'common-section',
    page_type: 'page-left',
    params: { has_class_photo_bottom: true, students_count: 2 },
    page_role: 'student_grid',
    slot_capacity: { students: 2, photos_full: 1 },
    applies_to_configs: [],
  },
  'J-Combined-Tail-2-Right': {
    family_id: 'common-section',
    page_type: 'page-right',
    params: { has_class_photo_bottom: true, students_count: 2 },
    page_role: 'student_grid',
    slot_capacity: { students: 2, photos_full: 1 },
    applies_to_configs: [],
  },
  'J-Combined-Tail-3': {
    family_id: 'common-section',
    page_type: 'page-left',
    params: { has_class_photo_bottom: true, students_count: 3 },
    page_role: 'student_grid',
    slot_capacity: { students: 3, photos_full: 1 },
    applies_to_configs: [],
  },
  'J-Combined-Tail-3-Right': {
    family_id: 'common-section',
    page_type: 'page-right',
    params: { has_class_photo_bottom: true, students_count: 3 },
    page_role: 'student_grid',
    slot_capacity: { students: 3, photos_full: 1 },
    applies_to_configs: [],
  },
  'J-Combined-Tail-4': {
    family_id: 'common-section',
    page_type: 'page-left',
    params: { has_class_photo_bottom: true, students_count: 4 },
    page_role: 'student_grid',
    slot_capacity: { students: 4, photos_full: 1 },
    applies_to_configs: [],
  },
  'J-Combined-Tail-4-Right': {
    family_id: 'common-section',
    page_type: 'page-right',
    params: { has_class_photo_bottom: true, students_count: 4 },
    page_role: 'student_grid',
    slot_capacity: { students: 4, photos_full: 1 },
    applies_to_configs: [],
  },
};

/**
 * Хелпер — сгенерировать массив grid_modes от 1 до maxSlots слотов.
 * Используется для параметрических Grid- и Combined-мастеров.
 */
function gridModes(minSlots: number, maxSlots: number): Array<{ slot_count: number }> {
  const out: Array<{ slot_count: number }> = [];
  for (let n = minSlots; n <= maxSlots; n += 1) {
    out.push({ slot_count: n });
  }
  return out;
}

/**
 * Получить маппинг для конкретного имени мастера.
 *
 * Возвращает null если мастер неизвестен — это не ошибка, просто
 * мастер будет загружен без family_id/page_type/density/params,
 * и админ может проставить вручную через SQL позже.
 */
export function getFamilyMapping(masterName: string): FamilyMapping | null {
  return MAPPING[masterName] ?? null;
}

/**
 * Список всех имён мастеров, для которых есть маппинг.
 * Используется в dry-run для отчёта о coverage.
 */
export function getKnownMasterNames(): readonly string[] {
  return Object.keys(MAPPING);
}
