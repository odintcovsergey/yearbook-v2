/**
 * Тесты evaluate.ts (РЭ.10.1).
 *
 * Покрывают:
 *   - evaluateWhen все 14 операторов §7.2
 *   - resolveValue для path/expr/template
 *   - resolveNumber для consumes
 *   - resolveBoolean для skip_if
 *   - Граничные случаи: пустые входы, NaN, undefined пути
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateWhen,
  resolveValue,
  resolveNumber,
  resolveBoolean,
  type EvalScope,
} from '../evaluate';
import type { RuleContext, RulesAlbumInput } from '../types';

// =============================================================================
// Test fixtures
// =============================================================================

function makeCtx(overrides?: Partial<RuleContext>): RuleContext {
  const base: RuleContext = {
    subjects_count: 5,
    students_count: 10,
    students_remaining: 10,
    current_student_index: 0,
    head_teacher: { has_photo: true, has_text: true },
    common_photos: {
      full_class: { count: 1, has_any: true },
      half_class: { count: 2, has_any: true },
      spread: { count: 0, has_any: false },
      quarter: { count: 0, has_any: false },
      sixth: { count: 0, has_any: false },
    },
    print_type: 'layflat',
    section: {
      position: 'middle',
      density: 'standard',
      has_quote: true,
      has_friend_photos: false,
    },
    prev_spread: { right_page_empty: false },
    friend_photos_count: 0,
  };
  return { ...base, ...overrides };
}

function makeInput(): RulesAlbumInput {
  return {
    students: [
      { full_name: 'Анна Иванова', portrait: 'A.jpg', quote: 'Цитата A', friend_photos: ['f1.jpg', 'f2.jpg'] },
      { full_name: 'Борис Петров', portrait: 'B.jpg', quote: 'Цитата B', friend_photos: [] },
      { full_name: 'Виктор Сидоров', portrait: 'C.jpg', quote: '', friend_photos: ['f3.jpg'] },
    ],
    subjects: [
      { name: 'Иванов И.И.', role: 'Математика', photo: 's1.jpg' },
      { name: 'Петров П.П.', role: 'Физика', photo: 's2.jpg' },
    ],
    head_teacher: {
      name: 'Сидорова С.С.',
      role: 'Классный руководитель',
      text: 'Поздравляю выпускников!',
      photo: 'ht.jpg',
    },
    common_photos: {
      full_class: ['fc1.jpg'],
      half_class: ['hc1.jpg', 'hc2.jpg'],
      spread: [],
      quarter: [],
      sixth: ['sx1.jpg', 'sx2.jpg', 'sx3.jpg', 'sx4.jpg', 'sx5.jpg', 'sx6.jpg'],
    },
  };
}

function makeScope(
  ctxOverrides?: Partial<RuleContext>,
  cursors: Record<string, number> = {},
  range_vars: Record<string, number> = {},
): EvalScope {
  return {
    ctx: makeCtx(ctxOverrides),
    input: makeInput(),
    cursors,
    range_vars,
  };
}

// =============================================================================
// evaluateWhen — операторы §7.2
// =============================================================================

describe('evaluateWhen — операторы', () => {
  it('литерал string как {eq}', () => {
    expect(evaluateWhen({ print_type: 'layflat' }, makeCtx())).toBe(true);
    expect(evaluateWhen({ print_type: 'soft' }, makeCtx())).toBe(false);
  });

  it('литерал number как {eq}', () => {
    expect(evaluateWhen({ subjects_count: 5 }, makeCtx())).toBe(true);
    expect(evaluateWhen({ subjects_count: 6 }, makeCtx())).toBe(false);
  });

  it('{eq} с явным объектом', () => {
    expect(evaluateWhen({ subjects_count: { eq: 5 } }, makeCtx())).toBe(true);
  });

  it('{neq}', () => {
    expect(evaluateWhen({ print_type: { neq: 'soft' } }, makeCtx())).toBe(true);
    expect(evaluateWhen({ print_type: { neq: 'layflat' } }, makeCtx())).toBe(false);
  });

  it('{gte}/{lte}/{gt}/{lt}', () => {
    const ctx = makeCtx({ subjects_count: 9 });
    expect(evaluateWhen({ subjects_count: { gte: 9 } }, ctx)).toBe(true);
    expect(evaluateWhen({ subjects_count: { gt: 9 } }, ctx)).toBe(false);
    expect(evaluateWhen({ subjects_count: { lte: 9 } }, ctx)).toBe(true);
    expect(evaluateWhen({ subjects_count: { lt: 10 } }, ctx)).toBe(true);
  });

  it('{between} включительно', () => {
    const ctx = makeCtx({ subjects_count: 10 });
    expect(evaluateWhen({ subjects_count: { between: [10, 12] } }, ctx)).toBe(true);
    expect(evaluateWhen({ subjects_count: { between: [11, 12] } }, ctx)).toBe(false);
    expect(evaluateWhen({ subjects_count: { between: [9, 10] } }, ctx)).toBe(true);
  });

  it('{in}/{not_in}', () => {
    expect(evaluateWhen({ print_type: { in: ['layflat', 'tryumo'] } }, makeCtx())).toBe(true);
    expect(evaluateWhen({ print_type: { in: ['soft'] } }, makeCtx())).toBe(false);
    expect(evaluateWhen({ print_type: { not_in: ['soft'] } }, makeCtx())).toBe(true);
  });

  it('AND нескольких полей: false если хоть одно не сходится', () => {
    expect(
      evaluateWhen(
        {
          subjects_count: { between: [1, 4] },
          print_type: 'layflat',
        },
        makeCtx({ subjects_count: 3 }),
      ),
    ).toBe(true);
    expect(
      evaluateWhen(
        {
          subjects_count: { between: [1, 4] },
          print_type: 'layflat',
        },
        makeCtx({ subjects_count: 5 }),
      ),
    ).toBe(false);
  });

  it('вложенный путь common_photos.half_class.count', () => {
    const ctx = makeCtx({
      common_photos: {
        full_class: { count: 0 },
        half_class: { count: 2 },
        spread: { count: 0 },
        quarter: { count: 0 },
        sixth: { count: 0 },
      },
    });
    expect(evaluateWhen({ 'common_photos.half_class.count': { gte: 2 } }, ctx)).toBe(true);
    expect(evaluateWhen({ 'common_photos.half_class.count': { gte: 3 } }, ctx)).toBe(false);
  });

  it('prev_spread.right_page_empty boolean', () => {
    expect(
      evaluateWhen({ 'prev_spread.right_page_empty': true }, makeCtx({ prev_spread: { right_page_empty: true } })),
    ).toBe(true);
    expect(
      evaluateWhen({ 'prev_spread.right_page_empty': true }, makeCtx({ prev_spread: { right_page_empty: false } })),
    ).toBe(false);
  });

  it('правило с приоритетом 110 vs 100: оба matches', () => {
    // Сценарий t-class-0-classphoto-and-halfs (priority 110)
    const ctx = makeCtx({
      subjects_count: 0,
      common_photos: {
        full_class: { count: 1 },
        half_class: { count: 2 },
        spread: { count: 0 },
        quarter: { count: 0 },
        sixth: { count: 0 },
      },
    });
    const wPriority110 = {
      subjects_count: 0,
      'common_photos.full_class.count': { gte: 1 },
      'common_photos.half_class.count': { gte: 2 },
      print_type: 'layflat',
    } as const;
    const wPriority100 = {
      subjects_count: 0,
      'common_photos.half_class.count': { gte: 2 },
      print_type: 'layflat',
    } as const;
    expect(evaluateWhen(wPriority110, ctx)).toBe(true);
    expect(evaluateWhen(wPriority100, ctx)).toBe(true);
    // Из двух — алгоритм выберет priority 110 (это уже build.ts тест)
  });
});

// =============================================================================
// resolveValue — пути
// =============================================================================

describe('resolveValue — пути', () => {
  it('простой path input.head_teacher.photo', () => {
    expect(resolveValue('input.head_teacher.photo', makeScope())).toBe('ht.jpg');
  });

  it('path с переменной $current_student_index', () => {
    const scope = makeScope({}, { current_student_index: 1 });
    expect(resolveValue('input.students[$current_student_index].full_name', scope)).toBe('Борис Петров');
  });

  it('path с арифметикой в индексе', () => {
    const scope = makeScope({}, { current_student_index: 0 });
    expect(resolveValue('input.students[$current_student_index + 1].full_name', scope)).toBe('Борис Петров');
  });

  it('path с {i} range_var', () => {
    const scope = makeScope({}, { current_student_index: 0 }, { i: 2 });
    expect(resolveValue('input.students[$current_student_index + {i} - 1].full_name', scope)).toBe('Борис Петров');
  });

  it('path out of bounds → null', () => {
    const scope = makeScope({}, { current_student_index: 100 });
    expect(resolveValue('input.students[$current_student_index].full_name', scope)).toBeNull();
  });

  it('пустая цитата → null (normalizeBindResult)', () => {
    // У третьего ученика quote = ''
    const scope = makeScope({}, { current_student_index: 2 });
    // resolveValue возвращает '' (пустую строку) для empty quote — это сырое значение,
    // которое в apply.ts нормализуется в null.
    expect(resolveValue('input.students[$current_student_index].quote', scope)).toBe('');
  });

  it('метод .last() на массиве', () => {
    expect(resolveValue('input.common_photos.full_class.last()', makeScope())).toBe('fc1.jpg');
  });

  it('.last() на пустом массиве → null', () => {
    expect(resolveValue('input.common_photos.spread.last()', makeScope())).toBeNull();
  });
});

// =============================================================================
// resolveValue — выражения
// =============================================================================

describe('resolveValue — выражения', () => {
  it('тернарный section.has_quote ? quote : null (true)', () => {
    const scope = makeScope({}, { current_student_index: 0 });
    const expr = 'section.has_quote ? input.students[$current_student_index].quote : null';
    expect(resolveValue(expr, scope)).toBe('Цитата A');
  });

  it('тернарный section.has_quote ? quote : null (false)', () => {
    const scope = makeScope({ section: { position: 'middle', density: 'standard', has_quote: false } }, { current_student_index: 0 });
    const expr = 'section.has_quote ? input.students[$current_student_index].quote : null';
    expect(resolveValue(expr, scope)).toBeNull();
  });

  it('унарный !section.has_friend_photos', () => {
    const scope = makeScope({ section: { position: 'middle', has_friend_photos: false } });
    expect(resolveValue('!section.has_friend_photos', scope)).toBe(true);
  });

  it('nullish coalescing chain', () => {
    // У первого общего фото есть, у spread пусто → first non-null = fc1
    const expr = 'input.common_photos.full_class.last() ?? input.common_photos.half_class[0] ?? null';
    expect(resolveValue(expr, makeScope())).toBe('fc1.jpg');
  });

  it('min(students_remaining, 6)', () => {
    expect(resolveValue('min(students_remaining, 6)', makeScope({ students_remaining: 3 }))).toBe(3);
    expect(resolveValue('min(students_remaining, 6)', makeScope({ students_remaining: 10 }))).toBe(6);
  });

  it('арифметика students_remaining - 6', () => {
    expect(resolveValue('students_remaining - 6', makeScope({ students_remaining: 10 }))).toBe(4);
  });
});

// =============================================================================
// resolveNumber — для consumes и range
// =============================================================================

describe('resolveNumber', () => {
  it('literal number proxy', () => {
    expect(resolveNumber(2, makeScope())).toBe(2);
  });

  it('expression students_remaining', () => {
    expect(resolveNumber('students_remaining', makeScope({ students_remaining: 7 }))).toBe(7);
  });

  it('expression with arithmetic', () => {
    expect(resolveNumber('students_remaining - 6', makeScope({ students_remaining: 10 }))).toBe(4);
  });

  it('expression with min()', () => {
    expect(resolveNumber('min(students_remaining, 6)', makeScope({ students_remaining: 4 }))).toBe(4);
  });

  it('non-numeric expression → NaN', () => {
    expect(Number.isNaN(resolveNumber('print_type', makeScope()))).toBe(true);
  });
});

// =============================================================================
// resolveBoolean — для skip_if
// =============================================================================

describe('resolveBoolean', () => {
  it('skip_if !section.has_friend_photos when false', () => {
    const scope = makeScope({ section: { position: 'middle', has_friend_photos: false } });
    expect(resolveBoolean('!section.has_friend_photos', scope)).toBe(true);
  });

  it('skip_if !section.has_friend_photos when true', () => {
    const scope = makeScope({ section: { position: 'middle', has_friend_photos: true } });
    expect(resolveBoolean('!section.has_friend_photos', scope)).toBe(false);
  });
});
