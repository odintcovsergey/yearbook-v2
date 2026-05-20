/**
 * Тесты для buildSpreadSemantic (РЭ.22.5): семантический поиск мастера
 * ученика для двух-осевой модели mode='spread' (1 ученик = 1 разворот).
 *
 * FIXED модель: photos_friend берётся из preset.student_friend_photos и
 * одинаков для всех учеников. Отличается от per-student адаптивной модели
 * `buildOnePerSpreadAdaptive` (РЭ.21.8.15), которая для Individual выбирает
 * мастер под количество фото КАЖДОГО ученика отдельно — эта старая логика
 * активна через legacy путь (mode=NULL + preset.id='individual').
 *
 * Покрывают:
 *  - Custom-пресет с mode='spread' → каждый ученик получает 2 страницы
 *  - Параметры photos_friend и has_quote → влияют на выбор мастера
 *  - Точное совпадение photos_friend на правой → exact_match
 *  - Ближайший меньший по photos_friend → warning students_lost_photos
 *  - Не найден left или right → warning, ученик пропускается
 *  - mode=NULL → fallback на legacy (включая buildOnePerSpreadAdaptive
 *    для preset.id='individual')
 *  - Decision trace содержит mode='spread'
 */

import { describe, it, expect } from 'vitest';
import { buildFromSectionStructure } from '../build-from-section-structure';
import type { Preset, RulesAlbumInput } from '../types';
import type { RuleEngineBundle } from '../loaders';
import type {
  Placeholder,
  SlotCapacity,
  PageRole,
  SpreadTemplate,
  TemplateSet,
} from '@/lib/album-builder/types';

// ─── Фикстуры ────────────────────────────────────────────────────────────────

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
  page_role: PageRole | null,
  slot_capacity: SlotCapacity | null,
): SpreadTemplate {
  return {
    id: `id-${name}`,
    name,
    type: 'student',
    is_spread: false,
    width_mm: 200,
    height_mm: 280,
    placeholders,
    rules: null,
    sort_order: 0,
    applies_to_configs: [],
    default_for_configs: [],
    page_role,
    slot_capacity,
    is_fallback: false,
    mirror_for_soft: false,
    audit_notes: null,
  };
}

// Maximum-стиль мастера: 1 ученик = разворот, 4 фото с друзьями справа.
const E_MAX_LEFT = makeMaster(
  'E-Max-Left',
  [photoSlot('studentportrait'), textSlot('studentname')],
  'student_left',
  { students: 1, photos_friend: 0, has_quote: false, has_portrait: true, has_name: true },
);

const E_MAX_RIGHT = makeMaster(
  'E-Max-Right',
  [
    textSlot('studentquote'),
    photoSlot('studentphoto_1'),
    photoSlot('studentphoto_2'),
    photoSlot('studentphoto_3'),
    photoSlot('studentphoto_4'),
  ],
  'student_right',
  { students: 1, photos_friend: 4, has_quote: true, has_portrait: false, has_name: false },
);

// Без quote: для теста has_quote=false.
const E_NO_QUOTE_RIGHT = makeMaster(
  'E-NoQuote-Right',
  [
    photoSlot('studentphoto_1'),
    photoSlot('studentphoto_2'),
    photoSlot('studentphoto_3'),
    photoSlot('studentphoto_4'),
  ],
  'student_right',
  { students: 1, photos_friend: 4, has_quote: false, has_portrait: false, has_name: false },
);

// Меньше friend_photos: для теста ближайшего меньшего.
const E_2FRIENDS_RIGHT = makeMaster(
  'E-2Friends-Right',
  [
    textSlot('studentquote'),
    photoSlot('studentphoto_1'),
    photoSlot('studentphoto_2'),
  ],
  'student_right',
  { students: 1, photos_friend: 2, has_quote: true, has_portrait: false, has_name: false },
);

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
  };
}

function makeBundle(opts: {
  preset: Preset;
  masters: SpreadTemplate[];
}): RuleEngineBundle {
  const mastersByName = new Map<string, SpreadTemplate>();
  for (const m of opts.masters) mastersByName.set(m.name, m);
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
    spreads: opts.masters,
  };
  return {
    preset: opts.preset,
    rules: [],
    families: [],
    templateSet,
    mastersByName,
  };
}

