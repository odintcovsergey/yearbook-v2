# Фаза РЭ.27 — `print_type` в альбоме + правила переплёта

**Статус**: ✅ Закрыта
**Сроки**: 21.05.2026 (одна сессия от РЭ.27.0 до РЭ.27.8)
**Главная цель**: перевести тип переплёта (`layflat` / `soft`) из пресета в альбом. Это даёт возможность менять тип листов БЕЗ смены пресета, готовит почву под слияние дубль-пресетов вида «Стандарт-layflat / Стандарт-soft» в один «Стандарт», и формализует полиграфические правила для мягкого переплёта (форзацы, запрет фото-на-разворот).

## Что было до фазы

После РЭ.22 (семантический engine), РЭ.24 (каталог шаблонов) и РЭ.25 (галка покупки) система пришла к двум движкам сборки:
- **Movement v2** — `buildAlbum` через `config_preset_id` (legacy, slug-based).
- **Movement v3** — `buildFromSectionStructure` через `section_structure_preset_id` (новый, uuid-based, РЭ.21+).

Оба движка читали `print_type` **только** из пресета. Это вело к проблемам:

1. **Дубль-пресеты:** каждая комплектация дублировалась в БД — «Стандарт-layflat» и «Стандарт-soft». Идентичные секции и личный раздел, отличался только `print_type`. В прод-БД были 7 пар = 14 записей в `config_presets`.

2. **Тип переплёта нельзя было сменить независимо.** Если партнёр хотел поменять альбом с твёрдых листов на мягкие — нужно было сменить весь пресет.

3. **Правила мягкого переплёта не формализованы:**
   - Мастер «фото на разворот» (`J-Spread`) пересекал бы корешок — допустим только для layflat.
   - Первая страница книги должна быть правой (титульная, нечётная) с физическим форзацем слева.
   - Последняя — левой (чётной) с форзацем справа.

4. **Раннее предположение в РЭ.24-spec §13** — двойной редактор (постраничный для soft, разворотный для layflat). Это сильно усложняло фазу.

## Что сделано

### 0. Spec фазы (РЭ.27.0, commit `266341a`)

`docs/phase-Р27-spec.md` — 7 архитектурных развилок согласованы:

- **A.** Один разворотный редактор для всех альбомов. Вёрстка ВСЕГДА разворотами, как в InDesign — деление на страницы только при экспорте PDF. **Отказ от двойного редактора** из Р24-spec §13. Это сократило фазу с 10-15 коммитов до 9-10, риск регрессий минимальный.
- **B.** `print_type` живёт в `albums.print_type` + fallback на `preset.print_type` через `resolvePrintType(album, preset)`.
- **C.** Автозаглушка «Форзац» — водяной знак бледным курсивом по центру белой страницы. На первом левом и последнем правом развороте soft.
- **D.** Миграция `print_type` для существующих альбомов — автоматически из пресета (это подэтап 27.7).
- **E.** Фильтр spread-мастера для soft — защита в **двух местах**: engine (последний рубеж) + UI (UX).
- **F.** Слияние дубль-пресетов — **Вариант A (агрессивный)**: перепривязка ссылок → удаление осиротевших → переименование. Колонку `config_presets.print_type` оставляем как deprecated.
- **G.** Подтверждение в UI при смене типа листов если есть spread-мастера — отложено (в текущем `template_set` нет spread-мастеров).

### 1. Миграция схемы (РЭ.27.1, commits `d4ff79e` + `5a52544`)

**⚠️ Открытие №1:** при проверке прод-БД оказалось, что колонка `albums.print_type TEXT NULL` **уже существует с 8 мая 2026** (миграция 1.0, `migrations/2026-05-08-album-config.sql`). Там же `CHECK constraint print_type IN ('layflat', 'soft')`. И в API `create_album` уже копировался `preset.print_type → albums.print_type`. Распределение в проде: layflat=4, soft=2, NULL=6.

