# КОНТЕКСТ ДЛЯ ПРОДОЛЖЕНИЯ РАБОТЫ
# Система отбора фотографий для выпускных альбомов → платформа для школьных фотографов
# Версия: v45
# Обновлено: 10.05.2026
#
# СТАТУС: АКТИВНЫЙ СЕЗОН (май 2026)
# Workflow производства готов. Партнёрский кабинет готов.
# Личный разворот реализован. CRM готов.
# Все фото в Yandex Object Storage.
#
# Параллельно: продукт B (движок автовёрстки) — фазы 0, 0.5, 1, 2, 3
# закрыты ПОЛНОСТЬЮ. PDF-экспорт работает в проде:
# партнёр в Обзоре альбома выбирает профиль из dropdown'а
# («Печать (типография)» / «Превью для клиента» / per-student-stub)
# и жмёт «Экспортировать» → endpoint собирает AlbumExportInput,
# через pdf-lib + sharp генерирует PDF с реальными шрифтами
# (Noto Serif/Open Sans/Slimamif) и фото в 300 dpi из оригиналов
# фотографа → upload в YC + INSERT в album_exports + audit_log →
# UI открывает PDF в новой вкладке + добавляет в историю экспортов.
# Готов к запуску фазы 3.A (per-student) или фазы 4 (cover-engine).
#
# Что нового в v45 относительно v44:
# - Фаза 3 (PDF-экспорт) закрыта целиком (16 коммитов: 3.0 → 3.10).
# - 3.0 — fix(URL): очистка ?album= при закрытии модала альбома.
# - 3.1 + 3.1.1 — миграции БД: export_profiles (16 колонок, 3 seed-
#   профиля okeybook-print/preview/per-student-stub), album_exports
#   (12 колонок), template_sets.bleed_mm=5 для okeybook-default.
# - 3.2 + 3.2.1 — фундамент lib/pdf-export: pdf-lib^1.17 + sharp^0.34
#   (уже был с фазы 0) + 5 TTF шрифтов в public/fonts/ (NotoSerif
#   Regular/Bold ~500 KB, OpenSans Regular/Italic ~130 KB, Slimamif-
#   Medium ~280 KB; суммарно ~1.5 МБ). 4 модуля: types.ts (~175 строк),
#   units.ts (~140 строк), font-loader.ts (~155 строк), index.ts.
# - 3.3 — pipeline.ts (~335 строк): orchestrator renderAllSpreads,
#   renderSpread с разрезом двухстраничных мастеров на 2 PDF page'а,
#   drawPlaceholder диспатчер по типу, поддержка rotation в PDF.
# - 3.4 — photo-embed.ts (~280 строк): lookup оригинала по filename
#   через urlToFilename мапу + originals[] из original_photos →
#   sharp resample (cover crop, mozjpeg, EXIF auto-rotation) → embedJpg →
#   drawImage. Поддержка is_circle (учительские аватарки) через
#   pdf-lib graphics state operators (Bezier-аппроксимация круга
#   4 кубическими кривыми, magic constant 0.5522847498). Graceful
#   degradation: на любой ошибке fetch/sharp/embed — серый
#   прямоугольник + warning.
# - 3.5 — text-shaping.ts (~290 строк): word-by-word line wrap,
#   auto_fit с уменьшением font_size до min_size_pt (step 0.5pt),
#   vertical_align top/middle/bottom, все 4 align (left/center/right/
#   justify), text_overflow warning + truncate.
# - 3.6 — 3 endpoint'а в /api/layout/route.ts (~519 строк):
#   GET list_export_profiles (для UI dropdown'а), GET list_album_exports
#   (история последних 10 с download_url), POST export (главный
#   endpoint фазы 3 — собирает AlbumExportInput, вызывает
#   exportAlbumPdf, upload в YC, INSERT в album_exports, audit_log).
#   Лимит 80 spreads. 501 для pages_mode!=all_common (per-student =
#   фаза 3.A) и format!=pdf (jpg-pages = 3.X).
# - 3.7 — ExportPanel.tsx (~330 строк) в Обзоре альбома: dropdown
#   профилей, описание выбранного, кнопка «Экспортировать», прогресс/
#   success/error блоки, история последних 10 с download-кнопками.
# - 3.7.1 — fix: albums.name → albums.title (правильное имя колонки
#   в schema.sql). Bug нашёл Сергей в DevTools при первой попытке
#   экспорта — endpoint возвращал 404 'album not found'.
# - 3.7.2 — fix: npm install @pdf-lib/fontkit + pdfDoc.registerFontkit
#   перед embedFont. pdf-lib умеет embed только стандартных PDF
#   шрифтов (Helvetica/TimesRoman) из коробки — для custom TTF нужен
#   peerDep fontkit.
# - 3.8 — реальные шрифты в Konva-редакторе: 5 @font-face блоков в
#   app/globals.css для NotoSerif/OpenSans/Slimamif из public/fonts/,
#   AlbumSpreadCanvas.tsx — fontFamily из placeholder.font_family +
#   fontStyle bold/normal вместо Arial fallback. Те же файлы что
#   embed'ятся в PDF — визуал в редакторе и в финальном PDF идентичен.
# - 3.9.1+3.9.2 — fix: subset=false для embedFont (subset=true ломал
#   кириллицу в pdf-lib + fontkit — 'Егоров Тимур' → 'Е е ин') +
#   первая попытка rotation положения baseline для вертикального
#   текста учительской роли (rotation_deg=-90 в БД).
# - 3.9.2.1 — ❌ ошибочная инверсия знака rotation IDML→PDF
#   (уверенность что Y-down → Y-up flips signs). Откачено в 3.9.2.2.
# - 3.9.2.2 — fix: знак rotation остаётся как есть (idml_rotation =
#   pdf_rotation, потому что pdf-lib drawText интерпретирует rotation
#   относительно baseline в PDF Y-up sense), правильная baseline
#   (box.x + descent / box.y + box.height для idml=-90), правильное
#   line_step (+line_height по x для CW 90°).
# - 3.9.2.3 — fix: max_width_pt и max_height_pt в drawTextShaped
#   зависят от rotation. Для rotated text длинная сторона placeholder'а
#   становится текстовой шириной (по которой wrap), короткая —
#   высотой. Без этого 'Учитель физики' wrap'ался на 53pt узкой
#   стороны вместо 369pt длинной.
# - 3.9.3 — feat(spread_export): миграция export_profiles + флаг
#   spread_export boolean DEFAULT false. okeybook-client-preview
#   получил spread_export=true (превью клиенту разворотами как в
#   реальной книге); okeybook-print остался false (типография
#   стандартно ожидает pages). Логика в pipeline.ts: если
#   spread_export=true И is_spread=true → одна широкая страница
#   spread_width × page_height, иначе 2 узких страницы.
# - 3.10 — этот контекст-файл, фаза 3 закрыта.
#
# 16 коммитов на main: 34fe2e8 (3.0) → ... → c22cf37 (3.9.2.2) →
# 94abbd6 (3.9.3) → cb16377 (3.9.2.3) → текущий 3.10.
#
# Подробности фазы 3:
#   - docs/phase-3-spec.md (~700 строк — финальная спека после двух
#     раундов уточнений; требует обновления в финал-помарку как
#     «PHASE 3 CLOSED» — оставлено для следующего раза при
#     необходимости)
#   - 4 миграции в migrations/2026-05-10-*.sql (export-profiles,
#     export-profiles-seed, album-exports, okeybook-default-bleed,
#     spread-export). Все применены в Supabase вручную через SQL Editor.
#
# Подробности фазы 2:
#   - docs/phase-2-spec.md (помечена как PHASE 2 CLOSED)
#   - docs/internal/2.{1,2,3,3.1,4,5,6.1,6.1.1,6.2,6.2.1,6.3,6.3.1,
#     6.4,6.4.1,6.5,6.5.1,7,8}-instructions.md (18 файлов)

