/**
 * Тестовые фикстуры мастеров (РЭ.10).
 *
 * Минимальные SpreadTemplate для всех мастеров, которые упоминаются
 * в 36 правилах rule engine. Placeholders сделаны достаточно полными
 * чтобы:
 *   - apply.ts корректно заполнял null для несвязанных меток
 *   - balance.ts мог найти группы studentportrait_N, teacherphoto_N
 *
 * Координаты упрощены — это unit-тесты алгоритма, а не визуальный рендер.
 * Сетки сделаны 3 столбца × N строк, шаг 50мм.
 */

import type { SpreadTemplate, Placeholder } from '@/lib/album-builder/types';

// =============================================================================
// Helpers
// =============================================================================

function photoSlot(label: string, x: number, y: number): Placeholder {
  return {
    label,
    x_mm: x,
    y_mm: y,
    width_mm: 40,
    height_mm: 55,
    type: 'photo',
    fit: 'fill_proportional',
    required: false,
  };
}

function textSlot(label: string, x: number, y: number): Placeholder {
  return {
    label,
    x_mm: x,
    y_mm: y,
    width_mm: 60,
    height_mm: 8,
    type: 'text',
    font_family: 'Arial',
    font_size_pt: 10,
    font_weight: 'regular',
    color: '#000',
    align: 'center',
    vertical_align: 'middle',
    auto_fit: false,
  };
}

/** Сетка N фотослотов с метками `${prefix}_1..N`. Колонок=cols, шаг 50мм. */
function gridSlots(prefix: string, count: number, cols: number, startX = 20, startY = 30): Placeholder[] {
  const out: Placeholder[] = [];
  for (let i = 1; i <= count; i++) {
    const col = (i - 1) % cols;
    const row = Math.floor((i - 1) / cols);
    out.push(photoSlot(`${prefix}_${i}`, startX + col * 50, startY + row * 60));
  }
  return out;
}

function makeMaster(name: string, placeholders: Placeholder[], is_spread = false): SpreadTemplate {
  // MasterType — это семантический тип legacy (student/head_teacher/subjects/common/cover/intro),
  // а не page_type rule engine. Для тестовых фикстур ставим минимально подходящий: 'common'.
  return {
    id: `test-master-${name}`,
    name,
    type: 'common',
    is_spread,
    width_mm: 200,
    height_mm: 280,
    placeholders,
    rules: null,
    sort_order: 0,
    applies_to_configs: [],
    default_for_configs: [],
    page_role: null,
    slot_capacity: null,
    is_fallback: false,
    mirror_for_soft: false,
    audit_notes: null,
  };
}

// =============================================================================
// Учительские мастера (F-Head-*)
// =============================================================================

const F_HEAD_WITH_PHOTO = makeMaster('F-Head-WithPhoto', [
  photoSlot('headteacherphoto', 30, 30),
  textSlot('headteachername', 30, 90),
  textSlot('headteacherrole', 30, 100),
  textSlot('headtextframe', 30, 120),
]);

const F_HEAD_SMALL_GRID = makeMaster('F-Head-SmallGrid', [
  photoSlot('headteacherphoto', 30, 30),
  textSlot('headteachername', 30, 90),
  textSlot('headteacherrole', 30, 100),
  textSlot('headtextframe', 30, 120),
  ...gridSlots('teacherphoto', 4, 2, 20, 160),
  ...gridSlots('teachername', 4, 2, 20, 220).map((p) => ({ ...p, type: 'text' as const, label: p.label, font_family: 'Arial', font_size_pt: 8, font_weight: 'regular' as const, color: '#000', align: 'center' as const, vertical_align: 'middle' as const, auto_fit: false })),
  ...gridSlots('teacherrole', 4, 2, 20, 230).map((p) => ({ ...p, type: 'text' as const, label: p.label, font_family: 'Arial', font_size_pt: 7, font_weight: 'regular' as const, color: '#666', align: 'center' as const, vertical_align: 'middle' as const, auto_fit: false })),
]);

const F_HEAD_WITH_CLASS_PHOTO_L = makeMaster('F-Head-WithClassPhoto-L', [
  photoSlot('headteacherphoto', 30, 30),
  textSlot('headteachername', 30, 90),
  textSlot('headteacherrole', 30, 100),
  textSlot('headtextframe', 30, 120),
  photoSlot('classphotoframe', 30, 180),
]);

// =============================================================================
// Учительские правые (G-*)
// =============================================================================

const G_HALF_CLASS = makeMaster('G-HalfClass', [
  photoSlot('halfphoto_1', 30, 30),
  photoSlot('halfphoto_2', 30, 150),
]);

const G_FULL_CLASS = makeMaster('G-FullClass', [photoSlot('classphotoframe', 30, 60)]);

const G_TEACHERS_3X3 = makeMaster('G-Teachers-3x3', [
  ...gridSlots('teacherphoto', 9, 3),
]);

const G_TEACHERS_3X4 = makeMaster('G-Teachers-3x4', [
  ...gridSlots('teacherphoto', 12, 3),
]);

const G_TEACHERS_4X4 = makeMaster('G-Teachers-4x4', [
  ...gridSlots('teacherphoto', 16, 4),
]);

// =============================================================================
// Ученические — Standard, Universal, Maximum
// =============================================================================

const E_STANDARD_LEFT = makeMaster('E-Standard-Left', [
  photoSlot('studentportrait', 30, 30),
  textSlot('studentname', 30, 200),
  textSlot('studentquote', 30, 220),
]);

const E_STANDARD_RIGHT = makeMaster('E-Standard-Right', [
  photoSlot('studentportrait', 30, 30),
  textSlot('studentname', 30, 200),
  textSlot('studentquote', 30, 220),
]);

