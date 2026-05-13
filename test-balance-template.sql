-- ═══════════════════════════════════════════════════════════════════════════
-- Тестовый template_set для прототипа алгоритма балансировки
-- (Сергей попросил создать через SQL вместо InDesign)
--
-- Содержит 1 двухстраничный мастер с regular grid 3×3 = 9 слотов:
--   - Левая страница: классрук (фото + подпись) + групповое фото
--   - Правая страница: 3×3 сетка предметников (фото + ФИО + предмет)
--
-- Назначение: алгоритм balanceRegularGrid должен уметь красиво
-- расставить 1..9 предметников в этой сетке.
--
-- Размер разворота: 420×297 мм (как в ТЗ заглушке)
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 0. Cleanup на случай повторного применения ────────────────────────
-- Удаляем старый тестовый template_set если он уже создан раньше.
-- ON DELETE CASCADE удалит spread_templates автоматически.
DELETE FROM template_sets WHERE id = '00000000-0000-0000-0000-000000000999';

-- ─── 1. template_set ───────────────────────────────────────────────────
INSERT INTO template_sets (
  id, tenant_id, name, slug, print_type, page_width_mm, page_height_mm,
  spread_width_mm, spread_height_mm, bleed_mm, is_global, facing_pages, page_binding
) VALUES (
  '00000000-0000-0000-0000-000000000999',  -- предсказуемый UUID для теста
  NULL,
  'TEST — Балансировка regular grid',
  'test-balance-grid',
  'layflat',
  210, 297,
  420, 297,
  3,
  true,
  true,
  'LeftToRight'
);

