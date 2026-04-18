# КОНТЕКСТ ДЛЯ ПРОДОЛЖЕНИЯ РАБОТЫ
# Система отбора фотографий для выпускных альбомов
# Обновлено: 18.04.2026
#
# СТАТУС: ПАУЗА НА БОЕВОЕ ТЕСТИРОВАНИЕ
# Пользователь (Сергей) создал себе owner-аккаунт в OkeyBook через
# новую кнопку в /super, сейчас выдаёт доступы своим сотрудникам
# и переводит реальные заказы на /app. Этапы 4.c (редирект /admin
# → /app) и 4.d (удаление legacy) на паузе — запустим, когда Сергей
# убедится что /app стабилен в боевом режиме.
#
# Старая админка /admin продолжает работать через ADMIN_SECRET
# как fallback. Обе системы смотрят в одну БД — изменения в одной
# отражаются в другой.

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

### Этап 3.5 — Настройки аккаунта и брендинг (готово)

#### 3.5.a — настройки tenant'а и смена пароля
- GET /api/tenant:
  - tenant_settings — полные данные tenant'а (name, slug, logo_url,
    city, phone, email, plan, plan_expires, max_albums, settings,
    is_active, created_at). Доступно всем ролям tenant'а.
- POST /api/tenant:
  - update_tenant_settings — owner-only, обновляет name (required, ≤100),
    city, phone, email (с валидацией формата)
  - change_password — для всех ролей, требует current_password, валидация
    new_password (min 8 chars, отличается от current), удаляет ВСЕ сессии
    пользователя после смены (разлогин на других устройствах)
- Добавлены импорты hashPassword, verifyPassword в /api/tenant

#### 3.5.b — брендинг (логотип, цвет, тексты)
- POST /api/tenant (multipart):
  - upload_logo — owner-only, sharp 256x256 cover с 'attention' position,
    WebP 90 quality, upsert в photos/tenants/<tenant_id>/logo.webp,
    удаление старого пути если отличался, update tenants.logo_url.
    5 MB file limit, graceful sharp errors.
- POST /api/tenant (JSON):
  - update_branding — owner-only, мердж settings JSONB с валидацией:
    - brand_color — regex /^#[0-9a-fA-F]{6}$/, нижний регистр
    - welcome_text — до 1000 символов
    - footer_text — до 500 символов
    - пустые значения удаляются из settings (не хранятся как empty)
    - logo_url: null → чистка Storage + NULL в БД (удаление логотипа)

#### /app UI
- Кнопка "Настройки" в toolbar дашборда, видна всем ролям
- SettingsModal:
  - Табы: Аккаунт (owner) / Пароль (все) / Брендинг (owner)
  - Вкладка "Аккаунт": редактирование name/city/phone/email + read-only
    блок с планом, max_albums, plan_expires, slug, created_at
  - Вкладка "Пароль": current + new (x2) с client-side валидацией,
    inline-ошибки, уведомление про разлогин на других устройствах
  - Вкладка "Брендинг":
    - Загрузка логотипа через FormData (action=upload_logo),
      клиентская валидация 5 MB, превью
    - Color picker для brand_color
    - Textarea с счётчиками символов: welcome_text (1000), footer_text (500)
    - Удаление логотипа (update_branding logo_url=null) с confirm

### Этап 3.6 — Брендинг на странице родителя (готово)
- /api/child GET обогащён:
  - album.tenant_id добавлен в select альбома
  - Отдельный запрос к tenants → name, slug, logo_url, settings
  - Public URL логотипа строится из logo_url storage path
  - Цитаты фильтруются через .or(tenant_id.is.null,tenant_id.eq.${id})
    — фикс мультиарендного бага: раньше родители всех tenant'ов
    видели общий пул цитат, теперь только свои + глобальные
  - tenant добавлен в JSON-ответ
