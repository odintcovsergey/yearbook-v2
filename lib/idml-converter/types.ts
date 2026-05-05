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
};

export type OvalPlaceholder = PhotoPlaceholder & {
  is_circle: true;
};

export type Placeholder = PhotoPlaceholder | TextPlaceholder | OvalPlaceholder;

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
