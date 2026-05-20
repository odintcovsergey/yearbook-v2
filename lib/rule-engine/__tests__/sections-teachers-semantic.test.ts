/**
 * Тесты для РЭ.22.7.2: семантический поиск teachers-мастеров.
 *
 * Покрывают новый путь (через page_role + slot_capacity), параллельный
 * с legacy путём в sections-teachers.test.ts. Главные сценарии:
 *  - Семантический поиск находит мастер даже если имя не совпадает с
 *    legacy (закрытие бага G-Teachers-4x3 vs реальное G-Teachers-3x4)
 *  - Размеченные мастера предпочтительнее (semantic=true в trace)
 *  - 10 subjects → находит G-Teachers-3x4 через teachers>=10
 *  - Семантика отсеивает F-Head-WithClassPhoto-L (head=1+classphoto=1)
 *    для запроса с photos_full=0 (т.е. обычная левая «только главный»)
 *  - Decision trace содержит inputs.semantic
 *  - Warning teachers_master_not_found со спецификацией slot_capacity
 *    когда ни семантика, ни legacy не нашли
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
    font_size_pt: 10,
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
    type: 'head_teacher',
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

/** Helper: F-Head-* мастер. Если semantic=true, размечает теги. */
function makeLeftMaster(
  name: string,
  opts: {
    teachers?: number;
    semantic?: boolean;
    photosFull?: number;
  } = {},
): SpreadTemplate {
  const teachers = opts.teachers ?? 0;
  const placeholders: Placeholder[] = [
    photoSlot('headteacherphoto'),
    textSlot('headteachername'),
    textSlot('headteacherrole'),
    textSlot('headteachertext'),
  ];
  for (let i = 1; i <= teachers; i++) {
    placeholders.push(photoSlot(`subjectphoto_${i}`));
    placeholders.push(textSlot(`subjectname_${i}`));
    placeholders.push(textSlot(`subjectrole_${i}`));
  }
  if (opts.photosFull) {
    placeholders.push(photoSlot('classphotoframe'));
  }
  const pageRole = opts.semantic ? ('teacher_left' as PageRole) : null;
  const slotCap = opts.semantic
    ? ({
        head_teacher: 1,
        teachers,
        photos_full: opts.photosFull ?? 0,
      } as SlotCapacity)
    : null;
  return makeMaster(name, placeholders, pageRole, slotCap);
}

/** Helper: G-* правый мастер. */
function makeRightMaster(
  name: string,
  opts: {
    teachers?: number;
    photosFull?: number;
    photosHalf?: number;
    semantic?: boolean;
  } = {},
): SpreadTemplate {
  const teachers = opts.teachers ?? 0;
  const placeholders: Placeholder[] = [];
  for (let i = 1; i <= teachers; i++) {
    placeholders.push(photoSlot(`subjectphoto_${i}`));
    placeholders.push(textSlot(`subjectname_${i}`));
  }
  if (opts.photosFull) placeholders.push(photoSlot('classphotoframe'));
  for (let i = 1; i <= (opts.photosHalf ?? 0); i++) {
    placeholders.push(photoSlot(`halfphoto_${i}`));
  }
  const pageRole = opts.semantic ? ('teacher_right' as PageRole) : null;
  const slotCap = opts.semantic
    ? ({
        teachers,
        photos_full: opts.photosFull ?? 0,
        photos_half: opts.photosHalf ?? 0,
      } as SlotCapacity)
    : null;
  return makeMaster(name, placeholders, pageRole, slotCap);
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
  subjects: number;
  half_class?: number;
  full_class?: number;
}): RulesAlbumInput {
  return {
    students: [],
    subjects: Array.from({ length: opts.subjects }, (_, i) => ({
      photo: `https://cdn/subj${i}.jpg`,
      name: `Teacher ${i}`,
      role: `Subject ${i}`,
    })),
    head_teacher: {
      photo: 'https://cdn/head.jpg',
      name: 'Head',
      role: 'Director',
      text: 'Welcome',
    },
    common_photos: {
      full_class: Array.from(
        { length: opts.full_class ?? 0 },
        (_, i) => `https://cdn/full${i}.jpg`,
      ),
      half_class: Array.from(
        { length: opts.half_class ?? 0 },
        (_, i) => `https://cdn/half${i}.jpg`,
      ),
      spread: [],
      quarter: [],
      sixth: [],
    },
  };
}

// ─── Тесты ──────────────────────────────────────────────────────────────────

