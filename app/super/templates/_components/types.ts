export type TemplateSet = {
  id: string
  name: string
  slug: string
  print_type: 'layflat' | 'soft'
  is_global: boolean
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
  created_at: string
  updated_at: string
  spread_count: number
}
