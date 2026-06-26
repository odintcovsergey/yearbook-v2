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
    expect(classifyMasterAsComplectation('J-Sixth-6')).toBeNull();
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
import { transitionMasterFields } from './__fixtures__/transition-master-fields';

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
  // РЭ.22.10: combo/J-chain дотянуты до реальной разметки (см.
  // __fixtures__/transition-master-fields). Явный slot_capacity (гриды)
  // сохраняется; combo/J получают page_role+capacity+page_type.
  const f = transitionMasterFields(name);
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
    page_role: f?.page_role ?? null,
    slot_capacity: slot_capacity ?? f?.slot_capacity ?? null,
    page_type: f?.page_type,
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
// 04.06.2026: J-Sixth-6 = «1/6 класса» (метки sixthphoto_N → пул sixth).
const J_SIXTH_6 = makeMaster(
  'J-Sixth-6',
  Array.from({ length: 6 }, (_, i) => photoSlot(`sixthphoto_${i + 1}`)),
);

// РЭ.37.3.b: S-Intro для soft-тестов. Первая правая страница soft-альбома
// с общим фото класса.
const S_INTRO = makeMaster('S-Intro', [photoSlot('classphotoframe')]);

const ALL_LIGHT_MASTERS = [L_GRID_PAGE, COMBO_3, COMBO_3_RIGHT, J_HALF, J_FULL, J_SIXTH_6, S_INTRO];

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
    symmetrize_students_tail: opts.symmetrize_students_tail ?? null,
    transition_scenario: opts.transition_scenario ?? null,
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
  collage?: number;
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
      collage: urls(opts.collage ?? 0, 'collage'),
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
    const limitedMasters = [L_GRID_PAGE, J_HALF, J_FULL, J_SIXTH_6];
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

describe('transition J-цепочка порядок (sixth → half → full, РЭ.37.3.b.2)', () => {
  it('доступны и half и sixth и full → выбран J-Sixth-6 (первый в порядке)', () => {
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
    // РЭ.37.3.b.2: sixth-first → J-Sixth-6 имеет приоритет над J-Half
    expect(result.spreads[1].right?.master_id).toBe('id-J-Sixth-6');
  });

  it('нет sixth, есть half и full → выбран J-Half (второй в порядке)', () => {
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
        half_class: 2,
        sixth: 0,
        full_class: 1,
      }),
    );
    expect(result.spreads[1].right?.master_id).toBe('id-J-Half');
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

// ─── РЭ.37.3.b.1: closing при complectation_unknown ─────────────────────
//
// Сценарий из Тест2 на проде (25.05.2026): students-секция кладёт legacy
// combined-tail мастер с именем, которое detectComplectationFromLastPage
// не распознаёт (например L-Combined-Page вместо J-Combined-Tail-3).
// До фикса transition выходил по ветке complectation=null без закрытия
// правой → разворот висел с пустой правой и warning.
//
// После фикса: combo replacement не делается (нечего заменять — мы не
// знаем какой combo подходит), но closing через J-цепочку всё равно
// пушится, если висит правая.

describe('РЭ.37.3.b.1: закрытие разворота при unknown комплектации', () => {
  it('Последняя страница students с unknown именем + hasVacantRight → J-Half на правой', () => {
    // Имитируем сценарий через legacy-style мастер 'L-Combined-Page' который
    // students.ts (semantic-grid режим) может выбрать через findStudentGridMaster
    // как min_fit для 1 ученика + classphoto.
    //
    // makeMaster выше — простой helper. Создаём bundle с мастером L-Combined-Page,
    // имя которого НЕ матчится regex detectComplectationFromLastPage.
    const L_COMBINED_PAGE = makeMaster(
      'L-Combined-Page',
      [
        ...Array.from({ length: 3 }, (_, i) => photoSlot(`studentportrait_${i + 1}`)),
        photoSlot('classphotoframe'),
      ],
      { students: 3, photos_full: 1 },
    );
    const masters = [L_GRID_PAGE, L_COMBINED_PAGE, J_HALF];
    const mastersByName = new Map<string, SpreadTemplate>();
    for (const m of masters) mastersByName.set(m.name, m);
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
        spreads: masters,
      },
      mastersByName,
    };
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 7, half_class: 2, full_class: 1 }),
    );
    // 7 учеников Light: 1 full grid (6) + хвост combined-tail (1+1фото).
    // pageInstances: [L-Grid-Page, L-Combined-Page]
    // length=2, hard binding → hasVacantRight нет (idx 1 = right). Хм,
    // но у нас 6+1=7, full=1 (6 учеников), tail=1. L-Combined занимает
    // index 1 = RIGHT разворот 1. После — нет hanging left. closing НЕ нужен.
    //
    // Чтобы воспроизвести Тест2-сценарий (combined-tail на LEFT), возьмём
    // 13 учеников: full=2, tail=1. pageInstances:
    // [L-Grid (idx 0 = LEFT разворот 1), L-Grid (idx 1 = RIGHT разворот 1),
    //  L-Combined-Page (idx 2 = LEFT разворот 2, висит правая)].
    // Engine: complectation_unknown (L-Combined-Page не распознан) +
    // J-Half closing на правой.
    const result2 = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 13, half_class: 2, full_class: 1 }),
    );

    // Warning о неизвестной комплектации присутствует
    expect(
      result2.warnings.some((w) => w.startsWith('transition_complectation_unknown')),
    ).toBe(true);

    // Но closing всё равно положен через J-цепочку
    const closingTrace = result2.decision_trace.find((t) =>
      t.rule_id.startsWith('j_chain:half_class:'),
    );
    expect(closingTrace).toBeDefined();

    // result2.spreads — на правой последнего разворота должен быть J-Half
    const lastSpread = result2.spreads[result2.spreads.length - 1];
    expect(lastSpread.right?.master_id).toBe('id-J-Half');

    // (result используется выше но мы про второй вариант — оставим первый
    // как контрольный без assertions.)
    void result;
  });
});

