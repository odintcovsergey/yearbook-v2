/**
 * buildAlbum — единственный builder фазы 0.5.3+. Читает Preset напрямую
 * (без промежуточного ScenarioDef) и собирает альбом через семантический
 * resolver `findMaster` поверх `template_set.spreads`.
 *
 * Эволюция:
 *   - 0.5.3.1 — скелет: intro, teacher (two_page/one_page), заглушки student
 *   - 0.5.3.2 — buildSinglePagePerStudent + buildSpreadPerStudent
 *   - 0.5.3.3 — buildGridStudents (Медиум/Лайт/Мини) + buildThumbnailsSection
 *   - 0.5.3.4 — финал: старый build.ts/scenarios.ts удалены, функция
 *               переименована в buildAlbum, MasterFilter перенесён в types.ts
 *
 * Принципы:
 *   - Семантический resolver: фильтр (`page_role` + `applies_to_config` +
 *     `slot_capacity_min`) вместо имени мастера
 *   - Hardcoded teacher-варианты остаются (TEACHER_TWO_PAGE_VARIANTS,
 *     TEACHER_ONE_PAGE_VARIANTS): набор вариантов определяет дизайн шаблона,
 *     не пресет
 *   - Грид-логика разбита по `grid_base_pages`: `null` → fixed (Медиум),
 *     число → adaptive (Лайт/Мини). Thumbnails-секция переиспользует core
 *     adaptive-grid с `hasQuote=false`
 */

import type {
  AlbumInput,
  BuildResult,
  BuildWarning,
  ConfigType,
  HeadTeacher,
  MasterFilter,
  Preset,
  PrintType,
  SpreadInstance,
  SpreadTemplate,
  Student,
  StudentSectionConfig,
  Subject,
  TemplateSet,
} from './types';
import { findMaster } from './find-master';
import { chunk } from './utils';

/** Variant двухстраничной учительской секции (F+G), layflat-стиль. */
type TeacherTwoPageVariant = {
  subjects_min: number;
  subjects_max: number;
  subjects_on_left: number;
  subjects_on_right?: number;
  left_filter: MasterFilter;
  right_filter?: MasterFilter; // undefined → dynamic via pickRightCommonPhotoMaster
};

/** Variant одностраничной учительской секции (F-*-R), Mini-soft. */
type TeacherOnePageVariant = {
  subjects_min: number;
  subjects_max: number;
  subjects_on_page: number;
  filter: MasterFilter;
};

/**
 * Изменяемый контекст одного запуска `buildAlbumFromPreset`. Локальный тип —
 * не выносим в `types.ts`, чтобы не загромождать публичный API.
 */
type PresetBuildContext = {
  input: AlbumInput;
  preset: Preset;
  templateSet: TemplateSet;
  cfgType: ConfigType;
  printType: PrintType;
  spreads: SpreadInstance[];
  warnings: BuildWarning[];
  spreadCounter: { value: number };
};

// ─── Константы ────────────────────────────────────────────────────────────

const VALID_CONFIG_TYPES: ConfigType[] = [
  'standard',
  'universal',
  'maximum',
  'medium',
  'light',
  'mini',
  'individual',
  'tryumo',
];

/**
 * Двухстраничная учительская (layflat-стиль) — 7 вариантов по `subjects.length`.
 * Перенесены из `scenarios.ts:TEACHER_SECTION_LAYFLAT`. `applies_to_config`
 * во всех filter'ах — заглушка `'standard'`, в runtime подменяется на
 * `ctx.cfgType`.
 *
 * Поведение для `subjects.length >= 25`: `buildTeacherSectionTwoPage` обрезает
 * до 24 + warning `subjects_overflow`.
 */
const TEACHER_TWO_PAGE_VARIANTS: TeacherTwoPageVariant[] = [
  {
    subjects_min: 0,
    subjects_max: 0,
    subjects_on_left: 0,
    // subjects_on_right: undefined → dynamic
    left_filter: {
      page_role: 'teacher_left',
      applies_to_config: 'standard',
      slot_capacity_min: { head_teacher: 1, photos_full: 1 },
      expected_name_hint: 'F-Head-WithPhoto',
    },
    // right_filter: undefined → dynamic (pickRightCommonPhotoMaster)
  },
  {
    subjects_min: 1,
    subjects_max: 4,
    subjects_on_left: 4,
    left_filter: {
      page_role: 'teacher_left',
      applies_to_config: 'standard',
      slot_capacity_min: { head_teacher: 1, teachers: 4 },
      expected_name_hint: 'F-Head-SmallGrid',
    },
  },
  {
    subjects_min: 5,
    subjects_max: 8,
    subjects_on_left: 8,
    left_filter: {
      page_role: 'teacher_left',
      applies_to_config: 'standard',
      slot_capacity_min: { head_teacher: 1, teachers: 8 },
      expected_name_hint: 'F-Head-LargeGrid',
    },
  },
  {
    subjects_min: 9,
    subjects_max: 9,
    subjects_on_left: 0,
    subjects_on_right: 9,
    left_filter: {
      page_role: 'teacher_left',
      applies_to_config: 'standard',
      slot_capacity_min: { head_teacher: 1, photos_full: 1 },
      expected_name_hint: 'F-Head-WithPhoto',
    },
    right_filter: {
      page_role: 'teacher_right',
      applies_to_config: 'standard',
      slot_capacity_min: { teachers: 9 },
      expected_name_hint: 'G-Teachers-3x3',
    },
  },
  {
    subjects_min: 10,
    subjects_max: 12,
    subjects_on_left: 0,
    subjects_on_right: 12,
    left_filter: {
      page_role: 'teacher_left',
      applies_to_config: 'standard',
      slot_capacity_min: { head_teacher: 1, photos_full: 1 },
      expected_name_hint: 'F-Head-WithPhoto',
    },
    right_filter: {
      page_role: 'teacher_right',
      applies_to_config: 'standard',
      slot_capacity_min: { teachers: 12 },
      expected_name_hint: 'G-Teachers-4x3',
    },
  },
  {
    subjects_min: 13,
    subjects_max: 16,
    subjects_on_left: 0,
    subjects_on_right: 16,
    left_filter: {
      page_role: 'teacher_left',
      applies_to_config: 'standard',
      slot_capacity_min: { head_teacher: 1, photos_full: 1 },
      expected_name_hint: 'F-Head-WithPhoto',
    },
    right_filter: {
      page_role: 'teacher_right',
      applies_to_config: 'standard',
      slot_capacity_min: { teachers: 16 },
      expected_name_hint: 'G-Teachers-4x4',
    },
  },
  {
    subjects_min: 17,
    subjects_max: 24,
    subjects_on_left: 8,
    subjects_on_right: 16,
    left_filter: {
      page_role: 'teacher_left',
      applies_to_config: 'standard',
      slot_capacity_min: { head_teacher: 1, teachers: 8 },
      expected_name_hint: 'F-Head-LargeGrid',
    },
    right_filter: {
      page_role: 'teacher_right',
      applies_to_config: 'standard',
      slot_capacity_min: { teachers: 16 },
      expected_name_hint: 'G-Teachers-4x4',
    },
  },
];

