-- Подэтап 2.1 — флаг has_user_edits в album_layouts.
--
-- Контекст: в фазе 2 партнёр редактирует layout вручную (drag-and-drop).
-- save_album_layout (подэтап 2.5) ставит флаг в true. build_album
-- (подэтап 2.1, этот же подэтап) сбрасывает флаг в false при пересборке.
-- UI 2.7 проверяет флаг и спрашивает confirm перед пересборкой.
--
-- На момент применения в БД 2 layout-записи (Красночетайская СОШ, Школа 89).
-- DEFAULT false → существующие записи получают false автоматически.
-- Никаких данных не теряем.

-- Добавить колонку has_user_edits.
-- IF NOT EXISTS на случай если миграция случайно прогоняется дважды.
ALTER TABLE album_layouts
  ADD COLUMN IF NOT EXISTS has_user_edits boolean NOT NULL DEFAULT false;

-- Проверка структуры
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'album_layouts'
  AND column_name = 'has_user_edits';
-- Ожидание:
--   has_user_edits | boolean | NO | false

-- Проверка что у существующих записей флаг = false
SELECT id, album_id, has_user_edits FROM album_layouts;
-- Ожидание: 2 записи (или сколько на момент применения), все с
-- has_user_edits = false
