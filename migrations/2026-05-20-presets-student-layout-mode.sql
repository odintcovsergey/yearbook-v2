-- РЭ.22.1: двух-осевая модель личного раздела.
--
-- Контекст:
-- В фазе РЭ.21.8.15 (миграция 2026-05-19-presets-student-layout-fields.sql)
-- были добавлены три плоских поля для семантического описания личного
-- раздела:
--   student_pages_per_student INT  -- 1 | 2 | NULL
--   student_friend_photos     INT  -- 0..10 | NULL
--   student_has_quote         BOOL -- true | false | NULL
--
-- Они работали только для Individual комплектации (все 3 поля NOT NULL).
-- Партнёр в UI заполнял их как 3 independent селекта — модель одно-осевая
-- и плохо отражает реальность: цитата фактически зависит от выбранного
-- режима личного раздела (в сетке Medium цитата есть, в Light/Mini нет;
-- в сетке размер N — отдельная характеристика которой в БД не было).
--
-- Решение Сергея 20.05.2026 (см. docs/phase-Р22-spec.md):
-- Партнёр выбирает режим личного раздела из 3 вариантов, и под каждым
-- режимом — свой набор параметров.
--   mode='page'   — 1 ученик/страница (Standard/Universal)
--                   параметры: friend_photos, has_quote
--   mode='spread' — 1 ученик/разворот (Maximum/Individual)
--                   параметры: friend_photos, has_quote
--   mode='grid'   — сетка N учеников на страницу (Medium/Light/Mini)
--                   параметры: grid_size (2..12), has_quote
--
-- Новые колонки:
--   student_layout_mode TEXT    -- 'page' | 'spread' | 'grid' | NULL
--                                  NULL = семантический поиск не активирован
--                                          (fallback по preset.id / density,
--                                           как сейчас работает legacy для
--                                           non-Individual пресетов).
--   student_grid_size   INT     -- 2..10 | NULL
--                                  Заполняется только для mode='grid'.
--                                  Сколько учеников на одной странице сетки.
--                                  Адаптивный хвост (последняя неполная
--                                  страница) подбирается engine'ом
--                                  семантически — список не нужен.
--
-- Все старые колонки (student_pages_per_student / student_friend_photos /
-- student_has_quote) остаются — РЭ.22.3 UI пишет в новые поля + дублирует
-- в legacy для отката Vercel. Удаление deprecated полей — ОТДЕЛЬНАЯ
-- сессия с двойным подтверждением необратимости (см. правило безопасных
-- миграций v90).
--
-- Применять до деплоя кода РЭ.22.2-РЭ.22.3 (по правилу ADD COLUMN:
-- сначала SQL → потом код).

ALTER TABLE presets
  ADD COLUMN IF NOT EXISTS student_layout_mode TEXT,
  ADD COLUMN IF NOT EXISTS student_grid_size INT;

-- Whitelist значений для student_layout_mode.
-- 'page'   = 1 ученик/страница (Standard/Universal комплектации).
-- 'spread' = 1 ученик/разворот (Maximum/Individual комплектации).
-- 'grid'   = сетка N учеников/страница (Medium/Light/Mini).
-- NULL = семантический поиск не активирован, engine идёт по legacy-пути
--        (жёсткие имена по preset.density / preset.id).
--
-- Postgres НЕ поддерживает ADD CONSTRAINT IF NOT EXISTS — используем
-- DO-блок с проверкой через pg_constraint (см. также миграцию РЭ.21.8.15
-- и hotfix 3e50d0e).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'presets_student_layout_mode_chk'
  ) THEN
    ALTER TABLE presets
      ADD CONSTRAINT presets_student_layout_mode_chk
      CHECK (student_layout_mode IS NULL OR student_layout_mode IN ('page', 'spread', 'grid'));
  END IF;
END $$;

-- Whitelist значений для student_grid_size: 2..12.
-- Минимум 2 — сетка из 1 ученика бессмысленна (для одного — mode='page').
-- Максимум 12 — реалистичный верхний предел (текущий Mini = 12 в библиотеке).
-- Свободное число в диапазоне (не enum) — партнёр может указать любое 5/7/8
-- если ему нужна нестандартная сетка, engine ищет мастер с подходящим
-- slot_capacity.students. Если мастера нет — warning со спецификацией
-- (РЭ.22.9), партнёр заказывает мастер у дизайнера.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'presets_student_grid_size_chk'
  ) THEN
    ALTER TABLE presets
      ADD CONSTRAINT presets_student_grid_size_chk
      CHECK (student_grid_size IS NULL OR (student_grid_size >= 2 AND student_grid_size <= 12));
  END IF;
END $$;

-- Проверка после применения:
--   SELECT id, display_name, density, student_layout_mode, student_grid_size
--   FROM presets ORDER BY id;
--
-- Ожидание: все 9 пресетов имеют student_layout_mode = NULL и
-- student_grid_size = NULL. Поля заполнятся когда суперадмин откроет
-- пресет в /super/presets после РЭ.22.3 и сохранит (или вручную через
-- SQL UPDATE — см. рекомендуемые стартовые значения в spec §5).
