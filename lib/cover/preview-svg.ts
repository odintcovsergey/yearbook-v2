/**
 * SVG-превью обложки — Этап 5 (ТЗ docs/tz-cover-design.md).
 *
 * Чистая функция (без React/Konva/DOM, тестируется в vitest): рисует полотно
 * обложки под реальный корешок — три зоны (задняя | корешок | передняя),
 * границы зон, фото-слоты и тексты. Если переданы данные сборки (data из
 * CoverInstance) — показывает реальное содержимое (фото через <image>, текст),
 * иначе серые заглушки слотов.
 *
 * Аналог lib/album-builder/render-preview-svg.ts, но для трёхзонной обложки.
 */

import type {
  DecorationPlaceholder,
  PhotoPlaceholder,
  RenderPlaceholder,
  TextPlaceholder,
} from '../album-builder/types';
import { resolveCoverBackground } from './editor-merge';

const SLOT_FILL = '#d1d5db'; // gray-300
const PAGE_BORDER = '#9ca3af'; // gray-400
const ZONE_GUIDE = '#c4b5fd'; // violet-300 — пунктир границ корешка
const TEXT_COLOR = '#374151'; // gray-700
const PAGE_BORDER_WIDTH_MM = 0.3;
const ZONE_GUIDE_WIDTH_MM = 0.4;

export type CoverPreviewInput = {
  width_mm: number;
  height_mm: number;
  spine_left_mm: number;
  spine_right_mm: number;
  /** Слоты обложки. Декор (type='decoration') рисуется по слою under/over/fg. */
  placeholders: RenderPlaceholder[];
  /** Данные сборки (label → URL фото или текст). Пусто = заглушки слотов. */
  data?: Record<string, string | null>;
  /** Фон обложки на всё полотно (covers.background_url). */
  background_url?: string | null;
  /**
   * Скрывать пустые слоты (без данных) вместо серых заглушек. true для превью
   * собранного альбома (реальная обложка), false для библиотечного превью.
   */
  hide_empty_slots?: boolean;
};

/**
 * Рендерит SVG-превью полотна обложки. viewBox — в миллиметрах, масштаб через
 * CSS контейнера. Готово для dangerouslySetInnerHTML.
 *
 * Порядок слоёв: фон → декор under → слоты (фото/текст) → декор over/foreground
 * → пунктир границ корешка (всегда сверху, чтобы был виден плавающий корешок).
 */
export function renderCoverPreviewSvg(input: CoverPreviewInput): string {
  const {
    width_mm: w,
    height_mm: h,
    spine_left_mm,
    spine_right_mm,
    placeholders,
    data,
    background_url,
    hide_empty_slots,
  } = input;

  // Ручное скрытие элемента: ключ `__hidden__<label>` в data. Отличается от
  // авто-скрытия пустых (hide_empty_slots) — гасит даже заполненный элемент.
  const isHidden = (label: string): boolean => !!data?.[`__hidden__${label}`];

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${fmt(w)} ${fmt(h)}" preserveAspectRatio="xMidYMid meet">`,
  );

  // Полотно целиком.
  parts.push(
    `<rect x="0" y="0" width="${fmt(w)}" height="${fmt(h)}" fill="white" stroke="${PAGE_BORDER}" stroke-width="${fmt(PAGE_BORDER_WIDTH_MM)}"/>`,
  );

  // Фон обложки на всё полотно (cover-crop). Правка `__bg__` перекрывает мастер.
  const bg = resolveCoverBackground(data, background_url);
  if (bg) {
    parts.push(
      `<image ${imgHref(bg)} x="0" y="0" width="${fmt(w)}" height="${fmt(h)}" preserveAspectRatio="xMidYMid slice"/>`,
    );
  }

  // Декор под слотами.
  for (const ph of placeholders) {
    if (ph.type === 'decoration' && ph.layer === 'under' && !isHidden(ph.label)) {
      parts.push(renderDecor(ph as DecorationPlaceholder));
    }
  }

  // Слоты (фото/текст).
  for (const ph of placeholders) {
    if ((ph.type === 'photo' || ph.type === 'text') && !isHidden(ph.label)) {
      parts.push(renderPlaceholder(ph, data, hide_empty_slots ?? false));
    }
  }

  // Декор поверх слотов (over + передний план).
  for (const ph of placeholders) {
    if (
      ph.type === 'decoration' &&
      (ph.layer === 'over' || ph.layer === 'foreground') &&
      !isHidden(ph.label)
    ) {
      parts.push(renderDecor(ph as DecorationPlaceholder));
    }
  }

  // Границы зоны корешка (пунктир) — наглядно показывают плавающий корешок.
  parts.push(zoneGuide(spine_left_mm, h));
  parts.push(zoneGuide(spine_right_mm, h));

  parts.push('</svg>');
  return parts.join('');
}

/** Декор-картинка (привязанный/передний план) — рисуется в своей рамке. */
function renderDecor(ph: DecorationPlaceholder): string {
  if (!ph.url) return '';
  const { x_mm: x, y_mm: y, width_mm: w, height_mm: h } = ph;
  const rotation = ph.rotation_deg ?? 0;
  const transform = rotation !== 0
    ? ` transform="rotate(${fmt(rotation)} ${fmt(x + w / 2)} ${fmt(y + h / 2)})"`
    : '';
  return `<image ${imgHref(ph.url)} x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" preserveAspectRatio="xMidYMid meet"${transform}/>`;
}

