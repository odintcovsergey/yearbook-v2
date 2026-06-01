-- Управляемые реферальные программы — Этап 1 (ТЗ docs/tz-referral-programs.md).
--
-- Сейчас реферальная награда («скидка 50%») зашита в код. Делаем
-- конструктор кампаний с настраиваемыми наградами для ОБЕИХ сторон:
--   РЕФЕРЕР — кто рекомендует (видит свою награду на «Спасибо»).
--   РЕФЕРАЛ — кто пришёл по ссылке (видит свою награду на лендинге).
--
-- Награды НЕ автоматические: система только ПОКАЗЫВАЕТ обещание и ВЕДЁТ
-- УЧЁТ кто кого привёл. Скидки Сергей применяет вручную. Никаких
-- промокодов/автоскидок в заказах.
--
-- Глобальность — как у template_sets (память «Глобальность дизайна в двух
-- полях»): храним tenant_id И is_global отдельно.
--   tenant_id IS NULL  → глобальная (рекомендованная всем партнёрам)
--   tenant_id = okeybook → внутренняя программа Сергея
--   tenant_id = партнёр  → своя программа партнёра
-- При смене глобальности код пишет ОБА поля синхронно.
--
-- Применять ДО деплоя кода Этапа 1.
-- Откат: drop table referral_programs cascade;
--        (колонки albums.referral_program_id / referral_leads.program_id
--         тогда тоже исчезнут вместе с FK — это ожидаемо).

-- ── Таблица программ ───────────────────────────────────────────────────────
create table if not exists referral_programs (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid references tenants(id) on delete cascade,  -- NULL = глобальная
  is_global             boolean not null default false,
  name                  text not null,                 -- внутреннее имя («Котики»)
  is_active             boolean not null default true,

  -- Награда реферера (кто рекомендует)
  referrer_reward_text  text,                          -- «50% на копию альбома»
  referrer_image_url    text,                          -- картинка для «Спасибо»

  -- Награда реферала (кто пришёл по ссылке)
  invitee_headline      text,                          -- «Вас рекомендует {имя}» (шаблон)
  invitee_reward_text   text,                          -- «Скидка 500₽ на первый заказ»
  invitee_description   text,                          -- условия/подробности
  invitee_image_url     text,                          -- картинка для лендинга

  created_at            timestamptz default now()
);

-- Быстрый отбор «свои + глобальные» (как делает партнёрская выдача).
create index if not exists referral_programs_tenant_idx
  on referral_programs (tenant_id);

-- ── Привязка программы к заказу ────────────────────────────────────────────
-- NULL = программа не назначена → показываем дефолтный блок (как сейчас).
alter table albums
  add column if not exists referral_program_id uuid
    references referral_programs(id) on delete set null;

-- ── Фиксация программы в заявке (для будущей аналитики Этапа 3) ─────────────
-- По какой программе пришёл лид. Связь referrer→invitee уже есть через
-- referral_leads.referrer_child_id.
alter table referral_leads
  add column if not exists program_id uuid
    references referral_programs(id) on delete set null;

-- Проверка после миграции:
-- SELECT count(*) FROM referral_programs;                      -- 0
-- \d albums      → есть колонка referral_program_id (uuid)
-- \d referral_leads → есть колонка program_id (uuid)
