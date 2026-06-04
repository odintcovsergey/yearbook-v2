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
// 04.06.2026 (tz-sixth-collage-split.md): J-Sixth-6 = «1/6 класса»
// (метки sixthphoto_N → пул sixth), J-Collage-4 = «Коллаж»
// (метки collagephoto_N → пул collage).
const J_SIXTH_6 = makeMaster(
  'J-Sixth-6',
  Array.from({ length: 6 }, (_, i) => photoSlot(`sixthphoto_${i + 1}`)),
);
const J_COLLAGE_4 = makeMaster(
  'J-Collage-4',
  Array.from({ length: 4 }, (_, i) => photoSlot(`collagephoto_${i + 1}`)),
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
  J_SIXTH_6,
  J_COLLAGE_4,
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
  collage?: number;
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
      collage: urls(opts.collage ?? 0, 'collage'),
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
              { master_name: 'J-Sixth-6' }, // нужно 6 sixth-фото
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

  it('Дедупликация: 2 J-Collage-4 подряд с 8 collage-фото → берут разные фото', () => {
    // 04.06.2026: collagephoto_N читает из пула collage. Курсор collageUsed
    // сдвигается между двумя J-Collage-4 → вторая берёт следующие 4 фото,
    // а не те же. (Раньше тест проверял ту же логику на пуле sixth.)
    const bundle = makeBundle({
      preset: makePreset({
        id: 'test',
        section_structure: [
          {
            type: 'common_required',
            pages: [
              { master_name: 'J-Collage-4' }, // left
              { master_name: 'J-Collage-4' }, // right
            ],
          },
        ],
      }),
    });
    const result = buildFromSectionStructure(bundle, makeInput({ collage: 8 }));
    expect(result.spreads).toHaveLength(1);

    const left = result.spreads[0].left;
    const right = result.spreads[0].right;
    expect(left?.master_id).toBe('id-J-Collage-4');
    expect(right?.master_id).toBe('id-J-Collage-4');

    // Левая страница: первые 4 фото из collage-пула.
    expect(left?.bindings.collagephoto_1).toBe('https://cdn/collage_0.jpg');
    expect(left?.bindings.collagephoto_2).toBe('https://cdn/collage_1.jpg');
    expect(left?.bindings.collagephoto_3).toBe('https://cdn/collage_2.jpg');
    expect(left?.bindings.collagephoto_4).toBe('https://cdn/collage_3.jpg');

    // Правая страница: следующие 4 фото из collage-пула. КЛЮЧЕВАЯ
    // проверка — не повторяются с левой.
    expect(right?.bindings.collagephoto_1).toBe('https://cdn/collage_4.jpg');
    expect(right?.bindings.collagephoto_2).toBe('https://cdn/collage_5.jpg');
    expect(right?.bindings.collagephoto_3).toBe('https://cdn/collage_6.jpg');
    expect(right?.bindings.collagephoto_4).toBe('https://cdn/collage_7.jpg');

    // Глобально: все 8 фото уникальны.
    const allUsed = [
      left?.bindings.collagephoto_1,
      left?.bindings.collagephoto_2,
      left?.bindings.collagephoto_3,
      left?.bindings.collagephoto_4,
      right?.bindings.collagephoto_1,
      right?.bindings.collagephoto_2,
      right?.bindings.collagephoto_3,
      right?.bindings.collagephoto_4,
    ];
    expect(new Set(allUsed).size).toBe(8);
  });

  it('J-Collage-4 при пустом collage но полном quarter → page_skipped (а не пустые bindings)', () => {
    // Проверка идёт по правильному пулу collage: при collage=0 страница
    // не строится (а не строится с пустыми bindings.collagephoto_N).
    const bundle = makeBundle({
      preset: makePreset({
        id: 'test',
        section_structure: [
          {
            type: 'common_required',
            pages: [{ master_name: 'J-Collage-4' }],
          },
        ],
      }),
    });
    const result = buildFromSectionStructure(bundle, makeInput({
      collage: 0,
      quarter: 8,
    }));
    expect(result.spreads).toHaveLength(0);
    expect(
      result.warnings.some(
        (w) => w.includes('page_skipped') && w.includes('J-Collage-4'),
      ),
    ).toBe(true);
  });

  it('J-Collage-N универсальный (на примере 5 collage-плейсхолдеров) → collage-пул, count=5', () => {
    // Обобщённое поведение: любой мастер с N collagephoto-плейсхолдерами
    // (не только 4) корректно работает через collage-пул.
    // Это снимает необходимость править код при появлении J-Collage-3,
    // J-Collage-5, J-Collage-8 и т.п.
    const J_COLLAGE_5 = makeMaster(
      'J-Collage-5',
      Array.from({ length: 5 }, (_, i) => photoSlot(`collagephoto_${i + 1}`)),
    );
    const bundle = makeBundle({
      masters: [...ALL_J_MASTERS, J_COLLAGE_5],
      preset: makePreset({
        id: 'test',
        section_structure: [
          {
            type: 'common_required',
            pages: [{ master_name: 'J-Collage-5' }],
          },
        ],
      }),
    });
    const result = buildFromSectionStructure(bundle, makeInput({ collage: 5 }));
    expect(result.spreads).toHaveLength(1);
    const left = result.spreads[0].left;
    expect(left?.master_id).toBe('id-J-Collage-5');
    expect(left?.bindings.collagephoto_1).toBe('https://cdn/collage_0.jpg');
    expect(left?.bindings.collagephoto_5).toBe('https://cdn/collage_4.jpg');
  });
});