- /[token]/page.tsx — только аддитивные правки, логика отбора
  не тронута (правило "не ломать страницу родителя" соблюдено):
  - 5 новых состояний: tenantName, tenantLogoUrl, tenantBrandColor,
    tenantWelcomeText, tenantFooterText
  - Шапка: маленький логотип + название tenant'а над albumTitle
    (рендерятся только если заданы)
  - Progress bar окрашивается в tenantBrandColor с fallback #3b82f6
  - Welcome-text баннер на шаге 1 перед сеткой портретов
    (whitespace-pre-wrap для переносов)
  - Footer-text в подвале страницы
  - Все фичи opt-in: если у tenant'а нет настроек, UI как раньше
- Новая страница app/t/[slug]/[token]/page.tsx:
  - Брендированный URL вида /t/<slug>/<token>
  - Server-side redirect на /<token>
  - Slug на бэке игнорируется — удобен для маркетинга/визиток/SMS,
    где важен видимый бренд в URL
  - Функционально эквивалентен обычной родительской странице

### Этап 4.a — Двойная авторизация в /api/admin (готово)
- Все три legacy-endpoint'а (/api/admin/route.ts,
  /api/admin/upload-photo/route.ts, /api/admin/register-photo/route.ts)
  переведены на requireAuth(['superadmin', 'owner', 'manager']).
- requireAuth внутренне принимает оба режима:
  - x-admin-secret → role='superadmin', tenantId=DEFAULT_TENANT_ID
    (legacy поведение полностью сохранено)
  - JWT cookie → role и tenantId из токена
- Viewer не пускается (legacy admin — пишущий API)
- Старый фронт /admin продолжает работать через x-admin-secret
  без изменений. Новый путь (JWT) доступен для /app-пользователей
  с owner/manager ролью во время миграционного периода.

### Этап 4.b — Tenant-aware /api/admin (готово)

GET-ветки (11 штук) теперь фильтруются по auth.tenantId:
- albums, albums_with_stats — прямой фильтр
- templates — свои + глобальные через .or()
- stats, children, teachers, responsible, surcharges, photos, export
  защищены assertAlbumInTenant (404 если чужой)
- child_details — assertChildInTenant

POST-ветки:
- Все MAIN_TENANT_ID() заменены на auth.tenantId (sed, 8 мест).
  Для legacy-режима поведение не меняется — getAuth() автоматически
  ставит tenantId=DEFAULT_TENANT_ID при x-admin-secret.
- delete_album/archive/rename/update/create_album — tenant-фильтр
- add_child/add_teacher/create_responsible/update_deadline —
  защищены assertAlbumInTenant
- reset_child/delete_child — защищены assertChildInTenant
- delete_photo/tag_photo/import_tags — проверяют принадлежность
  фото и ребёнка
- КРИТИЧНЫЙ ФИКС: create_quote и create_template теперь привязывают
  запись к auth.tenantId. РАНЬШЕ: создавали с tenant_id=NULL,
  то есть новые цитаты/шаблоны из /admin становились глобальными —
  утечка между tenant'ами.
- delete_quote/delete_template блокируют удаление глобальных (403)
  и проверяют владение личными
- get_quotes/get_templates возвращают свои + глобальные
- get_leads/update_lead_status/delete_lead — scope auth.tenantId

Новые хелперы в route.ts:
- assertAlbumInTenant(auth, albumId) — проверка albums.tenant_id
- assertChildInTenant(auth, childId) — JOIN albums.tenant_id
- Удалена локальная константа MAIN_TENANT_ID (больше не нужна)

Поведение старого /admin не изменилось: x-admin-secret по-прежнему
видит только главный tenant. JWT-пользователи из /app могут
безопасно использовать legacy admin API с правильной изоляцией.

### Этап вспомогательный — create_owner в /super (готово)
- POST /api/super action=create_owner — superadmin создаёт user
  в существующем tenant'е (любая роль: owner/manager/viewer).
  Валидация: email формат, пароль ≥8, уникальность email глобально,
  проверка существования tenant'а.
- UI /super → TenantDetailModal → кнопка "+ Создать пользователя"
  в режиме view → форма с email/имя/пароль/роль → зелёная карточка
  с показом введённых данных после успеха (пароль открытым текстом
  — superadmin должен скопировать до закрытия).
