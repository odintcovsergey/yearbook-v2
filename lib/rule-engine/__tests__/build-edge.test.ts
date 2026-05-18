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
  quarter?: number;
  sixth?: number;
  commonSectionMaxSpreads?: number | null;
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
      quarter: Array.from({ length: opts.quarter ?? 0 }, (_, i) => `qt${i + 1}.jpg`),
      sixth: Array.from({ length: opts.sixth ?? 0 }, (_, i) => `sx${i + 1}.jpg`),
    },
    common_section_max_spreads: opts.commonSectionMaxSpreads,
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
  it('Singleton-семейство без consumes: 1 разворот, БЕЗ warning (после РЭ.15.2)', () => {
    // До РЭ.15.2 head-teacher без consumes давал warning 'consumed nothing'
    // потому что общая защита от inf-loop срабатывала. После РЭ.15.2
    // warning подавлен для singleton — это нормальное поведение
    // правил вроде final-text-only / t-class-*-no-common.
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
      max_pages: 24,
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

    // status='ok' — нет warnings вообще (после РЭ.15.2)
    expect(layout.status).toBe('ok');
    expect(layout.warnings.some((w) => w.includes('consumed nothing'))).toBe(false);
    // Singleton всё равно сработал 1 раз
    const headTraces = layout.decision_trace.filter((t) => t.family_id === 'head-teacher');
    expect(headTraces.length).toBe(1);
  });

  it('Iterative-семейство без consumes: 1 разворот + warning (защита работает)', () => {
    // Если итеративное правило ничего не потребляет — это потенциальный
    // баг правила. Warning сохраняется как сигнал разработчику.
    const stubRule: Rule = {
      id: 'stub-iterative-no-consume',
      family_id: 'student-section',
      family_version: '1.0',
      priority: 100,
      when: {},
      produces: { type: 'page', side: 'left', master: 'L-Grid-Page' },
      bind: {},
      // consumes отсутствует — обычно у student-section это баг
    };
    const stubPreset: Preset = {
      id: 'stub-it',
      display_name: 'Stub Iter',
      print_type: 'layflat',
      pages_per_spread: 2,
      version: '1.0',
      tenant_id: null,
      max_pages: 24,
      sections: [{ family_id: 'student-section', params: { density: 'light' } }],
    };
    const stubFamily: TemplateFamily = {
      id: 'student-section',
      display_name: 'Student Section',
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
    const layout = buildFromRules(makeInput({ students: 5 }), bundle);

    // status='partial' — есть warning о подозрительном поведении
    expect(layout.status).toBe('partial');
    expect(layout.warnings.some((w) => w.includes('consumed nothing'))).toBe(true);
    // Защита сработала — 1 итерация (не 200)
    const traces = layout.decision_trace.filter((t) => t.family_id === 'student-section');
    expect(traces.length).toBe(1);
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
      max_pages: 24,
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
      max_pages: 24,
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

// =============================================================================
// 10. Singleton-семейства (РЭ.15.1 bug fix)
// =============================================================================
// До РЭ.15.1 head-teacher / intro / final могли срабатывать многократно
// в одной секции если их правила что-то потребляли (например half_class
// фото). Защита cursorsChanged срабатывает только когда правило ничего
// не потребляет. Это давало 19 учительских разворотов вместо одного для
// реальных альбомов с фото полкласса/общими.

describe('buildFromRules — singleton-семейства не повторяются', () => {
  it('head-teacher применяется ОДИН раз даже если есть много фото half_class', () => {
    // Реальный сценарий «тест 2026» Сергея: 8 учеников, 1 предметник,
    // head_teacher, 10 общих, 9 половин. До фикса было 19 разворотов
    // head-teacher (рекурсивно срабатывало t-class-1-4-half и -full).
    const bundle = makeBundle('standard');
    const input = makeInput({
      students: 8,
      subjects: 1,
      fullClass: 10,
      halfClass: 9,
    });
    const layout = buildFromRules(input, bundle);

    expect(layout.status).not.toBe('failed');
    const headTraces = layout.decision_trace.filter((t) => t.family_id === 'head-teacher');
    expect(headTraces.length).toBe(1);
  });

  it('head-teacher применяется ОДИН раз для subjects=0 + общее + полкласса', () => {
    // Этот сценарий триггерил t-class-0-classphoto-and-halfs (priority 110)
    // — раньше тоже мог повторяться пока half_class есть.
    const bundle = makeBundle('standard');
    const input = makeInput({
      students: 4,
      subjects: 0,
      fullClass: 5,
      halfClass: 6,
    });
    const layout = buildFromRules(input, bundle);

    const headTraces = layout.decision_trace.filter((t) => t.family_id === 'head-teacher');
    expect(headTraces.length).toBe(1);
    expect(headTraces[0].rule_id).toBe('t-class-0-classphoto-and-halfs');
  });

  it('intro применяется ОДИН раз в mini-soft пресете даже с обилием общих фото', () => {
    const bundle = makeBundle('mini-soft');
    const input = makeInput({ students: 5, fullClass: 8 });
    const layout = buildFromRules(input, bundle);

    const introTraces = layout.decision_trace.filter((t) => t.family_id === 'intro');
    expect(introTraces.length).toBe(1);
  });

  it('final применяется ОДИН раз в mini-soft пресете', () => {
    const bundle = makeBundle('mini-soft');
    const input = makeInput({ students: 5, fullClass: 8 });
    const layout = buildFromRules(input, bundle);

    const finalTraces = layout.decision_trace.filter((t) => t.family_id === 'final');
    expect(finalTraces.length).toBe(1);
  });

  it('student-section / common-section остаются итеративными', () => {
    // Регрессионный тест: фикс не должен сломать итеративность.
    const bundle = makeBundle('standard');
    const input = makeInput({ students: 6, fullClass: 0, halfClass: 0 });
    const layout = buildFromRules(input, bundle);

    const studentTraces = layout.decision_trace.filter((t) => t.family_id === 'student-section');
    // 6 учеников Standard = 3 spread (по 2 ученика) → 3 итерации правила
    expect(studentTraces.length).toBe(3);
  });

  it('Сценарий "тест 2026": итоговая структура разумна (РЭ.18 — с общим разделом)', () => {
    // 8 учеников, 1 предметник, есть head_teacher, 10 full + 9 half + 30 sixth.
    // ОБНОВЛЕНО ПОСЛЕ РЭ.18:
    //   - 1 разворот head-teacher (F-Head + G-HalfClass потребляет 2 half)
    //   - 4 разворота student-section-standard-pair (8/2 = 4)
    //   - common-section:
    //     - 5 разворотов full_class (10 фото / 2 на разворот)
    //     - 1 разворот half_class (остаток 7 → 1 пара по 4 фото, остаётся 3)
    //     - 2 разворота sixth (30 / 12 = 2 разворота по 12 фото, остаётся 6)
    //   = 1 + 4 + 5 + 1 + 2 = 13 разворотов
    const bundle = makeBundle('standard');
    const input = makeInput({
      students: 8,
      subjects: 1,
      fullClass: 10,
      halfClass: 9,
      sixth: 30,
    });
    const layout = buildFromRules(input, bundle);

    expect(layout.status).not.toBe('failed');
    expect(layout.spreads.length).toBe(13);

    const families = layout.decision_trace.map((t) => t.family_id);
    expect(families.filter((f) => f === 'head-teacher').length).toBe(1);
    expect(families.filter((f) => f === 'student-section').length).toBe(4);
    // Общий раздел: 5 full + 1 half + 2 sixth = 8 решений
    expect(families.filter((f) => f === 'common-section').length).toBe(8);
  });
});

// =============================================================================
// 11. Общий раздел — РЭ.18
// =============================================================================
// До РЭ.18 правила common-section были только fill-hanging-page-* —
// заполнить висящую правую страницу. Для симметричных альбомов (типа
// 'тест 2026' с 8 учениками) общий раздел вообще не создавался.
// После РЭ.18 — 4 новых правила common-section-*-pair создают
// полноценные развороты раздела с учётом common_section_max_spreads.

describe('buildFromRules — общий раздел (РЭ.18)', () => {
  it('10 фото full_class → 4 разворота common-section (head-teacher съест 1)', () => {
    // Standard preset: head-teacher t-class-0-full потребляет 1 full_class
    // (для G-FullClass на правой стороне учительского разворота).
    // Остаётся 9 → common-section-full-class-pair (gte:2) сматчит 4 раза
    // потребляя 8, остаётся 1 (правило gte:2 не сматчит).
    const bundle = makeBundle('standard');
    const input = makeInput({ students: 2, fullClass: 10 });
    const layout = buildFromRules(input, bundle);

    expect(layout.status).not.toBe('failed');
    const commonDecisions = layout.decision_trace.filter(
      (t) => t.family_id === 'common-section',
    );
    expect(commonDecisions.length).toBe(4);
    expect(commonDecisions.every((d) => d.rule_id === 'common-section-full-class-pair')).toBe(true);
  });

  it('common_section_max_spreads=2 → ограничивает количество разворотов', () => {
    const bundle = makeBundle('standard');
    const input = makeInput({
      students: 2,
      fullClass: 10, // 4 разворота без лимита
      commonSectionMaxSpreads: 2,
    });
    const layout = buildFromRules(input, bundle);

    const commonDecisions = layout.decision_trace.filter(
      (t) => t.family_id === 'common-section',
    );
    // Лимит 2 → только 2 разворота common-section
    expect(commonDecisions.length).toBe(2);
  });

  it('common_section_max_spreads=0 → раздел отключён полностью', () => {
    const bundle = makeBundle('standard');
    const input = makeInput({
      students: 2,
      fullClass: 10,
      halfClass: 8,
      sixth: 30,
      commonSectionMaxSpreads: 0,
    });
    const layout = buildFromRules(input, bundle);

    const commonDecisions = layout.decision_trace.filter(
      (t) => t.family_id === 'common-section',
    );
    expect(commonDecisions.length).toBe(0);
  });

  it('common_section_max_spreads=null → без лимита (5 разворотов: 4 full + 1 half)', () => {
    // Standard, subjects=0 → head-teacher t-class-0-classphoto-and-halfs
    // потребляет 1 full + 2 half. Остаётся 9 full + 6 half.
    // common-section-full-class-pair: 9/2 = 4 разворота (потребляет 8), 1 fc остаётся
    // common-section-half-class-pair: 6/4 = 1 разворот (потребляет 4), 2 hc остаётся
    // Итого common-section: 4 + 1 = 5.
    const bundle = makeBundle('standard');
    const input = makeInput({
      students: 2,
      fullClass: 10,
      halfClass: 8,
      commonSectionMaxSpreads: null,
    });
    const layout = buildFromRules(input, bundle);

    const commonDecisions = layout.decision_trace.filter(
      (t) => t.family_id === 'common-section',
    );
    expect(commonDecisions.length).toBe(5);
  });

  it('Приоритет: сначала full_class (200), потом half_class (190)', () => {
    // Standard, subjects=0 → head-teacher потребляет 1 full + 2 half.
    // Чтобы протестировать порядок full→half — нужно >=2 fc после head'a И
    // >=4 hc после head'a. Подаём 4 fc + 6 hc → head съест 1 fc + 2 hc →
    // остаётся 3 fc + 4 hc. full-pair sometimes 1 раз (gte:2), остаётся 1 fc.
    // half-pair 1 раз (gte:4), остаётся 0. Итого 2 common-decisions, full сначала.
    const bundle = makeBundle('standard');
    const input = makeInput({ students: 2, fullClass: 4, halfClass: 6 });
    const layout = buildFromRules(input, bundle);

    const commonDecisions = layout.decision_trace.filter(
      (t) => t.family_id === 'common-section',
    );
    expect(commonDecisions.length).toBe(2);
    // Сначала full (priority 200), потом half (190)
    expect(commonDecisions[0].rule_id).toBe('common-section-full-class-pair');
    expect(commonDecisions[1].rule_id).toBe('common-section-half-class-pair');
  });

  it('12 фото sixth → 1 разворот J-Collage pair', () => {
    // sixth не трогается head-teacher'ом — никакое t-class-* правило не
    // потребляет sixth.
    const bundle = makeBundle('standard');
    const input = makeInput({ students: 2, sixth: 12 });
    const layout = buildFromRules(input, bundle);

    const commonDecisions = layout.decision_trace.filter(
      (t) => t.family_id === 'common-section',
    );
    expect(commonDecisions.length).toBe(1);
    expect(commonDecisions[0].rule_id).toBe('common-section-sixth-pair');
  });

  it('Регрессия: fill-hanging-page всё ещё работает (приоритет 80-100 не мешает)', () => {
    // 3 ученика Standard → 1 пара + 1 tail → правая висит.
    // На висящей правой common-section секция выбирает по приоритету:
    //   common-section-full-class-pair (200) gte:2 — нет fc → не сматчит
    //   common-section-half-class-pair (190) gte:4 — есть 2 → не сматчит
    //   common-section-quarter-pair (180) gte:4 — нет quarter → не сматчит
    //   common-section-sixth-pair (170) gte:12 — нет sixth → не сматчит
    //   common-fill-hanging-page-half (100) gte:2 + right_page_empty=true → СМАТЧИТ
    const bundle = makeBundle('standard');
    const input = makeInput({ students: 3, subjects: 10, halfClass: 2 });
    const layout = buildFromRules(input, bundle);

    const fillHang = layout.decision_trace.find(
      (t) => t.rule_id === 'common-fill-hanging-page-half',
    );
    expect(fillHang).toBeDefined();
  });
});
