/**
 * РЭ.20.6.3: Генератор правил общего раздела из дизайнерской матрицы.
 *
 * Источник: docs/templates/album-structure-matrix.json (28 entries).
 * Выход:   docs/rule-engine-data/rules/common-section/generated/*.json.
 *
 * Шаблон правила — общий для всех генерируемых:
 *   - family_id        = 'common-section'
 *   - family_version   = '1.0'
 *   - priority         = 230 (mandatory) или 210 (additional)
 *   - when             = preset_density + preset_sheet_type + students_count
 *                        + mandatory_section.current_index (для mandatory)
 *                        + наличие фотоматериала (gte)
 *   - produces / bind  = по типу PagePattern (см. PATTERN_TO_PRODUCES ниже)
 *   - consumes         = pages: 2 + mandatory_section.pages: 1 (или additional)
 *                        + common_photos.X: N в зависимости от паттерна.
 *
 * Резолв альтернатив:
 *   Каждая опция alternative ячейки → отдельное правило с разным
 *   приоритетом (sixth_six > half_pair > full_one > quarter_pair).
 *   Это соответствует resolveAlternative из album-structure-matrix.ts
 *   и спецификации phase-Р20-spec.md §2.3.
 *
 * Известные ограничения (фиксируем в РЭ.20.6.4 или позже):
 *   - students.parity entries (4 шт. Standard/Universal hard/soft)
 *     пропускаются — нет оператора WHEN для чётности. Будут обработаны
 *     либо custom-операторами, либо explicit students-ranges.
 *   - personal_final ячейки (последний разворот student-section,
 *     отдельная семантика) — НЕ генерируются. Их обработает РЭ.20.6.5
 *     или ручные правила student-section.
 *
 * Запуск:
 *   npx tsx scripts/generate-rules-from-matrix.ts           # dry-run, печатает что бы сгенерил
 *   npx tsx scripts/generate-rules-from-matrix.ts --write   # запись в repo
 */

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  allMatrixEntries,
  mandatorySectionPatternsFor,
  additionalSectionPatternsFor,
  type MatrixEntry,
  type MatrixDensity,
} from '../lib/rule-engine/album-structure-matrix';
import type { PagePattern, PresetDensity, SheetType } from '../lib/rule-engine/types';

const GENERATED_DIR = join(
  process.cwd(),
  'docs',
  'rule-engine-data',
  'rules',
  'common-section',
  'generated',
);

// =============================================================================
// 1. Шаблоны produces / bind / consumes для каждого PagePattern.type
// =============================================================================

interface PatternTemplate {
  /** Производит spread с двумя мастерами. */
  left_master: string;
  right_master: string;
  /** Bind для каждой стороны. left/right одинаковая семантика. */
  left_bind: Record<string, unknown>;
  right_bind: Record<string, unknown>;
  /** Сколько common_photos потребляет. */
  consumes_common_photos: Record<string, number>;
  /** Минимум фото нужно чтобы when сматчил. */
  required_count: Record<string, number>;
  /** Человекочитаемое имя паттерна для display_name. */
  display_label: string;
  /** Приоритет внутри 230/210 — выше у более «крупного» материала. */
  priority_offset: number;
}

const PATTERN_TEMPLATES: Record<
  Exclude<PagePattern, { type: 'alternative' }>['type'],
  PatternTemplate