- Использовано для создания первого owner-аккаунта Сергея
  в main-tenant OkeyBook: okeybook18@gmail.com / okeybook123.
  Пользователь сменит пароль через /app → Настройки → Пароль
  после первого входа.

---

## ЧТО СДЕЛАТЬ ДАЛЬШЕ — ПЛАН

### ТЕКУЩИЙ ПЕРИОД: боевое тестирование /app (пауза в кодинге)

Сергей сейчас:
- Выдаёт доступы своим сотрудникам к /app (через /super → Создать
  пользователя или через /app → Команда → Пригласить)
- Переносит рабочие процессы с реальными заказами в /app
- Собирает баги от себя и сотрудников
- Параллельно может вести автовёрстку в InDesign в отдельном чате
  на основе CSV из /app (см. раздел ниже)

В этот период Claude:
- Не делает 4.c (редирект /admin → /app) — Сергей сказал ждать
- Не делает 4.d (удаление legacy) — ни в коем случае, пока /app
  не подтверждён как стабильный
- Готов чинить конкретные баги по мере их нахождения — каждый баг
  отдельный маленький коммит/фикс, как было сделано с тремя багами
  17.04.2026 в коммите 4d1d400

### Этап 4.c — Редирект /admin → /app для JWT (когда Сергей скажет)

Обратимый шаг. После того как Сергей скажет "делаем 4.c":
- app/admin/page.tsx: на старте проверяет наличие JWT через GET /api/auth.
  - Если залогинен через JWT → router.push('/app')
  - Если только ADMIN_SECRET или нет авторизации → остаётся /admin.
- Это делает /app основным входом, но /admin продолжает работать
  как fallback через ADMIN_SECRET.

### Этап 4.d — Удаление legacy-кода (финал, через 2-4 недели после 4.c)

НЕОБРАТИМЫЙ шаг. Выполняется ТОЛЬКО после явного подтверждения
Сергея что все сотрудники успешно работают через /app без жалоб.

- Удалить app/admin/page.tsx
- Удалить app/api/admin/route.ts, /upload-photo, /register-photo
- Удалить ADMIN_SECRET env-переменную из Vercel
- Обновить документацию

### Дальнейшее развитие продукта (после 4.d, не в явном плане)

Направления, которые напрашиваются из текущей архитектуры, но не
начаты. Сергей приоритизирует сам когда вернётся:
- **Биллинг и тарифы** — сейчас plan/max_albums/plan_expires —
  метки, лимита-на-создание есть, но оплаты нет. ЮKassa/Stripe,
  автопродление, уведомления.
- **Рассылка приглашений и напоминаний** — сейчас ссылки копируются
  в буфер. SMSC.ru / Twilio для SMS, Postmark/SendGrid для email.
- **Уведомления арендаторам** — новая заявка, родитель закончил,
  родитель застрял.
- **Аналитика** — графики по конверсии, время на странице, воронка.
- **Мобильное приложение фотографа** — нативная обёртка вокруг /app.

### ПАРАЛЛЕЛЬНЫЙ ПРОЕКТ: автовёрстка InDesign

Сергей сказал 18.04.2026 что хочет параллельно начать автовёрстку
в InDesign на основе CSV-экспорта из /app. Делать в отдельном
новом чате (не в этом — чтобы не загружать контекст).

Связь с текущим проектом:
- /api/tenant action=export_csv — формат CSV задан здесь.
- Если для автовёрстки понадобится новая колонка или формат —
  добавлять в этот экспорт, чтобы оба проекта жили на одной схеме.
- Имена файлов фотографий хранятся в photos.filename и попадают
  в CSV как есть.

Для старта того чата Сергею нужно приложить:
- Реальный CSV из /app (младшие классы и 11 класс отдельно —
  разный формат из-за quotes и cover_mode)
- Старые .jsx скрипты автовёрстки, если сохранились
- Пример готовой вёрстки PDF (~5-10 страниц) для понимания макета
- Версию InDesign и OS
- Описание целевого воркфлоу (ручная вёрстка сейчас занимает
  X часов, самые рутинные операции — Y).

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
