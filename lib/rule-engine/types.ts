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
  /**
   * Потолок фото с друзьями. Расширен с 2|3|4 до number (общий лимит 30,
   * согласован с lib/smart-fill MAX_FRIEND_PHOTOS и валидацией
   * student_friend_photos 0..30 в app/api/tenant) — для режима multi_spread.
   */
  friend_photos_max?: number;
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
  | 'common_required'  // РЭ.21.8.9: обязательный общий раздел по таблице OkeyBook
  | 'common_additional' // РЭ.21.8.10: доп. общий раздел (платная допуслуга)
  | 'transition'       // РЭ.21.8.11: переходная страница (правая, вариант C)
  | 'vignette'
  | 'soft_final';

/**
 * Один элемент section_structure. Discriminated union по `type`:
 *  - для не-common секций — только `type`;
 *  - для секции `common` две формы:
 *    - manual: `{ type: 'common', slots: SlotType[] }` — партнёр явно
 *      описал какие слоты и в каком порядке (используется slot-chains для
 *      каждого слота). Старая форма, существовала с РЭ.21.2.
 *    - auto:   `{ type: 'common', mode: 'auto', max_spreads: N }` — engine
 *      сам решает что положить из пула common_photos, ориентируясь на
 *      крупные → мелкие категории (РЭ.21.8.8). Лимит: не больше N разворотов.
 *      «Лучше меньше разворотов чем пустые слоты»: если фото хватает только
 *      на K < N разворотов — делает K с warning common_autopack_underflow.
 *  - для секции `common_required` (РЭ.21.8.9) параметров нет — engine
 *    автоматически выбирает строку из эталонной таблицы OkeyBook на основе
 *    preset.density × preset.sheet_type × input.students.length. См.
 *    lib/rule-engine/album-structure-okeybook.ts.
 *  - для секции `common_additional` (РЭ.21.8.10) обязателен `max_spreads`
 *    — макс. количество разворотов в доп. общем разделе. Может быть 0
 *    (тогда секция не строится — партнёр не купил допуслугу). Engine берёт
 *    additional_pages из той же таблицы что и common_required.
 *  - для секции `transition` (РЭ.21.8.11) параметров нет. Engine строит
 *    правую страницу переходного разворота (общий раздел) когда после
 *    students секции pageInstances нечётно. Левая сторона переходной
 *    в этом коммите не строится (требует комбо-мастеров, отложено в
 *    РЭ.21.8.11b).
 */
/**
 * РЭ.32: одна страница общего раздела, заданная партнёром в шаблоне.
 *
 * Партнёр в редакторе пресета собирает упорядоченный список таких записей.
 * Engine при сборке альбома проходит по списку и для каждой записи
 * пытается положить страницу с указанным мастером, потребляя фото из
 * соответствующей категории (определяется автоматически по placeholders
 * мастера).
 *
 * Имя мастера хранится **без суффикса -Right**. Engine при сборке смотрит
 * позицию страницы (left/right по чётности pageInstances.length) и
 * автоматически подставляет `<master_name>-Right` если такой мастер есть
 * в template_set. Это позволяет дизайнеру опционально создавать
 * зеркальные пары L/R для асимметричного дизайна (если в template_set
 * только универсальный мастер — он же используется для обеих позиций).
 */
export interface CommonRequiredPage {
  master_name: string;
}

/**
 * РЭ.37: пользовательский сценарий переходного раздела.
 *
 * Партнёр в конструкторе шаблона (TransitionScenarioPicker, реализуется
 * в РЭ.37.6) заранее задаёт мастера на каждый из двух возможных случаев
 * хвоста students-секции:
 *
 *  - `tail_left` — хвост из 1-N учеников остался на ЛЕВОЙ странице
 *    разворота личного раздела. Build engine достраивает низ левой
 *    страницы combo-мастером (`left.master_name`) и всю правую — другим
 *    мастером (`right.master_name`).
 *
 *  - `tail_right` — хвост из 1-N учеников остался на ПРАВОЙ странице.
 *    Левая остаётся как есть (последняя полная страница students),
 *    правую достраиваем combo-мастером (`right.master_name`).
 *
 * Названия мастеров — без суффикса `-Right` (та же конвенция, что у
 * CommonRequiredPage). Engine при сборке смотрит позицию и подставляет
 * зеркальный мастер, если он есть в template_set.
 *
 * См. docs/transition-section-spec.md §4.2, §5.1.
 */
