/**
 * Тесты для master-finder + Individual adaptive (РЭ.21.8.15).
 *
 * Покрывают:
 *  - findStudentMaster: exact match по photos_friend
 *  - findStudentMaster: ближайший меньший когда нет exact
 *  - findStudentMaster: фильтр page_role
 *  - findStudentMaster: фильтр has_quote / has_portrait
 *  - findStudentMaster: applies_to_configs (preset.id в массиве или пустой)
 *  - findStudentMaster: null когда ничего не подошло
 *  - Integration: Individual через семантический поиск с разным friend_photos
 *  - Integration: fallback на E-Max когда поля пресета не заполнены
 *  - Integration: warning students_lost_photos
 */

import { describe, it, expect } from 'vitest';
import { findStudentMaster } from '../master-finder';
import { buildFromSectionStructure } from '../build-from-section-structure';
import type { Preset, RulesAlbumInput } from '../types';
import type { RuleEngineBundle } from '../loaders';
import type {
  ConfigType,
  PageRole,
  Placeholder,
  SlotCapacity,
  SpreadTemplate,
  TemplateSet,
} from '@/lib/album-builder/types';

// ─── Фикстуры ───────────────────────────────────────────────────────────────

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

function makeMaster(opts: {
  name: string;
  placeholders?: Placeholder[];
  applies_to_configs?: ConfigType[];
  page_role?: PageRole | null;
  slot_capacity?: SlotCapacity | null;
}): SpreadTemplate {
  return {
    id: `id-${opts.name}`,
    name: opts.name,
    type: 'student',
    is_spread: false,
    width_mm: 200,
    height_mm: 280,
    placeholders: opts.placeholders ?? [],
    rules: null,
    sort_order: 0,
    applies_to_configs: opts.applies_to_configs ?? [],
    default_for_configs: [],
    page_role: opts.page_role ?? null,
    slot_capacity: opts.slot_capacity ?? null,
    is_fallback: false,
    mirror_for_soft: false,
    audit_notes: null,
  };
}

// E-Individual-* мастера (правая страница, photos_friend меняется).
const E_INDIVIDUAL_RIGHT_0 = makeMaster({
  name: 'E-Individual-Right-0',
  placeholders: [textSlot('studentquote')],
  applies_to_configs: ['individual' as ConfigType],
  page_role: 'student_right',
  slot_capacity: { students: 1, photos_friend: 0, has_quote: true },
});

const E_INDIVIDUAL_RIGHT_2 = makeMaster({
  name: 'E-Individual-Right-2',
  placeholders: [
    textSlot('studentquote'),
    photoSlot('studentphoto_1'),
    photoSlot('studentphoto_2'),
  ],
  applies_to_configs: ['individual' as ConfigType],
  page_role: 'student_right',
  slot_capacity: { students: 1, photos_friend: 2, has_quote: true },
});

const E_INDIVIDUAL_RIGHT_4 = makeMaster({
  name: 'E-Individual-Right-4',
  placeholders: [
    textSlot('studentquote'),
    photoSlot('studentphoto_1'),
    photoSlot('studentphoto_2'),
    photoSlot('studentphoto_3'),
    photoSlot('studentphoto_4'),
  ],
  applies_to_configs: ['individual' as ConfigType],
  page_role: 'student_right',
  slot_capacity: { students: 1, photos_friend: 4, has_quote: true },
});

const E_INDIVIDUAL_LEFT = makeMaster({
  name: 'E-Individual-Left',
  placeholders: [photoSlot('studentportrait'), textSlot('studentname')],
  applies_to_configs: ['individual' as ConfigType],
  page_role: 'student_left',
  slot_capacity: { students: 1, photos_friend: 0, has_portrait: true, has_name: true },
});

// Универсальный мастер (applies_to_configs пустой).
const E_GENERIC_RIGHT_3 = makeMaster({
  name: 'E-Generic-Right-3',
  placeholders: [
    photoSlot('studentphoto_1'),
    photoSlot('studentphoto_2'),
    photoSlot('studentphoto_3'),
  ],
  applies_to_configs: [],
  page_role: 'student_right',
  slot_capacity: { students: 1, photos_friend: 3, has_quote: false },
});

function buildMastersMap(masters: SpreadTemplate[]): ReadonlyMap<string, SpreadTemplate> {
  const m = new Map<string, SpreadTemplate>();
  for (const x of masters) m.set(x.name, x);
  return m;
}

// ─── findStudentMaster ──────────────────────────────────────────────────────

