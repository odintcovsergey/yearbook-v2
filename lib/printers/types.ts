/**
 * Сущность «Типография» (ТЗ tz-printer-entity + tz-printer-profile).
 *
 * Профиль типографии хранит данные печати: форматы блока, режим приёма,
 * формат файла, цвет, загибы обложки и типы листов с режимом расчёта корешка.
 *
 * config.printers расширяемый (jsonb): новые поля дозаливаются БЕЗ миграции.
 * Старые профили (только sheet_types[].spine_ranges) продолжают работать —
 * нормализуются к spine.mode='ranges' при чтении (см. lib/printers/spine.ts).
 */

/** Диапазон числа разворотов → ширина корешка (мм). Границы свободные. */
export type SpineRange = {
  min_spreads: number;
  max_spreads: number;
  spine_mm: number;
};

/** Формула корешка: base + step × (разворотов / per_spreads). */
export type SpineFormula = {
  base_mm: number;
  step_mm: number;
  per_spreads: number;
};

/** Режим расчёта корешка типа листа. */
export type SpineMode = 'ranges' | 'formula' | 'fixed';

/**
 * Корешок типа листа: один из трёх режимов.
 * - ranges — таблица «от-до разворотов → мм».
 * - formula — base + step × (разворотов / per_spreads).
 * - fixed — постоянная ширина (0 = без корешка).
 */
export type PrinterSpine = {
  mode: SpineMode;
  ranges?: SpineRange[];
  formula?: SpineFormula;
  fixed_mm?: number;
};

/** Семейство пропорций формата. */
export type FormatFamily = 'vertical_rect' | 'square' | 'horizontal';

/** Формат блока типографии (обрезной размер + рабочая зона + bleed/safe). */
export type PrinterFormat = {
  id: string;
  name: string;            // напр. «21x30»
  family: FormatFamily;
  page_w_mm: number;       // обрезной формат страницы
  page_h_mm: number;
  spread_w_px: number;     // холст разворота @300
  spread_h_px: number;
  work_w_mm: number;       // рабочая зона
  work_h_mm: number;
  bleed_mm: number;
  safe_mm: number;
};

/** Режим приёма файлов типографией. */
export type AcceptMode = 'spread' | 'page';

/** Формат итоговых файлов. */
export type FileFormat = 'jpeg' | 'pdf';

/** Загибы обложки (мм). */
export type CoverFlaps = {
  flap_lr_mm: number;      // загиб слева/справа
  flap_tb_mm: number;      // загиб сверху/снизу
};

/**
 * Тип листа типографии (напр. «с подложкой, плотные») со своим режимом корешка.
 *
 * spine_ranges — устаревшее поле (legacy-профили). При чтении нормализуется к
 * spine.mode='ranges'. Новые профили пишут spine.
 */
export type PrinterSheetType = {
  id: string;
  name: string;
  spine?: PrinterSpine;
  /** @deprecated legacy-профили; нормализуется к spine.mode='ranges'. */
  spine_ranges?: SpineRange[];
};

/** Конфиг типографии (jsonb, расширяемый). */
export type PrinterConfig = {
  sheet_types: PrinterSheetType[];
  formats?: PrinterFormat[];
  accept_mode?: AcceptMode;     // по умолчанию 'spread'
  file_format?: FileFormat;     // по умолчанию 'jpeg'
  color?: string;               // по умолчанию 'srgb'
  cover?: CoverFlaps;
};

/** Строка типографии (для UI/списков). */
export type Printer = {
  id: string;
  tenant_id: string | null;
  is_global: boolean;
  name: string;
  config: PrinterConfig;
};
