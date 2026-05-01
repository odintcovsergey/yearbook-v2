# КОНТЕКСТ ДЛЯ ПРОДОЛЖЕНИЯ РАБОТЫ
# Система отбора фотографий для выпускных альбомов
# Обновлено: 01.05.2026
#
# СТАТУС: АКТИВНЫЙ СЕЗОН
# Legacy /admin удалён (4.c + 4.d выполнены 27.04.2026).
# Все работы ведутся только в /app.
# Новые фото загружаются в Yandex Object Storage.
# Старые фото в Supabase Storage отдаются через /api/img/ прокси.

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
- Supabase (PostgreSQL) — Pro Plan — только БД, Storage больше не используется для новых фото
- Yandex Object Storage (новое хранилище фото) — доступно из РФ/КЗ без VPN
- Vercel (автодеплой из main) — Hobby Plan
- GitHub: https://github.com/odintcovsergey/yearbook-v2
- Зеркало: https://gitflic.ru/project/odintcovsergey/yearbook-v2
- jose (JWT), sharp (обработка фото), papaparse (CSV)
- @aws-sdk/client-s3, @aws-sdk/lib-storage (S3-совместимый клиент для YC)

---

## ДОСТУПЫ

### Vercel env переменные
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
- JWT_SECRET
- DEFAULT_TENANT_ID: 764929b7-3efe-43e7-aae9-0a9e97e52915
- CACHE_BUST
- YC_ACCESS_KEY_ID (Yandex Object Storage)
- YC_SECRET_ACCESS_KEY (Yandex Object Storage)
- YC_BUCKET_NAME: yearbook-photos
- ADMIN_SECRET — можно удалить (legacy удалён)

### Yandex Cloud
- console.yandex.cloud — аккаунт cloud-odintcovsergey
- Бакет: yearbook-photos, регион ru-central1, публичное чтение объектов
- Сервисный аккаунт: yearbook-storage, роль storage.editor
- Оплата: карта МИР, рубли. Грант 4000 ₽ зачислен.
- URL файлов: https://storage.yandexcloud.net/yearbook-photos/<path>

### Supabase
- https://supabase.com/dashboard
- Pro Plan — используется только для PostgreSQL (БД)
- Storage bucket "photos" — остаётся для старых файлов, новые туда не пишутся

### Cron keep-alive
- cron-job.org → GET /api/auth каждые 12ч (защита от заморозки Supabase)
- Раньше был /api/admin — обновить на /api/auth или /api/tenant

### GitHub Actions (автобэкап БД)
- .github/workflows/backup.yml — pg_dump ежедневно
- Secrets: SUPABASE_DB_URL, BACKUP_REPO_TOKEN

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

Деплой автоматический: push в main = деплой через 1-2 минуты.

---

## АРХИТЕКТУРА ХРАНИЛИЩА ФОТО

### Текущая схема (два провайдера одновременно)

**Новые фото (загружены после 01.05.2026):**
- Хранятся в Yandex Object Storage
- `storage_path` в БД имеет префикс `yc:` — например `yc:album-id/portrait/123_file.webp`
- URL: `https://storage.yandexcloud.net/yearbook-photos/album-id/portrait/123_file.webp`
- Доступны без VPN из РФ/КЗ напрямую

**Старые фото (загружены до 01.05.2026):**
- Хранятся в Supabase Storage
- `storage_path` без префикса — например `album-id/portrait/123_file.webp`
- URL: через прокси `/api/img/album-id/portrait/123_file.webp`
- Vercel проксирует запрос к Supabase (доступно, т.к. Vercel→Supabase работает)

### Ключевые файлы
- `lib/storage.ts` — клиент YC, функции ycUpload/ycDelete/isYcPath/ycPhotoUrl
- `lib/supabase.ts` — getPhotoUrl/getThumbUrl (универсальные, понимают оба провайдера)
- `app/api/upload/route.ts` — серверный роут загрузки (клиент → Vercel → YC)
- `app/api/img/[...path]/route.ts` — прокси для старых фото из Supabase

