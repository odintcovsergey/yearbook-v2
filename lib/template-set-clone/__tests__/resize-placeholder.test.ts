/**
 * Тесты resizePlaceholder (РЭ.28.2).
 *
 * Покрывают:
 *  - scale 1.0 → возвращает копию (через округление)
 *  - scale 2.0 → удваиваются размеры и координаты
 *  - округление до пикселей применено
 *  - rotation_deg, label, type — копируются как есть
 *  - возвращает НОВЫЙ объект (не мутирует входной)
 */

import { describe, it, expect } from 'vitest';
import { resizePlaceholder } from '../resize-placeholder';
import { MM_STEP } from '../constants';

const samplePlaceholder = {
  x_mm: 32.808,
  y_mm: 14.999,
  width_mm: 81.21,
  height_mm: 111.622,
  rotation_deg: 0,
  label: 'headteacherphoto',
  type: 'photo',
  fit: 'fill_proportional',
  original_label: 'headteacherphoto',
  required: false,
};

describe('resizePlaceholder (РЭ.28)', () => {
  it('scale 1.0 → возвращает все 4 mm-значения с округлением до пикселей', () => {
    const result = resizePlaceholder(samplePlaceholder, 1, 1);
    // Не равно исходному (округление к пикселю), но кратно MM_STEP
    // Проверяем через round(value/STEP) — должно быть целое число пикселей.
    for (const key of ['x_mm', 'y_mm', 'width_mm', 'height_mm'] as const) {
      const px = result[key] / MM_STEP;
      expect(Math.abs(px - Math.round(px))).toBeLessThan(1e-6);
    }
  });

  it('scale 2.0 по X → удваиваются x_mm и width_mm, y/height не меняются', () => {
    const result = resizePlaceholder(samplePlaceholder, 2, 1);
    expect(result.x_mm).toBeGreaterThan(samplePlaceholder.x_mm * 1.95);
    expect(result.x_mm).toBeLessThan(samplePlaceholder.x_mm * 2.05);
    expect(result.width_mm).toBeGreaterThan(samplePlaceholder.width_mm * 1.95);
    expect(result.width_mm).toBeLessThan(samplePlaceholder.width_mm * 2.05);
    // y и height без изменения
    expect(Math.abs(result.y_mm - samplePlaceholder.y_mm)).toBeLessThan(MM_STEP * 2);
    expect(Math.abs(result.height_mm - samplePlaceholder.height_mm)).toBeLessThan(MM_STEP * 2);
  });

  it('scale 2.0 по обеим осям → все 4 mm-значения удваиваются', () => {
    const result = resizePlaceholder(samplePlaceholder, 2, 2);
    expect(result.x_mm).toBeGreaterThan(samplePlaceholder.x_mm * 1.95);
    expect(result.y_mm).toBeGreaterThan(samplePlaceholder.y_mm * 1.95);
    expect(result.width_mm).toBeGreaterThan(samplePlaceholder.width_mm * 1.95);
    expect(result.height_mm).toBeGreaterThan(samplePlaceholder.height_mm * 1.95);
  });

  it('rotation_deg, label, type, fit — копируются как есть', () => {
    const result = resizePlaceholder(samplePlaceholder, 1.5, 1.5);
    expect(result.rotation_deg).toBe(0);
    expect(result.label).toBe('headteacherphoto');
    expect(result.type).toBe('photo');
    expect(result.fit).toBe('fill_proportional');
    expect(result.original_label).toBe('headteacherphoto');
    expect(result.required).toBe(false);
  });

  it('возвращает НОВЫЙ объект, не мутирует входной', () => {
    const originalX = samplePlaceholder.x_mm;
    const result = resizePlaceholder(samplePlaceholder, 2, 2);
    // Сам объект разный
    expect(result).not.toBe(samplePlaceholder);
    // Входной не изменён
    expect(samplePlaceholder.x_mm).toBe(originalX);
  });

  it('все 4 mm-значения после resize кратны MM_STEP', () => {
    const result = resizePlaceholder(samplePlaceholder, 1.7, 1.3);
    for (const key of ['x_mm', 'y_mm', 'width_mm', 'height_mm'] as const) {
      const pixels = result[key] / MM_STEP;
      expect(Math.abs(pixels - Math.round(pixels))).toBeLessThan(1e-6);
    }
  });

  it('placeholder с rotation_deg=90 — rotation сохраняется', () => {
    const rotated = { ...samplePlaceholder, rotation_deg: 90 };
    const result = resizePlaceholder(rotated, 1.5, 1.5);
    expect(result.rotation_deg).toBe(90);
  });

  it('дополнительные поля в placeholder копируются через spread', () => {
    const withExtra = { ...samplePlaceholder, custom_field: 'foo', another: 42 };
    const result = resizePlaceholder(withExtra, 1, 1);
    expect(result.custom_field).toBe('foo');
    expect(result.another).toBe(42);
  });
});
