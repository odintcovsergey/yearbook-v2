/**
 * Тесты lib/text-style (Р.3).
 *
 * Покрытие:
 *   - parseFontSizeMult: null/undefined/некорректные → 1.0, clamp в диапазон
 *   - serializeFontSizeMult: clamp + округление
 *   - parseColor: 3-/6-значный HEX, с # и без, регистр, мусор → null
 *   - serializeColor: round-trip и null pass-through
 *   - isColorInPalette: case-insensitive
 *   - hasCustomTextStyle: default detection
 */

import { describe, it, expect } from 'vitest';
import {
  parseFontSizeMult,
  serializeFontSizeMult,
  parseColor,
  serializeColor,
  isColorInPalette,
  hasCustomTextStyle,
  TEXT_STYLE_PALETTE,
  FONT_SIZE_MULT_MIN,
  FONT_SIZE_MULT_MAX,
} from '../index';

describe('parseFontSizeMult', () => {
  it('null/undefined → 1.0', () => {
    expect(parseFontSizeMult(null)).toBe(1.0);
    expect(parseFontSizeMult(undefined)).toBe(1.0);
  });

  it('некорректные значения → 1.0', () => {
    expect(parseFontSizeMult('garbage')).toBe(1.0);
    expect(parseFontSizeMult(NaN)).toBe(1.0);
    expect(parseFontSizeMult('')).toBe(1.0);
  });

  it('валидные значения проходят как есть', () => {
    expect(parseFontSizeMult(1.5)).toBe(1.5);
    expect(parseFontSizeMult('0.75')).toBe(0.75);
    expect(parseFontSizeMult(1)).toBe(1);
  });

  it('clamp [0.5, 2.0]', () => {
    expect(parseFontSizeMult(10)).toBe(FONT_SIZE_MULT_MAX);
    expect(parseFontSizeMult(0.1)).toBe(FONT_SIZE_MULT_MIN);
    expect(parseFontSizeMult(-5)).toBe(FONT_SIZE_MULT_MIN);
  });
});

describe('serializeFontSizeMult', () => {
  it('тривиальные значения', () => {
    expect(serializeFontSizeMult(1)).toBe('1');
    expect(serializeFontSizeMult(1.5)).toBe('1.5');
    expect(serializeFontSizeMult(0.75)).toBe('0.75');
  });

  it('clamp', () => {
    expect(serializeFontSizeMult(100)).toBe('2');
    expect(serializeFontSizeMult(0)).toBe('0.5');
  });

  it('убирает trailing zeros', () => {
    expect(serializeFontSizeMult(1.5)).toBe('1.5');
    expect(serializeFontSizeMult(1.0)).toBe('1');
  });
});

describe('parseColor', () => {
  it('#RRGGBB → возвращает как есть в верхнем регистре', () => {
    expect(parseColor('#ff0000')).toBe('#FF0000');
    expect(parseColor('#1f4e79')).toBe('#1F4E79');
    expect(parseColor('#FFFFFF')).toBe('#FFFFFF');
  });

  it('RRGGBB без # → добавляет', () => {
    expect(parseColor('ff0000')).toBe('#FF0000');
    expect(parseColor('1F4E79')).toBe('#1F4E79');
  });

  it('#RGB → расширяет', () => {
    expect(parseColor('#f00')).toBe('#FF0000');
    expect(parseColor('#abc')).toBe('#AABBCC');
    expect(parseColor('abc')).toBe('#AABBCC');
  });

  it('null/undefined/мусор → null', () => {
    expect(parseColor(null)).toBe(null);
    expect(parseColor(undefined)).toBe(null);
    expect(parseColor('')).toBe(null);
    expect(parseColor('garbage')).toBe(null);
    expect(parseColor('#GGHHII')).toBe(null);
    expect(parseColor('#12345')).toBe(null); // 5 знаков
    expect(parseColor(123)).toBe(null);
  });

  it('пробелы trim', () => {
    expect(parseColor('  #FF0000  ')).toBe('#FF0000');
  });
});

describe('serializeColor', () => {
  it('round-trip через parseColor', () => {
    expect(serializeColor('#ff0000')).toBe('#FF0000');
    expect(serializeColor('abc')).toBe('#AABBCC');
  });

  it('null pass-through', () => {
    expect(serializeColor(null)).toBe(null);
  });

  it('некорректный hex → null', () => {
    expect(serializeColor('not-hex')).toBe(null);
  });
});

describe('isColorInPalette', () => {
  it('точные совпадения из палитры', () => {
    expect(isColorInPalette('#000000')).toBe(true);
    expect(isColorInPalette('#FFFFFF')).toBe(true);
    expect(isColorInPalette('#1F4E79')).toBe(true);
  });

  it('case-insensitive', () => {
    expect(isColorInPalette('#ffffff')).toBe(true);
    expect(isColorInPalette('#1f4e79')).toBe(true);
  });

  it('без # тоже работает', () => {
    expect(isColorInPalette('000000')).toBe(true);
  });

  it('цвет не из палитры → false', () => {
    expect(isColorInPalette('#FF00FF')).toBe(false);
  });

  it('null/пустота → false', () => {
    expect(isColorInPalette(null)).toBe(false);
    expect(isColorInPalette('')).toBe(false);
  });
});

describe('hasCustomTextStyle', () => {
  it('default (1, null) → false', () => {
    expect(hasCustomTextStyle(1, null)).toBe(false);
  });

  it('изменённый размер → true', () => {
    expect(hasCustomTextStyle(1.5, null)).toBe(true);
    expect(hasCustomTextStyle(0.75, null)).toBe(true);
  });

  it('override цвета → true', () => {
    expect(hasCustomTextStyle(1, '#FF0000')).toBe(true);
  });

  it('всё изменено → true', () => {
    expect(hasCustomTextStyle(2, '#FFFFFF')).toBe(true);
  });
});

describe('TEXT_STYLE_PALETTE', () => {
  it('содержит 10 цветов', () => {
    expect(TEXT_STYLE_PALETTE.length).toBe(10);
  });

  it('все hex в нормализованном виде #RRGGBB upper', () => {
    for (const { hex } of TEXT_STYLE_PALETTE) {
      expect(hex).toMatch(/^#[0-9A-F]{6}$/);
      expect(parseColor(hex)).toBe(hex);
    }
  });

  it('все цвета имеют непустое имя', () => {
    for (const { name } of TEXT_STYLE_PALETTE) {
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it('без дубликатов', () => {
    const hexSet = new Set(TEXT_STYLE_PALETTE.map((c) => c.hex));
    expect(hexSet.size).toBe(TEXT_STYLE_PALETTE.length);
  });
});