/**
 * Одностраничная учительская (Mini-soft) — 3 варианта по `subjects.length`.
 * Перенесены из `scenarios.ts:TEACHER_SECTION_MINI_SOFT`. `applies_to_config`
 * — заглушка `'mini'`, в runtime подменяется на `ctx.cfgType`.
 *
 * При `subjects.length >= 9` — обрезка до 8 + warning `subjects_overflow`.
 */
const TEACHER_ONE_PAGE_VARIANTS: TeacherOnePageVariant[] = [
  {
    subjects_min: 0,
    subjects_max: 0,
    subjects_on_page: 0,
    filter: {
      page_role: 'teacher_left',
      applies_to_config: 'mini',
      slot_capacity_min: { photos_full: 1 },
      expected_name_hint: 'F-Head-WithPhoto-R',
    },
  },
  {
    subjects_min: 1,
    subjects_max: 4,
    subjects_on_page: 4,
    filter: {
      page_role: 'teacher_left',
      applies_to_config: 'mini',
      slot_capacity_min: { head_teacher: 1, teachers: 4 },
      expected_name_hint: 'F-Head-SmallGrid-R',
    },
  },
  {
    subjects_min: 5,
    subjects_max: 8,
    subjects_on_page: 8,
    filter: {
      page_role: 'teacher_left',
      applies_to_config: 'mini',
      slot_capacity_min: { head_teacher: 1, teachers: 8 },
      expected_name_hint: 'F-Head-LargeGrid-R',
    },
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Локальный аналог `utils.pushWarning`, но для `PresetBuildContext`. */
function pushWarning(ctx: PresetBuildContext, w: BuildWarning): void {
  ctx.warnings.push(w);
}

/**
 * Извлекает `ConfigType` из slug пресета (`'standard-layflat' → 'standard'`).
 * Используется внутри builder'а для подстановки в `MasterFilter.applies_to_config`.
 */
function presetSlugToConfigType(slug: string): ConfigType {
  const base = slug.replace(/-(layflat|soft)$/, '');
  if ((VALID_CONFIG_TYPES as string[]).indexOf(base) < 0) {
    throw new Error(
      `presetSlugToConfigType: cannot derive ConfigType from slug='${slug}', base='${base}'`,
    );
  }
  return base as ConfigType;
}

// ─── Главный entry point ──────────────────────────────────────────────────

export function buildAlbum(
  input: AlbumInput,
  preset: Preset,
  templateSet: TemplateSet,
): BuildResult {
  if (input.template_set_id !== templateSet.id) {
    throw new Error(
      `template_set_id mismatch: input=${input.template_set_id}, templateSet=${templateSet.id}`,
    );
  }

  const ctx: PresetBuildContext = {
    input,
    preset,
    templateSet,
    cfgType: presetSlugToConfigType(preset.slug),
    printType: preset.print_type,
    spreads: [],
    warnings: [],
    spreadCounter: { value: 0 },
  };

  if (input.students.length === 0) {
    pushWarning(ctx, {
      code: 'students_empty',
      detail: 'AlbumInput.students is empty',
    });
    return { spreads: ctx.spreads, warnings: ctx.warnings };
  }

  // Раздел 1 — S-Intro (только soft и если задано в пресете)
  if (preset.config.intro_section !== null && ctx.printType === 'soft') {
    buildIntroSection(ctx);
  }

  // Раздел 2 — учителя
  const teacherSection = preset.config.teacher_section;
  if (teacherSection !== null && teacherSection.enabled) {
    if (input.head_teacher === null) {
      pushWarning(ctx, {
        code: 'no_head_teacher',
        detail: 'preset.teacher_section.enabled=true, но input.head_teacher=null — учительский разворот пропущен',
      });
    } else if (teacherSection.layout === 'two_page') {
      buildTeacherSectionTwoPage(ctx);
    } else if (teacherSection.layout === 'one_page') {
      buildTeacherSectionOnePage(ctx);
    }
  }

  // Раздел 3 — ученики (dispatcher по base_layout_mode)
  const ss = preset.config.student_section;
  const mode = ss.base_layout_mode;
  if (mode === 'single_page_per_student') {
    buildSinglePagePerStudent(ctx, ss);
  } else if (mode === 'spread_per_student') {
    buildSpreadPerStudent(ctx, ss);
  } else if (mode === 'grid_multiple_students') {
    buildGridStudents(ctx, ss);
  }

  // Раздел 4 — thumbnails (только для Индивидуального; в Лайт/Мини не имеет смысла)
  const thumbnails = ss.thumbnails_section;
  if (
    thumbnails !== null &&
    thumbnails.enabled &&
    mode !== 'grid_multiple_students'
  ) {
    buildThumbnailsSection(ctx, ss);
  }

  // Раздел 5 — общий раздел альбома (А.2.2.b)
  // Жадно размещает common_* фото в J-* мастера. Если фото нет — функция
  // тихо возвращается. Не зависит от preset.config.common_section (он пока
  // зарезервирован, ⚪) — алгоритм работает напрямую из input.common_photos.
  buildCommonSection(ctx);

  return { spreads: ctx.spreads, warnings: ctx.warnings };
}

// ─── Section builders ─────────────────────────────────────────────────────

/**
 * Сборка вступительной страницы S-Intro (только для soft-печати).
 * Адаптировано из `build.ts:buildIntroSection`.
 */
function buildIntroSection(ctx: PresetBuildContext): void {
  const filter: MasterFilter = {
    page_role: 'intro',
    applies_to_config: ctx.cfgType,
    slot_capacity_min: { photos_full: 1 },
    expected_name_hint: 'S-Intro',
  };
  const r = findMaster(ctx.templateSet.spreads, filter);
  if (!r.ok) {
    pushWarning(ctx, {
      code: 'master_not_found',
      detail: `intro: ${filter.expected_name_hint ?? '?'}`,
    });
    return;
  }
  if (r.warning) pushWarning(ctx, r.warning);

  const data: Record<string, string | null> = {};
  if (hasPlaceholder(r.master, 'classphotoframe')) {
    const fc = ctx.input.common_photos.full_class;
    if (fc.length >= 1) {
      data.classphotoframe = fc[0];
    } else {
      data.classphotoframe = null;
      pushWarning(ctx, {
        code: 'class_photo_missing',
        detail: `master ${r.master.name} has classphotoframe but common_photos.full_class is empty`,
      });
    }
  }

  ctx.spreads.push({
    spread_index: ctx.spreadCounter.value++,
    template_id: r.master.id,
    template_name: r.master.name,
    data,
  });
}

/**
 * Сборка двухстраничной учительской секции (F-* + G-*).
 * Адаптировано из `build.ts:buildTeacherSection`.
 */
function buildTeacherSectionTwoPage(ctx: PresetBuildContext): void {
  const head = ctx.input.head_teacher!; // вызывающий проверил выше
  let subjects = ctx.input.subjects;

  if (subjects.length > 24) {
    pushWarning(ctx, {
      code: 'subjects_overflow',
      detail: `subjects.length=${subjects.length} > 24, обрезано до 24 (см. master-cleanup-tz §C1)`,
    });
    subjects = subjects.slice(0, 24);
  }

  const variant = TEACHER_TWO_PAGE_VARIANTS.find(
    (v) => subjects.length >= v.subjects_min && subjects.length <= v.subjects_max,
  );
  if (!variant) {
    pushWarning(ctx, {
      code: 'master_not_found',
      detail: `no teacher_section variant for subjects.length=${subjects.length}`,
    });
    return;
  }

  const leftFilter: MasterFilter = {
    ...variant.left_filter,
    applies_to_config: ctx.cfgType,
  };
  const leftR = findMaster(ctx.templateSet.spreads, leftFilter);
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
    const rightFilter: MasterFilter = {
      ...variant.right_filter,
      applies_to_config: ctx.cfgType,
    };
    const rightR = findMaster(ctx.templateSet.spreads, rightFilter);
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
    rightMaster = pickRightCommonPhotoMaster(ctx);
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
      ? subjects.slice(
          variant.subjects_on_left,
          variant.subjects_on_left + variant.subjects_on_right,
        )
      : [];
  ctx.spreads.push({
    spread_index: ctx.spreadCounter.value++,
    template_id: rightMaster.id,
    template_name: rightMaster.name,
    data: buildTeacherRightData(ctx, rightMaster, rightSubjects),
  });
}

/**
 * Сборка одностраничной учительской секции (F-*-R, Mini-soft).
 * Адаптировано из `build.ts:buildMiniSoftTeacherSection`.
 */
function buildTeacherSectionOnePage(ctx: PresetBuildContext): void {
  const head = ctx.input.head_teacher!;
  let subjects = ctx.input.subjects;

  if (subjects.length > 8) {
    pushWarning(ctx, {
      code: 'subjects_overflow',
      detail: `Mini-soft: subjects.length=${subjects.length} > 8, обрезано до 8 (F-Head-LargeGrid-R)`,
    });
    subjects = subjects.slice(0, 8);
  }

  const variant = TEACHER_ONE_PAGE_VARIANTS.find(
    (v) => subjects.length >= v.subjects_min && subjects.length <= v.subjects_max,
  );
  if (!variant) {
    pushWarning(ctx, {
      code: 'master_not_found',
      detail: `Mini-soft: no teacher variant for subjects.length=${subjects.length}`,
    });
    return;
  }

  const filter: MasterFilter = {
    ...variant.filter,
    applies_to_config: ctx.cfgType,
  };
  const r = findMaster(ctx.templateSet.spreads, filter);
  if (!r.ok) {
    pushWarning(ctx, {
      code: 'master_not_found',
      detail: `Mini-soft teacher: ${variant.filter.expected_name_hint ?? '?'}`,
    });
    return;
  }
  if (r.warning) pushWarning(ctx, r.warning);

  const sideTeachers = subjects.slice(0, variant.subjects_on_page);
  const data = buildTeacherLeftData(ctx, r.master, head, sideTeachers);

  ctx.spreads.push({
    spread_index: ctx.spreadCounter.value++,
    template_id: r.master.id,
    template_name: r.master.name,
    data,
  });
}

// ─── Student section builders ────────────────────────────────────────────

/**
 * Ученическая секция для пресетов с `base_layout_mode='single_page_per_student'`
 * (Стандарт + Универсал). Развилка по `friend_photos`:
 *
 * - `friend_photos === null` → Стандарт-flow: двухстраничный E-Student-Standard,
 *   пара учеников на разворот (логика из `build.ts:buildStandardStudents`).
 * - `friend_photos !== null` → Универсал-flow путь (a): одностраничные
 *   E-Student-Left/Right с alternate-чередованием по индексу ученика
 *   (логика из `build.ts:buildUniversalStudents`).
 *
 * Путь (b) для Универсала (попытка двухстраничного E-Student-Default первым)
 * зафиксирован в `docs/templates/master-cleanup-tz.md §B3` как улучшение P2.
 */
function buildSinglePagePerStudent(
  ctx: PresetBuildContext,
  ss: StudentSectionConfig,
): void {
  const friendPhotos = ss.first_spread_content.friend_photos;

  if (friendPhotos === null) {
    // Стандарт-flow: двухстраничный E-Student-Standard
    const filter: MasterFilter = {
      page_role: 'student',
      applies_to_config: ctx.cfgType,
      is_spread: true,
      slot_capacity_min: { students: 2 },
      expected_name_hint: 'E-Student-Standard',
    };
    const r = findMaster(ctx.templateSet.spreads, filter);
    if (!r.ok) {
      pushWarning(ctx, {
        code: 'master_not_found',
        detail: `single_page_per_student (standard): ${filter.expected_name_hint ?? '?'}`,
      });
      return;
    }
    if (r.warning) pushWarning(ctx, r.warning);

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
        template_id: r.master.id,
        template_name: r.master.name,
        data,
      });
    }
    return;
  }

  // Универсал-flow путь (a): одностраничные E-Student-Left/Right alternate
  const friendMax = friendPhotos.max;

  const leftFilter: MasterFilter = {
    page_role: 'student_left',
    applies_to_config: ctx.cfgType,
    is_spread: false,
    slot_capacity_min: { students: 1, photos_friend: friendMax },
    expected_name_hint: 'E-Student-Left',
  };
  const rightFilter: MasterFilter = {
    page_role: 'student_right',
    applies_to_config: ctx.cfgType,
    is_spread: false,
    slot_capacity_min: { students: 1, photos_friend: friendMax },
    expected_name_hint: 'E-Student-Right',
  };

  const left = findMaster(ctx.templateSet.spreads, leftFilter);
  const right = findMaster(ctx.templateSet.spreads, rightFilter);

  if (!left.ok) {
    pushWarning(ctx, {
      code: 'master_not_found',
      detail: `single_page_per_student (universal) left: ${leftFilter.expected_name_hint ?? '?'}`,
    });
    return;
  }
  if (!right.ok) {
    pushWarning(ctx, {
      code: 'master_not_found',
      detail: `single_page_per_student (universal) right: ${rightFilter.expected_name_hint ?? '?'}`,
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
      data: studentSinglePageData(s, friendMax),
    });
  }
}

