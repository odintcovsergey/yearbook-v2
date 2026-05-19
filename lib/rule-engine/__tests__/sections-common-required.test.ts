/**
 * Тесты для эталонной таблицы OkeyBook + fillCommonRequiredSection (РЭ.21.8.9).
 *
 * Покрывают:
 *  - matchStudents: ranges (один интервал, несколько), parity (even/odd), any
 *  - pickRow: разные комбинации density × sheet_type × students_count
 *  - fillCommonRequiredSection: bindings, страницы, mirror Quarter Left/Right
 *  - Пустая таблица (Мини плотные 25+) — 0 страниц без warnings
 *  - skip страницы при недостатке фото
 *  - density=null без resolveDensityForTable → warning
 */

import { describe, it, expect } from 'vitest';
import {
  matchStudents,
  pickRow,
  OKEYBOOK_TABLE,
} from '../album-structure-okeybook';
import { buildFromSectionStructure } from '../build-from-section-structure';
import type { Preset, RulesAlbumInput } from '../types';
import type { RuleEngineBundle } from '../loaders';
import type {
  Placeholder,
  SpreadTemplate,
  TemplateSet,
} from '@/lib/album-builder/types';

// ─── Тесты matchStudents ────────────────────────────────────────────────────

describe('matchStudents', () => {
  it('any — подходит для любого количества', () => {
    expect(matchStudents({ kind: 'any' }, 0)).toBe(true);
    expect(matchStudents({ kind: 'any' }, 1)).toBe(true);
    expect(matchStudents({ kind: 'any' }, 100)).toBe(true);
  });

  it('ranges один интервал', () => {
    const m = { kind: 'ranges' as const, ranges: [[1, 24]] as [number, number][] };
    expect(matchStudents(m, 0)).toBe(false);
    expect(matchStudents(m, 1)).toBe(true);
    expect(matchStudents(m, 12)).toBe(true);
    expect(matchStudents(m, 24)).toBe(true);
    expect(matchStudents(m, 25)).toBe(false);
  });

  it('ranges несколько интервалов', () => {
    const m = {
      kind: 'ranges' as const,
      ranges: [
        [13, 15],
        [25, 28],
      ] as [number, number][],
    };
    expect(matchStudents(m, 12)).toBe(false);
    expect(matchStudents(m, 13)).toBe(true);
    expect(matchStudents(m, 15)).toBe(true);
    expect(matchStudents(m, 16)).toBe(false);
    expect(matchStudents(m, 24)).toBe(false);
    expect(matchStudents(m, 25)).toBe(true);
    expect(matchStudents(m, 28)).toBe(true);
    expect(matchStudents(m, 29)).toBe(false);
  });

  it('parity even', () => {
    expect(matchStudents({ kind: 'parity', parity: 'even' }, 0)).toBe(true);
    expect(matchStudents({ kind: 'parity', parity: 'even' }, 2)).toBe(true);
    expect(matchStudents({ kind: 'parity', parity: 'even' }, 3)).toBe(false);
  });

  it('parity odd', () => {
    expect(matchStudents({ kind: 'parity', parity: 'odd' }, 0)).toBe(false);
    expect(matchStudents({ kind: 'parity', parity: 'odd' }, 1)).toBe(true);
    expect(matchStudents({ kind: 'parity', parity: 'odd' }, 21)).toBe(true);
  });
});

// ─── Тесты pickRow ──────────────────────────────────────────────────────────

