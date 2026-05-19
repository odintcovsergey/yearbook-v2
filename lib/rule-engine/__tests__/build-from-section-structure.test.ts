/**
 * Тесты для buildFromSectionStructure (РЭ.21.8.3 skeleton).
 *
 * Покрывают:
 *  - section_structure=NULL → status='failed' с warning section_structure_missing
 *  - пустой section_structure ([]) → status='ok', нет spreads
 *  - common(H, flex_A) с достаточным фото → 2 страницы, 1 разворот
 *  - common(FULL × 3) → 3 страницы (1 полный + 1 одиночный левый)
 *  - common с position-зависимым FULL: правая страница → J-ClassPhoto-Right
 *  - не-common секции (teachers/students/...) → warning section_..._not_implemented
 *  - master_not_found когда mastersByName пустой → warning
 *  - slot_skipped когда фото не хватает → warning
 *  - decision_trace: записи на каждый успешный слот
 *  - вычитание потреблённых фото из available между слотами
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

// ─── Минимальные фикстуры ───────────────────────────────────────────────────

function makeMaster(name: string): SpreadTemplate {
  const placeholders: Placeholder[] = [];
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

const J_MASTERS = [
  makeMaster('J-Half'),
  makeMaster('J-Quarter-Left'),
  makeMaster('J-Collage-6'),
  makeMaster('J-Full'),
  makeMaster('J-Full'),
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
  };
}

function makeBundle(opts: {
  preset: Preset;
  masters?: SpreadTemplate[];
}): RuleEngineBundle {
  const masters = opts.masters ?? J_MASTERS;
  const mastersByName = new Map<string, SpreadTemplate>();
  for (const m of masters) mastersByName.set(m.name, m);
  const templateSet: TemplateSet = {
    id: 'ts-test',
    tenant_id: null,
    name: 'test',
    slug: 'test-slug',
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

function makeInput(common: Partial<{
  full_class: number;
  half_class: number;
  quarter: number;
  sixth: number;
}>): RulesAlbumInput {
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
      spread: [],
      quarter: urls(common.quarter ?? 0, 'q'),
      sixth: urls(common.sixth ?? 0, 'sixth'),
    },
  };
}

// ─── 1. section_structure = NULL → failed ───────────────────────────────────

describe('buildFromSectionStructure: section_structure отсутствует', () => {
  it('section_structure = null → status=failed, конкретный warning', () => {
    const bundle = makeBundle({
      preset: makePreset({ id: 'p1', section_structure: null }),
    });
    const result = buildFromSectionStructure(bundle, makeInput({}));
    expect(result.status).toBe('failed');
    expect(result.spreads).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('section_structure_missing');
    expect(result.preset_id).toBe('p1');
    expect(result.rules_version).toBe('section_structure_v0');
  });
});

// ─── 2. Пустой section_structure ────────────────────────────────────────────

describe('buildFromSectionStructure: пустой section_structure', () => {
  it('[] → status=ok, нет spreads, нет warnings', () => {
    const bundle = makeBundle({
      preset: makePreset({ id: 'p2', section_structure: [] }),
    });
    const result = buildFromSectionStructure(bundle, makeInput({}));
    expect(result.status).toBe('ok');
    expect(result.spreads).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.decision_trace).toEqual([]);
  });
});

// ─── 3. common(H, flex_A) с фото ────────────────────────────────────────────

describe('buildFromSectionStructure: common секция с цепочками', () => {
  it('common(H, flex_A) при half=2, sixth=6 → 2 страницы, 1 разворот', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p3',
        section_structure: [{ type: 'common', slots: ['H', 'flex_A'] }],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ half_class: 2, sixth: 6 }),
    );
    expect(result.status).toBe('ok');
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].spread_index).toBe(0);
    expect(result.spreads[0].left?.master_id).toBe('id-J-Half'); // page 0, left
    expect(result.spreads[0].right?.master_id).toBe('id-J-Collage-6'); // page 1, right, flex_A → collage
    expect(result.decision_trace).toHaveLength(2);
    expect(result.decision_trace[0].rule_id).toBe('manual:H');
    expect(result.decision_trace[1].rule_id).toBe('manual:flex_A');
    expect(result.decision_trace[1].inputs.chain_trace).toBe(
      'flex_A → J-Collage-6 (6 sixth)',
    );
  });

  it('FULL × 3 → 3 страницы (1 полный разворот + 1 одиночный left)', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p4',
        section_structure: [{ type: 'common', slots: ['FULL', 'FULL', 'FULL'] }],
      }),
    });
    const result = buildFromSectionStructure(bundle, makeInput({ full_class: 3 }));
    expect(result.status).toBe('ok');
    expect(result.spreads).toHaveLength(2);
    // Разворот 0: L=J-ClassPhoto, R=J-ClassPhoto-Right (т.к. page 1 — правая)
    expect(result.spreads[0].left?.master_id).toBe('id-J-Full');
    expect(result.spreads[0].right?.master_id).toBe('id-J-Full');
    // Разворот 1: только L (нечётное число страниц)
    expect(result.spreads[1].left?.master_id).toBe('id-J-Full');
    expect(result.spreads[1].right).toBeUndefined();
  });

  it('вычитание фото между слотами: 2 H подряд при half=4 → оба J-Half', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p5',
        section_structure: [{ type: 'common', slots: ['H', 'H'] }],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ half_class: 4 }),
    );
    expect(result.warnings).toEqual([]);
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-J-Half');
    expect(result.spreads[0].right?.master_id).toBe('id-J-Half');
  });

  it('пул кончается между слотами: 2 H при half=2 → второй пропущен с warning', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p6',
        section_structure: [{ type: 'common', slots: ['H', 'H'] }],
      }),
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ half_class: 2 }),
    );
    expect(result.status).toBe('partial');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('slot_skipped');
    expect(result.warnings[0]).toContain('slot #1 (H)');
    // Только 1 страница из 2 запрошенных
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-J-Half');
    expect(result.spreads[0].right).toBeUndefined();
  });
});

// ─── 4. Заглушки не-common секций ───────────────────────────────────────────

describe('buildFromSectionStructure: заглушки секций', () => {
  it('teachers/students/soft_intro/soft_final/vignette → warning, нет страниц', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p7',
        section_structure: [
          { type: 'soft_intro' },
          { type: 'teachers' },
          { type: 'students' },
          { type: 'vignette' },
          { type: 'soft_final' },
        ],
      }),
    });
    const result = buildFromSectionStructure(bundle, makeInput({}));
    expect(result.status).toBe('partial');
    expect(result.spreads).toEqual([]);
    // teachers подключен (21.8.4a), students (21.8.4b/c), soft_intro/final (21.8.5):
    // без F-* — teachers_master_not_found; без density — students_density_not_supported;
    // без sheet_type='soft' — soft_intro_skipped / soft_final_skipped.
    // Заглушка остаётся только: vignette.
    expect(result.warnings).toContain('section_vignette_not_implemented');
    expect(
      result.warnings.some((w) => w.startsWith('soft_intro_skipped')),
    ).toBe(true);
    expect(
      result.warnings.some((w) => w.startsWith('soft_final_skipped')),
    ).toBe(true);
    expect(
      result.warnings.some((w) => w.startsWith('teachers_master_not_found')),
    ).toBe(true);
    expect(
      result.warnings.some((w) =>
        w.startsWith('students_density_not_supported'),
      ),
    ).toBe(true);
  });

  it('teachers + common(H), F-Head-* отсутствуют → teachers_master_not_found + 1 страница H', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p8',
        section_structure: [
          { type: 'teachers' },
          { type: 'common', slots: ['H'] },
        ],
      }),
      // J-* мастера есть (по умолчанию), F-Head-* — нет
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ half_class: 2 }),
    );
    expect(result.status).toBe('partial');
    expect(
      result.warnings.some((w) => w.includes('teachers_master_not_found')),
    ).toBe(true);
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-J-Half');
  });
});

// ─── 5. master_not_found ────────────────────────────────────────────────────

describe('buildFromSectionStructure: master_not_found', () => {
  it('пустой mastersByName → warning master_not_found, страница пропущена', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p9',
        section_structure: [{ type: 'common', slots: ['H'] }],
      }),
      masters: [], // никаких мастеров в дизайне
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ half_class: 2 }),
    );
    expect(result.status).toBe('partial');
    expect(result.spreads).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('master_not_found');
    expect(result.warnings[0]).toContain('J-Half');
  });
});
