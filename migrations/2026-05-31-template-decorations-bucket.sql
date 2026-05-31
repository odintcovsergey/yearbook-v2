-- Привязанный декор к слотам — Этап 1: bucket для картинок декора.
--
-- Контекст (ТЗ docs/tz-attached-decor.md, Часть 1):
--   Художественные дизайны (детсады / 4 класс) несут декор, привязанный к
--   слотам: рамки-теремки, ленточки-баннеры, орнаменты. Это статичные
--   картинки, вшитые (embed) в IDML. Парсер (Этап 2) достанет байты картинки
--   из IDML-архива и загрузит их сюда, а в placeholder type:'decoration'
--   запишет url.
--
-- Почему отдельный bucket, а не template-backgrounds:
--   Декор и фоны — разные сущности (фон один на разворот, декора много и он
--   привязан к слотам). Отдельный bucket чище для последующей чистки/аудита.
--   Структура идентична bucket'у фонов (2026-05-28-template-backgrounds-bucket).
--
-- Public bucket → читается по прямой ссылке без токена (как картинки фонов/фото).
-- Запись идёт с серверной стороны через service_role key, поэтому политики
-- на INSERT/UPDATE/DELETE не нужны.
--
-- Откат: delete from storage.buckets where id = 'template-decorations';
--   (только если bucket пуст; иначе сначала удалить объекты).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'template-decorations',
  'template-decorations',
  true,
  52428800,                              -- 50 MB
  array['image/jpeg', 'image/png']
)
on conflict (id) do nothing;

-- Проверка после миграции:
-- SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'template-decorations';
-- (одна строка, public = true)