export interface TransitionCustomScenario {
  tail_left: {
    left: { master_name: string };
    right: { master_name: string };
  };
  tail_right: {
    right: { master_name: string };
  };
}

/**
 * Один элемент section_structure. Discriminated union по `type`:
 *  - для большинства секций — только `type`;
 *  - для секции `common` (legacy с РЭ.21.2) две формы:
 *    - manual: `{ type: 'common', slots: SlotType[] }` — партнёр явно
 *      описал какие слоты и в каком порядке.
 *    - auto:   `{ type: 'common', mode: 'auto', max_spreads: N }` — engine
 *      сам решает, лимит N разворотов.
 *  - для секции `common_required` (РЭ.32): массив страниц `pages`. Партнёр
 *    в редакторе шаблона выбирает мастера общего раздела и располагает их
 *    в нужном порядке. Engine исполняет список без интерпретации.
 *    Старые сохранённые пресеты (до РЭ.32) могут иметь `pages: []` или
 *    отсутствие поля — engine выдаёт warning «общий раздел пуст», партнёр
 *    заходит и заполняет.
 *  - для секции `common_additional` (РЭ.21.8.10) обязателен `max_spreads`.
 *  - для секции `transition` (РЭ.37 расширил РЭ.32 и РЭ.21.8.11):
 *      • `mode: 'okeybook_default'` — engine применяет встроенную таблицу
 *        правил OkeyBook (см. docs/transition-section-spec.xlsx). Дефолт
 *        для всех новых пресетов с РЭ.37.6.
 *      • `mode: 'custom'` — engine использует сценарий из `custom`
 *        (см. TransitionCustomScenario), партнёр задал мастера вручную.
 *      • LEGACY (РЭ.32): `mode` отсутствует, `master_name` опционально
 *        задаёт один мастер для правой страницы переходного. Старые
 *        пресеты до РЭ.37.6 будут в этой форме. Валидатор API запрещает
 *        одновременное наличие `mode` и `master_name`.
 */
/**
 * Конфиг личного раздела, привязанный к КОНКРЕТНОЙ записи `students` в
 * структуре альбома (ТЗ 17.06.2026). Несколько записей `students` могут
 * иметь разные `config` — каждая раскладывает ВЕСЬ список учеников в своём
 * режиме (например: разворотный личный раздел на всех + компактная
 * сетка-указатель на всех).
 *
 * Режимы:
 *  - `grid`         — сетка `per_page` учеников/страницу (2..16); хвост
 *                     (неполная страница) подбирается семантически.
 *  - `page`         — 1 ученик/страницу; `friends` фото с друзьями (0..N),
 *                     `quote` — слот цитаты.
 *  - `spread`       — 1 ученик/разворот; число фото с друзьями ДИАПАЗОНОМ
 *                     `friends_min..friends_max` — на каждого ученика берётся
 *                     мастер под ЕГО фактическое число фото (clamp в диапазон).
 *  - `multi_spread` — 1 ученик на несколько разворотов. Два под-режима:
 *      • АВТО (по умолчанию): парад = ОДНА левая страница (портрет/имя/цитата),
 *        правая и дальше — коллажи фото, подбираемые автопаком под число фото.
 *        Лимит разворотов — `spreads_per_student` (2..4).
 *      • ВРУЧНУЮ (`manual_pages` задан): партнёр сам перечисляет мастера каждой
 *        страницы личного блока (по именам мастеров, стабильным при перезаливке).
 *        Применяется к КАЖДОМУ ученику; фото текут по страницам слева направо.
 *        Длина `manual_pages` чётная (целые развороты), `spreads_per_student`
 *        в этом под-режиме игнорируется.
 *
 * Если у записи `students` нет `config` (старый формат) — движок берёт
 * глобальные поля пресета (`student_layout_mode`/`student_grid_size`/
 * `student_friend_photos`/`student_has_quote`) как legacy-фолбэк. Глобальные
 * поля НЕ удаляем сразу — нужны для отката (зачистка отдельной сессией).
 */
