# КОНТЕКСТ ДЛЯ ПРОДОЛЖЕНИЯ РАБОТЫ
# Система отбора фотографий для выпускных альбомов
# Обновлено: 16.04.2026

---

## КТО Я И ЧТО МЫ ДЕЛАЕМ

Фотограф/организатор выпускных альбомов.
Веб-система для отбора фотографий родителями вместо Google Диска.

---

## СТЕК

- Next.js 14 + TypeScript + Tailwind
- Supabase (PostgreSQL + Storage)
- Vercel: https://yearbook-v2.vercel.app
- Домен: https://album.okeybook.ru (через Cloudflare)
- GitHub: https://github.com/odintcovsergey/yearbook-v2
- Зеркало: https://gitflic.ru/project/odintcovsergey/yearbook-v2

---

## ССЫЛКИ И ДОСТУПЫ

- Сайт: https://album.okeybook.ru (= https://yearbook-v2.vercel.app)
- Админка (старая): https://album.okeybook.ru/admin
- ADMIN_SECRET: хранится в Vercel → Settings → Environment Variables
- JWT_SECRET: хранится в Vercel env (новая авторизация)
- DEFAULT_TENANT_ID: 764929b7-3efe-43e7-aae9-0a9e97e52915
- GitHub токен: хранится в Vercel env (до Jul 09, 2026)
- Supabase: https://supabase.com/dashboard
- Cloudflare: https://dash.cloudflare.com (okeybook.ru)
- Cron keep-alive: cron-job.org каждые 12ч → /api/admin

Клонирование в новом сеансе Claude:
  git clone https://odintcovsergey:[ТОКЕН]@github.com/odintcovsergey/yearbook-v2.git ~/yearbook-v2
  cd ~/yearbook-v2
  git config user.email "deploy@yearbook.app"
  git config user.name "Deploy Bot"
  git remote set-url origin https://odintcovsergey:[ТОКЕН]@github.com/odintcovsergey/yearbook-v2.git

Деплой — автоматический. Push в main = деплой через 1-2 минуты.

---

## СТАТУС МУЛЬТИАРЕНДЫ (обновлено 16.04.2026)

### Фундамент — ГОТОВО ✓
- migration_v3_multitenant.sql применён в Supabase
- Таблицы созданы: tenants, users, sessions, invitations, audit_log
- Поле tenant_id добавлено в albums, album_templates, quotes, referral_leads
- Дефолтный tenant "OkeyBook" (slug='main', id=764929b7-3efe-43e7-aae9-0a9e97e52915)
- Все существующие альбомы привязаны к main tenant
- lib/auth.ts — двойная авторизация (legacy ADMIN_SECRET + JWT)
- /api/auth endpoint — login, refresh, logout, setup, GET (me)
- Superadmin-аккаунт создан: odintcovsergey@gmail.com (id=4af9dc20-9fb9-480c-8197-fbf6290a56c9)
- Env-переменные JWT_SECRET и DEFAULT_TENANT_ID в Vercel
- Зависимость jose установлена

### ВАЖНО: текущий фронт НЕ изменён
- admin/page.tsx работает через ADMIN_SECRET как раньше
- Сотрудники ничего не заметили
- Все API-эндпоинты работают по-старому
- Фундамент существует "рядом" и ни на что не влияет

### Следующие шаги (когда будем готовы)
1. Создать страницу /login с JWT-авторизацией
2. Постепенно мигрировать endpoints admin/route.ts (гайд в docs/migration-multitenant-guide.md)
3. Добавить UI для управления командой (приглашения, роли)
4. Добавить UI для брендинга tenant'а (логотип, цвета)
5. Тарифные планы и лимиты (максимум альбомов/хранилища)
6. Панель superadmin для управления всеми tenant'ами

---

## ТАБЛИЦЫ БД

### Мультиаренда (НОВОЕ)
tenants (id, name, slug, plan, max_albums, max_storage_mb, settings, is_active)
users (id, tenant_id, email, password_hash, full_name, role, is_active, last_login)
sessions (id, user_id, token, ip_address, user_agent, expires_at)
invitations (id, tenant_id, email, role, token, invited_by, expires_at, accepted_at)
audit_log (id, tenant_id, user_id, action, target_type, target_id, meta, ip_address)

