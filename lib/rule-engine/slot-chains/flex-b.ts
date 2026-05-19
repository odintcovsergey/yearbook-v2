/**
 * Цепочка слота `flex_B` — «всё попробовать».
 *
 * Шаги в порядке попыток (см. inventory §5):
 *   1. J-Quarter-Left/-Right (2 quarter) — приоритет четвертям; чередование
 *      L/R по position
 *   2. J-Collage-6 (6 sixth)
 *   3. J-Half (2 half_class)
 *   4. J-Full (1 full_class)             — мастер симметричный, без -Right
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
    tryStep(
      available,
      position,
      'J-Quarter-Left',
      'quarter',
      2,
      'J-Quarter-Right',
    ) ??
    tryStep(available, position, 'J-Collage-6', 'sixth', 6) ??
    tryStep(available, position, 'J-Half', 'half_class', 2) ??
    tryStep(available, position, 'J-Full', 'full_class', 1);
  return withChainPrefix(result, 'flex_B');
}
