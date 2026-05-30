/**
 * Тесты резолвера категорийных фонов (Этап 2).
 *
 * Покрывают:
 *   - маппинг page_role → категория (все 15 ролей);
 *   - ротацию по кругу внутри раздела;
 *   - сброс счётчика на смене section_type (каждая категория независимо);
 *   - три уровня приоритета (album > master > ротация);
 *   - смешанный разворот (ведущая левая задаёт категорию);
 *   - fallback на default_background_url и null;
 *   - сортировку пула по sort_order;
 *   - стабильность «номера разворота» при override в середине раздела.
 */

import { describe, it, expect } from 'vitest';
import {
  pageRoleToCategory,
  BACKGROUND_CATEGORIES,
} from '../page-role-to-category';
import {
  resolveBackgrounds,
  type SpreadBackgroundInput,
  type BackgroundPoolRow,
} from '../resolve-background';
import type { PageRole } from '@/lib/album-builder/types';

// ─── page-role-to-category ────────────────────────────────────────────────

describe('pageRoleToCategory', () => {
  const cases: Array<[PageRole, string]> = [
    ['intro', 'intro'],
    ['teacher_left', 'teacher'],
    ['teacher_right', 'teacher'],
    ['student', 'student'],
    ['student_left', 'student'],
    ['student_right', 'student'],
    ['student_last', 'student'],
    ['student_grid', 'student_grid'],
    ['student_grid_left', 'student_grid'],
    ['student_grid_right', 'student_grid'],
    ['student_overflow', 'student_grid'],
    ['student_overflow_right', 'student_grid'],
    ['common', 'common'],
    ['final', 'final'],
    ['cover', 'cover'],
  ];

  it.each(cases)('%s → %s', (role, category) => {
    expect(pageRoleToCategory(role)).toBe(category);
  });

  it('null/undefined → null', () => {
    expect(pageRoleToCategory(null)).toBeNull();
    expect(pageRoleToCategory(undefined)).toBeNull();
  });

  it('все 15 ролей покрыты (каждая даёт категорию из канона)', () => {
    for (const [role] of cases) {
      const cat = pageRoleToCategory(role);
      expect(cat).not.toBeNull();
      expect(BACKGROUND_CATEGORIES).toContain(cat);
    }
  });
});

// ─── helpers ──────────────────────────────────────────────────────────────

/** Удобный конструктор пула: category + N url'ов с возрастающим sort_order. */
function pool(entries: Array<[string, string[]]>): BackgroundPoolRow[] {
  const rows: BackgroundPoolRow[] = [];
  for (const [category, urls] of entries) {
    urls.forEach((url, i) => rows.push({ category, url, sort_order: i }));
  }
  return rows;
}

/** Разворот с ведущей ролью + section_type. */
function spread(
  leadingPageRole: PageRole,
  sectionType: string,
  extra?: Partial<SpreadBackgroundInput>,
): SpreadBackgroundInput {
  return { leadingPageRole, sectionType, ...extra };
}

// ─── resolveBackgrounds: ротация ──────────────────────────────────────────

describe('resolveBackgrounds — ротация по кругу', () => {
  it('15 разворотов student, 4 фона → 0,1,2,3,0,1,2,3,...', () => {
    const p = pool([['student', ['s0', 's1', 's2', 's3']]]);
    const spreads = Array.from({ length: 15 }, () =>
      spread('student', 'students'),
    );
    const out = resolveBackgrounds(spreads, p);
    expect(out).toEqual([
      's0', 's1', 's2', 's3',
      's0', 's1', 's2', 's3',
      's0', 's1', 's2', 's3',
      's0', 's1', 's2',
    ]);
  });

  it('один фон в категории → повторяется', () => {
    const p = pool([['common', ['c0']]]);
    const spreads = Array.from({ length: 3 }, () => spread('common', 'common'));
    expect(resolveBackgrounds(spreads, p)).toEqual(['c0', 'c0', 'c0']);
  });
});

// ─── resolveBackgrounds: сброс по разделам ────────────────────────────────

describe('resolveBackgrounds — сброс счётчика по section_type', () => {
  it('каждый раздел крутит свою ротацию с фон[0]', () => {
    const p = pool([
      ['student', ['s0', 's1']],
      ['common', ['c0', 'c1', 'c2']],
    ]);
    const spreads = [
      spread('student', 'students'), // s0
      spread('student', 'students'), // s1
      spread('student', 'students'), // s0 (кольцо student)
      spread('common', 'common'), // c0 — НОВЫЙ раздел, счётчик сброшен
      spread('common', 'common'), // c1
    ];
    expect(resolveBackgrounds(spreads, p)).toEqual(['s0', 's1', 's0', 'c0', 'c1']);
  });

  it('возврат к тому же типу позже — снова с фон[0]', () => {
    const p = pool([
      ['student', ['s0', 's1']],
      ['teacher', ['t0']],
    ]);
    const spreads = [
      spread('student', 'students'), // s0
      spread('student', 'students'), // s1
      spread('teacher_left', 'teachers'), // t0 — смена раздела
      spread('student', 'students'), // s0 — снова students, счётчик с нуля
    ];
    expect(resolveBackgrounds(spreads, p)).toEqual(['s0', 's1', 't0', 's0']);
  });
});

