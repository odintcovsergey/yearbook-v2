/**
 * Тесты для slot-chains (РЭ.21.8.2).
 *
 * Покрывают:
 *  - Happy-path каждой цепочки (выбор первого подходящего шага)
 *  - Fallback на следующий шаг при нехватке фото категории
 *  - `null` когда ни один шаг не подходит
 *  - `-Right` вариант на правой стороне (FULL, flex_A/B/C финальные)
 *  - flex_C: финальный FULL → `-Right` даже на position='left'
 *  - Trace формат: `'{slot} → {master} ({N} {category})'`
 *  - Диспетчер tryFillSlot делегирует по slotType
 */

import { describe, it, expect } from 'vitest';
import {
  tryFillSlot,
  tryFillH,
  tryFillQ,
  tryFillFull,
  tryFillFlexA,
  tryFillFlexB,
  tryFillFlexC,
} from '../slot-chains';
import type { CommonPhotoCounts } from '../slot-chains';

const empty: CommonPhotoCounts = {
  full_class: 0,
  half_class: 0,
  quarter: 0,
  sixth: 0,
};

const all: CommonPhotoCounts = {
  full_class: 5,
  half_class: 5,
  quarter: 5,
  sixth: 12,
};

// ─── H ──────────────────────────────────────────────────────────────────────

describe('slot-chains: H (полкласса)', () => {
  it('happy: 2 half_class → J-Half', () => {
    const r = tryFillH({ ...empty, half_class: 2 }, 'left');
    expect(r).not.toBeNull();
    expect(r!.master_name).toBe('J-Half');
    expect(r!.consumes).toEqual({ half_class: 2 });
    expect(r!.trace).toBe('H → J-Half (2 half_class)');
  });

  it('not enough half (1): null', () => {
    expect(tryFillH({ ...empty, half_class: 1 }, 'left')).toBeNull();
  });

  it('right position тоже даёт J-Half (нет -Right варианта)', () => {
    const r = tryFillH({ ...empty, half_class: 2 }, 'right');
    expect(r!.master_name).toBe('J-Half');
  });

  it('пусто: null', () => {
    expect(tryFillH(empty, 'left')).toBeNull();
  });
});

// ─── Q ──────────────────────────────────────────────────────────────────────

describe('slot-chains: Q (четверть)', () => {
  it('happy: 2 quarter → J-Quarter', () => {
    const r = tryFillQ({ ...empty, quarter: 2 }, 'left');
    expect(r!.master_name).toBe('J-Quarter');
    expect(r!.consumes).toEqual({ quarter: 2 });
    expect(r!.trace).toBe('Q → J-Quarter (2 quarter)');
  });

  it('not enough quarter: null', () => {
    expect(tryFillQ({ ...empty, quarter: 1 }, 'left')).toBeNull();
  });
});

// ─── FULL ───────────────────────────────────────────────────────────────────

describe('slot-chains: FULL (общее фото)', () => {
  it('left: J-ClassPhoto', () => {
    const r = tryFillFull({ ...empty, full_class: 1 }, 'left');
    expect(r!.master_name).toBe('J-ClassPhoto');
    expect(r!.consumes).toEqual({ full_class: 1 });
    expect(r!.trace).toBe('FULL → J-ClassPhoto (1 full_class)');
  });

  it('right: J-ClassPhoto-Right (зеркальный)', () => {
    const r = tryFillFull({ ...empty, full_class: 1 }, 'right');
    expect(r!.master_name).toBe('J-ClassPhoto-Right');
    expect(r!.trace).toBe('FULL → J-ClassPhoto-Right (1 full_class)');
  });

  it('no full_class: null', () => {
    expect(tryFillFull(empty, 'left')).toBeNull();
  });
});

// ─── flex_A ─────────────────────────────────────────────────────────────────

describe('slot-chains: flex_A (крупный приоритет)', () => {
  it('priority 1: J-Collage когда sixth >= 6', () => {
    const r = tryFillFlexA(
      { full_class: 1, half_class: 2, quarter: 0, sixth: 6 },
      'left',
    );
    expect(r!.master_name).toBe('J-Collage');
    expect(r!.consumes).toEqual({ sixth: 6 });
    expect(r!.trace).toBe('flex_A → J-Collage (6 sixth)');
  });

  it('priority 2: J-Half когда sixth < 6 но half_class >= 2', () => {
    const r = tryFillFlexA(
      { full_class: 1, half_class: 2, quarter: 0, sixth: 5 },
      'left',
    );
    expect(r!.master_name).toBe('J-Half');
  });

  it('priority 3: J-ClassPhoto когда нет sixth/half но есть full', () => {
    const r = tryFillFlexA(
      { full_class: 1, half_class: 1, quarter: 0, sixth: 5 },
      'left',
    );
    expect(r!.master_name).toBe('J-ClassPhoto');
  });

  it('priority 3 на right: J-ClassPhoto-Right', () => {
    const r = tryFillFlexA(
      { full_class: 1, half_class: 1, quarter: 0, sixth: 5 },
      'right',
    );
    expect(r!.master_name).toBe('J-ClassPhoto-Right');
  });

  it('пусто: null', () => {
    expect(tryFillFlexA(empty, 'left')).toBeNull();
  });

  it('quarter игнорируется в flex_A (шага нет)', () => {
    const r = tryFillFlexA(
      { full_class: 0, half_class: 0, quarter: 10, sixth: 0 },
      'left',
    );
    expect(r).toBeNull();
  });
});

