-- Профиль типографии (ТЗ tz-printer-profile): заказ хранит выбранный формат
-- блока. Цепочка выбора в заказе — типография → формат → тип листа.
--
-- format_id — это id из printers.config.formats[] (text, не FK: форматы лежат
-- в jsonb профиля). Тип листа уже хранится в albums.sheet_type_id (text).
--
-- Аддитивно/безопасно. Откат:
--   alter table albums drop column if exists format_id;

alter table albums
  add column if not exists format_id text;

comment on column albums.format_id is
  'Выбранный формат блока: id из printers.config.formats[]. Определяет размеры страницы/разворота (превью обложки, будущий экспорт).';

-- Проверка:
-- \d albums   → есть format_id (text)
