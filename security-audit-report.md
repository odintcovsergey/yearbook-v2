# Аудит безопасности yearbook-v2 (OkeyBook)

**Дата:** 09.06.2026
**Режим:** обследование, без правок кода/БД/конфига. Это документ для согласования, не фикс.
**Покрыто:** все 24 серверных роута под `app/api/`, `lib/auth.ts`, `lib/storage.ts`, `lib/supabase*.ts`, миграции, `schema.sql`, `next.config.js`, `.gitignore`, полная история git (977 ревизий), `npm audit` прод-зависимостей.

> Главный вывод простыми словами: **архитектура изоляции тенантов сделана крепко** — почти все запросы к данным правильно фильтруются по партнёру. Но есть **два больших риска уровня «красный»**, которые из браузера не видно: (1) фотографии детей лежат в **публичном** хранилище и открываются по прямой ссылке кому угодно, и (2) у нас стоит **версия Next.js с критической уязвимостью обхода авторизации** — её надо просто обновить. Остальное — точечная доводка и гигиена.

---

## 1. Сводка — топ-5 рисков (по убыванию)

1. **🔴 Фото детей в публичном бакете, отдаются по прямым незашифрованным ссылкам** (D1). Yandex Cloud бакет `yearbook-photos` заливает каждое фото с `ACL: 'public-read'` (`lib/storage.ts:41,77`). Ссылки без подписи и без срока — попадают в DOM родительской страницы и в каждый ответ API. Кто знает/угадает путь — скачает фото ребёнка. Это самый тяжёлый риск для ПДн несовершеннолетних.

2. **🔴 Next.js 14.2.3 — критическая дыра обхода авторизации + cache poisoning + SSRF** (J1). `npm audit --omit=dev`: 1 critical + несколько high. Чинится патч-обновлением `next@14.2.35` (внутри 14.2.x, без мажорной миграции). Прод на Vercel, дети, ПДн — приоритет №1 по скорости/риску.

3. **🔴 RLS на `children` выключен в живой БД + репозиторий «врёт» про RLS** (A1, известная дыра — подтверждаем). `schema.sql:134` формально включает RLS на `children`, но в живой базе он OFF (известный вход). Глубже: **ни одна миграция в репо не содержит `ENABLE ROW LEVEL SECURITY` или `CREATE POLICY`** — состояние RLS живёт только в Studio и невидимо для git. Таблицы из поздних миграций (`covers`, `cover_choices`, `referral_programs`, `template_set_backgrounds`, `album_exports` и др.) и таблицы, созданные только в Studio (`sessions`, `users`, `audit_log`, `clients`, `deals`, `original_photos`…), в репо вообще не имеют строки RLS — их статус надо проверить вручную.

4. **🟠 Публичный родительский эндпоинт `teacher` пишет в чужую карточку учителя** (C3). `app/api/teacher/route.ts:93-114` принимает `teacher_id` из тела и делает update/delete **без проверки**, что учитель принадлежит альбому этого родителя. Зная UUID учителя чужого партнёра, ответственный родитель может отредактировать/удалить чужую карточку и подменить фото. Единственная находка с заметным риском кросс-тенантной **записи**.

5. **🟠 Гигиена авторизации: god-key, нет защиты от перебора, сессии не гасятся** (F4/F5/F6). Статический `x-admin-secret` даёт полный superadmin одним заголовком без ротации и аудита (`lib/auth.ts:174-182`; в Vercel переменная удалена 05.05.2026, но код жив). Логин без лимита попыток (`app/api/auth/route.ts:28-49`). При смене пароля/деактивации старые сессии не отзываются — refresh-токены живут до 30 дней.

---

## 2. Таблица находок

Легенда статуса: **дыра** = надо чинить · **требует решения** = зависит от выбора Сергея · **норма** = ок, не трогать.

