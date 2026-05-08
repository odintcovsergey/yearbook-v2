# Фаза 1 — Smart-fill (финальная v1)

> Документ создан 08.05.2026 после обсуждения 17 open questions
> черновика `phase-1-spec-draft.md`.
> Архитектурный принцип: **минимальный MVP, тонкий слой между БД и builder'ом**.

## Зачем

После фазы 0.5 builder работает только с Preset из БД и протестирован
на 58 синтетических сценариях. Но **никогда не запускался на реальных
данных альбомов** в продакшене.

**Цель фазы 1:** сделать первый запуск builder'а на живых данных.
Партнёр-фотограф нажимает кнопку «Собрать автоматически» в кабинете,
получает готовый layout (массив разворотов с заполненными местами)
+ список предупреждений. Результат сохраняется в БД для последующего
просмотра и пересборки.

## Главное решение

**Smart-fill — тонкая обёртка между БД и builder'ом.** Никакой бизнес-логики
в smart-fill: чтение данных → перевод в `AlbumInput` → вызов `buildAlbum` →
сохранение в `album_layouts`.

Все ограничения, fallback'и, edge-cases остаются в builder'е (как было
в фазе 0.5). Smart-fill не дублирует логику, не переисчисляет лимиты,
не модифицирует данные.

Из этого следует:
- Если поведение builder'а изменится в будущем (новые мастера, новые
  пресеты) — smart-fill не нужно править
- Текущая фаза не усложняется ранними оптимизациями
- Полная совместимость с уже работающим Build Test endpoint'ом
  (тот же builder, разные источники данных)

## Решённые архитектурные моменты

