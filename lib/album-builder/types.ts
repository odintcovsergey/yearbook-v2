/**
 * Доменные типы для album-builder (фаза 0, подэтап 0.9 — фундамент).
 *
 * Источники истины:
 * - docs/templates/idml-recon-notes.md — реальные имена меток в шаблоне
 *   «Плотные Мастер Белый» (lowercase, см. §4)
 * - yearbook-context-v38.md, раздел «Семантические теги мастеров (после 0.8.6)» —
 *   список тегов в БД и список комплектаций
 * - migration 0.1 (template_sets/spread_templates/album_layouts),
 *   migration 0.3.5 (slug, facing_pages, page_binding),
 *   migration 0.8.6.1 (applies_to_configs, page_role, slot_capacity,
 *                      is_fallback, mirror_for_soft, audit_notes)
 * - docs/phase-0-spec.md §4 — формат Placeholder (актуален в части полей)
 *
 * В этом файле — только декларации. Никакой логики, никаких импортов.
 * Алгоритм buildAlbum появится в подэтапе 0.10.
 */

// ─── Фотографии и пользовательские данные (вход в buildAlbum) ─────────────

/**
 * Фото = уже зарезолвленный URL объекта в Yandex Cloud (через
 * `getPhotoUrl`/`getThumbUrl`). album-builder сам по себе не ходит в YC —
 * вызывающая сторона подаёт уже готовые ссылки. См. yearbook-context-v38
 * «ПРАВИЛА РАБОТЫ» (URL фото только через getPhotoUrl/getThumbUrl).
 */
export type Photo = string;

/**
 * Один ученик. `friend_photos` — 0..4 фото с друзьями (реальные мастера
 * E-Student-* содержат `studentPhoto1..4`, см. idml-recon §4 «Ученические»).
 */
export type Student = {
  full_name: string;
  quote: string;
  portrait: Photo | null;
  friend_photos: Photo[];
};

/**
 * Классный руководитель. Заполняет `headTeacher*` и `headTextFrame` в F-Head-*
 * (idml-recon §4 «Учительские»).
 */
export type HeadTeacher = {
  name: string;
  role: string;
  text: string;
  photo: Photo | null;
};

/**
 * Учитель-предметник. Заполняет `teacherName_N`/`teacherRole_N`/`teacherPhoto_N`
 * в G-Teachers-* и в F-Head-Small/LargeGrid (idml-recon §4 «Учительские»).
 */
export type Subject = {
  name: string;
  role: string;
  photo: Photo | null;
};

/**
 * Общие фотографии класса. Расфасованы по мастерам общего раздела (J-*),
 * а также используются в S-Intro/L-Last/N-Overflow и пр. (idml-recon §4
 * «Общие фото»).
 *
 * Маппинг полей CommonPhotos ↔ photos.type в БД (после А.1.1):
 * - `spread`     — `common_spread` (одно фото на весь разворот).
 *                  Внимание: для этого типа в template_set okeybook-default
 *                  пока нет специализированного мастера (J-Spread). См.
 *                  master-cleanup-tz.md (зависимость от дизайнера).
 * - `full_class` — `common_full`. Слоты `classPhotoFrame` в J-ClassPhoto
 *                  и J-ClassPhoto-Right.
 * - `half`       — `common_half`. `halfLeftPhoto`/`halfRightPhoto`/
 *                  `halfPhoto_*` в J-Half и J-HalfSixth.
 * - `quarter`    — `common_quarter`. `quarterPhoto_*` в J-Quarter.
 * - `sixth`      — `common_sixth` (одна шестая, по-старому «коллаж»).
 *                  `collagePhoto_*` в J-Collage, J-HalfSixth,
 *                  J-SixthSixth, J-SixthFull.
 * - `collage`    — DEPRECATED, оставлен для обратной совместимости со
 *                  smoke-tests. В новом коде использовать `sixth`.
 *                  Сергей подтвердил 10.05.2026: collage и sixth — одно
 *                  и то же (см. designer-questions-2026-05-10.md
 *                  уточнение про collage).
 *
 * Заполняется в `lib/smart-fill/build-album-input.ts` чтением
 * `photos WHERE type IN ('common_spread',...)` (А.2.1).
 */
