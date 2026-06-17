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
    collage: input.common_photos.collage.length,
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
        // ТЗ 17.06.2026: настройки личного раздела привязаны к секции
        // (section.config). Несколько students-секций → каждая раскладывает
        // весь класс в своём режиме. config отсутствует → legacy-фолбэк на
        // глобальные поля пресета (внутри fillStudentsSection).
        fillStudentsSection(ctx, section.config);
        break;
      case 'soft_intro':
        fillSoftIntroSection(ctx, section);
        break;
      case 'soft_final':
        fillSoftFinalSection(ctx, section);
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

    // РЭ.43: тегируем все добавленные секцией страницы её типом.
    // Используется ниже в enforcement max_pages для защиты soft_intro/
    // soft_final от обрезки. Заполняется ПОСЛЕ fill-функции — она сама
    // не знает свой тип в section_structure (могла бы, но архитектурно
    // удобнее проставить тег в orchestrator-е).
    for (let i = startCountBeforeSection; i < pageInstances.length; i++) {
      pageInstances[i].section_type = section.type;
    }
  }

  // 5.5. Enforcement min_pages / max_pages из пресета.
  // Применяется ПОСЛЕ всех секций, ДО группировки в spreads.
  // - При переборе (страниц > max_pages) обрезаем хвост + warning.
  //   РЭ.43: soft_intro и soft_final ЗАЩИЩЕНЫ от обрезки. Если суммарно
  //   страниц больше max_pages, удаляем последние НЕ-защищённые страницы.
  //   Это сохраняет семантику soft binding: первая страница на форзаце
  //   (soft_intro), последняя на форзаце (soft_final). Обрезается хвост
  //   общего раздела / лишние students.
  //   Партнёр через редактор может посмотреть что обрезалось.
  // - При недоборе (страниц < min_pages) — warning без auto-fill.
  //   Партнёр явно добавит общие развороты через section_structure
  //   или вручную через TemplatePickerModal.
  const minPages = bundle.preset.min_pages;
  const maxPages = bundle.preset.max_pages;
  const totalPages = pageInstances.length;

  if (typeof maxPages === 'number' && totalPages > maxPages) {
    const toRemove = totalPages - maxPages;

    // РЭ.43: индексы страниц которые МОЖНО удалять (не soft_intro/final).
    const PROTECTED_SECTION_TYPES = new Set<string>([
      'soft_intro',
      'soft_final',
    ]);
    const removableIndices: number[] = [];
    for (let i = 0; i < pageInstances.length; i++) {
      const sType = pageInstances[i].section_type;
      // Если section_type отсутствует (старое поведение) — считаем
      // страницу removable: обратная совместимость для тестов / случаев
      // когда orchestrator теги не проставил.
      if (!sType || !PROTECTED_SECTION_TYPES.has(sType)) {
        removableIndices.push(i);
      }
    }

    if (removableIndices.length < toRemove) {
      // Эдж-кейс: защищённых страниц больше чем мы можем оставить
      // в max_pages. Например max_pages=1, а структура {soft_intro,
      // soft_final}. Удаляем все removable, выдаём warning о том
      // что обрезка не полностью применилась.
      const indicesToRemove = new Set(removableIndices);
      const filtered = pageInstances.filter((_, i) => !indicesToRemove.has(i));
      pageInstances.length = 0;
      pageInstances.push(...filtered);
      warnings.push(
        `pages_overflow_partial_truncation: страниц ${totalPages} > max_pages ${maxPages}, ` +
          `обрезаны все ${removableIndices.length} не-защищённых страниц (общий раздел, students), ` +
          `но защищённых (soft_intro, soft_final) больше чем помещается. ` +
          `Текущая длина ${pageInstances.length}. Увеличьте max_pages или упростите структуру.`,
      );
    } else {
      // Стандартный случай: удаляем последние toRemove из removable.
      // С конца — потому что обрезка традиционно «с конца альбома»,
      // и эта страница ВСЕГДА имеет смысл "последняя добавленная не-защищённая".
      const indicesToRemove = new Set(removableIndices.slice(-toRemove));
      const filtered = pageInstances.filter((_, i) => !indicesToRemove.has(i));
      pageInstances.length = 0;
      pageInstances.push(...filtered);
      warnings.push(
        `pages_overflow_truncated: страниц ${totalPages} > max_pages ${maxPages}, обрезано ${toRemove} ` +
          `(soft_intro/soft_final защищены, обрезаются страницы общего раздела/students)`,
      );
    }

    // Чистим decision_trace для удалённых spread_index'ов. После фильтрации
    // последний spread_index = (pageInstances.length-1) / 2. Всё что больше — мусор.
    const maxSpreadKept = Math.floor((pageInstances.length - 1) / 2);
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
  //
  // РЭ.37.3.c: для sheet_type='soft' page 1 физически отсутствует (это
  // обложка/forzac мягкого переплёта, не входит в pageInstances). Первый
  // разворот альбома при soft binding состоит из {left: undefined,
  // right: pageInstances[0]}. Далее парная группировка идёт от индекса 1.
  // Без этой правки UI Обзор показывал «layflat-группировку» для soft
  // (S-Intro попадал на левую первого разворота, что неверно — у мягкого
  // переплёта page 1 это обложка), а UI Редактор делал свой pre-processing
  // и показывал правду — отсюда расхождение «Обзор vs Редактор».
  const mastersById = new Map<string, SpreadTemplate>();
  bundle.mastersByName.forEach((m) => mastersById.set(m.id, m));

  const spreads: SpreadInstance[] = [];
  let i = 0;

  // РЭ.37.3.c: soft binding — первый разворот это [обложка (нет в pageInstances),
  // pageInstances[0] как right]. Дальше парная группировка с индекса 1.
  //
  // Исключение: если pageInstances[0].section_start=true (это бывает когда
  // первой секцией стоит common_required или soft_final — секции из
  // SECTIONS_THAT_START_NEW_SPREAD), значит первая страница СЕМАНТИЧЕСКИ
  // требует быть LEFT нового разворота. Тогда soft-сдвиг НЕ применяется —
  // страница ложится на LEFT первого разворота как при layflat.
  const isSoft = bundle.preset.sheet_type === 'soft';
  if (
    isSoft &&
    pageInstances.length > 0 &&
    !pageInstances[0].section_start
  ) {
    spreads.push({
      spread_index: 0,
      right: pageInstances[0],
    });
    i = 1;
  }

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
