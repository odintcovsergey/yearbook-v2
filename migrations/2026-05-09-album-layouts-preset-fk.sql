-- Подэтап 1.1 — schema P3 для album_layouts.
-- Контекст: в фазе 0.5 пресет (config_presets) стал единственным источником
-- комплектации и типа печати. Колонки album_layouts.config_type/print_type
-- больше не нужны — их заменяет config_preset_id (FK).
-- Также добавляем warnings jsonb для хранения warning'ов от builder +
-- smart-fill (фаза 1.3).
--
-- Перед применением: SELECT COUNT(*) FROM album_layouts должен быть 0
-- (проверено 09.05.2026). Никаких данных не теряем.
-- В коде ни одного запроса к album_layouts нет — DROP COLUMN не сломает
-- сборку.

-- 1. Удалить legacy колонки.
-- IF EXISTS на случай если миграция случайно прогоняется дважды.
ALTER TABLE album_layouts
  DROP COLUMN IF EXISTS config_type,
  DROP COLUMN IF EXISTS print_type;

-- 2. Добавить FK на config_presets.
-- Без NOT NULL — endpoint 1.3 гарантирует наличие через бизнес-логику.
ALTER TABLE album_layouts
  ADD COLUMN IF NOT EXISTS config_preset_id uuid REFERENCES config_presets(id);

-- 3. Добавить warnings jsonb с default'ом.
-- NOT NULL DEFAULT '[]' — пустой массив если warning'ов нет, чтобы
-- upsert мог не передавать поле явно.
ALTER TABLE album_layouts
  ADD COLUMN IF NOT EXISTS warnings jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Проверка структуры
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'album_layouts'
ORDER BY ordinal_position;
-- Ожидание (после миграции):
--   id           | uuid                        | NO  | gen_random_uuid()
--   album_id     | uuid                        | NO  |
--   template_set_id | uuid                     | NO  |
--   spreads      | jsonb                       | NO  |
--   status       | text                        | NO  | 'draft'
--   created_at   | timestamp with time zone    | NO  | now()
--   updated_at   | timestamp with time zone    | NO  | now()
--   config_preset_id | uuid                    | YES |
--   warnings     | jsonb                       | NO  | '[]'::jsonb
-- (точный набор может отличаться по количеству и порядку — главное:
-- config_type и print_type отсутствуют, config_preset_id и warnings есть)

-- Проверка количества записей (должно быть 0 — таблица пустая)
SELECT COUNT(*) AS layouts_count FROM album_layouts;
-- Ожидание: 0
