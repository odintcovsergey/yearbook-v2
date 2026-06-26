/**
 * Тесты для fillCommonAutoSection (РЭ.21.8.8) + bindings common-секции.
 *
 * Покрывают:
 *  - Auto режим: 1 spread (1 full + 2 half) → 1 разворот J-Full + J-Half
 *  - Auto режим: 12 sixth + лимит 2 → 1 разворот (не 2 — лучше меньше чем
 *    пустые слоты), warning common_autopack_underflow
 *  - Auto режим: фото только в одной категории → разворот из 2 одинаковых
 *    мастеров
 *  - Auto режим: вообще нет фото → 0 разворотов + underflow
 *  - Auto режим: max_spreads=0 → секция пропущена с warning, если фото есть
 *  - Spread фото игнорируются с warning common_no_spread_master
 *  - Bindings: classphotoframe, halfphoto_N, quarterphoto_N, sixthphoto_N,
 *    collagephoto_N заполняются реальными фото с cursor-логикой
 *  - Manual режим тоже теперь имеет реальные bindings (регрессионный тест)
 *  - Cursor: teachers G-FullClass + common auto → разные фото full_class
 */

import { describe, it, expect } from 'vitest';
import { buildFromSectionStructure } from '../build-from-section-structure';
import type {
  Preset,
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
import { commonMasterFields } from './__fixtures__/common-master-fields';

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
    ...commonMasterFields(name),
    is_fallback: false,
    mirror_for_soft: false,
    audit_notes: null,
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
]);
const J_QUARTER_RIGHT = makeMaster('J-Quarter-Right', [
  photoSlot('quarterphoto_1'),
  photoSlot('quarterphoto_2'),
]);
// 04.06.2026 (tz-sixth-collage-split.md): «1/6 класса» (sixthphoto_N → пул
// sixth) и «Коллаж» (collagephoto_N → пул collage) разведены.
const J_SIXTH_6 = makeMaster(
  'J-Sixth-6',
  Array.from({ length: 6 }, (_, i) => photoSlot(`sixthphoto_${i + 1}`)),
);
const J_COLLAGE_4 = makeMaster(
  'J-Collage-4',
  Array.from({ length: 4 }, (_, i) => photoSlot(`collagephoto_${i + 1}`)),
);

const ALL_MASTERS = [
  J_FULL,
  J_HALF,
  J_QUARTER_LEFT,
  J_QUARTER_RIGHT,
  J_SIXTH_6,
  J_COLLAGE_4,
];

function makePreset(
  opts: Partial<Preset> & Pick<Preset, 'id'>,
): Preset {
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
    rules: [] as Rule[],
    families: [] as TemplateFamily[],
    templateSet,
    mastersByName,
  };
}

function makeInput(common: {
  full_class?: number;
  half_class?: number;
  quarter?: number;
  sixth?: number;
  collage?: number;
  spread?: number;
}): RulesAlbumInput {
  function urls(n: number, label: string): string[] {
    const out: string[] = [];
    for (let i = 0; i < n; i++) out.push(`https://cdn/${label}_${i}.jpg`);
    return out;
  }
  return {
    students: [],
    subjects: [],
    head_teacher: { photo: null, name: '', role: '', text: '' },
    common_photos: {
      full_class: urls(common.full_class ?? 0, 'full'),
      half_class: urls(common.half_class ?? 0, 'half'),
      spread: urls(common.spread ?? 0, 'spread'),
      quarter: urls(common.quarter ?? 0, 'q'),
      sixth: urls(common.sixth ?? 0, 'sixth'),
      collage: urls(common.collage ?? 0, 'collage'),
    },
  };
}

// ─── 1. Auto: основные сценарии ─────────────────────────────────────────────

