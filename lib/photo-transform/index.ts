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
 * Min/max bounds для поворота фото (Р.2 — горизонт).
 * ±45° достаточно для типичного use case (выправить заваленный горизонт).
 * Полная переориентация (90°/180°) не предполагается — для этого
 * партнёр поменяет фото через контекстное меню.
 */
export const ROTATE_MIN = -45;
export const ROTATE_MAX = 45;

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
 * Возвращает true если transform отличается от default (=1.0, =0,0, rotate=0).
 * Используется для индикации "Кадрирован вручную" (КЭ.6).
 *
 * Р.2 — параметр rotateDeg необязателен (default 0). При наличии
 * ненулевого rotate тоже считаем что transform не дефолтный.
 */
export function hasCustomTransform(
  scale: number,
  x: number,
  y: number,
  rotateDeg: number = 0,
): boolean {
  return scale !== 1 || x !== 0 || y !== 0 || rotateDeg !== 0;
}

/**
 * Парсит rotate из data-значения (в градусах).
 * Возвращает 0 для undefined/null/некорректных входов, иначе clamp
 * в [ROTATE_MIN, ROTATE_MAX].
 *
 * Принимает string (из data) или number (defensive).
 */
export function parseRotate(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return clamp(n, ROTATE_MIN, ROTATE_MAX);
}

/**
 * Сериализует rotate в string для записи в data.
 * Округляем до 2 знаков (UI step=0.5° достаточно). При значении 0
 * caller должен удалить ключ (см. интерактивный кроп на холсте).
 */
export function serializeRotate(rotateDeg: number): string {
  const r = clamp(rotateDeg, ROTATE_MIN, ROTATE_MAX);
  return r.toFixed(2).replace(/\.?0+$/, '');
}

/**
 * Вычисляет минимальный auto-zoom factor чтобы повёрнутое изображение
 * полностью покрывало рамку без видимых пустых углов.
 *
 * Геометрия: если рамка W×H, и внутри неё стоит изображение, повёрнутое
 * на угол θ, то нужно увеличить изображение в:
 *   factor = |cos θ| + max(W/H, H/W) * |sin θ|
 *
 * При θ=0 factor=1 (без зума). При θ=45° для квадратной рамки
 * factor = √2 ≈ 1.414. Для прямоугольных рамок factor больше.
 *
 * Зум применяется ВДОБАВОК к пользовательскому scale: реальный
 * effective scale = userScale * autoZoomFactor.
 *
 * @param rotateDeg   угол поворота в градусах
 * @param targetRatio aspect ratio рамки (width/height)
 */
export function computeAutoZoomForRotation(
  rotateDeg: number,
  targetRatio: number,
): number {
  if (!Number.isFinite(rotateDeg) || rotateDeg === 0) return 1;
  if (!Number.isFinite(targetRatio) || targetRatio <= 0) return 1;
  const rad = (rotateDeg * Math.PI) / 180;
  const absCos = Math.abs(Math.cos(rad));
  const absSin = Math.abs(Math.sin(rad));
  // max(W/H, H/W) гарантирует что зум покрывает обе стороны рамки.
  const maxRatio = Math.max(targetRatio, 1 / targetRatio);
  return absCos + maxRatio * absSin;
}

/** Standard utility — clamp number в диапазон [min, max]. */
function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}