### Правило: URL фото ТОЛЬКО через хелперы
```typescript
import { getPhotoUrl, getThumbUrl } from '@/lib/supabase'
// getPhotoUrl('yc:path') → https://storage.yandexcloud.net/yearbook-photos/path
// getPhotoUrl('path')    → /api/img/path (прокси для Supabase)
// НИКОГДА не строить URL вручную
```

### Следующий шаг: миграция старых файлов (не срочно)
Написать скрипт: копировать файлы из Supabase Storage → YC,
обновить storage_path в БД (убрать префикс-less пути, добавить yc:).
После этого можно удалить /api/img/ прокси.

---

## СТАТУС МУЛЬТИАРЕНДЫ — ГОТОВО ✓

Все этапы 1–4.d завершены. Коротко:
- Мультиаренда, /super, /app (полный цикл), /api/tenant
- Брендинг, команда, настройки, бэкап
- Legacy /admin УДАЛЁН (4.d, 27.04.2026)

### БД: cover_mode constraint расширен
```sql
ALTER TABLE albums DROP CONSTRAINT albums_cover_mode_check;
ALTER TABLE albums ADD CONSTRAINT albums_cover_mode_check
  CHECK (cover_mode IN ('none', 'optional', 'required', 'optional_blind'));
```

---

## ИЗМЕНЕНИЯ С 27.04.2026 (v29 → v30)

**feat(4.c): редирект /admin → /app при JWT (90f3b72)**
- app/admin/page.tsx: при старте проверяет JWT через GET /api/auth
- Если залогинен → router.replace('/app')
- Если нет JWT → остаётся на форме ADMIN_SECRET

**feat(4.d): удаление legacy /admin (12f9222)**
- Удалены: app/admin/page.tsx, app/api/admin/route.ts,
  app/api/admin/upload-photo/route.ts, app/api/admin/register-photo/route.ts
- Единственный вход теперь — /app
- ADMIN_SECRET в Vercel можно удалить (Сергей сделает вручную)

**feat: миграция загрузки фото на Yandex Object Storage (91f1057, e4a2554)**
- lib/storage.ts — новый S3-совместимый клиент YC
- app/api/upload/route.ts — серверный роут: клиент → Vercel → YC
  Ключи YC только на сервере, никогда в браузере
- Новые пути хранятся с префиксом `yc:` в photos.storage_path
- lib/supabase.ts: getPhotoUrl/getThumbUrl понимают оба провайдера
- app/api/tenant/route.ts: photos listing использует getPhotoUrl/getThumbUrl
- app/api/tenant/route.ts: delete_photo удаляет из нужного провайдера
- npm: добавлены @aws-sdk/client-s3, @aws-sdk/lib-storage

---

## ЧТО СДЕЛАТЬ ДАЛЬШЕ — ПЛАН

### Приоритет 1: миграция старых файлов Supabase → YC (когда удобно)
Написать скрипт `/scripts/migrate-storage.ts`:
1. Получить все photos без префикса yc: из БД
2. Для каждого: скачать из Supabase Storage, загрузить в YC с префиксом yc:
3. Обновить storage_path в БД
4. После проверки — удалить из Supabase Storage
После миграции: удалить /api/img/ прокси и Supabase Storage bucket.

### Приоритет 2: аналитика
Дашборд по всем альбомам:
- Воронка: не начал → в процессе → завершил
- Конверсия по альбомам (% завершивших)
- Доплаты: сколько % выбирают обложку
- Динамика по дням

### Приоритет 3: постепенный переезд с Vercel
- Next.js на Timeweb/Yandex Cloud App Platform
- Настройка CI/CD через GitHub Actions (SSH деплой)
- Делать после стабилизации сезона (не раньше осени 2026)

### Дальше
- **Биллинг** — ЮKassa, автопродление
- **SMS/Email рассылка** — SMSC.ru
- **Уведомления** — родитель закончил, дедлайн

