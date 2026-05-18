/**
 * Rule Engine — TypeScript типы
 *
 * Соответствует спецификации: docs/rule-engine-spec.md v1.1 §7-9.
 * Все типы только для time-of-compilation; runtime-валидация — schemas.ts.
 */

// =============================================================================
// 1. Перечисления
// =============================================================================

export type Density =
  | 'maximum'
  | 'universal'
  | 'standard'
  | 'medium'
  | 'light'
  | 'mini';

export type PageType = 'page-left' | 'page-right' | 'page-any' | 'spread';

export type PrintType = 'layflat' | 'soft' | 'tryumo';

export type LayoutStatus = 'ok' | 'partial' | 'failed';

/**
 * РЭ.20: тип листов альбома.
 *
 * Влияет на структуру альбома:
 *  - `hard` (плотные) — нет S-Intro/S-Final, общий раздел начинается сразу
 *    после головного учительского.
 *  - `soft` (мягкие) — первая страница S-Intro, последняя S-Final.
 *
 * Логика правил для hard и soft одинаковая — отличается только
 * `Preset.max_pages` и наличие двух краевых intro/final-страниц.
 */
export type SheetType = 'hard' | 'soft';

/**
 * РЭ.20: плотность портретов student-section для пресета.
 *
 * Соответствует CHECK-constraint'у на колонке `presets.density`
 * (миграция 2026-05-18-presets-total-pages-density-sheet-type.sql).
 *
 * Отличается от существующего `Density` отсутствием `'maximum'`:
 * комплектация Максимум не покрывается дизайнерской матрицей
 * (`docs/templates/album-structure-matrix.json`) и пока обрабатывается
 * отдельной логикой (density=NULL или standard по решению РЭ.20.5).
 */
export type PresetDensity =
  | 'standard'
  | 'universal'
  | 'medium'
  | 'light'
  | 'mini';

/**
 * РЭ.20: паттерн страницы общего раздела из дизайнерской матрицы.
 *
 * Каждая ячейка matrix.mandatory_section_pages /
 * matrix.additional_section_pages → один из этих паттернов.
 * Алгоритм планирования (РЭ.20.4) обходит массив паттернов и подставляет
 * соответствующего мастера из template_families.
 *
 * Случай `alternative` означает «либо X, либо Y, либо Z» — выбор
 * по наличию фотоматериала (см. phase-Р20-spec.md §2.3):
 *   1. ≥6 sixth → sixth_six
 *   2. ≥2 half_class → half_pair
 *   3. ≥1 full_class → full_one
 *   4. иначе skip (пустой слот, партнёр заполнит в редакторе)
 */
export type PagePattern =
  | { type: 'quarter_pair' } // «2 по 1/4 класса»
  | { type: 'half_pair' } // «2 по 1/2 класса»
  | { type: 'full_one' } // «1 общая»
  | { type: 'sixth_six' } // «6 фото 1/6»
  | { type: 'alternative'; options: PagePattern[] }; // «либо X, либо Y, либо Z»

// =============================================================================
// 2. Семейства мастеров (template_families)
// =============================================================================

export type FamilyId = string; // 'head-teacher' | 'student-section' | ...

export type FamilyVersion = string; // '1.0', '1.1', ...

export interface FamilyParam {
  type: 'enum' | 'boolean' | 'number' | 'string';
  values?: unknown[];
  default?: unknown;
  required?: boolean;
  description?: string;
}

export interface DensityConfig {
  capacity_per_side: number;
  capacity_per_spread: number;
}

export interface TemplateFamily {
  id: FamilyId;
  display_name: string;
  aliases: string[];
  deprecated: boolean;
  version: FamilyVersion;
  tenant_id: string | null;
  params: Record<string, FamilyParam>;
  density_config?: Partial<Record<Density, DensityConfig>> | null;
  created_at?: string;
  updated_at?: string;
}

// =============================================================================
// 3. Правила (rules) — when clause
// =============================================================================