describe('common auto: основные сценарии', () => {
  it('1 full + 2 half + лимит 2 → 1 разворот J-Full + J-Half, underflow', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [{ type: 'common', mode: 'auto', max_spreads: 2 }],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ full_class: 1, half_class: 2 }),
    );
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-J-Full');
    expect(result.spreads[0].right?.master_id).toBe('id-J-Half');
    expect(
      result.warnings.some((w) =>
        w.startsWith('common_autopack_underflow'),
      ),
    ).toBe(true);
  });

  it('12 sixth + лимит 2 → 1 разворот J-Sixth-6 + J-Sixth-6 (полностью), underflow', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [{ type: 'common', mode: 'auto', max_spreads: 2 }],
      }),
    });
    const result = buildFromSectionStructure(bundle, makeInput({ sixth: 12 }));
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-J-Sixth-6');
    expect(result.spreads[0].right?.master_id).toBe('id-J-Sixth-6');
    expect(
      result.warnings.some((w) =>
        w.startsWith('common_autopack_underflow'),
      ),
    ).toBe(true);
  });

  it('24 sixth + лимит 2 → 2 разворота J-Sixth-6 × 4, без underflow', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [{ type: 'common', mode: 'auto', max_spreads: 2 }],
      }),
    });
    const result = buildFromSectionStructure(bundle, makeInput({ sixth: 24 }));
    expect(result.spreads).toHaveLength(2);
    expect(result.spreads.every((s) => s.left?.master_id === 'id-J-Sixth-6')).toBe(true);
    expect(result.spreads.every((s) => s.right?.master_id === 'id-J-Sixth-6')).toBe(true);
    expect(
      result.warnings.some((w) => w.startsWith('common_autopack_underflow')),
    ).toBe(false);
  });

  it('Смешанный пул: 2 full + 4 half + 6 sixth + лимит 3 → жадно крупное вперёд', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [{ type: 'common', mode: 'auto', max_spreads: 3 }],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ full_class: 2, half_class: 4, sixth: 6 }),
    );
    // Page 0 (L): full → J-Full
    // Page 1 (R): full → J-Full (ещё осталось 1)
    // На самом деле full=2 даст 2 страницы J-Full, потом half=4 → 2 страницы J-Half,
    // потом sixth=6 → 1 страница J-Sixth-6, но это будет 5 страниц = не кратно 2
    // На развороте 3 (4-я и 5-я страницы): half + collage. Дальше фото нет.
    expect(result.spreads.length).toBeGreaterThanOrEqual(2);
    expect(result.spreads[0].left?.master_id).toBe('id-J-Full');
    expect(result.spreads[0].right?.master_id).toBe('id-J-Full');
    expect(result.spreads[1].left?.master_id).toBe('id-J-Half');
    expect(result.spreads[1].right?.master_id).toBe('id-J-Half');
  });

  it('Нет фото → 0 разворотов, underflow', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [{ type: 'common', mode: 'auto', max_spreads: 2 }],
      }),
    });
    const result = buildFromSectionStructure(bundle, makeInput({}));
    expect(result.spreads).toHaveLength(0);
    expect(
      result.warnings.some((w) => w.startsWith('common_autopack_underflow')),
    ).toBe(true);
  });

  it('max_spreads=0 + есть фото → секция пропущена, warning disabled', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [{ type: 'common', mode: 'auto', max_spreads: 0 }],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ full_class: 2 }),
    );
    expect(result.spreads).toHaveLength(0);
    expect(
      result.warnings.some((w) => w.startsWith('common_autopack_disabled')),
    ).toBe(true);
  });

  it('Только 1 фото full + лимит 1 → 0 разворотов (1 страница без пары)', () => {
    // Левая получилась (J-Full), правую сделать не из чего → откат, underflow.
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [{ type: 'common', mode: 'auto', max_spreads: 1 }],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ full_class: 1 }),
    );
    expect(result.spreads).toHaveLength(0);
    expect(
      result.warnings.some((w) => w.startsWith('common_autopack_underflow')),
    ).toBe(true);
  });
});

// ─── 2. Auto: spread фото игнорируются ──────────────────────────────────────

describe('common auto: spread фото без мастера', () => {
  it('Есть spread фото → warning common_no_spread_master, остальное работает', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [{ type: 'common', mode: 'auto', max_spreads: 1 }],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ spread: 2, full_class: 1, half_class: 2 }),
    );
    expect(
      result.warnings.some((w) =>
        w.startsWith('common_no_spread_master'),
      ),
    ).toBe(true);
    // Остальные категории всё равно собрались
    expect(result.spreads).toHaveLength(1);
  });
});

// ─── 3. Auto: разведение sixth и collage по разным мастерам ─────────────────