const E_UNIVERSAL_LEFT = makeMaster('E-Universal-Left', [
  photoSlot('studentportrait', 30, 30),
  textSlot('studentname', 30, 180),
  textSlot('studentquote', 30, 200),
  photoSlot('studentphoto_1', 100, 30),
  photoSlot('studentphoto_2', 100, 100),
]);

const E_UNIVERSAL_RIGHT = makeMaster('E-Universal-Right', [
  photoSlot('studentportrait', 30, 30),
  textSlot('studentname', 30, 180),
  textSlot('studentquote', 30, 200),
  photoSlot('studentphoto_1', 100, 30),
  photoSlot('studentphoto_2', 100, 100),
]);

const E_MAX_LEFT = makeMaster('E-Max-Left', [
  photoSlot('studentportrait', 30, 30),
  textSlot('studentname', 30, 220),
]);

const E_MAX_RIGHT = makeMaster('E-Max-Right', [
  textSlot('studentquote', 30, 20),
  ...gridSlots('studentphoto', 4, 2, 30, 50),
]);

// =============================================================================
// Сеточные (Light/Medium/Mini)
// =============================================================================

const L_GRID_PAGE = makeMaster('L-Grid-Page', [
  ...gridSlots('studentportrait', 6, 2),
  ...gridSlots('studentname', 6, 2, 20, 50),
]);

const M_GRID_PAGE = makeMaster('M-Grid-Page', [
  ...gridSlots('studentportrait', 4, 2),
  ...gridSlots('studentname', 4, 2, 20, 50),
  ...gridSlots('studentquote', 4, 2, 20, 60),
]);

const N_GRID_PAGE = makeMaster('N-Grid-Page', [
  ...gridSlots('studentportrait', 12, 3),
  ...gridSlots('studentname', 12, 3, 20, 50),
]);

const M_COMBINED_PAGE = makeMaster('M-Combined-Page', [
  ...gridSlots('studentportrait', 2, 2),
  ...gridSlots('studentname', 2, 2, 20, 50),
  photoSlot('classphotoframe', 30, 180),
]);

const L_COMBINED_PAGE = makeMaster('L-Combined-Page', [
  ...gridSlots('studentportrait', 3, 3),
  ...gridSlots('studentname', 3, 3, 20, 50),
  photoSlot('classphotoframe', 30, 180),
]);

const N_COMBINED_PAGE = makeMaster('N-Combined-Page', [
  ...gridSlots('studentportrait', 4, 2),
  ...gridSlots('studentname', 4, 2, 20, 50),
  photoSlot('classphotoframe', 30, 180),
]);

// =============================================================================
// Общий раздел (J-*)
// =============================================================================

const J_HALF = makeMaster('J-Half', [
  photoSlot('halfphoto_1', 30, 30),
  photoSlot('halfphoto_2', 30, 150),
]);

const J_FULL = makeMaster('J-Full', [photoSlot('classphotoframe', 30, 60)]);

const J_COLLAGE_6 = makeMaster('J-Collage-6', [...gridSlots('collagephoto', 6, 3)]);

// РЭ.18 + РЭ.18.4 — мастера для полноценного общего раздела
// Имена согласованы с боевой БД (см. SQL запрос 16.05.2026):
//   J-Full (используется на обеих сторонах разворота, нет зеркала)
//   J-Quarter-Left / J-Quarter-Right (есть зеркало)
//   J-Collage-6 (используется на обеих сторонах для разворота из 12 фото)
//   J-Half (уже был)
const J_QUARTER_LEFT = makeMaster('J-Quarter-Left', [
  photoSlot('quarterphoto_1', 30, 30),
  photoSlot('quarterphoto_2', 30, 150),
]);

const J_QUARTER_RIGHT = makeMaster('J-Quarter-Right', [
  photoSlot('quarterphoto_1', 30, 30),
  photoSlot('quarterphoto_2', 30, 150),
]);

// =============================================================================
// Soft intro/final
// =============================================================================

const S_INTRO = makeMaster('S-Intro', [photoSlot('classphotoframe', 30, 60)]);

const S_FINAL_SOFT_L = makeMaster('S-Final-Soft-L', [
  photoSlot('classphotoframe', 30, 30),
  textSlot('finaltext', 30, 200),
]);

// =============================================================================
// Export
// =============================================================================

export const TEST_MASTERS: SpreadTemplate[] = [
  F_HEAD_WITH_PHOTO,
  F_HEAD_SMALL_GRID,
  F_HEAD_WITH_CLASS_PHOTO_L,
  G_HALF_CLASS,
  G_FULL_CLASS,
  G_TEACHERS_3X3,
  G_TEACHERS_3X4,
  G_TEACHERS_4X4,
  E_STANDARD_LEFT,
  E_STANDARD_RIGHT,
  E_UNIVERSAL_LEFT,
  E_UNIVERSAL_RIGHT,
  E_MAX_LEFT,
  E_MAX_RIGHT,
  L_GRID_PAGE,
  M_GRID_PAGE,
  N_GRID_PAGE,
  M_COMBINED_PAGE,
  L_COMBINED_PAGE,
  N_COMBINED_PAGE,
  J_HALF,
  J_FULL,
  J_COLLAGE_6,
  J_QUARTER_LEFT,
  J_QUARTER_RIGHT,
  S_INTRO,
  S_FINAL_SOFT_L,
];

export function makeMastersByName(): Map<string, SpreadTemplate> {
  const m = new Map<string, SpreadTemplate>();
  for (const tpl of TEST_MASTERS) m.set(tpl.name, tpl);
  return m;
}
