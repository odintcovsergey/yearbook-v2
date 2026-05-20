/**
 * Тесты для buildPageSemantic (РЭ.22.4): семантический поиск мастера
 * ученика для двух-осевой модели mode='page'.
 *
 * Покрывают:
 *  - 3 ученика → 3 страницы, alternating L/R по чётности pageInstances.length
 *  - Параметры по preset.student_friend_photos / student_has_quote
 *    учитываются при поиске мастера через findStudentMaster
 *  - Точное совпадение photos_friend → exact_match, lost=0
 *  - Ближайший меньший по photos_friend → warning students_lost_photos
 *  - Мастер не найден → warning students_master_not_found, ученик
 *    пропускается, остальные строятся
 *  - mode=NULL → fallback на legacy buildAlternatingLR (НЕ buildPageSemantic)
 *  - position alternation сохраняется через чётность pageInstances.length,
 *    не через индекс ученика (важно когда перед students нечётное кол-во
 *    страниц от предыдущих секций)
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

// Standard мастера (legacy жёстко прошитые имена + page_role + slot_capacity).
// has_quote=true, photos_friend=0 — типичный Standard.
const E_STANDARD_LEFT = makeMaster(
  'E-Standard-Left',
  [photoSlot('studentportrait'), textSlot('studentname'), textSlot('studentquote')],
  'student_left',
  { students: 1, photos_friend: 0, has_quote: true, has_portrait: true, has_name: true },
);

const E_STANDARD_RIGHT = makeMaster(
  'E-Standard-Right',
  [photoSlot('studentportrait'), textSlot('studentname'), textSlot('studentquote')],
  'student_right',
  { students: 1, photos_friend: 0, has_quote: true, has_portrait: true, has_name: true },
);

// Universal мастера: photos_friend=4, has_quote=true.
const E_UNIVERSAL_LEFT = makeMaster(
  'E-Universal-Left',
  [
    photoSlot('studentportrait'),
    textSlot('studentname'),
    textSlot('studentquote'),
    photoSlot('studentphoto_1'),
    photoSlot('studentphoto_2'),
    photoSlot('studentphoto_3'),
    photoSlot('studentphoto_4'),
  ],
  'student_left',
  { students: 1, photos_friend: 4, has_quote: true, has_portrait: true, has_name: true },
);

const E_UNIVERSAL_RIGHT = makeMaster(
  'E-Universal-Right',
  [
    photoSlot('studentportrait'),
    textSlot('studentname'),
    textSlot('studentquote'),
    photoSlot('studentphoto_1'),
    photoSlot('studentphoto_2'),
    photoSlot('studentphoto_3'),
    photoSlot('studentphoto_4'),
  ],
  'student_right',
  { students: 1, photos_friend: 4, has_quote: true, has_portrait: true, has_name: true },
);

// Без quote — для теста has_quote=false.
const E_NO_QUOTE_LEFT = makeMaster(
  'E-NoQuote-Left',
  [photoSlot('studentportrait'), textSlot('studentname')],
  'student_left',
  { students: 1, photos_friend: 0, has_quote: false, has_portrait: true, has_name: true },
);

const E_NO_QUOTE_RIGHT = makeMaster(
  'E-NoQuote-Right',
  [photoSlot('studentportrait'), textSlot('studentname')],
  'student_right',
  { students: 1, photos_friend: 0, has_quote: false, has_portrait: true, has_name: true },
);

// Мастер с photos_friend=2 — для теста ближайшего меньшего.
const E_2FRIENDS_LEFT = makeMaster(
  'E-2Friends-Left',
  [
    photoSlot('studentportrait'),
    textSlot('studentname'),
    textSlot('studentquote'),
    photoSlot('studentphoto_1'),
    photoSlot('studentphoto_2'),
  ],
  'student_left',
  { students: 1, photos_friend: 2, has_quote: true, has_portrait: true, has_name: true },
);

const E_2FRIENDS_RIGHT = makeMaster(
  'E-2Friends-Right',
  [
    photoSlot('studentportrait'),
    textSlot('studentname'),
    textSlot('studentquote'),
    photoSlot('studentphoto_1'),
    photoSlot('studentphoto_2'),
  ],
  'student_right',
  { students: 1, photos_friend: 2, has_quote: true, has_portrait: true, has_name: true },
);

// S-Intro (для теста позиции с нечётным числом стартовых страниц).
const S_INTRO = makeMaster(
  'S-Intro',
  [photoSlot('classphotoframe')],
  'intro',
  { photos_full: 1 },
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
  full_class_count?: number;
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
      full_class: Array.from(
        { length: opts.full_class_count ?? 0 },
        (_, i) => `https://cdn/full${i}.jpg`,
      ),
      half_class: [],
      spread: [],
      quarter: [],
      sixth: [],
    },
  };
}

// ─── Тесты ──────────────────────────────────────────────────────────────────

describe("mode='page' семантический поиск (РЭ.22.4)", () => {
  it('3 ученика → 3 страницы, alternating L/R по чётности pageInstances.length', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'standard',
        student_layout_mode: 'page',
        student_friend_photos: 0,
        student_has_quote: true,
        section_structure: [{ type: 'students' }],
      }),
      masters: [E_STANDARD_LEFT, E_STANDARD_RIGHT],
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 3 }),
    );

    // 3 страницы → 2 разворота (последний разворот неполный, только left).
    expect(result.spreads).toHaveLength(2);
    expect(result.spreads[0].left?.master_id).toBe('id-E-Standard-Left');
    expect(result.spreads[0].right?.master_id).toBe('id-E-Standard-Right');
    expect(result.spreads[1].left?.master_id).toBe('id-E-Standard-Left');
    expect(result.spreads[1].right).toBeFalsy();

    // Bindings.
    expect(result.spreads[0].left?.bindings.studentportrait).toBe(
      'https://cdn/p0.jpg',
    );
    expect(result.spreads[0].left?.bindings.studentname).toBe('Student 0');
    expect(result.spreads[0].right?.bindings.studentportrait).toBe(
      'https://cdn/p1.jpg',
    );
  });

  it('has_quote=false → engine выбирает мастер без quote-слота', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'standard',
        student_layout_mode: 'page',
        student_friend_photos: 0,
        student_has_quote: false,
        section_structure: [{ type: 'students' }],
      }),
      // В template_set оба варианта — с quote и без. Engine должен выбрать без.
      masters: [E_STANDARD_LEFT, E_STANDARD_RIGHT, E_NO_QUOTE_LEFT, E_NO_QUOTE_RIGHT],
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 2 }),
    );

    expect(result.spreads[0].left?.master_id).toBe('id-E-NoQuote-Left');
    expect(result.spreads[0].right?.master_id).toBe('id-E-NoQuote-Right');
  });

  it('friend_photos=4 → engine ищет мастер с photos_friend=4 (Universal)', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'universal',
        student_layout_mode: 'page',
        student_friend_photos: 4,
        student_has_quote: true,
        section_structure: [{ type: 'students' }],
      }),
      masters: [E_STANDARD_LEFT, E_STANDARD_RIGHT, E_UNIVERSAL_LEFT, E_UNIVERSAL_RIGHT],
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 2, friend_photos_per_student: 4 }),
    );

    expect(result.spreads[0].left?.master_id).toBe('id-E-Universal-Left');
    expect(result.spreads[0].right?.master_id).toBe('id-E-Universal-Right');

    // Friend photos забиндены.
    expect(result.spreads[0].left?.bindings.studentphoto_1).toBe(
      'https://cdn/p0_friend0.jpg',
    );
    expect(result.spreads[0].left?.bindings.studentphoto_4).toBe(
      'https://cdn/p0_friend3.jpg',
    );
  });

  it('Запрос friend_photos=4, в template_set только мастер с 2 → warning lost_photos', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'standard',
        student_layout_mode: 'page',
        student_friend_photos: 4,
        student_has_quote: true,
        section_structure: [{ type: 'students' }],
      }),
      // Только 2-friends мастера в template_set.
      masters: [E_2FRIENDS_LEFT, E_2FRIENDS_RIGHT],
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 1, friend_photos_per_student: 4 }),
    );

    // Engine взял ближайший меньший (E-2Friends-Left).
    expect(result.spreads[0].left?.master_id).toBe('id-E-2Friends-Left');
    // Warning о потерянных 2 фото.
    const lostWarn = result.warnings.find((w) =>
      w.includes('students_lost_photos'),
    );
    expect(lostWarn).toBeDefined();
    expect(lostWarn).toContain('Student 0');
    expect(lostWarn).toContain('2 фото не размещены');
  });

  it('Мастер не найден → warning students_master_not_found, ученик пропущен', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'standard',
        student_layout_mode: 'page',
        student_friend_photos: 0,
        student_has_quote: true,
        section_structure: [{ type: 'students' }],
      }),
      // В template_set вообще нет мастеров с page_role='student_left'/'student_right'.
      // Берём teacher-мастер чтобы Map не был пустой.
      masters: [
        makeMaster('F-Other', [], 'teacher_left', { teachers: 4 }),
      ],
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 2 }),
    );

    // Учеников не разложили — pageInstances пустые.
    expect(result.spreads).toHaveLength(0);

    const notFoundWarns = result.warnings.filter((w) =>
      w.includes('students_master_not_found'),
    );
    expect(notFoundWarns.length).toBe(2); // для каждого ученика отдельный warning
    expect(notFoundWarns[0]).toContain("mode=page");
    expect(notFoundWarns[0]).toContain('page_role=');
    expect(notFoundWarns[0]).toContain('has_quote=true');
  });

  it("mode=NULL → fallback на legacy buildAlternatingLR (не семантика)", () => {
    // Legacy путь по density: standard → E-Standard-Left/Right по жёстким именам.
    // Создаём мастера без page_role/slot_capacity (как legacy записи в БД) —
    // если бы engine шёл семантически, он бы их не нашёл. Проверка что
    // engine идёт по legacy и подбирает их по имени.
    const legacyLeft = makeMaster(
      'E-Standard-Left',
      [photoSlot('studentportrait'), textSlot('studentname')],
      null, // legacy: без page_role
      null, // legacy: без slot_capacity
    );
    const legacyRight = makeMaster(
      'E-Standard-Right',
      [photoSlot('studentportrait'), textSlot('studentname')],
      null,
      null,
    );

    const bundle = makeBundle({
      preset: makePreset({
        id: 'standard',
        density: 'standard',
        student_layout_mode: null, // <-- ключевое: NULL = legacy путь
        section_structure: [{ type: 'students' }],
      }),
      masters: [legacyLeft, legacyRight],
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 2 }),
    );

    // Engine нашёл мастера по жёсткому имени, несмотря на отсутствие тегов.
    expect(result.spreads[0].left?.master_id).toBe('id-E-Standard-Left');
    expect(result.spreads[0].right?.master_id).toBe('id-E-Standard-Right');
  });

  it('Position сохраняется через чётность pageInstances.length, не индекс ученика', () => {
    // Если перед students идёт soft_intro (нечётное число страниц 1) —
    // первый ученик должен встать на right, второй на left.
    const bundle = makeBundle({
      preset: makePreset({
        id: 'standard',
        student_layout_mode: 'page',
        student_friend_photos: 0,
        student_has_quote: true,
        sheet_type: 'soft',
        section_structure: [{ type: 'soft_intro' }, { type: 'students' }],
      }),
      masters: [S_INTRO, E_STANDARD_LEFT, E_STANDARD_RIGHT],
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 2, full_class_count: 1 }),
    );

    // Разворот 0: left = S-Intro, right = первый ученик (E-Standard-Right)
    // Разворот 1: left = второй ученик (E-Standard-Left), right = null
    expect(result.spreads[0].left?.master_id).toBe('id-S-Intro');
    expect(result.spreads[0].right?.master_id).toBe('id-E-Standard-Right');
    expect(result.spreads[1].left?.master_id).toBe('id-E-Standard-Left');
    expect(result.spreads[1].right).toBeFalsy();
  });

  it("Decision trace содержит mode='page' и параметры поиска", () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'universal',
        student_layout_mode: 'page',
        student_friend_photos: 4,
        student_has_quote: true,
        section_structure: [{ type: 'students' }],
      }),
      masters: [E_UNIVERSAL_LEFT, E_UNIVERSAL_RIGHT],
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 1, friend_photos_per_student: 4 }),
    );

    const trace = result.decision_trace.find(
      (t) => t.rule_id?.startsWith('page_semantic:'),
    );
    expect(trace).toBeDefined();
    expect(trace?.inputs.mode).toBe('page');
    expect(trace?.inputs.page_role).toBe('student_left');
    expect(trace?.inputs.photos_friend_required).toBe(4);
    expect(trace?.inputs.has_quote_required).toBe(true);
    expect(trace?.inputs.exact_match).toBe(true);
    expect(trace?.inputs.lost_photos).toBe(0);
  });
});
