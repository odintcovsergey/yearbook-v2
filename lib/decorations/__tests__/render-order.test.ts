/**
 * Этап 4 ТЗ привязанного декора (docs/tz-attached-decor.md, Часть 1, рендер).
 *
 * Проверяет z-порядок: __under перед базой, __over после; базы сохраняют
 * исходный порядок; orphan-декор не теряется.
 */

import { describe, it, expect } from 'vitest';
import { orderPlaceholdersForRender } from '../render-order';

type P = { label: string; type: string; attached_to?: string; layer?: 'under' | 'over' | 'foreground' };

const labels = (arr: P[]) => arr.map((p) => p.label);

describe('orderPlaceholdersForRender (Этап 4)', () => {
  it('__under перед базой, __over после', () => {
    const phs: P[] = [
      { label: 'teacherphoto_1__over', type: 'decoration', attached_to: 'teacherphoto_1', layer: 'over' },
      { label: 'teacherphoto_1', type: 'photo' },
      { label: 'teacherphoto_1__under', type: 'decoration', attached_to: 'teacherphoto_1', layer: 'under' },
    ];
    expect(labels(orderPlaceholdersForRender(phs))).toEqual([
      'teacherphoto_1__under',
      'teacherphoto_1',
      'teacherphoto_1__over',
    ]);
  });

  it('несколько слотов сохраняют исходный порядок баз', () => {
    const phs: P[] = [
      { label: 'teacherphoto_1', type: 'photo' },
      { label: 'teachername_1', type: 'text' },
      { label: 'teachername_1__under', type: 'decoration', attached_to: 'teachername_1', layer: 'under' },
      { label: 'teacherphoto_2', type: 'photo' },
    ];
    // teachername_1__under встаёт ПЕРЕД teachername_1, базы — в исходном порядке
    expect(labels(orderPlaceholdersForRender(phs))).toEqual([
      'teacherphoto_1',
      'teachername_1__under',
      'teachername_1',
      'teacherphoto_2',
    ]);
  });

  it('orphan-декор (базы нет в списке) дорисовывается в конце, не теряется', () => {
    const phs: P[] = [
      { label: 'teacherphoto_1', type: 'photo' },
      // база teacherphoto_5 отсутствует (например, отфильтрована как hidden)
      { label: 'teacherphoto_5__over', type: 'decoration', attached_to: 'teacherphoto_5', layer: 'over' },
    ];
    const out = labels(orderPlaceholdersForRender(phs));
    expect(out).toContain('teacherphoto_5__over');
    expect(out[0]).toBe('teacherphoto_1');
  });

  it('без декора — порядок не меняется', () => {
    const phs: P[] = [
      { label: 'a', type: 'photo' },
      { label: 'b', type: 'text' },
      { label: 'c', type: 'photo' },
    ];
    expect(labels(orderPlaceholdersForRender(phs))).toEqual(['a', 'b', 'c']);
  });

  it('несколько декоров одного слоя одной базы — стабильный порядок', () => {
    const phs: P[] = [
      { label: 'p', type: 'photo' },
      { label: 'p__over_a', type: 'decoration', attached_to: 'p', layer: 'over' },
      { label: 'p__over_b', type: 'decoration', attached_to: 'p', layer: 'over' },
    ];
    expect(labels(orderPlaceholdersForRender(phs))).toEqual(['p', 'p__over_a', 'p__over_b']);
  });

  it('foreground (__fg_n) рисуется самым последним — поверх всего (Часть 4)', () => {
    const phs: P[] = [
      { label: '__fg_1', type: 'decoration', attached_to: '', layer: 'foreground' },
      { label: 'teacherphoto_1', type: 'photo' },
      { label: 'teacherphoto_1__over', type: 'decoration', attached_to: 'teacherphoto_1', layer: 'over' },
      { label: '__fg_2', type: 'decoration', attached_to: '', layer: 'foreground' },
    ];
    // foreground в самом конце (после баз и привязанного декора), порядок fg стабилен
    expect(labels(orderPlaceholdersForRender(phs))).toEqual([
      'teacherphoto_1',
      'teacherphoto_1__over',
      '__fg_1',
      '__fg_2',
    ]);
  });
});
