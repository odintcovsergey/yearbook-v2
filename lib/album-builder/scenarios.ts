/**
 * Декларативная конфигурация сборки альбомов по комплектациям.
 *
 * В фазе 0.9 — только фундамент: `student_section` для трёх layflat-комплектаций
 * (Стандарт/Универсал/Максимум). Расширения подключим в следующих подэтапах:
 *
 * - 0.10 — добавим `teacher_section` (F+G пары по числу subjects),
 *          `overflow`/`last`/`mirror` поля в StudentSection,
 *          и комплектацию Медиум.
 * - 0.11 — `common_section` (общий раздел, flex_A/B/C — но в фазе 0
 *          buildAlbum его не генерирует, см. idml-recon §9; форма
 *          оставлена на будущее), soft-intro для S-Intro, и комплектации
 *          Лайт/Мини/Индивидуальный.
 *
 * Триумо — отдельный продукт вне фазы 0 (см. memory
 * `project_phase0_tryumo_separate_masters`).
 *
 * Подход — гибридный: основное соответствие мастера задаётся семантическими
 * тегами (page_role + applies_to_config + slot_capacity_min + is_spread),
 * а `expected_name_hint` — только подсказка для логов и тестов 0.10/0.12.
 * Если найденный мастер не совпал с `expected_name_hint`, builder пишет
 * warning `name_mismatch`, но продолжает работу.
 *
 * Форма `MasterFilter` — рабочий черновик; уточним при написании
 * `findMaster()` в 0.10.
 */

import type {
  ConfigType,
  PageRole,
  PrintType,
  SlotCapacity,
} from './types';

/**
 * Семантический фильтр для поиска мастера в `template_set.spreads`.
 *
 * `slot_capacity_min` — минимальная требуемая ёмкость по соответствующим
 * ключам. Кандидат проходит, если для каждого присутствующего ключа
 * `candidate.slot_capacity[key] >= filter[key]`.
 *
 * `is_fallback_allowed` — по умолчанию `false`: fallback-мастера
 * (`is_fallback=true`, например `E-Student-Default`) рассматриваются только
 * когда специализированный кандидат не нашёлся.
 */
export type MasterFilter = {
  page_role: PageRole;
  applies_to_config: ConfigType;
  slot_capacity_min?: Partial<SlotCapacity>;
  is_spread?: boolean;
  is_fallback_allowed?: boolean;
  expected_name_hint?: string;
};

/**
 * Конфигурация специального последнего разворота для grid-комплектаций (Медиум).
 *
 * Применяется когда в обычном grid-потоке остался остаток учеников в диапазоне
 * [`remainder_min`, `remainder_max`]. Например, для Медиум: при остатке 1-2 ученика
 * используется D-Medium-Last-WithPhoto на левой странице + динамический G-*
 * мастер (HalfClass/FullClass/null) на правой.
 *
 * Если remainder вне диапазона — last_spread не активируется, остаток ложится
 * на обычный grid-мастер с пустыми слотами + warning `students_grid_no_special_master`.
 */
export type LastSpread = {
  /** Минимум remainder для активации (включительно). */
  remainder_min: number;
  /** Максимум remainder для активации (включительно). */
  remainder_max: number;
  /** Фильтр для левого мастера (например D-Medium-Last-WithPhoto). */
  left_filter: MasterFilter;
  /** Сколько учеников помещается в left мастере (например 2 для D-Medium-Last-WithPhoto). */
  left_slots_per_page: number;
  /** Содержит ли left мастер слоты для цитаты. */
  left_has_quote: boolean;
  /**
   * Использовать ли `pickRightCommonPhotoMaster` для правой страницы.
   * - `true` → динамический выбор G-HalfClass/G-FullClass/null по common_photos
   * - `false` → правая страница не генерируется
   */
  right_dynamic: boolean;
};

/**
 * Конфигурация ученического раздела одной комплектации.
 *
 * `students_per_unit` — сколько учеников вмещает одна единица шаблона.
 * `unit_is_spread` — true, если единица — разворот (1 SpreadInstance c
 * `is_spread=true` или пара одностраничных мастеров логически связанных
 * как разворот, как в Maximum: E-Max-Left + E-Max-Right).
 *
 * Поля для overflow/last/mirror добавим в 0.10b/0.11 — здесь они не нужны
 * (Стандарт/Универсал/Максимум не требуют overflow-логики).
 */
