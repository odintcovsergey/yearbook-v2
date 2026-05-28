-- AI-помощник: счётчик вызовов на одного ребёнка (защита от слива бюджета).
--
-- Контекст:
--   Чтобы родитель не мог бесконечно дёргать кнопку «Пересоздать» и
--   тратить деньги на Anthropic API — лимит 10 успешных вызовов AI
--   на одного ребёнка. Считается на сервере, проверяется в /api/text-assist.
--   Сброс вручную (UPDATE) если понадобится.
--
-- Поле инкрементируется только после УСПЕШНОГО ответа Claude.
-- Если Anthropic вернул ошибку — попытка не засчитывается.

ALTER TABLE children
  ADD COLUMN IF NOT EXISTS text_assist_count integer NOT NULL DEFAULT 0;

-- Проверка после применения:
--   SELECT id, full_name, text_assist_count FROM children LIMIT 5;
--   Все существующие записи должны иметь text_assist_count=0.
