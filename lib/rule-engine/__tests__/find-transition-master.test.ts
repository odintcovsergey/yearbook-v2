import { describe, it, expect } from 'vitest';
import { findComboTailMaster } from '../sections/find-transition-master';
import type { SpreadTemplate } from '@/lib/album-builder/types';

function m(
  name: string,
  role: string | null,
  cap: unknown,
  pt: string,
): SpreadTemplate {
  return {
    id: `id-${name}`, name, type: 'common', is_spread: false, width_mm: 0, height_mm: 0,
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

// belly-стиль: combo сторонний (page-left база / page-right зеркало).
const TAIL_4 = m('J-Combined-Tail-4', 'student_grid', { students: 4, photos_full: 1 }, 'page-left');
const TAIL_4_R = m('J-Combined-Tail-4-Right', 'student_grid', { students: 4, photos_full: 1 }, 'page-right');
const TAIL_2 = m('J-Combined-Tail-2', 'student_grid', { students: 2, photos_full: 1 }, 'page-left');
// дефект belly: J-J-Combined-Tail-2-Right — role=null/cap=null.
const TAIL_2_R_DEFECT = m('J-J-Combined-Tail-2-Right', null, null, 'page-any');
// сосед по student_grid: грид-с-портретом (page-any, has_portrait) — НЕ combo.
const N_COMBINED = m('N-Combined-Page', 'student_grid', { students: 4, photos_full: 1, has_portrait: true, has_name: true }, 'page-any');
// чистый грид без classphoto — НЕ combo.
const N_GRID = m('N-Grid-Page', 'student_grid', { students: 12, has_portrait: true }, 'page-any');

describe('findComboTailMaster — выбор стороны (главная риск-точка РЭ.22.10)', () => {
  it('left → база (page-left)', () => {
    expect(findComboTailMaster(byName(TAIL_4, TAIL_4_R), 4, 'left')?.name).toBe('J-Combined-Tail-4');
  });
  it('right → -Right (page-right)', () => {
    expect(findComboTailMaster(byName(TAIL_4, TAIL_4_R), 4, 'right')?.name).toBe('J-Combined-Tail-4-Right');
  });
  it('right без page-right → фолбэк на базу page-left (как by-name fallback на base)', () => {
    // дефектный -Right (role=null) исключён → берётся база (page-left).
    expect(findComboTailMaster(byName(TAIL_2, TAIL_2_R_DEFECT), 2, 'right')?.name).toBe('J-Combined-Tail-2');
  });
});

describe('findComboTailMaster — отбор combo от соседей по student_grid', () => {
  it('грид-с-портретом (has_portrait, page-any) НЕ берётся как combo (left)', () => {
    expect(findComboTailMaster(byName(N_COMBINED), 4, 'left')).toBeNull();
  });
  it('грид-с-портретом НЕ берётся даже когда ищем page-any фолбэком', () => {
    // page-any combo допустим (симметричный), но has_portrait исключает N-Combined-Page.
    expect(findComboTailMaster(byName(N_COMBINED), 4, 'right')).toBeNull();
  });
  it('чистый грид (photos_full=0) НЕ берётся (нет classphoto)', () => {
    expect(findComboTailMaster(byName(N_GRID), 12, 'left')).toBeNull();
  });
  it('симметричный combo page-any (без has_portrait) берётся фолбэком для обеих сторон', () => {
    const sym = m('J-Combined-Tail-4', 'student_grid', { students: 4, photos_full: 1 }, 'page-any');
    expect(findComboTailMaster(byName(sym), 4, 'left')?.name).toBe('J-Combined-Tail-4');
    expect(findComboTailMaster(byName(sym), 4, 'right')?.name).toBe('J-Combined-Tail-4');
  });
});

describe('findComboTailMaster — ёмкость и пустота', () => {
  it('capacity mismatch → null', () => {
    expect(findComboTailMaster(byName(TAIL_4, TAIL_4_R), 3, 'left')).toBeNull();
  });
  it('combo нужной ёмкости отсутствует → null (akvarel: combos нет вовсе)', () => {
    expect(findComboTailMaster(byName(N_COMBINED, N_GRID), 4, 'left')).toBeNull();
  });
  it('дефект role=null исключается', () => {
    expect(findComboTailMaster(byName(TAIL_2_R_DEFECT), 2, 'right')).toBeNull();
  });
});
