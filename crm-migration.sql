-- CRM Migration: clients, contacts, deal_stages, deals, tasks
-- Применить в Supabase SQL Editor

-- Клиенты (школы/организации)
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null,
  city text,
  address text,
  website text,
  notes text,
  tags text[] default '{}',
  created_at timestamptz default now()
);

-- Контакты (директора, завучи и т.д.)
create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_id uuid references clients(id) on delete set null,
  full_name text not null,
  role text,
  phone text,
  email text,
  notes text,
  birthday date,
  created_at timestamptz default now()
);

-- Этапы воронки (настраиваемые, с дефолтами)
create table if not exists deal_stages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null,
  color text not null default '#6b7280',
  sort_order int not null default 0,
  is_closed boolean not null default false,
  created_at timestamptz default now()
);

-- Сделки
create table if not exists deals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_id uuid references clients(id) on delete set null,
  album_id uuid references albums(id) on delete set null,
  stage_id uuid references deal_stages(id) on delete set null,
  title text not null,
  amount numeric(12,2),
  currency text default 'RUB',
  deadline date,
  assigned_to uuid references users(id) on delete set null,
  notes text,
  created_at timestamptz default now(),
  closed_at timestamptz
);

-- Задачи
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  deal_id uuid references deals(id) on delete cascade,
  client_id uuid references clients(id) on delete set null,
  title text not null,
  due_date timestamptz,
  assigned_to uuid references users(id) on delete set null,
  created_by uuid references users(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz default now()
);

-- Индексы
create index if not exists clients_tenant_id_idx on clients(tenant_id);
create index if not exists contacts_tenant_id_idx on contacts(tenant_id);
create index if not exists contacts_client_id_idx on contacts(client_id);
create index if not exists deal_stages_tenant_id_idx on deal_stages(tenant_id, sort_order);
create index if not exists deals_tenant_id_idx on deals(tenant_id);
create index if not exists deals_client_id_idx on deals(client_id);
create index if not exists deals_stage_id_idx on deals(stage_id);
create index if not exists tasks_tenant_id_idx on tasks(tenant_id);
create index if not exists tasks_deal_id_idx on tasks(deal_id);

-- Удалить дубли этапов (оставить первую запись по sort_order)
DELETE FROM deal_stages
WHERE id NOT IN (
  SELECT DISTINCT ON (tenant_id, name) id
  FROM deal_stages
  ORDER BY tenant_id, name, sort_order
);

-- Защита от дублей в будущем
CREATE UNIQUE INDEX IF NOT EXISTS deal_stages_tenant_name_unique
  ON deal_stages(tenant_id, name);