---

## BACKLOG ПОСЛЕ ФАЗЫ 3

Накопленные задачи. Не блокируют работу — PDF-экспорт в проде работает,
партнёры могут пользоваться. Делать когда придёт время.

### КРИТИЧНО (визуальные баги в PDF)

- **Позиционирование вертикального текста (rotation_deg=-90)** —
  единственный placeholder в БД с rotation, это `headteacherrole` во
  всех F-Head-* мастерах (роль учителя — «учитель физики»,
  «классный руководитель»). После 4 коммитов (3.9.2, 3.9.2.1,
  3.9.2.2, 3.9.2.3) текст рисуется в правильной ОРИЕНТАЦИИ (top of
  letters facing right, reading top-to-bottom), на одной строке (wrap
  по длинной стороне работает). НО **позиция placeholder'а
  относительно фото** не идеальна — текст накладывается на фото или
  смещён от ожидаемого места. Это либо нюанс **IDML rotation pivot**
  (вокруг какой точки вращается фрейм при IDML rendering), либо
  парсер IDML (фаза 0) извлекает координаты ROTATED frame'а в
  непреобразованном виде. Возможные направления решения:
  1) Изучить IDML spec для `Properties/PathGeometry` ROTATED фреймов —
     там координаты path могут быть в local coordinate space до
     ItemTransform, а не в spread-coordinate space как у нас сейчас.
  2) Применить IDML rotation matrix к bounding box rotated фрейма
     при парсинге, чтобы получить визуальный bbox в spread coords.
  3) Добавить `pivot_offset_mm` в Placeholder тип и заполнить из
     IDML — pdf-lib и Konva смогут передавать pivot в rotation.

  Проявляется во ВСЕХ заказах (не только в «тест»). Сергей подтвердил
  09.05.2026 — фиксить позже когда после сезона вернёмся к фазе 0
  парсера.

