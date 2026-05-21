/**
 * РЭ.28: пересчёт координат и размера одного placeholder при изменении
 * размера страницы partner-клона.
 *
 * Контракт:
 * - x_mm, y_mm, width_mm, height_mm — умножаются на соответствующий scale
 *   (X или Y) и округляются до целого пикселя при 300 DPI.
 * - Остальные поля (rotation_deg, label, type, fit, original_label,
 *   required, ...) копируются как есть.
 * - Возвращает НОВЫЙ объект — не мутирует входной.
 *
 * Чистая функция, без зависимостей от Supabase.
 */

import { roundMmToPx } from './round-to-pixels';

/**
 * Минимальный контракт placeholder'а, который мы умеем resize'ить.
 * В реальных данных Supabase у placeholder'а много дополнительных полей
 * (label, type, fit, original_label, required, ...) — мы их копируем
 * через spread без обработки.
 */
type ResizablePlaceholder = {
  x_mm: number;
  y_mm: number;
  width_mm: number;
  height_mm: number;
  [key: string]: unknown;
};

/**
 * Resize одного placeholder с округлением до пикселей.
 *
 * scaleX, scaleY — коэффициенты по соответствующим осям:
 *   scaleX = newPageWidth / oldPageWidth
 *   scaleY = newPageHeight / oldPageHeight
 *
 * Если pages не меняются (1:1), вернёт объект с теми же mm-значениями
 * (с поправкой на округление до пикселей).
 */
export function resizePlaceholder<P extends ResizablePlaceholder>(
  placeholder: P,
  scaleX: number,
  scaleY: number,
): P {
  return {
    ...placeholder,
    x_mm: roundMmToPx(placeholder.x_mm * scaleX),
    y_mm: roundMmToPx(placeholder.y_mm * scaleY),
    width_mm: roundMmToPx(placeholder.width_mm * scaleX),
    height_mm: roundMmToPx(placeholder.height_mm * scaleY),
  };
}
