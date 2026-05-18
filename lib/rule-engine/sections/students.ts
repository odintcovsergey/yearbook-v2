/**
 * Заполнение секции type='students' для buildFromSectionStructure.
 *
 * Логика выбора режима — по `preset.density` (см. inventory §4):
 *
 *   density     | режим                          | мастера
 *   ────────────┼────────────────────────────────┼────────────────────────────
 *   standard    | 2 ученика на разворот           | E-Student-Standard (is_spread)
 *   universal   | 1 ученик на страницу, alt L/R   | E-Universal-Left / E-Universal-Right
 *   medium      | сетка 4 на страницу             | M-Grid-Page + M-Combined-Page (21.8.4c)
 *   light       | адаптивная сетка 6→4→3→2        | L-Grid-Page + L-N + L-Combined-Page (21.8.4c)
 *   mini        | адаптивная сетка 12→9→6→4       | N-Grid-Page + N-N + N-Combined-Page (21.8.4c)
 *   null/other  | warning students_density_not_supported
 *
 * РЭ.21.8.4b — только Standard + Universal (single-page режимы).
 * РЭ.21.8.4c добавит grid-режимы (Medium / Light / Mini).
 *
 * Maximum / Individual комплектации имеют preset.density=null в БД
 * (см. РЭ.20.5 + рефлексию в master-cleanup-tz.md). Они обрабатываются
 * legacy buildAlbum, не новым engine'ом. В этом коммите для них —
 * warning students_density_not_supported.
 *
 * Bindings — placeholder-driven по аналогии с teachers (РЭ.21.8.4a).
 * Поддерживаемые labels:
 *  - studentportrait_left / _right          (Standard двухстраничный)
 *  - studentname_left / _right              (Standard)
 *  - studentquote_left / _right             (Standard)
 *  - studentportrait, studentname, studentquote — без суффикса (Universal)
 *  - studentphoto_N или studentphotoN       — friend photos (Universal)
 *
 * is_spread поведение:
 *  - Для Standard кладём ДВЕ записи pageInstances с одинаковым master_id
 *    и одинаковыми bindings (все labels с суффиксами _left/_right).
 *  - Orchestrator при группировке детектирует через master.is_spread=true
 *    в template_set и ставит SpreadInstance.is_spread=true автоматически.
 *    Adapter layout-to-buildresult.ts берёт только left, отбрасывает right,
 *    редактор показывает один двухстраничный мастер.
 */

import type { SpreadTemplate } from '@/lib/album-builder/types';
import type { RulesStudentInput } from '../types';
import type { SectionFillContext } from './shared';

export function fillStudentsSection(ctx: SectionFillContext): void {
  const density = ctx.bundle.preset.density;

  if (density === null || density === undefined) {
    ctx.warnings.push(
      `students_density_not_supported: preset.density is null ` +
        `(maximum/individual комплектации не покрыты новым engine'ом)`,
    );
    return;
  }

  switch (density) {
    case 'standard':
      buildStandard(ctx);
      return;
    case 'universal':
      buildUniversal(ctx);
      return;
    case 'medium':
      buildGrid(ctx, {
        density: 'medium',
        baseMasterName: 'M-Grid-Page',
        defaultSlots: 4,
        adaptiveTailNames: [],
        combinedMasterName: 'M-Combined-Page',
      });
      return;
    case 'light':
      buildGrid(ctx, {
        density: 'light',
        baseMasterName: 'L-Grid-Page',
        defaultSlots: 6,
        adaptiveTailNames: ['L-2', 'L-3', 'L-4'],
        combinedMasterName: 'L-Combined-Page',
      });
      return;
    case 'mini':
      buildGrid(ctx, {
        density: 'mini',
        baseMasterName: 'N-Grid-Page',
        defaultSlots: 12,
        adaptiveTailNames: ['N-4', 'N-6', 'N-9'],
        combinedMasterName: 'N-Combined-Page',
      });
      return;
  }
}

// ─── Standard: двухстраничный E-Student-Standard ───────────────────────────

