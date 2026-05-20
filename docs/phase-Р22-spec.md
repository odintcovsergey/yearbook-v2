# Фаза РЭ.22 — Конструктор пресетов: двух-осевая модель
# Спецификация v1.0

**Статус:** утверждена 20.05.2026, согласовано с Сергеем (browser-чат).
**Зависит от:** РЭ.21.8.15 (master-finder, slot_capacity-теги, поля
`presets.student_*`). РЭ.21.8.чистка-1 (удалён движок 2 — теперь только
legacy `buildAlbum` + `buildFromSectionStructure`).
**Эстимация:** 10 коммитов, 2-3 недели.

---

## 1. Зачем фаза существует

После РЭ.21.8 личный раздел переведён на семантический поиск только для
комплектации «Индивидуальная» (`preset.id='individual'` + все 3 поля
`presets.student_*` заполнены). Для остальных комплектаций engine идёт по
жёстким именам мастеров (`E-Standard-Left`, `E-Universal-Left`, `E-Max-Left`,
`M-Grid-Page`, `L-Grid-Page`, `N-Grid-Page` и т.д.).

Цель РЭ.22: партнёр (а в будущем и сам OkeyBook) описывает структуру
альбома в декларативных терминах («режим личного раздела × параметры»),
а engine ищет в template_set мастер с подходящими `page_role` +
`slot_capacity` тегами. Партнёр не пишет код, не зашивает имена. Любой
«интересный запрос клиента» превращается в «недостающий мастер с
конкретными slot_capacity-тегами», который дизайнер рисует в InDesign,
а engine автоматически подхватывает.

Дополнительно: переработать teachers / soft_intro / soft_final на тот же
принцип. Без этого партнёры не могут гибко описывать учительский разворот
и вступительные/финальные страницы.

`common_required` / `common_additional` / `transition` — **оставить как
есть.** Они уже работают через эталонную таблицу OkeyBook (РЭ.21.8.9-11)
и не требуют переработки.

---

## 2. Двух-осевая модель «режим × параметры»

Сейчас в БД три плоских поля:
```
student_pages_per_student INT  -- 1 | 2 | NULL
student_friend_photos     INT  -- 0..10 | NULL
student_has_quote         BOOL -- true | false | NULL
```

В UI они показаны как три независимых селекта. Партнёр может поставить
бессмысленную комбинацию (например `student_pages_per_student=1` +
`student_friend_photos=10` + `student_has_quote=false` — мастер с 10
фото на одной странице без цитаты в библиотеке вряд ли есть).

**Правильная модель — две оси:**

**Ось 1 — режим личного раздела** (один из трёх):
- `page` — 1 ученик = 1 страница (классические одностраничные мастера типа
  `E-Standard-Left/Right`, `E-Universal-Left/Right`)
- `spread` — 1 ученик = 1 разворот (двухстраничные пары типа `E-Max-Left` +
  `E-Max-Right`, `E-Ind-Right-N`)
- `grid` — сетка N учеников на странице (M/L/N-Grid-Page и адаптивные)

**Ось 2 — параметры режима** (зависят от режима):

| Режим    | Параметры                                                                 |
|----------|---------------------------------------------------------------------------|
| `page`   | `friend_photos: 0..10` (фото с друзьями), `has_quote: bool`              |
| `spread` | `friend_photos: 0..10` (на правой странице), `has_quote: bool`            |
| `grid`   | `grid_size: 2..12` (учеников на страницу), `has_quote: bool`              |

Цитата — параметр режима, не independent поле. Логически согласуется с
тем, какой мастер ищется в template_set.

---

## 3. Схема БД (РЭ.22.1)

### Новые колонки

```sql
ALTER TABLE presets
  ADD COLUMN IF NOT EXISTS student_layout_mode TEXT,
  ADD COLUMN IF NOT EXISTS student_grid_size INT;

-- Whitelist режима.
ALTER TABLE presets
  ADD CONSTRAINT presets_student_layout_mode_chk
  CHECK (student_layout_mode IS NULL OR student_layout_mode IN ('page', 'spread', 'grid'));

-- Whitelist размера сетки.
ALTER TABLE presets
  ADD CONSTRAINT presets_student_grid_size_chk
  CHECK (student_grid_size IS NULL OR (student_grid_size BETWEEN 2 AND 12));
```

