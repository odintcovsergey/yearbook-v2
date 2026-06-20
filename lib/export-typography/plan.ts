/**
 * Планировщик типографской выгрузки (ТЗ экспорта 20.06.2026).
 *
 * Превращает сохранённую вёрстку (album_layouts.spreads — legacy
 * SpreadInstance, 1 элемент = 1 страница; см. layout-to-buildresult.ts) в
 * список ФАЙЛОВ под профиль типографии:
 *
 *  1. Нарезка по книгам: страницы с меткой personal.student_index уходят в
 *     личную книгу ученика 00X, остальные — в общую книгу 000.
 *  2. Парная группировка каждой книги в визуальные развороты (canonical
 *     segmentToSpreads — та же, что в редакторе/превью; softShift для soft).
 *  3. Раскладка по «приёму» типографии:
 *      - 'spread'  (разворотами): 1 файл = 1 визуальный разворот (две страницы
 *        на одном широком холсте; is_spread-мастер — как есть);
 *      - 'page'    (постранично): 1 файл = 1 страница; is_spread-мастер режется
 *        на левую/правую половины.
 *  4. Имена «КНИГА-ЕДИНИЦА» со сквозной нумерацией ВНУТРИ книги с 01
 *     (разворотами — номер разворота, постранично — номер страницы). Обложка
 *     книги — «КНИГА-00».
 *
 * Чистая функция над геометрией списка — рендер (PDF/JPG) и zip отдельно.
 */

import type { SpreadInstance, SpreadTemplate } from '../album-builder/types';
import { segmentToSpreads } from '../album-builder/segment-to-spreads';
import { COMMON_BOOK_ID, formatBookId, bookFileName } from '../album-split';

/** Приём файлов типографией: разворотами или постранично. */
export type AcceptMode = 'spread' | 'page';

/**
 * Один файл выгрузки.
 *
 * Разворотами: `left`/`right` — две стороны разворота (для is_spread-мастера
 * `left` несёт мастер, `right` пуст, `is_spread_master=true`).
 * Постранично: `left` — единственная страница файла; если она половина
 * is_spread-мастера, `spread_half` указывает какую половину рендерить.
 */
export interface ExportUnit {
  /** Имя файла без расширения, напр. "000-01". */
  file_name: string;
  mode: AcceptMode;
  /** Разворотами: левая страница / is_spread-мастер. Постранично: страница файла. */
  left?: SpreadInstance;
  /** Разворотами: правая страница (для обычной пары). Постранично: не используется. */
  right?: SpreadInstance;
  /** Стороны пришли из одного is_spread-мастера (рендерить широким холстом). */
  is_spread_master: boolean;
  /** Постранично: какую половину is_spread-мастера рендерить. Иначе undefined. */
  spread_half?: 'left' | 'right';
}

export interface ExportBook {
  /** "000" — общая книга; "001"/"002"… — личная книга ученика. */
  book_id: string;
  kind: 'common' | 'personal';
  /** student_index из метки personal (0-based); только для kind='personal'. */
  student_index?: number;
  /** Имя файла обложки книги, напр. "000-00". */
  cover_file_name: string;
  /** Файлы книги по порядку (без обложки). */
  units: ExportUnit[];
  /** Число визуальных разворотов книги (для корешка). */
  spread_count: number;
}

export interface TypographyExportPlan {
  /** Книга 000 (общая) первой, далее личные книги по возрастанию ученика. */
  books: ExportBook[];
  has_personal: boolean;
  /** Суммарно визуальных разворотов по всем книгам (метрика лимита экспорта). */
  total_spreads: number;
}

/** Ключ книги страницы: 'common' или student_index личной книги. */
function bookKeyOf(sp: SpreadInstance): 'common' | number {
  return sp.personal ? sp.personal.student_index : 'common';
}

/**
 * Строит план типографской выгрузки.
 *
 * @param spreads — сохранённая вёрстка (legacy SpreadInstance, 1 = 1 страница).
 * @param templateById — мастера по id (для is_spread в сегментации).
 * @param opts.acceptMode — приём типографии ('spread' | 'page').
 * @param opts.softShift — soft-альбом (первая страница = форзац справа).
 */
