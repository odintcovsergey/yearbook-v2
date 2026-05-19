/**
 * Тесты lib/photo-transform (КЭ.1).
 *
 * Покрытие:
 *   - computeCrop: baseline cover (scale=1, offset=0,0)
 *   - computeCrop: scale > 1 (zoom)
 *   - computeCrop: offset != (0,0) (сдвиг)
 *   - computeCrop: scale + offset одновременно
 *   - computeCrop: ориентация landscape/portrait image и frame
 *   - computeCrop: clamp scale и offset
 *   - computeCrop: degenerate inputs (0, negative)
 *   - parseScale / parseOffset: некорректные входы
 *   - serializeScale / serializeOffset: round-trip
 *   - hasCustomTransform: default detection
 */

import { describe, it, expect } from 'vitest';
import {
  computeCrop,
  parseScale,
  parseOffset,
  serializeScale,
  serializeOffset,
  hasCustomTransform,
  parseRotate,
  serializeRotate,
  computeAutoZoomForRotation,
  SCALE_MIN,
  SCALE_MAX,
  OFFSET_MIN,
  OFFSET_MAX,
  ROTATE_MIN,
  ROTATE_MAX,
} from '../index';

describe('computeCrop — baseline (scale=1, offset=0,0)', () => {
  it('landscape image (200x100) в landscape frame ratio=2 → crop = весь image', () => {
    // imageRatio=2, targetRatio=2 → exact fit
    const r = computeCrop(200, 100, 2.0, 1, 0, 0);
    expect(r.cropW).toBe(200);
    expect(r.cropH).toBe(100);
    expect(r.cropX).toBe(0);
    expect(r.cropY).toBe(0);
  });

  it('landscape image (200x100) в square frame ratio=1 → срез боковин', () => {
    // imageRatio=2 > targetRatio=1 → cropH=100 (вся высота), cropW=100 (квадрат)
    const r = computeCrop(200, 100, 1.0, 1, 0, 0);
    expect(r.cropW).toBe(100);
    expect(r.cropH).toBe(100);
    expect(r.cropX).toBe(50); // центрирование (200-100)/2
    expect(r.cropY).toBe(0);
  });

  it('portrait image (100x200) в landscape frame ratio=2 → срез верха/низа', () => {
    // imageRatio=0.5 < targetRatio=2 → cropW=100 (вся ширина), cropH=50
    const r = computeCrop(100, 200, 2.0, 1, 0, 0);
    expect(r.cropW).toBe(100);
    expect(r.cropH).toBe(50);
    expect(r.cropX).toBe(0);
    expect(r.cropY).toBe(75); // (200-50)/2
  });
});

describe('computeCrop — scale > 1 (zoom-in)', () => {
  it('scale=2 → crop в 2 раза меньше (более крупный план)', () => {
    // Базовый baseline: 200x100 в square frame → crop 100x100 в позиции (50, 0)
    // scale=2 → cropW=50, cropH=50, центр в (200/2, 100/2)=(100, 50)
    //          cropX = (200 - 50) / 2 = 75, cropY = (100 - 50) / 2 = 25
    const r = computeCrop(200, 100, 1.0, 2, 0, 0);
    expect(r.cropW).toBe(50);
    expect(r.cropH).toBe(50);
    expect(r.cropX).toBe(75);
    expect(r.cropY).toBe(25);
  });

  it('scale=1.5 на портретном фото — половинная пропорция cropW/baseW', () => {
    const r = computeCrop(300, 600, 1.0, 1.5, 0, 0);
    // baseline: cropW=300, cropH=300 (срез верха/низа), position (0, 150)
    // scale=1.5 → cropW=300/1.5=200, cropH=200, центрировано
    expect(r.cropW).toBeCloseTo(200, 5);
    expect(r.cropH).toBeCloseTo(200, 5);
    expect(r.cropX).toBeCloseTo(50, 5); // (300-200)/2
    expect(r.cropY).toBeCloseTo(200, 5); // (600-200)/2
  });
});

