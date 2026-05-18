/**
 * Заполнение секции type='soft_final' для buildFromSectionStructure.
 *
 * Семантика (см. inventory §1): последняя левая страница в soft-альбомах,
 * прощание с классом. Опциональное общее фото класса (classphotoframe).
 * Применяется только когда `preset.sheet_type === 'soft'`. Для hard —
 * секция игнорируется с warning.
 *
 * Мастер: жёстко прошито имя `S-Final`. В реальной БД для okeybook-default
 * мастер существует под именем `S-Final-Soft-L` (из фикстур rule-engine).
 * Если `S-Final` не находится — пробуем `S-Final-Soft-L` как fallback.
 * Если ни один не найден — warning master_not_found.
 *
 * Bindings: placeholder-driven, поддерживаемый label — `classphotoframe`
 * (если есть в мастере). Cursor-логика через
 * `arr.length - available.full_class` — порядок: bindings ДО decrement.
 *
 * Позиция: S-Final встаёт как очередная страница в pageInstances. Для
 * хорошей визуальной картины должна быть на левой стороне последнего
 * разворота. Орchestrator не гарантирует это; партнёр в редакторе
 * подвинет при необходимости.
 */

import type { SpreadTemplate } from '@/lib/album-builder/types';
import type { SectionFillContext } from './shared';

export function fillSoftFinalSection(ctx: SectionFillContext): void {
  const sheetType = ctx.bundle.preset.sheet_type;
  if (sheetType !== 'soft') {
    ctx.warnings.push(
      `soft_final_skipped: sheet_type='${sheetType ?? 'null'}' (S-Final применяется только для soft)`,
    );
    return;
  }

  let master: SpreadTemplate | undefined = ctx.bundle.mastersByName.get('S-Final');
  if (!master) master = ctx.bundle.mastersByName.get('S-Final-Soft-L');
  if (!master) {
    ctx.warnings.push(
      `soft_final_master_not_found: ни 'S-Final' ни 'S-Final-Soft-L' не найдены в template_set дизайна`,
    );
    return;
  }

  // Bindings ДО decrement available.
  const bindings: Record<string, unknown> = {};
  const fullClassUsed =
    ctx.input.common_photos.full_class.length - ctx.available.full_class;
  let consumedFullClass = 0;

  for (let i = 0; i < master.placeholders.length; i++) {
    const ph = master.placeholders[i];
    if (ph.label.toLowerCase() === 'classphotoframe') {
      const photo = ctx.input.common_photos.full_class[fullClassUsed];
      if (photo) {
        bindings[ph.label] = photo;
        consumedFullClass = 1;
      }
      break;
    }
  }

  ctx.available.full_class -= consumedFullClass;

  const pageIndex = ctx.pageInstances.length;
  ctx.pageInstances.push({ master_id: master.id, bindings });

  ctx.decisionTrace.push({
    spread_index: Math.floor(pageIndex / 2),
    section_index: ctx.sectionIndex,
    family_id: 'final',
    rule_id: `soft_final:${master.name}`,
    inputs: {
      consumes: { full_class: consumedFullClass },
      sheet_type: 'soft',
    },
  });
}
