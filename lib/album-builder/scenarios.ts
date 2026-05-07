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
   * - `'alternate'` — Left и Right распределяют РАЗНЫХ учеников по чётности
   *   (Универсал: 0,2,4… → Left; 1,3,5… → Right).
   * - `'paired'` — Left и Right показывают ОДНОГО ученика на двух
   *   логически связанных страницах (Максимум: каждый ученик = 2 SpreadInstance
   *   подряд, Left=портрет+имя, Right=4 фото+цитата).
   * - `undefined` — second filter не используется (Стандарт: один
   *   двухстраничный мастер на пару учеников).
   */
  right_filter_mode?: 'alternate' | 'paired';
};

/**
 * Полное описание сценария одной комплектации. На 0.9 — только
 * `student_section`; `teacher_section`/`common_section` появятся в 0.10/0.11.
 */
export type ScenarioDef = {
  config_type: ConfigType;
  print_type: PrintType;
  description: string;
  student_section: StudentSection;
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
  },
};
