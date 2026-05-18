/**
 * Цепочка слота `FULL`: «1 общее фото класса».
 *
 * Один шаг: J-ClassPhoto (1 фото full_class). На правой стороне
 * используется зеркальный J-ClassPhoto-Right.
 *
 * Возвращает null если `full_class < 1`.
 */

import { tryStep, withChainPrefix } from './shared';
import type { CommonPhotoCounts, SlotFillResult, SlotPosition } from './shared';

export function tryFillFull(
  available: CommonPhotoCounts,
  position: SlotPosition,
): SlotFillResult | null {
  return withChainPrefix(
    tryStep(
      available,
      position,
      'J-ClassPhoto',
      'full_class',
      1,
      'J-ClassPhoto-Right',
    ),
    'FULL',
  );
}
