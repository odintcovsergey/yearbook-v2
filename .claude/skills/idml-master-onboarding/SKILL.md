---
name: idml-master-onboarding
description: Процедура загрузки нового мастера (spread_template) из IDML-файла в yearbook-v2. Применять когда Сергей присылает .idml и говорит «загрузи мастер», «добавь шаблон», «вот новый разворот», или когда нужно подключить ждущие мастера (N-Grid-Page-9, J-Combined-Tail-*, J-Collage-*). Многошаговый процесс ~30-45 мин с граблями по привязкам альбомов и family-mapping.
---

# Загрузка мастера из IDML (yearbook-v2)

## Зачем

Мастер — прототип страницы/разворота из IDML. Чтобы билдер альбома его
использовал, мало распарсить геометрию: нужно правильно заполнить
`page_role`/`slot_capacity` и завести в `family-mapping.ts`, иначе
`findStudentMaster` его не пропустит.

## Ключевые файлы

- `lib/idml-converter/extract-geometry.ts` — геометрия фреймов
- `lib/idml-converter/extract-styles.ts` — штатные Stroke + Outer Glow, стили
- `lib/idml-converter/family-mapping.ts` — **единственный** источник
  `page_role`/`slot_capacity`/`applies_to_configs`
- `lib/idml-converter/upload.ts` — заливка в `spread_templates`
- `lib/rule-engine/students.ts` — `findStudentMaster` (фильтрует по этим полям)

## Процесс

### 1. Разобрать, что за мастер

- К какой **семье** относится (E-Universal, M-Grid-Page, J-Combined-Tail…)?
- Какой `page_role` (student_left/right/grid, teacher_left/right, common,
  intro, final)?
- Какой `slot_capacity` (сколько учеников/фото, есть ли портрет/имя/цитата)?
- Проверить **Script Labels** в IDML — это канонические имена плейсхолдеров
  (`studentportrait_N`, `studentname_N`, `studentquote`, `classphotoframe`,
  `quarterphoto_N`, `sixthphoto_N`, `headteachername`, …). Произвольные имена
  (`static_text_1`) трактуются как декоративный текст с `default_text`.

### 2. Обновить family-mapping.ts

Завести/поправить запись для семьи мастера: `page_role`, `slot_capacity`,
`applies_to_configs`. **Если структура мастера нестандартная** (например,
добавили фото с друзьями) — обновить mapping, иначе фильтр не пропустит.

### 3. Загрузить IDML

Через пайплайн загрузки (`lib/idml-converter/upload.ts` / соответствующий
API-роут). Проверить, что парсер заполнил `page_role`+`slot_capacity`
(парсер это умеет с РЭ.58).

### 4. ⚠️ force=true ломает привязки альбомов

`force=true` upload делает DELETE+INSERT → `template_id` меняется → у
существующих альбомов рвётся привязка к мастеру.
- В тесте/деве — ок.
- В **проде** — НЕ перезаливать через force. Версионирование через новые
  slug. Если мастер уже привязан к альбомам — это не «обновить», а «завести
  новую версию».

### 5. Проверить вживую

- Канвас редактора (`AlbumSpreadCanvas.tsx`) — мастер рисуется, учитывает
  `rotation_deg`, плейсхолдеры на местах
- Билдер реально выбирает мастер для подходящего класса
- Если декор/текст-эффекты — глянуть и PDF-экспорт

### 6. Тесты + проверки

`npx vitest run` / `npx tsc --noEmit` / `npx next build` зелёные перед
коммитом.

## Грабли проекта

- Забыли `family-mapping.ts` → мастер загрузился, но билдер его «не видит»
- `force=true` на проде → массово порвал привязки альбомов
- Произвольный Script Label принят за плейсхолдер (или наоборот) → пустой
  слот или потерянный декоративный текст

## Анти-паттерны

- Загрузить мастер, не тронув family-mapping
- force=true перезалив на проде «чтобы обновить»
- Считать «парсер прошёл» = «билдер использует» (это разные вещи)
