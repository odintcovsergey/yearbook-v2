import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  computeCoverZones,
  computeCoverZonesSinglePage,
} from '../extract-geometry';
import { parseIdml } from '../parse';
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

  it('2 страницы (facing): задняя слева + передняя справа, корешок = зазор', () => {
    // Реальный кейс InDesign: левая [-595..0] задняя, правая [0..595] передняя.
    const ranges = [
      { x_min: 0, x_max: 595 },     // index 0 — правая → front
      { x_min: -595, x_max: 0 },    // index 1 — левая → back
    ];
    const r = computeCoverZones(ranges)!;
    expect(r).not.toBeNull();
    expect(r.zoneByPageIndex).toEqual(['front', 'back']);
    expect(r.zones.back_width_mm).toBeCloseTo(ptToMm(595), 5);
    expect(r.zones.front_width_mm).toBeCloseTo(ptToMm(595), 5);
    expect(r.zones.spine_width_mm).toBe(0); // страницы вплотную → корешок 0
  });

  it('2 страницы с зазором → корешок = ширина зазора', () => {
    const ranges = [
      { x_min: 0, x_max: 200 },
      { x_min: 210, x_max: 410 }, // зазор 10pt
    ];
    const r = computeCoverZones(ranges)!;
    expect(r.zones.spine_width_mm).toBeCloseTo(ptToMm(10), 5);
  });

  it('возвращает null, если страниц не 2 и не 3', () => {
    expect(computeCoverZones([{ x_min: 0, x_max: 600 }])).toBeNull();
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

// Обложка-полотно на ОДНОЙ широкой странице (~434 мм): задняя слева, передняя
// справа, граница между ними по контенту. computeCoverZonesSinglePage — чистая
// функция над краями страницы (мм) и слотами (мм).
describe('computeCoverZonesSinglePage', () => {
  const page = { left_mm: 0, right_mm: 434 };

  it('граница по контенту: правый край back_* и левый край cover_*', () => {
    const slots = [
      { label: 'back_logo', x_mm: 20, width_mm: 60 }, // back, правый край 80
      { label: 'back_qr', x_mm: 100, width_mm: 40 }, // back, правый край 140
      { label: 'cover_portrait', x_mm: 240, width_mm: 120 }, // front, левый край 240
      { label: 'cover_year', x_mm: 300, width_mm: 80 }, // front
    ];
    const r = computeCoverZonesSinglePage(page, slots);
    // граница = (140 + 240) / 2 = 190
    expect(r.boundary_mm).toBeCloseTo(190, 5);
    expect(r.zones.back_width_mm).toBeCloseTo(190, 5);
    expect(r.zones.front_width_mm).toBeCloseTo(434 - 190, 5);
    expect(r.zones.spine_width_mm).toBe(0);
    // зоны слотов по X-центру
    expect(r.zoneBySlot).toEqual(['back', 'back', 'front', 'front']);
  });

  it('каждый back_* → back, каждый cover_* → front', () => {
    const slots = [
      { label: 'back_contacts', x_mm: 30, width_mm: 100 },
      { label: 'cover_school_name', x_mm: 250, width_mm: 150 },
    ];
    const { zoneBySlot } = computeCoverZonesSinglePage(page, slots);
    expect(zoneBySlot[0]).toBe('back');
    expect(zoneBySlot[1]).toBe('front');
  });

  it('декор переднего плана (__fg) распределяется по X-центру', () => {
    const slots = [
      { label: 'back_logo', x_mm: 20, width_mm: 60 },
      { label: 'cover_portrait', x_mm: 240, width_mm: 120 },
      { label: '__fg_1', x_mm: 10, width_mm: 40 }, // центр 30 → back
      { label: '__fg_2', x_mm: 380, width_mm: 40 }, // центр 400 → front
    ];
    const { zoneBySlot } = computeCoverZonesSinglePage(page, slots);
    expect(zoneBySlot[2]).toBe('back');
    expect(zoneBySlot[3]).toBe('front');
  });

  it('fallback на геометрическую середину, если нет back_/cover_ слотов', () => {
    const slots = [
      { label: 'static_text_1', x_mm: 50, width_mm: 40 }, // центр 70 → back
      { label: 'static_text_2', x_mm: 300, width_mm: 40 }, // центр 320 → front
    ];
    const r = computeCoverZonesSinglePage(page, slots);
    expect(r.boundary_mm).toBeCloseTo(217, 5); // середина 0..434
    expect(r.zoneBySlot).toEqual(['back', 'front']);
  });

  it('fallback на середину, если back_* и cover_* перекрываются по X', () => {
    const slots = [
      { label: 'back_logo', x_mm: 200, width_mm: 100 }, // правый край 300
      { label: 'cover_portrait', x_mm: 150, width_mm: 100 }, // левый край 150 < 300
    ];
    const r = computeCoverZonesSinglePage(page, slots);
    expect(r.boundary_mm).toBeCloseTo(217, 5); // неоднозначно → середина
  });
});

// Интеграционный прогон на реальном cover-IDML с единым полотном. Файл
// присылает Сергей; если его нет в репозитории — тест пропускается (см.
// docs/tz парсера обложек). Имя ищем в корне и в docs/.
describe('единое полотно обложки (реальный IDML)', () => {
  const candidates = [
    join(process.cwd(), 'Мастер Аква меч обложки.idml'),
    join(process.cwd(), 'Мастер_Аква_меч_обложки.idml'),
    join(process.cwd(), 'docs', 'Мастер Аква меч обложки.idml'),
    join(process.cwd(), 'docs', 'templates', 'Мастер Аква меч обложки.idml'),
  ];
  const coverFile = candidates.find((p) => existsSync(p));
  const run = coverFile ? it : it.skip;

  run('3 мастера, зоны распознаны, слоты в правильных зонах, без _left/_right', async () => {
    const buf = readFileSync(coverFile!);
    const parsed = await parseIdml(buf);

    const covers = parsed.spread_templates.filter((t) => t.type === 'cover');
    // 3 мастера (НЕ 6): единое полотно — один мастер, не делится на _Left/_Right.
    expect(covers.length).toBe(3);

    for (const m of covers) {
      // зоны распознаны
      expect(m.cover_zones).not.toBeNull();
      // нет суффиксов _left/_right в метках
      for (const ph of m.placeholders) {
        expect(ph.label).not.toMatch(/_(left|right)$/);
      }
      // back_* в зоне back, cover_* в зоне front
      for (const ph of m.placeholders) {
        if (ph.label.startsWith('back')) expect(ph.zone).toBe('back');
        if (ph.label.startsWith('cover')) expect(ph.zone).toBe('front');
      }
    }

    // нет warning «не распознан»
    const notRecognized = parsed.warnings.filter((w) =>
      /не распознан/.test(w.message),
    );
    expect(notRecognized).toEqual([]);
  });
});
