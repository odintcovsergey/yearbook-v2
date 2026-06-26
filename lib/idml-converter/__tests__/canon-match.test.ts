import { describe, it, expect } from 'vitest';
import { matchCanonType, jsonEqual, type CanonType } from '../canon-match';

// Мини-канон для тестов (подмножество реальных типов Фазы 1).
const CANON: CanonType[] = [
  { id: 'id-grid12', code: 'grid-mini-12', page_role: 'student_grid', page_type: null,
    slot_capacity: { has_name: true, students: 12, has_quote: false, photos_full: 0, has_portrait: true } },
  { id: 'id-std-left', code: 'personal-standard-left', page_role: 'student_left', page_type: 'left',
    slot_capacity: { has_name: true, students: 1, has_quote: true, has_portrait: true, photos_friend: 0 } },
  // Неоднозначная пара common photos_full:1 (разводка по page_type):
  { id: 'id-full-page', code: 'common-full-page', page_role: 'common', page_type: null,
    slot_capacity: { photos_full: 1 } },
  { id: 'id-spread', code: 'common-spread', page_role: 'common', page_type: 'spread',
    slot_capacity: { photos_full: 1 } },
];

describe('jsonEqual — стабильное сравнение (порядок ключей не важен)', () => {
  it('равны при разном порядке ключей', () => {
    expect(jsonEqual({ a: 1, b: true }, { b: true, a: 1 })).toBe(true);
  });
  it('не равны при разном значении', () => {
    expect(jsonEqual({ students: 12 }, { students: 6 })).toBe(false);
  });
  it('не равны при лишнем ключе', () => {
    expect(jsonEqual({ students: 1 }, { students: 1, has_quote: true })).toBe(false);
  });
});

describe('matchCanonType', () => {
  it('matched — обычное совпадение role+capacity', () => {
    const r = matchCanonType(
      { page_role: 'student_grid', page_type: 'page-any',
        slot_capacity: { has_portrait: true, students: 12, has_name: true, has_quote: false, photos_full: 0 } },
      CANON,
    );
    expect(r).toEqual({ master_page_type_id: 'id-grid12', reason: 'matched' });
  });

  it('matched — порядок ключей slot_capacity не ломает матч', () => {
    // ключи в другом порядке, чем в каноне → всё равно matched
    const r = matchCanonType(
      { page_role: 'student_left', page_type: 'page-left',
        slot_capacity: { photos_friend: 0, has_portrait: true, has_quote: true, students: 1, has_name: true } },
      CANON,
    );
    expect(r.reason).toBe('matched');
    expect(r.master_page_type_id).toBe('id-std-left');
  });

  it('unmapped — нет page_role', () => {
    expect(matchCanonType({ page_role: null, slot_capacity: { photos_full: 1 }, page_type: 'page-any' }, CANON))
      .toEqual({ master_page_type_id: null, reason: 'unmapped' });
  });

  it('unmapped — нет slot_capacity', () => {
    expect(matchCanonType({ page_role: 'common', slot_capacity: null, page_type: 'page-any' }, CANON))
      .toEqual({ master_page_type_id: null, reason: 'unmapped' });
  });

  it('no-canon-type — валидные теги, но типа в каноне нет', () => {
    const r = matchCanonType(
      { page_role: 'student_grid', page_type: 'page-any', slot_capacity: { students: 99, has_name: true } },
      CANON,
    );
    expect(r).toEqual({ master_page_type_id: null, reason: 'no-canon-type' });
  });

  it('разводка: common photos_full:1 + page_type=spread → common-spread', () => {
    const r = matchCanonType({ page_role: 'common', page_type: 'spread', slot_capacity: { photos_full: 1 } }, CANON);
    expect(r).toEqual({ master_page_type_id: 'id-spread', reason: 'matched' });
  });

  it('разводка: common photos_full:1 + page-any → common-full-page', () => {
    const r = matchCanonType({ page_role: 'common', page_type: 'page-any', slot_capacity: { photos_full: 1 } }, CANON);
    expect(r).toEqual({ master_page_type_id: 'id-full-page', reason: 'matched' });
  });

  it('разводка: common photos_full:1 + page_type=null → common-full-page (не spread)', () => {
    const r = matchCanonType({ page_role: 'common', page_type: null, slot_capacity: { photos_full: 1 } }, CANON);
    expect(r.master_page_type_id).toBe('id-full-page');
  });
});