describe('computeCrop — offset != (0,0)', () => {
  it('offset=(1, 0) → cropX в максимальном правом положении', () => {
    // baseline: 200x100 в square frame, scale=1 → cropW=100 в позиции (50, 0)
    // offset=1 → cropX = remainingW * (1+1) / 2 = 100 * 2 / 2 = 100 (правый край)
    const r = computeCrop(200, 100, 1.0, 1, 1, 0);
    expect(r.cropX).toBe(100); // remainingW = 200 - 100 = 100
    expect(r.cropY).toBe(0); // remainingH = 0
  });

  it('offset=(-1, 0) → cropX = 0 (левый край)', () => {
    const r = computeCrop(200, 100, 1.0, 1, -1, 0);
    expect(r.cropX).toBe(0);
    expect(r.cropY).toBe(0);
  });

  it('offset=(0, -1) → cropY в верхнем положении (горизонт ниже)', () => {
    // portrait 100x200 в landscape frame ratio=2:
    // baseline cropW=100, cropH=50, cropY=75 (центр), cropX=0
    // offset=(0, -1) → cropY = remainingH * (1-1)/2 = 0 (верх)
    const r = computeCrop(100, 200, 2.0, 1, 0, -1);
    expect(r.cropY).toBe(0);
    expect(r.cropX).toBe(0);
  });

  it('offset=(0, 1) → cropY в нижнем положении (горизонт выше)', () => {
    const r = computeCrop(100, 200, 2.0, 1, 0, 1);
    // remainingH = 200 - 50 = 150, cropY = 150 * (1+1)/2 = 150
    expect(r.cropY).toBe(150);
  });
});

describe('computeCrop — scale + offset вместе', () => {
  it('scale=2, offset=(1, 1) → правый-нижний угол с зумом', () => {
    // 200x100 в square frame
    // scale=2 → cropW=50, cropH=50
    // offset=(1, 1) → remainingW=150, cropX=150*(1+1)/2=150
    //                 remainingH=50, cropY=50*(1+1)/2=50
    const r = computeCrop(200, 100, 1.0, 2, 1, 1);
    expect(r.cropW).toBe(50);
    expect(r.cropH).toBe(50);
    expect(r.cropX).toBe(150);
    expect(r.cropY).toBe(50);
  });

  it('scale=1.5, offset=(-0.5, 0.5) — комбинация средней силы', () => {
    // 600x400, square frame
    // baseline: cropW=400, cropH=400 в (100, 0)
    // scale=1.5 → cropW=400/1.5≈266.67, cropH=266.67
    // remainingW = 600 - 266.67 = 333.33
    // cropX = 333.33 * (1 + -0.5) / 2 = 333.33 * 0.25 = 83.33
    // remainingH = 400 - 266.67 = 133.33
    // cropY = 133.33 * (1 + 0.5) / 2 = 100
    const r = computeCrop(600, 400, 1.0, 1.5, -0.5, 0.5);
    expect(r.cropW).toBeCloseTo(266.67, 1);
    expect(r.cropX).toBeCloseTo(83.33, 1);
    expect(r.cropY).toBeCloseTo(100, 1);
  });
});

describe('computeCrop — clamp границы', () => {
  it('scale > SCALE_MAX → clamp в SCALE_MAX', () => {
    const r1 = computeCrop(200, 100, 1.0, 99, 0, 0);
    const r2 = computeCrop(200, 100, 1.0, SCALE_MAX, 0, 0);
    expect(r1).toEqual(r2);
  });

  it('scale < SCALE_MIN → clamp в SCALE_MIN (=1)', () => {
    const r1 = computeCrop(200, 100, 1.0, 0.5, 0, 0);
    const r2 = computeCrop(200, 100, 1.0, 1, 0, 0);
    expect(r1).toEqual(r2);
  });

  it('offset > OFFSET_MAX → clamp', () => {
    const r1 = computeCrop(200, 100, 1.0, 1, 5, 0);
    const r2 = computeCrop(200, 100, 1.0, 1, 1, 0);
    expect(r1).toEqual(r2);
  });

  it('offset < OFFSET_MIN → clamp', () => {
    const r1 = computeCrop(200, 100, 1.0, 1, -3, 0);
    const r2 = computeCrop(200, 100, 1.0, 1, -1, 0);
    expect(r1).toEqual(r2);
  });
});

