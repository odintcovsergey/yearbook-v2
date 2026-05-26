/**
 * Тесты для fillCommonAdditionalSection (РЭ.21.8.10).
 *
 * Покрывают:
 *  - max_spreads=0 → секция не строится, нет warnings
 *  - max_spreads=2 + Universal hard → 4 страницы по таблице
 *  - max_spreads=2 + Universal soft → начинается с null (пропуск 1-й)
 *  - Лимит max_spreads × 2 страниц соблюдается
 *  - row.additional_pages пустой (Light hard 16 уч) → 0 страниц
 *  - Bindings заполняются реальными фото
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

const ALL_MASTERS = [J_FULL, J_HALF, J_QUARTER_LEFT, J_QUARTER_RIGHT, J_COLLAGE_6];

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

function makeBundle(preset: Preset): RuleEngineBundle {
  const mastersByName = new Map<string, SpreadTemplate>();
  for (const m of ALL_MASTERS) mastersByName.set(m.name, m);
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
    spreads: ALL_MASTERS,
  };
  return {
    preset,
    rules: [],
    families: [],
    templateSet,
    mastersByName,
  };
}

function makeInput(opts: {
  students_count: number;
  full_class?: number;
  half_class?: number;
  quarter?: number;
  sixth?: number;
}): RulesAlbumInput {
  const urls = (n: number, label: string) =>
    Array.from({ length: n }, (_, i) => `https://cdn/${label}_${i}.jpg`);
  return {
    students: Array.from({ length: opts.students_count }, (_, i) => ({
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

describe('common_additional: основные сценарии', () => {
  it('max_spreads=0 → секция не строится, нет warnings', () => {
    const bundle = makeBundle(
      makePreset({
        id: 'universal',
        density: 'universal',
        sheet_type: 'hard',
        section_structure: [
          { type: 'common_additional', max_spreads: 0 },
        ],
      }),
    );
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 20, full_class: 5, half_class: 5, sixth: 24, quarter: 8 }),
    );
    expect(result.spreads).toHaveLength(0);
    expect(result.warnings.filter((w) => w.startsWith('common_additional'))).toEqual([]);
  });

  it('Universal hard + max_spreads=2 → 4 страницы (2 разворота)', () => {
    const bundle = makeBundle(
      makePreset({
        id: 'universal',
        density: 'universal',
        sheet_type: 'hard',
        section_structure: [
          { type: 'common_additional', max_spreads: 2 },
        ],
      }),
    );
    // Чтобы все 4 страницы построились — нужно фото для каждой попытки.
    // Первая попытка везде — J-Collage-6 (6 sixth) или J-Quarter (2 quarter).
    const result = buildFromSectionStructure(
      bundle,
      makeInput({
        students_count: 20,
        sixth: 12, // на 2 J-Collage-6 страницы
        quarter: 4, // на 2 J-Quarter (left+right) страницы
      }),
    );
    expect(result.spreads).toHaveLength(2);
    // Страницы 1-2 — J-Collage-6 (по первой попытке COLLAGE_OR_HALVES_OR_FULL)
    expect(result.spreads[0].left?.master_id).toBe('id-J-Collage-6');
    expect(result.spreads[0].right?.master_id).toBe('id-J-Collage-6');
    // Страницы 3-4 — J-Quarter-Left и -Right (первая попытка QUARTERS_OR_...)
    expect(result.spreads[1].left?.master_id).toBe('id-J-Quarter-Left');
    expect(result.spreads[1].right?.master_id).toBe('id-J-Quarter-Right');
  });

  it('Universal soft + max_spreads=2 → 3 страницы (1-я пропуск null)', () => {
    // У мягких ADDITIONAL_SOFT первая позиция null.
    // max_spreads=2 → max 4 страницы. Из них 1-я = null (пропуск),
    // строится: 2R + 3L + 4R = 3 страницы.
    const bundle = makeBundle(
      makePreset({
        id: 'universal',
        density: 'universal',
        sheet_type: 'soft',
        section_structure: [
          { type: 'common_additional', max_spreads: 2 },
        ],
      }),
    );
    const result = buildFromSectionStructure(
      bundle,
      makeInput({
        students_count: 20,
        sixth: 6,
        quarter: 4,
      }),
    );
    // РЭ.37.3.c: для soft binding pageInstances[0] идёт на RIGHT первого
    // разворота. Затем парная группировка с индекса 1:
    //   spread 0 = { right: J-Collage-6 }
    //   spread 1 = { left: J-Quarter-Right, right: J-Quarter-Left }
    //
    // Имена J-Quarter-Right / -Left наследуются от common_additional table,
    // которая сейчас нумерует мастера по index pageInstances (в layflat-логике).
    // Это известный side-effect — common_additional ещё не учитывает soft
    // adjustment, но физическая раскладка соответствует именам:
    // J-Quarter-Right на L разворот 2, J-Quarter-Left на R разворот 2.
    // Семантическая правка common_additional — отдельная фаза.
    expect(result.spreads).toHaveLength(2);
    expect(result.spreads[0].left).toBeUndefined();
    expect(result.spreads[0].right?.master_id).toBe('id-J-Collage-6');
    expect(result.spreads[1].left?.master_id).toBe('id-J-Quarter-Right');
    expect(result.spreads[1].right?.master_id).toBe('id-J-Quarter-Left');
  });

  it('Light hard 16 учеников → доп раздела нет (additional_pages пустой)', () => {
    const bundle = makeBundle(
      makePreset({
        id: 'light',
        density: 'light',
        sheet_type: 'hard',
        section_structure: [
          { type: 'common_additional', max_spreads: 2 },
        ],
      }),
    );
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 16, sixth: 12, quarter: 4 }),
    );
    expect(result.spreads).toHaveLength(0);
    // empty:by_table в decision_trace, но не warning
    expect(result.warnings.filter((w) => w.startsWith('common_additional'))).toEqual([]);
  });

  it('Лимит max_spreads=1 + Universal hard → только 2 страницы из 4 возможных', () => {
    const bundle = makeBundle(
      makePreset({
        id: 'universal',
        density: 'universal',
        sheet_type: 'hard',
        section_structure: [
          { type: 'common_additional', max_spreads: 1 },
        ],
      }),
    );
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 20, sixth: 24, quarter: 8 }),
    );
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-J-Collage-6');
    expect(result.spreads[0].right?.master_id).toBe('id-J-Collage-6');
  });

  it('Bindings: classphotoframe заполняется фото', () => {
    const bundle = makeBundle(
      makePreset({
        id: 'universal',
        density: 'universal',
        sheet_type: 'hard',
        section_structure: [
          { type: 'common_additional', max_spreads: 1 },
        ],
      }),
    );
    // Только full фото — 1-я попытка collage отвалится, 2-я half тоже,
    // 3-я full сработает.
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 20, full_class: 2 }),
    );
    expect(result.spreads[0].left?.master_id).toBe('id-J-Full');
    expect(result.spreads[0].left?.bindings.classphotoframe).toBe(
      'https://cdn/full_0.jpg',
    );
    expect(result.spreads[0].right?.bindings.classphotoframe).toBe(
      'https://cdn/full_1.jpg',
    );
  });
});

describe('common_additional: integration с common_required', () => {
  it('Universal hard чётное → common_required пустой (warning) + 2 разворота additional', () => {
    // РЭ.32.Б: common_required теперь требует явного pages[] списка.
    // Без него секция выдаёт warning 'common_required_empty' и страниц
    // не строит. Тест обновлён под это поведение — раньше ожидал что
    // engine auto-собирает required по density, но эта логика убрана.
    // Партнёр должен явно настроить общий раздел в редакторе шаблона.
    const bundle = makeBundle(
      makePreset({
        id: 'universal',
        density: 'universal',
        sheet_type: 'hard',
        section_structure: [
          { type: 'common_required' },  // pages не задан → пустой
          { type: 'common_additional', max_spreads: 2 },
        ],
      }),
    );
    const result = buildFromSectionStructure(
      bundle,
      makeInput({
        students_count: 20,
        sixth: 24,
        quarter: 8,
        half_class: 4,
        full_class: 0,
      }),
    );
    // Только additional строит развороты (2 шт). Required пропущен.
    expect(result.spreads).toHaveLength(2);
    // Warning о пустом required должен присутствовать.
    expect(
      result.warnings.some((w) => w.startsWith('common_required_empty')),
    ).toBe(true);
  });
});
