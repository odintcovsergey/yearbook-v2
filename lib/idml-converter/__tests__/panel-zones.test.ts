import { describe, it, expect } from 'vitest';
import { computePanelZones } from '../extract-geometry';
import { ptToMm } from '../xml-utils';

// Зоны панелей фотопапки (computePanelZones). Аналог computeCoverZones, но без
// семантики корешка: панели — независимые страницы в ряд (panel_0..panel_{n-1}
// слева направо). Реального IDML фотопапки пока нет — тестируем логику разбора
// напрямую на синтетических x-диапазонах.

describe('computePanelZones', () => {
  it('тримо (3 панели) по порядку x → panel_0 / panel_1 / panel_2', () => {
    // три панели по 600pt подряд
    const ranges = [
      { x_min: 0, x_max: 600 },
      { x_min: 600, x_max: 1200 },
      { x_min: 1200, x_max: 1800 },
    ];
    const r = computePanelZones(ranges)!;
    expect(r).not.toBeNull();
    expect(r.zoneByPageIndex).toEqual(['panel_0', 'panel_1', 'panel_2']);
    expect(r.panel_widths_mm).toHaveLength(3);
    r.panel_widths_mm.forEach((w) => expect(w).toBeCloseTo(ptToMm(600), 5));
  });

  it('сопоставляет панели по координате x, а НЕ по порядку страниц в XML', () => {
    // В XML порядок перемешан: правая, левая, центр.
    const ranges = [
      { x_min: 1200, x_max: 1800 }, // index 0 — самая правая → panel_2
      { x_min: 0, x_max: 600 }, // index 1 — самая левая → panel_0
      { x_min: 600, x_max: 1200 }, // index 2 — центр → panel_1
    ];
    const r = computePanelZones(ranges)!;
    // zoneByPageIndex идёт по ИСХОДНОМУ индексу страницы
    expect(r.zoneByPageIndex).toEqual(['panel_2', 'panel_0', 'panel_1']);
  });

  it('ширины панелей идут слева направо (panel_widths_mm[k] = ширина panel_k)', () => {
    // Разные ширины: левая узкая, центр средний, правая широкая.
    const ranges = [
      { x_min: 0, x_max: 400 }, // panel_0 — 400pt
      { x_min: 400, x_max: 1000 }, // panel_1 — 600pt
      { x_min: 1000, x_max: 1800 }, // panel_2 — 800pt
    ];
    const r = computePanelZones(ranges)!;
    expect(r.panel_widths_mm[0]).toBeCloseTo(ptToMm(400), 5);
    expect(r.panel_widths_mm[1]).toBeCloseTo(ptToMm(600), 5);
    expect(r.panel_widths_mm[2]).toBeCloseTo(ptToMm(800), 5);
  });

  it('двойная папка (2 панели) — архитектура готова заранее', () => {
    const ranges = [
      { x_min: 600, x_max: 1200 }, // index 0 — правая → panel_1
      { x_min: 0, x_max: 600 }, // index 1 — левая → panel_0
    ];
    const r = computePanelZones(ranges)!;
    expect(r).not.toBeNull();
    expect(r.zoneByPageIndex).toEqual(['panel_1', 'panel_0']);
    expect(r.panel_widths_mm).toHaveLength(2);
  });

  it('expectedPanels как страж: тримо ждёт ровно 3 панели', () => {
    const three = [
      { x_min: 0, x_max: 600 },
      { x_min: 600, x_max: 1200 },
      { x_min: 1200, x_max: 1800 },
    ];
    // совпало — разбирает
    expect(computePanelZones(three, 3)).not.toBeNull();
    // прислали 2 вместо ожидаемых 3 — null (кривой макет)
    expect(
      computePanelZones(
        [
          { x_min: 0, x_max: 600 },
          { x_min: 600, x_max: 1200 },
        ],
        3,
      ),
    ).toBeNull();
  });

  it('возвращает null, если панелей меньше 2', () => {
    expect(computePanelZones([{ x_min: 0, x_max: 600 }])).toBeNull();
    expect(computePanelZones([])).toBeNull();
  });
});
