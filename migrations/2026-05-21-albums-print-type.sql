-- РЭ.27.1: индекс + документирование колонки albums.print_type.
--
-- ⚠️ ВАЖНОЕ ОТКРЫТИЕ (21.05.2026):
-- При планировании РЭ.27 считалось, что колонки albums.print_type
-- ещё нет — её добавление было планируемой работой этой миграции.
-- При проверке состояния прод-БД выяснилось:
--
--   Колонка albums.print_type СУЩЕСТВУЕТ С 8 МАЯ 2026 (миграция 1.0,
--   файл migrations/2026-05-08-album-config.sql). Там же есть CHECK
--   constraint print_type IN ('layflat', 'soft') и она nullable.
--
-- Распределение значений на момент старта РЭ.27 (по данным прода):
--   layflat: 4 альбома (новые, после копирования из пресета)
--   soft:    2 альбома (новые, после копирования из пресета)
--   NULL:    6 альбомов (старые, до появления копирования)
--
-- Откуда заполнение: app/api/tenant/route.ts при create_album уже
-- копирует preset.print_type в albums.print_type (с какой-то даты
-- после 8 мая). Это означает что инфраструктура частично готова.
-- Engine при этом ПРОДОЛЖАЕТ читать из preset.print_type — это и
-- есть основная работа подэтапа 27.3.
--
-- Что реально делает эта миграция:
--   1) ADD COLUMN IF NOT EXISTS — no-op (колонка уже была).
--   2) COMMENT ON COLUMN — обновляет описание (это и есть полезная
--      часть, для трейсинга «колонка живёт по правилам РЭ.27»).
--   3) CREATE INDEX IF NOT EXISTS idx_albums_print_type —
--      ✅ ПОЛЕЗНО: индекс под этим именем раньше не было, миграция
--      его создала. Подтверждено через pg_indexes.
--
-- Решение: миграцию НЕ откатываем. Она:
--   • Документирует колонку с привязкой к РЭ.27 (COMMENT).
--   • Реально создаёт partial index, которого не было.
--
-- Контекст РЭ.27 (без изменений):
-- В РЭ.27 тип переплёта (layflat / soft) переезжает из presets.print_type
-- в albums.print_type. Это даёт:
--   1) единый разворотный редактор для всех альбомов (раньше предполагался
--      двойной — отказались, см. spec §1.2),
--   2) возможность сменить тип листов БЕЗ смены пресета,
--   3) почву для слияния дубль-пресетов (Стандарт-layflat / Стандарт-soft
--      в один Стандарт) — это уже подэтап 27.7.
--
-- Архитектура:
-- albums.print_type TEXT NULL (CHECK 'layflat'|'soft')
--   • Значения: 'layflat' | 'soft' | NULL.
--   • NULL означает «использовать print_type из связанного пресета»
--     (fallback для бэк-совместимости).
--   • После миграции данных в 27.7 NULL станет редким случаем, но
--     fallback остаётся работать.
--
-- Где читается:
--   • Engine (lib/album-builder) — будет через resolvePrintType(album,
--     preset) после подэтапа 27.3.
--   • API (создание альбома) — УЖЕ копируется из пресета (но не
--     принимается как явный параметр — это работа 27.2).
--   • UI формы альбома — селект «Тип листов» в подэтапе 27.6.
--
-- Индекс:
--   idx_albums_print_type — для агрегаций «сколько альбомов какого типа
--   у партнёра» и потенциальных фильтров в /app. Partial index
--   (WHERE print_type IS NOT NULL) экономит место.
--
-- ⚠️ Миграция чисто аддитивная (zero-downtime):
--   • Колонка nullable, без NOT NULL constraint.
--   • Старый код, не знающий о новой колонке, продолжает работать
--     (читает print_type из пресета как сейчас).
--   • Новый код (27.2+) читает из альбома, fallback на пресет.
--   • CHECK constraint УЖЕ ЕСТЬ из миграции 2026-05-08 — не добавляем
--     повторно.

-- ─── Добавление колонки ───────────────────────────────────────────────────
ALTER TABLE albums
ADD COLUMN IF NOT EXISTS print_type TEXT;

COMMENT ON COLUMN albums.print_type IS
  'Тип переплёта альбома (РЭ.27). Значения: layflat | soft. '
  'NULL = использовать print_type из связанного пресета (fallback '
  'для бэк-совместимости). Заполняется автоматически в подэтапе 27.7 '
  'для существующих альбомов из preset.print_type.';

-- ─── Индекс для агрегаций ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_albums_print_type
  ON albums(print_type)
  WHERE print_type IS NOT NULL;

COMMENT ON INDEX idx_albums_print_type IS
  'Partial index для агрегаций по типу переплёта (РЭ.27). '
  'WHERE NOT NULL — после миграции данных 27.7 покрывает почти '
  'все строки.';

-- ─── Проверка после применения ────────────────────────────────────────────
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'albums' AND column_name = 'print_type';
--
-- Ожидание:
--   albums | print_type | text | YES | NULL
--
-- Проверка индекса:
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE tablename = 'albums' AND indexname = 'idx_albums_print_type';
--
-- Ожидание: одна строка
--   CREATE INDEX idx_albums_print_type ON public.albums
--   USING btree (print_type) WHERE (print_type IS NOT NULL)
--
-- Проверка состояния данных (на этом этапе все NULL — это норма):
-- SELECT print_type, COUNT(*) FROM albums GROUP BY print_type;
--
-- Ожидание: одна строка с print_type=NULL и общим количеством альбомов.
-- Заполнение значениями — в подэтапе 27.7 (миграция данных).
