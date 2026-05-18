# Фаза РЭ.20 — Полная матрица структуры альбома

**Версия:** v1.0
**Дата:** 18.05.2026
**Статус:** ТЗ, готово к реализации после РЭ.12
**Связано:** docs/rule-engine-spec.md v1.3, РЭ.18, РЭ.19.1

## 1. Контекст

После реализации rule engine (РЭ.10..РЭ.18) и точечного фикса для
маленьких классов (РЭ.19.1) обнаружено что **архитектура общего раздела
неверна**. Текущая логика — «по убыванию размера фото» (full → half →
quarter → sixth) — не соответствует дизайнерским ожиданиям Сергея.

Правильная архитектура описана в `docs/templates/album-structure-matrix.xlsx`
(дизайнерская спецификация автоверстки в InDesign, проверенная на
производстве). Эта матрица — источник правды.

Документ конвертирован в машинно-читаемый JSON:
`docs/templates/album-structure-matrix.json` (28 записей).

## 2. Ключевые открытия из матрицы

### 2.1. Фиксированное число страниц альбома

У каждой комплектации **фиксированное total_pages** — атрибут пресета,
не альбома. Алгоритм планирования работает в этих рамках:

```
remaining_pages = total_pages
                - intro_pages          (1 для soft, 0 для hard)
                - head_teacher_pages   (1 или 2 в зависимости от пресета)
                - student_section_pages (вычисляется из students × density)
                - final_pages          (1 для soft, 0 для hard)
common_section_pages = remaining_pages
```

При большом классе общий раздел сжимается до минимума.
При маленьком — расширяется альтернативами.

Текущее поле `albums.common_section_max_spreads` устарело — оно становится
**вычисляемым** атрибутом, не настройкой партнёра. Партнёр настраивает
`total_pages` (через UI пресета — РЭ.12).

### 2.2. Обязательный vs дополнительный общий раздел

Матрица различает:
- **Обязательный общий раздел** (mandatory): первые 1-6 страниц после
  личного раздела. Структура жёстко задана матрицей.
- **Дополнительный общий раздел** (additional): следующие 1-5 страниц
  если у партнёра много фотоматериала.

### 2.3. Альтернативы на странице

Многие ячейки матрицы содержат **3 альтернативы**:
> «либо 6 фото 1/6, либо 2 по 1/2 класса, либо 1 общая»

Решение: **авто-выбор по приоритету наличия фотоматериала**:
1. Если у партнёра ≥6 фото категории `sixth` → ставим '6×1/6' (макс. использование материала)
2. Иначе если ≥2 `half_class` → '2 по 1/2 класса'
3. Иначе если ≥1 `full_class` → '1 общая'
4. Иначе — пустой слот (партнёр заменит мастер в редакторе)

Партнёр всегда может **вручную** заменить мастер в редакторе через
TemplatePickerModal.

### 2.4. Финал личного раздела с общим фото

Матрица различает 3 типа последнего разворота личного раздела:

| Случай | Левая | Правая |
|---|---|---|
| Точное заполнение grid (например 12 учеников Лайт) | `-` | `-` (не финальный) |
| Маленький хвост (1..N портретов помещаются на одной странице) | Combined-Page (портреты + общее снизу) | мастера общего раздела |
| Большой хвост (N+1..(2N) портретов) | Grid (полная) | Combined-Page (остаток + общее) |

Это уже частично реализовано в РЭ.19.1, но **точные интервалы** взяты из
матрицы (не аппроксимация). См. раздел 5.3.

### 2.5. Тип листов влияет на структуру

**Hard (плотные)**: intro/final не нужны, общий раздел сразу после головного.
**Soft (мягкие)**: первая страница = S-Intro, последняя = S-Final.
Иногда в S-Intro может быть **учительский разворот** (специальный случай).

Логика правил **одинаковая** — различается только общее число страниц и
наличие/отсутствие intro/final. Это упрощает реализацию: семантика правил
для hard и soft идентична, отличается только `total_pages` пресета.