export type StudentsSectionConfig =
  | { mode: 'grid'; per_page: number }
  | { mode: 'page'; friends: number; quote: boolean; is_personal?: boolean }
  | {
      mode: 'spread';
      friends_min: number;
      friends_max: number;
      quote: boolean;
      is_personal?: boolean;
    }
  | {
      mode: 'multi_spread';
      spreads_per_student: number;
      quote: boolean;
      /**
       * Ручной сценарий: имена мастеров по страницам личного блока (по порядку).
       * null/отсутствует → авто-режим. Чётная длина (целые развороты).
       */
      manual_pages?: string[] | null;
      is_personal?: boolean;
    };

/**
 * ТЗ 19.06.2026 «персональный раздел»: `is_personal=true` помечает students-секцию
 * как ЛИЧНУЮ — её развороты вычленяются в тонкую книгу конкретного ученика
 * (другие ученики туда не попадают), а корешок такой книги считается по её
 * собственному числу разворотов. `is_personal=false`/отсутствует — секция общая,
 * идёт в книгу 000 (как сетка портретов).
 *
 * Поддерживается только в режимах, где на одном печатном листе ОДИН ребёнок:
 * `page` (1 на страницу), `spread` (1 на разворот), `multi_spread` (несколько
 * разворотов на одного). В режиме `grid` (несколько детей на странице) флаг
 * не предусмотрен — сетку физически нельзя разнести по разным книгам.
 *
 * Разнесение по книгам выполняет lib/album-split (на этапе подготовки к
 * экспорту), читая метку PageInstance.personal, которую движок проставляет
 * на личные страницы. Сама раскладка секции при этом НЕ меняется.
 */

export type SectionStructureEntry =
  | { type: 'teachers' | 'vignette' }
  | { type: 'students'; config?: StudentsSectionConfig }
  /**
   * РЭ.42: soft_intro поддерживает опциональный master_name override.
   * Если задан — engine кладёт именно этот мастер (партнёр выбрал из
   * template_set). Если null/отсутствует — старое поведение (поиск
   * по page_role='intro' + photos_full=1, обычно classphoto-мастер).
   */
  | { type: 'soft_intro'; master_name?: string | null }
  /** РЭ.42: аналогично soft_intro — опциональный master_name override. */
  | { type: 'soft_final'; master_name?: string | null }
  | { type: 'common'; slots: SlotType[] }
  | { type: 'common'; mode: 'auto'; max_spreads: number }
  | { type: 'common_required'; pages?: CommonRequiredPage[] }
  | { type: 'common_additional'; max_spreads: number }
  | {
      type: 'transition';
      /**
       * РЭ.32, DEPRECATED с РЭ.37: один мастер для правой страницы.
       * Поддерживается для обратной совместимости со старыми пресетами.
       * Новые пресеты используют `mode`. Валидатор запрещает одновременно.
       */
      master_name?: string | null;
      /** РЭ.37: режим работы переходного раздела. */
      mode?: 'okeybook_default' | 'custom';
      /** Заполняется только когда mode='custom'. */
      custom?: TransitionCustomScenario;
    };

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

/**
 * РЭ.37.6: ручной сценарий для transition-разворота.
 *
 * Хранится в presets.transition_scenario JSONB. NULL в БД эквивалентен
 * mode='default' (OkeyBook-логика). В TypeScript типе используем
 * различение по полю mode для type narrowing.
 *
 * Поведение в engine'е:
 *   • mode='default' — обычная OkeyBook-логика (см. fillOkeybookDefault
 *     в lib/rule-engine/sections/transition.ts).
 *   • mode='custom' — fillCustomScenario использует master_id из объекта
 *     напрямую. Симметризация хвоста ИГНОРИРУЕТСЯ. detectComplectation
 *     не вызывается. Если master_id отсутствует в template_set на момент
 *     сборки — добавляется warning transition_custom_master_not_found.
 */
