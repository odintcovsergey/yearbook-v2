-- ============================================================
-- MIGRATION v3 — МУЛЬТИАРЕНДА
-- Добавляет tenant-систему БЕЗ нарушения работы текущих заказов
-- ============================================================
-- ВАЖНО: выполняйте блоки по порядку.
-- После выполнения — добавьте DEFAULT_TENANT_ID в Vercel env.
-- ============================================================

-- ============================================================
-- 1. НОВЫЕ ТАБЛИЦЫ
-- ============================================================

-- Арендаторы (компании/фотографы)
create table if not exists tenants (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,                     -- "ИП Одинцов" / "Фотостудия Солнышко"
  slug          text unique not null,              -- URL-идентификатор: "main", "solnyshko"
  logo_url      text,                              -- путь к логотипу в S3
  city          text,
  phone         text,
  email         text,
  plan          text not null default 'free'        -- free / basic / pro / enterprise
                check (plan in ('free','basic','pro','enterprise')),
  plan_expires  timestamptz,
  max_albums    integer not null default 5,         -- лимит по тарифу
  max_storage_mb integer not null default 2048,     -- лимит хранилища (МБ)
  settings      jsonb not null default '{}'::jsonb, -- брендинг, кастомизации
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- Пользователи системы (операторы, не родители)
create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid references tenants(id) on delete cascade,  -- NULL = superadmin
  email         text unique not null,
  password_hash text not null,
  full_name     text not null,
  role          text not null default 'manager'
                check (role in ('superadmin','owner','manager','viewer')),
  is_active     boolean not null default true,
  last_login    timestamptz,
  created_at    timestamptz not null default now()
);

-- Сессии (JWT refresh tokens)
create table if not exists sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  token       text unique not null,
  ip_address  text,
  user_agent  text,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

-- Приглашения сотрудников
create table if not exists invitations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  email       text not null,
  role        text not null default 'manager'
              check (role in ('owner','manager','viewer')),
  token       text unique not null default encode(gen_random_bytes(32), 'hex'),
  invited_by  uuid references users(id),
  expires_at  timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);

-- Журнал действий
create table if not exists audit_log (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references tenants(id) on delete set null,
  user_id     uuid references users(id) on delete set null,
  action      text not null,          -- 'album.create', 'photo.upload', 'child.submit'
  target_type text,                   -- 'album', 'photo', 'child'
  target_id   uuid,
  meta        jsonb default '{}'::jsonb,
  ip_address  text,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- 2. ДОБАВЛЯЕМ tenant_id В СУЩЕСТВУЮЩИЕ ТАБЛИЦЫ
-- ============================================================

-- albums — ключевая связь
alter table albums
  add column if not exists tenant_id uuid references tenants(id) on delete cascade;

-- album_templates — свои шаблоны у каждого tenant'а
alter table album_templates
  add column if not exists tenant_id uuid references tenants(id) on delete cascade;
-- tenant_id = NULL → глобальный шаблон (видят все)

-- quotes — цитаты тоже могут быть глобальными или tenant-specific
alter table quotes
  add column if not exists tenant_id uuid references tenants(id) on delete cascade;
-- tenant_id = NULL → глобальная цитата

-- referral_leads — привязка к tenant'у
alter table referral_leads
  add column if not exists tenant_id uuid references tenants(id) on delete cascade;

-- ============================================================
-- 3. СОЗДАЁМ ДЕФОЛТНЫЙ TENANT (ваш аккаунт)
-- ============================================================
-- ВАЖНО: запомните ID, он понадобится для env переменной

insert into tenants (name, slug, plan, max_albums, max_storage_mb)
values ('OkeyBook', 'main', 'enterprise', 9999, 999999)
on conflict (slug) do nothing;

-- Привязываем ВСЕ существующие альбомы к дефолтному tenant'у
update albums
set tenant_id = (select id from tenants where slug = 'main')
where tenant_id is null;

-- Привязываем шаблоны
update album_templates
set tenant_id = null  -- оставляем глобальными
where tenant_id is null;

-- Привязываем цитаты
update quotes
set tenant_id = null  -- оставляем глобальными
where tenant_id is null;

-- Привязываем лиды
update referral_leads
set tenant_id = (select id from tenants where slug = 'main')
where tenant_id is null;

-- ============================================================
-- 4. ДЕЛАЕМ tenant_id обязательным в albums
-- ============================================================
-- ТОЛЬКО после того, как все существующие записи обновлены!

alter table albums
  alter column tenant_id set not null;

-- ============================================================
-- 5. СОЗДАЁМ SUPERADMIN-пользователя
-- ============================================================
-- Пароль задаётся отдельно через API /api/auth/setup
-- Здесь placeholder — замените после первого входа

-- insert into users (email, password_hash, full_name, role, tenant_id)
-- values ('admin@okeybook.ru', '$HASH', 'Сергей', 'superadmin', null);
-- ↑ Раскомментируйте и выполните после настройки хеша через /api/auth/setup

-- ============================================================
-- 6. ИНДЕКСЫ
-- ============================================================

create index if not exists idx_albums_tenant on albums(tenant_id);
create index if not exists idx_users_tenant on users(tenant_id);
create index if not exists idx_users_email on users(email);
create index if not exists idx_sessions_token on sessions(token);
create index if not exists idx_sessions_user on sessions(user_id);
create index if not exists idx_sessions_expires on sessions(expires_at);
create index if not exists idx_invitations_token on invitations(token);
create index if not exists idx_invitations_tenant on invitations(tenant_id);
create index if not exists idx_audit_tenant on audit_log(tenant_id);
create index if not exists idx_audit_created on audit_log(created_at);
create index if not exists idx_templates_tenant on album_templates(tenant_id);
create index if not exists idx_referral_leads_tenant on referral_leads(tenant_id);

-- ============================================================
-- 7. RLS
-- ============================================================

alter table tenants enable row level security;
alter table users enable row level security;
alter table sessions enable row level security;
alter table invitations enable row level security;
alter table audit_log enable row level security;

-- ============================================================
-- 8. ПОСЛЕ ВЫПОЛНЕНИЯ
-- ============================================================
-- 1) Скопируйте ID дефолтного tenant'а:
--    select id from tenants where slug = 'main';
--
-- 2) Добавьте в Vercel → Settings → Environment Variables:
--    DEFAULT_TENANT_ID = <скопированный UUID>
--
-- 3) Создайте superadmin через /api/auth/setup (одноразовый endpoint)
--
-- 4) Текущий ADMIN_SECRET продолжает работать — не удаляйте!
-- ============================================================
