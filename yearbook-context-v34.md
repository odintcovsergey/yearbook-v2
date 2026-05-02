# КОНТЕКСТ ДЛЯ ПРОДОЛЖЕНИЯ РАБОТЫ
# Система отбора фотографий для выпускных альбомов → платформа для школьных фотографов
# Обновлено: 02.05.2026
#
# СТАТУС: АКТИВНЫЙ СЕЗОН (май 2026)
# Личный разворот реализован. CRM готов. Аналитика в карточке альбома.
# Все фото в Yandex Object Storage. Supabase Free Plan.
# AlbumDetailModal — фиксированный размер 90vh.

---

## КТО Я И ЧТО МЫ ДЕЛАЕМ

Сергей — фотограф/организатор выпускных альбомов.
Текущий продукт: веб-система для отбора фотографий родителями (вместо Google Диска).
Стратегическая цель: отраслевой SaaS для школьных фотографов.

## ДОРОЖНАЯ КАРТА 2026

### Май 2026 — активный сезон, работаем на Vercel
- Текущие заказы, обкатка системы, мелкие фиксы по обратной связи

### Июнь 2026 — переезд с Vercel на российский хостинг
- Переезд на Timeweb Cloud или Yandex Cloud App Platform
- Настройка GitHub Actions для автодеплоя (замена Vercel CI)
- Цель: полная независимость от западных сервисов до старта масштабирования
- Домен okeybook.ru станет доступен без VPN из РФ

### Июль 2026 — запуск партнёрской программы
- Раздача доступов фотографам-партнёрам (через /super → create_owner)
- Реферальная система для привлечения новых фотографов
- Сбор обратной связи, доработка под нужды партнёров
- Аналитика и метрики по партнёрам

### Сентябрь 2026 — полная боеготовность
- Самая активная фаза (начало учебного года = пик заказов)
- Цель: ~100 заказов/месяц, несколько активных партнёров
- Система должна быть стабильна и масштабируема

---

## РАБОЧИЙ ДОМЕН

**Основной:** https://yearbook-v2.vercel.app
(album.okeybook.ru через Cloudflare не работает без VPN из РФ — не используем до переезда)

---

## СТЕК

- Next.js 14 + TypeScript + Tailwind
- Supabase (PostgreSQL, Free Plan) — только БД
- Yandex Object Storage — всё хранилище фото (доступно из РФ/КЗ)
- Vercel (автодеплой из main) — до июня 2026
- GitHub: https://github.com/odintcovsergey/yearbook-v2
- jose (JWT), sharp (обработка фото), papaparse (CSV)
- @aws-sdk/client-s3, @aws-sdk/lib-storage (S3-клиент для YC)
- @dnd-kit/core, @dnd-kit/sortable (drag & drop в CRM)
- jszip (серверная сборка ZIP для скачивания фото разворота)
- browser-image-compression (сжатие фото на клиенте)

---

## ДОСТУПЫ

### Vercel env переменные
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
- JWT_SECRET
- DEFAULT_TENANT_ID: 764929b7-3efe-43e7-aae9-0a9e97e52915
- CACHE_BUST
- YC_ACCESS_KEY_ID
- YC_SECRET_ACCESS_KEY
- YC_BUCKET_NAME: yearbook-photos
- ADMIN_SECRET — можно удалить (legacy удалён)

### Yandex Cloud
- console.yandex.cloud — аккаунт cloud-odintcovsergey
- Бакет: yearbook-photos, регион ru-central1, публичное чтение объектов
- Сервисный аккаунт: yearbook-storage, роль storage.editor
- URL файлов: https://storage.yandexcloud.net/yearbook-photos/<path>
- Тарификация: ~2 ₽/ГБ/мес хранение, входящий трафик бесплатно

### Supabase
- https://supabase.com/dashboard — FREE Plan (15 MB БД из 500 MB)
- Storage bucket "photos" — только папка tenants/ (логотипы)

### GitHub токен (для клонирования в Claude)
- Истекает 09.07.2026 — обновить заранее в project instructions

### Superadmin-аккаунт
- Email: odintcovsergey@gmail.com
- ID: 4af9dc20-9fb9-480c-8197-fbf6290a56c9

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

**Все фото — в Yandex Object Storage:**
- `storage_path` в БД с префиксом `yc:` → URL напрямую на YC
- Исключение: `tenants/` (логотипы) — в Supabase Storage

**Структура бакета yearbook-photos:**
```
album_id/portrait/ts_filename.ext    ← портреты (WebP, конвертированы)
album_id/group/ts_filename.ext       ← групповые (WebP)
album_id/teacher/ts_filename.ext     ← учителя (WebP)
album_id/personal/child_id/filename  ← личный разворот (оригинал, не конвертируем)
tenants/tenant_id/logo.webp          ← логотипы (Supabase Storage)
```

