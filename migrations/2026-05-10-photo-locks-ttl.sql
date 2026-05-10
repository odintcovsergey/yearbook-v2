-- Hot-fix orphan locks: TTL 15 минут на photo_locks.
--
-- Проблема: ребёнок открывал фото в режиме «выбираю портрет» (PUT /api/select
-- action=lock), а потом закрывал вкладку браузера / переключался на другое
-- фото без unlock / уходил надолго. lock в БД оставался навсегда — другие
-- дети не могли выбрать это фото.
--
-- Sweep по проду 10.05.2026 нашёл 4 orphan locks в 2 активных альбомах
-- (Школа 89 4Д: 4 шт, Школа 17 9Б: 1 шт). Ручная очистка нерациональна
-- в активный сезон, нужен автоматический TTL.
--
-- Решение: каждый lock протухает через 15 минут с момента создания/обновления.
-- expires_at вычисляется на стороне сервера в /api/select PUT action=lock.
-- Везде где читаем lock для проверки «занято ли фото» — фильтр expires_at > now().
-- Старые locks автоматически игнорируются (не нужен sweep cron, БД может
-- хранить мусор — он не влияет на логику).
--
-- Defaults для существующих 4 locks: они уже orphan (часть массового DELETE
-- выше по плану), а если что-то осталось — expires_at = locked_at + 15 минут,
-- то есть давно протухло.

ALTER TABLE photo_locks
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- Backfill: existing rows get locked_at + 15 минут (давно протухло)
UPDATE photo_locks
SET expires_at = locked_at + interval '15 minutes'
WHERE expires_at IS NULL;

ALTER TABLE photo_locks
  ALTER COLUMN expires_at SET NOT NULL;

ALTER TABLE photo_locks
  ALTER COLUMN expires_at SET DEFAULT now() + interval '15 minutes';

COMMENT ON COLUMN photo_locks.expires_at IS
  'Когда lock протухает. Lock с expires_at < now() игнорируется — фото снова доступно. Auto-set в /api/select PUT action=lock = now() + 15 минут.';

-- Индекс для быстрого фильтра «активные локи»
CREATE INDEX IF NOT EXISTS photo_locks_expires_at_idx
  ON photo_locks (expires_at);