export type TransitionScenario =
  | { mode: 'default' }
  | {
      mode: 'custom';
      /** Мастер для левой страницы transition. null = оставить students-страницу. */
      tail_left_master_id: string | null;
      /** Мастер для правой страницы transition. null = закрыть J-цепочкой. */
      tail_right_master_id: string | null;
      /** Резерв на будущее. Пока игнорируется engine'ом. */
      closing_master_id: string | null;
    };

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
   * РЭ.21.8.15 (изначальная одно-осевая модель — DEPRECATED в РЭ.22.1):
   * семантическое описание макета личного раздела через 3 независимых поля.
   *
   *  - `student_pages_per_student` — 1 (одностраничный) или 2 (разворот)
   *  - `student_friend_photos` — сколько фото с друзьями (0..30)
   *  - `student_has_quote` — есть ли слот для текста-цитаты
   *
   * Engine `sections/students.ts` ищет в template_set мастер с подходящим
   * `slot_capacity` (см. lib/rule-engine/master-finder.ts). Когда все 3
   * поля NOT NULL — используется семантический поиск. Когда хоть одно
   * NULL — fallback на legacy выбор по density / preset.id.
   *
   * ⚠️ Эти поля DEPRECATED с РЭ.22.1 — заменены двух-осевой моделью
   * (`student_layout_mode` + `student_grid_size` ниже). До зачистки
   * (отдельная сессия) UI пишет в обе модели — старая остаётся для
   * отката Vercel.
   */
  student_pages_per_student?: 1 | 2 | null;
  student_friend_photos?: number | null;
  student_has_quote?: boolean | null;

  /**
   * РЭ.22.1: двух-осевая модель личного раздела «режим × параметры».
   *
   *  - `student_layout_mode` — один из трёх режимов:
   *      'page'   — 1 ученик/страница (Standard/Universal комплектации)
   *      'spread' — 1 ученик/разворот (Maximum/Individual)
   *      'grid'   — сетка N учеников/страница (Medium/Light/Mini)
   *      NULL = семантический поиск не активирован, engine идёт по
   *             legacy-пути (жёсткие имена по preset.density / preset.id).
   *
   *  - `student_grid_size` — сколько учеников помещается на одной
   *      странице сетки. Применимо только когда mode='grid'. Свободное
   *      число 2..12 (не enum) — партнёр может указать любое значение,
   *      engine ищет в template_set мастер с подходящим
   *      `slot_capacity.students`. Адаптивный хвост (последняя неполная
   *      страница) подбирается семантически.
   *      Для mode='page'/'spread' значение игнорируется.
   *
   * См. docs/phase-Р22-spec.md §3 для детального контракта и §6 для
   * описания engine-логики (которая придёт в РЭ.22.4-РЭ.22.6).
   */
  student_layout_mode?: 'page' | 'spread' | 'grid' | null;
  student_grid_size?: number | null;

  /**
   * РЭ.37: симметризация хвоста students-секции.
   *
   * Когда true, и комплектация = Мини/Лайт (определяется по наличию
   * N-Grid-12 / N-Grid-6 в template_set), и хвост = 1 ученик — engine
   * забирает 1 ученика с предыдущей полной страницы. Теперь на хвостовой
   * странице 2 ученика, на предыдущей — на 1 меньше. Оба «дефицита»
   * центрируются через placeholder_centering (см. BalanceClause).
   *
   * Для других комплектаций (Медиум / Стандарт / Универсал / Максимум)
   * флаг игнорируется engine'ом — UI его скрывает / disabled (РЭ.37.5).
   *
   * Источник: presets.symmetrize_students_tail BOOLEAN NOT NULL DEFAULT FALSE.
   * Дефолт false (опт-ин). Engine логика реализуется в РЭ.37.4.
   *
   * В custom-режиме transition_scenario симметризация ИГНОРИРУЕТСЯ —
   * партнёр явно задал что класть на хвост (см. РЭ.37.6).
   */
  symmetrize_students_tail?: boolean | null;

  /**
   * РЭ.37.6: ручной сценарий для transition-разворота.
   *
   * По умолчанию (null) engine использует OkeyBook-логику —
   * автоопределение комплектации по последней students-странице, выбор
   * combo и closing мастеров автоматически. Это покрывает большинство
   * случаев.
   *
   * Если партнёр в редакторе пресета явно задал свой сценарий
   * (РЭ.37.6.d UI), здесь приходит объект:
   *
   *   {
   *     mode: 'custom',
   *     tail_left_master_id:  string | null,   // мастер для L страницы
   *                                              transition. null = оставить
   *                                              students-страницу как есть
   *                                              (без замены).
   *     tail_right_master_id: string | null,   // мастер для R страницы.
   *                                              null = закрыть как обычно
   *                                              (J-цепочка).
   *     closing_master_id:    string | null,   // резерв на будущее, пока
   *                                              игнорируется engine'ом.
   *   }
   *
   * В custom-режиме:
   *   • Симметризация хвоста (symmetrize_students_tail) ИГНОРИРУЕТСЯ.
   *   • detectComplectation не вызывается.
   *   • Адаптивный хвост students.ts работает как обычно (это про сам
   *     students-раздел, не про transition).
   *
   * Если master_id из сценария отсутствует в template_set на момент
   * сборки — engine добавляет warning transition_custom_master_not_found
   * и продолжает с оставшимися (как если бы соответствующее поле было
   * null).
   *
   * Источник: presets.transition_scenario JSONB NULL.
   * Миграция: 2026-05-24-presets-transition-scenario.sql.
   */
  transition_scenario?: TransitionScenario | null;

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
  collage: string[];
}

