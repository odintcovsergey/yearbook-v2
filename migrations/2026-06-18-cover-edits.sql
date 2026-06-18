-- Правки редактора обложек (ТЗ tz-cover-editor). Две глубины:
--   - ШАБЛОННЫЕ на тип обложки заказа (cover_type, child_id NULL) — тексты/фон/
--     общее фото, применяются ко всем экземплярам типа;
--   - ПОШТУЧНЫЙ кроп портрета на ученика (child_id, cover_type NULL) — поверх.
-- data (jsonb) — служебные ключи как у разворотов (__scale__/__offset__/… +
-- значения слотов). Только редактор пишет; родительский флоу не трогается.
--
-- Аддитивно/безопасно. Откат: drop table if exists cover_edits;

create table if not exists cover_edits (
  id         uuid primary key default gen_random_uuid(),
  album_id   uuid not null references albums(id) on delete cascade,
  cover_type text,        -- шаблонная правка типа (child_id null)
  child_id   uuid references children(id) on delete cascade,  -- поштучный кроп (cover_type null)
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- Одна строка шаблонных правок на (заказ, тип) и одна поштучная на (заказ, ученик).
create unique index if not exists cover_edits_type_uniq
  on cover_edits(album_id, cover_type) where child_id is null;
create unique index if not exists cover_edits_student_uniq
  on cover_edits(album_id, child_id) where child_id is not null;

create index if not exists idx_cover_edits_album on cover_edits(album_id);

-- Проверка: \d cover_edits → таблица есть, два частичных уникальных индекса.