### Параллельный проект: автовёрстка InDesign
Отдельный чат. CSV формат: Класс, Ученик, Портрет_страница, Обложка,
Портрет_обложка, Текст, Фото_друзья_1..10, Статус, Родитель, Телефон,
Доплата, Комплектация.

---

## ТАБЛИЦЫ БД

### Мультиаренда
- tenants, users, sessions, invitations, audit_log

### Основные (с tenant_id)
- albums (cover_mode CHECK: 'none'|'optional'|'required'|'optional_blind')
- album_templates, quotes, referral_leads

### Без изменений
- children, teachers, responsible_parents
- photos (storage_path: старые без префикса, новые с 'yc:')
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

- lib/auth.ts — авторизация
- lib/supabase.ts — Supabase клиент + универсальные getPhotoUrl/getThumbUrl
- lib/storage.ts — Yandex Object Storage клиент
- app/api/upload/route.ts — серверная загрузка фото в YC
- app/api/img/[...path]/route.ts — прокси старых фото из Supabase
- app/api/tenant/route.ts — основное API кабинета
- app/api/child/route.ts — API для родителей (НЕ ТРОГАТЬ)
- app/api/select/route.ts и др. — для родителей (НЕ ТРОГАТЬ)
- .github/workflows/backup.yml — автобэкап БД

### Страницы
- app/login/page.tsx — вход
- app/super/page.tsx — панель superadmin
- app/app/page.tsx — основной кабинет owner/manager
- app/[token]/page.tsx — родитель (НЕ ТРОГАТЬ)
- app/teacher/[token]/page.tsx — ответственный родитель (НЕ ТРОГАТЬ)
- app/ref/[token]/page.tsx — реферальная форма (НЕ ТРОГАТЬ)
- app/album/[albumId]/page.tsx — общая ссылка на класс
- app/invite/[token]/page.tsx — приглашение в команду
- app/t/[slug]/[token]/page.tsx — брендированный URL

---

## ПАТТЕРНЫ КОДА

### Авторизация
```typescript
import { requireAuth, isAuthError } from '@/lib/auth'
const auth = await requireAuth(req, ['owner', 'manager', 'viewer'])
if (isAuthError(auth)) return auth
```

### URL фото (ОБЯЗАТЕЛЬНО через хелперы)
```typescript
import { getPhotoUrl, getThumbUrl } from '@/lib/supabase'
// Автоматически выбирает провайдер по префиксу пути
```

### Загрузка фото (новый путь)
```
Клиент сжимает в WebP → POST /api/upload (multipart) → Vercel → YC Storage
```

---

## СТИЛИ

- .btn-primary, .btn-secondary, .btn-ghost, .card, .input
- .badge-green / .badge-amber / .badge-gray / .badge-blue
- var(--font-display) — Unbounded; var(--font-body) — Geologica

---

## ЛИМИТЫ СЕРВИСОВ

- Supabase Pro: Database 8 GB, Egress 250 GB (Storage больше не растёт)
- Yandex Object Storage: оплата по факту ~₽/GB/мес, egress дешевле Supabase
- Vercel Hobby: 100 GB/мес трафика (прокси старых фото + JS/CSS)
- Vercel Function timeout: 10s — важно для /api/upload больших файлов

---

## ПРАВИЛА РАБОТЫ

1. **Родительские страницы НЕ ТРОГАТЬ** — /[token], /teacher, /ref, /album/[id]
2. **URL фото ТОЛЬКО через getPhotoUrl/getThumbUrl** из lib/supabase.ts
3. **Загрузка фото — только через /api/upload** (серверный роут → YC)
4. **После каждого подэтапа — обновлять контекст-файл**
5. **Никогда не коммитить секреты**

## НЮАНСЫ СИСТЕМЫ

### Ссылки по токенам
- `/<token>` — страница родителя
- `/teacher/<token>` — ответственный родитель (учителя своих ссылок не имеют)
- `/ref/<token>` — реферальная форма
- `/album/<albumId>` — общая ссылка на класс

### Рабочий домен
- yearbook-v2.vercel.app (основной)
- album.okeybook.ru — не работает без VPN из РФ

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
```
