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

  it('слоевая модель: __under уходит в самый низ, базы — в исходном порядке', () => {
    const phs: P[] = [
      { label: 'teacherphoto_1', type: 'photo' },
      { label: 'teachername_1', type: 'text' },
      { label: 'teachername_1__under', type: 'decoration', attached_to: 'teachername_1', layer: 'under' },
      { label: 'teacherphoto_2', type: 'photo' },
    ];
    // __under-подложка — в самый низ (под все слоты), базы сохраняют порядок.
    expect(labels(orderPlaceholdersForRender(phs))).toEqual([
      'teachername_1__under',
      'teacherphoto_1',
      'teachername_1',
      'teacherphoto_2',
    ]);
  });

  it('фикс «Аква меч»: __under-подложка цитаты НЕ перекрывает портрет другого слота', () => {
    // Облако-подложка studentquote_1__under и портрет — разные слоты. В списке
    // подложка идёт ПОЗЖЕ портрета, но как __under должна оказаться ПОД ним.
    const phs: P[] = [
      { label: 'studentportrait_1', type: 'photo' },
      { label: 'studentquote_1__under', type: 'decoration', attached_to: 'studentquote_1', layer: 'under' },
      { label: 'studentquote_1', type: 'text' },
    ];
    const out = labels(orderPlaceholdersForRender(phs));
    expect(out).toEqual([
      'studentquote_1__under',
      'studentportrait_1',
      'studentquote_1',
    ]);
    expect(out.indexOf('studentquote_1__under')).toBeLessThan(out.indexOf('studentportrait_1'));
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
