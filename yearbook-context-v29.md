# КОНТЕКСТ ДЛЯ ПРОДОЛЖЕНИЯ РАБОТЫ
# Система отбора фотографий для выпускных альбомов
# Обновлено: 27.04.2026
#
# СТАТУС: БОЕВОЕ ТЕСТИРОВАНИЕ /app — ИДЁТ АКТИВНО
# Сергей работает с реальными заказами в /app (10-30 заказов в сезоне).
# Этапы 4.c (редирект /admin → /app) и 4.d (удаление legacy) на паузе —
# запустим, когда Сергей убедится что /app стабилен.
#
# Старая админка /admin продолжает работать через ADMIN_SECRET
# как fallback. Обе системы смотрят в одну БД.
#
# КРИТИЧНО: Supabase Storage недоступен напрямую из РФ/Казахстана без VPN.
# Все URL фото проксируются через /api/img/[...path] на Vercel.
# Это решено в коде — менять ничего не нужно.

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
- Supabase (PostgreSQL + Storage) — Pro Plan
- Vercel (автодеплой из main) — Hobby Plan, ~580 MB / 100 GB трафика
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
- Pro Plan — 100 GB Storage, 250 GB Egress

### Cron keep-alive
- cron-job.org → GET /api/admin каждые 12ч (защита от заморозки Supabase)

### GitHub Actions (автобэкап БД)
- .github/workflows/backup.yml — pg_dump ежедневно + meta Storage еженедельно
- Secrets: SUPABASE_DB_URL, BACKUP_REPO_TOKEN

### GitHub токен (для клонирования в Claude)
- Истекает 09.07.2026 — обновить заранее в project instructions

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

### Этапы 1–3.6, 4.a–4.b, вспомогательный create_owner
Все эти этапы полностью завершены — описание в v28.
Коротко: мультиаренда, /super, /app (полный цикл работы), /api/tenant,
двойная авторизация в /api/admin, tenant-aware API, брендинг.

### БД: cover_mode constraint расширен (27.04.2026)
В таблице albums добавлено новое значение optional_blind:
```sql
ALTER TABLE albums DROP CONSTRAINT albums_cover_mode_check;
ALTER TABLE albums ADD CONSTRAINT albums_cover_mode_check
  CHECK (cover_mode IN ('none', 'optional', 'required', 'optional_blind'));
```
Это нужно применить на любой новой БД вручную через Supabase SQL Editor.

---

## ИЗМЕНЕНИЯ С 18.04.2026 (v28 → v29)

### Баги исправлены

**fix: кириллица в пути Storage (dcf77dd)**
- app/app/page.tsx: при загрузке фото cleanName теперь убирает кириллицу
  (`/[^\w.\-]/g` вместо `/[^\w.\-а-яёА-ЯЁ]/g`)
- Supabase Storage отвергает non-ASCII символы в ключах файлов

**fix: portrait_cover блокируется после submit (ffa1598)**
- app/api/child/route.ts: при определении заблокированных портретов
  теперь учитываются оба типа: `portrait_page` и `portrait_cover`
- Раньше фото выбранное на обложку не ставило замок для других учеников

**fix: авто-обновление токена при 401 (fd487a9)**
- app/app/page.tsx: функция `api()` при получении 401 автоматически
  вызывает `/api/auth` с `action=refresh`, затем повторяет запрос
- Добавлена `refreshAccessToken()` с дедупликацией параллельных вызовов
- Больше не выбрасывает на логин после 15 минут бездействия

**fix: прокси фото через /api/img/ (77d59a6)**
- ПРИЧИНА: Supabase Storage (bnotiyhamfyllcrqwquq.supabase.co) недоступен
  из РФ/Казахстана без VPN — Safari падает с "сервер неожиданно отключился"
- РЕШЕНИЕ: новый маршрут `app/api/img/[...path]/route.ts` — прокси
  Vercel забирает файл из Supabase сервер→сервер (работает),
  клиент обращается к yearbook-v2.vercel.app/api/img/... (работает везде)
- lib/supabase.ts: getPhotoUrl() и getThumbUrl() теперь возвращают `/api/img/...`
- app/api/tenant/route.ts, app/api/admin/route.ts: все хардкодные URL переведены
- Cache-Control: public, max-age=604800 — браузер кэширует на 7 дней
- Supabase Image Transformations (?width=400&quality=70) убраны полностью —
  даже на Pro Plan нестабильно работают через прокси

**fix: students missing from CSV (b09c532)**
- app/api/tenant/route.ts: при добавлении колонки Комплектация случайно
  был удалён `...rows` из allRows — ученики не попадали в файл

### Новые фичи в /app

**feat: панель деталей ученика (0ca8de6, e79704b)**
- При клике на строку завершившего ученика раскрывается панель с его выбором
- Показывает: портрет, фото обложки (+сумма), фото с друзьями, цитату, контакт
- Миниатюры 112×112, под каждой — имя файла (9b95de9)
- Клик по фото открывает оригинал в новой вкладке (cursor-zoom-in, hover-подсказка)
- API: GET /api/tenant?action=child_details&child_id=... — новый endpoint
  возвращает selections с URL/thumb, text, contact, cover

