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
 * Маппинг основан на:
 *   - ТЗ дизайнеру v1.5 (docs/templates/designer-tz-2026-05-16-v1.5.md), §1
 *     описывает соответствие префикса семейству
 *   - spec rule engine v1.3 (docs/rule-engine-spec.md), §3.1 список семейств
 *
 * Принцип: жёсткая таблица + правила-исключения. Если имя мастера НЕ
 * матчится ни с одним правилом — возвращаем null (загрузка продолжится,
 * но `family_id` останется NULL и мастер не попадёт в правила rule engine
 * пока админ не проставит вручную через SQL).
 */

import type { Density, PageType } from '../rule-engine/types';

export interface FamilyMapping {
  family_id: string;
  page_type: PageType;
  density?: Density;
  params: Record<string, unknown>;
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
  // page-any в layflat (мастер может оказаться слева или справа),
  // но F-Head-WithClassPhoto-L строго слева — там общее фото внизу
  // привязано к левой композиции.
  'F-Head-WithPhoto': {
    family_id: 'head-teacher',
    page_type: 'page-any',
    params: {},
  },
  'F-Head-SmallGrid': {
    family_id: 'head-teacher',
    page_type: 'page-any',
    params: {},
  },
  'F-Head-LargeGrid': {
    family_id: 'head-teacher',
    page_type: 'page-any',
    params: {},
  },
  'F-Head-WithClassPhoto-L': {
    family_id: 'head-teacher',
    page_type: 'page-left',
    params: {},
  },

  // ─── G: subject-teachers (правая страница при subjects ≥ 9) ──────
  'G-Teachers-3x3': {
    family_id: 'subject-teachers',
    page_type: 'page-right',
    params: { parametric: true, grid_modes: [{ slot_count: 9, rows: 3, cols: 3 }] },
  },
  'G-Teachers-3x4': {
    family_id: 'subject-teachers',
    page_type: 'page-right',
    params: { parametric: true, grid_modes: [{ slot_count: 12, rows: 3, cols: 4 }] },
  },
  'G-Teachers-4x4': {
    family_id: 'subject-teachers',
    page_type: 'page-right',
    params: { parametric: true, grid_modes: [{ slot_count: 16, rows: 4, cols: 4 }] },
  },

  // ─── G: class-photo ──────────────────────────────────────────────
  'G-FullClass': {
    family_id: 'class-photo',
    page_type: 'page-any',
    params: {},
  },
  'G-HalfClass': {
    family_id: 'class-photo',
    page_type: 'page-any',
    params: {},
  },

  // ─── E: student-section (max / universal / standard) ─────────────
  // Каждая страница — отдельный ученик. capacity_per_spread = 2.
  'E-Max-Left': {
    family_id: 'student-section',
    page_type: 'page-left',
    density: 'maximum',
    params: {},
  },
  'E-Max-Right': {
    family_id: 'student-section',
    page_type: 'page-right',
    density: 'maximum',
    params: {},
  },
  'E-Universal-Left': {
    family_id: 'student-section',
    page_type: 'page-left',
    density: 'universal',
    params: {},
  },
  'E-Universal-Right': {
    family_id: 'student-section',
    page_type: 'page-right',
    density: 'universal',
    params: {},
  },
  'E-Standard-Left': {
    family_id: 'student-section',
    page_type: 'page-left',
    density: 'standard',
    params: {},
  },
  'E-Standard-Right': {
    family_id: 'student-section',
    page_type: 'page-right',
    density: 'standard',
    params: {},
  },

  // ─── M/L/N: student-section сетки (параметрические) ──────────────
  'M-Grid-Page': {
    family_id: 'student-section',
    page_type: 'page-any',
    density: 'medium',
    params: { parametric: true, grid_modes: gridModes(1, 4) },
  },
  'L-Grid-Page': {
    family_id: 'student-section',
    page_type: 'page-any',
    density: 'light',
    params: { parametric: true, grid_modes: gridModes(1, 6) },
  },
  'N-Grid-Page': {
    family_id: 'student-section',
    page_type: 'page-any',
    density: 'mini',
    params: { parametric: true, grid_modes: gridModes(1, 12) },
  },

  // ─── M/L/N: Combined мастера (маленький остаток + общее фото) ────
  // has_class_photo_bottom: true — флаг для правил rule engine.
  // grid_modes здесь меньше чем у обычных Grid (M=2, L=3, N=4) —
  // это отдельный продуктовый вид страницы, не «обрезанная сетка».
  'M-Combined-Page': {
    family_id: 'student-section',
    page_type: 'page-any',
    density: 'medium',
    params: {
      parametric: true,
      has_class_photo_bottom: true,
      grid_modes: gridModes(1, 2),
    },
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
  },

  // ─── J: common-section ───────────────────────────────────────────
  'J-Spread': {
    family_id: 'common-section',
    page_type: 'spread',
    params: {},
  },
  'J-Full': {
    family_id: 'common-section',
    page_type: 'page-any',
    params: {},
  },
  'J-Half': {
    family_id: 'common-section',
    page_type: 'page-any',
    params: {},
  },
  'J-Quarter-Left': {
    family_id: 'common-section',
    page_type: 'page-left',
    params: {},
  },
  'J-Quarter-Right': {
    family_id: 'common-section',
    page_type: 'page-right',
    params: {},
  },
  'J-Collage-4': {
    family_id: 'common-section',
    page_type: 'page-any',
    params: {},
  },
  'J-Collage-6': {
    family_id: 'common-section',
    page_type: 'page-any',
    params: {},
  },

  // ─── S: intro / final (только soft) ──────────────────────────────
  'S-Intro': {
    family_id: 'intro',
    page_type: 'page-right',
    params: {},
  },
  'S-Final-Soft-L': {
    family_id: 'final',
    page_type: 'page-left',
    params: {},
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
