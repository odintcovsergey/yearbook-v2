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
  Subject,
  HeadTeacher,
  SpreadTemplate,
} from './types';
import {
  SCENARIOS_LAYFLAT,
  type StudentSection,
  type TeacherSection,
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

  // [SOFT-INTRO] — будет в 0.11
  if (scenario.teacher_section) {
    if (input.head_teacher) {
      buildTeacherSection(ctx, scenario.teacher_section);
    } else {
      pushWarning(ctx, {
        code: 'no_head_teacher',
        detail: 'head_teacher is null, teacher section skipped',
      });
    }
  }
  buildStudentsSection(ctx, scenario.student_section);
  // [COMMON] — НЕ генерируется (idml-recon §9)

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
      studentportrait_left: pair[0].portrait,
      studentname_left: pair[0].full_name,
      studentquote_left: pair[0].quote,
    };
    if (pair.length === 2) {
      data.studentportrait_right = pair[1].portrait;
      data.studentname_right = pair[1].full_name;
      data.studentquote_right = pair[1].quote;
    } else {
      data.studentportrait_right = null;
      data.studentname_right = null;
      data.studentquote_right = null;
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
        studentportrait: s.portrait,
        studentname: s.full_name,
      },
    });
    ctx.spreads.push({
      spread_index: ctx.spreadCounter.value++,
      template_id: right.master.id,
      template_name: right.master.name,
      data: {
        studentphoto1: s.friend_photos[0] ?? null,
        studentphoto2: s.friend_photos[1] ?? null,
        studentphoto3: s.friend_photos[2] ?? null,
        studentphoto4: s.friend_photos[3] ?? null,
        studentquote: s.quote,
      },
    });
  }
}

function studentSinglePageData(s: Student, friendSlots: number): Record<string, string | null> {
  const data: Record<string, string | null> = {
    studentportrait: s.portrait,
    studentname: s.full_name,
    studentquote: s.quote,
  };
  for (let i = 0; i < friendSlots; i++) {
    data['studentphoto' + (i + 1)] = s.friend_photos[i] ?? null;
  }
  return data;
}

/**
 * Подбор правого учительского мастера для variants 0-8 (без `right_filter`).
 * Логика из `build_album.jsx` (`pickRightPhotoMaster`):
 * 1) `common_photos.half >= 2`        → G-HalfClass
 * 2) `common_photos.full_class >= 1`  → G-FullClass
 * 3) иначе                            → null
 *
 * Внутренние warning'и о fallback/name_mismatch пушатся в ctx, но если мастер
 * не нашёлся в БД — молча идём к следующей ветке. Финальный warning
 * `no_right_teacher_master` пишется в `buildTeacherSection` после возврата `null`.
 */
function pickRightTeacherMaster(ctx: BuildContext): SpreadTemplate | null {
  const cp = ctx.input.common_photos;
  const spreads = ctx.config.template_set.spreads;

  if (cp.half.length >= 2) {
    const r = findMaster(spreads, {
      page_role: 'teacher_right',
      applies_to_config: ctx.config.config_type,
      slot_capacity_min: { photos_half: 2 },
      expected_name_hint: 'G-HalfClass',
    });
    if (r.ok) {
      if (r.warning) pushWarning(ctx, r.warning);
      return r.master;
    }
  }
  if (cp.full_class.length >= 1) {
    const r = findMaster(spreads, {
      page_role: 'teacher_right',
      applies_to_config: ctx.config.config_type,
      slot_capacity_min: { photos_full: 1 },
      expected_name_hint: 'G-FullClass',
    });
    if (r.ok) {
      if (r.warning) pushWarning(ctx, r.warning);
      return r.master;
    }
  }
  return null;
}

