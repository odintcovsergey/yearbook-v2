/**
 * Тесты для centerLastRowSlots (РЭ.37.5.b).
 *
 * Helper центрирует видимые portrait/name/quote-слоты в строке, где
 * часть слотов скрыта через __hidden__. Применяется к симметризованным
 * страницам (РЭ.37.4) и адаптивному хвосту grid.
 */

import { describe, it, expect } from 'vitest';
import { centerLastRowSlots } from '../sections/shared';

function slot(label: string, x: number, y: number) {
  return { label, x_mm: x, y_mm: y };
}

describe('centerLastRowSlots', () => {
  it('grid 2×3 с одним hidden в нижнем ряду → центрирует оставшиеся два', () => {
    // 2 ряда × 3 колонки. Y верхнего = 10, Y нижнего = 100.
    // X: 10, 50, 90 (шаг dx=40).
    // studentportrait_6 в нижнем правом → hidden.
    const master = {
      placeholders: [
        slot('studentportrait_1', 10, 10),
        slot('studentportrait_2', 50, 10),
        slot('studentportrait_3', 90, 10),
        slot('studentportrait_4', 10, 100),
        slot('studentportrait_5', 50, 100),
        slot('studentportrait_6', 90, 100),
      ],
    };
    const bindings: Record<string, unknown> = {
      studentportrait_1: 'p1',
      studentportrait_2: 'p2',
      studentportrait_3: 'p3',
      studentportrait_4: 'p4',
      studentportrait_5: 'p5',
      __hidden__studentportrait_6: '1',
    };
    centerLastRowSlots(master, bindings);

    // Нижний ряд: 2 видимых + 1 hidden. dx=40, shift = 1*40/2 = 20.
    // portrait_4: x 10 → 30, portrait_5: x 50 → 70.
    expect(bindings.__pos__studentportrait_4).toBe('30,100');
    expect(bindings.__pos__studentportrait_5).toBe('70,100');
    // Верхний ряд — не трогаем (там нет hidden).
    expect(bindings.__pos__studentportrait_1).toBeUndefined();
    expect(bindings.__pos__studentportrait_2).toBeUndefined();
    expect(bindings.__pos__studentportrait_3).toBeUndefined();
  });

  it('grid 2×3 с двумя hidden → один видимый сдвигается на dx', () => {
    // studentportrait_5 и _6 hidden, остаётся только portrait_4.
    const master = {
      placeholders: [
        slot('studentportrait_1', 10, 10),
        slot('studentportrait_2', 50, 10),
        slot('studentportrait_3', 90, 10),
        slot('studentportrait_4', 10, 100),
        slot('studentportrait_5', 50, 100),
        slot('studentportrait_6', 90, 100),
      ],
    };
    const bindings: Record<string, unknown> = {
      studentportrait_1: 'p1',
      studentportrait_2: 'p2',
      studentportrait_3: 'p3',
      studentportrait_4: 'p4',
      __hidden__studentportrait_5: '1',
      __hidden__studentportrait_6: '1',
    };
    centerLastRowSlots(master, bindings);

    // dx=40, shift = 2*40/2 = 40. portrait_4: x 10 → 50.
    expect(bindings.__pos__studentportrait_4).toBe('50,100');
  });

  it('связанные studentname_N и studentquote_N сдвигаются вместе с portrait_N', () => {
    const master = {
      placeholders: [
        slot('studentportrait_1', 10, 10),
        slot('studentportrait_2', 50, 10),
        slot('studentname_1', 10, 40),
        slot('studentname_2', 50, 40),
        slot('studentquote_1', 10, 50),
        slot('studentquote_2', 50, 50),
      ],
    };
    const bindings: Record<string, unknown> = {
      studentportrait_1: 'p1',
      studentname_1: 'Ivanov',
      studentquote_1: 'Hello',
      __hidden__studentportrait_2: '1',
      __hidden__studentname_2: '1',
      __hidden__studentquote_2: '1',
    };
    centerLastRowSlots(master, bindings);

    // 2 слота в ряду, 1 hidden. dx=40, shift=20.
    expect(bindings.__pos__studentportrait_1).toBe('30,10');
    expect(bindings.__pos__studentname_1).toBe('30,40');
    expect(bindings.__pos__studentquote_1).toBe('30,50');
  });

  it('полный ряд без hidden → ни одной __pos__ записи', () => {
    const master = {
      placeholders: [
        slot('studentportrait_1', 10, 10),
        slot('studentportrait_2', 50, 10),
        slot('studentportrait_3', 90, 10),
      ],
    };
    const bindings: Record<string, unknown> = {
      studentportrait_1: 'p1',
      studentportrait_2: 'p2',
      studentportrait_3: 'p3',
    };
    centerLastRowSlots(master, bindings);
    const posKeys = Object.keys(bindings).filter((k) => k.startsWith('__pos__'));
    expect(posKeys).toHaveLength(0);
  });

  it('mixed pattern hidden (не с конца) → не центрируется (защита)', () => {
    // portrait_2 hidden, но portrait_3 видим — паттерн не «с конца».
    const master = {
      placeholders: [
        slot('studentportrait_1', 10, 10),
        slot('studentportrait_2', 50, 10),
        slot('studentportrait_3', 90, 10),
      ],
    };
    const bindings: Record<string, unknown> = {
      studentportrait_1: 'p1',
      __hidden__studentportrait_2: '1',
      studentportrait_3: 'p3',
    };
    centerLastRowSlots(master, bindings);
    const posKeys = Object.keys(bindings).filter((k) => k.startsWith('__pos__'));
    expect(posKeys).toHaveLength(0);
  });

  it('combo-3 страница: 2 ученика + 1 hidden + classphoto → центрируем portrait', () => {
    // Симулирует L-Combined-Page после симметризации (РЭ.37.4):
    // 3 portrait слота в ряду + classphotoframe в другом месте.
    // У классфото своя позиция, мы её не трогаем.
    const master = {
      placeholders: [
        slot('studentportrait_1', 10, 200),
        slot('studentportrait_2', 60, 200),
        slot('studentportrait_3', 110, 200),
        slot('classphotoframe', 50, 50),
      ],
    };
    const bindings: Record<string, unknown> = {
      studentportrait_1: 'p1',
      studentportrait_2: 'p2',
      __hidden__studentportrait_3: '1',
      classphotoframe: 'class.jpg',
    };
    centerLastRowSlots(master, bindings);

    // dx=50, shift=25. portrait_1: 10 → 35, portrait_2: 60 → 85.
    expect(bindings.__pos__studentportrait_1).toBe('35,200');
    expect(bindings.__pos__studentportrait_2).toBe('85,200');
    // classphotoframe — не трогаем.
    expect(bindings.__pos__classphotoframe).toBeUndefined();
  });

  it('пустой мастер → no-op', () => {
    const master = { placeholders: [] };
    const bindings: Record<string, unknown> = {};
    centerLastRowSlots(master, bindings);
    expect(Object.keys(bindings)).toHaveLength(0);
  });

  it('один portrait-слот → no-op (нечего центрировать)', () => {
    const master = {
      placeholders: [slot('studentportrait_1', 10, 10)],
    };
    const bindings: Record<string, unknown> = {
      __hidden__studentportrait_1: '1',
    };
    centerLastRowSlots(master, bindings);
    expect(bindings.__pos__studentportrait_1).toBeUndefined();
  });
});
