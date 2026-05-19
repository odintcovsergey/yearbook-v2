/**
 * Тесты lib/template-replace (Р.1).
 *
 * Покрытие:
 *   - remapData: EXACT — точное совпадение label + type
 *   - remapData: NORMALIZED — нестрогое сопоставление по нормализованному label
 *   - remapData: BY_TYPE — fallback по типу placeholder с порядком
 *   - remapData: каждый old-label используется не более одного раза
 *   - remapData: type-mismatch при EXACT не срабатывает (фото-слот в текст не льётся)
 *   - remapData: служебные ключи __scale__/__offset__ мигрируют вместе с фото
 *   - remapData: __hidden__/__pos__ НЕ мигрируют (привязаны к старым рамкам)
 *   - remapData: stats.lost подсчитывается корректно
 *   - remapData: пустые входы (no placeholders, empty data)
 *   - normalizeLabel: разные варианты написания одного слота
 *   - hasBalanceOverridesForLabel
 */

import { describe, it, expect } from 'vitest';
import {
  remapData,
  normalizeLabel,
  hasBalanceOverridesForLabel,
} from '../index';
import type {
  PhotoPlaceholder,
  TextPlaceholder,
  Placeholder,
} from '@/lib/album-builder/types';

// ─── Helpers для построения placeholders в тестах ────────────────────────

function photoPh(label: string): PhotoPlaceholder {
  return {
    label,
    type: 'photo',
    x_mm: 0,
    y_mm: 0,
    width_mm: 100,
    height_mm: 100,
    fit: 'fill_proportional',
    required: false,
  };
}

function textPh(label: string): TextPlaceholder {
  return {
    label,
    type: 'text',
    x_mm: 0,
    y_mm: 0,
    width_mm: 100,
    height_mm: 20,
    font_family: 'NotoSerif',
    font_size_pt: 10,
    font_weight: 'regular',
    color: '#000000',
    align: 'left',
    vertical_align: 'top',
    auto_fit: false,
  };
}

// ─── EXACT стратегия ────────────────────────────────────────────────────

describe('remapData — EXACT (точное совпадение label + type)', () => {
  it('переносит значения по точному совпадению label', () => {
    const old: Placeholder[] = [
      photoPh('studentphoto1'),
      photoPh('studentphoto2'),
      textPh('name'),
    ];
    const next: Placeholder[] = [
      photoPh('studentphoto1'),
      photoPh('studentphoto2'),
      textPh('name'),
    ];
    const data = {
      studentphoto1: 'urlA',
      studentphoto2: 'urlB',
      name: 'Аня',
    };
    const { newData, stats } = remapData(data, old, next);
    expect(newData.studentphoto1).toBe('urlA');
    expect(newData.studentphoto2).toBe('urlB');
    expect(newData.name).toBe('Аня');
    expect(stats.exact).toBe(3);
    expect(stats.normalized).toBe(0);
    expect(stats.byType).toBe(0);
    expect(stats.lost).toBe(0);
  });

  it('точное совпадение label с РАЗНЫМ типом не срабатывает', () => {
    // В старом мастере studentphoto1 — это photo. В новом — text с тем
    // же label. Перенос недопустим (в текстовый слот не должен попасть
    // URL фото).
    const old: Placeholder[] = [photoPh('studentphoto1')];
    const next: Placeholder[] = [textPh('studentphoto1')];
    const data = { studentphoto1: 'urlA' };
    const { newData, stats } = remapData(data, old, next);
    // Слот остаётся null (не сматчили), URL'а в текст не попало.
    expect(newData.studentphoto1).toBe(null);
    expect(stats.exact).toBe(0);
    // urlA не было куда положить → lost.
    expect(stats.lost).toBe(1);
    expect(stats.lostLabels).toEqual(['studentphoto1']);
  });

  it('null-значения не считаются за preserved', () => {
    const old: Placeholder[] = [photoPh('photo1')];
    const next: Placeholder[] = [photoPh('photo1')];
    const data = { photo1: null };
    const { newData, stats } = remapData(data, old, next);
    expect(newData.photo1).toBe(null);
    // null → null не считается за «перенесено», stats.exact=0
    expect(stats.exact).toBe(0);
    expect(stats.lost).toBe(0);
  });
});

// ─── NORMALIZED стратегия ──────────────────────────────────────────────

