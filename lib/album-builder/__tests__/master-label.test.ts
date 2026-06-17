/**
 * Тесты для humanMasterLabel (ФИКС 2): человекочитаемые подписи мастеров
 * общего раздела в пикерах.
 */

import { describe, it, expect } from 'vitest';
import { humanMasterLabel } from '../master-label';

function master(name: string, labels: string[]) {
  return { name, placeholders: labels.map((label) => ({ label })) };
}

describe('humanMasterLabel', () => {
  it('classphotoframe → общее фото класса', () => {
    expect(humanMasterLabel(master('J-Full-1', ['classphotoframe']))).toBe(
      'Общее фото класса (1 фото на страницу)',
    );
  });

  it('halfphoto ×2 → половина класса', () => {
    expect(
      humanMasterLabel(master('J-Half-2', ['halfphoto_1', 'halfphoto_2'])),
    ).toBe('Половина класса (2 фото на страницу)');
  });

  it('quarterphoto ×2 → четверть класса', () => {
    expect(
      humanMasterLabel(master('J-Quarter-2', ['quarterphoto_1', 'quarterphoto_2'])),
    ).toBe('Четверть класса (2 фото на страницу)');
  });

  it('sixthphoto ×6 → 1/6 класса', () => {
    const labels = Array.from({ length: 6 }, (_, i) => `sixthphoto_${i + 1}`);
    expect(humanMasterLabel(master('J-Sixth-6', labels))).toBe(
      '1/6 класса (6 фото на страницу)',
    );
  });

  it('collagephoto ×N → коллаж — N фото на страницу', () => {
    for (const n of [3, 5, 6]) {
      const labels = Array.from({ length: n }, (_, i) => `collagephoto_${i + 1}`);
      expect(humanMasterLabel(master(`J-Collage-${n}`, labels))).toBe(
        `Коллаж — ${n} фото на страницу`,
      );
    }
  });

  it('spreadphoto → фото на весь разворот', () => {
    expect(humanMasterLabel(master('J-Spread', ['spreadphoto']))).toBe(
      'Фото на весь разворот',
    );
  });

  it('личный раздел: парадная (портрет + ФИО + цитата)', () => {
    expect(
      humanMasterLabel(
        master('E-Standard-Left', ['studentportrait_1', 'studentname_1', 'studentquote_1']),
      ),
    ).toBe('Личная: портрет + ФИО + цитата');
  });

  it('личный раздел: коллаж ученика (только фото)', () => {
    expect(
      humanMasterLabel(master('E-Collage-4', ['studentphoto_1', 'studentphoto_2', 'studentphoto_3', 'studentphoto_4'])),
    ).toBe('Коллаж ученика — 4 фото');
  });

  it('нераспознанный мастер → техимя (fallback)', () => {
    // Учительский мастер не распознаётся подписями студ/общих разделов.
    expect(humanMasterLabel(master('F-Head', ['headteacherphoto_1']))).toBe('F-Head');
    expect(humanMasterLabel({ name: 'X', placeholders: null })).toBe('X');
  });

  it('spread приоритетнее остальных слотов', () => {
    expect(
      humanMasterLabel(master('J-Mixed', ['spreadphoto', 'classphotoframe'])),
    ).toBe('Фото на весь разворот');
  });
});
