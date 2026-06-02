-- Обложка альбома — Этап 1: фундамент модели данных (ТЗ docs/tz-cover-design.md).
--
-- Обложка (твёрдый layflat-переплёт) — физический «контейнер» альбома: единое
-- полотно ЗАДНЯЯ + КОРЕШОК + ПЕРЕДНЯЯ. Корешок ПЛАВАЮЩИЙ — его ширина зависит
-- от числа листов и типа бумаги, считается на лету (не хранится).
--
-- ВАЖНО — строим РЯДОМ со старой системой обложек, НЕ трогаем её:
--   старое: albums.cover_mode (none/same/optional/required) + таблица
--           cover_selections — это живой родительский шаг «персональный портрет
--           на обложку за доплату». Используется в /api/select, [token], CRM.
--   новое:  таблица covers (библиотека обложек-мастеров), albums.cover_layout_mode
--           (fixed/default_editable/parent_choice) и таблица cover_choices.
-- Имена новых полей НАМЕРЕННО другие, чтобы не пересечься со старыми значениями.
--
-- Глобальность — как у template_sets / referral_programs (память «Глобальность
-- дизайна в двух полях»): храним tenant_id И is_global отдельно.
--   tenant_id IS NULL  → глобальная (библиотечная, видна всем)
--   tenant_id = okeybook → внутренняя обложка Сергея
--   tenant_id = партнёр  → своя обложка партнёра
--
-- ЧИСЛА КОРЕШКА/BLEED/ЗАГИБА — параметрические, реальные значения подставит
-- Сергей позже (запрос у дизайнера/типографии). Здесь только МЕХАНИЗМ.
--
-- Применять ДО деплоя кода Этапа 1.
-- Откат: drop table cover_choices, covers cascade;
--        alter table albums drop column cover_layout_mode, drop column
--          cover_default_type, drop column cover_available_ids,
--          drop column print_preset_id, drop column sheet_type_id;
--        alter table config_presets drop column print_spec;

-- ── 1. Библиотека обложек (cover-мастера) ──────────────────────────────────
-- Каждая строка = отдельный вариант обложки (полотно зад+корешок+перед).
-- ОТВЯЗАНА от внутреннего блока: template_set_id опционален.
create table if not exists covers (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid references tenants(id) on delete cascade,   -- NULL = глобальная
  is_global       boolean not null default false,
  template_set_id uuid references template_sets(id) on delete set null,
    -- NULL = библиотечная (не привязана к дизайну); иначе «обложка этого дизайна»

  name            text not null,
  slug            text,

  -- Что на передней обложке (см. CoverType в lib/cover/types.ts).
  cover_type      text not null
                    check (cover_type in ('portrait_photo','common_photo','design_only')),

  -- Галерея design_only: нейтральная / для мальчиков / для девочек.
  -- Выбор пола РУЧНОЙ (родитель сам), не по полу ребёнка.
  gender_hint     text check (gender_hint is null
                    or gender_hint in ('neutral','boys','girls')),
  variant_label   text,   -- человекочитаемая метка варианта в галерее

  -- Геометрия трёх зон полотна (мм). Корешок ПЛАВАЮЩИЙ — не хранится здесь,
  -- считается из числа листов + пресета печати (lib/cover/spine.ts).
  back_width_mm   numeric,   -- ширина задней зоны
  front_width_mm  numeric,   -- ширина передней зоны
  height_mm       numeric,   -- высота полотна (без bleed/загиба — это база блока)

  placeholders    jsonb not null default '[]'::jsonb,  -- метки cover_portrait, spine_text, back_logo …
  background_url  text,

  is_published    boolean not null default false,
  sort_order      int default 0,
  created_at      timestamptz default now()
);

create index if not exists covers_tenant_idx        on covers (tenant_id);
create index if not exists covers_template_set_idx   on covers (template_set_id);

comment on table covers is
  'Библиотека обложек-мастеров (полотно зад+корешок+перед). Этап 1 ТЗ docs/tz-cover-design.md. Корешок плавающий — считается на лету.';

-- ── 2. Параметры обложки на заказе (albums) — НОВЫЕ поля ────────────────────
-- НЕ трогаем старые cover_mode / cover_price.
alter table albums
  add column if not exists cover_layout_mode text
    check (cover_layout_mode is null
      or cover_layout_mode in ('fixed','default_editable','parent_choice')),
  add column if not exists cover_default_type text
    check (cover_default_type is null
      or cover_default_type in ('portrait_photo','common_photo','design_only')),
  add column if not exists cover_available_ids uuid[] not null default '{}',
    -- какие обложки из библиотеки показывать родителю (мультивыбор партнёра)
  add column if not exists print_preset_id uuid references config_presets(id) on delete set null,
    -- пресет печати для расчёта корешка (на весь заказ)
  add column if not exists sheet_type_id text;
    -- выбранный тип листа внутри пресета (без прослойки / +0.4 / +0.7)

comment on column albums.cover_layout_mode is
  'Режим обложки (НОВАЯ система): fixed (партнёр жёстко) / default_editable / parent_choice. Не путать со старым cover_mode.';
comment on column albums.print_preset_id is
  'Пресет печати (config_presets.print_spec) — параметры расчёта плавающего корешка.';

-- ── 3. Выбор родителя на новую систему (cover_choices) ──────────────────────
-- Отдельно от старой cover_selections. Заполняется только при режимах
-- default_editable / parent_choice. Биллинга НЕТ — paid_personalization лишь
-- метка «родитель захотел докупить», деньги менеджер считает вне системы.
create table if not exists cover_choices (
  id                    uuid primary key default gen_random_uuid(),
  child_id              uuid unique not null references children(id) on delete cascade,
  cover_type            text check (cover_type is null
                          or cover_type in ('portrait_photo','common_photo','design_only')),
  cover_id              uuid references covers(id) on delete set null,  -- выбранный вариант
  paid_personalization  boolean not null default false,
  created_at            timestamptz default now()
);

comment on table cover_choices is
  'Выбор обложки родителем (НОВАЯ система). Отдельно от cover_selections. Этап 1 ТЗ docs/tz-cover-design.md.';

-- ── 4. Параметры печати/корешка в пресете (config_presets.print_spec) ───────
-- Отдельная jsonb-колонка (не мешаем с config комплектации). Форма — PrintSpec
-- в lib/cover/types.ts:
--   {
--     spine_base_offset_mm, bleed_mm, cover_overhang_mm, cover_fold_mm,
--     sheet_types: [{ id, label, thickness_mm }],   -- без прослойки / +0.4 / +0.7
--     default_sheet_type_id?
--   }
-- ВСЕ числа — параметры. Реальные значения подставим позже.
alter table config_presets
  add column if not exists print_spec jsonb;

comment on column config_presets.print_spec is
  'Параметры печати для расчёта корешка обложки (PrintSpec в lib/cover/types.ts). NULL = пресет без параметров обложки.';

-- ── Проверка после миграции ────────────────────────────────────────────────
-- SELECT count(*) FROM covers;          -- 0
-- SELECT count(*) FROM cover_choices;   -- 0
-- \d albums          → есть cover_layout_mode, cover_default_type,
--                      cover_available_ids, print_preset_id, sheet_type_id
-- \d config_presets  → есть print_spec (jsonb)
