# КОНТЕКСТ ДЛЯ ПРОДОЛЖЕНИЯ РАБОТЫ
# Система отбора фотографий для выпускных альбомов → платформа для школьных фотографов
# Обновлено: 02.05.2026
#
# СТАТУС: АКТИВНЫЙ СЕЗОН
# Миграция фото Supabase → YC завершена (953 файла).
# Supabase даунгрейднут на Free Plan.
# Все фото теперь в Yandex Object Storage.
# Старые файлы из Supabase Storage удалены вручную через dashboard.

---

## КТО Я И ЧТО МЫ ДЕЛАЕМ

Сергей — фотограф/организатор выпускных альбомов.
Текущий продукт: веб-система для отбора фотографий родителями (вместо Google Диска).
Стратегическая цель: вырасти в большую платформу для ВСЕХ школьных фотографов —
CRM с ведением клиентов, реферальная программа, допродажи, загрузка фото клиентами,
аналитика. По сути — отраслевой SaaS для школьной фотографии.

---

## РАБОЧИЙ ДОМЕН

**Основной:** https://yearbook-v2.vercel.app
(album.okeybook.ru через Cloudflare не работает без VPN из РФ — не используем)

---

## СТЕК

- Next.js 14 + TypeScript + Tailwind
- Supabase (PostgreSQL, Free Plan) — только БД, Storage не используется
- Yandex Object Storage — всё хранилище фото (доступно из РФ/КЗ без VPN)
- Vercel (автодеплой из main)
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
- YC_ACCESS_KEY_ID
- YC_SECRET_ACCESS_KEY
- YC_BUCKET_NAME: yearbook-photos
- ADMIN_SECRET — можно удалить из Vercel (legacy удалён)

### Yandex Cloud
- console.yandex.cloud — аккаунт cloud-odintcovsergey
- Бакет: yearbook-photos, регион ru-central1, публичное чтение объектов
- Сервисный аккаунт: yearbook-storage, роль storage.editor
- URL файлов: https://storage.yandexcloud.net/yearbook-photos/<path>

### Supabase
- https://supabase.com/dashboard — FREE Plan (15 MB БД из 500 MB)
- Storage bucket "photos" — содержит только папку tenants/ (логотипы)

### Cron keep-alive
- cron-job.org → GET /api/auth каждые 12ч (защита от заморозки Supabase)

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

### Текущая схема (после миграции 02.05.2026)

**Все фото — в Yandex Object Storage:**
- `storage_path` в БД имеет префикс `yc:` — например `yc:album-id/portrait/123_file.webp`
- URL: `https://storage.yandexcloud.net/yearbook-photos/album-id/portrait/123_file.webp`
- Доступны без VPN из РФ/КЗ напрямую

**Supabase Storage:**
- Содержит только `tenants/` — логотипы tenant'ов (маленькие файлы)
- Все фото альбомов удалены

**Прокси /api/img/:**
- Формально ещё в коде, но использоваться не должен (все пути yc:)
- Можно удалить в следующей итерации

### Ключевые файлы
- `lib/storage.ts` — клиент YC, функции ycUpload/ycDelete/ycPhotoUrl
- `lib/supabase.ts` — getPhotoUrl/getThumbUrl (универсальные)
- `app/api/upload/route.ts` — серверный роут загрузки → YC
- `app/api/img/[...path]/route.ts` — прокси (можно удалить)

### Правило: URL фото ТОЛЬКО через хелперы
```typescript
import { getPhotoUrl, getThumbUrl } from '@/lib/supabase'
// НИКОГДА не строить URL вручную
```

### Скрипты миграции (в /scripts)
- `migrate-storage.mjs` — использован, миграция завершена
- `cleanup-supabase-storage.mjs` — частично использован (файлы удалены через UI)

---

## СТАТУС РАЗРАБОТКИ — ВСЁ СДЕЛАНО ✓

Все этапы 1–4.d + инфраструктура завершены:
- Мультиаренда, /super, /app (полный цикл работы с альбомами)
- Брендинг, команда, настройки, экспорт CSV
- Legacy /admin УДАЛЁН (4.d, 27.04.2026)
- Хранилище мигрировано на YC (02.05.2026)
- Supabase даунгрейднут на Free (~$25/мес сэкономлено)

---

## ИЗМЕНЕНИЯ С 01.05.2026 (v30 → v31)

