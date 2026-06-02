import { describe, it, expect } from 'vitest';
import {
  countAlbumSheets,
  computeAlbumSpineWidthMm,
  resolveAlbumSpineWidthMm,
} from '../album-spine';
import type { PrintSpec } from '../types';
import type { SpreadInstance, SpreadTemplate } from '../../album-builder/types';

// Параметрический пресет-заглушка (реальные числа — позже от типографии).
const SPEC: PrintSpec = {
  spine_base_offset_mm: 5,
  bleed_mm: 3,
  cover_overhang_mm: 3,
  cover_fold_mm: 15,
  sheet_types: [
    { id: 'plain', label: 'Без прослойки', thickness_mm: 0.5 },
    { id: 'spacer_07', label: 'Прослойка 0.7 мм', thickness_mm: 1.2 },
  ],
  default_sheet_type_id: 'plain',
};

function makeTemplate(id: string, isSpread = false): SpreadTemplate {
  return {
    id,
    name: id,
    type: 'common',
    is_spread: isSpread,
    width_mm: isSpread ? 400 : 200,
    height_mm: 280,
    placeholders: [],
    rules: null,
    sort_order: 0,
    applies_to_configs: [],
    default_for_configs: [],
    page_role: null,
    slot_capacity: null,
    is_fallback: false,
    mirror_for_soft: false,
    audit_notes: null,
  };
}

function makePage(template_id: string, idx: number): SpreadInstance {
  return { spread_index: idx, template_id, template_name: template_id, data: {} };
}

const tplPage = makeTemplate('page', false);
const tplSpread = makeTemplate('spread', true);
const TEMPLATES = new Map<string, SpreadTemplate>([
  ['page', tplPage],
  ['spread', tplSpread],
]);

describe('countAlbumSheets', () => {
  it('две обычные страницы = один лист (разворот)', () => {
    const spreads = [makePage('page', 0), makePage('page', 1)];
    expect(countAlbumSheets(spreads, TEMPLATES)).toBe(1);
  });

  it('spread-мастер занимает целый разворот = один лист', () => {
    const spreads = [makePage('spread', 0)];
    expect(countAlbumSheets(spreads, TEMPLATES)).toBe(1);
  });

  it('6 обычных страниц = 3 листа', () => {
    const spreads = Array.from({ length: 6 }, (_, i) => makePage('page', i));
    expect(countAlbumSheets(spreads, TEMPLATES)).toBe(3);
  });

  it('нечётное число страниц: последняя висит отдельным разворотом', () => {
    // 5 страниц → развороты [0,1] [2,3] [4] = 3 листа
    const spreads = Array.from({ length: 5 }, (_, i) => makePage('page', i));
    expect(countAlbumSheets(spreads, TEMPLATES)).toBe(3);
  });

  it('смесь обычных и spread-мастеров', () => {
    // page,page = лист1; spread = лист2; page,page = лист3
    const spreads = [
      makePage('page', 0),
      makePage('page', 1),
      makePage('spread', 2),
      makePage('page', 3),
      makePage('page', 4),
    ];
    expect(countAlbumSheets(spreads, TEMPLATES)).toBe(3);
  });
});

describe('computeAlbumSpineWidthMm', () => {
  it('корешок = base + число_листов × толщина', () => {
    // 6 страниц → 3 листа; plain 0.5 → 5 + 3×0.5 = 6.5
    const spreads = Array.from({ length: 6 }, (_, i) => makePage('page', i));
    expect(computeAlbumSpineWidthMm(spreads, TEMPLATES, SPEC, 'plain')).toBe(6.5);
  });

  it('толстая прослойка даёт более широкий корешок', () => {
    const spreads = Array.from({ length: 20 }, (_, i) => makePage('page', i)); // 10 листов
    const plain = computeAlbumSpineWidthMm(spreads, TEMPLATES, SPEC, 'plain'); // 5 + 10×0.5 = 10
    const spacer = computeAlbumSpineWidthMm(spreads, TEMPLATES, SPEC, 'spacer_07'); // 5 + 10×1.2 = 17
    expect(plain).toBe(10);
    expect(spacer).toBe(17);
    expect(spacer).toBeGreaterThan(plain);
  });

  it('без указания листа берёт дефолт пресета', () => {
    const spreads = Array.from({ length: 6 }, (_, i) => makePage('page', i));
    expect(computeAlbumSpineWidthMm(spreads, TEMPLATES, SPEC)).toBe(6.5); // как plain
  });
});

describe('resolveAlbumSpineWidthMm', () => {
  it('null-пресет → null (корешок не посчитать)', () => {
    const spreads = [makePage('page', 0), makePage('page', 1)];
    expect(resolveAlbumSpineWidthMm(spreads, TEMPLATES, null, 'plain')).toBeNull();
  });

  it('с пресетом считает как обычно', () => {
    const spreads = Array.from({ length: 6 }, (_, i) => makePage('page', i));
    expect(resolveAlbumSpineWidthMm(spreads, TEMPLATES, SPEC, 'plain')).toBe(6.5);
  });
});
