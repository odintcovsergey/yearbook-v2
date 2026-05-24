/**
 * Тесты для classifyTransitionLayout (РЭ.37.2.a).
 *
 * Покрытие:
 *   • Все 6 комплектаций — основные case-точки
 *   • Граничные значения tail (0, 1, M, M+1, N-1)
 *   • Соответствие историческим строкам xlsx (где они не противоречат
 *     новой автоматической логике Сергея — то есть Mini ≥ 25, Light ≥ 13,
 *     Medium ≥ 9, Standard / Universal любое)
 *   • Новые случаи, которых не было в xlsx (Mini ≤ 24, Light ≤ 12) —
 *     по решению Сергея от 24.05.2026 ночь
 *   • Невалидный ввод
 */

import { describe, it, expect } from 'vitest';
import {
  classifyTransitionLayout,
  type TransitionLayout,
  type Complectation,
} from '../transition-cases';

// ─── helpers ───────────────────────────────────────────────────────────

/** Удобный shorthand для сравнения с ожиданием. */
function expectLayout(
  actual: TransitionLayout,
  expected: Partial<TransitionLayout>,
) {
  for (const [k, v] of Object.entries(expected)) {
    expect(actual[k as keyof TransitionLayout]).toBe(v);
  }
}

// ─── Mini (N=12, M=4) ──────────────────────────────────────────────────

describe('classifyTransitionLayout — Mini (N=12, M=4)', () => {
  it('0 учеников: ровно 0 страниц, transition off', () => {
    const r = classifyTransitionLayout('mini', 0);
    expectLayout(r, {
      full_pages: 0,
      tail: 0,
      tail_page: 'none',
      closing_page: 'none',
    });
  });

  it('1 ученик: combo-4 с 1 портретом + J-цепочка (новая логика)', () => {
    // По xlsx «до 24» = transition off, но Сергей зафиксировал новую
    // автоматическую логику: combo нужен и при малом количестве.
    const r = classifyTransitionLayout('mini', 1);
    expectLayout(r, {
      full_pages: 0,
      tail: 1,
      tail_page: 'combo',
      combo_master_base: 'J-Combined-Tail-4',
      combo_capacity: 4,
      closing_page: 'j_chain',
    });
  });

  it('4 ученика (граница M): всё ещё combo', () => {
    const r = classifyTransitionLayout('mini', 4);
    expectLayout(r, {
      full_pages: 0,
      tail: 4,
      tail_page: 'combo',
      combo_master_base: 'J-Combined-Tail-4',
      combo_capacity: 4,
      closing_page: 'j_chain',
    });
  });

  it('5 учеников (tail > M): grid_padded + J', () => {
    const r = classifyTransitionLayout('mini', 5);
    expectLayout(r, {
      full_pages: 0,
      tail: 5,
      tail_page: 'grid_padded',
      combo_master_base: null,
      closing_page: 'j_chain',
    });
  });

  it('11 учеников (tail = N-1): grid_padded + J', () => {
    const r = classifyTransitionLayout('mini', 11);
    expectLayout(r, {
      full_pages: 0,
      tail: 11,
      tail_page: 'grid_padded',
      closing_page: 'j_chain',
    });
  });

  it('12 учеников (full=1, tail=0): закрывающий J на правой', () => {
    // Mini 12: одна полная страница N-Grid-12. По старой xlsx это
    // transition off (≤24), по новой логике нужна закрывающая J.
    const r = classifyTransitionLayout('mini', 12);
    expectLayout(r, {
      full_pages: 1,
      tail: 0,
      tail_page: 'none',
      closing_page: 'j_chain',
    });
  });

  it('24 ученика (full=2, tail=0): transition off (case 1)', () => {
    const r = classifyTransitionLayout('mini', 24);
    expectLayout(r, {
      full_pages: 2,
      tail: 0,
      tail_page: 'none',
      closing_page: 'none',
    });
  });

  it('25 учеников: full=2, tail=1, combo-4 (xlsx «25-28» строка)', () => {
    const r = classifyTransitionLayout('mini', 25);
    expectLayout(r, {
      full_pages: 2,
      tail: 1,
      tail_page: 'combo',
      combo_master_base: 'J-Combined-Tail-4',
      combo_capacity: 4,
      closing_page: 'j_chain',
    });
  });

  it('28 учеников: full=2, tail=4, combo-4 (граница M)', () => {
    const r = classifyTransitionLayout('mini', 28);
    expectLayout(r, {
      full_pages: 2,
      tail: 4,
      tail_page: 'combo',
      combo_capacity: 4,
      closing_page: 'j_chain',
    });
  });

  it('29 учеников: full=2, tail=5, grid_padded (xlsx «29-36» строка)', () => {
    const r = classifyTransitionLayout('mini', 29);
    expectLayout(r, {
      full_pages: 2,
      tail: 5,
      tail_page: 'grid_padded',
      closing_page: 'j_chain',
    });
  });

  it('36 учеников: full=3, tail=0 (xlsx «29-36» граница)', () => {
    const r = classifyTransitionLayout('mini', 36);
    expectLayout(r, {
      full_pages: 3,
      tail: 0,
      tail_page: 'none',
      closing_page: 'j_chain',
    });
  });

  it('48 учеников: full=4, tail=0, transition off', () => {
    const r = classifyTransitionLayout('mini', 48);
    expectLayout(r, {
      full_pages: 4,
      tail: 0,
      tail_page: 'none',
      closing_page: 'none',
    });
  });
});