export type WhenOperator =
  | number
  | string
  | boolean
  | { eq: unknown }
  | { neq: unknown }
  | { gte: number }
  | { lte: number }
  | { gt: number }
  | { lt: number }
  | { between: [number, number] }
  | { in: unknown[] }
  | { not_in: unknown[] }
  | { has: boolean }
  | { count_gte: number }
  | { count_lte: number }
  | { count_between: [number, number] };

export type WhenClause = Record<string, WhenOperator>;

// =============================================================================
// 4. Правила (rules) — produces clause
// =============================================================================

export interface MasterSelector {
  /** Имя параметрического мастера (например 'L-Grid-Page'). */
  parametric: string;
  /** Параметры для конкретного режима — slot_count, grid_mode и т.п. */
  params: Record<string, string | number>;
}

export type MasterRef = string | MasterSelector;

export interface ProducesSpread {
  type: 'spread';
  left_master: MasterRef;
  right_master: MasterRef;
  /** Если правило срабатывает при висящей правой странице — true. */
  start_on_right_page?: boolean;
}

export interface ProducesPage {
  type: 'page';
  side: 'left' | 'right' | 'any';
  master: MasterRef;
}

export interface ProducesSequence {
  type: 'sequence';
  steps: Array<ProducesSpread | ProducesPage>;
}

export type Produces = ProducesSpread | ProducesPage | ProducesSequence;

// =============================================================================
// 5. Правила (rules) — bind clause
// =============================================================================

/**
 * Значение для одной метки placeholder'а.
 *
 * Варианты:
 * - Строка-путь: 'input.head_teacher.photo'
 * - Параметрический шаблон: { template, params }
 * - Вычисляемое выражение: { expr }
 * - Любая комбинация с модификаторами (skip_if).
 */
export type BindValue =
  | string
  | {
      template?: string;
      params?: Record<string, unknown>;
      expr?: string;
      /** Если выражение возвращает true — пропустить эту метку. */
      skip_if?: string;
    };

/** Метки мастера → значения, которые подставить. */
export type Bind = Record<string, BindValue>;

// =============================================================================
// 6. Правила (rules) — consumes / balance / variants
// =============================================================================

export interface ConsumesClause {
  students?: number | string;
  common_photos?: {
    full_class?: number;
    half_class?: number;
    spread?: number;
    quarter?: number;
    sixth?: number;
  };
  /**
   * РЭ.20.6: бюджет страниц альбома (preset.max_pages).
   * Сколько страниц данное правило «тратит» из общего лимита.
   *
   * Используется правилами общего раздела чтобы соблюсти
   * preset.max_pages. Декрементирует cursor.current_consumed_pages,
   * соответственно ctx.pages_remaining уменьшается на каждом цикле.
   *
   * Типичные значения: 1 для одиночной страницы (intro, final),
   * 2 для разворота (J-Half pair, J-Full pair, ...), 3 для трюмо.
   */
  pages?: number;
  /**
   * РЭ.20.6: продвижение по mandatory_section.pages_pattern.
   *
   * Когда правило обслуживает текущий паттерн mandatory_section
   * (т.е. when'у matched по `mandatory_section.current_index`),
   * оно потребляет `pages: 1` из mandatory_section — что инкрементирует
   * cursor.current_mandatory_page_index. На следующей итерации
   * ctx.mandatory_section.current_index указывает на следующую ячейку.
   *
   * Это позволяет линейно обходить массив паттернов матрицы:
   * первое правило mandatory обрабатывает index=0, потом index=1,
   * и т.д. до конца.
   */
  mandatory_section?: {
    pages?: number;
  };
}

export interface BalanceClause {
  placeholder_centering?: boolean;
  hide_unfilled?: boolean;
}

export interface Rule {
  id: string;
  family_id: FamilyId;
  family_version: FamilyVersion;
  priority: number;
  when: WhenClause;
  produces: Produces;
  /** master_name → bindings для этого мастера. */
  bind?: Record<string, Bind>;
  consumes?: ConsumesClause;
  balance?: BalanceClause;
  variants?: Rule[];
  display_name?: string;
  description?: string;
  enabled?: boolean;
}

