# КОНТЕКСТ ДЛЯ ПРОДОЛЖЕНИЯ РАБОТЫ
# Система отбора фотографий для выпускных альбомов
# Обновлено: 16.04.2026 (этап 3.1 закрыт)

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

---

## ЧТО СДЕЛАТЬ ДАЛЬШЕ — ПЛАН

### Этап 3.2.a — создание + редактирование + архивирование альбомов
- POST /api/tenant:
  - create_album (с проверкой лимита max_albums)
  - update_album
  - archive_album / unarchive_album
  - get_templates (свои + глобальные)
- /app UI:
  - Кнопка "+ Новый альбом" → модалка с выбором шаблона и всеми полями
  - Шестерёнка на карточке альбома → модалка редактирования
  - Кнопка "В архив" в модалке редактирования
  - Проверка: viewer не видит кнопок создания/редактирования
- ВАЖНО: поля те же, что в старой админке. Рефернс — app/admin/page.tsx.
  Дублировать компоненты не надо — пишем заново под новую архитектуру.

### Этап 3.2.b — работа с учениками, учителями, ответственным родителем
- POST /api/tenant:
  - add_child, delete_child, reset_child
  - add_teacher, update_teacher, delete_teacher
  - create_responsible
  - import_children (CSV)
- /app UI:
  - Вкладка "Ученики" внутри модалки альбома
  - Вкладка "Учителя"
  - Вкладка "Ответственный родитель"
  - CSV-импорт учеников

### Этап 3.3 — фото и параллель с текущей админкой
- POST /api/tenant: upload_photo, register_photo (+ WebP через sharp),
  delete_photo, tag_photo, import_tags
- /app UI:
  - Вкладка "Фото" — параллельная загрузка, WebP, сортировка
  - Экспорт CSV
  - Управление заявками (referral_leads)
  - Цитаты (свои + глобальные)
  - Напоминания родителям

### Этап 3.4 — управление командой (только для owner)
- POST /api/tenant: invite_user, revoke_invitation, remove_user, change_role
- GET /api/tenant: users, invitations
- /app UI:
  - Раздел "Команда" в настройках
  - Приглашение по email (пока без реальной отправки email — копируемая ссылка)
  - Список активных пользователей с ролями
  - Удаление сотрудника

### Этап 3.5 — настройки аккаунта и брендинг
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