describe('computeCrop — degenerate inputs', () => {
  it('naturalW = 0 → (0,0,0,0)', () => {
    expect(computeCrop(0, 100, 1.0, 1, 0, 0)).toEqual({
      cropX: 0, cropY: 0, cropW: 0, cropH: 0,
    });
  });

  it('naturalH = 0 → (0,0,0,0)', () => {
    expect(computeCrop(100, 0, 1.0, 1, 0, 0)).toEqual({
      cropX: 0, cropY: 0, cropW: 0, cropH: 0,
    });
  });

  it('targetRatio = 0 → (0,0,0,0)', () => {
    expect(computeCrop(100, 100, 0, 1, 0, 0)).toEqual({
      cropX: 0, cropY: 0, cropW: 0, cropH: 0,
    });
  });

  it('негативные размеры → (0,0,0,0)', () => {
    expect(computeCrop(-100, 100, 1.0, 1, 0, 0)).toEqual({
      cropX: 0, cropY: 0, cropW: 0, cropH: 0,
    });
  });
});

describe('parseScale', () => {
  it('undefined/null → 1', () => {
    expect(parseScale(undefined)).toBe(1);
    expect(parseScale(null)).toBe(1);
  });

  it('правильная строка → number', () => {
    expect(parseScale('1.5')).toBe(1.5);
    expect(parseScale('2')).toBe(2);
  });

  it('число → clamped', () => {
    expect(parseScale(1.5)).toBe(1.5);
    expect(parseScale(99)).toBe(SCALE_MAX);
    expect(parseScale(0.1)).toBe(SCALE_MIN);
  });

  it('некорректные строки → 1', () => {
    expect(parseScale('not a number')).toBe(1);
    expect(parseScale('NaN')).toBe(1);
    expect(parseScale({})).toBe(1);
    expect(parseScale([])).toBe(1);
  });
});

describe('parseOffset', () => {
  it('undefined/null → [0,0]', () => {
    expect(parseOffset(undefined)).toEqual([0, 0]);
    expect(parseOffset(null)).toEqual([0, 0]);
  });

  it('правильная строка → tuple', () => {
    expect(parseOffset('0.5,-0.3')).toEqual([0.5, -0.3]);
    expect(parseOffset('1,1')).toEqual([1, 1]);
    expect(parseOffset(' 0.2 , 0.4 ')).toEqual([0.2, 0.4]); // whitespace handling
  });

  it('clamp значения вне границ', () => {
    expect(parseOffset('5,-5')).toEqual([1, -1]);
  });

  it('неправильный формат → [0,0]', () => {
    expect(parseOffset('not a number')).toEqual([0, 0]);
    expect(parseOffset('1')).toEqual([0, 0]); // только одна координата
    expect(parseOffset('1,2,3')).toEqual([0, 0]); // три координаты
    expect(parseOffset('abc,def')).toEqual([0, 0]);
  });
});

describe('serialize / parse round-trip', () => {
  it('serializeScale → parseScale возвращает то же значение', () => {
    expect(parseScale(serializeScale(1.5))).toBe(1.5);
    expect(parseScale(serializeScale(1.234))).toBeCloseTo(1.234, 3);
    expect(parseScale(serializeScale(1))).toBe(1);
    expect(parseScale(serializeScale(2))).toBe(2);
  });

  it('serializeOffset → parseOffset возвращает то же значение', () => {
    const [x, y] = parseOffset(serializeOffset(0.5, -0.3));
    expect(x).toBeCloseTo(0.5, 3);
    expect(y).toBeCloseTo(-0.3, 3);
  });

  it('serializeScale убирает trailing zeros', () => {
    expect(serializeScale(1.0)).toBe('1');
    expect(serializeScale(1.5)).toBe('1.5');
    expect(serializeScale(1.500)).toBe('1.5');
  });

  it('serializeScale clamp', () => {
    expect(serializeScale(99)).toBe('2');
    expect(serializeScale(0.1)).toBe('1');
  });
});

