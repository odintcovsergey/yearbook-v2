-- Rule Engine — миграция БД (подэтап РЭ.1)
-- Спецификация: docs/rule-engine-spec.md v1.1 §6
-- Аддитивная миграция: новые таблицы + ALTER существующих.
-- Применяется вручную в Supabase SQL Editor.

-- ============================================================
-- template_families — семейства мастеров (rule engine)
-- ID = стабильная строка ('head-teacher', 'student-section', ...).
-- Используется в правилах и пресетах для cross-reference, поэтому TEXT а не UUID.
-- ============================================================
create table if not exists template_families (
    id text primary key,                            -- 'head-teacher', 'student-section', ...
    display_name text not null,                     -- 'Учительская страница с классруком'
    aliases text[] default '{}',                    -- старые имена для совместимости
    deprecated boolean default false,
    version text not null,                          -- '1.0', '1.1', '2.0'
    tenant_id uuid references tenants(id) on delete cascade,  -- null = глобальное
    params jsonb default '{}',                      -- {density: {type:'enum', values:[...]}}
    density_config jsonb default null,              -- только для student-section
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

create index if not exists idx_template_families_tenant on template_families(tenant_id);

-- ============================================================
-- rules — правила rule engine (JSON)
-- ============================================================
create table if not exists rules (
    id text primary key,                            -- 't-class-0-half-class', ...
    family_id text not null references template_families(id) on delete cascade,
    family_version text not null,
    priority int not null default 0,
    rule_json jsonb not null,                       -- {when:..., produces:..., bind:..., consumes:...}
    tenant_id uuid references tenants(id) on delete cascade,  -- null = глобальное
    enabled boolean default true,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

create index if not exists idx_rules_family on rules(family_id, family_version, priority desc) where enabled = true;
create index if not exists idx_rules_tenant on rules(tenant_id);

-- ============================================================
-- presets — пресеты (комплектации)
-- ============================================================
create table if not exists presets (
    id text primary key,                            -- 'standard', 'individual', 'mini-soft', ...
    display_name text not null,                     -- 'Индивидуальный'
    sections jsonb not null,                        -- массив секций (см. spec §8)
    print_type text not null check (print_type in ('layflat', 'soft', 'tryumo')),
    pages_per_spread int not null default 2,        -- 2 обычно, 3 для трюмо
    tenant_id uuid references tenants(id) on delete cascade,  -- null = глобальное
    version text not null,
    parent_preset_id text references presets(id) on delete set null,  -- если копия глобального
    enabled boolean default true,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

create index if not exists idx_presets_tenant on presets(tenant_id, print_type) where enabled = true;

-- ============================================================
-- layout_cache — кэш раскладок
-- TTL: 7 дней, чистка через cron.
-- ============================================================
create table if not exists layout_cache (
    input_hash text primary key,                    -- sha256 of canonicalJson({input, preset_id, rules_version})
    layout jsonb not null,
    created_at timestamptz default now(),
    last_accessed_at timestamptz default now(),
    access_count int default 1
);

create index if not exists idx_layout_cache_accessed on layout_cache(last_accessed_at);

-- ============================================================
-- ALTER album_layouts — метаданные о правилах сборки
-- ============================================================
alter table album_layouts
    add column if not exists preset_id text references presets(id) on delete set null,
    add column if not exists rules_version text,
    add column if not exists decision_trace jsonb default '[]';

-- ============================================================
-- ALTER spread_templates — метаданные для rule engine
-- ============================================================
alter table spread_templates
    add column if not exists family_id text references template_families(id) on delete set null,
    add column if not exists page_type text default 'page-any',
    add column if not exists series_id text,                       -- null в MVP
    add column if not exists density text,                          -- только для student-section мастеров
    add column if not exists params jsonb default '{}';             -- для параметрических: {parametric: true, grid_modes: [...]}

-- check constraint на page_type (отдельным statement, чтобы IF NOT EXISTS работал)
do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'spread_templates_page_type_check'
    ) then
        alter table spread_templates
            add constraint spread_templates_page_type_check
            check (page_type in ('page-left', 'page-right', 'page-any', 'spread'));
    end if;
end $$;

create index if not exists idx_spread_templates_family on spread_templates(family_id, density);
create index if not exists idx_spread_templates_series on spread_templates(series_id) where series_id is not null;

-- ============================================================
-- ALTER children — заложено для будущей виньетки с детскими фото
-- В MVP не используется.
-- ============================================================
alter table children
    add column if not exists secondary_portraits jsonb default '[]';

-- ============================================================
-- Проверочные запросы (выполнить после миграции):
-- ============================================================
-- select tablename from pg_tables where schemaname = 'public'
--   and tablename in ('template_families', 'rules', 'presets', 'layout_cache')
--   order by tablename;
-- (ожидается 4 строки)
--
-- select column_name, data_type from information_schema.columns
--   where table_name = 'spread_templates'
--     and column_name in ('family_id', 'page_type', 'series_id', 'density', 'params');
-- (ожидается 5 строк)
--
-- select column_name from information_schema.columns
--   where table_name = 'album_layouts'
--     and column_name in ('preset_id', 'rules_version', 'decision_trace');
-- (ожидается 3 строки)
--
-- select column_name from information_schema.columns
--   where table_name = 'children'
--     and column_name = 'secondary_portraits';
-- (ожидается 1 строка)
