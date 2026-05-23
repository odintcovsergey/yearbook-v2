import { describe, it, expect } from 'vitest';
import {
  segmentToSpreads,
  findVisualSpreadForPage,
} from '../segment-to-spreads';
import type { SpreadInstance, SpreadTemplate } from '../types';

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
  return {
    spread_index: idx,
    template_id,
    template_name: template_id,
    data: {},
  };
}

describe('segmentToSpreads', () => {
  it('Пустой массив → пустой результат', () => {
    const result = segmentToSpreads([], new Map());
    expect(result).toEqual([]);
  });

  it('2 обычные страницы → 1 разворот (left, right)', () => {
    const templates = new Map([
      ['A', makeTemplate('A')],
      ['B', makeTemplate('B')],
    ]);
    const result = segmentToSpreads(
      [makePage('A', 0), makePage('B', 1)],
      templates,
    );
    expect(result).toEqual([
      { leftIdx: 0, rightIdx: 1, isSpread: false },
    ]);
  });

  it('4 обычные страницы → 2 разворота', () => {
    const templates = new Map([
      ['A', makeTemplate('A')],
    ]);
    const result = segmentToSpreads(
      [
        makePage('A', 0),
        makePage('A', 1),
        makePage('A', 2),
        makePage('A', 3),
      ],
      templates,
    );
    expect(result).toEqual([
      { leftIdx: 0, rightIdx: 1, isSpread: false },
      { leftIdx: 2, rightIdx: 3, isSpread: false },
    ]);
  });

  it('Нечётное количество страниц → последняя пустая правая', () => {
    const templates = new Map([['A', makeTemplate('A')]]);
    const result = segmentToSpreads(
      [makePage('A', 0), makePage('A', 1), makePage('A', 2)],
      templates,
    );
    expect(result).toEqual([
      { leftIdx: 0, rightIdx: 1, isSpread: false },
      { leftIdx: 2, isSpread: false }, // rightIdx undefined
    ]);
  });

  it('Spread-мастер один → занимает весь разворот', () => {
    const templates = new Map([
      ['J-Spread', makeTemplate('J-Spread', true)],
    ]);
    const result = segmentToSpreads(
      [makePage('J-Spread', 0)],
      templates,
    );
    expect(result).toEqual([
      { leftIdx: 0, rightIdx: 0, isSpread: true },
    ]);
  });

  it('Spread между обычными: обычная → spread → обычная', () => {
    const templates = new Map([
      ['A', makeTemplate('A')],
      ['B', makeTemplate('B')],
      ['J-Spread', makeTemplate('J-Spread', true)],
    ]);
    const result = segmentToSpreads(
      [
        makePage('A', 0),
        makePage('A', 1),
        makePage('J-Spread', 2),
        makePage('B', 3),
        makePage('B', 4),
      ],
      templates,
    );
    expect(result).toEqual([
      { leftIdx: 0, rightIdx: 1, isSpread: false },
      { leftIdx: 2, rightIdx: 2, isSpread: true },
      { leftIdx: 3, rightIdx: 4, isSpread: false },
    ]);
  });

  it('Spread после нечётного → предыдущий разворот закрывается «висящим»', () => {
    const templates = new Map([
      ['A', makeTemplate('A')],
      ['J-Spread', makeTemplate('J-Spread', true)],
    ]);
    const result = segmentToSpreads(
      [
        makePage('A', 0), // одна на левой
        makePage('J-Spread', 1), // spread на новом развороте
      ],
      templates,
    );
    expect(result).toEqual([
      { leftIdx: 0, isSpread: false }, // висящая левая
      { leftIdx: 1, rightIdx: 1, isSpread: true },
    ]);
  });

  it('Мастер не найден в templatesById → считается обычной страницей', () => {
    const result = segmentToSpreads(
      [makePage('UNKNOWN', 0), makePage('UNKNOWN', 1)],
      new Map(),
    );
    expect(result).toEqual([
      { leftIdx: 0, rightIdx: 1, isSpread: false },
    ]);
  });

  // ─── softShift (soft-альбомы) ───────────────────────────────────────────

  it('softShift: 14 страниц soft → 8 разворотов, первый/последний с форзацами', () => {
    const templates = new Map([['A', makeTemplate('A')]]);
    const pages = Array.from({ length: 14 }, (_, i) => makePage('A', i));
    const result = segmentToSpreads(pages, templates, { softShift: true });
    expect(result.length).toBe(8);
    // Первый разворот: пустая левая (форзац), первая страница как правая
    expect(result[0]).toEqual({
      leftIdx: undefined,
      rightIdx: 0,
      isSpread: false,
    });
    // Развороты 2-7: обычные пары
    expect(result[1]).toEqual({ leftIdx: 1, rightIdx: 2, isSpread: false });
    expect(result[6]).toEqual({ leftIdx: 11, rightIdx: 12, isSpread: false });
    // Последний: только левая (правая = форзац)
    expect(result[7]).toEqual({ leftIdx: 13, isSpread: false });
  });

  it('softShift: 2 страницы → 2 разворота (по форзацу с обеих сторон)', () => {
    const templates = new Map([['A', makeTemplate('A')]]);
    const result = segmentToSpreads(
      [makePage('A', 0), makePage('A', 1)],
      templates,
      { softShift: true },
    );
    expect(result).toEqual([
      { leftIdx: undefined, rightIdx: 0, isSpread: false },
      { leftIdx: 1, isSpread: false },
    ]);
  });

  it('softShift: 1 страница → 1 разворот { rightIdx: 0 }', () => {
    const templates = new Map([['A', makeTemplate('A')]]);
    const result = segmentToSpreads(
      [makePage('A', 0)],
      templates,
      { softShift: true },
    );
    // У single-страничного soft-альбома последний разворот не успевает
    // открыться (current уже закрылся когда rightIdx был установлен)
    expect(result).toEqual([
      { leftIdx: undefined, rightIdx: 0, isSpread: false },
    ]);
  });

  it('softShift: пустой массив → пустой результат', () => {
    const result = segmentToSpreads([], new Map(), { softShift: true });
    expect(result).toEqual([]);
  });
});

describe('findVisualSpreadForPage', () => {
  it('Возвращает индекс VisualSpread для указанной страницы', () => {
    const visualSpreads = [
      { leftIdx: 0, rightIdx: 1, isSpread: false },
      { leftIdx: 2, rightIdx: 2, isSpread: true },
      { leftIdx: 3, rightIdx: 4, isSpread: false },
    ];
    expect(findVisualSpreadForPage(visualSpreads, 0)).toBe(0);
    expect(findVisualSpreadForPage(visualSpreads, 1)).toBe(0);
    expect(findVisualSpreadForPage(visualSpreads, 2)).toBe(1);
    expect(findVisualSpreadForPage(visualSpreads, 3)).toBe(2);
    expect(findVisualSpreadForPage(visualSpreads, 4)).toBe(2);
  });

  it('Несуществующая страница → -1', () => {
    expect(findVisualSpreadForPage([], 0)).toBe(-1);
    expect(
      findVisualSpreadForPage(
        [{ leftIdx: 0, rightIdx: 1, isSpread: false }],
        99,
      ),
    ).toBe(-1);
  });
});
