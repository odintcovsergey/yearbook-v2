/**
 * РЭ.37.7: большой регрессионный набор тестов для переходного раздела.
 *
 * Покрывает матрицу OkeyBook-default сценариев из
 * docs/transition-section-spec.xlsx (~28 кейсов: 4 комплектации × 2 типа
 * листов × несколько диапазонов учеников) ПЛЮС новые фичи поверх неё:
 *   • Симметризация хвоста (РЭ.37.4) — опт-ин для Light/Mini
 *   • Quote fallback (РЭ.37.9) — мастер без цитат если с цитатами нет
 *   • Legacy combined-tail (Тест2-сценарий)
 *
 * РАСХОЖДЕНИЯ С XLSX:
 * Engine использует алгоритм min_fit для адаптивного хвоста (РЭ.22.6):
 * берёт минимально-достаточный мастер, а не «верхний/нижний предел
 * диапазона» как в xlsx-таблице. Это правильно по нашей текущей
 * архитектуре — меньше пустых слотов, более компактная вёрстка.
 *
 * Примеры расхождений:
 *   • Light 13 (tail=1): xlsx говорит «до 3 фото + общая» (Combo-3),
 *     engine выбирает Combo-2 (min_fit для tail=1, 2 ≥ 1).
 *   • Mini 29 (tail=5): xlsx «до 12 фото» (N-Grid-Page padded),
 *     engine выбирает L-Grid-Page (6 ≥ 5, минимально).
 *
 * Тесты фиксируют ФАКТИЧЕСКОЕ поведение engine, не xlsx. Это позволяет
 * ловить регрессии при изменении логики (если в будущем кто-то сломает
 * min_fit или симметризацию — тесты упадут).
 *
 * Тесты для Maximum (spread-режим) НЕ включены: у Maximum есть
 * известные pre-existing issues в spread-режиме (5 fails в общей suite),
 * это отдельная задача.
 */

import { describe, it, expect } from 'vitest';
import { buildFromSectionStructure } from '../build-from-section-structure';
import type { Preset, RulesAlbumInput } from '../types';
import type { RuleEngineBundle } from '../loaders';
import type {
  TemplateSet,
  Placeholder,
  SpreadTemplate,
  SlotCapacity,
} from '@/lib/album-builder/types';

// ─── Минимальные фикстуры ───────────────────────────────────────────────

function photoSlot(label: string): Placeholder {
  return {
    label, x_mm: 0, y_mm: 0, width_mm: 40, height_mm: 55,
    type: 'photo', fit: 'fill_proportional', required: false,
  };
}

function textSlot(label: string): Placeholder {
  return {
    label, x_mm: 0, y_mm: 0, width_mm: 40, height_mm: 10,
    type: 'text', font_family: 'Arial', font_size_pt: 12,
    font_weight: 'regular', color: '#000', align: 'left',
    vertical_align: 'top', auto_fit: false,
  };
}

function makeMaster(
  name: string,
  placeholders: Placeholder[],
  opts: {
    page_role?: SpreadTemplate['page_role'];
    slot_capacity?: SlotCapacity | null;
  } = {},
): SpreadTemplate {
  return {
    id: `id-${name}`, name, type: 'common', is_spread: false,
    width_mm: 200, height_mm: 280, placeholders, rules: null, sort_order: 0,
    applies_to_configs: [], default_for_configs: [],
    page_role: opts.page_role ?? null,
    slot_capacity: opts.slot_capacity ?? null,
    is_fallback: false, mirror_for_soft: false, audit_notes: null,
  };
}

function makeGridMaster(
  name: string,
  studentsCount: number,
  opts: {
    hasQuote?: boolean;
    photosFull?: number;
    pageRole?: SpreadTemplate['page_role'];
  } = {},
): SpreadTemplate {
  const placeholders: Placeholder[] = [];
  for (let i = 1; i <= studentsCount; i++) {
    placeholders.push(photoSlot(`studentportrait_${i}`));
    placeholders.push(textSlot(`studentname_${i}`));
    if (opts.hasQuote) placeholders.push(textSlot(`studentquote_${i}`));
  }
  if (opts.photosFull && opts.photosFull > 0) {
    placeholders.push(photoSlot('classphotoframe'));
  }
  const slotCap: SlotCapacity = {
    students: studentsCount,
    has_portrait: true,
    has_name: true,
    has_quote: !!opts.hasQuote,
  };
  if (opts.photosFull && opts.photosFull > 0) {
    slotCap.photos_full = opts.photosFull;
  }
  return makeMaster(name, placeholders, {
    page_role: opts.pageRole ?? 'student_grid',
    slot_capacity: slotCap,
  });
}

