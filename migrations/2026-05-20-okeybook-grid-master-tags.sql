-- РЭ.22.6.0: разметка существующих grid-мастеров для семантического поиска.
--
-- Контекст:
-- В РЭ.22.6 engine для mode='grid' (Medium/Light/Mini комплектации)
-- переключается с жёстких имён M-Grid-Page / L-Grid-Page / N-Grid-Page
-- на семантический поиск через findStudentMaster. Чтобы поиск находил
-- существующие мастера, у них должны быть размечены:
--   - page_role = 'student_grid' (симметричный, годится для левой и правой)
--   - slot_capacity со students=N (сколько учеников на странице) и
--     булевыми тегами has_portrait/has_name/has_quote
--
-- Текущее состояние в БД (выгрузка 20.05.2026):
--   L-Grid-12          | page_role='student'  | {"students":12}    -- частично
--   L-Grid-Page        | page_role=NULL       | {}                  -- не размечен
--   M-Grid-Page        | page_role=NULL       | {}                  -- не размечен
--   N-Grid-Page        | page_role=NULL       | {}                  -- не размечен
--   *-Combined-Page (M/L/N) | page_role=NULL  | {}                  -- не размечены
--
-- Адаптивные мастера (L-2/L-3/L-4, N-4/N-6/N-9) в БД ОТСУТСТВУЮТ —
-- они есть только в коде как имена для fallback'а. Будут нарисованы
-- дизайнером позже, размечены отдельной миграцией.
--
-- ⚠️ Эта миграция БЕЗУСЛОВНО overwrites page_role и slot_capacity для
-- перечисленных имён мастеров. Если в БД были ручные правки (например
-- кастомные slot_capacity-теги) — они потеряются. Текущая выгрузка
-- показывает что у всех перечисленных мастеров значения дефолтные
-- (NULL / {} / минимальные {"students":12}), так что риск нулевой.
--
-- Применяется до деплоя кода РЭ.22.6 (правило ADD COLUMN-like:
-- сначала данные → потом код, см. правила безопасных миграций v90).
--
-- Динамический подсчёт slot_capacity:
-- Числа берутся через jsonb_array_elements(placeholders) — миграция
-- НЕ предполагает конкретных значений, всё считается из реальных
-- placeholder'ов мастера. Это безопасно для любой комбинации M=3/4/5
-- учеников, L=4/5/6, N=8/9/12 и т.п. Названия placeholder'ов следуют
-- конвенции из lib/rule-engine/sections/students.ts:
--   studentportrait_N / studentname_N / studentquote_N / classphotoframe

-- ─── 1. Grid-Page мастера (M/L/N) и L-Grid-12 ─────────────────────────────
-- Симметричные сеточные мастера. page_role='student_grid' — годится
-- для левой и правой страницы (findStudentMaster в РЭ.22.6 будет
-- принимать student_grid как fallback для student_grid_left/right).

UPDATE spread_templates
SET
  page_role = 'student_grid',
  slot_capacity = jsonb_build_object(
    'students', (
      SELECT COUNT(*) FROM jsonb_array_elements(placeholders) e
      WHERE LOWER(e->>'label') ~ '^studentportrait_[0-9]+$'
    ),
    'has_portrait', EXISTS (
      SELECT 1 FROM jsonb_array_elements(placeholders) e
      WHERE LOWER(e->>'label') ~ '^studentportrait_[0-9]+$'
    ),
    'has_name', EXISTS (
      SELECT 1 FROM jsonb_array_elements(placeholders) e
      WHERE LOWER(e->>'label') ~ '^studentname_[0-9]+$'
    ),
    -- has_quote=true только если quote-слотов столько же сколько portrait-
    -- слотов (правило spec §6.4: "для каждого ученика есть quote-слот").
    'has_quote', (
      (SELECT COUNT(*) FROM jsonb_array_elements(placeholders) e
       WHERE LOWER(e->>'label') ~ '^studentquote_[0-9]+$')
      =
      (SELECT COUNT(*) FROM jsonb_array_elements(placeholders) e
       WHERE LOWER(e->>'label') ~ '^studentportrait_[0-9]+$')
      AND
      (SELECT COUNT(*) FROM jsonb_array_elements(placeholders) e
       WHERE LOWER(e->>'label') ~ '^studentquote_[0-9]+$') > 0
    )
  )
WHERE name IN (
  'M-Grid-Page',
  'L-Grid-Page',
  'L-Grid-12',
  'N-Grid-Page'
);

-- ─── 2. Combined-Page мастера (M/L/N) ─────────────────────────────────────
-- Хвост сетки с одним общим фото класса. Те же теги что у Grid-Page +
-- photos_full=1 (одна рамка classphotoframe).

UPDATE spread_templates
SET
  page_role = 'student_grid',
  slot_capacity = jsonb_build_object(
    'students', (
      SELECT COUNT(*) FROM jsonb_array_elements(placeholders) e
      WHERE LOWER(e->>'label') ~ '^studentportrait_[0-9]+$'
    ),
    'photos_full', (
      SELECT COUNT(*) FROM jsonb_array_elements(placeholders) e
      WHERE LOWER(e->>'label') = 'classphotoframe'
    ),
    'has_portrait', EXISTS (
      SELECT 1 FROM jsonb_array_elements(placeholders) e
      WHERE LOWER(e->>'label') ~ '^studentportrait_[0-9]+$'
    ),
    'has_name', EXISTS (
      SELECT 1 FROM jsonb_array_elements(placeholders) e
      WHERE LOWER(e->>'label') ~ '^studentname_[0-9]+$'
    ),
    'has_quote', (
      (SELECT COUNT(*) FROM jsonb_array_elements(placeholders) e
       WHERE LOWER(e->>'label') ~ '^studentquote_[0-9]+$')
      =
      (SELECT COUNT(*) FROM jsonb_array_elements(placeholders) e
       WHERE LOWER(e->>'label') ~ '^studentportrait_[0-9]+$')
      AND
      (SELECT COUNT(*) FROM jsonb_array_elements(placeholders) e
       WHERE LOWER(e->>'label') ~ '^studentquote_[0-9]+$') > 0
    )
  )
WHERE name IN (
  'M-Combined-Page',
  'L-Combined-Page',
  'N-Combined-Page'
);

-- ─── Проверка после применения ────────────────────────────────────────────
-- Запустить ПОСЛЕ миграции для контроля результата:
--
-- SELECT name, page_role, slot_capacity
-- FROM spread_templates
-- WHERE name IN (
--   'M-Grid-Page', 'L-Grid-Page', 'L-Grid-12', 'N-Grid-Page',
--   'M-Combined-Page', 'L-Combined-Page', 'N-Combined-Page'
-- )
-- ORDER BY name;
--
-- Ожидание:
--   - У всех page_role = 'student_grid'
--   - slot_capacity.students > 0 (реальное число учеников из placeholders)
--   - У Combined: slot_capacity.photos_full >= 1
--   - has_portrait/has_name: true для всех (стандартный layout)
--   - has_quote: true для Medium (если у M-Grid quote-слоты есть для всех
--     4 учеников), false для Light/Mini (там обычно цитат нет)
