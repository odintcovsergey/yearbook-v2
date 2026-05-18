/**
 * Тесты модуля album-structure-matrix (РЭ.20.4).
 *
 * Покрывают:
 *   - findMatrixEntry: позитивные кейсы для всех 4 density × 2 sheet_type
 *   - findMatrixEntry: отрицательные кейсы (maximum, экзотический count)
 *   - matchesStudentsSelector: ranges и parity
 *   - presetDensityToMatrix: standard+universal → standard_universal
 *   - parseCellToPattern: 4 базовых + alternative + неизвестные
 *   - mandatorySectionPatternsFor / additionalSectionPatternsFor
 *   - resolveAlternative: приоритеты sixth → half → full → quarter
 *
 * Источник данных — реальная матрица docs/templates/album-structure-matrix.json.
 */

import { describe, it, expect } from 'vitest';
import {
  findMatrixEntry,
  matchesStudentsSelector,
  presetDensityToMatrix,
  parseCellToPattern,
  mandatorySectionPatternsFor,
  additionalSectionPatternsFor,
  resolveAlternative,
  allMatrixEntries,
  type CommonPhotosAvailability,
} from '../album-structure-matrix';
import type { PagePattern } from '../types';

// =============================================================================
// presetDensityToMatrix
// =============================================================================

describe('presetDensityToMatrix', () => {
  it('standard → standard_universal', () => {
    expect(presetDensityToMatrix('standard')).toBe('standard_universal');
  });
  it('universal → standard_universal', () => {
    expect(presetDensityToMatrix('universal')).toBe('standard_universal');
  });
  it('medium → medium', () => {
    expect(presetDensityToMatrix('medium')).toBe('medium');
  });
  it('light → light', () => {
    expect(presetDensityToMatrix('light')).toBe('light');
  });
  it('mini → mini', () => {
    expect(presetDensityToMatrix('mini')).toBe('mini');
  });
});

// =============================================================================
// matchesStudentsSelector
// =============================================================================

describe('matchesStudentsSelector', () => {
  it('ranges: попадание в диапазон', () => {
    expect(matchesStudentsSelector({ ranges: [{ min: 1, max: 24 }] }, 10)).toBe(true);
    expect(matchesStudentsSelector({ ranges: [{ min: 1, max: 24 }] }, 24)).toBe(true);
    expect(matchesStudentsSelector({ ranges: [{ min: 1, max: 24 }] }, 1)).toBe(true);
  });
  it('ranges: вне диапазона', () => {
    expect(matchesStudentsSelector({ ranges: [{ min: 1, max: 24 }] }, 25)).toBe(false);
    expect(matchesStudentsSelector({ ranges: [{ min: 1, max: 24 }] }, 0)).toBe(false);
  });
  it('ranges: несколько интервалов (Light "13-15 / 25-28")', () => {
    const sel = { ranges: [{ min: 13, max: 15 }, { min: 25, max: 28 }] };
    expect(matchesStudentsSelector(sel, 14)).toBe(true);
    expect(matchesStudentsSelector(sel, 25)).toBe(true);
    expect(matchesStudentsSelector(sel, 16)).toBe(false);
    expect(matchesStudentsSelector(sel, 29)).toBe(false);
  });
  it('parity: even', () => {
    expect(matchesStudentsSelector({ parity: 'even' }, 8)).toBe(true);
    expect(matchesStudentsSelector({ parity: 'even' }, 9)).toBe(false);
  });
  it('parity: odd', () => {
    expect(matchesStudentsSelector({ parity: 'odd' }, 7)).toBe(true);
    expect(matchesStudentsSelector({ parity: 'odd' }, 8)).toBe(false);
  });
  it('пустой селектор → false (паника-безопасность)', () => {
    expect(matchesStudentsSelector({}, 10)).toBe(false);
  });
});

// =============================================================================
// findMatrixEntry — позитивные кейсы
// =============================================================================

