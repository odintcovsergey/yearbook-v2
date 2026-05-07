-- Миграция 0.11.2 — добавление page_role 'student_overflow_right'
-- для L-Overflow-Row-Right (правая страница overflow в Лайт 31-32).
-- Семантическое различие убирает костыль "поиск по имени" в build.ts.

ALTER TABLE spread_templates
DROP CONSTRAINT IF EXISTS spread_templates_page_role_check;

ALTER TABLE spread_templates
ADD CONSTRAINT spread_templates_page_role_check CHECK (
  page_role IS NULL OR page_role IN (
    'student',
    'student_left',
    'student_right',
    'student_grid',
    'student_grid_left',
    'student_grid_right',
    'student_overflow',
    'student_overflow_right',
    'student_last',
    'teacher_left',
    'teacher_right',
    'common',
    'intro',
    'cover'
  )
);

UPDATE spread_templates
SET page_role = 'student_overflow_right'
WHERE template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
  AND name = 'L-Overflow-Row-Right';

-- Проверка
SELECT name, page_role, slot_capacity
FROM spread_templates
WHERE template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
  AND name LIKE '%Overflow%'
ORDER BY name;
