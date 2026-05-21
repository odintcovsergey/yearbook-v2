-- РЭ.28.1: добавление template_sets.parent_template_set_id
--          для трейсинга партнёрских клонов глобальных дизайнов.
--
-- Контекст:
-- В РЭ.28 партнёр может клонировать глобальный template_set с
-- изменёнными размерами под свою типографию. parent_template_set_id
-- — это ссылка от клона на исходный template_set, чтобы можно было:
--   - в UI показать «создано на основе ...»
--   - агрегировать «сколько партнёров склонировали этот дизайн»
--   - в будущем (вне РЭ.28) — возможно «обновить клон до новой версии оригинала»
--
-- ⚠️ ПРАВИЛО ИЗ РЭ.27 (уроки фазы): перед миграцией снимаем реальную
-- схему таблицы. Сделано 21.05.2026 — выгрузка показала 15 колонок,
-- parent_template_set_id отсутствует. Аналогичное поле уже есть
-- у presets (parent_preset_id из РЭ.24) — паттерн отработан.
--
-- Архитектура:
--   parent_template_set_id uuid NULL
--   - NULL у оригиналов (3 текущих template_set'а получат NULL автоматически)
--   - UUID у клонов (заполняется в API template_set_clone, см. РЭ.28.3)
--   - REFERENCES template_sets(id) — самоссылка
--   - ON DELETE SET NULL — если оригинал когда-то будет удалён,
--     клон остаётся (просто теряет связь, не каскадно удаляется)
--
-- Индекс idx_template_sets_parent — partial по NOT NULL для агрегаций.
-- Большинство template_set'ов будут оригиналами (NULL), индекс
-- покрывает только клоны.
--
-- Безопасность:
-- - Аддитивно (ADD COLUMN, не модификация существующих)
-- - nullable (старые строки получают NULL, не падает NOT NULL constraint)
-- - IF NOT EXISTS — повторное применение безопасно (no-op)
-- - Zero-downtime — старый код игнорирует колонку

-- ─── Добавление колонки ───────────────────────────────────────────────────
ALTER TABLE template_sets
  ADD COLUMN IF NOT EXISTS parent_template_set_id uuid NULL
    REFERENCES template_sets(id) ON DELETE SET NULL;

COMMENT ON COLUMN template_sets.parent_template_set_id IS
  'РЭ.28: для партнёрских клонов — ссылка на исходный глобальный '
  'template_set. NULL для оригиналов. ON DELETE SET NULL — клон '
  'не удаляется каскадно при удалении оригинала.';

-- ─── Индекс для агрегаций ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_template_sets_parent
  ON template_sets(parent_template_set_id)
  WHERE parent_template_set_id IS NOT NULL;

COMMENT ON INDEX idx_template_sets_parent IS
  'Partial index для агрегаций по клонам (РЭ.28). '
  'WHERE NOT NULL покрывает только клоны, оригиналов большинство.';

-- ─── Проверка после применения ────────────────────────────────────────────
-- 1. Колонка появилась:
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'template_sets'
--   AND column_name = 'parent_template_set_id';
-- Ожидание: одна строка (uuid | YES).

-- 2. FK создан:
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'template_sets'::regclass
--   AND contype = 'f';
-- Ожидание: должна быть строка с FK на template_sets(id).

-- 3. Индекс создан:
-- SELECT indexname FROM pg_indexes
-- WHERE tablename = 'template_sets'
--   AND indexname = 'idx_template_sets_parent';
-- Ожидание: одна строка.

-- 4. Существующие 3 template_set'а — все NULL (это норма):
-- SELECT id, name, tenant_id, parent_template_set_id FROM template_sets;
-- Ожидание: 3 строки, parent_template_set_id у всех NULL.
