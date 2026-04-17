# КОНТЕКСТ ДЛЯ ПРОДОЛЖЕНИЯ РАБОТЫ
# Система отбора фотографий для выпускных альбомов
# Обновлено: 17.04.2026 (этап 3.4 закрыт — управление командой)

---

## КТО Я И ЧТО МЫ ДЕЛАЕМ

Фотограф/организатор выпускных альбомов.
Веб-система для отбора фотографий родителями вместо Google Диска.
Строим SaaS-платформу с мультиарендой для франшизы/партнёров.

---

## РАБОЧИЙ ДОМЕН

**Основной:** https://yearbook-v2.vercel.app
(album.okeybook.ru через Cloudflare не работает без VPN из РФ — не используем)

---

## СТЕК

- Next.js 14 + TypeScript + Tailwind
- Supabase (PostgreSQL + Storage)
- Vercel (автодеплой из main)
- GitHub: https://github.com/odintcovsergey/yearbook-v2
- Зеркало: https://gitflic.ru/project/odintcovsergey/yearbook-v2
- jose (JWT), sharp (обработка фото), papaparse (CSV)

---

## ДОСТУПЫ

### Vercel env переменные
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
- ADMIN_SECRET (для legacy-авторизации старой админки)
- JWT_SECRET (для новой JWT-авторизации)
- DEFAULT_TENANT_ID: 764929b7-3efe-43e7-aae9-0a9e97e52915
- CACHE_BUST

### Supabase
- https://supabase.com/dashboard

### Cron keep-alive
- cron-job.org → GET /api/admin каждые 12ч (защита от заморозки Supabase)

### GitHub токен
- Истекает 09.07.2026 — обновить заранее

### Superadmin-аккаунт
- Email: odintcovsergey@gmail.com
- ID: 4af9dc20-9fb9-480c-8197-fbf6290a56c9
- Пароль: задан через SQL (PBKDF2), при смене — см. раздел "Смена пароля"

---

## КАК КЛОНИРОВАТЬ В НОВОМ ЧАТЕ

```
git clone https://odintcovsergey:[ТОКЕН]@github.com/odintcovsergey/yearbook-v2.git ~/yearbook-v2
cd ~/yearbook-v2
git config user.email "deploy@yearbook.app"
git config user.name "Deploy Bot"
git remote set-url origin https://odintcovsergey:[ТОКЕН]@github.com/odintcovsergey/yearbook-v2.git
```

Деплой автоматический: push в main = деплой через 1-2 минуты.

---

## СТАТУС МУЛЬТИАРЕНДЫ — ГОТОВО ✓

### Этап 1 — Фундамент (готово)
- migration_v3_multitenant.sql применена в Supabase
- Таблицы: tenants, users, sessions, invitations, audit_log
- tenant_id добавлен в: albums, album_templates, quotes, referral_leads
- Дефолтный tenant: OkeyBook (slug=main)
- lib/auth.ts: двойная авторизация (legacy x-admin-secret + JWT)
- /api/auth: login, refresh, logout, setup, GET (me)
- Superadmin-аккаунт создан

### Этап 2 — Панель superadmin (готово)
- /api/super: tenants, tenant_detail, global_stats (GET)
- /api/super: create_tenant, update_tenant, deactivate_tenant, activate_tenant, delete_tenant (POST)
- /super: UI с глобальной статистикой, списком арендаторов, поиском
- Модалка создания tenant'а: автогенерация slug из кириллицы, генератор пароля
- Модалка деталей tenant'а: view / edit / delete режимы
- Редактирование: название, тариф, срок действия, лимиты, контакты
- Мягкая блокировка (is_active) с визуальной индикацией в таблице
- Удаление: красное предупреждение + ввод slug для подтверждения
- Защита главного tenant'а (slug='main') от блокировки и удаления
- ЯВНОЕ последовательное удаление (sessions → users → invitations →
  audit_log → albums → templates → quotes → leads → tenant).
  CASCADE не использовался, потому что оказался ненадёжным через PostgREST.

