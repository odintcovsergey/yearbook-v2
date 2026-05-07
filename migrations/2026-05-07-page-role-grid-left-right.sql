-- Migration: расширить page_role значениями student_grid_left/student_grid_right
-- Дата: 2026-05-07
-- Подэтап: 0.10b.1
-- Цель: разрешить findMaster различать левые и правые сеточные ученические
--       мастера (D-Medium, L-6, N-12). По аналогии с миграцией 0.10a.1
--       (student_left/student_right для E-Student/E-Max).
--
-- НЕ ТРОГАЕМ:
--   D-Medium-Last-WithPhoto — page_role='student_last'
--   L-6-Last                — page_role='student_last'
--   L-Overflow-Row[-Right]  — page_role='student_overflow'
--   N-Overflow-Row[-Right]  — page_role='student_overflow'
-- Их различение Left/Right (если потребуется) делаем при работе над
-- соответствующими комплектациями в 0.11.

-- 1. Расширяем CHECK constraint на page_role
ALTER TABLE spread_templates DROP CONSTRAINT IF EXISTS spread_templates_page_role_check;
ALTER TABLE spread_templates ADD CONSTRAINT spread_templates_page_role_check
  CHECK (page_role IS NULL OR page_role IN (
    'student',
    'student_left',
    'student_right',
    'student_grid',
    'student_grid_left',
    'student_grid_right',
    'student_overflow',
    'student_last',
    'teacher_left',
    'teacher_right',
    'common',
    'intro',
    'cover'
  ));

-- 2. Обновляем 6 мастеров до новых значений.
UPDATE spread_templates SET page_role = 'student_grid_left'
  WHERE template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
    AND name IN ('D-Medium-Left', 'L-6-Left', 'N-12-Left');

UPDATE spread_templates SET page_role = 'student_grid_right'
  WHERE template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
    AND name IN ('D-Medium-Right', 'L-6-Right', 'N-12-Right');

-- Проверка после применения:
-- SELECT name, page_role FROM spread_templates
--   WHERE template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
--     AND name LIKE 'D-%' OR name LIKE 'L-%' OR name LIKE 'N-%'
--   ORDER BY name;
-- Ожидаемое (для D/L/N мастеров):
--   D-Medium-Last-WithPhoto  student_last
--   D-Medium-Left            student_grid_left
--   D-Medium-Right           student_grid_right
--   L-6-Last                 student_last
--   L-6-Left                 student_grid_left
--   L-6-Right                student_grid_right
--   L-Overflow-Row           student_overflow
--   L-Overflow-Row-Right     student_overflow
--   N-12-Left                student_grid_left
--   N-12-Right               student_grid_right
--   N-Overflow-Row           student_overflow