### Технический долг (от фазы 2)

- **CORS на YC bucket** — настроить `Access-Control-Allow-Origin`
  на бакете `yearbook-photos`. Тогда можно вернуть
  `crossOrigin='anonymous'` в `useImage` хуке `AlbumSpreadCanvas`,
  что разблокирует canvas-PNG-экспорт через `stage.toDataURL()`.
- **Unify `refreshAccessToken+api`** в `lib/auth-client.ts` — сейчас
  дублируется в `app/app/page.tsx` и `app/app/album/[id]/layout/page.tsx`.
  Вынести когда появится 3-й consumer.
- **SQL-cleanup мусорных `photos` записей** для smoke-альбомов —
  битые URL'ы (`storage_path` указывает на отсутствующие файлы в YC).
  Накопились за время разработки. Не критично, но косметика.

### Технический долг (от фазы 3)

- **PDF приватность** — сейчас bucket public-read, security through
  obscurity через UUID в имени файла. Безопаснее: переход на private
  ACL для PDF + presigned download URL (1-2 часа). Это требует
  отдельной `ycUploadPrivate` функции и изменения логики в
  album_exports.download_url (не хранить, генерировать каждый раз).
- **Async pipeline + polling** — для альбомов >80 разворотов sync
  endpoint упрётся в Vercel timeout (60 сек free / 300 сек pro).
  Нужен async exports queue (например через background function
  Vercel или Inngest). Endpoint возвращает export_id мгновенно,
  фронт polling'ует /api/layout?action=export_status&id=X.
- **Параллелизм photo-embed** — сейчас последовательная обработка
  фото (await per placeholder) для экономии RAM. Семафор с
  concurrency=3-5 ускорит экспорт большого альбома в 2-3 раза.
- **Custom font weights** — в IDML парсер извлекает font_weight
  'medium'/'light' (Slimamif Medium), но мы загружаем только
  Regular/Bold/Italic + Slimamif Medium. Если в новых мастерах
  появятся NotoSerif-Medium, OpenSans-SemiBold и т.д. — нужно
  расширить FONT_FILES в font-loader.ts и загрузить TTF.
- **Character-level wrap** для экстремально длинных слов которые
  не влезают в max_width даже на min_size_pt. Сейчас вылезают за
  рамку. Не критично для русского текста (имена/цитаты).
- **Точное определение «последней строки параграфа» для justify** —
  сейчас не justify'им последнюю строку в массиве lines (это
  визуально верно для одного параграфа на placeholder'е). Если
  будет multi-paragraph — нужно различать.

### UX-улучшения (от фазы 2)

- **Open in new tab** для редактора — сейчас навигация через
  `router.push`. New tab помог бы держать Обзор + редактор рядом, но
  требует решения вопроса с beforeunload protection.
- **Восстановление активной вкладки модала** при deep link — сейчас
  всегда «Обзор». Можно передавать `?album=UUID&tab=students`.
- **Кастомный модал confirm** вместо нативного `window.confirm` —
  для брендинга OkeyBook.
- **Touch-events в редакторе** — пока drag работает только мышью.
- **Иконка камеры** в пустом photo-слоте — косметика для UX.
- **Виртуализация PhotoPalette** для альбомов 1000+ фото.

### UX-улучшения (от фазы 3)

- **Скачать готовое из истории** — сейчас кликаем «Скачать» и
  открывается в новой вкладке. UX: хочется чтобы было «скачать»
  именно как download (Content-Disposition: attachment), а не view.
  Требует прокси через Next.js handler (force download header).
- **Удаление старых экспортов** — sweep cron для записей старше 90
  дней (`expires_at < now()` → ycDelete + DELETE row). Сейчас
  expires_at заполняется но никем не используется.
