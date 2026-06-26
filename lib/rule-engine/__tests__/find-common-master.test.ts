import { describe, it, expect } from 'vitest';
import { findCommonMaster, pageTypeFromName } from '../sections/find-common-master';
import type { SpreadTemplate } from '@/lib/album-builder/types';

function m(name: string, role: string | null, cap: unknown, pt: string, isSpread = false): SpreadTemplate {
  return {
    id: `id-${name}`, name, type: 'common', is_spread: isSpread, width_mm: 0, height_mm: 0,
    placeholders: [], rules: null, sort_order: 0, applies_to_configs: [], default_for_configs: [],
    page_role: role as SpreadTemplate['page_role'], slot_capacity: cap as SpreadTemplate['slot_capacity'],
    is_fallback: false, mirror_for_soft: false, audit_notes: null, page_type: pt as SpreadTemplate['page_type'],
  };
}
function byName(...arr: SpreadTemplate[]) {
  const x = new Map<string, SpreadTemplate>();
  for (const a of arr) x.set(a.name, a);
  return x;
}

// akvarel-стиль: page-any quarter; belly-стиль: L/R quarter; дефект: role=null
const J_FULL = m('J-Full', 'common', { photos_full: 1 }, 'page-any');
const J_SPREAD = m('J-Spread', 'common', { photos_full: 1 }, 'spread', true);
const J_HALF = m('J-Half', 'common', { photos_half: 2 }, 'page-any');
const J_QUARTER_ANY = m('J-Quarter', 'common', { photos_quarter: 2 }, 'page-any');
const J_QUARTER_L = m('J-Quarter-Left', 'common', { photos_quarter: 2 }, 'page-left');
const J_QUARTER_R = m('J-Quarter-Right', 'common', { photos_quarter: 2 }, 'page-right');
const J_COLLAGE_5_NULL = m('J-Collage-5', null, null, 'page-any');
const J_COLLAGE_4 = m('J-Collage-4', 'common', { photos_collage: 4 }, 'page-any');

describe('pageTypeFromName', () => {
  it('-Left/-Right/иначе', () => {
    expect(pageTypeFromName('J-Quarter-Left')).toBe('page-left');
    expect(pageTypeFromName('J-Quarter-Right')).toBe('page-right');
    expect(pageTypeFromName('J-Half')).toBe('page-any');
  });
});

describe('findCommonMaster', () => {
  it('full→J-Full, не J-Spread (is_spread исключён)', () => {
    expect(findCommonMaster(byName(J_FULL, J_SPREAD), 'full_class', 1, ['page-any'])?.name).toBe('J-Full');
  });
  it('half page-any', () => {
    expect(findCommonMaster(byName(J_HALF), 'half_class', 2, ['page-any'])?.name).toBe('J-Half');
  });
  it('auto-quarter akvarel: page-any раньше стороны', () => {
    expect(findCommonMaster(byName(J_QUARTER_ANY), 'quarter', 2, ['page-any', 'page-right'])?.name).toBe('J-Quarter');
  });
  it('auto-quarter belly (right): нет page-any → page-right', () => {
    expect(findCommonMaster(byName(J_QUARTER_L, J_QUARTER_R), 'quarter', 2, ['page-any', 'page-right'])?.name).toBe('J-Quarter-Right');
  });
  it('manual-quarter belly (left): только сторона', () => {
    expect(findCommonMaster(byName(J_QUARTER_L, J_QUARTER_R), 'quarter', 2, ['page-left'])?.name).toBe('J-Quarter-Left');
  });
  it('manual-quarter akvarel: page-left нет → null (как by-name skip)', () => {
    expect(findCommonMaster(byName(J_QUARTER_ANY), 'quarter', 2, ['page-left'])).toBeNull();
  });
  it('дефект role=null исключается; падает на валидный тип', () => {
    expect(findCommonMaster(byName(J_COLLAGE_5_NULL), 'collage', 5, ['page-any'])).toBeNull();
    expect(findCommonMaster(byName(J_COLLAGE_5_NULL, J_COLLAGE_4), 'collage', 4, ['page-any'])?.name).toBe('J-Collage-4');
  });
  it('нет типа в наборе → null', () => {
    expect(findCommonMaster(byName(J_HALF), 'collage', 6, ['page-any'])).toBeNull();
  });
});
