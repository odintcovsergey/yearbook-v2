/**
 * Система категорийных фонов — Этап 2: маппинг page_role → категория фона.
 *
 * ЕДИНСТВЕННОЕ место, где роль страницы превращается в категорию фона.
 * Меняется здесь — меняется везде (резолвер, UI super-admin, редактор).
 *
 * Категория — это строка (НЕ enum в БД), чтобы расширять набор без миграции.
 * Здесь же — канонический список стартовых категорий (BACKGROUND_CATEGORIES)
 * для UI: показываем секции загрузки по этому списку.
 *
 * Стартовый набор категорий (из ТЗ):
 *   intro         — page_role intro (S-Intro)
 *   teacher       — teacher_left, teacher_right
 *   student       — student, student_left, student_right, student_last
 *   student_grid  — student_grid(_left/_right), student_overflow(_right) (виньетки/сетки)
 *   common        — common
 *   final         — final (S-Final)
 *   cover         — cover (обложка)
 */

import type { PageRole } from '@/lib/album-builder/types';

/** Канонический порядок категорий — используется UI для секций загрузки. */
export const BACKGROUND_CATEGORIES = [
  'intro',
  'teacher',
  'student',
  'student_grid',
  'common',
  'final',
  'cover',
] as const;

export type BackgroundCategory = (typeof BACKGROUND_CATEGORIES)[number];

/** Человекочитаемые подписи категорий для UI super-admin. */
export const BACKGROUND_CATEGORY_LABELS: Record<BackgroundCategory, string> = {
  intro: 'Вступление',
  teacher: 'Учителя',
  student: 'Личные страницы',
  student_grid: 'Сетки / виньетки',
  common: 'Общий раздел',
  final: 'Финал',
  cover: 'Обложка',
};

/**
 * page_role → категория фона. Возвращает null, если роль не задана или
 * не маппится ни на одну категорию (тогда движок уйдёт в fallback).
 */
export function pageRoleToCategory(
  role: PageRole | null | undefined,
): BackgroundCategory | null {
  switch (role) {
    case 'intro':
      return 'intro';

    case 'teacher_left':
    case 'teacher_right':
      return 'teacher';

    case 'student':
    case 'student_left':
    case 'student_right':
    case 'student_last':
      return 'student';

    case 'student_grid':
    case 'student_grid_left':
    case 'student_grid_right':
    case 'student_overflow':
    case 'student_overflow_right':
      return 'student_grid';

    case 'common':
      return 'common';

    case 'final':
      return 'final';

    case 'cover':
      return 'cover';

    default:
      return null;
  }
}
