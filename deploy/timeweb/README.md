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
| `deploy.sh` | `/srv/yearbook/repo/deploy/timeweb/` (в репо) | **pull-деплой**: fetch→build→switch→health→rollback |
| `health-check.sh` | рядом с `deploy.sh` | проба `/login`=200 + `/api/health`=200 (БД) |
| `yearbook-deploy.service` | `/etc/systemd/system/` | oneshot-запуск `deploy.sh` |
| `yearbook-deploy.timer` | `/etc/systemd/system/` | опрос GitHub каждые 2 мин |
| ~~`deploy-timeweb.yml`~~ | — | ⚠️ **ЗАМЕНЁН pull-моделью** (см. ниже), не используется |

## ⭐ Авто-деплой (pull-модель) — АКТУАЛЬНАЯ СХЕМА (ТЗ №1, 23.06.2026)

**Почему pull, а не GitHub Actions push.** С РФ-сервера **исходящий** git до GitHub
работает (`git ls-remote` → OK, проверено 23.06), а **входящие** соединения из-за
рубежа до сервера ненадёжны (та же фильтрация, что убила HTTP-01 Let's Encrypt).
Поэтому раннер GitHub, который SSH-ится внутрь сервера (входящее), и self-hosted
раннер (тянет бинарь/control-plane с заблокированного `githubusercontent.com`) —
оба хрупкие. Надёжно: **сервер сам опрашивает GitHub** (только исходящее).
GitFlic с сервера НЕ тянется (`ls-remote` → FAIL) — primary remote = GitHub.

**Раскладка на сервере (capistrano-стиль, аддитивно к старому `/srv/yearbook-v2`):**
```
/srv/yearbook/
├── repo/                      git clone main (источник; fetch исходящий)
├── shared/.env.production     секреты (НЕ в git, копия со старого стенда)
├── releases/<sha>/            релиз = git archive + npm ci + npm run build
├── current -> releases/<sha>  активный релиз (симлинк)
└── .deploy.lock               flock от параллельных запусков
```

**Цикл деплоя** (`deploy.sh`, по таймеру каждые 2 мин под юзером `yearbook`):
1. `git fetch origin main`; если sha == текущий — выходим (ничего не делаем).
2. Новый коммит → `git archive` в `releases/<sha>`, симлинк `.env.production`,
   `npm ci`, `npm run build`.
3. Переключить `current` → новый релиз, `sudo systemctl restart yearbook`.
4. `health-check.sh` (локально: `/login`=200 + `/api/health`=200). Провал →
   симлинк назад на прошлый релиз + restart = **авто-откат**.
5. Чистка: оставить 3 последних релиза.

**Установка (один раз, делается на сервере):**
1. `setup-pull-deploy.sh` (или вручную): создать `/srv/yearbook/{repo,shared,releases}`,
   `git clone https://github.com/odintcovsergey/yearbook-v2.git repo`,
   скопировать `.env.production` со старого стенда в `shared/`.
2. Первый релиз руками: `deploy.sh` → соберёт `releases/<sha>`, поставит `current`.
3. **sudoers** для `yearbook` (рестарт без пароля), файл `/etc/sudoers.d/yearbook-deploy`:
   `yearbook ALL=(root) NOPASSWD: /usr/bin/systemctl restart yearbook, /usr/bin/systemctl is-active yearbook`
4. **Тест на отдельном порту 3001** ДО переключения боевого (см. ТЗ-чеклист).
5. **Cutover:** в `yearbook.service` сменить `WorkingDirectory=/srv/yearbook/current`
   и `EnvironmentFile=/srv/yearbook/current/.env.production`, `daemon-reload`,
   `restart`, health. Старый `/srv/yearbook-v2` остаётся как мгновенный откат.
6. **Вооружить авто-деплой:** скопировать `yearbook-deploy.{service,timer}` в
   `/etc/systemd/system/`, `systemctl enable --now yearbook-deploy.timer`.

**⚠️ Реестр npm с РФ-сервера НЕДОСТУПЕН** (`registry.npmjs.org` → ETIMEDOUT,
проверено 23.06). Поэтому `npm ci` на деплое НЕ делаем: `node_modules` общий
(`shared/node_modules`, засеян из рабочего стенда), сборка `next build` идёт офлайн.
`deploy.sh` сверяет `package-lock.json` релиза с `shared/` — если зависимости
**изменились**, деплой прерывается (текущий релиз цел) с инструкцией обновить
`shared/node_modules` вручную:
```
# на Mac (где реестр доступен):
npm ci
rsync -a --delete node_modules/ root@SERVER:/srv/yearbook/shared/node_modules/
scp package-lock.json root@SERVER:/srv/yearbook/shared/package-lock.json
# затем деплой пройдёт автоматически на следующем тике
```

**Как Сергею выкатить изменение:** просто `git push` в `main` (через обычный коммит).
Через ≤2 минуты сервер сам соберёт и выкатит, при поломке откатится сам.
Если коммит **добавлял/менял npm-зависимости** — сначала обнови `shared/node_modules`
(см. выше), иначе деплой намеренно остановится.
Заморозить авто-деплой: `systemctl disable --now yearbook-deploy.timer` на сервере.

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

<!-- авто-деплой (pull-модель) активирован 2026-06-23 -->
