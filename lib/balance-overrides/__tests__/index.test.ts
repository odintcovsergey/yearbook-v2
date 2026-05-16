/**
 * Тесты lib/balance-overrides (БТ.1.4).
 *
 * Покрытие:
 *   - parseBalanceOverrides: распознавание __hidden__/__pos__ ключей
 *   - applyBalanceOverrides: hide + reposition logic
 *   - applyBalanceFromData: composition (parse + apply)
 *   - граничные случаи: empty data, malformed values, mixed keys
 */

import { describe, it, expect } from 'vitest';
import {
  parseBalanceOverrides,
  applyBalanceOverrides,
  applyBalanceFromData,
} from '../index';
import type { Placeholder } from '@/lib/album-builder/types';

function photoSlot(label: string, x: number, y: number): Placeholder {
  return {
    label,
    x_mm: x,
    y_mm: y,
    width_mm: 30,
    height_mm: 30,
    type: 'photo',
    fit: 'fill_proportional',
    required: false,
  };
}

describe('parseBalanceOverrides', () => {
  it('пустой data → null', () => {
    expect(parseBalanceOverrides({})).toBeNull();
  });

  it('data без служебных ключей → null', () => {
    expect(
      parseBalanceOverrides({
        studentportrait: 'http://example.com/x.jpg',
        studentname: 'John',
      }),
    ).toBeNull();
  });

  it('__hidden__ распознаётся', () => {
    const r = parseBalanceOverrides({ __hidden__teacherphoto_5: '1' });
    expect(r).toEqual({ teacherphoto_5: { hidden: true } });
  });

  it('__pos__ распознаётся', () => {
    const r = parseBalanceOverrides({ __pos__teacherphoto_1: '10.5,20' });
    expect(r).toEqual({ teacherphoto_1: { x_mm: 10.5, y_mm: 20 } });
  });

  it('hidden + pos для одного label комбинируются', () => {
    const r = parseBalanceOverrides({
      __hidden__teacherphoto_1: '1',
      __pos__teacherphoto_1: '5,10',
    });
    expect(r).toEqual({
      teacherphoto_1: { hidden: true, x_mm: 5, y_mm: 10 },
    });
  });

  it('__hidden__ со значением "0"/"false" игнорируется', () => {
    expect(parseBalanceOverrides({ __hidden__x: '0' })).toBeNull();
    expect(parseBalanceOverrides({ __hidden__x: 'false' })).toBeNull();
  });

  it('__hidden__ с пустой строкой игнорируется', () => {
    expect(parseBalanceOverrides({ __hidden__x: '' })).toBeNull();
  });

  it('__pos__ с некорректным форматом игнорируется', () => {
    expect(parseBalanceOverrides({ __pos__x: 'abc' })).toBeNull();
    expect(parseBalanceOverrides({ __pos__x: '10' })).toBeNull(); // только 1 координата
    expect(parseBalanceOverrides({ __pos__x: '10,20,30' })).toBeNull(); // 3 координаты
  });

  it('mixed data — служебные + обычные → только служебные', () => {
    const r = parseBalanceOverrides({
      studentportrait: 'http://x.com/y.jpg',
      __hidden__teacherphoto_9: '1',
      teachername_1: 'Иванов И.И.',
      __pos__teacherphoto_1: '0,0',
    });
    expect(r).toEqual({
      teacherphoto_9: { hidden: true },
      teacherphoto_1: { x_mm: 0, y_mm: 0 },
    });
  });

  it('null значение игнорируется', () => {
    const r = parseBalanceOverrides({
      __hidden__x: null,
      __pos__y: null,
    });
    expect(r).toBeNull();
  });

  it('whitespace в __pos__ обрабатывается', () => {
    const r = parseBalanceOverrides({ __pos__x: '  10  ,  20  ' });
    expect(r).toEqual({ x: { x_mm: 10, y_mm: 20 } });
  });
});