// =============================================================================
// 7. Пресеты (presets)
// =============================================================================

export interface SectionParams {
  density?: Density;
  /** Допустимо для max/universal/standard (см. §4.4). */
  has_quote?: boolean;
  /** Допустимо для max/universal (см. §4.4). */
  has_friend_photos?: boolean;
  friend_photos_max?: 2 | 3 | 4;
  /** Источник портрета. В MVP всегда 'default'. */
  portrait_source?: string;
}

export interface Section {
  family_id: FamilyId;
  params?: SectionParams;
  enabled_when?: WhenClause;
  display_name?: string;
}

// -----------------------------------------------------------------------------
// РЭ.21.8: section_structure — высокоуровневая структура альбома, редактируемая
// партнёром в UI редактора пресетов (РЭ.21.3 → РЭ.21.7).
//
// Логически независима от `Preset.sections` (старая модель для rule engine):
//   - `Preset.sections`         — список семейств правил для buildFromRules
//                                  (head-teacher / student-section / ...);
//                                  читается через JSON-правила в БД.
//   - `Preset.section_structure` — массив секций альбома в порядке появления,
//                                  с описанием слотов внутри общего раздела.
//                                  Читается новым build engine
//                                  (`buildFromSectionStructure`, РЭ.21.8.3+).
//
// Семантика и whitelist строго совпадают с серверным валидатором
// `validateSectionStructure` в app/api/tenant/route.ts и с UI-справочниками
// `SECTION_TYPE_ORDER` / `SLOT_TYPE_ORDER` в app/app/page.tsx.
//
// Источники:
//   - docs/album-structure-inventory.md §1 (структура альбома) и §5 (общий
//     раздел и слоты H/Q/FULL/flex_A/B/C).
// -----------------------------------------------------------------------------

/**
 * Тип слота внутри секции `common`.
 *
 * Семантика «цепочки попыток» (см. album-structure-inventory.md §5):
 *  - `H`      — страница «2 фото 1/2 класса» через J-Half.
 *  - `Q`      — страница «2 фото 1/4 класса» через J-Quarter.
 *  - `FULL`   — страница «1 общее фото» через J-ClassPhoto / J-ClassPhoto-Right.
 *  - `flex_A` — крупный приоритет: J-Collage (6×1/6) → J-Half (2×1/2) → J-Full.
 *  - `flex_B` — всё попробовать: J-Quarter → J-Collage → J-Half → J-Full.
 *  - `flex_C` — правая нечётная (мост от портретов): J-Half → J-Collage
 *               → J-ClassPhoto-Right.
 *
 * Каждый слот = одна страница (РЭ.21.8). Цепочки реализуются как чистые
 * функции в `lib/rule-engine/slot-chains/` в РЭ.21.8.2.
 */
export type SlotType = 'H' | 'Q' | 'FULL' | 'flex_A' | 'flex_B' | 'flex_C';

/**
 * Тип верхнеуровневой секции альбома.
 *
 * Порядок появления в альбоме фиксированный (см. album-structure-inventory.md §1),
 * но партнёр может опустить любую секцию.
 *
 *  - `soft_intro` — первая правая страница, только для `sheet_type='soft'`.
 *  - `teachers`   — учительский разворот: классрук + предметники / общее фото.
 *  - `students`   — портреты учеников; длина зависит от density и кол-ва учеников.
 *  - `common`     — общий раздел: массив `slots` (порядок страниц).
 *  - `vignette`   — виньетка из детских садиковых фото (опционально, MVP — заглушка).
 *  - `soft_final` — последняя левая страница, только для `sheet_type='soft'`.
 */
export type SectionType =
  | 'soft_intro'
  | 'teachers'
  | 'students'
  | 'common'
  | 'vignette'
  | 'soft_final';

/**
 * Один элемент section_structure. Discriminated union по `type`:
 *  - для секции `common` обязателен массив `slots`;
 *  - для всех остальных — только `type`.
 */
