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
 * Конфигурация overflow для adaptive_grid комплектаций (Лайт/Мини).
 *
 * Применяется когда total > base_pages * slotsPerPage в buildAdaptiveGridStudents.
 *
 * Алгоритм веток:
 *  - overflow ≤ row_capacity (3 для L, 4 для N) → single overflow-row
 *  - overflow ≤ slotsPerPage → extra обычная сетка (leftMaster, неполная)
 *  - overflow > slotsPerPage → extra полная сетка + overflow-row-right
 *    (только Лайт 31-32; для Мини не достижимо: 36-24=12, 12 ≤ slotsPerPage=12)
 *
 * row_capacity берётся из найденного master.slot_capacity.students.
 */
export type AdaptiveGridOverflow = {
  /** Фильтр для overflow-row LEFT мастера (page_role='student_overflow'). */
  row_filter: MasterFilter;
  /**
   * Фильтр для overflow-row RIGHT мастера (page_role='student_overflow_right').
   * Опционально, нужно только для Лайт 31-32.
   */
  row_right_filter?: MasterFilter;
};

/**
 * Конфигурация секции учеников для Индивидуального.
 *
 * Особенность: на правой странице используется ОДИН ИЗ ДВУХ мастеров
 * в зависимости от friend_photos.length каждого ученика:
 *   - friend_photos.length ≤ 3 → right_filter_3 (E-Ind-Right-3 с 3 слотами)
 *   - friend_photos.length = 4 → right_filter_4 (E-Max-Right с 4 слотами)
 *
 * left_filter — общий для всех (E-Max-Left).
 */