/**
 * Сборка учительского раздела (F+G).
 *
 * Шаги:
 *  1. При `subjects.length > 24` — обрезаем до 24 + warning `subjects_overflow`.
 *  2. Поиск variant'а по диапазону.
 *  3. `findMaster` для `left_filter` (F-*). Если не найден — warning + return.
 *  4. Заполняем data левой страницы и пушим SpreadInstance.
 *  5. Для правой:
 *     - `variant.right_filter` задан → `findMaster`
 *     - `undefined` → `pickRightTeacherMaster` (dynamic)
 *  6. Если правый мастер найден — пушим SpreadInstance с правой данными.
 *     Иначе — правую страницу пропускаем (warning уже залогирован).
 */
function buildTeacherSection(ctx: BuildContext, section: TeacherSection): void {
  const head = ctx.input.head_teacher!; // вызывающий buildAlbum проверил выше
  let subjects = ctx.input.subjects;

  if (subjects.length > 24) {
    pushWarning(ctx, {
      code: 'subjects_overflow',
      detail: `subjects.length=${subjects.length} > 24, обрезано до 24 (см. master-cleanup-tz §C1)`,
    });
    subjects = subjects.slice(0, 24);
  }

  const variant = section.variants.find(
    (v) => subjects.length >= v.subjects_min && subjects.length <= v.subjects_max,
  );
  if (!variant) {
    pushWarning(ctx, {
      code: 'master_not_found',
      detail: `no teacher_section variant for subjects.length=${subjects.length}`,
    });
    return;
  }

  const leftFilter = { ...variant.left_filter, applies_to_config: ctx.config.config_type };
  const leftR = findMaster(ctx.config.template_set.spreads, leftFilter);
  if (!leftR.ok) {
    pushWarning(ctx, {
      code: 'master_not_found',
      detail: `teacher left: ${variant.left_filter.expected_name_hint ?? '?'}`,
    });
    return;
  }
  if (leftR.warning) pushWarning(ctx, leftR.warning);

  const leftSubjects = subjects.slice(0, variant.subjects_on_left);
  ctx.spreads.push({
    spread_index: ctx.spreadCounter.value++,
    template_id: leftR.master.id,
    template_name: leftR.master.name,
    data: buildTeacherLeftData(ctx, leftR.master, head, leftSubjects),
  });

  let rightMaster: SpreadTemplate | null = null;
  if (variant.right_filter) {
    const rightFilter = { ...variant.right_filter, applies_to_config: ctx.config.config_type };
    const rightR = findMaster(ctx.config.template_set.spreads, rightFilter);
    if (!rightR.ok) {
      pushWarning(ctx, {
        code: 'master_not_found',
        detail: `teacher right: ${variant.right_filter.expected_name_hint ?? '?'}`,
      });
    } else {
      if (rightR.warning) pushWarning(ctx, rightR.warning);
      rightMaster = rightR.master;
    }
  } else {
    rightMaster = pickRightTeacherMaster(ctx);
    if (!rightMaster) {
      pushWarning(ctx, {
        code: 'no_right_teacher_master',
        detail: `subjects.length=${subjects.length}: ни half (>=2) ни full_class (>=1) — правая учительская страница пропущена`,
      });
    }
  }

  if (!rightMaster) return;

  const rightSubjects =
    variant.subjects_on_right !== undefined
      ? subjects.slice(variant.subjects_on_left, variant.subjects_on_left + variant.subjects_on_right)
      : [];
  ctx.spreads.push({
    spread_index: ctx.spreadCounter.value++,
    template_id: rightMaster.id,
    template_name: rightMaster.name,
    data: buildTeacherRightData(ctx, rightMaster, rightSubjects),
  });
}

/**
 * Заполнение левой страницы учительского разворота (F-*).
 *
 * Все ключи в lowercase — соответствует тому что хранится в БД после
 * нормализации парсером (idml-recon §6.4). Для удобства поиска
 * по InDesign-шаблону рядом приведены оригинальные имена.
 *
 * - `headteachername`/`role`/`photo`, `headtextframe` (orig: headTeacherName, headTextFrame)
 * - `teachername_1..N`/`teacherrole_1..N`/`teacherphoto_1..N` для side-teachers
 *   (только в F-Head-SmallGrid/LargeGrid; в F-Head-WithPhoto sideTeachers пуст)
 * - `classphotoframe` (orig: classPhotoFrame; только для F-Head-WithPhoto)
 */
