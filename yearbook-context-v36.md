# КОНТЕКСТ ДЛЯ ПРОДОЛЖЕНИЯ РАБОТЫ
# Система отбора фотографий для выпускных альбомов → платформа для школьных фотографов
# Версия: v36
# Обновлено: 05.05.2026
#
# СТАТУС: АКТИВНЫЙ СЕЗОН (май 2026)
# Workflow производства готов. Партнёрский кабинет готов.
# Личный разворот реализован. CRM готов.
# Все фото в Yandex Object Storage.
#
# Параллельно: фаза 0 продукта B (браузерный движок автовёрстки) в ветке
# feature/layout-engine. См. раздел «ПРОДУКТ B» ниже.
# Что нового в v36: добавлен раздел про продукт B (фаза 0 layout engine).

---

## КТО Я И ЧТО МЫ ДЕЛАЕМ

Сергей — фотограф/организатор выпускных альбомов (OkeyBook).
Стратегическая цель: отраслевой SaaS для школьных фотографов.

**Бизнес-модель с партнёрами:**
- Фотограф ведёт отбор фото через систему (бесплатно)
- После отбора передаёт альбом в OkeyBook на вёрстку/ретушь/печать
- OkeyBook зарабатывает на вёрстке (цена за ученика × количество)
- Менеджеры OkeyBook курируют своих фотографов

---

## ДОРОЖНАЯ КАРТА 2026

### Май — активный сезон, Vercel
### Июнь — переезд на российский хостинг (Timeweb или YC App Platform)
- Dockerfile + GitHub Actions CI/CD
- okeybook.ru без VPN из РФ

### Июль — запуск партнёрской программы
- Реклама, поиск партнёров-фотографов
- Биллинг (оплата вёрстки через менеджера вручную)

### Сентябрь — боеготовность (~100 заказов/мес)

---

## РАБОЧИЙ ДОМЕН

**Основной:** https://yearbook-v2.vercel.app
(album.okeybook.ru — не работает без VPN до переезда)

---

## СТЕК

- Next.js 14 + TypeScript + Tailwind
- Supabase (PostgreSQL, Free Plan) — только БД
- Yandex Object Storage — всё хранилище фото
- Vercel (автодеплой из main)
- GitHub: https://github.com/odintcovsergey/yearbook-v2
- @aws-sdk/client-s3, @aws-sdk/s3-request-presigner
- @dnd-kit/core, @dnd-kit/sortable (drag & drop в CRM)
- jszip (серверный ZIP для скачивания разворота)
- browser-image-compression (сжатие фото на клиенте)

---

## ДОСТУПЫ

### Vercel env переменные
- NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
- JWT_SECRET
- DEFAULT_TENANT_ID: 764929b7-3efe-43e7-aae9-0a9e97e52915
- YC_ACCESS_KEY_ID, YC_SECRET_ACCESS_KEY
- YC_BUCKET_NAME: yearbook-photos
- ADMIN_SECRET — можно удалить (legacy удалён)
- CACHE_BUST

### Yandex Cloud
- Бакет: yearbook-photos, публичное чтение
- URL: https://storage.yandexcloud.net/yearbook-photos/<path>

### GitHub токен истекает 09.07.2026

### Superadmin: odintcovsergey@gmail.com
### OkeyBook owner: okeybook18@gmail.com

---

## КАК КЛОНИРОВАТЬ В НОВОМ ЧАТЕ

```
git clone https://odintcovsergey:[ТОКЕН]@github.com/odintcovsergey/yearbook-v2.git ~/yearbook-v2
cd ~/yearbook-v2
git config user.email "deploy@yearbook.app"
git config user.name "Deploy Bot"
git remote set-url origin https://odintcovsergey:[ТОКЕН]@github.com/odintcovsergey/yearbook-v2.git
```

---

## АРХИТЕКТУРА ХРАНИЛИЩА

```
yearbook-photos/
  album_id/portrait/ts_filename.jpg        ← WebP, сжатые
  album_id/group/ts_filename.jpg           ← WebP
  album_id/teacher/ts_filename.jpg         ← WebP
  album_id/personal/child_id/filename      ← оригинал (не WebP!)
  album_id/originals/ts_filename           ← оригиналы фотографа для вёрстки
  album_id/delivery/ts_filename            ← готовые файлы от OkeyBook (6 мес)
  tenants/tenant_id/logo.webp              ← логотипы (Supabase Storage)
```

