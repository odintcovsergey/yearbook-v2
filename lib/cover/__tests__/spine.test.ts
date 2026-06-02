import { describe, it, expect } from 'vitest';
import {
  computeSpineWidthMm,
  resolveSheetType,
  computeSpineWidthFromPreset,
  computeCoverCanvasSize,
} from '../spine';
import type { PrintSpec } from '../types';

// Параметрический пресет-заглушка. Реальные числа Сергей подставит позже —
// тут важна МЕХАНИКА, а не конкретные значения.
const SPEC: PrintSpec = {
  spine_base_offset_mm: 5,
  bleed_mm: 3,
  cover_overhang_mm: 3,
  cover_fold_mm: 15,
  sheet_types: [
    { id: 'plain', label: 'Без прослойки', thickness_mm: 0.5 },
    { id: 'spacer_04', label: 'Прослойка 0.4 мм', thickness_mm: 0.9 },
    { id: 'spacer_07', label: 'Прослойка 0.7 мм', thickness_mm: 1.2 },
  ],
  default_sheet_type_id: 'plain',
};

describe('computeSpineWidthMm', () => {
  it('считает base + sheetCount × thickness', () => {
    // 5 + 10 × 0.5 = 10
    expect(computeSpineWidthMm({ sheetCount: 10, sheetThicknessMm: 0.5, baseOffsetMm: 5 })).toBe(10);
  });

  it('ноль листов → только base_offset', () => {
    expect(computeSpineWidthMm({ sheetCount: 0, sheetThicknessMm: 0.9, baseOffsetMm: 5 })).toBe(5);
  });

  it('прослойка увеличивает корешок', () => {
    const plain = computeSpineWidthMm({ sheetCount: 20, sheetThicknessMm: 0.5, baseOffsetMm: 5 });
    const spacer = computeSpineWidthMm({ sheetCount: 20, sheetThicknessMm: 1.2, baseOffsetMm: 5 });
    expect(spacer).toBeGreaterThan(plain);
    expect(plain).toBe(15);   // 5 + 20×0.5
    expect(spacer).toBe(29);  // 5 + 20×1.2
  });

  it('бросает при отрицательных входах', () => {
    expect(() => computeSpineWidthMm({ sheetCount: -1, sheetThicknessMm: 0.5, baseOffsetMm: 5 })).toThrow();
    expect(() => computeSpineWidthMm({ sheetCount: 10, sheetThicknessMm: -0.5, baseOffsetMm: 5 })).toThrow();
    expect(() => computeSpineWidthMm({ sheetCount: 10, sheetThicknessMm: 0.5, baseOffsetMm: -1 })).toThrow();
  });
});

describe('resolveSheetType', () => {
  it('по явному id', () => {
    expect(resolveSheetType(SPEC, 'spacer_07').thickness_mm).toBe(1.2);
  });

  it('без id → default_sheet_type_id', () => {
    expect(resolveSheetType(SPEC, null).id).toBe('plain');
    expect(resolveSheetType(SPEC, undefined).id).toBe('plain');
  });

  it('без id и без default → первый в списке', () => {
    const noDefault: PrintSpec = { ...SPEC, default_sheet_type_id: undefined };
    expect(resolveSheetType(noDefault, null).id).toBe('plain');
  });

  it('бросает на неизвестном id', () => {
    expect(() => resolveSheetType(SPEC, 'нет такого')).toThrow();
  });

  it('бросает на пустом списке типов', () => {
    const empty: PrintSpec = { ...SPEC, sheet_types: [] };
    expect(() => resolveSheetType(empty, null)).toThrow();
  });
});

describe('computeSpineWidthFromPreset', () => {
  it('берёт толщину выбранного листа и base из пресета', () => {
    // plain: 5 + 30×0.5 = 20
    expect(computeSpineWidthFromPreset(SPEC, 30, 'plain')).toBe(20);
    // spacer_04: 5 + 30×0.9 = 32
    expect(computeSpineWidthFromPreset(SPEC, 30, 'spacer_04')).toBe(32);
  });

  it('без указания листа использует дефолт пресета', () => {
    expect(computeSpineWidthFromPreset(SPEC, 30)).toBe(20); // как plain
  });
});

describe('computeCoverCanvasSize', () => {
  it('полная ширина = зад + корешок + перед + 2×(загиб+bleed)', () => {
    const r = computeCoverCanvasSize({
      backWidthMm: 226,
      frontWidthMm: 226,
      heightMm: 288,
      spineWidthMm: 20,
      foldMm: 15,
      bleedMm: 3,
    });
    // 226 + 20 + 226 + 2×(15+3) = 508
    expect(r.fullWidthMm).toBe(508);
    // 288 + 2×18 = 324
    expect(r.fullHeightMm).toBe(324);
  });

  it('границы зоны корешка по центру (после левого поля + задней зоны)', () => {
    const r = computeCoverCanvasSize({
      backWidthMm: 226,
      frontWidthMm: 226,
      heightMm: 288,
      spineWidthMm: 20,
      foldMm: 15,
      bleedMm: 3,
    });
    // sideMargin = 18; spineLeft = 18 + 226 = 244; spineRight = 264
    expect(r.spineLeftMm).toBe(244);
    expect(r.spineRightMm).toBe(264);
    expect(r.spineRightMm - r.spineLeftMm).toBe(20); // = ширина корешка
  });

  it('плавающий корешок расширяет полотно', () => {
    const base = { backWidthMm: 226, frontWidthMm: 226, heightMm: 288, foldMm: 15, bleedMm: 3 };
    const thin = computeCoverCanvasSize({ ...base, spineWidthMm: 10 });
    const thick = computeCoverCanvasSize({ ...base, spineWidthMm: 30 });
    expect(thick.fullWidthMm - thin.fullWidthMm).toBe(20);
  });

  it('бросает при отрицательных размерах', () => {
    expect(() =>
      computeCoverCanvasSize({
        backWidthMm: -1, frontWidthMm: 226, heightMm: 288, spineWidthMm: 20, foldMm: 15, bleedMm: 3,
      }),
    ).toThrow();
  });
});

describe('сквозной сценарий: число листов → корешок → полотно', () => {
  it('альбом на 24 разворота, без прослойки', () => {
    const sheetCount = 24;
    const spine = computeSpineWidthFromPreset(SPEC, sheetCount, 'plain'); // 5 + 24×0.5 = 17
    expect(spine).toBe(17);
    const canvas = computeCoverCanvasSize({
      backWidthMm: 226,
      frontWidthMm: 226,
      heightMm: 288,
      spineWidthMm: spine,
      foldMm: SPEC.cover_fold_mm,
      bleedMm: SPEC.bleed_mm,
    });
    expect(canvas.fullWidthMm).toBe(226 + 17 + 226 + 2 * (15 + 3)); // 505
    expect(canvas.spineRightMm - canvas.spineLeftMm).toBe(17);
  });
});