describe('remapData — NORMALIZED (нормализованный label)', () => {
  it('сопоставляет student_photo_1 ≈ studentphoto1', () => {
    const old: Placeholder[] = [photoPh('studentphoto1'), photoPh('studentphoto2')];
    const next: Placeholder[] = [
      photoPh('student_photo_1'),
      photoPh('student_photo_2'),
    ];
    const data = { studentphoto1: 'urlA', studentphoto2: 'urlB' };
    const { newData, stats } = remapData(data, old, next);
    expect(newData.student_photo_1).toBe('urlA');
    expect(newData.student_photo_2).toBe('urlB');
    expect(stats.normalized).toBe(2);
    expect(stats.byType).toBe(0);
    expect(stats.lost).toBe(0);
  });

  it('сопоставляет «Subject Photo 1» ≈ «subjectphoto1»', () => {
    const old: Placeholder[] = [photoPh('subjectphoto1')];
    const next: Placeholder[] = [photoPh('Subject Photo 1')];
    const data = { subjectphoto1: 'urlA' };
    const { newData, stats } = remapData(data, old, next);
    expect(newData['Subject Photo 1']).toBe('urlA');
    expect(stats.normalized).toBe(1);
  });

  it('числовой суффикс остаётся разделяющим', () => {
    // studentphoto1 ≠ studentphoto2 после нормализации.
    const old: Placeholder[] = [photoPh('studentphoto1')];
    const next: Placeholder[] = [photoPh('student_photo_2')];
    const data = { studentphoto1: 'urlA' };
    const { newData, stats } = remapData(data, old, next);
    // По NORMALIZED не сматчили (студентФото1 ≠ студентФото2),
    // но по BY_TYPE сработало (фото тип совпадает, один фото-слот).
    expect(newData.student_photo_2).toBe('urlA');
    expect(stats.normalized).toBe(0);
    expect(stats.byType).toBe(1);
  });
});

// ─── BY_TYPE fallback ──────────────────────────────────────────────────

describe('remapData — BY_TYPE (fallback по типу)', () => {
  it('фото мигрируют в новые фото-слоты в порядке появления', () => {
    const old: Placeholder[] = [
      photoPh('mainPhoto'),
      photoPh('friendPhoto1'),
      photoPh('friendPhoto2'),
    ];
    const next: Placeholder[] = [
      photoPh('hero'),
      photoPh('side1'),
      photoPh('side2'),
    ];
    const data = {
      mainPhoto: 'urlMain',
      friendPhoto1: 'urlF1',
      friendPhoto2: 'urlF2',
    };
    const { newData, stats } = remapData(data, old, next);
    expect(newData.hero).toBe('urlMain');
    expect(newData.side1).toBe('urlF1');
    expect(newData.side2).toBe('urlF2');
    expect(stats.byType).toBe(3);
    expect(stats.exact).toBe(0);
    expect(stats.normalized).toBe(0);
    expect(stats.lost).toBe(0);
  });

  it('тексты мигрируют в новые text-слоты в порядке появления', () => {
    const old: Placeholder[] = [textPh('name'), textPh('quote')];
    const next: Placeholder[] = [textPh('studentName'), textPh('studentQuote')];
    const data = { name: 'Аня', quote: 'Учиться-учиться-учиться' };
    const { newData, stats } = remapData(data, old, next);
    expect(newData.studentName).toBe('Аня');
    expect(newData.studentQuote).toBe('Учиться-учиться-учиться');
    expect(stats.byType).toBe(2);
  });

  it('каскад: EXACT первый, BY_TYPE подбирает остаток', () => {
    // В новом мастере есть label name (точное совпадение) и hero (фото
    // которое в старом было mainPhoto).
    const old: Placeholder[] = [photoPh('mainPhoto'), textPh('name')];
    const next: Placeholder[] = [photoPh('hero'), textPh('name')];
    const data = { mainPhoto: 'urlMain', name: 'Аня' };
    const { newData, stats } = remapData(data, old, next);
    expect(newData.hero).toBe('urlMain');
    expect(newData.name).toBe('Аня');
    expect(stats.exact).toBe(1); // name
    expect(stats.byType).toBe(1); // mainPhoto → hero
  });

  it('каждый old-label используется не более 1 раза', () => {
    const old: Placeholder[] = [photoPh('photo1')];
    const next: Placeholder[] = [photoPh('photo1'), photoPh('photo2')];
    const data = { photo1: 'urlA' };
    const { newData, stats } = remapData(data, old, next);
    expect(newData.photo1).toBe('urlA');
    expect(newData.photo2).toBe(null); // photo1 уже забрался EXACT'ом
    expect(stats.exact).toBe(1);
    expect(stats.byType).toBe(0);
  });
});