Применяется DO-блоком с проверкой через `pg_constraint` (Postgres не
поддерживает `ADD CONSTRAINT IF NOT EXISTS` — см. РЭ.21.8.15 hotfix).

### Старые колонки — deprecated, не удаляются в этой фазе

`student_pages_per_student`, `student_friend_photos`, `student_has_quote`
остаются в БД и в API. Engine приоритетно читает `student_layout_mode`,
fallback на legacy:

| `student_layout_mode` | поведение                                                    |
|-----------------------|--------------------------------------------------------------|
| `NULL`                | legacy — fallback на жёсткие имена по `density` / `preset.id` |
| `'page'`              | семантика, `pages_per_student=1`                              |
| `'spread'`            | семантика, `pages_per_student=2`                              |
| `'grid'`              | семантика, использует `student_grid_size`                     |

UI при сохранении дублирует данные в legacy:
- `mode='page'`  → `student_pages_per_student=1`
- `mode='spread'` → `student_pages_per_student=2`
- `mode='grid'`  → `student_pages_per_student=NULL` (legacy не знает grid)

Это нужно чтобы при откате кода (rollback Vercel) старая логика
семантического поиска (РЭ.21.8.15 для Individual) продолжала работать.

Удаление deprecated полей — **отдельная сессия**, не в РЭ.22. По правилам
безопасных миграций (см. контекст v90 §«Правила безопасных миграций БД»):
сначала код перестаёт писать в старое → деплой → дождаться → потом
`DROP COLUMN`. С двойным подтверждением необратимости от Сергея.

---

## 4. API контракт (`/api/tenant` action=`rule_preset_update`, РЭ.22.2)

Валидация новых полей:

```typescript
// student_layout_mode
if (body.student_layout_mode !== undefined) {
  if (body.student_layout_mode === null) {
    patch.student_layout_mode = null;
  } else if (typeof body.student_layout_mode === 'string' &&
             ['page', 'spread', 'grid'].includes(body.student_layout_mode)) {
    patch.student_layout_mode = body.student_layout_mode;
  } else {
    return 400 'student_layout_mode должен быть page/spread/grid или null';
  }
}

// student_grid_size
if (body.student_grid_size !== undefined) {
  if (body.student_grid_size === null) {
    patch.student_grid_size = null;
  } else {
    const n = Number(body.student_grid_size);
    if (!Number.isInteger(n) || n < 2 || n > 12) {
      return 400 'student_grid_size должен быть целым 2..12 или null';
    }
    patch.student_grid_size = n;
  }
}
```

Cross-field валидация (рекомендуется как warning, не блокирует):
- `mode='grid'` + `student_grid_size IS NULL` → warning «для grid нужен
  размер сетки»
- `mode='page'|'spread'` + `student_grid_size NOT NULL` → warning «для
  page/spread параметр grid_size игнорируется»

API расширения для `rule_presets_list`:
- `SELECT` добавляет `student_layout_mode`, `student_grid_size`

---

## 5. UI контракт (`PresetEditorModal`, РЭ.22.3)

### Новый блок «Личный раздел» (заменяет существующий)