function buildStandard(ctx: SectionFillContext): void {
  const master = ctx.bundle.mastersByName.get('E-Student-Standard');
  if (!master) {
    ctx.warnings.push(
      `students_master_not_found: 'E-Student-Standard' отсутствует в template_set дизайна`,
    );
    return;
  }

  const students = ctx.input.students;
  for (let i = 0; i < students.length; i += 2) {
    const left = students[i];
    const right = i + 1 < students.length ? students[i + 1] : null;

    // Bindings содержат labels для ОБЕИХ страниц (с суффиксами _left/_right).
    // Кладём один объект на обе страницы — orchestrator пометит is_spread,
    // adapter возьмёт только left.bindings.
    const bindings = bindStandardPair(master, left, right);

    // Две записи pageInstances с одинаковым master_id (двухстраничный мастер).
    ctx.pageInstances.push({ master_id: master.id, bindings: { ...bindings } });
    ctx.pageInstances.push({ master_id: master.id, bindings: { ...bindings } });

    const pairIdx = Math.floor(i / 2);
    ctx.decisionTrace.push({
      spread_index: Math.floor(ctx.pageInstances.length / 2) - 1,
      section_index: ctx.sectionIndex,
      family_id: 'student-section',
      rule_id: 'standard:E-Student-Standard',
      inputs: {
        density: 'standard',
        pair_index: pairIdx,
        student_left: left.full_name,
        student_right: right ? right.full_name : null,
      },
    });

    if (right === null) {
      ctx.warnings.push(
        `students_odd_in_standard: ученик ${left.full_name} на левой странице один, правая пустая (партнёр заменит мастер вручную)`,
      );
    }
  }
}

// ─── Universal: одностраничные E-Universal-Left / E-Universal-Right ────────

function buildUniversal(ctx: SectionFillContext): void {
  const leftMaster = ctx.bundle.mastersByName.get('E-Universal-Left');
  const rightMaster = ctx.bundle.mastersByName.get('E-Universal-Right');

  if (!leftMaster) {
    ctx.warnings.push(
      `students_master_not_found: 'E-Universal-Left' отсутствует в template_set дизайна`,
    );
    return;
  }
  if (!rightMaster) {
    ctx.warnings.push(
      `students_master_not_found: 'E-Universal-Right' отсутствует в template_set дизайна`,
    );
    return;
  }

  const students = ctx.input.students;
  for (let i = 0; i < students.length; i++) {
    const student = students[i];
    const position: 'left' | 'right' = i % 2 === 0 ? 'left' : 'right';
    const master = position === 'left' ? leftMaster : rightMaster;

    const bindings = bindUniversalSingle(master, student);

    ctx.pageInstances.push({ master_id: master.id, bindings });

    ctx.decisionTrace.push({
      spread_index: Math.floor((ctx.pageInstances.length - 1) / 2),
      section_index: ctx.sectionIndex,
      family_id: 'student-section',
      rule_id: `universal:${master.name}`,
      inputs: {
        density: 'universal',
        student_index: i,
        student_name: student.full_name,
        position,
        friend_photos_count: student.friend_photos ? student.friend_photos.length : 0,
      },
    });
  }
}

// ─── Bindings ──────────────────────────────────────────────────────────────

/**
 * Bindings для двухстраничного E-Student-Standard.
 *
 * Поддерживаемые labels (placeholder-driven):
 *   studentportrait_left / studentportrait_right
 *   studentname_left / studentname_right
 *   studentquote_left / studentquote_right
 *
 * Правая страница (right=null для нечётного хвоста) → labels _right
 * пишутся как null (Konva canvas скроет placeholder).
 */
function bindStandardPair(
  master: SpreadTemplate,
  left: RulesStudentInput,
  right: RulesStudentInput | null,
): Record<string, unknown> {
  const bindings: Record<string, unknown> = {};
  for (let i = 0; i < master.placeholders.length; i++) {
    const ph = master.placeholders[i];
    const label = ph.label.toLowerCase();

    // Левая сторона
    if (label === 'studentportrait_left') {
      bindings[ph.label] = left.portrait;
      continue;
    }
    if (label === 'studentname_left') {
      bindings[ph.label] = left.full_name;
      continue;
    }
    if (label === 'studentquote_left') {
      bindings[ph.label] = left.quote ?? null;
      continue;
    }

    // Правая сторона
    if (label === 'studentportrait_right') {
      bindings[ph.label] = right ? right.portrait : null;
      continue;
    }
    if (label === 'studentname_right') {
      bindings[ph.label] = right ? right.full_name : null;
      continue;
    }
    if (label === 'studentquote_right') {
      bindings[ph.label] = right ? (right.quote ?? null) : null;
      continue;
    }
  }
  return bindings;
}

