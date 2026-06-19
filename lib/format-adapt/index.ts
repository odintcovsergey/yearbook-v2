/**
 * Адаптация макета дизайна под формат типографии (ТЗ 19.06.2026).
 *
 * Чистые функции над геометрией: uniform-масштаб контента (без искажений) +
 * центрирование в целевом формате заказа. Применяется в ПРЕВЬЮ и РЕДАКТОРЕ
 * (см. ./README в ТЗ). Финальный экспорт-рендер — отдельное ТЗ.
 *
 * Принцип: адаптируем сам мастер (размеры + плейсхолдеры) ОДНИМ преобразованием
 * перед подачей в холст. Тогда и превью, и редактор, и обложка подхватывают
 * формат автоматически, а координаты/кроп не ломаются (как layoutCover у обложки).
 *
 * Адаптация только ВНУТРИ одного семейства пропорций. Чужое семейство
 * (квадрат↔прямоугольник) → не адаптируем, отдаём мастер как есть + предупреждение.
 */

import type { SpreadTemplate, Placeholder, RenderPlaceholder } from '../album-builder/types';
import type { FormatFamily, PrinterConfig, PrinterFormat } from '../printers/types';

/** Доля отклонения w/h, в пределах которой формат считаем квадратным (±8%). */
const SQUARE_TOLERANCE = 0.08;

/** Человекочитаемое имя семейства (для предупреждений). */
export const FAMILY_LABELS: Record<FormatFamily, string> = {
  vertical_rect: 'вертикальный',
  square: 'квадратный',
  horizontal: 'горизонтальный',
};

/**
 * Семейство пропорций по размерам страницы.
 *  - w/h > 1+tol → horizontal
 *  - w/h < 1-tol → vertical_rect
 *  - иначе       → square
 */
export function computeFormatFamily(widthMm: number, heightMm: number): FormatFamily {
  if (!(widthMm > 0) || !(heightMm > 0)) return 'vertical_rect';
  const ratio = widthMm / heightMm;
  if (ratio > 1 + SQUARE_TOLERANCE) return 'horizontal';
  if (ratio < 1 - SQUARE_TOLERANCE) return 'vertical_rect';
  return 'square';
}

/**
 * Семейство дизайна: явное `format_family` (если задано в БД) либо вычисленное
 * по пропорции страницы. NULL/undefined → расчёт по page_width/height.
 */
export function resolveDesignFamily(set: {
  page_width_mm: number;
  page_height_mm: number;
  format_family?: FormatFamily | null;
}): FormatFamily {
  return set.format_family ?? computeFormatFamily(set.page_width_mm, set.page_height_mm);
}

/**
 * Формат заказа по id из printers.config.formats[].
 *  - нет конфига/форматов → null;
 *  - formatId не задан → null (родной формат дизайна, без адаптации);
 *  - неизвестный id → null.
 */
export function resolveFormat(
  config: PrinterConfig | null | undefined,
  formatId: string | null | undefined,
): PrinterFormat | null {
  const formats = config?.formats ?? [];
  if (formats.length === 0 || !formatId) return null;
  return formats.find((f) => f.id === formatId) ?? null;
}

/** Положительное число или fallback (защита от нулей-заглушек в форматах). */
function pos(v: number | null | undefined, fallback: number): number {
  return typeof v === 'number' && v > 0 ? v : fallback;
}

/**
 * Масштабирует один плейсхолдер коэффициентом s и сдвигает на (offX, offY) мм.
 * Сохраняет все прочие поля (тип, url декора, эффекты). Все «размерные» поля —
 * геометрия (мм) и кегль/эффекты (pt) — умножаются на s; rotation не трогаем.
 */
function scalePlaceholder<T extends RenderPlaceholder>(
  p: T,
  s: number,
  offX: number,
  offY: number,
): T {
  const out: RenderPlaceholder = {
    ...p,
    x_mm: offX + p.x_mm * s,
    y_mm: offY + p.y_mm * s,
    width_mm: p.width_mm * s,
    height_mm: p.height_mm * s,
  };
  if (out.type === 'text') {
    out.font_size_pt = out.font_size_pt * s;
    if (typeof out.min_size_pt === 'number') out.min_size_pt = out.min_size_pt * s;
    if (typeof out.text_stroke_width_pt === 'number') out.text_stroke_width_pt *= s;
    if (typeof out.text_glow_blur_pt === 'number') out.text_glow_blur_pt *= s;
  } else if (out.type === 'photo') {
    if (typeof out.corner_radius_mm === 'number') out.corner_radius_mm *= s;
    if (typeof out.glow_size_pt === 'number') out.glow_size_pt *= s;
  } else if (out.type === 'decoration') {
    out.offset_x_mm *= s;
    out.offset_y_mm *= s;
  }
  return out as T;
}

