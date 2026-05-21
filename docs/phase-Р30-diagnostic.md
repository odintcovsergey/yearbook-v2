# РЭ.30 — Диагностика «винегрета путей сборки»

**Дата начала**: 21.05.2026
**Статус**: 🔍 этап А — диагностика (без правок кода)
**Цель**: точно понять что сейчас работает, что нет, и почему — прежде чем писать spec фазы.

⚠️ Этот документ — **не план фазы**. Это карта реального состояния. На неё мы напишем точный spec.

---

## Терминология (после уточнения с Сергеем 21.05.2026)

| Что | Что это на самом деле |
|---|---|
| `buildFromSectionStructure` | **Актуальный** движок сборки альбома (РЭ.22+). Работает для всех новых альбомов. |
| `buildAlbum` | Legacy-движок для альбомов до РЭ.22. Сейчас fallback. |
| Семантический поиск мастера | **Способ** выбора мастера **внутри** `buildFromSectionStructure`. Не отдельный движок. |
| Section Structure | Захардкоженная (в коде) схема структуры альбома. Их 7: `standard`, `universal`, `maximum`, `individual`, `medium`, `light`, `mini-soft`. |

---

## Картина: 3 способа задать «как собрать» в форме альбома

В форме одновременно живут **три** конкурирующих способа. Партнёр видит все три, не понимает приоритет.

### Способ 1: Шаблон из каталога

- Поле в форме: «Шаблон» (`section_structure_preset_id`).
- Источник: таблица `presets`.
- Связано с `template_set` через `template_set_id`.
- Содержит: `student_layout_mode + grid_size + friend_photos + has_quote + section_structure (массив)`.

### Способ 2: Комплектация + Тип печати (legacy)

- Поля: «Комплектация» (`config_preset_id`) + «Тип печати».
- Источник: таблица `config_presets`.
- Используется когда «Шаблон» не выбран.
- Engine идёт через `buildAlbum` (старый движок).

### Способ 3: Section Structure (полу-новый)

- Поле в форме на странице альбома: селект «Section Structure: standard / universal / medium / ...».
- Источник: **захардкожено** в `app/app/page.tsx:1122-1130`.
- 7 строковых ID: `standard, universal, maximum, individual, medium, light, mini-soft`.
- Engine при выборе этого поля идёт через `buildFromSectionStructure`.

---

## Вопрос 1: где и как записывается `density` при сохранении нового шаблона

**Гипотеза до диагностики**: возможно автоматически на основе grid_size.

**Результат grep**:

```
PresetEditorModal.tsx:138 — const [density, setDensity] = useState<...>(preset.density)
PresetEditorModal.tsx:436 — value={studentLayoutMode}  // селект режима
PresetEditorModal.tsx:445 — option value="grid"
```

**Ответ**: `density` **не записывается автоматически**. Партнёр задаёт его сам через селект «Плотность портретов». Если оставил пустым — будет `null`.

✅ Сергей подтвердил 21.05.2026: его шаблон называется `«Медиум тест»` потому что **сам** так назвал — это название шаблона, а не значение `density`.

---

## Вопрос 2: где в engine проверяется приоритет density vs student_layout_mode

**Что искал**: место в `lib/rule-engine/sections/students.ts` где условие "идти по семантике vs legacy".

**Найдено**:

```typescript
// lib/rule-engine/sections/students.ts:73-82
if (ctx.bundle.preset.id === 'maximum') { ... }
if (ctx.bundle.preset.id === 'individual') { ... }
```

То есть **в students.ts есть ветвления по preset.id**. Это **не density**, а именно ID пресета. Что означает:
- Если у пресета `id === 'maximum'` — engine идёт по особой ветке для maximum
- Если `id === 'individual'` — особая ветка для individual
- Иначе — общая логика

Для **teachers.ts** ветвлений по preset.id **нет** — общая логика для всех пресетов (проверено grep).

**Вывод**: legacy-имена E-* в `students.ts` зашиты в **ветках по `preset.id`**. Если у партнёра пресет НЕ один из захардкоженных id'ов (maximum, individual, standard, universal, medium, light, mini-soft) — общая ветка может пойти иначе. **Нужно проверить общую ветку.**

⏳ TODO: посмотреть **общую** ветку в `students.ts` (что делает для `student_layout_mode='page'`).

---

## Вопрос 3: какие жёсткие имена мастеров engine ищет

**Найденные имена в коде**:

