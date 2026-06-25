/**
 * Смена дизайна в редакторе — проверка совместимости (Этап 1, вариант B).
 *
 * ЧИСТАЯ логика (без БД), чтобы юнит-тестировать без сети. Загрузчик —
 * `cover-check.ts`.
 *
 * Подход (вариант B, утверждён): проверяем по ТЕКУЩИМ разворотам альбома, а не
 * пере-прогоном движка. Для каждого сохранённого разворота берём его мастер из
 * ТЕКУЩЕГО дизайна (по template_id) → его «тип» (page_role + slot_capacity) и
 * ищем в НОВОМ дизайне мастер, способный вместить то же (`findReplacementMaster`).
 * Если для какого-то типа замены нет — дизайн несовместим, показываем человеку
 * понятный отказ.
 *
 * `findReplacementMaster` — ОБЩАЯ функция: на Этапе 2 ровно она подбирает мастер
 * нового дизайна для переноса контента (remap). Пишем один раз.
 *
 * V1-упрощения (осознанно, см. комментарии у кода):
 *  - «потребность» = НОМИНАЛЬНАЯ slot_capacity текущего мастера (а не число
 *    реально заполненных слотов). Совпадает с замыслом владельца «разворот на 6
 *    человек» = мастер с ёмкостью 6, и сохраняет возможность показать всех.
 *  - photos_friend — МЯГКАЯ ёмкость (не блокирует): движок и так теряет лишние
 *    фото с другом без ошибки (Сергей 19.05.2026). Остальные ёмкости — жёсткие.
 *  - applies_to_configs НЕ фильтруем (дизайн меняем, пресет тот же; большинство
 *    мастеров универсальны). Проверка — про ТИП страницы, не про конфиг.
 *  - роли матчим строго в рамках семейства (student_left ≠ student); генерик
 *    student_grid принимается заменой для student_grid_left/right (как в движке).
 */

import type { SlotCapacity, SpreadTemplate, PageRole } from '@/lib/album-builder/types';

/** Числовые ёмкости, по которым НОВЫЙ мастер должен быть НЕ меньше текущего. */
const HARD_NUMERIC_KEYS: Array<keyof SlotCapacity> = [
  'students',
  'teachers',
  'head_teacher',
  'photos_full',
  'photos_half',
  'photos_quarter',
  'photos_sixth',
  'photos_collage',
];
// photos_friend — мягкая (теряемая), в HARD_* НЕ входит.

/** Булевы слоты-содержимое: если текущий их использует, новый обязан иметь. */
const HARD_BOOL_KEYS: Array<keyof SlotCapacity> = ['has_portrait', 'has_name', 'has_quote'];

function num(cap: SlotCapacity | null | undefined, k: keyof SlotCapacity): number {
  const v = cap?.[k];
  return typeof v === 'number' ? v : 0;
}
function bool(cap: SlotCapacity | null | undefined, k: keyof SlotCapacity): boolean {
  return cap?.[k] === true;
}

/** Совпадает ли роль страницы (с генерик-grid фолбэком, как в movie-finder). */
function roleMatches(needRole: PageRole | null, candRole: PageRole | null): boolean {
  if (needRole === candRole) return true;
  // Генерик student_grid принимается заменой для конкретной left/right сетки
  // (так же findStudentGridMaster трактует student_grid как fallback).
  if (
    (needRole === 'student_grid_left' || needRole === 'student_grid_right') &&
    candRole === 'student_grid'
  ) {
    return true;
  }
  return false;
}

/** Вмещает ли кандидат то, что заявляет текущий мастер (по ёмкостям). */
function capacityFits(need: SlotCapacity | null, cand: SlotCapacity | null): boolean {
  for (const k of HARD_NUMERIC_KEYS) {
    if (num(cand, k) < num(need, k)) return false;
  }
  for (const k of HARD_BOOL_KEYS) {
    if (bool(need, k) && !bool(cand, k)) return false;
  }
  return true;
}

/** Суммарная числовая ёмкость — для выбора «минимально достаточного» кандидата. */
function totalCapacity(cap: SlotCapacity | null): number {
  return HARD_NUMERIC_KEYS.reduce((s, k) => s + num(cap, k), 0);
}

/**
 * Подобрать в НОВОМ дизайне мастер-замену для текущего мастера: та же роль
 * страницы + ёмкость не меньше. Из подходящих — минимально достаточный (меньше
 * пустых слотов). Возвращает мастер или null (замены нет → несовместимо).
 *
 * Используется И проверкой совместимости (Этап 1), И remap (Этап 2).
 */
export function findReplacementMaster(
  currentMaster: SpreadTemplate,
  targetMasters: readonly SpreadTemplate[],
): SpreadTemplate | null {
  let best: SpreadTemplate | null = null;
  let bestTotal = Infinity;
  for (let i = 0; i < targetMasters.length; i++) {
    const cand = targetMasters[i];
    if (!roleMatches(currentMaster.page_role, cand.page_role)) continue;
    if (!capacityFits(currentMaster.slot_capacity, cand.slot_capacity)) continue;
    const t = totalCapacity(cand.slot_capacity);
    if (t < bestTotal) {
      bestTotal = t;
      best = cand;
    }
  }
  return best;
}

