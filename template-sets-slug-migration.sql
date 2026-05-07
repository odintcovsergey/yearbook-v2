-- Phase 0.3.5 — мини-миграция template_sets
-- Аддитивная: добавляем slug + поля из IDML Preferences (facing_pages, page_binding).
-- Применяется вручную в Supabase SQL Editor перед коммитом 0.4.

alter table template_sets add column slug text;
alter table template_sets add column facing_pages boolean default true;
alter table template_sets add column page_binding text default 'LeftToRight'
    check (page_binding in ('LeftToRight', 'RightToLeft'));

-- Partial unique index: NULL tenant_id трактуется как 'global'.
-- where slug is not null — старые записи без slug не блокируют друг друга.
create unique index idx_template_sets_tenant_slug
    on template_sets(coalesce(tenant_id::text, 'global'), slug)
    where slug is not null;

comment on column template_sets.slug is
    'Stable human-readable identifier for URLs and CLI imports. Unique per tenant (with NULL tenant treated as "global").';
comment on column template_sets.facing_pages is
    'From IDML Preferences. true = двухстраничные развороты.';
comment on column template_sets.page_binding is
    'From IDML Preferences. LeftToRight (стандарт) или RightToLeft (RTL-языки).';
