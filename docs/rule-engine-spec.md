# Rule Engine — спецификация

**Версия:** 1.0
**Дата:** 15.05.2026
**Статус:** черновик после фиксации архитектурных решений 15.05.2026
**Автор:** Сергей Одинцов + Claude

**Источники:**
- `docs/templates/architecture-decisions-2026-05-15.md` — 12 принятых решений (фундамент этого документа)
- `docs/templates/architecture-decisions-2026-05-12.md` — переход на двухстраничные мастера
- `docs/templates/composition-catalog.md` + `composition-catalog-filled-2026-05-15.xlsx` — каталог композиций с дополнениями Сергея
- `docs/templates/designer-tz-2026-05-12.md` v1.2 — словарь меток placeholder'ов (станет v1.3 после этого spec'а)
- `lib/album-builder/` — текущая монолитная реализация `buildAlbum` (3139 строк), которую rule engine **дополняет**, а не заменяет сразу

**Аудитория:** будущий Claude в сессии реализации `buildFromRules` (полный технический контекст) + Сергей как чек-лист функциональности. Дизайнер получит отдельный документ — ТЗ v1.3 (создаётся после этого spec'а).

**Связанные документы которые будут созданы после:**
- `docs/templates/designer-tz-2026-05-15.md` (v1.3) — обновлённое ТЗ дизайнеру с учётом постраничной модели и параметрических мастеров
- `docs/rule-engine-data/` — каталог JSON-файлов с правилами, пресетами, семействами (создаётся в подэтапе РЭ.3)

---

## 0. TL;DR

1. Старый `buildAlbum` — монолит, в котором композиционная логика зашита в TypeScript. Меняем на **rule engine**: те же правила, но как **данные** в БД (JSON).
2. Структура — три уровня: **мастер** (одна страница IDML), **семейство** (правила выбора мастера и заполнения данными), **пресет** (комплектация = упорядоченный список секций с параметрами).
3. **Семь семейств**: `head-teacher`, `subject-teachers`, `class-photo`, `student-section`, `common-section`, `intro`, `final`. Плюс **I-Personal** — отложен (закладывается структура).
4. Все плотности личного раздела (Maximum / Universal / Standard / Medium / Light / Mini, она же виньетка) объединены в **одно** семейство `student-section` с параметром `density`. Шесть значений — шесть capacity'ей. На разворот ставит от 1 (Maximum) до 24 (Mini) портретов.
5. Все новые мастера — **постраничные** (`page-left` / `page-right` / `page-any`). Из 4 одностраничных можно собрать 8 разворотов. **Серия мастеров** — набор страниц одного дизайна, гарантированно сочетающихся.
6. Поддерживается **межсемейственный разворот** — левая страница из одного семейства, правая из другого. Главный кейс: одинокий 13-й ученик в Standard (левая = E-Student, правая = J-* из общего раздела). Это естественный механизм «дозаполнения» неполных разворотов.
7. Для сеток (Mini 6..24, Light 1..12, Medium 1..8) — один **параметрический мастер**, не N отдельных. Дизайнер делает один IDML, правило выбирает сетку 3+3 / 4+3 / 4+4 / 12-full по числу учеников.
8. **Множественность правильных ответов** покрыта механизмом `variants`. Алгоритм выбирает default по контексту, партнёр в редакторе **переключает** на другой вариант кнопкой «другая раскладка» (UI уже готов — фаза М).
9. **Балансировка** трёхфазная: Phase 1 (локальная per-spread) — MVP, Phase 2 (проход оптимизации) — после запуска если будут жалобы, Phase 3 (UI ручной правки) — уже есть в фазе М.
10. **Совместимость**: старый `buildAlbum` остаётся для существующих альбомов. Новые альбомы строятся через `buildFromRules`. Каждый альбом помнит свою `rules_version`. Полная миграция не обязательна.
11. **Цель**: ~27 мастеров на одну дизайн-серию (вместо ~80 без rule engine). Запуск партнёрской программы в сентябре 2026 — есть 3+ месяца.

---

## 1. Зачем и что меняется

### 1.1. Что не так с текущим `buildAlbum`

`lib/album-builder/build-from-preset.ts` (1793 строки) и связанные файлы реализуют выбор мастера и распределение данных как **цепочку switch-case на TypeScript**:

```typescript
// псевдо-цитата из текущего кода
if (subjects.length === 0) {
  if (halfClassPhotos.length >= 2) return useMaster('F-Head-WithPhoto', 'G-HalfClass');
  if (fullClassPhotos.length >= 1) return useMaster('F-Head-WithPhoto', 'G-FullClass');
  ...
}
```

Проблемы:
1. **Каждое изменение правила = деплой**. Добавить вариацию «классрук + общее снизу левой + 2 полкласса справа» — это править код, тестировать, ревьюить.
2. **Партнёр не видит почему так получилось**. Решение алгоритма непрозрачное — нет `decision_trace`.
3. **Семейства мастеров не выделены**. Замена шаблона в редакторе показывает все мастера template_set'а, а не только подходящие.
4. **Множественность ответов не поддержана**. Если для subjects=11 есть 3 варианта правой страницы (3x3 / 4x3 / 4x4) — код выбирает один жёстко.
5. **Несоразмерно много мастеров**. Сейчас 39 мастеров в template_set okeybook-default, и часть из них дублирует друг друга с минимальными отличиями (mirror_for_soft, fallback варианты, варианты под комплектации).

### 1.2. Что меняется

| | Сейчас | После rule engine |
|---|---|---|
| Правила выбора мастера | TypeScript switch | JSON в БД |
| Композиции личного раздела | 4 семейства мастеров (E-Standard / E-Universal / E-Maximum / Light / Mini …) | 1 семейство `student-section` + `density` |
| Мастеров на серию | ~80 (текущая практика OkeyBook + 39 фактических в БД с дублями) | ~27 на серию благодаря: 6 density вместо 6 семейств + variable grid (1 IDML вместо 12 сеток) + параметрические placeholder'ы |
| Изменение правила | git commit + deploy | UPDATE строки в БД |
| Версионирование | нет | `rules.version`, `album_layouts.rules_version` |
| Аудит решения | console.log | `decision_trace` в БД |
| Замена шаблона партнёром | весь template_set | только из семейства |
| Поддержка межсемейственных разворотов | нет (хардкод в коде E-Standard для одинокого ученика) | первоклассная концепция |

### 1.3. Метрика успеха

1. **Объём работы дизайнера**: серия = ~27 мастеров в одном IDML, не 80+
2. **Скорость изменения правил**: новое правило вёрстки = UPDATE rules + INSERT новой версии за минуту, не неделя разработки
3. **Прозрачность**: партнёр в редакторе нажимает «почему такая раскладка» → видит `decision_trace` с правилом которое сработало
4. **Совместимость**: существующие альбомы (текущие 50+ в проде) продолжают рендериться корректно

---

## 2. Трёхуровневая архитектура

```
┌─────────────────────────────────────────────────────────────────┐
│  УРОВЕНЬ 3: Пресеты (комплектации)                              │
│                                                                  │
│  "Стандарт + виньетка" = [intro?, head-teacher, subject-teachers,│
│                            student-section[density=mini],        │
│                            student-section[density=standard],    │
│                            common-section, final?]               │
└─────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│  УРОВЕНЬ 2: Семейства (rule engine)                             │
│                                                                  │
│  family `head-teacher` = [rule1, rule2, ..., ruleN]              │
│    rule = when(context) → produce(spread_or_page) + bind + ...   │
│                                                                  │
│  family `student-section` = правила параметризованы density      │
└─────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│  УРОВЕНЬ 1: Мастера (IDML атомы)                                │
│                                                                  │
│  spread_templates: F-Head-WithPhoto (page-any), G-HalfClass…    │
│  placeholder'ы (lowercase): headteacherphoto, halfleftphoto, …  │
└─────────────────────────────────────────────────────────────────┘
```

### Поток данных при сборке альбома

```
Album.input + Album.preset_id
    ↓
[buildFromRules]
    ↓
1. Загрузить preset → список секций с параметрами
2. Для каждой секции:
   a. Найти family по section.family_id
   b. Получить контекст из input (subjects_count, students_remaining, ...)
   c. Применить правила family по убыванию priority
   d. Каждое сработавшее правило produces один разворот (или страницу)
   e. Если разворот неполный (правая пуста) — алгоритм передаёт «висящую правую страницу» следующей секции
3. Балансировка (Phase 1) — для каждого мастера с неполным заполнением
4. Сохранить AlbumLayout (spreads[] + decision_trace[])
    ↓
album_layouts.spreads (JSONB)
```

---

## 3. Каталог семейств

### 3.1. Семь активных семейств + I-Personal

| family_id | display_name | Назначение | Состав мастеров (типичный) |
|---|---|---|---|
| `head-teacher` | Учительская страница с классруком | Левая страница (layflat) или единственная (soft) учительского блока | F-Head-WithPhoto, F-Head-SmallGrid, F-Head-LargeGrid |
| `subject-teachers` | Страница с предметниками | Правая страница учительского блока при subjects ≥ 9 | G-Teachers-3x3, G-Teachers-4x3, G-Teachers-4x4 |
| `class-photo` | Страница с групповыми фото | Правая страница учительского блока при subjects ≤ 8 | G-FullClass, G-HalfClass |
| `student-section` | Личный раздел учеников **с параметром density** | Основная часть альбома (порция учеников с портретами) | E-Student-* (Maximum/Universal/Standard варианты), L-Grid-Page, N-Grid-Page |
| `common-section` | Общий раздел (фото поездок, мероприятий) | После личного раздела или дозаполнение неполных разворотов | J-Spread, J-ClassPhoto, J-Half, J-Quarter, J-Collage |
| `intro` | Заглавный | Только soft, перед основной частью | S-Intro |
| `final` | Финальный | Только soft, после основной части | S-Final-Soft-L |
| ~~`i-personal`~~ | Личный разворот посвящённый одному ученику | **Отложен** (architecture-decisions §10). Структура закладывается, правила не реализуются | (TBD) |

### 3.2. Замена шаблона партнёром

В редакторе (фаза М) кнопка «другая раскладка» открывает `TemplatePickerModal`. После rule engine модал фильтруется по **family_id** текущего разворота:

- Учительский разворот → видит только F-Head-* / G-Teachers-* / G-FullClass-* / G-HalfClass-* (то есть head-teacher + subject-teachers + class-photo)
- Личный раздел → видит только мастера с `family_id IN ('student-section')` (фильтрация по density необязательна — партнёр может вручную сменить плотность)
- Общий раздел → только J-*

Это технически реализуется добавлением фильтра в `TemplatePickerModal`. Сейчас он показывает весь template_set; после РЭ.9 — фильтрует по `family_id`.

### 3.3. Глобальные vs тенант-специфичные семейства

`template_families.tenant_id`:
- `NULL` — глобальное семейство (поставляется OkeyBook)
- `<uuid>` — кастомное семейство партнёра (партнёр может определить своё)

Партнёр **копирует** глобальное семейство в своё (с новым `id` и тем же `aliases: [old_id]` для совместимости) и редактирует. См. §12 «Версионирование».

---

## 4. Семейство `student-section` с параметром `density`

### 4.1. Шесть плотностей

| density | На сторону | На разворот | Friend photos | Использование |
|---|---|---|---|---|
| `maximum` | 1 (крупный портрет) | 1 (двухстраничный разворот) | да, 0-4 | Самая просторная подача, для Maximum/Indiv. комплектаций |
| `universal` | 1 + фото с друзьями | 2 | да, 0-4 | Один ученик на странице |
| `standard` | 1 | 2 | нет | Классика «двое на разворот» |
| `medium` | 4 | 8 | нет | Сетка 2×2 на странице |
| `light` | 6 | 12 | нет | Сетка 3×2 на странице |
| `mini` | 12 | 24 | нет | Сетка 4×3 на странице, она же **виньетка** |

### 4.2. Свойства семейства

```json
{
  "family_id": "student-section",
  "params": {
    "density": {
      "type": "enum",
      "values": ["maximum", "universal", "standard", "medium", "light", "mini"],
      "default": "standard",
      "required": true
    },
    "has_quote": {
      "type": "boolean",
      "default": false,
      "description": "Выводить ли цитату ученика под портретом (только для densities maximum/universal/standard)"
    }
  },
  "density_config": {
    "maximum":   { "capacity_per_side": 1, "capacity_per_spread": 1, "supports_friend_photos": true,  "supports_quote": true },
    "universal": { "capacity_per_side": 1, "capacity_per_spread": 2, "supports_friend_photos": true,  "supports_quote": true },
    "standard":  { "capacity_per_side": 1, "capacity_per_spread": 2, "supports_friend_photos": false, "supports_quote": true },
    "medium":    { "capacity_per_side": 4, "capacity_per_spread": 8, "supports_friend_photos": false, "supports_quote": false },
    "light":     { "capacity_per_side": 6, "capacity_per_spread": 12, "supports_friend_photos": false, "supports_quote": false },
    "mini":      { "capacity_per_side": 12, "capacity_per_spread": 24, "supports_friend_photos": false, "supports_quote": false }
  }
}
```

### 4.3. Множественные секции `student-section` в одном пресете

Один пресет может включать **несколько** секций `student-section` с разными плотностями. Пример «Стандарт + виньетка»:

```
preset "Стандарт + виньетка":
  ...
  section: student-section [density=mini]      ← виньетка после учителей
  section: student-section [density=standard]  ← основной раздел
  ...
```

Каждая секция получает **те же** входные `students` (полный список), но правила могут учитывать **позицию секции** (первая student-section получает всех, последующая — тоже всех, **но дублирование данных нормально**: виньетка показывает портреты всех, основной раздел тоже показывает портреты всех — это две разные репрезентации одних и тех же учеников).

**Решение 15.05.2026**: дублирование данных между секциями — это **дизайн-by-default**. Все секции получают `input.students[]` полностью, без фильтрации по позиции.

---

## 5. Постраничная модель

### 5.1. Типы страниц

В `spread_templates.page_type`:
- `page-left` — мастер только для левой страницы разворота (например, S-Final-Soft-L)
- `page-right` — мастер только для правой страницы (например, F-Head-WithPhoto-R в soft)
- `page-any` — мастер для любой стороны
- `spread` — мастер занимает оба листа разворота как единое полотно (например, J-Spread)

### 5.2. Серии мастеров

`spread_templates.series_id` — стабильный ID **серии**, к которой принадлежит мастер. Серия = набор страниц одного дизайна гарантированно сочетающихся.

Пример:
- Серия `okeybook-default-2026`:
  - F-Head-WithPhoto (page-any, family=head-teacher)
  - F-Head-SmallGrid (page-any, family=head-teacher)
  - F-Head-LargeGrid (page-any, family=head-teacher)
  - G-FullClass (page-any, family=class-photo)
  - G-HalfClass (page-any, family=class-photo)
  - G-Teachers-3x3 (page-right, family=subject-teachers)
  - E-Student-Left (page-left, family=student-section, density=universal)
  - E-Student-Right (page-right, family=student-section, density=universal)
  - L-Grid-Page (page-any, parametric, family=student-section, density=light)
  - …

Алгоритм при сборке предпочитает мастера из **одной** серии для всего альбома (если возможно).

### 5.3. Межсемейственный разворот

Концепция: **один разворот может состоять из страниц разных семейств**.

Главные кейсы (из xlsx-каталога 15.05):

1. **E-Standard, одинокий 13-й ученик**: левая страница = E-Student-Left (family=student-section), правая страница = J-* (family=common-section, как первая страница общего раздела)
2. **Light 1-12**, например 7 учеников: левая = L-Grid-Page с 7 учениками (балансировка), правая = первая страница общего раздела
3. **Medium 1-4 ученика**: аналогично — левая полу-заполнена, правая = common-section

Реализация:
- Алгоритм после применения правила student-section смотрит: разворот заполнен полностью (left+right) или только left?
- Если только left → переходит к следующей секции пресета (обычно common-section) с флагом `start_on_right_page=true`
- Следующая секция применяет своё правило, но **выбирает мастер с page_type ∈ (page-right, page-any)**, и кладёт его на «висящую» правую страницу того же разворота

Это нормальное поведение, не исключение. Описывается в `decision_trace` как `cross_family_spread: { left: <rule_id_section_X>, right: <rule_id_section_X+1> }`.

### 5.4. Корешок и сшивка

- **Корешок** между страницами — это внутренний отступ дизайна каждой страницы. Никакая логика rule engine с ним не работает.
- **Фото через сшивку запрещено**. Исключение: мастер `J-Spread` — фотограф снимает специально без лиц на сгибе, и этот мастер имеет `page_type='spread'` (один placeholder на оба листа).

---

## 6. Модель данных

### 6.1. Новые таблицы

```sql
-- Семейства мастеров (rule engine)
CREATE TABLE template_families (
  id TEXT PRIMARY KEY,                       -- стабильный ID: 'head-teacher', 'student-section', ...
  display_name TEXT NOT NULL,                -- 'Учительская страница с классруком'
  aliases TEXT[] DEFAULT '{}',               -- старые имена для совместимости: ['head_teacher_legacy', ...]
  deprecated BOOLEAN DEFAULT false,
  version TEXT NOT NULL,                     -- '1.0', '1.1', '2.0'
  tenant_id UUID NULL,                       -- NULL = глобальное
  params JSONB DEFAULT '{}',                 -- {density: {type:'enum', values:[...], default:...}}
  density_config JSONB DEFAULT NULL,         -- только для student-section
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_template_families_tenant ON template_families(tenant_id);

-- Правила (JSON)
CREATE TABLE rules (
  id TEXT PRIMARY KEY,                       -- 't-class-0-half', 'l-grid-adaptive', ...
  family_id TEXT NOT NULL REFERENCES template_families(id),
  family_version TEXT NOT NULL,              -- к какой версии семейства привязано
  priority INT NOT NULL DEFAULT 0,           -- больше = раньше пробуется
  rule_json JSONB NOT NULL,                  -- {when:..., produces:..., bind:..., consumes:...}
  tenant_id UUID NULL,                       -- NULL = глобальное
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rules_family ON rules(family_id, family_version, priority DESC) WHERE enabled = true;
CREATE INDEX idx_rules_tenant ON rules(tenant_id);

-- Пресеты (комплектации)
CREATE TABLE presets (
  id TEXT PRIMARY KEY,                       -- 'standard', 'standard-vignette', 'maximum', ...
  display_name TEXT NOT NULL,                -- 'Стандарт + виньетка'
  sections JSONB NOT NULL,                   -- массив секций (см. §8)
  print_type TEXT NOT NULL,                  -- 'layflat' | 'soft'
  tenant_id UUID NULL,
  version TEXT NOT NULL,
  parent_preset_id TEXT NULL,                -- если копия глобального — ссылка на оригинал
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_presets_tenant ON presets(tenant_id, print_type) WHERE enabled = true;
```

### 6.2. Изменения существующих таблиц

```sql
-- album_layouts: метаданные о правилах сборки
ALTER TABLE album_layouts
  ADD COLUMN preset_id TEXT REFERENCES presets(id),
  ADD COLUMN rules_version TEXT,             -- snapshot версий всех family
  ADD COLUMN decision_trace JSONB DEFAULT '[]';
                                             -- [{spread_index, rule_id, family_id, ...}, ...]

-- album_layouts.spreads (JSONB) — внутри каждого spread добавляется:
-- {
--   ...,
--   "user_edited": false,                   -- партнёр менял этот разворот вручную?
--   "user_edits": {                         -- что именно изменил
--     "master_id_left": "F-Head-SmallGrid",
--     "placeholder_overrides": {...}
--   }
-- }

-- spread_templates: метаданные для rule engine
ALTER TABLE spread_templates
  ADD COLUMN family_id TEXT REFERENCES template_families(id),
  ADD COLUMN page_type TEXT DEFAULT 'page-any', -- page-left | page-right | page-any | spread
  ADD COLUMN series_id TEXT,                    -- 'okeybook-default-2026'
  ADD COLUMN density TEXT NULL,                 -- только для student-section мастеров
  ADD COLUMN params JSONB DEFAULT '{}';         -- для параметрических мастеров: {grid_modes: [...]}

CREATE INDEX idx_spread_templates_family ON spread_templates(family_id, density);
CREATE INDEX idx_spread_templates_series ON spread_templates(series_id);
```

### 6.3. Кэш раскладок

```sql
CREATE TABLE layout_cache (
  input_hash TEXT PRIMARY KEY,               -- SHA256(JSON.stringify({input, preset_id, rules_version}))
  layout JSONB NOT NULL,                     -- готовый AlbumLayout
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_accessed_at TIMESTAMPTZ DEFAULT NOW(),
  access_count INT DEFAULT 1
);

CREATE INDEX idx_layout_cache_accessed ON layout_cache(last_accessed_at);
```

Используется при превью / редактировании пресета (партнёр меняет density → пересборка моментальная если результат уже в кэше). TTL: 7 дней, чистка через cron.

---

## 7. Формат JSON-правил

### 7.1. Структура правила

```typescript
type Rule = {
  id: string;                                  // 't-class-0-half-class'
  family_id: string;                           // 'head-teacher'
  family_version: string;                      // '1.0'
  priority: number;                            // 100 (больше = раньше)

  // Условия применимости. Все поля within = AND.
  when: WhenClause;

  // Что правило производит — один разворот, одна страница или их последовательность
  produces: ProducesSpread | ProducesPage | ProducesSequence;

  // Сколько входных данных правило "съедает"
  consumes: ConsumesClause;

  // Балансировка после применения (опционально)
  balance?: BalanceClause;

  // Альтернативные варианты (для multiple correct answers)
  variants?: Rule[];                           // у variant.id обязателен, но family/priority наследуются

  // Метаданные
  display_name?: string;
  description?: string;
  enabled?: boolean;                           // по умолчанию true
};
```

### 7.2. Оператор `when`

```typescript
type WhenClause = {
  [field: string]: WhenOperator;
};

type WhenOperator =
  | number | string | boolean                  // эквивалент {eq: value}
  | { eq: any }
  | { neq: any }
  | { gte: number }
  | { lte: number }
  | { gt: number }
  | { lt: number }
  | { between: [number, number] }              // включительно
  | { in: any[] }
  | { not_in: any[] }
  | { has: true | false }                      // для массивов: непустой / пустой
  | { count_gte: number }                      // для массивов
  | { count_lte: number }
  | { count_between: [number, number] };
```

**Доступные поля контекста** (входные для `when`):

| Поле | Тип | Описание |
|---|---|---|
| `subjects_count` | number | Число учителей-предметников |
| `students_count` | number | Общее число учеников в альбоме |
| `students_remaining` | number | Сколько учеников ещё не размещено в текущей секции |
| `current_student_index` | number | Индекс следующего ученика для размещения |
| `head_teacher.has_photo` | boolean | Есть ли фото классрука |
| `head_teacher.has_text` | boolean | Есть ли приветственный текст |
| `common_photos.full_class.count` | number | Число общих фото класса |
| `common_photos.half_class.count` | number | Число фото "полкласса" |
| `common_photos.spread.count` | number | Число фото для J-Spread |
| `common_photos.quarter.count` | number | Число фото "четверть класса" |
| `common_photos.sixth.count` | number | Число фото типа "шестая" (для коллажа) |
| `print_type` | string | 'layflat' / 'soft' |
| `section.position` | string | 'first' / 'middle' / 'last' (позиция секции в пресете) |
| `section.density` | string | значение параметра density (только для student-section) |
| `section.has_quote` | boolean | значение параметра has_quote (только для student-section) |
| `prev_spread.right_page_empty` | boolean | Висит ли свободная правая страница от предыдущей секции |
| `friend_photos_count` | number | Число фото с друзьями у текущего ученика (для Universal/Maximum правил) |

### 7.3. Оператор `produces`

```typescript
type ProducesSpread = {
  type: 'spread';
  left_master: string | MasterSelector;        // имя мастера или селектор
  right_master: string | MasterSelector;
  start_on_right_page?: boolean;               // true если разворот «склеивается» с предыдущей секцией
};

type ProducesPage = {
  type: 'page';
  side: 'left' | 'right';
  master: string | MasterSelector;
  // При page алгоритм будет ждать другую страницу того же разворота
  // от следующего правила (этой же секции или следующей)
};

type ProducesSequence = {
  type: 'sequence';                            // несколько разворотов подряд (для каскадов >12 учеников)
  steps: Array<ProducesSpread | ProducesPage>;
};

type MasterSelector = {
  // Для параметрических мастеров — выбор по числу заполняемых слотов
  parametric: string;                          // имя параметрического мастера: 'L-Grid-Page'
  params: Record<string, string | number>;     // {grid_mode: '3+3', students: <expr>}
};
```

### 7.4. Оператор `bind`

Внутри `produces.left_master`, `produces.right_master` или `produces.steps[].master` могут быть указаны привязки:

```typescript
type Bind = {
  [placeholder_label: string]: BindExpression;
};

type BindExpression =
  | string                                     // путь к данным: 'input.head_teacher.photo'
  | { template: string; params: Record<string, BindExpression> }  // шаблон с подстановкой
  | { expr: string };                          // вычисляемое выражение: '$current_student_index + 1'
```

Примеры путей:
- `input.head_teacher.photo`
- `input.subjects[0].name`
- `input.common_photos.half_class[0]`
- `input.students[$current_student_index].portrait` (`$` — переменная контекста)
- `input.students[$current_student_index].friend_photos[0]`

Параметрические привязки через `template`:
```json
{
  "studentportrait_{i}": {
    "template": "input.students[$current_student_index + {i} - 1].portrait",
    "params": { "i": { "range": [1, "$slot_count"] } }
  }
}
```

### 7.5. Оператор `consumes`

После применения правила алгоритм продвигает указатели:

```typescript
type ConsumesClause = {
  students?: number | string;                  // число или выражение: 'min(students_remaining, 24)'
  common_photos?: {
    full_class?: number;
    half_class?: number;
    spread?: number;
    quarter?: number;
    sixth?: number;
  };
  // subjects, head_teacher не "потребляются" — они используются один раз и помечаются как использованные
};
```

### 7.6. Оператор `variants`

Множественные правильные ответы для одного контекста. Default — первый variant с подходящим when. Партнёр в редакторе может переключить.

```json
{
  "id": "t-class-10-12-variants",
  "family_id": "head-teacher",
  "when": { "subjects_count": { "between": [10, 12] } },
  "produces": "$variants[0]",
  "variants": [
    {
      "id": "t-class-10-12-v1-largehead",
      "display_name": "Классрук крупно + 12 предметников",
      "produces": { "type": "spread", "left_master": "F-Head-WithPhoto", "right_master": "G-Teachers-4x3" }
    },
    {
      "id": "t-class-10-12-v2-smallhead",
      "display_name": "Классрук в сетке + 12 предметников",
      "produces": { "type": "spread", "left_master": "F-Head-SmallGrid", "right_master": "G-Teachers-4x3" },
      "when_default": { "head_teacher.has_text": { "eq": false } }
                                             // выбирается по умолчанию если у классрука нет текста
    },
    {
      "id": "t-class-10-12-v3-grid",
      "display_name": "Классрук крупно + 9 предметников + 3 в очередь",
      "produces": { "type": "spread", "left_master": "F-Head-WithPhoto", "right_master": "G-Teachers-3x3" },
      "balance": { "additional_subjects_to_next_spread": 3 }
    }
  ]
}
```

### 7.7. Полные примеры по семействам

#### 7.7.1. `head-teacher` + `class-photo` (учительский разворот, subjects=0..8, layflat)

```json
[
  {
    "id": "t-class-0-half-class",
    "family_id": "head-teacher",
    "family_version": "1.0",
    "priority": 100,
    "when": {
      "subjects_count": 0,
      "common_photos.half_class.count": { "gte": 2 },
      "print_type": "layflat"
    },
    "produces": {
      "type": "spread",
      "left_master": "F-Head-WithPhoto",
      "right_master": "G-HalfClass"
    },
    "bind": {
      "F-Head-WithPhoto": {
        "headteacherphoto": "input.head_teacher.photo",
        "headteachername": "input.head_teacher.name",
        "headteacherrole": "input.head_teacher.role",
        "headtextframe": "input.head_teacher.text"
      },
      "G-HalfClass": {
        "halfleftphoto": "input.common_photos.half_class[0]",
        "halfrightphoto": "input.common_photos.half_class[1]"
      }
    },
    "consumes": {
      "common_photos": { "half_class": 2 }
    }
  },
  {
    "id": "t-class-0-full-class",
    "family_id": "head-teacher",
    "priority": 90,
    "when": {
      "subjects_count": 0,
      "common_photos.full_class.count": { "gte": 1 },
      "print_type": "layflat"
    },
    "produces": {
      "type": "spread",
      "left_master": "F-Head-WithPhoto",
      "right_master": "G-FullClass"
    },
    "bind": {
      "F-Head-WithPhoto": { "...": "...как выше..." },
      "G-FullClass": { "classphotoframe": "input.common_photos.full_class[0]" }
    },
    "consumes": { "common_photos": { "full_class": 1 } }
  },
  {
    "id": "t-class-1-4-class-photo",
    "family_id": "head-teacher",
    "priority": 80,
    "when": {
      "subjects_count": { "between": [1, 4] },
      "print_type": "layflat"
    },
    "produces": {
      "type": "spread",
      "left_master": "F-Head-SmallGrid",
      "right_master": "$class_photo_rule"
                                             // делегирование выбора правой страницы class-photo family
    },
    "bind": {
      "F-Head-SmallGrid": {
        "headteacherphoto": "input.head_teacher.photo",
        "headteachername": "input.head_teacher.name",
        "headteacherrole": "input.head_teacher.role",
        "headtextframe": "input.head_teacher.text",
        "teacherphoto_{i}": {
          "template": "input.subjects[{i}-1].photo",
          "params": { "i": { "range": [1, "subjects_count"] } }
        },
        "teachername_{i}": { "template": "input.subjects[{i}-1].name", "params": { "i": { "range": [1, "subjects_count"] } } },
        "teacherrole_{i}": { "template": "input.subjects[{i}-1].role", "params": { "i": { "range": [1, "subjects_count"] } } }
      }
    },
    "balance": { "placeholder_centering": true }
  }
]
```

#### 7.7.2. `subject-teachers` (правая страница при subjects≥9)

```json
{
  "id": "subject-teachers-3x3",
  "family_id": "subject-teachers",
  "family_version": "1.0",
  "priority": 100,
  "when": {
    "subjects_count": { "between": [9, 9] }
  },
  "produces": {
    "type": "page",
    "side": "right",
    "master": "G-Teachers-3x3"
  },
  "bind": {
    "G-Teachers-3x3": {
      "teacherphoto_{i}": { "template": "input.subjects[{i}-1].photo", "params": { "i": { "range": [1, 9] } } },
      "teachername_{i}": { "template": "input.subjects[{i}-1].name", "params": { "i": { "range": [1, 9] } } },
      "teacherrole_{i}": { "template": "input.subjects[{i}-1].role", "params": { "i": { "range": [1, 9] } } }
    }
  }
}
```

**Решение spec'а 15.05.2026** (по 🔴 каталога): при subjects ≥ 9 общие фото и полкласса **не используются** на учительском развороте — они переходят в начало `common-section`. Партнёр в редакторе при желании добавляет «доп. учительский разворот» вручную через `TemplatePickerModal`. Пересмотрим если у партнёров будут жалобы.

#### 7.7.3. `student-section` density=standard (двое на разворот)

```json
[
  {
    "id": "student-section-standard-full",
    "family_id": "student-section",
    "family_version": "1.0",
    "priority": 100,
    "when": {
      "section.density": "standard",
      "students_remaining": { "gte": 2 }
    },
    "produces": {
      "type": "spread",
      "left_master": "E-Student-Standard-Left",
      "right_master": "E-Student-Standard-Right"
    },
    "bind": {
      "E-Student-Standard-Left": {
        "studentportrait_left": "input.students[$current_student_index].portrait",
        "studentname_left": "input.students[$current_student_index].full_name",
        "studentquote_left": "input.students[$current_student_index].quote"
      },
      "E-Student-Standard-Right": {
        "studentportrait_right": "input.students[$current_student_index + 1].portrait",
        "studentname_right": "input.students[$current_student_index + 1].full_name",
        "studentquote_right": "input.students[$current_student_index + 1].quote"
      }
    },
    "consumes": { "students": 2 }
  },
  {
    "id": "student-section-standard-single-tail",
    "family_id": "student-section",
    "priority": 50,
    "when": {
      "section.density": "standard",
      "students_remaining": 1
    },
    "produces": {
      "type": "page",
      "side": "left",
      "master": "E-Student-Standard-Left"
                                             // правая страница достанется common-section
                                             // (межсемейственный разворот)
    },
    "bind": {
      "E-Student-Standard-Left": {
        "studentportrait_left": "input.students[$current_student_index].portrait",
        "studentname_left": "input.students[$current_student_index].full_name",
        "studentquote_left": "input.students[$current_student_index].quote"
      }
    },
    "consumes": { "students": 1 }
  }
]
```

#### 7.7.4. `student-section` density=light (параметрическая сетка 1..12)

```json
{
  "id": "student-section-light-adaptive",
  "family_id": "student-section",
  "family_version": "1.0",
  "priority": 100,
  "when": {
    "section.density": "light",
    "students_remaining": { "between": [1, 12] }
  },
  "produces": {
    "type": "page",
    "side": "left",
    "master": {
      "parametric": "L-Grid-Page",
      "params": {
        "grid_mode": "$expr: select_grid_mode(students_remaining)",
                                             // 1→1×1, 2→2×1, 3→3×1, 4→2×2, 5→3+2, 6→3+3,
                                             // 7..12 → см. ниже
        "slot_count": "min(students_remaining, 6)"
      }
    }
  },
  "bind": {
    "L-Grid-Page": {
      "studentportrait_{i}": {
        "template": "input.students[$current_student_index + {i} - 1].portrait",
        "params": { "i": { "range": [1, "$slot_count"] } }
      },
      "studentname_{i}": {
        "template": "input.students[$current_student_index + {i} - 1].full_name",
        "params": { "i": { "range": [1, "$slot_count"] } }
      }
    }
  },
  "consumes": { "students": "min(students_remaining, 6)" }
}
```

Правила для 7-12 учеников (когда нужна и левая, и правая страница) — отдельные правила (один разворот, левая полная 6, правая балансированная остаток).

#### 7.7.5. `student-section` density=light overflow (>12 учеников)

```json
{
  "id": "student-section-light-overflow",
  "family_id": "student-section",
  "priority": 200,                            // выше priority, проверяется первым
  "when": {
    "section.density": "light",
    "students_remaining": { "gte": 13 }
  },
  "produces": {
    "type": "spread",
    "left_master": { "parametric": "L-Grid-Page", "params": { "slot_count": 6 } },
    "right_master": { "parametric": "L-Grid-Page", "params": { "slot_count": 6 } }
  },
  "bind": {
    "L-Grid-Page": { /* studentportrait_{i} для i=1..12 через всё span (left+right) */ }
  },
  "consumes": { "students": 12 }
  // После этого правило student-section-light-adaptive обработает остаток 1..12
}
```

Каскад в действии: при 17 учениках → правило overflow срабатывает (1 разворот, 12 учеников) → остаток 5 → правило adaptive (1 страница левая, 5 учеников балансированных) + межсемейственный common-section правая.

#### 7.7.6. `common-section`

```json
{
  "id": "common-half",
  "family_id": "common-section",
  "priority": 60,
  "when": {
    "common_photos.half_class.count": { "gte": 2 }
  },
  "produces": {
    "type": "page",
    "side": "any",                            // алгоритм решит куда положить
    "master": "J-Half"
  },
  "bind": {
    "J-Half": {
      "halfphoto_1": "input.common_photos.half_class[$consumed_half_class]",
      "halfphoto_2": "input.common_photos.half_class[$consumed_half_class + 1]"
    }
  },
  "consumes": { "common_photos": { "half_class": 2 } }
}
```

Общий раздел работает по принципу **жадного размещения**: алгоритм перебирает правила common-section по priority, применяет каждое пока оно `when` true, продвигает указатели. Когда все common_photos исчерпаны или ни одно правило не подошло — секция заканчивается.

#### 7.7.7. `intro` (только soft)

```json
{
  "id": "intro-soft",
  "family_id": "intro",
  "priority": 100,
  "when": {
    "print_type": "soft",
    "common_photos.full_class.count": { "gte": 1 }
  },
  "produces": {
    "type": "page",
    "side": "right",                          // первая страница soft альбома — правая
    "master": "S-Intro"
  },
  "bind": {
    "S-Intro": {
      "classphotoframe": "input.common_photos.full_class[0]"
    }
  },
  "consumes": { "common_photos": { "full_class": 1 } }
}
```

#### 7.7.8. `final` (только soft)

```json
{
  "id": "final-soft",
  "family_id": "final",
  "priority": 100,
  "when": { "print_type": "soft" },
  "produces": {
    "type": "page",
    "side": "left",
    "master": "S-Final-Soft-L"
  },
  "bind": {
    "S-Final-Soft-L": {
      "classphotoframe": {
        "expr": "input.common_photos.full_class.last() ?? input.common_photos.half_class[0] ?? null"
      }
    }
  }
}
```

**Решение spec'а 15.05.2026**: дефолт — последнее доступное общее фото. Если их нет — placeholder остаётся пустым (партнёр заменит вручную через редактор).

---

## 8. Формат JSON-пресетов

### 8.1. Структура пресета

```typescript
type Preset = {
  id: string;                                  // 'standard', 'standard-vignette', 'maximum', ...
  display_name: string;
  print_type: 'layflat' | 'soft';
  version: string;
  sections: Section[];
  parent_preset_id?: string;                   // если копия — ссылка на оригинал
  tenant_id: string | null;                    // null = глобальный
};

type Section = {
  family_id: string;                           // 'head-teacher', 'student-section', ...
  params?: Record<string, any>;                // {density: 'mini', has_quote: false}
  enabled_when?: WhenClause;                   // условная вставка: только soft, только layflat
  display_name?: string;                       // 'Виньетка', 'Основной раздел' — для UI
};
```

### 8.2. Условные секции

`enabled_when` позволяет одному пресету работать и в layflat, и в soft:

```json
{
  "id": "standard",
  "display_name": "Стандарт",
  "print_type": "layflat",
  "sections": [
    { "family_id": "intro", "enabled_when": { "print_type": "soft" } },
    { "family_id": "head-teacher" },
    { "family_id": "student-section", "params": { "density": "standard", "has_quote": true } },
    { "family_id": "common-section" },
    { "family_id": "final", "enabled_when": { "print_type": "soft" } }
  ]
}
```

Если `print_type='layflat'` в `preset.print_type` — секции `intro`/`final` отключены. Но если партнёр копирует этот пресет в свой и меняет `print_type='soft'` — они автоматически включаются.

### 8.3. Полные примеры пресетов

#### 8.3.1. Стандарт (layflat)

```json
{
  "id": "standard",
  "display_name": "Стандарт",
  "print_type": "layflat",
  "version": "1.0",
  "sections": [
    { "family_id": "head-teacher" },
    { "family_id": "student-section", "params": { "density": "standard", "has_quote": true } },
    { "family_id": "common-section" }
  ]
}
```

#### 8.3.2. Стандарт + виньетка (layflat)

```json
{
  "id": "standard-vignette",
  "display_name": "Стандарт + виньетка",
  "print_type": "layflat",
  "version": "1.0",
  "sections": [
    { "family_id": "head-teacher" },
    { "family_id": "student-section", "params": { "density": "mini", "has_quote": false }, "display_name": "Виньетка" },
    { "family_id": "student-section", "params": { "density": "standard", "has_quote": true }, "display_name": "Основной раздел" },
    { "family_id": "common-section" }
  ]
}
```

#### 8.3.3. Универсал (layflat)

```json
{
  "id": "universal",
  "display_name": "Универсал",
  "print_type": "layflat",
  "version": "1.0",
  "sections": [
    { "family_id": "head-teacher" },
    { "family_id": "student-section", "params": { "density": "universal", "has_quote": true } },
    { "family_id": "common-section" }
  ]
}
```

#### 8.3.4. Мини (soft)

```json
{
  "id": "mini-soft",
  "display_name": "Мини",
  "print_type": "soft",
  "version": "1.0",
  "sections": [
    { "family_id": "intro" },
    { "family_id": "head-teacher" },
    { "family_id": "student-section", "params": { "density": "mini" } },
    { "family_id": "common-section", "enabled_when": { "common_photos.has_any": true } },
    { "family_id": "final" }
  ]
}
```

### 8.4. Редактирование партнёром

Партнёр в `/app` (фаза N или последующая) видит список пресетов своего тенанта + копии глобальных. Действия:
1. **Копировать глобальный** — создаётся `preset` с `parent_preset_id`, `tenant_id=<партнёр>`
2. **Редактировать** — менять порядок секций, добавлять / удалять секции, менять параметры
3. **Удалить** — soft delete (`enabled=false`)

Партнёр НЕ может редактировать глобальные пресеты OkeyBook напрямую.

---

## 9. Алгоритм `buildFromRules`

### 9.1. Вход и выход

```typescript
function buildFromRules(input: AlbumInput, preset_id: string, tenant_id: string): AlbumLayout;

type AlbumInput = {
  students: Student[];
  subjects: Subject[];
  head_teacher: HeadTeacher;
  common_photos: CommonPhotos;
  // ... (полная структура — см. lib/album-builder/types.ts)
};

type AlbumLayout = {
  spreads: SpreadInstance[];
  decision_trace: DecisionTraceEntry[];
  rules_version: string;                       // snapshot всех family_version
  preset_id: string;
  status: 'ok' | 'partial' | 'failed';
  warnings: string[];
};

type DecisionTraceEntry = {
  spread_index: number;
  section_index: number;
  family_id: string;
  rule_id: string;
  variant_id?: string;
  cross_family?: { left_rule_id: string; right_rule_id: string };
  inputs: Record<string, any>;                 // снапшот контекста на момент применения
  balanced?: boolean;
};
```

### 9.2. Шаги

```
function buildFromRules(input, preset_id, tenant_id):
    preset = loadPreset(preset_id, tenant_id)
    rules_version = computeRulesVersion(preset, tenant_id)

    if cache_hit = getFromCache(hash(input, preset_id, rules_version)):
        return cache_hit

    state = {
        spreads: [],
        decision_trace: [],
        cursors: {
            student_index: 0,
            consumed_common: { full_class: 0, half_class: 0, ... },
            subjects_used: false,
            head_teacher_used: false
        },
        pending_right_page: null,                  // висячая правая страница для cross-family spread
        warnings: []
    }

    for section_index, section in enumerate(preset.sections):
        if section.enabled_when and not evaluateWhen(section.enabled_when, input, state):
            continue

        family = loadFamily(section.family_id, tenant_id)
        rules = loadRules(family.id, family.version, tenant_id)  // отсортированы по priority DESC

        section_complete = false
        while not section_complete:
            context = buildContext(input, state, section, section_index)

            applicable_rule = first(r for r in rules if evaluateWhen(r.when, context))
            if not applicable_rule:
                section_complete = true
                break

            variant = pickVariant(applicable_rule, context)  # default или выбранный партнёром

            spread_or_page = applyRule(variant, context, input)
            state.decision_trace.append({...})

            if spread_or_page.type == 'spread':
                if state.pending_right_page:
                    warn('cannot apply spread when right page is pending')
                state.spreads.append(spread_or_page)
            elif spread_or_page.type == 'page' and spread_or_page.side == 'left':
                state.pending_right_page = { spread_index: len(state.spreads), section_index }
                state.spreads.append(new SpreadInstance(left=spread_or_page))
            elif spread_or_page.type == 'page' and spread_or_page.side == 'right':
                if state.pending_right_page:
                    state.spreads[state.pending_right_page.spread_index].right = spread_or_page
                    state.spreads[state.pending_right_page.spread_index].cross_family = true
                    state.pending_right_page = null
                else:
                    state.spreads.append(new SpreadInstance(right=spread_or_page))

            advanceCursors(state, variant.consumes, context)

            if no_data_consumed(variant, context):
                section_complete = true                # бесконечный loop защита

    # Phase 1 balancing (per-spread, локально)
    for spread in state.spreads:
        if spread.has_unfilled_placeholders:
            balance(spread)

    layout = {
        spreads: state.spreads,
        decision_trace: state.decision_trace,
        rules_version: rules_version,
        preset_id: preset.id,
        status: state.warnings.length > 0 ? 'partial' : 'ok',
        warnings: state.warnings
    }

    saveToCache(hash, layout)
    return layout
```

### 9.3. Защита от бесконечного цикла

Если правило срабатывает, но **ничего не потребляет** (consumes = 0) — секция останавливается с warning. Это указывает на ошибку в правиле (либо `when` слишком широкий, либо `consumes` пропущено).

### 9.4. Обработка `start_on_right_page`

Когда секция X завершилась с `pending_right_page` (например, student-section с density=light и 7 учеников: левая страница заполнена 6+1 балансированных, разворот неполный):
1. Алгоритм переходит к секции X+1 (обычно common-section)
2. Контекст содержит `prev_spread.right_page_empty = true`
3. Правила common-section могут учесть это (priority повышен для `page-right` мастеров)
4. Первое сработавшее правило → его `produces` кладётся в `state.spreads[last].right`, `cross_family = true`

---

## 10. Балансировка paginate-aware

### 10.1. Phase 1 — локальная (MVP)

После применения правила, если мастер имеет N placeholder'ов, а данных в `bind` оказалось M < N (например, F-Head-SmallGrid с 4 слотами предметников, а предметников 3) — алгоритм:

1. Применяет уже существующую функцию `balanceUnusedPlaceholders` из `lib/album-builder/balance.ts` (393 строки, готово с фазы Б)
2. Скрывает «лишние» placeholder'ы с наибольшим `sort_order` (как в текущем коде)
3. Симметрично центрирует оставшиеся

Решение принимается **локально**, без оглядки на соседние развороты.

### 10.2. Phase 2 — проход оптимизации (после MVP)

После генерации всех разворотов алгоритм ищет «плохие» развороты:
- Одинокие ученики в Standard разделе (1 ученик с межсемейственной правой)
- Сильно неполные сетки (например, Light с 3 учениками вместо 12)
- Дыры в общем разделе

Пытается улучшить путём:
- Передачи учеников с предыдущего разворота на текущий (если предыдущий не последний)
- Слияния соседних разворотов с малым заполнением
- Замены плотности (Light → Medium при <8 учениках в секции)

Реализуется как отдельный `optimizeLayout(layout, input, preset)` после основного прохода. **Не включается в MVP** — добавляется только при появлении жалоб партнёров.

### 10.3. Phase 3 — UI ручной правки

Уже реализовано в **фазе М** (12.05.2026):
- Партнёр видит strip миниатюр всех разворотов внизу
- Может **переставить** разворот (drag)
- Может **заменить** шаблон разворота на другой из того же семейства
- Может **добавить** / **удалить** разворот

Что добавляется после rule engine:
- В `TemplatePickerModal` — фильтрация по `family_id`
- Бейджик «проблемный разворот» (если Phase 2 не реализована) — визуальная подсказка партнёру что развороту нужно внимание

---

## 11. Параметрические мастера (variable grid)

### 11.1. Зачем

Сетки Mini имеют capacity 1..12 на сторону. Без параметризации это 12 отдельных мастеров. С параметризацией — **один** мастер `N-Grid-Page` с диапазоном допустимых сеток.

### 11.2. Декларация в БД

```sql
-- spread_templates.params для параметрического мастера
{
  "parametric": true,
  "grid_modes": [
    { "id": "1x1", "slot_count": 1, "rows": 1, "cols": 1, "layout": "center" },
    { "id": "2x1", "slot_count": 2, "rows": 1, "cols": 2, "layout": "top-center" },
    { "id": "3x1", "slot_count": 3, "rows": 1, "cols": 3, "layout": "top-full" },
    { "id": "2x2", "slot_count": 4, "rows": 2, "cols": 2, "layout": "balanced" },
    { "id": "3+2", "slot_count": 5, "rows": 2, "cols": 3, "layout": "top3-bot2-center" },
    { "id": "3+3", "slot_count": 6, "rows": 2, "cols": 3, "layout": "balanced" },
    { "id": "4+3", "slot_count": 7, "rows": 2, "cols": 4, "layout": "top4-bot3-center" },
    { "id": "4+4", "slot_count": 8, "rows": 2, "cols": 4, "layout": "balanced" },
    { "id": "3+3+3", "slot_count": 9, "rows": 3, "cols": 3, "layout": "balanced" },
    { "id": "4+3+3", "slot_count": 10, "rows": 3, "cols": 4, "layout": "top4-mid3-bot3" },
    { "id": "4+4+3", "slot_count": 11, "rows": 3, "cols": 4, "layout": "top4-mid4-bot3-center" },
    { "id": "4+4+4", "slot_count": 12, "rows": 3, "cols": 4, "layout": "balanced" }
  ],
  "slot_template": {
    "label_prefix": "studentportrait_",
    "size_mm": { "width": 35, "height": 50 },
    "spacing_mm": 5,
    "frame_origin_mm": { "x": 10, "y": 15 }
  }
}
```

### 11.3. Что делает дизайнер

Дизайнер делает **один** IDML с примером полного заполнения (например 4×3 = 12 портретов). В Script Label указывает:
- `grid_modes_supported`: список ID режимов (1x1, 2x1, ..., 4+4+4)
- Геометрию ячейки (одна, остальные вычисляются)
- Декоративные элементы (фон, рамки, орнамент) — рисуются для **полного** заполнения, при меньшем числе они **симметрично сжимаются** или **скрываются** по правилам дизайна

### 11.4. Что делает парсер

При импорте параметрического мастера парсер:
1. Читает `grid_modes_supported` из метки страницы
2. Создаёт одну строку `spread_templates` с `params.parametric=true, params.grid_modes=[...]`
3. Сохраняет «эталонную» геометрию полного заполнения

### 11.5. Что делает rule engine при сборке

```json
{
  "produces": {
    "type": "page",
    "side": "left",
    "master": {
      "parametric": "N-Grid-Page",
      "params": { "grid_mode": "$expr: select_grid_mode(students_remaining)" }
    }
  }
}
```

Функция `select_grid_mode(N)` находит первый режим `grid_modes[*].slot_count == N`. Если точного нет — берёт ближайший меньший и применяет балансировку (Phase 1).

При рендере (PDF / редактор) расчёт координат каждого placeholder'а делается **на лету** из `grid_mode` + `slot_template`.

### 11.6. Какие мастера параметризуются (после рассмотрения каталога)

| Параметрический мастер | Family | Density | Grid modes |
|---|---|---|---|
| `L-Grid-Page` | student-section | light | 1×1, 2×1, 3×1, 2×2, 3+2, 3+3 (1..6 учеников) |
| `N-Grid-Page` | student-section | mini | 12 режимов (1..12 учеников) |
| `M-Grid-Page` | student-section | medium | 1×1, 2×1, 3×1, 2×2 (1..4 учеников) |
| `G-Teachers-Grid` | subject-teachers | — | 3×3 (9), 4×3 (12), 4×4 (16) — три варианта |

Остальные мастера (F-Head-*, E-Student-*, J-*, S-*) — **не параметрические**, обычные.

---

## 12. Версионирование, миграции, кэш

### 12.1. `rules_version` для каждого альбома

При сборке `buildFromRules` записывает в `album_layouts.rules_version` строку вида:

```
preset:standard-vignette@1.0|head-teacher@1.0|subject-teachers@1.0|class-photo@1.0|student-section@1.0|common-section@1.0
```

Это snapshot версий **всех** семейств которые участвовали. При пересборке альбома (например, после ручного изменения партнёром структуры в редакторе) система использует **зафиксированные** версии правил, не текущие.

### 12.2. Изменение правила = новая версия семейства

OkeyBook (superadmin) меняет правило T-Class subjects=9+ → новая версия `head-teacher@1.1`. Действия:
1. INSERT новый набор `rules` с `family_version='1.1'`
2. UPDATE `template_families.version = '1.1'`
3. Существующие альбомы помнят `head-teacher@1.0` и продолжают рендериться по старым правилам
4. Новые альбомы (созданные после изменения) используют `1.1`

### 12.3. Миграция альбомов

Опционально — при необходимости перевести все альбомы на новую версию:
```sql
-- Скрипт: для всех альбомов с rules_version 1.0, пересобрать с 1.1
UPDATE album_layouts SET status='needs_rebuild' WHERE rules_version LIKE '%head-teacher@1.0%';
```

Партнёр в кабинете видит уведомление «правила обновлены, нажмите для пересборки» (опционально). Без действия партнёра — альбом остаётся на старой версии.

### 12.4. Aliases — переименование семейств

Если семейство `head-teacher` переименовать в `homeroom-section`:
```json
{
  "id": "homeroom-section",
  "aliases": ["head-teacher"],
  "display_name": "Учительская страница"
}
```

Старые альбомы с `decision_trace[].family_id='head-teacher'` продолжают работать (lookup идёт по `id OR aliases`).

### 12.5. Deprecated семейства

```json
{
  "id": "old-teacher-section",
  "deprecated": true,
  "display_name": "(Устарело) Учительская страница",
  "version": "0.9"
}
```

В UI выбора пресета такие семейства скрыты, но существующие альбомы рендерятся.

### 12.6. Совместимость со старым `buildAlbum`

В `lib/album-builder/index.ts`:
```typescript
export async function buildAlbum(input: AlbumInput, options: BuildOptions): Promise<AlbumLayout> {
  if (options.preset_id && hasRuleEnginePreset(options.preset_id)) {
    return buildFromRules(input, options.preset_id, options.tenant_id);
  }
  // Старый монолитный путь
  return buildFromMonolithic(input, options);
}
```

Преимущества:
1. Существующие альбомы (с пресетами Стандарт/Универсал из старого `SCENARIOS`) продолжают работать через `buildFromMonolithic`
2. Новые пресеты партнёров используют rule engine
3. Полная миграция не обязательна — переключение по флагу

### 12.7. Кэш раскладок

`layout_cache.input_hash = SHA256(canonicalJson({ input, preset_id, rules_version }))`.

Полезен когда:
- Партнёр в редакторе нажимает «Предпросмотр PDF» — нет необходимости пересчитывать если ничего не изменилось
- Партнёр перебирает варианты пресетов — каждый просмотренный кэшируется

Инвалидация: при изменении `students[]` (добавление ученика) `input_hash` меняется → новый запрос → новая запись.

TTL: 7 дней. Cron-задача удаляет записи с `last_accessed_at < NOW() - 7 days`.

---

## 13. План реализации

Подэтапы для веток `feature/rule-engine` (или ветка `feature/layout-engine` продолжается):

### РЭ.1. Миграция БД (один коммит)
- Создание таблиц `template_families`, `rules`, `presets`, `layout_cache`
- ALTER таблиц `spread_templates`, `album_layouts`
- SQL-скрипт `rule-engine-migration.sql`
- Применение в Supabase

### РЭ.2. Типы и схемы (один коммит)
- `lib/rule-engine/types.ts` — Rule, Preset, Section, WhenClause и т.д.
- `lib/rule-engine/schemas.ts` — Zod схемы для рантайм-валидации
- Без логики, только декларации

### РЭ.3. Каталог JSON-файлов с глобальными данными (один коммит)
- `docs/rule-engine-data/families/*.json` — 7 семейств (+ I-Personal заглушка)
- `docs/rule-engine-data/rules/*.json` — правила сгруппированные по семействам
- `docs/rule-engine-data/presets/*.json` — 6 базовых пресетов (Стандарт, Стандарт+виньетка, Универсал, Максимум, Медиум, Лайт, Мини)
- Скрипт `scripts/seed-rule-engine.ts` — заливка JSON в БД

### РЭ.4. Правила head-teacher + subject-teachers + class-photo (один коммит)
- Полный набор правил для T-Class subjects=0..24 (с variants для 10..24)
- Тесты `vitest` на каждое правило (~25 тестов)

### РЭ.5. Правила student-section: maximum, universal, standard (один коммит)
- Правила density=maximum (E-Max-Left + E-Max-Right c variants для текста)
- Правила density=universal (E-Student-Left/Right с friend_photos)
- Правила density=standard (E-Student-Standard-Left/Right)
- Включая правила одинокого ученика (межсемейственный разворот)

### РЭ.6. Правила student-section: medium, light, mini + параметрические мастера (два коммита)
- РЭ.6.1: декларация параметрических мастеров в БД (L-Grid-Page, N-Grid-Page, M-Grid-Page + один пример IDML от дизайнера)
- РЭ.6.2: правила выбора grid_mode по числу учеников + правила overflow (>capacity)

### РЭ.7. Правила common-section + intro + final (один коммит)
- Жадные правила для common-section (J-* мастера)
- intro для soft
- final для soft (S-Final-Soft-L)

### РЭ.8. Базовые пресеты (один коммит)
- 6 пресетов от OkeyBook: Стандарт, Стандарт+виньетка, Универсал, Максимум, Лайт, Мини
- Каждый в обеих печатях (layflat + soft через enabled_when)

### РЭ.9. `buildFromRules` — алгоритм (один коммит)
- `lib/rule-engine/build.ts` — основная функция
- `lib/rule-engine/evaluate.ts` — when-evaluator
- `lib/rule-engine/apply.ts` — apply rule, advance cursors
- `lib/rule-engine/balance.ts` — Phase 1 балансировка (использует существующий `album-builder/balance.ts`)
- Интеграция с `lib/album-builder/index.ts` (фолбэк на старый)

### РЭ.10. Тесты `vitest` для алгоритма (один коммит)
- Smoke-тесты на каждый базовый пресет с типовыми входами
- Edge cases: одинокий ученик, overflow, межсемейственный разворот
- Тесты на decision_trace корректность
- ~50 тестов

### РЭ.11. UI: TemplatePickerModal фильтрация по family_id (один коммит)
- Изменение фильтра в `app/app/_components/TemplatePickerModal.tsx`
- При замене шаблона партнёр видит только из того же семейства

### РЭ.12. UI: Редактор пресетов (опционально, может быть после запуска)
- `/app/presets` — список пресетов партнёра + копии глобальных
- Создание / редактирование / удаление
- Drag-reorder секций
- Изменение params (density, has_quote)

### РЭ.13. Документация и обновление контекста (один коммит)
- Обновление `yearbook-context-vN.md` → vN+1
- Обновление `designer-tz-2026-05-12.md` → v1.3 (учитывает постраничную модель и параметрические мастера)
- README для `lib/rule-engine/`

**Оценка**: РЭ.1-РЭ.10 = 10 коммитов основной работы. Каждый коммит — отдельная сессия Claude или часть сессии. Реалистичная скорость с учётом тестирования — **2-3 коммита в неделю**, итого **3-5 недель** до полностью работающего MVP. С запасом до сентября — ОК.

---

## Приложение А: Решения spec'а по 🔴 каталога

Сергей в опросе 15.05.2026 разрешил фиксировать как принятые с возможностью пересмотра. Перечень решений с обоснованием:

### А.1. T-Class subjects=9+, общие фото и полкласса

**Решение**: при subjects ≥ 9 общие фото и полкласса **не используются** на учительском развороте. Переходят в начало `common-section`. Партнёр в редакторе может добавить «доп. учительский разворот» через `TemplatePickerModal`.

**Обоснование**: вариант с автоматическим доп. разворотом усложняет правило (нужно поднимать `produces` до уровня `sequence`); пересмотрим если у партнёров будут жалобы.

### А.2. S-Intro для layflat

**Решение**: нет S-Intro в layflat (подтверждено Сергеем в xlsx). Layflat начинается с учительского разворота.

**Обоснование**: layflat-обложка несёт ту же функцию.

### А.3. S-Final-Soft-L: какое фото

**Решение**: дефолт — последнее доступное общее фото класса (`common_photos.full_class.last()`). Fallback: первое полкласса. Fallback: placeholder остаётся пустым.

**Обоснование**: партнёр всё равно может заменить в редакторе. Логика «обычно общее в конце» соответствует практике OkeyBook.

### А.4. Виньетка: где и в каких комплектациях

**Решение**: виньетка = секция `student-section` с `density=mini` в пресете. Партнёр сам решает в пресете — добавлять до основного раздела (как в «Стандарт + виньетка») или нет. В дефолтных пресетах OkeyBook виньетка есть только в «Стандарт + виньетка» (и аналогичных копиях).

**Обоснование**: единый механизм, не отдельное семейство.

### А.5. E-Maximum 4+ фото с друзьями для Individual

**Решение**: warning + обрезка до 4 (текущее поведение кода). Партнёр в редакторе может добавить второй разворот E-Maximum для этого ученика вручную, или система может предложить добавить через бейдж «у ученика N фото с друзьями» (UI расширение, не в MVP).

### А.6. E-Maximum-1 (одинокий ученик в Maximum)

**Решение**: НЕ нужен (подтверждено Сергеем). Maximum применяется только когда учеников много, одинокий случай не возникает в практике OkeyBook.

### А.7. Mini 25-30 overflow (взять с предыдущей правой страницы)

**Решение**: в MVP не реализуем. Идём по простому каскаду (12+12 первого разворота, остаток на втором). Phase 2 (после MVP) реализует логику «перераспределения с соседями».

### А.8. Medium 9+ (каскад полных + остаток)

**Решение**: первый разворот полный (8 учеников), последующие — по 8, последний — остаток с балансировкой через Phase 1. Соответствует Light overflow логике.

### А.9. I-Personal — отложено

**Решение**: структура семейства закладывается в `template_families` с `deprecated=false, enabled=false`. Правил нет. Реализуем после запуска основного MVP.

---

## Приложение Б: Глоссарий

| Термин | Значение |
|---|---|
| **Мастер** | Шаблон одной страницы (или одного разворота для type='spread') в IDML. Содержит placeholder'ы и декоративные элементы. Хранится в `spread_templates`. |
| **Семейство (family)** | Группа мастеров одинакового назначения + правила выбора и заполнения. Хранится в `template_families`. |
| **Пресет (preset)** | Комплектация = упорядоченный список секций с параметрами. Хранится в `presets`. |
| **Секция (section)** | Одно вхождение семейства в пресет с конкретными параметрами. |
| **Правило (rule)** | Декларация «при условиях X используй мастер Y и привяжи данные Z». Хранится в `rules`. |
| **Density** | Параметр семейства `student-section`, определяющий плотность сетки портретов. Шесть значений: maximum, universal, standard, medium, light, mini. |
| **Page type** | Тип страницы мастера: page-left, page-right, page-any, spread. |
| **Серия мастеров (series)** | Набор страниц одного дизайна гарантированно сочетающихся. Используется алгоритмом для согласованности. |
| **Межсемейственный разворот** | Разворот, левая и правая страницы которого — из разных семейств. Главный кейс: одинокий ученик в student-section + начало common-section. |
| **Параметрический мастер** | Один IDML с диапазоном допустимых сеток (`grid_modes`). Алгоритм выбирает конкретный режим по числу заполняемых слотов. |
| **Variants** | Множественные правильные ответы для одного контекста. Алгоритм выбирает default, партнёр может переключить. |
| **Decision trace** | Структурированный лог решений алгоритма для каждого разворота. Хранится в `album_layouts.decision_trace`. |
| **Cross-family spread** | См. межсемейственный разворот. |
| **Rules version** | Snapshot версий всех семейств участвовавших в сборке альбома. Хранится в `album_layouts.rules_version`. |
| **Балансировка** | Распределение оставшихся слотов мастера при неполном заполнении: центрирование, скрытие лишних. Three phases (locale, optimize, UI). |

---

**Конец спецификации v1.0.**

Следующий шаг после согласования: создание `docs/rule-engine-data/` с JSON-каталогом и реализация подэтапов РЭ.1-РЭ.13. ТЗ дизайнеру v1.3 — параллельный документ создаваемый после этого spec'а.