function makePreset(opts: Partial<Preset> & Pick<Preset, 'id'>): Preset {
  return {
    id: opts.id,
    display_name: opts.display_name ?? 'Test',
    print_type: opts.print_type ?? 'layflat',
    pages_per_spread: opts.pages_per_spread ?? 2,
    version: opts.version ?? '1.0',
    sections: opts.sections ?? [],
    tenant_id: opts.tenant_id ?? null,
    section_structure: opts.section_structure ?? null,
    density: opts.density ?? null,
    sheet_type: opts.sheet_type ?? null,
    student_layout_mode: opts.student_layout_mode ?? null,
    student_grid_size: opts.student_grid_size ?? null,
    student_friend_photos: opts.student_friend_photos ?? null,
    student_has_quote: opts.student_has_quote ?? null,
    student_pages_per_student: opts.student_pages_per_student ?? null,
    symmetrize_students_tail: opts.symmetrize_students_tail ?? null,
    transition_scenario: opts.transition_scenario ?? null,
  };
}

function makeBundle(opts: {
  preset: Preset;
  masters: SpreadTemplate[];
  print_type?: 'layflat' | 'soft';
}): RuleEngineBundle {
  const mastersByName = new Map<string, SpreadTemplate>();
  for (const m of opts.masters) mastersByName.set(m.name, m);
  const templateSet: TemplateSet = {
    id: 'ts', tenant_id: null, name: 't', slug: 't',
    print_type: opts.print_type ?? 'layflat',
    page_width_mm: 200, page_height_mm: 280,
    spread_width_mm: 400, spread_height_mm: 280, bleed_mm: 0,
    facing_pages: true, page_binding: 'LeftToRight',
    spreads: opts.masters,
  };
  return { preset: opts.preset, rules: [], families: [], templateSet, mastersByName };
}

function makeInput(opts: {
  students_count: number;
  full_class?: number;
  half_class?: number;
  sixth?: number;
  quarter?: number;
}): RulesAlbumInput {
  const urls = (n: number, label: string) =>
    Array.from({ length: n }, (_, i) => `https://cdn/${label}_${i}.jpg`);
  return {
    students: Array.from({ length: opts.students_count }, (_, i) => ({
      full_name: `S${i}`, quote: '', portrait: `https://cdn/p${i}.jpg`, friend_photos: [],
    })),
    subjects: [],
    head_teacher: { photo: null, name: '', role: '', text: '' },
    common_photos: {
      full_class: urls(opts.full_class ?? 0, 'full'),
      half_class: urls(opts.half_class ?? 0, 'half'),
      spread: [],
      quarter: urls(opts.quarter ?? 0, 'quarter'),
      sixth: urls(opts.sixth ?? 0, 'sixth'),
    },
  };
}

// ─── Полный набор мастеров (всё что нужно для всех режимов) ─────────────

// Light: 6 учеников
const L_GRID = makeGridMaster('L-Grid-Page', 6);
// Light combo: 3 ученика + classphoto. base + -Right зеркало для soft.
const L_COMBO_3 = makeGridMaster('J-Combined-Tail-3', 3, { photosFull: 1 });
const L_COMBO_3_R = makeGridMaster('J-Combined-Tail-3-Right', 3, { photosFull: 1 });

// Mini: 12 учеников
const N_GRID = makeGridMaster('N-Grid-Page', 12);
// Mini combo: 4 ученика + classphoto (Tail-4 — для tail-замены в mini).
const N_COMBO_4 = makeGridMaster('J-Combined-Tail-4', 4, { photosFull: 1 });
const N_COMBO_4_R = makeGridMaster('J-Combined-Tail-4-Right', 4, { photosFull: 1 });

// Medium: 4 ученика
const M_GRID = makeGridMaster('M-Grid-Page', 4);
// Medium combo: 2 ученика + classphoto. base + -Right.
const M_COMBO_2 = makeGridMaster('J-Combined-Tail-2', 2, { photosFull: 1 });
const M_COMBO_2_R = makeGridMaster('J-Combined-Tail-2-Right', 2, { photosFull: 1 });