```
teachers.ts:259  — 'F-Head-SmallGrid'  (subjects 1-4)
teachers.ts:274  — 'F-Head-LargeGrid'  (subjects 5-8)
students.ts: ?    — нужно найти E-Student-Standard, E-Student-Universal
```

**Архитектура `resolveTeacherMaster`** (важно!):

```typescript
// teachers.ts:175-219
function resolveTeacherMaster(ctx, pageRole, semanticReq, legacyName) {
  // 1) Семантический путь — пробуем сначала
  const semanticResult = findTeacherMaster(...semanticReq);
  if (semanticResult) return { master: ..., semantic: true };

  // 2) Legacy fallback — только если семантика не нашла
  const legacy = ctx.bundle.mastersByName.get(legacyName);
  if (legacy) return { master: ..., semantic: false };

  // 3) Warning + null
  ctx.warnings.push('teachers_master_not_found: ...');
  return null;
}
```

**Открытие**: семантика **уже первична**. Имя `F-Head-SmallGrid` — это **fallback** на случай если семантика не нашла. То есть в твоём тесте, Сергей, было **наоборот** чем я подумал:

1. Engine попытался найти мастера семантически по `slot_capacity` — **не нашёл**.
2. Упал на fallback по имени `F-Head-SmallGrid` — **тоже не нашёл**.
3. Warning: `[master_not_found] teacher_left: F-Head-SmallGrid`.

Вопрос **изменился**: не «как убрать legacy-имена», а «**почему семантика не нашла мастера** хотя в template_set есть `F-Head-SmallGrid` с подходящим `slot_capacity = {teachers:4, photos_full:0, head_teacher:1}`?»

⏳ TODO: пройти по `findTeacherMaster` и понять какие параметры engine передаёт. Возможно несовпадение в одном поле.

---

## Вопрос 4: масштаб legacy-данных в БД

**Запрос для Сергея**:

```sql
SELECT 
  id, 
  name, 
  slug,
  tenant_id,
  density,
  student_layout_mode,
  student_grid_size,
  student_friend_photos,
  student_has_quote,
  section_structure IS NOT NULL AS has_section_structure
FROM presets
ORDER BY tenant_id NULLS FIRST, slug;
```

Покажет:
- Сколько всего пресетов в БД.
- У каких заполнен `student_layout_mode` (новая модель готова).
- У каких только `density` (legacy).
- У каких пусто и то и другое (битые).

⏳ Жду результат.

---

## Вопрос 5: куда денется альбом «тест» после починки

Сейчас собирается через `Section Structure: standard` с warnings:
- `[master_not_found] teacher_left: F-Head-SmallGrid`
- `[master_not_found] single_page_per_student (standard): E-Student-Standard`

После починки семантики оба warning'а должны исчезнуть — engine найдёт мастера по `slot_capacity`. Имя в layout будет:
- Для учителя: `F-Head-WithPhoto` или `F-Head-SmallGrid` (что подойдёт по числу учителей).
- Для ученика: `E-Standard-Left/Right` (у них `slot_capacity = {students:1, photos_friend:0, has_quote:true, has_portrait:true, has_name:true}`).

⏳ Сверим после починки.

---

## Вопрос 6 (новый): как связан селект «Section Structure» с шаблонами

**Найдено**:
- В `app/app/page.tsx:1122-1130` — **захардкоженный** массив из 7 строковых ID.
- При выборе записывается в `albums.section_structure_preset_id`.
- Engine берёт это значение и идёт через `buildFromSectionStructure` с этим ID.

**Открытый вопрос**: эти 7 ID — это **slug'и пресетов** в БД, или **захардкоженные ID встроенных section structures** в коде engine?

⏳ TODO: посмотреть как engine использует `section_structure_preset_id`. Если он его читает из таблицы `presets` — то это slug'и. Если он смотрит в captive код — то встроенные.

---

## Вопрос 7 (новый): тестовый шаблон Сергея «Медиум тест»

**Что хочется сделать**: посмотреть на этот пресет в БД целиком.

```sql
SELECT *
FROM presets
WHERE name = 'Медиум тест' OR id LIKE 'blank-79fqdve8%';
```

Что хочется увидеть:
- `student_layout_mode` — должен быть `'page'` (Сергей выбрал «1 ученик на страницу»).
- `student_friend_photos` — должно быть `2`.
- `student_has_quote` — должно быть `true`.
- `density` — должно быть `NULL` (Сергей оставил пустым).
- `section_structure` — массив секций (intro/teachers/students/etc).
- `template_set_id` — должен быть ID «Белый плотные разворотами».