describe('applyBalanceOverrides', () => {
  const placeholders = [
    photoSlot('p1', 10, 10),
    photoSlot('p2', 20, 20),
    photoSlot('p3', 30, 30),
  ];

  it('null overrides → identity', () => {
    expect(applyBalanceOverrides(placeholders, null)).toEqual(placeholders);
  });

  it('пустой overrides {} → identity', () => {
    // Пустой объект тоже identity — фильтрация ничего не делает
    expect(applyBalanceOverrides(placeholders, {})).toEqual(placeholders);
  });

  it('hidden исключает placeholder', () => {
    const r = applyBalanceOverrides(placeholders, { p2: { hidden: true } });
    expect(r.length).toBe(2);
    expect(r.map((p) => p.label)).toEqual(['p1', 'p3']);
  });

  it('pos переписывает координаты', () => {
    const r = applyBalanceOverrides(placeholders, {
      p2: { x_mm: 100, y_mm: 200 },
    });
    expect(r.length).toBe(3);
    expect(r.find((p) => p.label === 'p2')?.x_mm).toBe(100);
    expect(r.find((p) => p.label === 'p2')?.y_mm).toBe(200);
    // width/height НЕ изменяются
    expect(r.find((p) => p.label === 'p2')?.width_mm).toBe(30);
  });

  it('hidden имеет приоритет над pos для одного label', () => {
    const r = applyBalanceOverrides(placeholders, {
      p2: { hidden: true, x_mm: 100, y_mm: 200 },
    });
    // p2 удалён, остальные без изменений
    expect(r.length).toBe(2);
    expect(r.find((p) => p.label === 'p2')).toBeUndefined();
  });

  it('partial pos (только x_mm) — y_mm остаётся прежним', () => {
    const r = applyBalanceOverrides(placeholders, {
      p2: { x_mm: 100 },
    });
    expect(r.find((p) => p.label === 'p2')?.x_mm).toBe(100);
    expect(r.find((p) => p.label === 'p2')?.y_mm).toBe(20); // оригинал
  });

  it('не мутирует входной массив', () => {
    const original = placeholders.map((p) => ({ ...p }));
    applyBalanceOverrides(placeholders, { p2: { hidden: true } });
    expect(placeholders).toEqual(original);
  });
});

describe('applyBalanceFromData (композиция)', () => {
  const placeholders = [
    photoSlot('teacherphoto_1', 10, 10),
    photoSlot('teacherphoto_2', 20, 10),
    photoSlot('teacherphoto_3', 30, 10),
  ];

  it('data без служебных ключей → identity', () => {
    const r = applyBalanceFromData(placeholders, {
      teacherphoto_1: 'http://x.com/1.jpg',
    });
    expect(r).toEqual(placeholders);
  });

  it('data с __hidden__ → placeholder скрывается', () => {
    const r = applyBalanceFromData(placeholders, {
      __hidden__teacherphoto_2: '1',
    });
    expect(r.length).toBe(2);
    expect(r.map((p) => p.label)).toEqual(['teacherphoto_1', 'teacherphoto_3']);
  });

  it('data с __pos__ → координаты переписываются', () => {
    const r = applyBalanceFromData(placeholders, {
      __pos__teacherphoto_1: '50,100',
    });
    expect(r.find((p) => p.label === 'teacherphoto_1')?.x_mm).toBe(50);
    expect(r.find((p) => p.label === 'teacherphoto_1')?.y_mm).toBe(100);
  });

  it('реальный сценарий: 5 учителей в 3×3 (9 слотов) → 4 hidden', () => {
    const all9 = Array.from({ length: 9 }, (_, i) =>
      photoSlot(`teacherphoto_${i + 1}`, (i % 3) * 30, Math.floor(i / 3) * 30),
    );
    const data: Record<string, string> = {};
    for (let i = 6; i <= 9; i++) {
      data[`__hidden__teacherphoto_${i}`] = '1';
    }
    const r = applyBalanceFromData(all9, data);
    expect(r.length).toBe(5);
    expect(r.map((p) => p.label).sort()).toEqual([
      'teacherphoto_1',
      'teacherphoto_2',
      'teacherphoto_3',
      'teacherphoto_4',
      'teacherphoto_5',
    ]);
  });
});
