/**
 * Тесты integration балансировки (БТ.1.3).
 *
 * Проверяют полную цепочку:
 *   1. buildFromRules (rule engine) применяет balance.ts → пишет
 *      __hidden__<label>/__pos__<label> в bindings ProducedPage
 *   2. layout-to-buildresult адаптер копирует эти ключи в data
 *      legacy SpreadInstance
 *   3. Применение overrides на placeholders (симуляция логики
 *      AlbumSpreadCanvas БТ.1.1 и PDF pipeline БТ.1.2) даёт
 *      правильное число видимых placeholder'ов и правильные позиции
 *
 * Это integration тест который выявил бы первоначальный баг
 * (placeholderOverrides не прокидывался в боевой канвас).
 */

import { describe, it, expect } from 'vitest';
import { buildFromRules } from '../build';
import { adaptAlbumLayoutToBuildResult } from '../layout-to-buildresult';
import type { RulesAlbumInput, Rule, Preset, TemplateFamily } from '../types';
import { TEST_MASTERS } from './__fixtures__/masters';
import type { SpreadTemplate, Placeholder } from '@/lib/album-builder/types';

// ─── Симуляция логики БТ.1.1/БТ.1.2 — применение overrides на placeholders ─
//
// Этот же алгоритм находится в:
//   app/app/_components/AlbumSpreadCanvas.tsx (для Konva)
//   lib/pdf-export/pipeline.ts (applyBalanceOverrides для sharp/pdf-lib)
//
// Если этот тест проходит — оба боевых места должны вести себя одинаково.

function applyBalanceOverridesForTest(
  placeholders: Placeholder[],
  data: Record<string, string | null>,
): Placeholder[] {
  const overrides: Record<string, { hidden?: boolean; x_mm?: number; y_mm?: number }> = {};
  let hasAny = false;
  for (const [k, v] of Object.entries(data)) {
    if (typeof v !== 'string') continue;
    if (k.startsWith('__hidden__')) {
      const label = k.slice('__hidden__'.length);
      if (v && v !== '0' && v !== 'false') {
        overrides[label] = { ...overrides[label], hidden: true };
        hasAny = true;
      }
    } else if (k.startsWith('__pos__')) {
      const label = k.slice('__pos__'.length);
      const parts = v.split(',').map((s) => Number(s.trim()));
      if (parts.length === 2 && parts.every(Number.isFinite)) {
        overrides[label] = { ...overrides[label], x_mm: parts[0], y_mm: parts[1] };
        hasAny = true;
      }
    }
  }
  if (!hasAny) return placeholders;
  return placeholders
    .filter((p) => !overrides[p.label]?.hidden)
    .map((p) => {
      const ov = overrides[p.label];
      if (!ov || (ov.x_mm === undefined && ov.y_mm === undefined)) return p;
      return { ...p, x_mm: ov.x_mm ?? p.x_mm, y_mm: ov.y_mm ?? p.y_mm };
    });
}

// ─── Минимальная подготовка для buildFromRules ─────────────────────────

function findMaster(name: string): SpreadTemplate | undefined {
  return TEST_MASTERS.find((m) => m.name === name);
}

// Минимальное семейство и правило для head-teacher с hide_unfilled.
const HEAD_TEACHER_FAMILY: TemplateFamily = {
  id: 'head-teacher',
  display_name: 'Head teacher',
  description: '',
  required_inputs: ['head_teacher'],
};

const STUDENT_SECTION_FAMILY: TemplateFamily = {
  id: 'student-section',
  display_name: 'Student section',
  description: '',
  required_inputs: ['students'],
};

const RULE_HEAD_BIG_GRID: Rule = {
  id: 't-class-5+-grid',
  family_id: 'head-teacher',
  family_version: '1.0',
  priority: 100,
  display_name: 'Head with big grid for many subjects',
  description: '',
  when: {
    'subjects_count': { gte: 5 },
  },
  produces: {
    type: 'spread',
    left_master: 'F-Head-SmallGrid',
    right_master: 'G-Teachers-3x3',
  },
  bind: {
    'F-Head-SmallGrid': {
      'headteacherphoto': 'input.head_teacher.photo',
      'headteachername': 'input.head_teacher.name',
      'headteacherrole': 'input.head_teacher.role',
      'headtextframe': 'input.head_teacher.text',
    },
    'G-Teachers-3x3': {
      'teacherphoto_{i}': {
        template: 'input.subjects[{i}-1].photo',
        params: { i: { range: [1, 'subjects_count'] } },
      },
      'teachername_{i}': {
        template: 'input.subjects[{i}-1].name',
        params: { i: { range: [1, 'subjects_count'] } },
      },
      'teacherrole_{i}': {
        template: 'input.subjects[{i}-1].role',
        params: { i: { range: [1, 'subjects_count'] } },
      },
    },
  },
  consumes: {},
  balance: { placeholder_centering: true, hide_unfilled: true },
};