**Правило filename:** хранится оригинальное имя (DSC08521.jpg)

---

## СТАТУС РАЗРАБОТКИ — ВСЁ СДЕЛАНО ✓

### Мультиаренда (этапы 1-4)
- Tenants, users, sessions, invitations, audit_log
- /super (superadmin), /app (owner/manager/viewer)
- JWT-авторизация, приглашения, управление командой
- Брендинг (логотип, цвет, тексты на странице родителя)
- Legacy /admin УДАЛЁН

### CRM
- Клиенты, контакты, воронка Kanban (DnD), задачи
- Создание альбома из сделки, настройка этапов

### Личный разворот (personal spread)
- Настройки: тумблер + цена (С доплатой/Без цены) + мин/макс
- Шаг на странице родителя после текста
- Прогресс-бар при загрузке, предупреждение при низком разрешении
- Вкладка «Разворот» в AlbumDetailModal с превью и ZIP скачиванием
- Доплаты объединены с обложкой во вкладке «Доплаты»
- CSV: колонки Личный_1..Личный_12

### Workflow производства
- Статусы: active → ready → submitted → in_production → delivered
- Авто-переход в ready когда все ученики завершили
- Кнопка «Завершить досрочно» и «Передать в OkeyBook»
- Загрузка оригиналов (до 50 МБ) через presigned URL
- Загрузка delivery файлов с прогресс-баром (presigned URL, обход Vercel 4.5 МБ)
- Delivery файлы доступны 6 месяцев

### Партнёрский кабинет
- `/app` toolbar: кнопка «📸 Партнёры» для сотрудников OkeyBook (isMainTenant)
- Список партнёров — каждый сотрудник видит только назначенных ему
- Дашборд партнёра: карточки альбомов с прогрессом, клик → AlbumDetailModal
- AlbumDetailModal открывается с view_as → показывает реальные данные партнёра
- canEdit=true → менеджер может делать всё то же что и партнёр
- Кнопка «+ Партнёр» → CreatePartnerModal (полная форма с владельцем)
- При создании из кабинета OkeyBook → создающий автоматически назначается менеджером

### /super — Панель суперадмина
- Вкладки: Арендаторы / Партнёры / Очередь работ
- Партнёры: 3-колоночный вид (фотографы → альбомы → детали)
- Очередь работ: новые → взять в работу → загрузить delivery файл
- В карточке тенанта: назначение «Ответственного менеджера OkeyBook»
- `assigned_manager_id` в tenants + индекс

### Аналитика
- График динамики отбора по дням в AlbumDetailModal → Обзор

### Скрипт автоотбора (.exe/.command)
- Отложен — сделать после сезона

---

## ТАБЛИЦЫ БД

### Мультиаренда
- tenants (+assigned_manager_id — ответственный менеджер OkeyBook)
- users, sessions, invitations, audit_log

### Основные (с tenant_id)
- albums (+workflow_status, workflow_submitted_at, workflow_taken_at,
  workflow_delivered_at, workflow_assigned_to, workflow_notes)
- albums (+personal_spread_enabled, personal_spread_price,
  personal_spread_min, personal_spread_max)
- album_templates, quotes, referral_leads

### CRM
- clients, contacts, deal_stages, deals, tasks

### Личный разворот
- personal_spread_photos (child_id, album_id, tenant_id, storage_path,
  filename, width, height, file_size, sort_order)

### Workflow производства
- original_photos (album_id, tenant_id, storage_path, filename, file_size)
- delivery_files (album_id, tenant_id, storage_path, filename, file_size,
  label, expires_at, downloaded_at)
- okeybook_pricing (tenant_id NULL=глобальный, template_title,
  price_per_student, price_personal_spread, price_teacher, price_print_soft)

### Layout engine (продукт B, фаза 0)
- template_sets (tenant_id NULL=глобальный, name, print_type, page/spread sizes,
  bleed_mm, is_global, cover_preview_url)
- spread_templates (template_set_id, name, type, is_spread, width/height_mm,
  background_url, placeholders jsonb, rules jsonb, sort_order)
- album_layouts (album_id, template_set_id, config_type, print_type,
  spreads jsonb, status — один активный layout на альбом)