// ─── РЭ.37.4: симметризация хвоста ──────────────────────────────────────
//
// Опт-ин фича: preset.symmetrize_students_tail = true.
// Применяется только для Mini/Light с tail=1.
// Забирает 1 ученика с предыдущей полной страницы → на хвостовой combo
// с 2 учениками вместо 1. Цель — визуальная симметрия (избежать
// одинокого портрета на странице).

describe('РЭ.37.4: симметризация хвоста', () => {
  it('Light 13 учеников + symmetrize=true → combo с 2 учениками, prev grid с 5', () => {
    // 13 учеников Light (grid_size=6): full_pages=2, tail=1
    // Без симметризации: [grid6: 0..5], [grid6: 6..11], [combo: 12]
    // С симметризацией:  [grid6: 0..5], [grid6: 6..10 + hidden],
    //                    [combo-3: 11, 12 + 1 hidden + classphoto]
    //
    // pageInstances после симметризации = 3 entries (длина та же), затем
    // closing на R → 4 entries. Парная группировка:
    //   spread 0: [grid6(0..5), grid6(6..10 + hidden)]
    //   spread 1: [combo-3, J-Half]
    //
    // То есть combo попадает на ЛЕВУЮ второго разворота (positionOfIndex(2)=left).
    // Closing — J-Half (half=2).
    //
    // РЭ.40/РЭ.51: симметризация хвоста работает ТОЛЬКО в greedy режиме
    // распределения (см. decideDistribution в distribution.ts). В auto/
    // equalize режимах хвост распределяется равномерно, симметризация
    // не нужна. Явно ставим greedy чтобы воспроизвести legacy сценарий.
    const bundle = makeLightBundle(
      makePreset({
        id: 'light',
        density: 'light',
        sheet_type: 'hard',
        symmetrize_students_tail: true,
        section_structure: [{ type: 'students' }, { type: 'transition' }],
      }),
    );
    const result = buildFromSectionStructure(
      bundle,
      {
        ...makeInput({ students_count: 13, half_class: 2, full_class: 1 }),
        student_distribution: 'greedy',
      },
    );

    // Trace: symmetrize:light:J-Combined-Tail-3 должна быть
    const symmTrace = result.decision_trace.find((t) =>
      t.rule_id.startsWith('symmetrize:light:'),
    );
    expect(symmTrace).toBeDefined();
    expect(symmTrace?.inputs.prev_students_count).toBe(5);
    expect(symmTrace?.inputs.tail_students_count).toBe(2);
    expect(symmTrace?.inputs.combo_master).toBe('J-Combined-Tail-3');
    expect(symmTrace?.inputs.combo_position).toBe('left');

    // Warning info
    expect(
      result.warnings.some((w) => w.startsWith('transition_symmetrized')),
    ).toBe(true);

    // 2 разворота
    expect(result.spreads).toHaveLength(2);

    // Spread 0: левая = grid6 с учениками 0..5, правая = grid6 с 5 учениками + hidden
    const first = result.spreads[0];
    expect(first.left?.master_id).toBe('id-L-Grid-Page');
    expect(first.left?.bindings.studentportrait_1).toBe('https://cdn/p0.jpg');
    expect(first.left?.bindings.studentportrait_6).toBe('https://cdn/p5.jpg');
    expect(first.right?.master_id).toBe('id-L-Grid-Page');
    // На правой 5 учеников (6..10) + 1 hidden
    expect(first.right?.bindings.studentportrait_1).toBe('https://cdn/p6.jpg');
    expect(first.right?.bindings.studentportrait_5).toBe('https://cdn/p10.jpg');
    expect(first.right?.bindings.__hidden__studentportrait_6).toBe('1');

    // Spread 1: левая = combo-3 с 2 учениками + classphoto, правая = J-Half closing
    const second = result.spreads[1];
    expect(second.left?.master_id).toBe('id-J-Combined-Tail-3');
    expect(second.left?.bindings.studentportrait_1).toBe('https://cdn/p11.jpg');
    expect(second.left?.bindings.studentportrait_2).toBe('https://cdn/p12.jpg');
    expect(second.left?.bindings.__hidden__studentportrait_3).toBe('1');
    expect(second.left?.bindings.classphotoframe).toBe('https://cdn/full_0.jpg');
    expect(second.right?.master_id).toBe('id-J-Half');
  });

  it('Light 13 + symmetrize=false → обычная combo с 1 учеником (контроль)', () => {
    // Контрольный тест: тот же сценарий, но флаг false.
    const bundle = makeLightBundle(
      makePreset({
        id: 'light',
        density: 'light',
        sheet_type: 'hard',
        symmetrize_students_tail: false,
        section_structure: [{ type: 'students' }, { type: 'transition' }],
      }),
    );
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 13, half_class: 2, full_class: 1 }),
    );

    // НЕТ trace symmetrize
    expect(
      result.decision_trace.some((t) => t.rule_id.startsWith('symmetrize:')),
    ).toBe(false);
    // НЕТ warning
    expect(
      result.warnings.some((w) => w.startsWith('transition_symmetrized')),
    ).toBe(false);
    // Combo с 1 учеником + 2 hidden (обычный сценарий из РЭ.37.2)
    const second = result.spreads[1];
    expect(second.left?.master_id).toBe('id-J-Combined-Tail-3');
    expect(second.left?.bindings.studentportrait_1).toBe('https://cdn/p12.jpg');
    expect(second.left?.bindings.__hidden__studentportrait_2).toBe('1');
    expect(second.left?.bindings.__hidden__studentportrait_3).toBe('1');
  });

  it('Light 14 учеников (tail=2) + symmetrize=true → симметризация НЕ срабатывает', () => {
    // tail=2, не 1 → условие симметризации не выполнено.
    const bundle = makeLightBundle(
      makePreset({
        id: 'light',
        density: 'light',
        sheet_type: 'hard',
        symmetrize_students_tail: true,
        section_structure: [{ type: 'students' }, { type: 'transition' }],
      }),
    );
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 14, half_class: 2, full_class: 1 }),
    );
    expect(
      result.decision_trace.some((t) => t.rule_id.startsWith('symmetrize:')),
    ).toBe(false);
  });

  it('Light 19 учеников (tail=1, full_pages=3 нечёт) + symmetrize=true → combo на R', () => {
    // 19 учеников: full=3, tail=1
    // Без симметризации: [grid×3], [grid+combo-1ученик] (combo на R разворот 4)
    // С симметризацией: [grid×2], [grid+grid с 5+hidden], [combo с 2+classphoto]
    //                                                       это новый разворот с
    //                                                       combo на LEFT
    //
    // hmm wait: 19 - 1 - 6 = 12. prevStudents.slice(12, 17) = 5 учеников (12..16).
    // tailStudents.slice(17, 19) = 2 ученика (17..18). ОК.
    //
    // После симметризации pageInstances:
    //   [0]: grid6 (0..5)
    //   [1]: grid6 (6..11)
    //   [2]: grid6 (12..16 + 1 hidden) ← новая
    //   [3]: combo-3 (17..18 + 1 hidden + classphoto) ← новая
    // 4 entries, разворот 2 = [grid, grid], разворот 3 = [grid, combo].
    // Combo на index 3 = RIGHT для hard.
    const bundle = makeLightBundle(
      makePreset({
        id: 'light',
        density: 'light',
        sheet_type: 'hard',
        symmetrize_students_tail: true,
        section_structure: [{ type: 'students' }, { type: 'transition' }],
      }),
    );
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 19, half_class: 2, full_class: 1 }),
    );

    const symmTrace = result.decision_trace.find((t) =>
      t.rule_id.startsWith('symmetrize:light:'),
    );
    expect(symmTrace).toBeDefined();
    expect(symmTrace?.inputs.combo_position).toBe('right');
    // Combo на R = -Right версия
    expect(symmTrace?.inputs.combo_master).toBe('J-Combined-Tail-3-Right');
  });

  it('Standard + symmetrize=true → симметризация игнорируется (только Mini/Light)', () => {
    // Standard плотность → симметризация не применяется по spec.
    // Здесь сложно проверить через layflat-bundle (нужны E-Standard мастера),
    // проверим через прямую трассировку: для Standard layout.tail!==1
    // потому что комплектация другая. Хорошо хотя бы убедиться что НЕТ
    // trace 'symmetrize:'.
    const bundle = makeLightBundle(
      makePreset({
        id: 'std',
        density: 'standard', // не Light
        sheet_type: 'hard',
        symmetrize_students_tail: true,
        section_structure: [{ type: 'students' }, { type: 'transition' }],
      }),
    );
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 13, half_class: 2, full_class: 1 }),
    );
    expect(
      result.decision_trace.some((t) => t.rule_id.startsWith('symmetrize:')),
    ).toBe(false);
  });

  // ─── Фикс 25.05.2026 (РЭ.37.4.b): симметризация через preset, ──────────
  // когда detectComplectationFromLastPage не распознала комплектацию по
  // мастеру (legacy L-Combined-Page и аналоги).
  //
  // Тест2 case: Light 25 учеников, semantic-grid режим — students.ts кладёт
  // L-Combined-Page (вместо J-Combined-Tail-3). detectComplectationFromLastPage
  // возвращает null. До фикса симметризация не запускалась → хвост оставался
  // с 1 учеником несмотря на включённую галку. После фикса transition.ts
  // пробует определить комплектацию через preset.student_grid_size:
  //   grid_size=12 → mini
  //   grid_size=6  → light
  // И уже симметризация работает.

  it('Light 25 + legacy L-Combined-Page + symmetrize=true → симметризация через preset', () => {
    // Создаём bundle с legacy L-Combined-Page (имя которого НЕ
    // распознаётся detectComplectationFromLastPage).
    const L_COMBINED_PAGE = makeMaster(
      'L-Combined-Page',
      [
        ...Array.from({ length: 3 }, (_, i) => photoSlot(`studentportrait_${i + 1}`)),
        photoSlot('classphotoframe'),
      ],
      { students: 3, photos_full: 1 },
    );
    const masters = [L_GRID_PAGE, L_COMBINED_PAGE, COMBO_3, COMBO_3_RIGHT, J_HALF];
    const mastersByName = new Map<string, SpreadTemplate>();
    for (const m of masters) mastersByName.set(m.name, m);
    const bundle: RuleEngineBundle = {
      preset: makePreset({
        id: 'light',
        density: 'light', // ← через density, без student_layout_mode (legacy-style)
        sheet_type: 'hard',
        symmetrize_students_tail: true,
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
        spreads: masters,
      },
      mastersByName,
    };

    // 25 учеников: full=4, tail=1
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 25, half_class: 2, full_class: 1 }),
    );

    // Trace симметризации должен присутствовать (через preset path)
    const symmTraceFromPreset = result.decision_trace.find(
      (t) => t.rule_id === 'okeybook_default:symmetrize_from_preset',
    );
    expect(symmTraceFromPreset).toBeDefined();
    // grid_size в пресете не задан, density='light' использован как fallback
    expect(symmTraceFromPreset?.inputs.preset_density).toBe('light');
    expect(symmTraceFromPreset?.inputs.inferred_complectation).toBe('light');

    // Сама симметризация (после)
    const symmTrace = result.decision_trace.find((t) =>
      t.rule_id.startsWith('symmetrize:light:'),
    );
    expect(symmTrace).toBeDefined();
    expect(symmTrace?.inputs.prev_students_count).toBe(5);
    expect(symmTrace?.inputs.tail_students_count).toBe(2);

    // Warning info
    expect(
      result.warnings.some((w) => w.startsWith('transition_symmetrized')),
    ).toBe(true);
    // Старого warning о unknown быть НЕ должно — мы решили вопрос через preset
    expect(
      result.warnings.some((w) =>
        w.startsWith('transition_complectation_unknown'),
      ),
    ).toBe(false);
  });

  it('Light 25 + legacy + symmetrize=false → старое поведение (unknown warning)', () => {
    // Контрольный тест: при symmetrize=false для legacy мастера остаётся
    // старое поведение — transition_complectation_unknown + closing.
    const L_COMBINED_PAGE = makeMaster(
      'L-Combined-Page',
      [
        ...Array.from({ length: 3 }, (_, i) => photoSlot(`studentportrait_${i + 1}`)),
        photoSlot('classphotoframe'),
      ],
      { students: 3, photos_full: 1 },
    );
    const masters = [L_GRID_PAGE, L_COMBINED_PAGE, J_HALF];
    const mastersByName = new Map<string, SpreadTemplate>();
    for (const m of masters) mastersByName.set(m.name, m);
    const bundle: RuleEngineBundle = {
      preset: makePreset({
        id: 'light',
        density: 'light',
        sheet_type: 'hard',
        symmetrize_students_tail: false, // ← выключено
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
        spreads: masters,
      },
      mastersByName,
    };
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 25, half_class: 2, full_class: 1 }),
    );

    // Симметризация НЕ срабатывает
    expect(
      result.decision_trace.some((t) => t.rule_id.startsWith('symmetrize:')),
    ).toBe(false);
    // Возвращается старое info-warning
    expect(
      result.warnings.some((w) =>
        w.startsWith('transition_complectation_unknown'),
      ),
    ).toBe(true);
  });
});

