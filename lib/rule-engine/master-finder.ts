/**
 * Семантический поиск мастера ученика в template_set.
 *
 * РЭ.21.8.15 — выравнивание `students.ts` под принцип «engine описывает
 * что ищет, не имена». Раньше код знал имена 'E-Universal-Left',
 * 'E-Standard-Left', 'E-Max-Left' и использовал их жёстко. Теперь engine
 * формирует запрос (`StudentLayoutRequest`) и опрашивает template_set
 * через эту функцию.
 *
 * Алгоритм поиска (упрощённо):
 *  1. Фильтр по `applies_to_configs`: оставляем мастера у которых
 *     либо preset.id в массиве, либо массив пустой (универсальный).
 *  2. Фильтр по `page_role` (если задан в запросе): должен совпадать.
 *  3. Фильтр по `slot_capacity.students === 1` (всегда — у ученических
 *     мастеров всегда 1 ученик).
 *  4. Фильтр по `slot_capacity.has_quote` (если задан в запросе) и
 *     `has_portrait` (если применимо к этой странице).
 *  5. Среди прошедших — выбрать мастер с **точным совпадением** по
 *     `photos_friend`. Если нет — ближайший меньший (Сергей 19.05.2026:
 *     лишние фото просто игнорируются с warning).
 *
 * Возвращает `{ master, exactMatch, lostPhotos }` или null.
 *
 * Сейчас вызывается только из Individual (РЭ.21.8.15) — для других
 * комплектаций engine идёт по жёстким именам. РЭ.22 переведёт остальные
 * комплектации на эту функцию когда партнёры начнут создавать кастомные
 * пресеты.
 */

import type { SlotCapacity, SpreadTemplate } from '@/lib/album-builder/types';

/**
 * Запрос к template_set: какой мастер нужен для одной страницы ученика.
 *
 * Это **одна страница** в кадре поиска (left или right), даже если
 * personalspread занимает 2 страницы — caller вызывает findStudentMaster
 * дважды (для left и для right) с разными запросами.
 */
export interface StudentLayoutRequest {
  /** preset.id альбома, для фильтра по applies_to_configs. */
  presetId: string;
  /** Какая страница разворота нужна. NULL = любая. */
  pageRole?: 'student' | 'student_left' | 'student_right' | null;
  /** Сколько фото с друзьями должен помещать мастер. */
  photosFriend: number;
  /** Должен ли мастер иметь слот для цитаты. NULL = не важно. */
  hasQuote?: boolean | null;
  /** Должен ли мастер иметь слот для портрета. NULL = не важно. */
  hasPortrait?: boolean | null;
}

export interface FindStudentMasterResult {
  master: SpreadTemplate;
  /** true если photos_friend в slot_capacity точно совпал с requested. */
  exactMatch: boolean;
  /**
   * Сколько фото не помещается (если найден мастер с меньшим photos_friend).
   * 0 если exactMatch=true.
   */
  lostPhotos: number;
}

/**
 * Извлечь число из slot_capacity или 0 если поле отсутствует.
 */
function getCapacityNumber(
  slotCapacity: SlotCapacity | null | undefined,
  key: keyof SlotCapacity,
): number {
  if (!slotCapacity) return 0;
  const v = slotCapacity[key];
  if (typeof v === 'number') return v;
  return 0;
}

function getCapacityBool(
  slotCapacity: SlotCapacity | null | undefined,
  key: keyof SlotCapacity,
): boolean {
  if (!slotCapacity) return false;
  const v = slotCapacity[key];
  if (typeof v === 'boolean') return v;
  return false;
}

export function findStudentMaster(
  mastersByName: ReadonlyMap<string, SpreadTemplate>,
  request: StudentLayoutRequest,
): FindStudentMasterResult | null {
  const candidates: SpreadTemplate[] = [];

  // Шаг 1-4: фильтрация. Итерируем все мастера в template_set, оставляем
  // подходящих по applies_to_configs, page_role, students, has_quote,
  // has_portrait.
  mastersByName.forEach((master) => {
    // Фильтр applies_to_configs: либо preset.id в массиве, либо массив пустой.
    const configs = master.applies_to_configs;
    if (configs && configs.length > 0) {
      // applies_to_configs это ConfigType[] — приводим request.presetId
      // через unknown чтобы TS принял (presetId это generic string).
      const presetAsConfig = request.presetId as unknown as (typeof configs)[number];
      if (configs.indexOf(presetAsConfig) < 0) return;
    }

    // Фильтр page_role.
    if (request.pageRole !== undefined && request.pageRole !== null) {
      if (master.page_role !== request.pageRole) return;
    }

    // Шаг 3: students=1 — обязательно. У grid-мастеров (M/L/N-Grid-Page)
    // students > 1, они здесь не должны попадать.
    const studentsCap = getCapacityNumber(master.slot_capacity, 'students');
    if (studentsCap !== 1) return;

    // Фильтр has_quote (если задан).
    if (request.hasQuote !== undefined && request.hasQuote !== null) {
      const masterHasQuote = getCapacityBool(master.slot_capacity, 'has_quote');
      if (masterHasQuote !== request.hasQuote) return;
    }

    // Фильтр has_portrait (если задан).
    if (request.hasPortrait !== undefined && request.hasPortrait !== null) {
      const masterHasPortrait = getCapacityBool(
        master.slot_capacity,
        'has_portrait',
      );
      if (masterHasPortrait !== request.hasPortrait) return;
    }

    candidates.push(master);
  });

  if (candidates.length === 0) return null;

  // Шаг 5: поиск точного совпадения по photos_friend.
  const exactMatch = candidates.find(
    (m) => getCapacityNumber(m.slot_capacity, 'photos_friend') === request.photosFriend,
  );
  if (exactMatch) {
    return { master: exactMatch, exactMatch: true, lostPhotos: 0 };
  }

  // Шаг 5b: ближайший меньший по photos_friend.
  // Сортируем кандидатов по убыванию photos_friend, берём первый с
  // photos_friend <= request.photosFriend.
  let best: SpreadTemplate | null = null;
  let bestCapacity = -1;
  for (let i = 0; i < candidates.length; i++) {
    const cap = getCapacityNumber(candidates[i].slot_capacity, 'photos_friend');
    if (cap > request.photosFriend) continue; // слишком вместительный — пропускаем
    if (cap > bestCapacity) {
      bestCapacity = cap;
      best = candidates[i];
    }
  }

  if (!best) {
    // Все candidates имеют photos_friend > request — это странный случай
    // (например в template_set есть только E-Max с 4 фото, а нужно 2).
    // Возвращаем самый маленький из доступных как fallback с lostPhotos < 0
    // (но это значит «фото не хватило для мастера», а не «фото потеряны»).
    // Берём первый по сортировке возрастания.
    let smallest: SpreadTemplate | null = null;
    let smallestCap = Infinity;
    for (let i = 0; i < candidates.length; i++) {
      const cap = getCapacityNumber(candidates[i].slot_capacity, 'photos_friend');
      if (cap < smallestCap) {
        smallestCap = cap;
        smallest = candidates[i];
      }
    }
    if (!smallest) return null;
    // Возвращаем как НЕ exact match, lostPhotos=0 (фото меньше чем слотов
    // — лишние слоты будут пустые, но фото никаких не теряем).
    return { master: smallest, exactMatch: false, lostPhotos: 0 };
  }

  return {
    master: best,
    exactMatch: false,
    lostPhotos: request.photosFriend - bestCapacity,
  };
}
