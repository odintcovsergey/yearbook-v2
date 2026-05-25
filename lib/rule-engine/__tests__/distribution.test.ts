/**
 * Тесты decideDistribution() — алгоритм РЭ.40.b.
 *
 * Покрытие основано на таблице в шапке distribution.ts.
 * Все ключевые сценарии для Mini (maxGrid=12, combinedCapacity=4):
 *   - греедли (старое поведение)
 *   - equalize (равномерно)
 *   - auto (умное правило)
 *
 * Light тоже покрыт (несколько кейсов).
 *
 * Граничные случаи:
 *   - N=0
 *   - maxGrid<1 (invalid)
 *   - combinedCapacity=null (нет combined-мастера)
 */

import { describe, it, expect } from 'vitest';
import { decideDistribution, type DistributionInput } from '../sections/distribution';

// Helper: краткий конструктор для DistributionInput.
function mkInput(
  N: number,
  mode: 'auto' | 'equalize' | 'greedy',
  opts: { maxGrid?: number; combinedCapacity?: number | null; hasClassPhoto?: boolean } = {},
): DistributionInput {
  return {
    N,
    maxGrid: opts.maxGrid ?? 12,
    // combinedCapacity может быть explicitly null — это означает "combined-
    // мастера нет вообще". Используем 'combinedCapacity' in opts вместо ??
    // чтобы различать "не передано" и "явно null".
    combinedCapacity:
      'combinedCapacity' in opts ? (opts.combinedCapacity ?? null) : 4,
    hasClassPhoto: opts.hasClassPhoto ?? false,
    mode,
  };
}

// Helper: счёт + тип для каждой страницы в кратком виде.
function toShape(pages: ReturnType<typeof decideDistribution>['pages']): string[] {
  return pages.map((p) => `${p.type}:${p.count}`);
}

