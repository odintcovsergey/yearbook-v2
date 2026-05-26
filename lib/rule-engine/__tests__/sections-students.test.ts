/**
 * Тесты для fillStudentsSection (РЭ.21.8.4b/c + 21.8.6a).
 *
 * Покрывают:
 *  - preset.density=null → warning students_density_not_supported
 *  - density='standard': alternating E-Standard-Left/Right
 *    (как Universal; ранее ошибочно ожидался is_spread)
 *  - density='universal': чередование E-Universal-Left / E-Universal-Right
 *  - Bindings: studentportrait + name + quote + friend_photos
 *  - master_not_found когда мастер отсутствует
 *  - Grid режимы (Medium/Light/Mini) с base + combined + null-padding
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

const E_STANDARD_LEFT = makeMaster('E-Standard-Left', [
  photoSlot('studentportrait'),
  textSlot('studentname'),
  textSlot('studentquote'),
]);

const E_STANDARD_RIGHT = makeMaster('E-Standard-Right', [
  photoSlot('studentportrait'),
  textSlot('studentname'),
  textSlot('studentquote'),
]);

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
  E_STANDARD_LEFT,
  E_STANDARD_RIGHT,
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
    // РЭ.40: эти тесты были написаны до student_distribution и проверяют
    // ЖАДНОЕ распределение (полные сетки + специальный мастер для хвоста).
    // С дефолтом 'auto' раскладка идёт равномерно (без хвостовых L-2/N-6),
    // тесты падают. Явно ставим 'greedy' чтобы проверять что адаптивные
    // мастера выбираются корректно — это валидный сценарий когда партнёр
    // в /app выбрал 'Жадно' для конкретного альбома.
    student_distribution: 'greedy',
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

  it("density='medium' → реализовано в 21.8.4c, без мастеров → master_not_found", () => {
    const bundle = makeBundle({
      preset: makePreset({ id: 'p', density: 'medium' }),
    });
    const result = buildFromSectionStructure(bundle, makeInput({ students: 8 }));
    expect(result.spreads).toEqual([]);
    expect(
      result.warnings.some(
        (w) =>
          w.startsWith('students_master_not_found') && w.includes('M-Grid-Page'),
      ),
    ).toBe(true);
  });

  it("density='light' → реализовано, без мастеров → master_not_found L-Grid-Page", () => {
    const bundle = makeBundle({
      preset: makePreset({ id: 'p', density: 'light' }),
    });
    const result = buildFromSectionStructure(bundle, makeInput({ students: 6 }));
    expect(
      result.warnings.some(
        (w) =>
          w.startsWith('students_master_not_found') && w.includes('L-Grid-Page'),
      ),
    ).toBe(true);
  });

  it("density='mini' → реализовано, без мастеров → master_not_found N-Grid-Page", () => {
    const bundle = makeBundle({
      preset: makePreset({ id: 'p', density: 'mini' }),
    });
    const result = buildFromSectionStructure(bundle, makeInput({ students: 12 }));
    expect(
      result.warnings.some(
        (w) =>
          w.startsWith('students_master_not_found') && w.includes('N-Grid-Page'),
      ),
    ).toBe(true);
  });
});

// ─── 2. density='standard' ──────────────────────────────────────────────────

describe("students: density='standard' (alternating E-Standard-Left/Right)", () => {
  it('4 ученика → 2 разворота, чередование Left/Right, is_spread не выставлен', () => {
    const bundle = makeBundle({
      preset: makePreset({ id: 'p', density: 'standard' }),
    });
    const result = buildFromSectionStructure(bundle, makeInput({ students: 4 }));
    expect(result.status).toBe('ok');
    expect(result.spreads).toHaveLength(2);
    expect(result.spreads[0].is_spread).toBeUndefined();
    expect(result.spreads[0].left?.master_id).toBe('id-E-Standard-Left');
    expect(result.spreads[0].right?.master_id).toBe('id-E-Standard-Right');
    expect(result.spreads[1].left?.master_id).toBe('id-E-Standard-Left');
    expect(result.spreads[1].right?.master_id).toBe('id-E-Standard-Right');
  });

  it('3 ученика → 2 разворота, у 2-го только left', () => {
    const bundle = makeBundle({
      preset: makePreset({ id: 'p', density: 'standard' }),
    });
    const result = buildFromSectionStructure(bundle, makeInput({ students: 3 }));
    expect(result.spreads).toHaveLength(2);
    expect(result.spreads[1].left?.master_id).toBe('id-E-Standard-Left');
    expect(result.spreads[1].right).toBeUndefined();
  });

  it('Bindings Standard: portrait/name/quote через placeholder-driven', () => {
    const bundle = makeBundle({
      preset: makePreset({ id: 'p', density: 'standard' }),
    });
    const input = makeInput({ students: 2 });
    const result = buildFromSectionStructure(bundle, input);
    const left = result.spreads[0].left!.bindings;
    const right = result.spreads[0].right!.bindings;
    expect(left.studentportrait).toBe(input.students[0].portrait);
    expect(left.studentname).toBe(input.students[0].full_name);
    expect(left.studentquote).toBe(input.students[0].quote);
    expect(right.studentportrait).toBe(input.students[1].portrait);
    expect(right.studentname).toBe(input.students[1].full_name);
    expect(right.studentquote).toBe(input.students[1].quote);
  });

  it('E-Standard-Left отсутствует → warning students_master_not_found', () => {
    const bundle = makeBundle({
      preset: makePreset({ id: 'p', density: 'standard' }),
      masters: [E_STANDARD_RIGHT], // только Right
    });
    const result = buildFromSectionStructure(bundle, makeInput({ students: 4 }));
    expect(result.spreads).toEqual([]);
    expect(
      result.warnings.some(
        (w) =>
          w.startsWith('students_master_not_found') &&
          w.includes('E-Standard-Left'),
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
    const jFull = makeMaster('J-Full', [photoSlot('classphotoframe')]);
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        density: 'universal',
        section_structure: [
          { type: 'students' },
          { type: 'common', slots: ['FULL'] },
        ],
      }),
      masters: [...ALL_STUDENT_MASTERS, jFull],
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
    // 3 ученика Universal: pages 0=L, 1=R, 2=L (висящий left).
    // FULL слот: page index 3, position='right'. J-Full симметричный
    // (после РЭ.21.8.6a) — независимо от позиции один и тот же мастер.
    expect(result.spreads).toHaveLength(2);
    expect(result.spreads[1].left?.master_id).toBe('id-E-Universal-Left');
    expect(result.spreads[1].right?.master_id).toBe('id-J-Full');
  });
});

// ─── 5. Grid режимы (Medium / Light / Mini) — РЭ.21.8.4c ──────────────────

// Фикстуры grid-мастеров.
function gridMaster(name: string, slots: number): SpreadTemplate {
  const ph: Placeholder[] = [];
  for (let i = 1; i <= slots; i++) {
    ph.push(photoSlot(`studentportrait_${i}`));
    ph.push(textSlot(`studentname_${i}`));
    ph.push(textSlot(`studentquote_${i}`));
  }
  const m = makeMaster(name, ph);
  m.slot_capacity = { students: slots };
  return m;
}

function combinedMaster(name: string, slots: number): SpreadTemplate {
  const ph: Placeholder[] = [];
  for (let i = 1; i <= slots; i++) {
    ph.push(photoSlot(`studentportrait_${i}`));
    ph.push(textSlot(`studentname_${i}`));
  }
  ph.push(photoSlot('classphotoframe'));
  const m = makeMaster(name, ph);
  m.slot_capacity = { students: slots, photos_full: 1 };
  return m;
}

const M_GRID = gridMaster('M-Grid-Page', 4);
const M_COMBINED = combinedMaster('M-Combined-Page', 2);
const L_GRID = gridMaster('L-Grid-Page', 6);
const L_4 = gridMaster('L-4', 4);
const L_3 = gridMaster('L-3', 3);
const L_2 = gridMaster('L-2', 2);
const L_COMBINED = combinedMaster('L-Combined-Page', 3);
const N_GRID = gridMaster('N-Grid-Page', 12);
const N_9 = gridMaster('N-9', 9);
const N_6 = gridMaster('N-6', 6);
const N_4 = gridMaster('N-4', 4);
const N_COMBINED = combinedMaster('N-Combined-Page', 4);

describe('students: density=medium (M-Grid-Page 4 слота)', () => {
  it('8 учеников → 2 полные страницы M-Grid (1 разворот)', () => {
    const bundle = makeBundle({
      preset: makePreset({ id: 'p', density: 'medium' }),
      masters: [M_GRID, M_COMBINED],
    });
    const result = buildFromSectionStructure(bundle, makeInput({ students: 8 }));
    expect(result.status).toBe('ok');
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-M-Grid-Page');
    expect(result.spreads[0].right?.master_id).toBe('id-M-Grid-Page');
  });

  it('6 учеников + full=1 → 1 полная M-Grid + M-Combined (consume 1 full)', () => {
    const bundle = makeBundle({
      preset: makePreset({ id: 'p', density: 'medium' }),
      masters: [M_GRID, M_COMBINED],
    });
    const input = {
      ...makeInput({ students: 6 }),
      common_photos: {
        full_class: ['https://cdn/full_0.jpg'],
        half_class: [],
        spread: [],
        quarter: [],
        sixth: [],
      },
    };
    const result = buildFromSectionStructure(bundle, input);
    expect(result.status).toBe('ok');
    // 6 учеников = 1 полный M-Grid (4) + 1 M-Combined (2) = 2 страницы = 1 разворот
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-M-Grid-Page');
    expect(result.spreads[0].right?.master_id).toBe('id-M-Combined-Page');
    expect(result.spreads[0].right?.bindings.classphotoframe).toBe(
      'https://cdn/full_0.jpg',
    );
  });

  it('6 учеников БЕЗ full_class → fallback: M-Grid с null-падингом + warning', () => {
    // РЭ.40: распределение greedy → полные страницы по 4 + хвост 2.
    // Все хвосты теперь кладутся в baseMaster с null-padding (адаптивные
    // мастера больше не выбираются buildGrid'ом). Для medium 6=4+2 → 2 страницы M-Grid.
    // РЭ.31.3: пустые слоты получают __hidden__<label>='1' вместо null.
    const bundle = makeBundle({
      preset: makePreset({ id: 'p', density: 'medium' }),
      masters: [M_GRID, M_COMBINED],
    });
    const result = buildFromSectionStructure(bundle, makeInput({ students: 6 }));
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-M-Grid-Page');
    expect(result.spreads[0].right?.master_id).toBe('id-M-Grid-Page'); // не Combined (нет full_class)
    // Хвостовая страница: первые 2 слота заполнены, 3 и 4 скрыты __hidden__.
    expect(result.spreads[0].right?.bindings.__hidden__studentportrait_3).toBe('1');
    // РЭ.40: warning students_grid_tail_padded больше не выдаётся
    // (adaptive masters не выбираются, поведение унифицировано через
    // null-padding в baseMaster — не считается degraded).
  });

  it('M-Grid-Page отсутствует → warning students_master_not_found', () => {
    const bundle = makeBundle({
      preset: makePreset({ id: 'p', density: 'medium' }),
      masters: [],
    });
    const result = buildFromSectionStructure(bundle, makeInput({ students: 4 }));
    expect(result.spreads).toEqual([]);
    expect(
      result.warnings.some(
        (w) =>
          w.startsWith('students_master_not_found') && w.includes('M-Grid-Page'),
      ),
    ).toBe(true);
  });
});

describe('students: density=light (адаптивные сетки L-2/3/4)', () => {
  it('12 учеников → 2 полные L-Grid страницы (1 разворот)', () => {
    const bundle = makeBundle({
      preset: makePreset({ id: 'p', density: 'light' }),
      masters: [L_GRID, L_4, L_3, L_2, L_COMBINED],
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students: 12 }),
    );
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-L-Grid-Page');
    expect(result.spreads[0].right?.master_id).toBe('id-L-Grid-Page');
  });

  it('9 учеников → 1 полная L-Grid + 1 L-Grid с null-падингом (РЭ.40: без adaptive)', () => {
    // РЭ.40: adaptive tail masters (L-2/3/4) больше не выбираются buildGrid'ом.
    // greedy для 9 учеников при maxGrid=6 → 6 + 3. Обе страницы в L-Grid-Page,
    // хвостовая с __hidden__ на слотах 4-6.
    const bundle = makeBundle({
      preset: makePreset({ id: 'p', density: 'light' }),
      masters: [L_GRID, L_4, L_3, L_2, L_COMBINED],
    });
    const result = buildFromSectionStructure(bundle, makeInput({ students: 9 }));
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-L-Grid-Page');
    expect(result.spreads[0].right?.master_id).toBe('id-L-Grid-Page');
    // Слоты 4-6 на хвосте скрыты через __hidden__.
    expect(result.spreads[0].right?.bindings.__hidden__studentportrait_4).toBe('1');
  });

  it('8 учеников → 1 полная L-Grid + 1 L-Grid с null-падингом (РЭ.40)', () => {
    // РЭ.40: greedy 8 = 6 + 2, обе страницы L-Grid-Page с __hidden__
    // на хвостовой (3-6 слоты скрыты).
    const bundle = makeBundle({
      preset: makePreset({ id: 'p', density: 'light' }),
      masters: [L_GRID, L_4, L_3, L_2, L_COMBINED],
    });
    const result = buildFromSectionStructure(bundle, makeInput({ students: 8 }));
    expect(result.spreads[0].right?.master_id).toBe('id-L-Grid-Page');
    expect(result.spreads[0].right?.bindings.__hidden__studentportrait_3).toBe('1');
  });

  it('9 учеников + full=1 → Combined приоритет над адаптивным', () => {
    const bundle = makeBundle({
      preset: makePreset({ id: 'p', density: 'light' }),
      masters: [L_GRID, L_3, L_COMBINED],
    });
    const input = {
      ...makeInput({ students: 9 }),
      common_photos: {
        full_class: ['https://cdn/full_0.jpg'],
        half_class: [],
        spread: [],
        quarter: [],
        sixth: [],
      },
    };
    const result = buildFromSectionStructure(bundle, input);
    expect(result.spreads[0].right?.master_id).toBe('id-L-Combined-Page');
    expect(result.spreads[0].right?.bindings.classphotoframe).toBe(
      'https://cdn/full_0.jpg',
    );
  });

  it('8 учеников без адаптивных L-2/3/4 → fallback на L-Grid с null-падингом', () => {
    const bundle = makeBundle({
      preset: makePreset({ id: 'p', density: 'light' }),
      masters: [L_GRID], // только базовый
    });
    const result = buildFromSectionStructure(bundle, makeInput({ students: 8 }));
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].right?.master_id).toBe('id-L-Grid-Page');
    // РЭ.31.3: __hidden__ вместо null.
    expect(result.spreads[0].right?.bindings.__hidden__studentportrait_3).toBe('1');
    // РЭ.40: warning students_grid_tail_padded больше не выдаётся.
  });
});

describe('students: density=mini (N-Grid 12 + адаптивные N-4/6/9)', () => {
  it('24 ученика → 2 полные N-Grid страницы', () => {
    const bundle = makeBundle({
      preset: makePreset({ id: 'p', density: 'mini' }),
      masters: [N_GRID, N_9, N_6, N_4, N_COMBINED],
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students: 24 }),
    );
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-N-Grid-Page');
    expect(result.spreads[0].right?.master_id).toBe('id-N-Grid-Page');
  });

  it('17 учеников → 1 N-Grid (12) + 1 N-Grid с null-падингом (РЭ.40: без adaptive)', () => {
    // РЭ.40: greedy 17 = 12 + 5, обе страницы N-Grid-Page с __hidden__
    // на хвостовой (6-12 слоты скрыты).
    const bundle = makeBundle({
      preset: makePreset({ id: 'p', density: 'mini' }),
      masters: [N_GRID, N_9, N_6, N_4, N_COMBINED],
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students: 17 }),
    );
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-N-Grid-Page');
    expect(result.spreads[0].right?.master_id).toBe('id-N-Grid-Page');
    // Слоты 6-12 на хвосте скрыты.
    expect(result.spreads[0].right?.bindings.__hidden__studentportrait_6).toBe('1');
  });

  it('Bindings grid: studentportrait_N + studentname_N + studentquote_N', () => {
    // РЭ.40: adaptive masters не выбираются — 4 ученика идут в N-Grid-Page
    // (12 слотов) с __hidden__ для 5-12. Слоты 1-4 заполнены.
    const bundle = makeBundle({
      preset: makePreset({ id: 'p', density: 'mini' }),
      masters: [N_GRID, N_4, N_6, N_9, N_COMBINED],
    });
    const input = makeInput({ students: 4 });
    const result = buildFromSectionStructure(bundle, input);
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-N-Grid-Page');
    const b = result.spreads[0].left!.bindings;
    expect(b.studentportrait_1).toBe(input.students[0].portrait);
    expect(b.studentname_1).toBe(input.students[0].full_name);
    expect(b.studentquote_1).toBe(input.students[0].quote);
    expect(b.studentportrait_4).toBe(input.students[3].portrait);
    // Слоты 5-12 скрыты.
    expect(b.__hidden__studentportrait_5).toBe('1');
  });
});

describe('students grid: интеграция с teachers (общее фото не дублируется)', () => {
  it('teachers G-FullClass + students medium-combined → full_class[0] и [1]', () => {
    // Создаём F-Head-WithPhoto и G-FullClass из стандартного набора teachers.
    // Не подключаем G-HalfClass — будет fallback на G-FullClass.
    const fHeadWithPhoto = makeMaster('F-Head-WithPhoto', [
      photoSlot('headteacherphoto'),
      textSlot('headteachername'),
    ]);
    const gFullClass = makeMaster('G-FullClass', [photoSlot('classphotoframe')]);
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        density: 'medium',
        section_structure: [{ type: 'teachers' }, { type: 'students' }],
      }),
      masters: [fHeadWithPhoto, gFullClass, M_GRID, M_COMBINED],
    });
    const input = {
      ...makeInput({ students: 6 }),
      common_photos: {
        full_class: ['https://cdn/full_0.jpg', 'https://cdn/full_1.jpg'],
        half_class: [],
        spread: [],
        quarter: [],
        sixth: [],
      },
    };
    const result = buildFromSectionStructure(bundle, input);
    // teachers взял full_class[0] на G-FullClass
    expect(result.spreads[0].right?.master_id).toBe('id-G-FullClass');
    expect(result.spreads[0].right?.bindings.classphotoframe).toBe(
      'https://cdn/full_0.jpg',
    );
    // students medium: M-Grid (4) + M-Combined (2) — combined должен взять full_class[1]
    expect(result.spreads[1].right?.master_id).toBe('id-M-Combined-Page');
    expect(result.spreads[1].right?.bindings.classphotoframe).toBe(
      'https://cdn/full_1.jpg',
    );
  });
});
