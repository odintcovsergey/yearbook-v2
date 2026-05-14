-- ═══════════════════════════════════════════════════════════════════════════
-- Тестовый L-Grid-12 для прототипа балансировки сетки 12 учеников.
--
-- Двухстраничный разворот 420×297 мм:
--   - 2 ряда × 6 колонок = 12 photo-ячеек
--   - 3 ячейки на левой странице (X: 20, 85, 150)
--   - 3 ячейки на правой странице (X: 230, 295, 360)
--   - Между правой 3-й и левой 4-й колонкой — корешок (зазор 80мм)
--   - Размер ячейки: 55×75 мм (фото) + 15 мм для текста
--
-- Способ B нумерации (сквозная по строкам через обе страницы):
--   Верхний ряд: 1, 2, 3 (лев) + 4, 5, 6 (прав)
--   Нижний ряд: 7, 8, 9 (лев) + 10, 11, 12 (прав)
--
-- Балансировка скрывает последние, начиная с 12, 11, 10, ...
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Cleanup ──────────────────────────────────────────────────────────
DELETE FROM template_sets WHERE id = '00000000-0000-0000-0000-000000000998';

-- ─── template_set ─────────────────────────────────────────────────────
INSERT INTO template_sets (
  id, tenant_id, name, slug, print_type, page_width_mm, page_height_mm,
  spread_width_mm, spread_height_mm, bleed_mm, is_global, facing_pages, page_binding
) VALUES (
  '00000000-0000-0000-0000-000000000998',
  NULL,
  'TEST — Балансировка L-Grid-12',
  'test-balance-grid12',
  'layflat',
  210, 297,
  420, 297,
  3,
  true,
  true,
  'LeftToRight'
);

-- ─── Мастер L-Grid-12 ──────────────────────────────────────────────────
--
-- Координаты ячеек (X, Y) для photo:
--   Верхний ряд (Y=40):
--     studentportrait_1: (20, 40)   ┐
--     studentportrait_2: (85, 40)   ├ левая страница
--     studentportrait_3: (150, 40)  ┘
--     studentportrait_4: (230, 40)  ┐
--     studentportrait_5: (295, 40)  ├ правая страница
--     studentportrait_6: (360, 40)  ┘
--   Нижний ряд (Y=170):
--     studentportrait_7: (20, 170)
--     studentportrait_8: (85, 170)
--     studentportrait_9: (150, 170)
--     studentportrait_10: (230, 170)
--     studentportrait_11: (295, 170)
--     studentportrait_12: (360, 170)
--
-- Ширина ячейки фото: 55 мм. Высота фото: 75 мм.
-- Текст под фото (studentname_N): на 5 мм ниже фото, та же X, высота 15 мм.

