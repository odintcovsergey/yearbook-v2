-- Фаза А.4.1 — лимит количества разворотов в общем разделе альбома.
--
-- Контекст: после фазы А.2 builder автоматически вставляет ВСЕ загруженные
-- common_* фото в общий раздел альбома без ограничения. Это значит фотограф
-- не контролирует длину раздела: загрузил 50 фото common_half → получит
-- 13 разворотов J-Half. Возможно для конкретного альбома хочется ограничить
-- общий раздел до N разворотов.
--
-- Решение (Вариант A из обсуждения 11.05.2026): один числовой лимит
-- common_section_max_spreads на уровне альбома. Builder вставляет
-- фото в порядке spread → full → half → quarter → sixth (крупное приоритетнее
-- мелкого), останавливается при достижении лимита. Лишние фото остаются
-- в БД (видны во вкладке Фото), но в layout не попадают.
--
-- NULL = неограниченно (текущее поведение, дефолт для существующих альбомов).
-- Число = лимит. 0 = общий раздел не создавать вообще (валидное значение).
--
-- Миграция аддитивная и безопасная для прода.

ALTER TABLE albums
  ADD COLUMN IF NOT EXISTS common_section_max_spreads int;

COMMENT ON COLUMN albums.common_section_max_spreads IS
  'Лимит количества SpreadInstance в общем разделе альбома (фаза А.4 от 11.05.2026). NULL = неограниченно (дефолт), 0 = отключить общий раздел, >0 = ограничить. Builder в buildCommonSection накапливает число spread''ов и останавливается при достижении лимита, фото приоретизируются в порядке: spread → full → half → quarter → sixth (крупное приоритетнее). Warning common_section_truncated сообщает сколько фото не попало в layout.';

-- Pre-check после применения:
-- SELECT
--   COUNT(*) FILTER (WHERE common_section_max_spreads IS NULL) AS unlimited,
--   COUNT(*) FILTER (WHERE common_section_max_spreads = 0) AS disabled,
--   COUNT(*) FILTER (WHERE common_section_max_spreads > 0) AS limited,
--   COUNT(*) AS total
-- FROM albums;
--
-- Ожидание сразу после миграции: unlimited = total, остальные 0.
