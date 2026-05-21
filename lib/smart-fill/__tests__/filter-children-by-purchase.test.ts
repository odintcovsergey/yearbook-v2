/**
 * Тесты для filterChildrenByPurchase (РЭ.25.3).
 *
 * Покрывают:
 *  - Все is_purchased=true → все попадают (бэк-совместимость).
 *  - Строгий режим: is_purchased=false → отсечены.
 *  - Мягкий режим: include_non_purchasers=true → все попадают.
 *  - Mixed: 22 true + 3 false, строгий → 22.
 *  - Mixed: 22 true + 3 false, мягкий → 25.
 *  - Бэк-совместимость: undefined/null трактуются как true.
 *  - Пустой массив → пустой массив.
 *  - Стабильность порядка (не пересортирует).
 */

import { describe, it, expect } from 'vitest';
import { filterChildrenByPurchase } from '../filter-by-purchase';

// ─── Фикстура ─────────────────────────────────────────────────────────
type TestChild = {
  id: string;
  full_name: string;
  is_purchased?: boolean | null;
};

function makeChildren(specs: Array<{ id: string; purchased?: boolean | null }>): TestChild[] {
  return specs.map((s) => ({
    id: s.id,
    full_name: `Ученик ${s.id}`,
    ...(s.purchased !== undefined ? { is_purchased: s.purchased } : {}),
  }));
}

// ─── Тесты ────────────────────────────────────────────────────────────

describe('filterChildrenByPurchase (РЭ.25)', () => {
  it('все is_purchased=true → все попадают (бэк-совместимость)', () => {
    const children = makeChildren([
      { id: '1', purchased: true },
      { id: '2', purchased: true },
      { id: '3', purchased: true },
    ]);
    const result = filterChildrenByPurchase(children, false);
    expect(result).toHaveLength(3);
    expect(result.map((c) => c.id)).toEqual(['1', '2', '3']);
  });

  it('строгий режим: is_purchased=false → отсечены', () => {
    const children = makeChildren([
      { id: '1', purchased: false },
      { id: '2', purchased: false },
    ]);
    const result = filterChildrenByPurchase(children, false);
    expect(result).toHaveLength(0);
  });

  it('мягкий режим: include_non_purchasers=true → все попадают независимо от is_purchased', () => {
    const children = makeChildren([
      { id: '1', purchased: true },
      { id: '2', purchased: false },
      { id: '3', purchased: false },
    ]);
    const result = filterChildrenByPurchase(children, true);
    expect(result).toHaveLength(3);
    expect(result.map((c) => c.id)).toEqual(['1', '2', '3']);
  });

  it('mixed 22+3, строгий → 22 заказчика', () => {
    // 22 заказчика + 3 не-заказчика
    const specs: Array<{ id: string; purchased?: boolean | null }> = [];
    for (let i = 1; i <= 22; i++) specs.push({ id: `p${i}`, purchased: true });
    for (let i = 1; i <= 3; i++) specs.push({ id: `n${i}`, purchased: false });
    const children = makeChildren(specs);

    const result = filterChildrenByPurchase(children, false);
    expect(result).toHaveLength(22);
    expect(result.every((c) => c.id.startsWith('p'))).toBe(true);
    expect(result.find((c) => c.id.startsWith('n'))).toBeUndefined();
  });

  it('mixed 22+3, мягкий → все 25 учеников', () => {
    const specs: Array<{ id: string; purchased?: boolean | null }> = [];
    for (let i = 1; i <= 22; i++) specs.push({ id: `p${i}`, purchased: true });
    for (let i = 1; i <= 3; i++) specs.push({ id: `n${i}`, purchased: false });
    const children = makeChildren(specs);

    const result = filterChildrenByPurchase(children, true);
    expect(result).toHaveLength(25);
  });

  it('бэк-совместимость: undefined → попадают (как true)', () => {
    const children = makeChildren([
      { id: '1' }, // is_purchased undefined
      { id: '2' }, // is_purchased undefined
    ]);
    // Строгий режим, но поля нет → дети не отсекаются
    const result = filterChildrenByPurchase(children, false);
    expect(result).toHaveLength(2);
  });

  it('бэк-совместимость: null → попадают (как true)', () => {
    const children = makeChildren([
      { id: '1', purchased: null },
      { id: '2', purchased: null },
    ]);
    const result = filterChildrenByPurchase(children, false);
    expect(result).toHaveLength(2);
  });

  it('пустой массив → пустой массив (оба режима)', () => {
    expect(filterChildrenByPurchase([] as TestChild[], false)).toEqual([]);
    expect(filterChildrenByPurchase([] as TestChild[], true)).toEqual([]);
  });

  it('стабильность порядка: фильтр не пересортирует', () => {
    const children = makeChildren([
      { id: 'a', purchased: true },
      { id: 'b', purchased: false },
      { id: 'c', purchased: true },
      { id: 'd', purchased: false },
      { id: 'e', purchased: true },
    ]);
    const result = filterChildrenByPurchase(children, false);
    expect(result.map((c) => c.id)).toEqual(['a', 'c', 'e']);
  });

  it('mixed undefined + явные false: только явные false отсекаются', () => {
    // Сценарий: некоторые дети до миграции (undefined), некоторые
    // после (true/false). Фильтр должен отсечь только явный false.
    const children = makeChildren([
      { id: 'old1' }, // undefined → попадает
      { id: 'new1', purchased: true }, // явно true → попадает
      { id: 'new2', purchased: false }, // явно false → отсекается
      { id: 'old2' }, // undefined → попадает
    ]);
    const result = filterChildrenByPurchase(children, false);
    expect(result.map((c) => c.id)).toEqual(['old1', 'new1', 'old2']);
  });

  it('идемпотентность: повторный вызов не меняет результат', () => {
    const children = makeChildren([
      { id: '1', purchased: true },
      { id: '2', purchased: false },
      { id: '3', purchased: true },
    ]);
    const r1 = filterChildrenByPurchase(children, false);
    const r2 = filterChildrenByPurchase(r1, false);
    expect(r2).toEqual(r1);
  });

  it('обобщённый тип: работает с произвольным набором полей кроме is_purchased', () => {
    type Rich = { id: string; class: string; quote: string; is_purchased?: boolean };
    const children: Rich[] = [
      { id: '1', class: '11А', quote: 'hello', is_purchased: true },
      { id: '2', class: '11А', quote: 'world', is_purchased: false },
    ];
    const result = filterChildrenByPurchase(children, false);
    expect(result).toHaveLength(1);
    // Тип сохранён — TypeScript не жалуется
    expect(result[0].quote).toBe('hello');
    expect(result[0].class).toBe('11А');
  });
});