INSERT INTO spread_templates (
  template_set_id, name, type, is_spread, width_mm, height_mm,
  placeholders, rules, sort_order,
  applies_to_configs, default_for_configs, page_role, slot_capacity,
  is_fallback, mirror_for_soft, audit_notes,
  background_url
) VALUES (
  '00000000-0000-0000-0000-000000000998',
  'L-Grid-12',
  'student',
  true,
  420, 297,
  '[
    {"label": "studentportrait_1",  "type": "photo", "x_mm": 20,  "y_mm": 40,  "width_mm": 55, "height_mm": 75, "fit": "fill_proportional", "is_circle": false, "required": false},
    {"label": "studentname_1",  "type": "text",  "x_mm": 20,  "y_mm": 118, "width_mm": 55, "height_mm": 15, "font_family": "Helvetica", "font_size_pt": 9, "font_weight": "regular", "color": "#000000", "align": "center", "vertical_align": "top", "auto_fit": false, "default_text": "Фамилия Имя"},
    {"label": "studentportrait_2",  "type": "photo", "x_mm": 85,  "y_mm": 40,  "width_mm": 55, "height_mm": 75, "fit": "fill_proportional", "is_circle": false, "required": false},
    {"label": "studentname_2",  "type": "text",  "x_mm": 85,  "y_mm": 118, "width_mm": 55, "height_mm": 15, "font_family": "Helvetica", "font_size_pt": 9, "font_weight": "regular", "color": "#000000", "align": "center", "vertical_align": "top", "auto_fit": false, "default_text": "Фамилия Имя"},
    {"label": "studentportrait_3",  "type": "photo", "x_mm": 150, "y_mm": 40,  "width_mm": 55, "height_mm": 75, "fit": "fill_proportional", "is_circle": false, "required": false},
    {"label": "studentname_3",  "type": "text",  "x_mm": 150, "y_mm": 118, "width_mm": 55, "height_mm": 15, "font_family": "Helvetica", "font_size_pt": 9, "font_weight": "regular", "color": "#000000", "align": "center", "vertical_align": "top", "auto_fit": false, "default_text": "Фамилия Имя"},
    {"label": "studentportrait_4",  "type": "photo", "x_mm": 230, "y_mm": 40,  "width_mm": 55, "height_mm": 75, "fit": "fill_proportional", "is_circle": false, "required": false},
    {"label": "studentname_4",  "type": "text",  "x_mm": 230, "y_mm": 118, "width_mm": 55, "height_mm": 15, "font_family": "Helvetica", "font_size_pt": 9, "font_weight": "regular", "color": "#000000", "align": "center", "vertical_align": "top", "auto_fit": false, "default_text": "Фамилия Имя"},
    {"label": "studentportrait_5",  "type": "photo", "x_mm": 295, "y_mm": 40,  "width_mm": 55, "height_mm": 75, "fit": "fill_proportional", "is_circle": false, "required": false},
    {"label": "studentname_5",  "type": "text",  "x_mm": 295, "y_mm": 118, "width_mm": 55, "height_mm": 15, "font_family": "Helvetica", "font_size_pt": 9, "font_weight": "regular", "color": "#000000", "align": "center", "vertical_align": "top", "auto_fit": false, "default_text": "Фамилия Имя"},
    {"label": "studentportrait_6",  "type": "photo", "x_mm": 360, "y_mm": 40,  "width_mm": 55, "height_mm": 75, "fit": "fill_proportional", "is_circle": false, "required": false},
    {"label": "studentname_6",  "type": "text",  "x_mm": 360, "y_mm": 118, "width_mm": 55, "height_mm": 15, "font_family": "Helvetica", "font_size_pt": 9, "font_weight": "regular", "color": "#000000", "align": "center", "vertical_align": "top", "auto_fit": false, "default_text": "Фамилия Имя"},
    {"label": "studentportrait_7",  "type": "photo", "x_mm": 20,  "y_mm": 170, "width_mm": 55, "height_mm": 75, "fit": "fill_proportional", "is_circle": false, "required": false},
    {"label": "studentname_7",  "type": "text",  "x_mm": 20,  "y_mm": 248, "width_mm": 55, "height_mm": 15, "font_family": "Helvetica", "font_size_pt": 9, "font_weight": "regular", "color": "#000000", "align": "center", "vertical_align": "top", "auto_fit": false, "default_text": "Фамилия Имя"},
    {"label": "studentportrait_8",  "type": "photo", "x_mm": 85,  "y_mm": 170, "width_mm": 55, "height_mm": 75, "fit": "fill_proportional", "is_circle": false, "required": false},
    {"label": "studentname_8",  "type": "text",  "x_mm": 85,  "y_mm": 248, "width_mm": 55, "height_mm": 15, "font_family": "Helvetica", "font_size_pt": 9, "font_weight": "regular", "color": "#000000", "align": "center", "vertical_align": "top", "auto_fit": false, "default_text": "Фамилия Имя"},
    {"label": "studentportrait_9",  "type": "photo", "x_mm": 150, "y_mm": 170, "width_mm": 55, "height_mm": 75, "fit": "fill_proportional", "is_circle": false, "required": false},
    {"label": "studentname_9",  "type": "text",  "x_mm": 150, "y_mm": 248, "width_mm": 55, "height_mm": 15, "font_family": "Helvetica", "font_size_pt": 9, "font_weight": "regular", "color": "#000000", "align": "center", "vertical_align": "top", "auto_fit": false, "default_text": "Фамилия Имя"},
    {"label": "studentportrait_10", "type": "photo", "x_mm": 230, "y_mm": 170, "width_mm": 55, "height_mm": 75, "fit": "fill_proportional", "is_circle": false, "required": false},
    {"label": "studentname_10", "type": "text",  "x_mm": 230, "y_mm": 248, "width_mm": 55, "height_mm": 15, "font_family": "Helvetica", "font_size_pt": 9, "font_weight": "regular", "color": "#000000", "align": "center", "vertical_align": "top", "auto_fit": false, "default_text": "Фамилия Имя"},
    {"label": "studentportrait_11", "type": "photo", "x_mm": 295, "y_mm": 170, "width_mm": 55, "height_mm": 75, "fit": "fill_proportional", "is_circle": false, "required": false},
    {"label": "studentname_11", "type": "text",  "x_mm": 295, "y_mm": 248, "width_mm": 55, "height_mm": 15, "font_family": "Helvetica", "font_size_pt": 9, "font_weight": "regular", "color": "#000000", "align": "center", "vertical_align": "top", "auto_fit": false, "default_text": "Фамилия Имя"},
    {"label": "studentportrait_12", "type": "photo", "x_mm": 360, "y_mm": 170, "width_mm": 55, "height_mm": 75, "fit": "fill_proportional", "is_circle": false, "required": false},
    {"label": "studentname_12", "type": "text",  "x_mm": 360, "y_mm": 248, "width_mm": 55, "height_mm": 15, "font_family": "Helvetica", "font_size_pt": 9, "font_weight": "regular", "color": "#000000", "align": "center", "vertical_align": "top", "auto_fit": false, "default_text": "Фамилия Имя"}
  ]'::jsonb,
  null,
  0,
  ARRAY['light', 'mini']::text[],
  ARRAY[]::text[],
  'student',
  '{"students": 12}'::jsonb,
  false,
  false,
  'Тестовый L-Grid-12 для прототипа балансировки. 2 ряда × 6 колонок на разворот. Сквозная нумерация (способ B): верхний ряд 1-3 лев + 4-6 прав, нижний 7-9 лев + 10-12 прав.',
  null
);
