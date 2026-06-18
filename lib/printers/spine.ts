/**
 * Расчёт корешка из диапазонов типографии (ТЗ tz-printer-entity).
 *
 * Заменяет прежнюю формулу «листы × толщина + запас»: теперь корешок — это
 * lookup по диапазонам выбранного типа листа. Число разворотов даёт
 * countAlbumSheets (lib/cover/album-spine.ts).
 */

import type { PrinterConfig } from './types';

/**
 * Находит ширину корешка (мм) для числа разворотов в выбранном типе листа.
 *
 * - config/типов нет → null.
 * - sheetTypeId не задан → берём первый тип листа.
 * - число разворотов не попало ни в один диапазон → null (UI подскажет добавить
 *   диапазон). Не бросаем.
 */
export function resolveSpineFromRanges(
  config: PrinterConfig | null | undefined,
  sheetTypeId: string | null | undefined,
  spreadCount: number,
): number | null {
  const types = config?.sheet_types ?? [];
  if (types.length === 0) return null;

  const sheet =
    (sheetTypeId ? types.find((t) => t.id === sheetTypeId) : undefined) ?? types[0];
  if (!sheet) return null;

  for (const r of sheet.spine_ranges ?? []) {
    if (spreadCount >= r.min_spreads && spreadCount <= r.max_spreads) {
      return r.spine_mm;
    }
  }
  return null;
}
