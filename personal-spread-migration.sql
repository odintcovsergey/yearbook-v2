-- Миграция: личный разворот (personal spread)
-- Применить в Supabase SQL Editor

-- 1. Поля в albums
alter table albums
  add column if not exists personal_spread_enabled boolean not null default false,
  add column if not exists personal_spread_price int not null default 300,
  add column if not exists personal_spread_min int not null default 4,
  add column if not exists personal_spread_max int not null default 12;

-- 2. Таблица фото личного разворота
create table if not exists personal_spread_photos (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references children(id) on delete cascade,
  album_id uuid not null references albums(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  storage_path text not null,  -- yc:album_id/personal/child_id/filename
  filename text not null,
  width int,
  height int,
  file_size int,               -- байты
  sort_order int not null default 0,
  created_at timestamptz default now()
);

create index if not exists personal_spread_photos_child_id_idx on personal_spread_photos(child_id);
create index if not exists personal_spread_photos_album_id_idx on personal_spread_photos(album_id);
create index if not exists personal_spread_photos_tenant_id_idx on personal_spread_photos(tenant_id);