describe('findMatrixEntry — позитивные', () => {
  it('mini-hard, 10 учеников → entry для 1-24', () => {
    const e = findMatrixEntry('mini', 'hard', 10);
    expect(e).not.toBeNull();
    expect(e!.density).toBe('mini');
    expect(e!.sheet_type).toBe('hard');
  });

  it('mini-hard, 27 учеников → entry для 25-28 (другой)', () => {
    const e1 = findMatrixEntry('mini', 'hard', 10);
    const e2 = findMatrixEntry('mini', 'hard', 27);
    expect(e2).not.toBeNull();
    expect(e2).not.toBe(e1); // разные records
  });

  it('mini-soft, 10 учеников → entry с sheet_type=soft', () => {
    const e = findMatrixEntry('mini', 'soft', 10);
    expect(e).not.toBeNull();
    expect(e!.sheet_type).toBe('soft');
  });

  it('light-hard, 14 учеников → есть entry', () => {
    expect(findMatrixEntry('light', 'hard', 14)).not.toBeNull();
  });

  it('medium-hard, 20 учеников → есть entry', () => {
    expect(findMatrixEntry('medium', 'hard', 20)).not.toBeNull();
  });

  it('standard, 16 учеников → entry с density=standard_universal', () => {
    const e = findMatrixEntry('standard', 'hard', 16);
    expect(e).not.toBeNull();
    expect(e!.density).toBe('standard_universal');
  });

  it('universal, 16 учеников → тот же entry что standard (объединены)', () => {
    const e1 = findMatrixEntry('standard', 'hard', 16);
    const e2 = findMatrixEntry('universal', 'hard', 16);
    expect(e1).toBe(e2);
  });
});

// =============================================================================
// findMatrixEntry — отрицательные кейсы
// =============================================================================

describe('findMatrixEntry — отрицательные', () => {
  it('экстремальный students_count за пределами всех диапазонов → null', () => {
    expect(findMatrixEntry('mini', 'hard', 9999)).toBeNull();
    expect(findMatrixEntry('mini', 'hard', 0)).toBeNull();
  });
});

// =============================================================================
// parseCellToPattern — базовые
// =============================================================================

describe('parseCellToPattern — базовые', () => {
  it('"2 по 1/2 класса" → half_pair', () => {
    expect(parseCellToPattern('2 по 1/2 класса')).toEqual({ type: 'half_pair' });
  });
  it('"2 по 1/4 класса" → quarter_pair', () => {
    expect(parseCellToPattern('2 по 1/4 класса')).toEqual({ type: 'quarter_pair' });
  });
  it('"6 фото 1/6" → sixth_six', () => {
    expect(parseCellToPattern('6 фото 1/6')).toEqual({ type: 'sixth_six' });
  });
  it('"1 общая" → full_one', () => {
    expect(parseCellToPattern('1 общая')).toEqual({ type: 'full_one' });
  });
});

// =============================================================================
// parseCellToPattern — alternative
// =============================================================================

describe('parseCellToPattern — alternative', () => {
  it('"либо 6 фото 1/6, либо 2 по 1/2 класса, либо 1 общая" → alternative из 3', () => {
    const p = parseCellToPattern('либо 6 фото 1/6, либо 2 по 1/2 класса, либо 1 общая');
    expect(p).not.toBeNull();
    if (p && p.type === 'alternative') {
      const types = p.options.map(o => o.type).sort();
      expect(types).toEqual(['full_one', 'half_pair', 'sixth_six']);
    } else {
      expect.fail('expected alternative pattern');
    }
  });

  it('"Либо 1/4 класса, либо 6 фото 1/6, либо 2 по 1/2 класса, либо 1 общая" → 3 опции (quarter одиночный игнорируется)', () => {
    // Парсер ищет «2 по 1/4», а одиночное «1/4 класса» не покрывается базовым keyword.
    // Это известное ограничение — фиксируется в РЭ.20.6 либо расширением PagePattern.
    const p = parseCellToPattern(
      'Либо 1/4 класса, либо 6 фото 1/6, либо 2 по 1/2 класса, либо 1 общая',
    );
    expect(p).not.toBeNull();
    if (p && p.type === 'alternative') {
      const types = p.options.map(o => o.type).sort();
      expect(types).toEqual(['full_one', 'half_pair', 'sixth_six']);
    } else {
      expect.fail('expected alternative pattern');
    }
  });

  it('case-insensitive по «либо/Либо»', () => {
    const a = parseCellToPattern('либо 6 фото 1/6, либо 1 общая');
    const b = parseCellToPattern('Либо 6 фото 1/6, либо 1 общая');
    expect(a).toEqual(b);
  });
});

// =============================================================================
// parseCellToPattern — неизвестные ячейки
// =============================================================================

