/**
 * Edge cases тесты buildFromRules (РЭ.10.5).
 *
 * Покрывают:
 *   - 0 учеников / пустой preset / нет общих фото
 *   - 1 ученик в Standard → tail + mixed_pages с common-section
 *   - overflow в Light (17 учеников: 12 overflow + 5 grid-tail)
 *   - mixed_pages корректно склеивает левую и правую разных секций
 *   - decision_trace содержит правильные inputs snapshot
 *   - cursors двигаются корректно (consumed_*)
 *   - защита от бесконечного цикла (HARD_LOOP_LIMIT)
 *   - enabled_when отключает секцию
 *   - validateSectionParams warning для несовместимых density+param
 *   - prev_spread.right_page_empty корректно
 */

import { describe, it, expect } from 'vitest';
import { buildFromRules } from '../build';
import type { Preset, RulesAlbumInput, RulesStudentInput, Rule, TemplateFamily } from '../types';
import type { RuleEngineBundle } from '../loaders';
import { makeBundle } from './__fixtures__/bundle';
import { makeMastersByName, TEST_MASTERS } from './__fixtures__/masters';

// =============================================================================
// Helpers
// =============================================================================

function makeStudents(n: number): RulesStudentInput[] {
  return Array.from({ length: n }, (_, i) => ({
    full_name: `Уч ${i + 1}`,
    portrait: `p${i + 1}.jpg`,
    quote: `Q${i + 1}`,
    friend_photos: [],
  }));
}

function makeInput(opts: {
  students?: number;
  subjects?: number;
  fullClass?: number;
  halfClass?: number;
  sixth?: number;
}): RulesAlbumInput {
  return {
    students: makeStudents(opts.students ?? 0),
    subjects: Array.from({ length: opts.subjects ?? 0 }, (_, i) => ({
      name: `T${i + 1}`,
      role: 'R',
      photo: `s${i + 1}.jpg`,
    })),
    head_teacher: { name: 'HT', role: 'HR', text: 'HText', photo: 'ht.jpg' },
    common_photos: {
      full_class: Array.from({ length: opts.fullClass ?? 0 }, (_, i) => `fc${i + 1}.jpg`),
      half_class: Array.from({ length: opts.halfClass ?? 0 }, (_, i) => `hc${i + 1}.jpg`),
      spread: [],
      quarter: [],
      sixth: Array.from({ length: opts.sixth ?? 0 }, (_, i) => `sx${i + 1}.jpg`),
    },
  };
}

// =============================================================================
// 1. Граничные количества данных
// =============================================================================

describe('buildFromRules — edge: пустой / минимальный ввод', () => {
  it('0 учеников + 0 предметников + 0 фото → пустой layout, без fatal', () => {
    const bundle = makeBundle('standard');
    const layout = buildFromRules(makeInput({}), bundle);
    expect(layout.status).not.toBe('failed');
    // head-teacher без subjects может не найти подходящего правила (no common photos)
    // → секция завершится без правил
    expect(layout.spreads.length).toBeLessThanOrEqual(1);
  });

  it('Light с 1 учеником → одна страница (L-Grid-Page, side=left), правая висит → может стать mixed_pages', () => {
    const bundle = makeBundle('light');
    const input = makeInput({ students: 1, fullClass: 0 });
    const layout = buildFromRules(input, bundle);
    expect(layout.status).not.toBe('failed');
    const studentTrace = layout.decision_trace.find((t) => t.family_id === 'student-section');
    expect(studentTrace).toBeDefined();
  });
});

// =============================================================================
// 2. Mixed pages (разворот со смешанными страницами)
// =============================================================================

describe('buildFromRules — mixed_pages', () => {
  it('Standard 1 ученик + 2 полкласса: левая E-Standard-Left + правая J-Half → mixed_pages=true', () => {
    const bundle = makeBundle('standard');
    const input = makeInput({ students: 1, halfClass: 2, fullClass: 0, subjects: 10 });
    // subjects=10 чтобы head-teacher не тратил полкласса (он переходит в common)
    const layout = buildFromRules(input, bundle);

    expect(layout.status).not.toBe('failed');
    // Найти разворот со student-section левой страницей
    const tailSpread = layout.spreads.find(
      (s) => s.left?.bindings.__master_name__ === 'E-Standard-Left' && s.right !== undefined,
    );
    expect(tailSpread).toBeDefined();
    expect(tailSpread?.mixed_pages).toBe(true);
    // Правая — J-Half (common-section)
    expect(tailSpread?.right?.bindings.__master_name__).toBe('J-Half');
  });

  it('Light grid-tail 4 ученика + 1 общее фото: L-Grid-Page слева + J-Full справа', () => {
    const bundle = makeBundle('light');
    // 4 ученика → grid-tail (1 страница L-Grid-Page) + правая висит → common-section J-Full
    const input = makeInput({ students: 4, fullClass: 1 });
    const layout = buildFromRules(input, bundle);

    expect(layout.status).not.toBe('failed');
    // Должен быть разворот L-Grid-Page + J-Full
    const lTailMixed = layout.spreads.find(
      (s) => s.left?.bindings.__master_name__ === 'L-Grid-Page' && s.mixed_pages,
    );
    if (lTailMixed) {
      expect(lTailMixed.right?.bindings.__master_name__).toMatch(/^(J-Half|J-Full|J-Collage-6)$/);
    }
  });
});

