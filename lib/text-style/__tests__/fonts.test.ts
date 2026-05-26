import { describe, it, expect } from 'vitest';
import {
  AVAILABLE_FONTS,
  isAvailableFont,
  parseFontFamily,
  resolveFontFamily,
} from '../fonts';

describe('AVAILABLE_FONTS', () => {
  it('содержит 7 семейств', () => {
    expect(AVAILABLE_FONTS).toHaveLength(7);
  });

  it('включает все 7 ключевых шрифтов', () => {
    const families = AVAILABLE_FONTS.map((f) => f.family);
    expect(families).toContain('Noto Serif');
    expect(families).toContain('PT Serif');
    expect(families).toContain('Open Sans');
    expect(families).toContain('Roboto');
    expect(families).toContain('Montserrat');
    expect(families).toContain('Caveat');
    expect(families).toContain('Slimamif');
  });

  it('каждый шрифт имеет валидную категорию', () => {
    const validCategories = ['serif', 'sans', 'handwritten', 'decorative'];
    for (const font of AVAILABLE_FONTS) {
      expect(validCategories).toContain(font.category);
    }
  });
});

describe('isAvailableFont', () => {
  it('возвращает true для известных шрифтов', () => {
    expect(isAvailableFont('Noto Serif')).toBe(true);
    expect(isAvailableFont('Roboto')).toBe(true);
    expect(isAvailableFont('Caveat')).toBe(true);
  });

  it('case-insensitive', () => {
    expect(isAvailableFont('noto serif')).toBe(true);
    expect(isAvailableFont('ROBOTO')).toBe(true);
    expect(isAvailableFont('  Montserrat  ')).toBe(true);
  });

  it('возвращает false для неизвестных', () => {
    expect(isAvailableFont('Comic Sans')).toBe(false);
    expect(isAvailableFont('Arial')).toBe(false);
    expect(isAvailableFont('')).toBe(false);
    expect(isAvailableFont(null)).toBe(false);
    expect(isAvailableFont(undefined)).toBe(false);
  });
});

describe('parseFontFamily', () => {
  it('возвращает каноническое имя для валидных значений', () => {
    expect(parseFontFamily('Noto Serif')).toBe('Noto Serif');
    expect(parseFontFamily('PT Serif')).toBe('PT Serif');
    expect(parseFontFamily('Roboto')).toBe('Roboto');
  });

  it('нормализует регистр и пробелы', () => {
    expect(parseFontFamily('noto serif')).toBe('Noto Serif');
    expect(parseFontFamily('ROBOTO')).toBe('Roboto');
    expect(parseFontFamily('  Montserrat  ')).toBe('Montserrat');
  });

  it('возвращает null для неизвестных или невалидных значений', () => {
    expect(parseFontFamily('Comic Sans MS')).toBeNull();
    expect(parseFontFamily('Arial')).toBeNull();
    expect(parseFontFamily('')).toBeNull();
    expect(parseFontFamily('  ')).toBeNull();
    expect(parseFontFamily(null)).toBeNull();
    expect(parseFontFamily(undefined)).toBeNull();
    expect(parseFontFamily(42)).toBeNull();
    expect(parseFontFamily({})).toBeNull();
  });
});

describe('resolveFontFamily', () => {
  it('point !== null → point побеждает', () => {
    expect(
      resolveFontFamily('Caveat', { font_family: 'Roboto' }),
    ).toBe('Caveat');
  });

  it('point=null + global.font_family → global', () => {
    expect(
      resolveFontFamily(null, { font_family: 'Montserrat' }),
    ).toBe('Montserrat');
  });

  it('оба null → null (caller fallback на placeholder)', () => {
    expect(resolveFontFamily(null, null)).toBeNull();
    expect(resolveFontFamily(null, undefined)).toBeNull();
    expect(resolveFontFamily(null, {})).toBeNull();
    expect(resolveFontFamily(null, { font_family: null })).toBeNull();
  });
});