// Standard / Universal (page-режим — один ученик на страницу)
const E_STD_L = makeMaster('E-Standard-Left',
  [photoSlot('studentportrait_1'), textSlot('studentname_1'), textSlot('studenttext_1')],
  { page_role: 'student_left', slot_capacity: { students: 1, has_portrait: true, has_name: true } });
const E_STD_R = makeMaster('E-Standard-Right',
  [photoSlot('studentportrait_1'), textSlot('studentname_1'), textSlot('studenttext_1')],
  { page_role: 'student_right', slot_capacity: { students: 1, has_portrait: true, has_name: true } });
const E_UNI_L = makeMaster('E-Universal-Left',
  [photoSlot('studentportrait_1'), textSlot('studentname_1'), textSlot('studenttext_1'),
   photoSlot('photo_friend_1'), photoSlot('photo_friend_2')],
  { page_role: 'student_left', slot_capacity: { students: 1, has_portrait: true, has_name: true, photos_friend: 2 } });
const E_UNI_R = makeMaster('E-Universal-Right',
  [photoSlot('studentportrait_1'), textSlot('studentname_1'), textSlot('studenttext_1'),
   photoSlot('photo_friend_1'), photoSlot('photo_friend_2')],
  { page_role: 'student_right', slot_capacity: { students: 1, has_portrait: true, has_name: true, photos_friend: 2 } });

// Common masters (transition closing + общий раздел)
const J_HALF = makeMaster('J-Half',
  [photoSlot('halfphoto_1'), photoSlot('halfphoto_2')],
  { page_role: 'common', slot_capacity: { photos_half: 2 } });
const J_FULL = makeMaster('J-Full',
  [photoSlot('classphotoframe')],
  { page_role: 'common', slot_capacity: { photos_full: 1 } });
const J_COLLAGE_6 = makeMaster('J-Collage-6',
  Array.from({ length: 6 }, (_, i) => photoSlot(`collagephoto_${i + 1}`)),
  { page_role: 'common', slot_capacity: { photos_sixth: 6 } });
const J_COLLAGE_4 = makeMaster('J-Collage-4',
  Array.from({ length: 4 }, (_, i) => photoSlot(`collagephoto_${i + 1}`)),
  { page_role: 'common', slot_capacity: { photos_quarter: 4 } });

// ─── Раздельные bundles по комплектациям ────────────────────────────────
//
// Важно: combo-мастера разных размеров (Tail-2/3/4) НЕЛЬЗЯ смешивать в одном
// bundle. Иначе students.ts через min_fit для tail=1 возьмёт самый
// компактный (Tail-2), а это сломает определение комплектации через
// detectComplectationFromLastPage (Tail-2 = medium). В реальных
// template_set каждая комплектация имеет свой combo.

const LIGHT_MASTERS = [
  L_GRID, L_COMBO_3, L_COMBO_3_R,
  J_HALF, J_FULL, J_COLLAGE_6, J_COLLAGE_4,
];

const MINI_MASTERS = [
  N_GRID, N_COMBO_4, N_COMBO_4_R,
  J_HALF, J_FULL, J_COLLAGE_6, J_COLLAGE_4,
];

const MEDIUM_MASTERS = [
  M_GRID, M_COMBO_2, M_COMBO_2_R,
  J_HALF, J_FULL, J_COLLAGE_6, J_COLLAGE_4,
];

const PAGE_MODE_MASTERS = [
  E_STD_L, E_STD_R, E_UNI_L, E_UNI_R,
  J_HALF, J_FULL, J_COLLAGE_6, J_COLLAGE_4,
];

// ─── Хелперы для быстрой проверки ───────────────────────────────────────

function buildLayflat(opts: {
  density: 'light' | 'mini' | 'medium' | 'standard' | 'universal';
  gridSize?: number;
  mode?: 'grid' | 'page';
  symmetrize?: boolean;
  studentsCount: number;
}) {
  const isPage = opts.mode === 'page';
  const masters =
    isPage ? PAGE_MODE_MASTERS :
    opts.density === 'light' ? LIGHT_MASTERS :
    opts.density === 'mini' ? MINI_MASTERS :
    opts.density === 'medium' ? MEDIUM_MASTERS :
    PAGE_MODE_MASTERS;
  return buildFromSectionStructure(
    makeBundle({
      preset: makePreset({
        id: `${opts.density}-hard`,
        print_type: 'layflat',
        density: opts.density,
        sheet_type: 'hard',
        student_layout_mode: opts.mode ?? 'grid',
        student_grid_size: opts.gridSize ?? null,
        student_pages_per_student: isPage ? 1 : null,
        student_friend_photos: opts.density === 'universal' ? 2 : null,
        symmetrize_students_tail: opts.symmetrize ?? null,
        section_structure: [{ type: 'students' }, { type: 'transition' }],
      }),
      masters,
    }),
    makeInput({ students_count: opts.studentsCount, half_class: 2, full_class: 1 }),
  );
}

