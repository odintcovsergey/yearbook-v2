/**
 * Тесты для soft_intro / soft_final / min_pages / max_pages enforcement
 * (РЭ.21.8.5).
 */

import { describe, it, expect } from 'vitest';
import { buildFromSectionStructure } from '../build-from-section-structure';
import type {
  Preset,
  PresetDensity,
  Rule,
  RulesAlbumInput,
  SheetType,
  TemplateFamily,
} from '../types';
import type { RuleEngineBundle } from '../loaders';
import type {
  Placeholder,
  SpreadTemplate,
  TemplateSet,
} from '@/lib/album-builder/types';

// ─── Минимальные фикстуры ───────────────────────────────────────────────────

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
    page_role: null,
    slot_capacity: null,
    is_fallback: false,
    mirror_for_soft: false,
    audit_notes: null,
  };
}

const S_INTRO = makeMaster('S-Intro', [photoSlot('classphotoframe')]);
const S_FINAL = makeMaster('S-Final', [photoSlot('classphotoframe')]);
const S_FINAL_SOFT_L = makeMaster('S-Final-Soft-L', [
  photoSlot('classphotoframe'),
]);
const J_HALF = makeMaster('J-Half', [
  photoSlot('halfphoto_1'),
  photoSlot('halfphoto_2'),
]);
const J_CLASS_PHOTO = makeMaster('J-Full', [photoSlot('classphotoframe')]);
const J_CLASS_PHOTO_RIGHT = makeMaster('J-Full', [
  photoSlot('classphotoframe'),
]);

const ALL_MASTERS: SpreadTemplate[] = [
  S_INTRO,
  S_FINAL,
  S_FINAL_SOFT_L,
  J_HALF,
  J_CLASS_PHOTO,
  J_CLASS_PHOTO_RIGHT,
];

function makePreset(
  opts: Partial<Preset> &
    Pick<Preset, 'id'> & {
      density?: PresetDensity | null;
      sheet_type?: SheetType | null;
      min_pages?: number | null;
      max_pages?: number | null;
    },
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
    density: opts.density ?? null,
    sheet_type: opts.sheet_type ?? null,
    min_pages: opts.min_pages ?? null,
    max_pages: opts.max_pages ?? null,
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

function makeInput(opts: {
  full_class?: number;
  half_class?: number;
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
      full_class: urls(opts.full_class ?? 0, 'full'),
      half_class: urls(opts.half_class ?? 0, 'half'),
      spread: [],
      quarter: [],
      sixth: [],
      collage: [],
    },
  };
}

// ─── soft_intro ─────────────────────────────────────────────────────────────

describe('soft_intro', () => {
  it("sheet_type='soft' + full_class → 1 страница S-Intro + classphotoframe", () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        sheet_type: 'soft',
        section_structure: [{ type: 'soft_intro' }],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ full_class: 1 }),
    );
    expect(result.status).toBe('ok');
    expect(result.spreads).toHaveLength(1);
    // РЭ.37.3.c: для soft binding page 1 (LEFT первого разворота) — это
    // обложка/forzac, физически отсутствует в pageInstances. Первый
    // PageInstance ложится на RIGHT первого разворота.
    expect(result.spreads[0].left).toBeUndefined();
    expect(result.spreads[0].right?.master_id).toBe('id-S-Intro');
    expect(result.spreads[0].right?.bindings.classphotoframe).toBe(
      'https://cdn/full_0.jpg',
    );
  });

  it("sheet_type='hard' → warning soft_intro_skipped, нет страниц", () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        sheet_type: 'hard',
        section_structure: [{ type: 'soft_intro' }],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ full_class: 1 }),
    );
    expect(result.spreads).toEqual([]);
    expect(
      result.warnings.some((w) => w.startsWith('soft_intro_skipped')),
    ).toBe(true);
  });

  it("sheet_type='soft' без full_class → S-Intro без classphotoframe (slot пуст)", () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        sheet_type: 'soft',
        section_structure: [{ type: 'soft_intro' }],
      }),
    });
    const result = buildFromSectionStructure(bundle, makeInput({}));
    expect(result.spreads).toHaveLength(1);
    // РЭ.37.3.c: S-Intro на RIGHT первого разворота для soft.
    expect(result.spreads[0].right?.master_id).toBe('id-S-Intro');
    expect(result.spreads[0].right?.bindings.classphotoframe).toBeUndefined();
  });

  it('S-Intro отсутствует → warning soft_intro_master_not_found', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        sheet_type: 'soft',
        section_structure: [{ type: 'soft_intro' }],
      }),
      masters: [],
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ full_class: 1 }),
    );
    expect(
      result.warnings.some((w) =>
        w.startsWith('soft_intro_master_not_found'),
      ),
    ).toBe(true);
  });
});

// ─── soft_final ─────────────────────────────────────────────────────────────