### Этап 3.1 — Кабинет owner/manager read-only (готово)
- /api/tenant: dashboard, album, album_stats, children (GET только)
- Все запросы фильтруются по auth.tenantId через JOIN albums!inner(tenant_id)
- assertAlbumAccess — проверка владения альбомом перед доступом
- /app: UI кабинета
  - Сводные карточки: активные альбомы, ученики, процент завершения, новые заявки
  - Вкладки "Актуальные / Архив" с счётчиками
  - Поиск по названию и городу
  - Карточки альбомов с прогресс-баром, предупреждениями о дедлайне
  - Модалка деталей альбома: статистика + таблица учеников со статусами

### Этап 3.2.a — Создание/редактирование/архивирование альбомов (готово)
- /api/tenant GET: templates (свои + глобальные через OR is.null)
- /api/tenant POST: create_album, update_album, archive_album, unarchive_album
- Проверка лимита max_albums перед create и unarchive
- Проверка is_active tenant и plan_expires перед create (понятные ошибки)
- archive удаляет файлы фото из Storage батчами по 100
- Audit log на каждое действие
- /app UI:
  - Кнопка "+ Новый альбом" только для owner/manager (viewer не видит)
  - Шестерёнка на карточке → модалка редактирования
  - AlbumFormModal: единая для create и edit
    - Выбор шаблона (только create) — применяет все настройки
    - Все поля: title, city, year, deadline, cover_mode, cover_price
    - Групповые фото: enabled/min/max/exclusive
    - Текст ученика: enabled/type/max_chars
    - Архивирование с предупреждением об удалении фото
    - Возврат из архива
  - Прогресс-% перенесён inline к прогресс-бару (освободил место для шестерёнки)
  - Empty state с кнопкой "Создать первый альбом"
  - Уведомления об успехе/ошибке

### Изоляция старого /admin (готово)
- Старая админка /api/admin теперь фильтрует всё по tenant_id = MAIN_TENANT_ID
- Защита от подмены ID в delete/update/archive/rename альбомов
- get_leads, update_lead_status, delete_lead также фильтруют
- MAIN_TENANT_ID() helper из env DEFAULT_TENANT_ID
- Тестовые альбомы партнёров больше не засоряют основную админку

### Этап 3.2.b.1 — Управление учениками в /app (готово)
- /api/tenant POST:
  - add_child — одиночное добавление
  - import_children — массовый импорт с автопропуском дубликатов (name+class)
  - reset_child — сброс выбора (selections, photos, text, contacts)
  - delete_child — полное удаление со всем связанным
- assertChildAccess хелпер (через JOIN albums!inner(tenant_id))
- AlbumDetailModal обновлён:
  - Кнопки "+ Добавить" и "Импорт CSV" (только для canEdit)
  - Форма добавления inline — после submit очищает имя, оставляет класс
  - CSVImportBlock: textarea с живым парсингом через papaparse
    - Автоопределение разделителя (tab/comma/semicolon)
    - Пропуск заголовка (ФИО/name/full_name/имя)
    - Превью первых 20 строк
  - Клик по строке раскрывает панель действий: Копировать ссылку / Сбросить / Удалить
  - Быстрая кнопка "Ссылка" в правой колонке
  - Подтверждение через confirm() для destructive действий
  - Виден только для canEdit (viewer видит чистую таблицу)

### Этап 3.2.b.2 — Учителя и ответственный родитель (готово)
- /api/tenant GET:
  - teachers (с assertAlbumAccess)
  - responsible (maybeSingle, с assertAlbumAccess)
- /api/tenant POST:
  - add_teacher (ФИО и должность опциональны — можно заполнить позже)
  - update_teacher (full_name, position, description)
  - delete_teacher (каскадно удаляет photo_teachers)
  - create_responsible (409 если уже есть)
  - update_responsible (full_name, phone)
  - delete_responsible
