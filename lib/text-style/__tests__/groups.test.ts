import { describe, it, expect } from 'vitest';
import {
  detectTextStyleGroup,
  parseAlbumTextStyleOverrides,
  resolveFontSizeMult,
  resolveColor,
  parseHAlign,
  parseVAlign,
  resolveHAlign,
  resolveVAlign,
} from '../groups';

describe('detectTextStyleGroup', () => {
  it('studentname_N → studentname', () => {
    expect(detectTextStyleGroup('studentname_1')).toBe('studentname');
    expect(detectTextStyleGroup('studentname_25')).toBe('studentname');
    expect(detectTextStyleGroup('studentname')).toBe('studentname');
  });

  it('studentquote_N → studentquote', () => {
    expect(detectTextStyleGroup('studentquote_1')).toBe('studentquote');
    expect(detectTextStyleGroup('studentquote_99')).toBe('studentquote');
  });

  it('teachername_N + subjectname_N → teachername', () => {
    expect(detectTextStyleGroup('teachername_1')).toBe('teachername');
    expect(detectTextStyleGroup('teachername_5')).toBe('teachername');
    expect(detectTextStyleGroup('subjectname_1')).toBe('teachername');
    expect(detectTextStyleGroup('subjectname_3')).toBe('teachername');
  });

  it('teacherrole_N + subjectrole_N + headteacherrole → teacherrole', () => {
    expect(detectTextStyleGroup('teacherrole_1')).toBe('teacherrole');
    expect(detectTextStyleGroup('teacherrole_5')).toBe('teacherrole');
    expect(detectTextStyleGroup('subjectrole_1')).toBe('teacherrole');
    expect(detectTextStyleGroup('headteacherrole')).toBe('teacherrole');
  });

  it('headteachername (без числа) → null (РЭ.53.d: единственный экземпляр)', () => {
    // headteachername в альбоме в одном экземпляре — глобальный override
    // не нужен, партнёр правит точечно через клик. detectTextStyleGroup
    // намеренно возвращает null для этого label.
    expect(detectTextStyleGroup('headteachername')).toBeNull();
  });

  it('headtextframe → null (РЭ.53.d: единственный экземпляр)', () => {
    expect(detectTextStyleGroup('headtextframe')).toBeNull();
  });

  it('case-insensitive', () => {
    expect(detectTextStyleGroup('StudentName_1')).toBe('studentname');
    expect(detectTextStyleGroup('HEADTEACHERROLE')).toBe('teacherrole');
  });

  it('unrelated labels → null', () => {
    expect(detectTextStyleGroup('classphotoframe')).toBeNull();
    expect(detectTextStyleGroup('studentportrait_1')).toBeNull();
    expect(detectTextStyleGroup('headteacherphoto')).toBeNull();
    expect(detectTextStyleGroup('')).toBeNull();
    expect(detectTextStyleGroup('random')).toBeNull();
  });

  it('частичные совпадения НЕ матчатся (full label, не подстрока)', () => {
    // 'studentnames' (с s) — не должно быть studentname
    expect(detectTextStyleGroup('studentnames')).toBeNull();
    expect(detectTextStyleGroup('mystudentname_1')).toBeNull();
  });
});

describe('parseAlbumTextStyleOverrides', () => {
  it('null/undefined → пустой объект', () => {
    expect(parseAlbumTextStyleOverrides(null)).toEqual({});
    expect(parseAlbumTextStyleOverrides(undefined)).toEqual({});
  });

  it('не-объект → пустой', () => {
    expect(parseAlbumTextStyleOverrides('string')).toEqual({});
    expect(parseAlbumTextStyleOverrides(42)).toEqual({});
    expect(parseAlbumTextStyleOverrides([])).toEqual({});
  });

  it('валидный объект сохраняется', () => {
    const raw = {
      studentname: { size_pct: 110, color: '#000000' },
      studentquote: { size_pct: 90, color: null },
    };
    expect(parseAlbumTextStyleOverrides(raw)).toEqual({
      studentname: { size_pct: 110, color: '#000000', halign: null, valign: null },
      studentquote: { size_pct: 90, color: null, halign: null, valign: null },
    });
  });

  it('color нормализуется в upper-case', () => {
    const raw = { studentname: { size_pct: 100, color: '#abc123' } };
    expect(parseAlbumTextStyleOverrides(raw)).toEqual({
      studentname: { size_pct: 100, color: '#ABC123', halign: null, valign: null },
    });
  });

  it('некорректный size_pct → null', () => {
    const raw = {
      studentname: { size_pct: 250, color: null }, // > 200
      studentquote: { size_pct: 30, color: null }, // < 50
      teachername: { size_pct: 'abc', color: null }, // не число
    };
    // Все эти группы должны быть отброшены (size=null + color=null = не добавляем).
    expect(parseAlbumTextStyleOverrides(raw)).toEqual({});
  });

  it('некорректный color → null', () => {
    const raw = {
      studentname: { size_pct: 100, color: 'red' }, // не HEX
      studentquote: { size_pct: 100, color: '#zzz' }, // невалидный HEX
    };
    expect(parseAlbumTextStyleOverrides(raw)).toEqual({
      studentname: { size_pct: 100, color: null, halign: null, valign: null },
      studentquote: { size_pct: 100, color: null, halign: null, valign: null },
    });
  });

  it('неизвестные ключи игнорируются', () => {
    const raw = {
      studentname: { size_pct: 100, color: '#000000' },
      unknown_group: { size_pct: 100 },
    };
    expect(parseAlbumTextStyleOverrides(raw)).toEqual({
      studentname: { size_pct: 100, color: '#000000', halign: null, valign: null },
    });
  });
});

