-- 2026-06-18 — impersonation («вход в кабинет партнёра как партнёр»)
-- Добавляем в audit_log колонку acting_user_id: реальный исполнитель действия.
-- При обычной работе = NULL (исполнитель = user_id). При impersonation:
--   user_id        = владелец партнёрского тенанта (от чьего имени действие),
--   acting_user_id = менеджер OkeyBook, который реально его выполнил.
--
-- ВАЖНО (порядок применения): миграция аддитивная и обратносовместимая —
-- старый код колонку не трогает. Применять МОЖНО (и нужно) ДО выката нового
-- кода: новый logAction пишет acting_user_id в каждый аудит-лог, и без колонки
-- INSERT в audit_log упадёт (логи молча потеряются). Поэтому: сначала миграция,
-- потом деплой кода.

alter table audit_log
  add column if not exists acting_user_id uuid references users(id) on delete set null;

-- Индекс для выборки «что наделал менеджер X под impersonation».
create index if not exists idx_audit_acting_user on audit_log(acting_user_id);
