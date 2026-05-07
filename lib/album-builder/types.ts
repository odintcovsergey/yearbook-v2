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
 * - `full_class` — `classPhotoFrame`
 * - `half`       — `halfLeftPhoto`/`halfRightPhoto`/`halfPhoto_*`
 * - `quarter`    — `quarterPhoto_*`
 * - `sixth`      — `collagePhoto_*` в J-HalfSixth/SixthSixth/SixthFull
 * - `collage`    — `collagePhoto_*` в J-Collage
 *
 * В фазе 0 общий раздел `buildAlbum` не генерирует (см. idml-recon §9),
 * но соответствующие фото уже принимаются на вход — пригодятся в фазе 2-4.
 */
export type CommonPhotos = {
  full_class: Photo[];
  half: Photo[];
  quarter: Photo[];
  sixth: Photo[];
  collage: Photo[];
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
 * `spread_templates.page_role` (миграция 0.8.6.1 + 0.10a.1 + 0.10b.1).
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
 * Запись из `spread_templates` (миграция 0.1 + 0.8.6.1).
 *
 * `sort_order` — позиционный индекс из IDML (см. memory
 * `feedback_sort_order_semantics`); порядок применения определяется
 * не им, а семантическими тегами + сценариями (фильтрами в SCENARIOS).
 *
 * Семантические теги (`applies_to_configs`/`page_role`/`slot_capacity`/
 * `is_fallback`/`mirror_for_soft`/`audit_notes`) добавлены в 0.8.6.1
 * и заполнены для 39 мастеров в 0.8.6.2.
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
  | 'no_right_teacher_master';

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
