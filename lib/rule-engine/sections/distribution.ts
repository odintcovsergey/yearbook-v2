/**
 * РЭ.40: Smart distribution algorithm — решение «как разложить N учеников
 * по grid-страницам с maxGrid слотами на странице».
 *
 * Чистая функция без сайд-эффектов. Не знает про PageInstance, мастеров,
 * decision_trace — её результат потом интерпретирует buildGrid().
 *
 * Применяется ТОЛЬКО к grid-режимам (mini, light). Для page/spread/
 * alternating LR (medium, standard, universal, maximum) — другая модель.
 *
 * ─── Режимы (выбираются партнёром в карточке альбома) ─────────────
 *
 *   greedy:
 *     Жадное распределение. Полные страницы заполняются по maxGrid;
 *     остаток идёт на последнюю страницу.
 *     Пример: N=30, maxGrid=12 → [12, 12, 6]
 *     Combined-tail работает: если remainder ≤ combinedCapacity И есть
 *     свободное общее фото — последняя страница = combined-мастер.
 *     Может срабатывать symmetrize_tail (legacy-фича) для остатка 1.
 *
 *   equalize:
 *     Всегда равномерно по всем страницам, безусловно (даже если есть
 *     фото для combined-мастера).
 *     Пример: N=30, maxGrid=12 → [10, 10, 10]
 *     Симметризация не применяется (не нужна — хвоста 1 не бывает).
 *     Combined-tail не применяется (партнёр явно выбрал equalize).
 *
 *   auto (DEFAULT):
 *     Умное правило:
 *       1) Если N кратно maxGrid → жадно (никаких хвостов).
 *       2) Если N ≤ maxGrid → одна страница (равномерно).
 *       3) Если есть свободное общее фото И есть combined-мастер,
 *          И существует «средний» X (1 ≤ X ≤ combinedCapacity) при
 *          котором первые (pagesNeeded-1) страниц могут вместить
 *          оставшихся (N-X) учеников по ≤ maxGrid на странице —
 *          выбираем средний X из допустимых, последняя страница =
 *          combined-мастер с X портретов + 1 общее фото.
 *       4) Иначе — чистый equalize.
 *     Симметризация не применяется.
 *
 *   Сергей: «Тут, наверное, было бы удобно это всё-таки включать в
 *   самом заказе, а не в шаблоне. Потому что заказы разные.» (РЭ.40.b)
 *
 * ─── Примеры результатов для Mini (maxGrid=12, combinedCap=4) ──────
 *
 *   N    | hasPhoto | mode='auto' | mode='equalize' | mode='greedy'
 *   ─────┼──────────┼─────────────┼─────────────────┼──────────────
 *   12   | *        | [12]        | [12]            | [12]
 *   13   | yes      | [10, +3F]   | [7, 6]          | [12, +1F] OR [12,1]
 *   13   | no       | [7, 6]      | [7, 6]          | [12, 1]
 *   16   | yes      | [12, +4F]   | [8, 8]          | [12, +4F]
 *   16   | no       | [8, 8]      | [8, 8]          | [12, 4]
 *   18   | *        | [9, 9]      | [9, 9]          | [12, 6]
 *   20   | *        | [10, 10]    | [10, 10]        | [12, 8]
 *   24   | *        | [12, 12]    | [12, 12]        | [12, 12]
 *   25   | *        | [9, 8, 8]   | [9, 8, 8]       | [12, 12, 1] (sym→11,2)
 *   28   | yes      | [12,12,+4F] | [10, 9, 9]      | [12, 12, +4F]
 *   28   | no       | [10, 9, 9]  | [10, 9, 9]      | [12, 12, 4]
 *   30   | yes      | [10, 10, 10]| [10, 10, 10]    | [12, 12, 6]
 *   36   | *        | [12, 12, 12]| [12, 12, 12]    | [12, 12, 12]
 *
 *   Здесь `+NF` означает combined-мастер: N портретов сверху + 1 общее
 *   фото снизу. Это потребляет 1 свободный full_class.
 *
 * См. также: тесты в __tests__/distribution.test.ts (16+ кейсов).
 */

