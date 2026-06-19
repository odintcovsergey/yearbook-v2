import { describe, it, expect } from 'vitest';
import type { PageInstance, SpreadInstance } from '../../rule-engine/types';
import type { PrinterConfig } from '../../printers/types';
import {
  splitIntoBooks,
  formatBookId,
  formatSpreadPosition,
  bookFileName,
  spineMmForBook,
  assembledStudentSpineMm,
} from '../index';

// ─── Хелперы фикстур ────────────────────────────────────────────────────────

let mid = 0;
function commonPage(): PageInstance {
  return { master_id: `m${mid++}`, bindings: {}, section_type: 'common' };
}
function studentPage(sectionIndex: number, studentIndex: number): PageInstance {
  return {
    master_id: `m${mid++}`,
    bindings: {},
    section_type: 'students',
    personal: { section_index: sectionIndex, student_index: studentIndex },
  };
}
function spread(
  index: number,
  left?: PageInstance,
  right?: PageInstance,
  is_spread = false,
): SpreadInstance {
  return { spread_index: index, left, right, is_spread };
}

// Корешок = ровно число разворотов (base=0, step=1, per=1) — удобно для проверок.
const linearSpineConfig: PrinterConfig = {
  sheet_types: [
    {
      id: 'sheet-1',
      name: 'Тест',
      spine: { mode: 'formula', formula: { base_mm: 0, step_mm: 1, per_spreads: 1 } },
    },
  ],
};

// ─── Нумерация ──────────────────────────────────────────────────────────────

describe('нумерация', () => {
  it('formatBookId — ведущие нули, 0 = общая', () => {
    expect(formatBookId(0)).toBe('000');
    expect(formatBookId(1)).toBe('001');
    expect(formatBookId(12)).toBe('012');
    expect(formatBookId(123)).toBe('123');
  });

  it('formatSpreadPosition — два знака', () => {
    expect(formatSpreadPosition(0)).toBe('00');
    expect(formatSpreadPosition(3)).toBe('03');
    expect(formatSpreadPosition(15)).toBe('15');
  });

  it('bookFileName — КНИГА-РАЗВОРОТ', () => {
    expect(bookFileName('000', 1)).toBe('000-01');
    expect(bookFileName('001', 0)).toBe('001-00');
    expect(bookFileName('002', 12)).toBe('002-12');
  });
});

// ─── Нарезка ────────────────────────────────────────────────────────────────