Что реально сделано в 27.1:
- `ADD COLUMN IF NOT EXISTS` — no-op (колонка была).
- `COMMENT ON COLUMN` обновлён с привязкой к РЭ.27.
- `CREATE INDEX IF NOT EXISTS idx_albums_print_type` — partial index `WHERE print_type IS NOT NULL`. Раньше его не было.
- Корректировка spec §2.0 — фиксирует найденное «как есть» состояние схемы.

Применено в Supabase 21.05.2026.

### 2. API: явный print_type (РЭ.27.2, commit `3096c18`)

**⚠️ Открытие №2:** `update_album.allowedFields` уже содержал `'print_type'`. Но в `update_album` была строка, **перезаписывающая** `body.print_type` значением из пресета при смене `section_structure_preset_id`. Партнёр через API не мог поменять тип независимо от пресета.

Что сделано:

- **`create_album`** — добавлен приоритет:
  1. `body.print_type` если явно передан и валиден (`'layflat'` или `'soft'`).
  2. `presetPrintType` (текущее поведение, копирование из пресета).
  3. `null` (engine применит fallback в 27.3).

- **`update_album`** — инвертирована логика: при смене `section_structure_preset_id` подтягиваем `print_type` из пресета **только если** `body.print_type` не передан. Если передан явно — приоритет за ним.

- **Валидация:** явная проверка `print_type IN ('layflat', 'soft')` на уровне API → 400 вместо 500 от Supabase CHECK.

- **`types/index.ts`:** новый `export type PrintType = 'layflat' | 'soft'` + `Album.print_type?: PrintType | null`.

### 3. Engine: resolvePrintType + правила (РЭ.27.3, commit `d8ea615`)

**Главная работа фазы.** Три новых чистых модуля в `lib/album-builder/` (паттерн как `filter-by-purchase` из РЭ.25.3 — без зависимости от Supabase, тестируются напрямую):

**3a) `lib/album-builder/print-type-resolver.ts`:**
- `resolvePrintType(albumPrintType, presetPrintType): PrintType`
  Приоритет: album → preset → `'layflat'` (финальный default).
- `printTypeToSheetType` / `sheetTypeToPrintType` — bridge между PrintType (старый движок: `'layflat'|'soft'`) и SheetType (новый движок: `'hard'|'soft'`).

**3b) `lib/album-builder/endpaper-rules.ts`:**
- `getEndpaperRules(printType): EndpaperSpec[]`
  Описывает где должны быть форзацы для soft (`first_left` + `last_right`). Для layflat — пустой массив.
- ВАЖНО: это функция **плана** правил, не их применения. Применение и отрисовка пришли в 27.4.

**3c) `lib/album-builder/spread-master-filter.ts`:**
- `isSpreadMaster(master)` — детекция по имени (содержит `Spread`) и по `page_role` (`common_spread` / `student_spread` для будущих расширений).
- `isMasterAllowedForPrintType(master, printType)` — для layflat true для всех, для soft блокирует spread.

**Интеграция в `app/api/layout/route.ts`:**

- **Movement v2** (legacy `buildAlbum`): после `loadPresetById` — override `preset.print_type` значением из `resolvePrintType(album.print_type, preset.print_type)`. Mutating preset безопасно — `loadPresetById` возвращает свежую копию.
- **Movement v3** (`buildFromSectionStructure`): после `loadBundle` — отдельный SELECT `albums.print_type`, override `bundle.preset.print_type` И `bundle.preset.sheet_type` синхронно (новый движок использует оба поля для `soft_intro`/`soft_final`).
- SELECT albums расширен полем `'print_type'`.

**Unit-тесты (30 новых):**
- `print-type-resolver.test.ts` — 14 тестов (приоритет, fallback, default, bridge).
- `spread-master-filter.test.ts` — 12 тестов (детекция, edge cases, фильтр для типов).
- `endpaper-rules.test.ts` — 4 теста (layflat пустой, soft два правила, лейблы, иммутабельность).

