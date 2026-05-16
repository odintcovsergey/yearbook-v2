/**
 * Тесты apply.ts (РЭ.10.2).
 *
 * Покрывают applyRule:
 *   - simple page (single master)
 *   - spread с разными мастерами
 *   - spread с одинаковыми мастерами (left_master/right_master ключи)
 *   - параметрический range
 *   - skip_if=true → не выдаём метки
 *   - master selector (parametric / params)
 *   - master не найден → master_id=undefined + error
 *   - заполнение null для несвязанных placeholder'ов
 */

import { describe, it, expect } from 'vitest';
import { applyRule } from '../apply';
import type { Rule, RuleContext, RulesAlbumInput } from '../types';
import { makeMastersByName } from './__fixtures__/masters';

// =============================================================================
// Fixtures
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
    section: { position: 'middle', density: 'standard', has_quote: true, has_friend_photos: false },
    prev_spread: { right_page_empty: false },
    friend_photos_count: 0,
  };
  return { ...base, ...overrides };
}

function makeInput(): RulesAlbumInput {
  return {
    students: [
      { full_name: 'А', portrait: 'A.jpg', quote: 'Q-A', friend_photos: ['fA1', 'fA2', 'fA3', 'fA4'] },
      { full_name: 'Б', portrait: 'B.jpg', quote: 'Q-B', friend_photos: [] },
      { full_name: 'В', portrait: 'C.jpg', quote: 'Q-C', friend_photos: ['fC1'] },
      { full_name: 'Г', portrait: 'D.jpg', quote: 'Q-D', friend_photos: [] },
    ],
    subjects: [
      { name: 'T1', role: 'R1', photo: 's1.jpg' },
      { name: 'T2', role: 'R2', photo: 's2.jpg' },
    ],
    head_teacher: { name: 'HT', role: 'HR', text: 'HText', photo: 'ht.jpg' },
    common_photos: {
      full_class: ['fc1'],
      half_class: ['hc1', 'hc2'],
      spread: [],
      quarter: [],
      sixth: [],
    },
  };
}

// =============================================================================
// Тесты
// =============================================================================

describe('applyRule — type=spread с разными мастерами', () => {
  it('head-teacher t-class-1-4-full: F-Head-SmallGrid + G-FullClass', () => {
    const rule: Rule = {
      id: 't-class-1-4-full',
      family_id: 'head-teacher',
      family_version: '1.0',
      priority: 90,
      when: {},
      produces: {
        type: 'spread',
        left_master: 'F-Head-SmallGrid',
        right_master: 'G-FullClass',
      },
      bind: {
        'F-Head-SmallGrid': {
          headteacherphoto: 'input.head_teacher.photo',
          headteachername: 'input.head_teacher.name',
          'teacherphoto_{i}': {
            template: 'input.subjects[{i}-1].photo',
            params: { i: { range: [1, 'subjects_count'] } },
          },
        },
        'G-FullClass': {
          classphotoframe: 'input.common_photos.full_class[0]',
        },
      },
    };

    const r = applyRule(rule, makeCtx({ subjects_count: 2 }), makeInput(), {}, makeMastersByName());

    expect(r.left).not.toBeNull();
    expect(r.right).not.toBeNull();
    expect(r.left?.master_name).toBe('F-Head-SmallGrid');
    expect(r.right?.master_name).toBe('G-FullClass');
    expect(r.left?.bindings.headteacherphoto).toBe('ht.jpg');
    expect(r.left?.bindings.teacherphoto_1).toBe('s1.jpg');
    expect(r.left?.bindings.teacherphoto_2).toBe('s2.jpg');
    // teacherphoto_3, _4 — null (есть в placeholders но нет данных) — заполняются null
    expect(r.left?.bindings.teacherphoto_3).toBeNull();
    expect(r.left?.bindings.teacherphoto_4).toBeNull();
    expect(r.right?.bindings.classphotoframe).toBe('fc1');
  });
});

