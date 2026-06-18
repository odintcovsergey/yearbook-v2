-- Сущность «Типография» (ТЗ tz-printer-entity). Корешок обложки задаётся не
-- толщиной листа, а по-человечески: типография → типы листов → диапазоны
-- «от N до M разворотов → корешок X мм».
--
-- config (jsonb) заложен расширяемым: сейчас только sheet_types + spine_ranges;
-- позже (экспорт в печать) сюда добавятся формат/bleed/именование БЕЗ миграции.
--
-- Аддитивно/безопасно. Откат:
--   alter table albums drop column if exists printer_id;
--   drop table if exists printers;

create table if not exists printers (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid references tenants(id) on delete cascade,  -- NULL = глобальная (okeybook), для любого шаблона/заказа
  is_global  boolean not null default true,
  name       text not null,
  config     jsonb not null default '{"sheet_types":[]}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_printers_tenant on printers(tenant_id);

comment on table printers is
  'Типография: типы листов + диапазоны корешка (config.sheet_types[].spine_ranges). Основа профиля печати для будущего экспорта.';
comment on column printers.config is
  '{ sheet_types: [ { id, name, spine_ranges: [ { min_spreads, max_spreads, spine_mm } ] } ] }. Расширяется параметрами печати на этапе экспорта.';

-- Альбом ссылается на выбранную типографию. Тип листа внутри неё — в
-- существующем поле albums.sheet_type_id (text, id из config.sheet_types).
alter table albums
  add column if not exists printer_id uuid references printers(id) on delete set null;

-- Проверка:
-- \d printers   → таблица есть
-- \d albums     → есть printer_id (uuid)
