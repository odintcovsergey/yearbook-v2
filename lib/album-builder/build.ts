/**
 * buildAlbum — главный entry point движка автовёрстки.
 *
 * В подэтапе 0.10a реализована только ученическая секция для трёх layflat-
 * комплектаций (Стандарт/Универсал/Максимум). Остальное появится позднее:
 *
 * - 0.10b — учительский раздел (F+G), Медиум
 * - 0.11  — soft-intro (S-Intro), Лайт/Мини/Индивидуальный
 * - 0.12  — Vitest unit tests
 * - 0.13  — POST `/api/layout?action=build_album`
 *
 * Общий раздел (J-* мастера) НЕ генерируется автоматически — это архитектурное
 * решение фазы 0 (см. `docs/templates/idml-recon-notes.md` §9). Партнёр
 * добавит J-разворота вручную в редакторе фаз 2-4.
 */

import type {
  AlbumInput,
  BuildResult,
  BuildContext,
  Config,
  Student,
} from './types';
import {
  SCENARIOS_LAYFLAT,
  type StudentSection,
} from './scenarios';
import { findMaster } from './find-master';
import { chunk, pushWarning } from './utils';

export function buildAlbum(input: AlbumInput, config: Config): BuildResult {
  if (input.template_set_id !== config.template_set.id) {
    throw new Error(
      `template_set_id mismatch: input=${input.template_set_id}, config=${config.template_set.id}`,
    );
  }

  const ctx: BuildContext = {
    input,
    config,
    spreads: [],
    warnings: [],
    spreadCounter: { value: 0 },
  };

  const scenario = SCENARIOS_LAYFLAT[config.config_type];
  if (!scenario) {
    pushWarning(ctx, {
      code: 'master_not_found',
      detail: `scenario not defined for config_type=${config.config_type} in SCENARIOS_LAYFLAT`,
    });
    return { spreads: ctx.spreads, warnings: ctx.warnings };
  }
  if (scenario.print_type !== config.print_type) {
    pushWarning(ctx, {
      code: 'master_not_found',
      detail: `print_type mismatch: scenario=${scenario.print_type}, config=${config.print_type}`,
    });
    return { spreads: ctx.spreads, warnings: ctx.warnings };
  }

  if (input.students.length === 0) {
    pushWarning(ctx, {
      code: 'students_empty',
      detail: 'AlbumInput.students is empty',
    });
    return { spreads: ctx.spreads, warnings: ctx.warnings };
  }

  // [SOFT-INTRO]  — будет в 0.11
  // [TEACHERS]    — будет в 0.10b
  buildStudentsSection(ctx, scenario.student_section);
  // [COMMON]      — НЕ генерируется (idml-recon §9)

  return { spreads: ctx.spreads, warnings: ctx.warnings };
}

function buildStudentsSection(ctx: BuildContext, section: StudentSection): void {
  const mode = section.right_filter_mode;
  if (mode === undefined) {
    buildStandardStudents(ctx, section);
  } else if (mode === 'alternate') {
    buildUniversalStudents(ctx, section);
  } else if (mode === 'paired') {
    buildMaximumStudents(ctx, section);
  } else {
    pushWarning(ctx, {
      code: 'master_not_found',
      detail: `unknown right_filter_mode=${String(mode)}`,
    });
  }
}

/**
 * Стандарт — один двухстраничный мастер (E-Student-Standard) на пару учеников.
 * При нечётном числе последний идёт на левую половину последнего разворота,
 * правая остаётся пустой → warning `students_odd_in_standard` (degraded mode,
 * см. master-cleanup-tz §A4).
 */
function buildStandardStudents(ctx: BuildContext, section: StudentSection): void {
  const r = findMaster(ctx.config.template_set.spreads, section.student_master_filter);
  if (!r.ok) {
    pushWarning(ctx, {
      code: 'master_not_found',
      detail: `standard student master: page_role=${section.student_master_filter.page_role} applies_to=${section.student_master_filter.applies_to_config}`,
    });
    return;
  }
  if (r.warning) pushWarning(ctx, r.warning);
  const master = r.master;

  const pairs = chunk(ctx.input.students, 2);
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    const data: Record<string, string | null> = {
      studentPortrait_left: pair[0].portrait,
      studentName_left: pair[0].full_name,
      studentQuote_left: pair[0].quote,
    };
    if (pair.length === 2) {
      data.studentPortrait_right = pair[1].portrait;
      data.studentName_right = pair[1].full_name;
      data.studentQuote_right = pair[1].quote;
    } else {
      data.studentPortrait_right = null;
      data.studentName_right = null;
      data.studentQuote_right = null;
      pushWarning(ctx, {
        code: 'students_odd_in_standard',
        detail: `student ${pair[0].full_name} is alone on right page; partner should add J-Half/J-ClassPhoto/J-Collage manually in editor (см. master-cleanup-tz §A4)`,
      });
    }
    ctx.spreads.push({
      spread_index: ctx.spreadCounter.value++,
      template_id: master.id,
      template_name: master.name,
      data,
    });
  }
}

