-- Создаём публичный bucket template-backgrounds для фоновых изображений
-- мастер-разворотов (spread_templates.background_url ссылается сюда).
--
-- Public bucket → любой может прочитать файл по прямой ссылке без токена.
-- Запись пойдёт с серверной стороны через service_role key, поэтому
-- политики на INSERT/UPDATE/DELETE не нужны.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'template-backgrounds',
  'template-backgrounds',
  true,
  52428800,                              -- 50 MB
  array['image/jpeg', 'image/png']
)
on conflict (id) do nothing;