describe('applyRule — type=spread с одинаковыми мастерами (left_master/right_master ключи)', () => {
  it('light-overflow: L-Grid-Page + L-Grid-Page', () => {
    const rule: Rule = {
      id: 'student-section-light-overflow',
      family_id: 'student-section',
      family_version: '1.0',
      priority: 200,
      when: {},
      produces: {
        type: 'spread',
        left_master: 'L-Grid-Page',
        right_master: 'L-Grid-Page',
      },
      bind: {
        left_master: {
          'studentportrait_{i}': {
            template: 'input.students[$current_student_index + {i} - 1].portrait',
            params: { i: { range: [1, 2] } },
          },
        },
        right_master: {
          'studentportrait_{i}': {
            template: 'input.students[$current_student_index + 2 + {i} - 1].portrait',
            params: { i: { range: [1, 2] } },
          },
        },
      },
      consumes: { students: 4 },
    };

    const r = applyRule(
      rule,
      makeCtx({ students_remaining: 4 }),
      makeInput(),
      { current_student_index: 0 },
      makeMastersByName(),
    );

    expect(r.left?.master_name).toBe('L-Grid-Page');
    expect(r.right?.master_name).toBe('L-Grid-Page');
    expect(r.left?.bindings.studentportrait_1).toBe('A.jpg');
    expect(r.left?.bindings.studentportrait_2).toBe('B.jpg');
    expect(r.right?.bindings.studentportrait_1).toBe('C.jpg');
    expect(r.right?.bindings.studentportrait_2).toBe('D.jpg');
  });
});

describe('applyRule — type=page', () => {
  it('common-half: J-Half на right side, индексация через $consumed_half_class', () => {
    const rule: Rule = {
      id: 'common-fill-hanging-page-half',
      family_id: 'common-section',
      family_version: '1.0',
      priority: 100,
      when: {},
      produces: { type: 'page', side: 'right', master: 'J-Half' },
      bind: {
        'J-Half': {
          halfphoto_1: 'input.common_photos.half_class[$consumed_half_class]',
          halfphoto_2: 'input.common_photos.half_class[$consumed_half_class + 1]',
        },
      },
      consumes: { common_photos: { half_class: 2 } },
    };

    const r = applyRule(rule, makeCtx(), makeInput(), { consumed_half_class: 0 }, makeMastersByName());
    expect(r.right).not.toBeNull();
    expect(r.left).toBeNull();
    expect(r.right?.master_name).toBe('J-Half');
    expect(r.right?.side).toBe('right');
    expect(r.right?.bindings.halfphoto_1).toBe('hc1');
    expect(r.right?.bindings.halfphoto_2).toBe('hc2');
  });

  it('student-section-standard-tail: E-Standard-Left на left side (single tail)', () => {
    const rule: Rule = {
      id: 'student-section-standard-tail',
      family_id: 'student-section',
      family_version: '1.0',
      priority: 50,
      when: {},
      produces: { type: 'page', side: 'left', master: 'E-Standard-Left' },
      bind: {
        'E-Standard-Left': {
          studentportrait: 'input.students[$current_student_index].portrait',
          studentname: 'input.students[$current_student_index].full_name',
          studentquote: {
            expr: 'section.has_quote ? input.students[$current_student_index].quote : null',
          },
        },
      },
      consumes: { students: 1 },
    };

    const r = applyRule(
      rule,
      makeCtx({ students_remaining: 1, section: { position: 'middle', density: 'standard', has_quote: true } }),
      makeInput(),
      { current_student_index: 3 },
      makeMastersByName(),
    );
    expect(r.left).not.toBeNull();
    expect(r.right).toBeNull();
    expect(r.left?.master_name).toBe('E-Standard-Left');
    expect(r.left?.bindings.studentportrait).toBe('D.jpg');
    expect(r.left?.bindings.studentname).toBe('Г');
    expect(r.left?.bindings.studentquote).toBe('Q-D');
  });
});

