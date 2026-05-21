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

## Что осталось выяснить

После получения от Сергея результатов SQL по вопросам 4 и 7:

1. **Почему семантика не нашла teachers-мастера** в тесте — пройти по `findTeacherMaster` и точно понять параметры запроса.
2. **Что делает общая ветка** в `students.ts` (для пресетов которые не maximum / individual).
3. **Как engine использует `section_structure_preset_id`** — slug из БД или захардкоженный switch.

После ответа на эти 3 вопроса — пишем spec фазы.
