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
    expect(svg).toContain('<circle');
  });
});
