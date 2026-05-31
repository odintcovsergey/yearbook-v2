/**
 * Типы парсера IDML → ParsedTemplateSet.
 *
 * Архитектурные решения, формат IDML и правила парсинга —
 * см. docs/templates/idml-recon-notes.md (§6).
 */

// ─── Публичный формат плейсхолдера ────────────────────────────────────────

export type SpreadTemplateType =
  | 'student'
  | 'head_teacher'
  | 'subjects'
  | 'common'
  | 'cover'
  | 'intro';

export type Common = {
  /** lowercase-нормализованное имя плейсхолдера. */
  label: string;
  /**
   * Оригинальное имя из IDML (до lowercase-нормализации
   * и до добавления `_left`/`_right` суффиксов). Служебное поле
   * для отладки и фидбека дизайнеру.
   */
  original_label?: string;
  /** Координаты от верхнего-левого угла разворота. */
  x_mm: number;
  y_mm: number;
  width_mm: number;
  height_mm: number;
  /** Угол поворота фрейма в градусах, нормализован к [-180, 180]. */
  rotation_deg?: number;
};

export type PhotoPlaceholder = Common & {
  type: 'photo';
  fit: 'fill_proportional' | 'contain' | 'fill';
  is_circle?: boolean;
  required: boolean;
};

export type TextPlaceholder = Common & {
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
  // ─── Часть 3 ТЗ: текстовые эффекты для читаемости на пёстром фоне ──────
  // Обводка букв (stroke) и свечение/тень (glow). Все опциональны и
  // обратносовместимы — у старых мастеров отсутствуют (= эффекта нет).
  // Рендер: Konva нативно (stroke/strokeWidth, shadowColor/shadowBlur);
  // PDF — приблизительно (обводка реально, свечение упрощённо). undefined
  // в JSON эквивалентно «эффект выключен».
  /** Цвет обводки букв (hex), null/undefined = без обводки. */
  text_stroke_color?: string | null;
  /** Толщина обводки в pt. */
  text_stroke_width_pt?: number | null;
  /** Цвет свечения/тени (hex), null/undefined = без свечения. */
  text_glow_color?: string | null;
  /** Размытие свечения в pt. */
  text_glow_blur_pt?: number | null;
};

export type OvalPlaceholder = PhotoPlaceholder & {
  is_circle: true;
};

/**
 * Встроенная (embedded) картинка декора, извлечённая из IDML.
 *
 * Транзитный носитель между Этапом 2а (парсер достаёт base64 из
 * `Image > Properties > Contents`) и Этапом 2б (upload декодирует и грузит
 * в storage bucket template-decorations, затем проставляет `url` и удаляет
 * это поле перед записью JSON в БД). В саму БД `_embedded` не пишется.
 */
export type EmbeddedImage = {
  /** base64-содержимое картинки (без XMP-метаданных). */
  base64: string;
  /** Формат — для MIME и расширения файла при загрузке. */
  format: 'png' | 'jpeg';
};

/**
 * Часть 1 ТЗ: привязанный декор к слоту.
 *
 * Статичная картинка из IDML (вшитая embedded-картинка фрейма), привязанная
 * к базовому слоту через Script Label вида `<base>__under` / `<base>__over`.
 * В отличие от photo/text у декора НЕТ подстановки данных — это готовая
 * картинка (рамка-теремок, ленточка-баннер, орнамент).
 *
 * Динамика (см. builder, Этап 3): декор следует за базовым слотом —
 *   - базовый слот скрыт (`__hidden__<base>`) → декор тоже скрыт;
 *   - базовый слот смещён (`__pos__<base>`) → декор смещается на ту же
 *     дельту, сохраняя offset: deco_pos = new_base_pos + offset.
 *
 * Геометрия (x_mm/y_mm/width_mm/height_mm/rotation_deg из Common) — это
 * ИСХОДНОЕ положение декора в мастере (когда базовый слот не двигали).
 * offset_x_mm/offset_y_mm — смещение относительно базового слота, по нему
 * пересчитываем позицию когда слот сдвинут.
 */
