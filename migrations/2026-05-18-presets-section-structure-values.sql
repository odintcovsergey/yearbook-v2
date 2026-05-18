-- Фаза РЭ.21.2 — наполнение section_structure дефолтами для 7 пресетов.
--
-- ЗАМЕЧАНИЕ: это БАЗОВЫЕ дефолты, упрощённые относительно build_album.jsx.
-- Скрипт делает разные структуры в зависимости от sheet_type/чётности
-- учеников/overflow. Здесь — одна структура на пресет, без условий.
-- Engine при сборке пропустит слот если фотоматериала недостаточно —
-- например, FULL пропустится если нет full_class фото. Слоты soft_intro
-- и soft_final пропустятся для альбомов с sheet_type=hard.
--
-- Если структура какого-то пресета принципиально неправильна — поправим
-- отдельной миграцией. Сейчас цель — увидеть данные в Supabase в
-- человеческом виде, чтобы было что обсуждать.
--
-- Группировка:
--   - Mini-scale (mini-soft, individual):
--     [soft_intro, teachers, students, common(H,flex_A,FULL,flex_A,flex_B,flex_B), soft_final]
--   - Big-scale (standard, universal, medium, light, maximum):
--     [soft_intro, teachers, students, common(Q,Q,H,flex_A,flex_A,flex_A,flex_B,flex_B), soft_final]
--
-- vignette НЕ добавляется в дефолт — партнёр добавит сам если нужно.

UPDATE presets SET section_structure = '[
  {"type": "soft_intro"},
  {"type": "teachers"},
  {"type": "students"},
  {"type": "common", "slots": ["H", "flex_A", "FULL", "flex_A", "flex_B", "flex_B"]},
  {"type": "soft_final"}
]'::jsonb WHERE id = 'mini-soft';

UPDATE presets SET section_structure = '[
  {"type": "soft_intro"},
  {"type": "teachers"},
  {"type": "students"},
  {"type": "common", "slots": ["H", "flex_A", "FULL", "flex_A", "flex_B", "flex_B"]},
  {"type": "soft_final"}
]'::jsonb WHERE id = 'individual';

UPDATE presets SET section_structure = '[
  {"type": "soft_intro"},
  {"type": "teachers"},
  {"type": "students"},
  {"type": "common", "slots": ["Q", "Q", "H", "flex_A", "flex_A", "flex_A", "flex_B", "flex_B"]},
  {"type": "soft_final"}
]'::jsonb WHERE id = 'standard';

UPDATE presets SET section_structure = '[
  {"type": "soft_intro"},
  {"type": "teachers"},
  {"type": "students"},
  {"type": "common", "slots": ["Q", "Q", "H", "flex_A", "flex_A", "flex_A", "flex_B", "flex_B"]},
  {"type": "soft_final"}
]'::jsonb WHERE id = 'universal';

UPDATE presets SET section_structure = '[
  {"type": "soft_intro"},
  {"type": "teachers"},
  {"type": "students"},
  {"type": "common", "slots": ["Q", "Q", "H", "flex_A", "flex_A", "flex_A", "flex_B", "flex_B"]},
  {"type": "soft_final"}
]'::jsonb WHERE id = 'medium';

UPDATE presets SET section_structure = '[
  {"type": "soft_intro"},
  {"type": "teachers"},
  {"type": "students"},
  {"type": "common", "slots": ["Q", "Q", "H", "flex_A", "flex_A", "flex_A", "flex_B", "flex_B"]},
  {"type": "soft_final"}
]'::jsonb WHERE id = 'light';

UPDATE presets SET section_structure = '[
  {"type": "soft_intro"},
  {"type": "teachers"},
  {"type": "students"},
  {"type": "common", "slots": ["Q", "Q", "H", "flex_A", "flex_A", "flex_A", "flex_B", "flex_B"]},
  {"type": "soft_final"}
]'::jsonb WHERE id = 'maximum';

-- Проверочный запрос:
-- SELECT id, display_name, jsonb_pretty(section_structure) FROM presets ORDER BY id;
-- Ожидание: 7 строк, у каждой section_structure заполнен.
