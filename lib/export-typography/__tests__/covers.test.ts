/**
 * Тесты сборки файлов-обложек: имена 000-00/00X-00, дедупликация общей/дизайн
 * обложки, нумерация личных по childNumber, пропуск без мастера.
 */

import { describe, it, expect } from 'vitest';
import { buildCoverRenderUnits, type CoverMasterGeometry } from '../covers';
import type { CoverInstance } from '../../cover/assemble';

function master(id: string): CoverMasterGeometry {
  return {
    id,
    placeholders: [],
    back_width_mm: 100,
    front_width_mm: 100,
    height_mm: 100,
    nominal_spine_width_mm: 10,
    background_url: null,
  };
}

function inst(
  cover_type: CoverInstance['cover_type'],
  child_id: string | null,
  cover_id: string | null,
): CoverInstance {
  return { child_id, cover_id, cover_name: cover_id, cover_type, data: {} };
}

const masters = new Map<string, CoverMasterGeometry>([['m1', master('m1')]]);
const base = {
  masters,
  editsByType: {},
  editsByChild: {},
  spineWidthMm: 12 as number | null,
  family: 'vertical_rect' as const,
  targetFormat: null,
};

describe('buildCoverRenderUnits', () => {
  it('портретные → 00X-00 по номеру ученика; общая → 000-00 (дедуп)', () => {
    const childNumber = new Map([
      ['c1', 1],
      ['c2', 2],
    ]);
    const { units } = buildCoverRenderUnits({
      ...base,
      covers: [
        inst('common_photo', null, 'm1'),
        inst('portrait_photo', 'c1', 'm1'),
        inst('portrait_photo', 'c2', 'm1'),
        inst('common_photo', null, 'm1'), // дубль общей — должен отсеяться
      ],
      childNumber,
    });
    expect(units.map((u) => u.file_name)).toEqual(['000-00', '001-00', '002-00']);
    // Размеры полотна = задняя + корешок(12) + передняя = 100+12+100.
    expect(units[0].width_mm).toBe(212);
  });

  it('design_only тоже общая (000-00) и дедуплицируется с common', () => {
    const { units } = buildCoverRenderUnits({
      ...base,
      covers: [inst('design_only', null, 'm1'), inst('common_photo', null, 'm1')],
      childNumber: new Map(),
    });
    expect(units.map((u) => u.file_name)).toEqual(['000-00']);
  });

  it('обложка без мастера или без номера ученика пропускается', () => {
    const { units, skipped } = buildCoverRenderUnits({
      ...base,
      covers: [
        inst('portrait_photo', 'c1', null), // нет мастера
        inst('portrait_photo', 'cX', 'm1'), // нет номера ученика
      ],
      childNumber: new Map([['c1', 1]]),
    });
    expect(units).toEqual([]);
    expect(skipped.length).toBe(2);
  });

  it('номер личной обложки берётся из childNumber (согласован с книгами)', () => {
    const { units } = buildCoverRenderUnits({
      ...base,
      covers: [inst('portrait_photo', 'c7', 'm1')],
      childNumber: new Map([['c7', 7]]),
    });
    expect(units.map((u) => u.file_name)).toEqual(['007-00']);
  });
});