/**
 * Ученическая секция для пресетов с `base_layout_mode='spread_per_student'`
 * (Максимум + Индивидуальный). Каждый ученик = пара мастеров (E-Max-Left + E-*-Right).
 *
 * Правый мастер выбирается per-student через capacity-pool:
 *   - Maximum: pool = [E-Max-Right] (capacity=4) → всегда один мастер
 *   - Individual: pool = [E-Ind-Right-3, E-Max-Right] (capacity=3,4) → per-student
 * Подбор: первый кандидат с `slot_capacity.photos_friend >= friendCount`,
 * fallback — мастер с максимальной capacity + warning.
 *
 * Гибкость: при добавлении в БД новых вариантов (E-Max-Right-2 и т.п.) builder
 * автоматически распространит per-student режим на новые комплектации.
 */
function buildSpreadPerStudent(
  ctx: PresetBuildContext,
  ss: StudentSectionConfig,
): void {
  // 1. Левый мастер (общий для всех учеников)
  const leftFilter: MasterFilter = {
    page_role: 'student_left',
    applies_to_config: ctx.cfgType,
    slot_capacity_min: { students: 1 },
    expected_name_hint: 'E-Max-Left',
  };
  const left = findMaster(ctx.templateSet.spreads, leftFilter);
  if (!left.ok) {
    pushWarning(ctx, {
      code: 'master_not_found',
      detail: `spread_per_student left: ${leftFilter.expected_name_hint ?? '?'}`,
    });
    return;
  }
  if (left.warning) pushWarning(ctx, left.warning);

  // 2. Pool правых кандидатов, отсортированный asc по photos_friend
  const rightCandidates = ctx.templateSet.spreads
    .filter((s) => {
      if (s.page_role !== 'student_right') return false;
      if (s.default_for_configs.indexOf(ctx.cfgType) < 0) return false;
      if (s.is_fallback) return false;
      if (s.slot_capacity === null) return false;
      if (
        typeof s.slot_capacity.students !== 'number' ||
        s.slot_capacity.students < 1
      ) {
        return false;
      }
      return true;
    })
    .sort(
      (a, b) =>
        (a.slot_capacity?.photos_friend ?? 0) -
        (b.slot_capacity?.photos_friend ?? 0),
    );

  if (rightCandidates.length === 0) {
    pushWarning(ctx, {
      code: 'master_not_found',
      detail: `spread_per_student: no right candidates for cfgType=${ctx.cfgType}`,
    });
    return;
  }

  // 3. Per-student loop
  const friendMaxFromPreset = ss.first_spread_content.friend_photos?.max ?? 0;

  for (let i = 0; i < ctx.input.students.length; i++) {
    const student = ctx.input.students[i];

    // Левая страница: портрет + имя
    ctx.spreads.push({
      spread_index: ctx.spreadCounter.value++,
      template_id: left.master.id,
      template_name: left.master.name,
      data: {
        studentportrait: student.portrait,
        studentname: student.full_name,
      },
    });

    // Правая страница: выбор по friend_photos.length, обрезка по preset.max
    let friendCount = student.friend_photos.length;
    if (friendCount > friendMaxFromPreset) {
      pushWarning(ctx, {
        code: 'students_overflow',
        detail: `spread_per_student: student ${student.full_name} has ${friendCount} friend_photos, обрезано до ${friendMaxFromPreset} (preset.max)`,
      });
      friendCount = friendMaxFromPreset;
    }

    let rightMaster = rightCandidates.find(
      (c) => (c.slot_capacity?.photos_friend ?? 0) >= friendCount,
    );
    let usedSlots: number;

    if (rightMaster) {
      usedSlots = friendCount;
    } else {
      // У всех capacity ниже friendCount — берём максимальный
      rightMaster = rightCandidates[rightCandidates.length - 1];
      usedSlots = rightMaster.slot_capacity?.photos_friend ?? 0;
      pushWarning(ctx, {
        code: 'students_overflow',
        detail: `spread_per_student: student ${student.full_name} needs ${friendCount} slots, max available ${usedSlots} (${rightMaster.name})`,
      });
    }

    ctx.spreads.push({
      spread_index: ctx.spreadCounter.value++,
      template_id: rightMaster.id,
      template_name: rightMaster.name,
      data: studentSinglePageData(student, usedSlots),
    });
  }
}

