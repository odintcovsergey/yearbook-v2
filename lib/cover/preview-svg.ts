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
  Placeholder,
  PhotoPlaceholder,
  TextPlaceholder,
} from '../album-builder/types';

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
  placeholders: Placeholder[];
  /** Данные сборки (label → URL фото или текст). Пусто = заглушки слотов. */
  data?: Record<string, string | null>;
};

/**
 * Рендерит SVG-превью полотна обложки. viewBox — в миллиметрах, масштаб через
 * CSS контейнера. Готово для dangerouslySetInnerHTML.
 */
export function renderCoverPreviewSvg(input: CoverPreviewInput): string {
  const { width_mm: w, height_mm: h, spine_left_mm, spine_right_mm, placeholders, data } = input;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(w)} ${fmt(h)}" preserveAspectRatio="xMidYMid meet">`,
  );

  // Полотно целиком.
  parts.push(
    `<rect x="0" y="0" width="${fmt(w)}" height="${fmt(h)}" fill="white" stroke="${PAGE_BORDER}" stroke-width="${fmt(PAGE_BORDER_WIDTH_MM)}"/>`,
  );

  // Границы зоны корешка (пунктир) — наглядно показывают плавающий корешок.
  parts.push(zoneGuide(spine_left_mm, h));
  parts.push(zoneGuide(spine_right_mm, h));

  // Содержимое.
  for (const ph of placeholders) {
    parts.push(renderPlaceholder(ph, data));
  }

  parts.push('</svg>');
  return parts.join('');
}

function zoneGuide(x: number, h: number): string {
  return `<line x1="${fmt(x)}" y1="0" x2="${fmt(x)}" y2="${fmt(h)}" stroke="${ZONE_GUIDE}" stroke-width="${fmt(ZONE_GUIDE_WIDTH_MM)}" stroke-dasharray="2 1.5"/>`;
}

function renderPlaceholder(
  ph: Placeholder,
  data?: Record<string, string | null>,
): string {
  if (ph.type === 'photo') {
    return renderPhotoSlot(ph, data?.[ph.label] ?? null);
  }
  if (ph.type === 'text') {
    return renderTextSlot(ph, data?.[ph.label] ?? null);
  }
  // Декор и прочее в SVG-превью пропускаем (отрисуется в Konva/PDF).
  return '';
}

function renderPhotoSlot(ph: PhotoPlaceholder, url: string | null): string {
  const { x_mm: x, y_mm: y, width_mm: w, height_mm: h } = ph;
  const rotation = ph.rotation_deg ?? 0;
  const transform = rotation !== 0
    ? ` transform="rotate(${fmt(rotation)} ${fmt(x + w / 2)} ${fmt(y + h / 2)})"`
    : '';

  if (url) {
    if (ph.is_circle) {
      const r = Math.min(w, h) / 2;
      const cid = `clip-${slug(ph.label)}`;
      return (
        `<clipPath id="${cid}"><circle cx="${fmt(x + w / 2)}" cy="${fmt(y + h / 2)}" r="${fmt(r)}"/></clipPath>` +
        `<image href="${esc(url)}" x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${cid})"${transform}/>`
      );
    }
    return imageRect(x, y, w, h, url, rotation);
  }

  // Пустой слот — заглушка.
  if (ph.is_circle) {
    const r = Math.min(w, h) / 2;
    return `<circle cx="${fmt(x + w / 2)}" cy="${fmt(y + h / 2)}" r="${fmt(r)}" fill="${SLOT_FILL}"${transform}/>`;
  }
  return `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" fill="${SLOT_FILL}"${transform}/>`;
}

function renderTextSlot(ph: TextPlaceholder, value: string | null): string {
  const { x_mm: x, y_mm: y, width_mm: w, height_mm: h } = ph;
  const rotation = ph.rotation_deg ?? 0;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const transform = rotation !== 0
    ? ` transform="rotate(${fmt(rotation)} ${fmt(cx)} ${fmt(cy)})"`
    : '';

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
  return `<image href="${esc(url)}" x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" preserveAspectRatio="xMidYMid slice"${transform}/>`;
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

function slug(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_');
}