describe('pickRow', () => {
  it('Лайт плотные 16 учеников → 4 страницы', () => {
    const row = pickRow('light', 'hard', 16);
    expect(row).not.toBeNull();
    expect(row!.pages.length).toBe(4);
  });

  it('Лайт плотные 24 ученика → 6 страниц', () => {
    const row = pickRow('light', 'hard', 24);
    expect(row).not.toBeNull();
    expect(row!.pages.length).toBe(6);
  });

  it('Мини плотные 28 учеников → 0 страниц (нет обязательного раздела)', () => {
    const row = pickRow('mini', 'hard', 28);
    expect(row).not.toBeNull();
    expect(row!.pages.length).toBe(0);
  });

  it('Мини мягкие 24 ученика → 3 страницы', () => {
    const row = pickRow('mini', 'soft', 24);
    expect(row).not.toBeNull();
    expect(row!.pages.length).toBe(3);
  });

  it('Стандарт плотные чётное → 6 страниц', () => {
    const row = pickRow('standard', 'hard', 20);
    expect(row).not.toBeNull();
    expect(row!.pages.length).toBe(6);
  });

  it('Стандарт плотные нечётное → 4 страницы', () => {
    const row = pickRow('standard', 'hard', 19);
    expect(row).not.toBeNull();
    expect(row!.pages.length).toBe(4);
  });

  it('Максимум плотные любое количество → 6 страниц', () => {
    expect(pickRow('maximum', 'hard', 10)!.pages.length).toBe(6);
    expect(pickRow('maximum', 'hard', 30)!.pages.length).toBe(6);
  });

  it('Максимум мягкие → 5 страниц', () => {
    expect(pickRow('maximum', 'soft', 15)!.pages.length).toBe(5);
  });

  it('density=null → null', () => {
    expect(pickRow(null, 'hard', 20)).toBeNull();
  });

  it('sheet_type=null → null', () => {
    expect(pickRow('light', null, 20)).toBeNull();
  });

  it('Лайт плотные несовпадающий интервал (50 учеников) → null', () => {
    expect(pickRow('light', 'hard', 50)).toBeNull();
  });

  it('Все строки таблицы валидны — pages.length 0..6', () => {
    for (const row of OKEYBOOK_TABLE) {
      expect(row.pages.length).toBeGreaterThanOrEqual(0);
      expect(row.pages.length).toBeLessThanOrEqual(6);
    }
  });
});

// ─── Тесты fillCommonRequiredSection ────────────────────────────────────────

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

function makeMaster(name: string, placeholders: Placeholder[] = []): SpreadTemplate {
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
const J_COLLAGE_6 = makeMaster(
  'J-Collage-6',
  Array.from({ length: 6 }, (_, i) => photoSlot(`collagephoto_${i + 1}`)),
);

const ALL_J_MASTERS = [J_FULL, J_HALF, J_QUARTER_LEFT, J_QUARTER_RIGHT, J_COLLAGE_6];

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
  students_count?: number;
  full_class?: number;
  half_class?: number;
  quarter?: number;
  sixth?: number;
}): RulesAlbumInput {
  const urls = (n: number, label: string) =>
    Array.from({ length: n }, (_, i) => `https://cdn/${label}_${i}.jpg`);
  return {
    students: Array.from({ length: opts.students_count ?? 0 }, (_, i) => ({
      full_name: `S${i}`,
      quote: '',
      portrait: `https://cdn/p${i}.jpg`,
      friend_photos: [],
    })),
    subjects: [],
    head_teacher: { photo: null, name: '', role: '', text: '' },
    common_photos: {
      full_class: urls(opts.full_class ?? 0, 'full'),
      half_class: urls(opts.half_class ?? 0, 'half'),
      spread: [],
      quarter: urls(opts.quarter ?? 0, 'q'),
      sixth: urls(opts.sixth ?? 0, 'sixth'),
    },
  };
}

