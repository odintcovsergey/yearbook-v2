-- Фаза Б.1.0 — оригиналы для печати: колонка original_path в photos.
--
-- Контекст: текущая загрузка фото идёт через клиентскую компрессию
-- (browser-image-compression в app/app/page.tsx:3528) — оригинал
-- умирает на клиенте, до сервера доходит только WebP 2048px. PDF-экспорт
-- (фаза 3) использует эти WebP, что для печати в типографии 300 dpi
-- недостаточно качественно.
--
-- Решение фазы Б: добавить вторую параллельную загрузку оригинала через
-- presigned URL (минуя Vercel 4.5 МБ лимит), хранить путь в новой колонке
-- photos.original_path. PDF-экспорт читает original_path с fallback на
-- storage_path (для старых фото без оригинала).
--
-- Сергей подтвердил 11.05.2026: backfill старых альбомов НЕ делается —
-- текущие заказы он сдаёт в ручном режиме до запуска системы. Новые
-- альбомы получают оригиналы автоматически после Б.1.3 (клиент) +
-- Б.2 (pdf-export).
--
-- Поле original_path:
--   - NULL для существующих фото (старые альбомы) — pdf-export даёт fallback
--   - 'yc:album_id/originals/{ts}_{name}.{ext}' для новых
--   - расширение сохраняется оригинальное (jpg/jpeg/png), в отличие от
--     storage_path где всегда .webp
--
-- Миграция аддитивная, безопасная для прода.

ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS original_path text;

COMMENT ON COLUMN photos.original_path IS
  'Путь к оригиналу фото в YC Object Storage (yc:album_id/originals/{ts}_{name}.{ext}) для использования в PDF-экспорте на печать. NULL для старых фото загруженных до фазы Б.1 (11.05.2026) — pdf-export даёт fallback на storage_path (WebP). Расширение сохраняется оригинальное (jpg/jpeg/png), в отличие от storage_path где всегда .webp. Заполняется через POST /api/tenant action=register_original после успешной заливки оригинала через presigned URL.';

-- Pre-check после применения (раскомментируй):
-- SELECT
--   COUNT(*) FILTER (WHERE original_path IS NULL) AS without_original,
--   COUNT(*) FILTER (WHERE original_path IS NOT NULL) AS with_original,
--   COUNT(*) AS total
-- FROM photos;
--
-- Ожидание сразу после применения: without_original = total, with_original = 0.
-- По мере загрузки новых фото after Б.1.3 — with_original будет расти.