> = {
  half_pair: {
    left_master: 'J-Half',
    right_master: 'J-Half',
    left_bind: {
      halfphoto_1: 'input.common_photos.half_class[$consumed_half_class]',
      halfphoto_2: 'input.common_photos.half_class[$consumed_half_class + 1]',
    },
    right_bind: {
      halfphoto_1: 'input.common_photos.half_class[$consumed_half_class + 2]',
      halfphoto_2: 'input.common_photos.half_class[$consumed_half_class + 3]',
    },
    consumes_common_photos: { half_class: 4 },
    required_count: { half_class: 4 },
    display_label: 'пара 1/2 класса',
    priority_offset: 2, // 230 + 2 = 232 / 210 + 2 = 212
  },
  quarter_pair: {
    left_master: 'J-Quarter',
    right_master: 'J-Quarter',
    left_bind: {
      quarterphoto_1: 'input.common_photos.quarter[$consumed_quarter]',
      quarterphoto_2: 'input.common_photos.quarter[$consumed_quarter + 1]',
    },
    right_bind: {
      quarterphoto_1: 'input.common_photos.quarter[$consumed_quarter + 2]',
      quarterphoto_2: 'input.common_photos.quarter[$consumed_quarter + 3]',
    },
    consumes_common_photos: { quarter: 4 },
    required_count: { quarter: 4 },
    display_label: 'пара 1/4 класса',
    priority_offset: 0, // 230 / 210 — самый низкий по матрице
  },
  full_one: {
    left_master: 'J-Full',
    right_master: 'J-Full',
    left_bind: {
      classphotoframe: 'input.common_photos.full_class[$consumed_full_class]',
    },
    right_bind: {
      classphotoframe: 'input.common_photos.full_class[$consumed_full_class + 1]',
    },
    consumes_common_photos: { full_class: 2 },
    required_count: { full_class: 2 },
    display_label: '2 общих фото класса',
    priority_offset: 1,
  },
  sixth_six: {
    left_master: 'J-Collage-6',
    right_master: 'J-Collage-6',
    // Bind с range — берём 6 фото на сторону, по шаблону common-section-sixth-pair.json.
    left_bind: {
      'collagephoto_{i}': {
        template: 'input.common_photos.sixth[$consumed_sixth + {i} - 1]',
        params: { i: { range: [1, 6] } },
      },
    },
    right_bind: {
      'collagephoto_{i}': {
        template: 'input.common_photos.sixth[$consumed_sixth + 6 + {i} - 1]',
        params: { i: { range: [1, 6] } },
      },
    },
    consumes_common_photos: { sixth: 12 },
    required_count: { sixth: 12 },
    display_label: 'коллаж 12 фото 1/6',
    priority_offset: 3, // самый высокий — матрица предпочитает sixth_six
  },
};

// =============================================================================
// 2. Маппинг MatrixDensity → PresetDensity[] (для when)
// =============================================================================

// 'standard_universal' покрывает 2 пресета — генерим 2 правила.
function densityWhenValues(d: MatrixDensity): PresetDensity[] {
  if (d === 'standard_universal') return ['standard', 'universal'];
  return [d];
}

// =============================================================================
// 3. Конструктор одного правила
// =============================================================================

interface BuildRuleArgs {
  /** Категория правил. */
  kind: 'mandatory' | 'additional';
  /** Позиция страницы внутри секции (mandatory или additional). */
  pageIndex: number;
  /** PresetDensity (один из mini/light/medium/standard/universal). */
  presetDensity: PresetDensity;
  /** SheetType (hard или soft). */
  sheetType: SheetType;
  /** Диапазоны учеников из entry.students.ranges. */
  studentsRanges: Array<{ min: number; max: number }>;
  /** PagePattern (НЕ alternative). */
  pattern: Exclude<PagePattern, { type: 'alternative' }>;
  /** Опциональный суффикс для уникальности id (когда несколько правил
   *  для одной (density, sheet, page) — например из alternative). */
  optionSuffix?: string;
  /** Индекс entry в матрице (для трейсинга в id). */
  entryIndex: number;
}