После 27.3 на main 437/437 тестов (407 + 30).

### 4. UI редактора (РЭ.27.4, commits `2ca86f2` + `504e0c4`)

**API расширение** — `app/api/tenant/route.ts` `action='album'` возвращает `effective_print_type` (вычислено на сервере через тот же принцип что в layout API).

**⚠️ Открытие №3:** в первой версии 27.4 для legacy-fallback я писал `.from('presets').eq('slug', cfgId)`. В Postgres две разные таблицы пресетов:
- `presets` — новая (РЭ.21+, секции, uuid-связь, **без slug**).
- `config_presets` — старая (legacy, slug-связь).

Симптом: для legacy-альбомов `effective_print_type` всегда оставался `'layflat'` — приложение не падало (`maybeSingle()` возвращал null), просто значение неточное. **Fix `504e0c4`:** `.from('config_presets').eq('slug', cfgId)`.

**UI (`app/app/album/[id]/layout/page.tsx`):**

1) **Информационная плашка для soft-альбомов** — жёлтая карточка над canvas: «📖 Мягкий переплёт. На первом и последнем разворотах одна страница — это физический форзац типографии».

2) **Визуальная заглушка «Форзац»** — новый компонент `EndpaperPlaceholder`. Белая страница с тонкой рамкой и водяным знаком «Форзац» бледным курсивом (italic, text-gray-300, размер пропорционален высоте).
   - Soft + первый spread (`currentIdx === 0`) → заглушка СЛЕВА от canvas, реальная страница СПРАВА (правая, титульная).
   - Soft + последний spread → реальная СЛЕВА (последняя левая), заглушка СПРАВА.
   - Для layflat — ничего не показывается, поведение как раньше.

**Архитектурное решение 27.4 — рефлексия:** изначально планировалось вставлять `EndpaperPlaceholder` в `layout.spreads` как синтетический spread с magic `template_id`. При проработке оказалось что это ломает много мест (drag-drop, swap, replace, FK к templates). **UI-only визуализация** — самое безопасное и достаточное решение. Никаких изменений в данных, БД, engine.

### 5. UI палитры мастеров (РЭ.27.5, commit `ed380a3`)

`app/app/_components/TemplatePickerModal.tsx` — новый опциональный пропс `printType?: 'layflat' | 'soft'`. Для soft spread-мастера показаны:
- `opacity-40` (визуально приглушены)
- `cursor-not-allowed`
- title: «Недоступно для мягких листов — мастер «фото на разворот» пересёк бы корешок»
- Подпись «не для мягких листов» под названием
- HTML `disabled` + JS guard в `onClick` (двойная защита)

В layout viewer'е передаётся в обе точки вызова (М.2 «Добавить разворот» и М.3 «Заменить шаблон»).

**Защита spread-мастеров теперь в двух местах:**
- **Engine** (РЭ.27.3): `isMasterAllowedForPrintType` фильтрует в build — последний рубеж.
- **UI** (РЭ.27.5): TemplatePickerModal visually disabled — UX.

### 6. UI формы альбома (РЭ.27.6, commit `c421897`)

Новый селект **«Тип листов в альбоме»** в `app/app/page.tsx` (AlbumFormModal):

- Опции: «Из шаблона (по умолчанию)» (`value=''`) / «Твёрдые листы (layflat)» / «Мягкие листы (soft)».
- Сохраняется в `albums.print_type` через `body.print_type` (API с РЭ.27.2).
- Работает на create и update.
- Engine применит при следующей пересборке.

Поле в `FormData` называется `print_type_override` — чтобы не путать с **legacy** полем `print_type`, которое используется для построения `preset_slug` (комплектация+тип) в старом-форме флоу.

### 7. Миграция данных (РЭ.27.7, commits `ec08837` → `199e2a9` → `a936964` → `8cd1090`)

