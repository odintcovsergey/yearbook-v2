/**
 * Тесты для getEndpaperRules.
 *
 * Покрывают:
 *  - layflat — пустой список (правила не применяются)
 *  - soft — два правила (first_left, last_right)
 *  - Лейблы корректные
 */

import { describe, it, expect } from 'vitest';
import { getEndpaperRules } from '../endpaper-rules';

describe('getEndpaperRules (РЭ.27)', () => {
  it('layflat → пустой список', () => {
    expect(getEndpaperRules('layflat')).toEqual([]);
  });

  it('soft → две заглушки first_left + last_right', () => {
    const rules = getEndpaperRules('soft');
    expect(rules).toHaveLength(2);
    expect(rules[0].position).toBe('first_left');
    expect(rules[1].position).toBe('last_right');
  });

  it('soft заглушки имеют лейбл "Форзац"', () => {
    const rules = getEndpaperRules('soft');
    for (const rule of rules) {
      expect(rule.label).toBe('Форзац');
    }
  });

  it('возвращает новый массив каждый вызов (без shared mutable state)', () => {
    const r1 = getEndpaperRules('soft');
    const r2 = getEndpaperRules('soft');
    expect(r1).not.toBe(r2); // разные ссылки
    expect(r1).toEqual(r2); // одинаковое содержимое
  });
});
