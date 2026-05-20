/**
 * Тесты для validatePreset (РЭ.24.2).
 *
 * Покрывают:
 *  - Полностью валидный шаблон → valid=true, errors=[]
 *  - Каждое из 6 правил по отдельности (нарушение → конкретная ошибка)
 *  - Граничные случаи: student_grid_size = 1, 2, 12, 13, NULL для grid
 *  - Множественные ошибки одновременно
 *  - Несколько секций в section_structure (students присутствует / не присутствует)
 */

import { describe, it, expect } from 'vitest';
import { validatePreset } from '../validate';
import type { Preset } from '@/lib/rule-engine/types';

function makeValidPreset(overrides: Partial<Preset> = {}): Preset {
  return {
    id: 'p1',
    display_name: 'Стандарт',
    print_type: 'layflat',
    pages_per_spread: 2,
    version: '1.0',
    sections: [],
    tenant_id: null,
    template_set_id: 'ts-uuid',
    section_structure: [
      { type: 'soft_intro' },
      { type: 'students' },
      { type: 'teachers' },
    ],
    student_layout_mode: 'grid',
    student_grid_size: 4,
    ...overrides,
  } as Preset;
}

describe('validatePreset (РЭ.24.2)', () => {
  it('Полностью валидный grid-шаблон → valid=true, errors=[]', () => {
    const result = validatePreset(makeValidPreset());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('Валидный page-шаблон (без grid_size) → valid=true', () => {
    const result = validatePreset(
      makeValidPreset({ student_layout_mode: 'page', student_grid_size: null }),
    );
    expect(result.valid).toBe(true);
  });

  it('Валидный spread-шаблон → valid=true', () => {
    const result = validatePreset(
      makeValidPreset({ student_layout_mode: 'spread', student_grid_size: null }),
    );
    expect(result.valid).toBe(true);
  });

  it('Шаблон без секции students не требует student_layout_mode → valid=true', () => {
    // Только обложка + общий раздел, без личного — student_* поля не нужны.
    const result = validatePreset(
      makeValidPreset({
        section_structure: [
          { type: 'common_required' },
          { type: 'teachers' },
        ],
        student_layout_mode: null,
        student_grid_size: null,
      }),
    );
    expect(result.valid).toBe(true);
  });

  // ─── Правило 1: display_name ─────────────────────────────────────────────

  it('Пустой display_name → invalid с конкретной ошибкой', () => {
    const result = validatePreset(makeValidPreset({ display_name: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Название шаблона не может быть пустым');
  });

  it('display_name из пробелов → invalid (trim)', () => {
    const result = validatePreset(makeValidPreset({ display_name: '   ' }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Название');
  });

  // ─── Правило 2: print_type ───────────────────────────────────────────────

  it("Невалидный print_type → invalid", () => {
    // @ts-expect-error — намеренно передаём невалидное значение
    const result = validatePreset(makeValidPreset({ print_type: 'wrong' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Тип печати'))).toBe(true);
  });

  // ─── Правило 3: template_set_id ──────────────────────────────────────────

  it('template_set_id=null → invalid', () => {
    const result = validatePreset(makeValidPreset({ template_set_id: null }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('набор шаблонов'))).toBe(true);
  });

  it('template_set_id=пустая строка → invalid', () => {
    const result = validatePreset(makeValidPreset({ template_set_id: '   ' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('набор шаблонов'))).toBe(true);
  });

  // ─── Правило 4: section_structure ────────────────────────────────────────

  it('section_structure пустой массив → invalid', () => {
    const result = validatePreset(makeValidPreset({ section_structure: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Структура альбома пуста'))).toBe(true);
  });

  it('section_structure=null → invalid', () => {
    const result = validatePreset(makeValidPreset({ section_structure: null }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Структура альбома пуста'))).toBe(true);
  });

  // ─── Правило 5: student_layout_mode при наличии students ─────────────────

  it('Есть секция students, но student_layout_mode=null → invalid', () => {
    const result = validatePreset(
      makeValidPreset({ student_layout_mode: null, student_grid_size: null }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('режим'))).toBe(true);
  });

  // ─── Правило 6: student_grid_size при mode=grid ──────────────────────────

  it("mode='grid' + grid_size=null → invalid", () => {
    const result = validatePreset(
      makeValidPreset({ student_layout_mode: 'grid', student_grid_size: null }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('число учеников'))).toBe(true);
  });

  it("mode='grid' + grid_size=1 (меньше 2) → invalid", () => {
    const result = validatePreset(
      makeValidPreset({ student_layout_mode: 'grid', student_grid_size: 1 }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('от 2 до 12'))).toBe(true);
  });

  it("mode='grid' + grid_size=2 (граница) → valid", () => {
    const result = validatePreset(
      makeValidPreset({ student_layout_mode: 'grid', student_grid_size: 2 }),
    );
    expect(result.valid).toBe(true);
  });

  it("mode='grid' + grid_size=12 (граница) → valid", () => {
    const result = validatePreset(
      makeValidPreset({ student_layout_mode: 'grid', student_grid_size: 12 }),
    );
    expect(result.valid).toBe(true);
  });

  it("mode='grid' + grid_size=13 (больше 12) → invalid", () => {
    const result = validatePreset(
      makeValidPreset({ student_layout_mode: 'grid', student_grid_size: 13 }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('от 2 до 12'))).toBe(true);
  });

  // ─── Множественные ошибки ────────────────────────────────────────────────

  it('Несколько одновременных нарушений → все в errors', () => {
    const result = validatePreset(
      makeValidPreset({
        display_name: '',
        template_set_id: null,
        student_layout_mode: null,
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});
