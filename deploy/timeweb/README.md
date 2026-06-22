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
- **✅ `/rest/v1` ЗАКРЫТ через `jwt-secret` (22.06.2026, без суперюзера Timeweb).**
  PostgREST подключается под `gen_user` (владелец = как service_role), но требует
  валидный JWT: задан `jwt-secret` (отдельный случайный секрет, только в
  `postgrest.conf`), `db-anon-role` УБРАН → запрос без токена = `401 "Anonymous
  access is disabled"`. Приложение шлёт служебный токен
  (`SUPABASE_SERVICE_ROLE_KEY` в `.env.production` = HS256 `{"role":"gen_user"}`,
  подписан тем секретом; server-only). В nginx срез `Authorization`/`apikey`
  УБРАН (иначе токен не доедет). Секрет PostgREST НЕ равен `JWT_SECRET`
  приложения (вход пользователей) — слой независим. Anon-ключ к БД не ходит
  (браузер только через серверные API-роуты) → пересборка не нужна.
  **Историческая грабля (решена):** раньше `jwt-secret` НЕ задавали и срезали
  `Authorization` в nginx — из-за этого `/rest/v1` был открыт наружу как
  привилегированная роль (curl без заголовка отдавал 200, smoke это не ловил).
- **После каждой миграции** — reload схемы (`scripts/db-migrate.mjs` шлёт
  `NOTIFY pgrst,'reload schema'`); иначе новые колонки → 400.
- **Сервер этих действий требует обязательно** — с ноутбука Claude их выполнить
  не может, только подготовить (эти шаблоны).

## Грабли развёртывания (проверено в бою 21.06.2026 на 5.42.103.168)

- **Swap обязателен.** VDS 3.8 ГБ RAM без swap → `npm run build` падает по OOM и
  рвёт SSH-сессию. Добавить 2 ГБ: `fallocate -l 2G /swapfile && chmod 600 /swapfile
  && mkswap /swapfile && swapon /swapfile` + строка в `/etc/fstab`.
- **`next start` не читает env `HOST`** — слушает `0.0.0.0`. Чтобы только локально
  (наружу через nginx): `npm run start -- -H 127.0.0.1 -p 3000` (см. `yearbook.service`).
- **Сборку запускать от юзера `yearbook`** (не root), иначе `.next` будет root'ом.
  `runuser -u yearbook -- env HOME=/srv/yearbook-v2 npm_config_cache=… npm run build`.
- **`NEXT_PUBLIC_*` впекаются в бандл на `build`** — домен/anon-ключ задавать в
  `.env.production` ДО сборки; смена → пересборка.

## HTTPS: ⚠ HTTP-01 из РФ НЕ работает — только DNS-01

Серверы Let's Encrypt **физически не достукиваются до РФ-IP** (международный
сетевой стык; в access-логе nginx запросов валидаторов с токенами НЕТ вообще —
проверено). `certbot --nginx`/`--webroot` падают с `error:connection`. nginx/MTU/
firewall тут НИ ПРИ ЧЁМ — это сеть выше сервера. **Выпуск только через DNS-01.**

Делается через **acme.sh + dns_regru** (DNS okeybook.ru на ns1/ns2.reg.ru; certbot
reg.ru не умеет):
1. В личном кабинете reg.ru → Настройки → API: включить, задать пароль API,
   **whitelist IP сервера** (обязательно, иначе API отклонит).
2. `git clone https://github.com/acmesh-official/acme.sh` (github.com отвечает,
   CDN-обход не нужен) → `./acme.sh --install -m <email>` (ставит cron автопродления)
   → `acme.sh --set-default-ca --server letsencrypt`.
3. `REGRU_API_Username=… REGRU_API_Password=… acme.sh --issue --dns dns_regru -d <DOMAIN>`
   (acme.sh сам создаёт TXT через API, ждёт, проверяет; креды сохраняет в
   `account.conf` для автопродления).
4. `acme.sh --install-cert -d <DOMAIN> --ecc --key-file … --fullchain-file …
   --reloadcmd "systemctl reload nginx"` → прописать пути в `nginx-yearbook.conf`.

Outbound с сервера к LE и reg.ru API работает — блокируется только INBOUND от LE.