### Без изменений
- children, teachers, responsible_parents, photos, selections и т.д.

---

## РОЛИ

- superadmin — владелец системы, видит всё
- owner (main) — владелец OkeyBook, создаёт партнёров, видит всех назначенных
- manager (main) — менеджер OkeyBook, видит только своих партнёров
- owner/manager/viewer (partner tenant) — фотографы, работают в своём тенанте

---

## ВАЖНЫЕ ФАЙЛЫ

### API
- app/api/auth/route.ts — login/refresh/logout/me
- app/api/super/route.ts — операции superadmin + owner/manager OkeyBook
- app/api/tenant/route.ts — основное API кабинета (GET + POST)
  - view_as param: superadmin и сотрудники main тенанта могут смотреть партнёров
  - assertAlbumAccess принимает tenantIdOverride (tid)
  - partners_list — список партнёров для OkeyBook staff
  - isMainTenant в dashboard response
- app/api/crm/route.ts — CRM
- app/api/upload/route.ts — загрузка фото организатором → YC (WebP)
- app/api/upload-url/route.ts — presigned URL для прямой загрузки в YC
- app/api/personal-spread/route.ts — загрузка/удаление фото разворота (родитель)
- app/api/spread-download/route.ts — серверный ZIP для скачивания разворота
- app/api/workflow/route.ts — статусы, оригиналы, delivery файлы
- app/api/child/route.ts — родители (НЕ ТРОГАТЬ)

### Страницы
- app/login/page.tsx
- app/super/page.tsx — суперадмин (+ Партнёры + Очередь работ)
- app/app/page.tsx — основной кабинет (~7000+ строк)
  - PartnersDashboardModal — просмотр партнёров
  - CreatePartnerModal — создание партнёра (полная форма)
  - ProductionTab — вкладка производства в AlbumDetailModal
  - SpreadTab — вкладка личного разворота
- app/app/CRMModal.tsx — CRM
- app/[token]/page.tsx — родитель (осторожно при правках)
  - Шаги: 1(портрет)→2(обложка)→4(группа)→3(текст)→7(разворот)→5(контакт)→6(итого)

### Библиотеки
- lib/auth.ts — авторизация
- lib/supabase.ts — Supabase клиент + getPhotoUrl/getThumbUrl
- lib/storage.ts — YC клиент + ycUpload/ycDelete/getYcUploadUrl(presigned)

---

## ПАТТЕРНЫ КОДА

### Авторизация
```typescript
const auth = await requireAuth(req, ['owner', 'manager', 'viewer'])
if (isAuthError(auth)) return auth
```

### view_as (просмотр партнёра)
```typescript
// В GET /api/tenant — tid уже учитывает view_as
const viewAsTenantId = req.nextUrl.searchParams.get('view_as')
const tid = (canViewAs && viewAsTenantId) ? viewAsTenantId : auth.tenantId

// В AlbumDetailModal — apiVA добавляет ?view_as=... ко всем запросам
const apiVA = (url, opts?) => viewAsTenantId ? api(url + '&view_as=...') : api(url)
```

### Загрузка больших файлов (>4.5 МБ) — presigned URL
```
1. POST /api/upload-url → { upload_url, storage_path }
2. PUT upload_url (XHR с onprogress)
3. POST /api/workflow action=register_delivery (регистрация в БД)
```

### URL фото — ТОЛЬКО через хелперы
```typescript
import { getPhotoUrl, getThumbUrl } from '@/lib/supabase'
```

---

## МИГРАЦИИ (все применены в Supabase)

- migration_v3_multitenant.sql
- crm-migration.sql
- personal-spread-migration.sql
- workflow-migration.sql (включая assigned_manager_id в tenants)
- 2026-05-XX-template-sets.sql (фаза 0 layout engine — таблицы template_sets,
  spread_templates, album_layouts)

---

## ЧТО ДАЛЬШЕ

### Июнь 2026 — переезд с Vercel
1. Выбрать хостинг: Timeweb (~800 ₽/мес) или YC App Platform
2. Написать Dockerfile для Next.js
3. GitHub Actions: push → build → deploy
4. Перенести env-переменные
5. DNS okeybook.ru → новый сервер
6. Удалить ADMIN_SECRET из Vercel

