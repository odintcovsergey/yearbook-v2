# Аудит legacy-хвостов после переезда на Timeweb

> Только чтение/инвентаризация. Никаких правок. Дата: 2026-06-26.
> Контекст-файл: `yearbook-context-v199.md`. HEAD: `8892b8f`.
> Прод: VDS Timeweb + Managed Postgres + PostgREST self-host + S3 Timeweb (`s3.twcstorage.ru`).

## Главный вывод (как читать этот отчёт)

1. **`@supabase/supabase-js` — ЖИВОЙ и КОРРЕКТНЫЙ клиент.** После переезда приложение
   осознанно осталось на `supabaseAdmin.from()` как на клиенте к **PostgREST**, но endpoint
   теперь Timeweb (через `NEXT_PUBLIC_SUPABASE_URL` в `.env.production`). Поэтому 81 файл с
   «supabase» в коде — это в массе своей живой код, указывающий на Timeweb, **а не хвост**.
   Хвост — только там, где код идёт в Supabase **Storage** или на хардкод `*.supabase.co`.

2. **Вся маршрутизация ХРАНИЛИЩА держится на одной env-переменной `STORAGE_BACKEND`.**
   `lib/storage.ts` (фото) и `lib/blob-storage.ts` (фоны/декор/рефки) в КАЖДОЙ функции
   сперва проверяют `storageBackend()==='timeweb'` → `twc*` (Timeweb); else-ветка идёт в
   Supabase Storage / Yandex. **Default при отсутствии переменной = `'supabase'`.**
   ✅ В проде проверено: `.env.production` содержит `STORAGE_BACKEND=timeweb` → все else-ветки
   мертвы в проде. Это и есть «осознанный dual-backend», НО критическая точка: сбей/потеряй
   эту переменную — и весь storage молча уедет в мёртвые Supabase/Yandex.

3. **`yc:`-префикс ключей — ЖИВОЙ текущий формат, не legacy-чтение.** Новые загрузки тоже
   пишут `yc:<album>/...` (route.ts:2832, upload-url, workflow, personal-spread). Байты идут
   в Timeweb (`ycUpload→twcUpload`, `ycDelete→twcDelete`). «Yandex» в названии — чисто
   историческое; трогать нельзя без миграции ключей в БД.

4. **`next/image` не используется (0 импортов)** → `images.remotePatterns` в `next.config.js`
   (yandexcloud + supabase.co) — мёртвый конфиг. Картинки отдаются через `<img>` + signed URL
   и прокси `/api/img` (whitelist `s3.twcstorage.ru` — живой).

---

## Карта-инвентарь (классификация)

