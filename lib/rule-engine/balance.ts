/**
 * Rule Engine — балансировка ProducedPage.
 *
 * Спецификация: docs/rule-engine-spec.md v1.3 §10.1 (Phase 1 — локальная MVP).
 *
 * Цель: после применения правила, если мастер имеет N placeholder'ов
 * (например сетка 3×3 = 9 учительских слотов), а данных меньше M < N —
 * нужно «скрыть» пустые слоты и при необходимости центрировать оставшиеся.
 *
 * Стратегия:
 *   - `hide_unfilled` — placeholder'ы с null значением помечаются hidden.
 *   - `placeholder_centering` — пытаемся применить существующий
 *     `balanceRegularGrid` из lib/album-builder/balance.ts для известных
 *     групп (studentportrait, teacherphoto, collagephoto и т.п.).
 *
 * Результат балансировки прикладывается к ProducedPage.bindings как два
 * специальных служебных ключа:
 *   - `__hidden__<label>: '1'` для скрытых placeholder'ов
 *   - `__pos__<label>: 'x_mm,y_mm'` для переразмещённых
 *
 * Рендерер фазы Л/М знает эти конвенции и применяет overrides при отрисовке.
 * Это chosen-by-design (не отдельная структура): сохраняет
 * `PageInstance.bindings: Record<string, unknown>` тип из РЭ.2 без миграции.
 */

import type { BalanceClause } from './types';
import type { ProducedPage } from './apply';
import type { Placeholder, SpreadTemplate } from '@/lib/album-builder/types';
import {
  balanceRegularGrid,
  type PlaceholderOverride,
} from '@/lib/album-builder/balance';

/** Известные «семейные» группы placeholder'ов, для которых имеет смысл центрирование. */
const KNOWN_GROUPS = [
  'studentportrait',
  'teacherphoto',
  'collagephoto',
  'halfphoto',
  'quarterphoto',
] as const;

export interface BalanceApplyResult {
  /** true если что-то было изменено в bindings (hidden или pos). */
  applied: boolean;
  /** Подробности для decision_trace (какие группы балансированы, сколько слотов скрыто). */
  detail: string;
}

/**
 * Применяет balance-clause к ProducedPage. Мутирует page.bindings,
 * добавляя служебные ключи __hidden__<label> и __pos__<label>.
 *
 * @param page — страница, к bindings которой применяется балансировка
 * @param master — соответствующий мастер из template_set (для доступа к placeholders)
 * @param clause — `balance` из правила (placeholder_centering, hide_unfilled)
 */
export function applyBalance(
  page: ProducedPage,
  master: SpreadTemplate | undefined,
  clause: BalanceClause | undefined,
): BalanceApplyResult {
  if (!clause) return { applied: false, detail: 'no balance clause' };
  if (!master) return { applied: false, detail: 'no master found' };

  const placeholders = master.placeholders;
  if (placeholders.length === 0) return { applied: false, detail: 'no placeholders' };

  const notes: string[] = [];
  let touched = false;

  // 1) placeholder_centering — применяем balanceRegularGrid для известных групп.
  if (clause.placeholder_centering) {
    for (const group of KNOWN_GROUPS) {
      const used = countFilledInGroup(page.bindings, group, placeholders);
      if (used.total === 0) continue; // в мастере нет этой группы
      if (used.filled === used.total) continue; // всё заполнено — балансировать нечего
      if (used.filled === 0) continue; // пусто всё — централизация бессмысленна, отдадим в hide_unfilled

      const result = balanceRegularGrid(placeholders, group, used.filled);
      if (result.detectedGrid !== null) {
        applyOverridesToBindings(page.bindings, result.overrides);
        touched = true;
        notes.push(
          `centered group '${group}' used=${used.filled}/${used.total} (${result.strategy})`,
        );
      }
    }
  }

  // 2) hide_unfilled — скрыть placeholder'ы с null значением.
  // (применяется ПОСЛЕ centering, чтобы не скрывать те которые centering уже перерасположил —
  // он сам решит что скрыть через result.overrides.hidden=true).
  if (clause.hide_unfilled) {
    let hiddenCount = 0;
    for (const ph of placeholders) {
      const label = ph.label;
      const v = page.bindings[label];
      const alreadyHidden = page.bindings[`__hidden__${label}`] === '1';
      if (alreadyHidden) continue;
      if (v === null || v === undefined) {
        page.bindings[`__hidden__${label}`] = '1';
        hiddenCount++;
        touched = true;
      }
    }
    if (hiddenCount > 0) notes.push(`hidden ${hiddenCount} unfilled`);
  }

  return {
    applied: touched,
    detail: notes.length > 0 ? notes.join('; ') : 'no changes',
  };
}

/**
 * Считает сколько слотов группы заполнено в bindings.
 * Группа `studentportrait` → label'ы `studentportrait_1`, `studentportrait_2`, ...
 * Считаем уникальные индексы у placeholder'ов c photo-якорем (по аналогии с balanceRegularGrid).
 */
function countFilledInGroup(
  bindings: Record<string, string | null>,
  group: string,
  placeholders: Placeholder[],
): { filled: number; total: number } {
  const prefix = `${group}_`;
  const photoIndices: number[] = [];
  for (const ph of placeholders) {
    if (ph.type !== 'photo') continue;
    if (!ph.label.startsWith(prefix)) continue;
    const suffix = ph.label.slice(prefix.length);
    const idx = parseInt(suffix, 10);
    if (Number.isNaN(idx) || String(idx) !== suffix) continue;
    photoIndices.push(idx);
  }
  if (photoIndices.length === 0) return { filled: 0, total: 0 };

  let filled = 0;
  for (const idx of photoIndices) {
    const v = bindings[`${prefix}${idx}`];
    if (v !== null && v !== undefined && v !== '') filled++;
  }
  return { filled, total: photoIndices.length };
}

/**
 * Применяет overrides из balanceRegularGrid к bindings.
 * `hidden: true` → __hidden__<label> = '1'
 * `x_mm/y_mm` → __pos__<label> = 'X,Y'
 */
function applyOverridesToBindings(
  bindings: Record<string, string | null>,
  overrides: Record<string, PlaceholderOverride>,
): void {
  for (const label of Object.keys(overrides)) {
    const ov = overrides[label];
    if (ov.hidden) {
      bindings[`__hidden__${label}`] = '1';
    }
    if (ov.x_mm !== undefined && ov.y_mm !== undefined) {
      bindings[`__pos__${label}`] = `${ov.x_mm},${ov.y_mm}`;
    }
  }
}