## 3. Архитектура

### 3.1. Расширение Preset

```typescript
type Preset = {
  // существующие
  id: string
  slug: string
  display_name: string
  version: string
  print_type: 'layflat' | 'soft' | 'trumo'
  pages_per_spread: 2 | 3        // 2 для layflat/soft, 3 для trumo
  sections: Section[]

  // НОВОЕ в РЭ.20
  total_pages: number             // ФИКСИРОВАННОЕ общее число страниц альбома
  density: 'standard' | 'universal' | 'medium' | 'light' | 'mini'
  sheet_type: 'hard' | 'soft'

  // Глобальные пресеты OkeyBook (tenant_id=NULL) определяются изначально.
  // Партнёр в РЭ.12 копирует и меняет под свои нужды.
}
```

### 3.2. Расширение RulesAlbumInput

```typescript
type RulesAlbumInput = {
  // существующие
  students: Student[]
  subjects: Subject[]
  head_teacher: HeadTeacher
  common_photos: CommonPhotos
  print_type?: 'layflat' | 'soft'

  // НОВОЕ в РЭ.20
  // common_section_max_spreads УБРАН — теперь вычисляется из total_pages
}
```

### 3.3. Расширение RuleContext

```typescript
type RuleContext = {
  // существующие
  input: RulesAlbumInput
  cursors: Cursors
  common_section: { spreads_created, max_spreads, spreads_remaining }

  // НОВОЕ в РЭ.20
  pages_remaining: number         // total_pages - already_consumed_pages
  mandatory_section: {
    pages_pattern: PagePattern[]  // из матрицы для этой комбинации
    current_index: number         // какой странице сейчас обрабатываем
    pages_remaining: number       // сколько ещё страниц obligatory
  }
}

type PagePattern =
  | { type: 'quarter_pair' }     // '2 по 1/4 класса'
  | { type: 'half_pair' }        // '2 по 1/2 класса'
  | { type: 'full_one' }         // '1 общая'
  | { type: 'sixth_six' }        // '6 фото 1/6'
  | { type: 'alternative', options: PagePattern[] }  // 'либо X, либо Y, либо Z'
```

### 3.4. Алгоритм planning

```
1. Загрузить matrix-record для (density, sheet_type) пресета
2. Найти строку матрицы для текущего students_count
3. Извлечь:
   - personal_final.left / personal_final.right → правила для финала student-section
   - mandatory_section_pages → правила для общего раздела (priority 230)
   - additional_section_pages → правила (priority 210)
4. При резолве alternative выбирать по наличию фотоматериала:
   sixth >= 6 ? sixth_six :
   half_class >= 2 ? half_pair :
   full_class >= 1 ? full_one :
   skip (empty page, partner fills manually)
```

### 3.5. Генерация правил из матрицы

Вместо ручного написания JSON для каждой строки — **код-генератор**
`scripts/generate-rules-from-matrix.ts`:

```
read album-structure-matrix.json
for each entry:
  emit rule student-section-final-{density}-{sheet}-{idx}
       (priority 250, when matches entry.students)
  emit rules common-section-mandatory-page-{N}-{density}-{sheet}-{idx}
       (priority 230, when current_index == N)
  emit rules common-section-additional-page-{N}-{density}-{sheet}-{idx}
       (priority 210)
```

Это даст ~70-100 правил автоматически. JSON-файлы коммитятся в репо
как обычные правила (read-only output генератора), seed-скрипт грузит
их в БД.

## 4. Полная матрица (28 строк из xlsx)

См. `docs/templates/album-structure-matrix.json`.

Распределение записей по комплектациям:

| Density | Hard | Soft | Total |
|---|---|---|---|
| mini | 3 | 3 | 6 |
| light | 4 | 4 | 8 |
| medium | 4 | 4 | 8 |
| standard_universal | 2 | 2 | 4 |
| **Всего** | **13** | **13** | **26** |

(28 строк в JSON — 26 уникальных + 2 группы для Стандарт/Универсал)

