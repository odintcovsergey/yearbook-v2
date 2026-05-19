/**
 * Цепочка слота `Q`: «страница с фото 1/4 класса».
 *
 * Один шаг: J-Quarter-Left на левой странице, J-Quarter-Right на правой.
 * В template_set okeybook-default это два разных мастера; механизм
 * чередования прикладывает rightVariant в `tryStep` (как для FULL до 21.8.6a).
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
    tryStep(
      available,
      position,
      'J-Quarter-Left',
      'quarter',
      2,
      'J-Quarter-Right',
    ),
    'Q',
  );
}
