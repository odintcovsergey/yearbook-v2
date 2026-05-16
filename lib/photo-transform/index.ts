/**
 * lib/photo-transform — Контент-редактор фото (фаза КЭ).
 *
 * Единый источник правды для логики scale + offset фото внутри
 * photo-placeholder. Используется в трёх местах:
 *
 *   1. AlbumSpreadCanvas.PhotoSlot (Konva preview/editor)
 *   2. lib/pdf-export/photo-embed.ts (sharp.extract для PDF)
 *   3. (через них) превью в LayoutPreviewStrip (дочерний AlbumSpreadCanvas)
 *
 * Хранение: служебные ключи в album_layouts.spreads[].data:
 *   __scale__<label>   = "1.0" .. "2.0"            (1.0 = базовый cover crop)
 *   __offset__<label>  = "x,y" где x,y ∈ [-1, 1]   (0,0 = центрирование)
 *
 * Семантика как у существующих __hidden__<label> / __pos__<label> —
 * адаптер AlbumLayout→BuildResult (normalizeBindings) пропускает их
 * как обычные string значения.
 *
 * Default = отсутствие ключа → scale=1.0, offset=(0,0) → текущее
 * cover-crop поведение через getCoverCrop. Обратная совместимость 100%.
 *
 * См. docs/phase-content-edit-spec.md v1.1.
 */

/** Coordinates of the crop in the natural (source image) pixel space. */
export type CropParams = {
  /** Top-left X of crop in source image (px). */
  cropX: number;
  /** Top-left Y of crop in source image (px). */
  cropY: number;
  /** Width of crop in source (px). */
  cropW: number;
  /** Height of crop in source (px). */
  cropH: number;
};

/** Min/max bounds для scale. См. ТЗ v1.1 — решение #2: max 200%. */
export const SCALE_MIN = 1.0;
export const SCALE_MAX = 2.0;

/** Min/max bounds для offset (-1..1 в долях свободного пространства). */
export const OFFSET_MIN = -1.0;
export const OFFSET_MAX = 1.0;

/**
 * Вычисляет CropParams для photo внутри photo-placeholder с учётом
 * scale + offset transform.
 *
 * Алгоритм:
 *   1. Базовый cover crop (как getCoverCrop): обрезаем по короткой
 *      стороне изображения чтобы получился прямоугольник с target ratio.
 *   2. Применяем scale: crop становится в 1/scale меньше (зум-in).
 *   3. Применяем offset: центр crop смещается на
 *      (offsetX * remainingW, offsetY * remainingH), где remaining —
 *      разница между натуральным изображением и финальным crop.
 *
 * Граничные случаи:
 *   - scale clamped to [SCALE_MIN, SCALE_MAX]
 *   - offset clamped to [OFFSET_MIN, OFFSET_MAX]
 *   - naturalW или naturalH <= 0 → возвращаем (0,0,0,0)
 *   - targetRatio <= 0 → возвращаем (0,0,0,0)
 *
 * @param naturalW    Натуральная ширина исходного изображения (px)
 * @param naturalH    Натуральная высота исходного изображения (px)
 * @param targetRatio Отношение width/height фрейма-получателя
 * @param scale       Коэффициент масштабирования (1.0 = baseline cover)
 * @param offsetX     Сдвиг по X в долях [-1, 1]
 * @param offsetY     Сдвиг по Y в долях [-1, 1]
 */