function zoneGuide(x: number, h: number): string {
  return `<line x1="${fmt(x)}" y1="0" x2="${fmt(x)}" y2="${fmt(h)}" stroke="${ZONE_GUIDE}" stroke-width="${fmt(ZONE_GUIDE_WIDTH_MM)}" stroke-dasharray="2 1.5"/>`;
}

function renderPlaceholder(
  ph: PhotoPlaceholder | TextPlaceholder,
  data: Record<string, string | null> | undefined,
  hideEmpty: boolean,
): string {
  if (ph.type === 'photo') {
    return renderPhotoSlot(ph, data?.[ph.label] ?? null, hideEmpty);
  }
  return renderTextSlot(ph, data?.[ph.label] ?? null, hideEmpty);
}

function renderPhotoSlot(ph: PhotoPlaceholder, url: string | null, hideEmpty: boolean): string {
  const { x_mm: x, y_mm: y, width_mm: w, height_mm: h } = ph;
  const rotation = ph.rotation_deg ?? 0;
  const transform = rotation !== 0
    ? ` transform="rotate(${fmt(rotation)} ${fmt(x + w / 2)} ${fmt(y + h / 2)})"`
    : '';

  if (!url && hideEmpty) return '';

  // is_circle = овальная рамка (эллипс по габаритам слота, как на Konva-холсте),
  // а НЕ окружность — иначе портрет-овал в превью выглядел кругом.
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = w / 2;
  const ry = h / 2;

  if (url) {
    if (ph.is_circle) {
      const cid = `clip-${slug(ph.label)}`;
      return (
        `<clipPath id="${cid}"><ellipse cx="${fmt(cx)}" cy="${fmt(cy)}" rx="${fmt(rx)}" ry="${fmt(ry)}"/></clipPath>` +
        `<image ${imgHref(url)} x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${cid})"${transform}/>`
      );
    }
    return imageRect(x, y, w, h, url, rotation);
  }

  // Пустой слот — заглушка.
  if (ph.is_circle) {
    return `<ellipse cx="${fmt(cx)}" cy="${fmt(cy)}" rx="${fmt(rx)}" ry="${fmt(ry)}" fill="${SLOT_FILL}"${transform}/>`;
  }
  return `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" fill="${SLOT_FILL}"${transform}/>`;
}

function renderTextSlot(ph: TextPlaceholder, value: string | null, hideEmpty: boolean): string {
  const { x_mm: x, y_mm: y, width_mm: w, height_mm: h } = ph;
  const rotation = ph.rotation_deg ?? 0;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const transform = rotation !== 0
    ? ` transform="rotate(${fmt(rotation)} ${fmt(cx)} ${fmt(cy)})"`
    : '';

  if (!(value && value.trim()) && hideEmpty) return '';

  if (value && value.trim()) {
    // Реальный текст — показываем по центру слота.
    const size = (ph.font_size_pt ?? 12) * 0.3528; // pt → mm
    const fill = ph.color || TEXT_COLOR;
    const family = ph.font_family || 'serif';
    return `<text x="${fmt(cx)}" y="${fmt(cy)}" font-size="${fmt(size)}" font-family="${esc(family)}" fill="${esc(fill)}" text-anchor="middle" dominant-baseline="central"${transform}>${esc(value)}</text>`;
  }

  // Пустой текст — серая линия-заглушка.
  const lineW = w * 0.8;
  const lineH = 1.5;
  return `<rect x="${fmt(x + w * 0.1)}" y="${fmt(cy - lineH / 2)}" width="${fmt(lineW)}" height="${fmt(lineH)}" fill="${SLOT_FILL}"${transform}/>`;
}

function imageRect(x: number, y: number, w: number, h: number, url: string, rotation: number): string {
  const transform = rotation !== 0
    ? ` transform="rotate(${fmt(rotation)} ${fmt(x + w / 2)} ${fmt(y + h / 2)})"`
    : '';
  return `<image ${imgHref(url)} x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" preserveAspectRatio="xMidYMid slice"${transform}/>`;
}

// ─── Утилиты ────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Атрибуты ссылки для <image> в инлайн-SVG — кросс-браузерно и кросс-origin.
 *  - href — современный SVG2 (Chrome/Firefox);
 *  - xlink:href — старый синтаксис (часть версий Safari/WebKit грузит только его);
 *  - crossorigin="anonymous" — заставляет браузер слать заголовок Origin. Иначе
 *    Safari НЕ рисует кросс-origin картинку в инлайн-SVG без CORS-заголовка, а
 *    Timeweb отдаёт Access-Control-Allow-Origin ТОЛЬКО в ответ на запрос с Origin
 *    (supabase слал его всегда — поэтому раньше с supabase-URL фон был виден).
 */
function imgHref(url: string): string {
  const u = esc(url);
  return `href="${u}" xlink:href="${u}" crossorigin="anonymous"`;
}

function slug(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_');
}