describe('applyRule — skip_if', () => {
  it('maximum без has_friend_photos: studentphoto_* пропускаются', () => {
    const rule: Rule = {
      id: 'student-section-maximum',
      family_id: 'student-section',
      family_version: '1.0',
      priority: 100,
      when: {},
      produces: { type: 'spread', left_master: 'E-Max-Left', right_master: 'E-Max-Right' },
      bind: {
        'E-Max-Left': {
          studentportrait: 'input.students[$current_student_index].portrait',
          studentname: 'input.students[$current_student_index].full_name',
        },
        'E-Max-Right': {
          studentquote: { expr: 'section.has_quote ? input.students[$current_student_index].quote : null' },
          'studentphoto_{i}': {
            template: 'input.students[$current_student_index].friend_photos[{i}-1]',
            params: { i: { range: [1, 'section.friend_photos_max'] } },
            skip_if: '!section.has_friend_photos',
          },
        },
      },
      consumes: { students: 1 },
    };

    const r = applyRule(
      rule,
      makeCtx({
        students_remaining: 4,
        section: {
          position: 'middle',
          density: 'maximum',
          has_quote: true,
          has_friend_photos: false, // ← должно скипнуть
          friend_photos_max: 4,
        },
      }),
      makeInput(),
      { current_student_index: 0 },
      makeMastersByName(),
    );
    expect(r.right?.bindings.studentquote).toBe('Q-A');
    // studentphoto_1..4 — должны быть null (skip_if сработал, но placeholder в мастере есть)
    expect(r.right?.bindings.studentphoto_1).toBeNull();
    expect(r.right?.bindings.studentphoto_2).toBeNull();
    expect(r.right?.bindings.studentphoto_3).toBeNull();
    expect(r.right?.bindings.studentphoto_4).toBeNull();
  });

  it('maximum с has_friend_photos и 1 фото из 4: остальные null', () => {
    const rule: Rule = {
      id: 'student-section-maximum',
      family_id: 'student-section',
      family_version: '1.0',
      priority: 100,
      when: {},
      produces: { type: 'spread', left_master: 'E-Max-Left', right_master: 'E-Max-Right' },
      bind: {
        'E-Max-Right': {
          'studentphoto_{i}': {
            template: 'input.students[$current_student_index].friend_photos[{i}-1]',
            params: { i: { range: [1, 'section.friend_photos_max'] } },
            skip_if: '!section.has_friend_photos',
          },
        },
      },
      consumes: { students: 1 },
    };

    const r = applyRule(
      rule,
      makeCtx({
        students_remaining: 2,
        section: {
          position: 'middle',
          density: 'maximum',
          has_quote: true,
          has_friend_photos: true,
          friend_photos_max: 4,
        },
      }),
      makeInput(),
      { current_student_index: 2 }, // студент В: friend_photos=['fC1']
      makeMastersByName(),
    );
    expect(r.right?.bindings.studentphoto_1).toBe('fC1');
    expect(r.right?.bindings.studentphoto_2).toBeNull();
    expect(r.right?.bindings.studentphoto_3).toBeNull();
    expect(r.right?.bindings.studentphoto_4).toBeNull();
  });
});

describe('applyRule — master selector (parametric)', () => {
  it('parametric L-Grid-Page с slot_count=3', () => {
    const rule: Rule = {
      id: 'parametric-light-3',
      family_id: 'student-section',
      family_version: '1.0',
      priority: 100,
      when: {},
      produces: {
        type: 'page',
        side: 'left',
        master: { parametric: 'L-Grid-Page', params: { slot_count: 'min(students_remaining, 6)' } },
      },
      bind: {
        'L-Grid-Page': {
          'studentportrait_{i}': {
            template: 'input.students[$current_student_index + {i} - 1].portrait',
            params: { i: { range: [1, '$slot_count'] } },
          },
        },
      },
      consumes: { students: 'min(students_remaining, 6)' },
    };

    const r = applyRule(
      rule,
      makeCtx({ students_remaining: 3 }),
      makeInput(),
      { current_student_index: 0 },
      makeMastersByName(),
    );
    expect(r.left?.master_name).toBe('L-Grid-Page');
    expect(r.left?.master_selector_params.slot_count).toBe(3);
    expect(r.left?.bindings.studentportrait_1).toBe('A.jpg');
    expect(r.left?.bindings.studentportrait_2).toBe('B.jpg');
    expect(r.left?.bindings.studentportrait_3).toBe('C.jpg');
    expect(r.left?.bindings.studentportrait_4).toBeNull(); // slot_count=3, _4 в placeholders но без данных
  });
});

describe('applyRule — master не найден', () => {
  it('несуществующий мастер → master_id=undefined + resolve_error', () => {
    const rule: Rule = {
      id: 'test-missing',
      family_id: 'head-teacher',
      family_version: '1.0',
      priority: 100,
      when: {},
      produces: { type: 'page', side: 'left', master: 'Z-DoesNotExist' },
      bind: {},
    };
    const r = applyRule(rule, makeCtx(), makeInput(), {}, makeMastersByName());
    expect(r.left?.master_id).toBeUndefined();
    expect(r.resolve_errors.some((e) => e.includes('Z-DoesNotExist'))).toBe(true);
  });
});