| Файл:строка | Сервис | Тип | На что указывает | Риск |
|---|---|---|---|---|
| `.env.production` (prod) `STORAGE_BACKEND=timeweb` | — | **конфиг (критический)** | Единая точка маршрутизации всего storage. Стоит верно. | **СРЕДНИЙ** (single point of failure: default='supabase') |
| `lib/blob-storage.ts:129,140,149,161` | Supabase Storage | живой код, **gated else-ветка** | `createSignedUploadUrl/remove/copy/list` — выполняется ТОЛЬКО если `STORAGE_BACKEND≠timeweb`. В проде мёртво. | низкий (gated) / средний если флаг слетит |
| `lib/blob-upload-client.ts:27` | Supabase Storage (browser) | живой код, gated else-ветка | `supabaseBrowser.storage.uploadToSignedUrl` — только supabase-backend. В проде клиент идёт по `put_url` (Timeweb). | низкий (gated) |
| `app/api/tenant/route.ts:5978` | Supabase Storage | живой код, **legacy-fallback** | `supabase.storage.remove` в else после `isYcPath` (delete_album). Сработает лишь для НЕ-`yc:` ключа (доминирующих не осталось). | низкий |
| `app/api/tenant/route.ts:6816` | Supabase Storage | живой код, legacy-fallback | то же в delete_photo (else после isYcPath). | низкий |
| `lib/storage.ts:29-41` (`YC_ENDPOINT`, ycStorage) | Yandex | живой код, **gated else-ветка** | S3-клиент Yandex — используется только если backend≠timeweb. В проде мёртв. | низкий (gated) |
| `lib/storage.ts` + 14 файлов: `isYcPath/stripYcPrefix/ycUpload/ycDelete/ycDeleteStrict` | Yandex (наследие имени) | **осознанный legacy — ЖИВОЙ** | Текущий формат ключей `yc:`; роутинг в Timeweb. НЕ ошибка. | низкий (по дизайну) |
| `route.ts:2832`, `upload-url:60,101`, `workflow:152`, `personal-spread:157` | — (`yc:` имя) | живой код | Новые ключи пишутся как `yc:...`. | низкий (по дизайну) |
| `next.config.js:5-9` (`storage.yandexcloud.net`, `bnotiyhamfyllcrqwquq.supabase.co`) | Yandex+Supabase | **мёртвый конфиг** | `images.remotePatterns`, но `next/image` нигде не используется → не читается. | низкий (мусор) |
| `next.config.js` — нет `twcstorage.ru` | Timeweb | пропуск в конфиге | Не нужен, раз next/image не используется. Если когда-то введут next/Image — добавить. | низкий (открытый вопрос) |
| `lib/blob-storage.ts:32,46-47` (`SUPA_PUBLIC_RE`, `supabasePublicUrl` через `NEXT_PUBLIC_SUPABASE_URL`) | Supabase Storage | **legacy-чтение** | Распознаёт старые сохранённые публичные supabase-URL декора/рефок и переподписывает через Timeweb (`resolveReadUrl`). По дизайну. | низкий |
| `lib/cover/resign-*.ts`, `lib/pdf-export/photo-embed.ts:702-710` | Supabase/Yandex/Timeweb | живой код (legacy-парсинг URL) | Разбор path-style URL разных хостов (в т.ч. старых supabase) при переподписи. | низкий |
| `app/api/cleanup/route.ts` (весь) | — (Timeweb через ycDelete) | **НУЖНЫЙ, но отключённый чистильщик** | POST чистит ИСТЁКШИЕ (`expires_at`) `album_exports` + `delivery_files` (TTL экспортов/выдачи) + файлы из Timeweb. Чистит ДРУГОЕ, чем systemd `yearbook-cleanup` (тот — `photos.original_path` архивов), НЕ вытеснен им. В проде `CLEANUP_SECRET` не задан → POST=500 (отключён, fails-closed); вызывающих нет. **НЕ удалять** — оживить отдельной задачей (задать секрет + таймер), иначе истёкшие exports/delivery будут сиротеть. GET — безвредный healthcheck. | средний (отключён, не дыра) |
| `next.config.js` `api.bodyParser`, маршруты с `maxDuration`, ~30 комментов «лимит Vercel 4.5МБ/60с» | Vercel | коммент-док + конфиг | Историческая привязка к лимитам Vercel; на VDS не действует. | низкий (мусор/доки) |
| `lib/supabase.ts`, `lib/supabase-browser.ts` | Supabase-js клиент | **живой код (PostgREST → Timeweb)** | Читают `NEXT_PUBLIC_SUPABASE_URL`/ключи из env (в проде = Timeweb). Не хвост. | низкий (живой, корректный) |
| `.env.local` (локально): `NEXT_PUBLIC_SUPABASE_URL=...supabase.co`, `YC_ACCESS_KEY_ID/SECRET`, нет `STORAGE_BACKEND` | Supabase+Yandex | **stale local-конфиг** | Локалка всё ещё смотрит на СТАРЫЙ Supabase-cloud и (без флага) на supabase/yandex storage. Прод не затронут, но локалка≠прод (мои аудит-запросы по .env.local били в устаревшую базу). | средний (для разработки/recovery) |
| `.env.example` | Supabase | устаревший шаблон | Содержит только `SUPABASE_*`; нет `TWC_S3_*`, `STORAGE_BACKEND`, `TWC_*`. Не описывает то, что прод реально требует. | средний (onboarding/recovery) |
| `schema.sql:3,192` | Supabase | коммент-док | «Запустите в Supabase SQL Editor», «создайте bucket photos в Supabase UI». Стартовая схема, инструкции устарели после переезда. | низкий (доки) |
| `migrations/2026-05-28-*`, `2026-05-31-*`, `2026-06-01-*` (`insert into storage.buckets ...`) | Supabase Storage | **legacy-миграции** | Создание Supabase Storage-бакетов (template-backgrounds/decorations/referral). Supabase-специфика `storage.buckets` — на Timeweb-Postgres не применима, историческое. | низкий (история) |
| `migrations/*` заголовки «Применить в Supabase Studio/SQL Editor» (~8 файлов) | Supabase | коммент-док | Инструкции применения от эпохи Supabase. Сейчас миграции через psql/PostgREST на VDS. | низкий (доки) |
| `scripts/cleanup-supabase-storage.mjs` | Supabase Storage | **dead one-off** | Ручная чистка СТАРОГО supabase-бакета photos (Phase 3 backlog приватных фото). Не в request-path/systemd. | низкий |
| `scripts/migrate-storage.mjs`, `migrate-supabase-storage.mjs` | Supabase→Yandex | **dead one-off** | Миграционные тулзы (Supabase Storage → Yandex). Отыграны. | низкий |
| `scripts/compare-rest-backends.mjs` | Supabase vs self-host | dead one-off | Сверка PostgREST-бэкендов при переезде (шаг 4). Отыграно. | низкий |
| `scripts/dump-supabase-cli.sh`, `dump-supabase-pgdump.sh` | Supabase | one-off/наследие имени | Дамп БД (имя «supabase» историческое). Живой бэкап теперь `backup-db.sh` (systemd). | низкий |
| `scripts/yc-make-private.ts` | Yandex | dead one-off | Выставление ACL приватности в YC (D1). Отыграно. | низкий |
| `scripts/smoke-album-builder.ts:36`, `convert-idml.ts:318` | Supabase env | тул (читает env) | Используют `SUPABASE_SERVICE_ROLE_KEY` через env → в проде Timeweb. | низкий |
| `vitest.config.ts:29-30`, `lib/cover/__tests__/resign-*.test.ts` | Supabase | тест-фикстуры | Заглушки ключей/URL для тестов. | низкий (мусор) |
| `package.json` deps | — | конфиг | Есть `@supabase/supabase-js` (живой), `@aws-sdk/client-s3`+presigner (живой, S3 для YC/TWC). **Нет** `@vercel/*`, `yandex-*` пакетов. Мёртвого веса зависимостей нет. | низкий |
| `vercel.json`, `.vercel/` | Vercel | **отсутствуют** | Файлов нет (проверено). | — |