| Момент | Решение |
|---|---|
| Кто классный руководитель? | Флаг `teachers.is_head_teacher BOOLEAN` + checkbox в UI учителей |
| Если 0 учителей в альбоме | Не блокировать, builder пишет warning `no_head_teacher` |
| Если 0 портретов выбрано | Не блокировать, агрегированный warning `students_no_portrait` |
| Все ученики или только submitted? | Все, без фильтра (стабильность структуры layout'а) |
| Лимит friend_photos | Передаём всё (cap 10 от мусора), builder режет по preset.max |
| Длинный quote | Передаём как есть, ограничение уже на уровне ввода `albums.text_max_chars` |
| Schema album_layouts | P3 — миграция: убрать config_type/print_type, добавить config_preset_id + warnings |
| Хранить ли warnings | Да, отдельной jsonb колонкой |
| Перезапуск сборки | Upsert по unique album_id |
| status поле | Всегда 'draft' при первой записи; при upsert — сохраняется |
| Где кнопка | В Обзоре, рядом с блоком «Пресет вёрстки» |
| Когда disabled | Только при `config_preset_id IS NULL` |
| Per-child override (фаза 0.5.6.2) | Игнорируется на MVP с warning'ом, фрагментированная сборка — фаза 2+ |
| Уровни warning'ов в UI | 3 категории (blocking/degraded/info), коллапсируемые секции |
| Кто видит кнопку | canEdit=true (owner/manager партнёра + OkeyBook staff в view_as) |
| print_type источник | Из preset (через config_preset_id), не из legacy albums.print_type |
| template_set_id NULL | Бэкфил применён 08.05.2026 (10/10 альбомов имеют ID); auto-resolve в endpoint как защита |

## Out of MVP scope (future considerations)

### Типографии и порядок страниц

В MVP неявно подразумевается одна типография (OkeyBook), у которой
layflat начинает разворотом (слева), а soft справа (как обычная книга).
У других типографий правила могут отличаться — некоторые всегда
начинают слева, для мягких клеят первую страницу как форзац.

**Когда добавим партнёрский self-print или альтернативные типографии**
— потребуется доп. настройка `tenants.printing_house_settings` или
`albums.printing_house_id` с указанием правил начала первой страницы.
Шаблон-сет можно расширить флагом `start_page_side: 'left' | 'right'`
per print_type.

### Multi-design в одном альбоме

В MVP один альбом = один template_set. Партнёр желающий 2+ дизайнов
делает 2 альбома. Полная поддержка (per-child или per-group выбор
дизайна) — после фазы 4 (расширение библиотеки template_sets) и
потребует архитектурных изменений в builder и album_layouts.

### Полноценный UI выбора дизайна

Простой dropdown «Дизайн альбома: [okeybook-default ▾]» в форме
альбома **не делается** в MVP. Когда добавим выбор дизайнов —
нужна **полноценная страница с превью** (как у фотобота): крупные
миниатюры, описания, примеры. Без визуального превью dropdown
бесполезен — партнёр не поймёт что выбирает.

### Per-child override фрагментированная сборка

В фазе 0.5.6.2 у учеников появилось поле `children.config_preset_id`
(override альбомного пресета). На MVP smart-fill **игнорирует** override,
работает с альбомным пресетом для всех. Полная поддержка (группировка
учеников по эффективному пресету, N вызовов buildAlbum со склейкой
spreads) — фаза 2+.

### Canvas-рендер layout'а

В MVP результат показывается как **JSON + список warning'ов**. Реальный
визуальный рендер с подложками, фреймами, фотографиями на холсте —
**фаза 2** (Canvas-рендер).

### Bulk smart-fill

В MVP сборка только по одному альбому за клик. Массовая сборка по
тенанту/выборке альбомов — позже.

### Edit-режим layout'а

В MVP никаких ручных правок результата. Только пересборка целиком.
Drag-n-drop редактор, редактирование отдельных слотов — фаза 4.

### PDF-экспорт

Фаза 3.

## Маппинг данных БД → AlbumInput

`AlbumInput` — это контракт builder'а:

```typescript
type AlbumInput = {
  template_set_id: string;
  head_teacher: HeadTeacher | null;
  subjects: Subject[];
  students: Student[];
  common_photos: CommonPhotos;
};
```

Smart-fill собирает `AlbumInput` из 6 таблиц БД (паттерн уже отработан
в `app/api/tenant/route.ts → action=export_csv`, переиспользуем).

### template_set_id

Источник: `albums.template_set_id`.
Если NULL → `getDefaultTemplateSetId()` (auto-resolve через
единственный okeybook-default), как делает `update_album` в 0.5.6.1.

После бэкфила 08.05.2026 (`UPDATE albums SET template_set_id = ...`)
это поле NOT NULL у всех 10 текущих альбомов. Auto-resolve остаётся
как защита от будущих случаев.

### head_teacher (Teacher | null)

Источник: `teachers WHERE album_id = X AND is_head_teacher = true`
(должен быть один; см. constraint в миграции 1.0).

Mapping:
- `name` ← `teachers.full_name`
- `role` ← `teachers.position`
- `text` ← `teachers.description ?? ''`
- `photo` ← `getPhotoUrl(photo_teachers.photos.storage_path)` или null

Если 0 head_teacher (никто не отмечен) → `head_teacher = null`,
builder пишет warning `no_head_teacher`, учительский разворот пропускается.

### subjects (Teacher[])

Источник: `teachers WHERE album_id = X AND is_head_teacher = false`,
сортировка по `created_at ASC`.

Mapping тривиальный, как для head_teacher.

### students (Student[])

Источник: `children WHERE album_id = X`, сортировка `class ASC, full_name ASC`.

**Все ученики**, без фильтра по `submitted_at`.

Для каждого ученика дополнительно:

**`portrait`**:
```sql
SELECT photos.storage_path
FROM selections
JOIN photos ON photos.id = selections.photo_id
WHERE selections.child_id = X
  AND selections.selection_type = 'portrait_page'
LIMIT 1
```
Если найдено → `getPhotoUrl(storage_path)`. Если нет → `null`.

**`quote`**: `student_texts.text WHERE child_id = X` или `''` если нет
записи. Передаётся как есть (лимит уже обеспечен на уровне ввода
через `maxLength={textMaxChars}` в `app/[token]/page.tsx`).

**`friend_photos`**:
```sql
SELECT photos.storage_path
FROM selections
JOIN photos ON photos.id = selections.photo_id
WHERE selections.child_id = X
  AND selections.selection_type = 'group'
ORDER BY selections.created_at ASC
LIMIT 10
```
Защита: cap 10 от мусора. Builder режет дальше до `preset.config.
student_section.first_spread_content.friend_photos.max`.

### common_photos (CommonPhotos)

В MVP всегда передаём пустой объект:

```typescript
const common_photos: CommonPhotos = {
  full_class: [],
  half: [],
  quarter: [],
  sixth: [],
  collage: [],
};
```

**Причина:** builder фазы 0.5 общий раздел (J-* мастера) не генерирует
автоматически. Партнёр добавляет J-разворот вручную через UI редактора
(фаза 4). Smart-fill эти данные передавать не должен — они никуда не пойдут.

### Дополнительная агрегация в smart-fill (warnings)

Помимо warning'ов от builder'а, smart-fill добавляет свои:

| Код | Когда | Уровень |
|---|---|---|
| `students_no_portrait` | N из M учеников без `selections WHERE selection_type='portrait_page'` | info |
| `per_child_override_ignored` | N учеников имеют свой `config_preset_id`, override игнорируется на MVP | info |

## Schema migrations

### 1.0.1 — `teachers.is_head_teacher`

Файл: `migrations/2026-05-09-teachers-head-flag.sql`

```sql
-- Колонка флага
ALTER TABLE teachers
  ADD COLUMN is_head_teacher BOOLEAN NOT NULL DEFAULT false;

-- Один head на альбом (partial unique index)
CREATE UNIQUE INDEX teachers_one_head_per_album
  ON teachers (album_id)
  WHERE is_head_teacher = true;

-- Бэкфил: для каждого альбома где есть учителя — отметить первого
-- по created_at как head. Не идеально (может оказаться не классным),
-- но даёт рабочее значение по умолчанию. Партнёр поправит в UI.
WITH first_per_album AS (
  SELECT DISTINCT ON (album_id) id
  FROM teachers
  ORDER BY album_id, created_at ASC
)
UPDATE teachers
SET is_head_teacher = true
WHERE id IN (SELECT id FROM first_per_album);
```

### 1.1.1 — `album_layouts` schema P3

Файл: `migrations/2026-05-09-album-layouts-preset-fk.sql`

```sql
-- Удаляем старые колонки (фазы 0)
ALTER TABLE album_layouts
  DROP COLUMN IF EXISTS config_type,
  DROP COLUMN IF EXISTS print_type;

-- Добавляем новые
ALTER TABLE album_layouts
  ADD COLUMN config_preset_id uuid REFERENCES config_presets(id),
  ADD COLUMN warnings jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Старый CHECK на config_type/print_type удалится автоматически с колонками.
-- Status оставляем как был.
```

В проде на момент применения (09.05.2026) `album_layouts` имеет 0 записей —
никаких потерь данных. UNIQUE на album_id остаётся.

## API endpoint /api/layout?action=build_album

### Контракт

**POST** `/api/layout?action=build_album`

Request body:
```json
{
  "album_id": "uuid"
}
```

Response 200:
```json
{
  "spreads": [...],
  "warnings": [...],
  "layout_id": "uuid",
  "summary": {
    "total_spreads": 12,
    "total_warnings": 5,
    "warnings_by_level": {
      "blocking": 0,
      "degraded": 2,
      "info": 3
    },
    "preset_slug": "standard-layflat",
    "preset_name": "Стандарт (твёрдые листы)"
  }
}
```

Response 4xx:
- `400 album_id required` — нет body.album_id
- `400 album has no config_preset_id` — у альбома пресет NULL
- `403 access denied` — assertAlbumAccess вернул false
- `404 album not found` — нет такого альбома

### Tenant scoping

Использовать существующий `assertAlbumAccess(auth, album_id, tid)` с поддержкой
view_as параметра `tid` для OkeyBook staff (как в /api/tenant).

### Контракт уровней warning'ов

```typescript
const WARNING_LEVELS: Record<BuildWarningCode, 'blocking' | 'degraded' | 'info'> = {
  // Blocking — нельзя печатать как есть
  'master_not_found': 'blocking',
  'students_empty': 'blocking',
  
  // Degraded — собралось, но компромиссно
  'students_overflow': 'degraded',
  'subjects_overflow': 'degraded',
  'students_grid_no_special_master': 'degraded',
  'name_mismatch': 'degraded',
  'class_photo_missing': 'degraded',
  'students_odd_in_standard': 'degraded',
  'no_right_teacher_master': 'degraded',
  
  // Info — нормальная ситуация, к сведению
  'no_head_teacher': 'info',
  'students_no_portrait': 'info',           // smart-fill агрегированный
  'per_child_override_ignored': 'info',     // smart-fill агрегированный
};
```

### Логика endpoint'а

```typescript
async function handleBuildAlbum(req: NextRequest, auth: AuthContext) {
  // 1. Validate body
  const { album_id } = await req.json();
  if (!album_id) return error400('album_id required');
  
  // 2. Tenant scope (учитывая view_as)
  const tid = req.nextUrl.searchParams.get('view_as') ?? undefined;
  if (!await assertAlbumAccess(auth, album_id, tid)) return error403();
  
  // 3. Загрузить альбом + проверить пресет
  const album = await loadAlbum(album_id);
  if (!album) return error404();
  if (!album.config_preset_id) return error400('album has no config_preset_id');
  
  // 4. Auto-resolve template_set_id если NULL
  let templateSetId = album.template_set_id;
  if (!templateSetId) {
    templateSetId = await getDefaultTemplateSetId();
    if (!templateSetId) return error500('no default template_set');
  }
  
  // 5. Собрать AlbumInput из БД
  const input = await buildAlbumInput(album_id, templateSetId);
  
  // 6. Загрузить preset + template_set
  const preset = await loadPresetById(album.config_preset_id);
  const templateSet = await loadTemplateSet(supabaseAdmin);
  
  // 7. Вызвать buildAlbum
  const result = buildAlbum(input, preset, templateSet);
  
  // 8. Дополнить warnings smart-fill агрегированными
  const enrichedWarnings = enrichWarnings(result.warnings, input, album_id);
  
  // 9. Upsert в album_layouts
  const layoutId = await upsertAlbumLayout(album_id, {
    template_set_id: templateSetId,
    config_preset_id: album.config_preset_id,
    spreads: result.spreads,
    warnings: enrichedWarnings,
  });
  
  // 10. Вернуть response
  return NextResponse.json({
    spreads: result.spreads,
    warnings: enrichedWarnings,
    layout_id: layoutId,
    summary: {...},
  });
}
```

## UI компоненты

### Кнопка «Собрать автоматически»

Расположение: `AlbumDetailModal → Обзор`, в блоке «Пресет вёрстки»
(под именем пресета).

```jsx
{canEdit && (
  <button
    disabled={album.config_preset_id === null || busy}
    onClick={runSmartFill}
    className="btn-primary"
    title={album.config_preset_id === null
      ? 'Сначала выберите пресет вёрстки в форме редактирования'
      : ''}
  >
    {busy ? 'Сборка...' : 'Собрать автоматически'}
  </button>
)}
```

### Result-блок

После успешной сборки в Обзоре появляется блок:

```jsx
<div className="bg-gray-50 rounded-lg p-4 mt-4">
  <div className="flex items-center justify-between mb-3">
    <div className="font-medium">
      ✓ Layout собран · {summary.total_spreads} разворотов
      {summary.total_warnings > 0 && ` · ${summary.total_warnings} предупреждений`}
    </div>
    <div className="flex gap-2 text-xs">
      <button onClick={() => copyJson(layoutResult)}>Скопировать JSON</button>
      <button onClick={runSmartFill}>Пересобрать</button>
    </div>
  </div>
  
  {/* Раскрывающиеся секции по уровням */}
  <CollapseSection level="blocking" warnings={...} />
  <CollapseSection level="degraded" warnings={...} />
  <CollapseSection level="info" warnings={...} />
</div>
```

### Категоризированные warning'и

```jsx
function CollapseSection({ level, warnings }) {
  const colors = {
    blocking: 'red-600 bg-red-50',
    degraded: 'amber-700 bg-amber-50',
    info: 'gray-600 bg-gray-50',
  };
  const labels = {
    blocking: 'Критично',
    degraded: 'Требует внимания',
    info: 'К сведению',
  };
  
  if (warnings.length === 0) return null;
  
  return (
    <details className={`rounded p-2 ${colors[level]}`}>
      <summary>{labels[level]} ({warnings.length})</summary>
      <ul>
        {warnings.map(w => (
          <li key={...}>{w.detail}</li>
        ))}
      </ul>
    </details>
  );
}
```

### Persisted state

При открытии `AlbumDetailModal → Обзор`:
- Если есть запись в `album_layouts` для этого альбома → загрузить
  spreads + warnings, показать result-блок
- Если нет → показать только кнопку «Собрать автоматически» (пустой
  state)

## Этапы реализации

| Подэтап | Что | Объём |
|---|---|---|
| 1.0 | Флаг `is_head_teacher`: миграция БД + UI checkbox в форме учителя + бейдж в списке + расширение API update_teacher (radio-pattern: при отметке нового — старый сбрасывается) | ~2 ч |
| 1.1 | Миграция album_layouts (P3 — убрать config_type/print_type, добавить config_preset_id + warnings) | ~30 мин |
| 1.2 | Helper `lib/smart-fill/build-album-input.ts` — собирает `AlbumInput` из БД (head_teacher через флаг, students с portrait/quote/friend_photos, subjects, common=empty). Без endpoint'а, тестируется через CLI или ad-hoc скрипт | ~3 ч |
| 1.3 | POST `/api/layout?action=build_album` — endpoint собирает input → buildAlbum → upsert в album_layouts. Tenant scoping + view_as поддержка. Smart-fill enrichWarnings | ~2-3 ч |
| 1.4 | UI кнопка «Собрать автоматически» в Обзоре + result-блок с категоризированными warning'ами + JSON dump + load existing layout при открытии вкладки | ~3 ч |
| 1.5 | Smoke на 2-3 живых альбомах разных пресетов + обновление контекста v42 → v43 | ~2 ч |
| **Итого** | | **~12-13 ч** |

В коридоре оценки v42-roadmap (~12 ч).

## Testing strategy

### Unit (для подэтапа 1.2)

`build-album-input.ts` тестируется через одноразовый CLI-скрипт
`/tmp/test-build-album-input.ts` (как было в фазе 0.5):
- Создать тестовый альбом с детьми, учителями, фото, selections
- Вызвать `buildAlbumInput(albumId, templateSetId)`
- Проверить что AlbumInput собран корректно

Не коммитить скрипт — это разовая проверка.

### Integration (для подэтапа 1.3)

После реализации endpoint:
- Запустить локальный dev-сервер
- curl POST `/api/layout?action=build_album` с реальным album_id из dev-БД
- Проверить ответ + содержимое `album_layouts` в Supabase

### End-to-end (для подэтапа 1.5)

После всех подэтапов:
1. Открыть `/app` → реальный альбом с пресетом
2. Нажать «Собрать автоматически» → увидеть result-блок
3. Проверить разные сценарии:
   - Альбом без портретов (новый, родители ещё не выбрали)
   - Альбом с частично выбранными портретами
   - Альбом без учителей
   - Альбом с per-child override
   - Разные пресеты (Стандарт, Лайт, Мини)

### Smoke 58/58

Контрольная проверка после каждого подэтапа:
```bash
set -a && . ./.env.local && set +a && npx tsx scripts/smoke-album-builder.ts
```
Должно: `Result: 58/58 scenes passed`. Builder не меняется в фазе 1,
smoke не должен сломаться.

## Workflow по подэтапам

Стандартный workflow как в фазе 0.5:

1. Стратег готовит инструкцию `docs/internal/1.X-instructions.md` в песочнице
2. Сергей кладёт файл в `docs/internal/`
3. Сергей даёт команду Claude Code: "Прочитай docs/internal/1.X-instructions.md и примени"
4. Claude Code применяет, делает локальные коммиты (docs + feat), запускает проверки
5. Сергей пересылает отчёт стратегу
6. Стратег даёт OK на push (или просит правки)
7. После push — следующий подэтап

Между подэтапами: проверка `tsc --noEmit + next build + smoke 58/58`.

## Связь с следующими фазами

После закрытия фазы 1:
- **Фаза 2** — Canvas-рендер: layout JSON → визуальный preview с подложками
  и фотографиями на холсте. Использует тот же `album_layouts.spreads` JSON.
- **Фаза 3** — PDF-экспорт: layout → PDF для типографии.
- **Фаза 4** — Drag-n-drop редактор: ручные правки слотов в layout'е,
  per-child override становится осмысленным.
- **Фаза 5** — Биллинг: расчёт стоимости вёрстки, передача в OkeyBook.
- **Фаза 6** — Партнёрский онбординг.

Smart-fill MVP даёт **первое реальное доказательство** что builder
работает на живых данных. После него можно строить продуктовую
ценность дальше.
