/**
 * Тесты для fillTeachersSection (РЭ.21.8.4a).
 *
 * Покрывают:
 *  - Таблицу выбора F-Head-* по subjects_count (0 / 1-4 / 5-8 / 9 / 10-12 / 13-16 / 17+)
 *  - Цепочку G-* для subjects ≤ 8: half_class приоритет → full_class → пусто
 *  - G-Teachers-3x3 / 4x3 / 4x4 для subjects 9..16
 *  - 17+: F-LargeGrid (8 subjects) + G-Teachers-4x4 (subjectsOffset=8)
 *  - Bindings: headteacherphoto/name/role/text, subject_N, teacherphoto_N,
 *    halfphoto_1/2, classphotoframe
 *  - teachers_right_empty когда subjects ≤ 8 и нет общих фото
 *  - teachers_master_not_found когда F-* или G-* отсутствует
 *  - Вычитание consumes (half/full) из ctx.available
 */

import { describe, it, expect } from 'vitest';
import { buildFromSectionStructure } from '../build-from-section-structure';
import type { Preset, Rule, RulesAlbumInput, TemplateFamily } from '../types';
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
    slot_capacity: null,
    is_fallback: false,
    mirror_for_soft: false,
    audit_notes: null,
  };
}

// Все возможные F-/G- мастера с типовыми placeholders.
const F_WITH_PHOTO = makeMaster('F-Head-WithPhoto', [
  photoSlot('headteacherphoto'),
  textSlot('headteachername'),
  textSlot('headteacherrole'),
  textSlot('headteachertext'),
]);
function fHeadGrid(name: string, n: number): SpreadTemplate {
  const ph: Placeholder[] = [
    photoSlot('headteacherphoto'),
    textSlot('headteachername'),
    textSlot('headteachertext'),
  ];
  for (let i = 1; i <= n; i++) {
    ph.push(photoSlot(`subjectphoto_${i}`));
    ph.push(textSlot(`subjectname_${i}`));
  }
  return makeMaster(name, ph);
}
const F_SMALL_GRID = fHeadGrid('F-Head-SmallGrid', 4);
const F_LARGE_GRID = fHeadGrid('F-Head-LargeGrid', 8);

const G_HALF_CLASS = makeMaster('G-HalfClass', [
  photoSlot('halfphoto_1'),
  photoSlot('halfphoto_2'),
]);
const G_FULL_CLASS = makeMaster('G-FullClass', [photoSlot('classphotoframe')]);
function gTeachers(name: string, n: number): SpreadTemplate {
  const ph: Placeholder[] = [];
  for (let i = 1; i <= n; i++) {
    ph.push(photoSlot(`teacherphoto_${i}`));
    ph.push(textSlot(`teachername_${i}`));
  }
  return makeMaster(name, ph);
}
const G_3X3 = gTeachers('G-Teachers-3x3', 9);
const G_4X3 = gTeachers('G-Teachers-3x4', 12);
const G_4X4 = gTeachers('G-Teachers-4x4', 16);

// J-Half нужен для проверки взаимодействия teachers + common(H) — fillCommonSection
// его резолвит через mastersByName. Без него тест на "вычитание consumes"
// падает с master_not_found, а это не то, что мы проверяем.
const J_HALF = makeMaster('J-Half', [photoSlot('halfphoto_1'), photoSlot('halfphoto_2')]);

const ALL_TEACHERS_MASTERS: SpreadTemplate[] = [
  F_WITH_PHOTO,
  F_SMALL_GRID,
  F_LARGE_GRID,
  G_HALF_CLASS,
  G_FULL_CLASS,
  G_3X3,
  G_4X3,
  G_4X4,
  J_HALF,
];

// ─── makeBundle / makeInput / makePreset ────────────────────────────────────

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
  };
}