export function computeCrop(
  naturalW: number,
  naturalH: number,
  targetRatio: number,
  scale: number,
  offsetX: number,
  offsetY: number,
): CropParams {
  if (naturalW <= 0 || naturalH <= 0 || targetRatio <= 0) {
    return { cropX: 0, cropY: 0, cropW: 0, cropH: 0 };
  }

  const s = clamp(scale, SCALE_MIN, SCALE_MAX);
  const ox = clamp(offsetX, OFFSET_MIN, OFFSET_MAX);
  const oy = clamp(offsetY, OFFSET_MIN, OFFSET_MAX);

  // Шаг 1: базовый cover crop (по короткой стороне).
  const imageRatio = naturalW / naturalH;
  let baseCropW: number;
  let baseCropH: number;
  if (imageRatio > targetRatio) {
    // Изображение шире чем фрейм → срезаем боковины
    baseCropH = naturalH;
    baseCropW = naturalH * targetRatio;
  } else {
    // Изображение выше чем фрейм → срезаем верх/низ
    baseCropW = naturalW;
    baseCropH = naturalW / targetRatio;
  }

  // Шаг 2: scale. cropW/H уменьшаются в s раз.
  const cropW = baseCropW / s;
  const cropH = baseCropH / s;

  // Шаг 3: offset. Центр crop смещается. Свободное пространство:
  // remainingW = naturalW - cropW (сколько ещё можно подвинуть)
  const remainingW = naturalW - cropW;
  const remainingH = naturalH - cropH;

  // offset=0 → центрирование. offset=1 → крайнее правое/нижнее положение.
  // offset=-1 → крайнее левое/верхнее.
  // Центр без offset: cropX = remainingW / 2
  // Сдвиг: cropX = remainingW/2 + (offsetX * remainingW/2)
  //              = remainingW * (1 + offsetX) / 2
  const cropX = (remainingW * (1 + ox)) / 2;
  const cropY = (remainingH * (1 + oy)) / 2;

  return { cropX, cropY, cropW, cropH };
}

/**
 * Парсит scale из data-значения. Возвращает 1.0 (baseline) для
 * undefined/null/некорректных входов, иначе clamp в [SCALE_MIN, SCALE_MAX].
 *
 * Принимает string (из data) или number (defensive).
 */
export function parseScale(v: unknown): number {
  if (v === null || v === undefined) return 1;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 1;
  return clamp(n, SCALE_MIN, SCALE_MAX);
}

/**
 * Парсит offset из data-значения формата "x,y". Возвращает [0, 0]
 * (центрирование) для undefined/null/некорректных входов, иначе clamp
 * каждой координаты в [OFFSET_MIN, OFFSET_MAX].
 */
export function parseOffset(v: unknown): [number, number] {
  if (typeof v !== 'string') return [0, 0];
  const parts = v.split(',').map((x) => Number(x.trim()));
  if (parts.length !== 2) return [0, 0];
  const [x, y] = parts;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return [0, 0];
  return [clamp(x, OFFSET_MIN, OFFSET_MAX), clamp(y, OFFSET_MIN, OFFSET_MAX)];
}

/**
 * Сериализует scale в string для записи в data.
 * Округляем до 3 знаков после запятой — большая точность не нужна,
 * слайдер UI step=0.01 (1%), плюс защита от плавающей точки JS.
 */
export function serializeScale(scale: number): string {
  const s = clamp(scale, SCALE_MIN, SCALE_MAX);
  return s.toFixed(3).replace(/\.?0+$/, '');
}

/**
 * Сериализует offset в string "x,y" для записи в data.
 * Округляем до 3 знаков (порядка пикселя на стандартных размерах).
 */
export function serializeOffset(x: number, y: number): string {
  const xs = clamp(x, OFFSET_MIN, OFFSET_MAX).toFixed(3).replace(/\.?0+$/, '');
  const ys = clamp(y, OFFSET_MIN, OFFSET_MAX).toFixed(3).replace(/\.?0+$/, '');
  return `${xs},${ys}`;
}

/**
 * Возвращает true если transform отличается от default (=1.0, =0,0).
 * Используется для индикации "Кадрирован вручную" (КЭ.6).
 */
export function hasCustomTransform(scale: number, x: number, y: number): boolean {
  return scale !== 1 || x !== 0 || y !== 0;
}

/** Standard utility — clamp number в диапазон [min, max]. */
function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}
