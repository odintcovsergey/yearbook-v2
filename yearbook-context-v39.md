# КОНТЕКСТ ДЛЯ ПРОДОЛЖЕНИЯ РАБОТЫ
# Система отбора фотографий для выпускных альбомов → платформа для школьных фотографов
# Версия: v39
# Обновлено: 07.05.2026
#
# СТАТУС: АКТИВНЫЙ СЕЗОН (май 2026)
# Workflow производства готов. Партнёрский кабинет готов.
# Личный разворот реализован. CRM готов.
# Все фото в Yandex Object Storage.
#
# Параллельно: фаза 0 продукта B (браузерный движок автовёрстки) в ветке
# feature/layout-engine. См. раздел «ПРОДУКТ B» ниже.
# Что нового в v39: фаза 0 продукта B завершена. 49 коммитов на ветке
# feature/layout-engine, все смерджены в main. POST /api/layout?action=build_album_test
# + UI Build Test работают на проде. Семь комплектаций × два print_type = 14
# рабочих режимов автовёрстки. 58 smoke-сцен зелёные.

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
  background_url, placeholders jsonb, rules jsonb, sort_order,
  applies_to_configs text[], page_role text, slot_capacity jsonb,
  is_fallback bool, mirror_for_soft bool, audit_notes text)
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
- template-sets-migration.sql (фаза 0.1 — таблицы template_sets,
  spread_templates, album_layouts)
- template-sets-slug-migration.sql (фаза 0.3.5 — slug, facing_pages,
  page_binding в template_sets)
- template-sets-audit-fields-migration.sql (фаза 0.8.6.1 — 6 колонок
  семантических тегов в spread_templates + 2 индекса)
- template-sets-audit-data-update.sql (фаза 0.8.6.2 — 39 UPDATE-запросов
  заполняющих семантические теги для всех мастеров okeybook-default)
- 2026-05-07-page-role-left-right.sql (0.10a.1)
- 2026-05-07-page-role-grid-left-right.sql (0.10b.1)
- 2026-05-07-default-for-configs.sql (0.11.1.5 — разделение compat и default)
- 2026-05-07-page-role-overflow-right.sql (0.11.2)
- 2026-05-07-default-individual-e-max.sql (0.11.3)
- 2026-05-07-default-individual-extras.sql (0.11.3)

---

## ЧТО ДАЛЬШЕ

### Июнь 2026 — переезд с Vercel
1. Выбрать хостинг: Timeweb (~800 ₽/мес) или YC App Platform
2. Написать Dockerfile для Next.js
3. GitHub Actions: push → build → deploy
4. Перенести env-переменные
5. DNS okeybook.ru → новый сервер

### Июль 2026 — партнёрская программа
- Биллинг: расчёт стоимости вёрстки (цена за ученика × тариф)
- SMS/Email напоминания родителям
- Онбординг для новых фотографов

### Продукт B — фаза 1 (Smart-fill)
Можно начинать в любой момент. Фундамент фазы 0 готов:
- buildAlbum работает на синтетических данных
- 7 комплектаций × 2 print_type
- 58 smoke-сцен зелёные
- POST /api/layout?action=build_album_test для тестирования

Smart-fill будет:
- Брать реальный альбом из БД (children, teachers, common photos)
- Конвертировать портреты из YC в URL для buildAlbum
- Сохранять результат в album_layouts
- UI кнопку «Собрать автоматически» в /app

### Скрипт автоотбора (отложен)
- .exe для Windows, .command для Mac
- Читает CSV, копирует оригиналы по именам файлов

### Tech debt (отложено)
- Удалить legacy x-admin-secret из lib/auth.ts:174 после миграции фронта на JWT (0.15)
- Vitest unit-tests с моками (после фазы 1)

---

## ПРОДУКТ B — БРАУЗЕРНЫЙ ДВИЖОК АВТОВЁРСТКИ (ФАЗА 0 ЗАВЕРШЕНА ✅)

### Стратегия

Продукт B — браузерный редактор автовёрстки альбомов, конкурент fottobot.online. Партнёр-ориентированная архитектура (мультиаренда), но функциональность копируем массово. В долгосрочной перспективе — биллинг за вёрстку.

### Статус: фаза 0 завершена 07.05.2026

49 коммитов на ветке `feature/layout-engine` смерджены в main. Запущен в проде на `yearbook-v2.vercel.app`. Никаких регрессий по существующему функционалу.