describe('splitIntoBooks', () => {
  it('без личных страниц — всё в общую книгу 000', () => {
    const spreads = [
      spread(0, commonPage(), commonPage()),
      spread(1, commonPage(), commonPage()),
    ];
    const res = splitIntoBooks(spreads);
    expect(res.has_personal).toBe(false);
    expect(res.books).toHaveLength(1);
    const book000 = res.books[0];
    expect(book000.book_id).toBe('000');
    expect(book000.kind).toBe('common');
    expect(book000.cover_file_name).toBe('000-00');
    expect(book000.spreads.map((s) => s.file_name)).toEqual(['000-01', '000-02']);
  });

  it('режим «1 на разворот» — каждый ученик в свою книгу, общие в 000', () => {
    // Структура: общий разворот (учителя), затем по развороту на ученика.
    const spreads = [
      spread(0, commonPage(), commonPage()), // teachers/common → 000
      spread(1, studentPage(1, 0), studentPage(1, 0)), // ученик 0 → книга 001
      spread(2, studentPage(1, 1), studentPage(1, 1)), // ученик 1 → книга 002
      spread(3, studentPage(1, 2), studentPage(1, 2)), // ученик 2 → книга 003
    ];
    const res = splitIntoBooks(spreads);
    expect(res.has_personal).toBe(true);
    expect(res.books.map((b) => b.book_id)).toEqual(['000', '001', '002', '003']);

    const book000 = res.books[0];
    expect(book000.spreads.map((s) => s.file_name)).toEqual(['000-01']);

    const book001 = res.books[1];
    expect(book001.kind).toBe('personal');
    expect(book001.student_index).toBe(0);
    expect(book001.cover_file_name).toBe('001-00');
    // Один разворот ученика (2 страницы) → один разворот в книге.
    expect(book001.spreads.map((s) => s.file_name)).toEqual(['001-01']);
    expect(book001.spreads[0].left).toBeDefined();
    expect(book001.spreads[0].right).toBeDefined();

    // Позиция YY совпадает у всех личных книг (все начинаются с 01).
    expect(res.books[2].spreads.map((s) => s.position)).toEqual([1]);
    expect(res.books[3].spreads.map((s) => s.position)).toEqual([1]);
  });

  it('режим «1 на страницу» — два ребёнка с одного листа уходят в разные книги', () => {
    // Один печатный разворот: слева ученик 0, справа ученик 1.
    const spreads = [
      spread(0, commonPage(), commonPage()), // общий
      spread(1, studentPage(1, 0), studentPage(1, 1)), // лист делится между книгами
    ];
    const res = splitIntoBooks(spreads);
    expect(res.books.map((b) => b.book_id)).toEqual(['000', '001', '002']);

    const book001 = res.books[1];
    const book002 = res.books[2];
    // У каждого по одной странице → разворот с одной (левой) страницей.
    expect(book001.spreads).toHaveLength(1);
    expect(book001.spreads[0].file_name).toBe('001-01');
    expect(book001.spreads[0].left).toBeDefined();
    expect(book001.spreads[0].right).toBeUndefined();
    expect(book002.spreads[0].file_name).toBe('002-01');
  });

  it('«сетка» (общая, без меток) идёт в 000 целиком', () => {
    // Сетка портретов = страницы students БЕЗ метки personal → общие.
    const grid1: PageInstance = { master_id: 'g1', bindings: {}, section_type: 'students' };
    const grid2: PageInstance = { master_id: 'g2', bindings: {}, section_type: 'students' };
    const spreads = [spread(0, grid1, grid2)];
    const res = splitIntoBooks(spreads);
    expect(res.has_personal).toBe(false);
    expect(res.books).toHaveLength(1);
    expect(res.books[0].book_id).toBe('000');
    expect(res.books[0].spreads.map((s) => s.file_name)).toEqual(['000-01']);
  });

  it('multi_spread — несколько разворотов одного ученика собираются в его книгу', () => {
    // Ученик 0: парад + 1 коллаж (2 разворота = 4 страницы); ученик 1: столько же.
    const spreads = [
      spread(0, commonPage(), commonPage()),
      spread(1, studentPage(1, 0), studentPage(1, 0)),
      spread(2, studentPage(1, 0), studentPage(1, 0)),
      spread(3, studentPage(1, 1), studentPage(1, 1)),
      spread(4, studentPage(1, 1), studentPage(1, 1)),
    ];
    const res = splitIntoBooks(spreads);
    expect(res.books.map((b) => b.book_id)).toEqual(['000', '001', '002']);
    expect(res.books[1].spreads.map((s) => s.file_name)).toEqual(['001-01', '001-02']);
    expect(res.books[2].spreads.map((s) => s.file_name)).toEqual(['002-01', '002-02']);
  });

  it('несколько личных секций одного ученика складываются в одну книгу', () => {
    // Секция #1 (разворотный личный) и секция #3 (ещё личный) для тех же детей.
    const spreads = [
      spread(0, studentPage(1, 0), studentPage(1, 0)), // секция 1, ученик 0
      spread(1, studentPage(1, 1), studentPage(1, 1)), // секция 1, ученик 1
      spread(2, commonPage(), commonPage()), // общий между секциями
      spread(3, studentPage(3, 0), studentPage(3, 0)), // секция 3, ученик 0
      spread(4, studentPage(3, 1), studentPage(3, 1)), // секция 3, ученик 1
    ];
    const res = splitIntoBooks(spreads);
    expect(res.books.map((b) => b.book_id)).toEqual(['000', '001', '002']);
    // У ученика 0 — по развороту из каждой личной секции = 2 разворота.
    expect(res.books[1].spreads.map((s) => s.file_name)).toEqual(['001-01', '001-02']);
    expect(res.books[2].spreads.map((s) => s.file_name)).toEqual(['002-01', '002-02']);
    // Общий разворот — в 000.
    expect(res.books[0].spreads.map((s) => s.file_name)).toEqual(['000-01']);
  });

  it('висящий разворот (только правая) корректно попадает в книгу', () => {
    const spreads = [spread(0, undefined, commonPage())];
    const res = splitIntoBooks(spreads);
    expect(res.books[0].spreads).toHaveLength(1);
    expect(res.books[0].spreads[0].left).toBeDefined(); // правая стала первой страницей
  });
});

// ─── Корешок по числу разворотов собранной книги ────────────────────────────

describe('корешок', () => {
  it('тонкая книга ученика ≠ толстая общая', () => {
    // 000: 5 общих разворотов; ученик 0: 1 личный разворот.
    const spreads: SpreadInstance[] = [];
    for (let i = 0; i < 5; i++) spreads.push(spread(i, commonPage(), commonPage()));
    spreads.push(spread(5, studentPage(1, 0), studentPage(1, 0)));
    spreads.push(spread(6, studentPage(1, 1), studentPage(1, 1)));

    const res = splitIntoBooks(spreads);
    const book000 = res.books.find((b) => b.kind === 'common')!;
    const book001 = res.books.find((b) => b.student_index === 0)!;

    // Корешок отдельной книги = число её разворотов (formula step=1).
    expect(spineMmForBook(linearSpineConfig, 'sheet-1', book000)).toBe(5);
    expect(spineMmForBook(linearSpineConfig, 'sheet-1', book001)).toBe(1);
  });

  it('собранная книга ученика = общие 000 + его личные', () => {
    const spreads: SpreadInstance[] = [];
    for (let i = 0; i < 3; i++) spreads.push(spread(i, commonPage(), commonPage())); // 000 = 3
    spreads.push(spread(3, studentPage(1, 0), studentPage(1, 0))); // ученик 0: разворот 1
    spreads.push(spread(4, studentPage(1, 0), studentPage(1, 0))); // ученик 0: разворот 2

    const res = splitIntoBooks(spreads);
    // 3 общих + 2 личных = 5 разворотов в физически собранной тонкой книге.
    expect(assembledStudentSpineMm(linearSpineConfig, 'sheet-1', res, 0)).toBe(5);
  });

  it('корешок null, если режим типографии не даёт значения', () => {
    const emptyConfig: PrinterConfig = { sheet_types: [] };
    const res = splitIntoBooks([spread(0, commonPage(), commonPage())]);
    expect(spineMmForBook(emptyConfig, null, res.books[0])).toBeNull();
  });
});
