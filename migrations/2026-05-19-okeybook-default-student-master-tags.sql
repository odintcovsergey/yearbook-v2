-- РЭ.21.8.15: проставление slot_capacity тегов для existing мастеров
-- учеников в template_set okeybook-default.
--
-- Контекст: SELECT 19.05.2026 показал что у E-Max-Left/Right,
-- E-Universal-Left/Right, E-Standard-Left/Right slot_capacity={} (пустой),
-- applies_to_configs=[] (пустой). Engine после РЭ.21.8.15 будет искать
-- мастеров по семантическим тегам — без этих тегов поиск не сработает.
--
-- Применить разово в Supabase SQL Editor после применения миграции
-- 2026-05-19-presets-student-layout-fields.sql.
--
-- Структура тегов:
--   slot_capacity:
--     students        — сколько учеников на странице (всегда 1 для E-*)
--     photos_friend   — сколько слотов под friend_photos
--     has_quote       — есть ли слот для studentquote (text)
--     has_name        — есть ли слот для studentname (text)
--     has_portrait    — есть ли слот для studentportrait (photo)
--   applies_to_configs:
--     массив preset.id где мастер используется (пустой = универсальный)
--   page_role:
--     'student' (одностраничный) | 'student_left' | 'student_right' (для пар)

-- ─── E-Standard-Left ───────────────────────────────────────────────────────
-- Стандарт: 1 ученик на 1 странице, портрет + имя + цитата, 0 фото с друзьями.
UPDATE spread_templates
SET
  slot_capacity = jsonb_build_object(
    'students', 1,
    'photos_friend', 0,
    'has_quote', true,
    'has_name', true,
    'has_portrait', true
  ),
  applies_to_configs = ARRAY['standard']::text[],
  page_role = 'student_left'
WHERE name = 'E-Standard-Left'
  AND template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default');

-- ─── E-Standard-Right ──────────────────────────────────────────────────────
-- Тот же что Left, но позиция справа на развороте.
UPDATE spread_templates
SET
  slot_capacity = jsonb_build_object(
    'students', 1,
    'photos_friend', 0,
    'has_quote', true,
    'has_name', true,
    'has_portrait', true
  ),
  applies_to_configs = ARRAY['standard']::text[],
  page_role = 'student_right'
WHERE name = 'E-Standard-Right'
  AND template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default');

-- ─── E-Universal-Left ──────────────────────────────────────────────────────
-- Универсал: 1 ученик на 1 странице, портрет + имя + цитата + 2 фото с друзьями.
UPDATE spread_templates
SET
  slot_capacity = jsonb_build_object(
    'students', 1,
    'photos_friend', 2,
    'has_quote', true,
    'has_name', true,
    'has_portrait', true
  ),
  applies_to_configs = ARRAY['universal']::text[],
  page_role = 'student_left'
WHERE name = 'E-Universal-Left'
  AND template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default');

-- ─── E-Universal-Right ─────────────────────────────────────────────────────
UPDATE spread_templates
SET
  slot_capacity = jsonb_build_object(
    'students', 1,
    'photos_friend', 2,
    'has_quote', true,
    'has_name', true,
    'has_portrait', true
  ),
  applies_to_configs = ARRAY['universal']::text[],
  page_role = 'student_right'
WHERE name = 'E-Universal-Right'
  AND template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default');

-- ─── E-Max-Left ────────────────────────────────────────────────────────────
-- Максимум: 1 ученик на развороте, левая страница = портрет + имя.
-- Текст-цитата и фото с друзьями — на правой странице (E-Max-Right).
UPDATE spread_templates
SET
  slot_capacity = jsonb_build_object(
    'students', 1,
    'photos_friend', 0,
    'has_quote', false,
    'has_name', true,
    'has_portrait', true
  ),
  applies_to_configs = ARRAY['maximum', 'individual']::text[],
  page_role = 'student_left'
WHERE name = 'E-Max-Left'
  AND template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default');

-- ─── E-Max-Right ───────────────────────────────────────────────────────────
-- Правая страница разворота Максимум: 4 фото с друзьями + текст-цитата.
UPDATE spread_templates
SET
  slot_capacity = jsonb_build_object(
    'students', 1,
    'photos_friend', 4,
    'has_quote', true,
    'has_name', false,
    'has_portrait', false
  ),
  applies_to_configs = ARRAY['maximum', 'individual']::text[],
  page_role = 'student_right'
WHERE name = 'E-Max-Right'
  AND template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default');

-- Проверить результат:
-- SELECT name, slot_capacity, applies_to_configs, page_role
-- FROM spread_templates
-- WHERE template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
--   AND name LIKE 'E-%';
