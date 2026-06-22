-- ============================================================================
-- Шаг 4 / A1 — роли и гранты для self-hosted PostgREST (ТЗ docs/tz-step4-deployment.md)
-- ============================================================================
-- ВЫПОЛНЯЕТСЯ один раз на Timeweb Postgres. НЕ на боевом Supabase.
--
-- ⚠️ ВАЖНО (ограничение Timeweb): пользователь gen_user НЕ имеет CREATEROLE,
--    а атрибут BYPASSRLS назначает только суперпользователь. Поэтому раздельные
--    роли (authenticator/web_app) для боевого хардненинга нужно создавать либо
--    через панель/поддержку Timeweb (роль с нужными правами), либо под
--    суперпользователем. ДЛЯ ПРОВЕРКИ A4 это НЕ требуется — там PostgREST
--    подключается как gen_user с db-anon-role=gen_user (владелец таблиц обходит
--    RLS, видит все строки, как service_role). См. рецепт в ТЗ.
--
-- ⚠️ СТАТУС (22.06.2026): дверь «/rest/v1 открыт наружу» уже ЗАКРЫТА БЕЗ этих
--    ролей — через jwt-secret в PostgREST + служебный токен role=gen_user
--    (см. deploy/timeweb/postgrest.conf и README). Этот SQL — ОПЦИОНАЛЬНЫЙ
--    хардненинг (least-privilege на уровне БД), требует суперюзера Timeweb и
--    дыру НЕ закрывает (её закрыл jwt-secret). Применять, когда появится
--    суперюзер/панельная роль с CREATEROLE+BYPASSRLS.
--
-- Ниже — ИДЕАЛЬНЫЙ вариант (least privilege) для боевого. Замените пароль.
-- ============================================================================

-- 1. Технический логин-роль для подключения PostgREST.
CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD 'СМЕНИ_МЕНЯ';

-- 2. Рабочая роль доступа к данным. BYPASSRLS — чтобы поведение совпало с
--    нынешним service_role (RLS на таблицах оставляем как fail-safe).
--    (BYPASSRLS требует суперпользователя при создании роли.)
CREATE ROLE web_app NOLOGIN BYPASSRLS;
GRANT web_app TO authenticator;

-- 3. Права на данные.
GRANT USAGE ON SCHEMA public TO web_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO web_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO web_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO web_app;

-- 4. DEFAULT PRIVILEGES — чтобы будущие миграции (новые таблицы/последовательности/
--    функции) автоматически получали права, иначе 403 после каждой миграции.
--    Выполнять от имени роли-владельца объектов (gen_user) — тогда новые объекты,
--    созданные ею, сразу будут доступны web_app.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO web_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO web_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO web_app;

-- 5. pgcrypto живёт в схеме extensions (шаг 1). Нужно для токенов
--    (children/teachers/invitations/responsible_parents → gen_random_bytes).
GRANT USAGE ON SCHEMA extensions TO web_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO web_app;

-- 6. После применения миграций структуры — перезагрузить кэш схемы PostgREST:
--    NOTIFY pgrst, 'reload schema';   (см. scripts/db-migrate.mjs)