- **Прогресс-бар при экспорте** — сейчас просто spinner. Можно
  показывать «Обрабатываю фото 5/30» через server-sent events
  или polling с server-side progress tracking.
- **Warnings в UI** — сейчас счётчик `⚠ N предупреждений` без
  возможности развернуть. Можно добавить раскрывающийся блок с
  деталями (no_original / text_overflow / image_decode_failed).

### Функциональность (от фазы 2)

- **Optimistic UI для save** — сейчас status «● Не сохранено» →
  «Сохраняется…» → «✓ Сохранено». Partner видит loading state.
- **Undo/Redo (Ctrl+Z)** в редакторе.
- **Contextual menu на placeholder'е** (правый клик → «Очистить
  слот», «Заменить на»).
- **Click-to-navigate-to-spread** при клике на миниатюру в палитре.
- **Conflict resolution multi-editor**.

### Известные баги (для дебага позже)

- **Альбом «тест» (54bf48ee-5501-4c7f-a66a-1e8f8d2fc20e)** в
  превью разворотов показывает только ЛЕВУЮ часть учительского
  разворота (известный баг из v44). После анализа SQL во время фазы
  3 видно: smart-fill положил `F-Head-SmallGrid` вместо двухстраничного
  (`F-Head-WithPhoto+G-Teachers-Small` или подобного). Нужно изучить
  логику smart-fill find-master для F-Head в случае альбома с одним
  head_teacher (без классического разворота — может быть выбор
  fallback на одностраничный mirror_for_soft).

### Архитектура

- **Расширение smoke до 65+ scenes** в `scripts/smoke-album-builder.ts`.
- **Чистка `x-admin-secret` legacy** в `lib/auth.ts:174` и
  `app/api/auth/route.ts:259`.

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
  album_id/exports/ts_slug.pdf             ← PDF-экспорты (90 дней)
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

### Smart-fill (фаза 1) ✅
- Endpoint POST `/api/layout?action=build_album` — собирает layout
  из реальных данных альбома, сохраняет в `album_layouts` через upsert
- Endpoint GET `/api/layout?action=album_layout` — загрузка
  существующего layout для UI persisted state
- Helper `lib/smart-fill/build-album-input.ts` — БД → AlbumInput
- UI кнопка «Собрать автоматически» / «Пересобрать» в Обзоре альбома
  с tooltip и disabled state когда пресет не выбран
- Result-блок с категоризированными warning'ами (3 уровня:
  blocking/degraded/info × 2 источника: builder/smart_fill)
- Скопировать JSON для отладки/Canvas-рендера
- Persisted state — при открытии модала layout грузится автоматически
- Флаг `teachers.is_head_teacher` (partial unique index, radio-pattern
  в update_teacher, UI чекбокс)
- Превью фото учителей в `/app` (96×96 + подпись имени файла)

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
- album_layouts (album_id, template_set_id, config_preset_id FK,
  spreads jsonb, warnings jsonb, status — один активный layout на
  альбом, unique index на album_id; миграция P3 в фазе 1.1 удалила
  legacy config_type/print_type)

### PDF-экспорт (продукт B, фаза 3)
- export_profiles (tenant_id NULL=глобальный, slug, name, is_default,
  purpose, format, quality, include_bleed, color_mode, dpi,
  jpeg_quality, filename_template, pages_mode, target_size_mb,
  enabled, spread_export). 3 глобальных seed-профиля:
  okeybook-print (typography 300dpi bleed pages — для типографии),
  okeybook-client-preview (preview 150dpi spread — для клиента),
  okeybook-per-student (stub для фазы 3.A, endpoint вернёт 501).
- album_exports (album_id, tenant_id, profile_id FK, storage_path,
  filename, file_size, page_count, layout_snapshot jsonb,
  warnings jsonb, created_by, created_at, expires_at).
  Файлы лежат в YC bucket: album_id/exports/<unix_ts>_<slug>.pdf.
  expires_at = created_at + 90 days (sweep cron — backlog).

### Без изменений
- children, responsible_parents, photos, selections и т.д.
- teachers (+ is_head_teacher BOOLEAN NOT NULL DEFAULT false,
  partial unique index `teachers_one_head_per_album` где
  is_head_teacher=true)

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
- app/api/layout/route.ts — продукт B endpoints
  - GET: action=template_sets, template_set_detail, album_layout
    (фаза 1.4), list_export_profiles (фаза 3.6),
    list_album_exports (фаза 3.6, view_as)
  - POST: action=build_album_test (фаза 0), build_album (фаза 1.3),
    save_album_layout (фаза 2.5), import_idml (фаза 0),
    export (фаза 3.6 — главный endpoint PDF-генерации,
    собирает AlbumExportInput, exportAlbumPdf, ycUpload,
    INSERT album_exports, audit_log; лимит 80 spreads;
    501 для pages_mode!=all_common или format!=pdf)
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