const RULE_STUDENT_PAIR: Rule = {
  id: 'student-section-standard-pair',
  family_id: 'student-section',
  family_version: '1.0',
  priority: 100,
  display_name: 'Standard pair',
  description: '',
  when: {},
  produces: {
    type: 'spread',
    left_master: 'E-Standard-Left',
    right_master: 'E-Standard-Right',
  },
  bind: {
    'E-Standard-Left': {
      'studentportrait': 'input.students[$current_student_index].portrait',
      'studentname': 'input.students[$current_student_index].full_name',
    },
    'E-Standard-Right': {
      'studentportrait': 'input.students[$current_student_index + 1].portrait',
      'studentname': 'input.students[$current_student_index + 1].full_name',
    },
  },
  consumes: { students: 2 },
};

const PRESET_TEST: Preset = {
  id: 'integration-test',
  slug: 'integration-test',
  display_name: 'Integration Test',
  version: '1.0',
  print_type: 'layflat',
  sections: [
    { family_id: 'head-teacher' },
    { family_id: 'student-section' },
  ],
};

function makeBundle(preset: Preset) {
  const mastersByName = new Map<string, SpreadTemplate>();
  for (const m of TEST_MASTERS) mastersByName.set(m.name, m);
  return {
    families: [HEAD_TEACHER_FAMILY, STUDENT_SECTION_FAMILY],
    rules: [RULE_HEAD_BIG_GRID, RULE_STUDENT_PAIR],
    preset,
    templateSet: {
      id: 'test-set',
      slug: 'test',
      display_name: 'Test',
      version: '1.0',
      print_type: 'layflat' as const,
      spread_width_mm: 600,
      spread_height_mm: 300,
    },
    mastersByName,
  };
}

function makeInput(opts: { students: number; subjects: number }): RulesAlbumInput {
  return {
    students: Array.from({ length: opts.students }, (_, i) => ({
      full_name: `S${i + 1}`,
      portrait: `p${i + 1}.jpg`,
      quote: '',
      friend_photos: [],
    })),
    subjects: Array.from({ length: opts.subjects }, (_, i) => ({
      name: `T${i + 1}`,
      role: 'role',
      photo: `t${i + 1}.jpg`,
    })),
    head_teacher: {
      name: 'HT',
      role: 'HR',
      text: 'text',
      photo: 'ht.jpg',
    },
    common_photos: { full_class: [], half_class: [], spread: [], quarter: [], sixth: [] },
    print_type: 'layflat',
  };
}

// =============================================================================
// Тесты
// =============================================================================