export type DecorationPlaceholder = Common & {
  type: 'decoration';
  /** label базового слота, к которому привязан декор (например 'teacherphoto_1'). */
  attached_to: string;
  /** Слой относительно базового слота: 'under' (z ниже) / 'over' (z выше). */
  layer: 'under' | 'over';
  /**
   * URL картинки декора в storage (bucket template-decorations).
   * После Этапа 2а (только парсинг) пусто '' — заполняется на Этапе 2б
   * при загрузке `_embedded` в storage.
   */
  url: string;
  /** Смещение исходной позиции декора относительно базового слота, мм. */
  offset_x_mm: number;
  offset_y_mm: number;
  /**
   * Транзитная embedded-картинка из IDML (Этап 2а → 2б). В БД не пишется:
   * upload декодирует её, грузит в storage, ставит `url` и удаляет это поле.
   */
  _embedded?: EmbeddedImage;
};

export type Placeholder =
  | PhotoPlaceholder
  | TextPlaceholder
  | OvalPlaceholder
  | DecorationPlaceholder;

// ─── Правила применения мастера ───────────────────────────────────────────

export type SpreadTemplateRules = {
  applies_when?: {
    subjects_count?: { min: number; max: number };
  };
};

// ─── Результат парсинга одного мастера ────────────────────────────────────

export type ParsedSpreadTemplate = {
  /** Имя из MasterSpread.Name, например "E-Student-Left". */
  name: string;
  type: SpreadTemplateType;
  is_spread: boolean;
  width_mm: number;
  height_mm: number;
  placeholders: Placeholder[];
  rules: SpreadTemplateRules | null;
};

// ─── Предупреждения парсера ───────────────────────────────────────────────

export type ParserWarning = {
  message: string;
  /** Имя мастера, к которому относится предупреждение. */
  master?: string;
  /** Имя плейсхолдера, к которому относится предупреждение. */
  label?: string;
};

// ─── Полный результат парсинга IDML ───────────────────────────────────────

export type ParsedTemplateSet = {
  /** Размеры одной страницы в mm. */
  page_width_mm: number;
  page_height_mm: number;
  /** Размеры разворота в mm (для facing-pages = 2× ширина страницы). */
  spread_width_mm: number;
  spread_height_mm: number;
  /** Bleed в mm (DocumentBleedTopOffset и т.д. — берём максимум). */
  bleed_mm: number;
  /** FacingPages флаг из Preferences. */
  facing_pages: boolean;
  /** PageBinding из Preferences ("LeftToRight" | "RightToLeft"). */
  page_binding: 'LeftToRight' | 'RightToLeft';
  /** Все мастер-страницы из IDML. */
  spread_templates: ParsedSpreadTemplate[];
  /** Предупреждения, накопленные во время парсинга всего набора. */
  warnings: ParserWarning[];
};

// ─── Внутренние типы (геометрия) ──────────────────────────────────────────

/** Аффинная матрица 2×3 из IDML ItemTransform: a b c d tx ty. */
export type ItemTransform = {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
};

export type Point = { x: number; y: number };

export type BBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Геометрия разворота — результат `computeSpreadGeometry` из `extract-geometry.ts`.
 * Используется и `parse.ts` (для размеров мастера), и `extractPlaceholders`
 * (для нормализации координат и определения pageIndex по centroid bbox).
 */
export type SpreadGeometry = {
  width_mm: number;
  height_mm: number;
  /** spread origin = leftmost Page.ItemTransform.{tx, ty} в pt. */
  origin: Point;
  is_spread: boolean;
  /**
   * x-диапазоны страниц в spread coords (в pt). Длина массива = number of pages.
   * Используется для определения pageIndex фрейма по centroid его bbox
   * (для добавления `_left`/`_right` суффиксов в `dedupeLabels`).
   */
  pages_x_ranges: Array<{ x_min: number; x_max: number }>;
};