**⚠️ Открытие №4:** миграция v1 (`ec08837`) предполагала `albums.config_preset_id = text` и JOIN по `config_presets.slug`. Реально `config_preset_id` это **uuid**, FK на `config_presets.id`. Транзакция `BEGIN/COMMIT` защитила — откатилось атомарно, БД не пострадала.

**Миграция v2 (`199e2a9`)** — переписана через UUID:

```sql
BEGIN;

-- ШАГ 1: заполнение NULL print_type через JOIN UUID=UUID
UPDATE albums a SET print_type = cp.print_type
FROM config_presets cp
WHERE a.config_preset_id = cp.id AND a.print_type IS NULL;

-- ШАГ 2: 7 UPDATE'ов перепривязки soft → layflat по UUID
UPDATE albums SET config_preset_id = '98bfb269...'::uuid -- individual-layflat
WHERE config_preset_id = 'a126aace...'::uuid;            -- individual-soft
-- ... ещё 6 пар

-- ШАГ 3: DELETE FROM config_presets WHERE slug IN (7 soft-slug'ов)

-- ШАГ 4: 7 UPDATE'ов config_presets SET slug=name= (убрать суффикс)
UPDATE config_presets SET slug = 'individual', name = 'Индивидуальный'
WHERE slug = 'individual-layflat';
-- ... ещё 6

COMMIT;
```

**Ключевой инсайт:** связь `albums ↔ config_presets` идёт через UUID. `config_presets.slug` это только человекочитаемый ярлык. Менять slug безопасно — FK через `id` не сломается.

**Дополнительная миграция 27.7b (`a936964`):**

После основной миграции 6 альбомов остались с NULL — это **черновики без пресета** (`config_preset_id IS NULL AND section_structure_preset_id IS NULL`). UPDATE через JOIN их не затронул. Для них проставлен `'layflat'` дефолтом — не влияет на сборку (без пресета она всё равно не запускается), но даёт чистую модель данных.

**Cleanup кода 27.7c (`8cd1090`):**

- `app/app/page.tsx` submit-path: `preset_slug: \`${form.config_type}-${form.print_type}\`` → `preset_slug: form.config_type`. После слияния slug'ов с суффиксом больше нет.
- Подсказка «Выбран пресет X» в форме — slug строится без суффикса.
- Комментарий в `lib/album-builder/load-template-set.ts` — обновлены примеры.

### Финальное состояние БД (после всех миграций 27.7)

**`albums.print_type` (12 записей):**
| print_type | count |
|---|---|
| layflat | 9 |
| soft | 3 |
| NULL | **0** |

**`config_presets` (7 записей):**
| slug | name | print_type |
|---|---|---|
| individual | Индивидуальный | layflat |
| light | Лайт | layflat |
| maximum | Максимум | layflat |
| medium | Медиум | layflat |
| mini | Мини | layflat |
| standard | Стандарт | layflat |
| universal | Универсал | layflat |

В каталоге `/app/templates` партнёр теперь видит **7 чистых пресетов вместо 14**. Тип переплёта выбирается в форме альбома, не привязан к пресету.

## Архитектурное решение фазы

`resolvePrintType(albumPrintType, presetPrintType): PrintType` в `lib/album-builder/print-type-resolver.ts` — **тонкий override-слой перед engine**. Чистая функция без зависимостей от Supabase.

Что **не** сделано (намеренно):
- Engine не переписан — он по-прежнему читает `preset.print_type` / `preset.sheet_type`. Просто перед его вызовом мы переопределяем эти поля в bundle через `resolvePrintType(album.print_type, preset.print_type)`.
- Логика first/last для soft — описана как функция `getEndpaperRules`, но **не применяется в layout**. Визуализация форзацев — UI-only, не трогает данные.

Это даёт:
- Малый размер изменения в самом engine (10-15 строк override-кода в `layout/route.ts`).
- Существующие 407 unit-тестов engine продолжают проходить.
- Возможность безопасной отмены — достаточно убрать override-блок, всё вернётся к чтению из пресета.

