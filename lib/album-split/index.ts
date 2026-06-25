/**
 * Нарезка собранного альбома на per-student книги + нумерация + корешок
 * (ТЗ 19.06.2026 «персональный раздел»). См. ./types.ts про модель и нумерацию.
 *
 * Логика разнесения опирается на метку PageInstance.personal: личные страницы
 * (students-секция с config.is_personal=true) уходят в книгу своего ученика 00X,
 * все остальные страницы — в общую книгу 000. Регруппировка идёт на уровне
 * СТРАНИЦ: в режиме «1 на страницу» левая и правая страница одного печатного
 * листа могут принадлежать разным детям — каждая уходит в свою книгу, а уже
 * внутри книги страницы заново собираются в развороты.
 *
 * Сама раскладка движка НЕ меняется — это пост-обработка для подготовки к
 * экспорту.
 */

import type { PageInstance, SpreadInstance } from '../rule-engine/types';
import type { PrinterConfig } from '../printers/types';
import { resolveSpineMm } from '../printers/spine';
import type { AlbumBooks, Book, BookSpread } from './types';

export type { AlbumBooks, Book, BookSpread, BookKind } from './types';

/** Номер общей книги (она всегда 000). */
export const COMMON_BOOK_ID = '000';

/** "001", "012", "000" — номер книги с ведущими нулями (3 знака). 0 = общая. */
export function formatBookId(n: number): string {
  return String(Math.max(0, Math.trunc(n))).padStart(3, '0');
}

/** "00", "01", "12" — позиция разворота/обложки (2 знака). */
export function formatSpreadPosition(pos: number): string {
  return String(Math.max(0, Math.trunc(pos))).padStart(2, '0');
}

/** Имя файла «КНИГА-РАЗВОРОТ», напр. bookFileName('001', 3) → "001-03". */
export function bookFileName(bookId: string, position: number): string {
  return `${bookId}-${formatSpreadPosition(position)}`;
}

/** Одна страница с пометкой, в какую книгу она уходит. */
interface CarriedPage {
  page: PageInstance;
  sourceIndex: number;
  sourceIsSpread: boolean;
  /** 'common' или student_index личной книги. */
  bookKey: 'common' | number;
}

/** Собирает страницы книги в развороты (парами), нумеруя позиции с 1. */
function paginate(bookId: string, pages: CarriedPage[]): BookSpread[] {
  const out: BookSpread[] = [];
  let position = 1;
  for (let i = 0; i < pages.length; i += 2) {
    const a = pages[i];
    const b = pages[i + 1];
    const sameSource = b !== undefined && a.sourceIndex === b.sourceIndex;
    out.push({
      position,
      file_name: bookFileName(bookId, position),
      left: a.page,
      right: b?.page,
      ...(sameSource && a.sourceIsSpread ? { is_spread: true } : {}),
      source_spread_index: a.sourceIndex,
    });
    position++;
  }
  return out;
}

/**
 * Разносит развороты собранного альбома по книгам.
 *
 * Вход — развороты AlbumLayout (SpreadInstance с left/right). Метка
 * left/right.personal определяет принадлежность личной книге. Возвращает
 * книгу 000 (общую) + по книге на каждого ученика, у которого есть личные
 * страницы, в порядке возрастания номера ученика.
 *
 * Книга 000 присутствует ВСЕГДА (даже если все страницы личные — тогда она
 * пустая; на практике туда падают обложки/учителя/общий раздел).
 */
export function splitIntoBooks(spreads: SpreadInstance[]): AlbumBooks {
  const flat: CarriedPage[] = [];
  for (const sp of spreads) {
    for (const page of [sp.left, sp.right]) {
      if (!page) continue;
      const bookKey: 'common' | number = page.personal
        ? page.personal.student_index
        : 'common';
      flat.push({
        page,
        sourceIndex: sp.spread_index,
        sourceIsSpread: sp.is_spread === true,
        bookKey,
      });
    }
  }

  // Общая книга 000.
  const commonPages = flat.filter((f) => f.bookKey === 'common');
  const commonBook: Book = {
    book_id: COMMON_BOOK_ID,
    kind: 'common',
    cover_file_name: bookFileName(COMMON_BOOK_ID, 0),
    spreads: paginate(COMMON_BOOK_ID, commonPages),
  };

  // Личные книги — по уникальным student_index, по возрастанию.
  const studentIndices = Array.from(
    new Set(
      flat
        .filter((f): f is CarriedPage & { bookKey: number } => typeof f.bookKey === 'number')
        .map((f) => f.bookKey),
    ),
  ).sort((a, b) => a - b);

  const personalBooks: Book[] = studentIndices.map((studentIndex) => {
    // Номер книги = порядковый номер ученика (1-based).
    const bookId = formatBookId(studentIndex + 1);
    const pages = flat.filter((f) => f.bookKey === studentIndex);
    return {
      book_id: bookId,
      kind: 'personal',
      student_index: studentIndex,
      cover_file_name: bookFileName(bookId, 0),
      spreads: paginate(bookId, pages),
    };
  });

  return {
    books: [commonBook, ...personalBooks],
    has_personal: personalBooks.length > 0,
  };
}

/**
 * Корешок отдельной книги по её числу разворотов (мм) или null, если режим
 * корешка типографии не даёт значения. Для общей книги 000 — её число
 * разворотов; для личной — только личные развороты ученика.
 */
export function spineMmForBook(
  config: PrinterConfig | null | undefined,
  sheetTypeId: string | null | undefined,
  book: Book,
): number | null {
  return resolveSpineMm(config, sheetTypeId, book.spreads.length);
}

/**
 * Корешок ФИЗИЧЕСКИ собранной книги ученика: общие развороты (000) + его
 * личные развороты (00X). Это то, что реально сшивает типография для тонкого
 * персонального альбома. Если ученика с таким индексом нет среди личных книг —
 * считаем по одной общей части.
 */
export function assembledStudentSpineMm(
  config: PrinterConfig | null | undefined,
  sheetTypeId: string | null | undefined,
  books: AlbumBooks,
  studentIndex: number,
): number | null {
  const common = books.books.find((b) => b.kind === 'common');
  const personal = books.books.find(
    (b) => b.kind === 'personal' && b.student_index === studentIndex,
  );
  const count = (common?.spreads.length ?? 0) + (personal?.spreads.length ?? 0);
  return resolveSpineMm(config, sheetTypeId, count);
}
