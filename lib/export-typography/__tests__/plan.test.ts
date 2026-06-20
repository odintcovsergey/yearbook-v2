/**
 * Тесты планировщика типографской выгрузки: нарезка по книгам, разворотами vs
 * постранично, именование 000/00X, обложки, is_spread-мастер, лимит.
 */

import { describe, it, expect } from 'vitest';
import { planTypographyExport } from '../plan';
import type { SpreadInstance, SpreadTemplate } from '../../album-builder/types';

// ─── helpers ────────────────────────────────────────────────────────────────

function page(
  i: number,
  opts: {
    tpl?: string;
    personal?: number; // student_index
    section_start?: boolean;
  } = {},
): SpreadInstance {
  return {
    spread_index: i,
    template_id: opts.tpl ?? 'M-Std',
    template_name: opts.tpl ?? 'M-Std',
    data: {},
    ...(opts.section_start ? { section_start: true } : {}),
    ...(opts.personal !== undefined
      ? { personal: { section_index: 0, student_index: opts.personal } }
      : {}),
  };
}

/** Мастер с заданным is_spread (минимум для сегментации). */
function tpl(id: string, isSpread = false): SpreadTemplate {
  return {
    id,
    is_spread: isSpread,
    placeholders: [],
    width_mm: 100,
    height_mm: 100,
  } as unknown as SpreadTemplate;
}

const templates = new Map<string, SpreadTemplate>([
  ['M-Std', tpl('M-Std', false)],
  ['J-Spread', tpl('J-Spread', true)],
]);

// ─── общая книга ──────────────────────────────────────────────────────────

describe('planTypographyExport — общая книга', () => {
  it('разворотами: 4 страницы → 2 файла-разворота 000-01, 000-02', () => {
    const plan = planTypographyExport(
      [page(0), page(1), page(2), page(3)],
      templates,
      { acceptMode: 'spread', softShift: false },
    );
    expect(plan.books).toHaveLength(1);
    const book = plan.books[0];
    expect(book.book_id).toBe('000');
    expect(book.cover_file_name).toBe('000-00');
    expect(book.units.map((u) => u.file_name)).toEqual(['000-01', '000-02']);
    expect(book.spread_count).toBe(2);
    expect(plan.total_spreads).toBe(2);
    expect(plan.has_personal).toBe(false);
    // У первого разворота две стороны.
    expect(book.units[0].left?.spread_index).toBe(0);
    expect(book.units[0].right?.spread_index).toBe(1);
  });

  it('постранично: 4 страницы → 4 файла-страницы 000-01..000-04', () => {
    const plan = planTypographyExport(
      [page(0), page(1), page(2), page(3)],
      templates,
      { acceptMode: 'page', softShift: false },
    );
    const book = plan.books[0];
    expect(book.units.map((u) => u.file_name)).toEqual([
      '000-01',
      '000-02',
      '000-03',
      '000-04',
    ]);
    // spread_count — число визуальных разворотов (для корешка), не страниц.
    expect(book.spread_count).toBe(2);
    expect(book.units.every((u) => u.mode === 'page')).toBe(true);
    expect(book.units[0].left?.spread_index).toBe(0);
    expect(book.units[3].left?.spread_index).toBe(3);
  });
});

// ─── is_spread-мастер ──────────────────────────────────────────────────────

describe('planTypographyExport — is_spread-мастер', () => {
  it('разворотами: широкий мастер = 1 файл, is_spread_master=true', () => {
    const plan = planTypographyExport(
      [page(0, { tpl: 'J-Spread' })],
      templates,
      { acceptMode: 'spread', softShift: false },
    );
    const u = plan.books[0].units;
    expect(u).toHaveLength(1);
    expect(u[0].is_spread_master).toBe(true);
    expect(u[0].left?.spread_index).toBe(0);
    expect(u[0].right).toBeUndefined();
  });

  it('постранично: широкий мастер режется на 2 половины (left/right)', () => {
    const plan = planTypographyExport(
      [page(0, { tpl: 'J-Spread' })],
      templates,
      { acceptMode: 'page', softShift: false },
    );
    const u = plan.books[0].units;
    expect(u).toHaveLength(2);
    expect(u.map((x) => x.file_name)).toEqual(['000-01', '000-02']);
    expect(u[0].spread_half).toBe('left');
    expect(u[1].spread_half).toBe('right');
    expect(u[0].left?.spread_index).toBe(0);
    expect(u[1].left?.spread_index).toBe(0);
  });
});

// ─── нарезка per-student ───────────────────────────────────────────────────

describe('planTypographyExport — нарезка per-student', () => {
  it('личные страницы уходят в книги 00X, общие — в 000', () => {
    // 2 общие, затем по 1 личной странице ученикам 0 и 1.
    const plan = planTypographyExport(
      [
        page(0),
        page(1),
        page(2, { personal: 0 }),
        page(3, { personal: 1 }),
      ],
      templates,
      { acceptMode: 'spread', softShift: false },
    );
    expect(plan.has_personal).toBe(true);
    expect(plan.books.map((b) => b.book_id)).toEqual(['000', '001', '002']);

    const common = plan.books[0];
    expect(common.units.map((u) => u.file_name)).toEqual(['000-01']);
    expect(common.units[0].left?.spread_index).toBe(0);
    expect(common.units[0].right?.spread_index).toBe(1);

    // Ученик 0 → книга 001, его одна личная страница.
    const b1 = plan.books[1];
    expect(b1.kind).toBe('personal');
    expect(b1.student_index).toBe(0);
    expect(b1.cover_file_name).toBe('001-00');
    expect(b1.units.map((u) => u.file_name)).toEqual(['001-01']);
    expect(b1.units[0].left?.spread_index).toBe(2);

    // Ученик 1 → книга 002.
    const b2 = plan.books[2];
    expect(b2.student_index).toBe(1);
    expect(b2.units.map((u) => u.file_name)).toEqual(['002-01']);
    expect(b2.units[0].left?.spread_index).toBe(3);
  });

  it('чужие личные страницы не подмешиваются в книгу ученика', () => {
    const plan = planTypographyExport(
      [page(0, { personal: 5 }), page(1, { personal: 2 })],
      templates,
      { acceptMode: 'page', softShift: false },
    );
    // Книга 000 пустая (нет общих), личные — по возрастанию: 2 → 003, 5 → 006.
    expect(plan.books.map((b) => b.book_id)).toEqual(['000', '003', '006']);
    expect(plan.books[0].units).toHaveLength(0);
    const s2 = plan.books.find((b) => b.student_index === 2)!;
    const s5 = plan.books.find((b) => b.student_index === 5)!;
    expect(s2.units.every((u) => u.left?.personal?.student_index === 2)).toBe(true);
    expect(s5.units.every((u) => u.left?.personal?.student_index === 5)).toBe(true);
  });
});

// ─── soft-альбом ───────────────────────────────────────────────────────────

describe('planTypographyExport — soft', () => {
  it('softShift: первая страница уходит в правую первого разворота', () => {
    const plan = planTypographyExport([page(0), page(1)], templates, {
      acceptMode: 'spread',
      softShift: true,
    });
    const u = plan.books[0].units;
    // Форзац слева пуст, первая страница — справа первого разворота.
    expect(u[0].left).toBeUndefined();
    expect(u[0].right?.spread_index).toBe(0);
  });
});