- Новые хелперы: assertTeacherAccess, assertResponsibleAccess
- AlbumDetailModal переработан:
  - Tab bar: Обзор / Ученики / Учителя / Ответственный
  - Вкладка "Обзор": статистика + быстрые ссылки на другие вкладки
  - Вкладка "Ученики": всё что было в 3.2.b.1
  - Вкладка "Учителя" (TeachersTab):
    - Кнопка "+ Добавить учителя" создаёт пустую карточку
    - Edit-in-place для каждой карточки
    - У первого учителя бейдж "Классный руководитель" + поле "Текст от кл. руководителя"
    - Бейджи статуса (Заполнено / Ожидание)
    - Копирование ссылки учителя
  - Вкладка "Ответственный" (ResponsibleTab):
    - Объясняющий текст роли
    - "Назначить ответственного" если не создан
    - Редактирование ФИО/телефона
    - Копирование ссылки (/responsible/<token>)
    - Бейджи статуса (Заполнил / Ожидает)
    - Удаление с confirm

### Этап 3.3.a — Фото в /app (готово)
- /api/tenant GET:
  - photos — список фото альбома по типу (portrait/group/teacher),
    с thumb_url (настоящий thumb_path если есть, иначе fallback на
    Supabase-трансформацию ?width=400&quality=70) и tags (привязки к детям)
- /api/tenant POST (multipart):
  - upload_photo — серверный путь через sharp: WebP full 2048 + thumb 400,
    оба в Storage, запись в photos. Используется как резервный путь.
- /api/tenant POST (JSON):
  - register_photo — регистрация уже залитого файла
    (основной путь — клиентская компрессия). Проверяет, что
    storage_path и thumb_path начинаются с album_id/ (защита от
    подмены чужого альбома).
  - delete_photo — удаляет файлы из Storage (full + thumb), каскадом
    чистит selections/photo_teachers/photo_children/photo_locks,
    сбрасывает submitted_at у тех детей, кто выбирал это фото.
  - tag_photo / untag_photo — управление связью photo_children.
  - import_tags — массовая разметка из CSV. Матчит детей по full_name
    и фото по filename (регистронезависимо, через lookup-мапы —
    один запрос, не по строке). Возвращает { linked, skipped,
    skipped_rows[0..50] с причинами } для отладки.
- Новый хелпер: getOwnedPhoto (возвращает row с tenant-проверкой)
- Защита от загрузки в архивный альбом
- Аудит-лог на все действия
- /app UI:
  - Новая вкладка "Фото" в AlbumDetailModal (между Ученики и Учителя)
  - PhotosTab — саб-табы Портреты/Групповые/Учителя
  - Параллельная загрузка 5 воркеров через browser-image-compression,
    WebP на клиенте → прямая заливка в Storage → register_photo.
  - Независимые прогресс-бары для каждого из 3 типов, "Загрузить все"
    запускает все типы параллельно.
  - Частичное сообщение об успехе: "Загружено X из Y. Ошибок: Z."
  - Галерея с hover-удалением, оверлей с filename и тегами
    (для фото с одной привязкой — имя ученика, иначе "N привязок").
  - Блокировка загрузки в архивный альбом (без кнопок, с объяснением).
  - Viewer видит только галерею, без кнопок загрузки/удаления.
  - ImportTagsModal — paste CSV (не файл), автоопределение колонок
    (child_name/ФИО/имя/ученик, photo_filename/файл/фото).
    После импорта показывает результат и детализацию пропущенных
    строк с причинами ("ученик не найден", "фото не найдено").

### Этап 3.3.b — Экспорт CSV (готово)
- GET /api/tenant: export_csv — text/csv с BOM для Excel
  - Колонки совместимы со старой /api/admin?action=export:
    Класс, Ученик, Портрет_страница, Обложка, Портрет_обложка, Текст,
    Фото_друзья_1..10
  - Новые колонки справа (безопасно для легаси-импортёров):
    Статус, Родитель, Телефон, Доплата
  - Статус: 'Завершил' / 'В процессе' / 'Не начал'
  - Учителя идут в конце после пустой строки-разделителя
    с Класс=УЧИТЕЛЬ (и Статус 'Заполнено'/'Ожидание')
  - Имя файла: <title>-<city>-<year>.csv (слагифицировано,
    url-encoded в Content-Disposition)
  - Guard: пустой альбом → 400 "Альбом пуст — нечего экспортировать"
  - Аудит-лог на album.export_csv
  - assertAlbumAccess защита
- /app UI:
  - Кнопка "⬇ CSV" в шапке AlbumDetailModal, рядом с крестиком ×
    (доступна с любой вкладки)
  - Состояние "Готовим…" во время скачивания
  - Имя файла берётся из Content-Disposition сервера