export type CommonPhotos = {
  spread: Photo[];      // А.2.1 — фото на разворот (common_spread)
  full_class: Photo[];
  half: Photo[];
  quarter: Photo[];
  sixth: Photo[];
  collage: Photo[];     // DEPRECATED — alias для sixth, оставлен для совместимости
};

/**
 * Полный вход в buildAlbum.
 *
 * `template_set_id` обязателен и резолвится снаружи (по комплектации тенанта)
 * до вызова buildAlbum — сам алгоритм не делает запросов в БД.
 */
export type AlbumInput = {
  template_set_id: string;
  head_teacher: HeadTeacher | null;
  subjects: Subject[];
  students: Student[];
  common_photos: CommonPhotos;
};

// ─── Литералы (синхронны с CHECK constraints) ─────────────────────────────

/**
 * Комплектации продукта B. Соответствуют CHECK constraint на
 * `spread_templates.applies_to_configs[]` (миграция 0.8.6.1).
 *
 * `tryumo` — отдельный продукт, в фазе 0 его мастера НЕ генерируются
 * (см. memory `project_phase0_tryumo_separate_masters`).
 */
export type ConfigType =
  | 'standard'
  | 'universal'
  | 'maximum'
  | 'medium'
  | 'light'
  | 'mini'
  | 'individual'
  | 'tryumo';

/**
 * Тип печати — твёрдая обложка (layflat) или мягкие листы (soft).
 * Влияет на наличие S-Intro и на выбор зеркальных мастеров (`mirror_for_soft`).
 */
export type PrintType = 'layflat' | 'soft';

/**
 * Тип мастера — соответствует CHECK constraint на `spread_templates.type`
 * (миграция 0.1, см. также idml-recon §6.5 «Тип мастера по префиксу»).
 */
export type MasterType =
  | 'student'
  | 'head_teacher'
  | 'subjects'
  | 'common'
  | 'cover'
  | 'intro';

/**
 * Семантическая роль страницы. Соответствует CHECK constraint на
 * `spread_templates.page_role` (миграции 0.8.6.1 + 0.10a.1 + 0.10b.1 + 0.11.1.5 + 0.11.2).
 *
 * - `student`            — двухстраничный ученический мастер или legacy без
 *                          парного Left/Right (E-Student-Standard, E-Student-Default)
 * - `student_left`       — одностраничный мастер для левой страницы
 *                          (E-Student-Left, E-Max-Left)
 * - `student_right`      — одностраничный мастер для правой страницы
 *                          (E-Student-Right, E-Max-Right, E-Ind-Right-3)
 * - `student_grid`       — сетка нескольких учеников без парного Left/Right
 * - `student_grid_left`  — левая страница сетки (D-Medium-Left, L-6-Left, N-12-Left)
 * - `student_grid_right` — правая страница сетки (D-Medium-Right, L-6-Right, N-12-Right)
 * - `student_overflow`   — доп.ряд учеников (*-Overflow-Row*)
 * - `student_overflow_right` — правая overflow-страница в Лайт 31-32
 *                              (L-Overflow-Row-Right, добавлено в 0.11.2)
 * - `student_last`       — последняя страница раздела учеников (*-Last*)
 * - `teacher_left`       — левая страница учительского разворота (F-*)
 * - `teacher_right`      — правая страница учительского разворота (G-*)
 * - `common`             — общий раздел (J-*)
 * - `intro`              — вступление (S-Intro/S-Intro-Old)
 * - `cover`              — обложка (в текущем шаблоне отсутствует)
 */
export type PageRole =
  | 'student'
  | 'student_left'
  | 'student_right'
  | 'student_grid'
  | 'student_grid_left'
  | 'student_grid_right'
  | 'student_overflow'
  | 'student_overflow_right'
  | 'student_last'
  | 'teacher_left'
  | 'teacher_right'
  | 'common'
  | 'intro'
  | 'cover';

// ─── Проекции БД (spread_templates / template_sets) ───────────────────────