| ID | Область | Крит. | Статус | Где | Доказательство | Как чинить |
|---|---|---|---|---|---|---|
| **A1** | RLS-дрейф репо↔БД | 🔴/🟠 | требует решения | `schema.sql:131-144`, `migrations/*` | Ни одна миграция не содержит `ENABLE ROW LEVEL SECURITY`/`CREATE POLICY`; `children` OFF в проде; поздние и Studio-only таблицы без RLS-строки в репо | Выполнить в Studio `SELECT relname, relrowsecurity FROM pg_class WHERE relkind='r' AND relnamespace='public'::regnamespace;`, включить RLS где OFF, и впредь коммитить RLS-миграции |
| **A2** | anon-клиент `supabase` | 🟡 | норма | `lib/supabase.ts:14` | Экспорт `supabase` (anon) **нигде не импортируется**; cover-функции получают `supabaseAdmin` параметром; браузер использует отдельный `supabaseBrowser` только для Storage | Удалить мёртвый anon-экспорт, чтобы никто случайно не сделал `supabase.from('children')` в обход service_role |
| **A3** | утечка service_role в бандл | 🟡 | норма | `lib/supabase.ts:7-11` | `supabaseAdmin` не импортируется ни в одном `'use client'`; клиентские компоненты берут anon-`supabaseBrowser` | Ничего не требуется |
| **B1-a** | `quote` привязывает чужой quote_id | 🟡 | требует решения | `app/api/quote/route.ts:30-32` | `quote_id` из тела вставляется без проверки `tenant_id` цитаты (публичный эндпоинт) | Проверять `quote.tenant_id IS NULL OR = album.tenant_id` перед insert |
| **B1-b** | `crm` move/update_deal не проверяет stage_id | 🟡 | требует решения | `app/api/crm/route.ts:260,275` | `stage_id` из тела читается без `.eq('tenant_id', tid)`; сделка проверена, этап — нет | Добавить `.eq('tenant_id', tid)` к выборке `deal_stages` |
| **B2** | `workflow` delete_original/mark_downloaded по file_id | 🟡 | требует решения | `app/api/workflow/route.ts:327-333,374-379` | `file_id` из тела не связан с проверенным `album_id` → можно удалить/пометить чужой `original_photo`/`delivery_file` | Добавить `.eq('album_id', album_id)` к выборке/удалению |
| **B3** | роль/tenantId деривация | 🟡 | норма (1 замечание) | `lib/auth.ts:172-227` | Роль и `tid` зашиты в подписанный HS256 JWT, подмена невозможна. Замечание: при пустом `tid` `getAuth` подставляет `DEFAULT_TENANT_ID` — для не-superadmin это хрупкий инвариант | Для не-superadmin с пустым `tid` возвращать 401 вместо fallback |
| **C1** | серверная проверка токенов | 🟡 | норма | `app/api/{child,teacher,select,quote,draft,referral,personal-spread}/route.ts` | Каждый публичный роут начинает с lookup по `access_token` → 404 при отсутствии; токены 128-бит (`gen_random_bytes(16)`) | Ничего не требуется |
| **C2** | over-fetch у `child` | 🟡 | требует решения | `app/api/child/route.ts:48-66` | Родителю отдаётся весь `tenants.settings` (JSONB, может содержать служебные ключи) | Возвращать whitelist ключей брендинга, не весь `settings` |
| **C3-teacher** | запись в чужую карточку учителя | 🟠 | дыра | `app/api/teacher/route.ts:93-114` | `update/delete` по `teacher_id` из тела без проверки `teachers.album_id === resp.album_id` | Добавить `.eq('album_id', resp.album_id)`; проверять, что `photo_id` из того же альбома |
| **C3-select** | `select`/`quote` photo_id без привязки | 🟡 | требует решения | `app/api/select/route.ts:203` | `photo_id` не проверяется на принадлежность альбому ребёнка | Фильтровать `existingPhotos` по `album_id = child.album_id` |
| **D1** | фото детей в публичном бакете | 🔴 | дыра | `lib/storage.ts:24-27,41,66-69,77`; `app/[token]/page.tsx:1118`; `lib/pdf-export/photo-embed.ts:401` | `ACL: 'public-read'`; `ycPhotoUrl` отдаёт ссылку без подписи и срока; пути с `Date.now()`+имя файла слабо угадываемы, утекают в DOM и API | Сделать бакет приватным, отдавать через presigned GET (короткий TTL); PDF-экспорт тоже через presigned (`@aws-sdk/s3-request-presigner` уже есть) |
| **D2** | права на загрузку | 🟡 | норма | `app/api/upload/route.ts:22`, `upload-url/route.ts:21`, и др. | Все аккаунтные upload-сайты делают `requireAuth` + проверку владения альбомом ДО `.upload()`; родительский `personal-spread` гейтится токеном (by design) | Действий не требуется; для токен-пути — следить за энтропией токена + rate-limit |
| **D3** | валидация загрузки (MIME/размер) | 🟠 | дыра | `app/api/upload/route.ts:70-72`, `app/api/upload-url/route.ts:24,51` | `/api/upload` не проверяет MIME/размер, насильно метит `image/webp`; presign доверяет `content_type` от клиента; `personal-spread` — `sharp` best-effort, не блокирует | Серверная проверка magic-bytes + лимит размера; allow-list content-type/ext для presign; в `personal-spread` делать отказ при ошибке `sharp` |
| **E1** | секреты в истории git | 🟡 | норма | вся история (977 ревизий) | `ghp_/github_pat_/sk-/BEGIN PRIVATE KEY/AKIA/YCAJ` — 0 совпадений; `eyJ…` только sha512-хэши в lock-файлах; `service_role` только как слово в комментариях | Ротация не нужна — история чистая |
| **E2** | `.gitignore` не закрывает `.env*` | 🟠 | требует решения | `.gitignore:3` | Игнорируется только `.env.local`, не `.env`/`.env.production`/`.env.*`. Реальный env не закоммичен (только `.env.example`) | Расширить до `.env*` с негейтом `!.env.example` |
| **E3** | хардкод секретов | 🟡 | норма | `app/`, `lib/`, `scripts/` | Все ключи из `process.env`; хардкод только публичных хостнеймов Yandex/Supabase | Действий не требуется |
| **E4** | `images.domains: ['*']` | 🟠 | дыра | `next.config.js:3` | Image Optimizer проксирует/оптимизирует картинки с любого хоста (открытый прокси/SSRF-сосед) | Заменить на `remotePatterns` ровно с `storage.yandexcloud.net` и `<ref>.supabase.co` |
| **F1** | JWT | 🟡 | норма (1 гэп) | `lib/auth.ts:50-72` | HS256, access 15м, refresh 30д; подпись+срок проверяются через `jwtVerify` на каждом запросе. Гэп: нет явного `algorithms:['HS256']` | Передавать `{algorithms:['HS256']}` в `jwtVerify`; `JWT_SECRET` ≥32 случайных байт |
| **F2** | cookie-флаги | 🟡 | норма | `lib/auth.ts:272-290` | `httpOnly` ✅, `secure` в prod ✅, refresh path-scoped `/api/auth` ✅, `sameSite:'lax'` | Рассмотреть `sameSite:'strict'` или CSRF-токены для cookie-POST |
| **F3** | хеш паролей | 🟡 | норма | `lib/auth.ts:115-162` | PBKDF2-SHA256, **100000** итераций, 16-байт соль; сравнение хешей не constant-time | Constant-time сравнение; со временем — argon2/bcrypt или больше итераций |
| **F4** | legacy `x-admin-secret` | 🟠 | требует решения | `lib/auth.ts:174-182` | Один статический заголовок = полный superadmin, без ротации/аудита (`userId:null`); в Vercel переменная удалена, но код жив; не утекает в клиент (нет `NEXT_PUBLIC_`) | Удалить legacy-ветку; до того — `===`→constant-time, держать переменную unset, не логировать |
| **F5** | брутфорс логина | 🟠 | дыра | `app/api/auth/route.ts:28-49` | Нет счётчика попыток/локаута/задержки/CAPTCHA на login/accept_invitation/setup | Per-IP + per-email rate-limit / backoff / lockout (Vercel KV или таблица `login_attempts`) |
| **F6** | отзыв сессий | 🟠 | требует решения | `lib/auth.ts:78-107`; `app/api/auth/route.ts:131-139` | Refresh отзывается на логауте ✅, но при смене пароля/деактивации сессии **не** удаляются; access-JWT нельзя отозвать (живёт 15м после логаута) | На смене пароля/деактивации удалять все `sessions` юзера; рассмотреть token-version в JWT |
| **G1** | `view_as` без валидации UUID | 🟠 | требует решения | `app/api/tenant/route.ts:575,581` → `.or()` на :628,953,1048,… | URL-параметр `view_as` интерполируется в строку PostgREST `.or()` без проверки (фильтр-инъекция; доступ ограничен ролью). В `layout/route.ts:209` уже есть правильный `UUID_REGEX` | Добавить `UUID_REGEX.test(viewAsTenantId)` → 400, как в `layout/route.ts` |
| **G2** | нет zod-валидации тел | 🟡 | требует решения | все write-роуты `app/api/`; пример `crm:165`, `select:11` | `zod` в зависимостях, но в `app/api/` не используется; тела пишутся в БД как есть, только ad-hoc `.trim()`/`?? []` | Zod-схемы для тел (особенно `select/child/crm/teacher` — PII + публичный поток), `safeParse`→400 |
| **G3** | XSS через `dangerouslySetInnerHTML` | 🟡 | норма (остаточный) | 8 сайтов: `app/app/page.tsx:3837,4935,5062` и др. | Везде только серверный SVG-превью; пользовательский текст в обложках экранируется `esc()` (`lib/cover/preview-svg.ts`); в `render-preview-svg.ts` имён учеников нет | Оставить; при добавлении любого user-текста в SVG обязательно прогонять через `esc()` |
| **H1** | логи с ПДн | 🟡 | норма | 28 `console.*` в `app/api/`+`lib/` | Ни один лог не пишет имена/контакты/токены/тела — только операционные сообщения и ID | Не класть `body`/email/токены в новые логи |
| **H2** | сырые ошибки наружу | 🟠 | дыра | ~186 сайтов; `crm:65`, `layout:1932`, `tenant:607,632` и др. | Повсеместно `error.message` от Postgres/PostgREST уходит клиенту → раскрывает имена колонок/constraint'ов/RLS-нарушений (карта схемы) | Хелпер: полный `error` в серверный лог, клиенту обобщённое `{error:'internal error'}`; осмысленные сообщения оставить точечно |
| **I1** | security-заголовки | 🟡 | дыра | `next.config.js` (нет `headers()`) | Нет CSP/HSTS/X-Frame-Options/X-Content-Type-Options; `middleware.ts` отсутствует | Добавить `async headers()`: `X-Frame-Options:DENY`, `X-Content-Type-Options:nosniff`, `Strict-Transport-Security`, по возможности CSP |
| **I2** | CORS | 🟡 | норма | весь `app/`, `lib/` | `Access-Control-Allow-Origin:*` нигде не выставлен; API same-origin (дефолт Next) | Действий не требуется |
| **J1** | npm audit (prod) | 🔴 | дыра | `package.json` → `next@14.2.3` | 1 critical + 2 moderate. `next`: authz bypass (GHSA-f82v-jwr5-mffw), authz bypass (GHSA-7gfc-8cq8-jh5f), cache poisoning (GHSA-gp8f-8m3g-qvj9), SSRF; транзитивно `postcss`/`ws`. `fixAvailable: next@14.2.35` | Обновить `next` до `14.2.35` (патч-уровень); после — `tsc --noEmit` + `vitest run` + `next build` |

