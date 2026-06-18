import { describe, it, expect } from 'vitest';
import {
  detectCoverTextGroup,
  parseCoverTextStyleOverrides,
  applyCoverTextStyles,
} from '../text-styles';
import type { RenderPlaceholder } from '../../album-builder/types';

function textPh(label: string): RenderPlaceholder {
  return { label, type: 'text' } as unknown as RenderPlaceholder;
}

describe('detectCoverTextGroup', () => {
  it('сопоставляет метки группам', () => {
    expect(detectCoverTextGroup('cover_title')).toBe('title');
    expect(detectCoverTextGroup('cover_student_name')).toBe('name');
    expect(detectCoverTextGroup('cover_subtitle')).toBe('subtitle');
    expect(detectCoverTextGroup('cover_school_name')).toBe('details');
    expect(detectCoverTextGroup('cover_city')).toBe('details');
    expect(detectCoverTextGroup('cover_year')).toBe('details');
    expect(detectCoverTextGroup('cover_class')).toBe('details');
    expect(detectCoverTextGroup('spine_text')).toBe('spine');
    expect(detectCoverTextGroup('back_contacts')).toBe('contacts');
  });
  it('регистронезависимо и null для прочего', () => {
    expect(detectCoverTextGroup('COVER_TITLE')).toBe('title');
    expect(detectCoverTextGroup('cover_portrait')).toBeNull();
    expect(detectCoverTextGroup('whatever')).toBeNull();
  });
});

describe('parseCoverTextStyleOverrides', () => {
  it('валидирует значения и отбрасывает мусор', () => {
    const parsed = parseCoverTextStyleOverrides({
      title: { size_pct: 120, color: '#aabbcc', halign: 'center', valign: 'middle' },
      name: { size_pct: 999, color: 'red' }, // вне диапазона / невалидный hex → отбрасываются
      spine: {},                              // пустая группа → не сохраняется
    });
    expect(parsed.title).toEqual({
      size_pct: 120,
      color: '#AABBCC',
      halign: 'center',
      valign: 'middle',
      font_family: null,
    });
    expect('name' in parsed).toBe(false);
    expect('spine' in parsed).toBe(false);
  });
  it('невалидный вход → пустой объект', () => {
    expect(parseCoverTextStyleOverrides(null)).toEqual({});
    expect(parseCoverTextStyleOverrides('x')).toEqual({});
  });
});

describe('applyCoverTextStyles', () => {
  const phs = [textPh('cover_title'), textPh('cover_year'), textPh('cover_city')];

  it('добавляет служебные ключи глобальных стилей нижним слоем', () => {
    const out = applyCoverTextStyles({}, phs, {
      title: { size_pct: 150, color: '#112233', halign: null, valign: null, font_family: 'PT Serif' },
      details: { size_pct: null, color: '#445566', halign: 'right', valign: null, font_family: null },
    });
    expect(out['__fontSize__cover_title']).toBe('1.5');
    expect(out['__color__cover_title']).toBe('#112233');
    expect(out['__font__cover_title']).toBe('PT Serif');
    expect(out['__color__cover_year']).toBe('#445566');
    expect(out['__halign__cover_year']).toBe('right');
    expect(out['__color__cover_city']).toBe('#445566');
  });

  it('точечная правка приоритетнее глобальной (ключ не перетирается)', () => {
    const data = { '__color__cover_title': '#FF0000' };
    const out = applyCoverTextStyles(data, phs, {
      title: { size_pct: null, color: '#112233', halign: null, valign: null, font_family: null },
    });
    expect(out['__color__cover_title']).toBe('#FF0000'); // точка победила
  });

  it('пустые overrides → data без изменений', () => {
    const data = { cover_title: 'Привет' };
    expect(applyCoverTextStyles(data, phs, {})).toBe(data);
    expect(applyCoverTextStyles(data, phs, null)).toBe(data);
  });
});