### Этап 3.3.c — Управление заявками referral_leads (готово)
- GET /api/tenant: leads — список заявок с фильтром tenant_id,
  обогащён referrer_name (из parent_contacts или children.full_name) и
  referrer_album (через children→albums lookup). Сортировка по дате desc.
  Миграция: раньше был POST get_leads (legacy) — теперь REST GET.
- POST /api/tenant:
  - update_lead_status — whitelist из 4 статусов:
    new / in_progress / done / rejected. С проверкой владения tenant'ом
    и аудит-логом.
  - delete_lead — с проверкой tenant'а и аудит-логом.
- /app UI:
  - StatCard теперь поддерживает onClick (рендерится как <button>)
  - Карточка "Заявок" на дашборде — кликабельна, открывает LeadsModal
  - LeadsModal:
    - Фильтр-табы по статусу: Все / Новая / В работе / Заказ / Отказ,
      каждый со счётчиком
    - Карточки заявок: имя, tel: ссылка на телефон, город/школа/класс,
      реферер + альбом + дата, цветной бейдж статуса
    - 4 кнопки-переключателя статуса внизу карточки
      (текущий статус выделен, другие кликабельны)
    - Оптимистичный update_status с откатом при ошибке
    - Удаление с confirm
    - Viewer: только чтение (без кнопок переключения/удаления)
    - При закрытии модалки вызывается loadDashboard() —
      это пересчитывает leads_new в сводной карточке

