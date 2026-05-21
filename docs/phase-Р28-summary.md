# Фаза РЭ.28 — Партнёрские дизайны (сценарий A — клон template_set с resize)

**Статус**: ✅ Закрыта
**Сроки**: 21.05.2026 (одна сессия от РЭ.28.0 до РЭ.28.6)
**Главная цель**: дать партнёру возможность скопировать глобальный `template_set` с **изменёнными размерами страницы** под свою типографию. Мастера и placeholder'ы пересчитываются пропорционально с округлением до целых пикселей при 300 DPI.

## Что было до фазы

После РЭ.24 (каталог `/app/templates` для партнёра) и РЭ.27 (тип переплёта переехал в альбом, дубль-пресеты слиты) — система работала так:

- В БД 3 глобальных `template_set`'а (`tenant_id IS NULL`) от OkeyBook: A4 и 226×288.
- Партнёр выбирал один из них для своих альбомов.
- **Подстроить под свою типографию** размеры было нельзя.

Это блокировало партнёров с собственной типографией где другие размеры (например 19×29 или премиум 225×305). Им приходилось использовать стандартные размеры «как есть» с обрезкой типографией, или ждать пока Сергей вручную добавит их формат через `/super` загрузкой IDML.

Архитектурно `template_sets.tenant_id` уже поддерживал партнёрские дизайны (NULL = глобальный, иначе тенантский), и `designs_list` уже фильтровал «свои + глобальные». То есть **бэкенд каталога был готов** — нужно было только добавить мощность создать запись с `tenant_id=auth.tenantId` через UI.

## Что сделано

### 0. Spec фазы (РЭ.28.0, commit `1193b5d`)

`docs/phase-Р28-spec.md` v1.0 (553 строки). 8 архитектурных развилок A..H согласованы с Сергеем перед началом работы:

- **A.** Глубокая копия: `template_set` + все `spread_templates`, не ссылка. Партнёрский клон — независимый snapshot.
- **B.** Три уровня совместимости пропорций: <5% `ok` / 5-10% `warning` / >10% `blocked`.
- **C.** `print_type` копируется из источника. На уровне РЭ.27 этот параметр живёт в `albums.print_type`, на template_set остаётся для бэк-совместимости.
- **D.** Удаление клона разрешено только если 0 ссылок из `albums` и `presets`.
- **E.** `slug` у клона = NULL (опциональное поле).
- **F.** `is_global` у клона = false (явно, дубль `tenant_id IS NULL`).
- **G.** Партнёр редактирует name + page sizes + опциональный bleed. Всё остальное копируется из источника.
- **H.** Округление до целых пикселей при **300 DPI** хардкодом (не показывается партнёру как параметр). Шаг ≈ 0.0847 мм. В UI рядом с mm-полями показывается `≈ NNNN px`.

Spec также зафиксировал реальную схему `template_sets` (15 колонок) и `spread_templates` (25 колонок) через выгрузку `information_schema` — это применение урока из РЭ.27 §«Уроки фазы».

### 1. Миграция БД (РЭ.28.1, commit `68a7f0a`)

`migrations/2026-05-21-template-sets-parent.sql`:

```sql
ALTER TABLE template_sets
  ADD COLUMN IF NOT EXISTS parent_template_set_id uuid NULL
    REFERENCES template_sets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_template_sets_parent
  ON template_sets(parent_template_set_id)
  WHERE parent_template_set_id IS NOT NULL;
```

Самоссылочный FK для трейсинга «этот клон сделан на основе...». `ON DELETE SET NULL` — если оригинал удалят (теоретически), клон не удаляется каскадно, просто теряет связь. Partial index покрывает только клоны (у оригиналов всегда NULL).

Аддитивно, zero-downtime. Применено в Supabase 21.05.2026. Проверка через `information_schema`: колонка существует, у всех 3 существующих template_set'ов значение NULL.

### 2. Чистые утилиты + 55 unit-тестов (РЭ.28.2, commit `888f58c`)

**Главная инженерная часть фазы.** 5 новых файлов в `lib/template-set-clone/` — чистые функции без зависимости от Supabase, тестируются напрямую (паттерн как `lib/album-builder/print-type-resolver.ts` из РЭ.27.3 и `lib/smart-fill/filter-by-purchase.ts` из РЭ.25.3).

