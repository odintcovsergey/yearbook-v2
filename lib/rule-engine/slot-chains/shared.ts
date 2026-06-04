/**
 * Rule Engine — slot-chains/shared.ts
 *
 * Общие типы и хелпер `tryStep` для всех цепочек слотов общего раздела
 * (H, Q, FULL, flex_A, flex_B, flex_C).
 *
 * Концепция «цепочки попыток» из docs/album-structure-inventory.md §5:
 * каждая цепочка — упорядоченный список шагов. Engine берёт первый шаг,
 * для которого хватает фото; остальные шаги не пробуются. Если ни один
 * шаг не сработал — цепочка возвращает null (вызывающая сторона
 * оставляет страницу пустой; партнёр заменит мастер в редакторе вручную).
 *
 * Эти функции — чистые: без побочных эффектов, без обращений к БД,
 * не мутируют входные аргументы. Используются в РЭ.21.8.3+ из
 * `buildFromSectionStructure`.
 */

import type { SlotType } from '../types';

/**
 * Доступное количество общих фото по категориям.
 *
 * Категории совпадают с полями `RulesCommonPhotosInput` из `types.ts`,
 * но цепочки оперируют только этими четырьмя. Категория `spread` (для
 * J-Spread) используется в редких сценариях и не входит в семантику
 * слотов H/Q/FULL/flex_*.
 */
export interface CommonPhotoCounts {
  full_class: number;
  half_class: number;
  quarter: number;
  sixth: number;
  collage: number;
}

/**
 * Сторона страницы внутри разворота. Влияет на выбор `-Right` варианта
 * у мастеров, у которых он определён (например `J-ClassPhoto` → правая
 * `J-ClassPhoto-Right`). У большинства мастеров общего раздела
 * (`J-Half`, `J-Quarter`, `J-Collage`) зеркального варианта нет —
 * см. inventory §2.G.
 */
export type SlotPosition = 'left' | 'right';

/**
 * Сколько фото каждой категории потребит выбранный мастер.
 *
 * Поля присутствуют только для тех категорий, которые мастер реально
 * расходует. Вызывающая сторона вычитает эти значения из своего пула
 * оставшихся общих фото и переходит к следующему слоту.
 */
export interface SlotConsumes {
  full_class?: number;
  half_class?: number;
  quarter?: number;
  sixth?: number;
  collage?: number;
}

/**
 * Результат успешного срабатывания цепочки.
 *
 *  - `master_name` — имя мастера для подстановки в `PageInstance.master_id`
 *    после резолва через `RuleEngineBundle.mastersByName` (РЭ.21.8.3).
 *
 *  - `consumes` — сколько фото потребил мастер. Вычитается из остатка
 *    общих фото на следующей итерации.
 *
 *  - `trace` — короткое объяснение в стиле `'flex_A → J-Collage (6 sixth)'`.
 *    Попадёт в `AlbumLayout.decision_trace` для отладки в UI.
 */
export interface SlotFillResult {
  master_name: string;
  consumes: SlotConsumes;
  trace: string;
}

/**
 * Общий хелпер: попытаться использовать `masterName` если в `available`
 * достаточно фото категории `categoryKey`.
 *
 * @param available     — доступные категории фото
 * @param position      — текущая сторона страницы (для выбора -Right)
 * @param masterName    — основное имя мастера (`'J-Half'`, `'J-ClassPhoto'`, ...)
 * @param categoryKey   — какую категорию потребит мастер
 * @param count         — сколько фото потребит
 * @param rightVariant  — опц. имя зеркального мастера (`'J-ClassPhoto-Right'`).
 *                        Если задано и `position === 'right'`, используется
 *                        оно вместо `masterName`.
 *
 * Возвращает `SlotFillResult` без префикса цепочки в trace — префикс
 * добавляется в конкретной цепочке через `withChainPrefix`.
 */
export function tryStep(
  available: CommonPhotoCounts,
  position: SlotPosition,
  masterName: string,
  categoryKey: keyof CommonPhotoCounts,
  count: number,
  rightVariant?: string,
): SlotFillResult | null {
  if (available[categoryKey] < count) return null;
  const effectiveName =
    position === 'right' && rightVariant ? rightVariant : masterName;
  const consumes: SlotConsumes = {};
  consumes[categoryKey] = count;
  return {
    master_name: effectiveName,
    consumes,
    trace: `${effectiveName} (${count} ${categoryKey})`,
  };
}

/**
 * Завернуть результат шага в trace с префиксом цепочки.
 * Пример: `'J-Collage (6 sixth)'` → `'flex_A → J-Collage (6 sixth)'`.
 *
 * Принимает null и возвращает null без изменений — удобно использовать
 * в конце цепочки `withChainPrefix(stepA ?? stepB ?? stepC, 'flex_A')`.
 */
export function withChainPrefix(
  result: SlotFillResult | null,
  slotName: SlotType,
): SlotFillResult | null {
  if (!result) return null;
  return { ...result, trace: `${slotName} → ${result.trace}` };
}
