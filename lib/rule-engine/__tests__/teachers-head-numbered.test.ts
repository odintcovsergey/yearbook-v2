/**
 * Часть 1 (17.06.2026): биндер главного учителя/воспитателя понимает НОМЕРА
 * (headteacherphoto_N / headteachername_N / headteacherrole_N). Мастер детсада
 * «Аква меч» именует слоты с номером (два воспитателя). Пока в данных ОДИН
 * главный → слот _1 (или без номера) заполняется, _2+ скрываются (__hidden__).
 * Часть 2 добавит массив из двух главных.
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

describe('bindLeftPage — нумерованные слоты главного учителя (Часть 1)', () => {
  it('headteacher*_1 заполняется одним главным, _2 скрывается', () => {
    const m = master([
      photo('headteacherphoto_1'), text('headteachername_1'), text('headteacherrole_1'),
      photo('headteacherphoto_2'), text('headteachername_2'), text('headteacherrole_2'),
      text('headtextframe'),
    ]);
    const b = bindLeftPage(m, HEAD, []);
    // Первый воспитатель — заполнен.
    expect(b.headteacherphoto_1).toBe('https://cdn/h.jpg');
    expect(b.headteachername_1).toBe('Беляева Татьяна');
    expect(b.headteacherrole_1).toBe('Воспитатель');
    // Второй — скрыт (пока один главный).
    expect(b.__hidden__headteacherphoto_2).toBe('1');
    expect(b.__hidden__headteachername_2).toBe('1');
    expect(b.__hidden__headteacherrole_2).toBe('1');
    // Общий текст.
    expect(b.headtextframe).toBe('Текст');
  });

  it('форма без номера (legacy) по-прежнему работает', () => {
    const m = master([photo('headteacherphoto'), text('headteachername'), text('headteacherrole')]);
    const b = bindLeftPage(m, HEAD, []);
    expect(b.headteacherphoto).toBe('https://cdn/h.jpg');
    expect(b.headteachername).toBe('Беляева Татьяна');
    expect(b.headteacherrole).toBe('Воспитатель');
  });

  it('нет фото → _1 рамка скрыта', () => {
    const m = master([photo('headteacherphoto_1'), text('headteachername_1')]);
    const b = bindLeftPage(m, { ...HEAD, photo: null }, []);
    expect(b.__hidden__headteacherphoto_1).toBe('1');
    expect(b.headteachername_1).toBe('Беляева Татьяна');
  });
});