describe('findStudentMaster: exact match', () => {
  it('photos_friend=2 → E-Individual-Right-2', () => {
    const m = buildMastersMap([E_INDIVIDUAL_RIGHT_0, E_INDIVIDUAL_RIGHT_2, E_INDIVIDUAL_RIGHT_4]);
    const result = findStudentMaster(m, {
      presetId: 'individual',
      pageRole: 'student_right',
      photosFriend: 2,
      hasQuote: true,
    });
    expect(result).not.toBeNull();
    expect(result!.master.name).toBe('E-Individual-Right-2');
    expect(result!.exactMatch).toBe(true);
    expect(result!.lostPhotos).toBe(0);
  });
});

describe('findStudentMaster: ближайший меньший', () => {
  it('photos_friend=5, есть только до 4 → E-Individual-Right-4 + lostPhotos=1', () => {
    const m = buildMastersMap([E_INDIVIDUAL_RIGHT_0, E_INDIVIDUAL_RIGHT_2, E_INDIVIDUAL_RIGHT_4]);
    const result = findStudentMaster(m, {
      presetId: 'individual',
      pageRole: 'student_right',
      photosFriend: 5,
      hasQuote: true,
    });
    expect(result!.master.name).toBe('E-Individual-Right-4');
    expect(result!.exactMatch).toBe(false);
    expect(result!.lostPhotos).toBe(1);
  });

  it('photos_friend=3, есть 0/2/4 → E-Individual-Right-2 (ближайший меньший)', () => {
    const m = buildMastersMap([E_INDIVIDUAL_RIGHT_0, E_INDIVIDUAL_RIGHT_2, E_INDIVIDUAL_RIGHT_4]);
    const result = findStudentMaster(m, {
      presetId: 'individual',
      pageRole: 'student_right',
      photosFriend: 3,
      hasQuote: true,
    });
    expect(result!.master.name).toBe('E-Individual-Right-2');
    expect(result!.exactMatch).toBe(false);
    expect(result!.lostPhotos).toBe(1);
  });
});

describe('findStudentMaster: фильтр applies_to_configs', () => {
  it('Универсальный мастер (configs=[]) подходит для любого пресета', () => {
    const m = buildMastersMap([E_GENERIC_RIGHT_3]);
    const result = findStudentMaster(m, {
      presetId: 'my-custom-preset',
      pageRole: 'student_right',
      photosFriend: 3,
    });
    expect(result!.master.name).toBe('E-Generic-Right-3');
  });

  it('Мастер для individual НЕ подходит когда presetId=universal', () => {
    const m = buildMastersMap([E_INDIVIDUAL_RIGHT_2]);
    const result = findStudentMaster(m, {
      presetId: 'universal',
      pageRole: 'student_right',
      photosFriend: 2,
      hasQuote: true,
    });
    expect(result).toBeNull();
  });
});

describe('findStudentMaster: фильтр page_role', () => {
  it('page_role student_right отбрасывает мастера student_left', () => {
    const m = buildMastersMap([E_INDIVIDUAL_LEFT, E_INDIVIDUAL_RIGHT_2]);
    const result = findStudentMaster(m, {
      presetId: 'individual',
      pageRole: 'student_right',
      photosFriend: 2,
      hasQuote: true,
    });
    expect(result!.master.name).toBe('E-Individual-Right-2');
  });

  it('page_role student_left', () => {
    const m = buildMastersMap([E_INDIVIDUAL_LEFT, E_INDIVIDUAL_RIGHT_2]);
    const result = findStudentMaster(m, {
      presetId: 'individual',
      pageRole: 'student_left',
      photosFriend: 0,
      hasPortrait: true,
    });
    expect(result!.master.name).toBe('E-Individual-Left');
  });
});

describe('findStudentMaster: фильтр has_quote', () => {
  it('hasQuote=true отбрасывает мастера без has_quote', () => {
    const m = buildMastersMap([E_GENERIC_RIGHT_3, E_INDIVIDUAL_RIGHT_2]);
    const result = findStudentMaster(m, {
      presetId: 'individual',
      pageRole: 'student_right',
      photosFriend: 2,
      hasQuote: true,
    });
    expect(result!.master.name).toBe('E-Individual-Right-2');
  });

  it('hasQuote=false отбрасывает мастера с has_quote', () => {
    const m = buildMastersMap([E_GENERIC_RIGHT_3, E_INDIVIDUAL_RIGHT_2]);
    // E_GENERIC_RIGHT_3 — has_quote=false, photos_friend=3
    // E_INDIVIDUAL_RIGHT_2 — has_quote=true → отбрасывается
    // Доступен только GENERIC, photos_friend=3 → exact match нет (need 2),
    // ближайший меньший = E_GENERIC (3 > 2 → не подходит)
    // → smallest fallback
    const result = findStudentMaster(m, {
      presetId: 'individual',
      pageRole: 'student_right',
      photosFriend: 2,
      hasQuote: false,
    });
    expect(result).not.toBeNull();
    expect(result!.master.name).toBe('E-Generic-Right-3');
  });
});