/**
 * Универсал — чередование одностраничных E-Student-Left / E-Student-Right
 * (по чётности индекса ученика).
 */
function buildUniversalStudents(ctx: BuildContext, section: StudentSection): void {
  const filterRight = section.student_master_filter_right;
  if (!filterRight) {
    pushWarning(ctx, {
      code: 'master_not_found',
      detail: "universal scenario requires student_master_filter_right",
    });
    return;
  }

  const left = findMaster(ctx.config.template_set.spreads, section.student_master_filter);
  const right = findMaster(ctx.config.template_set.spreads, filterRight);
  if (!left.ok) {
    pushWarning(ctx, {
      code: 'master_not_found',
      detail: `universal student master (left): expected_name_hint=${section.student_master_filter.expected_name_hint ?? '?'}`,
    });
    return;
  }
  if (!right.ok) {
    pushWarning(ctx, {
      code: 'master_not_found',
      detail: `universal student master (right): expected_name_hint=${filterRight.expected_name_hint ?? '?'}`,
    });
    return;
  }
  if (left.warning) pushWarning(ctx, left.warning);
  if (right.warning) pushWarning(ctx, right.warning);

  for (let i = 0; i < ctx.input.students.length; i++) {
    const s = ctx.input.students[i];
    const m = i % 2 === 0 ? left.master : right.master;
    ctx.spreads.push({
      spread_index: ctx.spreadCounter.value++,
      template_id: m.id,
      template_name: m.name,
      data: studentSinglePageData(s, 2),
    });
  }
}

/**
 * Максимум — каждый ученик = пара одностраничных мастеров (E-Max-Left + E-Max-Right).
 * Левая = портрет + имя; правая = 4 фото друзей + цитата (см. idml-recon §5 #9).
 */
function buildMaximumStudents(ctx: BuildContext, section: StudentSection): void {
  const filterRight = section.student_master_filter_right;
  if (!filterRight) {
    pushWarning(ctx, {
      code: 'master_not_found',
      detail: "maximum scenario requires student_master_filter_right",
    });
    return;
  }

  const left = findMaster(ctx.config.template_set.spreads, section.student_master_filter);
  const right = findMaster(ctx.config.template_set.spreads, filterRight);
  if (!left.ok) {
    pushWarning(ctx, {
      code: 'master_not_found',
      detail: `maximum student master (left): expected_name_hint=${section.student_master_filter.expected_name_hint ?? '?'}`,
    });
    return;
  }
  if (!right.ok) {
    pushWarning(ctx, {
      code: 'master_not_found',
      detail: `maximum student master (right): expected_name_hint=${filterRight.expected_name_hint ?? '?'}`,
    });
    return;
  }
  if (left.warning) pushWarning(ctx, left.warning);
  if (right.warning) pushWarning(ctx, right.warning);

  for (let i = 0; i < ctx.input.students.length; i++) {
    const s = ctx.input.students[i];
    ctx.spreads.push({
      spread_index: ctx.spreadCounter.value++,
      template_id: left.master.id,
      template_name: left.master.name,
      data: {
        studentPortrait: s.portrait,
        studentName: s.full_name,
      },
    });
    ctx.spreads.push({
      spread_index: ctx.spreadCounter.value++,
      template_id: right.master.id,
      template_name: right.master.name,
      data: {
        studentPhoto1: s.friend_photos[0] ?? null,
        studentPhoto2: s.friend_photos[1] ?? null,
        studentPhoto3: s.friend_photos[2] ?? null,
        studentPhoto4: s.friend_photos[3] ?? null,
        studentQuote: s.quote,
      },
    });
  }
}

function studentSinglePageData(s: Student, friendSlots: number): Record<string, string | null> {
  const data: Record<string, string | null> = {
    studentPortrait: s.portrait,
    studentName: s.full_name,
    studentQuote: s.quote,
  };
  for (let i = 0; i < friendSlots; i++) {
    data['studentPhoto' + (i + 1)] = s.friend_photos[i] ?? null;
  }
  return data;
}