```
┌─ Личный раздел ───────────────────────────────────────────┐
│                                                             │
│  Режим: [ ▼ Сетка из N учеников на страницу ]             │
│         (1 ученик/страница | 1 ученик/разворот | сетка)    │
│                                                             │
│  ┌─ Параметры (показываются в зависимости от режима) ────┐│
│  │                                                          ││
│  │  [grid only]                                             ││
│  │  Учеников на страницу: [ 12 ]   (свободный input 2..12)  ││
│  │                                                          ││
│  │  [page/spread only]                                      ││
│  │  Фото с друзьями: [ 4 ]   (свободный input 0..10)         ││
│  │                                                          ││
│  │  [все режимы]                                            ││
│  │  Цитата: [ ☑ да ]   (бул свитч)                         ││
│  │                                                          ││
│  └──────────────────────────────────────────────────────────┘│
│                                                             │
│  ⚠ Для этого пресета не найдены мастера с такими тегами:    │
│  • page_role='student_grid_left', slot_capacity.students=5, │
│    has_quote=true                                           │
│  (диагностика появится в РЭ.22.9)                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Логика селекта режима

Селект режима — required (нет null-варианта, минимум один вариант
выбран). При первом открытии пресета без `student_layout_mode` —
fallback на режим по legacy:
- `density='medium'|'light'|'mini'` → `mode='grid'` + `grid_size`=4/6/12
- `density='standard'|'universal'` → `mode='page'`
- `density=NULL` + `id='maximum'|'individual'` → `mode='spread'`

UI этот fallback не сохраняет автоматически — пока партнёр не нажал
«Сохранить», в БД остаётся NULL. Это сознательно: видим, какие пресеты
ещё не мигрированы.

### Сохранение

При нажатии «Сохранить» UI отправляет:
- `student_layout_mode: 'page'|'spread'|'grid'`
- `student_grid_size: int|null` (заполнен только когда mode='grid')
- `student_friend_photos: int|null` (заполнен только когда mode='page'|'spread')
- `student_has_quote: bool` (для всех режимов)
- Legacy `student_pages_per_student: 1|2|null` (см. §3, дублирование)

### Старые поля в UI

В РЭ.22.3 убираем три прежних селекта (`student_pages_per_student`,
`student_friend_photos`, `student_has_quote` показанные как 3 независимых
поля). Их заменяет новый блок. Сами колонки в БД остаются — это
не противоречит, у нас просто новый UI, который пишет и в новые поля
и в legacy.

---

## 6. Engine: семантический поиск (РЭ.22.4-6)

### 6.1. Решение о маршруте в `fillStudentsSection`

Текущая логика в `lib/rule-engine/sections/students.ts`:
- Решение по `preset.density` → жёсткие имена.

После РЭ.22.4-6:
1. Если `preset.student_layout_mode === 'page'` → `buildPageSemantic`
2. Если `preset.student_layout_mode === 'spread'` → `buildSpreadSemantic`
   (текущий `buildOnePerSpreadAdaptive` — основа)
3. Если `preset.student_layout_mode === 'grid'` → `buildGridSemantic`
4. Если `student_layout_mode IS NULL` → fallback на текущую legacy-логику
   (по `density` / `preset.id`). Это путь обратной совместимости — старые
   пресеты не ломаются.

### 6.2. Контракт `findStudentMaster` (расширение для grid, РЭ.22.6)

Сейчас функция жёстко фильтрует `studentsCap === 1`. Снимаем ограничение,
вводим параметр `studentsCount`:

```typescript
export interface StudentLayoutRequest {
  presetId: string;
  pageRole?: 'student' | 'student_left' | 'student_right'
           | 'student_grid' | 'student_grid_left' | 'student_grid_right' | null;
  studentsCount: number;   // 1 для page/spread, N для grid (was implicit=1)
  photosFriend?: number;   // только для page/spread (studentsCount=1)
  hasQuote?: boolean | null;
  hasPortrait?: boolean | null;
}
```

Алгоритм поиска при `studentsCount > 1`:
1. Фильтр `applies_to_configs`, `page_role`, `slot_capacity.students === studentsCount`.
2. Фильтр `has_quote` — для grid это «у мастера есть quote-слот для каждого
   ученика». Соглашение (см. §6.4): мастер ставит `slot_capacity.has_quote=true`
   тогда и только тогда, когда `studentquote_N` placeholder есть для всех
   `N ∈ [1..students]`. Гибридные мастера (`has_quote` только для части
   учеников) **не маркируются** — engine их игнорирует с warning.
3. `photos_friend` для grid обычно не используется (фото с друзьями
   характерно для page/spread). Если задан — фильтр по точному совпадению.
4. Если несколько кандидатов прошли фильтр — берём первого по итерации
   (порядок Map'а сохраняется). Опционально: сортировка по имени для
   детерминизма (см. развилку D.1 ниже).

### 6.3. Контракт `findStudentGridTailMaster` (новая функция, РЭ.22.6)

Для адаптивного хвоста: ищем мастер с `slot_capacity.students = remainder`.

```typescript
export interface StudentGridTailRequest {
  presetId: string;
  studentsCount: number;        // remainder, e.g. 7
  hasQuote?: boolean | null;
  fullClassFrames?: number;     // 0 = обычный adaptive, 1 = combined
                                // (мастер с N учениками + 1 общее фото)
}
```

Если функция не находит мастер с `students=remainder + photos_full=0` для
combined=false режима — возвращает null. Caller (`buildGridSemantic`)
делает fallback по той же логике что сейчас в `buildGrid`:
- `combined` (с full_class фото)
- adaptive (без full_class)
- base-master с null'ями (хвост короче слотов)

### 6.4. Соглашение по `slot_capacity` для grid-мастеров

Мастер размечается так:

```jsonb
-- M-Grid-Page (4 ученика, без цитат)
"slot_capacity": {
  "students": 4,
  "has_quote": false,
  "has_portrait": true,
  "has_name": true
}

