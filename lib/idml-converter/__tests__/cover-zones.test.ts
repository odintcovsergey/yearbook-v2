import { describe, it, expect } from 'vitest';
import { computeCoverZones } from '../extract-geometry';
import { ptToMm } from '../xml-utils';

// Зоны обложки (Этап 2 ТЗ docs/tz-cover-design.md). computeCoverZones — чистая
// функция над x-диапазонами страниц 3-страничного разворота. Реального
// cover-IDML пока нет, поэтому тестируем логику разбора зон напрямую.

describe('computeCoverZones', () => {
  it('3 страницы по порядку x → back / spine / front по ширинам', () => {
    // back 600pt | spine 40pt | front 600pt, идут слева направо
    const ranges = [
      { x_min: 0, x_max: 600 },
      { x_min: 600, x_max: 640 },
      { x_min: 640, x_max: 1240 },
    ];
    const r = computeCoverZones(ranges)!;
    expect(r).not.toBeNull();
    expect(r.zones.back_width_mm).toBeCloseTo(ptToMm(600), 5);
    expect(r.zones.spine_width_mm).toBeCloseTo(ptToMm(40), 5);
    expect(r.zones.front_width_mm).toBeCloseTo(ptToMm(600), 5);
    // корешок — самая узкая зона
    expect(r.zones.spine_width_mm).toBeLessThan(r.zones.back_width_mm);
    expect(r.zoneByPageIndex).toEqual(['back', 'spine', 'front']);
  });

  it('сопоставляет зоны по координате x, а НЕ по порядку страниц в XML', () => {
    // В XML порядок перемешан: сначала передняя, потом задняя, потом корешок.
    const ranges = [
      { x_min: 640, x_max: 1240 }, // index 0 — самая правая → front
      { x_min: 0, x_max: 600 }, // index 1 — самая левая → back
      { x_min: 600, x_max: 640 }, // index 2 — середина → spine
    ];
    const r = computeCoverZones(ranges)!;
    // zoneByPageIndex идёт по ИСХОДНОМУ индексу страницы
    expect(r.zoneByPageIndex).toEqual(['front', 'back', 'spine']);
    // ширины при этом верные (back и front широкие, корешок узкий)
    expect(r.zones.back_width_mm).toBeCloseTo(ptToMm(600), 5);
    expect(r.zones.front_width_mm).toBeCloseTo(ptToMm(600), 5);
    expect(r.zones.spine_width_mm).toBeCloseTo(ptToMm(40), 5);
  });

  it('возвращает null, если страниц не ровно 3', () => {
    expect(computeCoverZones([{ x_min: 0, x_max: 600 }])).toBeNull();
    expect(
      computeCoverZones([
        { x_min: 0, x_max: 600 },
        { x_min: 600, x_max: 1200 },
      ]),
    ).toBeNull();
    expect(
      computeCoverZones([
        { x_min: 0, x_max: 1 },
        { x_min: 1, x_max: 2 },
        { x_min: 2, x_max: 3 },
        { x_min: 3, x_max: 4 },
      ]),
    ).toBeNull();
  });

  it('асимметричные задняя/передняя зоны (выступ) сохраняются раздельно', () => {
    const ranges = [
      { x_min: 0, x_max: 580 }, // задняя чуть уже
      { x_min: 580, x_max: 620 },
      { x_min: 620, x_max: 1240 }, // передняя чуть шире
    ];
    const r = computeCoverZones(ranges)!;
    expect(r.zones.back_width_mm).toBeCloseTo(ptToMm(580), 5);
    expect(r.zones.front_width_mm).toBeCloseTo(ptToMm(620), 5);
    expect(r.zones.back_width_mm).toBeLessThan(r.zones.front_width_mm);
  });
});