export type SectionStructureEntry =
  | { type: 'soft_intro' | 'teachers' | 'students' | 'vignette' | 'soft_final' }
  | { type: 'common'; slots: SlotType[] };

/**
 * Полная структура альбома = массив секций в порядке появления.
 *
 * Хранится в БД как `presets.section_structure jsonb`. Валидируется при
 * INSERT/UPDATE через API (validateSectionStructure). Build engine
 * (buildFromSectionStructure, РЭ.21.8.3+) использует это поле как источник
 * правды о структуре, заменяя устаревшую логику generic-правил для
 * head-teacher / student-section / common-section из rule engine v1.3.
 */
export type SectionStructure = SectionStructureEntry[];

export interface Preset {
  id: string;
  display_name: string;
  print_type: PrintType;
  pages_per_spread: number;
  version: string;
  sections: Section[];
  /** Если копия глобального — ссылка на родителя. */
  parent_preset_id?: string;
  tenant_id: string | null;
  enabled?: boolean;

  /**
   * РЭ.21.6: ссылка на template_set (дизайн / набор IDML-мастеров),
   * который надо использовать при сборке альбома по этому пресету.
   *
   * NULL означает «партнёр не выбрал дизайн» — loadBundle применяет
   * фолбэк на глобальный `okeybook-default`. Все 9 текущих пресетов
   * после миграции РЭ.21.6.1 имеют NULL.
   *
   * UUID (template_sets.id), а не slug — потому что slug уникален
   * только в (tenant_id, slug). См. miграцию 2026-05-18-presets-
   * template-set-id.sql.
   */
  template_set_id?: string | null;

  /**
   * РЭ.21.5: диапазон страниц альбома для этой комплектации.
   *
   * `min_pages` — нижняя граница. Фиксированные комплектации
   * (Мини: 6) имеют min = max. Расширяемые (Стандарт: 20..50) —
   * разные значения.
   *
   * `max_pages` — верхняя граница. Должна быть `>= min_pages`.
   *
   * Источник правды для алгоритма планирования общего раздела
   * (бюджет страниц = max_pages, либо выбранное на уровне альбома
   * значение в диапазоне min..max — это будет в РЭ.21.8).
   *
   * Nullable в TS на случай старых записей (нашёлся `custom-vrfxcuqi`
   * с NULL после РЭ.21.5.3). Build engine применяет фолбэк 24.
   */
  min_pages?: number | null;
  max_pages?: number | null;

  /**
   * РЭ.20: плотность портретов student-section.
   *
   * Используется генератором правил (РЭ.20.6) для выбора правильной
   * строки матрицы. NULL допустим между РЭ.20.2 и РЭ.20.5, далее
   * проставляется явно. См. также {@link PresetDensity}.
   */
  density?: PresetDensity | null;

  /**
   * РЭ.20: тип листов (hard/soft).
   *
   * Влияет только на total_pages и наличие S-Intro/S-Final, логика
   * правил одинаковая. NULL допустим между РЭ.20.2 и РЭ.20.5.
   * См. также {@link SheetType}.
   */
  sheet_type?: SheetType | null;

  /**
   * РЭ.21.8: высокоуровневая структура альбома, редактируемая партнёром
   * через UI редактора пресетов (РЭ.21.3 → РЭ.21.7).
   *
   * Массив секций (`soft_intro` / `teachers` / `students` / `common` / `vignette`
   * / `soft_final`) в порядке появления. Для секций `common` — массив слотов
   * (`H` / `Q` / `FULL` / `flex_A` / `flex_B` / `flex_C`).
   *
   * Источник правды для нового build engine `buildFromSectionStructure`
   * (появится в РЭ.21.8.3). buildFromRules это поле ИГНОРИРУЕТ — оно
   * существует параллельно с `Preset.sections` и переключается per-album
   * (см. albums.engine_mode, РЭ.21.8.7).
   *
   * `null` — не задано (старые пресеты до миграции РЭ.21.2). В этом случае
   * buildFromSectionStructure должен либо упасть в фолбэк, либо использовать
   * default-структуру; точное поведение определится в РЭ.21.8.3.
   *
   * Whitelist `type` и `slots` синхронизирован с серверным валидатором
   * `validateSectionStructure` в app/api/tenant/route.ts.
   */
  section_structure?: SectionStructure | null;
}

