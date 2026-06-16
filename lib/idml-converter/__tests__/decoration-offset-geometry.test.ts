/**
 * Геометрическая самокоррекция привязки декора (computeDecorationOffsets).
 *
 * Баг «Аква меч»: ленточки имён в сетке пронумерованы по строкам, а имена —
 * по столбцам, поэтому `studentname_5__under` физически лежит над ячейкой
 * `studentname_6`. Привязка по точному имени давала смещение ±48 мм → при
 * центрировании неполных рядов ленточки разлетались. Фикс: если названный
 * слот НЕ под декором — привязываем к слоту с макс. пересечением bbox.
 */

import { describe, it, expect } from 'vitest';
import { computeDecorationOffsets } from '../extract-geometry';
import type { Placeholder, ParserWarning } from '../types';

type PH = Placeholder & { _pageIndex: number };

function nameSlot(label: string, x: number, y: number): PH {
  return {
    type: 'text',
    label,
    x_mm: x,
    y_mm: y,
    width_mm: 40,
    height_mm: 10,
    font_family: 'Noto Serif',
    font_size_pt: 10,
    font_weight: 'regular',
    color: '#000',
    align: 'center',
    vertical_align: 'top',
    auto_fit: false,
    _pageIndex: 0,
  } as PH;
}

function ribbon(label: string, attached: string, x: number, y: number): PH {
  return {
    type: 'decoration',
    label,
    x_mm: x,
    y_mm: y,
    width_mm: 44,
    height_mm: 14,
    attached_to: attached,
    layer: 'under',
    url: '',
    offset_x_mm: 0,
    offset_y_mm: 0,
    _pageIndex: 0,
  } as PH;
}

describe('computeDecorationOffsets — геометрическая перепривязка', () => {
  it('перепривязывает ленточку к слоту под ней (offset → ~0) + warning', () => {
    // name_5 в колонке 1 (x=22), name_6 в колонке 2 (x=70).
    // Ленточка помечена name_5__under, но нарисована над колонкой 2 (x=70).
    const phs: PH[] = [
      nameSlot('studentname_5', 22, 87),
      nameSlot('studentname_6', 70, 87),
      ribbon('studentname_5__under', 'studentname_5', 70, 86),
    ];
    const warnings: ParserWarning[] = [];
    computeDecorationOffsets(phs, 'N-Grid-Page', warnings);

    const deco = phs.find((p) => p.label === 'studentname_5__under') as any;
    expect(deco.attached_to).toBe('studentname_6'); // перепривязан к ячейке под ним
    expect(deco.offset_x_mm).toBeCloseTo(0, 1); // 70 - 70
    expect(deco.offset_y_mm).toBeCloseTo(-1, 1); // 86 - 87
    expect(warnings.some((w) => /перепривязан/.test(w.message))).toBe(true);
  });

  it('корректную метку НЕ трогает (okeybook): база под декором → без изменений', () => {
    const phs: PH[] = [
      nameSlot('teachername_1', 24, 256),
      ribbon('teachername_1__under', 'teachername_1', 22, 252),
    ];
    const warnings: ParserWarning[] = [];
    computeDecorationOffsets(phs, 'F-Head', warnings);

    const deco = phs.find((p) => p.label === 'teachername_1__under') as any;
    expect(deco.attached_to).toBe('teachername_1'); // не перепривязан
    expect(deco.offset_x_mm).toBeCloseTo(22 - 24, 5);
    expect(deco.offset_y_mm).toBeCloseTo(252 - 256, 5);
    expect(warnings.some((w) => /перепривязан/.test(w.message))).toBe(false);
  });

  it('foreground-декор (attached_to="") не трогается', () => {
    const fg: PH = { ...ribbon('__fg_1', '', 10, 10), layer: 'foreground' } as PH;
    const phs: PH[] = [nameSlot('studentname_1', 22, 87), fg];
    const warnings: ParserWarning[] = [];
    computeDecorationOffsets(phs, 'X', warnings);
    const deco = phs.find((p) => p.label === '__fg_1') as any;
    expect(deco.attached_to).toBe('');
    expect(deco.offset_x_mm).toBe(0);
  });

  it('нет ни одного пересекающегося слота → warning, offset 0', () => {
    const phs: PH[] = [
      nameSlot('studentname_1', 22, 87),
      ribbon('studentname_9__under', 'studentname_9', 500, 500),
    ];
    const warnings: ParserWarning[] = [];
    computeDecorationOffsets(phs, 'X', warnings);
    const deco = phs.find((p) => p.label === 'studentname_9__under') as any;
    expect(deco.offset_x_mm).toBe(0);
    expect(warnings.some((w) => /no matching base slot/.test(w.message))).toBe(true);
  });
});
