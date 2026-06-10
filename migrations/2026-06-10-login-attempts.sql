-- F5 (аудит безопасности): защита логина от перебора паролей.
-- Таблица фиксирует попытки входа; код в /api/auth считает неудачные
-- за последние 15 минут и блокирует при превышении порога.
-- Доступ только через service_role (supabaseAdmin), который RLS обходит;
-- RLS включаем для единообразия (все таблицы проекта с RLS).

CREATE TABLE IF NOT EXISTS login_attempts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text NOT NULL,
  ip           text NOT NULL,
  success      boolean NOT NULL DEFAULT false,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

-- Индексы для быстрого подсчёта попыток в окне.
CREATE INDEX IF NOT EXISTS idx_login_attempts_email_time
  ON login_attempts (email, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_time
  ON login_attempts (ip, attempted_at DESC);

ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
-- Политик нет намеренно: anon/public доступа быть не должно, сервер ходит
-- под service_role и RLS обходит.

-- Чистка старых записей не обязательна (таблица лёгкая), но при желании:
--   DELETE FROM login_attempts WHERE attempted_at < now() - interval '7 days';
