import { describe, it, expect } from 'vitest';
import { layoutCover, type CoverLayoutInput } from '../layout';

type P = { x_mm: number; zone?: 'back' | 'spine' | 'front'; label: string };

const BASE: CoverLayoutInput = {
  backWidthMm: 200,
  frontWidthMm: 200,
  heightMm: 280,
  nominalSpineWidthMm: 10,
  realSpineWidthMm: 20, // корешок стал шире на 10
};

describe('layoutCover', () => {
  it('полная ширина = задняя + реальный корешок + передняя', () => {
    const r = layoutCover(BASE, [] as P[]);
    expect(r.width_mm).toBe(420); // 200 + 20 + 200
    expect(r.height_mm).toBe(280);
    expect(r.spine_left_mm).toBe(200);
    expect(r.spine_right_mm).toBe(220);
  });

  it('задняя зона не сдвигается', () => {
    const r = layoutCover(BASE, [{ x_mm: 50, zone: 'back', label: 'back_logo' }]);
    expect(r.placeholders[0].x_mm).toBe(50);
  });

  it('передняя зона сдвигается на разницу (real − nominal)', () => {
    const r = layoutCover(BASE, [{ x_mm: 215, zone: 'front', label: 'cover_portrait' }]);
    expect(r.placeholders[0].x_mm).toBe(225); // +10
  });

  it('корешок растёт симметрично — контент по центру (+delta/2)', () => {
    const r = layoutCover(BASE, [{ x_mm: 203, zone: 'spine', label: 'spine_text' }]);
    expect(r.placeholders[0].x_mm).toBe(208); // +5
  });

  it('без зоны не сдвигается (трактуем как заднюю)', () => {
    const r = layoutCover(BASE, [{ x_mm: 100, label: 'mystery' }]);
    expect(r.placeholders[0].x_mm).toBe(100);
  });

  it('корешок уже номинала (тонкий альбом) — передняя сдвигается влево', () => {
    const thin: CoverLayoutInput = { ...BASE, nominalSpineWidthMm: 20, realSpineWidthMm: 8 };
    const r = layoutCover(thin, [{ x_mm: 230, zone: 'front', label: 'x' }]);
    expect(r.placeholders[0].x_mm).toBe(218); // -12
    expect(r.width_mm).toBe(408); // 200 + 8 + 200
  });

  it('real === nominal → ничего не двигается, тот же объект', () => {
    const same: CoverLayoutInput = { ...BASE, nominalSpineWidthMm: 10, realSpineWidthMm: 10 };
    const ph: P = { x_mm: 215, zone: 'front', label: 'x' };
    const r = layoutCover(same, [ph]);
    expect(r.placeholders[0]).toBe(ph); // не копировали (dx===0)
    expect(r.placeholders[0].x_mm).toBe(215);
  });

  it('не мутирует исходные плейсхолдеры', () => {
    const ph: P = { x_mm: 215, zone: 'front', label: 'x' };
    layoutCover(BASE, [ph]);
    expect(ph.x_mm).toBe(215);
  });
});
