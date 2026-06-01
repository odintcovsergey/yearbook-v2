-- Реферальные программы — Этап 3: аналитика (ТЗ docs/tz-referral-programs.md).
--
-- Считаем воронку по каждой программе: ПЕРЕХОДЫ по ссылке → ЗАЯВКИ →
-- КОНВЕРСИИ (заявка со статусом «Заказ» = referral_leads.status='done'),
-- с разрезом по сегменту (детсад / 4 класс / 9-11 / свободный) и по партнёру.
--
-- Сегмент = albums.text_type альбома реферера на момент события:
--   'garden' | 'grade4' | 'grade11' | 'free'.
-- Денормализуем его в строки visits и leads — чтобы аналитика не зависела
-- от последующих изменений альбома и считалась простым group by.
--
-- Применять ДО деплоя кода Этапа 3.
-- Откат: drop table referral_visits; alter table referral_leads drop column segment;

-- ── Лог переходов по реф-ссылке ────────────────────────────────────────────
-- Одна строка = один заход на лендинг /ref/<token> (GET /api/referral).
-- program_id/tenant_id/segment берём из альбома реферера в момент захода.
create table if not exists referral_visits (
  id                 uuid primary key default gen_random_uuid(),
  program_id         uuid references referral_programs(id) on delete set null,
  tenant_id          uuid references tenants(id) on delete cascade,  -- партнёр реферера
  referrer_child_id  uuid references children(id) on delete set null,
  segment            text,                                            -- text_type альбома
  created_at         timestamptz default now()
);

create index if not exists referral_visits_program_idx on referral_visits (program_id);
create index if not exists referral_visits_tenant_idx  on referral_visits (tenant_id);

-- ── Сегмент заявки (для разреза конверсий) ─────────────────────────────────
-- Заполняется при создании лида из text_type альбома реферера.
alter table referral_leads
  add column if not exists segment text;

-- Проверка после миграции:
-- SELECT count(*) FROM referral_visits;                 -- 0
-- \d referral_leads → есть колонка segment (text)