// ─── Человеческие описания типов разворотов (без «мастер/слот/capacity») ──────

/** Русское склонение слова после числа: 1 ученик / 2 ученика / 5 учеников. */
function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

const STUDENT_SINGLE_ROLES: Array<PageRole | null> = [
  'student',
  'student_left',
  'student_right',
  'student_last',
  'student_overflow',
  'student_overflow_right',
];

/** Грубое «семейство» роли — для поиска самого вместительного варианта типа. */
function roleFamily(role: PageRole | null): string {
  if (role === 'student_grid' || role === 'student_grid_left' || role === 'student_grid_right') {
    return 'student_grid';
  }
  if (STUDENT_SINGLE_ROLES.includes(role)) return 'student_single';
  if (role === 'teacher_left' || role === 'teacher_right') return 'teacher';
  if (role === 'common') return 'common';
  if (role === 'intro') return 'intro';
  if (role === 'final') return 'final';
  return 'other';
}

/**
 * Человеческое описание потребности разворота для текста отказа.
 *  - `phrase` — как назвать тип («разворот на 6 учеников», «страница-коллаж из
 *    5 фото»), без терминов «мастер/слот/capacity»;
 *  - `primaryDim` — числовая ёмкость, по которой имеет смысл сказать «максимум
 *    N» (если у нового дизайна есть тот же тип, но меньше). null = не считаем
 *    «максимум», говорим «таких страниц нет»;
 *  - `maxUnit` — единица для фразы «максимум N <maxUnit>»;
 *  - `count` — нужное число по primaryDim.
 */
interface NeedDesc {
  phrase: string;
  primaryDim: keyof SlotCapacity | null;
  /** Построить хвост «максимум N …» с правильным склонением под число mx. */
  maxTail: ((mx: number) => string) | null;
  count: number;
}

/** Склонение «фотография» в позиции подлежащего: 1 фотография / 2 фотографии / 5 фотографий. */
function photosWord(n: number): string {
  return plural(n, 'фотография', 'фотографии', 'фотографий');
}
/** Склонение «фотография» после «из N»: из 1 фотографии / из 5 фотографий. */
function photosGen(n: number): string {
  return plural(n, 'фотографии', 'фотографий', 'фотографий');
}

function describeNeed(m: SpreadTemplate): NeedDesc {
  const role = m.page_role;
  const c = m.slot_capacity;
  const students = num(c, 'students');
  const teachers = num(c, 'teachers');
  const collage = num(c, 'photos_collage');

  if (roleFamily(role) === 'student_grid') {
    return {
      phrase: `разворот на ${students} ${plural(students, 'ученика', 'ученика', 'учеников')}`,
      primaryDim: 'students',
      maxTail: (mx) => `максимум ${mx} на разворот`,
      count: students,
    };
  }
  if (roleFamily(role) === 'student_single') {
    return { phrase: 'личная страница ученика', primaryDim: null, maxTail: null, count: 1 };
  }
  if (roleFamily(role) === 'teacher') {
    if (num(c, 'photos_full') > 0 && teachers === 0) {
      return { phrase: 'страница с общим фото класса', primaryDim: null, maxTail: null, count: 0 };
    }
    return {
      phrase: 'страница с учителями',
      primaryDim: teachers > 0 ? 'teachers' : null,
      maxTail: (mx) => `максимум ${mx} ${plural(mx, 'учитель', 'учителя', 'учителей')} на странице`,
      count: teachers,
    };
  }
  if (role === 'common') {
    if (collage > 0) {
      return {
        phrase: `страница-коллаж из ${collage} ${photosGen(collage)}`,
        primaryDim: 'photos_collage',
        maxTail: (mx) => `максимум ${mx} ${photosWord(mx)} в коллаже`,
        count: collage,
      };
    }
    if (num(c, 'photos_full') > 0) return { phrase: 'страница с общим фото класса', primaryDim: null, maxTail: null, count: 0 };
    if (num(c, 'photos_half') > 0) return { phrase: 'страница с фото половины класса', primaryDim: null, maxTail: null, count: 0 };
    if (num(c, 'photos_quarter') > 0) return { phrase: 'страница с фотографиями (по четверти класса)', primaryDim: null, maxTail: null, count: 0 };
    if (num(c, 'photos_sixth') > 0) return { phrase: 'страница с маленькими фотографиями', primaryDim: null, maxTail: null, count: 0 };
    return { phrase: 'общая страница', primaryDim: null, maxTail: null, count: 0 };
  }
  if (role === 'intro') return { phrase: 'вступительная страница', primaryDim: null, maxTail: null, count: 0 };
  if (role === 'final') return { phrase: 'финальная страница', primaryDim: null, maxTail: null, count: 0 };
  return { phrase: 'страница такого типа', primaryDim: null, maxTail: null, count: 0 };
}

