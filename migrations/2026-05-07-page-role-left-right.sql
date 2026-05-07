-- Migration: расширить page_role значениями student_left/student_right
-- Дата: 2026-05-07
-- Подэтап: 0.10a.1
-- Цель: разрешить findMaster различать одностраничные зеркальные ученические
--       мастера. Согласуется с уже существующими teacher_left/teacher_right
--       (миграция 0.8.6.1).

-- 1. Расширяем CHECK constraint на page_role
ALTER TABLE spread_templates DROP CONSTRAINT IF EXISTS spread_templates_page_role_check;
ALTER TABLE spread_templates ADD CONSTRAINT spread_templates_page_role_check
  CHECK (page_role IS NULL OR page_role IN (
    'student',
    'student_left',
    'student_right',
    'student_grid',
    'student_overflow',
    'student_last',
    'teacher_left',
    'teacher_right',
    'common',
    'intro',
    'cover'
  ));

-- 2. Обновляем 5 мастеров до новых значений
-- E-Student-Default и E-Student-Standard остаются 'student'
-- (двухстраничные/legacy, парных Left/Right не имеют).
UPDATE spread_templates SET page_role = 'student_left'
  WHERE template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
    AND name IN ('E-Student-Left', 'E-Max-Left');

UPDATE spread_templates SET page_role = 'student_right'
  WHERE template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
    AND name IN ('E-Student-Right', 'E-Max-Right', 'E-Ind-Right-3');

-- Проверка после применения:
-- SELECT name, page_role FROM spread_templates
--   WHERE template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
--     AND name LIKE 'E-%' ORDER BY name;
-- Должно быть:
--   E-Ind-Right-3       student_right
--   E-Max-Left          student_left
--   E-Max-Right         student_right
--   E-Student-Default   student
--   E-Student-Left      student_left
--   E-Student-Right     student_right
--   E-Student-Standard  student
