/**
 * РЭ.24.2: валидация шаблона (Preset) для каталога /app/templates.
 *
 * Чистая функция: принимает Preset, возвращает { valid, errors }.
 * Используется на сервере (фильтрация шаблонов для каталога) и в UI
 * (флаг 'Доработай' на карточках партнёрских шаблонов).
 *
 * Правила (см. docs/phase-Р24-spec.md §3):
 *   1. display_name непустое (после trim)
 *   2. print_type ∈ {'layflat', 'soft'}
 *   3. template_set_id не NULL и не пустая строка
 *   4. section_structure — массив длиной ≥ 1
 *   5. Если в section_structure есть секция {type:'students'} —
 *      student_layout_mode должен быть установлен ('page' | 'spread' | 'grid')
 *   6. Если student_layout_mode === 'grid' — student_grid_size в 2..12
 *
 * errors — массив человеко-читаемых строк на русском (для отображения
 * в UI пометки 'Доработай').
 */

import type { Preset } from '@/lib/rule-engine/types';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const ALLOWED_LAYOUT_MODES = ['page', 'spread', 'grid'] as const;
const MIN_GRID_SIZE = 2;
const MAX_GRID_SIZE = 12;

export function validatePreset(preset: Preset): ValidationResult {
  const errors: string[] = [];

  // 1. display_name
  if (!preset.display_name || preset.display_name.trim() === '') {
    errors.push('Название шаблона не может быть пустым');
  }

  // 2. print_type — только 'layflat' или 'soft'.
  // У PrintType из rule-engine есть третье значение 'tryumo', но для
  // шаблонов в каталоге РЭ.24 оно невалидно (только основные два типа).
  if (preset.print_type !== 'layflat' && preset.print_type !== 'soft') {
    errors.push(
      `Тип печати должен быть 'layflat' или 'soft' (сейчас: ${
        preset.print_type ?? 'не задан'
      })`,
    );
  }

  // 3. template_set_id
  const tsId = preset.template_set_id;
  if (tsId === null || tsId === undefined || (typeof tsId === 'string' && tsId.trim() === '')) {
    errors.push('Не выбран набор шаблонов вёрстки (template_set)');
  }

  // 4. section_structure — массив длиной ≥ 1
  const ss = preset.section_structure;
  if (!Array.isArray(ss) || ss.length === 0) {
    errors.push('Структура альбома пуста — добавьте хотя бы одну секцию');
  }

  // 5+6. Правила для students-секции
  const hasStudentsSection =
    Array.isArray(ss) && ss.some((entry) => entry?.type === 'students');
  if (hasStudentsSection) {
    const mode = preset.student_layout_mode;
    if (mode === null || mode === undefined) {
      errors.push(
        'Для секции «Личный раздел» не выбран режим (один ученик на страницу / разворот / сетка)',
      );
    } else if (!ALLOWED_LAYOUT_MODES.includes(mode)) {
      errors.push(
        `Недопустимый режим личного раздела: '${mode}'. Допустимые: page, spread, grid`,
      );
    } else if (mode === 'grid') {
      // 6. student_grid_size обязателен и в диапазоне
      const size = preset.student_grid_size;
      if (size === null || size === undefined) {
        errors.push(
          'Для режима «сетка» не указано число учеников на странице (student_grid_size)',
        );
      } else if (
        typeof size !== 'number' ||
        !Number.isInteger(size) ||
        size < MIN_GRID_SIZE ||
        size > MAX_GRID_SIZE
      ) {
        errors.push(
          `Число учеников на странице должно быть целым от ${MIN_GRID_SIZE} до ${MAX_GRID_SIZE} (сейчас: ${size})`,
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