### Что работает в проде

**Семь комплектаций × два print_type = 14 рабочих режимов автовёрстки:**
- standard / universal / maximum / medium / light / mini / individual
- Layflat (твёрдые листы) и soft (мягкие листы) для каждой
- Mini-soft — особый случай (одностраничная учительская F-*-R, без S-Intro)

**Особенности реализации:**
- Adaptive grid алгоритм для Лайт/Мини: автоматически выбирает мастер с минимальной достаточной ёмкостью; готов к появлению адаптивных мастеров L-2/L-3/L-4 и N-4/N-6/N-9 без изменений в коде
- Overflow-логика для классов 25+ учеников (Лайт 25-32, Мини 25-36)
- Семантические теги мастеров: `page_role`, `applies_to_configs` (для UI редактора), `default_for_configs` (для автовыбора), `slot_capacity`
- Lowercase нормализация label'ов везде (idml-recon §6.4)
- 58 smoke-сцен на реальной БД зелёные

**UI Build Test:**
- `/super/templates/<id>` — страница детали template_set с панелью «Build Test»
- POST `/api/layout?action=build_album_test` — endpoint для синтетических альбомов
- Возвращает JSON-результат (spreads + warnings + summary)
- Только superadmin

### Документы

- `docs/phase-0-spec.md` — детальное ТЗ фазы 0 (актуален в основных частях, но был расширен по ходу работы)
- `docs/templates/idml-recon-notes.md` — разведка шаблона «Плотные Мастер Белый», правила парсера
- `docs/templates/master-cleanup-tz.md` — накопительный TZ на доработку библиотеки мастеров (актуален, активно расширялся в 0.10b/0.11)
- `docs/templates/Плотные Мастер Белый.idml` — главный референсный шаблон. **НЕ закоммичен в репо.**

### Все коммиты фазы 0 (49 коммитов)

Резюме по подэтапам (от старого к новому):

- **0.1-0.8** — миграции, IDML парсер, CLI импорт, GET /api/layout, POST /api/layout?action=import_idml, UI list+upload, UI detail с Konva canvas
- **0.8.6** — семантические теги для 39 мастеров (3 коммита)
- **0.9** — фундамент `lib/album-builder/`
- **0.10a** — engine + Стандарт/Универсал/Максимум (миграция БД page_role student_left/right)
- **0.10b** — учительский раздел layflat (F+G), Медиум, миграция БД student_grid_left/right (4 коммита)
- **0.11.0** — soft-печать инфраструктура + S-Intro
- **0.11.1** — Лайт и Мини ≤24 + adaptive_grid алгоритм
- **0.11.1.5** — рефакторинг: разделение `applies_to_configs` (UI совместимость) и `default_for_configs` (автовыбор)
- **0.11.2** — overflow Лайт (25-32) и Мини (25-36) + page_role student_overflow_right
- **0.11.3** — Индивидуальный (E-Max + E-Ind + сетка-миниатюр)
- **0.11.4** — Mini-soft (одностраничная учительская F-*-R, без S-Intro)
- **0.13** — POST /api/layout?action=build_album_test + UI Build Test (фикс credentials в fetch)
- **0.14** — обновление контекста v38 → v39 (этот коммит)

(0.12 — Vitest unit tests — пропущен; smoke-скрипта 58/58 достаточно для текущего этапа.)

### Артефакты в БД (на 07.05.2026)

**`template_sets`:** 1 запись `slug=okeybook-default`

**`spread_templates`:** 39 записей с полным набором семантических тегов:
- `page_role` (15 значений: student/student_left/right/student_grid_left/right/student_overflow/student_overflow_right/student_last/teacher_left/teacher_right/common/intro/cover/student_grid)
- `applies_to_configs` text[] (для UI редактора)
- `default_for_configs` text[] (для автовыбора в buildAlbum)
- `slot_capacity` jsonb (students/teachers/head_teacher/photos_full/half/quarter/sixth/collage/friend)
- `is_fallback`, `mirror_for_soft`, `audit_notes`

### Миграции БД фазы 0

Файлы в `migrations/`:
- `2026-05-07-page-role-left-right.sql` (0.10a.1)
- `2026-05-07-page-role-grid-left-right.sql` (0.10b.1)
- `2026-05-07-default-for-configs.sql` (0.11.1.5)
- `2026-05-07-page-role-overflow-right.sql` (0.11.2)
- `2026-05-07-default-individual-e-max.sql` (0.11.3)
- `2026-05-07-default-individual-extras.sql` (0.11.3)