// ─── РЭ.38.1: fallback chain для common_required ────────────────────────
//
// Идея: если для запрошенного партнёром мастера не хватает фоток нужной
// категории — пробуем подобрать резервный из FALLBACK_CHAIN прежде чем
// оставить страницу пустой. Это даёт info-warning common_required_fallback_used
// вместо тревожного skip-warning'а.
//
// FALLBACK_CHAIN:
//   half_class → [J-Sixth-6, J-Full]
//   sixth      → [J-Half, J-Full]
//   collage    → [J-Half, J-Full]
//   full_class → [J-Half, J-Sixth-6]
//   quarter    → [J-Half, J-Sixth-6, J-Full]

describe('РЭ.38.1: fallback chain для common_required', () => {
  it('J-Half без half_class, но есть sixth → J-Sixth-6 как fallback + info warning', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'test',
        section_structure: [
          {
            type: 'common_required',
            pages: [{ master_name: 'J-Half' }],
          },
        ],
      }),
    });
    // half_class=0, sixth=6 → fallback J-Sixth-6 подойдёт
    const result = buildFromSectionStructure(bundle, makeInput({ half_class: 0, sixth: 6 }));
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-J-Sixth-6');
    // Запрошенный шаблон НЕ положен — фактически положен fallback
    expect(
      result.warnings.some((w) => w.startsWith('common_required_fallback_used')),
    ).toBe(true);
    // НЕ должно быть page_skipped (страница построилась через fallback)
    expect(
      result.warnings.some((w) => w.startsWith('common_required_page_skipped')),
    ).toBe(false);
  });

  it('J-Half без half_class и без sixth, но есть full_class → J-Full как fallback', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'test',
        section_structure: [
          {
            type: 'common_required',
            pages: [{ master_name: 'J-Half' }],
          },
        ],
      }),
    });
    // half_class=0, sixth=0, full_class=1 → J-Sixth-6 не подойдёт,
    // переходим к J-Full
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ half_class: 0, sixth: 0, full_class: 1 }),
    );
    expect(result.spreads[0].left?.master_id).toBe('id-J-Full');
    expect(
      result.warnings.some((w) => w.startsWith('common_required_fallback_used')),
    ).toBe(true);
  });

  it('J-Half вообще нет фоток ни одной категории → page_skipped как раньше', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'test',
        section_structure: [
          {
            type: 'common_required',
            pages: [{ master_name: 'J-Half' }],
          },
        ],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ half_class: 0, sixth: 0, full_class: 0, quarter: 0 }),
    );
    // Все fallback'и тоже не подошли → старое поведение
    expect(result.spreads).toHaveLength(0);
    expect(
      result.warnings.some((w) => w.startsWith('common_required_page_skipped')),
    ).toBe(true);
    expect(
      result.warnings.some((w) => w.startsWith('common_required_fallback_used')),
    ).toBe(false);
  });

  it('J-Sixth-6 без sixth, но есть half → J-Half как fallback', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'test',
        section_structure: [
          {
            type: 'common_required',
            pages: [{ master_name: 'J-Sixth-6' }],
          },
        ],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ half_class: 2, sixth: 0, full_class: 0 }),
    );
    expect(result.spreads[0].left?.master_id).toBe('id-J-Half');
    expect(
      result.warnings.some((w) => w.startsWith('common_required_fallback_used')),
    ).toBe(true);
  });

  it('J-Half с достаточным half_class → fallback НЕ срабатывает', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'test',
        section_structure: [
          {
            type: 'common_required',
            pages: [{ master_name: 'J-Half' }],
          },
        ],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ half_class: 2, sixth: 6, full_class: 1 }),
    );
    expect(result.spreads[0].left?.master_id).toBe('id-J-Half');
    expect(
      result.warnings.some((w) => w.startsWith('common_required_fallback_used')),
    ).toBe(false);
  });
});
