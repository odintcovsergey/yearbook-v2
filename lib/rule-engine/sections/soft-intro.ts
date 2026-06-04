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
 * РЭ.42: партнёр может явно указать `master_name` в section_structure —
 * тогда вместо автоматического поиска engine берёт именно этот мастер
 * из template_set. Это нужно когда партнёр хочет на первой правой странице
 * не общее фото класса, а, например, учителей / классного руководителя /
 * воспитателей детсада. Если master_name указан, но мастер не найден —
 * страница пропускается с warning (партнёр сразу заметит и исправит,
 * это лучше чем тихое падение на classphoto).
 *
 * Bindings: placeholder-driven, единственный поддерживаемый label —
 * `classphotoframe` (первое ещё неиспользованное full_class). Cursor-логика
 * через `arr.length - available.full_class` — порядок: bindings ДО
 * decrement available (как в teachers/students-combined). Для override-
 * мастеров с teacher-placeholder'ами автоматический биндинг пока не
 * реализован — партнёр заполнит teacher-фото в редакторе вручную.
 *
 * Позиция страницы: S-Intro обычно первая правая страница альбома, но
 * наш orchestrator не контролирует это явно. Если soft_intro идёт первой
 * в section_structure — она встанет на pageInstances[0], а группировка
 * для sheet_type='soft' положит её на R первого разворота (см.
 * build-from-section-structure.ts:255).
 */

import type { SpreadTemplate } from '@/lib/album-builder/types';
import { findSoftSectionMaster } from '../master-finder';
import type { SectionStructureEntry } from '../types';
import { bindOverrideMasterPlaceholders } from './shared';
import type { SectionFillContext } from './shared';

export function fillSoftIntroSection(
  ctx: SectionFillContext,
  section: Extract<SectionStructureEntry, { type: 'soft_intro' }>,
): void {
  const sheetType = ctx.bundle.preset.sheet_type;
  if (sheetType !== 'soft') {
    ctx.warnings.push(
      `soft_intro_skipped: sheet_type='${sheetType ?? 'null'}' (S-Intro применяется только для soft)`,
    );
    return;
  }

  let master: SpreadTemplate | undefined;
  let semantic = false;
  let overridden = false;

  // РЭ.42: explicit override через section.master_name. Если задан и
  // мастер найден — используем его. Если задан но не найден — warning
  // и SKIP страницы (не падаем на автоматический classphoto, чтобы
  // партнёр заметил опечатку / отсутствие мастера в template_set).
  if (section.master_name) {
    master = ctx.bundle.mastersByName.get(section.master_name);
    if (!master) {
      ctx.warnings.push(
        `soft_intro_master_override_not_found: указанный мастер ` +
          `'${section.master_name}' не найден в template_set. ` +
          `Проверьте имя мастера или выберите другой в редакторе шаблона.`,
      );
      return;
    }
    overridden = true;
  } else {
    // Автоматический режим (по умолчанию).
    // 1) Семантический путь: ищем мастер с page_role='intro', photos_full=1
    //    (требуется слот для общего фото класса).
    const semanticResult = findSoftSectionMaster(ctx.bundle.mastersByName, {
      presetId: ctx.bundle.preset.id,
      pageRole: 'intro',
      photosFull: 1,
    });

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
  }

  // Bindings: для override-режима — универсальная placeholder-driven логика
  // (classphoto + halfphoto + quarter + sixth/collage + spread + headteacher*
  // + subjects/teachers, РЭ.42.b.2 + РЭ.42.b.3).
  // Для автоматического режима — узкая classphoto-only логика (наследие,
  // не трогаем чтобы не сломать стабильное поведение).
  let bindings: Record<string, unknown>;
  let consumedFullClass = 0;
  let consumedHalfClass = 0;
  let consumedQuarter = 0;
  let consumedSixth = 0;
  let consumedCollage = 0;

  if (overridden) {
    const result = bindOverrideMasterPlaceholders(master, ctx.input, ctx.available);
    bindings = result.bindings;
    consumedFullClass = result.consumes.full_class;
    consumedHalfClass = result.consumes.half_class;
    consumedQuarter = result.consumes.quarter;
    consumedSixth = result.consumes.sixth;
    consumedCollage = result.consumes.collage;
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
        // Если фото нет — slot пустой, Konva canvas покажет placeholder.
        break;
      }
    }
    // РЭ.56: для всех text-placeholder'ов которые не получили binding
    // (например, декоративные тексты типа static_text_1) — записываем
    // default_text из IDML как initial value. Без этого декор не виден.
    for (const ph of master.placeholders) {
      const phAny = ph as { label: string; type?: string; default_text?: string };
      if (phAny.type === 'text' && phAny.default_text && !(ph.label in bindings)) {
        bindings[ph.label] = phAny.default_text;
      }
    }
  }

  ctx.available.full_class -= consumedFullClass;
  ctx.available.half_class -= consumedHalfClass;
  ctx.available.quarter -= consumedQuarter;
  ctx.available.sixth -= consumedSixth;
  ctx.available.collage -= consumedCollage;

  const pageIndex = ctx.pageInstances.length;
  ctx.pageInstances.push({ master_id: master.id, bindings });

  ctx.decisionTrace.push({
    spread_index: Math.floor(pageIndex / 2),
    section_index: ctx.sectionIndex,
    family_id: 'intro',
    rule_id: `soft_intro:${master.name}`,
    inputs: {
      consumes: {
        full_class: consumedFullClass,
        half_class: consumedHalfClass,
        quarter: consumedQuarter,
        sixth: consumedSixth,
        collage: consumedCollage,
      },
      sheet_type: 'soft',
      semantic,
      overridden,
    },
  });
}