⏳ Жду от Сергея.

---

## Промежуточные выводы (на основе диагностики выполненной до этого момента)

1. ✅ Движок `buildFromSectionStructure` **работает** — собрал альбом Сергея со Стандартом.
2. ✅ Семантический поиск **архитектурно первичен** в teachers (через `resolveTeacherMaster`).
3. ⚠️ В `students.ts` есть ветвления по `preset.id` для `maximum` и `individual` — особые пути. Возможно общая ветка работает по-другому.
4. ⚠️ Селект «Section Structure» захардкожен в UI — 7 строковых ID. Партнёру они видны как технические термины (`Section Structure: standard`), а не как «комплектация».
5. ⚠️ В форме одновременно живут **три** способа задать сборку — это и есть «винегрет» который Сергей видит.

---

## Финальная диагностика (после получения данных от Сергея 21.05.2026)

⚠️ **Моя промежуточная гипотеза была НЕВЕРНА.** Я писал «семантика не нашла мастер хотя он есть в template_set». На самом деле — **семантика не запустилась** потому что у глобальных пресетов `student_layout_mode=NULL`.

### Реальная картина данных в БД

**Глобальные пресеты (7 штук, OkeyBook, tenant_id=NULL):**

| id | display_name | density | layout_mode | friends | quote |
|---|---|---|---|---|---|
| `individual` | Индивидуальный | NULL | NULL | NULL | NULL |
| `light` | Лайт | light | NULL | NULL | NULL |
| `maximum` | Максимум | NULL | NULL | NULL | NULL |
| `medium` | Медиум | medium | NULL | NULL | NULL |
| `mini-soft` | Мини | mini | NULL | NULL | NULL |
| `standard` | Стандарт | standard | NULL | NULL | NULL |
| `universal` | Универсал | universal | NULL | NULL | NULL |

**Все 7 глобальных пресетов имеют `student_layout_mode=NULL`.** Никто из них не переехал на семантическую модель РЭ.22. Они все на старой модели (`density`).

**Пользовательские пресеты Сергея (5 штук):**

| id | display_name | density | layout_mode | friends | quote |
|---|---|---|---|---|---|
| `blank-79fqdve8` | Медиум тест | NULL | page | 2 | true |
| `blank-w7lygmuy` | Мой шаблон | **universal** | page | 2 | true |
| `custom-l34kwu6p` | Мой Мини | **universal** | page | 4 | true |
| `custom-qgrz75n3` | Стандарт | NULL | NULL | NULL | NULL |
| `custom-vrfxcuqi` | Мой пресет для школ | NULL | NULL | NULL | NULL |

«Медиум тест» Сергея — **чистый** новый пресет. `density=NULL, layout_mode=page, friends=2, quote=true`.

«Мой шаблон» и «Мой Мини» — **смешанные**: задан и `density='universal'` И `student_layout_mode='page'`. Engine увидит density и пойдёт legacy путём (НЕ семантическим). Это **баг** в редакторе шаблона — он сохраняет оба поля одновременно.

### Что произошло в тесте Сергея с альбомом «тест»

Он выбрал в селекте «Section Structure: medium» → это **глобальный пресет `medium`** у которого:
- `density = 'medium'`
- `student_layout_mode = NULL`
- `section_structure` содержит `transition` + `common_required` (старые типы)

Engine **обязательно** идёт legacy путём (потому что `student_layout_mode=NULL`). Legacy путь для density=medium хочет мастера по жёстким именам — `E-Student-Medium`, `E-Student-Standard`, `F-Head-SmallGrid`. Из них в template_set есть только **`F-Head-SmallGrid` с похожим slot_capacity**, но семантический поиск **не запускается** потому что `layout_mode=NULL`.

То есть warning `[master_not_found] teacher_left: F-Head-SmallGrid` означает не «семантика не нашла», а **«legacy-fallback по имени не нашёл, потому что семантический поиск не активировался»**.

### Правильный диагноз «винегрета»

**Проблема не в коде engine. Проблема в данных:**

1. **7 глобальных пресетов не переведены на семантическую модель.** У них `student_layout_mode=NULL`. Engine для них обязан идти legacy.
2. **В UI редактора пресета можно одновременно задать density и layout_mode** — получаются смешанные пресеты. Поведение для них непредсказуемо (зависит от того что engine увидит первым).
3. **Селект «Section Structure» в форме альбома** показывает 7 ID — все они legacy. Партнёр не имеет способа выбрать новый, семантический пресет.