// =============================================================================
// 8. Алгоритм buildFromRules — входы и выходы
// =============================================================================

export interface RulesStudentInput {
  id?: string;
  portrait: string | null;
  full_name: string;
  quote?: string | null;
  friend_photos?: string[];
  /** Заложено для будущей виньетки с детскими садиковыми фото. В MVP не используется. */
  secondary_portraits?: string[];
}

export interface RulesSubjectInput {
  photo: string | null;
  name: string;
  role: string;
}

export interface RulesHeadTeacherInput {
  photo: string | null;
  name: string;
  role: string;
  text: string;
}

export interface RulesCommonPhotosInput {
  full_class: string[];
  half_class: string[];
  spread: string[];
  quarter: string[];
  sixth: string[];
}

export interface RulesAlbumInput {
  students: RulesStudentInput[];
  subjects: RulesSubjectInput[];
  head_teacher: RulesHeadTeacherInput;
  common_photos: RulesCommonPhotosInput;
  /**
   * Лимит разворотов в общем разделе. РЭ.18.
   *   - undefined/null = без ограничения (builder вставляет все фото)
   *   - 0 = общий раздел полностью отключён
   *   - >0 = жёсткий лимит количества разворотов
   *
   * Передаётся в ctx как `common_section.max_spreads` и `common_section.spreads_remaining`.
   * Правила common-section-*-pair используют эти поля в when'ах.
   * Значение из albums.common_section_max_spreads через legacy-adapter.
   *
   * @deprecated РЭ.20: с реализацией матрицы (РЭ.20.6) число разворотов
   * общего раздела вычисляется автоматически из Preset.max_pages
   * (`common_section_pages = total_pages - student_section - head_teacher
   *  - intro - final`). Поле остаётся для обратной совместимости пока
   * РЭ.20.6 не закончен — после этого удалим из типов И из БД-колонки
   * albums.common_section_max_spreads отдельной миграцией.
   */
  common_section_max_spreads?: number | null;
}

// =============================================================================
// 9. Алгоритм buildFromRules — выходные структуры
// =============================================================================

export interface PageInstance {
  /** ID мастера из spread_templates. */
  master_id: string;
  /** Имя метки → значение (URL фото, текст, …). */
  bindings: Record<string, unknown>;
}

export interface SpreadInstance {
  spread_index: number;
  left?: PageInstance;
  right?: PageInstance;
  /** true для type='spread' (например J-Spread занимает оба листа). */
  is_spread?: boolean;
  /** true если левая и правая страницы из разных семейств (смешанный разворот). */
  mixed_pages?: boolean;
  /** true если партнёр редактировал разворот вручную. */
  user_edited?: boolean;
  user_edits?: Record<string, unknown>;
}

export interface DecisionTraceEntry {
  spread_index: number;
  section_index: number;
  family_id: FamilyId;
  rule_id: string;
  variant_id?: string;
  mixed_pages?: {
    left_rule_id: string;
    right_rule_id: string;
  };
  /** Снимок ключевых полей контекста на момент применения правила. */
  inputs: Record<string, unknown>;
  /** Применена ли балансировка к этому развороту. */
  balanced?: boolean;
}

export interface AlbumLayout {
  spreads: SpreadInstance[];
  decision_trace: DecisionTraceEntry[];
  rules_version: string;
  preset_id: string;
  status: LayoutStatus;
  warnings: string[];
}

// =============================================================================
// 10. Контекст вычисления правил (внутренний)
// =============================================================================

/**
 * Контекст для evaluateWhen — снимок всех полей из spec §7.2.
 * Заполняется в buildContext перед применением каждого правила.
 */
