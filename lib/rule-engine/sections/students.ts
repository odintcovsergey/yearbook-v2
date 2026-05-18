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
    case 'light':
    case 'mini':
      // РЭ.21.8.4c
      ctx.warnings.push(
        `students_density_not_implemented_yet: density='${density}' будет в РЭ.21.8.4c`,
      );
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