Плюс ранние миграции из `template-sets-*-migration.sql` в корне репо.

### lib/album-builder/ структура

```
lib/album-builder/
  types.ts                — Student/Subject/HeadTeacher/AlbumInput/Config/SpreadInstance/etc
  scenarios.ts            — SCENARIOS, TEACHER_SECTION_LAYFLAT, INTRO_SECTION_S_INTRO,
                            TEACHER_SECTION_MINI_SOFT, ScenarioDef, StudentSection,
                            TeacherSection, TeacherSpreadVariant, MiniSoftTeacherSection,
                            IndividualStudentSection, AdaptiveGridOverflow, LastSpread
  utils.ts                — chunk, assertExhaustive, pushWarning
  find-master.ts          — findMaster, matchesBaseFilters, pickPreferringHint
  build.ts                — buildAlbum + ~10 sub-функций по комплектациям
  load-template-set.ts    — helper для загрузки template_set из Supabase
  index.ts                — публичные экспорты
```

### Что НЕ входит в фазу 0 (запланировано на фазы 1+)

- **Фаза 1** — Smart-fill автоподбор фото из реальных загруженных в YC
- **Фаза 2** — Браузерный редактор макетов (Konva-based)
- **Фаза 3** — PDF-экспорт для печати
- **Фаза 4** — Расширение библиотеки шаблонов с UI загрузки
- **Фаза 5** — Биллинг и Wfolio-интеграция

### Что отложено в master-cleanup-tz (для дизайнера)

- §A1, A2 — адаптивные мастера L-2/L-3/L-4, N-4/N-6/N-9 (P0, перед запуском партнёрам)
- §A3 — эстетическая балансировка остатков (P0)
- §A4 — автоподбор J-* для одинокого Стандарта (P0)
- §A5 — D-Medium-Last-3-Centered (P1, отложено)
- §B1 — разделение E-Student-Standard на Left+Right (P1)
- §C1 — второй учительский разворот для 25+ предметников (P1, отложено)

### Накопленные уроки фазы 0 (для следующих сессий)

В процессе работы над фазой 0 встретилось несколько архитектурных нюансов которые легко забыть:

1. **Lowercase нормализация label'ов** — все ключи в data объекте и аргументы hasPlaceholder в lowercase. Парсер при импорте IDML тоже понижает регистр (idml-recon §6.4).

2. **Подмена applies_to_config в runtime** — в SCENARIOS заглушки фильтров, в build.ts везде `{ ...filter, applies_to_config: ctx.config.config_type }`.

3. **default_for_configs vs applies_to_configs** — разные семантики: первое для автовыбора в buildAlbum, второе для ручного выбора в UI редактора (фаза 2-4).

4. **expected_name_hint как priority hint** — в find-master.ts при нескольких равно подходящих кандидатах выигрывает тот чьё имя совпадает с hint. Расширено в 0.11.3.

5. **page_role расширяется по необходимости** — добавлено `student_overflow_right` для разрешения L-Overflow-Row vs L-Overflow-Row-Right (0.11.2). Будут и другие расширения по мере развития.

6. **Smoke на реальной БД ловит расхождения которые unit-тесты не поймают** — несколько раз баги обнаруживались только при прогоне через реальные данные (boolean head_teacher, photos_full дискриминация и т.д.).

### Связь с основным приложением

- Общая БД Supabase (таблицы `template_sets`, `spread_templates`, `album_layouts` добавлены аддитивно)
- Общая JWT-авторизация
- `/super/templates` — вкладка в существующей панели superadmin
- `/api/layout` — POST endpoint с двумя actions: `import_idml` (multipart) и `build_album_test` (JSON)
- `lib/album-builder/` — изолированная папка
- `lib/idml-converter/` — изолированная папка

### Что дальше — фазы 1+

Фаза 1 — Smart-fill — будет принимать на вход реальный альбом из БД и заполнять им мастера. Ключевые задачи:
- Чтение детей/учителей/common photos из существующих таблиц
- Конвертация портретов из YC в URL для buildAlbum
- Сохранение результата в `album_layouts`
- UI для запуска smart-fill в `/app` (партнёрский кабинет)

Можно начинать в любой момент — фундамент фазы 0 готов.

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
