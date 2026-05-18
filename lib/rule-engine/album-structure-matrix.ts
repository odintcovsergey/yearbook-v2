/**
 * РЭ.20.4: Модуль для работы с дизайнерской матрицей структуры альбома.
 *
 * Источник данных: docs/templates/album-structure-matrix.json (28 entries),
 * сконвертирован из дизайнерского xlsx (Сергей, 18.05.2026).
 *
 * Модуль предоставляет:
 *   - `findMatrixEntry(density, sheet_type, students_count)` — поиск
 *     строки матрицы для пресета+альбома.
 *   - `parseCellToPattern(cell)` — конвертация одной ячейки матрицы
 *     (строка на русском) в типизированный `PagePattern`.
 *   - `mandatorySectionPatternsFor(entry)` / `additionalSectionPatternsFor(entry)`
 *     — извлечение массива PagePattern из строки матрицы.
 *
 * Семантика отсутствующих случаев:
 *   - Если для (density, sheet_type, students_count) нет строки в матрице
 *     → null. Caller (buildContext) НЕ заполняет mandatory_section —
 *     остаётся undefined, build engine падает на legacy-правила.
 *   - Если ячейка не распознана парсером (новая формулировка, опечатка)
 *     → null. Caller трактует как «пропустить страницу».
 *
 * Связь с типами:
 *   - PagePattern из lib/rule-engine/types.ts (РЭ.20.3).
 *   - PresetDensity / SheetType из lib/rule-engine/types.ts (РЭ.20.3).
 */

import matrixJson from '../../docs/templates/album-structure-matrix.json';
import type { PagePattern, PresetDensity, SheetType } from './types';

// =============================================================================
// 1. Типизация JSON-матрицы
// =============================================================================

/**
 * Категория плотности в матрице. Отличается от PresetDensity тем, что
 * matrix объединяет 'standard' и 'universal' в один блок 'standard_universal'
 * (правила и для Стандарта, и для Универсала идентичны).
 */
export type MatrixDensity = 'mini' | 'light' | 'medium' | 'standard_universal';

export interface MatrixStudentsRange {
  min: number;
  max: number;
}

export interface MatrixStudentsSelector {
  /** Диапазоны студентов. */
  ranges?: MatrixStudentsRange[];
  /** Альтернатива ranges: чётность. */
  parity?: 'even' | 'odd';
}

export interface MatrixPersonalFinal {
  left: string | null;
  right: string | null;
}

export interface MatrixEntry {
  density: MatrixDensity;
  sheet_type: SheetType;
  students: MatrixStudentsSelector;
  personal_final: MatrixPersonalFinal;
  /** Ячейки обязательного общего раздела (0..6 элементов). */
  mandatory_section_pages: string[];
  /** Ячейки дополнительного общего раздела (0..5 элементов). */
  additional_section_pages: string[];
}

interface MatrixJson {
  source: string;
  date_imported: string;
  version: string;
  description: string;
  entries: MatrixEntry[];
}

const MATRIX = matrixJson as MatrixJson;

// =============================================================================
// 2. Маппинг PresetDensity → MatrixDensity
// =============================================================================

/**
 * Матрица объединяет Standard и Universal в одну категорию (правила идентичны),
 * остальные совпадают 1:1. Для пресетов maximum — матрица не покрывает
 * (фолбэк → return null в findMatrixEntry).
 */
export function presetDensityToMatrix(d: PresetDensity): MatrixDensity {
  if (d === 'standard' || d === 'universal') return 'standard_universal';
  return d;
}

// =============================================================================
// 3. Lookup
// =============================================================================

/**
 * Проверяет, попадает ли studentsCount под селектор students.
 *
 *  - `ranges` — список интервалов [min, max] включительно.
 *  - `parity` — чётность (даёт совпадение для любого студента указанной чётности).
 *  - Если ни ranges, ни parity не заданы — селектор не совпадает (паника-безопасность).
 */
export function matchesStudentsSelector(
  selector: MatrixStudentsSelector,
  studentsCount: number,
): boolean {
  if (selector.ranges && selector.ranges.length > 0) {
    for (let i = 0; i < selector.ranges.length; i++) {
      const r = selector.ranges[i];
      if (studentsCount >= r.min && studentsCount <= r.max) return true;
    }
    return false;
  }
  if (selector.parity === 'even') return studentsCount % 2 === 0;
  if (selector.parity === 'odd') return studentsCount % 2 === 1;
  return false;
}

/**
 * Находит строку матрицы для (density, sheet_type, students_count).
 *
 * Алгоритм:
 *  1. Маппит PresetDensity → MatrixDensity.
 *  2. Перебирает entries, выбирает первую где совпали density, sheet_type
 *     и matchesStudentsSelector.
 *
 * Возвращает null если такой записи нет (например, density='maximum'
 * или экзотический students_count вне всех диапазонов).
 */
export function findMatrixEntry(
  density: PresetDensity,
  sheetType: SheetType,
  studentsCount: number,
): MatrixEntry | null {
  const matrixDensity = presetDensityToMatrix(density);
  for (let i = 0; i < MATRIX.entries.length; i++) {
    const e = MATRIX.entries[i];
    if (e.density !== matrixDensity) continue;
    if (e.sheet_type !== sheetType) continue;
    if (!matchesStudentsSelector(e.students, studentsCount)) continue;
    return e;
  }
  return null;
}

/** Все записи матрицы (для генератора правил РЭ.20.6 и тестов). */
export function allMatrixEntries(): readonly MatrixEntry[] {
  return MATRIX.entries;
}