export function planTypographyExport(
  spreads: SpreadInstance[],
  templateById: ReadonlyMap<string, SpreadTemplate>,
  opts: { acceptMode: AcceptMode; softShift: boolean },
): TypographyExportPlan {
  // 1. Бакетим страницы по книгам, сохраняя порядок.
  const commonPages: SpreadInstance[] = [];
  const personalPages = new Map<number, SpreadInstance[]>();
  for (const sp of spreads) {
    const key = bookKeyOf(sp);
    if (key === 'common') {
      commonPages.push(sp);
    } else {
      const arr = personalPages.get(key) ?? [];
      arr.push(sp);
      personalPages.set(key, arr);
    }
  }

  const books: ExportBook[] = [];

  // 2. Общая книга 000 — всегда.
  books.push(
    buildBook(COMMON_BOOK_ID, 'common', undefined, commonPages, templateById, opts),
  );

  // 3. Личные книги — по возрастанию student_index.
  const studentIndices = Array.from(personalPages.keys()).sort((a, b) => a - b);
  for (const studentIndex of studentIndices) {
    const bookId = formatBookId(studentIndex + 1);
    books.push(
      buildBook(
        bookId,
        'personal',
        studentIndex,
        personalPages.get(studentIndex) ?? [],
        templateById,
        opts,
      ),
    );
  }

  const total_spreads = books.reduce((acc, b) => acc + b.spread_count, 0);

  return {
    books,
    has_personal: studentIndices.length > 0,
    total_spreads,
  };
}

function buildBook(
  bookId: string,
  kind: 'common' | 'personal',
  studentIndex: number | undefined,
  pages: SpreadInstance[],
  templateById: ReadonlyMap<string, SpreadTemplate>,
  opts: { acceptMode: AcceptMode; softShift: boolean },
): ExportBook {
  const visual = segmentToSpreads(pages, templateById, { softShift: opts.softShift });
  const units: ExportUnit[] = [];
  let n = 1; // сквозной номер файла внутри книги, с 01

  if (opts.acceptMode === 'spread') {
    // Разворотами: 1 файл = 1 визуальный разворот.
    for (const vs of visual) {
      const left = vs.leftIdx !== undefined ? pages[vs.leftIdx] : undefined;
      const right =
        vs.rightIdx !== undefined && vs.rightIdx !== vs.leftIdx
          ? pages[vs.rightIdx]
          : undefined;
      units.push({
        file_name: bookFileName(bookId, n++),
        mode: 'spread',
        left,
        right,
        is_spread_master: vs.isSpread,
      });
    }
  } else {
    // Постранично: 1 файл = 1 страница; is_spread-мастер режется на половины.
    for (const vs of visual) {
      if (vs.isSpread) {
        const master = vs.leftIdx !== undefined ? pages[vs.leftIdx] : undefined;
        // Широкий мастер → две страницы (левая/правая половины).
        units.push({
          file_name: bookFileName(bookId, n++),
          mode: 'page',
          left: master,
          is_spread_master: true,
          spread_half: 'left',
        });
        units.push({
          file_name: bookFileName(bookId, n++),
          mode: 'page',
          left: master,
          is_spread_master: true,
          spread_half: 'right',
        });
        continue;
      }
      // Обычная пара: каждая занятая сторона — отдельный файл-страница.
      if (vs.leftIdx !== undefined) {
        units.push({
          file_name: bookFileName(bookId, n++),
          mode: 'page',
          left: pages[vs.leftIdx],
          is_spread_master: false,
        });
      }
      if (vs.rightIdx !== undefined && vs.rightIdx !== vs.leftIdx) {
        units.push({
          file_name: bookFileName(bookId, n++),
          mode: 'page',
          left: pages[vs.rightIdx],
          is_spread_master: false,
        });
      }
    }
  }

  return {
    book_id: bookId,
    kind,
    ...(studentIndex !== undefined ? { student_index: studentIndex } : {}),
    cover_file_name: bookFileName(bookId, 0),
    units,
    spread_count: visual.length,
  };
}