// ─── Grid students (Медиум / Лайт / Мини) ─────────────────────────────────

/**
 * Dispatcher для grid-комплектаций. Развилка по `grid_base_pages`:
 * - `null` → fixed grid + last_spread (Медиум)
 * - число → adaptive grid + overflow (Лайт=4, Мини=2)
 */
function buildGridStudents(
  ctx: PresetBuildContext,
  ss: StudentSectionConfig,
): void {
  if (ss.grid_base_pages === null) {
    buildFixedGridStudents(ctx, ss);
  } else {
    buildAdaptiveGridStudents(ctx, ss);
  }
}

/**
 * Fixed grid (Медиум) — обобщение `build.ts:buildMediumStudents` с заменой
 * декларативного `last_spread.left_filter` на семантический discovery
 * через `page_role='student_last'` + `slot_capacity_min.students`.
 *
 * - capacity берётся из найденного `student_grid_left` мастера
 * - hasQuote берётся из `ss.first_spread_content.text?.enabled`
 * - last-мастер (если найден) определяет hasQuote сам через placeholders
 */
function buildFixedGridStudents(
  ctx: PresetBuildContext,
  ss: StudentSectionConfig,
): void {
  const cfgType = ctx.cfgType;
  const total = ctx.input.students.length;
  const hasQuote = ss.first_spread_content.text?.enabled === true;

  const leftR = findMaster(ctx.templateSet.spreads, {
    page_role: 'student_grid_left',
    applies_to_config: cfgType,
  });
  const rightR = findMaster(ctx.templateSet.spreads, {
    page_role: 'student_grid_right',
    applies_to_config: cfgType,
  });
  if (!leftR.ok) {
    pushWarning(ctx, {
      code: 'master_not_found',
      detail: `fixed_grid student_grid_left for ${cfgType}`,
    });
    return;
  }
  if (!rightR.ok) {
    pushWarning(ctx, {
      code: 'master_not_found',
      detail: `fixed_grid student_grid_right for ${cfgType}`,
    });
    return;
  }
  if (leftR.warning) pushWarning(ctx, leftR.warning);
  if (rightR.warning) pushWarning(ctx, rightR.warning);

  const N = leftR.master.slot_capacity?.students ?? 0;
  if (N < 1) {
    pushWarning(ctx, {
      code: 'master_not_found',
      detail: `fixed_grid: ${leftR.master.name} has slot_capacity.students<1`,
    });
    return;
  }

  // Last_spread semantic discovery
  const remainder = total % N;
  let lastLeftMaster: SpreadTemplate | null = null;
  let lastSlotsPerPage = 0;
  let lastHasQuote = false;

  if (remainder > 0) {
    const lastR = findMaster(ctx.templateSet.spreads, {
      page_role: 'student_last',
      applies_to_config: cfgType,
      slot_capacity_min: { students: remainder },
    });
    if (lastR.ok) {
      lastLeftMaster = lastR.master;
      lastSlotsPerPage = lastR.master.slot_capacity?.students ?? 0;
      lastHasQuote = hasPlaceholderPrefix(lastR.master, 'studentquote_');
      if (lastR.warning) pushWarning(ctx, lastR.warning);
    }
  }

  const useLastSpecial = lastLeftMaster !== null;
  const regularPages = useLastSpecial ? Math.floor(total / N) : Math.ceil(total / N);

  // Regular pages с чередованием Left/Right
  for (let i = 0; i < regularPages; i++) {
    const slice = ctx.input.students.slice(i * N, (i + 1) * N);
    const isLeft = i % 2 === 0;
    const master = isLeft ? leftR.master : rightR.master;

    if (slice.length < N) {
      pushWarning(ctx, {
        code: 'students_grid_no_special_master',
        detail: `${cfgType}: remainder=${remainder} учеников на последней странице (${master.name}) — нет специального мастера, пустые слоты заполнены null (см. master-cleanup-tz §A5)`,
      });
    }

    ctx.spreads.push({
      spread_index: ctx.spreadCounter.value++,
      template_id: master.id,
      template_name: master.name,
      data: buildGridStudentData(slice, N, hasQuote),
    });
  }

  // Special last spread: левая = last-мастер с classphotoframe, правая = dynamic G-*
  if (useLastSpecial && lastLeftMaster) {
    const consumed = regularPages * N;
    const lastSlice = ctx.input.students.slice(consumed);

    const leftData = buildGridStudentData(lastSlice, lastSlotsPerPage, lastHasQuote);
    if (hasPlaceholder(lastLeftMaster, 'classphotoframe')) {
      const fc = ctx.input.common_photos.full_class;
      if (fc.length >= 1) {
        leftData.classphotoframe = fc[0];
      } else {
        leftData.classphotoframe = null;
        pushWarning(ctx, {
          code: 'class_photo_missing',
          detail: `master ${lastLeftMaster.name} has classphotoframe placeholder but common_photos.full_class is empty`,
        });
      }
    }

    ctx.spreads.push({
      spread_index: ctx.spreadCounter.value++,
      template_id: lastLeftMaster.id,
      template_name: lastLeftMaster.name,
      data: leftData,
    });

    const rightMaster = pickRightCommonPhotoMaster(ctx);
    if (!rightMaster) {
      pushWarning(ctx, {
        code: 'no_right_teacher_master',
        detail: `last_spread right: ни half (>=2) ни full_class (>=1) — правая страница пропущена`,
      });
      return;
    }
    ctx.spreads.push({
      spread_index: ctx.spreadCounter.value++,
      template_id: rightMaster.id,
      template_name: rightMaster.name,
      data: buildTeacherRightData(ctx, rightMaster, []),
    });
  }
}

