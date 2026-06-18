/**
 * Сущность «Типография» (ТЗ tz-printer-entity).
 *
 * Корешок обложки задаётся не толщиной листа, а диапазонами: внутри типа листа
 * — «от N до M разворотов → корешок X мм». Толщина/микроны не нужны.
 *
 * config.printers расширяемый: позже (экспорт в печать) сюда добавятся формат
 * блока, bleed, safe-зона, dpi, режим приёма, схема именования — БЕЗ миграции.
 */

/** Диапазон числа разворотов → ширина корешка (мм). Границы свободные. */
export type SpineRange = {
  min_spreads: number;
  max_spreads: number;
  spine_mm: number;
};

/** Тип листа типографии (напр. «с подложкой, плотные») со своими диапазонами. */
export type PrinterSheetType = {
  id: string;
  name: string;
  spine_ranges: SpineRange[];
};

/** Конфиг типографии. Сейчас только типы листов; расширяется при экспорте. */
export type PrinterConfig = {
  sheet_types: PrinterSheetType[];
};

/** Строка типографии (для UI/списков). */
export type Printer = {
  id: string;
  tenant_id: string | null;
  is_global: boolean;
  name: string;
  config: PrinterConfig;
};
