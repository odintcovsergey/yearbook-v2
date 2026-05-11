-- Фаза А.3.2 — override настройки виньеток на уровне альбома.
--
-- Контекст: thumbnails_section.enabled в config_presets.config (jsonb) задаёт
-- ДЕФОЛТ для всей комплектации. Например в individual-layflat и individual-soft
-- стоит {enabled: true, preferred_grid_size: 12}. Остальные пресеты имеют
-- thumbnails_section: null.
--
-- Эта миграция (А.3.2 от 11.05.2026) добавляет возможность переопределить
-- настройку на уровне конкретного альбома. Партнёр-фотограф может:
--   - Оставить дефолт пресета (NULL — для большинства случаев)
--   - Включить виньетки в обычной комплектации (true) — например в Стандарте
--     если хочет добавить виньеточный разворот в конце
--   - Принудительно отключить виньетки в Индивидуальной (false) — если
--     хочет нестандартную конфигурацию
--
-- Три состояния (NULL/true/false) реализуются через nullable boolean.
-- В UI это будет дропдаун 'Виньетки: Авто / Включены / Выключены' (А.3.4).
--
-- Backend (А.3.3): при сборке альбома, если albums.vignettes_enabled IS NOT NULL,
-- endpoint перезаписывает preset.student_section.thumbnails_section перед
-- передачей в buildAlbum:
--   true  → {enabled: true, preferred_grid_size: 12}
--   false → null
--   NULL  → не трогаем (дефолт пресета)
--
-- Миграция аддитивная, безопасная для прода. Существующие альбомы получат NULL
-- = поведение как раньше (читается из пресета).

ALTER TABLE albums
  ADD COLUMN IF NOT EXISTS vignettes_enabled boolean;

COMMENT ON COLUMN albums.vignettes_enabled IS
  'Override настройки виньеток (thumbnails_section). NULL = использовать дефолт из config_presets.config.student_section.thumbnails_section. true = включить виньетки даже если пресет их не имеет (например Стандарт + виньеточный разворот). false = отключить виньетки даже если пресет их предполагает (например Индивидуальная без виньеток). См. фазу А.3 от 11.05.2026.';

-- Pre-check после применения:
-- SELECT
--   COUNT(*) FILTER (WHERE vignettes_enabled IS NULL) AS using_preset_default,
--   COUNT(*) FILTER (WHERE vignettes_enabled = true) AS force_enabled,
--   COUNT(*) FILTER (WHERE vignettes_enabled = false) AS force_disabled,
--   COUNT(*) AS total
-- FROM albums;
--
-- Ожидание сразу после миграции: using_preset_default = total, остальные 0.
