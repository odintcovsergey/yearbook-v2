/**
 * Rule Engine — buildFromSectionStructure (skeleton, РЭ.21.8.3)
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
 * === Текущий статус (РЭ.21.8.3 skeleton) ===
 *
 * Реализовано:
 *  - Проход по `preset.section_structure` по порядку.
 *  - Для секции `common` — заполнение слотов через `tryFillSlot` из
 *    `./slot-chains` (РЭ.21.8.2). Резолв `master_name` через
 *    `bundle.mastersByName`. Учёт оставшихся общих фото.
 *  - Группировка страниц в развороты (left+right).
 *  - decision_trace на каждый слот с записью chain trace.
 *
 * НЕ реализовано (заглушки → warning `section_<type>_not_implemented`):
 *  - `soft_intro` / `soft_final` — учитывается sheet_type (РЭ.21.8.5)
 *  - `teachers` — F-Head + G-* выбор по subjects_count (РЭ.21.8.4)
 *  - `students` — адаптивные сетки через findMaster (РЭ.21.8.4)
 *  - `vignette` — отдельная секция (отложено)
 *
 * Также пока упрощено:
 *  - bindings всегда пустые (`{}`) — мапинг фото на labels мастера будет
 *    в РЭ.21.8.4 совместно с подключением students.
 *  - rules_version = `'section_structure_v0'` (хэш правил отсутствует —
 *    это новая модель, не rule engine; в РЭ.21.8.6 решим формат версии).
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
import { tryFillSlot } from './slot-chains';
import type { CommonPhotoCounts, SlotPosition } from './slot-chains';

export function buildFromSectionStructure(
  bundle: RuleEngineBundle,
  input: RulesAlbumInput,
): AlbumLayout {
  const warnings: string[] = [];
  const decisionTrace: DecisionTraceEntry[] = [];

  // 1. Без section_structure — отказ. Это контракт нового engine'а:
  // пресет должен быть приведён к новой модели до использования.
  // Для старых пресетов с NULL используется один из других движков
  // (legacy / rule engine v1.3) — выбор делается на уровне альбома.
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

  // 2. Снапшот доступных общих фото. Будет декрементиться по мере
  // потребления слотами; URL'ы фото пока не используются (bindings={}).
  const available: CommonPhotoCounts = {
    full_class: input.common_photos.full_class.length,
    half_class: input.common_photos.half_class.length,
    quarter: input.common_photos.quarter.length,
    sixth: input.common_photos.sixth.length,
  };

  // 3. Накопитель страниц. Позиция (left/right) определяется чётностью
  // индекса в pageInstances. Разворот = группа из 2 страниц.
  // Когда подключатся soft_intro/teachers (РЭ.21.8.5) — стартовый offset
  // может стать ≠ 0; пока — простая модель.
  const pageInstances: PageInstance[] = [];

  // 4. Обход секций.
  for (let sIdx = 0; sIdx < sectionStructure.length; sIdx++) {
    const section = sectionStructure[sIdx];

    if (section.type !== 'common') {
      // Заглушка. РЭ.21.8.4-5 заменят на реальные реализации.
      // Сейчас просто сигнализируем что секция была проигнорирована —
      // это партиальный билд, не отказ.
      warnings.push(`section_${section.type}_not_implemented`);
      continue;
    }

    // section.type === 'common' — обходим слоты по очереди.
    for (let slotIdx = 0; slotIdx < section.slots.length; slotIdx++) {
      const slotType = section.slots[slotIdx];
      const pageIndex = pageInstances.length;
      const position: SlotPosition = pageIndex % 2 === 0 ? 'left' : 'right';

      const fill = tryFillSlot(slotType, available, position);
      if (!fill) {
        // Цепочка не нашла подходящего мастера — пропускаем слот.
        // Партнёр заменит мастер в редакторе через TemplatePickerModal.
        warnings.push(
          `slot_skipped: section #${sIdx} slot #${slotIdx} (${slotType}) — недостаточно общих фото`,
        );
        continue;
      }

      const master = bundle.mastersByName.get(fill.master_name);
      if (!master) {
        // Мастер выбран цепочкой, но отсутствует в template_set дизайна.
        // Это либо проблема дизайна (мастер не загружен), либо дрейф имён
        // (slot-chains возвращают имя, которого нет в IDML). Не падаем —
        // warning + пропуск слота. Партнёр увидит warning в UI.
        warnings.push(
          `master_not_found: '${fill.master_name}' (slot ${slotType}) ` +
            `отсутствует в template_set дизайна`,
        );
        continue;
      }

      // Вычитаем потреблённые фото из пула.
      // Перебираем явно по 4 категориям — короче чем for-in по keyof
      // (target=es5, ограничения downlevelIteration). Каждое consumes
      // содержит максимум 1 поле (см. shared.tryStep), но устойчиво
      // и к гипотетическим многокатегорийным мастерам.
      if (fill.consumes.full_class)
        available.full_class -= fill.consumes.full_class;
      if (fill.consumes.half_class)
        available.half_class -= fill.consumes.half_class;
      if (fill.consumes.quarter) available.quarter -= fill.consumes.quarter;
      if (fill.consumes.sixth) available.sixth -= fill.consumes.sixth;

      // Создаём страницу. bindings пока пустые — мапинг фото на labels
      // мастера придёт в РЭ.21.8.4.
      pageInstances.push({
        master_id: master.id,
        bindings: {},
      });

      decisionTrace.push({
        spread_index: Math.floor(pageIndex / 2),
        section_index: sIdx,
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

  // 5. Группировка страниц в SpreadInstance. Пары (0,1), (2,3), ...;
  // если общее число страниц нечётное — последний разворот содержит
  // только left (без right).
  const spreads: SpreadInstance[] = [];
  for (let i = 0; i < pageInstances.length; i += 2) {
    spreads.push({
      spread_index: Math.floor(i / 2),
      left: pageInstances[i],
      right: i + 1 < pageInstances.length ? pageInstances[i + 1] : undefined,
    });
  }

  // 6. Статус: ok если нет warnings, partial если есть (но какие-то
  // страницы получились), failed — только при section_structure=NULL.
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