-- ─── 2. Мастер: T-TEST-Grid-9 (классрук + групповое + сетка 3×3) ──────
--
-- Координаты в мм от левого верхнего угла разворота.
-- Левая страница: 0..210 (x), правая: 210..420.
--
-- Левая страница раскладка:
--   - Классрук фото: x=20, y=30, 80×100мм
--   - Текст под классруком: x=20, y=140, 80×15мм
--   - Групповое фото: x=20, y=180, 170×90мм
--
-- Правая страница раскладка (3×3 grid):
--   - Сетка 3×3, отступы 15мм слева/справа от страницы
--   - Доступная ширина = 210-30 = 180мм / 3 колонки = 60мм на колонку
--   - С отступом между ячейками 5мм: ячейка = 55мм ширина
--   - Высота ячейки: 75мм (фото 55мм + текст 20мм)
--   - Начало сетки: x=225, y=30 (с отступом 15мм от центра разворота)
--
--   Координаты ячеек (по схеме [колонка][ряд]):
--     row 0:  (225,30), (285,30), (345,30)
--     row 1:  (225,110), (285,110), (345,110)
--     row 2:  (225,190), (285,190), (345,190)
--
-- ПОРЯДОК placeholder'ов в sort_order — критичен для балансировки.
-- Первые placeholder'ы — обязательные (классрук, групповое).
-- Затем предметники по порядку слева-направо, сверху-вниз.
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO spread_templates (
  template_set_id, name, type, is_spread, width_mm, height_mm,
  placeholders, rules, sort_order,
  applies_to_configs, default_for_configs, page_role, slot_capacity,
  is_fallback, mirror_for_soft, audit_notes,
  background_url
) VALUES (
  '00000000-0000-0000-0000-000000000999',
  'T-TEST-Grid-9',
  'subjects',
  true,
  420, 297,
  '[
    {
      "label": "teacherphoto_head",
      "type": "photo",
      "x_mm": 20, "y_mm": 30, "width_mm": 80, "height_mm": 100,
      "fit": "fill_proportional",
      "is_circle": false,
      "required": false
    },
    {
      "label": "teachername_head",
      "type": "text",
      "x_mm": 20, "y_mm": 140, "width_mm": 80, "height_mm": 15,
      "font_family": "Helvetica",
      "font_size_pt": 14,
      "font_weight": "bold",
      "color": "#000000",
      "align": "center",
      "vertical_align": "middle",
      "auto_fit": false,
      "default_text": "Классный руководитель"
    },
    {
      "label": "groupphoto_1",
      "type": "photo",
      "x_mm": 20, "y_mm": 180, "width_mm": 170, "height_mm": 90,
      "fit": "fill_proportional",
      "is_circle": false,
      "required": false
    },
    {
      "label": "teacherphoto_1",
      "type": "photo",
      "x_mm": 225, "y_mm": 30, "width_mm": 55, "height_mm": 55,
      "fit": "fill_proportional",
      "is_circle": true,
      "required": false
    },
    {
      "label": "teachername_1",
      "type": "text",
      "x_mm": 225, "y_mm": 88, "width_mm": 55, "height_mm": 8,
      "font_family": "Helvetica",
      "font_size_pt": 9,
      "font_weight": "bold",
      "color": "#000000",
      "align": "center",
      "vertical_align": "middle",
      "auto_fit": false,
      "default_text": "Фамилия Имя"
    },
    {
      "label": "teachersubject_1",
      "type": "text",
      "x_mm": 225, "y_mm": 97, "width_mm": 55, "height_mm": 6,
      "font_family": "Helvetica",
      "font_size_pt": 7,
      "font_weight": "regular",
      "color": "#666666",
      "align": "center",
      "vertical_align": "middle",
      "auto_fit": false,
      "default_text": "учитель ..."
    },
    {
      "label": "teacherphoto_2",
      "type": "photo",
      "x_mm": 285, "y_mm": 30, "width_mm": 55, "height_mm": 55,
      "fit": "fill_proportional",
      "is_circle": true,
      "required": false
    },
    {
      "label": "teachername_2",
      "type": "text",
      "x_mm": 285, "y_mm": 88, "width_mm": 55, "height_mm": 8,
      "font_family": "Helvetica",
      "font_size_pt": 9,
      "font_weight": "bold",
      "color": "#000000",
      "align": "center",
      "vertical_align": "middle",
      "auto_fit": false,
      "default_text": "Фамилия Имя"
    },
    {
      "label": "teachersubject_2",
      "type": "text",
      "x_mm": 285, "y_mm": 97, "width_mm": 55, "height_mm": 6,
      "font_family": "Helvetica",
      "font_size_pt": 7,
      "font_weight": "regular",
      "color": "#666666",
      "align": "center",
      "vertical_align": "middle",
      "auto_fit": false,
      "default_text": "учитель ..."
    },
    {
      "label": "teacherphoto_3",
      "type": "photo",
      "x_mm": 345, "y_mm": 30, "width_mm": 55, "height_mm": 55,
      "fit": "fill_proportional",
      "is_circle": true,
      "required": false
    },
    {
      "label": "teachername_3",
      "type": "text",
      "x_mm": 345, "y_mm": 88, "width_mm": 55, "height_mm": 8,
      "font_family": "Helvetica",
      "font_size_pt": 9,
      "font_weight": "bold",
      "color": "#000000",
      "align": "center",
      "vertical_align": "middle",
      "auto_fit": false,
      "default_text": "Фамилия Имя"
    },
    {
      "label": "teachersubject_3",
      "type": "text",
      "x_mm": 345, "y_mm": 97, "width_mm": 55, "height_mm": 6,
      "font_family": "Helvetica",
      "font_size_pt": 7,
      "font_weight": "regular",
      "color": "#666666",
      "align": "center",
      "vertical_align": "middle",
      "auto_fit": false,
      "default_text": "учитель ..."
    },
    {
      "label": "teacherphoto_4",
      "type": "photo",
      "x_mm": 225, "y_mm": 110, "width_mm": 55, "height_mm": 55,
      "fit": "fill_proportional",
      "is_circle": true,
      "required": false
    },
    {
      "label": "teachername_4",
      "type": "text",
      "x_mm": 225, "y_mm": 168, "width_mm": 55, "height_mm": 8,
      "font_family": "Helvetica",
      "font_size_pt": 9,
      "font_weight": "bold",
      "color": "#000000",
      "align": "center",
      "vertical_align": "middle",
      "auto_fit": false,
      "default_text": "Фамилия Имя"
    },
    {
      "label": "teachersubject_4",
      "type": "text",
      "x_mm": 225, "y_mm": 177, "width_mm": 55, "height_mm": 6,
      "font_family": "Helvetica",
      "font_size_pt": 7,
      "font_weight": "regular",
      "color": "#666666",
      "align": "center",
      "vertical_align": "middle",
      "auto_fit": false,
      "default_text": "учитель ..."
    },
    {
      "label": "teacherphoto_5",
      "type": "photo",
      "x_mm": 285, "y_mm": 110, "width_mm": 55, "height_mm": 55,
      "fit": "fill_proportional",
      "is_circle": true,
      "required": false
    },
    {
      "label": "teachername_5",
      "type": "text",
      "x_mm": 285, "y_mm": 168, "width_mm": 55, "height_mm": 8,
      "font_family": "Helvetica",
      "font_size_pt": 9,
      "font_weight": "bold",
      "color": "#000000",
      "align": "center",
      "vertical_align": "middle",
      "auto_fit": false,
      "default_text": "Фамилия Имя"
    },
    {
      "label": "teachersubject_5",
      "type": "text",
      "x_mm": 285, "y_mm": 177, "width_mm": 55, "height_mm": 6,
      "font_family": "Helvetica",
      "font_size_pt": 7,
      "font_weight": "regular",
      "color": "#666666",
      "align": "center",
      "vertical_align": "middle",
      "auto_fit": false,
      "default_text": "учитель ..."
    },
    {
      "label": "teacherphoto_6",
      "type": "photo",
      "x_mm": 345, "y_mm": 110, "width_mm": 55, "height_mm": 55,
      "fit": "fill_proportional",
      "is_circle": true,
      "required": false
    },
    {
      "label": "teachername_6",
      "type": "text",
      "x_mm": 345, "y_mm": 168, "width_mm": 55, "height_mm": 8,
      "font_family": "Helvetica",
      "font_size_pt": 9,
      "font_weight": "bold",
      "color": "#000000",
      "align": "center",
      "vertical_align": "middle",
      "auto_fit": false,
      "default_text": "Фамилия Имя"
    },
    {
      "label": "teachersubject_6",
      "type": "text",
      "x_mm": 345, "y_mm": 177, "width_mm": 55, "height_mm": 6,
      "font_family": "Helvetica",
      "font_size_pt": 7,
      "font_weight": "regular",
      "color": "#666666",
      "align": "center",
      "vertical_align": "middle",
      "auto_fit": false,
      "default_text": "учитель ..."
    },
    {
      "label": "teacherphoto_7",
      "type": "photo",
      "x_mm": 225, "y_mm": 190, "width_mm": 55, "height_mm": 55,
      "fit": "fill_proportional",
      "is_circle": true,
      "required": false
    },
    {
      "label": "teachername_7",
      "type": "text",
      "x_mm": 225, "y_mm": 248, "width_mm": 55, "height_mm": 8,
      "font_family": "Helvetica",
      "font_size_pt": 9,
      "font_weight": "bold",
      "color": "#000000",
      "align": "center",
      "vertical_align": "middle",
      "auto_fit": false,
      "default_text": "Фамилия Имя"
    },
    {
      "label": "teachersubject_7",
      "type": "text",
      "x_mm": 225, "y_mm": 257, "width_mm": 55, "height_mm": 6,
      "font_family": "Helvetica",
      "font_size_pt": 7,
      "font_weight": "regular",
      "color": "#666666",
      "align": "center",
      "vertical_align": "middle",
      "auto_fit": false,
      "default_text": "учитель ..."
    },
    {
      "label": "teacherphoto_8",
      "type": "photo",
      "x_mm": 285, "y_mm": 190, "width_mm": 55, "height_mm": 55,
      "fit": "fill_proportional",
      "is_circle": true,
      "required": false
    },
    {
      "label": "teachername_8",
      "type": "text",
      "x_mm": 285, "y_mm": 248, "width_mm": 55, "height_mm": 8,
      "font_family": "Helvetica",
      "font_size_pt": 9,
      "font_weight": "bold",
      "color": "#000000",
      "align": "center",
      "vertical_align": "middle",
      "auto_fit": false,
      "default_text": "Фамилия Имя"
    },
    {
      "label": "teachersubject_8",
      "type": "text",
      "x_mm": 285, "y_mm": 257, "width_mm": 55, "height_mm": 6,
      "font_family": "Helvetica",
      "font_size_pt": 7,
      "font_weight": "regular",
      "color": "#666666",
      "align": "center",
      "vertical_align": "middle",
      "auto_fit": false,
      "default_text": "учитель ..."
    },
    {
      "label": "teacherphoto_9",
      "type": "photo",
      "x_mm": 345, "y_mm": 190, "width_mm": 55, "height_mm": 55,
      "fit": "fill_proportional",
      "is_circle": true,
      "required": false
    },
    {
      "label": "teachername_9",
      "type": "text",
      "x_mm": 345, "y_mm": 248, "width_mm": 55, "height_mm": 8,
      "font_family": "Helvetica",
      "font_size_pt": 9,
      "font_weight": "bold",
      "color": "#000000",
      "align": "center",
      "vertical_align": "middle",
      "auto_fit": false,
      "default_text": "Фамилия Имя"
    },
    {
      "label": "teachersubject_9",
      "type": "text",
      "x_mm": 345, "y_mm": 257, "width_mm": 55, "height_mm": 6,
      "font_family": "Helvetica",
      "font_size_pt": 7,
      "font_weight": "regular",
      "color": "#666666",
      "align": "center",
      "vertical_align": "middle",
      "auto_fit": false,
      "default_text": "учитель ..."
    }
  ]'::jsonb,
  null,
  0,
  ARRAY[]::text[],
  ARRAY[]::text[],
  'teacher_left',
  '{"teachers": 9, "head_teacher": 1, "photos_full": 1}'::jsonb,
  false,
  false,
  'Тестовый мастер для прототипа балансировки. 3×3 сетка предметников, классрук + групповое фото слева.',
  null
);

-- ─── Проверка результата ──────────────────────────────────────────────
-- SELECT id, name, jsonb_array_length(placeholders) AS placeholder_count
-- FROM spread_templates
-- WHERE template_set_id = '00000000-0000-0000-0000-000000000999';
--
-- Должно быть: T-TEST-Grid-9, 28 placeholders (1+1+1 левых + 9*3 правых)
