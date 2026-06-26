-- Библиотека мастер-страниц (канон типов разворотов) — Фаза 1 инициативы
-- «Разделение структуры и дизайна». Опора: audit-master-library-phase0.md.
--
-- Что делает: добавляет СПРАВОЧНИК типов разворотов (master_page_types) +
-- nullable-ссылку на него у мастеров (spread_templates.master_page_type_id).
-- Канон пока «для чтения»: движок/редактор/экспорт НЕ трогаются. Старые поля
-- spread_templates (page_role/slot_capacity/placeholders) НЕ удаляются (дублируют
-- тип — удаление отложено на Фазу 6).
--
-- Тип = page_role + slot_capacity (точная ёмкость = источник истины) +
-- canonical_slots (эталонный набор именованных слотов, БЕЗ координат/стиля).
-- ПРАВИЛО КАНОНА: слоты всегда в НУМЕРОВАННОЙ форме (studentname_1, не
-- studentname) — лечит разнобой akvarel/belly из Фазы 0.
--
-- ⚠️ ОТЛИЧИЕ ОТ ТЗ (осознанное): family_id сделан TEXT, а не uuid —
--    template_families.id в БД имеет тип text ('student-section'), uuid-FK
--    к нему невозможен (несовпадение типов). spread_templates.family_id тоже text.
--
-- Аддитивно/идемпотентно. Откат:
--   alter table spread_templates drop column if exists master_page_type_id;
--   drop table if exists master_page_types;

-- ─────────────────────────────────────────────────────────────────────────────
-- A) Справочник типов разворотов (канон)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists master_page_types (
  id               uuid primary key default gen_random_uuid(),
  -- человекочитаемый стабильный код: 'student-grid-12', 'personal-spread-6',
  -- 'common-collage-6'. Источник связи в коде/сидах (не uuid).
  code             text        not null unique,
  display_name     text        not null,
  -- из какого семейства тип (template_families.id — TEXT, см. примечание выше).
  family_id        text        references template_families(id),
  page_role        text        not null,
  -- точная ёмкость типа = ИСТОЧНИК ИСТИНЫ (jsonb, как slot_capacity мастера).
  slot_capacity    jsonb       not null,
  -- эталонный набор слотов: [{label,type,required}], БЕЗ координат/стиля/декора.
  canonical_slots  jsonb       not null,
  -- мягкая ось стороны разворота: 'left'/'right'/'spread'/null (page-any).
  page_type        text,
  is_active        boolean     not null default true,
  notes            text,
  created_at       timestamptz not null default now()
);

create index if not exists master_page_types_family_id_idx on master_page_types (family_id);
create index if not exists master_page_types_page_role_idx  on master_page_types (page_role);
-- code уже UNIQUE (создаёт уникальный индекс автоматически).

comment on table master_page_types is
  'Канон типов разворотов (библиотека мастер-страниц, Фаза 1). Тип = page_role + slot_capacity + canonical_slots. Дизайн-независим; мастера разных дизайнов ссылаются на тип через spread_templates.master_page_type_id. Пока «для чтения» — движок/экспорт не используют.';
comment on column master_page_types.code is
  'Стабильный человекочитаемый код типа (student-grid-12, personal-spread-6, common-collage-6). UNIQUE — ключ для сидов и связей в коде.';
comment on column master_page_types.family_id is
  'template_families.id (TEXT, напр. student-section). NULL = вне семейства.';
comment on column master_page_types.slot_capacity is
  'Точная ёмкость типа (источник истины), формат как spread_templates.slot_capacity.';
comment on column master_page_types.canonical_slots is
  'Эталонный набор слотов [{label,type,required}] в НУМЕРОВАННОЙ канонической форме, без координат/стиля/декора (__under, static_text исключены).';
comment on column master_page_types.page_type is
  'Мягкая ось стороны разворота: left/right/spread или NULL (page-any).';

-- ─────────────────────────────────────────────────────────────────────────────
-- B) Ссылка мастера на канон (nullable — безопасно для существующих строк)
-- ─────────────────────────────────────────────────────────────────────────────
alter table spread_templates
  add column if not exists master_page_type_id uuid references master_page_types(id);

create index if not exists spread_templates_master_page_type_id_idx
  on spread_templates (master_page_type_id);

comment on column spread_templates.master_page_type_id is
  'Ссылка на канон типа (master_page_types.id). NULL = мастер ещё не сверен с каноном (или не лёг чисто). Заполняется сидом наполнения; движок пока НЕ читает.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Проверка после применения:
--   select table_name from information_schema.tables
--     where table_name = 'master_page_types';                      -- 1 строка
--   select column_name, data_type from information_schema.columns
--     where table_name = 'master_page_types' order by ordinal_position;
--   select column_name from information_schema.columns
--     where table_name='spread_templates' and column_name='master_page_type_id'; -- есть
--   select count(*) from master_page_types;                        -- 0 (наполнение отдельно)
-- ─────────────────────────────────────────────────────────────────────────────