### Июль 2026 — партнёрская программа
- Биллинг: расчёт стоимости вёрстки (цена за ученика × тариф)
- SMS/Email напоминания родителям
- Онбординг для новых фотографов

### Скрипт автоотбора (отложен)
- .exe для Windows, .command для Mac
- Читает CSV, копирует оригиналы по именам файлов

---

## ПРОДУКТ B — БРАУЗЕРНЫЙ ДВИЖОК АВТОВЁРСТКИ (ФАЗА 0 В РАБОТЕ)

### Стратегия

Продукт B — браузерный редактор автовёрстки альбомов, конкурент fottobot.online. Партнёр-ориентированная архитектура (мультиаренда), но функциональность копируем массово. В долгосрочной перспективе — биллинг за вёрстку.

### Контекст работы

- **Ветка:** `feature/layout-engine`. Прод (`main`) не трогаем.
- **Дата старта:** 04.05.2026
- **Текущий статус:** фаза 0 в работе

### Документы

- `docs/phase-0-spec.md` — детальное ТЗ фазы 0 (13 разделов: цель, БД, форматы JSON, парсер IDML, алгоритм построения, API, UI, критерии приёмки, план коммитов).
- `docs/templates/idml-recon-notes.md` — разведка шаблона «Плотные Мастер Белый», решения по 13 расхождениям с ТЗ, правила парсера, архитектурное решение по общему разделу (§9).
- `docs/templates/Плотные Мастер Белый.idml` — главный референсный шаблон. 39 master-страниц. **НЕ закоммичен в репо** (большой файл), у Сергея локально.
- `docs/templates/комплектации_краткое_описание.md` — продуктовая спецификация комплектаций. **НЕ закоммичен в репо.**

### Сделанные коммиты фазы 0

- **0.1** (`e454b73`) — миграция БД: 3 таблицы `template_sets`, `spread_templates`, `album_layouts`. Применена в Supabase.
- **0.1.5** (`3ad2991`) — разведка IDML, `idml-recon-notes.md`.
- **0.2.1** (`0fdf190`) — типы парсера, скелет `parse.ts` с чтением Preferences.
- **0.2.2** (`2fc8087`) — `extract-geometry.ts`, `xml-utils.ts` shared helpers, `parse-test.ts` sanity-проверка. 17/17 проходит.

### Что осталось до конца фазы 0

- **0.3** — `extract-styles.ts` (стили текста из `Stories/`/`Resources/Styles.xml`)
- **0.4** — CLI `scripts/convert-idml.ts` + первый импорт `ParsedTemplateSet` в Supabase
- **0.5** — API: `GET /api/layout?action=template_sets`, `template_set_detail`
- **0.6** — POST `import_idml` (multipart, только superadmin)
- **0.7-0.8** — UI просмотрщик `/super/templates` (Konva canvas, миниатюры, подписи плейсхолдеров)
- **0.9-0.11** — `lib/album-builder/`: алгоритм `buildAlbum` для 7 комплектаций. Учительский раздел (8 кейсов по `subjects.length`: 0/1-4/5-8/9/10-12/13-16/17-24). Ученические по `config_type`. Soft-intro (`S-Intro`). Общий раздел НЕ генерируется (см. recon-notes §9).
- **0.12** — юнит-тесты `album-builder` (Vitest, добавляется в этом коммите).
- **0.13** — API `build_album_layout`
- **0.14** — обновление контекста до v37

### Архитектурное решение про общий раздел

Партнёры верстают по-разному, поэтому в `buildAlbum` общие развороты НЕ генерируем. Партнёр добавляет J-* развороты вручную через UI редактора фаз 2-4.

### Параллельные задачи дизайнеру (вне фазы 0)

- Добавить `L-2`/`L-3`/`L-4` и `N-4`/`N-6`/`N-9` для адаптивных сеток Лайт/Мини
- Метки `introText`/`introPhoto` в `S-Intro`/`S-Intro-Old`
- Опциональные `-Right` версии для `J-Quarter`/`J-Half`/`J-Collage`

### Что НЕ входит в фазу 0 (запланировано на фазы 1+)

- Smart-fill автоподбор фото (фаза 1)
- Браузерный редактор макетов (фаза 2)
- PDF-экспорт (фаза 3)
- Библиотека шаблонов с UI загрузки (фаза 4)
- Биллинг и Wfolio-интеграция (фаза 5)