function makeBundle(opts: {
  preset: Preset;
  masters?: SpreadTemplate[];
}): RuleEngineBundle {
  const masters = opts.masters ?? ALL_TEACHERS_MASTERS;
  const mastersByName = new Map<string, SpreadTemplate>();
  for (const m of masters) mastersByName.set(m.name, m);
  const templateSet: TemplateSet = {
    id: 'ts-test',
    tenant_id: null,
    name: 'test',
    slug: 'test-slug',
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
  subjects?: number;
  half_class?: number;
  full_class?: number;
  head_teacher?: { photo?: string | null; name?: string; role?: string; text?: string };
}): RulesAlbumInput {
  const subjectsList = [];
  for (let i = 1; i <= (opts.subjects ?? 0); i++) {
    subjectsList.push({
      photo: `https://cdn/subj_${i}.jpg`,
      name: `Учитель ${i}`,
      role: `Предмет ${i}`,
    });
  }
  function urls(n: number, label: string): string[] {
    const out: string[] = [];
    for (let i = 0; i < n; i++) out.push(`https://cdn/${label}_${i}.jpg`);
    return out;
  }
  return {
    students: [],
    subjects: subjectsList,
    head_teacher: {
      photo: opts.head_teacher?.photo ?? 'https://cdn/headphoto.jpg',
      name: opts.head_teacher?.name ?? 'Иванова И.И.',
      role: opts.head_teacher?.role ?? 'Классный руководитель',
      text: opts.head_teacher?.text ?? 'Доброго пути!',
    },
    common_photos: {
      full_class: urls(opts.full_class ?? 0, 'full'),
      half_class: urls(opts.half_class ?? 0, 'half'),
      spread: [],
      quarter: [],
      sixth: [],
      collage: [],
    },
  };
}

function buildOnlyTeachers(
  subjectsCount: number,
  commonOpts: { half_class?: number; full_class?: number } = {},
) {
  const bundle = makeBundle({
    preset: makePreset({
      id: 'p',
      section_structure: [{ type: 'teachers' }],
    }),
  });
  const input = makeInput({ subjects: subjectsCount, ...commonOpts });
  return { result: buildFromSectionStructure(bundle, input), bundle, input };
}

// ─── 1. Выбор F-Head-* по subjects_count ────────────────────────────────────

describe('teachers: выбор F-Head-* по subjects_count', () => {
  it('0 subjects → F-Head-WithPhoto', () => {
    const { result } = buildOnlyTeachers(0, { full_class: 1 });
    expect(result.spreads[0].left?.master_id).toBe('id-F-Head-WithPhoto');
  });

  it('3 subjects → F-Head-SmallGrid (subjectsOnLeft=3)', () => {
    const { result } = buildOnlyTeachers(3, { half_class: 2 });
    expect(result.spreads[0].left?.master_id).toBe('id-F-Head-SmallGrid');
    const trace = result.decision_trace.find(
      (t) => t.rule_id === 'teachers_left:F-Head-SmallGrid',
    );
    expect(trace?.inputs.subjects_on_left).toBe(3);
  });

  it('5 subjects → F-Head-LargeGrid', () => {
    const { result } = buildOnlyTeachers(5, { full_class: 1 });
    expect(result.spreads[0].left?.master_id).toBe('id-F-Head-LargeGrid');
  });

  it('9 subjects → F-Head-WithPhoto + G-Teachers-3x3', () => {
    const { result } = buildOnlyTeachers(9);
    expect(result.spreads[0].left?.master_id).toBe('id-F-Head-WithPhoto');
    expect(result.spreads[0].right?.master_id).toBe('id-G-Teachers-3x3');
  });

  it('12 subjects → F-WithPhoto + G-Teachers-3x4 (РЭ.22.7.2: ранее искалось 4x3 — баг)', () => {
    const { result } = buildOnlyTeachers(12);
    expect(result.spreads[0].right?.master_id).toBe('id-G-Teachers-3x4');
  });

  it('15 subjects → F-WithPhoto + G-Teachers-4x4', () => {
    const { result } = buildOnlyTeachers(15);
    expect(result.spreads[0].right?.master_id).toBe('id-G-Teachers-4x4');
  });

  it('18 subjects → F-LargeGrid (8 на левой) + G-4x4 (offset=8)', () => {
    const { result } = buildOnlyTeachers(18);
    expect(result.spreads[0].left?.master_id).toBe('id-F-Head-LargeGrid');
    expect(result.spreads[0].right?.master_id).toBe('id-G-Teachers-4x4');
    const trace = result.decision_trace.find(
      (t) => t.rule_id === 'teachers_right:G-Teachers-4x4',
    );
    expect(trace?.inputs.subjects_offset).toBe(8);
    expect(trace?.inputs.subjects_on_right).toBe(10); // 18 - 8
  });
});