/**
 * Человеческое название типа разворота (без числа-«максимум»). Используется в
 * диагностике/демо; в тексте отказа — describeNeed + расчёт «максимум N».
 */
export function describeSpreadType(m: SpreadTemplate): string {
  return describeNeed(m).phrase;
}

/** Самая большая ёмкость по `dim` среди мастеров того же семейства в дизайне. */
function maxCapacityOfFamily(
  family: string,
  dim: keyof SlotCapacity,
  masters: readonly SpreadTemplate[],
): number {
  let mx = 0;
  for (let i = 0; i < masters.length; i++) {
    if (roleFamily(masters[i].page_role) === family) {
      mx = Math.max(mx, num(masters[i].slot_capacity, dim));
    }
  }
  return mx;
}

// ─── Проверка покрытия ────────────────────────────────────────────────────────

/** Ссылка на сохранённый разворот (минимум, нужный для проверки). */
export interface LayoutSpreadRef {
  spread_index: number;
  template_id: string;
  section_type?: string | null;
}

/** Один недостающий в новом дизайне тип разворота. */
export interface MissingSpreadType {
  /** Человеческое описание («разворот на 6 учеников»). */
  label: string;
  /** Хвост фразы: «максимум 4 на разворот» либо «таких страниц нет». */
  tail: string;
  pageRole: PageRole | null;
  slotCapacity: SlotCapacity | null;
  /** Индексы текущих разворотов этого типа (для UI-подсветки). */
  spreadIndexes: number[];
}

export interface CoverageResult {
  ok: boolean;
  /** Типы разворотов, для которых в новом дизайне нет подходящей страницы. */
  missing: MissingSpreadType[];
  /** Готовый человеческий текст отказа (null если ok). */
  message: string | null;
  /**
   * Текущие развороты, чей мастер не найден в текущем дизайне (битые данные) —
   * проверить их тип нельзя. Не блокирует, но сообщаем для диагностики.
   */
  unverifiedSpreadIndexes: number[];
}

/**
 * Проверяет, покрывает ли НОВЫЙ дизайн все типы разворотов ТЕКУЩЕГО альбома.
 *
 * @param currentSpreads    сохранённые развороты (album_layouts.spreads)
 * @param currentMastersById мастера ТЕКУЩЕГО дизайна по id (для разбора типа)
 * @param targetMasters     мастера НОВОГО дизайна
 * @param targetDesignName  человеческое имя нового дизайна (для текста)
 */
export function checkCoverage(
  currentSpreads: LayoutSpreadRef[],
  currentMastersById: ReadonlyMap<string, SpreadTemplate>,
  targetMasters: readonly SpreadTemplate[],
  targetDesignName: string,
): CoverageResult {
  const missingByLabel = new Map<string, MissingSpreadType>();
  const unverified: number[] = [];

  for (const spread of currentSpreads) {
    const currentMaster = currentMastersById.get(spread.template_id);
    if (!currentMaster) {
      // Мастер текущего разворота не нашёлся в текущем дизайне (битые данные/
      // удалённый мастер). Тип определить нельзя — отмечаем, но не блокируем.
      unverified.push(spread.spread_index);
      continue;
    }
    if (findReplacementMaster(currentMaster, targetMasters)) continue; // тип покрыт

    const nd = describeNeed(currentMaster);
    const existing = missingByLabel.get(nd.phrase);
    if (existing) {
      existing.spreadIndexes.push(spread.spread_index);
      continue;
    }
    // «Максимум N» — если в новом дизайне есть тот же тип, но меньшей ёмкости.
    let tail = 'таких страниц нет';
    if (nd.primaryDim && nd.maxTail) {
      const mx = maxCapacityOfFamily(roleFamily(currentMaster.page_role), nd.primaryDim, targetMasters);
      if (mx > 0 && mx < nd.count) tail = nd.maxTail(mx);
    }
    missingByLabel.set(nd.phrase, {
      label: nd.phrase,
      tail,
      pageRole: currentMaster.page_role,
      slotCapacity: currentMaster.slot_capacity,
      spreadIndexes: [spread.spread_index],
    });
  }

  const missing = Array.from(missingByLabel.values());
  if (missing.length === 0) {
    return { ok: true, missing: [], message: null, unverifiedSpreadIndexes: unverified };
  }

  let message: string;
  if (missing.length === 1) {
    const m = missing[0];
    message =
      `Не получится перейти на дизайн «${targetDesignName}»: в вашем альбоме есть ` +
      `${m.label}, а в этом дизайне ${m.tail}. ` +
      `Выберите другой дизайн или измените комплектацию альбома.`;
  } else {
    const lines = missing
      .map((m) => `— ${m.label} (${m.spreadIndexes.length} шт.): ${m.tail}`)
      .join('\n');
    message =
      `Не получится перейти на дизайн «${targetDesignName}». В вашем альбоме есть ` +
      `страницы, которых здесь не хватает:\n${lines}\n` +
      `Выберите другой дизайн или измените комплектацию альбома.`;
  }

  return { ok: false, missing, message, unverifiedSpreadIndexes: unverified };
}