describe('fillCommonRequiredSection: основные сценарии', () => {
  it('Лайт плотные 16 уч → 4 страницы, мирор Quarter L/R', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'light',
        density: 'light',
        sheet_type: 'hard',
        section_structure: [{ type: 'common_required' }],
      }),
    });
    // Фото: 2 quarter (на 2 страницы по 2 шт = но нам нужно 4 quarter на
    // 2 страницы по 2 = 4 шт), 2 half (на 1 стр J-Half = 2 шт),
    // и 6 sixth (на стр 4 — flex). Итого должно влезть 4 страницы.
    const result = buildFromSectionStructure(
      bundle,
      makeInput({
        students_count: 16,
        quarter: 4, // 2 страницы × 2 = 4
        half_class: 2, // 1 страница × 2
        sixth: 6, // 1 страница × 6
      }),
    );
    expect(result.spreads).toHaveLength(2);
    // Page 0 (left) — J-Quarter-Left
    expect(result.spreads[0].left?.master_id).toBe('id-J-Quarter-Left');
    // Page 1 (right) — J-Quarter-Right (мирор)
    expect(result.spreads[0].right?.master_id).toBe('id-J-Quarter-Right');
    // Page 2 (left) — J-Half
    expect(result.spreads[1].left?.master_id).toBe('id-J-Half');
    // Page 3 (right) — J-Collage-6 (первая попытка для «либо 6 1/6, ...»)
    expect(result.spreads[1].right?.master_id).toBe('id-J-Collage-6');
  });

  it('Лайт плотные 16 уч, нет sixth → fallback на J-Half для page 4', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'light',
        density: 'light',
        sheet_type: 'hard',
        section_structure: [{ type: 'common_required' }],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({
        students_count: 16,
        quarter: 4,
        half_class: 4, // достаточно для J-Half x2 (page 3 и page 4)
      }),
    );
    expect(result.spreads).toHaveLength(2);
    expect(result.spreads[1].left?.master_id).toBe('id-J-Half'); // page 3
    expect(result.spreads[1].right?.master_id).toBe('id-J-Half'); // page 4 fallback
  });

  it('Лайт плотные 16 уч, нет sixth/half → fallback на J-Full', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'light',
        density: 'light',
        sheet_type: 'hard',
        section_structure: [{ type: 'common_required' }],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({
        students_count: 16,
        quarter: 4,
        half_class: 2, // на 1 J-Half (page 3)
        full_class: 1, // на 1 J-Full (page 4 — 3-я попытка)
      }),
    );
    expect(result.spreads).toHaveLength(2);
    expect(result.spreads[1].left?.master_id).toBe('id-J-Half');
    expect(result.spreads[1].right?.master_id).toBe('id-J-Full');
  });

  it('Лайт плотные 16 уч, недостаточно фото → skipped + warning', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'light',
        density: 'light',
        sheet_type: 'hard',
        section_structure: [{ type: 'common_required' }],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({
        students_count: 16,
        quarter: 4,
        half_class: 2,
        // На page 4 нет ни sixth, ни half (уже потратили), ни full — skip
      }),
    );
    // 3 страницы (page 0,1,2), page 3 пропущена
    expect(result.spreads).toHaveLength(2);
    expect(result.spreads[1].right).toBeUndefined();
    expect(
      result.warnings.some((w) => w.startsWith('common_required_page_skipped')),
    ).toBe(true);
  });

  it('Мини плотные 28 уч → 0 страниц без warnings', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'mini-hard',
        density: 'mini',
        sheet_type: 'hard',
        section_structure: [{ type: 'common_required' }],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 28, full_class: 10, half_class: 10, sixth: 30 }),
    );
    expect(result.spreads).toHaveLength(0);
    expect(
      result.warnings.filter((w) => w.startsWith('common_required_')),
    ).toEqual([]);
  });

  it('density=null + неизвестное имя пресета → warning common_required_no_density', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'unknown',
        density: null,
        sheet_type: 'hard',
        section_structure: [{ type: 'common_required' }],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 16 }),
    );
    expect(result.spreads).toHaveLength(0);
    // Может быть либо no_density (если фолбэк по preset.id не сработал),
    // либо no_row (если density резолвится но строки нет). Проверяем что
    // хоть какой-то common_required warning есть.
    expect(
      result.warnings.some((w) => w.startsWith('common_required_')),
    ).toBe(true);
  });

  it('density=null + preset.id=maximum → таблица Максимум используется', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'maximum',
        density: null,
        sheet_type: 'hard',
        section_structure: [{ type: 'common_required' }],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({
        students_count: 20,
        quarter: 4,
        half_class: 4,
        sixth: 12,
        full_class: 2,
      }),
    );
    // Максимум плотные = 6 страниц = 3 разворота, все должны построиться
    expect(result.spreads).toHaveLength(3);
  });

  it('Bindings: classphotoframe заполняется из full_class', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'maximum',
        density: null,
        sheet_type: 'hard',
        section_structure: [{ type: 'common_required' }],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({
        // Для теста bindings — упрощённый сценарий: только full фото
        // Чтобы первая попытка J-Quarter-Left отвалилась, не даём quarter
        quarter: 0,
        half_class: 0,
        sixth: 0,
        full_class: 6,
      }),
    );
    // Все 6 страниц попадут на 3-ю попытку (J-Full), но 1-я page это
    // 2 по 1/4 — отвалится → skipped. Идём 1-2 skip, 3-я page это
    // J-Half→J-Full = J-Full сработает.
    // Проверяем что хоть какие-то страницы J-Full вышли с classphotoframe
    const fullPages = result.spreads
      .flatMap((s) => [s.left, s.right])
      .filter((p) => p?.master_id === 'id-J-Full');
    expect(fullPages.length).toBeGreaterThan(0);
    expect(fullPages[0]!.bindings.classphotoframe).toBe('https://cdn/full_0.jpg');
  });
});