// ─── 2. Правая страница для subjects ≤ 8: цепочка half/full/пусто ────────────

describe('teachers: правая страница для subjects ≤ 8', () => {
  it('2 subjects + half=2 → G-HalfClass (приоритет)', () => {
    const { result } = buildOnlyTeachers(2, { half_class: 2, full_class: 1 });
    expect(result.spreads[0].right?.master_id).toBe('id-G-HalfClass');
  });

  it('2 subjects + только full=1 → G-FullClass', () => {
    const { result } = buildOnlyTeachers(2, { full_class: 1 });
    expect(result.spreads[0].right?.master_id).toBe('id-G-FullClass');
  });

  it('2 subjects + нет общих → одиночная страница F, warning teachers_right_empty', () => {
    const { result } = buildOnlyTeachers(2);
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-F-Head-SmallGrid');
    expect(result.spreads[0].right).toBeUndefined();
    expect(result.warnings).toContain(
      'teachers_right_empty: нет общих фото для правой страницы (subjects=2)',
    );
  });

  it('half=1 (недостаточно для G-HalfClass) → fallback на G-FullClass если есть full', () => {
    const { result } = buildOnlyTeachers(0, { half_class: 1, full_class: 1 });
    expect(result.spreads[0].right?.master_id).toBe('id-G-FullClass');
  });
});

// ─── 3. Bindings ────────────────────────────────────────────────────────────

describe('teachers: bindings', () => {
  it('F-Head-WithPhoto: headteacherphoto/name/role/text', () => {
    const { result, input } = buildOnlyTeachers(0, { full_class: 1 });
    const left = result.spreads[0].left!;
    expect(left.bindings.headteacherphoto).toBe(input.head_teacher.photo);
    expect(left.bindings.headteachername).toBe(input.head_teacher.name);
    expect(left.bindings.headteacherrole).toBe(input.head_teacher.role);
    expect(left.bindings.headteachertext).toBe(input.head_teacher.text);
  });

  it('F-Head-SmallGrid: subjectphoto_N + subjectname_N для каждого subject', () => {
    const { result, input } = buildOnlyTeachers(3, { half_class: 2 });
    const left = result.spreads[0].left!;
    expect(left.bindings.subjectphoto_1).toBe(input.subjects[0].photo);
    expect(left.bindings.subjectphoto_2).toBe(input.subjects[1].photo);
    expect(left.bindings.subjectphoto_3).toBe(input.subjects[2].photo);
    expect(left.bindings.subjectname_1).toBe(input.subjects[0].name);
    // 4-й слот мастера остаётся пустым (subjects=3)
    expect(left.bindings.subjectphoto_4).toBeUndefined();
  });

  it('G-HalfClass: halfphoto_1, halfphoto_2 = первые 2 фото half_class', () => {
    const { result, input } = buildOnlyTeachers(0, { half_class: 2 });
    const right = result.spreads[0].right!;
    expect(right.bindings.halfphoto_1).toBe(input.common_photos.half_class[0]);
    expect(right.bindings.halfphoto_2).toBe(input.common_photos.half_class[1]);
  });

  it('G-FullClass: classphotoframe = первое фото full_class', () => {
    const { result, input } = buildOnlyTeachers(0, { full_class: 1 });
    const right = result.spreads[0].right!;
    expect(right.bindings.classphotoframe).toBe(
      input.common_photos.full_class[0],
    );
  });

  it('G-Teachers-3x3: teacherphoto_N = subjects[N-1].photo (9 слотов)', () => {
    const { result, input } = buildOnlyTeachers(9);
    const right = result.spreads[0].right!;
    expect(right.bindings.teacherphoto_1).toBe(input.subjects[0].photo);
    expect(right.bindings.teacherphoto_9).toBe(input.subjects[8].photo);
    expect(right.bindings.teachername_5).toBe(input.subjects[4].name);
  });

  it('18 subjects: G-Teachers-4x4 → photos subjects[8..17] (offset)', () => {
    const { result, input } = buildOnlyTeachers(18);
    const right = result.spreads[0].right!;
    // teacherphoto_1 = subjects[8 + 1 - 1] = subjects[8]
    expect(right.bindings.teacherphoto_1).toBe(input.subjects[8].photo);
    // teacherphoto_10 = subjects[8 + 10 - 1] = subjects[17]
    expect(right.bindings.teacherphoto_10).toBe(input.subjects[17].photo);
    // teacherphoto_11..16 — пусто (subjects кончились)
    expect(right.bindings.teacherphoto_11).toBeUndefined();
  });
});

