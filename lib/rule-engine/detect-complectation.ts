/**
 * РЭ.37.2.b — определение комплектации шаблона.
 *
 * Используется в sections/transition.ts для выбора combo-мастера и
 * стратегии закрытия раздела учеников.
 *
 * Стратегия: смотрим на ПОСЛЕДНЮЮ положенную страницу в pageInstances
 * (на момент входа в transition это всегда последняя страница students-
 * секции — либо combined-tail, либо полная сетка, либо E-Standard/Universal,
 * либо E-Max). По имени мастера определяем комплектацию:
 *
 *   N-Grid-12-* → 'mini'   (12 портретов на странице)
 *   N-Grid-6-*  → 'light'  (6)
 *   N-Grid-4-*  → 'medium' (4)
 *   M-Grid-Page / Combined-Tail-2 / Combined-Tail-3 / Combined-Tail-4 → match по числу
 *   E-Standard-* / E-Standard-Left/Right → 'standard'
 *   E-Universal-* → 'universal'
 *   E-Max-* / M-Student-Spread → 'maximum'
 *
 * РЕШЕНИЕ Сергея А1+Б1 (24.05.2026):
 * Если в шаблоне несколько students-секций с разными мастерами (mismatch),
 * движок ориентируется на КОМПЛЕКТАЦИЮ ПОСЛЕДНЕЙ students-секции (той,
 * чей хвост закрываем). Этот функция как раз смотрит на последнюю
 * положенную страницу → это удовлетворяет А1+Б1 автоматически.
 */

import type { SpreadTemplate } from '@/lib/album-builder/types';
import type { Complectation } from './transition-cases';

/**
 * Распознать комплектацию по имени мастера. null если не удалось
 * (например мастер J-/S- из общего раздела, или незнакомое имя).
 */
export function classifyMasterAsComplectation(
  masterName: string,
): Complectation | null {
  // Нормализуем — убираем потенциальный суффикс -Left / -Right / -Page.
  const base = masterName
    .replace(/-Left$/, '')
    .replace(/-Right$/, '')
    .replace(/-Page$/, '');

  // Mini / Light / Medium — сеточные мастера.
  // Имена в продакшен-каталоге: N-Grid-12-..., N-Grid-6-..., N-Grid-4-...
  // также адаптивные L-2, L-3, L-4 (РЭ.31) и Combined-Tail-N (для combined-tail
  // страниц где portrait slot < N).
  if (/(^|-)N-Grid-12(-|$)/i.test(masterName) ||
      /(^|-)Combined-Tail-4(-|$)/i.test(masterName)) {
    return 'mini';
  }
  if (/(^|-)N-Grid-6(-|$)/i.test(masterName) ||
      /(^|-)L-Grid(-|$)/i.test(masterName) ||
      /(^|-)L-[234](-|$)/i.test(masterName) ||
      /(^|-)Combined-Tail-3(-|$)/i.test(masterName)) {
    return 'light';
  }
  if (/(^|-)N-Grid-4(-|$)/i.test(masterName) ||
      /(^|-)M-Grid(-|$)/i.test(masterName) ||
      /(^|-)Combined-Tail-2(-|$)/i.test(masterName)) {
    return 'medium';
  }

  // Standard / Universal — E-Student с разным числом friend-photo слотов.
  // В тестовом каталоге E-Standard-Left/Right (без friend), E-Universal-Left/
  // Right (без friend в этой fixture), а в продакшене - тоже E-Student-Left/
  // Right с разным slot_capacity.
  if (/^E-Standard$/i.test(base) || /(^|-)E-Standard(-|$)/i.test(masterName)) {
    return 'standard';
  }
  if (/^E-Universal$/i.test(base) || /(^|-)E-Universal(-|$)/i.test(masterName)) {
    return 'universal';
  }
  if (/(^|-)E-Student(-|$)/i.test(masterName)) {
    // E-Student без явного маркера — по умолчанию standard. UI/семантика
    // могут различать standard/universal по student_layout_mode / number
    // of friend-photo слотов; здесь — упрощение.
    return 'standard';
  }

  // Maximum — разворот на ученика.
  if (/(^|-)E-Max(-|$)/i.test(masterName) ||
      /(^|-)M-Student-Spread(-|$)/i.test(masterName)) {
    return 'maximum';
  }

  return null;
}

/**
 * Определить комплектацию по последней положенной странице (которая на
 * момент вызова — последняя страница students-секции).
 *
 * Аргументы:
 *   lastPageMasterId — master_id последней положенной страницы.
 *   mastersByName    — карта name → SpreadTemplate из bundle.
 *
 * Возвращает null если последняя страница не похожа на student-мастер
 * (например, students-секции вообще не было, или там нечто неопознанное).
 */
export function detectComplectationFromLastPage(
  lastPageMasterId: string | undefined,
  mastersByName: ReadonlyMap<string, SpreadTemplate>,
): Complectation | null {
  if (!lastPageMasterId) return null;
  // Найти мастер по id — нужно реверс-маппинг (карта по name → SpreadTemplate
  // с полем id). Линейный поиск, мастеров в шаблоне немного.
  let foundName: string | null = null;
  for (const m of Array.from(mastersByName.values())) {
    if (m.id === lastPageMasterId) {
      foundName = m.name;
      break;
    }
  }
  if (!foundName) return null;
  return classifyMasterAsComplectation(foundName);
}