// ─── Light (N=6, M=3) ──────────────────────────────────────────────────

describe('classifyTransitionLayout — Light (N=6, M=3)', () => {
  it('6 учеников (full=1, tail=0): нужна закрывающая J', () => {
    // По xlsx «до 12» = off, по новой логике нужна закрывающая.
    const r = classifyTransitionLayout('light', 6);
    expectLayout(r, {
      full_pages: 1,
      tail: 0,
      tail_page: 'none',
      closing_page: 'j_chain',
    });
  });

  it('12 учеников (full=2, tail=0): off', () => {
    const r = classifyTransitionLayout('light', 12);
    expectLayout(r, {
      full_pages: 2,
      tail: 0,
      tail_page: 'none',
      closing_page: 'none',
    });
  });

  it('13 учеников: full=2, tail=1, combo-3 (xlsx «13-15» строка)', () => {
    const r = classifyTransitionLayout('light', 13);
    expectLayout(r, {
      full_pages: 2,
      tail: 1,
      tail_page: 'combo',
      combo_master_base: 'J-Combined-Tail-3',
      combo_capacity: 3,
      closing_page: 'j_chain',
    });
  });

  it('15 учеников: full=2, tail=3, combo-3 (граница M)', () => {
    const r = classifyTransitionLayout('light', 15);
    expectLayout(r, {
      full_pages: 2,
      tail: 3,
      tail_page: 'combo',
      combo_capacity: 3,
      closing_page: 'j_chain',
    });
  });

  it('16 учеников: full=2, tail=4, grid_padded (xlsx «16-18»)', () => {
    const r = classifyTransitionLayout('light', 16);
    expectLayout(r, {
      full_pages: 2,
      tail: 4,
      tail_page: 'grid_padded',
      closing_page: 'j_chain',
    });
  });

  it('18 учеников: full=3, tail=0, нужна закрывающая J', () => {
    const r = classifyTransitionLayout('light', 18);
    expectLayout(r, {
      full_pages: 3,
      tail: 0,
      tail_page: 'none',
      closing_page: 'j_chain',
    });
  });

  it('19 учеников: full=3, tail=1, combo-3 (xlsx «19-21»)', () => {
    const r = classifyTransitionLayout('light', 19);
    expectLayout(r, {
      full_pages: 3,
      tail: 1,
      tail_page: 'combo',
      combo_capacity: 3,
      closing_page: 'j_chain',
    });
  });

  it('21 ученик: full=3, tail=3, combo-3 (граница)', () => {
    const r = classifyTransitionLayout('light', 21);
    expectLayout(r, {
      full_pages: 3,
      tail: 3,
      tail_page: 'combo',
      combo_capacity: 3,
      closing_page: 'j_chain',
    });
  });
});

// ─── Medium (N=4, M=2) ─────────────────────────────────────────────────

describe('classifyTransitionLayout — Medium (N=4, M=2)', () => {
  it('8 учеников: full=2, tail=0, off (xlsx «7-8»)', () => {
    const r = classifyTransitionLayout('medium', 8);
    expectLayout(r, {
      full_pages: 2,
      tail: 0,
      tail_page: 'none',
      closing_page: 'none',
    });
  });

  it('9 учеников: full=2, tail=1, combo-2 (xlsx «9-10»)', () => {
    const r = classifyTransitionLayout('medium', 9);
    expectLayout(r, {
      full_pages: 2,
      tail: 1,
      tail_page: 'combo',
      combo_master_base: 'J-Combined-Tail-2',
      combo_capacity: 2,
      closing_page: 'j_chain',
    });
  });

  it('11 учеников: full=2, tail=3, grid_padded (xlsx «11-12»)', () => {
    const r = classifyTransitionLayout('medium', 11);
    expectLayout(r, {
      full_pages: 2,
      tail: 3,
      tail_page: 'grid_padded',
      closing_page: 'j_chain',
    });
  });

  it('13 учеников: full=3, tail=1, combo-2 (xlsx «13-14»)', () => {
    const r = classifyTransitionLayout('medium', 13);
    expectLayout(r, {
      full_pages: 3,
      tail: 1,
      tail_page: 'combo',
      combo_capacity: 2,
      closing_page: 'j_chain',
    });
  });
});