/**
 * `spread_templates.slot_capacity` (jsonb). Сколько данных вмещает мастер.
 * Используется semantic-резолвером в `findMaster` (фаза 0.10) — фильтр
 * `slot_capacity_min` смотрит на эти числа (см. miграция 0.8.6.1).
 *
 * Все поля опциональны — мастер заявляет только релевантные ёмкости.
 */
export type SlotCapacity = {
  students?: number;
  teachers?: number;
  head_teacher?: number;
  photos_full?: number;
  photos_half?: number;
  photos_quarter?: number;
  photos_sixth?: number;
  photos_collage?: number;
  photos_friend?: number;
};

// ─── Placeholder (из БД, та же форма что в lib/idml-converter/types.ts) ───

/**
 * Общие поля плейсхолдера. Синхронны с docs/phase-0-spec.md §4 (Common)
 * и с `lib/idml-converter/types.ts` (см. ParsedSpreadTemplate.placeholders).
 *
 * Координаты — от верхнего-левого угла разворота (idml-recon §3).
 * `original_label` — оригинал из IDML до lowercase-нормализации
 * (idml-recon §6.4); используется для отладки и фидбека дизайнеру.
 */
export type PlaceholderCommon = {
  label: string;
  original_label?: string;
  x_mm: number;
  y_mm: number;
  width_mm: number;
  height_mm: number;
  rotation_deg?: number;
};

/** Прямоугольная фоторамка. */
export type PhotoPlaceholder = PlaceholderCommon & {
  type: 'photo';
  fit: 'fill_proportional' | 'contain' | 'fill';
  is_circle?: boolean;
  required: boolean;
};

/**
 * Текстовый плейсхолдер. `auto_fit` пока не реализован для name-плейсхолдеров
 * (см. memory `project_phase0_parser_followups`).
 */
export type TextPlaceholder = PlaceholderCommon & {
  type: 'text';
  font_family: string;
  font_size_pt: number;
  font_weight: 'regular' | 'bold' | 'medium' | 'light';
  color: string;
  align: 'left' | 'center' | 'right' | 'justify';
  vertical_align: 'top' | 'middle' | 'bottom';
  auto_fit: boolean;
  min_size_pt?: number;
  default_text?: string;
};

/**
 * Круглая аватарка (учительские портреты в F-Head-*Grid и G-Teachers-*).
 *
 * Это специализация PhotoPlaceholder с is_circle=true — НЕ отдельный
 * вариант discriminated union. В БД и в парсере (lib/idml-converter/types.ts)
 * овал хранится как { type:'photo', is_circle:true }. Соответственно
 * Placeholder discriminated union — это только { 'photo' | 'text' }, а
 * круглость определяется через type guard `p.type === 'photo' && p.is_circle`.
 */
export type OvalPlaceholder = PhotoPlaceholder & {
  is_circle: true;
};

/** Discriminated union по `type`. */
export type Placeholder = PhotoPlaceholder | TextPlaceholder;

// ─── SpreadTemplate / TemplateSet (проекции таблиц) ───────────────────────

/**
 * Запись из `spread_templates` (миграции 0.1 + 0.8.6.1 + 0.11.1.5).
 *
 * `sort_order` — позиционный индекс из IDML (см. memory
 * `feedback_sort_order_semantics`); порядок применения определяется
 * не им, а семантическими тегами + сценариями (фильтрами в SCENARIOS).
 *
 * Семантические теги (`applies_to_configs`/`page_role`/`slot_capacity`/
 * `is_fallback`/`mirror_for_soft`/`audit_notes`) добавлены в 0.8.6.1
 * и заполнены для 39 мастеров в 0.8.6.2.
 *
 * `applies_to_configs` — список комплектаций где мастер технически совместим
 *                       (используется в UI редактора фаз 2-4 для ручного выбора).
 * `default_for_configs` — список комплектаций где мастер выбирается автоматически
 *                       в buildAlbum (используется в семантических фильтрах).
 *                       Добавлено в 0.11.1.5 для разделения compat vs default.
 */