/**
 * Wrapper: вызывает adaptive-grid core с `basePages` из preset
 * и `hasQuote` из `text.enabled`. Защитная проверка на `null` (диспетчер
 * должен был отправить в `buildFixedGridStudents`).
 */
function buildAdaptiveGridStudents(
  ctx: PresetBuildContext,
  ss: StudentSectionConfig,
): void {
  if (ss.grid_base_pages === null) {
    pushWarning(ctx, {
      code: 'master_not_found',
      detail: 'buildAdaptiveGridStudents called with grid_base_pages=null',
    });
    return;
  }
  const hasQuote = ss.first_spread_content.text?.enabled === true;
  buildAdaptiveGridStudentsCore(ctx, ss.grid_base_pages, hasQuote);
}

/**
 * Core adaptive grid алгоритм. Используется и для основной student_section
 * (Лайт/Мини), и для thumbnails (Индивидуальный, hasQuote=false).
 *
 * Адаптировано из `build.ts:buildAdaptiveGridStudents` с заменой
 * декларативного `section.overflow.*_filter` на семантический discovery
 * через `page_role='student_overflow' | 'student_overflow_right'`.
 *
 * Шаги:
 *   1. Clamping через max-capacity мастер: `totalForBase = min(total, basePages × maxCap)`
 *   2. Подбор минимально-достаточных left/right мастеров через `pickAdaptiveGrid`
 *   3. Заполнение `basePages` базовых страниц с чередованием Left/Right
 *   4. Overflow — три ветки по `overflowCount`:
 *      a. ≤ rowCapacity → single overflow-row
 *      b. ≤ slotsPerPage → ещё одна regular-страница с null'ами
 *      c. > slotsPerPage → full grid + overflow_row_right (Лайт 31-32)
 */
