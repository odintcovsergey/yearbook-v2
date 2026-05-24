/**
 * Тесты для РЭ.22.8.2: семантический поиск soft_intro/soft_final мастеров.
 *
 * Параллельно с legacy тестами в sections-soft-and-pages.test.ts.
 * Покрывают:
 *  - Размеченный intro/final мастер находится через page_role
 *  - Любое имя мастера годится — engine не привязан к 'S-Intro'/'S-Final'
 *  - Legacy fallback по имени когда теги не размечены
 *  - photos_full=1 фильтр отсеивает мастеров без classphotoframe
 *  - decision_trace.inputs.semantic = true/false
 *  - Warning со спецификацией когда ни семантика ни legacy не нашли
 *  - sheet_type='hard' → секции skipped (поведение не меняется)
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

function photoSlot(label: string): Placeholder {
  return {
    label,
    x_mm: 0,
    y_mm: 0,
    width_mm: 100,
    height_mm: 100,
    type: 'photo',
    fit: 'fill_proportional',
    required: false,
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
    type: 'common',
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
    sheet_type: opts.sheet_type ?? 'soft',
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

function makeInput(fullClassCount: number): RulesAlbumInput {
  return {
    students: [],
    subjects: [],
    head_teacher: { photo: null, name: '', role: '', text: '' },
    common_photos: {
      full_class: Array.from(
        { length: fullClassCount },
        (_, i) => `https://cdn/full${i}.jpg`,
      ),
      half_class: [],
      spread: [],
      quarter: [],
      sixth: [],
    },
  };
}

// ─── Тесты ──────────────────────────────────────────────────────────────────

describe('soft_intro семантический поиск (РЭ.22.8.2)', () => {
  it('Размеченный S-Intro находится через page_role, semantic=true', () => {
    const introMaster = makeMaster('S-Intro', [photoSlot('classphotoframe')], 'intro', {
      photos_full: 1,
    });
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        sheet_type: 'soft',
        section_structure: [{ type: 'soft_intro' }],
      }),
      masters: [introMaster],
    });
    const result = buildFromSectionStructure(bundle, makeInput(1));
    expect(result.spreads[0].right?.master_id).toBe('id-S-Intro');
    const trace = result.decision_trace.find((t) =>
      t.rule_id?.startsWith('soft_intro:'),
    );
    expect(trace?.inputs.semantic).toBe(true);
    expect(trace?.rule_id).toBe('soft_intro:S-Intro');
  });

  it('Имя не важно — кастомный мастер с тегами тоже находится', () => {
    // Партнёр назвал свой intro-мастер 'Partner-Intro-2026' — engine
    // должен его найти, потому что page_role='intro' + photos_full=1.
    const customIntro = makeMaster(
      'Partner-Intro-2026',
      [photoSlot('classphotoframe')],
      'intro',
      { photos_full: 1 },
    );
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        sheet_type: 'soft',
        section_structure: [{ type: 'soft_intro' }],
      }),
      masters: [customIntro],
    });
    const result = buildFromSectionStructure(bundle, makeInput(1));
    expect(result.spreads[0].right?.master_id).toBe('id-Partner-Intro-2026');
    const trace = result.decision_trace.find((t) =>
      t.rule_id?.startsWith('soft_intro:'),
    );
    expect(trace?.inputs.semantic).toBe(true);
  });

  it('Legacy fallback: неразмеченный S-Intro находится по имени, semantic=false', () => {
    const legacyIntro = makeMaster(
      'S-Intro',
      [photoSlot('classphotoframe')],
      null,
      null,
    );
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        sheet_type: 'soft',
        section_structure: [{ type: 'soft_intro' }],
      }),
      masters: [legacyIntro],
    });
    const result = buildFromSectionStructure(bundle, makeInput(1));
    expect(result.spreads[0].right?.master_id).toBe('id-S-Intro');
    const trace = result.decision_trace.find((t) =>
      t.rule_id?.startsWith('soft_intro:'),
    );
    expect(trace?.inputs.semantic).toBe(false);
  });

  it('Мастер без classphotoframe отсеивается photos_full=1 → fallback по имени', () => {
    // Если в template_set два мастера с page_role='intro', но у одного
    // photos_full=0 (без classphotoframe), engine должен отсеять его.
    // В этом тесте — единственный intro-мастер без classphotoframe и
    // photos_full=0. Семантика не найдёт (запрос photos_full=1),
    // fallback по имени 'S-Intro' → находит того же мастера.
    const noPhoto = makeMaster('S-Intro', [], 'intro', { photos_full: 0 });
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        sheet_type: 'soft',
        section_structure: [{ type: 'soft_intro' }],
      }),
      masters: [noPhoto],
    });
    const result = buildFromSectionStructure(bundle, makeInput(1));
    expect(result.spreads[0].right?.master_id).toBe('id-S-Intro');
    const trace = result.decision_trace.find((t) =>
      t.rule_id?.startsWith('soft_intro:'),
    );
    expect(trace?.inputs.semantic).toBe(false);
  });

  it('Ни семантика, ни legacy не нашли → warning со спецификацией', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        sheet_type: 'soft',
        section_structure: [{ type: 'soft_intro' }],
      }),
      masters: [], // пусто
    });
    const result = buildFromSectionStructure(bundle, makeInput(1));
    expect(result.spreads).toHaveLength(0);
    const warn = result.warnings.find((w) =>
      w.startsWith('soft_intro_master_not_found'),
    );
    expect(warn).toBeDefined();
    expect(warn).toContain("page_role='intro'");
    expect(warn).toContain('photos_full=1');
    expect(warn).toContain("'S-Intro'");
  });

  it("sheet_type='hard' → skipped (поведение не меняется)", () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        sheet_type: 'hard',
        section_structure: [{ type: 'soft_intro' }],
      }),
      masters: [
        makeMaster('S-Intro', [photoSlot('classphotoframe')], 'intro', {
          photos_full: 1,
        }),
      ],
    });
    const result = buildFromSectionStructure(bundle, makeInput(1));
    expect(result.spreads).toHaveLength(0);
    const warn = result.warnings.find((w) => w.startsWith('soft_intro_skipped'));
    expect(warn).toBeDefined();
  });
});

describe('soft_final семантический поиск (РЭ.22.8.2)', () => {
  it('Размеченный S-Final-Soft-L (имя из реальной БД) находится через page_role', () => {
    // В реальной БД мастер 'S-Final' БЕЗ суффикса отсутствует —
    // есть только 'S-Final-Soft-L'. Семантика находит его через
    // page_role='final', без привязки к имени.
    const finalMaster = makeMaster(
      'S-Final-Soft-L',
      [photoSlot('classphotoframe')],
      'final',
      { photos_full: 1 },
    );
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        sheet_type: 'soft',
        section_structure: [{ type: 'soft_final' }],
      }),
      masters: [finalMaster],
    });
    const result = buildFromSectionStructure(bundle, makeInput(1));
    expect(result.spreads[0].left?.master_id).toBe('id-S-Final-Soft-L');
    const trace = result.decision_trace.find((t) =>
      t.rule_id?.startsWith('soft_final:'),
    );
    expect(trace?.inputs.semantic).toBe(true);
    // classphotoframe забинден
    expect(result.spreads[0].left?.bindings.classphotoframe).toBe(
      'https://cdn/full0.jpg',
    );
  });

  it("Закрытие двойственности 'S-Final' vs 'S-Final-Soft-L': семантика берёт любого с page_role='final'", () => {
    // Имя не важно, engine ищет page_role.
    const partnerFinal = makeMaster(
      'PartnerCo-Goodbye-Page',
      [photoSlot('classphotoframe')],
      'final',
      { photos_full: 1 },
    );
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        sheet_type: 'soft',
        section_structure: [{ type: 'soft_final' }],
      }),
      masters: [partnerFinal],
    });
    const result = buildFromSectionStructure(bundle, makeInput(1));
    expect(result.spreads[0].left?.master_id).toBe('id-PartnerCo-Goodbye-Page');
  });

  it('Legacy fallback: S-Final без суффикса (если бы был) предпочтительнее S-Final-Soft-L', () => {
    // Оба неразмечены — legacy fallback берёт S-Final первым по контракту.
    const sFinal = makeMaster('S-Final', [photoSlot('classphotoframe')], null, null);
    const sFinalSoftL = makeMaster(
      'S-Final-Soft-L',
      [photoSlot('classphotoframe')],
      null,
      null,
    );
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        sheet_type: 'soft',
        section_structure: [{ type: 'soft_final' }],
      }),
      masters: [sFinal, sFinalSoftL],
    });
    const result = buildFromSectionStructure(bundle, makeInput(1));
    expect(result.spreads[0].left?.master_id).toBe('id-S-Final');
    const trace = result.decision_trace.find((t) =>
      t.rule_id?.startsWith('soft_final:'),
    );
    expect(trace?.inputs.semantic).toBe(false);
  });

  it('Только S-Final-Soft-L (как в реальной БД до миграции) → fallback берёт его', () => {
    const sFinalSoftL = makeMaster(
      'S-Final-Soft-L',
      [photoSlot('classphotoframe')],
      null,
      null,
    );
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        sheet_type: 'soft',
        section_structure: [{ type: 'soft_final' }],
      }),
      masters: [sFinalSoftL],
    });
    const result = buildFromSectionStructure(bundle, makeInput(1));
    expect(result.spreads[0].left?.master_id).toBe('id-S-Final-Soft-L');
  });

  it('Ни одного финального мастера → warning со спецификацией', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        sheet_type: 'soft',
        section_structure: [{ type: 'soft_final' }],
      }),
      masters: [],
    });
    const result = buildFromSectionStructure(bundle, makeInput(1));
    const warn = result.warnings.find((w) =>
      w.startsWith('soft_final_master_not_found'),
    );
    expect(warn).toBeDefined();
    expect(warn).toContain("page_role='final'");
    expect(warn).toContain('photos_full=1');
  });
});
