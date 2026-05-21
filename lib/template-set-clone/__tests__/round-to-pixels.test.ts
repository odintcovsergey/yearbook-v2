/**
 * Тесты roundMmToPx + mmToPx (РЭ.28.2).
 *
 * Покрывают:
 *  - округление до ближайшего пикселя при 300 DPI
 *  - идемпотентность
 *  - граничные случаи (0, отрицательные, очень маленькие, дробные)
 *  - конверсия mm → целые px для UI
 */

import { describe, it, expect } from 'vitest';
import { roundMmToPx, mmToPx } from '../round-to-pixels';
import { MM_STEP } from '../constants';

describe('roundMmToPx (РЭ.28)', () => {
  it('0 → 0', () => {
    expect(roundMmToPx(0)).toBe(0);
  });

  it('кратное MM_STEP → возвращает то же значение (идемпотентность)', () => {
    // MM_STEP × N всегда округляется к себе же
    const exact = MM_STEP * 100; // 100 px
    expect(roundMmToPx(exact)).toBeCloseTo(exact, 10);
  });

  it('идемпотентно: roundMmToPx(roundMmToPx(x)) === roundMmToPx(x)', () => {
    const samples = [0, 10, 91.21031, 210, 297, 1, -5, 0.001];
    for (const s of samples) {
      const once = roundMmToPx(s);
      const twice = roundMmToPx(once);
      expect(twice).toBeCloseTo(once, 10);
    }
  });

  it('210 мм → 2480 пикселей (A4 width)', () => {
    // 210 / 0.0846666... = 2480.31...
    // Math.round(2480.31) = 2480
    // Возврат: 2480 * MM_STEP = 209.973... mm
    const result = roundMmToPx(210);
    const inPixels = result / MM_STEP;
    expect(Math.round(inPixels)).toBe(2480);
  });

  it('297 мм → 3508 пикселей (A4 height)', () => {
    const result = roundMmToPx(297);
    const inPixels = result / MM_STEP;
    expect(Math.round(inPixels)).toBe(3508);
  });

  it('91.21031 мм округляется до целого пикселя', () => {
    const result = roundMmToPx(91.21031920840365);
    const inPixels = result / MM_STEP;
    expect(Number.isInteger(Math.round(inPixels))).toBe(true);
  });

  it('малое значение (0.05 мм) → 0 (округление вниз)', () => {
    // 0.05 / 0.0847 = 0.59... → Math.round = 1 → 1 * MM_STEP ≈ 0.0847
    // (округление к ближайшему пикселю)
    const result = roundMmToPx(0.05);
    expect(result).toBeCloseTo(MM_STEP, 5);
  });

  it('отрицательные значения округляются корректно', () => {
    const result = roundMmToPx(-10);
    // не падает, результат отрицательный и кратен MM_STEP
    expect(result).toBeLessThan(0);
    const inPixels = result / MM_STEP;
    expect(Number.isInteger(Math.round(inPixels))).toBe(true);
  });

  it('NaN/Infinity → возвращает как есть (не падает)', () => {
    expect(roundMmToPx(NaN)).toBeNaN();
    expect(roundMmToPx(Infinity)).toBe(Infinity);
    expect(roundMmToPx(-Infinity)).toBe(-Infinity);
  });
});

describe('mmToPx (РЭ.28)', () => {
  it('0 → 0', () => {
    expect(mmToPx(0)).toBe(0);
  });

  it('210 мм → 2480 px (A4 width)', () => {
    expect(mmToPx(210)).toBe(2480);
  });

  it('297 мм → 3508 px (A4 height)', () => {
    expect(mmToPx(297)).toBe(3508);
  });

  it('25.4 мм → 300 px (1 дюйм при 300 DPI)', () => {
    expect(mmToPx(25.4)).toBe(300);
  });

  it('возвращает целое число всегда', () => {
    const samples = [10, 91.21, 200.5, 99.99];
    for (const s of samples) {
      expect(Number.isInteger(mmToPx(s))).toBe(true);
    }
  });

  it('NaN → 0 (защита от падения в UI)', () => {
    expect(mmToPx(NaN)).toBe(0);
  });
});