function buildAdaptiveGridStudentsCore(
  ctx: PresetBuildContext,
  basePages: number,
  hasQuote: boolean,
): void {
  if (basePages < 1) {
    pushWarning(ctx, {
      code: 'master_not_found',
      detail: `adaptive_grid: basePages must be >= 1, got ${basePages}`,
    });
    return;
  }

  const cfgType = ctx.cfgType;
  const total = ctx.input.students.length;

  const baseLeftFilter: MasterFilter = {
    page_role: 'student_grid_left',
    applies_to_config: cfgType,
  };
  const baseRightFilter: MasterFilter = {
    page_role: 'student_grid_right',
    applies_to_config: cfgType,
  };

  // 1. Clamping
  const maxLeftMaster = pickAdaptiveGridMaxCapacity(ctx, baseLeftFilter);
  if (!maxLeftMaster) {
    pushWarning(ctx, {
      code: 'master_not_found',
      detail: `adaptive_grid LEFT: no candidates for cfgType=${cfgType}`,
    });
    return;
  }
  const maxCapacityPerPage = maxLeftMaster.slot_capacity?.students ?? 0;
  if (maxCapacityPerPage < 1) {
    pushWarning(ctx, {
      code: 'master_not_found',
      detail: `adaptive_grid LEFT: max master ${maxLeftMaster.name} has slot_capacity.students<1`,
    });
    return;
  }
  const totalForBase = Math.min(total, basePages * maxCapacityPerPage);

  // 2. Минимально-достаточные мастера
  const leftMaster = pickAdaptiveGrid(ctx, baseLeftFilter, totalForBase, basePages);
  const rightMaster = pickAdaptiveGrid(ctx, baseRightFilter, totalForBase, basePages);
  if (!leftMaster || !rightMaster) {
    pushWarning(ctx, {
      code: 'master_not_found',
      detail: `adaptive_grid: missing left or right master for ${cfgType}`,
    });
    return;
  }

  const slotsPerPage = leftMaster.slot_capacity?.students ?? 0;
  if (slotsPerPage < 1) {
    pushWarning(ctx, {
      code: 'master_not_found',
      detail: `adaptive_grid LEFT: ${leftMaster.name} has slot_capacity.students<1`,
    });
    return;
  }

  const maxOnBase = basePages * slotsPerPage;

  // 3. Базовые страницы
  const baseStudents = ctx.input.students.slice(0, Math.min(total, maxOnBase));
  for (let i = 0; i < basePages; i++) {
    const slice = baseStudents.slice(i * slotsPerPage, (i + 1) * slotsPerPage);
    if (slice.length === 0) break;
    const isLeft = i % 2 === 0;
    const master = isLeft ? leftMaster : rightMaster;
    ctx.spreads.push({
      spread_index: ctx.spreadCounter.value++,
      template_id: master.id,
      template_name: master.name,
      data: buildGridStudentData(slice, slotsPerPage, hasQuote),
    });
  }

  // 4. Overflow
  const overflowCount = total - maxOnBase;
  if (overflowCount <= 0) return;

  const rowR = findMaster(ctx.templateSet.spreads, {
    page_role: 'student_overflow',
    applies_to_config: cfgType,
  });
  if (!rowR.ok) {
    pushWarning(ctx, {
      code: 'students_overflow',
      detail: `${cfgType}: total=${total} > maxOnBase=${maxOnBase}, overflow strategy не задана (нет мастера student_overflow)`,
    });
    return;
  }
  if (rowR.warning) pushWarning(ctx, rowR.warning);
  const rowCapacity = rowR.master.slot_capacity?.students ?? 0;

  const overflowStudents = ctx.input.students.slice(maxOnBase);

  if (overflowCount <= rowCapacity) {
    // Branch 1: single overflow-row
    buildOverflowRow(ctx, rowR.master, overflowStudents, rowCapacity);
  } else if (overflowCount <= slotsPerPage) {
    // Branch 2: ещё одна regular-страница с null'ами
    ctx.spreads.push({
      spread_index: ctx.spreadCounter.value++,
      template_id: leftMaster.id,
      template_name: leftMaster.name,
      data: buildGridStudentData(overflowStudents, slotsPerPage, hasQuote),
    });
  } else {
    // Branch 3: full grid + overflow_row_right (Лайт 31-32)
    const rightRowR = findMaster(ctx.templateSet.spreads, {
      page_role: 'student_overflow_right',
      applies_to_config: cfgType,
    });
    if (!rightRowR.ok) {
      pushWarning(ctx, {
        code: 'master_not_found',
        detail: `overflow grid_plus_row: no student_overflow_right master, overflowCount=${overflowCount}`,
      });
      return;
    }
    if (rightRowR.warning) pushWarning(ctx, rightRowR.warning);

    const fullSlice = overflowStudents.slice(0, slotsPerPage);
    ctx.spreads.push({
      spread_index: ctx.spreadCounter.value++,
      template_id: leftMaster.id,
      template_name: leftMaster.name,
      data: buildGridStudentData(fullSlice, slotsPerPage, hasQuote),
    });

    const remainSlice = overflowStudents.slice(slotsPerPage);
    const rightRowCapacity = rightRowR.master.slot_capacity?.students ?? rowCapacity;
    buildOverflowRow(ctx, rightRowR.master, remainSlice, rightRowCapacity);
  }
}

/**
 * Thumbnails-секция (только для пресетов с `thumbnails_section.enabled=true`,
 * например Индивидуальный). Реализована через `buildAdaptiveGridStudentsCore`
 * с `basePages = ceil(total / preferred_grid_size)` и `hasQuote=false`
 * (у thumbnails-мастеров нет quote-слотов).
 */
function buildThumbnailsSection(
  ctx: PresetBuildContext,
  ss: StudentSectionConfig,
): void {
  const ts = ss.thumbnails_section;
  if (!ts || !ts.enabled) return;

  const total = ctx.input.students.length;
  const preferred = ts.preferred_grid_size;
  if (preferred < 1) {
    pushWarning(ctx, {
      code: 'master_not_found',
      detail: `thumbnails: preferred_grid_size must be >= 1, got ${preferred}`,
    });
    return;
  }

  const basePages = Math.ceil(total / preferred);
  if (basePages < 1) return;

  buildAdaptiveGridStudentsCore(ctx, basePages, false);
}

// ─── Common section (А.2.2.b) ─────────────────────────────────────────────

/**
 * Опции для одной категории фото общего раздела.
 *
 * Алгоритм buildCommonPair (Вариант 1, одностраничные парами):
 *   1. Найти левый и правый одностраничные J-* мастера по hint+slotFilter
 *   2. Разбить photos на группы по `photos_per_page * 2` (фото на разворот)
 *   3. Для каждой группы добавить 2 SpreadInstance (левая + правая)
 *   4. Если фото < photos_per_page на правой → правая страница пропускается
 *      с warning `common_right_page_empty`
 *
 * Двухстраничные комбинированные мастера (J-HalfSixth, J-SixthFull,
 * J-SixthSixth) в этом варианте НЕ используются — это А.2.2.c, опциональное
 * расширение если партнёры пожалуются на длинный общий раздел.
 */
type CommonPairOpts = {
  /** Hint для findMaster левой страницы (например 'J-ClassPhoto'). */
  left_hint: string;
  /** Hint для правой страницы. Если совпадает с left_hint — переиспользуем
   *  тот же мастер (симметричный одностраничный мастер используется и слева
   *  и справа). */
  right_hint: string;
  /** Фильтр slot_capacity_min для findMaster. Ключ — как в БД мастера. */
  slot_filter: Partial<{
    photos_full: number;
    photos_half: number;
    photos_quarter: number;
    photos_collage: number;
  }>;
  /** Сколько фото вмещается на одну страницу (1, 2 или 6). */
  photos_per_page: number;
  /** Функция генерации label placeholder'а по индексу (1-based). */
  placeholder_label: (n: number) => string;
  /** Имя категории для warning detail (например 'full_class'). */
  category_name: string;
};

/**
 * Сборка общего раздела альбома (А.2.2.b). Вызывается в конце buildAlbum.
 *
 * Категории фото и их мастера:
 *   spread     — нет специализированного мастера (A5, dependent on designer)
 *   full_class — J-ClassPhoto (left) + J-ClassPhoto-Right (right)
 *   half       — J-Half × 2 (симметричный)
 *   quarter    — J-Quarter × 2 (симметричный)
 *   sixth      — J-Collage × 2 (симметричный, ключ slot_capacity = photos_collage)
 *
 * Порядок размещения: spread → full_class → half → quarter → sixth.
 * Внутри каждой категории фото берутся в том порядке, в каком были
 * загружены (created_at ASC из smart-fill).
 */