// ─── Standard / Universal (N=1, без combo) ─────────────────────────────

describe('classifyTransitionLayout — Standard (N=1, no combo)', () => {
  it('22 ученика (чёт): off', () => {
    const r = classifyTransitionLayout('standard', 22);
    expectLayout(r, {
      full_pages: 22,
      tail: 0,
      tail_page: 'none',
      closing_page: 'none',
    });
  });

  it('23 ученика (нечёт): закрывающая J (xlsx «нечетное»)', () => {
    const r = classifyTransitionLayout('standard', 23);
    expectLayout(r, {
      full_pages: 23,
      tail: 0,
      tail_page: 'none',
      combo_master_base: null,
      closing_page: 'j_chain',
    });
  });

  it('0 учеников: off', () => {
    const r = classifyTransitionLayout('standard', 0);
    expectLayout(r, {
      full_pages: 0,
      tail: 0,
      closing_page: 'none',
    });
  });
});

describe('classifyTransitionLayout — Universal (N=1, no combo)', () => {
  it('20 учеников (чёт): off', () => {
    const r = classifyTransitionLayout('universal', 20);
    expectLayout(r, {
      full_pages: 20,
      tail: 0,
      closing_page: 'none',
    });
  });

  it('21 ученик (нечёт): закрывающая J', () => {
    const r = classifyTransitionLayout('universal', 21);
    expectLayout(r, {
      full_pages: 21,
      tail: 0,
      tail_page: 'none',
      closing_page: 'j_chain',
    });
  });
});

// ─── Maximum (разворот на ученика) ─────────────────────────────────────

describe('classifyTransitionLayout — Maximum (spread per student)', () => {
  it.each([0, 1, 5, 10, 23, 100])(
    '%i учеников: всегда off (каждый = 2 страницы, число чётное)',
    (n) => {
      const r = classifyTransitionLayout('maximum', n);
      expect(r.full_pages).toBe(n * 2);
      expect(r.tail).toBe(0);
      expect(r.tail_page).toBe('none');
      expect(r.closing_page).toBe('none');
      expect(r.combo_master_base).toBeNull();
    },
  );
});

// ─── Невалидный ввод ───────────────────────────────────────────────────

describe('classifyTransitionLayout — невалидный ввод', () => {
  it('отрицательное число → throw', () => {
    expect(() => classifyTransitionLayout('mini', -1)).toThrow(/неотрицательным/);
  });

  it('дробное число → throw', () => {
    expect(() => classifyTransitionLayout('light', 13.5)).toThrow(/целым/);
  });

  it.each<Complectation>(['mini', 'light', 'medium', 'standard', 'universal', 'maximum'])(
    'все комплектации поддерживаются (smoke %s)',
    (c) => {
      expect(() => classifyTransitionLayout(c, 10)).not.toThrow();
    },
  );
});

// ─── Дополнительная сводка: проверяем что combo не возникает у не-сеток ─

describe('classifyTransitionLayout — инварианты', () => {
  it.each<Complectation>(['standard', 'universal', 'maximum'])(
    '%s: combo_master_base всегда null (нет combo для не-сеток)',
    (c) => {
      for (let n = 0; n <= 40; n++) {
        const r = classifyTransitionLayout(c, n);
        expect(r.combo_master_base).toBeNull();
        expect(r.combo_capacity).toBeNull();
        expect(r.tail_page).not.toBe('combo');
      }
    },
  );

  it.each<Complectation>(['mini', 'light', 'medium'])(
    '%s: tail<=M даёт combo, tail>M даёт grid_padded, tail=0 даёт none',
    (c) => {
      for (let n = 0; n <= 50; n++) {
        const r = classifyTransitionLayout(c, n);
        if (r.tail === 0) {
          expect(r.tail_page).toBe('none');
        } else if (r.combo_capacity !== null && r.tail <= r.combo_capacity) {
          expect(r.tail_page).toBe('combo');
        } else {
          expect(r.tail_page).toBe('grid_padded');
        }
      }
    },
  );
});
