import { describe, it, expect } from 'vitest';
import {
  findReplacementMaster,
  describeSpreadType,
  checkCoverage,
  type LayoutSpreadRef,
} from '../compatibility';
import type { SlotCapacity, SpreadTemplate, PageRole, MasterType } from '@/lib/album-builder/types';

/** Фабрика минимального мастера для тестов. */
function master(
  id: string,
  pageRole: PageRole | null,
  slotCapacity: SlotCapacity | null,
  type: MasterType = 'student',
): SpreadTemplate {
  return {
    id,
    name: id,
    type,
    is_spread: false,
    width_mm: 200,
    height_mm: 280,
    placeholders: [],
    rules: null,
    sort_order: 0,
    applies_to_configs: [],
    default_for_configs: [],
    page_role: pageRole,
    slot_capacity: slotCapacity,
    is_fallback: false,
    mirror_for_soft: false,
    audit_notes: null,
  };
}

const FORBIDDEN = ['мастер', 'слот', 'capacity', 'page_role', 'template'];
function assertHuman(message: string | null) {
  expect(message).toBeTruthy();
  for (const w of FORBIDDEN) expect(message!.toLowerCase()).not.toContain(w);
}

describe('findReplacementMaster', () => {
  it('сетка на 6: новый дизайн с мастером на 6 → найдено', () => {
    const cur = master('L-6', 'student_grid', { students: 6 });
    const target = [master('G-4', 'student_grid', { students: 4 }), master('G-6', 'student_grid', { students: 6 })];
    expect(findReplacementMaster(cur, target)?.id).toBe('G-6');
  });

  it('сетка на 6: только мастер на 4 → null (ёмкости не хватает)', () => {
    const cur = master('L-6', 'student_grid', { students: 6 });
    expect(findReplacementMaster(cur, [master('G-4', 'student_grid', { students: 4 })])).toBeNull();
  });

  it('выбирает МИНИМАЛЬНО достаточный (меньше пустых слотов)', () => {
    const cur = master('L-6', 'student_grid', { students: 6 });
    const target = [master('G-12', 'student_grid', { students: 12 }), master('G-8', 'student_grid', { students: 8 })];
    expect(findReplacementMaster(cur, target)?.id).toBe('G-8');
  });

  it('photos_friend — мягкая: меньше фото с друзьями НЕ блокирует', () => {
    const cur = master('E-Left', 'student_left', { students: 1, photos_friend: 2, has_portrait: true, has_name: true });
    const target = [master('X-Left', 'student_left', { students: 1, photos_friend: 0, has_portrait: true, has_name: true })];
    expect(findReplacementMaster(cur, target)?.id).toBe('X-Left');
  });

  it('has_portrait — жёсткая: нет портрета → null', () => {
    const cur = master('E-Left', 'student_left', { students: 1, has_portrait: true, has_name: true });
    const target = [master('X-Left', 'student_left', { students: 1, has_portrait: false, has_name: true })];
    expect(findReplacementMaster(cur, target)).toBeNull();
  });

  it('генерик student_grid заменяет конкретную student_grid_left', () => {
    const cur = master('L-6-Left', 'student_grid_left', { students: 6 });
    expect(findReplacementMaster(cur, [master('G-6', 'student_grid', { students: 6 })])?.id).toBe('G-6');
  });

  it('роли разных семейств не матчатся (student_left ≠ student)', () => {
    const cur = master('E-Left', 'student_left', { students: 1, has_portrait: true });
    expect(findReplacementMaster(cur, [master('E-Combined', 'student', { students: 1, has_portrait: true })])).toBeNull();
  });

  it('учителя: нужно 6 предметников, есть только на 3 → null', () => {
    const cur = master('G-3x2', 'teacher_right', { teachers: 6 });
    expect(findReplacementMaster(cur, [master('G-3', 'teacher_right', { teachers: 3 })])).toBeNull();
  });
});

