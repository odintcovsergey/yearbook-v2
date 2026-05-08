-- 0.5.3.1: расширяем структуру config двумя полями
--   1. student_section.grid_base_pages — толщина альбома для adaptive_grid
--      (light=4, mini=2, остальные=null)
--   2. individual.first_spread_content.friend_photos.max: 3 → 4
--      (сохранение поведения фазы 0: для 4 фото используется E-Max-Right)

-- light: grid_base_pages = 4
UPDATE config_presets
SET config = jsonb_set(config, '{student_section,grid_base_pages}', '4'::jsonb)
WHERE slug IN ('light-layflat', 'light-soft');

-- mini: grid_base_pages = 2
UPDATE config_presets
SET config = jsonb_set(config, '{student_section,grid_base_pages}', '2'::jsonb)
WHERE slug IN ('mini-layflat', 'mini-soft');

-- остальные: grid_base_pages = null (явно)
UPDATE config_presets
SET config = jsonb_set(config, '{student_section,grid_base_pages}', 'null'::jsonb)
WHERE slug IN (
  'standard-layflat', 'standard-soft',
  'universal-layflat', 'universal-soft',
  'maximum-layflat', 'maximum-soft',
  'medium-layflat', 'medium-soft',
  'individual-layflat', 'individual-soft'
);

-- individual: friend_photos.max 3 → 4
UPDATE config_presets
SET config = jsonb_set(
  config, '{student_section,first_spread_content,friend_photos,max}', '4'::jsonb
)
WHERE slug IN ('individual-layflat', 'individual-soft');

-- Проверка
SELECT slug,
       config->'student_section'->>'grid_base_pages' AS grid_base_pages,
       config->'student_section'->'first_spread_content'->'friend_photos' AS friend_photos
FROM config_presets
ORDER BY slug;
