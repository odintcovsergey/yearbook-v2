/**
 * Rule Engine — buildFromSectionStructure (orchestrator)
 *
 * Новый build engine, работающий по `preset.section_structure` —
 * высокоуровневой структуре альбома, редактируемой партнёром через UI
 * (РЭ.21.3 → РЭ.21.7).
 *
 * Существует ПАРАЛЛЕЛЬНО с двумя другими движками:
 *  - `lib/album-builder/build-from-preset.ts` (legacy buildAlbum)
 *  - `lib/rule-engine/build.ts` (JSON-правила, buildFromRules)
 *
 * Опт-ин будет per-album в РЭ.21.8.7. До этого момента функция вызывается
 * только из тестов и из sandbox endpoint (РЭ.21.8.6).
 *
 * === Архитектура ===
 *
 * Orchestrator (этот файл) делает три вещи:
 *  1. Защищается от section_structure=NULL (status='failed' без секций).
 *  2. Собирает SectionFillContext и для каждой секции вызывает
 *     соответствующую функцию из ./sections/. Функции мутируют ctx —
 *     накапливают страницы / warnings / decision_trace.
 *  3. Группирует накопленные страницы в SpreadInstance (по 2 в разворот,
 *     последний может быть одиночным).
 *
 * Текущее покрытие секций (РЭ.21.8.4a):
 *  - common   ✓ fillCommonSection (slot-chains H/Q/FULL/flex_A/B/C)
 *  - teachers ✓ fillTeachersSection (F-Head-* + G-* по subjects_count)
 *
 * Заглушки (warning section_<type>_not_implemented):
 *  - students   — РЭ.21.8.4b (адаптивные сетки с density)
 *  - soft_intro — РЭ.21.8.5 (S-Intro для sheet_type='soft')
 *  - soft_final — РЭ.21.8.5
 *  - vignette   — отложено
 *
 * Статусы:
 *  - 'failed'  — только при NULL section_structure
 *  - 'partial' — есть warnings (заглушки или пропуски слотов)
 *  - 'ok'      — никаких warnings
 *
 * Не реализовано (план):
 *  - bindings для common-страниц пока {} — реальные bindings придут
 *    в РЭ.21.8.4b (общий placeholder-driven mapping вынесем тогда же
 *    в sections/shared.ts).
 *  - rules_version = 'section_structure_v0' (фикс. заглушка; в РЭ.21.8.6
 *    решим формат).
 */

import type {
  AlbumLayout,
  DecisionTraceEntry,
  LayoutStatus,
  PageInstance,
  RulesAlbumInput,
  SpreadInstance,
} from './types';
import type { RuleEngineBundle } from './loaders';
import type { CommonPhotoCounts } from './slot-chains';
import type { SpreadTemplate } from '@/lib/album-builder/types';
import {
  fillCommonAdditionalSection,
  fillCommonAutoSection,
  fillCommonRequiredSection,
  fillCommonSection,
  fillSoftFinalSection,
  fillSoftIntroSection,
  fillStudentsSection,
  fillTeachersSection,
  fillTransitionSection,
} from './sections';
import type { SectionFillContext } from './sections';

