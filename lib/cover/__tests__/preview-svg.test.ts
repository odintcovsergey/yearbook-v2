import { describe, it, expect } from 'vitest';
import { renderCoverPreviewSvg, type CoverPreviewInput } from '../preview-svg';
import type { Placeholder } from '../../album-builder/types';

function photo(label: string, x: number, isCircle = false): Placeholder {
  return {
    type: 'photo',
    label,
    x_mm: x,
    y_mm: 20,
    width_mm: 60,
    height_mm: 80,
    fit: 'fill_proportional',
    required: false,
    is_circle: isCircle,
  } as unknown as Placeholder;
}

function text(label: string, x: number): Placeholder {
  return {
    type: 'text',
    label,
    x_mm: x,
    y_mm: 130,
    width_mm: 80,
    height_mm: 12,
    font_family: 'PT Serif',
    font_size_pt: 18,
    font_weight: 'regular',
    color: '#222222',
    align: 'center',
    vertical_align: 'middle',
    auto_fit: false,
  } as unknown as Placeholder;
}

const BASE: CoverPreviewInput = {
  width_mm: 420,
  height_mm: 280,
  spine_left_mm: 200,
  spine_right_mm: 220,
  placeholders: [photo('cover_portrait', 280), text('cover_title', 250)],
};

describe('renderCoverPreviewSvg', () => {
  it('содержит viewBox в мм по размеру полотна', () => {
    const svg = renderCoverPreviewSvg(BASE);
    expect(svg).toContain('viewBox="0 0 420 280"');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.trim().endsWith('</svg>')).toBe(true);
  });

  it('рисует пунктирные границы корешка', () => {
    const svg = renderCoverPreviewSvg(BASE);
    expect(svg).toContain('stroke-dasharray');
    expect(svg).toContain('x1="200"');
    expect(svg).toContain('x1="220"');
  });

  it('пустые слоты — серые заглушки', () => {
    const svg = renderCoverPreviewSvg(BASE);
    expect(svg).toContain('#d1d5db'); // заглушка фото/текста
  });

  it('рисует фон обложки на всё полотно (background_url)', () => {
    const svg = renderCoverPreviewSvg({ ...BASE, background_url: 'https://cdn/bg.jpg' });
    expect(svg).toContain('href="https://cdn/bg.jpg"');
    expect(svg).toContain('width="420"');
    expect(svg).toContain('height="280"');
  });

  it('hide_empty_slots: пустые слоты не рисуются (нет серых заглушек)', () => {
    const svg = renderCoverPreviewSvg({ ...BASE, hide_empty_slots: true });
    expect(svg).not.toContain('#d1d5db');
  });

  it('hide_empty_slots не скрывает заполненные слоты', () => {
    const svg = renderCoverPreviewSvg({
      ...BASE,
      hide_empty_slots: true,
      data: { cover_title: 'Выпуск 11А' },
    });
    expect(svg).toContain('Выпуск 11А');
  });

  it('рисует декор-картинку (type=decoration) через <image>', () => {
    const decor = {
      type: 'decoration',
      label: 'cover_title__under',
      layer: 'under',
      attached_to: 'cover_title',
      url: 'https://cdn/ribbon.png',
      x_mm: 240, y_mm: 120, width_mm: 100, height_mm: 30,
      offset_x_mm: 0, offset_y_mm: 0,
    } as unknown as CoverPreviewInput['placeholders'][number];
    const svg = renderCoverPreviewSvg({ ...BASE, placeholders: [...BASE.placeholders, decor] });
    expect(svg).toContain('href="https://cdn/ribbon.png"');
  });

  it('с данными показывает фото через <image> и текст через <text>', () => {
    const svg = renderCoverPreviewSvg({
      ...BASE,
      data: {
        cover_portrait: 'https://cdn/p.jpg',
        cover_title: 'Выпуск 11А',
      },
    });
    expect(svg).toContain('<image');
    expect(svg).toContain('href="https://cdn/p.jpg"');
    expect(svg).toContain('Выпуск 11А');
  });

  it('экранирует спецсимволы в тексте', () => {
    const svg = renderCoverPreviewSvg({
      ...BASE,
      data: { cover_title: 'Маша & <Петя>' },
    });
    expect(svg).toContain('Маша &amp; &lt;Петя&gt;');
    expect(svg).not.toContain('<Петя>');
  });

  it('круглый фото-слот с фото использует clipPath', () => {
    const svg = renderCoverPreviewSvg({
      width_mm: 420,
      height_mm: 280,
      spine_left_mm: 200,
      spine_right_mm: 220,
      placeholders: [photo('back_logo', 50, true)],
      data: { back_logo: 'https://cdn/logo.png' },
    });
    expect(svg).toContain('<clipPath');
    // is_circle = овальная рамка → эллипс по габаритам слота (не круг).
    expect(svg).toContain('<ellipse');
  });
});