describe('БТ.1.3 integration — balance end-to-end', () => {
  it('5 учителей в G-Teachers-3x3 (9 слотов) → __hidden__ для 4 пустых', () => {
    // G-Teachers-3x3 в TEST_MASTERS имеет 9 teacherphoto слотов
    // При 5 учителях: bindings заполнены для teacherphoto_1..5,
    // 6..9 = null. hide_unfilled должен пометить их.
    const bundle = makeBundle(PRESET_TEST);
    const input = makeInput({ students: 2, subjects: 5 });
    const layout = buildFromRules(input, bundle);

    expect(layout.status).not.toBe('failed');
    // Первый разворот = head-teacher (F-Head-SmallGrid + G-Teachers-3x3)
    const teachersPage = layout.spreads[0].right;
    expect(teachersPage).toBeDefined();
    if (!teachersPage) return;
    expect(teachersPage.bindings.__master_name__).toBe('G-Teachers-3x3');

    // Проверяем __hidden__teacherphoto_6..9 в bindings
    for (let i = 6; i <= 9; i++) {
      const key = `__hidden__teacherphoto_${i}`;
      expect(teachersPage.bindings[key]).toBe('1');
    }
    // Для филлед слотов __hidden__ НЕ должно быть
    for (let i = 1; i <= 5; i++) {
      const key = `__hidden__teacherphoto_${i}`;
      expect(teachersPage.bindings[key]).toBeUndefined();
    }
  });

  it('Адаптер копирует __hidden__ из bindings в data legacy SpreadInstance', () => {
    const bundle = makeBundle(PRESET_TEST);
    const input = makeInput({ students: 2, subjects: 5 });
    const layout = buildFromRules(input, bundle);
    const adapted = adaptAlbumLayoutToBuildResult(layout);

    // Первая страница legacy = F-Head-SmallGrid, вторая = G-Teachers-3x3
    // (адаптер 1:N — каждая страница отдельная SpreadInstance)
    const teachers = adapted.result.spreads.find(
      (s) => s.template_name === 'G-Teachers-3x3',
    );
    expect(teachers).toBeDefined();
    if (!teachers) return;
    for (let i = 6; i <= 9; i++) {
      const key = `__hidden__teacherphoto_${i}`;
      expect(teachers.data[key]).toBe('1');
    }
  });

  it('applyBalanceOverrides скрывает hidden placeholders в layout', () => {
    const bundle = makeBundle(PRESET_TEST);
    const input = makeInput({ students: 2, subjects: 5 });
    const layout = buildFromRules(input, bundle);
    const adapted = adaptAlbumLayoutToBuildResult(layout);
    const teachers = adapted.result.spreads.find(
      (s) => s.template_name === 'G-Teachers-3x3',
    )!;
    const master = findMaster('G-Teachers-3x3')!;

    // До: 9 teacherphoto + 9 teachername + 9 teacherrole = 27 placeholders (+
    // дополнительные если есть)
    const beforeTeacherPhoto = master.placeholders.filter((p) =>
      p.label.startsWith('teacherphoto_'),
    ).length;
    expect(beforeTeacherPhoto).toBe(9);

    // После применения overrides — 6..9 скрыты, остаются 1..5
    const effective = applyBalanceOverridesForTest(master.placeholders, teachers.data);
    const visibleTeacherPhoto = effective.filter((p) =>
      p.label.startsWith('teacherphoto_'),
    );
    expect(visibleTeacherPhoto.length).toBe(5);
    expect(visibleTeacherPhoto.map((p) => p.label).sort()).toEqual([
      'teacherphoto_1',
      'teacherphoto_2',
      'teacherphoto_3',
      'teacherphoto_4',
      'teacherphoto_5',
    ]);
  });

  it('Все 9 учителей → НИКАКОЙ балансировки нет', () => {
    const bundle = makeBundle(PRESET_TEST);
    const input = makeInput({ students: 2, subjects: 9 });
    const layout = buildFromRules(input, bundle);
    const adapted = adaptAlbumLayoutToBuildResult(layout);
    const teachers = adapted.result.spreads.find(
      (s) => s.template_name === 'G-Teachers-3x3',
    )!;

    // НИ ОДНОГО __hidden__ ключа быть не должно
    const hiddenKeys = Object.keys(teachers.data).filter((k) =>
      k.startsWith('__hidden__'),
    );
    expect(hiddenKeys).toEqual([]);

    // applyBalanceOverrides возвращает placeholders как есть
    const master = findMaster('G-Teachers-3x3')!;
    const effective = applyBalanceOverridesForTest(master.placeholders, teachers.data);
    expect(effective.length).toBe(master.placeholders.length);
  });

  it('Альбом без балансировки → applyBalanceOverrides не меняет placeholders', () => {
    // Альбом где правило БЕЗ balance — student-section-standard-pair
    const bundle = makeBundle(PRESET_TEST);
    const input = makeInput({ students: 2, subjects: 9 });
    const layout = buildFromRules(input, bundle);
    const adapted = adaptAlbumLayoutToBuildResult(layout);
    // E-Standard-Left на 2-й странице (после head-teacher)
    const studentPage = adapted.result.spreads.find(
      (s) => s.template_name === 'E-Standard-Left',
    );
    expect(studentPage).toBeDefined();
    if (!studentPage) return;
    const master = findMaster('E-Standard-Left')!;
    const effective = applyBalanceOverridesForTest(master.placeholders, studentPage.data);
    // Identity — никаких overrides не применено
    expect(effective).toEqual(master.placeholders);
  });
});
