/**
 * Цепочка слота `FULL`: «1 общее фото класса».
 *
 * Один шаг: J-Full (1 фото full_class). Мастер симметричный в template_set
 * okeybook-default — отдельного `-Right` варианта нет.
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
    tryStep(available, position, 'J-Full', 'full_class', 1),
    'FULL',
  );
}