// ─── flex_B ─────────────────────────────────────────────────────────────────

describe('slot-chains: flex_B (всё попробовать)', () => {
  it('priority 1: J-Quarter когда quarter >= 2', () => {
    const r = tryFillFlexB(all, 'left');
    expect(r!.master_name).toBe('J-Quarter');
    expect(r!.consumes).toEqual({ quarter: 2 });
  });

  it('priority 2: J-Collage когда quarter < 2 но sixth >= 6', () => {
    const r = tryFillFlexB(
      { full_class: 1, half_class: 2, quarter: 1, sixth: 6 },
      'left',
    );
    expect(r!.master_name).toBe('J-Collage');
  });

  it('priority 3: J-Half когда quarter/sixth малы но half_class >= 2', () => {
    const r = tryFillFlexB(
      { full_class: 1, half_class: 2, quarter: 0, sixth: 5 },
      'left',
    );
    expect(r!.master_name).toBe('J-Half');
  });

  it('priority 4: J-ClassPhoto в конце цепочки', () => {
    const r = tryFillFlexB(
      { full_class: 1, half_class: 1, quarter: 1, sixth: 5 },
      'left',
    );
    expect(r!.master_name).toBe('J-ClassPhoto');
  });

  it('priority 4 на right: J-ClassPhoto-Right', () => {
    const r = tryFillFlexB(
      { full_class: 1, half_class: 1, quarter: 1, sixth: 5 },
      'right',
    );
    expect(r!.master_name).toBe('J-ClassPhoto-Right');
  });

  it('пусто: null', () => {
    expect(tryFillFlexB(empty, 'left')).toBeNull();
  });
});

// ─── flex_C ─────────────────────────────────────────────────────────────────

describe('slot-chains: flex_C (правая нечётная)', () => {
  it('priority 1: J-Half — half перед collage (в отличие от flex_A)', () => {
    const r = tryFillFlexC(
      { full_class: 1, half_class: 2, quarter: 0, sixth: 6 },
      'right',
    );
    expect(r!.master_name).toBe('J-Half');
    expect(r!.trace).toBe('flex_C → J-Half (2 half_class)');
  });

  it('priority 2: J-Collage когда half < 2 но sixth >= 6', () => {
    const r = tryFillFlexC(
      { full_class: 1, half_class: 1, quarter: 0, sixth: 6 },
      'right',
    );
    expect(r!.master_name).toBe('J-Collage');
  });

  it('priority 3: J-ClassPhoto-Right на position=right', () => {
    const r = tryFillFlexC(
      { full_class: 1, half_class: 1, quarter: 0, sixth: 5 },
      'right',
    );
    expect(r!.master_name).toBe('J-ClassPhoto-Right');
  });

  it('priority 3: J-ClassPhoto-Right ДАЖЕ на position=left (слот всегда правый)', () => {
    const r = tryFillFlexC(
      { full_class: 1, half_class: 1, quarter: 0, sixth: 5 },
      'left',
    );
    expect(r!.master_name).toBe('J-ClassPhoto-Right');
  });

  it('пусто: null', () => {
    expect(tryFillFlexC(empty, 'right')).toBeNull();
  });
});

// ─── tryFillSlot диспетчер ──────────────────────────────────────────────────

describe('slot-chains: tryFillSlot диспетчер', () => {
  it('делегирует на все 6 цепочек по slotType', () => {
    expect(
      tryFillSlot('H', { ...empty, half_class: 2 }, 'left')!.master_name,
    ).toBe('J-Half');
    expect(
      tryFillSlot('Q', { ...empty, quarter: 2 }, 'left')!.master_name,
    ).toBe('J-Quarter');
    expect(
      tryFillSlot('FULL', { ...empty, full_class: 1 }, 'right')!.master_name,
    ).toBe('J-ClassPhoto-Right');
    expect(
      tryFillSlot('flex_A', { ...empty, sixth: 6 }, 'left')!.master_name,
    ).toBe('J-Collage');
    expect(
      tryFillSlot('flex_B', { ...empty, quarter: 2 }, 'left')!.master_name,
    ).toBe('J-Quarter');
    expect(
      tryFillSlot('flex_C', { ...empty, half_class: 2 }, 'right')!.master_name,
    ).toBe('J-Half');
  });

  it('null когда фото нет — для любого slotType', () => {
    expect(tryFillSlot('H', empty, 'left')).toBeNull();
    expect(tryFillSlot('Q', empty, 'left')).toBeNull();
    expect(tryFillSlot('FULL', empty, 'left')).toBeNull();
    expect(tryFillSlot('flex_A', empty, 'left')).toBeNull();
    expect(tryFillSlot('flex_B', empty, 'left')).toBeNull();
    expect(tryFillSlot('flex_C', empty, 'right')).toBeNull();
  });
});