### Основные таблицы (с добавленным tenant_id)
albums (tenant_id, archived, group_enabled, group_min, group_max, group_exclusive,
        text_enabled, text_max_chars, text_type, template_title,
        city, year, cover_mode, cover_price, deadline)
album_templates (tenant_id — NULL для глобальных)
quotes (tenant_id — NULL для глобальных)
referral_leads (tenant_id)

### Остальные (без изменений, связь через album_id)
children (started_at, submitted_at)
teachers (description)
responsible_parents
photos (portrait/group/teacher, thumb_path)
photo_children, photo_teachers
selections, parent_contacts
student_texts
cover_selections, photo_locks, drafts
quote_selections (quote_id, child_id, album_id, UNIQUE quote+album)

---

## РОЛИ ПОЛЬЗОВАТЕЛЕЙ (новая система)

- superadmin — вы, видит все tenant'ы, tenant_id=null
- owner — партнёр/владелец аккаунта, полный контроль своего tenant'а
- manager — сотрудник, работает с альбомами, не управляет настройками
- viewer — только чтение

---

## ТИПЫ ТЕКСТА (text_type в albums)

- free — свободное поле (по умолчанию)
- garden — Детский сад: вопросы + пример
- grade4 — 4 класс: вопросы + пример
- grade11 — 9-11 класс: свободное поле + список цитат на выбор (блокировка)

---

## РЕЖИМЫ ОБЛОЖКИ (cover_mode)

- required — Обязателен (все платят): родитель сразу выбирает второй портрет
- optional — На выбор: 3 варианта (без портрета / тот же / другой с доплатой)
- none, same — legacy, обратная совместимость сохранена

---

## ЧТО РАБОТАЕТ

### Главная страница админки
- Карточки с прогресс-баром, крупным %
- Вкладки «Актуальные / Архив» для архивных заказов
- Кнопки: Шаблоны, Цитаты, Заявки (с бейджем новых), + Новый альбом
- Шестерёнка на карточке → модалка редактирования настроек альбома
- Поиск, фильтры по статусу, сортировка

### Редактирование альбома (модалка)
- Название, город, год, дедлайн
- Обложка (Обязателен / На выбор + доплата)
- Групповые фото (вкл/выкл, мин/макс, эксклюзив)
- Текст от ученика (вкл/выкл, макс символов, тип)

### Создание альбома
- Выбор шаблона → применяет все параметры
- 2 режима обложки: Обязателен / На выбор

### Вкладки внутри альбома
- Обзор: дедлайн, экспорт CSV (без URL-ссылок), напоминание, архивирование
- Ученики: чекбоксы, массовые действия, панель деталей
- Фото: параллельная загрузка, WebP, сортировка по filename
- Учителя: токен в карточке

### Сценарий родителя
- Шаг 1: портрет, sticky подсказка, миниатюра выбранного в sticky-панели
- Шаг 2: обложка (required = сразу выбор / optional = 3 варианта)
- Шаг 3: фото с друзьями, миниатюры выбранных в sticky-панели
- Шаг 4: текст, кнопки Назад/Далее над списком цитат
- Шаг 5: телефон + согласие на обработку ПД (текст под кнопкой)
- Шаг 6: подтверждение
- Нумерация страниц (1,2,3...) вместо стрелок, скролл к сетке
- После подтверждения: «Спасибо» + реферальная ссылка
- Повторный заход: «Выбор уже сделан» + реферальная ссылка

### Учителя (/teacher/[token])
- Поле «Текст от классного руководителя» у первого учителя
- Инструкция про пожелание в описании

### Реферальная система
- /ref/[token] — лендинг с формой (имя, телефон, город, школа, класс)
- Согласие на обработку ПД
- Заявки в админке (Новая → В работе → Заказ → Отказ)
- Бейдж-счётчик новых на кнопке «Заявки»
- Имя реферера + название альбома в карточке заявки

