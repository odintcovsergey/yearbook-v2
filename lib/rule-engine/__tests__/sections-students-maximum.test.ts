/**
 * Тесты для secondsudents Maximum/Individual (РЭ.21.8.14).
 *
 * Покрывают:
 *  - density=null + preset.id='maximum' → 1 ученик = 1 разворот через
 *    E-Max-Left + E-Max-Right
 *  - density=null + preset.id='individual' → пока то же что Maximum
 *    (будет переработано в РЭ.21.8.15)
 *  - density=null + preset.id='unknown' → warning students_density_not_supported
 *  - Bindings: studentportrait/name на левой, studentquote/studentphoto_N
 *    на правой
 *  - Множество учеников → каждый занимает один разворот
 *  - master_not_found когда E-Max-* отсутствует
 */

import { describe, it, expect } from 'vitest';
import { buildFromSectionStructure } from '../build-from-section-structure';
import type { Preset, RulesAlbumInput } from '../types';
import type { RuleEngineBundle } from '../loaders';
import type {
  Placeholder,
  SpreadTemplate,
  TemplateSet,
} from '@/lib/album-builder/types';

// ─── Фикстуры локальные (минимальный набор) ─────────────────────────────────

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

function makeMaster(name: string, placeholders: Placeholder[]): SpreadTemplate {
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
    page_role: null,
    slot_capacity: null,
    is_fallback: false,
    mirror_for_soft: false,
    audit_notes: null,
  };
}

const E_MAX_LEFT = makeMaster('E-Max-Left', [
  photoSlot('studentportrait'),
  textSlot('studentname'),
]);

const E_MAX_RIGHT = makeMaster('E-Max-Right', [
  textSlot('studentquote'),
  photoSlot('studentphoto_1'),
  photoSlot('studentphoto_2'),
  photoSlot('studentphoto_3'),
  photoSlot('studentphoto_4'),
]);

const ALL_MASTERS = [E_MAX_LEFT, E_MAX_RIGHT];

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
  };
}

function makeBundle(opts: {
  preset: Preset;
  masters?: SpreadTemplate[];
}): RuleEngineBundle {
  const masters = opts.masters ?? ALL_MASTERS;
  const mastersByName = new Map<string, SpreadTemplate>();
  for (const m of masters) mastersByName.set(m.name, m);
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
    spreads: masters,
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
      collage: [],
    },
  };
}

// ─── Тесты ──────────────────────────────────────────────────────────────────

describe("students: density=null + preset.id='maximum'", () => {
  it('3 ученика → 3 разворота, каждый E-Max-Left + E-Max-Right', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'maximum',
        density: null,
        section_structure: [{ type: 'students' }],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 3, friend_photos_per_student: 4 }),
    );
    expect(result.spreads).toHaveLength(3);
    for (const s of result.spreads) {
      expect(s.left?.master_id).toBe('id-E-Max-Left');
      expect(s.right?.master_id).toBe('id-E-Max-Right');
    }
  });

  it('Bindings: studentportrait на левой, friend_photos на правой', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'maximum',
        density: null,
        section_structure: [{ type: 'students' }],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 1, friend_photos_per_student: 4 }),
    );
    const spread = result.spreads[0];
    // Левая — портрет + имя
    expect(spread.left?.bindings.studentportrait).toBe('https://cdn/p0.jpg');
    expect(spread.left?.bindings.studentname).toBe('Student 0');
    // Правая — цитата + 4 friend_photos
    expect(spread.right?.bindings.studentquote).toBe('Quote 0');
    expect(spread.right?.bindings.studentphoto_1).toBe(
      'https://cdn/p0_friend0.jpg',
    );
    expect(spread.right?.bindings.studentphoto_4).toBe(
      'https://cdn/p0_friend3.jpg',
    );
  });

  it('Меньше friend_photos чем слотов → лишние слоты пустые (null bindings)', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'maximum',
        density: null,
        section_structure: [{ type: 'students' }],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 1, friend_photos_per_student: 2 }),
    );
    const right = result.spreads[0].right!;
    expect(right.bindings.studentphoto_1).toBe('https://cdn/p0_friend0.jpg');
    expect(right.bindings.studentphoto_2).toBe('https://cdn/p0_friend1.jpg');
    // studentphoto_3 и _4 не должны быть установлены (или равны null).
    expect(right.bindings.studentphoto_3 ?? null).toBeNull();
    expect(right.bindings.studentphoto_4 ?? null).toBeNull();
  });

  it('0 учеников → 0 разворотов', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'maximum',
        density: null,
        section_structure: [{ type: 'students' }],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 0 }),
    );
    expect(result.spreads).toHaveLength(0);
  });

  it('E-Max-Left отсутствует → warning students_master_not_found', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'maximum',
        density: null,
        section_structure: [{ type: 'students' }],
      }),
      masters: [E_MAX_RIGHT], // только Right
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 3 }),
    );
    expect(result.spreads).toHaveLength(0);
    expect(
      result.warnings.some(
        (w) =>
          w.startsWith('students_master_not_found') &&
          w.includes('E-Max-Left'),
      ),
    ).toBe(true);
  });
});

describe("students: density=null + preset.id='individual'", () => {
  it('Заглушка пока работает как Maximum (РЭ.21.8.15 переделает)', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'individual',
        density: null,
        section_structure: [{ type: 'students' }],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 2, friend_photos_per_student: 3 }),
    );
    expect(result.spreads).toHaveLength(2);
    expect(result.spreads[0].left?.master_id).toBe('id-E-Max-Left');
    expect(result.spreads[0].right?.master_id).toBe('id-E-Max-Right');
  });
});

describe('students: density=null + неизвестный preset.id', () => {
  it('preset.id=unknown → warning students_density_not_supported', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'unknown-preset',
        density: null,
        section_structure: [{ type: 'students' }],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 5 }),
    );
    expect(result.spreads).toHaveLength(0);
    expect(
      result.warnings.some((w) =>
        w.startsWith('students_density_not_supported'),
      ),
    ).toBe(true);
  });
});