## Ключевые архитектурные развилки (сводка)

| # | Развилка | Решение |
|---|---|---|
| A | Двойной редактор (по типу переплёта)? | НЕТ. Один разворотный для всех. Объём фазы упал с 10-15 до 9-10 коммитов. |
| B | Где живёт `print_type`? | `albums.print_type` + fallback на пресет через `resolvePrintType`. |
| C | Как показать форзац? | Белая страница с водяным знаком «Форзац» бледным курсивом. UI-only. |
| D | Как мигрировать существующие альбомы? | UPDATE через JOIN с `config_presets`, 6 черновиков → `'layflat'` дефолтом. |
| E | Фильтр spread-мастера для soft? | Защита в двух местах: engine + UI. |
| F | Что с дубль-пресетами? | Вариант A — слияние: перепривязка + удаление soft-вариантов + переименование. |
| G | Confirmation при смене типа листов? | Отложено. В текущем template_set нет spread-мастеров — реальной проблемы нет. |

## ⚠️ Уроки фазы — 4 расхождения ментальной модели и реальности БД

Эта фаза вскрыла четыре момента, где моё представление о схеме БД не соответствовало действительности. Все ловились, БД не пострадала (помогли `IF NOT EXISTS`, `maybeSingle()`, транзакции `BEGIN/COMMIT`). Но это привело к 2-3 лишним итерациям и фиксам.

1. **РЭ.27.1**: колонка `albums.print_type` **уже существовала** с 8 мая 2026. Миграция v1 оказалась no-op в части `ADD COLUMN`. Реально полезное действие — создание индекса. Если бы заранее посмотрел `information_schema.columns`, написал бы миграцию точнее.

2. **РЭ.27.2**: `update_album.allowedFields` уже содержал `'print_type'`, но был перетирающий код. Работа подэтапа = инвертировать приоритет, а не «добавить новое поле». Если бы заранее сделал `grep print_type app/api`, увидел бы существующую логику.

3. **РЭ.27.4**: запрашивал `.from('presets').eq('slug', cfgId)`. В Postgres **две разные таблицы пресетов**: `presets` (новая, uuid, без slug) и `config_presets` (legacy, с slug). Fix потребовал отдельный коммит `504e0c4`.

4. **РЭ.27.7**: миграция v1 предполагала `config_preset_id = text`, JOIN по slug. Реально `config_preset_id = uuid`, FK на `config_presets.id`. Транзакция откатилась, миграция v2 переписана через UUID.

**Правило на будущее** (записано в spec, не «принцип», а обязательное действие):

> Перед каждым подэтапом, особенно с миграцией:
> 1. `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '...'` — снять реальную схему всех затрагиваемых таблиц.
> 2. Сделать test JOIN на 5 строках чтобы убедиться что связи работают как предполагается.
> 3. Только потом писать код миграции / запрос.

Все четыре открытия фазы зафиксированы как **первичные** уроки. Цена их отлова была минимальная благодаря защитным механизмам (атомарные транзакции, `IF NOT EXISTS`, `maybeSingle()`), но в более рискованной фазе они стоили бы дороже.

## Что НЕ сделано (фиксируется как долг)

1. **Удаление колонки `config_presets.print_type`.** Оставлена как deprecated legacy fallback для случая `albums.print_type IS NULL` (теоретически могут появиться через ручной UPDATE). Удалить можно в отдельной зачистке через 1-2 фазы стабильности.

2. **Confirmation в UI при смене типа листов** если в альбоме уже есть spread-мастера (развилка G). Сейчас в `template_set okeybook-default` spread-мастеров нет, реальной болью это не является. Можно добавить когда дизайнер положит `J-Spread` в IDML.

3. **PDF-экспорт с водяным знаком «Форзац».** UI-визуализация работает. В PDF-pipeline (`lib/pdf-export/`) — отдельная фаза.