describe('describeSpreadType — человеческий язык', () => {
  it('сетка → «разворот на N учеников»', () => {
    expect(describeSpreadType(master('L-6', 'student_grid', { students: 6 }))).toBe('разворот на 6 учеников');
    expect(describeSpreadType(master('L-1', 'student_grid', { students: 1 }))).toBe('разворот на 1 ученика');
  });
  it('личная страница', () => {
    expect(describeSpreadType(master('E-Left', 'student_left', { students: 1 }))).toBe('личная страница ученика');
  });
  it('учителя / общее фото', () => {
    expect(describeSpreadType(master('G-3x2', 'teacher_right', { teachers: 6 }))).toBe('страница с учителями');
    expect(describeSpreadType(master('G-Full', 'teacher_right', { photos_full: 1, teachers: 0 }))).toBe('страница с общим фото класса');
  });
});

describe('checkCoverage', () => {
  const curMasters = new Map<string, SpreadTemplate>([
    ['m-grid6', master('L-6', 'student_grid', { students: 6 })],
    ['m-grid4', master('L-4', 'student_grid', { students: 4 })],
    ['m-teach', master('G-3x2', 'teacher_right', { teachers: 6 })],
    ['m-collage5', master('J-Collage-5', 'common', { photos_collage: 5 }, 'common')],
  ]);
  const spreads = (ids: string[]): LayoutSpreadRef[] =>
    ids.map((template_id, i) => ({ spread_index: i, template_id }));

  it('совместимый дизайн → ok:true, message null', () => {
    const target = [master('T-6', 'student_grid', { students: 6 }), master('T-T', 'teacher_right', { teachers: 6 })];
    const r = checkCoverage(spreads(['m-grid6', 'm-teach']), curMasters, target, 'Новый');
    expect(r.ok).toBe(true);
    expect(r.message).toBeNull();
    expect(r.missing).toHaveLength(0);
  });

  it('нет мастера на 6, но есть на 4 → одиночный текст с «максимум 4 на разворот»', () => {
    const target = [master('T-4', 'student_grid', { students: 4 }), master('T-T', 'teacher_right', { teachers: 6 })];
    const r = checkCoverage(spreads(['m-grid6', 'm-grid6', 'm-teach']), curMasters, target, 'Аква меч');
    expect(r.ok).toBe(false);
    expect(r.missing).toHaveLength(1);
    expect(r.missing[0].label).toBe('разворот на 6 учеников');
    expect(r.missing[0].spreadIndexes).toEqual([0, 1]);
    expect(r.message).toContain('Аква меч');
    expect(r.message).toContain('разворот на 6 учеников');
    expect(r.message).toContain('максимум 4 на разворот');
    assertHuman(r.message);
  });

  it('коллаж: нужно 5, есть 4 → «из 5 фотографий … максимум 4 фотографии в коллаже»', () => {
    const target = [master('J-Collage-4', 'common', { photos_collage: 4 }, 'common')];
    const r = checkCoverage(spreads(['m-collage5']), curMasters, target, 'Белый');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('страница-коллаж из 5 фотографий');
    expect(r.message).toContain('максимум 4 фотографии в коллаже');
    assertHuman(r.message);
  });

  it('несколько недостающих типов — маркированный список с количеством и хвостами', () => {
    const target = [master('T-4', 'student_grid', { students: 4 })]; // есть только 4-сетка
    const r = checkCoverage(spreads(['m-grid6', 'm-teach']), curMasters, target, 'Минимал');
    expect(r.ok).toBe(false);
    expect(r.missing).toHaveLength(2);
    expect(r.message).toContain('— разворот на 6 учеников');
    expect(r.message).toContain('максимум 4 на разворот'); // 6-сетка: есть 4
    expect(r.message).toContain('таких страниц нет'); // учителей нет вовсе
    assertHuman(r.message);
  });

  it('пустой альбом → ok:true', () => {
    const r = checkCoverage([], curMasters, [master('T-6', 'student_grid', { students: 6 })], 'Любой');
    expect(r.ok).toBe(true);
  });

  it('мастер текущего разворота не найден → в unverified, не блокирует', () => {
    const target = [master('T-6', 'student_grid', { students: 6 })];
    const r = checkCoverage(
      [{ spread_index: 0, template_id: 'НЕИЗВЕСТНЫЙ' }],
      curMasters,
      target,
      'Новый',
    );
    expect(r.ok).toBe(true);
    expect(r.unverifiedSpreadIndexes).toEqual([0]);
  });
});
