-- Жизненный цикл архива — отложенное автоудаление исходников (Фаза 1, ТЗ
-- docs/tz-archive-lifecycle.md). Сама по себе миграция НИЧЕГО не удаляет —
-- только добавляет поля-фундамент.
--
-- albums.archived_at         — момент архивации (база отсчёта 90 дней). NULL =
--                              отсчёт не начат (в т.ч. у 11 уже-архивных: НЕ
--                              бэкфиллим, чтобы они не «истекли» в первый же
--                              запуск чистильщика).
-- albums.keep_originals_forever — флаг «оставить навсегда» (opt-out из чистки).
-- albums.originals_deleted_at — когда оригиналы реально удалены (UI-статус).
--
-- Аддитивно/идемпотентно. Откат:
--   alter table albums drop column if exists archived_at;
--   alter table albums drop column if exists keep_originals_forever;
--   alter table albums drop column if exists originals_deleted_at;

alter table albums
  add column if not exists archived_at timestamptz;

alter table albums
  add column if not exists keep_originals_forever boolean not null default false;

alter table albums
  add column if not exists originals_deleted_at timestamptz;

comment on column albums.archived_at is
  'Момент архивации (база отсчёта автоудаления исходников 90 дней). NULL = отсчёт не начат; ставится в archive_album, снимается в unarchive_album. Существующие 11 архивных НЕ бэкфиллены (остаются NULL).';
comment on column albums.keep_originals_forever is
  'Флаг «оставить исходники навсегда»: true исключает заказ из автоудаления.';
comment on column albums.originals_deleted_at is
  'Когда исходники фотографа (photos.original_path) реально удалены чистильщиком. NULL = ещё на месте.';

-- Проверка:
-- \d albums  → есть archived_at (timestamptz), keep_originals_forever (boolean
--              default false), originals_deleted_at (timestamptz)
-- select count(*) from albums where archived and archived_at is not null;  → 0
--   (11 архивных остались с archived_at = NULL, как и задумано)
