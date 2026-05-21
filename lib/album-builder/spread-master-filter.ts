/**
 * РЭ.27.3: определение «spread-мастера» — мастер, занимающий
 * оба листа разворота под одно непрерывное содержимое (фото на разворот).
 *
 * Зачем:
 * Для soft-альбомов такие мастера запрещены — фото пересекало бы корешок,
 * на сгибе теряется часть изображения. См. spec §1.1.
 *
 * Где используется:
 * - В findMaster / каталоге мастеров (engine, последний рубеж): если
 *   resolvedPrintType === 'soft' и кандидат-мастер spread — пропуск.
 * - В UI палитры мастеров (UX, в 27.5): spread-мастера показаны
 *   серым с тултипом «недоступно для мягких листов».
 *
 * Эвристика определения spread-мастера:
 * Сейчас в template_set нет явного маркера «это spread». Используем
 * два сигнала:
 *
 * 1. Имя мастера содержит подстроку 'Spread' или начинается с 'J-Spread'.
 *    Это исторический способ маркировки в OkeyBook (см. master-cleanup-tz).
 *
 * 2. Будущее: явный page_role='common_spread' / 'student_spread' — пока
 *    его нет, но если появится — функция уже учитывает.
 *
 * Чистая функция, тестируется без Supabase.
 */

import type { PageRole } from '@/lib/album-builder/types';

/**
 * Минимальный интерфейс мастера для определения spread'а.
 * Совместим со SpreadTemplate из types.ts, но не зависит от него
 * (чтобы не тащить весь тип в этот модуль).
 */
export type SpreadMasterCandidate = {
  name: string;
  page_role?: PageRole | string | null;
};

/**
 * Возвращает true, если мастер занимает оба листа разворота под одно
 * непрерывное содержимое (фото на разворот). Такие мастера должны
 * быть отфильтрованы при сборке soft-альбома.
 */
export function isSpreadMaster(master: SpreadMasterCandidate): boolean {
  if (!master || typeof master.name !== 'string') return false;

  // 1. По имени (текущий способ маркировки в OkeyBook template_set'ах).
  if (master.name.includes('Spread')) return true;

  // 2. По page_role — на случай если в будущем добавятся явные роли.
  const role = master.page_role;
  if (role === 'common_spread') return true;
  if (role === 'student_spread') return true;

  return false;
}

/**
 * Версия для PrintType-чувствительного фильтра. Возвращает true если
 * мастер разрешён для использования в альбоме с указанным типом переплёта.
 *
 * Контракт:
 * - layflat → все мастера разрешены (true)
 * - soft → spread-мастера запрещены (false на них), остальные разрешены.
 */
export function isMasterAllowedForPrintType(
  master: SpreadMasterCandidate,
  printType: 'layflat' | 'soft',
): boolean {
  if (printType === 'layflat') return true;
  // soft: запрещаем spread
  return !isSpreadMaster(master);
}
