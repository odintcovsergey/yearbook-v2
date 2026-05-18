/**
 * Цепочка слота `flex_C` — «правая нечётная страница»: мост от секции
 * портретов в общий раздел.
 *
 * По семантике (inventory §5): слот всегда стоит на правой стороне
 * разворота (левая занята последним учеником). Функция параметризована
 * `position` для симметрии API, но вызывающая сторона должна передавать
 * `'right'`. Если по ошибке пришёл `'left'` — финальный мастер всё равно
 * `J-ClassPhoto-Right` (см. шаг 3).
 *
 * Шаги в порядке попыток:
 *   1. J-Half (2 half_class)             — приоритет половинам класса
 *   2. J-Collage (6 sixth)
 *   3. J-ClassPhoto-Right (1 full_class) — финал ВСЕГДА `-Right`
 *      независимо от position; слот по семантике правый.
 *
 * Принципиальное отличие от flex_A: half перед collage (не наоборот),
 * и финальный FULL фиксирован как `-Right`.
 */

import { tryStep, withChainPrefix } from './shared';
import type { CommonPhotoCounts, SlotFillResult, SlotPosition } from './shared';

export function tryFillFlexC(
  available: CommonPhotoCounts,
  position: SlotPosition,
): SlotFillResult | null {
  const result =
    tryStep(available, position, 'J-Half', 'half_class', 2) ??
    tryStep(available, position, 'J-Collage', 'sixth', 6) ??
    // Третий шаг: FULL в flex_C всегда `-Right` — поэтому форсируем
    // position='right' независимо от входа. См. doc-комментарий выше.
    tryStep(
      available,
      'right',
      'J-ClassPhoto',
      'full_class',
      1,
      'J-ClassPhoto-Right',
    );
  return withChainPrefix(result, 'flex_C');
}