function buildRule(args: BuildRuleArgs): Record<string, unknown> {
  const tpl = PATTERN_TEMPLATES[args.pattern.type];
  const basePriority = args.kind === 'mandatory' ? 230 : 210;
  const priority = basePriority + tpl.priority_offset;

  // ID правила: общий стиль common-{mandatory|additional}-{density}-{sheet}-page-{N}-{pattern}-e{idx}[-opt-{suffix}]
  const idParts = [
    'common',
    args.kind,
    args.presetDensity,
    args.sheetType,
    `page-${args.pageIndex}`,
    args.pattern.type.replace('_', '-'),
    `e${args.entryIndex}`,
  ];
  if (args.optionSuffix) idParts.push(`opt-${args.optionSuffix}`);
  const id = idParts.join('-');

  // when:
  //  preset_density / preset_sheet_type — обязательные.
  //  students_count — диапазон. Если ranges одна — between [min,max].
  //                   Если несколько — оператор 'in' через ручной expand —
  //                   но 'in' с range списком не поддерживается. Просто
  //                   возьмём union of ranges как between [min(all), max(all)]
  //                   с warning'ом. Реальные матричные данные обычно
  //                   состоят из 1 интервала, либо 2 явно непересекающихся;
  //                   в последнем случае генерим 2 правила (отдельная задача —
  //                   см. expandRangesToRules ниже).
  //  mandatory_section.current_index — только для mandatory правил.
  //  required common_photos.X.count: { gte: N } — наличие фотоматериала.
  const when: Record<string, unknown> = {
    preset_density: args.presetDensity,
    preset_sheet_type: args.sheetType,
  };

  // students_count: единый диапазон если 1 range.
  if (args.studentsRanges.length === 1) {
    when['students_count'] = {
      between: [args.studentsRanges[0].min, args.studentsRanges[0].max],
    };
  } else {
    // Несколько ranges → unionRange. Помечаем в description что точное
    // соответствие будет в РЭ.20.6.4 (когда добавим custom оператор `in_ranges`).
    const min = Math.min(...args.studentsRanges.map((r) => r.min));
    const max = Math.max(...args.studentsRanges.map((r) => r.max));
    when['students_count'] = { between: [min, max] };
  }

  if (args.kind === 'mandatory') {
    when['mandatory_section.current_index'] = args.pageIndex;
  }
  // Требование к фотоматериалу
  for (const [cat, n] of Object.entries(tpl.required_count)) {
    when[`common_photos.${cat}.count`] = { gte: n };
  }

  // consumes
  const consumes: Record<string, unknown> = {
    common_photos: { ...tpl.consumes_common_photos },
    pages: 2,
  };
  if (args.kind === 'mandatory') {
    consumes['mandatory_section'] = { pages: 1 };
  }

  // display_name + description
  const sheetLabel = args.sheetType === 'soft' ? 'мягкие' : 'плотные';
  const densityLabel: Record<PresetDensity, string> = {
    standard: 'Стандарт',
    universal: 'Универсал',
    medium: 'Медиум',
    light: 'Лайт',
    mini: 'Мини',
  };
  const kindLabel = args.kind === 'mandatory' ? 'обязательный' : 'дополнительный';
  const optionTail = args.optionSuffix ? ` (опция ${args.optionSuffix})` : '';
  const display_name =
    `Общий раздел (${kindLabel}): ${densityLabel[args.presetDensity]} ` +
    `${sheetLabel}, страница ${args.pageIndex} — ${tpl.display_label}${optionTail}`;
  const description =
    `Авто-сгенерировано из docs/templates/album-structure-matrix.json ` +
    `entry #${args.entryIndex} (РЭ.20.6.3). Матрица: ` +
    `${args.presetDensity} × ${args.sheetType}, ` +
    `students ${JSON.stringify(args.studentsRanges)}. ` +
    `${args.kind}_section_pages[${args.pageIndex}] = ${args.pattern.type}` +
    (args.optionSuffix
      ? `. Эта опция выбрана из alternative по приоритету наличия фотоматериала.`
      : `.`);

  return {
    id,
    family_id: 'common-section',
    family_version: '1.0',
    priority,
    display_name,
    description,
    when,
    produces: {
      type: 'spread',
      left_master: tpl.left_master,
      right_master: tpl.right_master,
    },
    bind: {
      left_master: tpl.left_bind,
      right_master: tpl.right_bind,
    },
    consumes,
  };
}

// =============================================================================
// 4. Раскрытие PagePattern (с учётом alternative) в массив рабочих паттернов
// =============================================================================

function expandPattern(p: PagePattern): Array<{
  pattern: Exclude<PagePattern, { type: 'alternative' }>;
  optionSuffix?: string;
}> {
  if (p.type !== 'alternative') return [{ pattern: p }];
  // В реальной матрице alternatives не вложены — фильтруем для type safety.
  // options содержит только базовые паттерны (half_pair, quarter_pair, full_one, sixth_six).
  const basicOptions = p.options.filter(
    (o): o is Exclude<PagePattern, { type: 'alternative' }> => o.type !== 'alternative',
  );
  // Сортируем по priority_offset DESC — более «крупный» материал имеет
  // больший приоритет. Соответствует resolveAlternative.
  const sorted = [...basicOptions].sort(
    (a, b) =>
      PATTERN_TEMPLATES[b.type].priority_offset -
      PATTERN_TEMPLATES[a.type].priority_offset,
  );
  return sorted.map((opt) => ({
    pattern: opt,
    optionSuffix: opt.type.replace('_', '-'),
  }));
}

