/**
 * buildAlbumFromPreset — новый builder, работающий напрямую с Preset (фаза 0.5.3.1).
 *
 * Архитектурный путь Г1: прямое переписывание под Preset, без промежуточного
 * ScenarioDef. Старый `build.ts` и `scenarios.ts` продолжают работать
 * параллельно — old smoke 58/58 на старом builder'е остаётся зелёным.
 * Удаление старого builder'а — в подэтапе 0.5.3.4.
 *
 * Статус 0.5.3.1 (скелет):
 *   ✅ Validation, empty students guard
 *   ✅ Intro section (только soft)
 *   ✅ Teacher section: layout='two_page' (F+G как в layflat) и
 *      layout='one_page' (F-*-R как в Mini-soft)
 *   ⏳ Student section dispatcher — заглушки:
 *      - single_page_per_student   (TODO 0.5.3.2)
 *      - spread_per_student        (TODO 0.5.3.2)
 *      - grid_multiple_students    (TODO 0.5.3.3)
 *   ⏳ Thumbnails section          (TODO 0.5.3.3)
 *
 * Builder из 0.5.3.1 НЕ используется production-кодом (`/api/layout` и smoke
 * продолжают работать через старый buildAlbum). Внутренний экспорт без
 * подключения к index.ts — будет открыт в 0.5.3.4.
 */

import type {
  AlbumInput,
  BuildResult,
  BuildWarning,
  ConfigType,
  HeadTeacher,
  PageRole,
  Preset,
  PrintType,
  SlotCapacity,
  SpreadInstance,
  SpreadTemplate,
  Subject,
  TemplateSet,
} from './types';
import { findMaster } from './find-master';

// ─── Локальные типы ──────────────────────────────────────────────────────

/**
 * Локальный аналог `MasterFilter` из `scenarios.ts`. Структурно идентичен,
 * совместим с `findMaster`. В 0.5.3.4 при удалении scenarios.ts остаётся
 * только эта копия.
 */
type MasterFilter = {
  page_role: PageRole;
  applies_to_config: ConfigType;
  slot_capacity_min?: Partial<SlotCapacity>;
  is_spread?: boolean;
  is_fallback_allowed?: boolean;
  expected_name_hint?: string;
};

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

export function buildAlbumFromPreset(
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
  const mode = preset.config.student_section.base_layout_mode;
  if (mode === 'single_page_per_student') {
    buildSinglePagePerStudent(ctx);
  } else if (mode === 'spread_per_student') {
    buildSpreadPerStudent(ctx);
  } else if (mode === 'grid_multiple_students') {
    buildGridStudents(ctx);
  }

  // Раздел 4 — thumbnails (только для Индивидуального; в Лайт/Мини не имеет смысла)
  const thumbnails = preset.config.student_section.thumbnails_section;
  if (
    thumbnails !== null &&
    thumbnails.enabled &&
    mode !== 'grid_multiple_students'
  ) {
    buildThumbnailsSection(ctx);
  }

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

// ─── Stubs (TODO 0.5.3.2 / 0.5.3.3) ───────────────────────────────────────

function buildSinglePagePerStudent(ctx: PresetBuildContext): void {
  pushWarning(ctx, {
    code: 'master_not_found',
    detail: 'TODO: buildSinglePagePerStudent not yet implemented (0.5.3.2)',
  });
}

function buildSpreadPerStudent(ctx: PresetBuildContext): void {
  pushWarning(ctx, {
    code: 'master_not_found',
    detail: 'TODO: buildSpreadPerStudent not yet implemented (0.5.3.2)',
  });
}

function buildGridStudents(ctx: PresetBuildContext): void {
  pushWarning(ctx, {
    code: 'master_not_found',
    detail: 'TODO: buildGridStudents not yet implemented (0.5.3.3)',
  });
}

function buildThumbnailsSection(ctx: PresetBuildContext): void {
  pushWarning(ctx, {
    code: 'master_not_found',
    detail: 'TODO: buildThumbnailsSection not yet implemented (0.5.3.3)',
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

/** Проверка что в `placeholders` мастера есть placeholder с заданным `label`. */
function hasPlaceholder(master: SpreadTemplate, label: string): boolean {
  for (let i = 0; i < master.placeholders.length; i++) {
    if (master.placeholders[i].label === label) return true;
  }
  return false;
}