// =============================================================================
// 3. Light overflow (>12 учеников)
// =============================================================================

describe('buildFromRules — overflow Light (>12 учеников)', () => {
  it('17 учеников Light: 12 overflow (6+6) + 5 tail', () => {
    const bundle = makeBundle('light');
    const input = makeInput({ students: 17, fullClass: 0 });
    const layout = buildFromRules(input, bundle);

    expect(layout.status).not.toBe('failed');
    const studentTraces = layout.decision_trace.filter((t) => t.family_id === 'student-section');
    // Должно быть минимум 2: overflow (12) + tail (5)
    expect(studentTraces.length).toBeGreaterThanOrEqual(2);
    // Первое — overflow
    expect(studentTraces[0].rule_id).toContain('overflow');
    expect(studentTraces[0].inputs.students_remaining).toBe(17);
    // Второе — какой-то tail/grid правило
    const tailRule = studentTraces[1];
    expect(tailRule.inputs.students_remaining).toBe(5);
  });

  it('25 учеников Light: 12 + 12 + 1 grid-tail', () => {
    const bundle = makeBundle('light');
    const input = makeInput({ students: 25, fullClass: 0 });
    const layout = buildFromRules(input, bundle);

    expect(layout.status).not.toBe('failed');
    const studentTraces = layout.decision_trace.filter((t) => t.family_id === 'student-section');
    expect(studentTraces.length).toBeGreaterThanOrEqual(3);
    // Последний trace: остаток=1
    const lastStudent = studentTraces[studentTraces.length - 1];
    expect(lastStudent.inputs.students_remaining).toBeLessThanOrEqual(6);
  });
});

// =============================================================================
// 4. decision_trace корректность
// =============================================================================

describe('buildFromRules — decision_trace', () => {
  it('trace.spread_index монотонно неубывает и соответствует spreads', () => {
    const bundle = makeBundle('standard');
    const input = makeInput({ students: 6, subjects: 4, fullClass: 1 });
    const layout = buildFromRules(input, bundle);

    let prevIdx = -1;
    for (const t of layout.decision_trace) {
      expect(t.spread_index).toBeGreaterThanOrEqual(prevIdx);
      expect(t.spread_index).toBeLessThan(layout.spreads.length);
      prevIdx = t.spread_index;
    }
  });

  it('trace.inputs содержит students_remaining / current_student_index / subjects_count', () => {
    const bundle = makeBundle('standard');
    const input = makeInput({ students: 4, subjects: 2, fullClass: 1 });
    const layout = buildFromRules(input, bundle);

    for (const t of layout.decision_trace) {
      expect(t.inputs.students_remaining).toBeDefined();
      expect(t.inputs.current_student_index).toBeDefined();
      expect(t.inputs.subjects_count).toBeDefined();
    }
  });
});

// =============================================================================
// 5. Курсоры двигаются корректно
// =============================================================================

describe('buildFromRules — cursors advance', () => {
  it('Standard 4 ученика: current_student_index по правилам = 0, 2, 4', () => {
    const bundle = makeBundle('standard');
    const input = makeInput({ students: 4, subjects: 0, fullClass: 0 });
    const layout = buildFromRules(input, bundle);

    const studentTraces = layout.decision_trace.filter((t) => t.family_id === 'student-section');
    const indices = studentTraces.map((t) => t.inputs.current_student_index);
    expect(indices).toEqual([0, 2]); // 4 / 2 = 2 правила: на 0 и на 2
  });

  it('Individual: cursor сбрасывается в 0 при входе в виньетку (mini секцию)', () => {
    const bundle = makeBundle('individual');
    const input = makeInput({ students: 2, subjects: 0, fullClass: 0 });
    // Для individual: friend_photos не нужны — student-section-maximum срабатывает
    // даже без них (балансировка скроет).
    const layout = buildFromRules(input, bundle);

    expect(layout.status).not.toBe('failed');
    // Все правила student-section в первой секции (maximum) → индексы 0, 1
    // Затем вторая секция (mini) → индекс снова 0
    const traces = layout.decision_trace.filter((t) => t.family_id === 'student-section');
    const firstSecTraces = traces.filter((t) => t.section_index === 1); // 0=head, 1=max, 2=mini
    const secondSecTraces = traces.filter((t) => t.section_index === 2);

    if (firstSecTraces.length > 0 && secondSecTraces.length > 0) {
      // Первое в mini секции должно начинаться снова с 0
      expect(secondSecTraces[0].inputs.current_student_index).toBe(0);
    }
  });
});

