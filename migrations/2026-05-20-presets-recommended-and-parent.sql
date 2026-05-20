-- РЭ.24.1: подготовка БД для каталога готовых шаблонов.
--
-- Контекст:
-- В РЭ.24 партнёры будут видеть глобальные пресеты OkeyBook
-- (tenant_id=NULL) в каталоге /app/templates с возможностью
-- клонирования в личную библиотеку.
--
-- Две новых колонки в presets:
--
--   is_recommended BOOLEAN DEFAULT false
--     Фильтр для каталога. Только глобальные пресеты могут быть
--     рекомендованными — Сергей в /super/presets отметит галочкой,
--     какие 7 (стартовая линейка: мини/лайт/медиум/стандарт/универсал/
--     максимум/индивидуальный) показывать партнёрам.
--     Партнёрские пресеты (tenant_id != NULL) могут технически тоже
--     иметь is_recommended=true, но API будет фильтровать только
--     глобальные.
--
--   parent_preset_id UUID NULL REFERENCES presets(id) ON DELETE SET NULL
--     Для клонированных шаблонов = id оригинального глобального.
--     NULL для глобальных и созданных с нуля.
--     Используется для трейсинга («клон из Стандарт») и будущей
--     возможности «обновить из шаблона».
--     ON DELETE SET NULL — если оригинал удалят, клоны останутся.
--
-- ⚠️ Миграция чисто аддитивная. Существующие записи получают
-- is_recommended=false (default) и parent_preset_id=NULL — ни на что
-- не влияет.

-- ─── 1. is_recommended ────────────────────────────────────────────────────
ALTER TABLE presets
ADD COLUMN IF NOT EXISTS is_recommended BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN presets.is_recommended IS
  'Показывать шаблон в каталоге /app/templates для партнёров (РЭ.24). '
  'Применимо только к глобальным шаблонам (tenant_id=NULL). '
  'Партнёрские шаблоны фильтруются API независимо.';

-- ─── 2. parent_preset_id ──────────────────────────────────────────────────
ALTER TABLE presets
ADD COLUMN IF NOT EXISTS parent_preset_id UUID NULL
  REFERENCES presets(id) ON DELETE SET NULL;

COMMENT ON COLUMN presets.parent_preset_id IS
  'Если шаблон клонирован из глобального (РЭ.24) — id оригинала. '
  'NULL для глобальных и созданных с нуля. ON DELETE SET NULL.';

-- Индекс для запроса 'найди все клоны этого шаблона' (для аналитики
-- и будущей фичи 'обновить из шаблона').
CREATE INDEX IF NOT EXISTS idx_presets_parent_preset_id
  ON presets(parent_preset_id)
  WHERE parent_preset_id IS NOT NULL;

-- ─── Проверка после применения ────────────────────────────────────────────
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'presets'
--   AND column_name IN ('is_recommended', 'parent_preset_id')
-- ORDER BY column_name;
--
-- Ожидание:
--   is_recommended    | boolean | NO  | false
--   parent_preset_id  | uuid    | YES | (null)