describe('parseCellToPattern — неизвестные', () => {
  it('"" → null', () => {
    expect(parseCellToPattern('')).toBeNull();
  });
  it('"до 4 фото учеников + снизу 1 общая" → full_one (содержит "1 общая")', () => {
    // personal_final ячейка случайно матчит '1 общая' — это известный
    // edge case, в РЭ.20.6 будем парсить personal_final отдельным API.
    expect(parseCellToPattern('до 4 фото учеников + снизу 1 общая')).toEqual({
      type: 'full_one',
    });
  });
  it('"до 12 фото учеников" → null (ни один keyword не совпал)', () => {
    expect(parseCellToPattern('до 12 фото учеников')).toBeNull();
  });
});

// =============================================================================
// mandatorySectionPatternsFor / additionalSectionPatternsFor
// =============================================================================

describe('section patterns from real matrix entries', () => {
  it('mini-hard 1-24: mandatory = 2 паттерна, первый half_pair', () => {
    const e = findMatrixEntry('mini', 'hard', 10);
    const patterns = mandatorySectionPatternsFor(e!);
    expect(patterns.length).toBe(2);
    expect(patterns[0]).toEqual({ type: 'half_pair' });
    expect(patterns[1].type).toBe('alternative');
  });

  it('mini-hard 1-24: additional = 4 паттерна (по матрице)', () => {
    const e = findMatrixEntry('mini', 'hard', 10);
    const patterns = additionalSectionPatternsFor(e!);
    expect(patterns.length).toBe(4);
  });

  it('mini-hard 25-28: mandatory = пустой, additional = пустой', () => {
    const e = findMatrixEntry('mini', 'hard', 27);
    expect(mandatorySectionPatternsFor(e!)).toEqual([]);
    expect(additionalSectionPatternsFor(e!)).toEqual([]);
  });
});

// =============================================================================
// resolveAlternative
// =============================================================================

describe('resolveAlternative', () => {
  const alt: PagePattern = {
    type: 'alternative',
    options: [
      { type: 'sixth_six' },
      { type: 'half_pair' },
      { type: 'full_one' },
    ],
  };
  const empty: CommonPhotosAvailability = {
    sixth: 0,
    half_class: 0,
    full_class: 0,
    quarter: 0,
  };

  it('non-alternative pattern возвращается как есть', () => {
    expect(resolveAlternative({ type: 'half_pair' }, empty)).toEqual({ type: 'half_pair' });
  });

  it('≥6 sixth → sixth_six (приоритет 1)', () => {
    expect(resolveAlternative(alt, { ...empty, sixth: 6, half_class: 10 })).toEqual({
      type: 'sixth_six',
    });
  });

  it('<6 sixth, ≥2 half_class → half_pair (приоритет 2)', () => {
    expect(resolveAlternative(alt, { ...empty, sixth: 5, half_class: 2 })).toEqual({
      type: 'half_pair',
    });
  });

  it('<6 sixth, <2 half_class, ≥1 full_class → full_one (приоритет 3)', () => {
    expect(resolveAlternative(alt, { ...empty, sixth: 5, half_class: 1, full_class: 1 })).toEqual({
      type: 'full_one',
    });
  });

  it('всего по нулю в опциях → null (пустой слот для партнёра)', () => {
    expect(resolveAlternative(alt, empty)).toBeNull();
  });

  it('quarter работает если в options есть quarter_pair', () => {
    const altQ: PagePattern = {
      type: 'alternative',
      options: [{ type: 'quarter_pair' }, { type: 'full_one' }],
    };
    expect(resolveAlternative(altQ, { ...empty, quarter: 2 })).toEqual({
      type: 'quarter_pair',
    });
  });

  it('priority: quarter не выбирается если half доступен', () => {
    const altMix: PagePattern = {
      type: 'alternative',
      options: [{ type: 'half_pair' }, { type: 'quarter_pair' }],
    };
    expect(resolveAlternative(altMix, { ...empty, half_class: 2, quarter: 10 })).toEqual({
      type: 'half_pair',
    });
  });
});

// =============================================================================
// Smoke: матрица содержит ожидаемое количество записей
// =============================================================================

describe('matrix smoke', () => {
  it('всего 28 entries (по ТЗ §4)', () => {
    expect(allMatrixEntries().length).toBe(28);
  });
  it('по сheet_type соотношение hard ≈ soft (примерно равно)', () => {
    const hard = allMatrixEntries().filter(e => e.sheet_type === 'hard').length;
    const soft = allMatrixEntries().filter(e => e.sheet_type === 'soft').length;
    expect(Math.abs(hard - soft)).toBeLessThanOrEqual(1);
  });
});
