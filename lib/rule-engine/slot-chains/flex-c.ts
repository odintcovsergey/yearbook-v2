/**
 * Цепочка слота `flex_C` — «правая нечётная страница»: мост от секции
 * портретов в общий раздел.
 *
 * По семантике (inventory §5): слот всегда стоит на правой стороне
 * разворота (левая занята последним учеником). Функция параметризована
 * `position` для симметрии API, но вызывающая сторона должна передавать
 * `'right'`.
 *
 * Шаги в порядке попыток:
 *   1. J-Half (2 half_class)             — приоритет половинам класса
 *   2. J-Sixth-6 (6 sixth)
 *   3. J-Full (1 full_class)             — мастер симметричный; раньше
 *      здесь форсился `-Right`, теперь не нужно (J-Full одинаково смотрится
 *      на любой стороне в template_set okeybook-default).
 *
 * Принципиальное отличие от flex_A: half перед collage (не наоборот).
 */

import { tryStep, withChainPrefix } from './shared';
import type { CommonPhotoCounts, SlotFillResult, SlotPosition } from './shared';

export function tryFillFlexC(
  available: CommonPhotoCounts,
  position: SlotPosition,
): SlotFillResult | null {
  const result =
    tryStep(available, position, 'J-Half', 'half_class', 2) ??
    tryStep(available, position, 'J-Sixth-6', 'sixth', 6) ??
    tryStep(available, position, 'J-Full', 'full_class', 1);
  return withChainPrefix(result, 'flex_C');
}
