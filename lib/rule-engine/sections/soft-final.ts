/**
 * Заполнение секции type='soft_final' для buildFromSectionStructure.
 *
 * Семантика (см. inventory §1): последняя левая страница в soft-альбомах,
 * прощание с классом. Опциональное общее фото класса (classphotoframe).
 * Применяется только когда `preset.sheet_type === 'soft'`. Для hard —
 * секция игнорируется с warning.
 *
 * РЭ.22.8.2: семантический поиск мастера через page_role='final' +
 * опциональный photos_full=1. Legacy fallback двойной: сначала 'S-Final'
 * (которого в реальной БД okeybook-default не существует, но может быть
 * у партнёра), потом 'S-Final-Soft-L'. После семантизации эта
 * двойственность имён не нужна — engine ищет по page_role.
 *
 * РЭ.42: партнёр может явно указать `master_name` в section_structure —
 * аналогично soft_intro. Если master_name задан, но мастер не найден —
 * страница пропускается с warning.
 *
 * Bindings: placeholder-driven, поддерживаемый label — `classphotoframe`
 * (если есть в мастере). Cursor-логика через
 * `arr.length - available.full_class` — порядок: bindings ДО decrement.
 *
 * Позиция: S-Final встаёт как очередная страница в pageInstances. Для
 * хорошей визуальной картины должна быть на левой стороне последнего
 * разворота. Orchestrator не гарантирует это; партнёр в редакторе
 * подвинет при необходимости.
 */

import type { SpreadTemplate } from '@/lib/album-builder/types';
import { findSoftSectionMaster } from '../master-finder';
import type { SectionStructureEntry } from '../types';
import { bindOverrideMasterPlaceholders } from './shared';
import type { SectionFillContext } from './shared';

export function fillSoftFinalSection(
  ctx: SectionFillContext,
  section: Extract<SectionStructureEntry, { type: 'soft_final' }>,
): void {
  const sheetType = ctx.bundle.preset.sheet_type;
  if (sheetType !== 'soft') {
    ctx.warnings.push(
      `soft_final_skipped: sheet_type='${sheetType ?? 'null'}' (S-Final применяется только для soft)`,
    );
    return;
  }

  let master: SpreadTemplate | undefined;
  let semantic = false;
  let overridden = false;

  // РЭ.42: explicit override через section.master_name.
  if (section.master_name) {
    master = ctx.bundle.mastersByName.get(section.master_name);
    if (!master) {
      ctx.warnings.push(
        `soft_final_master_override_not_found: указанный мастер ` +
          `'${section.master_name}' не найден в template_set. ` +
          `Проверьте имя мастера или выберите другой в редакторе шаблона.`,
      );
      return;
    }
    overridden = true;
  } else {
    // Автоматический режим (по умолчанию).
    // 1) Семантический путь: page_role='final', photos_full=1.
    const semanticResult = findSoftSectionMaster(ctx.bundle.mastersByName, {
      presetId: ctx.bundle.preset.id,
      pageRole: 'final',
      photosFull: 1,
    });

    if (semanticResult) {
      master = semanticResult.master;
      semantic = true;
    } else {
      // 2) Legacy fallback по имени — сначала S-Final, потом S-Final-Soft-L.
      //    В реальной БД okeybook-default есть только второй, но первый
      //    может быть у других партнёров.
      master = ctx.bundle.mastersByName.get('S-Final');
      if (!master) master = ctx.bundle.mastersByName.get('S-Final-Soft-L');
    }

    if (!master) {
      ctx.warnings.push(
        `soft_final_master_not_found: ни через семантический поиск ` +
          `(page_role='final', photos_full=1), ни по именам 'S-Final' / ` +
          `'S-Final-Soft-L' мастер не найден в template_set. Закажите ` +
          `мастер у дизайнера.`,
      );
      return;
    }
  }

  // Bindings: для override-режима — универсальная placeholder-driven логика
  // (РЭ.42.b.2). Для автоматического — узкая classphoto-only.
  let bindings: Record<string, unknown>;
  let consumedFullClass = 0;
  let consumedHalfClass = 0;

  if (overridden) {
    const result = bindOverrideMasterPlaceholders(master, ctx.input, ctx.available);
    bindings = result.bindings;
    consumedFullClass = result.consumes.full_class;
    consumedHalfClass = result.consumes.half_class;
  } else {
    bindings = {};
    const fullClassUsed =
      ctx.input.common_photos.full_class.length - ctx.available.full_class;

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
  }

  ctx.available.full_class -= consumedFullClass;
  ctx.available.half_class -= consumedHalfClass;

  const pageIndex = ctx.pageInstances.length;
  ctx.pageInstances.push({ master_id: master.id, bindings });

  ctx.decisionTrace.push({
    spread_index: Math.floor(pageIndex / 2),
    section_index: ctx.sectionIndex,
    family_id: 'final',
    rule_id: `soft_final:${master.name}`,
    inputs: {
      consumes: {
        full_class: consumedFullClass,
        half_class: consumedHalfClass,
      },
      sheet_type: 'soft',
      semantic,
      overridden,
    },
  });
}
