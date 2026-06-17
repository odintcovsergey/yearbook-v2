/**
 * Главный учитель/воспитатель в биндере teachers.ts.
 *
 * Часть 1 (17.06.2026): биндер понимает НОМЕРА слотов
 * (headteacherphoto_N / headteachername_N / headteacherrole_N). Мастер детсада
 * «Аква меч» именует слоты с номером (два воспитателя).
 *
 * Часть 2 (17.06.2026): bindLeftPage принимает МАССИВ главных (0..2). Слот
 * headteacher*_N заполняется head_teachers[N-1]; лишние слоты скрываются
 * (__hidden__) → привязанный декор уходит автоматически через
 * applyBalanceOverrides. Текст-письмо общий (одно поле на обоих).
 */
import { describe, it, expect } from 'vitest';
import { bindLeftPage } from '../sections/teachers';
import type { SpreadTemplate } from '@/lib/album-builder/types';
import type { RulesHeadTeacherInput } from '../types';

function photo(label: string) {
  return { label, x_mm: 0, y_mm: 0, width_mm: 40, height_mm: 55, type: 'photo' as const, fit: 'fill_proportional' as const, required: false };
}
function text(label: string) {
  return { label, x_mm: 0, y_mm: 0, width_mm: 40, height_mm: 10, type: 'text' as const, font_family: 'Arial', font_size_pt: 12, font_weight: 'regular' as const, color: '#000', align: 'left' as const, vertical_align: 'top' as const, auto_fit: false };
}
function master(placeholders: any[]): SpreadTemplate {
  return {
    id: 'm', name: 'F-Head', type: 'common', is_spread: false, width_mm: 200, height_mm: 280,
    placeholders, rules: null, sort_order: 0, applies_to_configs: [], default_for_configs: [],
    page_role: 'teacher_left', slot_capacity: { head_teacher: 1 }, is_fallback: false,
    mirror_for_soft: false, audit_notes: null,
  };
}
const HEAD: RulesHeadTeacherInput = { photo: 'https://cdn/h.jpg', name: 'Беляева Татьяна', role: 'Воспитатель', text: 'Текст' };
const HEAD2: RulesHeadTeacherInput = { photo: 'https://cdn/h2.jpg', name: 'Соколова Анна', role: 'Воспитатель', text: '' };

describe('bindLeftPage — один главный (Часть 1)', () => {
  it('headteacher*_1 заполняется одним главным, _2 скрывается', () => {
    const m = master([
      photo('headteacherphoto_1'), text('headteachername_1'), text('headteacherrole_1'),
      photo('headteacherphoto_2'), text('headteachername_2'), text('headteacherrole_2'),
      text('headtextframe'),
    ]);
    const b = bindLeftPage(m, [HEAD], []);
    // Первый воспитатель — заполнен.
    expect(b.headteacherphoto_1).toBe('https://cdn/h.jpg');
    expect(b.headteachername_1).toBe('Беляева Татьяна');
    expect(b.headteacherrole_1).toBe('Воспитатель');
    // Второй — скрыт (один главный).
    expect(b.__hidden__headteacherphoto_2).toBe('1');
    expect(b.__hidden__headteachername_2).toBe('1');
    expect(b.__hidden__headteacherrole_2).toBe('1');
    // Общий текст.
    expect(b.headtextframe).toBe('Текст');
  });

  it('форма без номера (legacy) по-прежнему работает', () => {
    const m = master([photo('headteacherphoto'), text('headteachername'), text('headteacherrole')]);
    const b = bindLeftPage(m, [HEAD], []);
    expect(b.headteacherphoto).toBe('https://cdn/h.jpg');
    expect(b.headteachername).toBe('Беляева Татьяна');
    expect(b.headteacherrole).toBe('Воспитатель');
  });

  it('нет фото → _1 рамка скрыта', () => {
    const m = master([photo('headteacherphoto_1'), text('headteachername_1')]);
    const b = bindLeftPage(m, [{ ...HEAD, photo: null }], []);
    expect(b.__hidden__headteacherphoto_1).toBe('1');
    expect(b.headteachername_1).toBe('Беляева Татьяна');
  });
});

describe('bindLeftPage — два равных главных (Часть 2)', () => {
  const m = () => master([
    photo('headteacherphoto_1'), text('headteachername_1'), text('headteacherrole_1'),
    photo('headteacherphoto_2'), text('headteachername_2'), text('headteacherrole_2'),
    text('headtextframe'),
  ]);

  it('оба слота заполнены, ни один не скрыт', () => {
    const b = bindLeftPage(m(), [HEAD, HEAD2], []);
    expect(b.headteacherphoto_1).toBe('https://cdn/h.jpg');
    expect(b.headteachername_1).toBe('Беляева Татьяна');
    expect(b.headteacherrole_1).toBe('Воспитатель');
    expect(b.headteacherphoto_2).toBe('https://cdn/h2.jpg');
    expect(b.headteachername_2).toBe('Соколова Анна');
    expect(b.headteacherrole_2).toBe('Воспитатель');
    expect(b.__hidden__headteacherphoto_2).toBeUndefined();
    expect(b.__hidden__headteachername_2).toBeUndefined();
  });

  it('текст-письмо общий — один на обоих', () => {
    const b = bindLeftPage(m(), [HEAD, HEAD2], []);
    expect(b.headtextframe).toBe('Текст');
  });

  it('общий текст берётся у первого НЕПУСТОГО (письмо вписали второму)', () => {
    const b = bindLeftPage(m(), [{ ...HEAD, text: '' }, { ...HEAD2, text: 'Письмо от второго' }], []);
    expect(b.headtextframe).toBe('Письмо от второго');
  });

  it('второй главный без фото → его рамка фото скрыта, имя/роль остаются', () => {
    const b = bindLeftPage(m(), [HEAD, { ...HEAD2, photo: null }], []);
    expect(b.headteacherphoto_1).toBe('https://cdn/h.jpg');
    expect(b.__hidden__headteacherphoto_2).toBe('1');
    expect(b.headteachername_2).toBe('Соколова Анна');
    expect(b.headteacherrole_2).toBe('Воспитатель');
  });

  it('нумерованный текст-письмо headteachertext_N — раздельные письма', () => {
    const m2 = master([
      photo('headteacherphoto_1'), text('headteachertext_1'),
      photo('headteacherphoto_2'), text('headteachertext_2'),
    ]);
    const b = bindLeftPage(m2, [{ ...HEAD, text: 'Письмо-1' }, { ...HEAD2, text: 'Письмо-2' }], []);
    expect(b.headteachertext_1).toBe('Письмо-1');
    expect(b.headteachertext_2).toBe('Письмо-2');
  });

  it('один главный при мастере на двоих → _2 скрыт (нет второго)', () => {
    const b = bindLeftPage(m(), [HEAD], []);
    expect(b.headteacherphoto_1).toBe('https://cdn/h.jpg');
    expect(b.__hidden__headteacherphoto_2).toBe('1');
    expect(b.__hidden__headteachername_2).toBe('1');
    expect(b.__hidden__headteacherrole_2).toBe('1');
  });
});
