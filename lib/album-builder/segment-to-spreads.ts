/**
 * РЭ.35.А — Сегментация массива страниц в визуальные развороты.
 *
 * Layout редактор работает с layout.spreads — массивом SpreadInstance, где
 * каждый элемент = одна страница (наследие legacy формата, см.
 * lib/rule-engine/layout-to-buildresult.ts). UI же должен показывать
 * **визуальные развороты** — пары страниц, рендерящиеся рядом как
 * раскрытая книга.
 *
 * Эта функция — чистый helper для UI. Не меняет данные, только
 * сегментирует индексы.
 *
 * Правила сегментации:
 *   1. Обычная страница (мастер с is_spread=false или undefined) —
 *      занимает одну позицию в развороте. Если позиция left свободна —
 *      идёт туда; иначе right.
 *   2. Spread-мастер (is_spread=true) — занимает обе позиции разворота.
 *      Если перед ним стояла одна страница на left — закрываем тот
 *      разворот с пустой right и начинаем новый с этим spread-мастером.
 *
 * Вход:
 *   spreads — массив SpreadInstance (legacy формат, 1 элемент = 1 страница)
 *   templatesById — Map<string, SpreadTemplate> для определения is_spread
 *
 * Выход — массив VisualSpread:
 *   {
 *     leftIdx?: number       — индекс страницы в spreads для левой стороны
 *     rightIdx?: number      — индекс страницы для правой
 *     isSpread: boolean      — true если левая и правая ссылаются на один
 *                              spread-мастер (или это spread мастер на одной
 *                              из позиций)
 *   }
 */

import type { SpreadInstance, SpreadTemplate } from '@/lib/album-builder/types';

export type VisualSpread = {
  /** Индекс страницы (в массиве spreads) для левой стороны. undefined = пусто. */
  leftIdx?: number;
  /** Индекс страницы для правой стороны. undefined = пусто. */
  rightIdx?: number;
  /** true если разворот занят одним spread-мастером (is_spread=true). */
  isSpread: boolean;
};

export function segmentToSpreads(
  spreads: SpreadInstance[],
  templatesById: ReadonlyMap<string, SpreadTemplate>,
  options?: {
    /**
     * РЭ.35.Е.5 — режим soft-альбома. Когда true, первая страница
     * массива становится ПРАВОЙ первого визуального разворота (левая
     * остаётся undefined — там форзац), последняя страница становится
     * ЛЕВОЙ последнего разворота (правая undefined — форзац).
     *
     * Это отражает реальность soft-альбома: первая физическая страница
     * — внутренняя сторона мягкой обложки (форзац), содержательная
     * вёрстка начинается со 2-й страницы (= правая 1-го разворота).
     *
     * Если false (default) — обычная сегментация для hard/layflat.
     */
    softShift?: boolean;
  },
): VisualSpread[] {
  const result: VisualSpread[] = [];
  let current: VisualSpread | null = null;

  // РЭ.35.Е.5: для soft первая страница → правая первого разворота.
  // Открываем первый разворот сразу с занятой левой (форзац) — стартуем
  // с nextSide='right'.
  if (options?.softShift && spreads.length > 0) {
    current = { leftIdx: undefined, isSpread: false };
  }

  for (let i = 0; i < spreads.length; i++) {
    const page = spreads[i];
    const template = templatesById.get(page.template_id);
    const isSpread = template?.is_spread === true;

    // РЭ.35.Ж.4: если страница помечена как начало нового разворота,
    // закрываем текущий открытый разворот (он остаётся с висящей левой)
    // и эта страница станет левой нового разворота.
    if (page.section_start && current) {
      result.push(current);
      current = null;
    }

    if (isSpread) {
      // Spread-мастер занимает весь разворот. Если уже есть open разворот
      // с одной страницей — закрываем его (висит).
      if (current) {
        result.push(current);
        current = null;
      }
      result.push({
        leftIdx: i,
        rightIdx: i,
        isSpread: true,
      });
      continue;
    }

    // Обычная страница.
    if (!current) {
      current = { leftIdx: i, isSpread: false };
    } else {
      current.rightIdx = i;
      result.push(current);
      current = null;
    }
  }

  // Висящий разворот (последняя страница без пары) — закрываем как есть.
  if (current) {
    result.push(current);
  }

  return result;
}

/**
 * Обратная функция: по индексу страницы найти к какому VisualSpread'у
 * она относится. Возвращает индекс в массиве segmentToSpreads()-результата.
 *
 * Используется для синхронизации currentIdx (page-based) с pairIdx
 * (spread-based) в UI.
 */
export function findVisualSpreadForPage(
  visualSpreads: VisualSpread[],
  pageIdx: number,
): number {
  for (let i = 0; i < visualSpreads.length; i++) {
    const vs = visualSpreads[i];
    if (vs.leftIdx === pageIdx || vs.rightIdx === pageIdx) {
      return i;
    }
  }
  return -1;
}