**`constants.ts`:**
```typescript
export const PRINT_DPI = 300;
export const MM_STEP = 25.4 / PRINT_DPI; // ≈ 0.0847 мм
```

**`round-to-pixels.ts`:**
- `roundMmToPx(mm)` — округление до ближайшего целого пикселя при 300 DPI (значение остаётся в мм, но кратно MM_STEP). Идемпотентно.
- `mmToPx(mm)` — конверсия в целые пиксели для UI-подсказки `≈ NNNN px`.

**`aspect-compatibility.ts`:**
- `checkAspectCompatibility(oldW, oldH, newW, newH)` возвращает `{ level, aspect_diff_percent, message }`.
- Метрика разницы аспектов: `max(a/b, b/a) - 1` — симметрична.
- Три уровня по spec §3.3 с осмысленными сообщениями на русском.

**`resize-placeholder.ts`:**
- `resizePlaceholder<P>(p, scaleX, scaleY): P` — resize 4 mm-полей через `roundMmToPx`.
- `rotation_deg`, `label`, `type`, `fit` и т.д. копируются через spread.
- Возвращает НОВЫЙ объект (immutable).

**`prepare-clone.ts` (главный entry point):**
- `prepareTemplateSetClone(request): ClonePlan` — не выполняет операций в БД, готовит структуры данных для API 28.3.
- Логика: валидация → checkAspect (throw if blocked) → scale_x/scale_y → resize всех мастеров и placeholder'ов → spread_width/height с учётом `facing_pages` → bleed override/fallback → округление всех mm.
- Возвращает `ClonedTemplateSetRecord` + `ClonedMasterRecord[]` + `resize_info` (метрика).
- `parent_template_set_id` заполняется ID источника, `is_global=false`, `slug=null` фиксированно.

**Публичный API** в `lib/template-set-clone/index.ts`.

**Unit-тесты (55 новых):**
- `round-to-pixels.test.ts` — 15 тестов: идемпотентность, A4 calc (2480/3508 px), edge cases (NaN, 0, negative).
- `aspect-compatibility.test.ts` — 11 тестов: три уровня, симметрия `diff(A→B)===diff(B→A)`, граничные размеры.
- `resize-placeholder.test.ts` — 11 тестов: scale 1/2, immutability, копирование доп.полей через spread, кратность MM_STEP проверена через `round(value/STEP)` а не `% STEP` (важная техническая деталь из-за плавающей запятой).
- `prepare-clone.test.ts` — 18 тестов: идентичные размеры, resize, blocked-throw, facing_pages true/false, bleed override/fallback/null, parent_id, is_global, slug, валидация.

Тесты на main: **437 → 492 passing**. Превысили эстимацию (15-20) почти в три раза — пользовался моментом написать жёсткое покрытие, поскольку утилиты лежат в фундаменте фазы.

### 3. API endpoints (РЭ.28.3, commit `0b8eced`)

Три новых action'а в `app/api/tenant/route.ts`:

**`GET action='template_set_my_list'`** (~строка 1107):
- SELECT `template_sets` WHERE `tenant_id = auth.tenantId` ORDER BY created_at DESC.
- Возвращает только клоны партнёра. Глобальные не включает — для них есть существующий `designs_list`.

**`POST action='template_set_clone'`** (~строка 2930):
- Body: `source_template_set_id`, `new_name`, `new_page_width_mm`, `new_page_height_mm`, `new_bleed_mm?`.
- Валидация: размеры 50-500 мм, bleed 0-20 мм или null/undefined.
- SELECT source + всех `spread_templates`.
- Проверка доступа: source глобальный (`tenant_id IS NULL`) или собственный.
- `prepareTemplateSetClone(...)` — pure utility делает всю валидацию и resize. При `aspect_check.level='blocked'` throw → 400.
- INSERT `template_sets` → новый id (`tenant_id = auth.tenantId`).
- INSERT `spread_templates` (batched, все мастера разом, с чисткой служебных полей `id` / `template_set_id` / `created_at` и проставлением нового `template_set_id`).
- **Ручной rollback:** если INSERT мастеров упал, DELETE template_set чтобы не оставить полу-клон. Supabase JS client не поддерживает явные транзакции — это компенсация.
- Audit log: `template_set.clone` с meta (source, scale, aspect, counts).
- Response: `{ ok, template_set_id, aspect_check, masters_count }`.

