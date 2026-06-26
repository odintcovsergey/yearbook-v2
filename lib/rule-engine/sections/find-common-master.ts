/**
 * РЭ.22.9 — семантический выбор мастера общего раздела (by-type вместо by-name).
 *
 * Раньше common/slot-chains выбирали мастер по строковому ИМЕНИ
 * (`mastersByName.get('J-Half')` и т.п.). Теперь — по семантике
 * `page_role='common'` + ёмкости (категория фото = count) + `page_type`
 * (сторона), как уже сделано для students/teachers/soft (master-finder.ts).
 * Дизайн-имена мастеров больше не зашиты в движок.
 *
 * ВАЖНО (идентичность раскладки): функция воспроизводит ПРЕЖНЮЮ by-name
 * приоритизацию стороны через список `pageTypePref`:
 *   - manual-режим (tryStep: rightVariant/base, БЕЗ preferAny):
 *       quarter → [сторона]; остальные → ['page-any'].
 *   - auto-режим (pickAutopackPage: preferAny → rightVariant → base):
 *       quarter → ['page-any', сторона]; остальные → ['page-any'].
 * Возвращает мастер или null (как `mastersByName.get(...)` возвращал undefined).
 *
 * Чистая, без БД — юнит-тестируется.
 */

import type { SpreadTemplate } from '@/lib/album-builder/types';
import type { CommonPhotoCounts } from '../slot-chains';

export type CommonPageType = 'page-any' | 'page-left' | 'page-right';

/** Категория общего фото → ключ ёмкости в slot_capacity мастера. */
const CATEGORY_TO_CAPACITY_KEY: Record<keyof CommonPhotoCounts, string> = {
  full_class: 'photos_full',
  half_class: 'photos_half',
  quarter: 'photos_quarter',
  sixth: 'photos_sixth',
  collage: 'photos_collage',
};

/**
 * Сторона из канонического имени слот-мастера (для manual-режима, где tryStep
 * уже зашил сторону в имя через rightVariant/base). `-Left`→page-left,
 * `-Right`→page-right, иначе page-any. Это НЕ чтение дизайна — это разбор
 * внутреннего словаря движка; сам мастер выбирается потом по типу.
 */
export function pageTypeFromName(masterName: string): CommonPageType {
  if (masterName.endsWith('-Left')) return 'page-left';
  if (masterName.endsWith('-Right')) return 'page-right';
  return 'page-any';
}

/**
 * Найти мастер общего раздела по типу. Перебирает мастера дизайна
 * (`mastersByName`), фильтрует по page_role='common' + ёмкости + page_type
 * из списка-приоритета (первый совпавший page_type выигрывает). Исключает
 * is_spread (J-Spread выбирается отдельным путём, не слотами; к тому же его
 * page_type='spread' и так не входит в pref).
 */
export function findCommonMaster(
  mastersByName: ReadonlyMap<string, SpreadTemplate>,
  category: keyof CommonPhotoCounts,
  count: number,
  pageTypePref: readonly CommonPageType[],
): SpreadTemplate | null {
  const capKey = CATEGORY_TO_CAPACITY_KEY[category];
  const masters = Array.from(mastersByName.values());
  for (const pt of pageTypePref) {
    for (const m of masters) {
      if (m.page_role !== 'common') continue;
      if (m.is_spread) continue;
      const cap = m.slot_capacity as Record<string, number> | null | undefined;
      if (!cap || (cap[capKey] ?? 0) !== count) continue;
      if ((m.page_type ?? 'page-any') === pt) return m;
    }
  }
  return null;
}
