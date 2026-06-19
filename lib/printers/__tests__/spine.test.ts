import { describe, it, expect } from 'vitest';
import { resolveSpineMm, resolveSpineFromRanges, normalizeSpine } from '../spine';
import type { PrinterConfig, PrinterSheetType } from '../types';

const CONFIG: PrinterConfig = {
  sheet_types: [
    {
      id: 'plain',
      name: 'Без подложки',
      spine: {
        mode: 'ranges',
        ranges: [
          { min_spreads: 0, max_spreads: 10, spine_mm: 5 },
          { min_spreads: 11, max_spreads: 20, spine_mm: 8 },
          { min_spreads: 21, max_spreads: 40, spine_mm: 12 },
        ],
      },
    },
    {
      id: 'dense',
      name: 'С подложкой, плотные',
      spine: {
        mode: 'ranges',
        ranges: [
          { min_spreads: 0, max_spreads: 10, spine_mm: 9 },
          { min_spreads: 11, max_spreads: 20, spine_mm: 15 },
        ],
      },
    },
  ],
};

describe('resolveSpineMm — режим ranges', () => {
  it('возвращает корешок по диапазону выбранного типа листа', () => {
    expect(resolveSpineMm(CONFIG, 'plain', 8)).toBe(5);
    expect(resolveSpineMm(CONFIG, 'plain', 15)).toBe(8);
    expect(resolveSpineMm(CONFIG, 'plain', 30)).toBe(12);
  });

  it('границы диапазонов включительны', () => {
    expect(resolveSpineMm(CONFIG, 'plain', 10)).toBe(5);
    expect(resolveSpineMm(CONFIG, 'plain', 11)).toBe(8);
    expect(resolveSpineMm(CONFIG, 'plain', 20)).toBe(8);
    expect(resolveSpineMm(CONFIG, 'plain', 21)).toBe(12);
  });

  it('другой тип листа той же типографии даёт другой корешок', () => {
    expect(resolveSpineMm(CONFIG, 'dense', 8)).toBe(9);
    expect(resolveSpineMm(CONFIG, 'dense', 15)).toBe(15);
  });

  it('вне всех диапазонов → null', () => {
    expect(resolveSpineMm(CONFIG, 'plain', 41)).toBeNull();
    expect(resolveSpineMm(CONFIG, 'dense', 25)).toBeNull();
  });

  it('тип листа не задан → берётся первый', () => {
    expect(resolveSpineMm(CONFIG, null, 8)).toBe(5);
  });

  it('нет конфига / типов → null', () => {
    expect(resolveSpineMm(null, 'plain', 8)).toBeNull();
    expect(resolveSpineMm({ sheet_types: [] }, null, 8)).toBeNull();
  });

  it('неизвестный sheetTypeId → фолбэк на первый тип', () => {
    expect(resolveSpineMm(CONFIG, 'nope', 8)).toBe(5);
  });
});

describe('resolveSpineMm — режим formula (Булгак: base + 1мм/разворот)', () => {
  const BULGAK: PrinterConfig = {
    sheet_types: [
      { id: 'std', name: 'Стандарт', spine: { mode: 'formula', formula: { base_mm: 4, step_mm: 1, per_spreads: 1 } } },
    ],
  };

  it('даёт base + step × разворотов', () => {
    expect(resolveSpineMm(BULGAK, 'std', 0)).toBe(4);
    expect(resolveSpineMm(BULGAK, 'std', 10)).toBe(14);
    expect(resolveSpineMm(BULGAK, 'std', 25)).toBe(29);
  });

  it('per_spreads делит шаг (0.5мм за разворот при per_spreads=2)', () => {
    const half: PrinterConfig = {
      sheet_types: [{ id: 's', name: 's', spine: { mode: 'formula', formula: { base_mm: 2, step_mm: 1, per_spreads: 2 } } }],
    };
    expect(resolveSpineMm(half, 's', 10)).toBe(7); // 2 + 1*(10/2)
  });

  it('per_spreads=0 → null (защита от деления на ноль)', () => {
    const bad: PrinterConfig = {
      sheet_types: [{ id: 's', name: 's', spine: { mode: 'formula', formula: { base_mm: 2, step_mm: 1, per_spreads: 0 } } }],
    };
    expect(resolveSpineMm(bad, 's', 10)).toBeNull();
  });
});

describe('resolveSpineMm — режим fixed', () => {
  it('возвращает постоянную ширину', () => {
    const okey: PrinterConfig = {
      sheet_types: [{ id: 'f', name: 'Фикс', spine: { mode: 'fixed', fixed_mm: 6 } }],
    };
    expect(resolveSpineMm(okey, 'f', 5)).toBe(6);
    expect(resolveSpineMm(okey, 'f', 50)).toBe(6);
  });

  it('fixed_mm=0 → корешка нет (Принт Мейтс)', () => {
    const pm: PrinterConfig = {
      sheet_types: [{ id: 'f', name: 'Без корешка', spine: { mode: 'fixed', fixed_mm: 0 } }],
    };
    expect(resolveSpineMm(pm, 'f', 20)).toBe(0);
  });
});

describe('обратная совместимость legacy-профилей (только spine_ranges)', () => {
  const LEGACY: PrinterConfig = {
    sheet_types: [
      {
        id: 'plain',
        name: 'Без подложки',
        spine_ranges: [
          { min_spreads: 0, max_spreads: 10, spine_mm: 5 },
          { min_spreads: 11, max_spreads: 20, spine_mm: 8 },
        ],
      } as PrinterSheetType,
    ],
  };

  it('старый профиль продолжает считать корешок', () => {
    expect(resolveSpineMm(LEGACY, 'plain', 8)).toBe(5);
    expect(resolveSpineMm(LEGACY, 'plain', 15)).toBe(8);
  });

  it('resolveSpineFromRanges (deprecated) делегирует в resolveSpineMm', () => {
    expect(resolveSpineFromRanges(LEGACY, 'plain', 8)).toBe(5);
    expect(resolveSpineFromRanges(CONFIG, 'plain', 30)).toBe(12);
  });

  it('normalizeSpine: spine_ranges → mode=ranges', () => {
    const sheet = LEGACY.sheet_types[0];
    expect(normalizeSpine(sheet)).toEqual({ mode: 'ranges', ranges: sheet.spine_ranges });
  });
});