export type DistributionMode = 'auto' | 'equalize' | 'greedy';

/**
 * Одна страница в результате распределения. Тип определяет какой мастер
 * использовать в `buildGrid()`:
 *   - 'grid' → baseMaster (например N-Grid-Page) с `count` учениками,
 *     остальные слоты null. Если count < slotsPerPage — применяется
 *     centerLastRowSlots для аккуратного размещения.
 *   - 'combined' → combinedMaster (например N-Combined-Page) с `count`
 *     учениками сверху + 1 общее фото снизу. Потребляет 1 full_class.
 */
export interface DistributionPage {
  type: 'grid' | 'combined';
  count: number;
}

export interface DistributionInput {
  /** Количество учеников. */
  N: number;
  /** Слотов на полной странице базового мастера (12 для Mini, 6 для Light). */
  maxGrid: number;
  /** Слотов в combined-мастере (4 для N-Combined, 3 для L-Combined). null = нет. */
  combinedCapacity: number | null;
  /** Есть ли свободное общее фото full_class. */
  hasClassPhoto: boolean;
  /** Режим из albums.student_distribution. */
  mode: DistributionMode;
}

export interface DistributionResult {
  /** Список страниц в порядке размещения. */
  pages: DistributionPage[];
  /** Допустима ли legacy-симметризация хвоста (только для mode='greedy'). */
  symmetrizable: boolean;
  /** Warnings уровня alg (не строго required, могут быть пустыми). */
  warnings: string[];
}

/**
 * Решает как разложить учеников по страницам. Без сайд-эффектов.
 */
export function decideDistribution(input: DistributionInput): DistributionResult {
  const { N, maxGrid, combinedCapacity, hasClassPhoto, mode } = input;

  // Граничные случаи.
  if (N <= 0) {
    return { pages: [], symmetrizable: false, warnings: [] };
  }
  if (maxGrid < 1) {
    return {
      pages: [],
      symmetrizable: false,
      warnings: [`distribution_invalid_maxGrid: ${maxGrid}`],
    };
  }

  // Режим greedy — старое поведение.
  if (mode === 'greedy') {
    return greedyDistribution(N, maxGrid, combinedCapacity, hasClassPhoto);
  }

  // Режим equalize — всегда равномерно, без combined-tail.
  if (mode === 'equalize') {
    return equalizeDistribution(N, maxGrid);
  }

  // Режим auto (default).
  return autoDistribution(N, maxGrid, combinedCapacity, hasClassPhoto);
}

// ─── Реализации режимов ────────────────────────────────────────────

/**
 * Жадное распределение (старая логика).
 * Полные страницы → maxGrid; хвост → отдельная страница (grid или combined).
 */
function greedyDistribution(
  N: number,
  maxGrid: number,
  combinedCapacity: number | null,
  hasClassPhoto: boolean,
): DistributionResult {
  const fullPages = Math.floor(N / maxGrid);
  const remainder = N % maxGrid;
  const pages: DistributionPage[] = [];

  for (let i = 0; i < fullPages; i++) {
    pages.push({ type: 'grid', count: maxGrid });
  }

  if (remainder > 0) {
    // Combined-tail если применимо.
    if (
      combinedCapacity !== null &&
      remainder <= combinedCapacity &&
      hasClassPhoto
    ) {
      pages.push({ type: 'combined', count: remainder });
    } else {
      pages.push({ type: 'grid', count: remainder });
    }
  }

  // Симметризация (legacy-фича) разрешена только в greedy.
  return { pages, symmetrizable: true, warnings: [] };
}

/**
 * Равномерное распределение по всем страницам, без combined-tail.
 * Алгоритм «лишние в начало» (для N=28, pagesNeeded=3, base=9, extras=1 → [10,9,9]).
 */
