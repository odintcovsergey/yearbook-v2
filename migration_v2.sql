-- ============================================================
-- MIGRATION v2 — параметры альбома + шаблоны
-- Запустите в Supabase → SQL Editor → Run
-- ============================================================

-- 1. Новые поля в таблице albums
alter table albums
  add column if not exists group_enabled    boolean not null default true,
  add column if not exists group_min        integer not null default 2,
  add column if not exists group_max        integer not null default 2,
  add column if not exists group_exclusive  boolean not null default true,
  add column if not exists text_enabled     boolean not null default true,
  add column if not exists text_max_chars   integer not null default 500;

-- 2. Таблица шаблонов альбомов
create table if not exists album_templates (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  cover_mode      text not null default 'none'
                  check (cover_mode in ('none','same','optional','required')),
  cover_price     integer not null default 0,
  group_enabled   boolean not null default true,
  group_min       integer not null default 2,
  group_max       integer not null default 2,
  group_exclusive boolean not null default true,
  text_enabled    boolean not null default true,
  text_max_chars  integer not null default 500,
  created_at      timestamptz default now()
);

alter table album_templates enable row level security;

-- 3. Предустановленные шаблоны
insert into album_templates (title, cover_mode, cover_price, group_enabled, group_min, group_max, group_exclusive, text_enabled, text_max_chars) values
  ('Универсал',      'optional', 300, true,  2, 2, true,  true,  500),
  ('Максимум',       'optional', 300, true,  4, 4, true,  true,  500),
  ('Максимум+',      'optional', 300, true,  2, 8, true,  true,  500),
  ('Медиум/Стандарт','none',     0,   false, 0, 0, true,  true,  500),
  ('Трюмо/Мини/Лайт','none',     0,   false, 0, 0, true,  false, 500)
on conflict do nothing;

-- 4. Обновить существующие альбомы — выставить дефолты
update albums set
  group_enabled   = true,
  group_min       = 2,
  group_max       = 2,
  group_exclusive = true,
  text_enabled    = true,
  text_max_chars  = 500
where group_enabled is null or group_min is null;

-- 5. Город и год выпуска
alter table albums
  add column if not exists city text,
  add column if not exists year integer not null default 2026;