export type SpreadTemplate = {
  id: string;
  name: string;
  type: MasterType;
  is_spread: boolean;
  width_mm: number;
  height_mm: number;
  placeholders: Placeholder[];
  rules: unknown | null;
  sort_order: number;
  applies_to_configs: ConfigType[];
  default_for_configs: ConfigType[];
  page_role: PageRole | null;
  slot_capacity: SlotCapacity | null;
  is_fallback: boolean;
  mirror_for_soft: boolean;
  audit_notes: string | null;
};

/**
 * Запись из `template_sets` (миграция 0.1 + 0.3.5).
 *
 * `spreads` — материализованный список мастеров текущего сета. Алгоритм
 * `buildAlbum` работает только с этой структурой и не делает доп.запросов.
 */
export type TemplateSet = {
  id: string;
  tenant_id: string | null;
  name: string;
  slug: string;
  print_type: PrintType;
  page_width_mm: number;
  page_height_mm: number;
  spread_width_mm: number;
  spread_height_mm: number;
  bleed_mm: number;
  facing_pages: boolean;
  page_binding: 'LeftToRight' | 'RightToLeft';
  spreads: SpreadTemplate[];
};

// ─── I/O для buildAlbum ───────────────────────────────────────────────────

/**
 * Конфигурация одного запуска buildAlbum: какой набор шаблонов и в какой
 * комплектации/печати собираем.
 */
export type Config = {
  print_type: PrintType;
  config_type: ConfigType;
  template_set: TemplateSet;
};

/**
 * Один разворот результата. `data: label → URL/text/null` — слепок значений
 * для каждого плейсхолдера выбранного мастера. `null` означает «слот пустой»
 * (например, опциональные `studentPhoto3..4`).
 *
 * `template_name` дублирует `template_id` для удобства отладки/UI.
 */
export type SpreadInstance = {
  spread_index: number;
  template_id: string;
  template_name: string;
  data: Record<string, string | null>;
};

/**
 * Коды предупреждений buildAlbum. Все warning'и неблокирующие — алгоритм
 * пытается продолжить с fallback-мастером или с обрезанными данными.
 *
 * - `master_not_found`        — нет мастера под фильтр и нет fallback'а
 * - `fallback_used`           — применили `is_fallback=true` мастер
 * - `name_mismatch`           — найденный мастер не совпал с `expected_name_hint`
 * - `no_head_teacher`         — `head_teacher=null`, учительский разворот пропущен
 * - `students_overflow`       — учеников больше, чем вмещает выбранный layout
 * - `students_too_few`        — учеников меньше минимума (для мини/лайт)
 * - `students_empty`          — `input.students` пуст, секция учеников пропущена
 * - `students_odd_in_standard` — нечётный последний ученик в Стандарте, правая
 *                                страница оставлена пустой (degraded mode,
 *                                см. master-cleanup-tz §A4)
 * - `subjects_overflow`        — subjects.length > 24, лишние обрезаны (degraded)
 * - `class_photo_missing`      — мастер требует classPhotoFrame, в input нет full_class
 * - `half_class_missing`       — мастер требует halfLeftPhoto/halfRightPhoto, в input нет half
 * - `no_right_teacher_master`  — для subjects 0-8 нет ни half, ни full_class фото —
 *                                правая учительская страница пропущена
 * - `students_grid_no_special_master` — в grid-комплектации остался остаток
 *                                       (например 3 в Медиум) для которого
 *                                       нет специального мастера; используется
 *                                       обычный мастер с пустыми слотами
 *                                       (см. master-cleanup-tz §A5 для D-Medium)
 * - `adaptive_grid_fallback`     — для grid-комплектации не нашёлся мастер
 *                                  с минимальной нужной ёмкостью; используется
 *                                  максимальный доступный (например L-6 при
 *                                  отсутствии L-2/3/4 в БД)
 */
export type BuildWarningCode =
  | 'master_not_found'
  | 'fallback_used'
  | 'name_mismatch'
  | 'no_head_teacher'
  | 'students_overflow'
  | 'students_too_few'
  | 'students_empty'
  | 'students_odd_in_standard'
  | 'subjects_overflow'
  | 'class_photo_missing'
  | 'half_class_missing'
  | 'no_right_teacher_master'
  | 'students_grid_no_special_master'
  | 'adaptive_grid_fallback'
  // А.2.2.b — общий раздел альбома:
  | 'no_master_for_common_spread'   // нет мастера J-Spread (A5)
  | 'right_mirror_not_found'        // зеркальный мастер для правой страницы не нашёлся
  | 'common_right_page_empty'       // нечётное число фото, правая страница пустая
  | 'common_section_skipped';       // мастер не найден, фото не размещены