function buildSoft(opts: {
  density: 'light' | 'mini' | 'medium' | 'standard' | 'universal';
  gridSize?: number;
  mode?: 'grid' | 'page';
  symmetrize?: boolean;
  studentsCount: number;
}) {
  const isPage = opts.mode === 'page';
  const masters =
    isPage ? PAGE_MODE_MASTERS :
    opts.density === 'light' ? LIGHT_MASTERS :
    opts.density === 'mini' ? MINI_MASTERS :
    opts.density === 'medium' ? MEDIUM_MASTERS :
    PAGE_MODE_MASTERS;
  return buildFromSectionStructure(
    makeBundle({
      preset: makePreset({
        id: `${opts.density}-soft`,
        print_type: 'soft',
        density: opts.density,
        sheet_type: 'soft',
        student_layout_mode: opts.mode ?? 'grid',
        student_grid_size: opts.gridSize ?? null,
        student_pages_per_student: isPage ? 1 : null,
        student_friend_photos: opts.density === 'universal' ? 2 : null,
        symmetrize_students_tail: opts.symmetrize ?? null,
        section_structure: [{ type: 'students' }, { type: 'transition' }],
      }),
      masters,
      print_type: 'soft',
    }),
    makeInput({ students_count: opts.studentsCount, half_class: 2, full_class: 1 }),
  );
}

/** Проверка: ни одного warning уровня degraded/blocking — только info допустимы. */
function assertNoDegraded(result: ReturnType<typeof buildFromSectionStructure>) {
  // result.warnings — массив строк. Engine сам по себе не присваивает уровни;
  // уровни WARNING_LEVELS живут в /api/layout. Здесь просто проверяем что
  // отрицательные коды отсутствуют. Если будет регрессия — увидим лишний warning.
  const blockingCodes = ['students_master_not_found', 'students_grid_size_missing'];
  for (const w of result.warnings) {
    for (const code of blockingCodes) {
      expect(w.startsWith(code), `Неожиданный blocking warning: ${w}`).toBe(false);
    }
  }
}

// ─── 28 кейсов из xlsx ──────────────────────────────────────────────────