---

## СВОДКА

### Всего (значимых попаданий)
- **Supabase:** ~81 файл кода (в основном живой PostgREST-клиент → Timeweb), 9 скриптов, 250 .md (доки/история).
  Значимых не-PostgREST: ~6 storage-точек (все gated/fallback), хардкод URL в `next.config` (мёртв) + тесты, 5 dead-скриптов, legacy-миграции бакетов.
- **Yandex:** `lib/storage.ts` (gated клиент-fallback) + `yc:`-naming (живой формат ключей, 15 файлов) + `next.config` (мёртв) + 2 dead-скрипта.
- **Vercel:** 0 живого кода. ~30 комментов про лимиты + `/api/cleanup` (возможно мёртвый) + отсутствующий `vercel.json`.
- **AWS:** хардкод-эндпоинтов нет; `@aws-sdk` используется как S3-клиент для YC/TWC (корректно).

### По риску
- **ВЫСОКИЙ (живой путь данных НЕ в Timeweb):** **0 подтверждённых.** В проде всё gated `STORAGE_BACKEND=timeweb`.
- **СРЕДНИЙ:** (1) сам `STORAGE_BACKEND` как single-point-of-failure; (2) `/api/cleanup` — мёртв ли и доступен ли снаружи; (3) `.env.local` смотрит на старый Supabase-cloud (локалка≠прод); (4) `.env.example` не описывает Timeweb-переменные.
- **НИЗКИЙ:** мёртвый `images.remotePatterns`, комменты про Vercel-лимиты, legacy-миграции бакетов, dead one-off скрипты, тест-фикстуры, doc-заголовки «Supabase Studio».

### ТОП к проверке (не баги, но требуют решения человека)
1. **`/api/cleanup`** — подтвердить, что эндпоинт мёртв и/или закрыт снаружи (вызывающих в репо нет; чистку делает systemd). Если открыт — потенциальная двойная логика.
2. **`STORAGE_BACKEND`** — единственный рубильник всего storage; стоит задокументировать/захардкодить дефолт безопаснее или добавить fail-fast, если он не `timeweb` в проде.
3. **`.env.local` / `.env.example`** — локальная разработка всё ещё на старом Supabase-cloud; шаблон не отражает Timeweb. Привести в соответствие (иначе диагностики по локалке врут — как было сегодня).

### Точно мёртвый код/мусор (можно удалять ОТДЕЛЬНОЙ задачей, осторожно)
- `next.config.js images.remotePatterns` (next/image не используется).
- dead one-off скрипты: `cleanup-supabase-storage.mjs`, `migrate-storage.mjs`, `migrate-supabase-storage.mjs`, `compare-rest-backends.mjs`, `yc-make-private.ts`.
- Комменты-привязки к лимитам Vercel (косметика).
- legacy `insert into storage.buckets` миграции (история, на Timeweb не применяются).

### Осознанный legacy (НЕ трогать без миграции)
- `yc:`-формат ключей + `isYcPath/stripYcPrefix/ycUpload/ycDelete` — живой роутинг в Timeweb.
- dual-backend в `lib/storage.ts` / `lib/blob-storage.ts` (else-ветки supabase/yandex — страховка/история переезда).
- `resolveReadUrl`/`SUPA_PUBLIC_RE` и path-style парсинг в `lib/cover/*`, `lib/pdf-export/photo-embed.ts` — чтение старых сохранённых supabase-URL с переподписью через Timeweb.

### Открытые вопросы (сам не уверен живое/мёртвое)
- `/api/cleanup` — есть в коде, вызывающих не нашёл; доступность снаружи не проверял (только инвентаризация).
- Остались ли в проде НЕ-`yc:` ключи в `photos` (по которым сработала бы supabase-fallback-ветка delete_album/delete_photo). Беглый аудит утром стрипал `yc:` у всех — похоже, не-yc не осталось, но точечно не считал.
- Старый Supabase-бакет `photos` (Phase 3 backlog) — закрыт ли; это вне репо (инфра Supabase).