---

## 3. Что уже хорошо (не трогать зря)

- **Изоляция тенантов реализована дисциплинированно.** Авторизованные роуты последовательно проверяют владение через хелперы `assertAlbumAccess` / `assertChildAccess` / `assertTeacherAccess` / `getOwnedPhoto` / `assertOwns` (через `albums!inner(tenant_id)`) ДО чтения/мутации по id. Системной IDOR нет.
- **Service_role-only архитектура соблюдена.** Anon-клиент `supabase` нигде не используется для чтения таблиц; service_role-ключ не уезжает в клиентский бандл; браузер имеет отдельный `supabaseBrowser` только для Storage-загрузок.
- **История git чистая** — никаких ключей/токенов/паролей за 977 ревизий.
- **JWT и cookie-гигиена в основном корректны:** HS256 с проверкой подписи+срока на каждом запросе, `httpOnly`+`secure`(prod), refresh path-scoped на `/api/auth` и отзываемый на логауте, PBKDF2 100k итераций (соответствует планке).
- **Публичные родительские эндпоинты проверяют токен серверно** на каждом запросе перед выдачей данных; токены 128-битные.
- **Загрузка в бакеты гейтится правами** — все аккаунтные upload-пути делают `requireAuth` + проверку владения альбомом перед `.upload()`.
- **PII не утекает в логи Vercel**; XSS-дыр через `dangerouslySetInnerHTML` не найдено (SVG-превью, пользовательский текст экранируется).
- **CORS не открыт наружу.**

