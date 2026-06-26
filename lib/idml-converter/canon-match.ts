/**
 * Сверка мастера с каноном master_page_types (Фаза 2, инициатива «Разделение
 * структуры и дизайна»). ЧИСТАЯ логика (без БД) — для тестов и переиспользования.
 *
 * Режим МЯГКИЙ: функция только КЛАССИФИЦИРУЕТ (matched/unmapped/no-canon-type),
 * НЕ блокирует загрузку. Вызывается в lib/idml-converter/upload.ts между сборкой
 * spreadRows и INSERT — проставить master_page_type_id и собрать отчёт.
 *
 * КРИТИЧНО: логика ТОЧНО повторяет backfill-скрипт Фазы 1
 * (scripts/gen-master-page-types-seed.mjs), чтобы результат совпал с тем, что уже
 * лежит в spread_templates.master_page_type_id (59/61 у akvarel+belly). Совпадение
 * проверено на живых данных (см. отчёт Фазы 2). Бэкилл Фазы 1 был разовым; для
 * новых загрузок единственный источник логики — ЭТА функция.
 *
 * Правило матча (= SQL Фазы 1):
 *   page_role равен И slot_capacity deep-equal (jsonb) И разводка неоднозначности
 *   common photos_full:1: page_type='spread' → common-spread, иначе → common-full-page.
 */

/** Тип канона (строка master_page_types). */
export interface CanonType {
  id: string;
  code: string;
  page_role: string;
  /** jsonb-ёмкость; ключи как в slot_capacity мастера. */
  slot_capacity: Record<string, unknown>;
  page_type: string | null;
}

/** Теги загружаемого мастера (из family-mapping; могут быть null если не размечен). */
export interface MasterTags {
  page_role: string | null;
  slot_capacity: Record<string, unknown> | null;
  /** 'spread' | 'page-any' | 'page-left' | 'page-right' | null. */
  page_type: string | null;
}

export type CanonMatchReason = 'matched' | 'unmapped' | 'no-canon-type';

export interface CanonMatchResult {
  master_page_type_id: string | null;
  reason: CanonMatchReason;
}

/** Коды канона с неоднозначной парой (одинаковые role+capacity, разводятся по page_type). */
const SPREAD_CODE = 'common-spread';
const PAGE_CODE = 'common-full-page';

/**
 * Стабильное (порядок ключей не важен) глубокое сравнение jsonb-значений.
 * Достаточно для slot_capacity (плоские объекты с числами/булями), но рекурсивно.
 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }
  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr !== bArr) return false;
  if (aArr && bArr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!jsonEqual(a[i], (b as unknown[])[i])) return false;
    }
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(bo, k)) return false;
    if (!jsonEqual(ao[k], bo[k])) return false;
  }
  return true;
}

/**
 * Сверяет мастер с каноном. Возвращает id типа + причину.
 *  - 'unmapped'      — нет page_role или slot_capacity (мастер не размечен family-mapping);
 *  - 'no-canon-type' — теги есть, но в каноне нет типа с таким role+capacity;
 *  - 'matched'       — совпал, master_page_type_id проставлен.
 */
export function matchCanonType(
  master: MasterTags,
  canon: readonly CanonType[],
): CanonMatchResult {
  if (master.page_role == null || master.slot_capacity == null) {
    return { master_page_type_id: null, reason: 'unmapped' };
  }

  const isSpread = master.page_type === 'spread';

  const matches = canon.filter(
    (c) =>
      c.page_role === master.page_role &&
      jsonEqual(c.slot_capacity, master.slot_capacity) &&
      // Разводка неоднозначной пары common photos_full:1 по page_type
      // (= SQL Фазы 1: code not in (pair) OR (spread↔spread) OR (page↔не-spread)).
      (
        (c.code !== SPREAD_CODE && c.code !== PAGE_CODE) ||
        (c.code === SPREAD_CODE && isSpread) ||
        (c.code === PAGE_CODE && !isSpread)
      ),
  );

  if (matches.length === 0) {
    return { master_page_type_id: null, reason: 'no-canon-type' };
  }
  return { master_page_type_id: matches[0].id, reason: 'matched' };
}