describe('decideDistribution / граничные случаи', () => {
  it('N=0 → пусто', () => {
    const r = decideDistribution(mkInput(0, 'auto'));
    expect(r.pages).toEqual([]);
    expect(r.symmetrizable).toBe(false);
  });

  it('maxGrid<1 → warning + пустой результат', () => {
    const r = decideDistribution({
      N: 10,
      maxGrid: 0,
      combinedCapacity: 4,
      hasClassPhoto: false,
      mode: 'auto',
    });
    expect(r.pages).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('decideDistribution / mode=greedy (legacy-поведение)', () => {
  it('N=12 → [12]', () => {
    const r = decideDistribution(mkInput(12, 'greedy'));
    expect(toShape(r.pages)).toEqual(['grid:12']);
    expect(r.symmetrizable).toBe(true); // greedy всегда позволяет симметризацию
  });

  it('N=30 (без фото) → [12, 12, 6]', () => {
    const r = decideDistribution(mkInput(30, 'greedy'));
    expect(toShape(r.pages)).toEqual(['grid:12', 'grid:12', 'grid:6']);
  });

  it('N=16 + есть фото → combined-tail [12, +4F]', () => {
    const r = decideDistribution(mkInput(16, 'greedy', { hasClassPhoto: true }));
    expect(toShape(r.pages)).toEqual(['grid:12', 'combined:4']);
  });

  it('N=13 + есть фото → combined-tail [12, +1F]', () => {
    // В greedy combined-tail срабатывает при rem ≤ combinedCapacity И есть фото.
    const r = decideDistribution(mkInput(13, 'greedy', { hasClassPhoto: true }));
    expect(toShape(r.pages)).toEqual(['grid:12', 'combined:1']);
  });

  it('N=13 без фото → [12, 1] (greedy, никакого equalize)', () => {
    const r = decideDistribution(mkInput(13, 'greedy'));
    expect(toShape(r.pages)).toEqual(['grid:12', 'grid:1']);
  });

  it('symmetrizable=true в greedy', () => {
    const r = decideDistribution(mkInput(25, 'greedy'));
    expect(r.symmetrizable).toBe(true);
  });
});

describe('decideDistribution / mode=equalize (всегда равномерно)', () => {
  it('N=12 → [12]', () => {
    const r = decideDistribution(mkInput(12, 'equalize'));
    expect(toShape(r.pages)).toEqual(['grid:12']);
  });

  it('N=13 → [7, 6]', () => {
    const r = decideDistribution(mkInput(13, 'equalize'));
    expect(toShape(r.pages)).toEqual(['grid:7', 'grid:6']);
  });

  it('N=16 → [8, 8] (даже если есть фото — equalize игнорирует combined)', () => {
    const r = decideDistribution(mkInput(16, 'equalize', { hasClassPhoto: true }));
    expect(toShape(r.pages)).toEqual(['grid:8', 'grid:8']);
  });

  it('N=18 → [9, 9]', () => {
    const r = decideDistribution(mkInput(18, 'equalize'));
    expect(toShape(r.pages)).toEqual(['grid:9', 'grid:9']);
  });

  it('N=20 → [10, 10]', () => {
    const r = decideDistribution(mkInput(20, 'equalize'));
    expect(toShape(r.pages)).toEqual(['grid:10', 'grid:10']);
  });

  it('N=24 → [12, 12]', () => {
    const r = decideDistribution(mkInput(24, 'equalize'));
    expect(toShape(r.pages)).toEqual(['grid:12', 'grid:12']);
  });

  it('N=25 → [9, 8, 8]', () => {
    const r = decideDistribution(mkInput(25, 'equalize'));
    expect(toShape(r.pages)).toEqual(['grid:9', 'grid:8', 'grid:8']);
  });

  it('N=28 → [10, 9, 9] (lишний в начало)', () => {
    const r = decideDistribution(mkInput(28, 'equalize'));
    expect(toShape(r.pages)).toEqual(['grid:10', 'grid:9', 'grid:9']);
  });

  it('N=30 → [10, 10, 10]', () => {
    const r = decideDistribution(mkInput(30, 'equalize'));
    expect(toShape(r.pages)).toEqual(['grid:10', 'grid:10', 'grid:10']);
  });

  it('symmetrizable=false (симметризация не применяется в equalize)', () => {
    const r = decideDistribution(mkInput(30, 'equalize'));
    expect(r.symmetrizable).toBe(false);
  });
});

describe('decideDistribution / mode=auto (умное правило)', () => {
  it('N=12 → [12] (ровное деление, никакого хвоста)', () => {
    const r = decideDistribution(mkInput(12, 'auto'));
    expect(toShape(r.pages)).toEqual(['grid:12']);
  });

  it('N=24 → [12, 12] (ровное деление)', () => {
    const r = decideDistribution(mkInput(24, 'auto'));
    expect(toShape(r.pages)).toEqual(['grid:12', 'grid:12']);
  });

  it('N=36 → [12, 12, 12]', () => {
    const r = decideDistribution(mkInput(36, 'auto'));
    expect(toShape(r.pages)).toEqual(['grid:12', 'grid:12', 'grid:12']);
  });

  it('N=8 (≤ maxGrid) → [8] (одна страница)', () => {
    const r = decideDistribution(mkInput(8, 'auto'));
    expect(toShape(r.pages)).toEqual(['grid:8']);
  });

  // Case N=13: candidates = [1, 2, 3, 4] → средний = 3 → [10, +3F]
  it('N=13 + есть фото → [10, +3F] (combined со средним X=3)', () => {
    const r = decideDistribution(mkInput(13, 'auto', { hasClassPhoto: true }));
    expect(toShape(r.pages)).toEqual(['grid:10', 'combined:3']);
  });

  it('N=13 без фото → [7, 6] (чистый equalize)', () => {
    const r = decideDistribution(mkInput(13, 'auto'));
    expect(toShape(r.pages)).toEqual(['grid:7', 'grid:6']);
  });

  // Case N=16: candidates = [4] (только X=4, иначе perPage > 12) → [12, +4F]
  it('N=16 + есть фото → [12, +4F] (combined единственно возможный)', () => {
    const r = decideDistribution(mkInput(16, 'auto', { hasClassPhoto: true }));
    expect(toShape(r.pages)).toEqual(['grid:12', 'combined:4']);
  });

  it('N=16 без фото → [8, 8] (equalize fallback)', () => {
    const r = decideDistribution(mkInput(16, 'auto'));
    expect(toShape(r.pages)).toEqual(['grid:8', 'grid:8']);
  });

  it('N=18 → [9, 9] (нет нужды в combined, equalize дробит ровно)', () => {
    const r = decideDistribution(mkInput(18, 'auto', { hasClassPhoto: true }));
    // N=18, pagesNeeded=2: X=1→perPage=17>12, X=2→16>12, X=3→15>12, X=4→14>12.
    // candidates пусто → fallback в equalize: [9, 9].
    expect(toShape(r.pages)).toEqual(['grid:9', 'grid:9']);
  });

  it('N=20 → [10, 10]', () => {
    const r = decideDistribution(mkInput(20, 'auto', { hasClassPhoto: true }));
    // N=20, pagesNeeded=2: candidates пусто (любой X→perPage>12). equalize.
    expect(toShape(r.pages)).toEqual(['grid:10', 'grid:10']);
  });

  // Case N=28: candidates = [4] (только X=4 даёт perPage=12) → [12, 12, +4F]
  it('N=28 + есть фото → [12, 12, +4F]', () => {
    const r = decideDistribution(mkInput(28, 'auto', { hasClassPhoto: true }));
    expect(toShape(r.pages)).toEqual(['grid:12', 'grid:12', 'combined:4']);
  });

  it('N=28 без фото → [10, 9, 9] (equalize fallback)', () => {
    const r = decideDistribution(mkInput(28, 'auto'));
    expect(toShape(r.pages)).toEqual(['grid:10', 'grid:9', 'grid:9']);
  });

  // Case N=30: candidates пусто (любой X→perPage>12 даже при X=4) → equalize
  it('N=30 + есть фото → [10, 10, 10] (combined не помещается, equalize)', () => {
    const r = decideDistribution(mkInput(30, 'auto', { hasClassPhoto: true }));
    expect(toShape(r.pages)).toEqual(['grid:10', 'grid:10', 'grid:10']);
  });

  it('N=30 без фото → [10, 10, 10]', () => {
    const r = decideDistribution(mkInput(30, 'auto'));
    expect(toShape(r.pages)).toEqual(['grid:10', 'grid:10', 'grid:10']);
  });

  it('symmetrizable=false в auto', () => {
    const r = decideDistribution(mkInput(13, 'auto'));
    expect(r.symmetrizable).toBe(false);
  });

  it('combinedCapacity=null → fallback в equalize', () => {
    const r = decideDistribution(
      mkInput(13, 'auto', { combinedCapacity: null, hasClassPhoto: true }),
    );
    expect(toShape(r.pages)).toEqual(['grid:7', 'grid:6']);
  });
});

describe('decideDistribution / mode=auto для Light (maxGrid=6, combined=3)', () => {
  it('Light N=6 → [6]', () => {
    const r = decideDistribution(
      mkInput(6, 'auto', { maxGrid: 6, combinedCapacity: 3 }),
    );
    expect(toShape(r.pages)).toEqual(['grid:6']);
  });

  it('Light N=7 без фото → [4, 3]', () => {
    const r = decideDistribution(
      mkInput(7, 'auto', { maxGrid: 6, combinedCapacity: 3 }),
    );
    expect(toShape(r.pages)).toEqual(['grid:4', 'grid:3']);
  });

  // N=9: pagesNeeded=2; candidates: X=1→remaining=8>6 ❌; X=2→7>6 ❌; X=3→6 ✓.
  // candidates=[3], средний=3 → [6, +3F]
  it('Light N=9 + есть фото → [6, +3F]', () => {
    const r = decideDistribution(
      mkInput(9, 'auto', { maxGrid: 6, combinedCapacity: 3, hasClassPhoto: true }),
    );
    expect(toShape(r.pages)).toEqual(['grid:6', 'combined:3']);
  });

  it('Light N=9 без фото → [5, 4]', () => {
    const r = decideDistribution(
      mkInput(9, 'auto', { maxGrid: 6, combinedCapacity: 3 }),
    );
    expect(toShape(r.pages)).toEqual(['grid:5', 'grid:4']);
  });

  it('Light N=12 → [6, 6] (ровное деление)', () => {
    const r = decideDistribution(
      mkInput(12, 'auto', { maxGrid: 6, combinedCapacity: 3 }),
    );
    expect(toShape(r.pages)).toEqual(['grid:6', 'grid:6']);
  });
});

describe('decideDistribution / interesting edge cases', () => {
  it('greedy N=12 → не вызывает combined (rem=0)', () => {
    const r = decideDistribution(mkInput(12, 'greedy', { hasClassPhoto: true }));
    expect(toShape(r.pages)).toEqual(['grid:12']);
  });

  it('equalize N=1 → [1] (одна страница, никакой попытки делить)', () => {
    const r = decideDistribution(mkInput(1, 'equalize'));
    expect(toShape(r.pages)).toEqual(['grid:1']);
  });

  it('greedy N=1 → [1]', () => {
    const r = decideDistribution(mkInput(1, 'greedy'));
    expect(toShape(r.pages)).toEqual(['grid:1']);
  });

  it('auto N=1 → [1]', () => {
    const r = decideDistribution(mkInput(1, 'auto'));
    expect(toShape(r.pages)).toEqual(['grid:1']);
  });
});