describe('resolveFontSizeMult', () => {
  it('point !== null → point побеждает', () => {
    expect(resolveFontSizeMult(1.5, { size_pct: 110, color: null })).toBe(1.5);
    expect(resolveFontSizeMult(0.8, null)).toBe(0.8);
  });

  it('point=null + global.size_pct → global/100', () => {
    expect(resolveFontSizeMult(null, { size_pct: 110, color: null })).toBe(1.1);
    expect(resolveFontSizeMult(null, { size_pct: 90, color: null })).toBe(0.9);
  });

  it('point=null + global=null → 1', () => {
    expect(resolveFontSizeMult(null, null)).toBe(1);
    expect(resolveFontSizeMult(null, undefined)).toBe(1);
  });

  it('point=null + global без size_pct → 1', () => {
    expect(
      resolveFontSizeMult(null, { size_pct: null, color: '#000000' }),
    ).toBe(1);
  });
});

describe('resolveColor', () => {
  it('point !== null → point', () => {
    expect(
      resolveColor('#FF0000', { size_pct: 100, color: '#00FF00' }),
    ).toBe('#FF0000');
  });

  it('point=null + global.color → global', () => {
    expect(
      resolveColor(null, { size_pct: 100, color: '#00FF00' }),
    ).toBe('#00FF00');
  });

  it('point=null + global=null → null (caller fallback)', () => {
    expect(resolveColor(null, null)).toBeNull();
    expect(resolveColor(null, undefined)).toBeNull();
    expect(resolveColor(null, { size_pct: 100, color: null })).toBeNull();
  });
});

describe('parseHAlign / parseVAlign (РЭ.54)', () => {
  it('parseHAlign валидные значения', () => {
    expect(parseHAlign('left')).toBe('left');
    expect(parseHAlign('center')).toBe('center');
    expect(parseHAlign('right')).toBe('right');
    expect(parseHAlign('LEFT')).toBe('left'); // case-insensitive
    expect(parseHAlign('  center  ')).toBe('center'); // trim
  });

  it('parseHAlign невалидные → null', () => {
    expect(parseHAlign(null)).toBeNull();
    expect(parseHAlign('')).toBeNull();
    expect(parseHAlign('middle')).toBeNull(); // не валидное для H
    expect(parseHAlign(42)).toBeNull();
  });

  it('parseVAlign валидные значения', () => {
    expect(parseVAlign('top')).toBe('top');
    expect(parseVAlign('middle')).toBe('middle');
    expect(parseVAlign('bottom')).toBe('bottom');
    expect(parseVAlign('TOP')).toBe('top');
  });

  it('parseVAlign невалидные → null', () => {
    expect(parseVAlign('center')).toBeNull(); // 'center' это H, не V
    expect(parseVAlign(undefined)).toBeNull();
  });
});

describe('resolveHAlign / resolveVAlign (РЭ.54)', () => {
  it('resolveHAlign: point побеждает global', () => {
    expect(
      resolveHAlign('right', { size_pct: null, color: null, halign: 'left' }),
    ).toBe('right');
  });

  it('resolveHAlign: point=null + global.halign → global', () => {
    expect(
      resolveHAlign(null, { size_pct: null, color: null, halign: 'center' }),
    ).toBe('center');
  });

  it('resolveHAlign: оба null → null (caller fallback)', () => {
    expect(resolveHAlign(null, null)).toBeNull();
    expect(resolveHAlign(null, { size_pct: 100, color: null })).toBeNull();
  });

  it('resolveVAlign: аналогично', () => {
    expect(
      resolveVAlign('bottom', { size_pct: null, color: null, valign: 'top' }),
    ).toBe('bottom');
    expect(
      resolveVAlign(null, { size_pct: null, color: null, valign: 'middle' }),
    ).toBe('middle');
    expect(resolveVAlign(null, null)).toBeNull();
  });
});

describe('parseAlbumTextStyleOverrides — halign/valign (РЭ.54)', () => {
  it('извлекает halign и valign из JSONB', () => {
    const raw = {
      studentname: { size_pct: 100, color: null, halign: 'center', valign: 'middle' },
    };
    expect(parseAlbumTextStyleOverrides(raw)).toEqual({
      studentname: {
        size_pct: 100,
        color: null,
        halign: 'center',
        valign: 'middle',
      },
    });
  });

  it('некорректные halign/valign → null', () => {
    const raw = {
      studentname: { size_pct: 100, color: null, halign: 'oops', valign: 'invalid' },
    };
    expect(parseAlbumTextStyleOverrides(raw)).toEqual({
      studentname: { size_pct: 100, color: null, halign: null, valign: null },
    });
  });

  it('только halign (без size/color/valign) — группа сохраняется', () => {
    const raw = { studentname: { halign: 'right' } };
    expect(parseAlbumTextStyleOverrides(raw)).toEqual({
      studentname: { size_pct: null, color: null, halign: 'right', valign: null },
    });
  });

  it('группа со всеми null значениями отбрасывается', () => {
    const raw = {
      studentname: {
        size_pct: null,
        color: null,
        halign: 'bogus',
        valign: 'bogus',
      },
    };
    expect(parseAlbumTextStyleOverrides(raw)).toEqual({});
  });
});