/**
 * Bindings для одностраничного E-Universal-Left / -Right.
 *
 * Поддерживаемые labels:
 *   studentportrait        → student.portrait
 *   studentname            → student.full_name
 *   studentquote           → student.quote
 *   studentphoto_N, studentphotoN, friendphoto_N → student.friend_photos[N-1]
 *     (поддерживаем 3 регекс-конвенции одновременно, как в teachers)
 */
function bindUniversalSingle(
  master: SpreadTemplate,
  student: RulesStudentInput,
): Record<string, unknown> {
  const bindings: Record<string, unknown> = {};
  const friends = student.friend_photos ?? [];

  for (let i = 0; i < master.placeholders.length; i++) {
    const ph = master.placeholders[i];
    const label = ph.label.toLowerCase();

    if (label === 'studentportrait') {
      bindings[ph.label] = student.portrait;
      continue;
    }
    if (label === 'studentname') {
      bindings[ph.label] = student.full_name;
      continue;
    }
    if (label === 'studentquote') {
      bindings[ph.label] = student.quote ?? null;
      continue;
    }

    // Фото с друзьями: разные конвенции имени.
    const friendMatch = label.match(/^(?:studentphoto|friendphoto)_?(\d+)$/);
    if (friendMatch) {
      const n = parseInt(friendMatch[1], 10);
      bindings[ph.label] = friends[n - 1] ?? null;
      continue;
    }
  }
  return bindings;
}

// ─── Grid режимы (Medium / Light / Mini) ───────────────────────────────────

/**
 * Конфиг для одного grid-режима. Имена мастеров — это семантические
 * имена, которые предполагает inventory §4. Реальное наличие в
 * template_set okeybook-default проверим в РЭ.21.8.6 на боевых данных.
 *
 *  - `baseMasterName` — основной сеточный мастер (M/L/N-Grid-Page),
 *    содержит `defaultSlots` ученических placeholder'ов.
 *  - `defaultSlots` — fallback количество слотов, если у мастера нет
 *    `slot_capacity.students`. Используется только если БД-тег не задан.
 *  - `adaptiveTailNames` — упорядоченный (asc по slots) список адаптивных
 *    мастеров для хвоста. Пустой массив для Medium (нет адаптивных).
 *    Для Light: L-2 / L-3 / L-4. Для Mini: N-4 / N-6 / N-9. Берётся
 *    минимально-достаточный по slot_capacity.students (см. pickAdaptiveTail).
 *  - `combinedMasterName` — мастер с N учениками сверху + общее фото снизу,
 *    используется для хвоста когда есть `full_class >= 1`. Потребляет
 *    1 фото full_class.
 */
interface GridConfig {
  density: 'medium' | 'light' | 'mini';
  baseMasterName: string;
  defaultSlots: number;
  adaptiveTailNames: string[];
  combinedMasterName: string;
}