// ─── 4. Вычитание consumes ──────────────────────────────────────────────────

describe('teachers: вычитание consumes из available', () => {
  it('G-HalfClass потребил 2 half — common(H) после него с half=2 → slot_skipped', () => {
    // teachers съест 2 half на G-HalfClass; common(H) требует 2 half — не хватит.
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [
          { type: 'teachers' },
          { type: 'common', slots: ['H'] },
        ],
      }),
    });
    const input = makeInput({ subjects: 0, half_class: 2 });
    const result = buildFromSectionStructure(bundle, input);
    // teachers занял разворот (2 страницы: F-WithPhoto + G-HalfClass)
    expect(result.spreads[0].left?.master_id).toBe('id-F-Head-WithPhoto');
    expect(result.spreads[0].right?.master_id).toBe('id-G-HalfClass');
    // common(H) не сработал — half_class кончился
    expect(
      result.warnings.some((w) => w.includes('slot_skipped') && w.includes('(H)')),
    ).toBe(true);
  });

  it('G-HalfClass + common(H) при half=4 → оба сработают (по 2)', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [
          { type: 'teachers' },
          { type: 'common', slots: ['H'] },
        ],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ subjects: 0, half_class: 4 }),
    );
    expect(result.spreads).toHaveLength(2);
    expect(result.spreads[0].right?.master_id).toBe('id-G-HalfClass');
    expect(result.spreads[1].left?.master_id).toBe('id-J-Half');
  });
});

// ─── 5. master_not_found ────────────────────────────────────────────────────

describe('teachers: master_not_found', () => {
  it('F-Head-WithPhoto отсутствует → warning teachers_master_not_found', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [{ type: 'teachers' }],
      }),
      masters: [G_HALF_CLASS, G_FULL_CLASS], // только G-*, без F-*
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ subjects: 0, half_class: 2 }),
    );
    expect(result.spreads).toEqual([]);
    expect(
      result.warnings.some(
        (w) =>
          w.startsWith('teachers_master_not_found') && w.includes('F-Head-WithPhoto'),
      ),
    ).toBe(true);
  });

  it('G-HalfClass отсутствует → F всё равно на странице, warning по G', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [{ type: 'teachers' }],
      }),
      masters: [F_WITH_PHOTO], // только F-Head-WithPhoto, без G-*
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ subjects: 0, half_class: 2 }),
    );
    // F попал на страницу
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-F-Head-WithPhoto');
    expect(result.spreads[0].right).toBeUndefined();
    // Warning по G
    expect(
      result.warnings.some(
        (w) =>
          w.startsWith('teachers_master_not_found') && w.includes('G-HalfClass'),
      ),
    ).toBe(true);
  });
});