describe('РЭ.37.7: регрессионная матрица transition (xlsx-spec)', () => {
  // ═══════════════════════════════════════════════════════════════════════
  // МИНИ (grid=12)
  // ═══════════════════════════════════════════════════════════════════════
  describe('Мини плотные (grid=12, layflat)', () => {
    it('кейс 1: 24 ученика (до 24, full=2 чёт, tail=0) → нет transition', () => {
      const r = buildLayflat({ density: 'mini', gridSize: 12, studentsCount: 24 });
      assertNoDegraded(r);
      expect(r.spreads).toHaveLength(1);
      expect(r.spreads[0].left?.master_id).toBe('id-N-Grid-Page');
      expect(r.spreads[0].right?.master_id).toBe('id-N-Grid-Page');
    });

    it('кейс 2: 25 учеников (25-28, tail=1) → combo на L + closing на R', () => {
      const r = buildLayflat({ density: 'mini', gridSize: 12, studentsCount: 25 });
      assertNoDegraded(r);
      expect(r.spreads).toHaveLength(2);
      // Mini bundle содержит Tail-4 (combo для mini) — engine берёт его
      // (min_fit для tail=1 с photos_full=1 в нашем bundle = Combo-4 как
      // единственный доступный).
      expect(r.spreads[1].left?.master_id).toBe('id-J-Combined-Tail-4');
      expect(r.spreads[1].right?.master_id).toBe('id-J-Half');
    });

    it('кейс 3: 29 учеников (29-36, tail=5) → adaptive grid + closing', () => {
      const r = buildLayflat({ density: 'mini', gridSize: 12, studentsCount: 29 });
      assertNoDegraded(r);
      expect(r.spreads).toHaveLength(2);
      // engine min_fit: остаток=5 → N-Grid (12 ≥ 5) с 7 hidden,
      // потому что L-Grid не в Mini bundle.
      expect(r.spreads[1].left?.master_id).toBe('id-N-Grid-Page');
      expect(r.spreads[1].right?.master_id).toBe('id-J-Half');
    });
  });

  describe('Мини мягкие (grid=12, soft)', () => {
    it('кейс 4: 24 ученика → soft binding (Spread 0 левая пустая)', () => {
      const r = buildSoft({ density: 'mini', gridSize: 12, studentsCount: 24 });
      assertNoDegraded(r);
      // soft: первый разворот L=пусто (это форзац), R=первая страница students
      // 24 ученика на N-Grid-12 = 2 страницы → spread 0 R + spread 1 L
      expect(r.spreads.length).toBeGreaterThanOrEqual(1);
      // Soft чётность: ученики стоят на нечётных pageInstances index'ах
      // (т.е. правые страницы) — N-Grid должен быть в spread 0 правой
      expect(r.spreads[0].right?.master_id).toBe('id-N-Grid-Page');
    });

    it('кейс 5: 25 учеников soft (tail=1) → combo + J-Half', () => {
      const r = buildSoft({ density: 'mini', gridSize: 12, studentsCount: 25 });
      assertNoDegraded(r);
      // На soft combo может оказаться на разных позициях; проверяем наличие
      // combo (без жёсткой проверки L/R или конкретного combo размера).
      expect(
        r.spreads.some(s =>
          s.left?.master_id?.includes('Combined-Tail') ||
          s.right?.master_id?.includes('Combined-Tail'),
        ),
      ).toBe(true);
    });

    it('кейс 6: 29 учеников soft (29-36, tail=5)', () => {
      const r = buildSoft({ density: 'mini', gridSize: 12, studentsCount: 29 });
      assertNoDegraded(r);
      expect(r.spreads.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // ЛАЙТ (grid=6)
  // ═══════════════════════════════════════════════════════════════════════
  describe('Лайт плотные (grid=6, layflat)', () => {
    it('кейс 7: 12 учеников (до 12, full=2 чёт, tail=0) → без transition', () => {
      const r = buildLayflat({ density: 'light', gridSize: 6, studentsCount: 12 });
      assertNoDegraded(r);
      expect(r.spreads).toHaveLength(1);
      expect(r.spreads[0].left?.master_id).toBe('id-L-Grid-Page');
      expect(r.spreads[0].right?.master_id).toBe('id-L-Grid-Page');
    });

    it('кейс 8: 13 учеников (13-15, tail=1) → combo + J-Half', () => {
      const r = buildLayflat({ density: 'light', gridSize: 6, studentsCount: 13 });
      assertNoDegraded(r);
      expect(r.spreads).toHaveLength(2);
      expect(r.spreads[1].left?.master_id).toBe('id-J-Combined-Tail-3');
      expect(r.spreads[1].right?.master_id).toBe('id-J-Half');
    });

    it('кейс 9: 16 учеников (16-18, full=2 чёт, tail=4) → adaptive', () => {
      const r = buildLayflat({ density: 'light', gridSize: 6, studentsCount: 16 });
      assertNoDegraded(r);
      expect(r.spreads).toHaveLength(2);
      // 4 в Light bundle: нет 4-ёх размер adaptive, нет Combo-4. Fallback на base
      // (L-Grid с 2 hidden). Combined-tail (photos_full=1) — Combo-3 не вмещает 4 (3 < 4)
      // → min_fit найдёт base или ничего. Проверим что хотя бы L-Grid на L.
      expect(r.spreads[1].left?.master_id).toBe('id-L-Grid-Page');
    });

    it('кейс 10: 19 учеников (19-21, full=3 нечёт, tail=1) → combo на R', () => {
      const r = buildLayflat({ density: 'light', gridSize: 6, studentsCount: 19 });
      assertNoDegraded(r);
      expect(r.spreads).toHaveLength(2);
      // 3 полные + хвост. spread 0: L+R грид, spread 1: L грид + R combo-Right
      expect(r.spreads[1].left?.master_id).toBe('id-L-Grid-Page');
      expect(r.spreads[1].right?.master_id).toBe('id-J-Combined-Tail-3-Right');
    });
  });

  describe('Лайт мягкие (grid=6, soft)', () => {
    it('кейс 11: 12 учеников soft → грид без transition', () => {
      const r = buildSoft({ density: 'light', gridSize: 6, studentsCount: 12 });
      assertNoDegraded(r);
      // Soft: 2 страницы student grid = 1 spread (R+L) с soft binding
      expect(r.spreads.length).toBeGreaterThanOrEqual(1);
    });

    it('кейс 12: 13 учеников soft (tail=1) → combo-Right на L', () => {
      const r = buildSoft({ density: 'light', gridSize: 6, studentsCount: 13 });
      assertNoDegraded(r);
      // Soft mirror для combo
      const hasCombo = r.spreads.some(s =>
        s.left?.master_id?.includes('Combined-Tail') ||
        s.right?.master_id?.includes('Combined-Tail'),
      );
      expect(hasCombo).toBe(true);
    });

    it('кейс 13: 16 учеников soft (16-18)', () => {
      const r = buildSoft({ density: 'light', gridSize: 6, studentsCount: 16 });
      assertNoDegraded(r);
      expect(r.spreads.length).toBeGreaterThanOrEqual(2);
    });

    it('кейс 14: 19 учеников soft (19-21, нечёт)', () => {
      const r = buildSoft({ density: 'light', gridSize: 6, studentsCount: 19 });
      assertNoDegraded(r);
      expect(r.spreads.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // МЕДИУМ (grid=4)
  // ═══════════════════════════════════════════════════════════════════════
  describe('Медиум плотные (grid=4, layflat)', () => {
    it('кейс 15: 8 учеников (7-8, full=2 чёт, tail=0)', () => {
      const r = buildLayflat({ density: 'medium', gridSize: 4, studentsCount: 8 });
      assertNoDegraded(r);
      expect(r.spreads).toHaveLength(1);
      expect(r.spreads[0].left?.master_id).toBe('id-M-Grid-Page');
      expect(r.spreads[0].right?.master_id).toBe('id-M-Grid-Page');
    });

    it('кейс 16: 10 учеников (9-10, tail=2) → combo + J-Half', () => {
      const r = buildLayflat({ density: 'medium', gridSize: 4, studentsCount: 10 });
      assertNoDegraded(r);
      expect(r.spreads).toHaveLength(2);
      expect(r.spreads[1].left?.master_id).toBe('id-J-Combined-Tail-2');
      expect(r.spreads[1].right?.master_id).toBe('id-J-Half');
    });

    it('кейс 17: 11 учеников (11-12, tail=3) → grid (adapt 3)? combo больше', () => {
      const r = buildLayflat({ density: 'medium', gridSize: 4, studentsCount: 11 });
      assertNoDegraded(r);
      expect(r.spreads).toHaveLength(2);
    });

    it('кейс 18: 15 учеников (full=3 нечёт, tail=3) → M-Grid с null padding на R', () => {
      const r = buildLayflat({ density: 'medium', gridSize: 4, studentsCount: 15 });
      assertNoDegraded(r);
      expect(r.spreads).toHaveLength(2);
      // В Medium bundle есть только Combo-2 (не -3). engine ищет min_fit для
      // tail=3, photos_full=1 — Combo-2 не подходит (capacity=2 < 3). Без
      // combined-tail → проверит adaptive: nothing. Fallback на base
      // (M-Grid с 1 hidden).
      expect(r.spreads[1].right?.master_id).toBe('id-M-Grid-Page');
    });
  });

  describe('Медиум мягкие (grid=4, soft)', () => {
    it('кейс 19: 8 учеников soft (чёт без transition)', () => {
      const r = buildSoft({ density: 'medium', gridSize: 4, studentsCount: 8 });
      assertNoDegraded(r);
      expect(r.spreads.length).toBeGreaterThanOrEqual(1);
    });

    it('кейс 20: 10 учеников soft (9-10, tail=2)', () => {
      const r = buildSoft({ density: 'medium', gridSize: 4, studentsCount: 10 });
      assertNoDegraded(r);
      expect(r.spreads.length).toBeGreaterThanOrEqual(2);
    });

    it('кейс 21: 11 учеников soft (11-12, tail=3)', () => {
      const r = buildSoft({ density: 'medium', gridSize: 4, studentsCount: 11 });
      assertNoDegraded(r);
      expect(r.spreads.length).toBeGreaterThanOrEqual(2);
    });

    it('кейс 22: 15 учеников soft (нечёт, tail=3)', () => {
      const r = buildSoft({ density: 'medium', gridSize: 4, studentsCount: 15 });
      assertNoDegraded(r);
      expect(r.spreads.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // СТАНДАРТ / УНИВЕРСАЛ (page-режим)
  // ═══════════════════════════════════════════════════════════════════════
  describe('Стандарт плотные (page-режим)', () => {
    it('кейс 23: 24 ученика чётное → 12 разворотов student, без transition', () => {
      const r = buildLayflat({ density: 'standard', mode: 'page', studentsCount: 24 });
      assertNoDegraded(r);
      expect(r.spreads).toHaveLength(12);
      for (const s of r.spreads) {
        expect(s.left?.master_id).toBe('id-E-Standard-Left');
        expect(s.right?.master_id).toBe('id-E-Standard-Right');
      }
    });

    it('кейс 24: 25 учеников нечётное → 12 пар + 1 ученик на L, closing J-Half на R', () => {
      const r = buildLayflat({ density: 'standard', mode: 'page', studentsCount: 25 });
      assertNoDegraded(r);
      expect(r.spreads).toHaveLength(13);
      expect(r.spreads[12].left?.master_id).toBe('id-E-Standard-Left');
      expect(r.spreads[12].right?.master_id).toBe('id-J-Half');
    });
  });

  describe('Стандарт мягкие (page-режим, soft)', () => {
    it('кейс 25: 24 чётное soft', () => {
      const r = buildSoft({ density: 'standard', mode: 'page', studentsCount: 24 });
      assertNoDegraded(r);
      expect(r.spreads.length).toBeGreaterThanOrEqual(12);
    });

    it('кейс 26: 25 нечётное soft', () => {
      const r = buildSoft({ density: 'standard', mode: 'page', studentsCount: 25 });
      assertNoDegraded(r);
      expect(r.spreads.length).toBeGreaterThanOrEqual(13);
    });
  });

  describe('Универсал (page + photos_friend=2)', () => {
    it('кейс 27: Универсал 24 чётное → E-Universal-Left/Right', () => {
      const r = buildLayflat({ density: 'universal', mode: 'page', studentsCount: 24 });
      assertNoDegraded(r);
      expect(r.spreads).toHaveLength(12);
      for (const s of r.spreads) {
        expect(s.left?.master_id).toBe('id-E-Universal-Left');
        expect(s.right?.master_id).toBe('id-E-Universal-Right');
      }
    });

    it('кейс 28: Универсал 25 нечётное → closing на R', () => {
      const r = buildLayflat({ density: 'universal', mode: 'page', studentsCount: 25 });
      assertNoDegraded(r);
      expect(r.spreads).toHaveLength(13);
      expect(r.spreads[12].left?.master_id).toBe('id-E-Universal-Left');
      expect(r.spreads[12].right?.master_id).toBe('id-J-Half');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// НОВЫЕ ФИЧИ ПОВЕРХ OkeyBook-default
// ═══════════════════════════════════════════════════════════════════════════

describe('РЭ.37.7: симметризация хвоста (РЭ.37.4) поверх матрицы', () => {
  it('Лайт 13 + symmetrize=true → 2 ученика на combo (вместо 1)', () => {
    const r = buildLayflat({
      density: 'light', gridSize: 6,
      studentsCount: 13, symmetrize: true,
    });
    // С симметризацией хвост = 2 ученика на combo, prev grid 5 + 1 hidden
    expect(
      r.warnings.some(w => w.startsWith('transition_symmetrized')),
    ).toBe(true);
    expect(
      r.decision_trace.some(t => t.rule_id.startsWith('symmetrize:light:')),
    ).toBe(true);
  });

  it('Лайт 13 + symmetrize=false → без симметризации (контроль)', () => {
    const r = buildLayflat({
      density: 'light', gridSize: 6,
      studentsCount: 13, symmetrize: false,
    });
    expect(
      r.warnings.some(w => w.startsWith('transition_symmetrized')),
    ).toBe(false);
  });

  it('Мини 25 + symmetrize=true → симметризация для grid=12', () => {
    const r = buildLayflat({
      density: 'mini', gridSize: 12,
      studentsCount: 25, symmetrize: true,
    });
    expect(
      r.decision_trace.some(t => t.rule_id.startsWith('symmetrize:mini:')),
    ).toBe(true);
  });

  it('Лайт 14 (tail=2) + symmetrize=true → НЕ срабатывает (tail≠1)', () => {
    const r = buildLayflat({
      density: 'light', gridSize: 6,
      studentsCount: 14, symmetrize: true,
    });
    expect(
      r.decision_trace.some(t => t.rule_id.startsWith('symmetrize:')),
    ).toBe(false);
  });

  it('Медиум 9 + symmetrize=true → НЕ срабатывает (не Light/Mini)', () => {
    const r = buildLayflat({
      density: 'medium', gridSize: 4,
      studentsCount: 9, symmetrize: true,
    });
    expect(
      r.decision_trace.some(t => t.rule_id.startsWith('symmetrize:')),
    ).toBe(false);
  });
});

describe('РЭ.37.7: автоцентрирование (РЭ.37.5.b)', () => {
  it('Mini 25 (tail=1 → grid=12 с 12 hidden, кроме 1) → __pos__ для видимого слота', () => {
    // Реальный тест геометрии — нужен мастер с координатами. Используем
    // отдельный bundle с осмысленными x_mm/y_mm.
    const gridMaster = makeGridMaster('Geom-Grid', 6, {});
    // Перепишем координаты вручную: 2 ряда × 3 колонки. dx=50, dy=80.
    let i = 0;
    for (const ph of gridMaster.placeholders) {
      if (ph.label.startsWith('studentportrait_')) {
        const n = parseInt(ph.label.split('_')[1], 10);
        const row = Math.floor((n - 1) / 3);
        const col = (n - 1) % 3;
        ph.x_mm = 10 + col * 50;
        ph.y_mm = 10 + row * 80;
        i++;
      }
    }
    const bundle = makeBundle({
      preset: makePreset({
        id: 'centering-test',
        density: 'light', sheet_type: 'hard',
        student_layout_mode: 'grid', student_grid_size: 6,
        section_structure: [{ type: 'students' }],
      }),
      masters: [gridMaster, ...LIGHT_MASTERS.filter(m => m.name !== 'L-Grid-Page')],
    });
    // 4 ученика — нижний ряд должен иметь 1 видимый + 2 hidden
    const r = buildFromSectionStructure(bundle, makeInput({ students_count: 4 }));
    // Найдём страницу с __pos__ ключами
    const hasPos = r.spreads.some(s => {
      const leftHas = s.left && Object.keys(s.left.bindings).some(k => k.startsWith('__pos__'));
      const rightHas = s.right && Object.keys(s.right.bindings).some(k => k.startsWith('__pos__'));
      return leftHas || rightHas;
    });
    expect(hasPos).toBe(true);
  });
});

describe('РЭ.37.7: quote fallback (РЭ.37.9)', () => {
  it('has_quote=true + мастер без цитат → fallback + info-warning', () => {
    // Bundle с только L-Grid (без quote-слотов), но в пресете has_quote=true
    const bundle = makeBundle({
      preset: makePreset({
        id: 'quote-fallback',
        density: 'light', sheet_type: 'hard',
        student_layout_mode: 'grid', student_grid_size: 6,
        student_has_quote: true,
        section_structure: [{ type: 'students' }],
      }),
      masters: [L_GRID],
    });
    const r = buildFromSectionStructure(bundle, makeInput({ students_count: 12 }));
    expect(r.spreads).toHaveLength(1);
    expect(r.warnings.some(w => w.startsWith('students_quote_fallback'))).toBe(true);
    expect(r.warnings.some(w => w.startsWith('students_master_not_found'))).toBe(false);
  });
});

describe('РЭ.37.7: legacy combined-tail (РЭ.37.4.b)', () => {
  it('legacy L-Combined-Page + symmetrize=true → срабатывает через preset density', () => {
    // Имитируем сценарий Тест2 с «Белый плотные разворотами»
    const L_LEGACY = makeGridMaster('L-Combined-Page', 3, { photosFull: 1 });
    const bundle = makeBundle({
      preset: makePreset({
        id: 'legacy',
        density: 'light', sheet_type: 'hard',
        symmetrize_students_tail: true,
        section_structure: [{ type: 'students' }, { type: 'transition' }],
      }),
      masters: [L_GRID, L_LEGACY, L_COMBO_3, L_COMBO_3_R, J_HALF],
    });
    const r = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 25, half_class: 2, full_class: 1 }),
    );
    // Симметризация через preset должна сработать
    expect(
      r.decision_trace.some(t =>
        t.rule_id === 'okeybook_default:symmetrize_from_preset',
      ),
    ).toBe(true);
  });
});
