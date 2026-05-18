/**
 * Цепочка слота `H`: «страница с фото полкласса».
 *
 * Один шаг: J-Half (2 фото half_class). У J-Half нет зеркального
 * `-Right` варианта (см. inventory §2.G), позиция в выборе не участвует.
 *
 * Возвращает null если `half_class < 2`.
 */

import { tryStep, withChainPrefix } from './shared';
import type { CommonPhotoCounts, SlotFillResult, SlotPosition } from './shared';

export function tryFillH(
  available: CommonPhotoCounts,
  position: SlotPosition,
): SlotFillResult | null {
  return withChainPrefix(
    tryStep(available, position, 'J-Half', 'half_class', 2),
    'H',
  );
}
