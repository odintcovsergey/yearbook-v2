-- Миграция 0.11.3 — расширение default_for_configs для E-Max-Left/Right
-- чтобы они автоматически выбирались в Индивидуальном.
--
-- В Индивидуальном:
--   E-Max-Left  — левая страница (портрет + имя)
--   E-Max-Right — правая страница для учеников с 4 фото-друзьями
--   E-Ind-Right-3 — правая страница для учеников с ≤3 фото-друзьями
--
-- E-Ind-Right-3 уже имеет default_for_configs=['individual'].
-- Расширяем E-Max-Left/Right с ['maximum'] до ['maximum','individual'].

UPDATE spread_templates
SET default_for_configs = ARRAY['maximum', 'individual']
WHERE template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
  AND name IN ('E-Max-Left', 'E-Max-Right');

-- Проверка
SELECT name, default_for_configs
FROM spread_templates
WHERE template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
  AND (name LIKE 'E-Max-%' OR name = 'E-Ind-Right-3')
ORDER BY name;