// ─── Подсчёт lost ──────────────────────────────────────────────────────

describe('remapData — stats.lost', () => {
  it('считает значения которые не нашли куда положить', () => {
    const old: Placeholder[] = [
      photoPh('photo1'),
      photoPh('photo2'),
      photoPh('photo3'),
      textPh('name'),
      textPh('quote'),
    ];
    const next: Placeholder[] = [photoPh('photo_a'), textPh('name')];
    const data = {
      photo1: 'A',
      photo2: 'B',
      photo3: 'C',
      name: 'Аня',
      quote: 'кварц',
    };
    const { stats } = remapData(data, old, next);
    expect(stats.exact).toBe(1); // name
    expect(stats.byType).toBe(1); // photo1 → photo_a
    expect(stats.lost).toBe(3); // photo2, photo3, quote
    expect(new Set(stats.lostLabels)).toEqual(
      new Set(['photo2', 'photo3', 'quote']),
    );
  });

  it('пустые value (null) не считаются lost', () => {
    const old: Placeholder[] = [photoPh('photo1'), photoPh('photo2')];
    const next: Placeholder[] = [photoPh('hero')];
    const data = { photo1: 'urlA', photo2: null };
    const { stats } = remapData(data, old, next);
    expect(stats.byType).toBe(1);
    expect(stats.lost).toBe(0); // photo2 был null, потери нет
  });
});

// ─── Миграция служебных ключей ────────────────────────────────────────

describe('remapData — миграция служебных ключей', () => {
  it('__scale__ и __offset__ мигрируют ВМЕСТЕ с фото (BY_TYPE)', () => {
    const old: Placeholder[] = [photoPh('studentphoto1')];
    const next: Placeholder[] = [photoPh('hero')];
    const data = {
      studentphoto1: 'urlA',
      __scale__studentphoto1: '1.5',
      __offset__studentphoto1: '0.2,-0.1',
    };
    const { newData } = remapData(data, old, next);
    expect(newData.hero).toBe('urlA');
    expect(newData.__scale__hero).toBe('1.5');
    expect(newData.__offset__hero).toBe('0.2,-0.1');
    // Старые ключи в newData отсутствуют
    expect(newData.__scale__studentphoto1).toBeUndefined();
    expect(newData.__offset__studentphoto1).toBeUndefined();
  });

  it('__scale__ мигрирует и при EXACT (тот же label)', () => {
    const old: Placeholder[] = [photoPh('photo1')];
    const next: Placeholder[] = [photoPh('photo1')];
    const data = { photo1: 'urlA', __scale__photo1: '1.7' };
    const { newData } = remapData(data, old, next);
    expect(newData.__scale__photo1).toBe('1.7');
  });

  it('__rotate__/__fontSize__/__color__ — зарезервированные ключи тоже мигрируют', () => {
    // Р.2 и Р.3 добавят эти ключи; remapData должен их сразу понимать.
    const old: Placeholder[] = [photoPh('photo1'), textPh('name')];
    const next: Placeholder[] = [photoPh('hero'), textPh('studentName')];
    const data = {
      photo1: 'urlA',
      __rotate__photo1: '5.5',
      name: 'Аня',
      __fontSize__name: '1.25',
      __color__name: '#FF0000',
    };
    const { newData } = remapData(data, old, next);
    expect(newData.__rotate__hero).toBe('5.5');
    expect(newData.__fontSize__studentName).toBe('1.25');
    expect(newData.__color__studentName).toBe('#FF0000');
  });

  it('__hidden__ и __pos__ НЕ мигрируют (привязаны к старым рамкам)', () => {
    const old: Placeholder[] = [photoPh('subjectphoto5')];
    const next: Placeholder[] = [photoPh('subjectphoto5')];
    const data = {
      subjectphoto5: 'urlA',
      __hidden__subjectphoto5: '1',
      __pos__subjectphoto5: '50,80',
    };
    const { newData } = remapData(data, old, next);
    expect(newData.subjectphoto5).toBe('urlA');
    expect(newData.__hidden__subjectphoto5).toBeUndefined();
    expect(newData.__pos__subjectphoto5).toBeUndefined();
  });

  it('служебные ключи без значения в old не появляются в new', () => {
    const old: Placeholder[] = [photoPh('photo1')];
    const next: Placeholder[] = [photoPh('hero')];
    const data = { photo1: 'urlA' }; // нет __scale__/__offset__
    const { newData } = remapData(data, old, next);
    expect(newData.hero).toBe('urlA');
    expect(newData.__scale__hero).toBeUndefined();
    expect(newData.__offset__hero).toBeUndefined();
  });
});