**`POST action='template_set_delete'`**:
- Глобальные (`tenant_id IS NULL`) — НИКОГДА не удаляются.
- Чужой тенант → 404 (не раскрываем существование).
- COUNT `albums.template_set_id` + `presets.template_set_id`. Если ≥ 1 → 409 + сообщение `«используется в N альбомах и M пресетах»`.
- DELETE `spread_templates` вручную (нет ON DELETE CASCADE).
- DELETE `template_sets`. Audit log.

Был **один маленький фикс** при написании — изначально вызывал `logAction({...})` с объектом, а правильная сигнатура `logAction(auth, action, targetType, targetId, meta)`. Поймали через `tsc --noEmit` до коммита.

### 4. UI каталога (РЭ.28.4, commit `e22ceae`)

`app/app/templates/page.tsx` — разделение на два секционных раздела и кнопки действий.

**Структурные изменения:**
- Раньше: одна сетка карточек вперемешку.
- Теперь:
  - Раздел «Мои дизайны» (зелёный бейдж) — показывается **только если** есть клоны.
  - Раздел «Глобальные шаблоны OkeyBook» (синий бейдж).
- На карточке **глобального** дизайна — кнопка «Создать на основе…» (в 28.4 — заглушка `alert`, реальная модалка в 28.5).
- На карточке **своего** дизайна — кнопка «Удалить» (с `confirm()` + API + reload).
- Размеры (`226×288 мм`) теперь видны на карточке.

**Перестройка карточки:**
- Раньше: `<button onClick={onOpen}>` — клик на всю карточку.
- Теперь: `<div>` с отдельными зонами клика (превью, название, кнопка «Открыть») и отдельными action-кнопками.
- Причина: вложенные `<button>` запрещены в HTML, для встраивания action-кнопок пришлось разделить.

**Обработка 409:**
- API возвращает 409 если клон в использовании. UI показывает сообщение из API с count'ами.
- Кнопка «Удалить» имеет состояние `deleting` (disabled во время запроса).

### 5. UI модалка ввода размеров (РЭ.28.5, commit `f98df1c`)

`app/app/templates/_components/CloneTemplateSetModal.tsx` (новый компонент, ~280 строк).

**Поля формы:**
- Название (text, обязательно, дефолт `«<source.name> (копия)»`).
- Ширина страницы, мм (number 50-500) + подсказка `≈ NNNN px (при 300 DPI)`.
- Высота страницы, мм (number 50-500) + подсказка `≈ NNNN px`.
- Припуск под обрез, мм (number 0-20, опционально) + подсказка `≈ NNNN px` или fallback-надпись «по умолчанию из исходного».

Подсказки в px вычисляются через `mmToPx` из `lib/template-set-clone` — показывают финальное значение в типографском растре при 300 DPI.

**Real-time check совместимости пропорций:**
```typescript
const aspectCheck = useMemo(
  () => checkAspectCompatibility(defaultW, defaultH, widthNum, heightNum),
  [defaultW, defaultH, widthNum, heightNum],
)
```
- На каждое изменение размеров — пересчёт.
- Блок aspect-check меняет цвет:
  - `ok` — зелёный, `✓ Пропорции подходят`
  - `warning` — жёлтый, `⚠ Проверьте пропорции`
  - `blocked` — красный, `⛔ Пропорции несовместимы`
- При `blocked` кнопка «Создать» disabled.

**Submit:**
- POST `/api/tenant action='template_set_clone'`.
- При успехе → `onSuccess(newTsId)` → родитель закрывает модалку и reload `designs_list`.
- При ошибке (400/409/500) — показ сообщения из API в форме.

**UX-нюансы:**
- Клик по затемнению — закрыть.
- `e.stopPropagation` на самой модалке — клик внутри не закрывает.
- Поддержка ввода через запятую (`.replace(',', '.')`).
- Все поля disabled во время `submitting`.
- Подсказка `\u00a0` (non-breaking space) на пустых полях — чтобы layout не прыгал.

