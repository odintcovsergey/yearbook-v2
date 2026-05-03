-- Workflow migration: статусы альбома, тарифы, файлы для скачивания
-- Применить в Supabase SQL Editor

-- 1. Статус workflow в albums
alter table albums
  add column if not exists workflow_status text not null default 'active'
    check (workflow_status in ('active','ready','submitted','in_production','delivered')),
  add column if not exists workflow_submitted_at timestamptz,
  add column if not exists workflow_taken_at timestamptz,
  add column if not exists workflow_delivered_at timestamptz,
  add column if not exists workflow_assigned_to uuid references users(id) on delete set null,
  add column if not exists workflow_notes text;

-- 2. Таблица оригинальных фото (загружает фотограф для вёрстки)
create table if not exists original_photos (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references albums(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  storage_path text not null,   -- yc:album_id/originals/filename
  filename text not null,
  file_size bigint,
  uploaded_by uuid references users(id) on delete set null,
  created_at timestamptz default now()
);

create index if not exists original_photos_album_id_idx on original_photos(album_id);
create index if not exists original_photos_tenant_id_idx on original_photos(tenant_id);

-- 3. Таблица готовых файлов (загружает OkeyBook, скачивает партнёр)
create table if not exists delivery_files (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references albums(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  storage_path text not null,   -- yc:album_id/delivery/filename
  filename text not null,
  file_size bigint,
  label text,                   -- «Вёрстка PDF», «Архив для печати»
  expires_at timestamptz,       -- через полгода после загрузки
  uploaded_by uuid references users(id) on delete set null,
  downloaded_at timestamptz,    -- первое скачивание партнёром
  created_at timestamptz default now()
);

create index if not exists delivery_files_album_id_idx on delivery_files(album_id);
create index if not exists delivery_files_tenant_id_idx on delivery_files(tenant_id);

-- 4. Тарифная сетка OkeyBook (глобально + per-tenant override)
create table if not exists okeybook_pricing (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,  -- NULL = глобальный дефолт
  template_title text not null,   -- 'Универсал', 'Медиум' и т.д.
  price_per_student int not null default 0,
  price_personal_spread int not null default 0,  -- за каждого выбравшего разворот
  price_teacher int not null default 0,          -- за каждого учителя
  price_print_soft int not null default 0,       -- печать мягкие листы/ученик
  created_at timestamptz default now(),
  unique(tenant_id, template_title)
);

-- Глобальные дефолтные тарифы (цены подставишь сам)
insert into okeybook_pricing (tenant_id, template_title, price_per_student)
values
  (null, 'Универсал', 0),
  (null, 'Медиум', 0),
  (null, 'Индивидуальный', 0),
  (null, 'Фотопапка / Мини / Лайт', 0)
on conflict (tenant_id, template_title) do nothing;

-- Менеджер фотографов: assigned_manager_id в tenants
alter table tenants
  add column if not exists assigned_manager_id uuid references users(id) on delete set null;

create index if not exists tenants_assigned_manager_idx on tenants(assigned_manager_id);
