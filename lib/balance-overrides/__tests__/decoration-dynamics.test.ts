/**
 * Этап 3 ТЗ привязанного декора (docs/tz-attached-decor.md, Часть 1, динамика).
 *
 * Декор СЛЕДУЕТ за своим базовым слотом через тот же движок balance-overrides,
 * что двигает/скрывает обычные слоты при симметризации:
 *   - базовый слот скрыт (__hidden__<base>)  → декор тоже скрыт;
 *   - базовый слот сдвинут (__pos__<base>)   → декор сдвинут на ту же дельту
 *     (deco = base_new + offset);
 *   - базовый слот на месте                  → декор на исходной позиции.
 */

import { describe, it, expect } from 'vitest';
import { applyBalanceFromData, applyBalanceOverrides, parseBalanceOverrides } from '../index';
import type { Placeholder } from '@/lib/album-builder/types';

type Ph = {
  label: string;
  x_mm: number;
  y_mm: number;
  width_mm: number;
  height_mm: number;
  type: 'photo' | 'text' | 'decoration';
  attached_to?: string;
  layer?: 'under' | 'over';
  offset_x_mm?: number;
  offset_y_mm?: number;
};

// balance-overrides типизирован на album-builder Placeholder; в тестах
// строим минимальные объекты и приводим (рантайм-логика смотрит только на
// label/x_mm/y_mm/type/attached_to/offset).
const asPhs = (phs: Ph[]): Placeholder[] => phs as unknown as Placeholder[];

const photo = (label: string, x: number, y: number): Ph => ({
  label, x_mm: x, y_mm: y, width_mm: 30, height_mm: 30, type: 'photo',
});

const decor = (
  label: string,
  attached_to: string,
  x: number,
  y: number,
  offset_x_mm: number,
  offset_y_mm: number,
  layer: 'under' | 'over' = 'over',
): Ph => ({
  label, x_mm: x, y_mm: y, width_mm: 20, height_mm: 10,
  type: 'decoration', attached_to, layer, offset_x_mm, offset_y_mm,
});

describe('decoration dynamics (Этап 3)', () => {
  it('базовый слот на месте → декор на исходной позиции', () => {
    const phs: Ph[] = [
      photo('teacherphoto_1', 10, 20),
      decor('teacherphoto_1__over', 'teacherphoto_1', 8, 15, -2, -5),
    ];
    const out = applyBalanceFromData(asPhs(phs), {});
    const d = out.find((p) => p.label === 'teacherphoto_1__over');
    expect(d).toBeDefined();
    expect(d!.x_mm).toBe(8);
    expect(d!.y_mm).toBe(15);
  });

  it('базовый слот скрыт → декор тоже исключается', () => {
    const phs: Ph[] = [
      photo('teacherphoto_2', 100, 50),
      decor('teacherphoto_2__over', 'teacherphoto_2', 98, 45, -2, -5),
      decor('teacherphoto_2__under', 'teacherphoto_2', 99, 60, -1, 10, 'under'),
    ];
    const out = applyBalanceFromData(asPhs(phs), { '__hidden__teacherphoto_2': '1' });
    // и база, и оба декора исчезают
    expect(out.find((p) => p.label === 'teacherphoto_2')).toBeUndefined();
    expect(out.find((p) => p.label === 'teacherphoto_2__over')).toBeUndefined();
    expect(out.find((p) => p.label === 'teacherphoto_2__under')).toBeUndefined();
  });

  it('базовый слот сдвинут → декор сдвигается на дельту (base_new + offset)', () => {
    const phs: Ph[] = [
      photo('teacherphoto_1', 10, 20),
      decor('teacherphoto_1__over', 'teacherphoto_1', 8, 15, -2, -5),
    ];
    // база переехала на (40, 20); декор должен встать на (40-2, 20-5) = (38, 15)
    const out = applyBalanceFromData(asPhs(phs), { '__pos__teacherphoto_1': '40,20' });
    const base = out.find((p) => p.label === 'teacherphoto_1');
    const d = out.find((p) => p.label === 'teacherphoto_1__over');
    expect(base!.x_mm).toBe(40);
    expect(base!.y_mm).toBe(20);
    expect(d!.x_mm).toBe(38);
    expect(d!.y_mm).toBe(15);
  });

  it('декор НЕ реагирует на override со СВОИМ label (только на базу)', () => {
    const phs: Ph[] = [
      photo('teacherphoto_1', 10, 20),
      decor('teacherphoto_1__over', 'teacherphoto_1', 8, 15, -2, -5),
    ];
    // override адресован самому декору — должен игнорироваться (декор следует за базой)
    const out = applyBalanceOverrides(
      asPhs(phs),
      parseBalanceOverrides({ '__pos__teacherphoto_1__over': '999,999' }),
    );
    const d = out.find((p) => p.label === 'teacherphoto_1__over');
    expect(d!.x_mm).toBe(8);
    expect(d!.y_mm).toBe(15);
  });

  it('текстовый слот с ленточкой-подложкой: __under следует за __pos__ имени', () => {
    const phs: Ph[] = [
      { label: 'teachername_1', x_mm: 30, y_mm: 80, width_mm: 40, height_mm: 8, type: 'text' },
      decor('teachername_1__under', 'teachername_1', 28, 78, -2, -2, 'under'),
    ];
    const out = applyBalanceFromData(asPhs(phs), { '__pos__teachername_1': '50,80' });
    const d = out.find((p) => p.label === 'teachername_1__under');
    expect(d!.x_mm).toBe(48); // 50 + (-2)
    expect(d!.y_mm).toBe(78); // 80 + (-2)
  });

  it('обычные слоты не затронуты новой логикой (регрессия)', () => {
    const phs: Ph[] = [photo('a', 1, 1), photo('b', 2, 2)];
    const out = applyBalanceFromData(asPhs(phs), { '__hidden__a': '1', '__pos__b': '9,9' });
    expect(out.find((p) => p.label === 'a')).toBeUndefined();
    expect(out.find((p) => p.label === 'b')!.x_mm).toBe(9);
  });
});