export type IndividualStudentSection = {
  /** Фильтр для левой страницы (E-Max-Left). */
  left_filter: MasterFilter;
  /** Фильтр для правой страницы при friend_photos.length ≤ 3 (E-Ind-Right-3, 3 слота). */
  right_filter_3: MasterFilter;
  /** Фильтр для правой страницы при friend_photos.length = 4 (E-Max-Right, 4 слота). */
  right_filter_4: MasterFilter;
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
   * - `'adaptive_grid'` — Лайт/Мини: фиксированное `base_pages`, адаптивная сетка.
   *   Один и тот же мастер на всех страницах (его выбирает `pickAdaptiveGrid` по
   *   числу учеников и `base_pages`). Чередование Left/Right по чётности страницы.
   * - `undefined` — second filter не используется (Стандарт: один
   *   двухстраничный мастер на пару учеников).
   */
  right_filter_mode?: 'alternate' | 'paired' | 'grid_alternate' | 'adaptive_grid';
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
  /**
   * Базовое количество страниц для adaptive grid (4 для Лайт, 2 для Мини).
   * Используется только при `right_filter_mode === 'adaptive_grid'`.
   */
  base_pages?: number;
  /** Базовый фильтр для adaptive grid LEFT мастера. `applies_to_config` — заглушка. */
  grid_filter_left?: MasterFilter;
  /** Базовый фильтр для adaptive grid RIGHT мастера. `applies_to_config` — заглушка. */
  grid_filter_right?: MasterFilter;
  /**
   * Overflow-стратегия для adaptive_grid комплектаций. Применяется только
   * при right_filter_mode === 'adaptive_grid' и total > base_pages*slotsPerPage.
   * Если не задана — overflow обрезается с warning students_overflow.
   */
  overflow?: AdaptiveGridOverflow;
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
 * Один вариант одностраничной учительской секции для Mini-soft.
 *
 * В отличие от TeacherSpreadVariant — нет right_filter (правой страницы
 * вообще не существует), нет subjects_on_right.
 */
export type MiniSoftTeacherVariant = {
  subjects_min: number;
  subjects_max: number;
  /**
   * Сколько subjects уходит на единственную страницу (F-*-R мастер).
   * Для F-Head-WithPhoto-R = 0 (только головной), F-SmallGrid-R = 4, F-LargeGrid-R = 8.
   */
  subjects_on_page: number;
  /** Фильтр для F-*-R мастера. */
  filter: MasterFilter;
};

/**
 * Учительский раздел для Mini-soft. Одностраничный (без G-* справа).
 * Применяется через soft_overrides.teacher_section в mini.
 *
 * Поддерживает только subjects 0-8 (F-Head-*-R мастера). При subjects ≥ 9
 * — warning subjects_overflow + обрезка до 8 (использует LargeGrid-R).
 */
export type MiniSoftTeacherSection = {
  variants: MiniSoftTeacherVariant[];
};

/**
 * Конфигурация вступительной страницы (S-Intro).
 *
 * Используется только в soft-печати (через `soft_overrides`). В layflat
 * S-Intro не применяется — там альбом начинается сразу с учительского
 * разворота.
 *
 * Mini-soft — особый случай: `intro_section` в его `soft_overrides` явно
 * выставлен в `null` (S-Intro не создаётся), потому что первая страница
 * используется под учительский F-*-R мастер.
 *
 * Интерпретация поля `intro_section`:
 *   - `undefined` — не задано (используется базовое значение из ScenarioDef)
 *   - `null` — явно отключено (например, Mini-soft через soft_overrides)
 *   - `IntroSection` объект — описание секции
 */
export type IntroSection = {
  /** Фильтр для S-Intro мастера. */
  filter: MasterFilter;
};

/**
 * Override-поля для soft-печати. Применяются поверх базового `ScenarioDef`
 * при `print_type === 'soft'` через простой shallow-merge.
 *
 * Если поле задано в `soft_overrides` — оно заменяет соответствующее поле
 * базового сценария. Если не задано — остаётся базовое значение.
 *
 * Поля `config_type` и `description` не переопределяются (description можно,
 * если очень нужно).
 */
export type SoftOverrides = {
  description?: string;
  student_section?: StudentSection;
  individual_student_section?: IndividualStudentSection;
  student_thumbnails_section?: StudentSection;
  /**
   * Учительская секция при soft. В обычных случаях — TeacherSection
   * (двухстраничная). Для Mini-soft — MiniSoftTeacherSection (одностраничная).
   */
  teacher_section?: TeacherSection | MiniSoftTeacherSection;
  /** `null` — явно отключить S-Intro (Mini-soft); `undefined` — оставить базовое. */
  intro_section?: IntroSection | null;
};

/**
 * Полное описание сценария одной комплектации.
 *
 * Один `ScenarioDef` обслуживает оба типа печати (`layflat` и `soft`).
 * Layflat-поведение задаётся прямо в полях; soft-различия — через
 * `soft_overrides` (shallow merge поверх базы при `print_type === 'soft'`).
 *
 * `intro_section` обычно живёт только в `soft_overrides` — в layflat
 * вступительная страница не нужна. `common_section` отсутствует — общий
 * раздел в фазе 0 не генерируется (см. idml-recon §9).
 */
export type ScenarioDef = {
  config_type: ConfigType;
  description: string;
  student_section: StudentSection;
  /**
   * Опциональная альтернативная секция учеников для Индивидуального.
   * Если задана — используется ВМЕСТО student_section в buildAlbum.
   * student_section всё равно требуется как заглушка (типобезопасность).
   */
  individual_student_section?: IndividualStudentSection;
  /**
   * Опциональная вторая секция учеников (сетка-миниатюр в Индивидуальном).
   * Если задана — после личных разворотов запускается вторая buildStudentsSection.
   */
  student_thumbnails_section?: StudentSection;
  /**
   * Опционально — учительский раздел. Если undefined, секция не генерируется.
   * В layflat это всегда `TeacherSection` (двухстраничная); тип расширен
   * до `MiniSoftTeacherSection` ради shallow merge с soft_overrides
   * (Mini-soft подставляет одностраничную). Различение в runtime — через
   * type guard `isMiniSoftTeacherSection` в build.ts.
   */
  teacher_section?: TeacherSection | MiniSoftTeacherSection;
  /**
   * Опционально — вступительная страница (обычно задаётся в soft_overrides).
   * `null` — явно отключено (Mini-soft); `undefined` — не задано.
   */
  intro_section?: IntroSection | null;
  /** Override-поля при `print_type === 'soft'`. */
  soft_overrides?: SoftOverrides;
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
 * Учительский раздел для Mini-soft — одностраничный (F-*-R мастера).
 *
 * `applies_to_config` во всех filter'ах — заглушка ('mini'), фактически
 * подменяется в runtime из `ctx.config.config_type` в build.ts.
 *
 * При subjects ≥ 9 buildAlbum обрезает до 8 (LargeGrid-R) с warning subjects_overflow.
 */
export const TEACHER_SECTION_MINI_SOFT: MiniSoftTeacherSection = {
  variants: [
    {
      subjects_min: 0, subjects_max: 0,
      subjects_on_page: 0,
      filter: {
        page_role: 'teacher_left',
        applies_to_config: 'mini',
        slot_capacity_min: { photos_full: 1 },
        expected_name_hint: 'F-Head-WithPhoto-R',
      },
    },
    {
      subjects_min: 1, subjects_max: 4,
      subjects_on_page: 4,
      filter: {
        page_role: 'teacher_left',
        applies_to_config: 'mini',
        slot_capacity_min: { head_teacher: 1, teachers: 4 },
        expected_name_hint: 'F-Head-SmallGrid-R',
      },
    },
    {
      subjects_min: 5, subjects_max: 8,
      subjects_on_page: 8,
      filter: {
        page_role: 'teacher_left',
        applies_to_config: 'mini',
        slot_capacity_min: { head_teacher: 1, teachers: 8 },
        expected_name_hint: 'F-Head-LargeGrid-R',
      },
    },
  ],
};

/**
 * Стандартная конфигурация intro-секции для всех soft-комплектаций
 * кроме Mini-soft (там intro не используется).
 *
 * Ищет S-Intro мастер с `photos_full: 1`. S-Intro-Old (legacy, `is_fallback`)
 * отсеивается фильтром `applies_to_config` (у него `applies_to_configs=[]`).
 *
 * `applies_to_config` во `filter` — заглушка, подменяется в `buildIntroSection`
 * на `ctx.config.config_type`.
 */
export const INTRO_SECTION_S_INTRO: IntroSection = {
  filter: {
    page_role: 'intro',
    applies_to_config: 'standard',
    slot_capacity_min: { photos_full: 1 },
    expected_name_hint: 'S-Intro',
  },
};

/**
 * Сценарии всех комплектаций — описывают поведение для обоих типов печати
 * (`layflat` и `soft`).
 *
 * Layflat-поведение задаётся прямо в полях `student_section`/`teacher_section`/
 * `intro_section`. Soft-различия — через `soft_overrides` (shallow merge при
 * `print_type === 'soft'`).
 *
 * `Partial` — заполнены только реализованные комплектации; остальные
 * (Лайт/Мини/Индивидуальный) появятся в 0.11.1+.
 */
export const SCENARIOS: Partial<Record<ConfigType, ScenarioDef>> = {
  standard: {
    config_type: 'standard',
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
    soft_overrides: {
      intro_section: INTRO_SECTION_S_INTRO,
    },
  },

  universal: {
    config_type: 'universal',
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
    soft_overrides: {
      intro_section: INTRO_SECTION_S_INTRO,
    },
  },

  maximum: {
    config_type: 'maximum',
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
    soft_overrides: {
      intro_section: INTRO_SECTION_S_INTRO,
    },
  },

  medium: {
    config_type: 'medium',
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
    soft_overrides: {
      intro_section: INTRO_SECTION_S_INTRO,
    },
  },

  light: {
    config_type: 'light',
    description:
      'Лайт — фиксированно 4 базовые страницы, slotsPerPage адаптивный (2/3/4/6) под класс ≤24. При 25+ — overflow (0.11.2).',
    student_section: {
      students_per_unit: 0,
      unit_is_spread: false,
      base_pages: 4,
      has_quote: false,
      // student_master_filter — заглушка для backward compatibility типа;
      // adaptive_grid использует grid_filter_left/right.
      student_master_filter: {
        page_role: 'student_grid_left',
        applies_to_config: 'light',
        slot_capacity_min: { students: 1 },
      },
      grid_filter_left: {
        page_role: 'student_grid_left',
        applies_to_config: 'light',
      },
      grid_filter_right: {
        page_role: 'student_grid_right',
        applies_to_config: 'light',
      },
      right_filter_mode: 'adaptive_grid',
      overflow: {
        row_filter: {
          page_role: 'student_overflow',
          applies_to_config: 'light',
          expected_name_hint: 'L-Overflow-Row',
        },
        row_right_filter: {
          page_role: 'student_overflow_right',
          applies_to_config: 'light',
          expected_name_hint: 'L-Overflow-Row-Right',
        },
      },
    },
    teacher_section: TEACHER_SECTION_LAYFLAT,
    soft_overrides: {
      intro_section: INTRO_SECTION_S_INTRO,
    },
  },

  mini: {
    config_type: 'mini',
    description:
      'Мини — фиксированно 2 базовые страницы, slotsPerPage адаптивный (4/6/9/12) под класс ≤24. При 25+ — overflow (0.11.2).',
    student_section: {
      students_per_unit: 0,
      unit_is_spread: false,
      base_pages: 2,
      has_quote: false,
      student_master_filter: {
        page_role: 'student_grid_left',
        applies_to_config: 'mini',
        slot_capacity_min: { students: 1 },
      },
      grid_filter_left: {
        page_role: 'student_grid_left',
        applies_to_config: 'mini',
      },
      grid_filter_right: {
        page_role: 'student_grid_right',
        applies_to_config: 'mini',
      },
      right_filter_mode: 'adaptive_grid',
      overflow: {
        row_filter: {
          page_role: 'student_overflow',
          applies_to_config: 'mini',
          expected_name_hint: 'N-Overflow-Row',
        },
        // row_right_filter не задаём — Мини max 36-24=12, не доходит до grid+row
      },
    },
    teacher_section: TEACHER_SECTION_LAYFLAT,
    soft_overrides: {
      // Mini-soft: первая страница — учительская F-*-R, S-Intro отключён.
      intro_section: null,
      teacher_section: TEACHER_SECTION_MINI_SOFT,
    },
  },

  individual: {
    config_type: 'individual',
    description:
      'Индивидуальный — личный разворот на каждого ученика (E-Max-Left + E-Ind-Right-3 для ≤3 фото / E-Max-Right для 4 фото) + сетка миниатюр в конце как в Мини.',
    student_section: {
      // Заглушка для типобезопасности — реально используется individual_student_section
      students_per_unit: 1,
      unit_is_spread: true,
      student_master_filter: {
        page_role: 'student_left',
        applies_to_config: 'individual',
        slot_capacity_min: { students: 1 },
        expected_name_hint: 'E-Max-Left',
      },
    },
    individual_student_section: {
      left_filter: {
        page_role: 'student_left',
        applies_to_config: 'individual',
        slot_capacity_min: { students: 1 },
        expected_name_hint: 'E-Max-Left',
      },
      right_filter_3: {
        page_role: 'student_right',
        applies_to_config: 'individual',
        slot_capacity_min: { students: 1, photos_friend: 3 },
        expected_name_hint: 'E-Ind-Right-3',
      },
      right_filter_4: {
        page_role: 'student_right',
        applies_to_config: 'individual',
        slot_capacity_min: { students: 1, photos_friend: 4 },
        expected_name_hint: 'E-Max-Right',
      },
    },
    student_thumbnails_section: {
      students_per_unit: 0,
      unit_is_spread: false,
      base_pages: 2,
      has_quote: false,
      student_master_filter: {
        page_role: 'student_grid_left',
        applies_to_config: 'individual',
        slot_capacity_min: { students: 1 },
      },
      grid_filter_left: {
        page_role: 'student_grid_left',
        applies_to_config: 'individual',
      },
      grid_filter_right: {
        page_role: 'student_grid_right',
        applies_to_config: 'individual',
      },
      right_filter_mode: 'adaptive_grid',
      overflow: {
        row_filter: {
          page_role: 'student_overflow',
          applies_to_config: 'individual',
          expected_name_hint: 'N-Overflow-Row',
        },
        // row_right_filter не задаём — для Индивидуального тоже не доходит
      },
    },
    teacher_section: TEACHER_SECTION_LAYFLAT,
    soft_overrides: {
      intro_section: INTRO_SECTION_S_INTRO,
    },
  },
};
