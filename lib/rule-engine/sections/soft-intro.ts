/**
 * Заполнение секции type='soft_intro' для buildFromSectionStructure.
 *
 * Семантика (см. inventory §1): первая правая страница в soft-альбомах
 * с общим фото класса (classphotoframe). Применяется только когда
 * `preset.sheet_type === 'soft'`. Для hard — секция игнорируется
 * с warning (партнёр поставил её в section_structure ошибочно).
 *
 * РЭ.22.8.2: семантический поиск мастера через page_role='intro' +
 * опциональный photos_full=1. Legacy fallback на жёсткое имя 'S-Intro'
 * для template_set'ов где теги ещё не размечены.
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

import type { SpreadTemplate } from '@/lib/album-builder/types';
import { findSoftSectionMaster } from '../master-finder';
import type { SectionFillContext } from './shared';

export function fillSoftIntroSection(ctx: SectionFillContext): void {
  const sheetType = ctx.bundle.preset.sheet_type;
  if (sheetType !== 'soft') {
    ctx.warnings.push(
      `soft_intro_skipped: sheet_type='${sheetType ?? 'null'}' (S-Intro применяется только для soft)`,
    );
    return;
  }

  // 1) Семантический путь: ищем мастер с page_role='intro', photos_full=1
  //    (требуется слот для общего фото класса).
  const semanticResult = findSoftSectionMaster(ctx.bundle.mastersByName, {
    presetId: ctx.bundle.preset.id,
    pageRole: 'intro',
    photosFull: 1,
  });

  let master: SpreadTemplate | undefined;
  let semantic = false;
  if (semanticResult) {
    master = semanticResult.master;
    semantic = true;
  } else {
    // 2) Legacy fallback по имени
    master = ctx.bundle.mastersByName.get('S-Intro');
  }

  if (!master) {
    ctx.warnings.push(
      `soft_intro_master_not_found: ни через семантический поиск ` +
        `(page_role='intro', photos_full=1), ни по имени 'S-Intro' мастер ` +
        `не найден в template_set. Закажите мастер у дизайнера.`,
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
    rule_id: `soft_intro:${master.name}`,
    inputs: {
      consumes: { full_class: consumedFullClass },
      sheet_type: 'soft',
      semantic,
    },
  });
}