function buildCommonSection(ctx: PresetBuildContext): void {
  const cp = ctx.input.common_photos;

  // 1. spread — нет мастера J-Spread (A5 в master-cleanup-tz). Warning и
  // продолжаем — фото не размещены в layout, партнёр может вручную
  // вставить через редактор фаз 2-4.
  if (cp.spread.length > 0) {
    pushWarning(ctx, {
      code: 'no_master_for_common_spread',
      detail: `${cp.spread.length} фото common_spread не размещены — мастер J-Spread не реализован в template_set (см. master-cleanup-tz A5)`,
    });
  }

  // 2. full_class — J-ClassPhoto + J-ClassPhoto-Right (есть зеркало)
  buildCommonPair(ctx, cp.full_class, {
    left_hint: 'J-ClassPhoto',
    right_hint: 'J-ClassPhoto-Right',
    slot_filter: { photos_full: 1 },
    photos_per_page: 1,
    placeholder_label: () => 'classphotoframe',
    category_name: 'full_class',
  });

  // 3. half — J-Half (симметричный, один мастер на обе стороны разворота)
  buildCommonPair(ctx, cp.half, {
    left_hint: 'J-Half',
    right_hint: 'J-Half',
    slot_filter: { photos_half: 2 },
    photos_per_page: 2,
    placeholder_label: (n) => `halfphoto_${n}`,
    category_name: 'half',
  });

  // 4. quarter — J-Quarter (симметричный). slot_capacity = photos_quarter:2
  // согласно audit_notes мастера J-Quarter (2 фото четверти на странице).
  buildCommonPair(ctx, cp.quarter, {
    left_hint: 'J-Quarter',
    right_hint: 'J-Quarter',
    slot_filter: { photos_quarter: 2 },
    photos_per_page: 2,
    placeholder_label: (n) => `quarterphoto_${n}`,
    category_name: 'quarter',
  });

  // 5. sixth (1/6 класса) — J-Collage (симметричный). ВНИМАНИЕ: ключ в
  // slot_capacity у J-Collage в БД называется photos_collage (исторический
  // legacy с тех пор когда категорию называли "коллаж"). Поле в
  // CommonPhotos называется sixth — это явное различие, сохранено в коде.
  // В будущем стоит переименовать в БД на photos_sixth для консистентности
  // (отдельная миграция, см. master-cleanup-tz).
  buildCommonPair(ctx, cp.sixth, {
    left_hint: 'J-Collage',
    right_hint: 'J-Collage',
    slot_filter: { photos_collage: 6 },
    photos_per_page: 6,
    placeholder_label: (n) => `collagephoto_${n}`,
    category_name: 'sixth',
  });
}

/**
 * Сборка одной категории общего раздела через пару одностраничных J-* мастеров.
 *
 * Разбивает входной массив `photos` на группы размера `photos_per_page * 2`
 * (фото на разворот). Для каждой группы добавляет в `ctx.spreads`:
 *   - Левая страница: left_hint мастер с photo_per_page слотами
 *   - Правая страница: right_hint мастер с photo_per_page слотами
 *
 * Edge cases:
 *   - photos.length === 0 → ничего не делаем (тихо)
 *   - left_hint мастер не нашёлся → warning common_section_skipped, return
 *   - right_hint мастер не нашёлся (когда отличается от left_hint) →
 *     warning right_mirror_not_found, fallback на left_hint мастер
 *   - последняя группа неполная (фото < photos_per_page * 2) → правая
 *     страница пропускается с warning common_right_page_empty, либо
 *     заполняется частично с null для пустых слотов
 */
function buildCommonPair(
  ctx: PresetBuildContext,
  photos: string[],
  opts: CommonPairOpts,
): void {
  if (photos.length === 0) return;

  // Найти левый мастер
  const leftR = findMaster(ctx.templateSet.spreads, {
    page_role: 'common',
    applies_to_config: ctx.cfgType,
    slot_capacity_min: opts.slot_filter,
    expected_name_hint: opts.left_hint,
  });
  if (!leftR.ok) {
    pushWarning(ctx, {
      code: 'common_section_skipped',
      detail: `common_${opts.category_name}: ${opts.left_hint} не найден, ${photos.length} фото не размещены`,
    });
    return;
  }
  if (leftR.warning) pushWarning(ctx, leftR.warning);
  const leftMaster = leftR.master;

  // Найти правый мастер — либо тот же (если симметричный), либо отдельный
  let rightMaster: SpreadTemplate;
  if (opts.left_hint === opts.right_hint) {
    rightMaster = leftMaster;
  } else {
    const rightR = findMaster(ctx.templateSet.spreads, {
      page_role: 'common',
      applies_to_config: ctx.cfgType,
      slot_capacity_min: opts.slot_filter,
      expected_name_hint: opts.right_hint,
    });
    if (!rightR.ok) {
      pushWarning(ctx, {
        code: 'right_mirror_not_found',
        detail: `common_${opts.category_name}: ${opts.right_hint} не найден, используется ${opts.left_hint} вместо зеркала`,
      });
      rightMaster = leftMaster;
    } else {
      if (rightR.warning) pushWarning(ctx, rightR.warning);
      rightMaster = rightR.master;
    }
  }

  // Группируем фото по разворотам
  const photos_per_spread = opts.photos_per_page * 2;
  const groups = chunk(photos, photos_per_spread);

  for (const group of groups) {
    const left_photos = group.slice(0, opts.photos_per_page);
    const right_photos = group.slice(opts.photos_per_page);

    // Левая страница
    const left_data: Record<string, string | null> = {};
    for (let i = 0; i < opts.photos_per_page; i++) {
      const label = opts.placeholder_label(i + 1);
      left_data[label] = left_photos[i] ?? null;
    }
    ctx.spreads.push({
      spread_index: ctx.spreadCounter.value++,
      template_id: leftMaster.id,
      template_name: leftMaster.name,
      data: left_data,
    });

    // Правая страница — только если есть хотя бы одно фото справа
    if (right_photos.length > 0) {
      const right_data: Record<string, string | null> = {};
      for (let i = 0; i < opts.photos_per_page; i++) {
        const label = opts.placeholder_label(i + 1);
        right_data[label] = right_photos[i] ?? null;
      }
      ctx.spreads.push({
        spread_index: ctx.spreadCounter.value++,
        template_id: rightMaster.id,
        template_name: rightMaster.name,
        data: right_data,
      });
    } else {
      // Нечётное количество фото — последняя группа без правой
      pushWarning(ctx, {
        code: 'common_right_page_empty',
        detail: `common_${opts.category_name}: разворот с пустой правой страницей (${left_photos.length} из ${opts.photos_per_page} фото на левой)`,
      });
    }
  }
}

// ─── Grid helpers ─────────────────────────────────────────────────────────