function buildGrid(ctx: SectionFillContext, config: GridConfig): void {
  const baseMaster = ctx.bundle.mastersByName.get(config.baseMasterName);
  if (!baseMaster) {
    ctx.warnings.push(
      `students_master_not_found: '${config.baseMasterName}' отсутствует в template_set дизайна`,
    );
    return;
  }

  const slotsPerPage =
    baseMaster.slot_capacity && typeof baseMaster.slot_capacity.students === 'number'
      ? baseMaster.slot_capacity.students
      : config.defaultSlots;
  if (slotsPerPage < 1) {
    ctx.warnings.push(
      `students_grid_invalid_slots: '${config.baseMasterName}' has slot_capacity.students < 1`,
    );
    return;
  }

  const students = ctx.input.students;
  const total = students.length;
  if (total === 0) return;

  const fullPages = Math.floor(total / slotsPerPage);
  const remainder = total % slotsPerPage;

  // 1. Полные страницы — все на baseMaster
  for (let i = 0; i < fullPages; i++) {
    const slice = students.slice(i * slotsPerPage, (i + 1) * slotsPerPage);
    pushGridPage(
      ctx,
      baseMaster,
      slice,
      slotsPerPage,
      `${config.density}:grid:${i}`,
    );
  }

  if (remainder === 0) return;

  // 2. Хвост — три варианта: combined / adaptive / base с null'ями
  const tail = students.slice(fullPages * slotsPerPage);

  // 2a. Combined-page (если есть свободное full_class фото)
  if (ctx.available.full_class >= 1) {
    const combined = ctx.bundle.mastersByName.get(config.combinedMasterName);
    if (combined) {
      const combSlots =
        combined.slot_capacity && typeof combined.slot_capacity.students === 'number'
          ? combined.slot_capacity.students
          : remainder;
      if (combSlots >= remainder) {
        pushCombinedTailPage(ctx, combined, tail, combSlots, config.density);
        // ctx.available.full_class декрементится внутри pushCombinedTailPage
        // (через формулу used = arr.length - available, важен порядок).
        return;
      }
    }
  }

  // 2b. Адаптивный мастер (L-2/3/4, N-4/6/9)
  if (config.adaptiveTailNames.length > 0) {
    const adaptive = pickAdaptiveTail(
      ctx.bundle.mastersByName,
      config.adaptiveTailNames,
      remainder,
    );
    if (adaptive) {
      pushGridPage(
        ctx,
        adaptive.master,
        tail,
        adaptive.slots,
        `${config.density}:adaptive_tail:${adaptive.master.name}`,
      );
      return;
    }
  }

  // 2c. Fallback — base-мастер с null'ями
  pushGridPage(
    ctx,
    baseMaster,
    tail,
    slotsPerPage,
    `${config.density}:tail_padded`,
  );
  ctx.warnings.push(
    `students_grid_tail_padded: остаток ${remainder} учеников вместился в ${slotsPerPage}-слотный ${config.baseMasterName} с null-заполнением`,
  );
}

/**
 * Выбирает минимально-достаточного адаптивного мастера для остатка.
 *
 * Параметры:
 *  - `names` — кандидаты в порядке возрастания slots (например ['L-2','L-3','L-4']).
 *  - `remainder` — количество учеников в хвосте.
 *
 * Алгоритм: собираем кандидатов с известным slot count, фильтруем по
 * `slots >= remainder`, берём минимальный по slots. Slot count берётся
 * из `master.slot_capacity.students` или парсится из имени (`L-N` → N).
 * Если ни один кандидат не подходит — null (caller сделает другой fallback).
 */
function pickAdaptiveTail(
  mastersByName: ReadonlyMap<string, SpreadTemplate>,
  names: string[],
  remainder: number,
): { master: SpreadTemplate; slots: number } | null {
  const candidates: Array<{ master: SpreadTemplate; slots: number }> = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const m = mastersByName.get(name);
    if (!m) continue;
    let slots: number;
    if (m.slot_capacity && typeof m.slot_capacity.students === 'number') {
      slots = m.slot_capacity.students;
    } else {
      const parsed = slotsFromName(name);
      if (parsed === null) continue;
      slots = parsed;
    }
    if (slots > 0) candidates.push({ master: m, slots });
  }
  const fits = candidates.filter((c) => c.slots >= remainder);
  if (fits.length === 0) return null;
  fits.sort((a, b) => a.slots - b.slots);
  return fits[0];
}

/**
 * Парсит количество слотов из имени мастера вида `L-N` / `N-N` (где N — число).
 * Возвращает null если формат не подходит (например `L-Grid-Page`).
 */
