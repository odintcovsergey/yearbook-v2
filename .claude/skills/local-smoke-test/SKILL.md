---
name: local-smoke-test
description: Прокликивание изменений на локальном dev-сервере yearbook-v2 через фоновый запуск + wait-loop + curl с авторизацией. Применять когда нужно проверить поведение вживую локально (API-роут, страница, сценарий), снять скриншот, или Сергей говорит «проверь локально», «прокликай», «запусти и посмотри». Заточен под наш запуск: Next dev на localhost:3000, cookie auth_token.
---

# Локальный smoke-тест (yearbook-v2)

## Зачем

Зелёные тесты ≠ работающий сценарий. Этот навык — как поднять dev-сервер и
реально потрогать роут/страницу локально, не угадывая.

## Запуск dev-сервера (фон + wait-loop)

Запустить `npm run dev` в фоне с логом, дождаться готовности по строке
`Ready in`, таймаут ~60с:

```bash
npm run dev > /tmp/yearbook-dev.log 2>&1 &
# дождаться готовности
timeout 60 bash -c 'until grep -q "Ready in" /tmp/yearbook-dev.log; do sleep 1; done' \
  && echo "READY" || echo "TIMEOUT — см. /tmp/yearbook-dev.log"
```

Сервер на `localhost:3000`.

## Авторизованные запросы

Cookie называется **`auth_token`** (НЕ `access_token`). JWT берётся из
DevTools браузера (Application → Cookies).

```bash
curl -s -b "auth_token=$JWT" http://localhost:3000/api/tenant | head
```

## Что проверять

- API-роут отдаёт ожидаемый JSON (формат, не только 200)
- Страница рендерится без ошибок в логе
- Конкретный сценарий, который менял

## Грабли проекта

- Cookie `auth_token`, а не `access_token` — частая путаница
- `.env.local` должен быть с НАСТОЯЩИМИ значениями (не заглушки CI)
- PostgREST nested-aggregate: `select('foo(count)')` →
  `foo: [{count: number}]` (массив с объектом, не число)
- Supabase query builder с условными фильтрами: `let q; q = q.or(...)`,
  не `const q; q.or(...)` — иначе immutability обманывает

## После проверки

Заглушить фоновый сервер, если больше не нужен. Честно сказать Сергею, что
именно прокликал, а что нет — не выдавать «тесты зелёные» за ручную проверку.

## Анти-паттерны

- Выдавать зелёные тесты за ручной smoke
- curl с `access_token` (не та cookie) → 401 и ложный вывод «сломано»
- Забыть про настоящий `.env.local` перед запросами к БД
