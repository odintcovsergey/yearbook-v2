# КОНТЕКСТ ДЛЯ ПРОДОЛЖЕНИЯ РАБОТЫ
# Система отбора фотографий для выпускных альбомов → платформа для школьных фотографов
# Версия: v42
# Обновлено: 08.05.2026
#
# СТАТУС: АКТИВНЫЙ СЕЗОН (май 2026)
# Workflow производства готов. Партнёрский кабинет готов.
# Личный разворот реализован. CRM готов.
# Все фото в Yandex Object Storage.
#
# Параллельно: продукт B (движок автовёрстки) — фазы 0 и 0.5 закрыты ПОЛНОСТЬЮ.
# Builder работает только с Preset из БД, у альбомов и учеников есть UI
# выбора/override пресета. Готов к запуску фазы 1 (Smart-fill).
#
# Что нового в v42 относительно v41:
# - Фаза 0.5.6 закрыта (UI пресета у альбома + UI override per-child).
# - 0.5.6.1 — UI пресета у альбома: 2 dropdown'а (Комплектация + Тип печати)
#   в AlbumFormModal, отображение в Обзоре и AlbumCard, API presets_list
#   + расширение create_album/update_album принимают preset_slug.
# - 0.5.6.1 fix — sentinel «— выберите —» для существующих альбомов
#   с config_preset_id=NULL (защита от случайного назначения «Стандарт»).
# - 0.5.6.2 — UI override per-child: dropdown в expanded row карточки
#   ученика (15 опций: sentinel «Использовать пресет альбома» + 14 пресетов),
#   фиолетовый чип в строке таблицы если override установлен.
#   API update_child_preset action.
# - Фаза 0.5 закрыта целиком (все 7 подэтапов из спеки).
# - НЕ сделано: ничего обязательного. Опционально — расширение smoke до 65+ сцен.
#
# Подробности фазы 0.5:
#   - docs/phase-0.5-spec.md (v4, финальная спека)
#   - docs/internal/0.5.{3.1,3.2,3.3,3.4,6.1,6.2,7}-instructions.md

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
  - presets_list (action GET) — список 14 глобальных config_presets для UI dropdown'ов
  - create_album / update_album принимают preset_slug; helpers
    resolvePresetBySlug + getDefaultTemplateSetId для маппинга slug → FK
    и auto-resolve template_set_id (единственный okeybook-default)
  - dashboard response включает config_preset_slug + config_preset_name для альбомов
  - children action возвращает config_preset_id/slug/name через join config_presets
  - update_child_preset action — назначить/снять override config_preset_id
    у ребёнка (assertChildAccess)
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
  - AlbumFormModal — секция «Пресет вёрстки» с 2 dropdown'ами
    (Комплектация + Тип печати), sentinel «— выберите —» для существующих
    альбомов с config_preset_id=NULL
  - AlbumDetailModal → Обзор показывает блок «Пресет вёрстки»
  - AlbumCard показывает имя пресета или ⚠ если не задан
  - ChildPresetSelect (module-scope, function declaration для hoisting'а) —
    dropdown override пресета per-child в expanded row карточки ученика;
    фиолетовый чип в строке таблицы если override установлен
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
- 2026-05-08-album-config.sql (1.0 — config_type/print_type в albums; ВРЕМЕННО, удалено в 0.5.1)
- 2026-05-08-fix-e-student-photos-friend.sql (0.15 — fix slot_capacity для E-Student мастеров)
- 2026-05-08-config-presets.sql (0.5.1 — таблица config_presets, FK в albums и children, удаление albums.config_type)
- 2026-05-08-config-presets-seed.sql (0.5.2 — seed 14 глобальных пресетов: 7 комплектаций × 2 print_type)
- 2026-05-08-config-presets-add-grid-base-pages.sql (0.5.3.1 — поле
  student_section.grid_base_pages в JSONB: light=4, mini=2, остальные=null;
  individual.first_spread_content.friend_photos.max: 3 → 4)

---

## ЧТО ДАЛЬШЕ

### Продукт B — фаза 0.5 (refactor builder под пресеты + UI) — ЗАВЕРШЕНА ✅

После фазы 0 builder работал с 7 жёстко-зашитыми комплектациями
(config_type enum в коде). Это было негибко — партнёр не мог создать
свой пресет без правки кода.

**Что сделано в фазе 0.5:** builder работает только с Preset из БД,
у альбомов и учеников есть UI для выбора/override пресета. Старые
scenarios.ts и build.ts удалены.

**Архитектурный путь:** Г1 — прямое переписывание под Preset, без
адаптера (выбран в начале фазы).

**Сделано:**
- 0.5.1 — миграция БД (config_presets + FK в albums и children)
- 0.5.2 — TypeScript типы Preset/PresetConfig + seed 14 глобальных пресетов
- 0.15 (bonus) — fix slot_capacity.photos_friend у E-Student мастеров
- 0.5.3.1 — скелет build-from-preset.ts + intro/teacher + миграция grid_base_pages
- 0.5.3.2 — buildSinglePagePerStudent (Стандарт+Универсал) + buildSpreadPerStudent
  (Максимум+Индивидуальный) с capacity-pool алгоритмом
- 0.5.3.3 — buildGridStudents (Медиум fixed + Лайт/Мини adaptive) + thumbnails
- 0.5.3.4 — финальная замена: удалены build.ts старый и scenarios.ts,
  buildAlbum принимает Preset, smoke 58/58 на новом builder'е,
  endpoint /api/layout и UI Build Test обновлены под preset_slug
- 0.5.6.1 — UI пресета у альбома: 2 dropdown'а в AlbumFormModal
  (Комплектация + Тип печати), отображение в Обзоре и AlbumCard,
  API presets_list + расширение create_album/update_album
- 0.5.6.1 fix — sentinel «— выберите —» для существующих альбомов
  с config_preset_id=NULL (защита от случайного назначения)
- 0.5.6.2 — UI override per-child: dropdown в expanded row карточки
  ученика (sentinel «Использовать пресет альбома» + 14 пресетов),
  фиолетовый чип в строке таблицы если override установлен.
  API update_child_preset action

**Архитектурное замечание про update_album и config_preset_id:**
поле `albums.print_type` сохраняется как legacy для backward compat —
синхронизируется при сохранении альбома (sync с print_type выбранного
пресета). UI продолжает читать его в некоторых местах. Когда builder
будет вызываться из реальных альбомов в фазе 1, основным источником
правды будет config_preset_id → preset.print_type.

**Не сделано (опциональное):**
- Расширение smoke до 65+ сцен с edge-cases для grid (опционально)
- master-cleanup-tz §B3 — двухстраничный E-Student-Default для Универсала
  (решение b отложено в master-cleanup-tz, P2)

Подробности: `docs/phase-0.5-spec.md` (v4) +
`docs/internal/0.5.{3.1,3.2,3.3,3.4,6.1,6.2,7}-instructions.md`.

### Продукт B — фаза 1 (Smart-fill) — после 0.5

Когда фаза 0.5 закроется:
- Брать реальный альбом из БД (children, teachers, common photos)
- Конвертировать портреты из YC в URL для buildAlbum
- Сохранять результат в album_layouts
- UI кнопку «Собрать автоматически» в /app
- Bulk-тестирование на множестве альбомов (для отладки алгоритма)

Подробности: `docs/phase-1-spec.md`.

### Roadmap до запуска (после фаз 0.5 + 1)

| Фаза | Что | Объём |
|------|-----|-------|
| ✅ 0 | Builder + endpoint + Build Test | Сделано |
| ✅ 0.5 | Refactor под пресеты в БД + UI пресетов (альбом + per-child) | Сделано |
| 1 | Smart-fill: реальные данные → buildAlbum | ~12 ч |
| 2 | Canvas-рендер с реальными фото | ~15-20 ч |
| 3 | PDF-экспорт для печати | ~15-20 ч |
| 4 | Drag-n-drop редактор макетов | ~30-40 ч |
| 5 | Админский тулинг (управление template_set'ами) | ~10-15 ч |
| 6 | Биллинг + партнёрский онбординг | ~20 ч |

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

### Скрипт автоотбора (отложен)
- .exe для Windows, .command для Mac
- Читает CSV, копирует оригиналы по именам файлов

### Tech debt (отложено)
- Удалить legacy x-admin-secret из lib/auth.ts:174 после миграции фронта на JWT (отдельный подэтап)
- Vitest unit-tests с моками (после фазы 1)
- Master-cleanup-tz §F — виртуальные страницы (1 spread мастер вместо Left+Right) — после фазы 1+


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

### lib/album-builder/ структура (после 0.5.3.4)

```
lib/album-builder/
  types.ts                — публичные типы builder'а: AlbumInput, Preset, PresetConfig,
                            StudentSectionConfig, TeacherSectionConfig, IntroSectionConfig,
                            CoverSectionConfig, BaseLayoutMode, FirstSpreadContent,
                            FriendPhotosContent, ThumbnailsSectionConfig, SpreadInstance,
                            SpreadTemplate, TemplateSet, MasterFilter, ConfigType,
                            PageRole, SlotCapacity, Photo, Student, HeadTeacher, Subject,
                            CommonPhotos, Placeholder, BuildResult, BuildWarning, etc.
  utils.ts                — chunk, assertExhaustive, pushWarning
  find-master.ts          — findMaster, matchesBaseFilters, pickPreferringHint
  build-from-preset.ts    — buildAlbum (единственный) + sub-функции:
                            * buildSinglePagePerStudent (Стандарт + Универсал)
                            * buildSpreadPerStudent (Максимум + Индивидуальный)
                            * buildGridStudents → диспетчер по grid_base_pages:
                              - buildFixedGridStudents (Медиум, semantic last_spread)
                              - buildAdaptiveGridStudents (Лайт/Мини, semantic overflow)
                                → buildAdaptiveGridStudentsCore (общий core)
                            * buildThumbnailsSection (через core, для Индивидуального)
                            * buildIntroSection
                            * buildTeacherSectionTwoPage (двухстраничная F+G)
                            * buildTeacherSectionOnePage (одностраничная F-*-R, Mini-soft)
                            * helpers: pickAdaptiveGrid, pickAdaptiveGridMaxCapacity,
                              buildOverflowRow, buildGridStudentData, studentSinglePageData,
                              buildTeacherLeftData, buildTeacherRightData,
                              pickRightCommonPhotoMaster, presetSlugToConfigType,
                              hasPlaceholder, hasPlaceholderPrefix
                            * локальные const: TEACHER_TWO_PAGE_VARIANTS,
                              TEACHER_ONE_PAGE_VARIANTS, VALID_CONFIG_TYPES
  load-template-set.ts    — loadTemplateSet, loadPresetBySlug
  index.ts                — публичные экспорты (без legacy SCENARIOS/ScenarioDef/Config)

  build.ts                — УДАЛЁН в 0.5.3.4 (был 1241 строк → переехал в build-from-preset.ts)
  scenarios.ts            — УДАЛЁН в 0.5.3.4 (был 806 строк → конфигурация в БД config_presets)
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

Можно начинать в любой момент — фундамент фазы 0 + 0.5.3 готов.

---

## ПРОДУКТ B — ФАЗА 0.5 ЗАВЕРШЕНА ✅

### Контекст

После фазы 0 в коде была захардкожена структура `SCENARIOS` с 7
комплектациями. Чтобы партнёр мог создавать свои пресеты — нужно было
перенести структуру в БД и дать UI для выбора пресета. Фаза 0.5 решила
эту задачу: 0.5.3 — рефакторинг builder под Preset (путь Г1), 0.5.6 —
UI пресетов на двух уровнях (альбом + per-child override).

### Что появилось

**БД (0.5.1-0.5.2):**
- Таблица `config_presets` (tenant_id NULL=глобальный, slug, name,
  print_type, config jsonb, is_template) — описывает пресет
- 14 глобальных пресетов в seed (7 комплектаций × 2 print_type)
- `albums.config_preset_id` (FK) — пресет альбома
- `albums.template_set_id` (FK) — auto-resolve через единственный okeybook-default
- `children.config_preset_id` (FK NULL=использовать альбомный) — per-child override
- `student_section.grid_base_pages` (jsonb) — толщина для adaptive_grid

**Builder (0.5.3):**
- `lib/album-builder/build-from-preset.ts` — единственный builder, читает Preset
- `loadPresetBySlug` helper в `lib/album-builder/load-template-set.ts`
- Удалены: build.ts (старый, 1241 строк), scenarios.ts (806 строк)

**API (0.5.3 + 0.5.6):**
- `/api/layout?action=build_album_test` принимает preset_slug
- `/api/tenant?action=presets_list` — 14 глобальных пресетов
- `/api/tenant?action=create_album` / `update_album` принимают preset_slug
- `/api/tenant?action=children` возвращает config_preset_slug + name через join
- `/api/tenant?action=update_child_preset` — назначить/снять override
- helpers `resolvePresetBySlug`, `getDefaultTemplateSetId` в tenant route

**UI (0.5.6):**
- AlbumFormModal: секция «Пресет вёрстки» с 2 dropdown'ами
  (Комплектация + Тип печати), sentinel «— выберите —» защищает
  существующие альбомы от случайного назначения «Стандарт»
- AlbumDetailModal → Обзор: блок «Пресет вёрстки» (имя + slug или ⚠)
- AlbumCard: имя пресета или ⚠ если не задан
- ChildPresetSelect (module-scope component): dropdown в expanded row
  карточки ученика, sentinel «Использовать пресет альбома (...)» +
  14 опций, кнопка «Применить» + индикатор «Не сохранено»
- Фиолетовый чип в строке таблицы рядом с именем ученика если override

### Архитектурные принципы

- **Богатая БД, простая логика.** Структура config в JSONB готова под все
  будущие фичи (additional_spreads, financial_mode, common_section,
  cover_section.cover_type, personal_spread_addon), но builder в фазе 0.5
  читает только подмножество полей.
- **Семантический discovery в builder'е.** Builder ищет мастера через
  `page_role` + `default_for_configs` + `slot_capacity` без декларативных
  filter'ов:
  - **last_spread (Медиум)** — `findMaster({page_role: 'student_last',
    slot_capacity_min: {students: remainder}})`. Если найден → используем,
    иначе fallback на обычный grid с null'ами + warning.
  - **overflow (Лайт/Мини)** — `page_role='student_overflow'` для row,
    `student_overflow_right` для редкой ветки grid_plus_row (Лайт 31-32).
  - **capacity-pool (Максимум/Индивидуальный)** — фильтр+сортировка кандидатов
    `student_right` по `slot_capacity.photos_friend` asc; per-student выбор
    минимально-достаточного. Для Maximum pool=[E-Max-Right]; для Individual
    pool=[E-Ind-Right-3, E-Max-Right] — единый код, разное поведение.
- **Унификация функций.** 5 ученических функций из старого scenarios.ts → 3:
  - `buildSinglePagePerStudent` (single_page_per_student): развилка по
    `friend_photos === null` (Стандарт двухстраничный vs Универсал
    одностраничный alternate)
  - `buildSpreadPerStudent` (spread_per_student): capacity-pool для правого
    мастера (Максимум + Индивидуальный)
  - `buildGridStudents` (grid_multiple_students): диспетчер по
    `grid_base_pages` — null=fixed Медиум, число=adaptive Лайт/Мини;
    последний переиспользует core-функцию для thumbnails Индивидуального

### Решение по Универсалу

Универсал использует одностраничные E-Student-Left/Right alternate
(путь a). Решение b — двухстраничный E-Student-Default первым с
fallback — отложено в `master-cleanup-tz.md §B3` как улучшение для
будущей итерации (~1.5-2 ч, P2).

### Главный критерий безрегрессионного рефакторинга

Smoke 58/58 на новом builder'е (тот же набор сцен что работал на старом
builder'е через Config). Это означает что **поведение нового builder'а
полностью эквивалентно старому** на всех 58 сценариях.

### UX-нюансы 0.5.6

- **AlbumCard / Обзор:** показывают «⚠ пресет не выбран» для существующих
  альбомов с config_preset_id=NULL. Партнёр видит проблему и должен
  выбрать пресет перед запуском Smart-fill (фаза 1).
- **AlbumFormModal sentinel:** для edit-режима альбомов с NULL пресетом
  dropdown'ы стартуют с «— выберите —», submit без выбора оставляет
  пресет NULL (не назначает «Стандарт» автоматически).
- **ChildPresetSelect sentinel:** «Использовать пресет альбома (Стандарт)»
  — текст в скобках динамически отражает альбомный пресет (или «не задан»).
- **albums.print_type legacy:** поле сохраняется для backward compat
  (sync с print_type выбранного пресета). Когда builder будет вызываться
  из реальных альбомов в фазе 1, основным источником будет config_preset_id.

### Что отложено

- Расширение smoke до 65+ сцен с edge-cases для grid (опционально)
- master-cleanup-tz §B3 — двухстраничный мастер для Универсала (P2)

### Связь с текущим состоянием

После 0.5.6.2 фаза 0.5 закрыта целиком. Технически разблокирована
**фаза 1 (Smart-fill)** — у альбомов и учеников могут быть пресеты,
builder работает с реальными данными.

---

## ПРАВИЛА РАБОТЫ

1. **Родительские страницы НЕ ТРОГАТЬ деструктивно** — /[token], /teacher, /ref
2. **URL фото ТОЛЬКО через getPhotoUrl/getThumbUrl**
3. **Загрузка портретов/групп → WebP; личный разворот → оригинальный формат**
4. **filename в БД = оригинальное имя** (DSC08521.jpg)
5. **Большие файлы (>4.5 МБ) → presigned URL** через /api/upload-url
6. **После каждого подэтапа — обновлять контекст-файл**
7. **Продукт B полностью смержен в main** — фазы 0 и 0.5.3 закрыты, всё в main; новые подэтапы (фаза 1+) тоже идут в main аддитивно

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
