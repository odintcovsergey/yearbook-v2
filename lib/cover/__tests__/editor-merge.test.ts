import { describe, it, expect } from 'vitest';
import { mergeCoverEditsInto, indexCoverEdits, hiddenOverridesFromData } from '../editor-merge';

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

describe('hiddenOverridesFromData', () => {
  it('собирает скрытые слоты', () => {
    const o = hiddenOverridesFromData({ __hidden__back_qr: '1', cover_title: 'x' });
    expect(o.back_qr).toEqual({ hidden: true });
    expect(o.cover_title).toBeUndefined();
  });
});
