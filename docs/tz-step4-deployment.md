# ТЗ Шаг 4 — Развёртывание на Timeweb (PostgREST + приложение)

> Статус: план (написан 21.06.2026). Реализация — на копии/staging, боевой
> (Vercel + Supabase + Yandex) НЕ переключаем до полной проверки.
> Подход к слою данных выбран: **Вариант 1 — self-host PostgREST** (анализ —
> память `project-step4-data-layer` / переписка). Приложение продолжает ходить
> тем же `supabase.from()` API; меняются endpoint и роль в БД, а не 868 запросов.

Принцип: старый стек жив до конца; новый поднимаем рядом; переключаем по DNS;
гасим старое через 1–2 недели. Откат = возврат переменных окружения на Supabase.

Замеры по коду (на момент написания): ~868 `.from()`, `.rpc()` = 0, только
PostgREST (нет Supabase Auth / Realtime / Functions). PostgREST-специфика:
37 вложенных эмбедов, 14 дизамбигуаторов (`!inner`/`!fk`), 26 `.or()` с сырыми
строками, 53 count/head, 239 `.single/.maybeSingle`. БД — строго server-only
(прямых запросов браузер→БД нет). RLS — не рантайм-зависимость (ходим под
привилегированной ролью, авторизация в коде).

---

## Часть A. Self-host PostgREST

### A1. Роли и гранты в базе Timeweb
Дамп шага 1 шёл с `--no-privileges` → права проставляем заново.

- **`authenticator`** — технический логин-роль для подключения PostgREST
  (LOGIN, NOINHERIT, свой пароль).
- **`web_app`** — рабочая роль доступа к данным (NOLOGIN, **BYPASSRLS** —
  чтобы поведение совпало с нынешним service_role, который RLS обходит).
  `GRANT web_app TO authenticator` (PostgREST переключается через SET ROLE).
- **Гранты `web_app`:** USAGE на схему `public`; SELECT/INSERT/UPDATE/DELETE на
  все таблицы; USAGE,SELECT на все последовательности; EXECUTE на функции
  (нужно для триггера `ideas_recount_votes`). Плюс **ALTER DEFAULT PRIVILEGES** —
  чтобы будущие таблицы/последовательности автоматически получали права (иначе
  после каждой миграции 403).
- **pgcrypto:** дать `web_app` USAGE на схему `extensions` + EXECUTE на
  `gen_random_bytes` (зависят children/teachers/invitations/responsible_parents).
- **RLS:** оставляем включённым (fail-safe), но `web_app` BYPASSRLS → политики не
  мешают. Две недоехавшие политики `children` из шага 1 при таком раскладе не
  критичны — зафиксировать в `knowledge/RECOVERY.md`.

### A2. Конфиг PostgREST
- Версию **закрепить ≥ v12** (как у Supabase) — иначе тонкие отличия в
  эмбедах/агрегатах/`!inner`. Прибить тег Docker-образа.
- `db-uri` → `authenticator@127.0.0.1`.
- `db-schemas = public`; `db-extra-search-path = public, extensions`.
- **`db-anon-role = web_app`** — ключевое: без валидного JWT PostgREST работает
  под `web_app` (= нынешний service_role).
- **`jwt-secret` НЕ задаём** — приложению он не нужен (auth в коде). Заголовки
  `apikey`/`Authorization` от supabase-js PostgREST просто игнорирует.
- `db-pool` — под CPU/нагрузку; `server-host = 127.0.0.1` (наружу НЕ публикуем).
- После каждой миграции — **reload схемы** (`NOTIFY pgrst, 'reload schema'`).
  Внести в процедуру миграций (см. раздел «Процедура миграций»).

### A3. nginx (внутренний путь к PostgREST)
- supabase-js ходит на `<URL>/rest/v1/...`. Отдаём PostgREST по этому пути:
  `location /rest/v1/ → proxy_pass на 127.0.0.1:<порт PostgREST>/` (срезая
  префикс `/rest/v1`). Это то же, что делает шлюз Supabase.
- Наружу `/rest/v1` НЕ открывать — БД остаётся server-only (app и PostgREST на
  одной машине, трафик локальный).

### A4. Проверка на копии (обязательно до cutover)
Поднять PostgREST против копии базы и **сравнить ответы со Supabase** на местах с
PostgREST-спецификой. Автоматизировано: `scripts/compare-rest-backends.mjs`
(сравнивает один и тот же набор PostgREST-запросов на двух бэкендах и диффит
JSON; есть self-test против самого Supabase). Покрыть:
- **Эмбеды:** `config_presets!config_preset_id(...)`, `albums!inner(tenant_id)`,
  многоуровневые (CRM).
- **`.or()`:** видимость tenant/global (`tenant_id.is.null,tenant_id.eq.X`).
- **count/head:** счётчики, `spread_templates(count)` (форма `[{count}]`).
- **upsert onConflict:** `photo_locks`, `album_layouts`, `ideas` (проверяется
  функционально в smoke — diff-скрипт сравнивает только чтения).
- **Триггеры:** пересчёт голосов идей (`ideas_recount_votes`).
- **pgcrypto-вставки:** создание ребёнка/учителя/приглашения (токены).
- Проверить, что **reload схемы** после миграции подхватывает новые колонки.

