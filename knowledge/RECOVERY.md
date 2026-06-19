# RECOVERY — восстановление проекта yearbook-v2 (OkeyBook) с нуля

Что это: SaaS-платформа сбора фотоматериалов для выпускных альбомов.
Стек: Next.js 14.2 + TypeScript + Tailwind + Supabase. Деплой: Vercel.

- Репозиторий: https://github.com/odintcovsergey/yearbook-v2
- Продакшн: https://yearbook-v2.vercel.app (домен okeybook.ru — за VPN)

---

## 1. Клонирование

```
git clone https://github.com/odintcovsergey/yearbook-v2.git ~/yearbook-v2
cd ~/yearbook-v2
git config user.email "deploy@yearbook.app"
git config user.name "Deploy Bot"
```

Для push нужен GitHub PAT (хранится в project instructions, не в репозитории).
Если git падает с 401/403 — токен протух, обновить на github.com/settings/tokens.

## 2. Установка зависимостей

Нужен Node.js LTS (v20+). Проверка: `node --version`.
```
npm install
```

## 3. База данных и хранилище (Supabase)

1. supabase.com → New project (запомнить пароль БД).
2. SQL Editor → выполнить `schema.sql` из корня репозитория.
3. Применить миграции из `migrations/` ПО ПОРЯДКУ ДАТ (имена `YYYY-MM-DD-*.sql`),
   а также корневые `migration_v2.sql`, `migration_v3_multitenant.sql` и прочие
   `*-migration.sql` (template-sets, rule-engine, workflow, personal-spread, crm).
   Часть миграций помечена «применить вручную» в контексте — не пропускать.
4. Storage → New bucket: имя `photos`, Public bucket = ВКЛ.
5. Settings → API — взять три значения для env (шаг 4).

## 4. Переменные окружения

Шаблон — `.env.example` в корне. Локально создать `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://<проект>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon public key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
ADMIN_SECRET=<пароль для /admin, 20+ символов>
JWT_SECRET=<секрет 32+ символов>
DEFAULT_TENANT_ID=<uuid тенанта по умолчанию>
```

Секреты — ТОЛЬКО в env (локально `.env.local`, прод — Vercel → Settings →
Environment Variables). Никогда в код и не в коммиты.

### Fake .env для локальной сборки/проверки (без реального Supabase)

```
cat > .env.local <<'ENV'
NEXT_PUBLIC_SUPABASE_URL=https://fake.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=fake
SUPABASE_SERVICE_ROLE_KEY=fake
ADMIN_SECRET=fake
JWT_SECRET=fake_jwt_secret_for_build_only_32chars
DEFAULT_TENANT_ID=00000000-0000-0000-0000-000000000000
ENV
```
После проверки удалить: `rm -f .env.local`.

## 5. Локальный запуск и проверки

```
npm run dev            # http://localhost:3000
npx tsc --noEmit --project .   # типы: должно быть пусто
npx next build         # сборка: должна быть зелёной (нужен .env.local)
npm test               # vitest (на v199 — 1088/1088 проходят)
```

## 6. Деплой (Vercel)

Прод-деплой автоматический: push в `main` → Vercel собирает и публикует.
Перед push обязательны зелёные `tsc --noEmit` и `next build` (см. шаг 5).
Env-переменные продакшна заданы в Vercel (не в репозитории).

## 7. Ключевые точки входа в код

- `app/` — Next.js App Router (страницы и API-роуты).
- `lib/auth.ts` — `requireAuth` / `getAuth`; все БД-запросы tenant-aware через
  `auth.tenantId`.
- Публичные страницы родителей/учителей (НЕ ломать):
  `/[token]`, `/teacher/[token]`, `/ref/[token]`, `/invite/[token]`, `/t/[slug]/[token]`.
- Экспорт CSV для автовёрстки InDesign: `/api/tenant` action=export_csv и
  `/api/admin` action=export (формат колонок — контракт со связанным проектом).
- `CLAUDE.md` в корне — рабочие правила для ассистента.