function slotsFromName(name: string): number | null {
  const m = name.match(/^[A-Z]-(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Положить grid-страницу: формирует bindings (studentportrait_N + name + quote),
 * добавляет PageInstance и decision_trace.
 */
function pushGridPage(
  ctx: SectionFillContext,
  master: SpreadTemplate,
  students: RulesStudentInput[],
  slotsPerPage: number,
  ruleId: string,
): void {
  const bindings = bindGridStudents(master, students, slotsPerPage);
  ctx.pageInstances.push({ master_id: master.id, bindings });
  const pageIndex = ctx.pageInstances.length - 1;
  ctx.decisionTrace.push({
    spread_index: Math.floor(pageIndex / 2),
    section_index: ctx.sectionIndex,
    family_id: 'student-section',
    rule_id: ruleId,
    inputs: {
      master_name: master.name,
      students_on_page: students.length,
      slots_per_page: slotsPerPage,
      page_position: pageIndex % 2 === 0 ? 'left' : 'right',
    },
  });
}

/**
 * Положить combined-tail страницу: bindings grid + classphotoframe (общее фото),
 * декремент ctx.available.full_class. Порядок важен: bindings ДО decrement,
 * чтобы used-index был корректным.
 */
function pushCombinedTailPage(
  ctx: SectionFillContext,
  master: SpreadTemplate,
  students: RulesStudentInput[],
  slotsPerPage: number,
  density: GridConfig['density'],
): void {
  // Сначала grid-bindings (без classphotoframe — он добавляется ниже).
  const bindings = bindGridStudents(master, students, slotsPerPage);

  // classphotoframe — берём первое ещё не потреблённое фото full_class.
  const fullClassUsed =
    ctx.input.common_photos.full_class.length - ctx.available.full_class;
  const fullClassPhoto = ctx.input.common_photos.full_class[fullClassUsed];
  for (let i = 0; i < master.placeholders.length; i++) {
    const ph = master.placeholders[i];
    if (ph.label.toLowerCase() === 'classphotoframe') {
      if (fullClassPhoto) bindings[ph.label] = fullClassPhoto;
      break;
    }
  }

  // Потребление — ПОСЛЕ bindings (см. doc-комментарий функции).
  ctx.available.full_class -= 1;

  ctx.pageInstances.push({ master_id: master.id, bindings });
  const pageIndex = ctx.pageInstances.length - 1;
  ctx.decisionTrace.push({
    spread_index: Math.floor(pageIndex / 2),
    section_index: ctx.sectionIndex,
    family_id: 'student-section',
    rule_id: `${density}:combined_tail:${master.name}`,
    inputs: {
      master_name: master.name,
      students_on_page: students.length,
      slots_per_page: slotsPerPage,
      consumes: { full_class: 1 },
    },
  });
}

/**
 * Bindings для grid-мастера (M/L/N-Grid-Page и адаптивных L-N / N-N).
 *
 * Поддерживаемые labels (placeholder-driven):
 *   studentportrait_N → students[N-1].portrait
 *   studentname_N     → students[N-1].full_name
 *   studentquote_N    → students[N-1].quote
 *
 * Слоты с индексом > students.length — null (Konva canvas скроет
 * placeholder через __hidden__N логику фазы Л/М).
 *
 * classphotoframe (для combined-pages) обрабатывается в pushCombinedTailPage,
 * не здесь.
 */
function bindGridStudents(
  master: SpreadTemplate,
  students: RulesStudentInput[],
  _slotsPerPage: number,
): Record<string, unknown> {
  const bindings: Record<string, unknown> = {};
  for (let i = 0; i < master.placeholders.length; i++) {
    const ph = master.placeholders[i];
    const label = ph.label.toLowerCase();

    const portraitMatch = label.match(/^studentportrait_(\d+)$/);
    if (portraitMatch) {
      const n = parseInt(portraitMatch[1], 10);
      const s = students[n - 1];
      bindings[ph.label] = s ? s.portrait : null;
      continue;
    }
    const nameMatch = label.match(/^studentname_(\d+)$/);
    if (nameMatch) {
      const n = parseInt(nameMatch[1], 10);
      const s = students[n - 1];
      bindings[ph.label] = s ? s.full_name : null;
      continue;
    }
    const quoteMatch = label.match(/^studentquote_(\d+)$/);
    if (quoteMatch) {
      const n = parseInt(quoteMatch[1], 10)
      const s = students[n - 1];
      bindings[ph.label] = s ? (s.quote ?? null) : null;
      continue;
    }
  }
  return bindings;
}