### Компоненты редактора (фаза 2)
- app/app/_components/AlbumSpreadCanvas.tsx — Konva-рендер spread'а
  (preview/edit mode), DropZone overlay для drag-and-drop в edit.
  С фазы 3.8: реальный fontFamily из placeholder вместо Arial
- app/app/_components/LayoutPreviewStrip.tsx — миниатюры разворотов
  в Обзоре + кнопка «Открыть редактор»
- app/app/_components/PhotoPalette.tsx — правая колонка редактора
  с миниатюрами, поиском, бейджами использования
- app/app/_components/SaveIndicator.tsx — статус сохранения в header
  редактора
- app/app/album/[id]/layout/page.tsx — fullscreen редактор layout
  альбома (DndContext, auto-save, beforeunload, swap)

### Компоненты PDF-экспорта (фаза 3)
- app/app/_components/ExportPanel.tsx (~330 строк) — UI экспорта
  в Обзоре альбома: dropdown профилей, описание выбранного,
  кнопка «Экспортировать», прогресс/success/error блоки, история
  последних 10 с download-кнопками. viewAsTenantId как prop для
  view_as поддержки
- app/globals.css — 5 @font-face блоков для NotoSerif/OpenSans/
  Slimamif из public/fonts/ (фаза 3.8)
- public/fonts/ — 5 TTF файлов (~1.5 МБ суммарно):
  NotoSerif-Regular/Bold (Google Fonts SIL OFL),
  OpenSans-Regular/Italic (Apache 2.0/OFL),
  Slimamif-Medium (FFC, free for commercial)

### Библиотеки
- lib/auth.ts — авторизация
- lib/supabase.ts — Supabase клиент + getPhotoUrl/getThumbUrl
- lib/storage.ts — YC клиент + ycUpload/ycDelete/getYcUploadUrl(presigned)
- lib/smart-fill/build-album-input.ts — БД → AlbumInput (фаза 1.2)
- lib/smart-fill/index.ts — публичный API smart-fill
- lib/album-builder/load-template-set.ts — `loadTemplateSet`,
  `loadPresetBySlug`, `loadPresetById` (последний добавлен в 1.3)
- lib/pdf-export/ (фаза 3) — PDF-генератор:
  - types.ts (~175 строк) — ExportProfile, AlbumExportInput
    с originals/urlToFilename, OriginalPhoto, PdfWarning (7 кодов),
    ExportResult, PageBoxes. spread_export: boolean добавлен в 3.9.3
  - units.ts (~140 строк) — PT_PER_MM, mmToPt, mmToPixels,
    computePageBoxes, flipY (Y-down → Y-up), placeholderToPdfBox,
    hexToRgb01
  - font-loader.ts (~155 строк) — pdfDoc.registerFontkit(fontkit) +
    embedFont 5 TTF из public/fonts/ с subset:false (3.9.1) +
    FontRegistry.resolve case-insensitive
  - pipeline.ts (~340 строк) — renderAllSpreads главный orchestrator,
    renderSpread с разрезом на 2 страницы или spread mode (3.9.3),
    drawPlaceholder диспатчер photo/text, RenderContext с pdfDoc/
    fontRegistry/pageBoxes/warnings/profile/photoCtx
  - photo-embed.ts (~280 строк) — embedPhotoOnPage с graceful
    degradation, fetchPhotoSource с lookup originals[] →
    sharp resample (cover crop, EXIF rotation, mozjpeg) →
    embedJpg → drawImage. Поддержка is_circle через
    pdf-lib graphics state operators (Bezier 4 кубические кривые,
    magic 0.5522847498)
  - text-shaping.ts (~390 строк) — drawTextShaped с rotation-aware
    max_width_pt и position baseline (3.9.2.2 + 3.9.2.3),
    shapeText с auto_fit (step 0.5pt до min_size_pt) + wrapWords,
    drawLine с justify (pdf-lib drawText rotate degrees(rotation_deg)
    БЕЗ инверсии знака — это и было главным уроком rotation-фиксов)
  - index.ts — exportAlbumPdf entry point + re-exports

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
- migrations/2026-05-09-teachers-head-flag.sql (фаза 1.0 — флаг
  is_head_teacher + partial unique + бэкфил)
