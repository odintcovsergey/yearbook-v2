/**
 * Цепочка слота `flex_B` — «всё попробовать».
 *
 * Шаги в порядке попыток (см. inventory §5):
 *   1. J-Quarter (2 quarter)             — приоритет четвертям
 *   2. J-Collage (6 sixth)
 *   3. J-Half (2 half_class)
 *   4. J-ClassPhoto (1 full_class)       — на правой стороне → J-ClassPhoto-Right
 *
 * Отличается от flex_A добавлением J-Quarter в начало — для случаев
 * когда у партнёра есть фото 1/4 класса (редко, но бывает).
 */

import { tryStep, withChainPrefix } from './shared';
import type { CommonPhotoCounts, SlotFillResult, SlotPosition } from './shared';

export function tryFillFlexB(
  available: CommonPhotoCounts,
  position: SlotPosition,
): SlotFillResult | null {
  const result =
    tryStep(available, position, 'J-Quarter', 'quarter', 2) ??
    tryStep(available, position, 'J-Collage', 'sixth', 6) ??
    tryStep(available, position, 'J-Half', 'half_class', 2) ??
    tryStep(
      available,
      position,
      'J-ClassPhoto',
      'full_class',
      1,
      'J-ClassPhoto-Right',
    );
  return withChainPrefix(result, 'flex_B');
}