**Правило filename в БД:**
- Хранится оригинальное имя файла: `DSC08521.jpg` (не `.jpg.webp`)
- Storage path хранит WebP: `album_id/portrait/ts_DSC08521.jpg.webp` — для хранилища
- Для личного разворота: оригинальный формат без конвертации (важно для качества печати)

---

## СТАТУС РАЗРАБОТКИ

### Завершено ✓

**Мультиаренда (этапы 1-4)**
- Tenants, users, sessions, invitations, audit_log
- /super (superadmin), /app (owner/manager/viewer)
- JWT-авторизация, приглашения, управление командой
- Брендинг tenant'а (логотип, цвет, тексты на странице родителя)
- Legacy /admin УДАЛЁН

**CRM (02.05.2026)**
- Клиенты (школы): список, карточка, контакты (директора/завучи), теги, заметки
- Воронка (Kanban): этапы Лид→Переговоры→Договор→Съёмка→Отбор фото→Верстка→Готово→Закрыто
- Drag & drop карточек между колонками (@dnd-kit)
- Задачи: создание с дедлайном, привязка к сделке/клиенту, фильтр Мои/Все
- Создание альбома прямо из сделки
- Настройка этапов воронки (цвет, порядок, переименование)

**Личный разворот (02.05.2026)**
- Настройки в AlbumFormModal: тумблер, цена, мин/макс фото
- Новый шаг на странице родителя (после текста): загрузка 4-12 фото, до 10 МБ
  - Сжатие >4 МБ на клиенте (browser-image-compression, не WebP — оригинальный формат)
  - Прогресс-бар при загрузке нескольких файлов
  - Предупреждение при разрешении < 800×1200px
  - Продающий текст: «+2 страницы только ваших фотографий»
  - Фото на странице итогов — как портреты (96×96, клик → лайтбокс)
- Вкладка «Разворот» в AlbumDetailModal:
  - Аккордеон: кликнуть на ученика → превью фото
  - Кнопка «⬇ Скачать всё» → серверный ZIP (/api/spread-download)
  - Итоговая сумма доплат
- Вкладка «Доплаты» — объединяет доплаты за обложку и за разворот
- Фото разворота видны в детализации ученика (вкладка Ученики)
- CSV: колонки Личный_1..Личный_12 с именами файлов

**Аналитика**
- График динамики отбора по дням — в AlbumDetailModal → Обзор
- Показывает: завершили (зелёная линия) / открыли (синяя пунктирная)

**UX/инфраструктура**
- Свайп фото в лайтбоксе (useRef, корректная обработка вертикального скролла)
- AlbumDetailModal — фиксированный размер 90vh, внутренний скролл
- /api/img/ прокси удалён (все пути yc:)
- .next/ добавлен в .gitignore

**Скрипты (в /scripts)**
- migrate-storage.mjs — миграция Supabase → YC (использован, 953 файла мигрировано)
- cleanup-supabase-storage.mjs — очистка Supabase Storage (использован)

---

## ТАБЛИЦЫ БД

### Мультиаренда
- tenants, users, sessions, invitations, audit_log

### Основные (с tenant_id)
- albums (+personal_spread_enabled, personal_spread_price, personal_spread_min, personal_spread_max)
- album_templates, quotes, referral_leads

### CRM
- clients (tenant_id, name, city, address, website, notes, tags[])
- contacts (tenant_id, client_id, full_name, role, phone, email, notes, birthday)
- deal_stages (tenant_id, name, color, sort_order, is_closed)
- deals (tenant_id, client_id, album_id, stage_id, title, amount, deadline, assigned_to, notes)
- tasks (tenant_id, deal_id, client_id, title, due_date, assigned_to, completed_at)

### Личный разворот
- personal_spread_photos (child_id, album_id, tenant_id, storage_path, filename, width, height, file_size, sort_order)

### Без изменений
- children, teachers, responsible_parents
- photos (storage_path: все с префиксом 'yc:')
- photo_children, photo_teachers, selections, parent_contacts
- student_texts, cover_selections, photo_locks, drafts, quote_selections

---

## РОЛИ
- superadmin — владелец системы
- owner — владелец tenant'а
- manager — сотрудник (без управления командой)
- viewer — только чтение

---

## ВАЖНЫЕ ФАЙЛЫ

### API
- app/api/auth/route.ts — login/refresh/logout/me
- app/api/super/route.ts — операции superadmin
- app/api/tenant/route.ts — основное API кабинета
- app/api/crm/route.ts — CRM (клиенты, сделки, задачи)
- app/api/upload/route.ts — загрузка фото организатором → YC
- app/api/personal-spread/route.ts — загрузка/удаление фото родителем
- app/api/spread-download/route.ts — серверный ZIP для скачивания разворота
- app/api/child/route.ts — для родителей (НЕ ТРОГАТЬ)

