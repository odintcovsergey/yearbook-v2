/**
 * Тесты balance.ts (РЭ.10.3).
 *
 * Покрывают applyBalance:
 *   - hide_unfilled добавляет __hidden__<label>='1' для null bindings
 *   - placeholder_centering 7 в 3×3 сетке через balanceRegularGrid
 *   - bindings без null → ничего не происходит
 *   - balance отсутствует → ничего не происходит
 *   - master отсутствует → graceful skip
 *   - placeholder_centering пропускается для filled=0
 */

import { describe, it, expect } from 'vitest';
import { applyBalance } from '../balance';
import type { ProducedPage } from '../apply';
import type { SpreadTemplate, Placeholder } from '@/lib/album-builder/types';

// =============================================================================
// Helpers
// =============================================================================

function photoSlot(label: string, x: number, y: number): Placeholder {
  return {
    label,
    x_mm: x,
    y_mm: y,
    width_mm: 40,
    height_mm: 55,
    type: 'photo',
    fit: 'fill_proportional',
    required: false,
  };
}

function makeMaster(name: string, placeholders: Placeholder[]): SpreadTemplate {
  return {
    id: `m-${name}`,
    name,
    type: 'subjects',
    is_spread: false,
    width_mm: 200,
    height_mm: 280,
    placeholders,
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

function makePage(masterName: string, bindings: Record<string, string | null>, labels: string[]): ProducedPage {
  return {
    side: 'left',
    master_name: masterName,
    master_id: `m-${masterName}`,
    master_selector_params: {},
    bindings,
    master_placeholder_labels: labels,
  };
}

// 3x3 сетка teacherphoto_1..9
function makeTeachers3x3(): SpreadTemplate {
  const ph: Placeholder[] = [];
  for (let i = 1; i <= 9; i++) {
    const col = (i - 1) % 3;
    const row = Math.floor((i - 1) / 3);
    ph.push(photoSlot(`teacherphoto_${i}`, 20 + col * 50, 30 + row * 60));
  }
  return makeMaster('G-Teachers-3x3', ph);
}

// =============================================================================
// Тесты
// =============================================================================

describe('applyBalance — basic guards', () => {
  it('clause=undefined → applied=false', () => {
    const page = makePage('G-Teachers-3x3', {}, []);
    const r = applyBalance(page, makeTeachers3x3(), undefined);
    expect(r.applied).toBe(false);
  });

  it('master=undefined → applied=false', () => {
    const page = makePage('Z-Missing', {}, []);
    const r = applyBalance(page, undefined, { hide_unfilled: true });
    expect(r.applied).toBe(false);
    expect(r.detail).toContain('no master');
  });

  it('master с пустыми placeholders → applied=false', () => {
    const page = makePage('Empty', {}, []);
    const r = applyBalance(page, makeMaster('Empty', []), { hide_unfilled: true });
    expect(r.applied).toBe(false);
  });
});

describe('applyBalance — hide_unfilled', () => {
  it('Заполнено 5 из 9, hide_unfilled=true → 4 __hidden__ ключа', () => {
    const labels = Array.from({ length: 9 }, (_, i) => `teacherphoto_${i + 1}`);
    const bindings: Record<string, string | null> = {};
    for (let i = 1; i <= 5; i++) bindings[`teacherphoto_${i}`] = `s${i}.jpg`;
    for (let i = 6; i <= 9; i++) bindings[`teacherphoto_${i}`] = null;

    const page = makePage('G-Teachers-3x3', bindings, labels);
    const r = applyBalance(page, makeTeachers3x3(), { hide_unfilled: true });
    expect(r.applied).toBe(true);
    expect(page.bindings.__hidden__teacherphoto_6).toBe('1');
    expect(page.bindings.__hidden__teacherphoto_7).toBe('1');
    expect(page.bindings.__hidden__teacherphoto_8).toBe('1');
    expect(page.bindings.__hidden__teacherphoto_9).toBe('1');
    // 1..5 не должны быть скрыты
    expect(page.bindings.__hidden__teacherphoto_1).toBeUndefined();
    expect(page.bindings.__hidden__teacherphoto_5).toBeUndefined();
  });

  it('Все заполнены → ничего не скрывается', () => {
    const labels = Array.from({ length: 9 }, (_, i) => `teacherphoto_${i + 1}`);
    const bindings: Record<string, string | null> = {};
    for (let i = 1; i <= 9; i++) bindings[`teacherphoto_${i}`] = `s${i}.jpg`;
    const page = makePage('G-Teachers-3x3', bindings, labels);
    const r = applyBalance(page, makeTeachers3x3(), { hide_unfilled: true });
    expect(r.applied).toBe(false);
  });
});

describe('applyBalance — placeholder_centering', () => {
  it('7 из 9 в 3×3 сетке: применяется balanceRegularGrid', () => {
    const labels = Array.from({ length: 9 }, (_, i) => `teacherphoto_${i + 1}`);
    const bindings: Record<string, string | null> = {};
    for (let i = 1; i <= 7; i++) bindings[`teacherphoto_${i}`] = `s${i}.jpg`;
    bindings.teacherphoto_8 = null;
    bindings.teacherphoto_9 = null;

    const page = makePage('G-Teachers-3x3', bindings, labels);
    const r = applyBalance(page, makeTeachers3x3(), { placeholder_centering: true });
    expect(r.applied).toBe(true);
    // balanceRegularGrid должен либо скрыть лишние, либо переразместить.
    // Точное поведение зависит от внутренней эвристики — главное что хоть
    // одна служебная метка появилась в bindings.
    const hasHidden = Object.keys(page.bindings).some((k) => k.startsWith('__hidden__'));
    const hasPos = Object.keys(page.bindings).some((k) => k.startsWith('__pos__'));
    expect(hasHidden || hasPos).toBe(true);
  });

  it('filled=0 → centering пропускается (нет смысла центрировать пустоту)', () => {
    const labels = Array.from({ length: 9 }, (_, i) => `teacherphoto_${i + 1}`);
    const bindings: Record<string, string | null> = {};
    for (const l of labels) bindings[l] = null;
    const page = makePage('G-Teachers-3x3', bindings, labels);
    const r = applyBalance(page, makeTeachers3x3(), { placeholder_centering: true });
    // centering не сработал; но hide_unfilled НЕ передан → applied=false
    expect(r.applied).toBe(false);
  });

  it('group не из KNOWN_GROUPS (например myphoto_N) → centering игнорирует', () => {
    const ph: Placeholder[] = [];
    for (let i = 1; i <= 4; i++) ph.push(photoSlot(`myphoto_${i}`, 20 + i * 30, 30));
    const m = makeMaster('Custom', ph);
    const labels = ['myphoto_1', 'myphoto_2', 'myphoto_3', 'myphoto_4'];
    const bindings: Record<string, string | null> = {
      myphoto_1: 'a',
      myphoto_2: 'b',
      myphoto_3: null,
      myphoto_4: null,
    };
    const page = makePage('Custom', bindings, labels);
    const r = applyBalance(page, m, { placeholder_centering: true });
    // myphoto не в KNOWN_GROUPS → centering ничего не делает
    expect(r.applied).toBe(false);
  });
});

describe('applyBalance — комбинация centering + hide_unfilled', () => {
  it('Применяются обе стратегии: centering сначала, потом hide для оставшихся null', () => {
    const labels = Array.from({ length: 9 }, (_, i) => `teacherphoto_${i + 1}`);
    const bindings: Record<string, string | null> = {};
    for (let i = 1; i <= 4; i++) bindings[`teacherphoto_${i}`] = `s${i}.jpg`;
    for (let i = 5; i <= 9; i++) bindings[`teacherphoto_${i}`] = null;

    const page = makePage('G-Teachers-3x3', bindings, labels);
    const r = applyBalance(page, makeTeachers3x3(), {
      placeholder_centering: true,
      hide_unfilled: true,
    });
    expect(r.applied).toBe(true);
    // Хотя бы какие-то placeholder'ы должны быть скрыты (либо centering, либо hide)
    const hiddenCount = Object.keys(page.bindings).filter((k) => k.startsWith('__hidden__')).length;
    expect(hiddenCount).toBeGreaterThan(0);
  });
});
