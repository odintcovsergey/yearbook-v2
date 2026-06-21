# Шаблоны развёртывания на Timeweb (шаг 4 переезда)

Готовые под копипаст конфиги для self-host PostgREST + приложения на VDS Timeweb.
Полное ТЗ и обоснование — `docs/tz-step4-deployment.md`. Здесь — только файлы и
порядок применения. **Все секреты подставляются НА СЕРВЕРЕ, в репозиторий не
коммитятся** (в файлах — плейсхолдеры `<...>`).

## Файлы

| Файл | Куда на сервере | Зачем |
|---|---|---|
| `postgrest.conf` | `/etc/postgrest/postgrest.conf` | конфиг PostgREST (роль `web_app`, schema, пул) — A2 |
| `postgrest.service` | `/etc/systemd/system/postgrest.service` | автозапуск PostgREST — B1 |
| `nginx-yearbook.conf` | `/etc/nginx/sites-available/yearbook` | `/rest/v1` → PostgREST + фронт Next + HTTPS — A3/B2 |
| `yearbook.service` | `/etc/systemd/system/yearbook.service` | автозапуск Next — B1 |
| `deploy-timeweb.yml` | `.github/workflows/` (после cutover) | авто-деплой по push в main — B3 |

Связанные артефакты (уже в репо):
- `scripts/step4-postgrest-roles.sql` — роли `authenticator`/`web_app` + гранты (A1).
- `scripts/db-migrate.mjs` — применить миграцию + reload схемы PostgREST.
- `scripts/compare-rest-backends.mjs` — сверка A4 (старый Supabase vs новый PostgREST).

## Порядок (когда появится сервер)

1. **Роли в БД** (через панель/поддержку Timeweb или суперпользователем —
   `gen_user` без CREATEROLE/BYPASSRLS): применить `scripts/step4-postgrest-roles.sql`,
   сменив `СМЕНИ_МЕНЯ` на реальный пароль `authenticator`.
2. **PostgREST:** положить бинарь (версия ≥ v12), `postgrest.conf` (подставить
   `<TIMEWEB_PG_HOST>`/`<DB_NAME>`/пароль/`ca.crt`), `postgrest.service` →
   `systemctl enable --now postgrest`. Проверка: `curl 127.0.0.1:3001/albums?limit=1`.
3. **Сверка A4 (обязательно до cutover):**
   `TIMEWEB_REST_URL=http://127.0.0.1:3001 node --env-file=.env.local scripts/compare-rest-backends.mjs`
   — должно быть 33/33 без расхождений (старый Supabase vs новый PostgREST).
4. **Приложение:** код в `/srv/yearbook-v2`, `.env.production` (см. комментарии в
   `yearbook.service`, главное — `JWT_SECRET` тот же, что в текущем проде),
   `npm ci && npm run build`, `yearbook.service` → `systemctl enable --now yearbook`.
5. **nginx + HTTPS:** `nginx-yearbook.conf` (подставить `<DOMAIN>`), `nginx -t`,
   `certbot --nginx -d <DOMAIN>`, reload.
6. **CI:** скопировать `deploy-timeweb.yml` в `.github/workflows/`, задать секреты
   `TIMEWEB_SSH_*`. (Только ПОСЛЕ того как прод реально переедет с Vercel.)
7. **Cutover (ТЗ A5):** финальная дельта-синхронизация БД + storage (rclone),
   переключить ENV, smoke по ключевым сценариям, откат наготове (вернуть ENV на
   Supabase — старый стек жив).

## Важные нюансы

- **`/rest/v1` срезается trailing-слэшем** в `proxy_pass http://127.0.0.1:3001/;`
  — без него PostgREST получит несуществующий путь `/rest/v1/...`.
- **`jwt-secret` у PostgREST НЕ задаём** — всё идёт под `web_app` (= нынешний
  service_role). Авторизация остаётся в коде приложения.
- **После каждой миграции** — reload схемы (`scripts/db-migrate.mjs` шлёт
  `NOTIFY pgrst,'reload schema'`); иначе новые колонки → 400.
- **Сервер этих действий требует обязательно** — с ноутбука Claude их выполнить
  не может, только подготовить (эти шаблоны).