В `page.tsx`: новый state `cloneSource: Design | null`, замена alert-заглушки на установку state, рендеринг модалки в конце JSX.

## Финальное состояние после фазы

**`template_sets` в проде:**
- Все 3 оригинальных глобальных дизайна сохранили `parent_template_set_id=NULL`.
- При первом клонировании партнёром появляется запись с `tenant_id=<его-id>` и `parent_template_set_id=<id-источника>`.
- Эту запись партнёр видит в разделе «Мои дизайны» в `/app/templates`.

**Каталог `/app/templates`:**
- Партнёр видит свои клоны в отдельном разделе сверху.
- На глобальных карточках — кнопка «Создать на основе…».
- При нажатии открывается модалка с предзаполненными размерами из источника.
- Можно менять размеры и видеть в реальном времени уровень совместимости пропорций.
- После создания клон сразу появляется в разделе «Мои дизайны».
- Свои дизайны можно удалить (если нет ссылок).

**Engine (РЭ.22, layout API):**
- Не задеть фазой — клон содержит тот же формат `placeholders` что и оригинал, engine собирает его по той же логике.

## Архитектурное решение фазы

`prepareTemplateSetClone()` в `lib/template-set-clone/` — **чистая функция без зависимостей** от Supabase. Готовит структуры данных, не выполняет операций в БД.

API endpoint остаётся **тонким слоем**: валидация входных параметров → загрузка из БД → передача в utility → INSERT'ы → audit log → response.

Это даёт:
- Высокое покрытие тестами без mock'ов БД (55 unit-тестов).
- Возможность переиспользования utility в других контекстах (например `/super` мог бы предложить «сделать партнёрскую копию глобального дизайна» — utility готова).
- Изоляция бизнес-логики от инфраструктуры.

## Ключевые архитектурные развилки (сводка)

| # | Развилка | Решение |
|---|---|---|
| A | Глубина копирования | Полная глубокая копия (template_set + все spread_templates). |
| B | Уровни совместимости пропорций | <5% ok / 5-10% warning / >10% blocked. Метрика `max(a/b, b/a) - 1`. |
| C | print_type клона | Копируется из источника. На уровне РЭ.27 параметр живёт в `albums.print_type`. |
| D | Удаление клона | Только если 0 ссылок из albums и presets. 409 с понятным сообщением. |
| E | slug у клона | NULL (поле опциональное). |
| F | is_global у клона | false (явно). |
| G | Что партнёр редактирует | name, page_width, page_height, bleed_mm. Остальное из источника. |
| H | Округление | До целых пикселей при 300 DPI (хардкод). mm и ≈ px показываются рядом в UI. |

## ⚠️ Применение урока из РЭ.27 — успех

В РЭ.27 было **4 расхождения** ментальной модели и реальности БД. После закрытия фазы зафиксировали правило:

> Перед каждым подэтапом, особенно с миграцией:
> 1. `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '...'`
> 2. Test JOIN на 5 строках
> 3. Только потом писать код миграции/запрос

**В РЭ.28 это правило применялось трижды и сработало:**

1. **28.0 (spec):** перед написанием spec выгружена схема `template_sets` (15 колонок) и `spread_templates` (25 колонок). Это позволило сразу написать spec с точными типами полей.

2. **28.1 (миграция):** перед `ALTER TABLE` проверено что колонки `parent_template_set_id` ещё нет, формат FK совпадает с используемым в схеме. Миграция применилась с первого раза.

3. **28.3 (API):** при чтении `spread_templates` для клонирования использован `SELECT *` — все 25 колонок копируются, никаких предположений «нужно только width/height/placeholders». Это страховка от того что у мастера есть какие-то поля которые мы не учли (а их в schema действительно много: `applies_to_configs`, `page_role`, `slot_capacity`, `family_id`, и т.д.).

Никаких новых «открытий» в фазе РЭ.28. Правило работает — фаза прошла без откатов, фиксов миграций, перезаписей.

## Что НЕ сделано (фиксируется как долг)

