/**
 * Цепочка слота `flex_A` — «крупный приоритет».
 *
 * Шаги в порядке попыток (см. inventory §5):
 *   1. J-Sixth-6 (6 sixth)               — максимальное использование 1/6 фото
 *   2. J-Half (2 half_class)             — фолбэк на полкласса
 *   3. J-Full (1 full_class)             — мастер симметричный, без -Right
 *
 * Возвращает null если ни один шаг не сработал. Партнёр заменит мастер
 * в редакторе вручную (TemplatePickerModal уже работает в Л.M).
 */

import { tryStep, withChainPrefix } from './shared';
import type { CommonPhotoCounts, SlotFillResult, SlotPosition } from './shared';

export function tryFillFlexA(
  available: CommonPhotoCounts,
  position: SlotPosition,
): SlotFillResult | null {
  const result =
    tryStep(available, position, 'J-Sixth-6', 'sixth', 6) ??
    tryStep(available, position, 'J-Half', 'half_class', 2) ??
    tryStep(available, position, 'J-Full', 'full_class', 1);
  return withChainPrefix(result, 'flex_A');
}
