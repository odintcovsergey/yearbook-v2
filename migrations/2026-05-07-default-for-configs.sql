-- Миграция 0.11.1.5 — добавление default_for_configs для разделения
-- "технически совместим" (applies_to_configs) и "автовыбор в buildAlbum" (default_for_configs).

-- Шаг 1. Колонка + GIN индекс
ALTER TABLE spread_templates
ADD COLUMN default_for_configs text[] NOT NULL DEFAULT '{}';

CREATE INDEX idx_spread_templates_default_for_configs
ON spread_templates USING GIN (default_for_configs);

-- Шаг 2. Заполнение значений для всех 39 мастеров okeybook-default

-- E-Student-Default — fallback
UPDATE spread_templates SET default_for_configs = '{}'
WHERE template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
  AND name = 'E-Student-Default';

UPDATE spread_templates SET default_for_configs = ARRAY['standard']
WHERE template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
  AND name = 'E-Student-Standard';

UPDATE spread_templates SET default_for_configs = ARRAY['universal']
WHERE template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
  AND name IN ('E-Student-Left', 'E-Student-Right');

UPDATE spread_templates SET default_for_configs = ARRAY['maximum']
WHERE template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
  AND name IN ('E-Max-Left', 'E-Max-Right');

UPDATE spread_templates SET default_for_configs = ARRAY['individual']
WHERE template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
  AND name = 'E-Ind-Right-3';

UPDATE spread_templates SET default_for_configs = ARRAY['medium']
WHERE template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
  AND name LIKE 'D-Medium-%';

UPDATE spread_templates SET default_for_configs = ARRAY['light']
WHERE template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
  AND name LIKE 'L-%';

UPDATE spread_templates SET default_for_configs = ARRAY['mini', 'individual']
WHERE template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
  AND name LIKE 'N-%';

UPDATE spread_templates SET default_for_configs = ARRAY['standard','universal','maximum','medium','light','mini']
WHERE template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
  AND name IN ('F-Head-WithPhoto', 'F-Head-SmallGrid', 'F-Head-LargeGrid');

UPDATE spread_templates SET default_for_configs = ARRAY['mini']
WHERE template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
  AND name LIKE 'F-Head-%-R';

UPDATE spread_templates SET default_for_configs = ARRAY['standard','universal','maximum','medium','light','mini']
WHERE template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
  AND name LIKE 'G-%';

UPDATE spread_templates SET default_for_configs = '{}'
WHERE template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
  AND name LIKE 'J-%';

UPDATE spread_templates SET default_for_configs = ARRAY['standard','universal','maximum','medium','light','mini']
WHERE template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
  AND name = 'S-Intro';

UPDATE spread_templates SET default_for_configs = '{}'
WHERE template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
  AND name = 'S-Intro-Old';

-- Проверка
SELECT name, applies_to_configs, default_for_configs
FROM spread_templates
WHERE template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
ORDER BY name;