1. **Сценарий B (партнёрский IDML)** — собственная загрузка `template_set` с нуля. Это **РЭ.29+**, открывается по запросу первого партнёра. Без чёткой потребности не начинаем.

2. **Графический редактор placeholder'ов.** Партнёр не может «передвинуть фото на 5 мм влево». Мастера резайзятся пропорционально, ручное редактирование не предусмотрено.

3. **Расширенный DPI (240, 600).** Хардкод 300. Если придёт запрос — добавим параметр в API.

4. **Обновление клонов при изменении оригинала.** Клон — независимая копия. Если глобальный template_set обновится (например Сергей загрузит новые мастера через `/super`), клоны останутся как были. Партнёр может удалить старый клон и создать новый.

5. **Шеринг клонов между партнёрами.** Клон видит только тот партнёр который его создал.

6. **Кастомный `cover_preview_url` у клона.** Берётся из источника как ссылка. Если файл удалили — превью пропадёт у клона тоже.

7. **Аналитика resize-операций.** Audit log есть, но дашборда «сколько клонов было сделано, какие пропорции часто blocked» — нет. Если станет нужно — отдельная задача.

## Статистика фазы

- **Коммитов основной фазы: 6** — `1193b5d..f98df1c`.
- **Контекстных коммитов: 6** — v136..v141.
- **SQL миграций: 1** — `template_sets.parent_template_set_id` (28.1). Применена в Supabase.
- **Новых unit-тестов: 55** — 437 → 492 на main. Превысили эстимацию (15-20) почти в 3 раза.
- **Затронуто файлов кода:** 7 новых (5 в `lib/template-set-clone/`, 1 UI компонент, тесты) + 2 правки (page.tsx, route.ts).
- **Длительность:** одна сессия (21.05.2026). После закрытия РЭ.27 в той же сессии.

## Ключевые файлы фазы

**Новые модули (resize-pipeline):**
- `lib/template-set-clone/constants.ts` — `PRINT_DPI=300`, `MM_STEP`.
- `lib/template-set-clone/round-to-pixels.ts` — `roundMmToPx`, `mmToPx`.
- `lib/template-set-clone/aspect-compatibility.ts` — `checkAspectCompatibility` с тремя уровнями.
- `lib/template-set-clone/resize-placeholder.ts` — `resizePlaceholder`.
- `lib/template-set-clone/prepare-clone.ts` — главный `prepareTemplateSetClone`.
- `lib/template-set-clone/index.ts` — публичный API.
- `lib/template-set-clone/__tests__/round-to-pixels.test.ts` — 15 тестов.
- `lib/template-set-clone/__tests__/aspect-compatibility.test.ts` — 11 тестов.
- `lib/template-set-clone/__tests__/resize-placeholder.test.ts` — 11 тестов.
- `lib/template-set-clone/__tests__/prepare-clone.test.ts` — 18 тестов.

**Миграция БД:**
- `migrations/2026-05-21-template-sets-parent.sql` — `parent_template_set_id` + индекс.

**API:**
- `app/api/tenant/route.ts`:
  - GET `template_set_my_list` (~строка 1107).
  - POST `template_set_clone` (~строка 2930) — с ручным rollback при сбое INSERT мастеров.
  - POST `template_set_delete` — с защитой от удаления при ссылках.
  - Импорт `prepareTemplateSetClone` из `@/lib/template-set-clone`.

**UI:**
- `app/app/templates/page.tsx` — разделение на «Мои дизайны» / «Глобальные», кнопки действий.
- `app/app/templates/_components/CloneTemplateSetModal.tsx` — модалка ввода размеров.

## Связь со следующими фазами

**РЭ.29+ (партнёрский IDML, сценарий B):** РЭ.28 решает 80% кейсов «другой размер, тот же дизайн». РЭ.29 нужен только если партнёр хочет совсем другой дизайн. Открывается по реальному запросу.

**Возможные будущие улучшения:**
- Партнёр-уровневые `cover_preview_url` (генерируются автоматически при клонировании).
- Update-of-clone когда оригинал поменяли.
- Аналитика clone-операций для бизнес-метрик.

---

**Конец summary РЭ.28.**