Каждая строка содержит:
- `density`: standard_universal / medium / light / mini
- `sheet_type`: hard / soft
- `students.ranges`: массив диапазонов или `parity: even/odd`
- `personal_final.left`, `personal_final.right`: что положить на последнем
  развороте student-section (или null если финала нет)
- `mandatory_section_pages`: массив 0-6 страниц обязательного общего раздела
- `additional_section_pages`: массив 0-5 страниц дополнительного

## 5. Конкретные правила по матрице

### 5.1. Mini hard (3 сценария)

```
mini, hard, 1-24 students:
  personal_final: нет (заполняется ровно)
  mandatory: ['2 по 1/2', alt(6×1/6, 2×1/2, 1общая)]
  additional: 4 страницы с alt

mini, hard, 25-28 students:
  personal_final.left: 'до 4 портретов + 1 общая' (N-Combined)
  personal_final.right: alt(2×1/2, 6×1/6, 1общая)
  mandatory: []
  additional: []

mini, hard, 29-36 students:
  personal_final.left: 'до 12 портретов' (N-Grid полная)
  personal_final.right: alt(2×1/2, 6×1/6, 1общая)
  mandatory: []
  additional: []
```

### 5.2. Mini soft (3 сценария)

Аналогично mini hard, но **дополнительный раздел расширен** (до 5 страниц
вместо 4) — из-за S-Intro и S-Final занимающих по 1 странице.

### 5.3. Light hard (4 сценария)

```
light, hard, 1-12 / 22-24:
  personal_final: нет
  mandatory: ['2 по 1/4', '2 по 1/4', '2 по 1/2', alt, alt, '2 по 1/2']
  additional: до 5 страниц

light, hard, 13-15 / 25-28:
  personal_final.left: 'до 3 портретов + 1 общая' (L-Combined)
  personal_final.right: alt(2×1/2, 6×1/6, 1общая)
  mandatory: ['2 по 1/4', '2 по 1/4', '2 по 1/2', alt]

light, hard, 16-18:
  personal_final.left: 'до 6 портретов' (L-Grid полная)
  personal_final.right: alt
  mandatory: ['2 по 1/4', '2 по 1/4', '2 по 1/2', alt]

light, hard, 19-21 / 31-33:
  personal_final.left: 'до 6 портретов'
  personal_final.right: 'до 3 портретов + 1 общая' (L-Combined)
  mandatory: ['2 по 1/4', '2 по 1/4', '2 по 1/2', alt, alt, '2 по 1/2']
```

### 5.4. Light soft (4 сценария)

Аналогично + S-Intro/Final.

### 5.5. Medium hard/soft (4+4 сценария)

Аналогичная структура с M-Grid (2×2=4 слота) и M-Combined.

### 5.6. Standard/Universal hard/soft (2+2 сценария)

Простая: чётное / нечётное число учеников.

## 6. План реализации (8-12 коммитов)

### Этап А — Подготовка (1-2 коммита)

**РЭ.20.1.** Документ-спецификация + JSON-матрица закоммичены в репо.

**РЭ.20.2.** Миграция БД: добавить поля в presets:
- `total_pages: integer NOT NULL DEFAULT 24`
- `density: text` (constraint values)
- `sheet_type: text` (constraint values)

### Этап Б — Типы и контекст (2-3 коммита)

**РЭ.20.3.** Расширить types.ts (Preset + RuleContext). Удалить или
deprecate `common_section_max_spreads`.

**РЭ.20.4.** Расширить build.ts: считать pages_remaining + mandatory_section
seamlessly. Cursors track current_mandatory_page_index.

**РЭ.20.5.** loader/migrate существующих 7 пресетов: проставить total_pages
из значений по умолчанию (Сергея):
- standard/universal: вычисляется (число личных страниц + 8)
- mini-hard/soft: 6 (по словам Сергея)
- medium, light: вычисляется (число личных + 8)

