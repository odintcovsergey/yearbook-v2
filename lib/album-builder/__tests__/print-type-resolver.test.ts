/**
 * Тесты для resolvePrintType + printTypeToSheetType + sheetTypeToPrintType.
 *
 * Покрывают:
 *  - Приоритет albumPrintType над presetPrintType
 *  - Fallback на пресет когда альбом null/undefined
 *  - Финальный default 'layflat' когда оба null
 *  - Bridge между PrintType (layflat/soft) и SheetType (hard/soft)
 */

import { describe, it, expect } from 'vitest';
import {
  resolvePrintType,
  printTypeToSheetType,
  sheetTypeToPrintType,
} from '../print-type-resolver';

describe('resolvePrintType (РЭ.27)', () => {
  it('возвращает albumPrintType когда он задан (приоритет над пресетом)', () => {
    expect(resolvePrintType('soft', 'layflat')).toBe('soft');
    expect(resolvePrintType('layflat', 'soft')).toBe('layflat');
    expect(resolvePrintType('soft', 'soft')).toBe('soft');
    expect(resolvePrintType('layflat', 'layflat')).toBe('layflat');
  });

  it('fallback на presetPrintType когда album null', () => {
    expect(resolvePrintType(null, 'soft')).toBe('soft');
    expect(resolvePrintType(null, 'layflat')).toBe('layflat');
  });

  it('fallback на presetPrintType когда album undefined', () => {
    expect(resolvePrintType(undefined, 'soft')).toBe('soft');
    expect(resolvePrintType(undefined, 'layflat')).toBe('layflat');
  });

  it('возвращает layflat когда оба null (финальный default)', () => {
    expect(resolvePrintType(null, null)).toBe('layflat');
  });

  it('возвращает layflat когда оба undefined', () => {
    expect(resolvePrintType(undefined, undefined)).toBe('layflat');
  });

  it('возвращает layflat когда album null, preset undefined', () => {
    expect(resolvePrintType(null, undefined)).toBe('layflat');
  });

  it('возвращает layflat когда album undefined, preset null', () => {
    expect(resolvePrintType(undefined, null)).toBe('layflat');
  });

  it('не возвращает album значение если оно невалидно (как null трактуется через тип)', () => {
    // TypeScript не позволит передать 'invalid' напрямую, но через any —
    // функция должна вести себя предсказуемо. Проверяем через явный union.
    const album: 'layflat' | 'soft' | null = null;
    expect(resolvePrintType(album, 'soft')).toBe('soft');
  });
});

describe('printTypeToSheetType (РЭ.27)', () => {
  it('layflat → hard', () => {
    expect(printTypeToSheetType('layflat')).toBe('hard');
  });
  it('soft → soft', () => {
    expect(printTypeToSheetType('soft')).toBe('soft');
  });
});

describe('sheetTypeToPrintType (РЭ.27)', () => {
  it('hard → layflat', () => {
    expect(sheetTypeToPrintType('hard')).toBe('layflat');
  });
  it('soft → soft', () => {
    expect(sheetTypeToPrintType('soft')).toBe('soft');
  });
});

describe('roundtrip конверсии PrintType ↔ SheetType', () => {
  it('layflat → hard → layflat', () => {
    expect(sheetTypeToPrintType(printTypeToSheetType('layflat'))).toBe('layflat');
  });
  it('soft → soft → soft', () => {
    expect(sheetTypeToPrintType(printTypeToSheetType('soft'))).toBe('soft');
  });
});
