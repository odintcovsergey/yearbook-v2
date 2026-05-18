/**
 * Заполнение секции type='common' для buildFromSectionStructure.
 *
 * Логика проста: обходим slots[] по очереди, для каждого слота —
 * tryFillSlot из slot-chains (РЭ.21.8.2). Слот = 1 страница.
 * Позиция (left/right) определяется чётностью текущего pageInstances.length.
 *
 * Если цепочка вернула null или мастер не найден в template_set —
 * страница пропускается с warning. Партнёр заменит мастер в редакторе
 * через TemplatePickerModal.
 *
 * Bindings пока пустые: реальный маппинг фото на labels мастера придёт
 * в РЭ.21.8.4 (вместе с подключением students/teachers). Сейчас цель —
 * убедиться что цепочка слотов выбирает правильные мастера.
 */

import type { SlotType } from '../types';
import type { SlotPosition } from '../slot-chains';
import { tryFillSlot } from '../slot-chains';
import type { SectionFillContext } from './shared';

export function fillCommonSection(
  ctx: SectionFillContext,
  slots: SlotType[],
): void {
  for (let slotIdx = 0; slotIdx < slots.length; slotIdx++) {
    const slotType = slots[slotIdx];
    const pageIndex = ctx.pageInstances.length;
    const position: SlotPosition = pageIndex % 2 === 0 ? 'left' : 'right';

    const fill = tryFillSlot(slotType, ctx.available, position);
    if (!fill) {
      ctx.warnings.push(
        `slot_skipped: section #${ctx.sectionIndex} slot #${slotIdx} (${slotType}) — недостаточно общих фото`,
      );
      continue;
    }

    const master = ctx.bundle.mastersByName.get(fill.master_name);
    if (!master) {
      ctx.warnings.push(
        `master_not_found: '${fill.master_name}' (slot ${slotType}) ` +
          `отсутствует в template_set дизайна`,
      );
      continue;
    }

    // Вычитаем потреблённые фото из пула.
    if (fill.consumes.full_class)
      ctx.available.full_class -= fill.consumes.full_class;
    if (fill.consumes.half_class)
      ctx.available.half_class -= fill.consumes.half_class;
    if (fill.consumes.quarter) ctx.available.quarter -= fill.consumes.quarter;
    if (fill.consumes.sixth) ctx.available.sixth -= fill.consumes.sixth;

    ctx.pageInstances.push({
      master_id: master.id,
      bindings: {},
    });

    ctx.decisionTrace.push({
      spread_index: Math.floor(pageIndex / 2),
      section_index: ctx.sectionIndex,
      family_id: 'common-section',
      rule_id: `slot:${slotType}`,
      inputs: {
        slot_type: slotType,
        position,
        chain_trace: fill.trace,
        consumes: fill.consumes,
      },
    });
  }
}
