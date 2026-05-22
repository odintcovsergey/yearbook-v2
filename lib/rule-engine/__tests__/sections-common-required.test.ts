/**
 * Тесты для fillCommonRequiredSection (РЭ.32).
 *
 * Покрывают новый формат:
 *   { type: 'common_required', pages: [{ master_name: '...' }] }
 *
 * Сценарии:
 *  - pages пуст / отсутствует → warning common_required_empty
 *  - 1 страница full_class, фото есть → 1 SpreadInstance, classphotoframe bound
 *  - 2 страницы quarter (left + right) → J-Quarter-Left на левой,
 *    J-Quarter-Right на правой (зеркало)
 *  - master_name не найден → warning common_required_master_missing
 *  - фото не хватает → warning common_required_page_skipped, остальные продолжают
 *  - J-Spread (is_spread=true) → одна запись pages → 2 pageInstances →
 *    SpreadInstance.is_spread=true
 *  - смешанная последовательность с разными категориями
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

function makeMaster(
  name: string,
  placeholders: Placeholder[] = [],
  overrides: Partial<SpreadTemplate> = {},
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
    ...overrides,
  };
}

const J_FULL = makeMaster('J-Full', [photoSlot('classphotoframe')]);
const J_HALF = makeMaster('J-Half', [
  photoSlot('halfphoto_1'),
  photoSlot('halfphoto_2'),
]);
const J_QUARTER_LEFT = makeMaster('J-Quarter-Left', [
  photoSlot('quarterphoto_1'),
  photoSlot('quarterphoto_2'),
  photoSlot('quarterphoto_3'),
  photoSlot('quarterphoto_4'),
]);
const J_QUARTER_RIGHT = makeMaster('J-Quarter-Right', [
  photoSlot('quarterphoto_1'),
  photoSlot('quarterphoto_2'),
  photoSlot('quarterphoto_3'),
  photoSlot('quarterphoto_4'),
]);
const J_COLLAGE_6 = makeMaster(
  'J-Collage-6',
  Array.from({ length: 6 }, (_, i) => photoSlot(`collagephoto_${i + 1}`)),
);
const J_SPREAD = makeMaster(
  'J-Spread',
  [photoSlot('spreadphoto')],
  { is_spread: true, width_mm: 400 },
);

const ALL_J_MASTERS = [
  J_FULL,
  J_HALF,
  J_QUARTER_LEFT,
  J_QUARTER_RIGHT,
  J_COLLAGE_6,
  J_SPREAD,
];

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
  const masters = opts.masters ?? ALL_J_MASTERS;
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
  full_class?: number;
  half_class?: number;
  quarter?: number;
  sixth?: number;
  spread?: number;
} = {}): RulesAlbumInput {
  const urls = (n: number, label: string) =>
    Array.from({ length: n }, (_, i) => `https://cdn/${label}_${i}.jpg`);
  return {
    students: [],
    subjects: [],
    head_teacher: { photo: null, name: '', role: '', text: '' },
    common_photos: {
      full_class: urls(opts.full_class ?? 0, 'full'),
      half_class: urls(opts.half_class ?? 0, 'half'),
      spread: urls(opts.spread ?? 0, 'spread'),
      quarter: urls(opts.quarter ?? 0, 'q'),
      sixth: urls(opts.sixth ?? 0, 'sixth'),
    },
  };
}

// ─── Тесты ──────────────────────────────────────────────────────────────────

describe('fillCommonRequiredSection (РЭ.32): новый формат pages', () => {
  it('pages отсутствует → warning common_required_empty, секция пропускается', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'test',
        section_structure: [{ type: 'common_required' }],
      }),
    });
    const result = buildFromSectionStructure(bundle, makeInput({ full_class: 5 }));
    expect(result.spreads).toHaveLength(0);
    expect(result.warnings.some((w) => w.startsWith('common_required_empty'))).toBe(true);
  });

  it('pages пуст → warning common_required_empty', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'test',
        section_structure: [{ type: 'common_required', pages: [] }],
      }),
    });
    const result = buildFromSectionStructure(bundle, makeInput({ full_class: 5 }));
    expect(result.warnings.some((w) => w.startsWith('common_required_empty'))).toBe(true);
  });

  it('1 страница J-Full → 1 разворот, левая страница занята, правая пустая', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'test',
        section_structure: [
          {
            type: 'common_required',
            pages: [{ master_name: 'J-Full' }],
          },
        ],
      }),
    });
    const result = buildFromSectionStructure(bundle, makeInput({ full_class: 1 }));
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-J-Full');
    expect(result.spreads[0].left?.bindings.classphotoframe).toBe('https://cdn/full_0.jpg');
    expect(result.spreads[0].right).toBeUndefined();
  });

  it('Зеркальный мастер: 2 страницы J-Quarter-Left → на правой автоматически J-Quarter-Right', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'test',
        section_structure: [
          {
            type: 'common_required',
            pages: [
              { master_name: 'J-Quarter-Left' },
              { master_name: 'J-Quarter-Left' },
            ],
          },
        ],
      }),
    });
    const result = buildFromSectionStructure(bundle, makeInput({ quarter: 8 }));
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-J-Quarter-Left');
    expect(result.spreads[0].right?.master_id).toBe('id-J-Quarter-Right');
  });

  it('master_name не найден → warning, остальные продолжают', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'test',
        section_structure: [
          {
            type: 'common_required',
            pages: [
              { master_name: 'J-NonExistent' },
              { master_name: 'J-Full' },
            ],
          },
        ],
      }),
    });
    const result = buildFromSectionStructure(bundle, makeInput({ full_class: 1 }));
    expect(result.warnings.some((w) => w.includes('master_missing'))).toBe(true);
    // J-Full должен сработать несмотря на пропущенный мастер.
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-J-Full');
  });

  it('фото не хватает → warning common_required_page_skipped, остальные продолжают', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'test',
        section_structure: [
          {
            type: 'common_required',
            pages: [
              { master_name: 'J-Collage-6' }, // нужно 6 sixth-фото
              { master_name: 'J-Full' }, // нужно 1 full
            ],
          },
        ],
      }),
    });
    // sixth=0, full_class=1 → первая страница пропускается, вторая строится
    const result = buildFromSectionStructure(bundle, makeInput({ full_class: 1, sixth: 0 }));
    expect(result.warnings.some((w) => w.includes('page_skipped'))).toBe(true);
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-J-Full');
  });

  it('J-Spread (is_spread=true) → 1 запись pages → SpreadInstance.is_spread=true', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'test',
        section_structure: [
          {
            type: 'common_required',
            pages: [{ master_name: 'J-Spread' }],
          },
        ],
      }),
    });
    const result = buildFromSectionStructure(bundle, makeInput({ spread: 1 }));
    expect(result.spreads).toHaveLength(1);
    const spread = result.spreads[0];
    // SpreadInstance.is_spread должен быть true (через детектор is_spread пары в orchestrator)
    expect((spread as unknown as { is_spread?: boolean }).is_spread).toBe(true);
    expect(spread.left?.master_id).toBe('id-J-Spread');
    expect(spread.right?.master_id).toBe('id-J-Spread');
  });

  it('Смешанная последовательность: 4 страницы разных категорий', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'test',
        section_structure: [
          {
            type: 'common_required',
            pages: [
              { master_name: 'J-Quarter-Left' }, // page 1 (left): quarter
              { master_name: 'J-Quarter-Left' }, // page 2 (right): → J-Quarter-Right
              { master_name: 'J-Half' }, // page 3 (left): half
              { master_name: 'J-Full' }, // page 4 (right): full
            ],
          },
        ],
      }),
    });
    const result = buildFromSectionStructure(bundle, makeInput({
      quarter: 8,
      half_class: 2,
      full_class: 1,
    }));
    expect(result.spreads).toHaveLength(2);
    expect(result.spreads[0].left?.master_id).toBe('id-J-Quarter-Left');
    expect(result.spreads[0].right?.master_id).toBe('id-J-Quarter-Right');
    expect(result.spreads[1].left?.master_id).toBe('id-J-Half');
    expect(result.spreads[1].right?.master_id).toBe('id-J-Full');
  });
});
