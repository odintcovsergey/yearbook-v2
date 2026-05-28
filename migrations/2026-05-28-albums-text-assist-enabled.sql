-- AI-помощник для текстов родителей: feature flag на уровне альбома.
--
-- Контекст:
--   На родительской странице /[token] появляется кнопка «Исправить ошибки»
--   (вызов Claude через /api/text-assist) рядом с полем текста.
--   Чтобы не показывать новинку всем активным заказам сразу — закрываем
--   фичу под флагом. По умолчанию выключено.
--
-- Включение:
--   UPDATE albums SET text_assist_enabled = true WHERE id = '<album-id>';
--
-- Поле проверяется и на фронте (показ кнопки), и на сервере
-- (/api/text-assist возвращает 403 если флаг false).

ALTER TABLE albums
  ADD COLUMN IF NOT EXISTS text_assist_enabled boolean NOT NULL DEFAULT false;

-- Проверка после применения:
--   SELECT id, title, text_assist_enabled FROM albums LIMIT 5;
--   Все существующие альбомы должны иметь text_assist_enabled=false.