### Страницы
- app/login/page.tsx
- app/super/page.tsx
- app/app/page.tsx — основной кабинет (5000+ строк)
- app/app/CRMModal.tsx — CRM модалка
- app/[token]/page.tsx — родитель (аддитивные правки только)
- app/teacher/[token]/page.tsx — ответственный родитель (НЕ ТРОГАТЬ)

### Библиотеки
- lib/auth.ts — авторизация
- lib/supabase.ts — Supabase клиент + getPhotoUrl/getThumbUrl
- lib/storage.ts — YC клиент, ycUpload/ycDelete/getPhotoUrlUniversal

---

## ПАТТЕРНЫ КОДА

### Авторизация
```typescript
const auth = await requireAuth(req, ['owner', 'manager', 'viewer'])
if (isAuthError(auth)) return auth
// auth.tenantId, auth.role, auth.userId
```

### URL фото — ТОЛЬКО через хелперы
```typescript
import { getPhotoUrl, getThumbUrl } from '@/lib/supabase'
```

### Загрузка фото организатором
```
Клиент → browser-image-compression (WebP) → /api/upload → YC
```

### Загрузка фото личного разворота (родитель)
```
Клиент → browser-image-compression если >4МБ (оригинальный формат!) → /api/personal-spread → YC
```

---

## ЧТО ДАЛЬШЕ (приоритеты)

### Июнь 2026 — переезд с Vercel

**Шаги переезда:**
1. Выбрать хостинг: Timeweb Cloud VPS (~800 ₽/мес) или YC App Platform
2. Написать Dockerfile для Next.js
3. Настроить GitHub Actions: push → build → deploy
4. Перенести env-переменные
5. Обновить DNS okeybook.ru → новый сервер
6. Удалить Vercel проект

После переезда okeybook.ru заработает из РФ без VPN.

### Июль 2026 — партнёрская программа

**Что нужно доделать для партнёров:**
- Онбординг: что делать после первого входа (пустой экран сейчас не объясняет)
- Биллинг: сейчас plan/max_albums — метки, оплаты нет (ЮKassa)
- Уведомления партнёру: новая заявка, родитель застрял
- SMS/Email напоминания родителям (сейчас только копирование ссылки)

### Сентябрь 2026 — боеготовность

- Полный биллинг с автопродлением
- Мобильная версия кабинета (адаптив уже есть, возможно нативное приложение)
- Аналитика для партнёров

---

## МИГРАЦИИ БД (применены в Supabase)

- migration_v3_multitenant.sql — мультиаренда
- crm-migration.sql — CRM таблицы + unique index deal_stages
- personal-spread-migration.sql — личный разворот

---

## СТИЛИ

- .btn-primary, .btn-secondary, .btn-ghost, .card, .input
- .badge-green / .badge-amber / .badge-gray / .badge-blue
- var(--font-display) — Unbounded; var(--font-body) — Geologica

---

## ПРАВИЛА РАБОТЫ

1. **Родительские страницы НЕ ТРОГАТЬ деструктивно** — /[token], /teacher, /ref
2. **URL фото ТОЛЬКО через getPhotoUrl/getThumbUrl**
3. **Загрузка портретов/групп → WebP; личный разворот → оригинальный формат**
4. **filename в БД = оригинальное имя файла** (DSC08521.jpg, не DSC08521.jpg.webp)
5. **После каждого подэтапа — обновлять контекст-файл**
6. **Никогда не коммитить секреты**

---

## НЮАНСЫ СИСТЕМЫ

### Ссылки по токенам
- `/<token>` — страница родителя (шаги: портрет → обложка → фото с друзьями → текст → личный разворот → контакт → итого)
- `/teacher/<token>` — ответственный родитель
- `/ref/<token>` — реферальная форма

### Шаги родителя (StepId: 1|2|3|4|5|6|7)
- 1: Портрет
- 2: Обложка (если cover_mode != 'none')
- 4: Фото с друзьями (если group_enabled)
- 3: Текст (если text_enabled)
- 7: Личный разворот (если personal_spread_enabled) ← НОВЫЙ
- 5: Контакт
- 6: Итого + подтверждение

### Домены
- yearbook-v2.vercel.app — основной (до переезда)
- album.okeybook.ru — не работает без VPN из РФ (до переезда с Vercel)

---

## СМЕНА ПАРОЛЯ (через SQL)

```javascript
const crypto = require('crypto');
const password = 'НОВЫЙ_ПАРОЛЬ';
const salt = crypto.randomBytes(16);
crypto.pbkdf2(password, salt, 100000, 32, 'sha256', (err, dk) => {
  console.log(`pbkdf2:100000:${salt.toString('hex')}:${dk.toString('hex')}`);
});
```
```sql
update users set password_hash = 'ХЕШ' where email = 'email@example.com';
```

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
