-- Обложка альбома — поле «учебное заведение» для метки cover_school_name.
-- (ТЗ docs/tz-cover-design.md). Город (city) и год (year) уже есть в albums.
--
-- Раньше название заведения было «зашито» в albums.title. Для отдельной
-- подписи на обложке (cover_school_name) заводим самостоятельное поле —
-- чище, чем парсить из title.
--
-- Аддитивно, безопасно. Откат: alter table albums drop column school_name;

alter table albums
  add column if not exists school_name text;

comment on column albums.school_name is
  'Название учебного заведения для подписи на обложке (метка cover_school_name). NULL = не задано.';

-- Проверка:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name='albums' AND column_name='school_name';