// ─── Граничные случаи ─────────────────────────────────────────────────

describe('remapData — граничные случаи', () => {
  it('пустой новый мастер: всё в lost', () => {
    const old: Placeholder[] = [photoPh('photo1'), textPh('name')];
    const next: Placeholder[] = [];
    const data = { photo1: 'A', name: 'Аня' };
    const { newData, stats } = remapData(data, old, next);
    expect(newData).toEqual({});
    expect(stats.lost).toBe(2);
  });

  it('пустые старые данные: всё в null', () => {
    const old: Placeholder[] = [photoPh('photo1')];
    const next: Placeholder[] = [photoPh('hero'), photoPh('hero2')];
    const data = {};
    const { newData, stats } = remapData(data, old, next);
    expect(newData.hero).toBe(null);
    expect(newData.hero2).toBe(null);
    expect(stats.exact).toBe(0);
    expect(stats.byType).toBe(0);
    expect(stats.lost).toBe(0);
  });

  it('мусорные служебные ключи в data игнорируются и не вызывают краш', () => {
    const old: Placeholder[] = [photoPh('photo1')];
    const next: Placeholder[] = [photoPh('photo1')];
    const data = {
      photo1: 'urlA',
      __scale__doesnotexist: '2.0', // ключ для несуществующего label
      garbage_key: 'whatever',
    };
    const { newData } = remapData(data, old, next);
    expect(newData.photo1).toBe('urlA');
    // Мусор не попадает в newData
    expect(newData.__scale__doesnotexist).toBeUndefined();
    expect(newData.garbage_key).toBeUndefined();
  });
});

// ─── normalizeLabel ──────────────────────────────────────────────────

describe('normalizeLabel', () => {
  it('переводит в lowercase и удаляет non-alphanumeric', () => {
    expect(normalizeLabel('Studentphoto1')).toBe('studentphoto1');
    expect(normalizeLabel('student_photo_1')).toBe('studentphoto1');
    expect(normalizeLabel('Student Photo 1')).toBe('studentphoto1');
    expect(normalizeLabel('student-photo-1')).toBe('studentphoto1');
    expect(normalizeLabel('STUDENTPHOTO1')).toBe('studentphoto1');
  });

  it('числовой суффикс не теряется (разные слоты не сольются)', () => {
    expect(normalizeLabel('photo1')).not.toBe(normalizeLabel('photo2'));
    expect(normalizeLabel('photo_1')).not.toBe(normalizeLabel('photo_2'));
  });

  it('пустые и спецсимвольные строки', () => {
    expect(normalizeLabel('')).toBe('');
    expect(normalizeLabel('___')).toBe('');
    expect(normalizeLabel('!!!')).toBe('');
  });
});

// ─── hasBalanceOverridesForLabel ─────────────────────────────────────

describe('hasBalanceOverridesForLabel', () => {
  it('видит __hidden__', () => {
    const data = { __hidden__photo1: '1' };
    expect(hasBalanceOverridesForLabel(data, 'photo1')).toBe(true);
    expect(hasBalanceOverridesForLabel(data, 'photo2')).toBe(false);
  });

  it('видит __pos__', () => {
    const data = { __pos__photo1: '50,80' };
    expect(hasBalanceOverridesForLabel(data, 'photo1')).toBe(true);
  });

  it('null/empty значение → false', () => {
    expect(
      hasBalanceOverridesForLabel({ __hidden__photo1: null }, 'photo1'),
    ).toBe(false);
    expect(
      hasBalanceOverridesForLabel({ __hidden__photo1: '' }, 'photo1'),
    ).toBe(false);
  });
});