### Стек продукта B (поверх существующего)

- `fast-xml-parser` (новая dependency)
- `jszip` (уже был)
- `tsx` (новая devDependency для запуска TS-скриптов)
- `konva` + `react-konva` (планируется в 0.6 для просмотрщика)
- Vitest (планируется в 0.12 для тестов)

### Правила работы парсера (§6 из idml-recon-notes.md)

- Координаты от leftmost `Page.ItemTransform` (не `-spread_width/2` хардкодом)
- Lowercase нормализация всех label'ов с сохранением `original_label`
- `_left`/`_right` суффиксы при коллизиях в двухстраничных мастерах
- `rotation_deg = atan2(b, a) * 180/π`
- Фреймы без `<Label>` пропускаются как декоративные (агрегированный warning)
- `required = false` всегда (продуктовая логика в `album-builder`)
- `tsconfig` `target=es5` без `downlevelIteration` — избегать spread в `Math.min/max` и for-of по итераторам Map

### Связь с основным приложением

- Общая БД Supabase (таблицы `template_sets`, `spread_templates`, `album_layouts` добавлены аддитивно)
- Общая JWT-авторизация (пользователи, тенанты)
- `/super/templates` — новая вкладка в существующей панели superadmin
- `/api/layout` — новый endpoint, рядом с `/api/super`, `/api/tenant`
- `lib/idml-converter/` — изолированная папка, ниоткуда из routes пока не импортируется

---

## ПРАВИЛА РАБОТЫ

1. **Родительские страницы НЕ ТРОГАТЬ деструктивно** — /[token], /teacher, /ref
2. **URL фото ТОЛЬКО через getPhotoUrl/getThumbUrl**
3. **Загрузка портретов/групп → WebP; личный разворот → оригинальный формат**
4. **filename в БД = оригинальное имя** (DSC08521.jpg)
5. **Большие файлы (>4.5 МБ) → presigned URL** через /api/upload-url
6. **После каждого подэтапа — обновлять контекст-файл**
7. **Продукт B изолирован в feature/layout-engine** — main не трогаем, изменения аддитивные

---

## НЮАНСЫ СИСТЕМЫ

### Ссылки по токенам
- `/<token>` — страница родителя
- `/teacher/<token>` — ответственный родитель
- `/ref/<token>` — реферальная форма

### Шаги родителя (StepId: 1|2|3|4|5|6|7)
1: Портрет → 2: Обложка → 4: Фото с друзьями → 3: Текст → 7: Личный разворот → 5: Контакт → 6: Итого

### Workflow статусы альбома
active → ready (авто когда все завершили) → submitted → in_production → delivered

### isMainTenant
- Определяется по tenant.slug === 'main'
- Возвращается в dashboard response
- Показывает кнопку «📸 Партнёры» в /app toolbar

### view_as
- Только superadmin и сотрудники main тенанта
- Передаётся как ?view_as=<tenant_id> в GET запросах
- AlbumDetailModal использует apiVA() вместо api()
- assertAlbumAccess принимает tenantIdOverride=tid

---

## СБРОС ТЕСТОВОГО УЧЕНИКА (SQL)

```sql
update children set submitted_at = null, started_at = null where full_name = 'Имя';
delete from drafts where child_id = (select id from children where full_name = 'Имя');
delete from selections where child_id = (select id from children where full_name = 'Имя');
delete from parent_contacts where child_id = (select id from children where full_name = 'Имя');
delete from cover_selections where child_id = (select id from children where full_name = 'Имя');
delete from photo_locks where child_id = (select id from children where full_name = 'Имя');
delete from student_texts where child_id = (select id from children where full_name = 'Имя');
delete from quote_selections where child_id = (select id from children where full_name = 'Имя');
delete from personal_spread_photos where child_id = (select id from children where full_name = 'Имя');
```

## ПЕРЕВОД СТАРЫХ АЛЬБОМОВ В ready (SQL)

```sql
-- Альбомы где все ученики завершили но статус ещё active
UPDATE albums a SET workflow_status = 'ready'
WHERE workflow_status = 'active'
  AND NOT EXISTS (SELECT 1 FROM children c WHERE c.album_id = a.id AND c.submitted_at IS NULL)
  AND EXISTS (SELECT 1 FROM children c WHERE c.album_id = a.id);
```
