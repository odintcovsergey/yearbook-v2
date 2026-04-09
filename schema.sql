-- ============================================================
-- YEARBOOK PHOTO SELECTION SYSTEM — schema.sql
-- Запустите этот файл в Supabase → SQL Editor → Run
-- ============================================================

-- 1. Альбомы
create table albums (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,               -- "Выпускной 11А 2025"
  classes     text[] not null default '{}', -- ["11А"] или ["11А","11Б"]
  cover_mode  text not null default 'none'  -- 'none' | 'same' | 'optional' | 'required'
              check (cover_mode in ('none','same','optional','required')),
  cover_price integer not null default 300, -- доплата за обложку в рублях
  deadline    timestamptz,                  -- после этой даты ссылки не работают
  created_at  timestamptz default now()
);

-- 2. Ученики
create table children (
  id            uuid primary key default gen_random_uuid(),
  album_id      uuid not null references albums(id) on delete cascade,
  full_name     text not null,
  class         text not null,
  access_token  text unique not null default encode(gen_random_bytes(16), 'hex'),
  submitted_at  timestamptz,
  created_at    timestamptz default now()
);

-- 3. Учителя
create table teachers (
  id            uuid primary key default gen_random_uuid(),
  album_id      uuid not null references albums(id) on delete cascade,
  full_name     text,          -- заполняет ответственный родитель
  position      text,          -- должность / предмет
  access_token  text unique not null default encode(gen_random_bytes(16), 'hex'),
  submitted_at  timestamptz,
  created_at    timestamptz default now()
);

-- Ответственный родитель (один на альбом, заполняет данные учителей)
create table responsible_parents (
  id            uuid primary key default gen_random_uuid(),
  album_id      uuid not null references albums(id) on delete cascade,
  full_name     text,
  phone         text,
  access_token  text unique not null default encode(gen_random_bytes(16), 'hex'),
  submitted_at  timestamptz,
  created_at    timestamptz default now()
);

-- 4. Фотографии
create table photos (
  id            uuid primary key default gen_random_uuid(),
  album_id      uuid not null references albums(id) on delete cascade,
  filename      text not null,
  storage_path  text not null,
  type          text not null check (type in ('portrait','group','teacher')),
  created_at    timestamptz default now()
);

-- 5. Привязка фото к детям / учителям (из CSV разметки)
create table photo_children (
  photo_id   uuid not null references photos(id) on delete cascade,
  child_id   uuid not null references children(id) on delete cascade,
  primary key (photo_id, child_id)
);

create table photo_teachers (
  photo_id   uuid not null references photos(id) on delete cascade,
  teacher_id uuid not null references teachers(id) on delete cascade,
  primary key (photo_id, teacher_id)
);

-- 6. Выборы родителей
create table selections (
  id              uuid primary key default gen_random_uuid(),
  child_id        uuid not null references children(id) on delete cascade,
  photo_id        uuid not null references photos(id) on delete cascade,
  selection_type  text not null check (selection_type in ('portrait_page','portrait_cover','group')),
  created_at      timestamptz default now(),
  unique(child_id, selection_type) filter (selection_type in ('portrait_page','portrait_cover')),
  unique(child_id, photo_id)
);

-- 7. Контактные данные родителей
create table parent_contacts (
  id          uuid primary key default gen_random_uuid(),
  child_id    uuid unique not null references children(id) on delete cascade,
  parent_name text not null,
  phone       text not null,
  created_at  timestamptz default now()
);

-- 8. Тексты от учеников
create table student_texts (
  id          uuid primary key default gen_random_uuid(),
  child_id    uuid unique not null references children(id) on delete cascade,
  text        text not null default '',
  created_at  timestamptz default now()
);

-- 9. Выбор обложки
create table cover_selections (
  id            uuid primary key default gen_random_uuid(),
  child_id      uuid unique not null references children(id) on delete cascade,
  cover_option  text not null check (cover_option in ('none','same','other')),
  photo_id      uuid references photos(id),   -- если 'other'
  surcharge     integer not null default 0,   -- доплата в рублях
  created_at    timestamptz default now()
);

-- 10. Блокировка групповых фото (резерв до подтверждения)
create table photo_locks (
  photo_id    uuid primary key references photos(id) on delete cascade,
  child_id    uuid not null references children(id) on delete cascade,
  locked_at   timestamptz default now()
);

-- ============================================================
-- ИНДЕКСЫ для скорости
-- ============================================================
create index on children(album_id);
create index on children(access_token);
create index on photos(album_id, type);
create index on photo_children(child_id);
create index on selections(child_id);
create index on photo_locks(child_id);

-- ============================================================
-- RLS — всё через серверный код с service_role ключом
-- ============================================================
alter table albums enable row level security;
alter table children enable row level security;
alter table teachers enable row level security;
alter table responsible_parents enable row level security;
alter table photos enable row level security;
alter table photo_children enable row level security;
alter table photo_teachers enable row level security;
alter table selections enable row level security;
alter table parent_contacts enable row level security;
alter table student_texts enable row level security;
alter table cover_selections enable row level security;
alter table photo_locks enable row level security;

-- ============================================================
-- STORAGE — создайте bucket "photos" вручную в Supabase UI
-- Storage → New bucket → name: photos → Public: YES
-- ============================================================
