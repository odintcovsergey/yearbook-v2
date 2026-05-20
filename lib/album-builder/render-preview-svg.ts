/**
 * РЭ.23.2: автогенерация SVG-превью мастера для каталога / галереи.
 *
 * Чистая функция: принимает SpreadTemplate (мастер из БД), возвращает
 * SVG-строку. Никаких зависимостей от React/Konva/DOM — тестируется
 * в vitest без браузера.
 *
 * Что показывает превью:
 *  - Контур страницы (для двухстраничных мастеров — оба разворота
 *    рядом с промежутком-сгибом 4mm)
 *  - Фото-слоты — серые прямоугольники (или круги для is_circle=true)
 *  - Текст-слоты — серые горизонтальные линии (короче для коротких
 *    подписей с auto_fit=false, длиннее для длинных с auto_fit=true)
 *  - rotation_deg учитывается (через transform="rotate(...)")
 *
 * SVG масштабируется через CSS контейнера (нет фиксированных размеров,
 * только viewBox в миллиметрах).
 *
 * Используется в:
 *  - РЭ.23.3 API endpoint `template_set_list_with_previews`
 *  - РЭ.23.4 страница /super/master-catalog
 *  - РЭ.24 анонс готовых пресетов
 *  - РЭ.25 галерея вариантов в конструкторе
 */

import type {
  Placeholder,
  PhotoPlaceholder,
  TextPlaceholder,
  SpreadTemplate,
} from './types';

// ─── Константы стиля ────────────────────────────────────────────────────────

/** Цвет заливки фото-слотов и текст-линий. Tailwind gray-300. */
const SLOT_FILL = '#d1d5db';

/** Цвет контура страницы. Tailwind gray-400. */
const PAGE_BORDER = '#9ca3af';

/** Промежуток между страницами разворота (mm). */
const SPREAD_GUTTER_MM = 4;

/** Толщина текст-линий (mm). */
const TEXT_LINE_HEIGHT_MM = 1.5;

/** Толщина контура страницы (mm). */
const PAGE_BORDER_WIDTH_MM = 0.3;

// ─── Главная функция ────────────────────────────────────────────────────────

/**
 * Рендерит SVG-превью мастера.
 *
 * Для двухстраничных мастеров (is_spread=true) — обе страницы рядом
 * + сгиб между ними. Координаты placeholders уже в системе
 * двухстраничного разворота (правая страница имеет x_mm > width_mm).
 *
 * Для одностраничных (is_spread=false) — одна страница.
 *
 * @param template Мастер из БД
 * @returns SVG-строка с viewBox в миллиметрах. Готова для встраивания
 *          через dangerouslySetInnerHTML или прямого вывода.
 */
export function renderPreviewSvg(template: SpreadTemplate): string {
  const pageW = template.width_mm;
  const pageH = template.height_mm;
  const isSpread = template.is_spread === true;

  // Полная ширина viewBox: для разворота — две страницы + сгиб.
  // ВНИМАНИЕ: в БД width_mm для двухстраничных мастеров — это ширина
  // ОДНОЙ страницы (правая половина расположена в координатах
  // [width_mm, 2*width_mm]). Поэтому viewBox.width = 2*pageW + gutter.
  const viewBoxW = isSpread ? pageW * 2 + SPREAD_GUTTER_MM : pageW;
  const viewBoxH = pageH;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(viewBoxW)} ${fmt(viewBoxH)}" preserveAspectRatio="xMidYMid meet">`,
  );

  // Контуры страниц
  if (isSpread) {
    // Левая страница: x=0
    parts.push(pageBorder(0, 0, pageW, pageH));
    // Правая страница: x = pageW + gutter (визуально отделена)
    parts.push(pageBorder(pageW + SPREAD_GUTTER_MM, 0, pageW, pageH));
  } else {
    parts.push(pageBorder(0, 0, pageW, pageH));
  }

  // Placeholders
  for (const ph of template.placeholders) {
    parts.push(renderPlaceholder(ph, isSpread, pageW));
  }

  parts.push('</svg>');
  return parts.join('');
}

// ─── Рендер одного placeholder ──────────────────────────────────────────────

function renderPlaceholder(
  ph: Placeholder,
  isSpread: boolean,
  pageW: number,
): string {
  // Для разворотных мастеров: placeholder'ы с x_mm >= pageW визуально
  // находятся на правой странице. Сдвигаем их на SPREAD_GUTTER_MM
  // вправо, чтобы превью имитировало сгиб.
  let x = ph.x_mm;
  if (isSpread && x >= pageW) {
    x += SPREAD_GUTTER_MM;
  }

  if (ph.type === 'photo') {
    return renderPhotoSlot(ph, x);
  }
  return renderTextSlot(ph, x);
}

function renderPhotoSlot(ph: PhotoPlaceholder, x: number): string {
  const w = ph.width_mm;
  const h = ph.height_mm;
  const y = ph.y_mm;
  const rotation = ph.rotation_deg ?? 0;
  const transform = rotation !== 0
    ? ` transform="rotate(${fmt(rotation)} ${fmt(x + w / 2)} ${fmt(y + h / 2)})"`
    : '';

  if (ph.is_circle) {
    // Круг (учительская аватарка). Центр = (x + w/2, y + h/2),
    // радиус = min(w,h)/2.
    const cx = x + w / 2;
    const cy = y + h / 2;
    const r = Math.min(w, h) / 2;
    return `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}" fill="${SLOT_FILL}"${transform}/>`;
  }
  return `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" fill="${SLOT_FILL}"${transform}/>`;
}

function renderTextSlot(ph: TextPlaceholder, x: number): string {
  // Текст-слот рисуем как тонкую горизонтальную линию посередине
  // bounding-box'а placeholder'а. Длина — 80% от ширины placeholder'а
  // (визуально намекает что текст не занимает всю ширину).
  const w = ph.width_mm * 0.8;
  const xCentered = x + ph.width_mm * 0.1;
  const yCentered = ph.y_mm + ph.height_mm / 2 - TEXT_LINE_HEIGHT_MM / 2;
  const rotation = ph.rotation_deg ?? 0;
  const transform = rotation !== 0
    ? ` transform="rotate(${fmt(rotation)} ${fmt(x + ph.width_mm / 2)} ${fmt(ph.y_mm + ph.height_mm / 2)})"`
    : '';
  return `<rect x="${fmt(xCentered)}" y="${fmt(yCentered)}" width="${fmt(w)}" height="${fmt(TEXT_LINE_HEIGHT_MM)}" fill="${SLOT_FILL}"${transform}/>`;
}

// ─── Рамка страницы ─────────────────────────────────────────────────────────

function pageBorder(x: number, y: number, w: number, h: number): string {
  return `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" fill="white" stroke="${PAGE_BORDER}" stroke-width="${fmt(PAGE_BORDER_WIDTH_MM)}"/>`;
}

// ─── Утилиты ────────────────────────────────────────────────────────────────

/**
 * Форматирует число для SVG-атрибута: убирает лишние нули, ограничивает
 * до 2 знаков после запятой. Уменьшает размер SVG-строки.
 */
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}
