# scripts/dev/

Скрипты для **локальной отладки**. Не запускаются в проде / на Vercel.

- Папка добавлена в `.vercelignore` — не попадает в production deployment.
- Проходят `tsc --noEmit` (`tsconfig.json` включает `**/*.ts`) — это safety, чтобы скрипты не сгнили.
- Запуск через `tsx`: `npx tsx scripts/dev/<file>.ts`.

## Что здесь сейчас

| Файл | Назначение | Появится в |
|---|---|---|
| `parse-test.ts` | Sanity-проверка `lib/idml-converter` против `docs/templates/Плотные Мастер Белый.idml` — сверяет позиции ключевых плейсхолдеров с эмпирическими значениями из `docs/templates/idml-recon-notes.md` §3. | коммит 0.2.2 |

## Что сюда НЕ кладём

- Production CLI (`scripts/convert-idml.ts` и т.п.) — они в `scripts/` (без `dev/`), их Vercel видит и они проходят все проверки.
- Одноразовые миграции данных — лучше отдельный SQL или ad-hoc скрипт вне репо.