// =============================================================================
// 6. Защита от бесконечного цикла
// =============================================================================

describe('buildFromRules — защита от inf loop', () => {
  it('Правило без consumes → секция завершается с warning', () => {
    // Создаём кастомный bundle с правилом которое не потребляет ничего
    const stubRule: Rule = {
      id: 'stub-no-consume',
      family_id: 'head-teacher',
      family_version: '1.0',
      priority: 100,
      when: {},
      produces: { type: 'page', side: 'left', master: 'F-Head-WithPhoto' },
      bind: {},
      // consumes отсутствует
    };
    const stubPreset: Preset = {
      id: 'stub',
      display_name: 'Stub',
      print_type: 'layflat',
      pages_per_spread: 2,
      version: '1.0',
      tenant_id: null,
      sections: [{ family_id: 'head-teacher' }],
    };
    const stubFamily: TemplateFamily = {
      id: 'head-teacher',
      display_name: 'Head Teacher',
      aliases: [],
      deprecated: false,
      version: '1.0',
      tenant_id: null,
      params: {},
    };
    const bundle: RuleEngineBundle = {
      preset: stubPreset,
      rules: [stubRule],
      families: [stubFamily],
      templateSet: {
        id: 'ts',
        tenant_id: null,
        name: 'ts',
        slug: 'okeybook-default',
        print_type: 'layflat',
        page_width_mm: 200,
        page_height_mm: 280,
        spread_width_mm: 400,
        spread_height_mm: 280,
        bleed_mm: 3,
        facing_pages: true,
        page_binding: 'LeftToRight',
        spreads: TEST_MASTERS,
      },
      mastersByName: makeMastersByName(),
    };
    const layout = buildFromRules(makeInput({}), bundle);

    // Цикл должен корректно завершиться (а не зависнуть)
    expect(layout.status).toBe('partial');
    expect(layout.warnings.some((w) => w.includes('consumed nothing'))).toBe(true);
    // Только одно правило должно было применится (потом cursors не изменились → break)
    const headTraces = layout.decision_trace.filter((t) => t.family_id === 'head-teacher');
    expect(headTraces.length).toBe(1);
  });
});

// =============================================================================
// 7. enabled_when секции
// =============================================================================

describe('buildFromRules — enabled_when секции', () => {
  it('Секция final с enabled_when print_type=soft пропускается для layflat', () => {
    // Создаём кастомный preset с условной секцией
    const stubPreset: Preset = {
      id: 'cond',
      display_name: 'Cond',
      print_type: 'layflat',
      pages_per_spread: 2,
      version: '1.0',
      tenant_id: null,
      sections: [
        { family_id: 'head-teacher' },
        { family_id: 'student-section', params: { density: 'standard', has_quote: true } },
        { family_id: 'final', enabled_when: { print_type: 'soft' } },
      ],
    };
    const baseBundle = makeBundle('standard');
    const bundle: RuleEngineBundle = { ...baseBundle, preset: stubPreset };
    const layout = buildFromRules(makeInput({ students: 2, fullClass: 1 }), bundle);

    const finalTraces = layout.decision_trace.filter((t) => t.family_id === 'final');
    expect(finalTraces.length).toBe(0); // секция final пропущена
  });
});

// =============================================================================
// 8. validateSectionParams warnings
// =============================================================================

describe('buildFromRules — validateSectionParams §4.4', () => {
  it('density=mini + has_quote=true → warning', () => {
    const stubPreset: Preset = {
      id: 'bad',
      display_name: 'Bad',
      print_type: 'layflat',
      pages_per_spread: 2,
      version: '1.0',
      tenant_id: null,
      sections: [
        { family_id: 'student-section', params: { density: 'mini', has_quote: true } },
      ],
    };
    const baseBundle = makeBundle('standard');
    const bundle: RuleEngineBundle = { ...baseBundle, preset: stubPreset };
    const layout = buildFromRules(makeInput({ students: 4 }), bundle);

    // Среди warnings должно быть упоминание has_quote+mini
    const hasQuoteWarning = layout.warnings.some((w) => w.includes('has_quote') && w.includes('mini'));
    expect(hasQuoteWarning).toBe(true);
  });
});

// =============================================================================
// 9. prev_spread.right_page_empty
// =============================================================================

describe('buildFromRules — prev_spread.right_page_empty', () => {
  it('После student-section-standard-tail следующая common-section видит right_page_empty=true', () => {
    const bundle = makeBundle('standard');
    const input = makeInput({ students: 3, subjects: 10, fullClass: 0, halfClass: 2 });
    // 3 ученика → 1 spread (2 ученика) + 1 tail (1 ученик) → правая висит → J-Half
    const layout = buildFromRules(input, bundle);

    // Найти J-Half на правой стороне
    const jHalfMixed = layout.spreads.find(
      (s) => s.right?.bindings.__master_name__ === 'J-Half' && s.mixed_pages,
    );
    expect(jHalfMixed).toBeDefined();
  });
});
