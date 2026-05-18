/**
 * Rule Engine — slot-chains/index.ts
 *
 * Точка входа: `tryFillSlot(slotType, available, position)` → либо
 * `SlotFillResult` (выбранный мастер + сколько фото потребит), либо null
 * если ни один шаг цепочки не сработал.
 *
 * Используется новым build engine'ом `buildFromSectionStructure` (РЭ.21.8.3+)
 * при проходе по `preset.section_structure`, конкретно — для секций
 * `type: 'common'` с массивом `slots: SlotType[]`.
 *
 * Каждая цепочка живёт в отдельном файле и описана через 1..4 шага
 * вызова `tryStep`. Семантика шагов задана в docs/album-structure-inventory.md
 * §5 и продублирована в JSDoc каждого файла.
 */

import type { SlotType } from '../types';
import { tryFillH } from './h';
import { tryFillQ } from './q';
import { tryFillFull } from './full';
import { tryFillFlexA } from './flex-a';
import { tryFillFlexB } from './flex-b';
import { tryFillFlexC } from './flex-c';
import type {
  CommonPhotoCounts,
  SlotFillResult,
  SlotPosition,
} from './shared';

export type {
  CommonPhotoCounts,
  SlotConsumes,
  SlotFillResult,
  SlotPosition,
} from './shared';

export {
  tryFillH,
  tryFillQ,
  tryFillFull,
  tryFillFlexA,
  tryFillFlexB,
  tryFillFlexC,
};

/**
 * Диспетчер цепочек слотов общего раздела.
 *
 * Семантика входа:
 *  - `slotType`  — какой слот заполняем; берётся из
 *    `preset.section_structure[i].slots[j]`.
 *  - `available` — текущий пул общих фото (после вычитания того, что
 *    потратили на предыдущих слотах).
 *  - `position`  — `'left'` или `'right'` страницы. Влияет на выбор
 *    `-Right` варианта у мастеров, у которых он есть.
 *
 * Семантика выхода:
 *  - `SlotFillResult` — нашёлся подходящий мастер. Вызывающая сторона
 *    вычитает `consumes` из своего пула и заполняет страницу мастером.
 *  - `null` — ни один шаг цепочки не подошёл. Вызывающая сторона
 *    оставляет страницу пустой и пишет warning; партнёр заменит мастер
 *    в редакторе.
 */
export function tryFillSlot(
  slotType: SlotType,
  available: CommonPhotoCounts,
  position: SlotPosition,
): SlotFillResult | null {
  switch (slotType) {
    case 'H':
      return tryFillH(available, position);
    case 'Q':
      return tryFillQ(available, position);
    case 'FULL':
      return tryFillFull(available, position);
    case 'flex_A':
      return tryFillFlexA(available, position);
    case 'flex_B':
      return tryFillFlexB(available, position);
    case 'flex_C':
      return tryFillFlexC(available, position);
  }
}
