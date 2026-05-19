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
  for (let sIdx = 0; sIdx < sectionStructure.length; sIdx++) {
    ctx.sectionIndex = sIdx;
    const section = sectionStructure[sIdx];

    switch (section.type) {
      case 'common':
        // РЭ.21.8.8: две формы common-секции.
        //   { type: 'common', slots: [...] }                       — manual
        //   { type: 'common', mode: 'auto', max_spreads: N }       — auto
        // Различаем явной проверкой поля mode. TS не умеет сужать
        // discriminated union по 'mode' in section когда оба варианта
        // имеют один и тот же type — поэтому используем if/else с явной
        // type assertion.
        if ('mode' in section) {
          fillCommonAutoSection(ctx, section.max_spreads);
        } else {
          fillCommonSection(ctx, section.slots);
        }
        break;
      case 'common_required':
        // РЭ.21.8.9: обязательный общий раздел по эталонной таблице OkeyBook.
        // Параметров нет — engine сам выбирает строку таблицы по
        // density × sheet_type × students_count.
        fillCommonRequiredSection(ctx);
        break;
      case 'common_additional':
        // РЭ.21.8.10: дополнительный общий раздел (платная допуслуга).
        // max_spreads берётся из секции — партнёр в редакторе альбома
        // выставляет сколько разворотов готов добавить.
        fillCommonAdditionalSection(ctx, section.max_spreads);
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
  const mastersById = new Map<string, SpreadTemplate>();
  bundle.mastersByName.forEach((m) => mastersById.set(m.id, m));

  const spreads: SpreadInstance[] = [];
  for (let i = 0; i < pageInstances.length; i += 2) {
    const left = pageInstances[i];
    const right = i + 1 < pageInstances.length ? pageInstances[i + 1] : undefined;
    let isSpread = false;
    if (right && left.master_id === right.master_id) {
      const master = mastersById.get(left.master_id);
      if (master && master.is_spread === true) isSpread = true;
    }
    spreads.push({
      spread_index: Math.floor(i / 2),
      left,
      right,
      ...(isSpread ? { is_spread: true } : {}),
    });
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