### Политика конфиденциальности
- /privacy — ИП Одинцов С.Н., ИНН 183310659096
- Текст согласия под кнопками на шаге 5 и реферальной форме

### API endpoints
- /api/child — text_type, quotes, takenQuoteIds, selectedQuoteId
- /api/quote — сохранение/снятие выбора цитаты
- /api/referral — GET info + POST заявка
- /api/admin — CRUD для всего + get_leads, update_lead_status, delete_lead, update_album
- /api/auth — login, refresh, logout, setup, GET me (НОВОЕ)

---

## ПЛАНЫ НА СЕЗОН 2026/2027

- Сентябрь — активное использование, ~100 заказов/месяц
- ~2500 родителей, ~40000 фото для отбора
- К сентябрю — готовая мультиаренда для партнёров/сотрудников
- Возможно — видеоконтент
- Миграция на российские сервисы (Timeweb/Yandex Cloud) — рассматривается после стабилизации мультиаренды

---

## ЛИМИТЫ СЕРВИСОВ

Supabase Free: Storage ~0.25/1GB, Database 0.028/0.5GB, Egress 5GB
Cron-job.org: keep-alive каждые 12ч (защита от заморозки)
Cloudflare Free: DNS + прокси (обход блокировок РФ)

---

## СБРОС ТЕСТОВОГО УЧЕНИКА (SQL)

update children set submitted_at = null, started_at = null where full_name = 'Имя';
delete from drafts where child_id = (select id from children where full_name = 'Имя');
delete from selections where child_id = (select id from children where full_name = 'Имя');
delete from parent_contacts where child_id = (select id from children where full_name = 'Имя');
delete from cover_selections where child_id = (select id from children where full_name = 'Имя');
delete from photo_locks where child_id = (select id from children where full_name = 'Имя');
delete from student_texts where child_id = (select id from children where full_name = 'Имя');
delete from quote_selections where child_id = (select id from children where full_name = 'Имя');

---

## СМЕНА ПАРОЛЯ SUPERADMIN (через SQL)

Пока нет UI для смены пароля. Если нужно сменить:

1. Попросить Claude сгенерировать новый хеш (алгоритм PBKDF2-SHA256, 100000 итераций)
2. Выполнить в Supabase SQL Editor:

update users
set password_hash = 'НОВЫЙ_ХЕШ'
where email = 'odintcovsergey@gmail.com';

---

## СТРУКТУРА lib/auth.ts

Главная функция: getAuth(req) → AuthContext | null

AuthContext: { userId, tenantId, role, isLegacy }

Порядок проверки:
1. x-admin-secret === ADMIN_SECRET → role=superadmin, isLegacy=true
2. Cookie auth_token (JWT) → роль из токена
3. null → 401

Хелперы:
- requireAuth(req, allowedRoles?) — защита endpoint'ов
- isAuthError(result) — type guard
- tenantFilter(auth) — получить tenant_id для SQL-фильтра
- logAction(auth, action, ...) — запись в audit_log
- setAuthCookies(response, access, refresh) — установка cookies
- clearAuthCookies(response) — удаление cookies
- hashPassword / verifyPassword — PBKDF2-SHA256

---

## МИГРАЦИЯ ENDPOINT'ОВ (когда продолжим)

Паттерн замены в каждом API route:

БЫЛО:
  function checkAdmin(req) {
    return req.headers.get('x-admin-secret') === process.env.ADMIN_SECRET
  }
  if (!checkAdmin(req)) return NextResponse.json({error:'Нет доступа'}, {status:401})

СТАЛО:
  import { requireAuth, isAuthError } from '@/lib/auth'
  const auth = await requireAuth(req)
  if (isAuthError(auth)) return auth
  // auth.tenantId, auth.role, auth.userId доступны

Добавить tenant-фильтр к запросам:
  let query = supabaseAdmin.from('albums').select('*')
  if (auth.role !== 'superadmin') {
    query = query.eq('tenant_id', auth.tenantId)
  }

Подробный гайд: docs/migration-multitenant-guide.md