export type StudentSection = {
  students_per_unit: number;
  unit_is_spread: boolean;
  student_master_filter: MasterFilter;
  /**
   * Второй фильтр для пары/чередования. Если задан — должен быть и
   * `right_filter_mode`, иначе buildAlbum пишет warning и пропускает секцию.
   */
  student_master_filter_right?: MasterFilter;
  /**
   * Как использовать `student_master_filter_right`:
   *
   * - `'alternate'` — Универсал: разные ученики Left/Right по чётности
   *   (0,2,4… → Left; 1,3,5… → Right).
   * - `'paired'` — Максимум: один ученик на двух логически связанных страницах
   *   (Left=портрет+имя, Right=4 фото+цитата; каждый ученик = 2 SpreadInstance подряд).
   * - `'grid_alternate'` — Медиум: chunk по N учеников, чередование Left/Right
   *   по чётности индекса страницы (НЕ ученика).
   * - `undefined` — second filter не используется (Стандарт: один
   *   двухстраничный мастер на пару учеников).
   */
  right_filter_mode?: 'alternate' | 'paired' | 'grid_alternate';
  /**
   * Содержат ли мастера grid-комплектации слот для цитаты (`studentquote_N`).
   * По умолчанию `false`. `true` для Медиум.
   */
  has_quote?: boolean;
  /**
   * Конфигурация специального последнего разворота. Применяется только при
   * `right_filter_mode === 'grid_alternate'`. По умолчанию `undefined`.
   */
  last_spread?: LastSpread;
};

/**
 * Один вариант учительского разворота. Применяется когда `subjects.length`
 * попадает в диапазон [`subjects_min`, `subjects_max`] (включительно).
 */
export type TeacherSpreadVariant = {
  /** Минимум `subjects.length` для применения. */
  subjects_min: number;
  /** Максимум `subjects.length` для применения. */
  subjects_max: number;
  /** Сколько subjects уходит на левую страницу (F-*). */
  subjects_on_left: number;
  /** Сколько subjects уходит на правую страницу (G-*). undefined — динамический выбор. */
  subjects_on_right?: number;
  /**
   * Фильтр для левого мастера (F-*). `applies_to_config` — заглушка,
   * подменяется в runtime из `ctx.config.config_type` (см. `buildTeacherSection`).
   */
  left_filter: MasterFilter;
  /**
   * Фильтр для правого мастера (G-*). `undefined` означает что правый мастер
   * выбирается динамически в `build.ts` → `pickRightTeacherMaster` по наличию
   * фото в `common_photos`. Актуально для subjects 0-8.
   */
  right_filter?: MasterFilter;
};

/**
 * Учительский раздел сценария — список вариантов в порядке проверки.
 * Алгоритм берёт первый где `subjects.length ∈ [min, max]`.
 */
export type TeacherSection = {
  variants: TeacherSpreadVariant[];
};

/**
 * Полное описание сценария одной комплектации. В 0.10b.2 добавлен
 * `teacher_section` (опциональный); `common_section` остаётся отсутствовать
 * (общий раздел не генерируется в фазе 0, см. idml-recon §9).
 */
export type ScenarioDef = {
  config_type: ConfigType;
  print_type: PrintType;
  description: string;
  student_section: StudentSection;
  /** Опционально — учительский раздел. Если undefined, секция не генерируется. */
  teacher_section?: TeacherSection;
};

/**
 * Учительский раздел для layflat-печати. Применим к Стандарту/Универсалу/
 * Максимуму/Медиуму. Mini-soft (одностраничная учительская секция с F-*-R)
 * — отдельная константа в 0.11.
 *
 * Семь вариантов по `subjects.length`. Поведение для `subjects.length >= 25`
 * — degraded: `buildTeacherSection` обрезает до 24 и пишет warning
 * `subjects_overflow`.
 *
 * `applies_to_config` во всех filter'ах — заглушка (`'standard'`), фактическое
 * значение подменяется в `buildTeacherSection` из `ctx.config.config_type`.
 */