function buildTeacherLeftData(
  ctx: BuildContext,
  master: SpreadTemplate,
  head: HeadTeacher,
  sideTeachers: Subject[],
): Record<string, string | null> {
  const data: Record<string, string | null> = {
    headteachername: head.name,
    headteacherrole: head.role,
    headteacherphoto: head.photo,
    headtextframe: head.text,
  };
  for (let i = 0; i < sideTeachers.length; i++) {
    const n = i + 1;
    data[`teachername_${n}`] = sideTeachers[i].name;
    data[`teacherrole_${n}`] = sideTeachers[i].role;
    data[`teacherphoto_${n}`] = sideTeachers[i].photo;
  }
  if (hasPlaceholder(master, 'classphotoframe')) {
    const fc = ctx.input.common_photos.full_class;
    if (fc.length >= 1) {
      data.classphotoframe = fc[0];
    } else {
      data.classphotoframe = null;
      pushWarning(ctx, {
        code: 'class_photo_missing',
        detail: `master ${master.name} has classphotoframe placeholder but common_photos.full_class is empty`,
      });
    }
  }
  return data;
}

/**
 * Заполнение правой страницы учительского разворота (G-*).
 *
 * Все ключи в lowercase — соответствует тому что хранится в БД после
 * нормализации парсером (idml-recon §6.4).
 *
 * - G-Teachers-3x3/4x3/4x4: `teachername_1..N`/`teacherrole_1..N`/`teacherphoto_1..N`
 * - G-HalfClass: `halfleftphoto`, `halfrightphoto` из `common_photos.half[0..1]`
 *   (orig: halfLeftPhoto, halfRightPhoto)
 * - G-FullClass: `classphotoframe` из `common_photos.full_class[0]`
 *   (orig: classPhotoFrame)
 */
function buildTeacherRightData(
  ctx: BuildContext,
  master: SpreadTemplate,
  rightSubjects: Subject[],
): Record<string, string | null> {
  const data: Record<string, string | null> = {};

  for (let i = 0; i < rightSubjects.length; i++) {
    const n = i + 1;
    data[`teachername_${n}`] = rightSubjects[i].name;
    data[`teacherrole_${n}`] = rightSubjects[i].role;
    data[`teacherphoto_${n}`] = rightSubjects[i].photo;
  }

  if (hasPlaceholder(master, 'halfleftphoto') && hasPlaceholder(master, 'halfrightphoto')) {
    const half = ctx.input.common_photos.half;
    if (half.length >= 2) {
      data.halfleftphoto = half[0];
      data.halfrightphoto = half[1];
    } else {
      data.halfleftphoto = half[0] ?? null;
      data.halfrightphoto = null;
      pushWarning(ctx, {
        code: 'half_class_missing',
        detail: `master ${master.name} requires 2 half photos, got ${half.length}`,
      });
    }
  }

  if (hasPlaceholder(master, 'classphotoframe')) {
    const fc = ctx.input.common_photos.full_class;
    if (fc.length >= 1) {
      data.classphotoframe = fc[0];
    } else {
      data.classphotoframe = null;
      pushWarning(ctx, {
        code: 'class_photo_missing',
        detail: `master ${master.name} has classphotoframe but common_photos.full_class is empty`,
      });
    }
  }

  return data;
}

/** Проверка что в `placeholders` мастера есть placeholder с заданным `label`. */
function hasPlaceholder(master: SpreadTemplate, label: string): boolean {
  for (let i = 0; i < master.placeholders.length; i++) {
    if (master.placeholders[i].label === label) return true;
  }
  return false;
}
