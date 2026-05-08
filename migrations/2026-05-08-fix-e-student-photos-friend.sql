-- Миграция 0.15 — исправление slot_capacity.photos_friend и applies_to_configs
-- для E-Student мастеров.
--
-- Корень проблемы: парсер IDML в фазе 0.4 не вычислил photos_friend
-- из лейблов наподобие studentphotofriend_1/_2 и оставил slot_capacity
-- без этого поля. Также E-Student-Default попал в БД с пустыми
-- applies_to_configs / default_for_configs, из-за чего builder его не использовал.
--
-- Реальное содержимое мастеров (по визуальной проверке в IDML):
--   E-Student-Default  — 2 ученика, 4 фото с друзьями (по 2 на ученика) — Универсал-разворот
--   E-Student-Left     — 1 ученик слева, 2 фото с друзьями             — Универсал-одиночка-слева
--   E-Student-Right    — 1 ученик справа, 2 фото с друзьями            — Универсал-одиночка-справа
--   E-Student-Standard — 2 ученика без фото с друзьями                  — Стандарт-разворот

-- E-Student-Default: 2 ученика, 4 фото с друзьями (по 2 на ученика)
UPDATE spread_templates
SET
  slot_capacity = jsonb_set(slot_capacity, '{photos_friend}', '4'),
  applies_to_configs = ARRAY['universal'],
  default_for_configs = ARRAY['universal']
WHERE template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
  AND name = 'E-Student-Default';

-- E-Student-Left: 1 ученик, 2 фото с друзьями
UPDATE spread_templates
SET slot_capacity = jsonb_set(slot_capacity, '{photos_friend}', '2')
WHERE template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
  AND name = 'E-Student-Left';

-- E-Student-Right: 1 ученик, 2 фото с друзьями
UPDATE spread_templates
SET slot_capacity = jsonb_set(slot_capacity, '{photos_friend}', '2')
WHERE template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
  AND name = 'E-Student-Right';

-- E-Student-Standard: ничего не меняем (без photos_friend, applies_to_configs уже правильный)

-- Проверка
SELECT name, page_role, slot_capacity, applies_to_configs, default_for_configs, is_spread
FROM spread_templates
WHERE template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
  AND name LIKE 'E-Student%'
ORDER BY name;