function equalizeDistribution(N: number, maxGrid: number): DistributionResult {
  // Если влезает в одну страницу — просто одна.
  if (N <= maxGrid) {
    return {
      pages: [{ type: 'grid', count: N }],
      symmetrizable: false,
      warnings: [],
    };
  }

  // Если N кратно maxGrid — все страницы полные.
  if (N % maxGrid === 0) {
    const pages: DistributionPage[] = [];
    for (let i = 0; i < N / maxGrid; i++) {
      pages.push({ type: 'grid', count: maxGrid });
    }
    return { pages, symmetrizable: false, warnings: [] };
  }

  // Равномерное распределение.
  const pagesNeeded = Math.ceil(N / maxGrid);
  const basePerPage = Math.floor(N / pagesNeeded);
  const extras = N - basePerPage * pagesNeeded;
  const pages: DistributionPage[] = [];
  for (let i = 0; i < pagesNeeded; i++) {
    pages.push({ type: 'grid', count: basePerPage + (i < extras ? 1 : 0) });
  }
  return { pages, symmetrizable: false, warnings: [] };
}

/**
 * Умное распределение (mode='auto').
 *
 *   1) N кратно maxGrid → жадно (ровно).
 *   2) N ≤ maxGrid → одна страница.
 *   3) Есть фото И есть combined → пробуем combined-tail + equalize.
 *      Ищем средний X из допустимых.
 *   4) Fallback → чистый equalize.
 */
function autoDistribution(
  N: number,
  maxGrid: number,
  combinedCapacity: number | null,
  hasClassPhoto: boolean,
): DistributionResult {
  // 1. Ровное деление.
  if (N % maxGrid === 0) {
    const pages: DistributionPage[] = [];
    for (let i = 0; i < N / maxGrid; i++) {
      pages.push({ type: 'grid', count: maxGrid });
    }
    return { pages, symmetrizable: false, warnings: [] };
  }

  // 2. Одна страница.
  if (N <= maxGrid) {
    return {
      pages: [{ type: 'grid', count: N }],
      symmetrizable: false,
      warnings: [],
    };
  }

  // 3. Combined-tail если возможен.
  if (hasClassPhoto && combinedCapacity !== null && combinedCapacity >= 1) {
    const pagesNeeded = Math.ceil(N / maxGrid);
    // Ищем все X (1..combinedCapacity) при которых первые (pagesNeeded-1)
    // страниц могут вместить (N-X) учеников по ≤ maxGrid на странице.
    const candidates: number[] = [];
    for (let X = 1; X <= combinedCapacity; X++) {
      const remaining = N - X;
      if (remaining <= 0) continue;
      // pagesNeeded == 1 невозможно здесь (N > maxGrid), так что pagesNeeded-1 >= 1.
      const perPage = Math.ceil(remaining / (pagesNeeded - 1));
      if (perPage <= maxGrid) {
        candidates.push(X);
      }
    }

    if (candidates.length > 0) {
      // Средний X (Сергей: «средний — балансировано», N=13 → X=3 из [1,2,3,4]).
      const X = candidates[Math.floor(candidates.length / 2)];
      const remaining = N - X;
      const basePerPage = Math.floor(remaining / (pagesNeeded - 1));
      const extras = remaining - basePerPage * (pagesNeeded - 1);
      const pages: DistributionPage[] = [];
      for (let i = 0; i < pagesNeeded - 1; i++) {
        pages.push({ type: 'grid', count: basePerPage + (i < extras ? 1 : 0) });
      }
      pages.push({ type: 'combined', count: X });
      return { pages, symmetrizable: false, warnings: [] };
    }
    // candidates пусто — combined не подходит, идём в equalize.
  }

  // 4. Fallback: чистый equalize.
  return equalizeDistribution(N, maxGrid);
}