- migrations/2026-05-09-album-layouts-preset-fk.sql (фаза 1.1 —
  P3 schema: + config_preset_id FK + warnings jsonb,
  - config_type, - print_type)
- migrations/2026-05-10-export-profiles.sql (фаза 3.1 — таблица
  export_profiles 16 колонок + 2 индекса; 3 seed-профиля
  okeybook-print/preview/per-student-stub в отдельной seed-миграции)
- migrations/2026-05-10-export-profiles-seed.sql (фаза 3.1)
- migrations/2026-05-10-album-exports.sql (фаза 3.1 — таблица
  album_exports 12 колонок + 4 индекса включая PK)
- migrations/2026-05-10-okeybook-default-bleed.sql (фаза 3.1 —
  template_sets.bleed_mm=5 для okeybook-default)
- migrations/2026-05-10-spread-export.sql (фаза 3.9.3 —
  ALTER export_profiles + spread_export boolean DEFAULT false;
  UPDATE okeybook-client-preview SET spread_export=true)

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

### Фаза 3 — PDF-экспорт layout'ов ✅ (закрыта 10.05.2026)

Партнёр в Обзоре альбома видит блок «Экспорт PDF» с dropdown'ом
профилей. Жмёт «Экспортировать» → сервер за 30-60 сек собирает PDF
из template_set + layout + оригиналов фотографа → upload в YC →
PDF открывается в новой вкладке + добавляется в историю экспортов.

3 seed-профиля:
- okeybook-print (typography 300dpi с bleed, постранично)
- okeybook-client-preview (preview 150dpi без bleed, разворотами)
- okeybook-per-student (stub для фазы 3.A — endpoint вернёт 501)

Реализовано:
- ✅ Серверный pipeline pdf-lib + sharp (lib/pdf-export/, ~1500 строк)
- ✅ Реальные шрифты NotoSerif/OpenSans/Slimamif из public/fonts/
  (те же что в Konva @font-face — визуал редактора и PDF идентичны)
- ✅ TrimBox/BleedBox для типографии (5мм по периметру)
- ✅ Lookup оригинала фотографа по filename → sharp resample 300dpi
  (без потери разрешения через уменьшенный preview)
- ✅ Графически правильный photo-clip для круглых аватарок
  (Bezier-аппроксимация magic 0.5522847498)
- ✅ Text shaping: word wrap, auto_fit, vertical_align, все 4 align
- ✅ Rotation для вертикального текста (учительский headteacherrole)
- ✅ Spread mode (3.9.3) — двухстраничные мастера одной широкой
  страницей для preview-профиля (как InDesign Spreads checkbox)
- ✅ История экспортов с download-кнопками (последние 10)
- ✅ Audit log при каждом экспорте

Что в backlog:
- Позиционирование вертикального текста относительно фото —
  работающий первый approximation, точный pivot rotation для
  IDML фреймов нужно дорабатывать в парсере (фаза 0)
- Per-student режим (фаза 3.A) — endpoint stub есть, выдаёт 501
- JPG-pages формат (фаза 3.X — для Фабрика Фотокниг style)
- Async pipeline + polling (для альбомов >80 разворотов)
- PDF приватность (private ACL + presigned URL вместо public-read)

### Скрипт автоотбора (отложен)
- .exe для Windows, .command для Mac
- Читает CSV, копирует оригиналы по именам файлов

---

## ПРОДУКТ B — БРАУЗЕРНЫЙ ДВИЖОК АВТОВЁРСТКИ (ФАЗЫ 0, 0.5, 1, 2 И 3 ЗАВЕРШЕНЫ ✅)

### Фаза 3 — PDF-экспорт (закрыта 10.05.2026)

Партнёр в Обзоре альбома экспортирует layout в PDF одной кнопкой.
Серверный pipeline pdf-lib + sharp (lib/pdf-export/, ~1500 строк
в 7 модулях) генерирует PDF за 30-60 сек на альбом 9-11 разворотов.
Реальные шрифты embed'ятся из public/fonts/ (те же 5 TTF что в
Konva @font-face — визуал редактора и финального PDF идентичны).
Фото берутся из оригиналов фотографа (lookup по filename), sharp
делает resample к dpi профиля. История последних 10 экспортов с
download-кнопками. spread_export флаг профиля переключает
постранично/разворотами.