// ─── resolveBackgrounds: приоритеты ───────────────────────────────────────

describe('resolveBackgrounds — три уровня приоритета', () => {
  const p = pool([['student', ['s0', 's1']]]);

  it('album override побеждает всё', () => {
    const spreads = [
      spread('student', 'students', {
        albumOverrideUrl: 'ALBUM',
        masterOverrideUrl: 'MASTER',
      }),
    ];
    expect(resolveBackgrounds(spreads, p)).toEqual(['ALBUM']);
  });

  it('master override побеждает ротацию', () => {
    const spreads = [
      spread('student', 'students', { masterOverrideUrl: 'MASTER' }),
    ];
    expect(resolveBackgrounds(spreads, p)).toEqual(['MASTER']);
  });

  it('ротация когда override-ов нет', () => {
    const spreads = [spread('student', 'students')];
    expect(resolveBackgrounds(spreads, p)).toEqual(['s0']);
  });

  it('override в середине раздела не сбивает «номер разворота»', () => {
    // 4 разворота student; на втором — master override. Счётчик растёт всегда,
    // поэтому третий разворот = s2 (не s1).
    const spreads = [
      spread('student', 'students'), // idx 0 → s0
      spread('student', 'students', { masterOverrideUrl: 'M' }), // idx 1 → M
      spread('student', 'students'), // idx 2 → s0 (2 % 2)
      spread('student', 'students'), // idx 3 → s1 (3 % 2)
    ];
    expect(resolveBackgrounds(spreads, p)).toEqual(['s0', 'M', 's0', 's1']);
  });
});

// ─── resolveBackgrounds: смешанный разворот ───────────────────────────────

describe('resolveBackgrounds — смешанный разворот', () => {
  it('ведущая (левая) student_last задаёт категорию student, не common справа', () => {
    const p = pool([
      ['student', ['s0']],
      ['common', ['c0']],
    ]);
    // Ведущая роль = student_last (левая страница). Резолвер не знает про
    // правую — вызывающий код уже выбрал ведущую. Категория = student.
    const spreads = [spread('student_last', 'students')];
    expect(resolveBackgrounds(spreads, p)).toEqual(['s0']);
  });
});

// ─── resolveBackgrounds: fallback ─────────────────────────────────────────

describe('resolveBackgrounds — fallback', () => {
  it('нет фонов в категории → default_background_url', () => {
    const p = pool([['teacher', ['t0']]]); // student-пул пуст
    const spreads = [spread('student', 'students')];
    expect(resolveBackgrounds(spreads, p, 'DEFAULT')).toEqual(['DEFAULT']);
  });

  it('нет фонов и нет default → null', () => {
    const spreads = [spread('student', 'students')];
    expect(resolveBackgrounds(spreads, [])).toEqual([null]);
  });

  it('роль без категории (null) → fallback', () => {
    const p = pool([['student', ['s0']]]);
    const spreads: SpreadBackgroundInput[] = [
      { leadingPageRole: null, sectionType: 'x' },
    ];
    expect(resolveBackgrounds(spreads, p, 'DEFAULT')).toEqual(['DEFAULT']);
  });

  it('override работает даже когда пул пуст', () => {
    const spreads = [
      spread('student', 'students', { albumOverrideUrl: 'A' }),
    ];
    expect(resolveBackgrounds(spreads, [])).toEqual(['A']);
  });
});

// ─── resolveBackgrounds: сортировка пула ──────────────────────────────────

describe('resolveBackgrounds — порядок ротации по sort_order', () => {
  it('пул в обратном порядке всё равно крутится по sort_order', () => {
    const p: BackgroundPoolRow[] = [
      { category: 'student', url: 's2', sort_order: 2 },
      { category: 'student', url: 's0', sort_order: 0 },
      { category: 'student', url: 's1', sort_order: 1 },
    ];
    const spreads = Array.from({ length: 4 }, () => spread('student', 'students'));
    expect(resolveBackgrounds(spreads, p)).toEqual(['s0', 's1', 's2', 's0']);
  });
});

// ─── resolveBackgrounds: контракт длины/порядка ───────────────────────────

describe('resolveBackgrounds — контракт', () => {
  it('пустой вход → пустой выход', () => {
    expect(resolveBackgrounds([], pool([['student', ['s0']]]))).toEqual([]);
  });

  it('длина результата = числу разворотов', () => {
    const spreads = Array.from({ length: 7 }, () => spread('common', 'common'));
    const out = resolveBackgrounds(spreads, pool([['common', ['c0', 'c1']]]));
    expect(out).toHaveLength(7);
  });
});