describe('teachers семантический поиск (РЭ.22.7.2)', () => {
  it('Размеченные мастера используются, trace.semantic=true', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [{ type: 'teachers' }],
      }),
      masters: [
        makeLeftMaster('F-Head-LargeGrid', { teachers: 8, semantic: true }),
        makeRightMaster('G-Teachers-4x4', { teachers: 16, semantic: true }),
      ],
    });
    const result = buildFromSectionStructure(bundle, makeInput({ subjects: 6 }));
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-F-Head-LargeGrid');

    const leftTrace = result.decision_trace.find(
      (t) => t.rule_id?.startsWith('teachers_left:'),
    );
    expect(leftTrace?.inputs.semantic).toBe(true);
  });

  it("Закрытие бага G-Teachers-3x4 vs 4x3: 10 subjects → находит G-Teachers-3x4 через teachers>=10", () => {
    // Раньше legacy искал жёсткое имя 'G-Teachers-4x3', а в реальной БД
    // мастер называется 'G-Teachers-3x4'. Семантический поиск ищет по
    // slot_capacity.teachers >= 10 → находит G-Teachers-3x4 (teachers=12).
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [{ type: 'teachers' }],
      }),
      masters: [
        makeLeftMaster('F-Head-WithPhoto', { teachers: 0, semantic: true }),
        // Только G-Teachers-3x4 — никакого 'G-Teachers-4x3' в template_set.
        makeRightMaster('G-Teachers-3x4', { teachers: 12, semantic: true }),
      ],
    });
    const result = buildFromSectionStructure(bundle, makeInput({ subjects: 10 }));
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].right?.master_id).toBe('id-G-Teachers-3x4');

    const rightTrace = result.decision_trace.find(
      (t) => t.rule_id?.startsWith('teachers_right:'),
    );
    expect(rightTrace?.inputs.semantic).toBe(true);
    expect(rightTrace?.inputs.subjects_on_right).toBe(10);
  });

  it("Семантика отсеивает F-Head-WithClassPhoto-L (photos_full=1) для запроса photos_full=0", () => {
    // В template_set два мастера с head_teacher=1, teachers=0:
    //  - F-Head-WithPhoto (photos_full=0)            ← должен быть выбран
    //  - F-Head-WithClassPhoto-L (photos_full=1)     ← НЕ выбран
    // Для subjects=0 без общих фото запрос photos_full=0 — отсеивает второй.
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [{ type: 'teachers' }],
      }),
      masters: [
        makeLeftMaster('F-Head-WithPhoto', { teachers: 0, semantic: true }),
        makeLeftMaster('F-Head-WithClassPhoto-L', {
          teachers: 0,
          photosFull: 1,
          semantic: true,
        }),
      ],
    });
    const result = buildFromSectionStructure(bundle, makeInput({ subjects: 0 }));
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-F-Head-WithPhoto');
  });

  it('Legacy fallback: неразмеченный F-Head-WithPhoto находится по имени, semantic=false', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [{ type: 'teachers' }],
      }),
      masters: [
        // НЕ размечен (page_role=null, slot_capacity=null)
        makeLeftMaster('F-Head-WithPhoto', { teachers: 0, semantic: false }),
      ],
    });
    const result = buildFromSectionStructure(bundle, makeInput({ subjects: 0 }));
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-F-Head-WithPhoto');

    const leftTrace = result.decision_trace.find(
      (t) => t.rule_id?.startsWith('teachers_left:'),
    );
    expect(leftTrace?.inputs.semantic).toBe(false);
  });

  it('Ни семантика, ни legacy не нашли левую → warning со спецификацией', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [{ type: 'teachers' }],
      }),
      // template_set пустой относительно F-* мастеров
      masters: [makeRightMaster('G-FullClass', { photosFull: 1, semantic: true })],
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ subjects: 3, full_class: 1 }),
    );
    expect(result.spreads).toHaveLength(0);
    const warn = result.warnings.find((w) =>
      w.startsWith('teachers_master_not_found'),
    );
    expect(warn).toBeDefined();
    expect(warn).toContain("page_role='teacher_left'");
    expect(warn).toContain('head_teacher=1');
    expect(warn).toContain('teachers>=3');
  });

  it('14 subjects → G-Teachers-4x4 (16 слотов), 2 слота останутся пустыми', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [{ type: 'teachers' }],
      }),
      masters: [
        makeLeftMaster('F-Head-WithPhoto', { teachers: 0, semantic: true }),
        makeRightMaster('G-Teachers-4x4', { teachers: 16, semantic: true }),
      ],
    });
    const result = buildFromSectionStructure(bundle, makeInput({ subjects: 14 }));
    expect(result.spreads[0].right?.master_id).toBe('id-G-Teachers-4x4');
    // 14 первых слотов заполнены, 15-16 скрыты
    const rightB = result.spreads[0].right!.bindings;
    expect(rightB.subjectphoto_1).toBe('https://cdn/subj0.jpg');
    expect(rightB.subjectphoto_14).toBe('https://cdn/subj13.jpg');
    expect(rightB.__hidden__subjectphoto_15).toBe('1');
    expect(rightB.__hidden__subjectphoto_16).toBe('1');
  });

  it('20 subjects → F-Head-LargeGrid (8 на левой) + G-Teachers-4x4 (12 на правой, offset=8)', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [{ type: 'teachers' }],
      }),
      masters: [
        makeLeftMaster('F-Head-LargeGrid', { teachers: 8, semantic: true }),
        makeRightMaster('G-Teachers-4x4', { teachers: 16, semantic: true }),
      ],
    });
    const result = buildFromSectionStructure(bundle, makeInput({ subjects: 20 }));
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-F-Head-LargeGrid');
    expect(result.spreads[0].right?.master_id).toBe('id-G-Teachers-4x4');

    // Левая: первые 8 subjects (0..7)
    expect(result.spreads[0].left?.bindings.subjectphoto_1).toBe(
      'https://cdn/subj0.jpg',
    );
    expect(result.spreads[0].left?.bindings.subjectphoto_8).toBe(
      'https://cdn/subj7.jpg',
    );
    // Правая: offset=8, subjects 8..19 (12 шт.)
    expect(result.spreads[0].right?.bindings.subjectphoto_1).toBe(
      'https://cdn/subj8.jpg',
    );
    expect(result.spreads[0].right?.bindings.subjectphoto_12).toBe(
      'https://cdn/subj19.jpg',
    );
  });

  it('subjects=0 + full_class=1: правая = G-FullClass, в bindings есть classphotoframe', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [{ type: 'teachers' }],
      }),
      masters: [
        makeLeftMaster('F-Head-WithPhoto', { teachers: 0, semantic: true }),
        makeRightMaster('G-FullClass', { photosFull: 1, semantic: true }),
      ],
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ subjects: 0, full_class: 1 }),
    );
    expect(result.spreads[0].right?.master_id).toBe('id-G-FullClass');
    expect(result.spreads[0].right?.bindings.classphotoframe).toBe(
      'https://cdn/full0.jpg',
    );
  });
});
