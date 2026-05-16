/**
 * Smoke-тесты buildFromRules (РЭ.10.4).
 *
 * Полный прогон алгоритма на реальных правилах + тестовых мастерах.
 * Проверяем что для каждого пресета получаем разумный layout с
 * правильным количеством разворотов и корректным заполнением.
 *
 * Эти тесты покрывают happy path. Edge cases (1 ученик в Standard,
 * overflow Light, mixed pages) — в РЭ.10.5.
 */

import { describe, it, expect } from 'vitest';
import { buildFromRules } from '../build';
import type { RulesAlbumInput, RulesStudentInput } from '../types';
import { makeBundle } from './__fixtures__/bundle';

// =============================================================================
// Test data helpers
// =============================================================================

function makeStudents(n: number, withFriendPhotos = false): RulesStudentInput[] {
  return Array.from({ length: n }, (_, i) => ({
    full_name: `Ученик ${i + 1}`,
    portrait: `p${i + 1}.jpg`,
    quote: `Цитата ${i + 1}`,
    friend_photos: withFriendPhotos ? [`f${i + 1}-1.jpg`, `f${i + 1}-2.jpg`] : [],
  }));
}

function makeStandardInput(studentsCount: number, opts?: {
  subjects?: number;
  fullClass?: number;
  halfClass?: number;
  withFriends?: boolean;
}): RulesAlbumInput {
  const subjects = opts?.subjects ?? 0;
  const fullClass = opts?.fullClass ?? 1;
  const halfClass = opts?.halfClass ?? 0;
  return {
    students: makeStudents(studentsCount, opts?.withFriends),
    subjects: Array.from({ length: subjects }, (_, i) => ({
      name: `Препод ${i + 1}`,
      role: 'Предмет',
      photo: `s${i + 1}.jpg`,
    })),
    head_teacher: {
      name: 'Иванова И.И.',
      role: 'Классный руководитель',
      text: 'Текст напутствия',
      photo: 'ht.jpg',
    },
    common_photos: {
      full_class: Array.from({ length: fullClass }, (_, i) => `fc${i + 1}.jpg`),
      half_class: Array.from({ length: halfClass }, (_, i) => `hc${i + 1}.jpg`),
      spread: [],
      quarter: [],
      sixth: [],
    },
  };
}

// =============================================================================
// Smoke: каждый пресет
// =============================================================================

describe('buildFromRules — smoke: Стандарт (layflat)', () => {
  it('4 ученика, 0 предметников, 1 общее фото: 1 head + 2 student-spread', () => {
    const input = makeStandardInput(4, { subjects: 0, fullClass: 1 });
    const bundle = makeBundle('standard');
    const layout = buildFromRules(input, bundle);

    expect(layout.status).not.toBe('failed');
    expect(layout.preset_id).toBe('standard');
    // Минимум: head-teacher (1 разворот) + 4 ученика по 2 в развороте (2 разворота)
    expect(layout.spreads.length).toBeGreaterThanOrEqual(3);

    // Первый разворот должен быть учительский (head-teacher)
    const traceFirst = layout.decision_trace[0];
    expect(traceFirst.family_id).toBe('head-teacher');
    expect(traceFirst.rule_id).toContain('t-class-0');

    // Должны быть применены student-section правила
    const studentRules = layout.decision_trace.filter((t) => t.family_id === 'student-section');
    expect(studentRules.length).toBeGreaterThan(0);
  });

  it('5 учеников, нечётно: 2 spread + 1 tail (mixed pages)', () => {
    const input = makeStandardInput(5, { subjects: 0, fullClass: 1, halfClass: 2 });
    const bundle = makeBundle('standard');
    const layout = buildFromRules(input, bundle);

    expect(layout.status).not.toBe('failed');
    const studentTraces = layout.decision_trace.filter((t) => t.family_id === 'student-section');
    // 2 пары + 1 tail = 3 правила student-section
    expect(studentTraces.length).toBe(3);
    // Последнее — tail правило
    expect(studentTraces[studentTraces.length - 1].rule_id).toContain('tail');
  });
});

describe('buildFromRules — smoke: Универсал', () => {
  it('4 ученика с friend_photos', () => {
    const input = makeStandardInput(4, { subjects: 0, fullClass: 1, withFriends: true });
    const bundle = makeBundle('universal');
    const layout = buildFromRules(input, bundle);

    expect(layout.status).not.toBe('failed');
    const studentTraces = layout.decision_trace.filter((t) => t.family_id === 'student-section');
    expect(studentTraces.length).toBeGreaterThan(0);
    // Должно использовать E-Universal-Left/Right мастера
    const universalSpreads = layout.spreads.filter(
      (s) => s.left && s.left.bindings.__master_name__ === 'E-Universal-Left',
    );
    expect(universalSpreads.length).toBeGreaterThan(0);
  });
});