// =============================================================================
// 5. Главный цикл — генерация по всем entries
// =============================================================================

interface GenerationStats {
  entriesProcessed: number;
  entriesSkippedParity: number;
  rulesGenerated: number;
  filesWritten: number;
}

function generate(write: boolean): GenerationStats {
  const stats: GenerationStats = {
    entriesProcessed: 0,
    entriesSkippedParity: 0,
    rulesGenerated: 0,
    filesWritten: 0,
  };

  const entries = allMatrixEntries();
  const allRules: Array<{ id: string; data: Record<string, unknown> }> = [];

  for (let entryIdx = 0; entryIdx < entries.length; entryIdx++) {
    const entry: MatrixEntry = entries[entryIdx];

    // Skip parity entries (Standard/Universal) — см. ограничения в шапке.
    if (entry.students.parity) {
      stats.entriesSkippedParity++;
      continue;
    }
    if (!entry.students.ranges || entry.students.ranges.length === 0) continue;
    stats.entriesProcessed++;

    // Для каждой PresetDensity (standard_universal даёт 2)
    for (const presetDensity of densityWhenValues(entry.density)) {
      // Mandatory pages
      const mandatoryPatterns = mandatorySectionPatternsFor(entry);
      for (let pageIdx = 0; pageIdx < mandatoryPatterns.length; pageIdx++) {
        const opts = expandPattern(mandatoryPatterns[pageIdx]);
        for (const opt of opts) {
          const rule = buildRule({
            kind: 'mandatory',
            pageIndex: pageIdx,
            presetDensity,
            sheetType: entry.sheet_type,
            studentsRanges: entry.students.ranges,
            pattern: opt.pattern,
            optionSuffix: opt.optionSuffix,
            entryIndex: entryIdx,
          });
          allRules.push({ id: rule.id as string, data: rule });
          stats.rulesGenerated++;
        }
      }

      // Additional pages
      const additionalPatterns = additionalSectionPatternsFor(entry);
      for (let pageIdx = 0; pageIdx < additionalPatterns.length; pageIdx++) {
        const opts = expandPattern(additionalPatterns[pageIdx]);
        for (const opt of opts) {
          const rule = buildRule({
            kind: 'additional',
            pageIndex: pageIdx,
            presetDensity,
            sheetType: entry.sheet_type,
            studentsRanges: entry.students.ranges,
            pattern: opt.pattern,
            optionSuffix: opt.optionSuffix,
            entryIndex: entryIdx,
          });
          allRules.push({ id: rule.id as string, data: rule });
          stats.rulesGenerated++;
        }
      }
    }
  }

  // Дедупликация по id (если два entries дали одно и то же правило).
  const dedup = new Map<string, Record<string, unknown>>();
  for (const r of allRules) {
    if (!dedup.has(r.id)) dedup.set(r.id, r.data);
  }
  const finalRules = Array.from(dedup.entries()).map(([id, data]) => ({ id, data }));

  // Write step
  if (write) {
    // Очистим целевую папку (это «output» генератора, мы её владеем).
    if (existsSync(GENERATED_DIR)) {
      const existing = readdirSync(GENERATED_DIR);
      for (const f of existing) {
        if (f.endsWith('.json')) rmSync(join(GENERATED_DIR, f));
      }
    } else {
      mkdirSync(GENERATED_DIR, { recursive: true });
    }
    for (const r of finalRules) {
      const path = join(GENERATED_DIR, `${r.id}.json`);
      writeFileSync(path, JSON.stringify(r.data, null, 2) + '\n', 'utf-8');
      stats.filesWritten++;
    }
  }

  return stats;
}

// =============================================================================
// 6. CLI
// =============================================================================

const args = process.argv.slice(2);
const write = args.includes('--write');

console.log(`generate-rules-from-matrix: ${write ? 'WRITE' : 'dry-run'} mode`);
const stats = generate(write);
console.log(`  entries processed:       ${stats.entriesProcessed}`);
console.log(`  entries skipped (parity): ${stats.entriesSkippedParity}`);
console.log(`  rules generated:         ${stats.rulesGenerated}`);
if (write) {
  console.log(`  files written:           ${stats.filesWritten}`);
  console.log(`  → ${GENERATED_DIR}`);
} else {
  console.log(`  (use --write to persist to repo)`);
}
