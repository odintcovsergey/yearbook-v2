import { describe, it, expect } from 'vitest';
import { resolveSpineFromRanges } from '../spine';
import type { PrinterConfig } from '../types';

const CONFIG: PrinterConfig = {
  sheet_types: [
    {
      id: 'plain',
      name: 'Без подложки',
      spine_ranges: [
        { min_spreads: 0, max_spreads: 10, spine_mm: 5 },
        { min_spreads: 11, max_spreads: 20, spine_mm: 8 },
        { min_spreads: 21, max_spreads: 40, spine_mm: 12 },
      ],
    },
    {
      id: 'dense',
      name: 'С подложкой, плотные',
      spine_ranges: [
        { min_spreads: 0, max_spreads: 10, spine_mm: 9 },
        { min_spreads: 11, max_spreads: 20, spine_mm: 15 },
      ],
    },
  ],
};

describe('resolveSpineFromRanges', () => {
  it('возвращает корешок по диапазону выбранного типа листа', () => {
    expect(resolveSpineFromRanges(CONFIG, 'plain', 8)).toBe(5);
    expect(resolveSpineFromRanges(CONFIG, 'plain', 15)).toBe(8);
    expect(resolveSpineFromRanges(CONFIG, 'plain', 30)).toBe(12);
  });

  it('границы диапазонов включительны', () => {
    expect(resolveSpineFromRanges(CONFIG, 'plain', 10)).toBe(5);
    expect(resolveSpineFromRanges(CONFIG, 'plain', 11)).toBe(8);
    expect(resolveSpineFromRanges(CONFIG, 'plain', 20)).toBe(8);
    expect(resolveSpineFromRanges(CONFIG, 'plain', 21)).toBe(12);
  });

  it('другой тип листа той же типографии даёт другой корешок', () => {
    expect(resolveSpineFromRanges(CONFIG, 'dense', 8)).toBe(9);
    expect(resolveSpineFromRanges(CONFIG, 'dense', 15)).toBe(15);
  });

  it('вне всех диапазонов → null', () => {
    expect(resolveSpineFromRanges(CONFIG, 'plain', 41)).toBeNull();
    expect(resolveSpineFromRanges(CONFIG, 'dense', 25)).toBeNull();
  });

  it('тип листа не задан → берётся первый', () => {
    expect(resolveSpineFromRanges(CONFIG, null, 8)).toBe(5);
  });

  it('нет конфига / типов → null', () => {
    expect(resolveSpineFromRanges(null, 'plain', 8)).toBeNull();
    expect(resolveSpineFromRanges({ sheet_types: [] }, null, 8)).toBeNull();
  });

  it('неизвестный sheetTypeId → фолбэк на первый тип', () => {
    expect(resolveSpineFromRanges(CONFIG, 'nope', 8)).toBe(5);
  });
});