-- M-Combined-Page (3 ученика + 1 общее фото класса)
"slot_capacity": {
  "students": 3,
  "photos_full": 1,
  "has_quote": false,
  "has_portrait": true,
  "has_name": true
}

-- L-Grid-Page (6 учеников, с цитатами для всех)
"slot_capacity": {
  "students": 6,
  "has_quote": true,
  "has_portrait": true,
  "has_name": true
}
```

`page_role` для grid:
- `student_grid_left` — левая страница (чётный pageIndex с 0)
- `student_grid_right` — правая страница (нечётный)
- `student_grid` — если мастер симметричный (можно ставить и слева и
  справа). При поиске engine принимает `student_grid` как fallback,
  когда `student_grid_left` / `student_grid_right` не найдены.

Под применение текущих M/L/N-Grid-Page нужна data-миграция (РЭ.22.6.0,
до перехода engine на семантику). Подготовлю SQL по образцу
`migrations/2026-05-19-okeybook-default-student-master-tags.sql`.

### 6.5. teachers / soft_intro / soft_final (РЭ.22.7-8)

**teachers (РЭ.22.7).** Текущий `lib/rule-engine/sections/teachers.ts`
содержит таблицу для subjects 0 / 1-4 / 5-8 / 9 / 10-12 / 13-16 / 17+:
- Левая: `F-Head-WithPhoto` / `F-Head-SmallGrid` / `F-Head-LargeGrid`
- Правая: `G-HalfClass` / `G-FullClass` / `G-Teachers-3x3/4x3/4x4`

Семантика:
- `page_role`: `teacher_left` / `teacher_right`
- `slot_capacity`: `head_teacher`, `teachers`, `photos_full`, `photos_half`

Алгоритм для левой стороны (subjects):
- Ищем мастер с `page_role='teacher_left'` + `head_teacher=1` +
  `teachers ≥ subjects_count` (минимально-достаточный).
- Если в библиотеке таких нет — warning со спецификацией.

Алгоритм для правой стороны:
- Если subjects ≥ 9 — мастер с `page_role='teacher_right'` + `teachers ≥ (subjects-8)`.
- Иначе — мастер с `page_role='teacher_right'` + `photos_half ≥ 2` если
  `half_class ≥ 2`, иначе `photos_full ≥ 1` если `full_class ≥ 1`.

**soft_intro (РЭ.22.8).** Сейчас жёсткое имя `S-Intro`. Семантика:
- `page_role='intro'` + `photos_full ≥ 1`.

**soft_final (РЭ.22.8).** Аналогично — текущий код в `soft-final.ts`
посмотреть, заменить жёсткие имена на семантический поиск.

---

## 7. Контракт slot_capacity-тегов для дизайнера

Это перенос обновляемой части в `docs/templates/master-cleanup-tz.md`
(делаем в РЭ.22.6.0 параллельно с data-миграцией).

Для каждого мастера нужны:
1. `page_role` — обязательно. Значения см. в `lib/album-builder/types.ts`
   (тип `PageRole`).
2. `slot_capacity` — обязательно. Минимум:
   - `students` — сколько учеников помещается (1, 2, 3, ..., 12)
   - `has_portrait`, `has_name` — обычно true для всех ученических мастеров
   - `has_quote` — true только если quote-слот есть **у каждого** ученика
   - `photos_friend` — для page/spread мастеров (сколько фото с друзьями)
   - `photos_full`, `photos_half`, `photos_quarter`, `photos_sixth` — для
     combined-мастеров и общего раздела
3. `applies_to_configs` — опционально. Массив `preset.id` для которых
   мастер доступен. Пустой = универсальный.

---

## 8. Диагностика недостающих мастеров (РЭ.22.9)

Когда `find*` возвращает null — engine добавляет warning с конкретной
спецификацией. Формат:

```
students_master_not_found: для пресета 'standard' (mode=page) не найден
мастер с page_role='student_left', slot_capacity.students=1, photos_friend=4,
has_quote=true, has_portrait=true. Закажите мастер у дизайнера.
```

Это **строка** (warning), не структурный объект (см. развилку D.2).
Опционально в РЭ.22.9 — UI-сводка на карточке пресета («для этого пресета
нужны такие мастера, у вас не хватает X»).

---

## 9. Скоуп: что входит / не входит

### Входит в РЭ.22

| Подэтап   | Что                                                                |
|-----------|--------------------------------------------------------------------|
| РЭ.22.0   | docs/phase-Р22-spec.md (этот файл) ✅                              |
| РЭ.22.1   | Миграция БД: student_layout_mode + student_grid_size + CHECK'и     |
| РЭ.22.2   | Типы (Preset) + API валидация (rule_preset_update) + SELECT в list |
| РЭ.22.3   | UI: двух-осевая модель в PresetEditorModal                          |
| РЭ.22.4   | Engine semantic для mode='page' (Standard/Universal) + тесты       |
| РЭ.22.5   | Engine semantic для mode='spread' (Maximum/Individual) + тесты     |
| РЭ.22.6.0 | data-миграция: page_role+slot_capacity для M/L/N-Grid-Page         |
| РЭ.22.6   | Engine semantic для mode='grid' (Medium/Light/Mini) + тесты        |
| РЭ.22.7   | teachers секция: семантический поиск + тесты                        |
| РЭ.22.8   | soft_intro + soft_final: семантический поиск + тесты               |
| РЭ.22.9   | Диагностика недостающих мастеров (warnings + опц. UI-сводка)        |
| РЭ.22.10  | docs финал: контекст v(N+10), summary архитектуры                  |

### Не входит в РЭ.22

- `common_required` / `common_additional` / `transition` — уже работают через
  таблицу OkeyBook, не трогаем.
- Партнёрский UI редактор пресетов в `/app` (сейчас только `/super/presets`).
  Перенос — отдельная сессия.
- Создание / удаление / дублирование пресетов в `/super/presets`. Сейчас
  только edit. Отдельная сессия.
- UI селектор `template_set_id`. Сейчас фолбэк на `okeybook-default`.
- Левая сторона переходной (РЭ.21.8.11b) — 9 комбо-мастеров от дизайнера.
- Удаление deprecated `student_pages_per_student` / `student_friend_photos`
  / `student_has_quote`. Отдельная сессия с двойным подтверждением.

---

## 10. План подэтапов (детальный)

### РЭ.22.1 — Миграция БД (1 коммит)

Файл: `migrations/2026-05-XX-presets-student-layout-mode.sql`.
ADD COLUMN + 2 CHECK через DO-блоки. Применяется в Supabase Сергеем.

### РЭ.22.2 — Типы + API (1 коммит)

Файлы:
- `app/super/presets/_components/PresetEditorModal.tsx` — расширение `Preset` интерфейса
- `app/api/tenant/route.ts` — расширение SELECT в `rule_presets_list`,
  валидация в `rule_preset_update`
- `lib/rule-engine/types.ts` — если PresetSnapshot существует, расширить

tsc + next build зелёные. UI ещё не меняем.

### РЭ.22.3 — UI двух-осевая модель (1 коммит)

Файл: `app/super/presets/_components/PresetEditorModal.tsx`.
- Заменяем 3 поля на блок «Личный раздел» с селектом режима.
- Параметры показываются по селекту режима.
- Save пишет в новые + дублирует в legacy.
- Fallback при первом открытии — см. §5.

### РЭ.22.4 — Engine mode='page' (1 коммит)

Файлы:
- `lib/rule-engine/sections/students.ts` — новая `buildPageSemantic`.
- `lib/rule-engine/master-finder.ts` — если нужно расширение (skip studentsCap==1).
- `lib/rule-engine/__tests__/sections-students-page-semantic.test.ts` — 5-8 тестов.

Engine использует семантику только когда `student_layout_mode='page'`.
Иначе fallback на текущую `buildAlternatingLR` / `buildOnePerSpread`.

### РЭ.22.5 — Engine mode='spread' (1 коммит)

Файлы:
- `lib/rule-engine/sections/students.ts` — новая `buildSpreadSemantic` или
  переименование `buildOnePerSpreadAdaptive`.
- Тесты.

### РЭ.22.6.0 — Data-миграция grid-мастеров (1 коммит)

Файл: `migrations/2026-05-XX-okeybook-grid-master-tags.sql`.
UPDATE spread_templates SET page_role=..., slot_capacity=... WHERE name IN ('M-Grid-Page', 'L-Grid-Page', 'N-Grid-Page', 'M-Combined-Page', 'L-Combined-Page', 'N-Combined-Page', 'L-2', 'L-3', 'L-4', 'N-4', 'N-6', 'N-9').

Применяется Сергеем до деплоя кода РЭ.22.6 (по правилу ADD-first для
данных тоже — старая логика не читает теги, новая будет).

### РЭ.22.6 — Engine mode='grid' (1 коммит)

Файлы:
- `lib/rule-engine/sections/students.ts` — новая `buildGridSemantic`,
  `findStudentGridTailMaster`.
- `lib/rule-engine/master-finder.ts` — расширение для studentsCount > 1.
- Тесты.

### РЭ.22.7 — teachers (1-2 коммита, может быть разбит)

Файл: `lib/rule-engine/sections/teachers.ts`. Замена slot-chains на
семантику. Может быть разбит на 7.1 (head_teacher левая) + 7.2 (правая).

### РЭ.22.8 — soft_intro + soft_final (1 коммит)

Файлы: `lib/rule-engine/sections/soft-intro.ts`, `soft-final.ts`.

### РЭ.22.9 — Диагностика (1 коммит)

Расширение warnings + опц. UI-сводка на карточке пресета.

### РЭ.22.10 — финал (1 коммит)

`docs/phase-Р22-summary.md`, контекст v(N).

---

## 11. Развилки — журнал решённого

Все развилки решены 20.05.2026 в чате с Сергеем (browser).

| #  | Развилка                                | Решение                                                                     |
|----|------------------------------------------|-----------------------------------------------------------------------------|
| 1  | Схема БД (две колонки vs jsonb)          | **A** — две колонки `student_layout_mode` + `student_grid_size`              |
| 2  | Что с legacy `student_pages_per_student` | **A** — оставляем deprecated, новый код дублирует. Удаление — отдельной сессией |
| 3  | Скоуп: только students или + teachers/soft | **A** — students + teachers + soft_intro/soft_final (как в v90)             |
| 4  | `page_role` для grid                     | используем `student_grid_left/right/student_grid` (fallback). Data-миграция в РЭ.22.6.0 |
| 5  | Адаптивный хвост: явный список vs автопоиск | **A** — автопоиск через семантику                                            |
| 6  | `has_quote` для grid                     | **A** — true только если у всех учеников есть quote-слот                     |
| 7  | `student_grid_size`: enum vs свободный    | **B** — свободный int 2..12. Можно обратимо ужесточить в селект позже         |
| 8  | Формат диагностики                       | **A** — текстовая строка в warning. UI-сводка опционально в РЭ.22.9         |
| 9  | UI: /super/presets vs /app               | **A** — только /super/presets. Партнёрский UI — отдельная сессия            |
| 10 | Старт: с UI или с engine                  | миграция → API → UI → engine                                                  |

---

## D. Открытые развилки (могут возникнуть по ходу)

### D.1. Детерминизм поиска при нескольких подходящих мастерах

Сейчас `findStudentMaster` возвращает первого по итерации Map'а. Порядок
итерации Map'а в JS детерминированный (порядок вставки), но если в БД
порядок мастеров меняется — выбор тоже. Если важно фиксировать выбор —
можно сортировать кандидатов по имени.

**Решение по умолчанию:** оставляем порядок Map'а. Если в РЭ.22.4-6 на
тестах увижу проблему — добавлю сортировку.

### D.2. Структурный объект для диагностики

Сергей выбрал A (текстовая строка). Если в РЭ.22.9 при делании UI-сводки
выяснится, что парсить строку неудобно — добавлю параллельное поле
`build_result.missing_masters: MissingMasterSpec[]`. Это аддитивно,
не ломает RA.

### D.3. Обработка `student_grid_size` для случая «партнёр указал 5, а в библиотеке 4/6»

Engine возвращает warning + НЕ строит секцию. Альтернатива: fallback на
ближайший меньший (4 учеников на страницу, остаток в combined-tail).
Решим на тестах в РЭ.22.6 — если кейс реалистичный, добавлю fallback.

---

**Конец spec'а v1.0. Изменения — версионируются, новый файл
`docs/phase-Р22-spec-v1.1.md` (но не редактируется этот в обратной
несовместимости).**