export interface RulesAlbumInput {
  students: RulesStudentInput[];
  subjects: RulesSubjectInput[];
  head_teacher: RulesHeadTeacherInput;
  /**
   * Все главные (классные руководители / воспитатели) — 0..2. ТЗ 17.06.2026:
   * поддержка ДВУХ равных главных (детсад/школа). `head_teacher` остаётся для
   * обратной совместимости и = head_teachers[0] (либо пустой stub, если 0).
   * Биндер teachers.ts читает массив: head_teachers[N-1] → слот headteacher*_N,
   * лишние слоты скрываются (__hidden__, привязанный декор уходит автоматически
   * через applyBalanceOverrides). Текст-письмо общий — head_teachers[0].text.
   *
   * Опционален: старые вызовы (тесты, preview-bundle, legacy-движок) задают
   * только head_teacher — движок тогда трактует это как один главный
   * (`head_teachers ?? [head_teacher]`).
   */
  head_teachers?: RulesHeadTeacherInput[];
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
  /**
   * РЭ.40: стратегия распределения учеников по grid-страницам.
   * Применяется только в grid-режимах (Mini, Light).
   *
   * - 'greedy' — жадное (12+12+6) + симметризация хвоста 1
   * - 'equalize' — всегда равномерно (10+10+10)
   * - 'auto' — combined-tail+equalize если есть фото и combined-мастер
   *   с подходящим slot_capacity; иначе чистый equalize
   *
   * Значение из albums.student_distribution через legacy-adapter.
   * Если undefined — engine применяет 'auto' (default).
   */
  student_distribution?: 'auto' | 'equalize' | 'greedy';
}

// =============================================================================
// 9. Алгоритм buildFromRules — выходные структуры
// =============================================================================

export interface PageInstance {
  /** ID мастера из spread_templates. */
  master_id: string;
  /** Имя метки → значение (URL фото, текст, …). */
  bindings: Record<string, unknown>;
  /**
   * РЭ.35.Ж: страница помечена как «начало нового разворота» — следующая
   * за ней секция должна обязательно начаться с левой стороны разворота.
   * Если предыдущий разворот закрылся нечётно (висящая левая), shift в
   * группировке создаёт пустую правую (висящий разворот), и эта страница
   * становится левой нового.
   *
   * Применяется автоматически build-from-section-structure для секций
   * которые семантически ОТДЕЛЬНЫЕ (common_required начинается с нового
   * разворота, soft_final — последняя левая, и т.д.). НЕ применяется
   * для transition (она специально достраивает students).
   */
  section_start?: boolean;
  /**
   * РЭ.43: тип секции из которой пришла эта страница. Заполняется
   * автоматически orchestrator-ом (build-from-section-structure) после
   * вызова fill-функции секции. Используется в enforcement max_pages
   * для защиты «жёстко привязанных» страниц от обрезки —
   * soft_intro / soft_final у soft binding обязательно остаются
   * на форзацах, обрезается всегда хвост из не-защищённых секций
   * (common_additional → common_required → ...).
   *
   * NULL допустим для исторических page_instance без тега — fallback на
   * старое поведение (обрезка с конца без защиты).
   */
  section_type?: SectionStructureEntry['type'];
  /**
   * ТЗ 19.06.2026 «персональный раздел»: метка принадлежности страницы
   * ЛИЧНОЙ книге конкретного ученика. Проставляется движком только для
   * страниц students-секции с `config.is_personal=true` (режимы page/spread/
   * multi_spread). По этой метке lib/album-split разносит развороты по книгам
   * 00X на этапе подготовки к экспорту. Отсутствие метки → страница общая
   * (книга 000). Вёрстку не меняет — чистая метаинформация.
   */
  personal?: { section_index: number; student_index: number };
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
    collage: { count: number; has_any?: boolean };
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