export interface RuleContext {
  subjects_count: number;
  students_count: number;
  students_remaining: number;
  current_student_index: number;
  head_teacher: {
    has_photo: boolean;
    has_text: boolean;
  };
  common_photos: {
    full_class: { count: number; has_any?: boolean };
    half_class: { count: number; has_any?: boolean };
    spread: { count: number; has_any?: boolean };
    quarter: { count: number; has_any?: boolean };
    sixth: { count: number; has_any?: boolean };
  };
  print_type: PrintType;
  /**
   * РЭ.20.6.2: плотность из пресета (preset.density).
   *
   * Видна в WHEN'е любого правила независимо от семейства (в отличие
   * от `section.density`, которая задаётся только в student-section
   * секции). Нужна правилам общего раздела чтобы выбирать структуру
   * по матрице (mini × hard vs light × hard и т.д.).
   *
   * `null` для пресетов где density не задан (Maximum/Individual) —
   * такие пресеты не используют новые mandatory-правила.
   */
  preset_density?: PresetDensity | null;
  /**
   * РЭ.20.6.2: тип листов из пресета (preset.sheet_type).
   *
   * ⚠️ Временный путь. В РЭ.12 (UI редактор) sheet_type переедет на
   * уровень альбома (albums.sheet_type), и `preset_sheet_type` будет
   * заменён на `sheet_type` (читается из альбома). Сейчас читаем из
   * пресета, потому что правилу нужно дифференцировать hard/soft
   * на этапе построения.
   */
  preset_sheet_type?: SheetType | null;
  section: {
    position: 'first' | 'middle' | 'last';
    density?: Density;
    has_quote?: boolean;
    has_friend_photos?: boolean;
    friend_photos_max?: number;
  };
  prev_spread: {
    right_page_empty: boolean;
  };
  /**
   * Состояние общего раздела (РЭ.18). Используется правилами
   * common-section-* для соблюдения лимита из
   * albums.common_section_max_spreads.
   *
   *   spreads_created      — сколько разворотов уже добавил builder в раздел
   *   max_spreads          — лимит из input (null/undefined = без лимита)
   *   spreads_remaining    — сколько ещё можно добавить
   *                           (null = unlimited, >=0 если есть лимит)
   *
   * В when'ах правил пишется как
   *   "common_section.spreads_remaining": { "gte": 1 }
   * либо просто "common_section.max_spreads": { "neq": 0 } (не отключён).
   */
  common_section: {
    spreads_created: number;
    max_spreads: number | null;
    spreads_remaining: number | null;
  };
  friend_photos_count?: number;

  /**
   * РЭ.20: сколько страниц альбома осталось «свободно» после планирования
   * student-section, головного учительского и intro/final.
   *
   *   pages_remaining = preset.max_pages - already_consumed_pages
   *
   * Используется правилами общего раздела (priority 230/210) чтобы решить
   * добавлять ещё страницу или нет. Заполняется в buildContext (РЭ.20.4).
   * До РЭ.20.4 — undefined, существующие правила его не читают.
   */
  pages_remaining?: number;

  /**
   * РЭ.20: состояние «обязательного» общего раздела (mandatory_section_pages
   * из матрицы). Заполняется в buildContext (РЭ.20.4) на основе строки
   * матрицы для текущего (density, sheet_type, students_count).
   *
   *   pages_pattern    — массив паттернов страниц из ячейки матрицы
   *                      (см. {@link PagePattern}).
   *   current_index    — индекс паттерна, который сейчас обрабатываем.
   *   pages_remaining  — сколько ещё страниц обязательного раздела
   *                      осталось добавить (= pages_pattern.length - current_index).
   *
   * Правила common-section-mandatory-page-N-* читают current_index в when'ах,
   * чтобы каждой странице соответствовало своё правило.
   *
   * undefined в существующих правилах = поле не используется (РЭ.18 fallback).
   */
  mandatory_section?: {
    pages_pattern: PagePattern[];
    current_index: number;
    pages_remaining: number;
  };
}
