-- Обложка альбома — Этап 6а: поля для загрузки cover-мастеров из IDML.
-- (ТЗ docs/tz-cover-design.md). Дополняет 2026-06-02-cover-foundation.sql.
--
-- 1. nominal_spine_width_mm — ширина корешка, как нарисовал дизайнер в макете
--    (заглушка). Нужна рендеру (layoutCover, Этап 5): реальный корешок
--    пересчитывается из числа листов, а сдвиг передней зоны = real − nominal.
-- 2. Частичный уникальный индекс на (tenant, slug) — чтобы повторная загрузка
--    обложки (--force) заменяла строку, а не плодила дубли. Зеркалит логику
--    template_sets.
--
-- Аддитивно, безопасно. Откат:
--   drop index if exists covers_tenant_slug_uniq;
--   alter table covers drop column if exists nominal_spine_width_mm;

alter table covers
  add column if not exists nominal_spine_width_mm numeric;

comment on column covers.nominal_spine_width_mm is
  'Номинальная ширина корешка из макета (мм). Реальный корешок считается из числа листов; сдвиг передней зоны = real − nominal (lib/cover/layout.ts).';

create unique index if not exists covers_tenant_slug_uniq
  on covers (coalesce(tenant_id::text, 'global'), slug)
  where slug is not null;

-- Проверка:
-- \d covers  → есть nominal_spine_width_mm (numeric)
-- \di covers_tenant_slug_uniq  → уникальный частичный индекс