// ─── РЭ.37.6: ручной сценарий из preset.transition_scenario ────────────
//
// Тесты для fillPresetCustomScenario — функции которая срабатывает когда
// в пресете явно задан custom-сценарий (через UI РЭ.37.6.d). В отличие
// от OkeyBook-default, custom-сценарий:
//   • применяется ВСЕГДА когда задан (независимо от чётности, типа
//     последней students-страницы и т.д.)
//   • не определяет комплектацию
//   • не применяет симметризацию (партнёр сам решил)
//   • кладёт указанные master_id с правильным bindings (grid/combo/common)

describe('РЭ.37.6: preset.transition_scenario custom-сценарий', () => {
  it('tail_left=J-Half (common-мастер) → правильный bind halfphoto', () => {
    // Light 13 учеников, tail=1. По умолчанию engine положил бы combo-3
    // на L + J-Half на R. Партнёр в transition_scenario явно сказал
    // "положи J-Half на L (вместо combo) и закрой как обычно".
    //
    // Замена должна сработать через bindCommonPhotos (J-Half = halfphoto_1/2).
    const bundle = makeLightBundle(
      makePreset({
        id: 'custom-half-left',
        density: 'light',
        sheet_type: 'hard',
        section_structure: [{ type: 'students' }, { type: 'transition' }],
        transition_scenario: {
          mode: 'custom',
          tail_left_master_id: 'id-J-Half',
          tail_right_master_id: null,
          closing_master_id: null,
        },
      }),
    );
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 13, half_class: 4, full_class: 1 }),
    );

    // Trace должен показать что preset_custom_scenario сработал
    expect(
      result.decision_trace.some((t) =>
        t.rule_id === 'preset_custom_scenario:start',
      ),
    ).toBe(true);
    expect(
      result.decision_trace.some((t) =>
        t.rule_id?.startsWith('preset_custom_scenario:tail_left:'),
      ),
    ).toBe(true);

    // Spread 1 left должен быть J-Half с заполненными halfphoto.
    const lastSpread = result.spreads[result.spreads.length - 1];
    expect(lastSpread.left?.master_id).toBe('id-J-Half');
    expect(typeof lastSpread.left?.bindings.halfphoto_1).toBe('string');
    expect(typeof lastSpread.left?.bindings.halfphoto_2).toBe('string');

    // НЕТ warning о combo (combo не применялся — мы кастомным заменили)
    expect(
      result.warnings.some((w) =>
        w.startsWith('transition_combo_master_missing'),
      ),
    ).toBe(false);
  });

  it('tail_left=combo-мастер → bind учеников хвоста + classphoto', () => {
    // Партнёр явно выбрал J-Combined-Tail-3 (его id) для tail_left.
    // Должно сработать как обычный combo: 1 ученик хвоста + classphoto.
    const bundle = makeLightBundle(
      makePreset({
        id: 'custom-combo-left',
        density: 'light',
        sheet_type: 'hard',
        section_structure: [{ type: 'students' }, { type: 'transition' }],
        transition_scenario: {
          mode: 'custom',
          tail_left_master_id: 'id-J-Combined-Tail-3',
          tail_right_master_id: null,
          closing_master_id: null,
        },
      }),
    );
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 13, half_class: 2, full_class: 1 }),
    );

    const lastSpread = result.spreads[result.spreads.length - 1];
    expect(lastSpread.left?.master_id).toBe('id-J-Combined-Tail-3');
    // На combo лежит 1 студент (хвост) + classphoto, остальные скрыты
    expect(typeof lastSpread.left?.bindings.studentportrait_1).toBe('string');
    expect(typeof lastSpread.left?.bindings.classphotoframe).toBe('string');
  });

  it('tail_left=master_id отсутствует в template_set → warning + старый layout', () => {
    // Партнёр сохранил master_id, который потом был удалён из template_set
    // (или это какой-то мусор). Engine должен добавить warning и оставить
    // popped страницу на месте.
    const bundle = makeLightBundle(
      makePreset({
        id: 'custom-missing',
        density: 'light',
        sheet_type: 'hard',
        section_structure: [{ type: 'students' }, { type: 'transition' }],
        transition_scenario: {
          mode: 'custom',
          tail_left_master_id: 'id-DOES-NOT-EXIST',
          tail_right_master_id: null,
          closing_master_id: null,
        },
      }),
    );
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 13, half_class: 2, full_class: 1 }),
    );

    // Warning должен быть
    expect(
      result.warnings.some((w) =>
        w.startsWith('transition_custom_master_not_found'),
      ),
    ).toBe(true);
    // Last spread всё ещё должен содержать хвост (engine не сломался)
    expect(result.spreads.length).toBeGreaterThan(0);
  });

  it('tail_right=J-Sixth-6 + правая висит → bind collagephoto', () => {
    // Партнёр положил кастомный мастер на правую страницу transition.
    // Light 19 (full=3 нечёт, tail=1) → tail попадает на L первого
    // students-разворота нового spread, R висит. Партнёр поставил
    // tail_right=J-Sixth-6 — engine должен положить туда коллаж.
    const bundle = makeLightBundle(
      makePreset({
        id: 'custom-right-collage',
        density: 'light',
        sheet_type: 'hard',
        section_structure: [{ type: 'students' }, { type: 'transition' }],
        transition_scenario: {
          mode: 'custom',
          tail_left_master_id: null,
          tail_right_master_id: 'id-J-Sixth-6',
          closing_master_id: null,
        },
      }),
    );
    const result = buildFromSectionStructure(
      bundle,
      // 13 учеников (full=2 чёт, tail=1) → tail сел на L нового spread,
      // R висит. Партнёр сказал положить J-Sixth-6 на R.
      makeInput({ students_count: 13, half_class: 0, full_class: 1, sixth: 6 }),
    );

    const lastSpread = result.spreads[result.spreads.length - 1];
    expect(lastSpread.right?.master_id).toBe('id-J-Sixth-6');
    // collagephoto_1..6 должны быть заполнены
    expect(typeof lastSpread.right?.bindings.sixthphoto_1).toBe('string');
    expect(typeof lastSpread.right?.bindings.sixthphoto_6).toBe('string');

    // Trace на tail_right
    expect(
      result.decision_trace.some((t) =>
        t.rule_id?.startsWith('preset_custom_scenario:tail_right:'),
      ),
    ).toBe(true);
  });

  it('tail_right=null + правая висит → fallback на стандартную J-цепочку', () => {
    // Light 13 (tail=1) → tail сел на L нового spread, R висит.
    // tail_right не задан → engine использует обычный tryJChainClosing
    // (выберет J-Half/J-Sixth-6/J-Full по доступным фото).
    const bundle = makeLightBundle(
      makePreset({
        id: 'custom-left-only',
        density: 'light',
        sheet_type: 'hard',
        section_structure: [{ type: 'students' }, { type: 'transition' }],
        transition_scenario: {
          mode: 'custom',
          tail_left_master_id: 'id-J-Combined-Tail-3',
          tail_right_master_id: null,
          closing_master_id: null,
        },
      }),
    );
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 13, half_class: 2, full_class: 1 }),
    );

    const lastSpread = result.spreads[result.spreads.length - 1];
    expect(lastSpread.left?.master_id).toBe('id-J-Combined-Tail-3');
    // R закрыт через J-цепочку (Half — есть 2 фото half_class)
    expect(lastSpread.right?.master_id).toBe('id-J-Half');
  });

  it('mode=default → старое OkeyBook поведение (контроль)', () => {
    // Если transition_scenario = null или mode='default' — engine
    // использует обычную логику без custom-вмешательства.
    // (mode='default' API нормализует в null, но проверим что null path
    // работает.)
    const bundle = makeLightBundle(
      makePreset({
        id: 'no-custom-control',
        density: 'light',
        sheet_type: 'hard',
        section_structure: [{ type: 'students' }, { type: 'transition' }],
        transition_scenario: null,
      }),
    );
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 13, half_class: 2, full_class: 1 }),
    );
    // НЕ должно быть trace preset_custom_scenario
    expect(
      result.decision_trace.some((t) =>
        t.rule_id?.startsWith('preset_custom_scenario:'),
      ),
    ).toBe(false);
    // Должно быть обычное combo replacement
    const lastSpread = result.spreads[result.spreads.length - 1];
    expect(lastSpread.left?.master_id).toBe('id-J-Combined-Tail-3');
    expect(lastSpread.right?.master_id).toBe('id-J-Half');
  });

  it('symmetrize=true + custom-сценарий → симметризация ИГНОРИРУЕТСЯ', () => {
    // Если включена симметризация И задан custom-сценарий — приоритет
    // у custom (партнёр сам решил). Симметризация не должна выполняться.
    const bundle = makeLightBundle(
      makePreset({
        id: 'custom-wins-over-symm',
        density: 'light',
        sheet_type: 'hard',
        symmetrize_students_tail: true, // включена, но игнорируется
        section_structure: [{ type: 'students' }, { type: 'transition' }],
        transition_scenario: {
          mode: 'custom',
          tail_left_master_id: 'id-J-Half',
          tail_right_master_id: null,
          closing_master_id: null,
        },
      }),
    );
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 13, half_class: 4, full_class: 1 }),
    );
    // Trace симметризации НЕ должен быть
    expect(
      result.decision_trace.some((t) => t.rule_id?.startsWith('symmetrize:')),
    ).toBe(false);
    // Custom сработал
    expect(
      result.decision_trace.some(
        (t) => t.rule_id === 'preset_custom_scenario:start',
      ),
    ).toBe(true);
  });
});