export type FormatAdaptResult =
  /** Формат не выбран → рисуем мастер как есть (родной формат дизайна). */
  | { status: 'native'; template: SpreadTemplate; scale: 1 }
  /** Семейство дизайна ≠ семейство формата → не адаптируем, мастер как есть + предупреждение. */
  | { status: 'incompatible'; template: SpreadTemplate; scale: 1; warning: string }
  /** Адаптировано: uniform-масштаб + центрирование под формат заказа. */
  | { status: 'adapted'; template: SpreadTemplate; scale: number };

export type AdaptSource = {
  /** Родной формат дизайна — размеры ОДНОЙ страницы, мм. */
  pageWidthMm: number;
  pageHeightMm: number;
  family: FormatFamily;
};

/**
 * Адаптирует мастер под целевой формат заказа.
 *
 * @param template — мастер дизайна (page или spread по `is_spread`).
 * @param source — родной формат дизайна (размеры страницы + семейство).
 * @param target — формат заказа (PrinterFormat) или null (формат не выбран).
 *
 * Логика:
 *  - target=null → status='native' (мастер как есть).
 *  - семейства разные → status='incompatible' (как есть + warning).
 *  - иначе → uniform-масштаб по меньшему коэффициенту work-зоны + центрирование
 *    в целевом формате; status='adapted'.
 *
 * Масштаб считается ПО СТРАНИЦЕ (для spread берём половину ширины мастера),
 * затем применяется ко всему мастеру. Контент центрируется в целевом холсте
 * (страница, или 2 страницы для spread). Фон рисует холст во всю целевую
 * страницу (навылет) — отдельно от контента, как сейчас.
 */
export function adaptTemplateToFormat(
  template: SpreadTemplate,
  source: AdaptSource,
  target: PrinterFormat | null,
): FormatAdaptResult {
  if (!target) return { status: 'native', template, scale: 1 };

  if (source.family !== target.family) {
    return {
      status: 'incompatible',
      template,
      scale: 1,
      warning:
        `Дизайн ${FAMILY_LABELS[source.family]} не подходит под формат ` +
        `${target.name} (${FAMILY_LABELS[target.family]}) — нужен отдельный дизайн ` +
        `этого семейства. Показан родной формат дизайна.`,
    };
  }

  const isSpread = template.is_spread === true;

  // Родной размер ОДНОЙ страницы. Для spread берём половину ширины мастера.
  const srcPageW = pos(
    isSpread ? template.width_mm / 2 : template.width_mm,
    source.pageWidthMm,
  );
  const srcPageH = pos(template.height_mm, source.pageHeightMm);

  // Целевая страница и work-зона (work=0 у заглушек → фолбэк на размер страницы).
  const tgtPageW = pos(target.page_w_mm, srcPageW);
  const tgtPageH = pos(target.page_h_mm, srcPageH);
  const tgtWorkW = pos(target.work_w_mm, tgtPageW);
  const tgtWorkH = pos(target.work_h_mm, tgtPageH);

  // Uniform-масштаб по меньшему коэффициенту (контент влезает в work-зону).
  const s = Math.min(tgtWorkW / srcPageW, tgtWorkH / srcPageH);

  // Целевой холст мастера (страница или 2 страницы для spread).
  const tgtCanvasW = isSpread ? tgtPageW * 2 : tgtPageW;
  const tgtCanvasH = tgtPageH;

  // Масштабированный размер контента мастера и центрирующий сдвиг.
  const scaledW = template.width_mm * s;
  const scaledH = template.height_mm * s;
  const offX = (tgtCanvasW - scaledW) / 2;
  const offY = (tgtCanvasH - scaledH) / 2;

  const placeholders = (template.placeholders as RenderPlaceholder[]).map((p) =>
    scalePlaceholder(p, s, offX, offY),
  ) as unknown as Placeholder[];

  return {
    status: 'adapted',
    scale: s,
    template: {
      ...template,
      width_mm: tgtCanvasW,
      height_mm: tgtCanvasH,
      placeholders,
    },
  };
}