/**
 * Заполнить data объект для grid-страницы. Студенты идут с `_1, _2, …, _N`,
 * пустые слоты — `null` (для скрытия placeholder'ов в фазе 2-4 рендера).
 * Все ключи в lowercase (idml-recon §6.4): `studentportrait_N`,
 * `studentname_N`, и опционально `studentquote_N` если `hasQuote=true`.
 */
function buildGridStudentData(
  students: Student[],
  slotsPerPage: number,
  hasQuote: boolean,
): Record<string, string | null> {
  const data: Record<string, string | null> = {};
  for (let i = 0; i < students.length; i++) {
    const n = i + 1;
    data[`studentportrait_${n}`] = students[i].portrait;
    data[`studentname_${n}`] = students[i].full_name;
    if (hasQuote) {
      data[`studentquote_${n}`] = students[i].quote;
    }
  }
  for (let n = students.length + 1; n <= slotsPerPage; n++) {
    data[`studentportrait_${n}`] = null;
    data[`studentname_${n}`] = null;
    if (hasQuote) {
      data[`studentquote_${n}`] = null;
    }
  }
  return data;
}

/**
 * Возвращает grid-мастер с **максимальной** `slot_capacity.students` среди
 * доступных кандидатов. Используется для clamping в adaptive grid:
 * нужно знать максимальный capacity ДО выбора оптимального через `pickAdaptiveGrid`.
 */
function pickAdaptiveGridMaxCapacity(
  ctx: PresetBuildContext,
  baseFilter: MasterFilter,
): SpreadTemplate | null {
  const filter: MasterFilter = { ...baseFilter, applies_to_config: ctx.cfgType };
  const candidates = ctx.templateSet.spreads.filter((s) => {
    if (s.page_role !== filter.page_role) return false;
    if (s.default_for_configs.indexOf(filter.applies_to_config) < 0) return false;
    return s.slot_capacity !== null && typeof s.slot_capacity.students === 'number';
  });

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const aCap = a.slot_capacity?.students ?? 0;
    const bCap = b.slot_capacity?.students ?? 0;
    return bCap - aCap;
  });

  return candidates[0];
}

/**
 * Возвращает grid-мастер с **минимально-достаточной** `slot_capacity.students`
 * для `required_capacity = ceil(totalStudents / basePages)`. Если ни один
 * не подходит — fallback на максимальный + warning `adaptive_grid_fallback`.
 * Если кандидатов нет — `null` (вызывающая сторона пишет `master_not_found`).
 */
function pickAdaptiveGrid(
  ctx: PresetBuildContext,
  baseFilter: MasterFilter,
  totalStudents: number,
  basePages: number,
): SpreadTemplate | null {
  const filter: MasterFilter = { ...baseFilter, applies_to_config: ctx.cfgType };
  const requiredCapacity = Math.ceil(totalStudents / basePages);

  const candidates = ctx.templateSet.spreads.filter((s) => {
    if (s.page_role !== filter.page_role) return false;
    if (s.default_for_configs.indexOf(filter.applies_to_config) < 0) return false;
    return s.slot_capacity !== null && typeof s.slot_capacity.students === 'number';
  });

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const aCap = a.slot_capacity?.students ?? 0;
    const bCap = b.slot_capacity?.students ?? 0;
    return aCap - bCap;
  });

  for (let i = 0; i < candidates.length; i++) {
    const cap = candidates[i].slot_capacity?.students ?? 0;
    if (cap >= requiredCapacity) {
      return candidates[i];
    }
  }

  const fallback = candidates[candidates.length - 1];
  pushWarning(ctx, {
    code: 'adaptive_grid_fallback',
    detail: `${ctx.cfgType}: required capacity=${requiredCapacity} (для ${totalStudents} учеников на ${basePages} страниц), max available=${fallback.slot_capacity?.students ?? 0}, выбран ${fallback.name}`,
  });
  return fallback;
}

/**
 * Сборка overflow-row страницы (Лайт/Мини). Заполняет `studentportrait_N`/
 * `studentname_N` (без quote — у overflow-row мастеров нет цитатных слотов)
 * и опционально `classphotoframe` из `common_photos.full_class[0]`.
 */
function buildOverflowRow(
  ctx: PresetBuildContext,
  master: SpreadTemplate,
  students: Student[],
  rowCapacity: number,
): void {
  const data = buildGridStudentData(students, rowCapacity, false);

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

  ctx.spreads.push({
    spread_index: ctx.spreadCounter.value++,
    template_id: master.id,
    template_name: master.name,
    data,
  });
}

// ─── Helpers (data builders) ──────────────────────────────────────────────

/**
 * Динамический выбор правого мастера учительского разворота на основе
 * `common_photos`. Адаптировано из `build.ts:pickRightCommonPhotoMaster`.
 *
 * 1) `common_photos.half >= 2`        → G-HalfClass
 * 2) `common_photos.full_class >= 1`  → G-FullClass
 * 3) иначе                            → null
 */
function pickRightCommonPhotoMaster(ctx: PresetBuildContext): SpreadTemplate | null {
  const cp = ctx.input.common_photos;
  const spreads = ctx.templateSet.spreads;

  if (cp.half.length >= 2) {
    const r = findMaster(spreads, {
      page_role: 'teacher_right',
      applies_to_config: ctx.cfgType,
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
      applies_to_config: ctx.cfgType,
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
 * Заполнение левой страницы учительского разворота (F-*).
 * Адаптировано из `build.ts:buildTeacherLeftData`.
 */
function buildTeacherLeftData(
  ctx: PresetBuildContext,
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
 * Адаптировано из `build.ts:buildTeacherRightData`.
 */
function buildTeacherRightData(
  ctx: PresetBuildContext,
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

/**
 * Заполнение одностраничной ученической страницы (E-Student-Left/Right,
 * E-Max-Right, E-Ind-Right-3 и т.п.) — портрет, имя, цитата + N слотов
 * фото с друзьями. `friendSlots` — фактическое число слотов в выбранном мастере;
 * `s.friend_photos[i] ?? null` заполняет недостающие слоты null'ами.
 */
function studentSinglePageData(
  s: Student,
  friendSlots: number,
): Record<string, string | null> {
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

/** Проверка что в `placeholders` мастера есть placeholder с заданным `label`. */
function hasPlaceholder(master: SpreadTemplate, label: string): boolean {
  for (let i = 0; i < master.placeholders.length; i++) {
    if (master.placeholders[i].label === label) return true;
  }
  return false;
}

/**
 * Проверка что в `placeholders` мастера есть placeholder, label которого
 * начинается с заданного префикса. Используется для динамического определения
 * `hasQuote` у last-мастера (наличие `studentquote_N`-слотов).
 */
function hasPlaceholderPrefix(master: SpreadTemplate, prefix: string): boolean {
  for (let i = 0; i < master.placeholders.length; i++) {
    if (master.placeholders[i].label.indexOf(prefix) === 0) return true;
  }
  return false;
}