export function buildFromSectionStructure(
  bundle: RuleEngineBundle,
  input: RulesAlbumInput,
): AlbumLayout {
  // 1. Без section_structure — отказ.
  const sectionStructure = bundle.preset.section_structure;
  if (sectionStructure === null || sectionStructure === undefined) {
    return {
      spreads: [],
      decision_trace: [],
      rules_version: 'section_structure_v0',
      preset_id: bundle.preset.id,
      status: 'failed',
      warnings: [
        `section_structure_missing: preset '${bundle.preset.id}' has no section_structure (NULL)`,
      ],
    };
  }

  // 2. Снапшот доступных общих фото — будет декрементиться по мере
  // потребления секциями (common через slot-chains; teachers через G-*).
  const available: CommonPhotoCounts = {
    full_class: input.common_photos.full_class.length,
    half_class: input.common_photos.half_class.length,
    quarter: input.common_photos.quarter.length,
    sixth: input.common_photos.sixth.length,
  };

  // 3. Накопители (мутируются функциями-секциями).
  const pageInstances: PageInstance[] = [];
  const decisionTrace: DecisionTraceEntry[] = [];
  const warnings: string[] = [];

  // 4. Контекст — общий для всех функций-секций.
  const ctx: SectionFillContext = {
    bundle,
    input,
    available,
    pageInstances,
    decisionTrace,
    warnings,
    sectionIndex: 0,
  };

  // 5. Обход секций. Каждая функция мутирует ctx.
  //
  // РЭ.35.Ж: секции которые СЕМАНТИЧЕСКИ отдельные от предыдущих
  // (партнёр явно положил их как отдельные блоки в шаблоне) помечаются
  // флагом section_start у первой добавленной страницы. В шаге 6
  // (группировка) это превращается в принудительное закрытие предыдущего
  // разворота с пустой правой.
  //
  // Список НАМЕРЕННО узкий: только common_required и soft_final.
  // - transition — продолжает students, НЕ помечаем
  // - teachers, students, soft_intro — обычно идут с начала альбома или
  //   в начале своего раздела, legacy-поведение «правая прошлой секции
  //   = левая текущей» зашито в тестах и используется в плотностных
  //   пресетах; не трогаем чтобы не сломать обратную совместимость
  // - common (legacy slots-режим), common_additional — те же причины
  const SECTIONS_THAT_START_NEW_SPREAD = new Set([
    'common_required',
    'soft_final',
  ]);
  for (let sIdx = 0; sIdx < sectionStructure.length; sIdx++) {
    ctx.sectionIndex = sIdx;
    const section = sectionStructure[sIdx];
    const startCountBeforeSection = pageInstances.length;

    switch (section.type) {
      case 'common':
        if ('mode' in section) {
          fillCommonAutoSection(ctx, section.max_spreads);
        } else {
          fillCommonSection(ctx, section.slots);
        }
        break;
      case 'common_required':
        fillCommonRequiredSection(ctx, section.pages);
        break;
      case 'common_additional':
        fillCommonAdditionalSection(ctx, section.max_spreads);
        break;
      case 'transition':
        // РЭ.37.2.b: передаём весь section entry (нужны mode/custom/master_name).
        fillTransitionSection(ctx, section);
        break;
      case 'teachers':
        fillTeachersSection(ctx);
        break;
      case 'students':
        fillStudentsSection(ctx);
        break;
      case 'soft_intro':
        fillSoftIntroSection(ctx);
        break;
      case 'soft_final':
        fillSoftFinalSection(ctx);
        break;
      // vignette — отложено (виньетки из детских фото = отдельная подсистема).
      case 'vignette':
        warnings.push(`section_${section.type}_not_implemented`);
        break;
    }

    // Помечаем первую добавленную секцией страницу флагом section_start
    // если секция требует начать новый разворот.
    if (
      SECTIONS_THAT_START_NEW_SPREAD.has(section.type) &&
      pageInstances.length > startCountBeforeSection
    ) {
      pageInstances[startCountBeforeSection].section_start = true;
    }
  }

  // 5.5. Enforcement min_pages / max_pages из пресета.
  // Применяется ПОСЛЕ всех секций, ДО группировки в spreads.
  // - При переборе (страниц > max_pages) обрезаем хвост + warning.
  //   Партнёр через редактор может посмотреть что обрезалось.
  // - При недоборе (страниц < min_pages) — warning без auto-fill.
  //   Партнёр явно добавит общие развороты через section_structure
  //   или вручную через TemplatePickerModal.
  const minPages = bundle.preset.min_pages;
  const maxPages = bundle.preset.max_pages;
  const totalPages = pageInstances.length;

  if (typeof maxPages === 'number' && totalPages > maxPages) {
    const dropped = totalPages - maxPages;
    pageInstances.length = maxPages; // обрезаем in-place
    warnings.push(
      `pages_overflow_truncated: страниц ${totalPages} > max_pages ${maxPages}, обрезано ${dropped} (с конца)`,
    );
    // Чистим decision_trace для обрезанных страниц (spread_index >= maxPages/2).
    // Делать не строго обязательно (trace всё равно отладочная инфа), но
    // чище для UI: фильтр inline через splice по индексу.
    const maxSpreadKept = Math.floor((maxPages - 1) / 2);
    for (let i = decisionTrace.length - 1; i >= 0; i--) {
      if (decisionTrace[i].spread_index > maxSpreadKept) {
        decisionTrace.splice(i, 1);
      }
    }
  } else if (typeof minPages === 'number' && totalPages < minPages) {
    warnings.push(
      `pages_underflow: страниц ${totalPages} < min_pages ${minPages} (партнёр добавит общие развороты вручную)`,
    );
  }

  // 6. Группировка страниц в SpreadInstance.
  // Для is_spread мастеров (двухстраничных, например E-Student-Standard или
  // J-Spread) section-функция кладёт ДВЕ записи pageInstances с одинаковым
  // master_id. Здесь мы детектируем такие пары через master.is_spread флаг
  // и помечаем SpreadInstance.is_spread=true, чтобы adapter
  // layout-to-buildresult сделал 1 legacy SpreadInstance вместо 2.
  // Для остальных случаев — обычная попарная группировка.
  //
  // РЭ.35.Ж: учитываем флаг section_start. Если страница помечена как
  // начало новой секции, а текущий разворот ещё открыт (висит left без
  // right) — закрываем его пустым right и начинаем новый разворот с
  // этой страницы как left. Это создаёт «висящий» разворот после хвоста
  // students когда transition пропустила страницу — и common_required
  // начинается с нового разворота, как и должно быть.
  const mastersById = new Map<string, SpreadTemplate>();
  bundle.mastersByName.forEach((m) => mastersById.set(m.id, m));

  const spreads: SpreadInstance[] = [];
  let i = 0;
  while (i < pageInstances.length) {
    const left = pageInstances[i];
    const next = i + 1 < pageInstances.length ? pageInstances[i + 1] : undefined;
    // Если следующая страница помечена section_start — она не должна
    // быть правой текущего разворота. Закрываем разворот с right=undefined.
    const useRight =
      next && !next.section_start ? next : undefined;
    let isSpread = false;
    if (useRight && left.master_id === useRight.master_id) {
      const master = mastersById.get(left.master_id);
      if (master && master.is_spread === true) isSpread = true;
    }
    spreads.push({
      spread_index: spreads.length,
      left,
      right: useRight,
      ...(isSpread ? { is_spread: true } : {}),
    });
    // Если right взят — двинулись на 2, иначе на 1 (висящий разворот).
    i += useRight ? 2 : 1;
  }

  // 7. Статус.
  const status: LayoutStatus = warnings.length > 0 ? 'partial' : 'ok';

  return {
    spreads,
    decision_trace: decisionTrace,
    rules_version: 'section_structure_v0',
    preset_id: bundle.preset.id,
    status,
    warnings,
  };
}