**Миграция фото Supabase → Yandex Object Storage (02.05.2026)**
- scripts/migrate-storage.mjs — скрипт миграции (скачать из Supabase через прокси → залить в YC → обновить storage_path в БД)
- Мигрировано 953 файла, все storage_path теперь с префиксом `yc:`
- Supabase Storage очищен от фото альбомов (tenants/ оставлен)
- Supabase даунгрейднут с Pro ($25/мес) на Free

---

## ЧТО ДАЛЬШЕ — СТРАТЕГИЧЕСКИЙ ПЛАН

### Текущий сезон 2025/2026 (май–июнь 2026)
Система стабильна, работает. Фокус — собирать обратную связь от сотрудников
и родителей, находить узкие места в UX.

### Следующие технические задачи (по приоритету)

**1. Чистка кода (небольшая)**
- Удалить /api/img/ прокси (больше не нужен)
- Логотипы tenant'ов перенести в YC (сейчас в Supabase Storage)
- Удалить ADMIN_SECRET из Vercel env

**2. Аналитика** — когда платформа вырастет и появятся партнёры:
- Воронка: не начал → в процессе → завершил
- Конверсия по альбомам, динамика по дням
- Доплаты: % выбирающих обложку

**3. Рост платформы (стратегические направления)**
Сергей хочет вырастить систему в платформу для ВСЕХ школьных фотографов:

- **CRM для клиентов** — история заказов, контакты, теги, заметки
- **Реферальная программа** — уже есть базовая реализация, развить
- **Допродажи** — механики для увеличения среднего чека
- **Загрузка фото клиентами** — родители загружают свои фото (доп. кадры)
- **Биллинг** — ЮKassa, тарифы, автопродление, пробные периоды
- **SMS/Email рассылка** — SMSC.ru, Postmark
- **Аналитика** — дашборд метрик для партнёров

**4. Переезд с Vercel (осень 2026)**
- Timeweb или Yandex Cloud App Platform
- После окончания активного сезона

### Параллельный проект: автовёрстка InDesign
Отдельный чат. CSV формат задан в /api/tenant action=export_csv.

---

## ТАБЛИЦЫ БД

### Мультиаренда
- tenants, users, sessions, invitations, audit_log

### Основные (с tenant_id)
- albums (cover_mode CHECK: 'none'|'optional'|'required'|'optional_blind')
- album_templates, quotes, referral_leads

### Без изменений
- children, teachers, responsible_parents
- photos (storage_path: все с префиксом 'yc:' после миграции 02.05.2026)
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
- app/api/img/[...path]/route.ts — прокси (устарел, удалить)
- app/api/tenant/route.ts — основное API кабинета
- app/api/child/route.ts — API для родителей (НЕ ТРОГАТЬ)

### Страницы
- app/login/page.tsx — вход
- app/super/page.tsx — панель superadmin
- app/app/page.tsx — основной кабинет owner/manager
- app/[token]/page.tsx — родитель (НЕ ТРОГАТЬ)
- app/teacher/[token]/page.tsx — ответственный родитель (НЕ ТРОГАТЬ)
- app/ref/[token]/page.tsx — реферальная форма (НЕ ТРОГАТЬ)
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
```

---

## СТИЛИ

- .btn-primary, .btn-secondary, .btn-ghost, .card, .input
- .badge-green / .badge-amber / .badge-gray / .badge-blue
- var(--font-display) — Unbounded; var(--font-body) — Geologica

---

## ЛИМИТЫ СЕРВИСОВ

- Supabase Free: 500 MB БД (использует 15 MB), 1 GB Storage (почти пусто)
- Yandex Object Storage: оплата по факту, ~₽/GB/мес
- Vercel Hobby: 100 GB/мес трафика

---

## ПРАВИЛА РАБОТЫ

1. **Родительские страницы НЕ ТРОГАТЬ** — /[token], /teacher, /ref, /album/[id]
2. **URL фото ТОЛЬКО через getPhotoUrl/getThumbUrl** из lib/supabase.ts
3. **Загрузка фото — только через /api/upload** (серверный роут → YC)
4. **После каждого подэтапа — обновлять контекст-файл**
5. **Никогда не коммитить секреты**

---

## НЮАНСЫ СИСТЕМЫ

### Ссылки по токенам
- `/<token>` — страница родителя
- `/teacher/<token>` — ответственный родитель (учителя своих ссылок не имеют)
- `/ref/<token>` — реферальная форма
- `/album/<albumId>` — общая ссылка на класс

### Рабочий домен
- yearbook-v2.vercel.app (основной)
- album.okeybook.ru — не работает без VPN из РФ

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
```
