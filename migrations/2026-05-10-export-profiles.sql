-- Подэтап 3.1 — таблица export_profiles для PDF-экспорта.
--
-- Контекст: фаза 3 (PDF-экспорт). Партнёр в Обзоре альбома выбирает
-- профиль из dropdown'а ("Печать (типография)" / "Превью для клиента"
-- / "Индивидуальные комплекты") и жмёт "Экспортировать".
--
-- Архитектурное решение: профиль описывает ВСЕ параметры экспорта
-- (формат, качество, bleed, dpi, имя файла, режим страниц). Список
-- профилей расширяется конфигурацией, не кодом.
--
-- tenant_id NULL = глобальный профиль (доступен всем партнёрам). На
-- старте все 3 seed-профиля глобальные. В будущем партнёр сможет
-- создавать свои (например Фабрика Фотокниг с её требованиями имени
-- файла) — для этого и нужен tenant_id (ссылается на партнёра).
--
-- См. docs/phase-3-spec.md §3.1 и §4.4.

CREATE TABLE IF NOT EXISTS export_profiles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid REFERENCES tenants(id) ON DELETE CASCADE,
  slug            text NOT NULL,
  name            text NOT NULL,
  is_default      boolean NOT NULL DEFAULT false,

  -- purpose: для чего профиль создан
  --   typography — для печати в типографии (с bleed, 300 dpi)
  --   preview    — для согласования с клиентом (без bleed, малый размер)
  purpose         text NOT NULL CHECK (purpose IN ('typography','preview')),

  -- format: что выходит на download
  --   pdf       — один PDF файл
  --   jpg-pages — ZIP с JPG страниц + manifest.txt (фаза 3.X)
  format          text NOT NULL CHECK (format IN ('pdf','jpg-pages')),

  -- quality: как обрабатываются фото
  --   high    — оригиналы → sharp resample к dpi
  --   medium  — оригиналы → sharp resample к dpi (lite)
  --   preview — selection WebP без resample (быстро, малый размер)
  quality         text NOT NULL CHECK (quality IN ('high','medium','preview')),

  include_bleed   boolean NOT NULL DEFAULT true,
  color_mode      text NOT NULL DEFAULT 'rgb'
                    CHECK (color_mode IN ('rgb','cmyk')),
  dpi             integer NOT NULL DEFAULT 300
                    CHECK (dpi BETWEEN 72 AND 600),
  jpeg_quality    integer NOT NULL DEFAULT 92
                    CHECK (jpeg_quality BETWEEN 30 AND 100),

  -- filename_template: переменные {album_name} {date} {datetime}
  --   {student_name} {ext}
  filename_template text NOT NULL DEFAULT '{album_name}_{date}.{ext}',

  -- pages_mode: структура страниц на выходе
  --   all_common                  — один PDF со всеми разворотами (фаза 3)
  --   per_student                 — N файлов (общая часть + персональная) (фаза 3.A)
  --   per_student_individual_only — N файлов только индивидуальной части (фаза 3.A)
  pages_mode      text NOT NULL DEFAULT 'all_common'
                    CHECK (pages_mode IN ('all_common','per_student','per_student_individual_only')),

  target_size_mb  integer,  -- для info/UI, не enforce'ится
  enabled         boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Уникальность slug в пределах tenant (или глобально для tenant_id=NULL).
-- COALESCE'ом превращаем NULL в строку 'global', чтобы UNIQUE сработал
-- и для глобальных профилей.
CREATE UNIQUE INDEX IF NOT EXISTS export_profiles_tenant_slug
  ON export_profiles (COALESCE(tenant_id::text, 'global'), slug);

-- Индекс для быстрой выборки enabled профилей в UI.
CREATE INDEX IF NOT EXISTS export_profiles_tenant_enabled
  ON export_profiles (tenant_id, enabled) WHERE enabled = true;

-- Проверка структуры
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'export_profiles'
ORDER BY ordinal_position;

-- Проверка индексов
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'export_profiles';

-- Ожидание: таблица пустая, 2 индекса (включая PK).
SELECT count(*) AS rows FROM export_profiles;
-- Ожидание: 0 (seed применяется отдельной миграцией).
