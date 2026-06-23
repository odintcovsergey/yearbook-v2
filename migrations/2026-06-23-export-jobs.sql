-- ТЗ №2 — Фоновая очередь экспорта (docs: вставлено в чат 23.06.2026).
--
-- Контекст: синхронный экспорт больших альбомов держит веб-сервер минутами
-- (потолки 80 разворотов для PDF / 50 для типографии). Теперь сервер свой
-- (Timeweb, лимита запроса нет), большие альбомы (> порога ~30 разворотов)
-- уезжают в ОЧЕРЕДЬ: фоновый воркер (systemd) собирает файл не в HTTP-цикле.
-- Малые альбомы (<= порога) по-прежнему экспортируются синхронно как сейчас.
--
-- Очередь — чистый Postgres (переносимо, без Supabase-специфики). Доступ
-- только через service role (как album_exports) — внешний /rest/v1 закрыт.
--
-- Жизненный цикл задачи: queued -> processing -> done | failed.
-- При падении: attempts++ ; повтор делает партнёр кнопкой «Повторить»
-- (status снова queued). Зависшие (processing дольше N минут) воркер сам
-- возвращает в queued (watchdog).
--
-- «Только последний файл на альбом» (решение Сергея): файл кладётся по
-- СТАБИЛЬНОМУ ключу album_id/exports/queue_<kind>_<slug>.<ext> — новый рендер
-- затирает прошлый. Частичный уникальный индекс не даёт двум активным
-- задачам висеть на одном (album_id, kind) — идемпотентность постановки.
--
-- Откат: drop table if exists export_jobs;

CREATE TABLE IF NOT EXISTS export_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id      uuid NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Вид экспорта: 'pdf' (цельный PDF, action=export) или
  -- 'typography' (zip по книгам, action=export_typography).
  kind          text NOT NULL CHECK (kind IN ('pdf', 'typography')),

  -- Параметры рендера, чтобы воркер собрал ровно то же, что попросил UI:
  -- { profile_slug, accept_mode?, file_format?, view_as_tenant_id? }.
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,

  status        text NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'processing', 'done', 'failed')),

  -- Результат (заполняется при status='done'):
  storage_path  text,            -- стабильный ключ файла в S3
  filename      text,            -- имя для скачивания
  file_size     bigint,
  page_count    integer,         -- для pdf; для typography — число файлов
  warnings      jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Диагностика ошибок и ретраев:
  error         text,
  attempts      integer NOT NULL DEFAULT 0,
  max_attempts  integer NOT NULL DEFAULT 3,

  -- Грубая стадия для UI («готовлю фото» / «собираю PDF») — без процентов.
  progress_stage text,
  worker_id     text,            -- кто взял задачу (для watchdog/диагностики)

  created_by    uuid NOT NULL REFERENCES users(id),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Забор задачи воркером: только queued, в порядке очереди.
CREATE INDEX IF NOT EXISTS export_jobs_queued
  ON export_jobs (requested_at)
  WHERE status = 'queued';

-- Последняя задача альбома (UI «вернулся на страницу» + история по виду).
CREATE INDEX IF NOT EXISTS export_jobs_album_kind_requested
  ON export_jobs (album_id, kind, requested_at DESC);

-- Watchdog зависших: быстрый поиск долго висящих processing.
CREATE INDEX IF NOT EXISTS export_jobs_processing_started
  ON export_jobs (started_at)
  WHERE status = 'processing';

-- Идемпотентность: не более ОДНОЙ активной (queued|processing) задачи на
-- (album_id, kind). Повторный клик при активной задаче → ловим конфликт и
-- возвращаем существующий job_id, а не плодим дубль.
CREATE UNIQUE INDEX IF NOT EXISTS export_jobs_active_uniq
  ON export_jobs (album_id, kind)
  WHERE status IN ('queued', 'processing');

COMMENT ON TABLE export_jobs IS
  'Очередь фонового экспорта больших альбомов (ТЗ №2). Воркер под systemd '
  'забирает queued, рендерит существующим кодом lib/pdf-export, кладёт файл '
  'в S3 по стабильному ключу. Малые альбомы идут синхронно мимо очереди.';

-- ── Проверки (выполнить после применения) ────────────────────────────────
-- Структура:
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'export_jobs'
ORDER BY ordinal_position;

-- Индексы (ожидание: PK + 4 наших):
SELECT indexname FROM pg_indexes WHERE tablename = 'export_jobs' ORDER BY indexname;

-- Пусто:
SELECT count(*) AS rows FROM export_jobs;
