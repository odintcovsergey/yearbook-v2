/**
 * Заполнение секции type='soft_intro' для buildFromSectionStructure.
 *
 * Семантика (см. inventory §1): первая правая страница в soft-альбомах
 * с общим фото класса (classphotoframe). Применяется только когда
 * `preset.sheet_type === 'soft'`. Для hard — секция игнорируется
 * с warning (партнёр поставил её в section_structure ошибочно).
 *
 * Мастер: жёстко прошито имя `S-Intro`. В реальной БД для okeybook-default
 * этот мастер есть (из контекста v38: «intro (2)» в page_role). Если
 * его нет — warning master_not_found.
 *
 * Bindings: placeholder-driven, единственный поддерживаемый label —
 * `classphotoframe` (первое ещё неиспользованное full_class). Cursor-логика
 * через `arr.length - available.full_class` — порядок: bindings ДО
 * decrement available (как в teachers/students-combined).
 *
 * Позиция страницы: S-Intro обычно первая правая страница альбома, но
 * наш orchestrator не контролирует это явно. Если soft_intro идёт первой
 * в section_structure — она встанет на pageInstances[0] = left. Это
 * визуальное расхождение со стандартом, но функционально корректно
 * (страница есть, фото есть). Партнёр в редакторе может подвинуть.
 */

import type { SectionFillContext } from './shared';

export function fillSoftIntroSection(ctx: SectionFillContext): void {
  const sheetType = ctx.bundle.preset.sheet_type;
  if (sheetType !== 'soft') {
    ctx.warnings.push(
      `soft_intro_skipped: sheet_type='${sheetType ?? 'null'}' (S-Intro применяется только для soft)`,
    );
    return;
  }

  const master = ctx.bundle.mastersByName.get('S-Intro');
  if (!master) {
    ctx.warnings.push(
      `soft_intro_master_not_found: 'S-Intro' отсутствует в template_set дизайна`,
    );
    return;
  }

  // Bindings ДО decrement available (cursor-логика).
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
      // Если фото нет — slot пустой, Konva canvas покажет placeholder.
      break;
    }
  }

  ctx.available.full_class -= consumedFullClass;

  const pageIndex = ctx.pageInstances.length;
  ctx.pageInstances.push({ master_id: master.id, bindings });

  ctx.decisionTrace.push({
    spread_index: Math.floor(pageIndex / 2),
    section_index: ctx.sectionIndex,
    family_id: 'intro',
    rule_id: 'soft_intro:S-Intro',
    inputs: {
      consumes: { full_class: consumedFullClass },
      sheet_type: 'soft',
    },
  });
}
