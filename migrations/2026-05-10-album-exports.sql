-- Подэтап 3.1 — таблица album_exports для истории PDF-экспортов.
--
-- Контекст: каждый раз когда партнёр жмёт «Экспортировать PDF» —
-- создаётся запись в album_exports + файл в YC bucket
-- (album_id/exports/<timestamp>_<profile_slug>.pdf).
--
-- В UI партнёр видит историю последних 10 экспортов с download-кнопкой
-- (presigned URL на 1 час). Файлы хранятся 90 дней (expires_at), но
-- автоудаление в фазе 3 не реализуется — записи и файлы остаются в БД
-- и YC даже после expires_at. Cleanup задача — backlog (как с
-- delivery_files в workflow, см. yearbook-context-v44.md).
--
-- layout_snapshot: копия album_layouts.spreads на момент экспорта.
-- Если партнёр позже изменит layout — у нас остаётся точная фиксация
-- что именно было выгружено (для debug при претензиях типографии).
--
-- См. docs/phase-3-spec.md §3.1 и §4.5.

CREATE TABLE IF NOT EXISTS album_exports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id        uuid NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  profile_id      uuid NOT NULL REFERENCES export_profiles(id) ON DELETE RESTRICT,

  -- Файл в YC: album_id/exports/<timestamp>_<profile_slug>.pdf
  storage_path    text NOT NULL,
  -- Имя файла для скачивания (отрендеренный filename_template):
  -- например "Школа_89_2026-05-10.pdf"
  filename        text NOT NULL,
  file_size       bigint NOT NULL,
  page_count      integer NOT NULL,

  -- Snapshot layout'а на момент экспорта (для debug и audit).
  -- Структура такая же как album_layouts.spreads.
  layout_snapshot jsonb NOT NULL,

  -- Warnings от PDF builder'а (no_original, font_not_found и т.д.)
  warnings        jsonb NOT NULL DEFAULT '[]'::jsonb,

  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL REFERENCES users(id),

  -- expires_at = created_at + 90 дней. После этой даты файл считается
  -- "expired" в UI (но физически не удаляется — это cleanup-задача,
  -- backlog).
  expires_at      timestamptz NOT NULL
);

-- Индекс для UI: «последние 10 экспортов альбома».
CREATE INDEX IF NOT EXISTS album_exports_album_id_created
  ON album_exports (album_id, created_at DESC);

-- Индекс на expires_at — для будущего cleanup-cron'а который будет
-- искать просроченные записи. Без WHERE-предиката, потому что now()
-- не IMMUTABLE и Postgres не разрешает её в index predicate
-- (ERROR: 42P17). Полный индекс по expires_at достаточно эффективен:
-- при ~1000 экспортов запрос `WHERE expires_at < now()` вернёт нужные
-- строки за миллисекунды.
CREATE INDEX IF NOT EXISTS album_exports_expires_at
  ON album_exports (expires_at);

-- Индекс для поиска экспортов одного партнёра (счёт квот в будущем).
CREATE INDEX IF NOT EXISTS album_exports_tenant_id_created
  ON album_exports (tenant_id, created_at DESC);

-- Проверка структуры
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'album_exports'
ORDER BY ordinal_position;

-- Проверка индексов
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'album_exports';

-- Ожидание: таблица пустая, 4 индекса (включая PK).
SELECT count(*) AS rows FROM album_exports;
-- Ожидание: 0