describe('applyRule — заполнение null для несвязанных placeholder', () => {
  it('rule.bind покрывает только portrait, name; quote в мастере → bindings.quote=null', () => {
    const rule: Rule = {
      id: 'test-partial-bind',
      family_id: 'student-section',
      family_version: '1.0',
      priority: 100,
      when: {},
      produces: { type: 'page', side: 'left', master: 'E-Standard-Left' },
      bind: {
        'E-Standard-Left': {
          studentportrait: 'input.students[$current_student_index].portrait',
          studentname: 'input.students[$current_student_index].full_name',
          // studentquote НЕ задан в bind, но есть в мастере → null
        },
      },
      consumes: { students: 1 },
    };
    const r = applyRule(rule, makeCtx(), makeInput(), { current_student_index: 0 }, makeMastersByName());
    expect(r.left?.bindings.studentportrait).toBe('A.jpg');
    expect(r.left?.bindings.studentname).toBe('А');
    expect(r.left?.bindings.studentquote).toBeNull();
  });
});

describe('applyRule — range с динамической границей', () => {
  it('range [1, subjects_count] с 3 предметниками → 3 итерации', () => {
    const rule: Rule = {
      id: 'test-dynamic-range',
      family_id: 'head-teacher',
      family_version: '1.0',
      priority: 100,
      when: {},
      produces: { type: 'page', side: 'left', master: 'G-Teachers-3x3' },
      bind: {
        'G-Teachers-3x3': {
          'teacherphoto_{i}': {
            template: 'input.subjects[{i}-1].photo',
            params: { i: { range: [1, 'subjects_count'] } },
          },
        },
      },
    };
    const r = applyRule(rule, makeCtx({ subjects_count: 2 }), makeInput(), {}, makeMastersByName());
    expect(r.left?.bindings.teacherphoto_1).toBe('s1.jpg');
    expect(r.left?.bindings.teacherphoto_2).toBe('s2.jpg');
    // _3 .. _9 — есть в placeholders, нет данных → null
    expect(r.left?.bindings.teacherphoto_3).toBeNull();
    expect(r.left?.bindings.teacherphoto_9).toBeNull();
  });

  it('range [1, students_remaining - 6] с remaining=8 → 2 итерации', () => {
    const rule: Rule = {
      id: 'test-arith-range',
      family_id: 'student-section',
      family_version: '1.0',
      priority: 100,
      when: {},
      produces: { type: 'page', side: 'right', master: 'L-Grid-Page' },
      bind: {
        'L-Grid-Page': {
          'studentportrait_{i}': {
            template: 'input.students[$current_student_index + 6 + {i} - 1].portrait',
            params: { i: { range: [1, 'students_remaining - 6'] } },
          },
        },
      },
    };
    // Симулируем: студенты [0..3] всего 4, current=0, remaining=8 (хардкод для теста)
    const r = applyRule(
      rule,
      makeCtx({ students_remaining: 8 }),
      // Расширяю input — 10 студентов
      {
        ...makeInput(),
        students: Array.from({ length: 10 }, (_, i) => ({
          full_name: `S${i + 1}`,
          portrait: `p${i + 1}.jpg`,
          quote: '',
          friend_photos: [],
        })),
      },
      { current_student_index: 0 },
      makeMastersByName(),
    );
    expect(r.right?.bindings.studentportrait_1).toBe('p7.jpg');
    expect(r.right?.bindings.studentportrait_2).toBe('p8.jpg');
    expect(r.right?.bindings.studentportrait_3).toBeNull(); // range [1, 2] закончился
  });
});

describe('applyRule — type=sequence не поддержан в MVP', () => {
  it('sequence → resolve_error и пустой результат', () => {
    const rule: Rule = {
      id: 'test-sequence',
      family_id: 'head-teacher',
      family_version: '1.0',
      priority: 100,
      when: {},
      produces: {
        type: 'sequence',
        steps: [{ type: 'page', side: 'left', master: 'F-Head-WithPhoto' }],
      },
    };
    const r = applyRule(rule, makeCtx(), makeInput(), {}, makeMastersByName());
    expect(r.left).toBeNull();
    expect(r.right).toBeNull();
    expect(r.resolve_errors.some((e) => e.includes('sequence'))).toBe(true);
  });
});