**feat: кнопка "🔗 Класс" в шапке модалки альбома (c67782d)**
- Копирует ссылку `/album/<id>` — родитель сам выбирает ребёнка из списка
- Стоит между "Напомнить" и "CSV"

**feat: зелёный прогресс-бар при 100% (b634ea0)**
- Карточки альбомов на дашборде: шкала становится зелёной при progress >= 100

**feat: cover_mode = optional_blind (708addb)**
- Третий вариант обложки в настройках альбома: "На выбор (без цен)"
- Родитель видит те же три кнопки, но без подписей "Бесплатно" / "+300 ₽"
- RadioCard: sub не рендерится если пустая строка
- Доплата при выборе "другой портрет" всё равно записывается в БД и CSV
- ВАЖНО: requires SQL migration (см. выше — расширение CHECK constraint)

**feat: колонка Обложка в таблице учеников (f0dd40d, 2ac92c7)**
- Показывает сумму доплаты `+N ₽` для всех у кого cover_option='other'
- "тот же" если выбрал same, "—" если без обложки/не выбрал

**feat: таб "Доплаты" в модалке альбома (2ac92c7)**
- Стоит после "Ответственный"
- Таблица: ФИО, класс, за что, сумма — только ученики с доплатами
- Итоговая сумма в правом верхнем углу
- Сейчас только обложки; архитектурно готово к добавлению других категорий

**feat: колонка Комплектация в CSV (a8ea50b)**
- Последняя колонка в экспорте (после Доплата)
- Значение = album.template_title ("Фотопапка / Мини / Лайт" и т.д.)
- Нужно для логики автовёрстки InDesign

**feat: ежедневный бэкап БД через GitHub Actions (3dc5495)**
- .github/workflows/backup.yml
- pg_dump ежедневно → отдельный приватный репо
- Meta Storage еженедельно (список файлов)

### UX-правки

**fix: убрано предупреждение про ссылку из модалки напоминания (aa9490f)**
- Убран текст "Ваша персональная ссылка — не пересылайте её..." из шаблона
- Убрана серая подсказка внизу ReminderModal

---

## ЧТО СДЕЛАТЬ ДАЛЬШЕ — ПЛАН

### Следующие этапы (когда Сергей скажет)

**Этап 4.c — Редирект /admin → /app для JWT**
Обратимый шаг. app/admin/page.tsx: проверяет JWT при старте,
если залогинен → router.push('/app'), иначе остаётся /admin.

**Этап 4.d — Удаление legacy /admin**
НЕОБРАТИМЫЙ. Только после явного подтверждения Сергея.
- Удалить app/admin/page.tsx
- Удалить app/api/admin/route.ts, /upload-photo, /register-photo
- Удалить ADMIN_SECRET из Vercel

### Дальнейшее развитие (после стабилизации)

- **Биллинг** — ЮKassa/Stripe, автопродление тарифов
- **SMS/Email рассылка** — SMSC.ru / Postmark вместо ручного копирования
- **Уведомления** — родитель закончил, новая заявка, дедлайн
- **Аналитика** — конверсия, воронка, время на странице
- **Миграция Storage** — Cloudflare R2 или Timeweb (без блокировок из РФ)
  Сейчас обходим прокси /api/img/, но долгосрочно лучше мигрировать Storage

### Параллельный проект: автовёрстка InDesign
Делать в отдельном чате. CSV формат задан в /api/tenant action=export_csv.
Колонки: Класс, Ученик, Портрет_страница, Обложка, Портрет_обложка, Текст,
Фото_друзья_1..10, Статус, Родитель, Телефон, Доплата, Комплектация.

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
  cover_mode CHECK: 'none' | 'optional' | 'required' | 'optional_blind'
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
- lib/supabase.ts — клиент Supabase + getPhotoUrl/getThumbUrl (через /api/img/)
- app/api/img/[...path]/route.ts — прокси фото (обход блокировки Supabase из РФ/КЗ)
- migration_v3_multitenant.sql — SQL-миграция в корне репо
- docs/migration-multitenant-guide.md — гайд по миграции старых endpoint'ов
- .github/workflows/backup.yml — автобэкап БД

### Страницы
- app/login/page.tsx — вход
- app/super/page.tsx — панель superadmin
- app/app/page.tsx — кабинет owner/manager (ОСНОВНОЙ, полнофункциональный)
- app/admin/page.tsx — СТАРАЯ админка (работает на ADMIN_SECRET, legacy)
- app/[token]/page.tsx — сценарий родителя (НЕ ТРОГАТЬ)
- app/teacher/[token]/page.tsx — ответственный родитель (НЕ ТРОГАТЬ)
- app/ref/[token]/page.tsx — реферальная форма (НЕ ТРОГАТЬ)
- app/album/[albumId]/page.tsx — общая ссылка на класс (родитель выбирает себя)
- app/invite/[token]/page.tsx — приглашение в команду
- app/t/[slug]/[token]/page.tsx — брендированный URL (редирект на /[token])

