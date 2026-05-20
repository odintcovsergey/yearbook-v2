/**
 * Тесты для renderPreviewSvg (РЭ.23.2).
 *
 * Покрывают:
 *  - Одностраничный мастер с одним фото → SVG c page-border + rect
 *  - Двухстраничный мастер → две страницы рядом + сгиб
 *  - Круглая аватарка (is_circle) → <circle>
 *  - Текст-слот → линия 80% ширины placeholder'а
 *  - rotation_deg → transform="rotate(...)"
 *  - Пустые placeholders → только контур страницы
 *  - viewBox в миллиметрах (пропорции страницы)
 *  - Размер SVG-строки разумный (для типичного мастера < 5 KB)
 */

import { describe, it, expect } from 'vitest';
import { renderPreviewSvg } from '../render-preview-svg';
import type {
  Placeholder,
  PhotoPlaceholder,
  TextPlaceholder,
  SpreadTemplate,
} from '../types';

// ─── Фикстуры ────────────────────────────────────────────────────────────────

function photoSlot(opts: {
  x: number;
  y: number;
  w?: number;
  h?: number;
  isCircle?: boolean;
  rotation?: number;
  label?: string;
}): PhotoPlaceholder {
  return {
    label: opts.label ?? 'photo',
    x_mm: opts.x,
    y_mm: opts.y,
    width_mm: opts.w ?? 40,
    height_mm: opts.h ?? 50,
    type: 'photo',
    fit: 'fill_proportional',
    required: false,
    is_circle: opts.isCircle ?? false,
    rotation_deg: opts.rotation,
  };
}

function textSlot(opts: {
  x: number;
  y: number;
  w?: number;
  h?: number;
  rotation?: number;
  label?: string;
}): TextPlaceholder {
  return {
    label: opts.label ?? 'name',
    x_mm: opts.x,
    y_mm: opts.y,
    width_mm: opts.w ?? 60,
    height_mm: opts.h ?? 8,
    type: 'text',
    font_family: 'Arial',
    font_size_pt: 10,
    font_weight: 'regular',
    color: '#000',
    align: 'left',
    vertical_align: 'top',
    auto_fit: false,
    rotation_deg: opts.rotation,
  };
}

function makeTemplate(opts: {
  width_mm?: number;
  height_mm?: number;
  is_spread?: boolean;
  placeholders: Placeholder[];
}): SpreadTemplate {
  return {
    id: 'test-id',
    name: 'TestMaster',
    type: 'common',
    is_spread: opts.is_spread ?? false,
    width_mm: opts.width_mm ?? 200,
    height_mm: opts.height_mm ?? 280,
    placeholders: opts.placeholders,
    rules: null,
    sort_order: 0,
    applies_to_configs: [],
    default_for_configs: [],
    page_role: null,
    slot_capacity: null,
    is_fallback: false,
    mirror_for_soft: false,
    audit_notes: null,
  };
}

// ─── Тесты ──────────────────────────────────────────────────────────────────

