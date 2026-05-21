/**
 * Тесты checkAspectCompatibility (РЭ.28.2).
 *
 * Покрывают:
 *  - три уровня <5% ok / 5-10% warning / >10% blocked
 *  - симметрия (разница A→B === B→A)
 *  - граничные случаи (одинаковые размеры, нулевые/отрицательные)
 *  - текст message для UI содержит процент
 */

import { describe, it, expect } from 'vitest';
import { checkAspectCompatibility } from '../aspect-compatibility';

describe('checkAspectCompatibility (РЭ.28)', () => {
  it('идентичные размеры → ok, diff=0', () => {
    const r = checkAspectCompatibility(210, 297, 210, 297);
    expect(r.level).toBe('ok');
    expect(r.aspect_diff_percent).toBe(0);
    expect(r.message).toContain('совпадают');
  });

  it('пропорциональный resize → ok, diff=0 (аспект совпадает)', () => {
    // 200×283 имеет тот же аспект ≈ 0.707, что и 210×297
    const r = checkAspectCompatibility(210, 297, 200, 282.85);
    expect(r.level).toBe('ok');
    expect(r.aspect_diff_percent).toBeLessThan(0.5);
  });

  it('маленькая разница 3% → ok', () => {
    // 210×290 vs 210×297 — аспект 210/297=0.707, 210/290=0.724, diff ~2.4%
    const r = checkAspectCompatibility(210, 297, 210, 290);
    expect(r.level).toBe('ok');
    expect(r.aspect_diff_percent).toBeLessThan(5);
  });

  it('умеренная разница 6-7% → warning', () => {
    // 210×297 (0.707) vs 200×270 (0.741) → diff ≈ 4.8% — на границе
    // возьмём явный warning-кейс: 200×260 (0.769) → diff ≈ 8.8%
    const r = checkAspectCompatibility(210, 297, 200, 260);
    expect(r.level).toBe('warning');
    expect(r.aspect_diff_percent).toBeGreaterThanOrEqual(5);
    expect(r.aspect_diff_percent).toBeLessThan(10);
  });

  it('большая разница >10% → blocked', () => {
    // 210×297 (0.707) vs 200×200 (1.0) → diff ≈ 41.4%
    const r = checkAspectCompatibility(210, 297, 200, 200);
    expect(r.level).toBe('blocked');
    expect(r.aspect_diff_percent).toBeGreaterThan(10);
  });

  it('симметрия: diff(A→B) === diff(B→A)', () => {
    const a = checkAspectCompatibility(210, 297, 200, 260);
    const b = checkAspectCompatibility(200, 260, 210, 297);
    expect(a.aspect_diff_percent).toBeCloseTo(b.aspect_diff_percent, 5);
    expect(a.level).toBe(b.level);
  });

  it('blocked при размерах ≤ 0', () => {
    const r1 = checkAspectCompatibility(0, 297, 210, 297);
    expect(r1.level).toBe('blocked');
    const r2 = checkAspectCompatibility(210, -10, 210, 297);
    expect(r2.level).toBe('blocked');
  });

  it('квадрат vs прямоугольник → blocked', () => {
    const r = checkAspectCompatibility(100, 100, 200, 300);
    expect(r.level).toBe('blocked');
    expect(r.aspect_diff_percent).toBeGreaterThan(40);
  });

  it('message содержит % при warning', () => {
    const r = checkAspectCompatibility(210, 297, 200, 260);
    expect(r.level).toBe('warning');
    expect(r.message).toContain('%');
  });

  it('message содержит % при blocked', () => {
    const r = checkAspectCompatibility(100, 100, 200, 300);
    expect(r.level).toBe('blocked');
    expect(r.message).toContain('%');
  });

  it('aspect_diff_percent округлён до 1 знака после запятой', () => {
    const r = checkAspectCompatibility(210, 297, 200, 260);
    // Не должен иметь больше 1 знака после запятой
    const decimals = String(r.aspect_diff_percent).split('.')[1] ?? '';
    expect(decimals.length).toBeLessThanOrEqual(1);
  });
});