// =============================================================================
// 4. Парсинг ячеек в PagePattern
// =============================================================================

/**
 * Известные базовые формулировки, нормализованные.
 *
 * Ключ — substring (lowercase), значение — PagePattern (без alternative).
 * Поиск идёт по `includes`, поэтому строка с альтернативами
 * («либо A, либо B») матчится сразу несколько ключей — это и есть
 * семантика alternative.
 */
const BASIC_PATTERN_KEYWORDS: ReadonlyArray<{
  keyword: string;
  pattern: Exclude<PagePattern, { type: 'alternative' }>;
}> = [
  // Порядок имеет значение: проверяем '2 по 1/2' раньше '1/2 класса',
  // '2 по 1/4' раньше '1/4 класса', и т.д.
  { keyword: '2 по 1/2 класса', pattern: { type: 'half_pair' } },
  { keyword: '2 по 1/4 класса', pattern: { type: 'quarter_pair' } },
  { keyword: '6 фото 1/6', pattern: { type: 'sixth_six' } },
  { keyword: '1 общая', pattern: { type: 'full_one' } },
];

/**
 * Парсит одну ячейку матрицы в PagePattern.
 *
 * Логика:
 *  - Если ячейка содержит слово «либо» — это alternative. Сканируем
 *    все базовые keywords и собираем найденные в options.
 *  - Иначе ищем ровно один матчинг базовый pattern.
 *  - Если ничего не нашли — null (caller трактует как «неизвестная ячейка»).
 *
 * Примеры (из реальной матрицы):
 *   '2 по 1/2 класса'                            → { type: 'half_pair' }
 *   '1 общая'                                    → { type: 'full_one' }
 *   'либо 6 фото 1/6, либо 2 по 1/2 класса,
 *    либо 1 общая'                               → { type: 'alternative',
 *                                                   options: [sixth_six, half_pair, full_one] }
 *
 * Ячейки personal_final (например 'до 4 фото учеников + снизу 1 общая')
 * НЕ парсятся этой функцией — для них отдельная семантика, решим в РЭ.20.6.
 */
export function parseCellToPattern(cell: string): PagePattern | null {
  if (!cell || typeof cell !== 'string') return null;

  const lower = cell.toLowerCase();

  // Случай alternative — присутствует «либо» (Cyrillic).
  if (lower.includes('либо')) {
    const options: Exclude<PagePattern, { type: 'alternative' }>[] = [];
    for (let i = 0; i < BASIC_PATTERN_KEYWORDS.length; i++) {
      const { keyword, pattern } = BASIC_PATTERN_KEYWORDS[i];
      if (lower.includes(keyword.toLowerCase())) {
        options.push(pattern);
      }
    }
    if (options.length === 0) return null;
    if (options.length === 1) return options[0];
    return { type: 'alternative', options };
  }

  // Базовый паттерн без альтернатив.
  for (let i = 0; i < BASIC_PATTERN_KEYWORDS.length; i++) {
    const { keyword, pattern } = BASIC_PATTERN_KEYWORDS[i];
    if (lower.includes(keyword.toLowerCase())) return pattern;
  }
  return null;
}

/**
 * Конвертирует ячейки entry.mandatory_section_pages в массив PagePattern.
 *
 * Пропускает ячейки, которые не распознаются (вернёт массив только из
 * успешно распарсенных + warning отдельно — пока без warning, в РЭ.20.6
 * перенесём в decision_trace).
 */
export function mandatorySectionPatternsFor(entry: MatrixEntry): PagePattern[] {
  return parseCellsToPatterns(entry.mandatory_section_pages);
}

export function additionalSectionPatternsFor(entry: MatrixEntry): PagePattern[] {
  return parseCellsToPatterns(entry.additional_section_pages);
}

function parseCellsToPatterns(cells: string[]): PagePattern[] {
  const out: PagePattern[] = [];
  for (let i = 0; i < cells.length; i++) {
    const p = parseCellToPattern(cells[i]);
    if (p) out.push(p);
  }
  return out;
}

// =============================================================================
// 5. Резолв alternative по наличию фотоматериала (для РЭ.20.6).
//    Не используется в РЭ.20.4 — экспортируется как утилита для РЭ.20.6.
// =============================================================================

/**
 * Резолвит paterns alternative в конкретный pattern по приоритету наличия
 * фотоматериала. Приоритет из phase-Р20-spec.md §2.3:
 *   1. ≥6 sixth → sixth_six
 *   2. ≥2 half_class → half_pair
 *   3. ≥1 full_class → full_one
 *   4. ≥2 quarter (если в options) → quarter_pair
 *   5. иначе → null (пустой слот, партнёр заполнит в редакторе)
 *
 * Не-alternative pattern возвращается как есть.
 */
export interface CommonPhotosAvailability {
  sixth: number;
  half_class: number;
  full_class: number;
  quarter: number;
}

export function resolveAlternative(
  pattern: PagePattern,
  available: CommonPhotosAvailability,
): PagePattern | null {
  if (pattern.type !== 'alternative') return pattern;
  const optTypes = new Set(pattern.options.map(o => o.type));
  if (optTypes.has('sixth_six') && available.sixth >= 6) {
    return { type: 'sixth_six' };
  }
  if (optTypes.has('half_pair') && available.half_class >= 2) {
    return { type: 'half_pair' };
  }
  if (optTypes.has('full_one') && available.full_class >= 1) {
    return { type: 'full_one' };
  }
  if (optTypes.has('quarter_pair') && available.quarter >= 2) {
    return { type: 'quarter_pair' };
  }
  return null;
}