Заметка: для variable total_pages (зависит от учеников) нужно либо
сделать `total_pages: 'auto'` либо вычислять в runtime. Решим в реализации.

### Этап В — Код-генератор правил (3-4 коммита)

**РЭ.20.6.** `scripts/generate-rules-from-matrix.ts` — читает JSON, генерит
JSON-правила в `docs/rule-engine-data/rules/generated/`.

**РЭ.20.7.** Адаптер: при загрузке правил в БД сначала запускать генератор
если есть изменения в матрице. Или один раз сгенерить и закоммитить.

**РЭ.20.8.** Удалить/deprecate old правила common-section-*-pair из РЭ.18.
Они становятся fallback для случаев когда матрица не задаёт.

### Этап Г — Тестирование (1-2 коммита)

**РЭ.20.9.** Unit-тесты для каждой строки матрицы. Test-генератор берёт
JSON и для каждой entry создаёт test case.

**РЭ.20.10.** End-to-end тест на реальных альбомах: 'тест 2026' × все
комплектации × hard/soft.

### Этап Д — Документация (1 коммит)

**РЭ.20.11.** Обновить контекст vN, добавить раздел про матрицу,
seed-instructions.

## 7. Связь с РЭ.12 (UI редактор пресетов)

РЭ.20 **зависит** от РЭ.12 в части UI — партнёр должен иметь возможность:
- видеть глобальные пресеты OkeyBook (read-only)
- копировать в свой тенант
- редактировать `total_pages` (фундаментальное!)
- редактировать `density` / `sheet_type` если нужны кастомные комбинации
- видеть какие правила сгенерируются (preview)

**Порядок реализации:**
1. РЭ.20.1-РЭ.20.5 (этапы А+Б): подготовка типов, миграция
2. РЭ.12 (UI редактор): партнёр может задать total_pages
3. РЭ.20.6-РЭ.20.11 (этапы В+Г+Д): code generator + правила

Без этого порядка партнёр не сможет настроить total_pages → правила
не будут работать корректно.

## 8. Что НЕ входит в фазу РЭ.20

- **Трюмо (pages_per_spread=3)**: отдельная фаза, отложено.
- **Кастомные мастера от партнёра**: загрузка партнёрских IDML — РЭ.21+.
- **Smart-fill (автоподбор фото по тэгам)**: фаза 1 продукта B.
- **Расширение матрицы для редких случаев**: эта матрица v1.0 — стартовая.
  Можно расширять по feedback'у от партнёров.

## 9. Эстимация

| Этап | Сложность | Часы |
|---|---|---|
| А. Подготовка (документ + миграция) | M | 4-5 |
| Б. Типы и контекст | L | 6-8 |
| В. Код-генератор | XL | 10-14 |
| Г. Тестирование | M | 4-6 |
| Д. Документация | S | 2 |
| **Итого РЭ.20** | | **26-35 часов** |

Параллельно идёт **РЭ.12 (UI редактор пресетов)** — 5-8 коммитов, ~16-24 часа.

**Общее время до боеготовности**: РЭ.20 + РЭ.12 = 40-60 часов = 2-3 недели
работы при темпе 2-3 коммита в день. До августа есть запас.

## 10. Открытые вопросы (решать в процессе реализации)

1. `total_pages` для Стандарт/Универсал «число личных + 8» — это формула.
   Хранить как формулу в пресете или вычислять?
2. Случай «учительский раздел внутри S-Intro» (Мини soft) — отдельное правило?
3. Что если у партнёра 7 учеников Light hard — этого нет в матрице (есть
   1-12, 13-15, 16-18). Попадёт в 1-12 = personal_final нет. Это корректно?
4. Trim бок: «25-28» учеников Мини = одна категория, но это значит
   нагрузка очень разная (25 vs 28 = разное число пустых слотов в Grid).
   Это балансируется через `placeholder_centering` + `hide_unfilled`?
   Скорее всего да, но проверить на тестах.

Эти вопросы можно закрывать **в процессе** реализации, не блокеры для
старта.
