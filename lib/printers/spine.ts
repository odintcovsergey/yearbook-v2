/**
 * Расчёт корешка из профиля типографии (ТЗ tz-printer-entity + tz-printer-profile).
 *
 * Тип листа задаёт режим корешка:
 * - ranges  — lookup по диапазонам «от-до разворотов → мм».
 * - formula — base + step × (разворотов / per_spreads) (напр. Булгак: +1мм/разворот).
 * - fixed   — постоянная ширина (ОкейКнига; Принт Мейтс = 0).
 *
 * Legacy-профили (только spine_ranges, без spine) нормализуются к ranges.
 * Число разворотов даёт countAlbumSheets (lib/cover/album-spine.ts).
 */

import type { PrinterConfig, PrinterSheetType, PrinterSpine } from './types';

/**
 * Приводит тип листа к актуальной форме spine.
 * Старые профили несут только spine_ranges → трактуем как mode='ranges'.
 */
export function normalizeSpine(sheet: PrinterSheetType | null | undefined): PrinterSpine | null {
  if (!sheet) return null;
  if (sheet.spine) return sheet.spine;
  if (sheet.spine_ranges) return { mode: 'ranges', ranges: sheet.spine_ranges };
  return { mode: 'ranges', ranges: [] };
}

/** Корешок по диапазонам (включительные границы); вне диапазонов → null. */
function fromRanges(spine: PrinterSpine, spreadCount: number): number | null {
  for (const r of spine.ranges ?? []) {
    if (spreadCount >= r.min_spreads && spreadCount <= r.max_spreads) {
      return r.spine_mm;
    }
  }
  return null;
}

/**
 * Находит ширину корешка (мм) для числа разворотов в выбранном типе листа,
 * учитывая режим корешка типа листа.
 *
 * - config/типов нет → null.
 * - sheetTypeId не задан / неизвестен → берём первый тип листа.
 * - ranges: число разворотов вне диапазонов → null (UI подскажет добавить).
 * - formula: всегда число.
 * - fixed: возвращает fixed_mm (0 = без корешка).
 */
export function resolveSpineMm(
  config: PrinterConfig | null | undefined,
  sheetTypeId: string | null | undefined,
  spreadCount: number,
): number | null {
  const types = config?.sheet_types ?? [];
  if (types.length === 0) return null;

  const sheet =
    (sheetTypeId ? types.find((t) => t.id === sheetTypeId) : undefined) ?? types[0];
  const spine = normalizeSpine(sheet);
  if (!spine) return null;

  switch (spine.mode) {
    case 'fixed':
      return typeof spine.fixed_mm === 'number' ? spine.fixed_mm : null;
    case 'formula': {
      const f = spine.formula;
      if (!f || f.per_spreads === 0) return null;
      return f.base_mm + f.step_mm * (spreadCount / f.per_spreads);
    }
    case 'ranges':
    default:
      return fromRanges(spine, spreadCount);
  }
}

/**
 * @deprecated Используйте resolveSpineMm — учитывает все режимы корешка.
 * Оставлено для обратной совместимости (делегирует в resolveSpineMm).
 */
export function resolveSpineFromRanges(
  config: PrinterConfig | null | undefined,
  sheetTypeId: string | null | undefined,
  spreadCount: number,
): number | null {
  return resolveSpineMm(config, sheetTypeId, spreadCount);
}
