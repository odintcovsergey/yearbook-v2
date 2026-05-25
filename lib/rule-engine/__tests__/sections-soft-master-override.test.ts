/**
 * Тесты для РЭ.42: ручной выбор мастера для soft_intro / soft_final через
 * section.master_name. Партнёр может вместо автоматического classphoto
 * положить любой мастер из template_set (типично — учителей / классного
 * руководителя / воспитателей детсада).
 *
 * Покрытие:
 *  - soft_intro: override валидным именем → мастер кладётся, decision_trace
 *    содержит overridden=true.
 *  - soft_intro: override НЕсуществующим именем → warning, страница НЕ
 *    кладётся (защита от тихой подмены на classphoto).
 *  - soft_intro: без override → автоматический поиск (regression test).
 *  - soft_intro: override + sheet_type='hard' → секция skipped (behavior
 *    унаследован от старой semantics).
 *  - soft_final: те же 4 сценария.
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

// РЭ.42.b.2: input с заполненным head_teacher и subjects для тестов
// автоматического биндинга teacher-placeholder'ов в override-режиме.
function makeInputWithTeachers(): RulesAlbumInput {
  return {
    students: [],
    subjects: [
      { photo: 'https://cdn/subj1.jpg', name: 'Иван Иванов', role: 'Математика' },
      { photo: 'https://cdn/subj2.jpg', name: 'Пётр Петров', role: 'Физика' },
    ],
    head_teacher: {
      photo: 'https://cdn/head.jpg',
      name: 'Мария Сергеевна',
      role: 'Классный руководитель',
      text: 'Мудрая цитата.',
    },
    common_photos: {
      full_class: ['https://cdn/full0.jpg'],
      half_class: [],
      spread: [],
      quarter: [],
      sixth: [],
    },
  };
}

// ─── soft_intro ─────────────────────────────────────────────────────────────

describe('РЭ.42: soft_intro master_name override', () => {
  it('Валидный override → указанный мастер кладётся, decision_trace.overridden=true', () => {
    const introDefault = makeMaster(
      'S-Intro',
      [photoSlot('classphotoframe')],
      'intro',
      { photos_full: 1 },
    );
    const teachersMaster = makeMaster(
      'J-Teachers-Single',
      [photoSlot('headteacherphoto'), photoSlot('teacherphoto_1')],
      null,
      null,
    );
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        sheet_type: 'soft',
        section_structure: [
          { type: 'soft_intro', master_name: 'J-Teachers-Single' },
        ],
      }),
      masters: [introDefault, teachersMaster],
    });
    const result = buildFromSectionStructure(bundle, makeInput(1));

    // Мастер на R первого разворота — J-Teachers-Single, не S-Intro.
    expect(result.spreads[0].right?.master_id).toBe('id-J-Teachers-Single');

    const trace = result.decision_trace.find((t) =>
      t.rule_id?.startsWith('soft_intro:'),
    );
    expect(trace?.rule_id).toBe('soft_intro:J-Teachers-Single');
    expect(trace?.inputs.overridden).toBe(true);
    expect(trace?.inputs.semantic).toBe(false);
    // Classphoto НЕ был потреблён — у J-Teachers-Single нет такого placeholder.
    expect(trace?.inputs.consumes).toEqual({ full_class: 0, half_class: 0 });

    // Warnings не должно быть.
    expect(
      result.warnings.filter((w) => w.startsWith('soft_intro')),
    ).toEqual([]);
  });

  it('Override с несуществующим именем → warning, страница НЕ кладётся', () => {
    const introDefault = makeMaster(
      'S-Intro',
      [photoSlot('classphotoframe')],
      'intro',
      { photos_full: 1 },
    );
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        sheet_type: 'soft',
        section_structure: [
          { type: 'soft_intro', master_name: 'NonExistent-Master' },
        ],
      }),
      masters: [introDefault],
    });
    const result = buildFromSectionStructure(bundle, makeInput(1));

    // Страниц нет → spreads пустой.
    expect(result.spreads).toHaveLength(0);

    // Точный warning.
    const w = result.warnings.find((x) =>
      x.startsWith('soft_intro_master_override_not_found'),
    );
    expect(w).toBeDefined();
    expect(w).toContain("'NonExistent-Master'");
    // S-Intro fallback НЕ должен сработать (это явный override, не автомат).
    expect(
      result.warnings.some((x) => x.startsWith('soft_intro_master_not_found')),
    ).toBe(false);
  });

  it('Без override → автоматический поиск работает как раньше (regression)', () => {
    const introMaster = makeMaster(
      'S-Intro',
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
      masters: [introMaster],
    });
    const result = buildFromSectionStructure(bundle, makeInput(1));

    expect(result.spreads[0].right?.master_id).toBe('id-S-Intro');
    const trace = result.decision_trace.find((t) =>
      t.rule_id?.startsWith('soft_intro:'),
    );
    expect(trace?.inputs.overridden).toBe(false);
    expect(trace?.inputs.semantic).toBe(true);
  });

  it("Override + sheet_type='hard' → секция skipped (override не сработает)", () => {
    const teachersMaster = makeMaster(
      'J-Teachers-Single',
      [photoSlot('headteacherphoto')],
      null,
      null,
    );
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        sheet_type: 'hard',
        section_structure: [
          { type: 'soft_intro', master_name: 'J-Teachers-Single' },
        ],
      }),
      masters: [teachersMaster],
    });
    const result = buildFromSectionStructure(bundle, makeInput(1));

    expect(result.spreads).toHaveLength(0);
    // Стандартный skip-warning, не override-warning.
    expect(
      result.warnings.some((x) => x.startsWith('soft_intro_skipped')),
    ).toBe(true);
    expect(
      result.warnings.some((x) =>
        x.startsWith('soft_intro_master_override_not_found'),
      ),
    ).toBe(false);
  });
});

// ─── soft_final ─────────────────────────────────────────────────────────────

describe('РЭ.42: soft_final master_name override', () => {
  it('Валидный override → указанный мастер кладётся, decision_trace.overridden=true', () => {
    const finalDefault = makeMaster(
      'S-Final-Soft-L',
      [photoSlot('classphotoframe')],
      'final',
      { photos_full: 1 },
    );
    const farewellMaster = makeMaster(
      'J-Farewell-Custom',
      [photoSlot('textframe')],
      null,
      null,
    );
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        sheet_type: 'soft',
        section_structure: [
          { type: 'soft_final', master_name: 'J-Farewell-Custom' },
        ],
      }),
      masters: [finalDefault, farewellMaster],
    });
    const result = buildFromSectionStructure(bundle, makeInput(1));

    // soft_final в SECTIONS_THAT_START_NEW_SPREAD → section_start=true →
    // страница встаёт на LEFT первого разворота (не R, как у soft_intro).
    expect(result.spreads[0].left?.master_id).toBe('id-J-Farewell-Custom');
    expect(result.spreads[0].right).toBeUndefined();

    const trace = result.decision_trace.find((t) =>
      t.rule_id?.startsWith('soft_final:'),
    );
    expect(trace?.rule_id).toBe('soft_final:J-Farewell-Custom');
    expect(trace?.inputs.overridden).toBe(true);
    expect(trace?.inputs.semantic).toBe(false);
    expect(trace?.inputs.consumes).toEqual({ full_class: 0, half_class: 0 });
  });

  it('Override с несуществующим именем → warning, страница НЕ кладётся', () => {
    const finalDefault = makeMaster(
      'S-Final-Soft-L',
      [photoSlot('classphotoframe')],
      'final',
      { photos_full: 1 },
    );
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        sheet_type: 'soft',
        section_structure: [
          { type: 'soft_final', master_name: 'Missing-Master' },
        ],
      }),
      masters: [finalDefault],
    });
    const result = buildFromSectionStructure(bundle, makeInput(1));

    expect(result.spreads).toHaveLength(0);
    const w = result.warnings.find((x) =>
      x.startsWith('soft_final_master_override_not_found'),
    );
    expect(w).toBeDefined();
    expect(w).toContain("'Missing-Master'");
    expect(
      result.warnings.some((x) => x.startsWith('soft_final_master_not_found')),
    ).toBe(false);
  });

  it('Без override → автоматический поиск работает как раньше (regression)', () => {
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

    // section_start → LEFT первого разворота.
    expect(result.spreads[0].left?.master_id).toBe('id-S-Final-Soft-L');
    const trace = result.decision_trace.find((t) =>
      t.rule_id?.startsWith('soft_final:'),
    );
    expect(trace?.inputs.overridden).toBe(false);
    expect(trace?.inputs.semantic).toBe(true);
  });

  it("Override + sheet_type='hard' → секция skipped (override не сработает)", () => {
    const farewellMaster = makeMaster(
      'J-Farewell-Custom',
      [photoSlot('textframe')],
      null,
      null,
    );
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        sheet_type: 'hard',
        section_structure: [
          { type: 'soft_final', master_name: 'J-Farewell-Custom' },
        ],
      }),
      masters: [farewellMaster],
    });
    const result = buildFromSectionStructure(bundle, makeInput(1));

    expect(result.spreads).toHaveLength(0);
    expect(
      result.warnings.some((x) => x.startsWith('soft_final_skipped')),
    ).toBe(true);
  });
});

// ─── Автоматический биндинг placeholder'ов в override-режиме (РЭ.42.b.2) ──

describe('РЭ.42.b.2: автоматический биндинг teacher-placeholder в override', () => {
  it('soft_intro: override с teacher-мастером → автобиндинг headteacher + subjects', () => {
    const teacherMaster = makeMaster(
      'J-Teachers-Single',
      [
        photoSlot('headteacherphoto'),
        photoSlot('headteachername'),
        photoSlot('headteacherrole'),
        photoSlot('headteachertext'),
        photoSlot('teacherphoto_1'),
        photoSlot('teachername_1'),
        photoSlot('teacherphoto_2'),
        photoSlot('teachername_2'),
      ],
      null,
      null,
    );
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        sheet_type: 'soft',
        section_structure: [
          { type: 'soft_intro', master_name: 'J-Teachers-Single' },
        ],
      }),
      masters: [teacherMaster],
    });
    const result = buildFromSectionStructure(bundle, makeInputWithTeachers());

    const page = result.spreads[0].right;
    expect(page?.master_id).toBe('id-J-Teachers-Single');

    const bindings = page!.bindings as Record<string, unknown>;
    expect(bindings.headteacherphoto).toBe('https://cdn/head.jpg');
    expect(bindings.headteachername).toBe('Мария Сергеевна');
    expect(bindings.headteacherrole).toBe('Классный руководитель');
    expect(bindings.headteachertext).toBe('Мудрая цитата.');
    expect(bindings.teacherphoto_1).toBe('https://cdn/subj1.jpg');
    expect(bindings.teachername_1).toBe('Иван Иванов');
    expect(bindings.teacherphoto_2).toBe('https://cdn/subj2.jpg');
    expect(bindings.teachername_2).toBe('Пётр Петров');
  });

  it('soft_intro override: subject N+ отсутствует → __hidden__ для лишних слотов', () => {
    // У нас в input 2 subjects, мастер просит 4 — последние 2 должны
    // быть скрыты через __hidden__.
    const teacherMaster = makeMaster(
      'J-Teachers-4',
      [
        photoSlot('teacherphoto_1'),
        photoSlot('teacherphoto_2'),
        photoSlot('teacherphoto_3'),
        photoSlot('teacherphoto_4'),
      ],
      null,
      null,
    );
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        sheet_type: 'soft',
        section_structure: [
          { type: 'soft_intro', master_name: 'J-Teachers-4' },
        ],
      }),
      masters: [teacherMaster],
    });
    const result = buildFromSectionStructure(bundle, makeInputWithTeachers());
    const bindings = result.spreads[0].right!.bindings as Record<string, unknown>;

    expect(bindings.teacherphoto_1).toBe('https://cdn/subj1.jpg');
    expect(bindings.teacherphoto_2).toBe('https://cdn/subj2.jpg');
    expect(bindings.__hidden__teacherphoto_3).toBe('1');
    expect(bindings.__hidden__teacherphoto_4).toBe('1');
  });

  it('soft_intro override с classphoto+headteacher → биндим оба + consumes.full_class=1', () => {
    const mixedMaster = makeMaster(
      'J-Mixed',
      [photoSlot('classphotoframe'), photoSlot('headteacherphoto')],
      null,
      null,
    );
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        sheet_type: 'soft',
        section_structure: [
          { type: 'soft_intro', master_name: 'J-Mixed' },
        ],
      }),
      masters: [mixedMaster],
    });
    const result = buildFromSectionStructure(bundle, makeInputWithTeachers());
    const bindings = result.spreads[0].right!.bindings as Record<string, unknown>;

    expect(bindings.classphotoframe).toBe('https://cdn/full0.jpg');
    expect(bindings.headteacherphoto).toBe('https://cdn/head.jpg');

    const trace = result.decision_trace.find((t) =>
      t.rule_id?.startsWith('soft_intro:'),
    );
    const consumes = trace?.inputs.consumes as { full_class: number };
    expect(consumes.full_class).toBe(1);
  });

  it('soft_final override: тот же автобиндинг, что и для intro', () => {
    const farewellMaster = makeMaster(
      'J-Farewell-WithTeacher',
      [photoSlot('headteacherphoto'), photoSlot('headteachertext')],
      null,
      null,
    );
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        sheet_type: 'soft',
        section_structure: [
          { type: 'soft_final', master_name: 'J-Farewell-WithTeacher' },
        ],
      }),
      masters: [farewellMaster],
    });
    const result = buildFromSectionStructure(bundle, makeInputWithTeachers());
    // soft_final → section_start → LEFT.
    const bindings = result.spreads[0].left!.bindings as Record<string, unknown>;

    expect(bindings.headteacherphoto).toBe('https://cdn/head.jpg');
    expect(bindings.headteachertext).toBe('Мудрая цитата.');
  });

  it('Автоматический режим (без override) — старая classphoto-only логика сохранена', () => {
    // Мастер S-Intro с classphoto + неожиданный teacher placeholder. В
    // автоматическом режиме (без master_name) НЕ должен биндить teacher,
    // только classphoto.
    const introMaster = makeMaster(
      'S-Intro',
      [photoSlot('classphotoframe'), photoSlot('headteacherphoto')],
      'intro',
      { photos_full: 1 },
    );
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        sheet_type: 'soft',
        section_structure: [{ type: 'soft_intro' }], // без master_name
      }),
      masters: [introMaster],
    });
    const result = buildFromSectionStructure(bundle, makeInputWithTeachers());
    const bindings = result.spreads[0].right!.bindings as Record<string, unknown>;

    expect(bindings.classphotoframe).toBe('https://cdn/full0.jpg');
    // headteacherphoto НЕ должен биндиться в автоматическом режиме.
    expect(bindings.headteacherphoto).toBeUndefined();
  });
});