export type BuildWarning = {
  code: BuildWarningCode;
  detail: string;
};

/** Результат buildAlbum. */
export type BuildResult = {
  spreads: SpreadInstance[];
  warnings: BuildWarning[];
};

// ─── Внутреннее (используется в 0.10+) ────────────────────────────────────

/**
 * Изменяемый контекст одного запуска buildAlbum. Хранит накопленные
 * spreads/warnings и счётчик индекса разворота.
 *
 * `spreadCounter.value` — отдельный объект, чтобы передавать «по ссылке»
 * между секциями (intro → teachers → students) без возврата.
 */
export type BuildContext = {
  input: AlbumInput;
  config: Config;
  spreads: SpreadInstance[];
  warnings: BuildWarning[];
  spreadCounter: { value: number };
};

// ─── Pressets (фаза 0.5) ──────────────────────────────────────────────────
//
// Тип Preset описывает гибкую конфигурацию альбома, хранящуюся в таблице
// config_presets. В фазе 0.5.2 эти типы добавлены, но buildAlbum их пока НЕ
// использует — продолжает работать через старый Config/ConfigType.
//
// В фазе 0.5.3 buildAlbum переключится на Preset, scenarios.ts будет удалён.
//
// Принцип "богатая БД, простая логика": PresetConfig содержит ВСЕ возможные
// поля (включая зарезервированные на будущее additional_spreads, financial_mode,
// common_section, etc.), но builder в фазе 0.5 читает только подмножество
// (см. docs/phase-0.5-spec.md часть "Что builder читает в 0.5").

/**
 * Запись пресета из таблицы config_presets.
 */
export type Preset = {
  id: string;
  tenant_id: string | null;     // NULL = глобальный
  slug: string;
  name: string;
  description: string | null;
  print_type: PrintType;
  config: PresetConfig;
};

/**
 * Богатая структура config (JSONB в БД).
 *
 * 🟢 = читается buildAlbum в фазе 0.5
 * ⚪ = зарезервировано на будущее, builder игнорирует
 */
export type PresetConfig = {
  student_section: StudentSectionConfig;        // 🟢
  teacher_section: TeacherSectionConfig | null; // 🟢
  intro_section: IntroSectionConfig | null;     // 🟢
  cover_section: CoverSectionConfig;            // ⚪ (cover_type зарезервирован)
  common_section?: CommonSectionConfig | null;  // ⚪ полностью
  personal_spread_addon?: PersonalSpreadAddonConfig | null; // ⚪ полностью
};

// ─── Student section ──────────────────────────────────────────────────────

export type StudentSectionConfig = {
  spreads_per_student: SpreadsPerStudentConfig;
  base_layout_mode: BaseLayoutMode;
  first_spread_content: FirstSpreadContent;
  additional_spreads: AdditionalSpreadsConfig | null;     // ⚪
  thumbnails_section: ThumbnailsSectionConfig | null;
  /**
   * 🟢 0.5.3.1: жёсткая толщина страниц для adaptive_grid комплектаций.
   * - `null` → вычислять автоматически (Медиум: ceil(total / capacity))
   * - число → фиксированная толщина (Лайт=4, Мини=2)
   * Используется в buildGridStudents (0.5.3.3).
   */
  grid_base_pages: number | null;
};

export type SpreadsPerStudentConfig = {
  min: number;
  max: number;       // 🟢 (только =1 в 0.5)
  default: number;
  per_student: boolean; // ⚪
};

export type BaseLayoutMode =
  | 'single_page_per_student'  // E-Student-Standard (Стандарт), E-Student-Default (Универсал)
  | 'spread_per_student'       // E-Max-Left + E-Max-Right (Максимум, Индивидуальный)
  | 'grid_multiple_students';  // D-Medium / L-6 / N-12 (Медиум, Лайт, Мини)