describe('hasCustomTransform', () => {
  it('default (1, 0, 0) → false', () => {
    expect(hasCustomTransform(1, 0, 0)).toBe(false);
  });

  it('default с явным rotate=0 → false', () => {
    expect(hasCustomTransform(1, 0, 0, 0)).toBe(false);
  });

  it('любое изменение → true', () => {
    expect(hasCustomTransform(1.5, 0, 0)).toBe(true);
    expect(hasCustomTransform(1, 0.5, 0)).toBe(true);
    expect(hasCustomTransform(1, 0, -0.3)).toBe(true);
    expect(hasCustomTransform(2, 1, -1)).toBe(true);
  });

  it('rotate != 0 → true даже при scale=1, offset=0', () => {
    expect(hasCustomTransform(1, 0, 0, 5)).toBe(true);
    expect(hasCustomTransform(1, 0, 0, -1.5)).toBe(true);
  });
});

// ─── Р.2 — rotate + auto-zoom ─────────────────────────────────────────

describe('parseRotate', () => {
  it('null/undefined/некорректные значения → 0', () => {
    expect(parseRotate(null)).toBe(0);
    expect(parseRotate(undefined)).toBe(0);
    expect(parseRotate('garbage')).toBe(0);
    expect(parseRotate(NaN)).toBe(0);
    expect(parseRotate('')).toBe(0);
  });

  it('валидные значения проходят', () => {
    expect(parseRotate(5)).toBe(5);
    expect(parseRotate('-3.5')).toBe(-3.5);
    expect(parseRotate('10')).toBe(10);
    expect(parseRotate(0)).toBe(0);
  });

  it('clamp [-45, 45]', () => {
    expect(parseRotate(100)).toBe(ROTATE_MAX);
    expect(parseRotate(-100)).toBe(ROTATE_MIN);
    expect(parseRotate(45.0001)).toBe(ROTATE_MAX);
  });
});

describe('serializeRotate', () => {
  it('тривиальные значения', () => {
    expect(serializeRotate(0)).toBe('0');
    expect(serializeRotate(5)).toBe('5');
    expect(serializeRotate(-3)).toBe('-3');
  });

  it('дробные части', () => {
    expect(serializeRotate(0.5)).toBe('0.5');
    expect(serializeRotate(7.25)).toBe('7.25');
  });

  it('clamp', () => {
    expect(serializeRotate(100)).toBe('45');
    expect(serializeRotate(-100)).toBe('-45');
  });
});

describe('computeAutoZoomForRotation', () => {
  it('rotate=0 → factor=1 (без зума)', () => {
    expect(computeAutoZoomForRotation(0, 1)).toBe(1);
    expect(computeAutoZoomForRotation(0, 2)).toBe(1);
    expect(computeAutoZoomForRotation(0, 0.5)).toBe(1);
  });

  it('квадратная рамка (aspect=1), 45° → √2', () => {
    const f = computeAutoZoomForRotation(45, 1);
    expect(f).toBeCloseTo(Math.SQRT2, 4);
  });

  it('квадратная рамка, -45° → тоже √2 (симметрия)', () => {
    expect(computeAutoZoomForRotation(-45, 1)).toBeCloseTo(Math.SQRT2, 4);
  });

  it('малые углы дают factor близкий к 1', () => {
    expect(computeAutoZoomForRotation(2, 1)).toBeLessThan(1.05);
    expect(computeAutoZoomForRotation(5, 1)).toBeLessThan(1.1);
  });

  it('широкая рамка (aspect=2): больший зум на тех же углах', () => {
    const fSquare = computeAutoZoomForRotation(30, 1);
    const fWide = computeAutoZoomForRotation(30, 2);
    expect(fWide).toBeGreaterThan(fSquare);
  });

  it('aspect=2 и aspect=0.5 (повернутая та же рамка) дают одинаковый factor', () => {
    expect(computeAutoZoomForRotation(15, 2)).toBeCloseTo(
      computeAutoZoomForRotation(15, 0.5),
      6,
    );
  });

  it('некорректные входы → 1 (безопасно)', () => {
    expect(computeAutoZoomForRotation(0, 0)).toBe(1);
    expect(computeAutoZoomForRotation(0, -1)).toBe(1);
    expect(computeAutoZoomForRotation(NaN, 1)).toBe(1);
  });
});