4. **Расширенные `page_role` (`common_spread`, `student_spread`).** Функция `isSpreadMaster` учитывает их при детекции, но IDML-конвертер их ещё не размечает. Появятся когда понадобятся.

5. **Принудительная парность страниц для soft.** Если у партнёра в альбоме непарное число контентных страниц — последний разворот будет «недокомплектным» (одинокая правая страница без форзаца). Сейчас engine этого не ловит. Сознательное решение: лучше показать партнёру несоответствие, чем тихо подсунуть пустую страницу. Если станет болью — добавим в будущей фазе.

## Статистика фазы

- **Коммитов в фазе (исключая контексты): 12** — `266341a..d4ad4ba`. Включая 1 fix (`504e0c4`) и 1 миграцию-rewrite (`199e2a9` после `ec08837`).
- **Контекстных коммитов: 9** — v126..v134.
- **SQL миграций: 3** — schema (`27.1`), data + merge (`27.7`), drafts (`27.7b`). Все применены в Supabase.
- **Новых unit-тестов: 30** — 407 → 437 на main.
- **Затронуто файлов кода: ~10** (см. ниже).
- **Длительность: одна сессия** (21.05.2026), включая 4 разбора расхождений со схемой.

## Ключевые файлы фазы

**Новые модули (engine):**
- `lib/album-builder/print-type-resolver.ts` — чистая функция resolvePrintType + bridge с SheetType.
- `lib/album-builder/endpaper-rules.ts` — план правил форзацев (не применяется в layout).
- `lib/album-builder/spread-master-filter.ts` — isSpreadMaster + isMasterAllowedForPrintType.
- `lib/album-builder/__tests__/print-type-resolver.test.ts` — 14 тестов.
- `lib/album-builder/__tests__/spread-master-filter.test.ts` — 12 тестов.
- `lib/album-builder/__tests__/endpaper-rules.test.ts` — 4 теста.
- `lib/album-builder/index.ts` — публичный экспорт новых модулей.

**Миграции БД:**
- `migrations/2026-05-21-albums-print-type.sql` — индекс + COMMENT (27.1).
- `migrations/2026-05-21-albums-print-type-data-and-preset-merge.sql` — слияние пресетов v2 (27.7).
- `migrations/2026-05-21-albums-print-type-fill-draft-albums.sql` — заполнение черновиков (27.7b).

**API:**
- `app/api/tenant/route.ts`:
  - `create_album` — приоритет `body.print_type` над пресетом.
  - `update_album` — инвертирован перезаписывающий код, явная валидация.
  - `action='album'` — возвращает `effective_print_type`.
- `app/api/layout/route.ts`:
  - SELECT albums расширен `print_type`.
  - Movement v2 и v3: override `preset.print_type` / `bundle.preset.print_type+sheet_type`.

**UI:**
- `app/app/album/[id]/layout/page.tsx` — EndpaperPlaceholder, информационная плашка, передача printType в TemplatePickerModal.
- `app/app/_components/TemplatePickerModal.tsx` — фильтр spread-мастеров (disabled + tooltip).
- `app/app/page.tsx` (AlbumFormModal) — селект «Тип листов», cleanup preset_slug.

**Типы:**
- `types/index.ts` — `PrintType` type + `Album.print_type?: PrintType | null`.

## Связь со следующими фазами

**РЭ.28 (партнёрские дизайны, сценарий A) — будет проще.** Партнёр копирует **один** пресет «Стандарт» с переопределением размеров — а не выбирает между двумя дубль-вариантами. Число копируемых пресетов сократилось в 2 раза.

**РЭ.29+ (партнёрский IDML, сценарий B) — не пересекается напрямую.** Когда дизайнер начнёт размечать `J-Spread` мастера и роли `common_spread` / `student_spread` — функция `isSpreadMaster` их уже учитывает.

---

**Конец summary РЭ.27.**
