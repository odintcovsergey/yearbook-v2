-- Добавляем поле default_background_url в template_sets — путь к PNG/JPG
-- разворота-подложки, который рендерится первым слоем на каждом развороте
-- альбома, использующего этот набор. Хранится как путь в bucket
-- template-backgrounds (например: '<template_set_id>/default.jpg').
--
-- Один фон = один набор. Если нужно несколько фонов в наборе (для разных
-- типов разворотов) — это будет отдельной таблицей в будущем.

alter table template_sets
  add column if not exists default_background_url text;