export const TEACHER_SECTION_LAYFLAT: TeacherSection = {
  variants: [
    {
      subjects_min: 0, subjects_max: 0,
      subjects_on_left: 0,
      // subjects_on_right: undefined → dynamic
      left_filter: {
        page_role: 'teacher_left',
        applies_to_config: 'standard',
        slot_capacity_min: { head_teacher: 1, photos_full: 1 },
        expected_name_hint: 'F-Head-WithPhoto',
      },
      // right_filter: undefined → dynamic в коде
    },
    {
      subjects_min: 1, subjects_max: 4,
      subjects_on_left: 4,
      left_filter: {
        page_role: 'teacher_left',
        applies_to_config: 'standard',
        slot_capacity_min: { head_teacher: 1, teachers: 4 },
        expected_name_hint: 'F-Head-SmallGrid',
      },
    },
    {
      subjects_min: 5, subjects_max: 8,
      subjects_on_left: 8,
      left_filter: {
        page_role: 'teacher_left',
        applies_to_config: 'standard',
        slot_capacity_min: { head_teacher: 1, teachers: 8 },
        expected_name_hint: 'F-Head-LargeGrid',
      },
    },
    {
      subjects_min: 9, subjects_max: 9,
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
      subjects_min: 10, subjects_max: 12,
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
      subjects_min: 13, subjects_max: 16,
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
      subjects_min: 17, subjects_max: 24,
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
  ],
};

/**
 * Сценарии для layflat-печати. `Partial` — потому что в 0.9 заполнены
 * только три ключа; остальные комплектации появятся в 0.10/0.11. Soft-варианты
 * (отдельная константа `SCENARIOS_SOFT`) добавим там же.
 */
export const SCENARIOS_LAYFLAT: Partial<Record<ConfigType, ScenarioDef>> = {
  standard: {
    config_type: 'standard',
    print_type: 'layflat',
    description:
      'Стандарт — 1 разворот на 2 учеников (E-Student-Standard, is_spread=true)',
    student_section: {
      students_per_unit: 2,
      unit_is_spread: true,
      student_master_filter: {
        page_role: 'student',
        applies_to_config: 'standard',
        is_spread: true,
        slot_capacity_min: { students: 2 },
        expected_name_hint: 'E-Student-Standard',
      },
    },
    teacher_section: TEACHER_SECTION_LAYFLAT,
  },

  universal: {
    config_type: 'universal',
    print_type: 'layflat',
    description:
      'Универсал — по 1 ученику на странице, чередуем E-Student-Left/Right',
    student_section: {
      students_per_unit: 1,
      unit_is_spread: false,
      student_master_filter: {
        page_role: 'student_left',
        applies_to_config: 'universal',
        is_spread: false,
        slot_capacity_min: { students: 1, photos_friend: 2 },
        expected_name_hint: 'E-Student-Left',
      },
      student_master_filter_right: {
        page_role: 'student_right',
        applies_to_config: 'universal',
        is_spread: false,
        slot_capacity_min: { students: 1, photos_friend: 2 },
        expected_name_hint: 'E-Student-Right',
      },
      right_filter_mode: 'alternate',
    },
    teacher_section: TEACHER_SECTION_LAYFLAT,
  },

  maximum: {
    config_type: 'maximum',
    print_type: 'layflat',
    description:
      'Максимум — 1 разворот на ученика (пара одностраничных E-Max-Left + E-Max-Right)',
    student_section: {
      students_per_unit: 1,
      unit_is_spread: true,
      // E-Max-Left реально содержит только портрет+имя (idml-recon §5 #9),
      // в БД slot_capacity = {students:1} без photos_friend — поэтому
      // фильтр для левой не требует photos_friend.
      student_master_filter: {
        page_role: 'student_left',
        applies_to_config: 'maximum',
        is_spread: false,
        slot_capacity_min: { students: 1 },
        expected_name_hint: 'E-Max-Left',
      },
      student_master_filter_right: {
        page_role: 'student_right',
        applies_to_config: 'maximum',
        is_spread: false,
        slot_capacity_min: { students: 1, photos_friend: 4 },
        expected_name_hint: 'E-Max-Right',
      },
      right_filter_mode: 'paired',
    },
    teacher_section: TEACHER_SECTION_LAYFLAT,
  },

  medium: {
    config_type: 'medium',
    print_type: 'layflat',
    description:
      'Медиум — сетка 4 ученика на странице (D-Medium-Left/Right с чередованием), последняя при остатке 1-2 — D-Medium-Last-WithPhoto + dynamic G-*',
    student_section: {
      students_per_unit: 4,
      unit_is_spread: false,
      has_quote: true,
      student_master_filter: {
        page_role: 'student_grid_left',
        applies_to_config: 'medium',
        slot_capacity_min: { students: 4 },
        expected_name_hint: 'D-Medium-Left',
      },
      student_master_filter_right: {
        page_role: 'student_grid_right',
        applies_to_config: 'medium',
        slot_capacity_min: { students: 4 },
        expected_name_hint: 'D-Medium-Right',
      },
      right_filter_mode: 'grid_alternate',
      last_spread: {
        remainder_min: 1,
        remainder_max: 2,
        left_filter: {
          page_role: 'student_last',
          applies_to_config: 'medium',
          slot_capacity_min: { students: 2, photos_full: 1 },
          expected_name_hint: 'D-Medium-Last-WithPhoto',
        },
        left_slots_per_page: 2,
        left_has_quote: true,
        right_dynamic: true,
      },
    },
    teacher_section: TEACHER_SECTION_LAYFLAT,
  },
};
