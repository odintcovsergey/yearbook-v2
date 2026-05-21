-- РЭ.30.1: миграция глобальных пресетов на семантическую модель.
--
-- Контекст (см. docs/phase-Р30-spec.md §«Этап Б — миграция данных»):
-- До этой миграции 6 из 7 глобальных пресетов жили на legacy-модели
-- (заполнен `density`, `student_layout_mode = NULL`). Engine для них
-- обязан был идти legacy-путём по жёстким именам мастеров (E-Student-*,
-- F-Head-*). Семантический поиск (РЭ.22) не активировался.
--
-- Сергей частично применил UPDATE'ы вручную через Supabase 21.05.2026.
-- Эта миграция приводит данные к согласованному финальному состоянию,
-- работая как идемпотентный «sync to known state» — повторное
-- применение даёт тот же результат.
--
-- Что делает миграция:
--   1. Для каждого из 7 глобальных пресетов:
--      - обнуляет `density` и `sheet_type` (legacy)
--      - проставляет `student_layout_mode` + параметры по mapping таблице
--      - проставляет `template_set_id = okeybook-default`
--                    («Белый плотные разворотами»)
--   2. Снимает `applies_to_configs` у E-* мастеров (используется только
--      legacy-движком; семантический поиск опирается на slot_capacity).
--
-- Mapping таблица (из spec §«Состояние данных»):
--   id          | mode    | grid_size | friends | quote
--   ────────────┼─────────┼───────────┼─────────┼──────
--   standard    | page    | NULL      | 0       | true
--   universal   | page    | NULL      | 2       | true
--   maximum     | spread  | NULL      | 4       | true
--   individual  | spread  | NULL      | 4       | true   (как maximum)
--   medium      | grid    | 4         | NULL    | true
--   light       | grid    | 6         | NULL    | false
--   mini-soft   | grid    | 12        | NULL    | false
--
-- Безопасность:
--   - Каждый UPDATE с WHERE по id AND tenant_id IS NULL — только глобальные.
--   - Партнёрские пресеты (tenant_id IS NOT NULL) не затрагиваются.
--   - Legacy-альбомы продолжают работать через fallback в engine
--     (`buildAlbum` + жёсткие имена мастеров) — см. spec §«Риски».
--
-- ⚠️ Применять ПОСЛЕ зелёного tsc/build кода (для этой миграции код
-- не меняется — только данные, так что порядок неважен).

-- ─── 1. standard: page, 0 друзей, цитата ──────────────────────────────────
UPDATE presets
SET
  density = NULL,
  sheet_type = NULL,
  student_layout_mode = 'page',
  student_grid_size = NULL,
  student_friend_photos = 0,
  student_has_quote = true,
  template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
WHERE id = 'standard' AND tenant_id IS NULL;

-- ─── 2. universal: page, 2 друга, цитата ──────────────────────────────────
UPDATE presets
SET
  density = NULL,
  sheet_type = NULL,
  student_layout_mode = 'page',
  student_grid_size = NULL,
  student_friend_photos = 2,
  student_has_quote = true,
  template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
WHERE id = 'universal' AND tenant_id IS NULL;

-- ─── 3. maximum: spread, 4 друга, цитата ──────────────────────────────────
UPDATE presets
SET
  density = NULL,
  sheet_type = NULL,
  student_layout_mode = 'spread',
  student_grid_size = NULL,
  student_friend_photos = 4,
  student_has_quote = true,
  template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
WHERE id = 'maximum' AND tenant_id IS NULL;

-- ─── 4. individual: spread, 4 друга, цитата (как maximum) ─────────────────
-- До этой миграции individual единственный не был мигрирован (mode=NULL).
-- Сергей решил 21.05.2026 — делаем как maximum.
UPDATE presets
SET
  density = NULL,
  sheet_type = NULL,
  student_layout_mode = 'spread',
  student_grid_size = NULL,
  student_friend_photos = 4,
  student_has_quote = true,
  template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
WHERE id = 'individual' AND tenant_id IS NULL;

-- ─── 5. medium: grid 4, цитата ────────────────────────────────────────────
UPDATE presets
SET
  density = NULL,
  sheet_type = NULL,
  student_layout_mode = 'grid',
  student_grid_size = 4,
  student_friend_photos = NULL,
  student_has_quote = true,
  template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
WHERE id = 'medium' AND tenant_id IS NULL;

-- ─── 6. light: grid 6, без цитаты ─────────────────────────────────────────
UPDATE presets
SET
  density = NULL,
  sheet_type = NULL,
  student_layout_mode = 'grid',
  student_grid_size = 6,
  student_friend_photos = NULL,
  student_has_quote = false,
  template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
WHERE id = 'light' AND tenant_id IS NULL;

-- ─── 7. mini-soft: grid 12, без цитаты ────────────────────────────────────
UPDATE presets
SET
  density = NULL,
  sheet_type = NULL,
  student_layout_mode = 'grid',
  student_grid_size = 12,
  student_friend_photos = NULL,
  student_has_quote = false,
  template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
WHERE id = 'mini-soft' AND tenant_id IS NULL;

-- ─── 8. Снять applies_to_configs у E-* мастеров ───────────────────────────
-- После перехода на семантический поиск engine выбирает мастер по
-- `slot_capacity` (students, photos_friend, has_quote, has_portrait,
-- has_name). Поле `applies_to_configs` использовалось только legacy
-- движком для жёсткой привязки мастера к комплектации
-- (universal/standard/...). После РЭ.30 оно больше не нужно.
--
-- Идемпотентно: повторное применение даёт тот же результат
-- (пустой массив остаётся пустым).
UPDATE spread_templates
SET applies_to_configs = ARRAY[]::text[]
WHERE name LIKE 'E-%'
  AND template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
  AND applies_to_configs IS DISTINCT FROM ARRAY[]::text[];

-- ─── Проверка результата ──────────────────────────────────────────────────
-- SELECT id, display_name, density, student_layout_mode,
--        student_grid_size, student_friend_photos, student_has_quote,
--        template_set_id
-- FROM presets
-- WHERE tenant_id IS NULL
-- ORDER BY id;
--
-- Ожидание:
--   • Все 7 строк имеют density = NULL и sheet_type = NULL.
--   • Все 7 строк имеют student_layout_mode IN ('page','spread','grid').
--   • Все 7 строк имеют template_set_id = 08baf556-7831-44e9-9ba8-4af20f19ee44.
--   • Параметры соответствуют mapping таблице выше.
--
-- SELECT name, applies_to_configs
-- FROM spread_templates
-- WHERE name LIKE 'E-%'
--   AND template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
-- ORDER BY name;
--
-- Ожидание: applies_to_configs = '{}' (пустой массив) у всех E-* мастеров.