---

## 4. Открытые вопросы к Сергею (нужно решение, не код)

1. **Приватные фото (D1) — главный продуктовый выбор.** Перевести бакет `yearbook-photos` в приватный и раздавать фото только по подписанным ссылкам с коротким сроком? Это закрывает №1 риск для ПДн детей, но требует доработки родительской страницы и PDF-экспорта (везде, где сейчас прямая публичная ссылка). Подтвердить готовность к этой работе и согласовать TTL ссылок. То же решение по бакетам Supabase (`photos`/логотипы/фоны), если там окажется PII.

2. **Обновление Next.js (J1).** Можно ли обновить `next` 14.2.3 → 14.2.35 прямо сейчас? Это патч внутри 14.2.x, риск регрессии низкий, но я хочу OK на отдельный коммит + прогон трёх проверок. Это самый быстрый и важный фикс.

3. **Проверка RLS в Supabase (A1) — нужен ваш доступ к Studio.** Я не вижу живую БД из кода. Прошу выполнить в SQL Editor: `SELECT relname, relrowsecurity FROM pg_class WHERE relkind='r' AND relnamespace='public'::regnamespace ORDER BY 1;` и прислать результат — тогда я точно скажу, на каких таблицах RLS реально выключен (кроме известного `children`). Особый интерес: `covers`, `cover_choices`, `referral_programs`, `referral_visits`, `template_set_backgrounds`, `album_exports`, `export_profiles`, `config_presets`, `sessions`, `users`, `audit_log`, `clients`, `deals`, `quotes`, `invitations`, `original_photos`, `personal_spread_photos`.

4. **Legacy `x-admin-secret` (F4).** Подтвердите, что переменная `ADMIN_SECRET` в Vercel действительно не задана (тогда путь мёртв). Согласны ли вы на удаление legacy-ветки из `lib/auth.ts` совсем — или фронт где-то ещё на неё опирается?

5. **Приоритизация 🟠-находок.** После согласования отчёта составим отдельный план фиксов. Предлагаю порядок: J1 (Next) → D1 (приватные фото) → закрыть `children` RLS → C3-teacher (кросс-тенантная запись) → F5/F6 (брутфорс + отзыв сессий) → H2/G1/E4/E2 (гигиена). Подтвердите или переставьте.

---

*Отчёт сгенерирован read-only обследованием. Код, БД и конфиг не менялись. План реализации фиксов — отдельным шагом после вашего согласования.*