describe('findStudentMaster: ничего не подошло', () => {
  it('пустой mastersByName → null', () => {
    const m = buildMastersMap([]);
    const result = findStudentMaster(m, {
      presetId: 'individual',
      pageRole: 'student_right',
      photosFriend: 2,
    });
    expect(result).toBeNull();
  });
});

// ─── Integration: Individual через семантический поиск ──────────────────────

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
    student_pages_per_student: opts.student_pages_per_student ?? null,
    student_friend_photos: opts.student_friend_photos ?? null,
    student_has_quote: opts.student_has_quote ?? null,
  };
}

function makeBundle(opts: { preset: Preset; masters: SpreadTemplate[] }): RuleEngineBundle {
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
  students: { name: string; friend_photos_count: number }[];
}): RulesAlbumInput {
  return {
    students: opts.students.map((s, i) => ({
      full_name: s.name,
      quote: `Quote ${i}`,
      portrait: `https://cdn/p${i}.jpg`,
      friend_photos: Array.from(
        { length: s.friend_photos_count },
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

describe('Individual: семантический поиск per-student', () => {
  it('Ученики с разным friend_photos получают разные мастера', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'individual',
        density: null,
        student_pages_per_student: 2,
        student_has_quote: true,
        section_structure: [{ type: 'students' }],
      }),
      masters: [
        E_INDIVIDUAL_LEFT,
        E_INDIVIDUAL_RIGHT_0,
        E_INDIVIDUAL_RIGHT_2,
        E_INDIVIDUAL_RIGHT_4,
      ],
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({
        students: [
          { name: 'Алиса', friend_photos_count: 0 },
          { name: 'Боря', friend_photos_count: 2 },
          { name: 'Вова', friend_photos_count: 4 },
        ],
      }),
    );
    expect(result.spreads).toHaveLength(3);
    // Все левые — E-Individual-Left
    for (const s of result.spreads) {
      expect(s.left?.master_id).toBe('id-E-Individual-Left');
    }
    // Правые — разные
    expect(result.spreads[0].right?.master_id).toBe('id-E-Individual-Right-0');
    expect(result.spreads[1].right?.master_id).toBe('id-E-Individual-Right-2');
    expect(result.spreads[2].right?.master_id).toBe('id-E-Individual-Right-4');
  });

  it('Ученик с 5 фото + есть только до 4 → используется -4 + warning lost_photos', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'individual',
        density: null,
        student_pages_per_student: 2,
        student_has_quote: true,
        section_structure: [{ type: 'students' }],
      }),
      masters: [E_INDIVIDUAL_LEFT, E_INDIVIDUAL_RIGHT_4],
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({
        students: [{ name: 'Алиса', friend_photos_count: 5 }],
      }),
    );
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].right?.master_id).toBe('id-E-Individual-Right-4');
    expect(
      result.warnings.some(
        (w) =>
          w.startsWith('students_lost_photos') &&
          w.includes('Алиса') &&
          w.includes('1 фото не размещены'),
      ),
    ).toBe(true);
  });

  it('Fallback на E-Max когда новые поля пресета не заполнены', () => {
    // Если student_pages_per_student=null → engine идёт по 21.8.14
    // (жёсткие имена E-Max-Left / E-Max-Right).
    const E_MAX_LEFT = makeMaster({
      name: 'E-Max-Left',
      placeholders: [photoSlot('studentportrait')],
    });
    const E_MAX_RIGHT = makeMaster({
      name: 'E-Max-Right',
      placeholders: [photoSlot('studentphoto_1')],
    });
    const bundle = makeBundle({
      preset: makePreset({
        id: 'individual',
        density: null,
        student_pages_per_student: null, // не заполнено → fallback
        section_structure: [{ type: 'students' }],
      }),
      masters: [E_MAX_LEFT, E_MAX_RIGHT],
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students: [{ name: 'Алиса', friend_photos_count: 4 }] }),
    );
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-E-Max-Left');
    expect(result.spreads[0].right?.master_id).toBe('id-E-Max-Right');
  });

  it('Мастер не найден → warning, ученик пропущен, остальные строятся', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'individual',
        density: null,
        student_pages_per_student: 2,
        student_has_quote: true,
        section_structure: [{ type: 'students' }],
      }),
      masters: [E_INDIVIDUAL_LEFT, E_INDIVIDUAL_RIGHT_4],
      // Нет E-Individual-Right-100, который нужен для friend_photos=100.
      // Но E-Individual-Right-4 fallback (ближайший меньший) сработает,
      // 4 фото показано, 96 lostPhotos.
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students: [{ name: 'Алиса', friend_photos_count: 100 }] }),
    );
    expect(result.spreads).toHaveLength(1);
    expect(
      result.warnings.some((w) => w.startsWith('students_lost_photos')),
    ).toBe(true);
  });
});
