/**
 * Семантический резолвер мастера. Чистая функция, без побочных эффектов.
 *
 * Принимает плоский список мастеров `template_set.spreads` и фильтр из
 * сценария — возвращает либо первого подходящего кандидата (по `sort_order`),
 * либо `not_found`. Warning'и про fallback / name_mismatch возвращаются
 * в результате; решение о записи в BuildContext остаётся за вызывающей
 * стороной.
 *
 * Алгоритм фильтрации (5 шагов, последовательно):
 *   1. `page_role`           — точное совпадение
 *   2. `applies_to_config`   — конфигурация должна быть в массиве
 *   3. `is_spread`           — если задан в фильтре, должен совпадать
 *   4. `slot_capacity_min`   — для каждого ключа фильтра candidate-значение
 *                              должно быть >= требуемого. Если у кандидата
 *                              `slot_capacity === null` — отсеивается.
 *   5. `is_fallback`         — двухпроходный: сначала только `false`,
 *                              затем (если `is_fallback_allowed`) — `true`.
 *
 * Из прошедших фильтр кандидатов берётся первый по `sort_order`
 * (стабильная сортировка сохраняет порядок при равенстве).
 */

import type { SpreadTemplate, BuildWarning, SlotCapacity, MasterFilter } from './types';

/**
 * Результат `findMaster`.
 *
 * - `ok: true`  — мастер найден; `warning` отличен от `null`, если применили
 *   fallback или имя не совпало с `expected_name_hint`.
 * - `ok: false` — кандидатов нет ни на основном проходе, ни на fallback.
 */
export type FindMasterResult =
  | { ok: true; master: SpreadTemplate; warning: BuildWarning | null }
  | { ok: false; reason: 'not_found' };

function matchesBaseFilters(
  candidate: SpreadTemplate,
  filter: MasterFilter,
): boolean {
  if (candidate.page_role !== filter.page_role) return false;
  if (candidate.default_for_configs.indexOf(filter.applies_to_config) < 0) {
    return false;
  }
  if (filter.is_spread !== undefined && candidate.is_spread !== filter.is_spread) {
    return false;
  }
  if (filter.slot_capacity_min) {
    if (candidate.slot_capacity === null) return false;
    const cap = candidate.slot_capacity;
    const need = filter.slot_capacity_min;
    const keys = Object.keys(need) as (keyof SlotCapacity)[];
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const required = need[k];
      const actual = cap[k];
      if (typeof required === 'number') {
        if (typeof actual !== 'number' || actual < required) return false;
      }
    }
  }
  return true;
}

function pickFirstBySortOrder(candidates: SpreadTemplate[]): SpreadTemplate {
  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    if (candidates[i].sort_order < best.sort_order) best = candidates[i];
  }
  return best;
}

/**
 * Приоритет точного совпадения с `expected_name_hint` — добавлено в 0.11.3
 * для разрешения ambiguous match'ей (например E-Ind-Right-3 vs E-Max-Right
 * когда оба удовлетворяют photos_friend≥3, но первый имеет больший sort_order).
 *
 * Если hint задан и среди кандидатов есть мастер с таким именем — берём его;
 * иначе — обычный pickFirstBySortOrder. Семантика name_mismatch warning при
 * этом сохраняется: если hint задан, но точного совпадения нет, после
 * pickFirstBySortOrder вызывающая сторона запишет name_mismatch.
 */
function pickPreferringHint(
  candidates: SpreadTemplate[],
  hint: string | undefined,
): SpreadTemplate {
  if (hint) {
    for (let i = 0; i < candidates.length; i++) {
      if (candidates[i].name === hint) return candidates[i];
    }
  }
  return pickFirstBySortOrder(candidates);
}

export function findMaster(
  spreads: SpreadTemplate[],
  filter: MasterFilter,
): FindMasterResult {
  const primary: SpreadTemplate[] = [];
  const fallbacks: SpreadTemplate[] = [];
  for (let i = 0; i < spreads.length; i++) {
    const c = spreads[i];
    if (!matchesBaseFilters(c, filter)) continue;
    if (c.is_fallback) fallbacks.push(c);
    else primary.push(c);
  }

  let master: SpreadTemplate;
  let usedFallback = false;
  if (primary.length > 0) {
    master = pickPreferringHint(primary, filter.expected_name_hint);
  } else if (filter.is_fallback_allowed && fallbacks.length > 0) {
    master = pickPreferringHint(fallbacks, filter.expected_name_hint);
    usedFallback = true;
  } else {
    return { ok: false, reason: 'not_found' };
  }

  let warning: BuildWarning | null = null;
  if (usedFallback) {
    warning = {
      code: 'fallback_used',
      detail: `no specialized master for page_role=${filter.page_role} applies_to=${filter.applies_to_config}, falling back to ${master.name}`,
    };
  } else if (
    filter.expected_name_hint &&
    filter.expected_name_hint !== master.name
  ) {
    warning = {
      code: 'name_mismatch',
      detail: `expected ${filter.expected_name_hint}, got ${master.name}`,
    };
  }

  return { ok: true, master, warning };
}
