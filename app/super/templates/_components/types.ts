export type TemplateSet = {
  id: string
  name: string
  slug: string
  print_type: 'layflat' | 'soft'
  is_global: boolean
  is_published: boolean
  tenant_id: string | null
  page_width_mm: number
  page_height_mm: number
  spread_width_mm: number
  spread_height_mm: number
  bleed_mm: number
  facing_pages: boolean
  page_binding: 'LeftToRight' | 'RightToLeft'
  description: string | null
  cover_preview_url: string | null
  default_background_url: string | null
  /** Модель «поля»: отступ контента от корешка (мм). null = legacy зеркало. */
  spine_margin_mm: number | null
  /**
   * Семейство пропорций дизайна (ТЗ 19.06.2026). null → вычисляется из пропорции
   * page_width/height (см. lib/format-adapt). Адаптация под формат заказа —
   * только внутри одного семейства.
   */
  format_family: 'vertical_rect' | 'square' | 'horizontal' | null
  created_at: string
  updated_at: string
  spread_count: number
}

// ============================================================
// Placeholder — discriminated union по type ('photo' | 'text').
// Узкие union'ы fit/vertical_align соответствуют реальным данным
// в БД на 06.05.2026 (один шаблон «okeybook-default», 39 spreads).
// ============================================================

export type PlaceholderBase = {
  label: string
  original_label: string
  x_mm: number
  y_mm: number
  width_mm: number
  height_mm: number
  rotation_deg: number
  required: boolean
}

export type PhotoPlaceholder = PlaceholderBase & {
  type: 'photo'
  // TODO 0.9+: расширить если парсер начнёт извлекать fit_proportional/stretch
  fit: 'fill_proportional'
}

export type TextPlaceholder = PlaceholderBase & {
  type: 'text'
  align: 'left' | 'center' | 'right' | 'justify'
  // TODO 0.9+: расширить если парсер начнёт извлекать center/bottom
  vertical_align: 'top'
  color: string
  font_family: string
  font_weight: string  // open string — IDML много вариантов
  font_size_pt: number
  min_size_pt?: number
  auto_fit: boolean
}

export type Placeholder = PhotoPlaceholder | TextPlaceholder

// ============================================================
// SpreadTemplate — соответствует SPREAD_TEMPLATE_FIELDS в /api/layout.
// type — широкий enum (E-Student-Left, F-Teacher, J-* и т.д.), оставляем string.
// ============================================================

export type SpreadTemplate = {
  id: string
  name: string
  type: string
  is_spread: boolean
  width_mm: number
  height_mm: number
  placeholders: Placeholder[]
  rules: unknown  // TODO 0.8.2+: типизировать когда поймём как используются
  sort_order: number
  background_url: string | null
  created_at: string
}

export type TemplateSetDetailResponse = {
  template_set: Omit<TemplateSet, 'spread_count'>
  spread_templates: SpreadTemplate[]
}
