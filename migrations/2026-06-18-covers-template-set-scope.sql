-- Обложки: уникальность slug в РАМКАХ дизайна (template_set), а не только тенанта.
-- (ТЗ tz-cover-connect-to-order). Теперь обложки бывают двух видов:
--   - родные обложки дизайна: template_set_id заполнен, is_global=false;
--   - библиотечные (дизайнерские): template_set_id=null, is_global=true.
--
-- Старый индекс covers_tenant_slug_uniq был на (coalesce(tenant_id,'global'), slug)
-- и НЕ учитывал template_set_id. Родная обложка дизайна (tenant_id=null) с тем же
-- именем, что и библиотечная (тоже tenant_id=null) → коллизия slug, хотя это
-- разные сущности. Добавляем template_set_id в область уникальности.
--
-- Аддитивно/безопасно (только пересоздание индекса). Откат:
--   drop index if exists covers_scope_slug_uniq;
--   create unique index covers_tenant_slug_uniq
--     on covers (coalesce(tenant_id::text, 'global'), slug) where slug is not null;

drop index if exists covers_tenant_slug_uniq;

create unique index if not exists covers_scope_slug_uniq
  on covers (
    coalesce(tenant_id::text, 'global'),
    coalesce(template_set_id::text, 'lib'),
    slug
  )
  where slug is not null;

-- Проверка:
-- \di covers_scope_slug_uniq  → уникальный частичный индекс по 3 полям