describe('soft_final', () => {
  it("sheet_type='soft' → S-Final", () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        sheet_type: 'soft',
        section_structure: [{ type: 'soft_final' }],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ full_class: 1 }),
    );
    expect(result.spreads[0].left?.master_id).toBe('id-S-Final');
    expect(result.spreads[0].left?.bindings.classphotoframe).toBe(
      'https://cdn/full_0.jpg',
    );
  });

  it("sheet_type='soft' + только S-Final-Soft-L → fallback на него", () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        sheet_type: 'soft',
        section_structure: [{ type: 'soft_final' }],
      }),
      masters: [S_FINAL_SOFT_L],
    });
    const result = buildFromSectionStructure(bundle, makeInput({}));
    expect(result.spreads[0].left?.master_id).toBe('id-S-Final-Soft-L');
  });

  it("sheet_type='hard' → warning soft_final_skipped", () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        sheet_type: 'hard',
        section_structure: [{ type: 'soft_final' }],
      }),
    });
    const result = buildFromSectionStructure(bundle, makeInput({}));
    expect(result.spreads).toEqual([]);
    expect(
      result.warnings.some((w) => w.startsWith('soft_final_skipped')),
    ).toBe(true);
  });

  it('Ни S-Final ни S-Final-Soft-L → warning soft_final_master_not_found', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        sheet_type: 'soft',
        section_structure: [{ type: 'soft_final' }],
      }),
      masters: [],
    });
    const result = buildFromSectionStructure(bundle, makeInput({}));
    expect(
      result.warnings.some((w) =>
        w.startsWith('soft_final_master_not_found'),
      ),
    ).toBe(true);
  });

  it('intro и final потребляют разные full_class (cursor работает)', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        sheet_type: 'soft',
        section_structure: [{ type: 'soft_intro' }, { type: 'soft_final' }],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ full_class: 2 }),
    );
    // РЭ.37.3.c: для soft binding pageInstances = [S-Intro (no section_start),
    // S-Final (section_start=true из SECTIONS_THAT_START_NEW_SPREAD)].
    // Группировка:
    //   spread 0 = { right: S-Intro }              (soft-сдвиг: первая на right)
    //   spread 1 = { left: S-Final, right: undef } (section_start → новый разворот, S-Final на L)
    expect(result.spreads).toHaveLength(2);
    // S-Intro на правой первого разворота, classphoto из cursor=0
    expect(result.spreads[0].left).toBeUndefined();
    expect(result.spreads[0].right?.bindings.classphotoframe).toBe(
      'https://cdn/full_0.jpg',
    );
    // S-Final на левой второго разворота, classphoto из cursor=1
    expect(result.spreads[1].left?.bindings.classphotoframe).toBe(
      'https://cdn/full_1.jpg',
    );
    expect(result.spreads[1].right).toBeUndefined();
  });
});

// ─── min_pages / max_pages enforcement ─────────────────────────────────────

describe('min_pages / max_pages enforcement', () => {
  it('max_pages=2, секция выдаёт 4 страницы → обрезано до 2 + warning overflow', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        max_pages: 2,
        section_structure: [{ type: 'common', slots: ['H', 'H'] }],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ half_class: 4 }),
    );
    // 2 H-страницы = 2 strана; max=2 → влезает, без обрезки
    expect(result.spreads).toHaveLength(1);
    expect(
      result.warnings.some((w) => w.startsWith('pages_overflow_truncated')),
    ).toBe(false);
  });

  it('max_pages=3, секция выдаёт 4 страницы → обрезано до 3 + warning', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        max_pages: 3,
        section_structure: [
          { type: 'common', slots: ['H', 'H', 'H', 'H'] },
        ],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ half_class: 8 }),
    );
    // common выдал 4 страницы H, max=3 → срезаем последнюю.
    // 3 страницы = 2 разворота (1+1 одиночка)
    expect(result.spreads).toHaveLength(2);
    expect(result.spreads[0].left?.master_id).toBe('id-J-Half');
    expect(result.spreads[0].right?.master_id).toBe('id-J-Half');
    expect(result.spreads[1].left?.master_id).toBe('id-J-Half');
    expect(result.spreads[1].right).toBeUndefined();
    expect(
      result.warnings.some(
        (w) =>
          w.startsWith('pages_overflow_truncated') && w.includes('обрезано 1'),
      ),
    ).toBe(true);
  });

  it('min_pages=10, выдано 2 страницы → warning pages_underflow, без auto-fill', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        min_pages: 10,
        section_structure: [{ type: 'common', slots: ['H'] }],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ half_class: 2 }),
    );
    // 1 страница; min=10 → underflow
    expect(result.spreads).toHaveLength(1); // не добили
    expect(
      result.warnings.some(
        (w) =>
          w.startsWith('pages_underflow') && w.includes('min_pages 10'),
      ),
    ).toBe(true);
  });

  it('min_pages=2, max_pages=2, выдано 2 → ok, нет ни одного warning про pages', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        min_pages: 2,
        max_pages: 2,
        section_structure: [{ type: 'common', slots: ['H', 'H'] }],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ half_class: 4 }),
    );
    expect(result.spreads).toHaveLength(1);
    expect(
      result.warnings.some(
        (w) =>
          w.startsWith('pages_overflow') || w.startsWith('pages_underflow'),
      ),
    ).toBe(false);
  });

  it('max_pages=null/undefined → нет проверки overflow', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [
          { type: 'common', slots: ['H', 'H', 'H', 'H', 'H'] },
        ],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ half_class: 10 }),
    );
    expect(result.spreads.length).toBeGreaterThanOrEqual(2);
    expect(
      result.warnings.some((w) =>
        w.startsWith('pages_overflow_truncated'),
      ),
    ).toBe(false);
  });

  it('обрезка тримит decision_trace для обрезанных страниц', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        max_pages: 2,
        section_structure: [
          { type: 'common', slots: ['H', 'H', 'H', 'H'] },
        ],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ half_class: 8 }),
    );
    // 4 → 2 страницы. decision_trace должен содержать только 2 записи
    // (spread_index 0, обе страницы на одном развороте).
    expect(result.decision_trace).toHaveLength(2);
    expect(result.decision_trace.every((t) => t.spread_index === 0)).toBe(true);
  });
});