3 seed-профиля в `export_profiles`:
- `okeybook-print` (typography 300dpi с bleed, postranично) — для типографии
- `okeybook-client-preview` (preview 150dpi без bleed, разворотами) — для клиента
- `okeybook-per-student` (stub) — endpoint выдаёт 501 (фаза 3.A)

**Файлы фазы 3:**
- `lib/pdf-export/{types,units,font-loader,pipeline,photo-embed,text-shaping,index}.ts`
- `app/app/_components/ExportPanel.tsx` (UI экспорта в Обзоре)
- `app/api/layout/route.ts` (3 endpoint'а: list_export_profiles,
  list_album_exports, export)
- `public/fonts/` — 5 TTF (NotoSerif Regular/Bold, OpenSans
  Regular/Italic, Slimamif Medium)
- `app/globals.css` — 5 @font-face блоков

**Артефакты в БД:** таблицы `export_profiles` (16 колонок + spread_export
из 3.9.3), `album_exports` (12 колонок). Файлы лежат в YC
`album_id/exports/<ts>_<slug>.pdf` с expires_at +90 дней.

**Известные баги:** позиционирование вертикального текста
(headteacherrole rotation_deg=-90) относительно фото — нужен фикс
парсера IDML фазы 0 для правильного pivot rotation. Текст рисуется
в правильной ориентации (top-to-bottom, top of letters facing right),
но смещён относительно фото в InDesign-эталоне.

### Фаза 2 — Canvas-редактор (закрыта 09.05.2026)

Партнёр-фотограф теперь имеет полноценный редактор layout альбома:
- Канвас (Konva) рендерит spread в нужных мм-координатах из IDML
- Палитра справа со всеми фото альбома (поиск, фильтры, бейджи)
- Drag-and-drop из палитры в placeholder (через @dnd-kit)
- Swap между placeholder'ами на одном спреде
- Auto-save через 2с после последнего drag'а
- SaveIndicator (✓/●/Saving/⚠) в header'е
- BeforeUnload защита от закрытия с unsaved
- Deep link `?album=UUID` для возврата в нужный альбом
- Confirm-диалог при пересборке если есть несохранённые правки

**Файлы фазы 2:**
- `app/app/_components/AlbumSpreadCanvas.tsx` (Konva-рендер,
  PhotoSlot/TextSlot/DropZone, mode='preview'|'edit')
- `app/app/_components/LayoutPreviewStrip.tsx` (миниатюры в Обзоре
  альбома + кнопка «Открыть редактор»)
- `app/app/_components/PhotoPalette.tsx` (палитра справа в редакторе)
- `app/app/_components/SaveIndicator.tsx` (статус save'а)
- `app/app/album/[id]/layout/page.tsx` (страница редактора)
- `app/api/layout/route.ts` (handleSaveAlbumLayout добавлен)
- `app/api/tenant/route.ts` (action=album_photos добавлен)

**Артефакты в БД:** `album_layouts.has_user_edits boolean DEFAULT false`
(миграция 2.1).

**Что НЕ входит в фазу 2 (бэклог фаз 3+):**
- PDF-экспорт layout'ов (фаза 3)
- Touch-events для drag (mobile)
- Real-time sync для concurrent editors
- Optimistic UI для save

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

### ФАЗА 1 (SMART-FILL) ЗАВЕРШЕНА ✅

#### Стратегия

Smart-fill — мост между формой отбора фото (партнёр + родители) и
builder'ом (продукт B движок). Когда альбом готов (родители заполнили
данные, партнёр загрузил фото), партнёр в кабинете жмёт одну кнопку,
и система собирает первоначальный layout, который потом редактируется
в фазе 2 (canvas).

#### Статус: фаза 1 завершена 09.05.2026

Все 7 подэтапов (1.0, 1.0.2, 1.0.3, 1.1, 1.2, 1.3, 1.4) запушены в
main и задеплоены на Vercel. Никаких регрессий в существующем
функционале.

#### Что работает в проде

**Кнопка «Собрать автоматически»** в `/app` → AlbumDetailModal → Обзор:
- Disabled пока пресет не выбран (с tooltip)
- Busy state «Сборка...» при клике
- Result-блок после успеха: количество разворотов, кнопки «Скопировать JSON» / «Пересобрать»
- 3 секции `<details>` с warning'ами по уровням:
  Критично (красный) / Требует внимания (янтарный) / К сведению (серый)
- Persisted state — при открытии модала existing layout подгружается
  автоматически

**Smart-fill helper** (`lib/smart-fill/build-album-input.ts`):
- Тонкая обёртка БД → `AlbumInput`
- Параллельные SELECT'ы (teachers, children, photo_teachers,
  selections, student_texts)
