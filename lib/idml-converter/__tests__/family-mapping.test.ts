import { describe, it, expect } from 'vitest';
import { getFamilyMapping } from '../family-mapping';

/**
 * Реестр family-mapping: новые мастера набора «Аква меч» должны получать
 * ненулевой slot_capacity и правильный page_type/page_role, иначе движок их
 * не видит (грузятся с slot_capacity=null). ТЗ tz-mirror + расширение каталога.
 */
describe('family-mapping: новые мастера', () => {
  it('J-Quarter — page-any common, photos_quarter=2', () => {
    const m = getFamilyMapping('J-Quarter');
    expect(m).not.toBeNull();
    expect(m!.page_type).toBe('page-any');
    expect(m!.page_role).toBe('common');
    expect(m!.slot_capacity).toEqual({ photos_quarter: 2 });
  });

  it('J-Collage-3/5/6 — page-any common, photos_collage=число', () => {
    for (const [name, n] of [
      ['J-Collage-3', 3],
      ['J-Collage-5', 5],
      ['J-Collage-6', 6],
    ] as const) {
      const m = getFamilyMapping(name);
      expect(m, name).not.toBeNull();
      expect(m!.page_type).toBe('page-any');
      expect(m!.slot_capacity).toEqual({ photos_collage: n });
    }
  });

  it('G-Teachers-3x2 — page-right teacher_right, teachers=6', () => {
    const m = getFamilyMapping('G-Teachers-3x2');
    expect(m).not.toBeNull();
    expect(m!.page_type).toBe('page-right');
    expect(m!.page_role).toBe('teacher_right');
    expect(m!.slot_capacity).toEqual({ teachers: 6 });
  });

  it('совместимость: старые J-Quarter-Left/Right и J-Collage-4 на месте', () => {
    expect(getFamilyMapping('J-Quarter-Left')?.page_type).toBe('page-left');
    expect(getFamilyMapping('J-Quarter-Right')?.page_type).toBe('page-right');
    expect(getFamilyMapping('J-Collage-4')?.slot_capacity).toEqual({
      photos_collage: 4,
    });
  });
});
