/**
 * Тесты для fillStudentsSection (РЭ.21.8.4b — single page режимы).
 *
 * Покрывают:
 *  - preset.density=null → warning students_density_not_supported
 *  - preset.density='medium'/'light'/'mini' → warning ...not_implemented_yet
 *  - density='standard': двухстраничный E-Student-Standard,
 *    is_spread=true в SpreadInstance после группировки
 *  - Нечётное число учеников в Standard → последний пара с null'ями + warning
 *  - density='universal': чередование E-Universal-Left / E-Universal-Right
 *  - Bindings Standard: studentportrait_left/right + name + quote
 *  - Bindings Universal: studentportrait + name + quote + friend_photos
 *  - master_not_found когда мастер отсутствует
 */

import { describe, it, expect } from 'vitest';
import { buildFromSectionStructure } from '../build-from-section-structure';
import type {
  Preset,
  PresetDensity,
  Rule,
  RulesAlbumInput,
  TemplateFamily,
} from '../types';
import type { RuleEngineBundle } from '../loaders';
import type {
  Placeholder,
  SpreadTemplate,
  TemplateSet,
} from '@/lib/album-builder/types';

// ─── Фикстуры мастеров ──────────────────────────────────────────────────────

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

function makeMaster(
  name: string,
  placeholders: Placeholder[] = [],
  isSpread = false,
): SpreadTemplate {
  return {
    id: `id-${name}`,
    name,
    type: 'common',
    is_spread: isSpread,
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

const E_STANDARD = makeMaster(
  'E-Student-Standard',
  [
    photoSlot('studentportrait_left'),
    textSlot('studentname_left'),
    textSlot('studentquote_left'),
    photoSlot('studentportrait_right'),
    textSlot('studentname_right'),
    textSlot('studentquote_right'),
  ],
  true, // is_spread двухстраничный
);

const E_UNIVERSAL_LEFT = makeMaster('E-Universal-Left', [
  photoSlot('studentportrait'),
  textSlot('studentname'),
  textSlot('studentquote'),
  photoSlot('studentphoto_1'),
  photoSlot('studentphoto_2'),
]);

const E_UNIVERSAL_RIGHT = makeMaster('E-Universal-Right', [
  photoSlot('studentportrait'),
  textSlot('studentname'),
  textSlot('studentquote'),
  photoSlot('studentphoto_1'),
  photoSlot('studentphoto_2'),
]);

const ALL_STUDENT_MASTERS: SpreadTemplate[] = [
  E_STANDARD,
  E_UNIVERSAL_LEFT,
  E_UNIVERSAL_RIGHT,
];

// ─── makeBundle / makeInput / makePreset ────────────────────────────────────

function makePreset(
  opts: Partial<Preset> & Pick<Preset, 'id'> & { density?: PresetDensity | null },
): Preset {
  return {
    id: opts.id,
    display_name: opts.display_name ?? 'Test',
    print_type: opts.print_type ?? 'layflat',
    pages_per_spread: opts.pages_per_spread ?? 2,
    version: opts.version ?? '1.0',
    sections: opts.sections ?? [],
    tenant_id: opts.tenant_id ?? null,
    section_structure: opts.section_structure ?? [{ type: 'students' }],
    density: opts.density ?? null,
  };
}

function makeBundle(opts: {
  preset: Preset;
  masters?: SpreadTemplate[];
}): RuleEngineBundle {
  const masters = opts.masters ?? ALL_STUDENT_MASTERS;
  const mastersByName = new Map<string, SpreadTemplate>();
  for (const m of masters) mastersByName.set(m.name, m);
  const templateSet: TemplateSet = {
    id: 'ts-test',
    tenant_id: null,
    name: 'test',
    slug: 'test',
    print_type: 'layflat',
    page_width_mm: 200,
    page_height_mm: 280,
    spread_width_mm: 400,
    spread_height_mm: 280,
    bleed_mm: 0,
    facing_pages: true,
    page_binding: 'LeftToRight',
    spreads: masters,
  };
  return {
    preset: opts.preset,
    rules: [] as Rule[],
    families: [] as TemplateFamily[],
    templateSet,
    mastersByName,
  };
}

function makeInput(opts: {
  students: number;
  friend_photos_per_student?: number;
}): RulesAlbumInput {
  const students = [];
  for (let i = 1; i <= opts.students; i++) {
    const friends = [];
    const friendCount = opts.friend_photos_per_student ?? 0;
    for (let j = 1; j <= friendCount; j++) {
      friends.push(`https://cdn/friend_${i}_${j}.jpg`);
    }
    students.push({
      portrait: `https://cdn/portrait_${i}.jpg`,
      full_name: `Ученик ${i}`,
      quote: `Цитата ${i}`,
      friend_photos: friends,
    });
  }
  return {
    students,
    subjects: [],
    head_teacher: { photo: null, name: '', role: '', text: '' },
    common_photos: {
      full_class: [],
      half_class: [],
      spread: [],
      quarter: [],
      sixth: [],
    },
  };
}

// ─── 1. density=null / unsupported ─────────────────────────────────────────

describe('students: неподдерживаемые density', () => {
  it('density=null → warning students_density_not_supported, нет страниц', () => {
    const bundle = makeBundle({ preset: makePreset({ id: 'p', density: null }) });
    const result = buildFromSectionStructure(bundle, makeInput({ students: 4 }));
    expect(result.spreads).toEqual([]);
    expect(
      result.warnings.some((w) =>
        w.startsWith('students_density_not_supported'),
      ),
    ).toBe(true);
  });

  it("density='medium' → warning students_density_not_implemented_yet (21.8.4c)", () => {
    const bundle = makeBundle({
      preset: makePreset({ id: 'p', density: 'medium' }),
    });
    const result = buildFromSectionStructure(bundle, makeInput({ students: 8 }));
    expect(result.spreads).toEqual([]);
    expect(
      result.warnings.some((w) =>
        w.startsWith('students_density_not_implemented_yet'),
      ),
    ).toBe(true);
  });

  it("density='light' → warning not_implemented_yet", () => {
    const bundle = makeBundle({
      preset: makePreset({ id: 'p', density: 'light' }),
    });
    const result = buildFromSectionStructure(bundle, makeInput({ students: 6 }));
    expect(
      result.warnings.some((w) =>
        w.startsWith('students_density_not_implemented_yet'),
      ),
    ).toBe(true);
  });

  it("density='mini' → warning not_implemented_yet", () => {
    const bundle = makeBundle({
      preset: makePreset({ id: 'p', density: 'mini' }),
    });
    const result = buildFromSectionStructure(bundle, makeInput({ students: 12 }));
    expect(
      result.warnings.some((w) =>
        w.startsWith('students_density_not_implemented_yet'),
      ),
    ).toBe(true);
  });
});

// ─── 2. density='standard' ──────────────────────────────────────────────────

describe("students: density='standard' (E-Student-Standard двухстраничный)", () => {
  it('4 ученика → 2 разворота, is_spread=true в обоих', () => {
    const bundle = makeBundle({
      preset: makePreset({ id: 'p', density: 'standard' }),
    });
    const result = buildFromSectionStructure(bundle, makeInput({ students: 4 }));
    expect(result.status).toBe('ok');
    expect(result.spreads).toHaveLength(2);
    expect(result.spreads[0].is_spread).toBe(true);
    expect(result.spreads[1].is_spread).toBe(true);
    expect(result.spreads[0].left?.master_id).toBe('id-E-Student-Standard');
    expect(result.spreads[0].right?.master_id).toBe('id-E-Student-Standard');
    expect(result.spreads[1].left?.master_id).toBe('id-E-Student-Standard');
    expect(result.spreads[1].right?.master_id).toBe('id-E-Student-Standard');
  });

  it('3 ученика → 2 разворота, последний с null правой + warning students_odd_in_standard', () => {
    const bundle = makeBundle({
      preset: makePreset({ id: 'p', density: 'standard' }),
    });
    const result = buildFromSectionStructure(bundle, makeInput({ students: 3 }));
    expect(result.spreads).toHaveLength(2);
    // На последнем развороте: right=null
    const lastBindings = result.spreads[1].left!.bindings;
    expect(lastBindings.studentportrait_left).toBe(
      'https://cdn/portrait_3.jpg',
    );
    expect(lastBindings.studentportrait_right).toBeNull();
    expect(lastBindings.studentname_right).toBeNull();
    expect(lastBindings.studentquote_right).toBeNull();
    expect(
      result.warnings.some((w) => w.startsWith('students_odd_in_standard')),
    ).toBe(true);
  });

  it('Bindings Standard: portrait/name/quote в _left и _right', () => {
    const bundle = makeBundle({
      preset: makePreset({ id: 'p', density: 'standard' }),
    });
    const input = makeInput({ students: 2 });
    const result = buildFromSectionStructure(bundle, input);
    const b = result.spreads[0].left!.bindings;
    expect(b.studentportrait_left).toBe(input.students[0].portrait);
    expect(b.studentname_left).toBe(input.students[0].full_name);
    expect(b.studentquote_left).toBe(input.students[0].quote);
    expect(b.studentportrait_right).toBe(input.students[1].portrait);
    expect(b.studentname_right).toBe(input.students[1].full_name);
    expect(b.studentquote_right).toBe(input.students[1].quote);
  });

  it('E-Student-Standard отсутствует → warning students_master_not_found', () => {
    const bundle = makeBundle({
      preset: makePreset({ id: 'p', density: 'standard' }),
      masters: [], // ничего нет
    });
    const result = buildFromSectionStructure(bundle, makeInput({ students: 4 }));
    expect(result.spreads).toEqual([]);
    expect(
      result.warnings.some(
        (w) =>
          w.startsWith('students_master_not_found') &&
          w.includes('E-Student-Standard'),
      ),
    ).toBe(true);
  });
});

// ─── 3. density='universal' ────────────────────────────────────────────────

describe("students: density='universal' (E-Universal-Left/Right одностраничные)", () => {
  it('4 ученика → 2 разворота, чередование Left/Right, is_spread=false', () => {
    const bundle = makeBundle({
      preset: makePreset({ id: 'p', density: 'universal' }),
    });
    const result = buildFromSectionStructure(bundle, makeInput({ students: 4 }));
    expect(result.status).toBe('ok');
    expect(result.spreads).toHaveLength(2);
    expect(result.spreads[0].is_spread).toBeUndefined();
    expect(result.spreads[0].left?.master_id).toBe('id-E-Universal-Left');
    expect(result.spreads[0].right?.master_id).toBe('id-E-Universal-Right');
    expect(result.spreads[1].left?.master_id).toBe('id-E-Universal-Left');
    expect(result.spreads[1].right?.master_id).toBe('id-E-Universal-Right');
  });

  it('3 ученика → 2 разворота, 2-й с одной L страницей', () => {
    const bundle = makeBundle({
      preset: makePreset({ id: 'p', density: 'universal' }),
    });
    const result = buildFromSectionStructure(bundle, makeInput({ students: 3 }));
    expect(result.spreads).toHaveLength(2);
    expect(result.spreads[1].left?.master_id).toBe('id-E-Universal-Left');
    expect(result.spreads[1].right).toBeUndefined();
  });

  it('Bindings Universal: portrait/name/quote/studentphoto_N', () => {
    const bundle = makeBundle({
      preset: makePreset({ id: 'p', density: 'universal' }),
    });
    const input = makeInput({ students: 1, friend_photos_per_student: 2 });
    const result = buildFromSectionStructure(bundle, input);
    const b = result.spreads[0].left!.bindings;
    expect(b.studentportrait).toBe(input.students[0].portrait);
    expect(b.studentname).toBe(input.students[0].full_name);
    expect(b.studentquote).toBe(input.students[0].quote);
    expect(b.studentphoto_1).toBe(input.students[0].friend_photos![0]);
    expect(b.studentphoto_2).toBe(input.students[0].friend_photos![1]);
  });

  it('Меньше friend_photos чем слотов → лишние слоты null', () => {
    const bundle = makeBundle({
      preset: makePreset({ id: 'p', density: 'universal' }),
    });
    const input = makeInput({ students: 1, friend_photos_per_student: 1 });
    const result = buildFromSectionStructure(bundle, input);
    const b = result.spreads[0].left!.bindings;
    expect(b.studentphoto_1).toBe(input.students[0].friend_photos![0]);
    expect(b.studentphoto_2).toBeNull();
  });

  it('E-Universal-Left отсутствует → warning students_master_not_found', () => {
    const bundle = makeBundle({
      preset: makePreset({ id: 'p', density: 'universal' }),
      masters: [E_UNIVERSAL_RIGHT], // только Right, без Left
    });
    const result = buildFromSectionStructure(bundle, makeInput({ students: 2 }));
    expect(
      result.warnings.some(
        (w) =>
          w.startsWith('students_master_not_found') &&
          w.includes('E-Universal-Left'),
      ),
    ).toBe(true);
  });

  it('E-Universal-Right отсутствует → warning, страниц нет', () => {
    const bundle = makeBundle({
      preset: makePreset({ id: 'p', density: 'universal' }),
      masters: [E_UNIVERSAL_LEFT],
    });
    const result = buildFromSectionStructure(bundle, makeInput({ students: 2 }));
    expect(result.spreads).toEqual([]);
    expect(
      result.warnings.some(
        (w) =>
          w.startsWith('students_master_not_found') &&
          w.includes('E-Universal-Right'),
      ),
    ).toBe(true);
  });
});

// ─── 4. Студенты + общий раздел ────────────────────────────────────────────

describe('students + common: позиция работает корректно', () => {
  it('Universal с 3 учениками (висящая L), потом common(FULL) → правильно на правой', () => {
    // J-Half / J-ClassPhoto-Right нужны для common; добавим
    const jClassPhotoRight = makeMaster('J-ClassPhoto-Right', [
      photoSlot('classphotoframe'),
    ]);
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        density: 'universal',
        section_structure: [
          { type: 'students' },
          { type: 'common', slots: ['FULL'] },
        ],
      }),
      masters: [...ALL_STUDENT_MASTERS, jClassPhotoRight],
    });
    const input = {
      ...makeInput({ students: 3 }),
      common_photos: {
        full_class: ['https://cdn/full_0.jpg'],
        half_class: [],
        spread: [],
        quarter: [],
        sixth: [],
      },
    };
    const result = buildFromSectionStructure(bundle, input);
    // 3 ученика Universal: pages 0=L, 1=R, 2=L (висящий left)
    // FULL слот: page index 3, position='right' → J-ClassPhoto-Right
    expect(result.spreads).toHaveLength(2);
    expect(result.spreads[1].left?.master_id).toBe('id-E-Universal-Left');
    expect(result.spreads[1].right?.master_id).toBe('id-J-ClassPhoto-Right');
  });
});