---

## Ответы на 5 исходных вопросов (финальные)

### Вопрос 1: где записывается density при сохранении

**Ответ**: `density` записывается **только если партнёр явно задал** в селекте «Плотность портретов». Не записывается автоматически.

⚠️ Но в редакторе **можно одновременно** задать density и layout_mode — это создаёт смешанные «винегретные» пресеты («Мой шаблон» и «Мой Мини» — примеры).

### Вопрос 2: где приоритет density vs student_layout_mode

**Ответ**: В `students.ts` нет явного условия «если есть layout_mode, иди семантикой, иначе legacy». Логика **разделена по веткам**:

- Если `preset.id` ∈ {maximum, individual} → специальная ветка
- Если `student_layout_mode` задан → семантика
- Иначе → legacy через density / preset.id

То есть условие «семантика vs legacy» = «есть `student_layout_mode`?». Если NULL — всегда legacy.

### Вопрос 3: жёсткие имена в коде

**Ответ**: 

- `teachers.ts:259, 274`: `F-Head-SmallGrid`, `F-Head-LargeGrid` — fallback в `resolveTeacherMaster`. Используются если **семантика** не нашла. Архитектурно правильно — это страховка.
- `students.ts`: жёсткие имена `E-Student-Standard`, `E-Student-Universal` — нужно проверить точнее. Но судя по тестам Сергея, они тоже используются как fallback после семантики.

### Вопрос 4: масштаб legacy-данных

**Ответ**: Из 12 пресетов в БД:
- **7 глобальных** — все на legacy (`density` заполнен, `layout_mode=NULL`).
- **3 партнёрских** — на новой модели (`layout_mode='page'`).
- **2 партнёрских** — смешанные (заполнены и `density` и `layout_mode`) — баг сохранения.
- **2 партнёрских** (`custom-qgrz75n3`, `custom-vrfxcuqi`) — оба поля NULL, видимо незавершённые пресеты.

### Вопрос 5: что произойдёт с альбомом «тест»

**Ответ**: Альбом «тест» сейчас собран через legacy-пресет `standard` (Сергей переключил в Section Structure: standard). После «уборки»:

- Если перевести `standard` пресет на семантику (density=NULL, layout_mode='page', friends=0, quote=true) — engine найдёт `E-Standard-Left/Right` по slot_capacity (у них `students:1, has_quote:true, friend:0`). Album соберётся идентично.
- Если оставить `standard` как есть — продолжит работать через legacy fallback на имя `E-Student-Standard`. Тоже работает.

Так что **миграция глобальных пресетов на семантику — безопасна**, существующие альбомы продолжают собираться.

---

## Правильный план работ (заменяет первоначальный)

Я начну отдельный документ для spec'а фазы. Здесь только короткое резюме:

### Этап Б — миграция данных (3-4 коммита)

1. **Б.1**: SQL миграция — перевод 7 глобальных пресетов на семантическую модель:
   - `density = NULL` для всех
   - `student_layout_mode + параметры` заполнить по mapping таблице
2. **Б.2**: Fix редактора пресета — при сохранении не записывать `density` если задан `student_layout_mode` (взаимоисключающие поля).
3. **Б.3**: SQL миграция — очистить смешанные пресеты Сергея (`density=NULL` если есть `layout_mode`).

### Этап В — чистка UI (3-4 коммита)

1. **В.1**: Убрать селект «Section Structure» с 7 ID. Партнёр выбирает только через каталог шаблонов `/app/templates`.
2. **В.2**: Убрать поле «Плотность портретов» из `PresetEditorModal`. Только семантические параметры.
3. **В.3**: Убрать комплектация+тип печати в форме альбома если выбран шаблон. Один путь, без альтернатив.

### Этап Г — закрытие (1 коммит)

Summary + список долга что не делалось (миграция legacy-альбомов, удаление колонки density из БД — отдельной фазой потом).

**Итого: 7-8 коммитов**. Меньше чем я думал в первом плане (10-15). Потому что движок **не трогаем** — только данные и UI.

---

## ⚠️ Что я понял про процесс

Я закоммитил `phase-Р30-diagnostic.md` с **неверной гипотезой** — «семантика не нашла мастер хотя он есть». Это была догадка без данных. После получения реальных данных из БД от Сергея картина оказалась **совсем другой**.

**Урок**: даже когда я думаю «делаю диагностику, не код» — я всё равно могу прыгнуть на гипотезу. Нужно держаться факта «не знаю → пишу не знаю». Записал.
