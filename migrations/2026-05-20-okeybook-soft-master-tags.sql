-- РЭ.22.8.1: разметка soft_intro/soft_final мастеров для семантического поиска.
--
-- Контекст:
-- В РЭ.22.8.2 sections/soft-intro.ts и sections/soft-final.ts будут
-- переведены с жёстких имён (S-Intro, S-Final, S-Final-Soft-L) на
-- семантический поиск через page_role ('intro' / 'final') +
-- опциональный photos_full.
--
-- Текущее состояние в БД (выгрузка 20.05.2026):
--   S-Final-Soft-L | page_role=NULL | {}  | classphoto_count=1
--   S-Intro        | page_role=NULL | {}  | classphoto_count=1
--
-- Замечание: legacy soft-final.ts ищет 'S-Final' первым, потом fallback
-- на 'S-Final-Soft-L'. В БД мастера 'S-Final' нет — fallback срабатывает
-- всегда. После семантизации обе разновидности имени становятся
-- неважны — engine ищет page_role='final'.
--
-- ⚠️ ВАЖНО (обнаружено при первой попытке применения):
-- CHECK constraint spread_templates_page_role_check (определён в
-- migrations/2026-05-07-page-role-overflow-right.sql) разрешает
-- 'intro' но НЕ разрешает 'final'. Поэтому миграция расширяет
-- constraint ПЕРЕД UPDATE'ами.
--
-- ⚠️ Миграция БЕЗУСЛОВНО overwrites page_role и slot_capacity для
-- перечисленных имён. Текущие значения дефолтные (NULL / {}) — риск нулевой.

-- ─── 0. Расширяем CHECK constraint: добавляем 'final' ────────────────────
ALTER TABLE spread_templates
DROP CONSTRAINT IF EXISTS spread_templates_page_role_check;

ALTER TABLE spread_templates
ADD CONSTRAINT spread_templates_page_role_check CHECK (
  page_role IS NULL OR page_role IN (
    'student',
    'student_left',
    'student_right',
    'student_grid',
    'student_grid_left',
    'student_grid_right',
    'student_overflow',
    'student_overflow_right',
    'student_last',
    'teacher_left',
    'teacher_right',
    'common',
    'intro',
    'final',
    'cover'
  )
);

-- ─── 1. S-Intro → page_role='intro' ──────────────────────────────────────
UPDATE spread_templates
SET
  page_role = 'intro',
  slot_capacity = jsonb_build_object(
    'photos_full', (
      SELECT COUNT(*) FROM jsonb_array_elements(placeholders) e
      WHERE LOWER(e->>'label') = 'classphotoframe'
    )
  )
WHERE name = 'S-Intro';

-- ─── 2. S-Final-Soft-L → page_role='final' ──────────────────────────────────
-- В БД нет мастера 'S-Final' без суффикса; единственный финальный
-- мастер — S-Final-Soft-L. Размечаем его как 'final'.
UPDATE spread_templates
SET
  page_role = 'final',
  slot_capacity = jsonb_build_object(
    'photos_full', (
      SELECT COUNT(*) FROM jsonb_array_elements(placeholders) e
      WHERE LOWER(e->>'label') = 'classphotoframe'
    )
  )
WHERE name = 'S-Final-Soft-L';

-- ─── Проверка после применения ────────────────────────────────────────────
-- SELECT name, page_role, slot_capacity
-- FROM spread_templates
-- WHERE name LIKE 'S-%' OR page_role IN ('intro', 'final')
-- ORDER BY name;
--
-- Ожидание:
--   S-Final-Soft-L | final | {"photos_full":1}
--   S-Intro        | intro | {"photos_full":1}