describe('buildFromRules — smoke: Максимум', () => {
  it('3 ученика → 3 spread по одному (E-Max-Left + E-Max-Right)', () => {
    const input = makeStandardInput(3, { subjects: 0, fullClass: 0, withFriends: true });
    const bundle = makeBundle('maximum');
    const layout = buildFromRules(input, bundle);

    expect(layout.status).not.toBe('failed');
    const studentTraces = layout.decision_trace.filter((t) => t.family_id === 'student-section');
    expect(studentTraces.length).toBe(3); // 1 разворот на ученика
    // Каждое правило — student-section-maximum
    for (const t of studentTraces) {
      expect(t.rule_id).toBe('student-section-maximum');
    }
  });
});

describe('buildFromRules — smoke: Индивидуальный (max + mini)', () => {
  it('3 ученика: 3 max-разворота + виньетка из 3', () => {
    const input = makeStandardInput(3, { subjects: 0, fullClass: 0, withFriends: true });
    const bundle = makeBundle('individual');
    const layout = buildFromRules(input, bundle);

    expect(layout.status).not.toBe('failed');
    // 3 правила student-section-maximum + 1 правило student-section-mini
    const maxTraces = layout.decision_trace.filter((t) => t.rule_id === 'student-section-maximum');
    expect(maxTraces.length).toBe(3);
    // mini секция должна быть применена — 3 ученика помещаются в одну Combined-Page
    // (при есть общее фото) или N-Grid-Page tail
    const miniSecTraces = layout.decision_trace.filter(
      (t) => t.section_index > 1 && t.family_id === 'student-section',
    );
    expect(miniSecTraces.length).toBeGreaterThan(0);
  });
});

describe('buildFromRules — smoke: Мини soft (intro + final)', () => {
  it('4 ученика + soft → S-Intro первой, S-Final последней', () => {
    const input = makeStandardInput(4, { subjects: 0, fullClass: 2, halfClass: 0 });
    const bundle = makeBundle('mini-soft');
    const layout = buildFromRules(input, bundle);

    expect(layout.status).not.toBe('failed');
    const families = layout.decision_trace.map((t) => t.family_id);
    expect(families).toContain('intro');
    expect(families).toContain('final');
    // intro должна быть до student-section
    const introIdx = families.indexOf('intro');
    const studentIdx = families.indexOf('student-section');
    expect(introIdx).toBeLessThan(studentIdx);
    // final — после student-section
    const finalIdx = families.lastIndexOf('final');
    expect(finalIdx).toBeGreaterThan(studentIdx);
  });
});

describe('buildFromRules — smoke: head-teacher с предметниками', () => {
  it('subjects=4 → F-Head-SmallGrid + class-photo на правой', () => {
    const input = makeStandardInput(4, { subjects: 4, fullClass: 1 });
    const bundle = makeBundle('standard');
    const layout = buildFromRules(input, bundle);

    expect(layout.status).not.toBe('failed');
    const headTrace = layout.decision_trace.find((t) => t.family_id === 'head-teacher');
    expect(headTrace).toBeDefined();
    expect(headTrace?.rule_id).toContain('t-class-1-4');
  });

  it('subjects=10 → F-Head-WithPhoto + G-Teachers-3x4', () => {
    const input = makeStandardInput(4, { subjects: 10, fullClass: 1 });
    const bundle = makeBundle('standard');
    const layout = buildFromRules(input, bundle);

    expect(layout.status).not.toBe('failed');
    const headTrace = layout.decision_trace.find((t) => t.family_id === 'head-teacher');
    expect(headTrace?.rule_id).toBe('t-class-10-12');
    // Проверяем что левый мастер F-Head-WithPhoto, правый G-Teachers-3x4
    const headSpread = layout.spreads[headTrace?.spread_index ?? 0];
    expect(headSpread.left?.bindings.__master_name__).toBe('F-Head-WithPhoto');
    expect(headSpread.right?.bindings.__master_name__).toBe('G-Teachers-3x4');
  });

  it('subjects=0 с общим И 2 полкласса → t-class-0-classphoto-and-halfs (priority 110)', () => {
    const input = makeStandardInput(4, { subjects: 0, fullClass: 1, halfClass: 2 });
    const bundle = makeBundle('standard');
    const layout = buildFromRules(input, bundle);

    expect(layout.status).not.toBe('failed');
    const headTrace = layout.decision_trace.find((t) => t.family_id === 'head-teacher');
    // priority=110 → должен победить базовое 100/90/80
    expect(headTrace?.rule_id).toBe('t-class-0-classphoto-and-halfs');
  });
});

describe('buildFromRules — smoke: rules_version детерминирован', () => {
  it('Тот же preset+rules → тот же rules_version', () => {
    const input = makeStandardInput(4, { subjects: 0, fullClass: 1 });
    const bundle = makeBundle('standard');
    const l1 = buildFromRules(input, bundle);
    const l2 = buildFromRules(input, bundle);
    expect(l1.rules_version).toBe(l2.rules_version);
    expect(l1.rules_version.length).toBeGreaterThan(0);
  });
});
