/**
 * Цепочка слота `Q`: «страница с фото 1/4 класса».
 *
 * Один шаг: J-Quarter (2 фото quarter). У J-Quarter нет зеркального
 * `-Right` варианта (см. inventory §2.G).
 *
 * Возвращает null если `quarter < 2`.
 */

import { tryStep, withChainPrefix } from './shared';
import type { CommonPhotoCounts, SlotFillResult, SlotPosition } from './shared';

export function tryFillQ(
  available: CommonPhotoCounts,
  position: SlotPosition,
): SlotFillResult | null {
  return withChainPrefix(
    tryStep(available, position, 'J-Quarter', 'quarter', 2),
    'Q',
  );
}
