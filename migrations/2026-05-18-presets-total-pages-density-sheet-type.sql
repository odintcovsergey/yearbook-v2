-- Фаза РЭ.20.А (РЭ.20.2 по нумерации docs/phase-Р20-spec.md §6) —
-- добавление полей структуры альбома в presets.
--
-- Контекст: после реализации rule engine (РЭ.10..РЭ.18) и РЭ.19.1
-- обнаружено, что архитектура общего раздела неверна — она строилась
-- «по убыванию размера фото». Источник правды — дизайнерская матрица
-- docs/templates/album-structure-matrix.xlsx (см. JSON в .json).
--
-- Ключевое открытие: total_pages — это атрибут ПРЕСЕТА (не альбома),
-- фиксированное число страниц альбома данной комплектации. Из него
-- вычисляется common_section_pages = total_pages - student_section_pages
-- - head_teacher_pages - intro_pages - final_pages. Партнёр настраивает
-- total_pages в UI пресета (фаза РЭ.12).
--
-- Логика правил для hard и soft одинаковая — различаются только
-- наличие S-Intro/S-Final (страница в начале/конце для soft) и
-- total_pages. Поэтому sheet_type достаточно хранить в пресете
-- атомарным enum, не в правилах.
--
-- density тоже становится свойством пресета: rule engine выбирает
-- правила student-section в зависимости от плотности портретов на
-- странице (mini/light/medium/standard/universal).
--
-- Все три поля добавляются:
--   - total_pages — NOT NULL DEFAULT 24 (типичный альбом). В этапе
--     Б (РЭ.20.5) loader проставит реальные значения существующим
--     7 глобальным пресетам.
--   - density — NULLable пока. После РЭ.20.5 значения проставятся
--     для всех глобальных пресетов; constraint допускает NULL чтобы
--     не сломать существующие записи между фазами.
--   - sheet_type — NULLable аналогично density.
--
-- Все три поля имеют CHECK constraints на допустимые значения,
-- созданные через DO-блок для идемпотентности (IF NOT EXISTS
-- не работает на ADD CONSTRAINT в PG <17).
--
-- Миграция аддитивная: ничего не удаляет, не переименовывает,
-- existing rule engine продолжает работать без чтения новых полей.
--
-- common_section_max_spreads на albums НЕ удаляем — это задача
-- этапа Б (РЭ.20.3, расширение типов TypeScript + удаление кода
-- из build-from-preset.ts). Сейчас оба поля сосуществуют.

-- =============================================================
-- 1. Колонки
-- =============================================================
ALTER TABLE presets
  ADD COLUMN IF NOT EXISTS total_pages int NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS density     text,
  ADD COLUMN IF NOT EXISTS sheet_type  text;

-- =============================================================
-- 2. Check constraints (идемпотентно через pg_constraint)
-- =============================================================
DO $$
BEGIN
  -- total_pages > 0
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'presets_total_pages_check'
  ) THEN
    ALTER TABLE presets
      ADD CONSTRAINT presets_total_pages_check
      CHECK (total_pages > 0 AND total_pages <= 200);
  END IF;

  -- density ∈ {standard, universal, medium, light, mini} ∪ NULL
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'presets_density_check'
  ) THEN
    ALTER TABLE presets
      ADD CONSTRAINT presets_density_check
      CHECK (density IS NULL OR density IN ('standard', 'universal', 'medium', 'light', 'mini'));
  END IF;

  -- sheet_type ∈ {hard, soft} ∪ NULL
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'presets_sheet_type_check'
  ) THEN
    ALTER TABLE presets
      ADD CONSTRAINT presets_sheet_type_check
      CHECK (sheet_type IS NULL OR sheet_type IN ('hard', 'soft'));
  END IF;
END $$;

-- =============================================================
-- 3. Документация колонок
-- =============================================================
COMMENT ON COLUMN presets.total_pages IS
  'Фиксированное число страниц альбома данной комплектации (РЭ.20). Источник правды для алгоритма планирования: common_section_pages = total_pages - student_section_pages - head_teacher_pages - intro_pages - final_pages. Партнёр настраивает в UI пресета (РЭ.12). DEFAULT 24 — заглушка до проставления реальных значений в РЭ.20.5.';

COMMENT ON COLUMN presets.density IS
  'Плотность портретов на странице student-section: standard | universal | medium | light | mini. Rule engine выбирает правила student-section по этому полю. Матрица docs/templates/album-structure-matrix.json объединяет standard+universal в одну категорию (одинаковые правила), но в пресете хранятся раздельно для гибкости. NULL допустим до проставления значений в РЭ.20.5.';

COMMENT ON COLUMN presets.sheet_type IS
  'Тип листов: hard (плотные, без S-Intro/Final) или soft (мягкие, с S-Intro/Final по краям). Логика правил одинаковая, отличается только total_pages и наличие intro/final-страниц. NULL допустим до проставления значений в РЭ.20.5.';

-- =============================================================
-- Проверочные запросы (выполнить после миграции):
-- =============================================================
-- SELECT id, display_name, print_type, total_pages, density, sheet_type
-- FROM presets ORDER BY id;
--
-- Ожидание: все 7 глобальных пресетов получают total_pages=24,
-- density=NULL, sheet_type=NULL. Реальные значения проставляются
-- в РЭ.20.5 через UPDATE-скрипт на основе значений Сергея.
--
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'presets'::regclass
--   AND conname LIKE 'presets_%_check'
-- ORDER BY conname;
--
-- Ожидание: 4 строки — старый presets_print_type_check (был в
-- rule-engine-migration.sql) + 3 новых.
