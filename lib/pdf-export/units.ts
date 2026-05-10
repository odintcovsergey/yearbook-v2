/**
 * Конверсия единиц измерения и расчёт PDF page boxes.
 *
 * Контекст: координаты IDML и наши placeholder'ы в БД хранятся в
 * миллиметрах. PDF использует pt (point, 1/72 inch). pdf-lib
 * принимает координаты в pt.
 *
 * Константа `PT_PER_MM` соответствует Preferences/PointsPerInch=72
 * в IDML "Плотные Мастер Белый" (см. docs/templates/idml-recon-notes.md §1).
 *
 * Для расчёта pixel-разрешения при photo embedding используем формулу
 * из спеки phase-3 §4.1: `pixels = mm × dpi / 25.4`.
 */

import type { PageBoxes } from './types';

/** 1 mm = 72/25.4 pt = 2.83464566929... pt */
export const PT_PER_MM = 72 / 25.4;

/** 1 pt = 25.4/72 mm */
export const MM_PER_PT = 25.4 / 72;

export function mmToPt(mm: number): number {
  return mm * PT_PER_MM;
}

export function ptToMm(pt: number): number {
  return pt * MM_PER_PT;
}

/**
 * Нужное pixel-разрешение фото для печати на trim-размере placeholder'а
 * с заданным dpi. Используется photo embedder'ом (фаза 3.4) для
 * sharp.resize(...).
 *
 * Пример: рамка 80×100 мм @ 300 dpi → 945×1181 px.
 */
export function mmToPixels(mm: number, dpi: number): number {
  return Math.ceil((mm * dpi) / 25.4);
}

/**
 * Расчёт page boxes для PDF страницы.
 *
 * Если `include_bleed=true` — mediaBox = trim + 2×bleed_mm.
 * Если `include_bleed=false` — mediaBox = trim (для preview-профиля).
 *
 * @param trim_width_mm  — `template_set.page_width_mm`
 * @param trim_height_mm — `template_set.page_height_mm`
 * @param bleed_mm       — `template_set.bleed_mm` (5 для okeybook-default)
 * @param include_bleed  — `profile.include_bleed`
 */
export function computePageBoxes(
  trim_width_mm: number,
  trim_height_mm: number,
  bleed_mm: number,
  include_bleed: boolean
): PageBoxes {
  const effectiveBleed = include_bleed ? bleed_mm : 0;
  return {
    trim_width_mm,
    trim_height_mm,
    bleed_mm: effectiveBleed,
    media_width_mm: trim_width_mm + effectiveBleed * 2,
    media_height_mm: trim_height_mm + effectiveBleed * 2,
  };
}

/**
 * Преобразование Y-координаты IDML → PDF.
 *
 * IDML: Y растёт вниз (origin top-left).
 * PDF:  Y растёт вверх (origin bottom-left).
 *
 * Для placeholder'а высотой h на странице высотой H:
 *   pdf_y = H - (idml_y + h)
 *
 * Это применяется к pt-координатам (после mmToPt).
 */
export function flipY(
  pdf_page_height_pt: number,
  idml_y_pt: number,
  height_pt: number
): number {
  return pdf_page_height_pt - (idml_y_pt + height_pt);
}

/**
 * Полный set координат placeholder'а на странице PDF.
 *
 * @param placeholder_x_mm  — x_mm из placeholder
 * @param placeholder_y_mm  — y_mm (от верхнего-левого угла страницы)
 * @param placeholder_w_mm  — width_mm
 * @param placeholder_h_mm  — height_mm
 * @param pageBoxes         — результат computePageBoxes
 *
 * Возвращает PDF-координаты в pt где x/y — нижний-левый угол placeholder'а
 * (требуется pdf-lib для drawImage / drawText / drawRectangle).
 *
 * Учитывает bleed: placeholder.x/y относительно trim, а PDF media_box
 * сдвинут на bleed.
 */
export function placeholderToPdfBox(
  placeholder_x_mm: number,
  placeholder_y_mm: number,
  placeholder_w_mm: number,
  placeholder_h_mm: number,
  pageBoxes: PageBoxes
): { x_pt: number; y_pt: number; width_pt: number; height_pt: number } {
  // Placeholder координаты — относительно trim-зоны страницы.
  // PDF mediaBox начинается на bleed_mm левее и ниже trim.
  // Поэтому добавляем bleed_mm к x и к (page_h_mm - y - h).
  const x_pt = mmToPt(placeholder_x_mm + pageBoxes.bleed_mm);
  const w_pt = mmToPt(placeholder_w_mm);
  const h_pt = mmToPt(placeholder_h_mm);
  const media_h_pt = mmToPt(pageBoxes.media_height_mm);
  // y placeholder'а от верхней границы trim'а; добавляем bleed_mm
  // чтобы получить y от верхней границы media; потом flip.
  const y_from_top_pt = mmToPt(placeholder_y_mm + pageBoxes.bleed_mm);
  const y_pt = media_h_pt - y_from_top_pt - h_pt;
  return { x_pt, y_pt, width_pt: w_pt, height_pt: h_pt };
}

/**
 * Hex-цвет → RGB компоненты в [0, 1] (формат pdf-lib `rgb(r, g, b)`).
 *
 * `#FFFFFF` → { r: 1, g: 1, b: 1 }
 * `#000000` → { r: 0, g: 0, b: 0 }
 *
 * Используется для drawText fillColor.
 */
export function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const cleaned = hex.replace('#', '').trim();
  if (cleaned.length !== 6 && cleaned.length !== 3) {
    return { r: 0, g: 0, b: 0 }; // fallback на чёрный
  }
  const expanded =
    cleaned.length === 3
      ? cleaned[0] + cleaned[0] + cleaned[1] + cleaned[1] + cleaned[2] + cleaned[2]
      : cleaned;
  const r = parseInt(expanded.slice(0, 2), 16);
  const g = parseInt(expanded.slice(2, 4), 16);
  const b = parseInt(expanded.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) {
    return { r: 0, g: 0, b: 0 };
  }
  return { r: r / 255, g: g / 255, b: b / 255 };
}