### API
- app/api/auth/route.ts — login/refresh/logout/setup/me
- app/api/super/route.ts — операции superadmin над tenants
- app/api/tenant/route.ts — операции owner/manager (полный CRUD)
- app/api/admin/route.ts — СТАРЫЙ admin API (legacy, x-admin-secret)
- app/api/img/[...path]/route.ts — прокси фото из Supabase Storage
- app/api/child/route.ts — для родителей (по токену, НЕ ТРОГАТЬ)
- app/api/select/route.ts, /draft, /quote, /teacher, /referral — для родителей/учителей
- app/api/admin/upload-photo, /register-photo — старая загрузка фото (legacy)

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
.eq('tenant_id', auth.tenantId)

// Для связанных таблиц через JOIN
.select('*, albums!inner(tenant_id)')
.eq('albums.tenant_id', auth.tenantId)
```

### URL фото — ВСЕГДА через хелперы
```typescript
import { getPhotoUrl, getThumbUrl } from '@/lib/supabase'
// Возвращают /api/img/<path> — прокси через Vercel
// НЕ строить URL вручную через NEXT_PUBLIC_SUPABASE_URL + storage/...
```

### Модалка-overlay (защита от случайного закрытия)
```typescript
const [backdropStart, setBackdropStart] = useState(false)
// onMouseDown + onMouseUp на backdrop div
```

### Audit log
```typescript
import { logAction } from '@/lib/auth'
await logAction(auth, 'album.create', 'album', albumId, { title, city })
```

---

## СТИЛИ (globals.css)

- .btn-primary — чёрная кнопка
- .btn-secondary — белая с рамкой
- .btn-ghost — серая "прозрачная"
- .card — белая карточка со скруглениями
- .input — единообразное поле ввода
- .badge-green / .badge-amber / .badge-gray / .badge-blue
- var(--font-display) — Unbounded для заголовков
- var(--font-body) — Geologica для текста (default)

---

## ЛИМИТЫ СЕРВИСОВ

- Supabase Pro: Storage 100 GB, Database 8 GB, Egress 250 GB
- Vercel Hobby: Fast Data Transfer 100 GB/мес (сейчас ~580 MB использовано)
- Vercel Function timeout: 10s (Hobby), важно для прокси больших фото
- Cron-job.org: keep-alive каждые 12ч

---

## ПЛАНЫ НА СЕЗОН 2026/2027

- Сейчас: боевой тест, 10-30 заказов
- К августу 2026 — готовая мультиаренда для демонстрации партнёрам
- Сентябрь 2026 — активное использование, ~100 заказов/месяц
- ~2500 родителей, ~40000 фото для отбора
- Миграция Storage на Cloudflare R2 или Timeweb — после стабилизации

---

## СМЕНА ПАРОЛЯ (через SQL)

```javascript
const crypto = require('crypto');
const password = 'НОВЫЙ_ПАРОЛЬ';
const salt = crypto.randomBytes(16);
const saltHex = salt.toString('hex');
crypto.pbkdf2(password, salt, 100000, 32, 'sha256', (err, dk) => {
  console.log(`pbkdf2:100000:${saltHex}:${dk.toString('hex')}`);
});
```
```sql
update users set password_hash = 'ХЕШ' where email = 'email@example.com';
```

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

## ВАЖНО: ПРАВИЛА РАБОТЫ

1. **Старые endpoint'ы /api/admin/* НЕ ТРОГАТЬ** пока активно идут заказы.

2. **Родительские страницы НЕ ТРОГАТЬ** — /[token], /teacher, /ref, /album/[id].
   Только аддитивные правки, не менять логику отбора/submit/draft.

3. **URL фото ТОЛЬКО через getPhotoUrl/getThumbUrl** из lib/supabase.ts.
   Никогда не строить вручную через NEXT_PUBLIC_SUPABASE_URL.

4. **После каждого подэтапа — обновлять контекст-файл** (новый vN).

5. **Никогда не коммитить секреты** — только через env Vercel.

6. **4.c и 4.d — только по явной команде Сергея.**

## ВАЖНЫЕ НЮАНСЫ СИСТЕМЫ

### Ссылки по токенам
- `/<token>` — страница родителя ученика (выбор фото)
- `/teacher/<token>` — страница ОТВЕТСТВЕННОГО РОДИТЕЛЯ
  (назван исторически; учителя НЕ имеют своих ссылок)
- `/ref/<token>` — реферальная форма
- `/album/<albumId>` — общая ссылка на класс (родитель выбирает себя)

### Текущие рабочие домены
- Основной: yearbook-v2.vercel.app
- album.okeybook.ru — НЕ работает без VPN из РФ