export type FirstSpreadContent = {
  portrait: boolean;       // 🟢 (всегда true в 0.5)
  full_name: boolean;      // 🟢 (всегда true в 0.5)
  text: TextContent | null;
  friend_photos: FriendPhotosContent | null;
};

export type TextContent = {
  enabled: boolean;
  max_chars?: number;             // ⚪
  modes_allowed?: string[];       // ⚪ ('free' / 'quote_catalog')
  text_template_id?: string | null; // ⚪
};

export type FriendPhotosContent = {
  enabled: boolean;
  min: number;
  max: number;
  exclusive_in_album?: boolean;  // ⚪
};

export type AdditionalSpreadsConfig = {
  enabled: boolean;
  max_count: number;
  price_per_spread: number;
  content_options?: AdditionalSpreadContentOption[];
};

export type AdditionalSpreadContentOption = {
  name: string;
  uses_friend_photos: boolean;
  additional_text?: boolean;
  min_photos: number;
  max_photos: number;
};

export type ThumbnailsSectionConfig = {
  enabled: boolean;
  preferred_grid_size: number;
};

// ─── Teacher section ──────────────────────────────────────────────────────

export type TeacherSectionConfig = {
  enabled: boolean;
  layout: 'two_page' | 'one_page';
  show_head_teacher: boolean;
  max_subjects_per_page: number;
  right_page_content: 'auto_common_photo' | null;
  head_teachers_count?: number;          // ⚪ (мульти-учителя позже)
  default_text_when_empty?: string | null; // ⚪
};

// ─── Intro section (для soft) ─────────────────────────────────────────────

export type IntroSectionConfig = {
  type: 'single_page';
  with_photo?: boolean; // ⚪
};

// ─── Cover section ────────────────────────────────────────────────────────

export type CoverSectionConfig = {
  cover_type: 'portrait_photo' | 'common_photo' | 'design_only'; // 🟢 (на будущее)
  financial_mode?: 'required' | 'optional_paid_visible' | 'optional_paid_hidden'; // ⚪
  price?: number;       // ⚪
  per_student?: boolean; // ⚪
};

// ─── Common section (виньетки, коллажи) — ⚪ полностью ────────────────────

export type CommonSectionConfig = {
  enabled: boolean;
  auto_generate: boolean;
  vignette?: { enabled: boolean; per_student: boolean };
  collages?: { enabled: boolean; max_count: number };
  class_photo?: { enabled: boolean };
  half_class_photos?: { enabled: boolean; max_count: number };
  quarter_class_photos?: { enabled: boolean; max_count: number };
};

// ─── Personal spread addon — ⚪ полностью (отдельный модуль продукта) ─────

export type PersonalSpreadAddonConfig = {
  enabled: boolean;
  price: number;
  min_photos: number;
  max_photos: number;
  per_student: boolean;
};

// ─── MasterFilter (резолвер мастеров, используется в find-master + builder) ─

/**
 * Семантический фильтр для поиска мастера в `template_set.spreads`.
 *
 * `slot_capacity_min` — минимальная требуемая ёмкость по соответствующим
 * ключам. Кандидат проходит, если для каждого присутствующего ключа
 * `candidate.slot_capacity[key] >= filter[key]`.
 *
 * `is_fallback_allowed` — по умолчанию `false`: fallback-мастера
 * (`is_fallback=true`) рассматриваются только когда специализированный
 * кандидат не нашёлся.
 *
 * `expected_name_hint` — приоритет точного совпадения имени при ambiguous
 * match (см. find-master.ts:pickPreferringHint). Также используется для
 * генерации `name_mismatch` warning.
 *
 * До 0.5.3.4 этот тип жил в scenarios.ts; перенесён сюда в финале фазы 0.5.3.
 */
export type MasterFilter = {
  page_role: PageRole;
  applies_to_config: ConfigType;
  slot_capacity_min?: Partial<SlotCapacity>;
  is_spread?: boolean;
  is_fallback_allowed?: boolean;
  expected_name_hint?: string;
};
