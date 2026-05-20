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
 *
 * РЭ.22.6: добавлены grid-роли `student_grid` / `student_grid_left` /
 * `student_grid_right`. Но `findStudentMaster` сам ВСЁ ЕЩЁ требует
 * `slot_capacity.students === 1` (см. фильтр в теле функции) — для grid
 * (`studentsCount > 1`) используется отдельная функция
 * `findStudentGridMaster`. Это сознательное разделение: page/spread
 * ищет «точное совпадение по photos_friend ИЛИ ближайший меньший», а
 * grid — «точное совпадение по students» (для base) или «минимально-
 * достаточный по students» (для адаптивного хвоста). Семантика поиска
 * разная, поэтому функции разные.
 */
export interface StudentLayoutRequest {
  /** preset.id альбома, для фильтра по applies_to_configs. */
  presetId: string;
  /** Какая страница разворота нужна. NULL = любая. */
  pageRole?:
    | 'student'
    | 'student_left'
    | 'student_right'
    | 'student_grid'
    | 'student_grid_left'
    | 'student_grid_right'
    | null;
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

// ─── РЭ.22.6: семантический поиск для grid-режима ──────────────────────────

/**
 * Запрос к template_set для grid-мастера (mode='grid' в двух-осевой модели).
 *
 * В отличие от `StudentLayoutRequest` (один ученик на страницу), здесь
 * партнёр указывает сколько учеников должно помещаться на странице
 * (`studentsCount`). Опционально требует `photosFull` (1 для combined-tail
 * с общим фото класса, 0 для обычной сетки).
 *
 * Совмещение grid + photos_friend в текущей модели не поддерживается
 * (для сетки фото с друзьями обычно не предусмотрены — каждый ученик
 * представлен только портретом).
 */
export interface StudentGridLayoutRequest {
  /** preset.id альбома, для фильтра по applies_to_configs. */
  presetId: string;
  /**
   * Какая страница нужна. По умолчанию учитываются `student_grid_left`,
   * `student_grid_right` и `student_grid` (последний — fallback для
   * симметричных мастеров).
   *
   * Если NULL или не задан — принимаются все три grid-роли.
   */
  pageRole?: 'student_grid' | 'student_grid_left' | 'student_grid_right' | null;
  /** Сколько учеников должно поместиться на странице. */
  studentsCount: number;
  /**
   * Режим сопоставления по числу учеников:
   *  - `exact` — точное совпадение `slot_capacity.students === studentsCount`.
   *    Используется для базы сетки.
   *  - `min_fit` — `slot_capacity.students >= studentsCount`, выбирается
   *    минимально-достаточный. Используется для адаптивного хвоста и
   *    combined-tail (мастер шире остатка → лишние слоты остаются null).
   */
  match: 'exact' | 'min_fit';
  /**
   * Должно ли быть `slot_capacity.photos_full === photosFull` (точное).
   * Не задан → не фильтруем. Обычно: 0 для plain grid, 1 для combined-tail.
   */
  photosFull?: number;
  /** Должен ли мастер иметь quote-слоты для всех учеников. NULL = не важно. */
  hasQuote?: boolean | null;
  /** Должен ли мастер иметь portrait-слоты. NULL = не важно. */
  hasPortrait?: boolean | null;
}

export interface FindStudentGridMasterResult {
  master: SpreadTemplate;
  /** true если slot_capacity.students точно совпал с studentsCount. */
  exactMatch: boolean;
  /**
   * Сколько слотов учеников останется пустыми. 0 если exactMatch=true,
   * (slot_capacity.students - studentsCount) если match='min_fit' и мастер
   * шире.
   */
  emptySlots: number;
}

/**
 * Семантический поиск grid-мастера в template_set (РЭ.22.6).
 *
 * Алгоритм:
 *  1. Фильтр `applies_to_configs` (как в findStudentMaster).
 *  2. Фильтр `page_role`: принимаются `student_grid_*` (left/right) и
 *     нейтральный `student_grid`. Если `request.pageRole` задан конкретно
 *     — фильтр строгий.
 *  3. Фильтр `slot_capacity.students` — по `match`:
 *     - `exact`: students === studentsCount
 *     - `min_fit`: students >= studentsCount
 *  4. Опциональный фильтр `slot_capacity.photos_full` (точное совпадение).
 *  5. Опциональные `has_quote` / `has_portrait`.
 *  6. Если кандидатов несколько:
 *     - `exact`: возвращаем первого по итерации Map'а
 *     - `min_fit`: возвращаем кандидата с минимальным `students` (ближе
 *       всего к studentsCount)
 */
export function findStudentGridMaster(
  mastersByName: ReadonlyMap<string, SpreadTemplate>,
  request: StudentGridLayoutRequest,
): FindStudentGridMasterResult | null {
  const candidates: SpreadTemplate[] = [];

  mastersByName.forEach((master) => {
    // Фильтр applies_to_configs.
    const configs = master.applies_to_configs;
    if (configs && configs.length > 0) {
      const presetAsConfig = request.presetId as unknown as (typeof configs)[number];
      if (configs.indexOf(presetAsConfig) < 0) return;
    }

    // Фильтр page_role.
    const role = master.page_role;
    if (request.pageRole !== undefined && request.pageRole !== null) {
      // Конкретная роль запрошена — строгое совпадение, но student_grid
      // принимается как fallback для student_grid_left/right (симметричный).
      const acceptsGenericGrid =
        (request.pageRole === 'student_grid_left' ||
          request.pageRole === 'student_grid_right') &&
        role === 'student_grid';
      if (master.page_role !== request.pageRole && !acceptsGenericGrid) return;
    } else {
      // Любая grid-роль принимается.
      if (
        role !== 'student_grid' &&
        role !== 'student_grid_left' &&
        role !== 'student_grid_right'
      ) {
        return;
      }
    }

    // Фильтр по students.
    const studentsCap = getCapacityNumber(master.slot_capacity, 'students');
    if (request.match === 'exact') {
      if (studentsCap !== request.studentsCount) return;
    } else {
      // min_fit
      if (studentsCap < request.studentsCount) return;
    }

    // Опциональный фильтр по photos_full.
    if (request.photosFull !== undefined) {
      const photosFullCap = getCapacityNumber(master.slot_capacity, 'photos_full');
      if (photosFullCap !== request.photosFull) return;
    }

    // Фильтр has_quote (если задан).
    if (request.hasQuote !== undefined && request.hasQuote !== null) {
      const masterHasQuote = getCapacityBool(master.slot_capacity, 'has_quote');
      if (masterHasQuote !== request.hasQuote) return;
    }

    // Фильтр has_portrait (если задан).
    if (request.hasPortrait !== undefined && request.hasPortrait !== null) {
      const masterHasPortrait = getCapacityBool(master.slot_capacity, 'has_portrait');
      if (masterHasPortrait !== request.hasPortrait) return;
    }

    candidates.push(master);
  });

  if (candidates.length === 0) return null;

  if (request.match === 'exact') {
    // Точное совпадение — берём первого по итерации Map'а.
    return { master: candidates[0], exactMatch: true, emptySlots: 0 };
  }

  // min_fit — берём кандидата с минимальным students (ближе всего к запросу).
  let best = candidates[0];
  let bestCap = getCapacityNumber(best.slot_capacity, 'students');
  for (let i = 1; i < candidates.length; i++) {
    const cap = getCapacityNumber(candidates[i].slot_capacity, 'students');
    if (cap < bestCap) {
      bestCap = cap;
      best = candidates[i];
    }
  }
  return {
    master: best,
    exactMatch: bestCap === request.studentsCount,
    emptySlots: bestCap - request.studentsCount,
  };
}

// ─── РЭ.22.7.2: семантический поиск teacher-мастеров ───────────────────────

/**
 * Запрос к template_set для учительского мастера (секция 'teachers').
 *
 * Учительский разворот всегда имеет две стороны:
 *  - Левая (page_role='teacher_left'): главный учитель + опц. сетка
 *    предметников или общее фото класса (F-Head-WithClassPhoto-L).
 *  - Правая (page_role='teacher_right'): либо общее фото класса
 *    (G-FullClass / G-HalfClass), либо сетка предметников
 *    (G-Teachers-3x3 / 3x4 / 4x4).
 *
 * Критерии поиска:
 *  - `headTeacher` (точное): сколько слотов главного учителя должен
 *    иметь мастер. Обычно 1 для левой страницы, 0 для правой.
 *  - `teachers` (по match): сколько слотов предметников.
 *  - `photosFull` (точное): рамок общего фото класса.
 *  - `photosHalf` (точное): рамок «полкласса».
 *
 * `match` для `teachers`:
 *  - `exact` — точное совпадение `slot_capacity.teachers === teachers`.
 *  - `min_fit` — `slot_capacity.teachers >= teachers`, минимально-достаточный.
 */
export interface TeacherSearchRequest {
  presetId: string;
  pageRole: 'teacher_left' | 'teacher_right';
  match: 'exact' | 'min_fit';
  /** Точное число слотов главного учителя. По умолчанию не фильтруем. */
  headTeacher?: number;
  /** Число слотов предметников, режим определяется `match`. */
  teachers?: number;
  /** Точное число рамок общего фото класса. По умолчанию не фильтруем. */
  photosFull?: number;
  /** Точное число рамок полкласса. По умолчанию не фильтруем. */
  photosHalf?: number;
}

export interface FindTeacherMasterResult {
  master: SpreadTemplate;
  /** true если slot_capacity.teachers точно совпал с запросом. */
  exactMatch: boolean;
  /**
   * Сколько слотов предметников останется пустыми (0 если exactMatch=true,
   * (slot_capacity.teachers - request.teachers) если match='min_fit').
   */
  emptySlots: number;
}

/**
 * Семантический поиск teacher-мастера в template_set (РЭ.22.7.2).
 *
 * Алгоритм:
 *  1. Фильтр applies_to_configs (как в findStudentMaster).
 *  2. Фильтр page_role — строгий ('teacher_left' либо 'teacher_right').
 *  3. Опциональные точные фильтры headTeacher / photosFull / photosHalf.
 *  4. Фильтр teachers по match:
 *     - 'exact': slot_capacity.teachers === request.teachers
 *     - 'min_fit': slot_capacity.teachers >= request.teachers
 *  5. Из подходящих кандидатов:
 *     - 'exact': первый по итерации Map'а
 *     - 'min_fit': кандидат с минимальным slot_capacity.teachers
 */
export function findTeacherMaster(
  mastersByName: ReadonlyMap<string, SpreadTemplate>,
  request: TeacherSearchRequest,
): FindTeacherMasterResult | null {
  const candidates: SpreadTemplate[] = [];

  mastersByName.forEach((master) => {
    // Фильтр applies_to_configs.
    const configs = master.applies_to_configs;
    if (configs && configs.length > 0) {
      const presetAsConfig = request.presetId as unknown as (typeof configs)[number];
      if (configs.indexOf(presetAsConfig) < 0) return;
    }

    // Фильтр page_role — строгий.
    if (master.page_role !== request.pageRole) return;

    // Точный фильтр head_teacher.
    if (request.headTeacher !== undefined) {
      const cap = getCapacityNumber(master.slot_capacity, 'head_teacher');
      if (cap !== request.headTeacher) return;
    }

    // Точный фильтр photos_full.
    if (request.photosFull !== undefined) {
      const cap = getCapacityNumber(master.slot_capacity, 'photos_full');
      if (cap !== request.photosFull) return;
    }

    // Точный фильтр photos_half.
    if (request.photosHalf !== undefined) {
      const cap = getCapacityNumber(master.slot_capacity, 'photos_half');
      if (cap !== request.photosHalf) return;
    }

    // Фильтр teachers по match.
    if (request.teachers !== undefined) {
      const cap = getCapacityNumber(master.slot_capacity, 'teachers');
      if (request.match === 'exact') {
        if (cap !== request.teachers) return;
      } else {
        if (cap < request.teachers) return;
      }
    }

    candidates.push(master);
  });

  if (candidates.length === 0) return null;

  const requestedTeachers = request.teachers ?? 0;

  if (request.match === 'exact') {
    return { master: candidates[0], exactMatch: true, emptySlots: 0 };
  }

  // min_fit — берём кандидата с минимальным teachers (ближайший к запросу).
  let best = candidates[0];
  let bestCap = getCapacityNumber(best.slot_capacity, 'teachers');
  for (let i = 1; i < candidates.length; i++) {
    const cap = getCapacityNumber(candidates[i].slot_capacity, 'teachers');
    if (cap < bestCap) {
      bestCap = cap;
      best = candidates[i];
    }
  }
  return {
    master: best,
    exactMatch: bestCap === requestedTeachers,
    emptySlots: bestCap - requestedTeachers,
  };
}

// ─── РЭ.22.8.2: семантический поиск soft_intro/soft_final мастеров ──────────

/**
 * Запрос к template_set для soft-секции (intro / final).
 *
 * Эти секции — одностраничные, один мастер на роль. Семантика проще чем
 * у students/teachers: нет режимов match (для одной роли мастер либо есть,
 * либо нет), нет таблицы выбора по числу. Опциональный `photosFull` фильтр
 * (1 если у мастера должен быть слот classphotoframe, 0 если без).
 */
export interface SoftSectionRequest {
  presetId: string;
  pageRole: 'intro' | 'final';
  /**
   * Точное число рамок общего фото класса. По умолчанию не фильтруем
   * (любой мастер с подходящим page_role).
   */
  photosFull?: number;
}

export interface FindSoftSectionMasterResult {
  master: SpreadTemplate;
}

/**
 * Семантический поиск soft-мастера (intro/final) в template_set (РЭ.22.8.2).
 *
 * Алгоритм:
 *  1. Фильтр applies_to_configs (как везде).
 *  2. Фильтр page_role — строгий ('intro' или 'final').
 *  3. Опциональный точный фильтр photos_full.
 *  4. Возвращаем первого подходящего по итерации Map'а.
 *     Множественные кандидаты возможны если у партнёра в template_set
 *     несколько мастеров одной роли — в этом случае выбор «первого»
 *     детерминирован порядком записей в БД (см. spec D.1).
 */
export function findSoftSectionMaster(
  mastersByName: ReadonlyMap<string, SpreadTemplate>,
  request: SoftSectionRequest,
): FindSoftSectionMasterResult | null {
  let result: SpreadTemplate | null = null;

  mastersByName.forEach((master) => {
    if (result) return; // first-match выход

    // Фильтр applies_to_configs.
    const configs = master.applies_to_configs;
    if (configs && configs.length > 0) {
      const presetAsConfig = request.presetId as unknown as (typeof configs)[number];
      if (configs.indexOf(presetAsConfig) < 0) return;
    }

    // Фильтр page_role.
    if (master.page_role !== request.pageRole) return;

    // Опциональный фильтр photos_full.
    if (request.photosFull !== undefined) {
      const cap = getCapacityNumber(master.slot_capacity, 'photos_full');
      if (cap !== request.photosFull) return;
    }

    result = master;
  });

  return result ? { master: result } : null;
}