describe('common auto: sixth → J-Sixth-6, collage → J-Collage-4', () => {
  it('6 sixth + 4 collage + лимит 2 → J-Sixth-6 (L) + J-Collage-4 (R)', () => {
    // 04.06.2026: пулы 1/6 и коллажа разведены. J-Sixth-6 берёт 6 фото 1/6,
    // J-Collage-4 — 4 коллажных. Раньше J-Collage-4 был «хвостом» 1/6 — это
    // была ошибка (см. tz-sixth-collage-split.md).
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [{ type: 'common', mode: 'auto', max_spreads: 2 }],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ sixth: 6, collage: 4 }),
    );
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-J-Sixth-6');
    expect(result.spreads[0].right?.master_id).toBe('id-J-Collage-4');
  });

  it('collage фото больше не теряются: 4 collage + 1 full + лимит 1 → размещены', () => {
    // Регрессия на баг утечки common_collage (раньше collage-фото молча
    // выбрасывались в build-album-input).
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [{ type: 'common', mode: 'auto', max_spreads: 1 }],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ full_class: 1, collage: 4 }),
    );
    expect(result.spreads).toHaveLength(1);
    const ids = [
      result.spreads[0].left?.master_id,
      result.spreads[0].right?.master_id,
    ];
    expect(ids).toContain('id-J-Collage-4');
    expect(ids).toContain('id-J-Full');
  });
});

// ─── 4. Bindings ────────────────────────────────────────────────────────────

describe('common auto: bindings заполняются реальными фото', () => {
  it('J-Full: classphotoframe', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [{ type: 'common', mode: 'auto', max_spreads: 1 }],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ full_class: 2 }),
    );
    expect(result.spreads[0].left?.bindings.classphotoframe).toBe(
      'https://cdn/full_0.jpg',
    );
    expect(result.spreads[0].right?.bindings.classphotoframe).toBe(
      'https://cdn/full_1.jpg',
    );
  });

  it('J-Half: halfphoto_1 + halfphoto_2 с cursor', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [{ type: 'common', mode: 'auto', max_spreads: 1 }],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ half_class: 4 }),
    );
    expect(result.spreads[0].left?.bindings.halfphoto_1).toBe(
      'https://cdn/half_0.jpg',
    );
    expect(result.spreads[0].left?.bindings.halfphoto_2).toBe(
      'https://cdn/half_1.jpg',
    );
    expect(result.spreads[0].right?.bindings.halfphoto_1).toBe(
      'https://cdn/half_2.jpg',
    );
    expect(result.spreads[0].right?.bindings.halfphoto_2).toBe(
      'https://cdn/half_3.jpg',
    );
  });

  it('J-Sixth-6: sixthphoto_1..6 первый разворот, потом 7..12 второй', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [{ type: 'common', mode: 'auto', max_spreads: 2 }],
      }),
    });
    const result = buildFromSectionStructure(bundle, makeInput({ sixth: 24 }));
    expect(result.spreads[0].left?.bindings.sixthphoto_1).toBe(
      'https://cdn/sixth_0.jpg',
    );
    expect(result.spreads[0].left?.bindings.sixthphoto_6).toBe(
      'https://cdn/sixth_5.jpg',
    );
    expect(result.spreads[0].right?.bindings.sixthphoto_1).toBe(
      'https://cdn/sixth_6.jpg',
    );
    expect(result.spreads[1].left?.bindings.sixthphoto_1).toBe(
      'https://cdn/sixth_12.jpg',
    );
  });

  it('J-Collage-4: collagephoto_1..4 заполняются из пула collage', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [{ type: 'common', mode: 'auto', max_spreads: 1 }],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ collage: 8 }),
    );
    expect(result.spreads[0].left?.bindings.collagephoto_1).toBe(
      'https://cdn/collage_0.jpg',
    );
    expect(result.spreads[0].left?.bindings.collagephoto_4).toBe(
      'https://cdn/collage_3.jpg',
    );
    expect(result.spreads[0].right?.bindings.collagephoto_1).toBe(
      'https://cdn/collage_4.jpg',
    );
  });

  it('Manual режим тоже даёт реальные bindings (регрессия)', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [{ type: 'common', slots: ['FULL', 'H'] }],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ full_class: 1, half_class: 2 }),
    );
    expect(result.spreads[0].left?.bindings.classphotoframe).toBe(
      'https://cdn/full_0.jpg',
    );
    expect(result.spreads[0].right?.bindings.halfphoto_1).toBe(
      'https://cdn/half_0.jpg',
    );
    expect(result.spreads[0].right?.bindings.halfphoto_2).toBe(
      'https://cdn/half_1.jpg',
    );
  });
});

