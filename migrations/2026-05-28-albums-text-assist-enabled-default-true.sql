-- AI-помощник для текстов родителей: включаем по умолчанию для всех НОВЫХ
-- альбомов.
--
-- Контекст:
--   Миграция 2026-05-28-albums-text-assist-enabled.sql добавила колонку
--   text_assist_enabled с DEFAULT false. Под флагом мы протестировали
--   фичу на тестовом альбоме «Тест 25» (id b3994ae3-7ee3-4823-8595-2ac815272ef3).
--   Тест прошёл успешно — теперь раскатываем на все будущие заказы.
--
-- Что меняется:
--   • DEFAULT колонки переключается на true.
--   • Существующие 16 альбомов (16 отключённых + 1 включённый TEST25) НЕ
--     затрагиваются: ALTER ... SET DEFAULT влияет только на новые INSERT'ы.
--   • Endpoint'ы create_album и album_clone в app/api/tenant/route.ts не
--     передают text_assist_enabled явно — поэтому новые альбомы будут
--     создаваться с true автоматически, без правок кода.
--
-- Откат:
--   ALTER TABLE albums ALTER COLUMN text_assist_enabled SET DEFAULT false;

ALTER TABLE albums
  ALTER COLUMN text_assist_enabled SET DEFAULT true;

-- Проверка после применения:
--   SELECT column_default FROM information_schema.columns
--     WHERE table_name='albums' AND column_name='text_assist_enabled';
--   Ожидается: true
--
--   После создания тестового альбома через UI:
--   SELECT id, title, text_assist_enabled, created_at
--     FROM albums ORDER BY created_at DESC LIMIT 3;
--   Новый альбом должен быть с text_assist_enabled=true.