function makeInput(opts: {
  students_count: number;
  friend_photos_per_student?: number;
}): RulesAlbumInput {
  const friendsPerStudent = opts.friend_photos_per_student ?? 0;
  return {
    students: Array.from({ length: opts.students_count }, (_, i) => ({
      full_name: `Student ${i}`,
      quote: `Quote ${i}`,
      portrait: `https://cdn/p${i}.jpg`,
      friend_photos: Array.from(
        { length: friendsPerStudent },
        (_, j) => `https://cdn/p${i}_friend${j}.jpg`,
      ),
    })),
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

// ─── Тесты ──────────────────────────────────────────────────────────────────

describe("mode='spread' семантический поиск (РЭ.22.5)", () => {
  it('Custom-пресет с mode=spread, 4 photos_friend → каждый ученик 2 страницы', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'custom-test',
        student_layout_mode: 'spread',
        student_friend_photos: 4,
        student_has_quote: true,
        section_structure: [{ type: 'students' }],
      }),
      masters: [E_MAX_LEFT, E_MAX_RIGHT],
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 3, friend_photos_per_student: 4 }),
    );

    // 3 ученика × 2 страницы = 6 страниц → 3 разворота.
    expect(result.spreads).toHaveLength(3);
    for (const s of result.spreads) {
      expect(s.left?.master_id).toBe('id-E-Max-Left');
      expect(s.right?.master_id).toBe('id-E-Max-Right');
    }

    // Bindings: первая левая — портрет первого ученика, первая правая — его друзья.
    expect(result.spreads[0].left?.bindings.studentportrait).toBe(
      'https://cdn/p0.jpg',
    );
    expect(result.spreads[0].right?.bindings.studentphoto_1).toBe(
      'https://cdn/p0_friend0.jpg',
    );
    expect(result.spreads[0].right?.bindings.studentphoto_4).toBe(
      'https://cdn/p0_friend3.jpg',
    );
  });

  it('has_quote=false → engine выбирает мастер без quote-слота', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'custom-test',
        student_layout_mode: 'spread',
        student_friend_photos: 4,
        student_has_quote: false,
        section_structure: [{ type: 'students' }],
      }),
      masters: [E_MAX_LEFT, E_MAX_RIGHT, E_NO_QUOTE_RIGHT],
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 1, friend_photos_per_student: 4 }),
    );

    // Правая — E-NoQuote-Right (без quote), левая всё та же E-Max-Left.
    expect(result.spreads[0].left?.master_id).toBe('id-E-Max-Left');
    expect(result.spreads[0].right?.master_id).toBe('id-E-NoQuote-Right');
  });

  it('photos_friend=4, в template_set только 2-friends → warning lost_photos', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'custom-test',
        student_layout_mode: 'spread',
        student_friend_photos: 4,
        student_has_quote: true,
        section_structure: [{ type: 'students' }],
      }),
      // Только 2-friends правый мастер.
      masters: [E_MAX_LEFT, E_2FRIENDS_RIGHT],
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 1, friend_photos_per_student: 4 }),
    );

    expect(result.spreads[0].right?.master_id).toBe('id-E-2Friends-Right');
    const lostWarn = result.warnings.find((w) =>
      w.includes('students_lost_photos'),
    );
    expect(lostWarn).toBeDefined();
    expect(lostWarn).toContain('Student 0');
    expect(lostWarn).toContain('2 фото не размещены');
  });

  it('Правый мастер не найден → warning, ученик пропущен', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'custom-test',
        student_layout_mode: 'spread',
        student_friend_photos: 4,
        student_has_quote: true,
        section_structure: [{ type: 'students' }],
      }),
      // Только левый мастер, нет student_right.
      masters: [E_MAX_LEFT],
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 2, friend_photos_per_student: 4 }),
    );

    // Ничего не построили.
    expect(result.spreads).toHaveLength(0);
    const notFoundWarns = result.warnings.filter((w) =>
      w.includes('students_master_not_found'),
    );
    expect(notFoundWarns.length).toBe(2); // один warning на каждого ученика
    expect(notFoundWarns[0]).toContain('mode=spread');
    expect(notFoundWarns[0]).toContain('student_right');
    expect(notFoundWarns[0]).toContain('photos_friend=4');
  });

  it("mode=NULL + preset.id='maximum' → fallback на legacy buildOnePerSpread", () => {
    // Legacy путь: ищет по жёстким именам E-Max-Left/Right без тегов.
    const legacyLeft = makeMaster(
      'E-Max-Left',
      [photoSlot('studentportrait'), textSlot('studentname')],
      null, // нет page_role
      null, // нет slot_capacity
    );
    const legacyRight = makeMaster(
      'E-Max-Right',
      [photoSlot('studentphoto_1'), photoSlot('studentphoto_2')],
      null,
      null,
    );

    const bundle = makeBundle({
      preset: makePreset({
        id: 'maximum',
        density: null,
        student_layout_mode: null, // <-- ключевое: legacy путь
        section_structure: [{ type: 'students' }],
      }),
      masters: [legacyLeft, legacyRight],
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 2 }),
    );

    // Engine нашёл по жёстким именам, mode не активен.
    expect(result.spreads).toHaveLength(2);
    expect(result.spreads[0].left?.master_id).toBe('id-E-Max-Left');
    expect(result.spreads[0].right?.master_id).toBe('id-E-Max-Right');
  });

  it("Decision trace содержит mode='spread' и параметры поиска", () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'custom-test',
        student_layout_mode: 'spread',
        student_friend_photos: 4,
        student_has_quote: true,
        section_structure: [{ type: 'students' }],
      }),
      masters: [E_MAX_LEFT, E_MAX_RIGHT],
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 1, friend_photos_per_student: 4 }),
    );

    const trace = result.decision_trace.find((t) =>
      t.rule_id?.startsWith('spread_semantic:'),
    );
    expect(trace).toBeDefined();
    expect(trace?.inputs.mode).toBe('spread');
    expect(trace?.inputs.photos_friend_required).toBe(4);
    expect(trace?.inputs.has_quote_required).toBe(true);
    expect(trace?.inputs.left_master).toBe('E-Max-Left');
    expect(trace?.inputs.right_master).toBe('E-Max-Right');
    expect(trace?.inputs.right_exact_match).toBe(true);
    expect(trace?.inputs.right_lost_photos).toBe(0);
  });

  it('5 учеников с разным количеством фактических фото — FIXED layout, все одинаковые', () => {
    // Демонстрирует FIXED модель: все ученики получают один и тот же мастер
    // E-Max-Right на 4 фото, независимо от их student.friend_photos.length.
    // У student[0] 4 фото — заполнят все 4 слота. У student[1] 2 фото —
    // 2 слота пустые. У student[2] 6 фото — 2 не помещаются (но без warning
    // на уровне engine, потому что engine не знает сколько фото у ученика
    // в этой модели — он работает с фиксированным числом слотов).
    const bundle = makeBundle({
      preset: makePreset({
        id: 'custom-test',
        student_layout_mode: 'spread',
        student_friend_photos: 4,
        student_has_quote: true,
        section_structure: [{ type: 'students' }],
      }),
      masters: [E_MAX_LEFT, E_MAX_RIGHT],
    });
    const input: RulesAlbumInput = {
      students: [
        {
          full_name: 'S0_4photos',
          quote: 'Q0',
          portrait: 'https://cdn/p0.jpg',
          friend_photos: ['f0_1', 'f0_2', 'f0_3', 'f0_4'],
        },
        {
          full_name: 'S1_2photos',
          quote: 'Q1',
          portrait: 'https://cdn/p1.jpg',
          friend_photos: ['f1_1', 'f1_2'],
        },
        {
          full_name: 'S2_6photos',
          quote: 'Q2',
          portrait: 'https://cdn/p2.jpg',
          friend_photos: ['f2_1', 'f2_2', 'f2_3', 'f2_4', 'f2_5', 'f2_6'],
        },
      ],
      subjects: [],
      head_teacher: { photo: null, name: '', role: '', text: '' },
      common_photos: { full_class: [], half_class: [], spread: [], quarter: [], sixth: [] },
    };
    const result = buildFromSectionStructure(bundle, input);

    expect(result.spreads).toHaveLength(3);

    // Все три ученика получили один и тот же right-мастер (FIXED).
    for (const s of result.spreads) {
      expect(s.right?.master_id).toBe('id-E-Max-Right');
    }

    // S0: все 4 слота заполнены.
    expect(result.spreads[0].right?.bindings.studentphoto_1).toBe('f0_1');
    expect(result.spreads[0].right?.bindings.studentphoto_4).toBe('f0_4');

    // S1: 2 слота заполнены, 2 — null (друзей не хватает).
    expect(result.spreads[1].right?.bindings.studentphoto_1).toBe('f1_1');
    expect(result.spreads[1].right?.bindings.studentphoto_2).toBe('f1_2');
    expect(result.spreads[1].right?.bindings.studentphoto_3).toBe(null);
    expect(result.spreads[1].right?.bindings.studentphoto_4).toBe(null);

    // S2: 4 слота заполнены первыми фото, 5-е и 6-е НЕ помещаются (мастер 4-слотный).
    expect(result.spreads[2].right?.bindings.studentphoto_1).toBe('f2_1');
    expect(result.spreads[2].right?.bindings.studentphoto_4).toBe('f2_4');
  });
});