### Этап 3.3.d — Цитаты (готово)
- GET /api/tenant: quotes — объединение своих tenant'а и глобальных
  через .or('tenant_id.is.null,tenant_id.eq.${tenantId}').
  Обогащено: is_global flag, use_count (через JOIN quote_selections ×
  albums по tenant_id — считаем только выборы детей этого tenant'а).
- POST /api/tenant:
  - create_quote — text обязательно (≤500 симв), category default
    'general', insert с tenant_id=auth.tenantId.
  - update_quote — проверка владения, глобальные read-only (403).
  - delete_quote — 409 с requires_force если use_count>0.
    С force=true — каскадное удаление quote_selections. Глобальные
    защищены от удаления (403).
- /app UI:
  - Кнопка "Цитаты" в toolbar дашборда (левее "+ Новый альбом"),
    видна всем, viewer тоже может смотреть.
  - QuotesModal:
    - Фильтр-табы: Все / Свои / Глобальные со счётчиками
    - Поиск по тексту
    - Группировка по категориям с заголовками (и подсчётом в группе)
    - Глобальные — бейдж "глобальная", без кнопок редактирования
    - Свои — hover открывает "Изменить / Удалить"
    - Встроенная форма создания/редактирования (не модалка в модалке):
      textarea с счётчиком 500 символов, datalist с существующими
      категориями, autoFocus.
    - Бейдж use_count (зелёный "✓ N") на цитатах, уже выбранных детьми.
    - 2-ступенчатый confirm при удалении используемой цитаты
      (сервер возвращает 409 + requires_force, UI показывает детали
      и спрашивает подтверждение для force=true).

### Этап 3.3.e — Напоминания родителям (готово)
- Реализовано полностью на клиенте — без нового API endpoint'а.
  Дети и access_token уже загружены в AlbumDetailModal, добавлять
  backend-маршрут было бы избыточно.
- /app UI:
  - Кнопка "🔔 Напомнить · N" в шапке AlbumDetailModal
    (показывается только если есть незавершившие, N — их счётчик)
  - ReminderModal:
    - Фильтр: Все незавершившие / Не начали / В процессе со счётчиками,
      кнопки неактивны если в категории 0 учеников
    - Авто-флажок "Группировать по классу" при наличии >1 класса
    - Текст-шаблон: шапка (название альбома, город, год, дедлайн),
      тело (ФИО → origin/token), хвост с подписью
    - Readonly textarea с click-to-select
    - Копирование в буфер с fallback через document.execCommand
      для старых браузеров
    - Примечание о приватности ссылок (советуем рассылать
      в личку, а не в общий чат, т.к. ссылка персональная)
- В импорты app/app/page.tsx добавлен useRef

### ИТОГ ЭТАПА 3.3 — ВСЕ ПОДЭТАПЫ ЗАКРЫТЫ (a/b/c/d/e)
- a: фото (загрузка, галерея, удаление, импорт тегов)
- b: экспорт CSV
- c: управление заявками
- d: цитаты
- e: напоминания родителям
Новый кабинет /app теперь покрывает все основные сценарии рабочего
цикла организатора альбома. Остались настройки (3.4-3.6) и миграция
старой админки (этап 4).

### Этап 3.4 — Управление командой (готово)
- /api/tenant GET:
  - users — список команды (исключая superadmin), только для owner
  - invitations — активные непринятые и непросроченные приглашения,
    обогащено invited_by_name через JOIN users
- /api/tenant POST:
  - invite_user — валидация email, 7-дневный токен (БД default),
    409 если user или активное приглашение уже существует
  - revoke_invitation — удаление pending приглашения с tenant-проверкой
  - remove_user — 4 защиты: сам себя, superadmin, чужой tenant,
    последний owner; поддержка soft=true (is_active=false)
    вместо hard delete
  - change_role — те же защиты, нельзя понизить последнего owner'а
- /api/auth GET action=invitation — публичная валидация токена
  (без авторизации), возвращает email + role + tenant_name
- /api/auth POST accept_invitation — создаёт user в tenant_id из
  приглашения с ролью из приглашения, ставит accepted_at, сразу
  логинит (выдаёт access + refresh cookies)
- Новая страница app/invite/[token]/page.tsx:
  - Форма: full_name + password (≥8) + confirm
  - Показ роли и названия tenant'а до приёма
  - Обработка ошибок: expired/already used (410), not found (404) —
    все в одной карточке с кнопкой "К входу"
  - Редирект после приёма: /app или /super в зависимости от роли
- /app UI:
  - Production: canManageTeam = auth.user.role === 'owner'
  - currentUserId для self-protection в UI
  - Кнопка "Команда" в toolbar (только для owner)
  - TeamModal:
    - Два таба: Сотрудники / Приглашения со счётчиками
    - Inline-форма приглашения с radio-картами ролей
      (с описанием каждой роли)
    - Автокопирование invite-ссылки после создания
    - При 409 existing — копируется существующий токен (UX-дружелюбие)
    - Карточки сотрудников: бейдж "это вы", "отключён",
      humanized last_login, переключатели ролей (блокированы для себя),
      кнопка Удалить (скрыта для себя)
    - Карточки приглашений: бейдж "ещё N дн." (красный ≤1, амбер ≤3),
      имя пригласившего, кнопки Скопировать / Отозвать
    - Оптимистичное change_role с откатом при ошибке

---

## ЧТО СДЕЛАТЬ ДАЛЬШЕ — ПЛАН

### Этап 3.5 — настройки аккаунта и брендинг (следующий)
- POST /api/tenant: update_settings (name, logo_url, brand_color, welcome_text, footer_text)
- UPLOAD: логотип в S3 bucket photos/tenants/<tenant_id>/logo
- /app UI:
  - Раздел "Настройки" (только для owner)
  - Форма смены пароля для всех
  - Загрузка логотипа
  - Выбор цвета бренда
  - Кастомный welcome-text для родителей

### Этап 3.6 — интеграция брендинга в страницу родителя
- Страница /[token] (сценарий родителя) подтягивает tenant.settings:
  - Логотип арендатора в шапке
  - Название арендатора
  - Кастомный welcome-text
  - Фирменный цвет для кнопок
- URL /t/[slug]/[token] как альтернатива для брендированных ссылок

### Этап 4 — перенос старой админки
- Мигрируем endpoint'ы /api/admin/* на двойную авторизацию (requireAuth)
- Добавляем tenant_id фильтры ко всем запросам
- Когда всё работает параллельно — постепенный перенос пользователей
- Финал: удаление app/admin/page.tsx и app/api/admin/route.ts

---

## ТАБЛИЦЫ БД

### Мультиаренда
- tenants (id, name, slug, logo_url, city, phone, email, plan,
  plan_expires, max_albums, max_storage_mb, settings, is_active, created_at)
- users (id, tenant_id, email, password_hash, full_name, role, is_active,
  last_login, created_at)
- sessions (id, user_id, token, ip_address, user_agent, expires_at, created_at)
- invitations (id, tenant_id, email, role, token, invited_by, expires_at,
  accepted_at, created_at)
- audit_log (id, tenant_id, user_id, action, target_type, target_id, meta,
  ip_address, created_at)

### Основные (с tenant_id)
- albums (tenant_id, archived, group_enabled, group_min, group_max,
  group_exclusive, text_enabled, text_max_chars, text_type, template_title,
  city, year, cover_mode, cover_price, deadline)
- album_templates (tenant_id — NULL для глобальных)
- quotes (tenant_id — NULL для глобальных)
- referral_leads (tenant_id)

### Без изменений (связь через album_id)
- children, teachers, responsible_parents
- photos (portrait/group/teacher, thumb_path)
- photo_children, photo_teachers
- selections, parent_contacts
- student_texts, cover_selections, photo_locks, drafts
- quote_selections (unique quote+album)

---

## РОЛИ

- superadmin — владелец системы, видит всё, tenant_id=null
- owner — владелец арендатора, полный контроль своего tenant'а
- manager — сотрудник, работает с альбомами, не управляет командой/настройками
- viewer — только чтение

---

## ВАЖНЫЕ ФАЙЛЫ

- lib/auth.ts — главная библиотека авторизации
- lib/supabase.ts — клиент Supabase
- migration_v3_multitenant.sql — SQL-миграция в корне репо
- docs/migration-multitenant-guide.md — гайд по миграции старых endpoint'ов

### Страницы
- app/login/page.tsx — вход
- app/super/page.tsx — панель superadmin
- app/app/page.tsx — кабинет owner/manager (ПОКА read-only, этап 3.1)
- app/admin/page.tsx — СТАРАЯ админка (работает на ADMIN_SECRET)
- app/[token]/page.tsx — сценарий родителя (БЕЗ ИЗМЕНЕНИЙ)
- app/teacher/[token]/page.tsx — учителя (БЕЗ ИЗМЕНЕНИЙ)
- app/ref/[token]/page.tsx — реферальная форма

### API
- app/api/auth/route.ts — login/refresh/logout/setup/me
- app/api/super/route.ts — операции superadmin над tenants
- app/api/tenant/route.ts — операции owner/manager над своим tenant'ом (read-only)
- app/api/admin/route.ts — СТАРЫЙ admin API (работает на x-admin-secret)
- app/api/child/route.ts — для родителей (по токену, без изменений)
- app/api/select/route.ts, /draft, /quote, /teacher, /referral — для родителей/учителей
- app/api/admin/upload-photo, /register-photo — старая загрузка фото

---

## ПАТТЕРНЫ КОДА

### Авторизация в новых endpoint'ах
```typescript
import { requireAuth, isAuthError } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, ['owner', 'manager', 'viewer'])
  if (isAuthError(auth)) return auth
  // auth.tenantId, auth.role, auth.userId
}
```

### Фильтр tenant_id
```typescript
// Для прямых запросов
.eq('tenant_id', auth.tenantId)

// Для связанных таблиц (children, photos) через JOIN
.select('*, albums!inner(tenant_id)')
.eq('albums.tenant_id', auth.tenantId)

// Superadmin-обход
if (auth.role === 'superadmin') {
  // фильтр не применяем
}
```

### Проверка владения альбомом
```typescript
async function assertAlbumAccess(auth, albumId) {
  if (auth.role === 'superadmin') return true
  const { data } = await supabaseAdmin
    .from('albums').select('tenant_id').eq('id', albumId).single()
  return data?.tenant_id === auth.tenantId
}
```

### Модалка-overlay (защита от случайного закрытия)
```typescript
const [backdropStart, setBackdropStart] = useState(false)
const handleBackdropMouseDown = (e) => {
  if (e.target === e.currentTarget) setBackdropStart(true)
}
const handleBackdropMouseUp = (e) => {
  if (backdropStart && e.target === e.currentTarget) onClose()
  setBackdropStart(false)
}
// <div onMouseDown={handleBackdropMouseDown} onMouseUp={handleBackdropMouseUp}>
```

### Audit log
```typescript
import { logAction } from '@/lib/auth'
await logAction(auth, 'album.create', 'album', albumId, { title, city })
```

---

## СТИЛИ (globals.css)

CSS-классы:
- .btn-primary — чёрная кнопка
- .btn-secondary — белая с рамкой
- .btn-ghost — серая "прозрачная"
- .card — белая карточка со скруглениями
- .input — единообразное поле ввода
- .badge-green / .badge-amber / .badge-gray / .badge-blue

Шрифты:
- var(--font-display) — Unbounded для заголовков
- var(--font-body) — Geologica для текста (default)

---

## ЛИМИТЫ СЕРВИСОВ

- Supabase Free: Storage ~0.25/1GB, Database 0.028/0.5GB, Egress 5GB
- Cron-job.org: keep-alive каждые 12ч
- Cloudflare Free: DNS + прокси

---

## ПЛАНЫ НА СЕЗОН 2026/2027

- К августу 2026 — готовая мультиаренда для демонстрации партнёрам
- Сентябрь 2026 — активное использование, ~100 заказов/месяц
- ~2500 родителей, ~40000 фото для отбора
- Миграция на российские сервисы (Timeweb/Yandex Cloud) —
  рассматривается после стабилизации мультиаренды

---

## СМЕНА ПАРОЛЯ (пока через SQL)

1. Попросить Claude сгенерировать PBKDF2-SHA256 хеш (100000 итераций):
```javascript
const crypto = require('crypto');
const password = 'НОВЫЙ_ПАРОЛЬ';
const salt = crypto.randomBytes(16);
const saltHex = salt.toString('hex');
crypto.pbkdf2(password, salt, 100000, 32, 'sha256', (err, derivedKey) => {
  console.log(`pbkdf2:100000:${saltHex}:${derivedKey.toString('hex')}`);
});
```

2. Выполнить в Supabase SQL Editor:
```sql
update users set password_hash = 'НОВЫЙ_ХЕШ' where email = 'email@example.com';
```

UI для смены пароля появится на этапе 3.5.

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
```

---

## УДАЛЕНИЕ ТЕСТОВОГО ТЕНАНТА И СИРОТ

Если после тестов остаются "висящие" пользователи без tenant'а:
```sql
delete from users where email in ('test@example.com');
select id, email, tenant_id from users;
```

Нормальное удаление tenant'а делается через /super UI.
НЕ полагаться на CASCADE — использовать endpoint delete_tenant
из /api/super, который удаляет ВСЕ связанные данные явно.

---

## ВАЖНО: ПРАВИЛА РАБОТЫ

1. **Старые endpoint'ы /api/admin/* НЕ ТРОГАТЬ** пока активно идут заказы.
   Они работают на ADMIN_SECRET и это нормально.

2. **Родительские страницы (/[token], /teacher, /ref) НЕ ТРОГАТЬ** —
   они работают по токенам доступа, авторизация там не нужна.

3. **Новые файлы строим рядом, не переписывая старое.**
   Новый кабинет = /app, а не /admin.
   Новое API = /api/tenant, а не /api/admin.

4. **После каждого подэтапа — обновлять этот контекст-файл** (новый vN).
   Коммитить в репо. Это страховка на случай обрыва чата.

5. **Никогда не коммитить секреты** (токены, пароли) в код.
   Все секреты — через env переменные Vercel.

## ВАЖНЫЕ НЮАНСЫ СИСТЕМЫ

### Ссылки по токенам
- `/<token>` — страница родителя ученика (выбор фото)
- `/teacher/<token>` — страница ОТВЕТСТВЕННОГО РОДИТЕЛЯ
  (назван исторически, на самом деле это он заполняет данные учителей;
  у учителей НЕТ своих отдельных ссылок, хотя в БД есть поле access_token)
- `/ref/<token>` — реферальная форма

### Текущие рабочие домены
- Основной: yearbook-v2.vercel.app (используем его!)
- album.okeybook.ru — через Cloudflare, но НЕ работает без VPN из РФ
