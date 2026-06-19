# RECOVERY — восстановление yearbook-v2 с нуля

Как поднять проект на новой машине. **Без секретов** — здесь только названия
переменных и шаги. Значения берутся из безопасного хранилища (менеджер паролей /
Vercel / Supabase / Yandex Cloud консоли).

## 1. Клонирование (два зеркала)

Основное (GitHub):
```bash
git clone https://github.com/odintcovsergey/yearbook-v2.git
cd yearbook-v2
```

Резервное (GitFlic) — если GitHub недоступен:
```bash
git clone https://gitflic.ru/project/odintcovsergey/yearbook-v2.git
```

Настроить двойной push (origin → оба зеркала):
```bash
git remote add gitflic https://gitflic.ru/project/odintcovsergey/yearbook-v2.git
git remote set-url --add --push origin https://github.com/odintcovsergey/yearbook-v2.git
git remote set-url --add --push origin https://gitflic.ru/project/odintcovsergey/yearbook-v2.git
# проверка: git remote -v → origin (push) должен показывать оба URL
```

## 2. Зависимости и проверка

```bash
npm install
npx vitest run        # тесты
npx tsc --noEmit      # типы
npx next build        # сборка
npm run dev           # локально на localhost:3000
```

## 3. Переменные окружения

Создать `.env.local` в корне. Шаблон названий — `.env.example`. Полный список имён,
которые читает код (значения — НЕ здесь, взять из Vercel / Supabase / YC):

**Supabase**
- `NEXT_PUBLIC_SUPABASE_URL` — URL проекта Supabase
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — публичный anon-ключ
- `SUPABASE_SERVICE_ROLE_KEY` — сервисный ключ (только сервер, секрет)

**Auth / служебное**
- `JWT_SECRET` — подпись cookie `auth_token`
- `ADMIN_SECRET` — bootstrap setup-экшена
- `CLEANUP_SECRET` — служебный секрет очистки
- `DEFAULT_TENANT_ID` — id тенанта по умолчанию

**Yandex Cloud S3 (хранилище фото/оригиналов/PDF)**
- `YC_ACCESS_KEY_ID`
- `YC_SECRET_ACCESS_KEY`
- `YC_BUCKET_NAME`

**Прочее**
- `ANTHROPIC_API_KEY` — если используется AI-функционал
- `NODE_ENV` — стандартная (Next выставляет сам)

> Значения этих переменных НИГДЕ в репозитории не хранить. На Vercel они заданы в
> Project → Settings → Environment Variables.

## 4. База данных (Supabase)

- Схема с нуля: применить `schema.sql` в Supabase Studio → SQL Editor.
- Затем по порядку — датированные миграции из `migrations/` (2026-MM-DD-*.sql),
  которые ещё не вошли в `schema.sql`.
- Storage: бакет(ы) под фоны/обложки + основной бакет фото. Бакет фото детей —
  ПРИВАТНЫЙ (доступ через signed URL).

## 5. Хранилище Yandex Cloud

- S3-совместимый бакет (`YC_BUCKET_NAME`), приватный. Сервисный аккаунт с ключами
  (`YC_ACCESS_KEY_ID` / `YC_SECRET_ACCESS_KEY`). Раздача фото — напрямую с YC по
  signed URL (минуя Vercel).

## 6. Деплой (Vercel)

- Vercel-проект привязан к репозиторию **GitHub** (origin). Auto-deploy: push в
  `main` → продакшен; push в любую ветку → preview-деплой (ссылка
  `yearbook-v2-git-<ветка>-<scope>.vercel.app`).
- Переменные окружения — в Vercel Project Settings (Production + Preview).
- Тариф: бесплатный (Hobby). Лимит времени функции влияет на синхронный экспорт PDF
  (см. `DECISIONS.md` / `PROJECT_CONTEXT.md`).
- Откат: в Vercel → Deployments → выбрать прошлый успешный → Promote/Rollback.

## 7. Бэкапы

- Скрипты в `scripts/` (`backup-local.sh`, `backup-db.sh`).
- Git — два зеркала (см. п.1). Если GitHub отвалится: `git push gitflic main`.
