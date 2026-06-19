-- ТЗ «адаптация макета под формат типографии» (19.06.2026).
-- Семейство пропорций дизайна: 'vertical_rect' | 'square' | 'horizontal'.
-- Адаптация (масштаб контента под формат заказа) делается только ВНУТРИ одного
-- семейства. Колонка nullable: если NULL — код вычисляет семейство по пропорции
-- мастера (page_width_mm/page_height_mm), так что существующие дизайны работают
-- без backfill. Обратносовместимо.

alter table template_sets
  add column if not exists format_family text
    check (format_family is null or format_family in ('vertical_rect', 'square', 'horizontal'));

-- Откат (если понадобится):
--   alter table template_sets drop column if exists format_family;
