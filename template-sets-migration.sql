-- Phase 0 — фундамент движка автовёрстки (Product B)
-- Аддитивная миграция: новые таблицы, существующие не трогаются.
-- Применяется вручную в Supabase SQL Editor.

-- ============================================================
-- template_sets — набор шаблонов = один полный шаблон альбома (один IDML)
-- ============================================================
create table template_sets (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid references tenants(id) on delete cascade,  -- null = глобальный
    name text not null,                  -- "Плотные Мастер Белый"
    print_type text not null check (print_type in ('layflat', 'soft')),
    page_width_mm numeric not null,
    page_height_mm numeric not null,
    spread_width_mm numeric not null,
    spread_height_mm numeric not null,
    bleed_mm numeric default 3,
    is_global boolean default false,
    cover_preview_url text,
    description text,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

create index idx_template_sets_tenant on template_sets(tenant_id);

-- ============================================================
-- spread_templates — шаблон одного разворота или одной страницы
-- ============================================================
create table spread_templates (
    id uuid primary key default gen_random_uuid(),
    template_set_id uuid not null references template_sets(id) on delete cascade,
    name text not null,                  -- "E-Student-Left"
    type text not null check (type in ('student', 'head_teacher', 'subjects', 'common', 'cover', 'intro')),
    is_spread boolean default false,     -- true для двухстраничных мастеров
    width_mm numeric not null,
    height_mm numeric not null,
    background_url text,                 -- URL фонового растра (фаза 1+, в фазе 0 null)
    placeholders jsonb not null,         -- массив плейсхолдеров (см. docs/phase-0-spec.md §4)
    rules jsonb,                         -- условия применения (см. docs/phase-0-spec.md §4)
    sort_order int default 0,
    created_at timestamptz default now()
);

create index idx_spread_templates_set on spread_templates(template_set_id);
create index idx_spread_templates_type on spread_templates(type);
create unique index idx_spread_templates_set_name on spread_templates(template_set_id, name);

-- ============================================================
-- album_layouts — структура и заполнение конкретного альбома
-- Один альбом = один активный layout. При смене комплектации перезаписываем.
-- ============================================================
create table album_layouts (
    id uuid primary key default gen_random_uuid(),
    album_id uuid not null references albums(id) on delete cascade,
    template_set_id uuid not null references template_sets(id),
    config_type text not null check (config_type in ('standard', 'universal', 'maximum', 'medium', 'light', 'mini', 'individual')),
    print_type text not null check (print_type in ('layflat', 'soft')),
    spreads jsonb not null,              -- массив свёрстанных разворотов (см. docs/phase-0-spec.md §5)
    status text default 'draft' check (status in ('draft', 'in_progress', 'final')),
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

create unique index idx_album_layouts_album_unique on album_layouts(album_id);