- Auto-resolve `template_set_id` если NULL
- Smart-fill warnings: `students_no_portrait`,
  `per_child_override_ignored`

**Endpoint `POST /api/layout?action=build_album`**:
- Auth + tenant scoping + view_as
- Валидация: UUID для album_id, проверка что
  `albums.config_preset_id` назначен (400 если NULL)
- smart-fill → loadPresetById → loadTemplateSet → buildAlbum
- Объединение и классификация warnings (level + source)
- Upsert в `album_layouts` с `onConflict: 'album_id'`
  (status сохраняется при UPDATE)
- audit_log: `album_layout.build`

**Endpoint `GET /api/layout?action=album_layout`**:
- Те же права что у POST
- Возвращает `{ layout: null }` если нет записи, иначе полный layout
- Использует join `config_presets(slug, name)` для UI

**Флаг `teachers.is_head_teacher`**:
- Партиальный unique index `teachers_one_head_per_album`
  (только для is_head_teacher=true)
- Бэкфил: первый по `created_at` отмечен как head в каждом альбоме
- UI чекбокс в edit-форме (с radio-pattern в API: при выставлении
  true сначала сбрасывается у других учителей альбома)
- Бейдж «Классный руководитель» по `t.is_head_teacher` (вместо
  старого `idx === 0`)
- Описание (description) показывается только у head'а

**UI учителей расширен**:
- Превью фото 96×96 в readonly-блоке
- Подпись имени файла без расширения (truncate, tooltip с полным)
- Клик → оригинал в новом табе

#### Документы

- `docs/phase-1-spec.md` — финальная спека Smart-fill (после
  обсуждения 17 open questions)
- `docs/internal/1.{0,0.2,0.3,1,2,3,4,5}-instructions.md` — детальные
  инструкции каждого подэтапа

#### Все коммиты фазы 1

| Подэтап | Коммит | Что |
|---|---|---|
| 1.0 | `55a338d` | флаг `teachers.is_head_teacher` + UI checkbox + radio |
| 1.0.2 | `9e70db0` | превью фото учителей |
| 1.0.3 | `5da9fed` | крупнее превью + подпись имени файла |
| 1.1 | `5e39cbe` | миграция album_layouts (preset_id + warnings) |
| 1.2 | `4a91352` | `lib/smart-fill/build-album-input.ts` |
| 1.3 | `8ef19c9` | POST `/api/layout?action=build_album` |
| 1.4 | `572c998` | UI кнопка + result-блок + GET album_layout |
| 1.5 | (этот) | финальный smoke + контекст v43 |

#### Артефакты в БД (на 09.05.2026)

- `teachers`: новая колонка `is_head_teacher` BOOLEAN NOT NULL DEFAULT false,
  partial unique index, бэкфил отмечает первого по created_at
- `album_layouts`: removed `config_type`, `print_type`; added
  `config_preset_id` (FK), `warnings jsonb DEFAULT '[]'::jsonb`
- На дату закрытия фазы 1 в БД 2 layout записи (для smoke-альбомов
  Красночетайская СОШ и Школа 89)

#### Миграции БД фазы 1

- `migrations/2026-05-09-teachers-head-flag.sql` (1.0)
- `migrations/2026-05-09-album-layouts-preset-fk.sql` (1.1)

Применены в Supabase 09.05.2026.

#### Связь с текущим состоянием

Smart-fill готов к боевому использованию. Партнёр в кабинете может:
1. Отметить классного руководителя в учителях
2. Открыть альбом → выбрать пресет вёрстки в форме редактирования
3. Перейти в Обзор → нажать «Собрать автоматически»
4. Получить полный layout с warning'ами для отладки

Это разблокирует **фазу 2 (Canvas-рендер)** — UI редактирования
layout'а в браузере. Spec пока не написана.

#### Что отложено

- **Чистка `x-admin-secret` legacy** (фаза 0.14 спеки) — требует
  решения как создавать первого superadmin'а без legacy hack.
  Текущие use-cases:
  - `lib/auth.ts:174-182` — Legacy режим getAuth()
  - `app/api/auth/route.ts:259` — bootstrap первого superadmin'а
- **E2E smoke на Mini-soft альбоме** — не нашёлся в dev данных.
  Если попадётся в проде — ad-hoc проверим.
- **UI назначения фото учителей в кабинете партнёра** — пока
  только родитель назначает фото через `/teacher/[token]`.
  Партнёр видит превью read-only.

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
