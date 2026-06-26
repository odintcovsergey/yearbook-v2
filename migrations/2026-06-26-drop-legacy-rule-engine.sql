-- Уборка мёртвого legacy движка раскладки (Этап Б). Парная к коду-чистке
-- 193944e (Вариант A, Этап А): loadBundle больше НЕ грузит rules/template_families
-- и НЕ пишет presets.sections — наследие удалённого buildFromRules
-- (РЭ.21.8.чистка-1, 20.05.2026). Живой движок — buildFromSectionStructure
-- (читает presets.section_structure). Опора: audit-phase3-structure.md.
--
-- ⚠️ ПОРЯДОК: применять ТОЛЬКО после того, как код-чистка 193944e доехала на
--    прод (✅ live, health 200). Эта миграция ДОПОЛНИТЕЛЬНО ЧИНИТ регресс:
--    presets.sections — NOT NULL без default; код 193944e перестал её писать в
--    fresh-create путях → создание НОВОГО пресета сейчас падает на NOT NULL.
--    DROP колонки восстанавливает создание (клонирование не затронуто).
--
-- Что дропаем (доказанно мёртвое, см. audit-re22-binding.md / phase3):
--   1) таблица rules (46 строк) — на неё НЕТ входящих FK (проверено); код её
--      не читает (bundle.rules не потребляется живым движком).
--   2) колонка template_families.density_config — код её не читает (захардкожено
--      в sections/students.ts). ТАБЛИЦУ template_families НЕ трогаем (на неё FK
--      от spread_templates.family_id и master_page_types.family_id).
--   3) колонка presets.sections — legacy представление структуры; живой движок
--      и редактор работают на section_structure.
--
-- Откат (структуру вернуть; ДАННЫЕ rules — только из бэкапа, но они мёртвые):
--   create table rules (id uuid primary key default gen_random_uuid(),
--     family_id text, family_version text, priority int, rule_json jsonb,
--     tenant_id uuid, enabled boolean default true,
--     created_at timestamptz default now(), updated_at timestamptz default now());
--   alter table template_families add column if not exists density_config jsonb;
--   alter table presets add column if not exists sections jsonb not null default '[]'::jsonb;
-- (при откате презет-колонке даём default '[]', чтобы старый код снова мог писать.)

-- ─────────────────────────────────────────────────────────────────────────────
drop table if exists rules;

alter table template_families drop column if exists density_config;

alter table presets drop column if exists sections;

-- ─────────────────────────────────────────────────────────────────────────────
-- Проверка после применения:
--   select to_regclass('public.rules');                              -- NULL (нет)
--   select count(*) from information_schema.columns
--     where table_name='template_families' and column_name='density_config'; -- 0
--   select count(*) from information_schema.columns
--     where table_name='presets' and column_name='sections';        -- 0
--   -- смоук: создание нового пресета через /super больше не падает на NOT NULL.
-- ─────────────────────────────────────────────────────────────────────────────
