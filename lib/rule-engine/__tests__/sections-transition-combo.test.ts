/**
 * РЭ.37.2.b — тесты для combo-логики в fillTransitionSection.
 *
 * Покрытие:
 *  • detect-complectation: распознавание мастеров по имени
 *  • Lite / Medium / Mini combo-замена хвостовой страницы
 *  • Случай tail > M: combo не применяется, students оставляет N-Grid
 *    с padding, transition добавляет J-цепочку
 *  • Case 7 (нечётное число полных + tail ≤ M): combo на правой,
 *    разворот закрыт, J НЕ добавляется
 *  • Mini с classphoto: предыдущая combined_tail страница students
 *    содержала classphotoframe — full_class должен быть возвращён
 *    в available
 *
 * Существующие тесты для Standard (sections-transition.test.ts) НЕ
 * перетираются — там combo не применяется, поведение прежнее.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyMasterAsComplectation,
  detectComplectationFromLastPage,
} from '../detect-complectation';
import type { SpreadTemplate } from '@/lib/album-builder/types';

// ─── detect-complectation ──────────────────────────────────────────────

describe('classifyMasterAsComplectation', () => {
  it('распознаёт N-Grid-12 → mini', () => {
    expect(classifyMasterAsComplectation('N-Grid-12')).toBe('mini');
    expect(classifyMasterAsComplectation('N-Grid-12-Left')).toBe('mini');
    expect(classifyMasterAsComplectation('N-Grid-12-Page')).toBe('mini');
  });

  it('распознаёт N-Grid-6 / L-Grid / L-2 → light', () => {
    expect(classifyMasterAsComplectation('N-Grid-6')).toBe('light');
    expect(classifyMasterAsComplectation('L-Grid')).toBe('light');
    expect(classifyMasterAsComplectation('L-Grid-Page')).toBe('light');
    expect(classifyMasterAsComplectation('L-2')).toBe('light');
    expect(classifyMasterAsComplectation('L-3')).toBe('light');
    expect(classifyMasterAsComplectation('L-4')).toBe('light');
  });

  it('распознаёт N-Grid-4 / M-Grid → medium', () => {
    expect(classifyMasterAsComplectation('N-Grid-4')).toBe('medium');
    expect(classifyMasterAsComplectation('M-Grid')).toBe('medium');
    expect(classifyMasterAsComplectation('M-Grid-Page')).toBe('medium');
  });

  it('распознаёт E-Standard → standard', () => {
    expect(classifyMasterAsComplectation('E-Standard-Left')).toBe('standard');
    expect(classifyMasterAsComplectation('E-Standard-Right')).toBe('standard');
  });

  it('распознаёт E-Universal → universal', () => {
    expect(classifyMasterAsComplectation('E-Universal-Left')).toBe('universal');
    expect(classifyMasterAsComplectation('E-Universal-Right')).toBe('universal');
  });

  it('распознаёт E-Max → maximum', () => {
    expect(classifyMasterAsComplectation('E-Max-Left')).toBe('maximum');
    expect(classifyMasterAsComplectation('M-Student-Spread-Left')).toBe('maximum');
  });

  it('распознаёт Combined-Tail-N как соответствующую комплектацию', () => {
    // Combined-Tail-4 → Mini комплектация (combo для мини)
    expect(classifyMasterAsComplectation('Combined-Tail-4')).toBe('mini');
    expect(classifyMasterAsComplectation('Combined-Tail-3')).toBe('light');
    expect(classifyMasterAsComplectation('Combined-Tail-2')).toBe('medium');
  });

  it('null для неизвестных и J-мастеров', () => {
    expect(classifyMasterAsComplectation('J-Half')).toBeNull();
    expect(classifyMasterAsComplectation('J-Full')).toBeNull();
    expect(classifyMasterAsComplectation('J-Collage-6')).toBeNull();
    expect(classifyMasterAsComplectation('S-Intro-Left')).toBeNull();
    expect(classifyMasterAsComplectation('UnknownMaster')).toBeNull();
  });
});

describe('detectComplectationFromLastPage', () => {
  function makeMaster(name: string, id: string): SpreadTemplate {
    return {
      id,
      name,
      type: 'common',
      is_spread: false,
      width_mm: 200,
      height_mm: 280,
      placeholders: [],
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

  it('находит комплектацию по master_id последней страницы', () => {
    const m = makeMaster('N-Grid-6-Page', 'id-grid6');
    const map = new Map<string, SpreadTemplate>([[m.name, m]]);
    expect(detectComplectationFromLastPage('id-grid6', map)).toBe('light');
  });

  it('null если master_id не найден', () => {
    const map = new Map<string, SpreadTemplate>();
    expect(detectComplectationFromLastPage('id-missing', map)).toBeNull();
  });

  it('null если lastPageMasterId undefined', () => {
    const map = new Map<string, SpreadTemplate>();
    expect(detectComplectationFromLastPage(undefined, map)).toBeNull();
  });
});

// ─── Combo-замена хвостовой страницы (integration через build-from-section-structure) ──

import { buildFromSectionStructure } from '../build-from-section-structure';
import type { Preset, RulesAlbumInput } from '../types';
import type { RuleEngineBundle } from '../loaders';
import type { TemplateSet, Placeholder } from '@/lib/album-builder/types';

function photoSlot(label: string): Placeholder {
  return {
    label,
    x_mm: 0,
    y_mm: 0,
    width_mm: 40,
    height_mm: 55,
    type: 'photo',
    fit: 'fill_proportional',
    required: false,
  };
}

function textSlot(label: string): Placeholder {
  return {
    label,
    x_mm: 0,
    y_mm: 0,
    width_mm: 40,
    height_mm: 10,
    type: 'text',
    font_family: 'Arial',
    font_size_pt: 12,
    font_weight: 'regular',
    color: '#000',
    align: 'left',
    vertical_align: 'top',
    auto_fit: false,
  };
}

function makeMaster(
  name: string,
  placeholders: Placeholder[],
  slot_capacity: SpreadTemplate['slot_capacity'] = null,
): SpreadTemplate {
  return {
    id: `id-${name}`,
    name,
    type: 'common',
    is_spread: false,
    width_mm: 200,
    height_mm: 280,
    placeholders,
    rules: null,
    sort_order: 0,
    applies_to_configs: [],
    default_for_configs: [],
    page_role: null,
    slot_capacity,
    is_fallback: false,
    mirror_for_soft: false,
    audit_notes: null,
  };
}

// Light N-Grid-Page = 6 портретов, 6 имён.
const L_GRID_PAGE = makeMaster(
  'L-Grid-Page',
  [
    ...Array.from({ length: 6 }, (_, i) => photoSlot(`studentportrait_${i + 1}`)),
    ...Array.from({ length: 6 }, (_, i) => textSlot(`studentname_${i + 1}`)),
  ],
  { students: 6 },
);

// Combo-3 для light: 3 portrait + classphotoframe.
const COMBO_3 = makeMaster('J-Combined-Tail-3', [
  ...Array.from({ length: 3 }, (_, i) => photoSlot(`studentportrait_${i + 1}`)),
  photoSlot('classphotoframe'),
]);

const COMBO_3_RIGHT = makeMaster('J-Combined-Tail-3-Right', [
  ...Array.from({ length: 3 }, (_, i) => photoSlot(`studentportrait_${i + 1}`)),
  photoSlot('classphotoframe'),
]);

const J_HALF = makeMaster('J-Half', [photoSlot('halfphoto_1'), photoSlot('halfphoto_2')]);
const J_FULL = makeMaster('J-Full', [photoSlot('classphotoframe')]);
const J_COLLAGE_6 = makeMaster(
  'J-Collage-6',
  Array.from({ length: 6 }, (_, i) => photoSlot(`collagephoto_${i + 1}`)),
);

// РЭ.37.3.b: S-Intro для soft-тестов. Первая правая страница soft-альбома
// с общим фото класса.
const S_INTRO = makeMaster('S-Intro', [photoSlot('classphotoframe')]);

const ALL_LIGHT_MASTERS = [L_GRID_PAGE, COMBO_3, COMBO_3_RIGHT, J_HALF, J_FULL, J_COLLAGE_6, S_INTRO];

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
  };
}

function makeLightBundle(preset: Preset): RuleEngineBundle {
  const mastersByName = new Map<string, SpreadTemplate>();
  for (const m of ALL_LIGHT_MASTERS) mastersByName.set(m.name, m);
  const templateSet: TemplateSet = {
    id: 'ts',
    tenant_id: null,
    name: 't',
    slug: 't',
    print_type: 'layflat',
    page_width_mm: 200,
    page_height_mm: 280,
    spread_width_mm: 400,
    spread_height_mm: 280,
    bleed_mm: 0,
    facing_pages: true,
    page_binding: 'LeftToRight',
    spreads: ALL_LIGHT_MASTERS,
  };
  return { preset, rules: [], families: [], templateSet, mastersByName };
}

function makeInput(opts: {
  students_count: number;
  full_class?: number;
  half_class?: number;
  sixth?: number;
}): RulesAlbumInput {
  const urls = (n: number, label: string) =>
    Array.from({ length: n }, (_, i) => `https://cdn/${label}_${i}.jpg`);
  return {
    students: Array.from({ length: opts.students_count }, (_, i) => ({
      full_name: `S${i}`,
      quote: '',
      portrait: `https://cdn/p${i}.jpg`,
      friend_photos: [],
    })),
    subjects: [],
    head_teacher: { photo: null, name: '', role: '', text: '' },
    common_photos: {
      full_class: urls(opts.full_class ?? 0, 'full'),
      half_class: urls(opts.half_class ?? 0, 'half'),
      spread: [],
      quarter: [],
      sixth: urls(opts.sixth ?? 0, 'sixth'),
    },
  };
}

describe('transition combo-replacement (Light, M=3)', () => {
  it('Light 13 учеников (full=2 чёт, tail=1) → POP последней + PUSH Combo-3 на L + J-Half на R', () => {
    const bundle = makeLightBundle(
      makePreset({
        id: 'light',
        density: 'light',
        sheet_type: 'hard',


        section_structure: [{ type: 'students' }, { type: 'transition' }],
      }),
    );
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 13, half_class: 2, full_class: 1 }),
    );
    // Должно быть: 2 разворота (L-Grid+L-Grid, Combo-3+J-Half).
    expect(result.spreads).toHaveLength(2);
    // 3-я страница (index=2, page 3, L) = Combo-3 (base, не -Right)
    expect(result.spreads[1].left?.master_id).toBe('id-J-Combined-Tail-3');
    // На combo лежит 1 ученик + 2 скрытых
    expect(result.spreads[1].left?.bindings.studentportrait_1).toBe('https://cdn/p12.jpg');
    expect(result.spreads[1].left?.bindings.__hidden__studentportrait_2).toBe('1');
    expect(result.spreads[1].left?.bindings.__hidden__studentportrait_3).toBe('1');
    expect(result.spreads[1].left?.bindings.classphotoframe).toBe('https://cdn/full_0.jpg');
    // 4-я страница (R) = J-Half
    expect(result.spreads[1].right?.master_id).toBe('id-J-Half');
  });

  it('Light 19 учеников (full=3 нечёт, tail=1) → POP + PUSH Combo-3 на R, разворот закрыт без J', () => {
    const bundle = makeLightBundle(
      makePreset({
        id: 'light',
        density: 'light',
        sheet_type: 'hard',


        section_structure: [{ type: 'students' }, { type: 'transition' }],
      }),
    );
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 19, half_class: 2, full_class: 1 }),
    );
    // Должно быть: 2 разворота (L-Grid+L-Grid, L-Grid+Combo-3-Right).
    expect(result.spreads).toHaveLength(2);
    // 4-я страница (R) = Combo-3-Right (зеркальный вариант)
    expect(result.spreads[1].right?.master_id).toBe('id-J-Combined-Tail-3-Right');
    expect(result.spreads[1].right?.bindings.studentportrait_1).toBe('https://cdn/p18.jpg');
    expect(result.spreads[1].right?.bindings.__hidden__studentportrait_2).toBe('1');
    expect(result.spreads[1].right?.bindings.__hidden__studentportrait_3).toBe('1');
    expect(result.spreads[1].right?.bindings.classphotoframe).toBe('https://cdn/full_0.jpg');
    // Левая 4-го разворота = последняя полная сетка
    expect(result.spreads[1].left?.master_id).toBe('id-L-Grid-Page');
  });

  it('Light 16 учеников (full=2 чёт, tail=4 > M=3) → grid_padded на L + J-Half на R', () => {
    const bundle = makeLightBundle(
      makePreset({
        id: 'light',
        density: 'light',
        sheet_type: 'hard',


        section_structure: [{ type: 'students' }, { type: 'transition' }],
      }),
    );
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 16, half_class: 2, full_class: 1 }),
    );
    expect(result.spreads).toHaveLength(2);
    // 3-я страница = L-Grid-Page (НЕ combo, потому что tail=4>M=3)
    expect(result.spreads[1].left?.master_id).toBe('id-L-Grid-Page');
    // 4-я страница = J-Half
    expect(result.spreads[1].right?.master_id).toBe('id-J-Half');
  });

  it('Light 18 учеников (full=3 нечёт, tail=0) → последняя L-Grid на L, J-Half на R', () => {
    const bundle = makeLightBundle(
      makePreset({
        id: 'light',
        density: 'light',
        sheet_type: 'hard',


        section_structure: [{ type: 'students' }, { type: 'transition' }],
      }),
    );
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 18, half_class: 2, full_class: 1 }),
    );
    expect(result.spreads).toHaveLength(2);
    expect(result.spreads[1].left?.master_id).toBe('id-L-Grid-Page');
    expect(result.spreads[1].right?.master_id).toBe('id-J-Half');
  });

  it('Light 12 учеников (full=2, tail=0) → transition OFF (разворот закрыт)', () => {
    const bundle = makeLightBundle(
      makePreset({
        id: 'light',
        density: 'light',
        sheet_type: 'hard',


        section_structure: [{ type: 'students' }, { type: 'transition' }],
      }),
    );
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 12, half_class: 2, full_class: 1 }),
    );
    // Только 1 разворот (2 страницы N-Grid-6). Transition не добавил.
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-L-Grid-Page');
    expect(result.spreads[0].right?.master_id).toBe('id-L-Grid-Page');
  });

  it('Light 13 без combo-3 мастера → warning + хвостовая страница остаётся как есть + J на R', () => {
    // Bundle БЕЗ Combo-3 / Combo-3-Right.
    const limitedMasters = [L_GRID_PAGE, J_HALF, J_FULL, J_COLLAGE_6];
    const mastersByName = new Map<string, SpreadTemplate>();
    for (const m of limitedMasters) mastersByName.set(m.name, m);
    const bundle: RuleEngineBundle = {
      preset: makePreset({
        id: 'light',
        density: 'light',
        sheet_type: 'hard',


        section_structure: [{ type: 'students' }, { type: 'transition' }],
      }),
      rules: [],
      families: [],
      templateSet: {
        id: 'ts',
        tenant_id: null,
        name: 't',
        slug: 't',
        print_type: 'layflat',
        page_width_mm: 200,
        page_height_mm: 280,
        spread_width_mm: 400,
        spread_height_mm: 280,
        bleed_mm: 0,
        facing_pages: true,
        page_binding: 'LeftToRight',
        spreads: limitedMasters,
      },
      mastersByName,
    };
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 13, half_class: 2, full_class: 1 }),
    );
    // Combo не найден → warning
    expect(
      result.warnings.some((w) =>
        w.startsWith('transition_combo_master_missing'),
      ),
    ).toBe(true);
    // Хвостовая страница students (L-Grid с 1 учеником + 5 скрытых)
    // остаётся, J-Half добавляется на R.
    expect(result.spreads).toHaveLength(2);
    expect(result.spreads[1].left?.master_id).toBe('id-L-Grid-Page');
    expect(result.spreads[1].right?.master_id).toBe('id-J-Half');
  });
});

describe('transition okeybook_default vs legacy master_name', () => {
  it("legacy master_name='J-Half' для Light 13 → J-Half на R (без combo)", () => {
    // Legacy режим ИГНОРИРУЕТ classifyTransitionLayout и просто кладёт
    // указанный мастер на правую. Хвостовая страница students остаётся
    // (как до РЭ.37).
    const bundle = makeLightBundle(
      makePreset({
        id: 'light',
        density: 'light',
        sheet_type: 'hard',


        section_structure: [
          { type: 'students' },
          { type: 'transition', master_name: 'J-Half' },
        ],
      }),
    );
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 13, half_class: 2, full_class: 1 }),
    );
    // Хвостовая L-Grid не заменена на combo.
    expect(result.spreads[1].left?.master_id).toBe('id-L-Grid-Page');
    expect(result.spreads[1].right?.master_id).toBe('id-J-Half');
  });

  it('explicit mode=okeybook_default для Light 13 → combo (как дефолт)', () => {
    const bundle = makeLightBundle(
      makePreset({
        id: 'light',
        density: 'light',
        sheet_type: 'hard',


        section_structure: [
          { type: 'students' },
          { type: 'transition', mode: 'okeybook_default' },
        ],
      }),
    );
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 13, half_class: 2, full_class: 1 }),
    );
    expect(result.spreads[1].left?.master_id).toBe('id-J-Combined-Tail-3');
  });

  it('mode=custom без custom-поля → warning + fallback на okeybook_default', () => {
    const bundle = makeLightBundle(
      makePreset({
        id: 'light',
        density: 'light',
        sheet_type: 'hard',
        section_structure: [
          { type: 'students' },
          // Без поля custom — этот случай в проде не должен случаться
          // (валидатор API запретит), но движок должен grаmotно обработать.
          { type: 'transition', mode: 'custom' } as never,
        ],
      }),
    );
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 13, half_class: 2, full_class: 1 }),
    );
    expect(
      result.warnings.some((w) =>
        w.startsWith('transition_custom_missing'),
      ),
    ).toBe(true);
    // Fallback на okeybook_default → стандартный combo + J.
    expect(result.spreads[1].left?.master_id).toBe('id-J-Combined-Tail-3');
    expect(result.spreads[1].right?.master_id).toBe('id-J-Half');
  });
});

// ─── РЭ.37.2.c: custom-режим (партнёр явно задал мастера) ──────────────

describe('transition custom mode (Light, M=3)', () => {
  it('Light 13 (tail_left case) + custom: combo-3 на L + J-Full на R', () => {
    // Хвост 1, full_pages=2 (чёт) → tail_left сценарий.
    // Партнёр указал J-Combined-Tail-3 для combo + J-Full для закрытия.
    const bundle = makeLightBundle(
      makePreset({
        id: 'light',
        density: 'light',
        sheet_type: 'hard',
        section_structure: [
          { type: 'students' },
          {
            type: 'transition',
            mode: 'custom',
            custom: {
              tail_left: {
                left: { master_name: 'J-Combined-Tail-3' },
                right: { master_name: 'J-Full' },
              },
              tail_right: { right: { master_name: 'J-Combined-Tail-3' } },
            },
          },
        ],
      }),
    );
    const result = buildFromSectionStructure(
      bundle,
      // full_class: 2 — combo съест 1 (classphoto), J-Full возьмёт 1.
      makeInput({ students_count: 13, half_class: 2, full_class: 2 }),
    );
    expect(result.spreads).toHaveLength(2);
    // L = указанный combo (с 1 портретом + 2 hidden + classphoto).
    expect(result.spreads[1].left?.master_id).toBe('id-J-Combined-Tail-3');
    expect(result.spreads[1].left?.bindings.studentportrait_1).toBe('https://cdn/p12.jpg');
    expect(result.spreads[1].left?.bindings.__hidden__studentportrait_2).toBe('1');
    // R = J-Full (не J-Half как было бы в okeybook_default).
    expect(result.spreads[1].right?.master_id).toBe('id-J-Full');
  });

  it('Light 19 (tail_right case) + custom: combo-3-Right на R, разворот закрыт', () => {
    // Хвост 1, full_pages=3 (нечёт) → tail_right сценарий.
    // Партнёр указал J-Combined-Tail-3 (базу) — движок берёт -Right.
    const bundle = makeLightBundle(
      makePreset({
        id: 'light',
        density: 'light',
        sheet_type: 'hard',
        section_structure: [
          { type: 'students' },
          {
            type: 'transition',
            mode: 'custom',
            custom: {
              tail_left: {
                left: { master_name: 'J-Combined-Tail-3' },
                right: { master_name: 'J-Full' },
              },
              tail_right: { right: { master_name: 'J-Combined-Tail-3' } },
            },
          },
        ],
      }),
    );
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 19, half_class: 2, full_class: 1 }),
    );
    expect(result.spreads).toHaveLength(2);
    // L = последняя полная сетка (от students, не трогаем).
    expect(result.spreads[1].left?.master_id).toBe('id-L-Grid-Page');
    // R = combo-3-Right (зеркало!).
    expect(result.spreads[1].right?.master_id).toBe('id-J-Combined-Tail-3-Right');
    expect(result.spreads[1].right?.bindings.studentportrait_1).toBe('https://cdn/p18.jpg');
  });

  it('Light 18 (tail=0, full=3 нечёт) + custom: fallback на okeybook_default (J на R)', () => {
    // Нет хвоста — custom не применяется. Engine закрывает разворот
    // через J-цепочку okeybook_default.
    const bundle = makeLightBundle(
      makePreset({
        id: 'light',
        density: 'light',
        sheet_type: 'hard',
        section_structure: [
          { type: 'students' },
          {
            type: 'transition',
            mode: 'custom',
            custom: {
              tail_left: {
                left: { master_name: 'J-Combined-Tail-3' },
                right: { master_name: 'J-Full' },
              },
              tail_right: { right: { master_name: 'J-Combined-Tail-3' } },
            },
          },
        ],
      }),
    );
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 18, half_class: 2, full_class: 1 }),
    );
    expect(result.spreads).toHaveLength(2);
    expect(result.spreads[1].left?.master_id).toBe('id-L-Grid-Page');
    // По дефолту half первый в J-цепочке → J-Half (не J-Full из custom).
    expect(result.spreads[1].right?.master_id).toBe('id-J-Half');
  });

  it('Light 16 (tail=4 > M=3) + custom: fallback на okeybook_default', () => {
    // tail > M → custom не применяется (combo не подходит).
    const bundle = makeLightBundle(
      makePreset({
        id: 'light',
        density: 'light',
        sheet_type: 'hard',
        section_structure: [
          { type: 'students' },
          {
            type: 'transition',
            mode: 'custom',
            custom: {
              tail_left: {
                left: { master_name: 'J-Combined-Tail-3' },
                right: { master_name: 'J-Full' },
              },
              tail_right: { right: { master_name: 'J-Combined-Tail-3' } },
            },
          },
        ],
      }),
    );
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 16, half_class: 2, full_class: 1 }),
    );
    expect(result.spreads).toHaveLength(2);
    // L = students grid_padded (4 портрета + 2 пустых).
    expect(result.spreads[1].left?.master_id).toBe('id-L-Grid-Page');
    // R = J-Half (дефолтный приоритет).
    expect(result.spreads[1].right?.master_id).toBe('id-J-Half');
  });

  it('Light 13 + custom с несуществующим мастером (tail_left.left) → warning, хвост остаётся', () => {
    const bundle = makeLightBundle(
      makePreset({
        id: 'light',
        density: 'light',
        sheet_type: 'hard',
        section_structure: [
          { type: 'students' },
          {
            type: 'transition',
            mode: 'custom',
            custom: {
              tail_left: {
                left: { master_name: 'NonExistentMaster' },
                right: { master_name: 'J-Full' },
              },
              tail_right: { right: { master_name: 'J-Combined-Tail-3' } },
            },
          },
        ],
      }),
    );
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 13, half_class: 2, full_class: 1 }),
    );
    expect(
      result.warnings.some((w) =>
        w.startsWith('transition_custom_master_missing (tail_left.left)'),
      ),
    ).toBe(true);
    // POP отменён — хвостовая страница students осталась.
    expect(result.spreads[1].left?.master_id).toBe('id-L-Grid-Page');
  });

  it('Light 13 + custom с несуществующим мастером (tail_left.right) → combo есть, J нет, warning', () => {
    const bundle = makeLightBundle(
      makePreset({
        id: 'light',
        density: 'light',
        sheet_type: 'hard',
        section_structure: [
          { type: 'students' },
          {
            type: 'transition',
            mode: 'custom',
            custom: {
              tail_left: {
                left: { master_name: 'J-Combined-Tail-3' },
                right: { master_name: 'NonExistentRight' },
              },
              tail_right: { right: { master_name: 'J-Combined-Tail-3' } },
            },
          },
        ],
      }),
    );
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 13, half_class: 2, full_class: 1 }),
    );
    expect(
      result.warnings.some((w) =>
        w.startsWith('transition_custom_master_missing (tail_left.right)'),
      ),
    ).toBe(true);
    // Combo поставлен, но R не закрыта.
    expect(result.spreads[1].left?.master_id).toBe('id-J-Combined-Tail-3');
    expect(result.spreads[1].right).toBeUndefined();
  });
});

describe('transition J-цепочка порядок (half → sixth → full)', () => {
  it('доступны и half и sixth и full → выбран J-Half (первый в новом порядке)', () => {
    const bundle = makeLightBundle(
      makePreset({
        id: 'light',
        density: 'light',
        sheet_type: 'hard',


        section_structure: [{ type: 'students' }, { type: 'transition' }],
      }),
    );
    const result = buildFromSectionStructure(
      bundle,
      makeInput({
        students_count: 18, // full=3, tail=0 → нужна закрывающая
        half_class: 2,
        sixth: 6,
        full_class: 1,
      }),
    );
    expect(result.spreads).toHaveLength(2);
    expect(result.spreads[1].right?.master_id).toBe('id-J-Half');
  });

  it('нет half, есть sixth и full → выбран J-Collage-6 (sixth)', () => {
    const bundle = makeLightBundle(
      makePreset({
        id: 'light',
        density: 'light',
        sheet_type: 'hard',


        section_structure: [{ type: 'students' }, { type: 'transition' }],
      }),
    );
    const result = buildFromSectionStructure(
      bundle,
      makeInput({
        students_count: 18,
        half_class: 0,
        sixth: 6,
        full_class: 1,
      }),
    );
    expect(result.spreads[1].right?.master_id).toBe('id-J-Collage-6');
  });

  it('только full → выбран J-Full', () => {
    const bundle = makeLightBundle(
      makePreset({
        id: 'light',
        density: 'light',
        sheet_type: 'hard',


        section_structure: [{ type: 'students' }, { type: 'transition' }],
      }),
    );
    const result = buildFromSectionStructure(
      bundle,
      makeInput({
        students_count: 18,
        half_class: 0,
        sixth: 0,
        full_class: 1,
      }),
    );
    expect(result.spreads[1].right?.master_id).toBe('id-J-Full');
  });

  it('нет ни одной J-категории → warning transition_skipped', () => {
    const bundle = makeLightBundle(
      makePreset({
        id: 'light',
        density: 'light',
        sheet_type: 'hard',


        section_structure: [{ type: 'students' }, { type: 'transition' }],
      }),
    );
    const result = buildFromSectionStructure(
      bundle,
      makeInput({
        students_count: 18,
        half_class: 0,
        sixth: 0,
        full_class: 0,
      }),
    );
    expect(
      result.warnings.some((w) => w.startsWith('transition_skipped')),
    ).toBe(true);
  });
});

// ─── РЭ.37.3.b: soft binding для combo + closing ────────────────────────
//
// До РЭ.37.3.b формула чётности в transition.ts работала только для
// layflat (где pageInstances[0] = physical page 1 = LEFT). Для soft
// pageInstances[0] = physical page 2 = RIGHT (page 1 — это обложка/forzac,
// в pageInstances не входит). После фикса positionOfIndex и hasVacantRight
// учитывают sheet_type через softOffset(ctx).
//
// Тесты проверяют decision_trace (явные rule_id от transition), а не
// spreads — потому что группировка pageInstances→spreads пока в
// layflat-логике (баг будет починен в РЭ.37.3.c, см. context-v159).
// decision_trace отражает РЕШЕНИЯ engine напрямую и не зависит от
// группировки.

describe('РЭ.37.3.b transition + soft binding (Light, M=3, S-Intro первой)', () => {
  function softLightBundle() {
    return makeLightBundle(
      makePreset({
        id: 'light',
        density: 'light',
        sheet_type: 'soft',
        section_structure: [
          { type: 'soft_intro' },
          { type: 'students' },
          { type: 'transition' },
        ],
      }),
    );
  }

  it('Soft + 13 учеников (full=2 чёт, tail=1) → Combo-3 на L (база) + J-Half на R', () => {
    // pageInstances:
    //   [0]: S-Intro       — physical page 2 (RIGHT разворот 1)
    //   [1]: L-Grid-Page   — physical page 3 (LEFT разворот 2)
    //   [2]: L-Grid-Page   — physical page 4 (RIGHT разворот 2)
    //   [3]: tail (POP)    — physical page 5 (LEFT разворот 3)
    //   → POP, positionOfIndex(soft, 3)=LEFT → PUSH Combo-3 (база, не -Right)
    //   → After combo length=4. hasVacantRight: positionOfIndex(soft, 3)=LEFT → true
    //   → tryJChainClosing: pageIndex=4, positionOfIndex(soft, 4)=RIGHT → J-Half
    const result = buildFromSectionStructure(
      softLightBundle(),
      makeInput({ students_count: 13, half_class: 2, full_class: 2 }),
    );

    // Главная проверка фикса: combo выбрал БАЗОВУЮ версию (не -Right),
    // потому что physical page 5 = LEFT. До РЭ.37.3.b формула idx 3 → RIGHT
    // дала бы -Right версию — это и был баг.
    const comboTrace = result.decision_trace.find((t) =>
      t.rule_id.includes('light:combined_tail:J-Combined-Tail-3'),
    );
    expect(comboTrace).toBeDefined();
    expect(comboTrace?.rule_id).toBe('light:combined_tail:J-Combined-Tail-3');

    // Главная проверка #2: closing-страница на J-Half положена.
    // До фикса closing вообще не вызывалось (length=4 % 2 == 0).
    const closingTrace = result.decision_trace.find((t) =>
      t.rule_id.startsWith('j_chain:half_class:J-Half'),
    );
    expect(closingTrace).toBeDefined();

    // 0 warnings от transition
    expect(
      result.warnings.filter((w) => w.startsWith('transition_')),
    ).toHaveLength(0);
  });

  it('Soft + 6 учеников (full=1, tail=0) → разворот 2 висит left → closing J-Half', () => {
    // pageInstances:
    //   [0]: S-Intro     — physical page 2 (RIGHT разворот 1)
    //   [1]: L-Grid-Page — physical page 3 (LEFT разворот 2) — висит!
    //   hasVacantRight(soft, idx 1): physical page 3 = LEFT → true → closing
    //
    // В layflat-логике (старой) length=2 → 2%2==0 → закрыт → НЕ вызвался.
    // Это и был баг.
    const result = buildFromSectionStructure(
      softLightBundle(),
      makeInput({ students_count: 6, half_class: 2, full_class: 2 }),
    );

    const closingTrace = result.decision_trace.find((t) =>
      t.rule_id.startsWith('j_chain:half_class:J-Half'),
    );
    expect(closingTrace).toBeDefined();
    expect(
      result.warnings.filter((w) => w.startsWith('transition_')),
    ).toHaveLength(0);
  });

  it('Soft + 12 учеников (full=2 чёт, tail=0) → разворот 2 закрыт, closing НЕ нужен', () => {
    // pageInstances:
    //   [0]: S-Intro     — physical page 2 (RIGHT разворот 1)
    //   [1]: L-Grid-Page — physical page 3 (LEFT разворот 2)
    //   [2]: L-Grid-Page — physical page 4 (RIGHT разворот 2) — закрыт
    //   hasVacantRight(soft, idx 2): physical page 4 = RIGHT → false → НЕТ closing
    //
    // В layflat-логике (старой) length=3 → 3%2==1 → ошибочно ТРИГГЕРИЛО
    // closing → лишняя страница. После фикса — корректно нет.
    const result = buildFromSectionStructure(
      softLightBundle(),
      makeInput({ students_count: 12, half_class: 2, full_class: 2 }),
    );

    // Ни одного j_chain в trace
    expect(
      result.decision_trace.filter((t) => t.rule_id.startsWith('j_chain:')),
    ).toHaveLength(0);
    // Ни одного combo (tail=0)
    expect(
      result.decision_trace.filter((t) => t.rule_id.includes('combined_tail')),
    ).toHaveLength(0);
  });

  it('Soft + 19 учеников (full=3 нечёт, tail=1) → Combo-3-Right на R, closing НЕ нужен', () => {
    // pageInstances:
    //   [0]: S-Intro     — physical page 2 (RIGHT разворот 1)
    //   [1]: L-Grid      — page 3 LEFT разворот 2
    //   [2]: L-Grid      — page 4 RIGHT разворот 2
    //   [3]: L-Grid      — page 5 LEFT разворот 3
    //   [4]: tail (POP)  — page 6 RIGHT разворот 3
    //   POP, positionOfIndex(soft, 4)=RIGHT → ищем Combo-3-Right
    //   After combo length=5. hasVacantRight(soft, idx 4): RIGHT → false
    //   → closing НЕ вызван (combo закрыло разворот собой)
    const result = buildFromSectionStructure(
      softLightBundle(),
      makeInput({ students_count: 19, half_class: 2, full_class: 2 }),
    );

    // Combo лёг — есть combined_tail trace
    const comboTrace = result.decision_trace.find((t) =>
      t.rule_id.includes('combined_tail'),
    );
    expect(comboTrace).toBeDefined();
    // Closing НЕ был вызван
    expect(
      result.decision_trace.filter((t) => t.rule_id.startsWith('j_chain:')),
    ).toHaveLength(0);
  });
});