### A5. Чек-лист переключения (cutover)
- [ ] Гранты + DEFAULT PRIVILEGES проставлены; pgcrypto-права выданы.
- [ ] PostgREST поднят, версия зафиксирована, schema-reload в процедуре миграций.
- [ ] nginx `/rest/v1` → PostgREST (внутренне), наружу закрыто.
- [ ] `scripts/compare-rest-backends.mjs` — расхождений нет.
- [ ] ENV приложения: `NEXT_PUBLIC_SUPABASE_URL` → внутренний адрес (через
      `/rest/v1`); `SUPABASE_SERVICE_ROLE_KEY`/`ANON_KEY` → заглушки (supabase-js
      требует непустой ключ, но PostgREST его не использует); `STORAGE_BACKEND=timeweb`.
- [ ] **Финальная дельта-синхронизация:** БД (изменения с шага 1) + storage
      (rclone — помним, 1 файл уже добавился после снимка).
- [ ] Smoke по ключевым сценариям (кабинет/редактор/обложки/родитель/супер).
- [ ] Откат наготове: вернуть ENV на Supabase (старый стек жив).

---

## Часть B. Приложение на VDS Timeweb

### B1. Сервер и процессы
- VDS (Ubuntu LTS), **Node 20 LTS**. Next.js: `npm ci && npm run build &&
  next start` на `127.0.0.1:3000` под **systemd** или **pm2** (pm2 — для
  zero-downtime reload).
- PostgREST — отдельный systemd-юнит/Docker (часть A).
- Postgres — managed Timeweb (уже есть с шага 1).

### B2. Домен + HTTPS
- DNS A-запись поддомена для теста (напр. `ru.…` / `app.…`); основной домен
  переключаем в конце.
- **nginx** :443 → `localhost:3000` (Next) и внутренний `/rest/v1` → PostgREST.
- **Let's Encrypt (certbot)** + авто-продление. HSTS. Наша auth — secure-cookie →
  HTTPS обязателен.

### B3. Авто-деплой из Git
- GitHub Actions (или GitFlic) → push в `main` → SSH на VDS → `git pull &&
  npm ci && npm run build` → перезапуск (**pm2 reload** для без-даунтайма).
- **Health-check** после деплоя + откат на предыдущий релиз (релизы папками +
  симлинк `current`).
- **Секреты на сервере** (.env): критично перенести **тот же `JWT_SECRET`** —
  иначе разлогинятся все (см. `docs/security-migration-checklist.md`). Не коммитить.
- Миграции остаются ручными (см. процедуру ниже) + reload схемы PostgREST.

### B4. Эксплуатация
- Бэкапы БД: managed-бэкапы Timeweb + `scripts/backup-db.sh` по расписанию;
  проверять восстановление.
- Логи/мониторинг: `journalctl`/`pm2 logs` + healthcheck-пинг.
- **Разблокируется РИСК №1:** фоновый экспорт PDF без лимита 60с (отдельное ТЗ).

### B5. Последовательность и риски
1. VDS + PostgREST + приложение на **поддомене**, прогон A4 + smoke.
2. Параллельная работа со старым стеком; тестовые альбомы на новом домене.
3. Финальная дельта-синхронизация → переключение **основного домена** в DNS.
4. Через 1–2 недели — гашение Vercel/Supabase/Yandex.
- Главные риски: забыть `JWT_SECRET` (разлогин), не проставить DEFAULT PRIVILEGES
  (403 после миграций), рассинхрон версии PostgREST (баги эмбедов), не сделать
  reload схемы.

---

## Процедура миграций (после переезда) + авто-reload схемы

Сейчас: датированный SQL в `migrations/`, Сергей применяет вручную через Supabase
Studio. После переезда Supabase Studio нет — применяем к Timeweb Postgres и
**обязательно перезагружаем кэш схемы PostgREST** (иначе новые колонки/таблицы
вернут ошибку «column not found», пока кэш старый).

Порядок:
1. Написать датированный файл `migrations/YYYY-MM-DD-*.sql` (как сейчас; префиксы
   таблиц в JOIN/WHERE).
2. Применить к Timeweb Postgres: `psql "$TIMEWEB_DATABASE_URL" -f <файл>`
   (клиент postgresql@18, SSL `verify-ca` с `ca.crt` — как в шаге 1).
3. **Если миграция меняет СТРУКТУРУ** (таблицы/колонки/связи/функции) —
   перезагрузить схему PostgREST: `NOTIFY pgrst, 'reload schema';`
   (для смены связей/FK — ещё и `NOTIFY pgrst, 'reload config';`). Чистые
   изменения ДАННЫХ reload не требуют.
4. Если добавлены новые таблицы — проверить, что `web_app` имеет на них права
   (DEFAULT PRIVILEGES из A1 должны покрыть автоматически; иначе доставить GRANT).
5. Дублировать структурное изменение в `schema.sql` (для развёртывания с нуля).

Хелпер: `scripts/db-migrate.mjs` — применяет файл миграции к указанной БД и
шлёт reload одной командой (требует явного `--confirm` и целевого URL; по
умолчанию НИЧЕГО не делает). Использовать только для Timeweb, не для боевого
до cutover.

---

## Что нужно сделать руками на сервере (вне досягаемости Claude с ноутбука)
- Создать VDS, открыть порты, поставить Node/nginx/certbot, развернуть PostgREST.
- Создать роли `authenticator`/`web_app` и выдать гранты (A1) — через `psql` к
  Timeweb (Claude может подготовить точный SQL по запросу).
- Прописать DNS, секреты на сервере, настроить CI/CD (Claude готовит конфиги/workflow).

Claude готовит: SQL ролей/грантов, конфиг PostgREST, nginx-конфиг, CI-workflow,
скрипт сверки A4, хелпер миграций — по мере перехода к реализации.