describe('renderPreviewSvg (РЭ.23.2)', () => {
  it('Одностраничный мастер с одним фото → SVG с контуром страницы и прямоугольником', () => {
    const template = makeTemplate({
      placeholders: [photoSlot({ x: 20, y: 30 })],
    });
    const svg = renderPreviewSvg(template);

    // Базовая структура
    expect(svg).toMatch(/^<svg /);
    expect(svg).toMatch(/<\/svg>$/);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('viewBox="0 0 200 280"');

    // Контур страницы — один (одностраничный мастер)
    const pageRects = svg.match(/<rect[^>]*fill="white"/g);
    expect(pageRects).not.toBeNull();
    expect(pageRects!.length).toBe(1);

    // Фото-слот: серый rect
    expect(svg).toContain('<rect x="20" y="30" width="40" height="50" fill="#d1d5db"');
  });

  it('Двухстраничный мастер → две страницы рядом + сгиб 4mm', () => {
    // Левая страница: фото в [10,10]. Правая: фото в [210,10] (правая половина).
    const template = makeTemplate({
      is_spread: true,
      width_mm: 200,
      placeholders: [
        photoSlot({ x: 10, y: 10 }),
        photoSlot({ x: 210, y: 10 }),
      ],
    });
    const svg = renderPreviewSvg(template);

    // viewBox = 200*2 + 4 = 404
    expect(svg).toContain('viewBox="0 0 404 280"');

    // Два контура страницы
    const pageRects = svg.match(/<rect[^>]*fill="white"/g);
    expect(pageRects!.length).toBe(2);

    // Левая страница: x=0
    expect(svg).toContain('<rect x="0" y="0" width="200" height="280" fill="white"');
    // Правая страница: x = 200+4 = 204
    expect(svg).toContain('<rect x="204" y="0" width="200" height="280" fill="white"');

    // Фото левой страницы остаётся в x=10
    expect(svg).toContain('<rect x="10" y="10" width="40" height="50" fill="#d1d5db"');
    // Фото правой страницы сдвинуто на gutter: 210 + 4 = 214
    expect(svg).toContain('<rect x="214" y="10" width="40" height="50" fill="#d1d5db"');
  });

  it('Круглая аватарка (is_circle) → <circle>, не <rect>', () => {
    const template = makeTemplate({
      placeholders: [photoSlot({ x: 50, y: 50, w: 40, h: 40, isCircle: true })],
    });
    const svg = renderPreviewSvg(template);

    // Центр: (50+20, 50+20) = (70, 70). Радиус: min(40,40)/2 = 20.
    expect(svg).toContain('<circle cx="70" cy="70" r="20" fill="#d1d5db"');
    // НЕТ <rect> с этими координатами
    expect(svg).not.toContain('<rect x="50" y="50" width="40" height="40" fill="#d1d5db"');
  });

  it('Текст-слот → линия 80% ширины, по центру placeholder-bbox', () => {
    const template = makeTemplate({
      placeholders: [textSlot({ x: 20, y: 100, w: 100, h: 10 })],
    });
    const svg = renderPreviewSvg(template);

    // Текст-линия: ширина = 100*0.8 = 80, x смещён на 10% = 30, y по центру.
    // height=10, y_center = 100 + 10/2 - 1.5/2 = 104.25
    expect(svg).toContain('<rect x="30" y="104.25" width="80" height="1.5" fill="#d1d5db"');
  });

  it('rotation_deg → transform="rotate(...)" вокруг центра placeholder', () => {
    const template = makeTemplate({
      placeholders: [photoSlot({ x: 10, y: 10, w: 40, h: 50, rotation: 45 })],
    });
    const svg = renderPreviewSvg(template);

    // Центр: (10+20, 10+25) = (30, 35)
    expect(svg).toContain('transform="rotate(45 30 35)"');
  });

  it('Пустые placeholders → только контур страницы', () => {
    const template = makeTemplate({ placeholders: [] });
    const svg = renderPreviewSvg(template);
    // Один <rect> (page border) + теги <svg>/</svg>
    const rects = svg.match(/<rect/g);
    expect(rects).not.toBeNull();
    expect(rects!.length).toBe(1);
  });

  it('Grid из 4 учеников: фото + имя для каждого → 8 элементов + 1 контур страницы', () => {
    const placeholders: Placeholder[] = [];
    for (let i = 1; i <= 4; i++) {
      placeholders.push(photoSlot({ x: 10 + (i - 1) * 45, y: 50 }));
      placeholders.push(textSlot({ x: 10 + (i - 1) * 45, y: 110, w: 40, h: 6 }));
    }
    const template = makeTemplate({ placeholders });
    const svg = renderPreviewSvg(template);
    // 1 page border + 4 фото-rect + 4 text-rect = 9 rect'ов
    const rects = svg.match(/<rect/g);
    expect(rects!.length).toBe(9);
  });

  it('Размер SVG-строки разумный (< 5 KB для типичного grid)', () => {
    // 12 учеников + 12 имён + 12 цитат = 36 placeholders. Типичный N-Grid.
    const placeholders: Placeholder[] = [];
    for (let i = 1; i <= 12; i++) {
      placeholders.push(photoSlot({ x: (i % 4) * 50, y: Math.floor(i / 4) * 90 }));
      placeholders.push(textSlot({ x: (i % 4) * 50, y: Math.floor(i / 4) * 90 + 55 }));
      placeholders.push(textSlot({ x: (i % 4) * 50, y: Math.floor(i / 4) * 90 + 65 }));
    }
    const template = makeTemplate({ placeholders });
    const svg = renderPreviewSvg(template);
    expect(svg.length).toBeLessThan(5000);
  });

  it('Числа форматируются без лишних нулей (целые без точки, дробные с округлением)', () => {
    const template = makeTemplate({
      placeholders: [
        photoSlot({ x: 10, y: 20.5, w: 40.123, h: 50 }),
      ],
    });
    const svg = renderPreviewSvg(template);
    // 10 → "10", не "10.00". 20.5 → "20.5". 40.123 → "40.12".
    expect(svg).toContain('x="10"');
    expect(svg).toContain('y="20.5"');
    expect(svg).toContain('width="40.12"');
    expect(svg).toContain('height="50"');
  });
});
