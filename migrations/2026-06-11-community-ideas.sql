-- Раздел «Идеи и предложения» с голосованием (по мотивам wfolio «Ваши идеи»).
-- Date: 2026-06-11
--
-- Глобальный модуль: идеи и голоса ОБЩИЕ для всего сообщества партнёров,
-- БЕЗ привязки к tenant_id. Доступ только через service role (supabaseAdmin),
-- поэтому RLS включаем (как на всех таблицах), но политик не добавляем —
-- анонимный/публичный клиент к этим таблицам напрямую не ходит.
--
-- Откат:
--   drop trigger if exists trg_idea_votes_count on idea_votes;
--   drop function if exists ideas_recount_votes();
--   drop table if exists idea_votes cascade;
--   drop table if exists ideas cascade;

-- ============================================================
-- ideas — сами идеи
-- ============================================================
create table if not exists ideas (
  id               uuid primary key default gen_random_uuid(),
  title            text,
  body             text not null,
  -- автор нужен для модерации/антиспама и для связи суперадмина с автором.
  -- НИКОГДА не отдаётся в публичные ответы API (анонимность для партнёров).
  author_user_id   uuid not null references users(id) on delete cascade,
  status           text not null default 'pending'
                     check (status in ('pending', 'published', 'done', 'rejected')),
  -- денормализованный счётчик голосов для сортировки ленты (ведёт триггер ниже).
  votes_count      int  not null default 0,
  created_at       timestamptz not null default now(),
  published_at     timestamptz,
  done_at          timestamptz,
  moderated_by     uuid references users(id) on delete set null
);

-- Лента «Голосование»: опубликованные по убыванию голосов.
create index if not exists ideas_status_votes_idx
  on ideas (status, votes_count desc);

-- Антиспам-лимит: «сколько идей этот автор создал за сутки».
create index if not exists ideas_author_created_idx
  on ideas (author_user_id, created_at);

-- ============================================================
-- idea_votes — голоса (одна реакция на пользователя)
-- ============================================================
create table if not exists idea_votes (
  id          uuid primary key default gen_random_uuid(),
  idea_id     uuid not null references ideas(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  -- защита от двойного голоса на уровне БД, не только в UI.
  unique (idea_id, user_id)
);

-- Вкладка «Мои голоса»: за что проголосовал текущий пользователь.
create index if not exists idea_votes_user_idx
  on idea_votes (user_id);

-- ============================================================
-- Триггер пересчёта votes_count — race-safe (row-level lock на ideas).
-- INSERT через `on conflict do nothing`: при дубле строка не вставляется,
-- триггер НЕ срабатывает → счётчик не задваивается. DELETE — снятие голоса.
-- ============================================================
create or replace function ideas_recount_votes() returns trigger as $$
begin
  if (tg_op = 'INSERT') then
    update ideas set votes_count = votes_count + 1 where ideas.id = new.idea_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update ideas set votes_count = greatest(votes_count - 1, 0) where ideas.id = old.idea_id;
    return old;
  end if;
  return null;
end;
$$ language plpgsql;

drop trigger if exists trg_idea_votes_count on idea_votes;
create trigger trg_idea_votes_count
  after insert or delete on idea_votes
  for each row execute function ideas_recount_votes();

-- ============================================================
-- RLS — включаем, политик не добавляем (доступ только service role).
-- ============================================================
alter table ideas      enable row level security;
alter table idea_votes enable row level security;

-- ============================================================
-- Проверки после применения (выполнять отдельно, не часть миграции):
--   SELECT count(*) FROM ideas;       -- 0
--   SELECT count(*) FROM idea_votes;  -- 0
--   \d ideas       → есть status (text, default 'pending'), votes_count (int)
--   \d idea_votes  → есть unique (idea_id, user_id)
-- ============================================================
