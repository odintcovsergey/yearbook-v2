/**
 * РЭ.22.10 — семантический выбор combo-мастера переходного раздела
 * (by-type вместо by-name).
 *
 * Раньше combo-мастер хвоста искался по ИМЕНИ из конвенции:
 * `mastersByName.get('J-Combined-Tail-4')` для левой страницы и
 * `mastersByName.get('J-Combined-Tail-4-Right')` для правой (с фолбэком на
 * base). Теперь — по семантике, как у students/teachers/soft/common:
 *   page_role='student_grid' + ёмкость (students=M, есть classphoto) +
 *   page_type (сторона).
 *
 * ЧТО ТАКОЕ COMBO-МАСТЕР (отличие от соседей по page_role='student_grid'):
 *   • combo (J-Combined-Tail-N): M маленьких слотов учеников + classphoto,
 *     БЕЗ крупного сольного портрета → slot_capacity={students:M, photos_full≥1}
 *     без has_portrait. Сторонний (page-left у base, page-right у -Right).
 *   • N/L/M-Combined-Page: грид с КРУПНЫМ портретом → has_portrait=true,
 *     page-any. Это НЕ combo хвоста — исключаем по has_portrait.
 *   • N/L/M-Grid-Page: чистый грид без classphoto → photos_full=0. Исключаем.
 *
 * ИДЕНТИЧНОСТЬ СТОРОНЫ (главная риск-точка РЭ.22.10). by-name брал:
 *   left  → base (по конвенции base = page-left)
 *   right → -Right (page-right), фолбэк на base
 * Воспроизводим списком приоритета page_type:
 *   left  → ['page-left', 'page-any']
 *   right → ['page-right', 'page-left', 'page-any']
 * page-any в хвосте — фолбэк на случай симметричного combo; он безопасен,
 * потому что has_portrait уже отсёк page-any мастера N-Combined-Page.
 *
 * Чистая, без БД — юнит-тестируется.
 */

import type { SpreadTemplate } from '@/lib/album-builder/types';
import type { CommonPageType } from './find-common-master';

export function findComboTailMaster(
  mastersByName: ReadonlyMap<string, SpreadTemplate>,
  capacity: number,
  position: 'left' | 'right',
): SpreadTemplate | null {
  const pref: readonly CommonPageType[] =
    position === 'right'
      ? ['page-right', 'page-left', 'page-any']
      : ['page-left', 'page-any'];
  const masters = Array.from(mastersByName.values());
  for (const pt of pref) {
    for (const m of masters) {
      if (m.page_role !== 'student_grid') continue;
      const cap = m.slot_capacity as
        | Record<string, number | boolean>
        | null
        | undefined;
      if (!cap) continue;
      if ((cap.students ?? 0) !== capacity) continue;
      // combo хвоста несёт classphoto (photos_full≥1)…
      if (!((cap.photos_full as number) >= 1)) continue;
      // …и НЕ крупный портрет (это бы был N-Combined-Page, page-any).
      if (cap.has_portrait) continue;
      if ((m.page_type ?? 'page-any') === pt) return m;
    }
  }
  return null;
}