// ─── 4. J-Quarter (page-any) предпочитается паре Left/Right ──────────────────
describe('common auto: J-Quarter page-any vs пара Left/Right', () => {
  const J_QUARTER_ANY = makeMaster('J-Quarter', [
    photoSlot('quarterphoto_1'),
    photoSlot('quarterphoto_2'),
  ]);

  it('есть J-Quarter → обе страницы используют его (правую зеркалит рендер)', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [{ type: 'common', mode: 'auto', max_spreads: 1 }],
      }),
      masters: [J_FULL, J_HALF, J_QUARTER_ANY, J_SIXTH_6, J_COLLAGE_4],
    });
    const result = buildFromSectionStructure(bundle, makeInput({ quarter: 4 }));
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-J-Quarter');
    expect(result.spreads[0].right?.master_id).toBe('id-J-Quarter');
  });

  it('только пара Left/Right (без J-Quarter) → старый путь (регресс)', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [{ type: 'common', mode: 'auto', max_spreads: 1 }],
      }),
      // ALL_MASTERS содержит J-Quarter-Left/Right, но НЕ J-Quarter
    });
    const result = buildFromSectionStructure(bundle, makeInput({ quarter: 4 }));
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-J-Quarter-Left');
    expect(result.spreads[0].right?.master_id).toBe('id-J-Quarter-Right');
  });
});

// ─── 5. Коллаж: count-aware выбор крупнейшего помещающегося мастера ──────────
describe('common auto: J-Collage-6/5/4/3 по числу collage-фото', () => {
  const J_COLLAGE_3 = makeMaster(
    'J-Collage-3',
    Array.from({ length: 3 }, (_, i) => photoSlot(`collagephoto_${i + 1}`)),
  );
  const J_COLLAGE_5 = makeMaster(
    'J-Collage-5',
    Array.from({ length: 5 }, (_, i) => photoSlot(`collagephoto_${i + 1}`)),
  );
  const J_COLLAGE_6 = makeMaster(
    'J-Collage-6',
    Array.from({ length: 6 }, (_, i) => photoSlot(`collagephoto_${i + 1}`)),
  );
  const FULL_COLLAGE_SET = [
    J_FULL, J_HALF, J_SIXTH_6,
    J_COLLAGE_3, J_COLLAGE_4, J_COLLAGE_5, J_COLLAGE_6,
  ];

  function runCollage(masters: SpreadTemplate[], collage: number, maxSpreads = 1) {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [{ type: 'common', mode: 'auto', max_spreads: maxSpreads }],
      }),
      masters,
    });
    return buildFromSectionStructure(bundle, makeInput({ collage }));
  }

  it('12 collage → обе страницы J-Collage-6 (крупнейший)', () => {
    const result = runCollage(FULL_COLLAGE_SET, 12);
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-J-Collage-6');
    expect(result.spreads[0].right?.master_id).toBe('id-J-Collage-6');
  });

  it('6 collage на странице → J-Collage-6 (а не 5/4/3)', () => {
    // 1 разворот: левая 6 (J-Collage-6, 6 осталось), правая 6 (J-Collage-6).
    const result = runCollage(FULL_COLLAGE_SET, 12, 1);
    expect(result.spreads[0].left?.master_id).toBe('id-J-Collage-6');
  });

  it('только J-Collage-3 в наборе: 6 collage → обе страницы J-Collage-3', () => {
    const result = runCollage([J_FULL, J_HALF, J_SIXTH_6, J_COLLAGE_3], 6);
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-J-Collage-3');
    expect(result.spreads[0].right?.master_id).toBe('id-J-Collage-3');
  });

  it('только J-Collage-4: 8 collage → обе J-Collage-4', () => {
    const result = runCollage([J_FULL, J_HALF, J_SIXTH_6, J_COLLAGE_4], 8);
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-J-Collage-4');
    expect(result.spreads[0].right?.master_id).toBe('id-J-Collage-4');
  });

  it('деградация: только J-Collage-4 + 6 collage → не падает, underflow-warning', () => {
    // Левая берёт J-Collage-4 (4), на правую остаётся 2 (< 3) → откат пары,
    // 0 разворотов, collage не теряются (восстановлены), warning есть.
    const result = runCollage([J_FULL, J_HALF, J_SIXTH_6, J_COLLAGE_4], 6);
    expect(result.spreads).toHaveLength(0);
    expect(
      result.warnings.some((w) => w.startsWith('common_autopack_underflow')),
    ).toBe(true);
  });
});
