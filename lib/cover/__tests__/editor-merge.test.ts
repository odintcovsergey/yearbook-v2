import { describe, it, expect } from 'vitest';
import { mergeCoverEditsInto, mergeCoverData, indexCoverEdits, hiddenOverridesFromData, resolveCoverBackground, COVER_BG_NONE } from '../editor-merge';

describe('indexCoverEdits', () => {
  it('раскладывает по типу и по ученику', () => {
    const { byType, byChild } = indexCoverEdits([
      { cover_type: 'portrait_photo', child_id: null, data: { cover_title: 'Выпуск' } },
      { cover_type: null, child_id: 'c1', data: { __scale__cover_portrait: '1.4' } },
    ]);
    expect(byType.portrait_photo).toEqual({ cover_title: 'Выпуск' });
    expect(byChild.c1).toEqual({ __scale__cover_portrait: '1.4' });
  });
});

describe('mergeCoverEditsInto', () => {
  const editsByType = { portrait_photo: { cover_title: 'Выпуск 2026', __color__cover_title: '#111' } };
  const editsByChild = { c1: { __scale__cover_portrait: '1.5', __offset__cover_portrait: '0.1,0' } };

  it('шаблонные правки применяются ко всем экземплярам типа', () => {
    const inst = { child_id: 'c2', cover_type: 'portrait_photo' as const, data: { cover_portrait: 'u.jpg' } as Record<string, string | null> };
    const r = mergeCoverEditsInto(inst, editsByType, editsByChild);
    expect(r.data.cover_title).toBe('Выпуск 2026');
    expect(r.data.__color__cover_title).toBe('#111');
    // у c2 нет поштучного кропа
    expect(r.data.__scale__cover_portrait).toBeUndefined();
  });

  it('поштучный кроп ученика поверх шаблонных', () => {
    const inst = { child_id: 'c1', cover_type: 'portrait_photo' as const, data: { cover_portrait: 'u.jpg' } as Record<string, string | null> };
    const r = mergeCoverEditsInto(inst, editsByType, editsByChild);
    expect(r.data.__scale__cover_portrait).toBe('1.5');
    expect(r.data.cover_title).toBe('Выпуск 2026'); // шаблонная тоже есть
  });

  it('правка student перекрывает type при совпадении ключа', () => {
    const inst = { child_id: 'c1', cover_type: 'portrait_photo' as const, data: {} as Record<string, string | null> };
    const byType = { portrait_photo: { __scale__cover_portrait: '1.0' } };
    const byChild = { c1: { __scale__cover_portrait: '2.0' } };
    const r = mergeCoverEditsInto(inst, byType, byChild);
    expect(r.data.__scale__cover_portrait).toBe('2.0');
  });
});

describe('mergeCoverData — личные метки (имя/класс)', () => {
  it('имя/класс из ШАБЛОННОЙ правки игнорируются (личные у ученика)', () => {
    const base = { cover_student_name: 'Морозова Полина', cover_class: '11А', cover_title: 'Выпуск' };
    const typePatch = { cover_student_name: 'Фёдорова Варвара', cover_class: 'группа', cover_title: 'Выпуск 2026' };
    const r = mergeCoverData(base, typePatch, {});
    // имя/класс берутся из base (личные), title — из type (общий)
    expect(r.cover_student_name).toBe('Морозова Полина');
    expect(r.cover_class).toBe('11А');
    expect(r.cover_title).toBe('Выпуск 2026');
  });

  it('личная (student) правка имени применяется', () => {
    const base = { cover_student_name: 'Морозова Полина' };
    const r = mergeCoverData(base, { cover_student_name: 'Фёдорова Варвара' }, { cover_student_name: 'Морозова П.' });
    expect(r.cover_student_name).toBe('Морозова П.');
  });

  it('стиль имени (служебный ключ) из типа остаётся общим', () => {
    const r = mergeCoverData({}, { __color__cover_student_name: '#0a0' }, {});
    expect(r.__color__cover_student_name).toBe('#0a0');
  });
});

describe('hiddenOverridesFromData', () => {
  it('собирает скрытые слоты', () => {
    const o = hiddenOverridesFromData({ __hidden__back_qr: '1', cover_title: 'x' });
    expect(o.back_qr).toEqual({ hidden: true });
    expect(o.cover_title).toBeUndefined();
  });
});

describe('resolveCoverBackground', () => {
  it('нет правки __bg__ → фон мастера', () => {
    expect(resolveCoverBackground({}, 'master.jpg')).toBe('master.jpg');
    expect(resolveCoverBackground(undefined, 'master.jpg')).toBe('master.jpg');
    expect(resolveCoverBackground({ cover_title: 'x' }, null)).toBeNull();
  });

  it('__bg__ = URL → этот фон (перекрывает мастер)', () => {
    expect(resolveCoverBackground({ __bg__: 'custom.jpg' }, 'master.jpg')).toBe('custom.jpg');
  });

  it('__bg__ = none/пусто → явно без фона', () => {
    expect(resolveCoverBackground({ __bg__: COVER_BG_NONE }, 'master.jpg')).toBeNull();
    expect(resolveCoverBackground({ __bg__: '' }, 'master.jpg')).toBeNull();
  });

  it('__bg__ = null (сброс правки) → фон мастера', () => {
    expect(resolveCoverBackground({ __bg__: null }, 'master.jpg')).toBe('master.jpg');
  });

  it('поштучный __bg__ перекрывает шаблонный через mergeCoverData', () => {
    const merged = mergeCoverData({}, { __bg__: 'type.jpg' }, { __bg__: 'student.jpg' });
    expect(resolveCoverBackground(merged, 'master.jpg')).toBe('student.jpg');
  });
});
