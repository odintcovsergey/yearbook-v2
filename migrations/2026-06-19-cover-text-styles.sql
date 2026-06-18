-- Глобальные стили текстов обложек (аналог albums.text_style_overrides для
-- разворотов). Партнёр в редакторе обложек настраивает шрифт/размер/цвет/
-- выравнивание по смысловым группам (Заголовок, Имя выпускника, Реквизиты …),
-- применяется ко ВСЕМ обложкам заказа. Точечные правки по тексту приоритетнее.
--
-- Аддитивно/безопасно. Откат: alter table albums drop column if exists cover_text_style_overrides;

alter table albums
  add column if not exists cover_text_style_overrides jsonb not null default '{}'::jsonb;

-- Проверка: \d albums → колонка cover_text_style_overrides jsonb not null default '{}'.
