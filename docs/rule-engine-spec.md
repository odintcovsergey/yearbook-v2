# Rule Engine — спецификация

**Версия:** 1.3
**Дата:** 16.05.2026 (уточнение семантики Combined-мастеров после сверки с IDML v2)
**Статус:** утверждённая спецификация
**Автор:** Сергей Одинцов + Claude

**Источники:**
- `docs/templates/architecture-decisions-2026-05-15.md` — 12 принятых решений (фундамент этого документа)
- `docs/templates/architecture-decisions-2026-05-12.md` — переход на двухстраничные мастера
- `docs/templates/composition-catalog.md` + `composition-catalog-filled-2026-05-15.xlsx` — каталог композиций
- `docs/templates/designer-tz-2026-05-16-v1.5.md` v1.5 — актуальное ТЗ дизайнеру с правильными размерами Combined (M=2, L=3, N=4)
- `lib/album-builder/` — текущая монолитная реализация `buildAlbum` (3139 строк), которую rule engine **дополняет**, а не заменяет сразу

**Аудитория:** будущий Claude в сессии реализации `buildFromRules` (полный технический контекст) + Сергей как чек-лист функциональности.

**Связанные документы:**
- `docs/templates/designer-tz-2026-05-16-v1.5.md` (v1.5) — актуальное ТЗ дизайнеру
- `docs/rule-engine-data/` — каталог JSON-файлов с правилами, пресетами, семействами

---

## Changelog: v1.2 → v1.3 (16.05.2026 — уточнение Combined после сверки с IDML v2)

После выпуска v1.2 Сергей сделал IDML с комбинированными мастерами — но с **меньшим** числом портретов чем я предполагал в ТЗ v1.4 (M=2, L=3, N=4 вместо 4/6/12).

Уточнение семантики: Combined — это **отдельный продуктовый вид страницы** для **маленького остатка** учеников, не «обрезанная полная сетка». Применяется когда `students_remaining <= max_slots_combined[density]` + есть общее фото. Иначе → обычный Grid-Page.

| # | Что было в v1.2 | Что стало в v1.3 |
|---|---|---|
| 1 | Combined = полная сетка + общее фото (M=4, L=6, N=12) | Combined = **отдельный** вид страницы с **маленьким** числом портретов (M=2, L=3, N=4) + общее фото |
| 2 | Условие применения: «есть общее фото + неполный остаток сетки» | Условие применения: `students_remaining <= max_slots_combined[density]` + есть общее фото. Если остаток больше — используется обычный Grid-Page (как для полной сетки, так и для большой неполной) |
| 3 | ТЗ v1.4 | ТЗ v1.5 (`designer-tz-2026-05-16-v1.5.md`) с правильными размерами |

`MAX_SLOTS_COMBINED` константа в коде rule engine:
```typescript
const MAX_SLOTS_COMBINED: Record<Density, number> = {
  medium: 2,
  light: 3,
  mini: 4,
  // maximum/universal/standard не используют Combined
};
```

---

## Changelog: v1.1 → v1.2 (16.05.2026 — после сверки с реальным IDML)

После выпуска v1.1 Сергей прислал готовый IDML «Белый плотные разворотами» с 27 мастерами. Сверка обнаружила что отдельный класс композиций — «портреты вверху + общее фото внизу на одной странице» — НЕ покрывался postpage-моделью разворота со смешанными страницами. Это типовая верстка для случаев типа «Light с 7-12 учениками: левая страница полная сетка 6, правая 1-3 портрета + общее фото внизу».

Решение: добавлено **подсемейство комбинированных мастеров** для плотностей medium/light/mini.

| # | Что было в v1.1 | Что стало в v1.2 |
|---|---|---|
| 1 | Раздел учеников с неполным остатком + общее фото = разворот со смешанными страницами (M/L/N-Grid-Page слева + J-Full справа) | Добавлены **комбинированные мастера** M-Combined-Page / L-Combined-Page / N-Combined-Page — портреты вверху + одно общее фото внизу на ОДНОЙ странице. Применяются только для density=medium/light/mini |
| 2 | Не было обоснования почему combined только для M/L/N | Зафиксировано: для Standard/Universal/Maximum (E-*) комбинированные мастера НЕ нужны — остаток идёт через классический разворот со смешанными страницами (E-* слева + J-* справа). Для M/L/N — комбинированный мастер компактнее и эстетичнее |
| 3 | `spread_templates.params` имел только `parametric: true` | Добавлено поле `has_class_photo_bottom: true` для комбинированных мастеров. Алгоритм при сборке предпочитает их в правилах когда есть общее фото и неполный остаток учеников |
| 4 | Метки `halfleftphoto`/`halfrightphoto` для G-HalfClass | Унифицированы как `halfphoto_1`, `halfphoto_2` (одинаково с J-Half) |
| 5 | E-Max: цитата на левой странице, фото с друзьями на правой | Цитата переехала на правую (`studentquote` на E-Max-Right), левая только портрет + ФИО |
| 6 | E-Universal: фото с друзьями только на правой | На обеих страницах — каждая про **отдельного ученика** со своим портретом + 2 фото с друзьями. capacity_per_spread = 2 |
| 7 | G-Teachers-4x3 (формат «строки×колонки») | G-Teachers-3x4 (физически сетка 3 ряда × 4 колонки) |
| 8 | J-Quarter (один мастер) | J-Quarter-Left + J-Quarter-Right (две раскладки) |
| 9 | J-Quote был в плане | Удалён из MVP |
| 10 | S-Intro с `albumtitle`/`albumyear`/`schoolname` | Сокращён до `classphotoframe` (для теста, дополнить позже) |
| 11 | ТЗ дизайнеру v1.3 (designer-tz-2026-05-15.md) | ТЗ v1.4 (designer-tz-2026-05-16.md) — все правки выше |

---

## Changelog: v1.0 → v1.1 (15.05.2026 после ревью)

После выпуска v1.0 Сергей прошёл по spec'у в 3 раунда вопросов. Найдены 13 неточностей в моих допущениях. Все исправлены в v1.1.

| # | Что было в v1.0 | Что стало в v1.1 |
|---|---|---|
| 1 | «Межсемейственный разворот» — редкий случай | «Разворот со смешанными страницами» — норма для **любого** нечётного числа в Standard и любого неполного заполнения сеток |
| 2 | «Дублирование данных между секциями — by-default» | Это специфика конкретных пресетов (Индивидуальный, Мини с виньеткой), не общее правило |
| 3 | Пример пресета «Стандарт + виньетка» | **Удалён** — это было моё изобретение, в практике OkeyBook такого нет |
| 4 | I-Personal — отдельное семейство, отложено | **Удалено** — функция выполняется через student-section с density=maximum |
| 5 | Нет пресета «Индивидуальный» | **Добавлен** — реальный пример двух секций student-section (max + mini) |
| 6 | `print_type`: layflat / soft | Добавлен **трюмо** (фотопапка из 3 створок, разворот = 3 страницы). Заложено структурно, реализация после MVP |
| 7 | `has_quote` встроен в density_config | `has_quote`, `has_friend_photos`, `friend_photos_max` — **параметры секции пресета**, не свойства плотности |
| 8 | Не было матрицы допустимых комбинаций | Добавлена §4.4: какие параметры допустимы для какой density |
| 9 | Параметрические мастера — основной путь | Поддерживаются **оба пути** — параметрический И N отдельных мастеров. Решение продуктовое, не архитектурное |
| 10 | F-Head-WithClassPhoto не упомянут | **Добавлен** новый одностраничный мастер для композиции «классрук + общее фото внизу левой + 2 полкласса справа» |
| 11 | `series_id` — активная концепция | Колонка в БД остаётся, NULL по умолчанию. В MVP не используется. Открыта дверь для будущих дизайнов |
| 12 | Не заложен механизм для виньетки с детскими фото | Опционально `Section.params.portrait_source` + `Student.secondary_portraits[]` |
| 13 | Нет раздела «простыми словами» | Добавлен **§1 «Как это работает» простыми словами** перед техническими разделами |

---

## 0. TL;DR

1. Старый `buildAlbum` — монолит, в котором композиционная логика зашита в TypeScript. Меняем на **rule engine**: те же правила, но как **данные** в БД (JSON).
2. Структура — три уровня: **мастер** (одна страница IDML), **семейство** (правила выбора мастера и заполнения данными), **пресет** (комплектация = упорядоченный список секций с параметрами).
3. **Семь семейств**: `head-teacher`, `subject-teachers`, `class-photo`, `student-section`, `common-section`, `intro`, `final`. (I-Personal удалён — его роль выполняет student-section с density=maximum.)
4. Все плотности личного раздела (Maximum / Universal / Standard / Medium / Light / Mini, она же виньетка) объединены в **одно** семейство `student-section` с параметром `density`. Шесть значений — шесть capacity'ей. На разворот ставит от 1 (Maximum) до 24 (Mini) портретов.
5. Все новые мастера — **постраничные** (`page-left` / `page-right` / `page-any`). Из 4 одностраничных можно собрать 8 разворотов.
6. Поддерживается **разворот со смешанными страницами** — левая страница из одного семейства, правая из другого. Это норма для любого нечётного числа учеников в Standard и любого неполного заполнения сеток (Light, Medium, Mini).
7. Для сеток (Mini 1..12, Light 1..6, Medium 1..4) поддерживаются **два пути**: (а) **параметрический мастер** — один IDML с диапазоном допустимых сеток; (б) **N отдельных мастеров** — по одному на каждое число учеников. Какой использовать — продуктовое решение (зависит от готовности дизайнера сделать «гибкий» IDML).
8. **Множественность правильных ответов** покрыта механизмом `variants`. Алгоритм выбирает default по контексту, партнёр в редакторе **переключает** на другой вариант кнопкой «другая раскладка» (UI уже готов — фаза М).
9. **Балансировка** трёхфазная: Phase 1 (локальная per-spread) — MVP, Phase 2 (проход оптимизации) — после запуска если будут жалобы, Phase 3 (UI ручной правки) — уже есть в фазе М.
10. **Параметры секции пресета** (не свойства density): `has_quote`, `has_friend_photos`, `friend_photos_max`. Партнёр настраивает в пресете — например «Стандарт **без** цитат» или «Универсал с **4** фото друзей вместо 2». Матрица допустимых параметров по плотности — §4.4.
11. **Совместимость**: старый `buildAlbum` остаётся для существующих альбомов. Новые альбомы строятся через `buildFromRules`. Каждый альбом помнит свою `rules_version`. Полная миграция не обязательна.
12. **Цель**: ~27 мастеров на одну дизайн-серию (вместо ~80 без rule engine). Запуск партнёрской программы в сентябре 2026 — есть 3+ месяца.
13. **Трюмо** (фотопапка из 3 створок) — заложен структурно как `print_type='tryumo'` + `pages_per_spread=3`. Реализация после MVP, технически отличается от 2-страничного разворота.

---

## 1. Как это работает простыми словами

> Этот раздел — без терминов и JSON. Если в техдеталях ниже что-то непонятно — вернись сюда.

### Что такое мастер

**Мастер** = один лист, нарисованный дизайнером в InDesign. На листе нарисованы **пустые рамки** (placeholder'ы) куда система потом подставит фото и тексты. Пример: лист «Учительский с большим фото» — рамка для портрета классрука сверху, под ней рамки для ФИО и должности, ниже рамка для приветственного текста. Сам лист красивый — фон, орнамент, всё что дизайнер захотел. Но содержимого рамок ещё нет.

Один IDML-файл дизайнера = один комплект мастеров (60-80 листов разного назначения).

### Что такое семейство

**Семейство** = группа мастеров **одного назначения**. Например все «учительские страницы с классруком» — это семейство `head-teacher`. В нём:
- F-Head-WithPhoto — классрук с крупным портретом
- F-Head-SmallGrid — классрук + до 4 предметников в сетке
- F-Head-LargeGrid — классрук + до 8 предметников

Эти три мастера решают **одну задачу** — показать учителей в начале альбома. Какой именно мастер взять — зависит от ситуации (сколько у класса предметников).

Партнёр в редакторе если нажмёт «заменить шаблон» — увидит **только** мастера из того же семейства. Не сможет случайно поменять учительскую страницу на «коллаж фото с поездок».

### Что такое правило

**Правило** = строчка в базе типа «если выполнены такие условия — взять такой мастер». Пример:

```
ЕСЛИ предметников 5..8 → взять мастер F-Head-LargeGrid
ЕСЛИ предметников 9    → взять мастер G-Teachers-3x3
ЕСЛИ предметников 10..12 → взять мастер G-Teachers-4x3
```

Раньше это было прописано в коде TypeScript — каждое изменение требовало деплой. Теперь это **данные в БД** — изменить правило = UPDATE строки в Supabase, без выкатки.

### Что такое пресет

**Пресет** = «рецепт альбома». Список секций в правильном порядке. Пример:

```
Пресет "Стандарт":
  1. Заглавный лист (если soft, иначе пропустить)
  2. Учительская страница с классруком
  3. Раздел учеников: density=standard (двое на разворот, с цитатами)
  4. Общий раздел (фото поездок и мероприятий)
  5. Финальный лист (если soft)

Пресет "Индивидуальный":
  1. Заглавный (если soft)
  2. Учительская страница
  3. Раздел учеников: density=maximum (по развороту на каждого, с фото друзей)
  4. Раздел учеников: density=mini (виньетка — все ученики мелко в сетке 4×3)
  5. Общий раздел
  6. Финальный (если soft)
```

В Индивидуальном есть **два** раздела учеников — это нормально. Те же ученики появятся сначала с большими портретами на разворотах, потом в виньетке мелко. **Партнёр в кабинете** (после реализации) может скопировать глобальный пресет и поменять под себя — добавить/удалить секции, поменять плотность.

### Что такое плотность (density)

**Плотность** = насколько тесно ставить портреты учеников в личном разделе. Шесть значений:

| density | На страницу | На разворот | Как выглядит |
|---|---|---|---|
| maximum | 1 крупно | 1 | Целая страница — один портрет крупно + ФИО. Справа фото с друзьями |
| universal | 1 | 2 | Один ученик на страницу, можно с фото с друзьями |
| standard | 1 | 2 | Один ученик на страницу, классика, без фото с друзьями |
| medium | 4 | 8 | Сетка 2×2 на каждой странице |
| light | 6 | 12 | Сетка 3×2 на каждой странице |
| mini | 12 | 24 | Сетка 4×3 на каждой странице — она же **виньетка** |

Виньетка — это просто `density=mini`. Не отдельная сущность.

### Что такое разворот со смешанными страницами

Допустим у класса 13 учеников и комплектация Standard (двое на разворот). 12 учеников = 6 разворотов. **13-й остался один**. Его портрет ставим на левую страницу следующего разворота — а **правую** заполняем тем что обычно идёт дальше (например 2 фото полкласса из общего раздела).

Получается разворот: слева ученик, справа общее фото. **Это один разворот**, не два — мы НЕ оставляем правую страницу пустой и НЕ выбрасываем разворот.

Это нормально, происходит часто (у любого нечётного числа в Standard, у любого неполного заполнения сетки в Light/Medium/Mini). Никаких костылей — встроено в архитектуру.

### Что меняется по сравнению с сегодняшним кодом

| Сейчас | После rule engine |
|---|---|
| Правила в TypeScript switch'ах | Правила как JSON в БД |
| Партнёр не видит почему алгоритм выбрал такой мастер | Каждое решение записано в `decision_trace` |
| Замена шаблона в редакторе показывает ВСЕ мастера template_set'а | Показывает только из того же **семейства** |
| Множественные правильные ответы не поддержаны | `variants` — partner переключает между ними |
| ~80 мастеров на серию у дизайнера | ~27 (в 3-4 раза меньше за счёт параметрических мастеров и объединения плотностей) |
| Изменение правила = git commit + deploy | UPDATE строки в БД за секунду |

### Что НЕ меняется

- **Существующие альбомы** (50+ в проде) продолжают работать через старый `buildAlbum`. Их не трогаем
- **UI редактора** макета — фаза М уже сделана, остаётся как есть. Только добавится фильтр по семейству в `TemplatePickerModal`
- **Структура данных альбома** в БД — `album_layouts.spreads[]` остаётся прежним

Теперь — технические разделы.

---

## 2. Зачем и что меняется

### 2.1. Что не так с текущим `buildAlbum`

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
5. **Несоразмерно много мастеров**. Сейчас 39 мастеров в template_set okeybook-default, и часть из них дублирует друг друга с минимальными отличиями.

### 2.2. Что меняется

| | Сейчас | После rule engine |
|---|---|---|
| Правила выбора мастера | TypeScript switch | JSON в БД |
| Композиции личного раздела | 4+ семейства мастеров (E-Standard / E-Universal / E-Maximum / Light / Mini …) | 1 семейство `student-section` + параметр `density` |
| Мастеров на серию | ~80 | ~27 (или больше если N отдельных мастеров вместо параметрических) |
| Изменение правила | git commit + deploy | UPDATE строки в БД |
| Версионирование | нет | `rules.version`, `album_layouts.rules_version` |
| Аудит решения | console.log | `decision_trace` в БД |
| Замена шаблона партнёром | весь template_set | только из семейства |
| Поддержка разворотов со смешанными страницами | нет (хардкод в коде E-Standard для одинокого ученика) | первоклассная концепция |

### 2.3. Метрика успеха

1. **Объём работы дизайнера**: ~27 мастеров (с параметрическими) или ~50 (без), вместо 80+
2. **Скорость изменения правил**: новое правило = UPDATE rules за минуту, не неделя разработки
3. **Прозрачность**: партнёр в редакторе видит `decision_trace` с правилом которое сработало
4. **Совместимость**: существующие альбомы продолжают рендериться корректно

---

## 3. Трёхуровневая архитектура

```
┌─────────────────────────────────────────────────────────────────┐
│  УРОВЕНЬ 3: Пресеты (комплектации)                              │
│                                                                  │
│  "Индивидуальный" = [intro?, head-teacher,                       │
│                       student-section[density=maximum],          │
│                       student-section[density=mini],             │
│                       common-section, final?]                    │
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
│  spread_templates: F-Head-WithPhoto (page-any),                  │
│  F-Head-WithClassPhoto-L (page-left, новый), G-HalfClass, …      │
│  placeholder'ы (lowercase): headteacherphoto, halfleftphoto, …   │
└─────────────────────────────────────────────────────────────────┘
```

### 3.1. Семь активных семейств

| family_id | display_name | Назначение | Состав мастеров |
|---|---|---|---|
| `head-teacher` | Учительская страница с классруком | Левая страница (layflat) или единственная (soft) | F-Head-WithPhoto, F-Head-SmallGrid, F-Head-LargeGrid, **F-Head-WithClassPhoto-L** (новый в v1.1) |
| `subject-teachers` | Страница с предметниками | Правая страница при subjects ≥ 9 | G-Teachers-3x3, G-Teachers-4x3, G-Teachers-4x4 |
| `class-photo` | Страница с групповыми фото | Правая страница при subjects ≤ 8 | G-FullClass, G-HalfClass |
| `student-section` | Личный раздел учеников **с параметром density** | Основная часть альбома | E-Max/Universal/Standard-Left/Right, L-Grid-Page, N-Grid-Page, M-Grid-Page, **M/L/N-Combined-Page** (комбинированные с общим фото внизу, v1.2) |
| `common-section` | Общий раздел | После личного раздела или дозаполнение смешанных разворотов | J-Spread, J-ClassPhoto, J-Half, J-Quarter, J-Collage |
| `intro` | Заглавный | Только soft | S-Intro |
| `final` | Финальный | Только soft | S-Final-Soft-L |

**Удалено в v1.1**: семейство `i-personal`. Его функцию полностью покрывает `student-section` с `density=maximum`.

### 3.2. Замена шаблона партнёром

В редакторе (фаза М) кнопка «другая раскладка» открывает `TemplatePickerModal`. После rule engine модал фильтруется по **family_id** текущей страницы:

- Учительская страница → видит мастера из head-teacher
- Учительский разворот с правой G-* → правая фильтруется по subject-teachers + class-photo
- Личный раздел → видит мастера student-section
- Общий раздел → видит J-*

При разворотах со смешанными страницами (§5.3) партнёр может заменить **каждую** страницу отдельно — левая фильтруется по family левой, правая — по family правой.

### 3.3. Глобальные vs тенант-специфичные семейства

`template_families.tenant_id`:
- `NULL` — глобальное (поставляется OkeyBook)
- `<uuid>` — кастомное семейство партнёра

Партнёр **копирует** глобальное в своё (с новым `id` и `aliases: [old_id]`) и редактирует. См. §12.

---

## 4. Семейство `student-section` с параметром `density`

### 4.1. Шесть плотностей

| density | На сторону | На разворот | Использование |
|---|---|---|---|
| `maximum` | 1 (крупный портрет) | 1 (двухстраничный разворот) | Самая просторная подача, для Maximum/Индивидуальный |
| `universal` | 1 | 2 | Один ученик на странице, можно с фото с друзьями |
| `standard` | 1 | 2 | Классика «двое на разворот» |
| `medium` | 4 | 8 | Сетка 2×2 на странице |
| `light` | 6 | 12 | Сетка 3×2 на странице |
| `mini` | 12 | 24 | Сетка 4×3 на странице, **виньетка** |

### 4.2. Декларация семейства

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
      "default": true,
      "description": "Выводить ли цитату ученика под портретом (см. матрицу §4.4)"
    },
    "has_friend_photos": {
      "type": "boolean",
      "default": false,
      "description": "Выводить ли фото с друзьями (см. матрицу §4.4)"
    },
    "friend_photos_max": {
      "type": "number",
      "default": 4,
      "values": [2, 3, 4],
      "description": "Максимум фото с друзьями (когда has_friend_photos=true)"
    },
    "portrait_source": {
      "type": "string",
      "default": "default",
      "description": "Источник портрета. Опционально для будущей доп-услуги (виньетка с детскими фото из садика). В MVP всегда 'default'."
    }
  },
  "density_config": {
    "maximum":   { "capacity_per_side": 1,  "capacity_per_spread": 1 },
    "universal": { "capacity_per_side": 1,  "capacity_per_spread": 2 },
    "standard":  { "capacity_per_side": 1,  "capacity_per_spread": 2 },
    "medium":    { "capacity_per_side": 4,  "capacity_per_spread": 8 },
    "light":     { "capacity_per_side": 6,  "capacity_per_spread": 12 },
    "mini":      { "capacity_per_side": 12, "capacity_per_spread": 24 }
  }
}
```

**Важно** (изменение v1.1): `has_quote`, `has_friend_photos`, `friend_photos_max` — **параметры секции пресета**, не свойства density. Партнёр может в одном пресете включить has_quote=true для density=standard, а в другом — has_quote=false. Какие параметры допустимы для какой плотности — §4.4.

### 4.3. Множественные секции `student-section` в одном пресете

Один пресет может включать **несколько** секций `student-section` с разными плотностями. Это **специфика конкретных пресетов**, не общее правило.

**Реальный пример из практики OkeyBook**:

```
preset "Индивидуальный":
  - intro (если soft)
  - section: head-teacher
  - section: student-section [density=maximum, has_quote=true, has_friend_photos=true]
    # Каждому ученику — отдельный разворот E-Max-Left + E-Max-Right
  - section: student-section [density=mini]
    # В конце — виньетка всех учеников мелко в сетке 4×3
  - section: common-section
  - final (если soft)
```

В Индивидуальном пресете **те же** ученики появятся в обоих секциях:
1. С большими портретами в основной части
2. Мелко в виньетке в конце

Это **корректное** поведение — практика OkeyBook так и работает.

В **большинстве** пресетов (Стандарт, Универсал, Максимум, Медиум, Лайт, Мини) — **одна** секция student-section. Никакого дублирования.

**Удалено в v1.1**: пример пресета «Стандарт + виньетка» — это было моё изобретение, в реальной практике такого пресета нет.

### 4.4. Матрица допустимых параметров по плотности

| density | has_quote | has_friend_photos | friend_photos_max | Комментарий |
|---|---|---|---|---|
| `maximum` | ✓ | ✓ | 2-4 | Все опции доступны |
| `universal` | ✓ | ✓ | 2-4 | Все опции доступны |
| `standard` | ✓ | ✗ | — | Цитаты есть; фото с друзьями физически некуда |
| `medium` | ✗ | ✗ | — | Сетка 4 на страницу — нет места |
| `light` | ✗ | ✗ | — | Сетка 6 на страницу |
| `mini` | ✗ | ✗ | — | Сетка 12 на страницу — только портрет + ФИО |

Если партнёр в пресете указывает `has_quote=true` для density=medium — Zod-валидация при сохранении пресета **отклоняет** изменение с сообщением «параметр has_quote не поддерживается для плотности medium».

### 4.5. Параметр `portrait_source` (для будущего)

В MVP не реализуется. Заложен на случай будущей доп-услуги «**виньетка с детскими фото из садика**».

Когда захотим реализовать:
1. `Student.secondary_portraits[]` — массив дополнительных портретов (загружаются партнёром отдельно)
2. `Section.params.portrait_source` — значения `'default'` / `'secondary_1'` / `'secondary_2'` / ...
3. Алгоритм: если `portrait_source != 'default'` и у ученика есть `secondary_portraits[N]` — использует его. Fallback на default если нет.

В типах будет, в правилах не используется. Партнёр в UI пресета пока эту опцию не видит.

---

## 5. Постраничная модель

### 5.1. Типы страниц и типы печати

В `spread_templates.page_type`:
- `page-left` — мастер только для левой страницы (S-Final-Soft-L, F-Head-WithClassPhoto-L)
- `page-right` — мастер только для правой (F-Head-WithPhoto-R в soft)
- `page-any` — мастер для любой стороны
- `spread` — мастер занимает оба листа как единое полотно (J-Spread)

В `presets.print_type`:
- `layflat` — толстые плотные страницы, склеенные попарно; начинается с разворота (без S-Intro)
- `soft` — мягкие листы, скреплённые сшивкой; начинается с правой (S-Intro), заканчивается левой (S-Final-Soft-L)
- `tryumo` — **фотопапка из 3 створок**, разворот = 3 страницы. **Заложено структурно**, реализация после MVP. Меняется `pages_per_spread=3` и понятие разворота (left/center/right вместо left/right)

### 5.2. Серии мастеров (заложено, не используется в MVP)

`spread_templates.series_id` — стабильный ID **серии** = весь комплект мастеров одного **визуального стиля** (учительские, ученические, общие, заглавные, финальные).

**В MVP**: `series_id = NULL` для всех мастеров. Один глобальный комплект `okeybook-default`, партнёры выбора дизайна не имеют.

**В будущем** (после запуска партнёрки, если будет спрос): можно создать дополнительные серии и предложить партнёрам выбирать стиль альбома. Партнёр при создании альбома выберет серию, и весь альбом соберётся из мастеров **только** этой серии.

Колонка `series_id` в БД есть, NULL по умолчанию, в правилах rule engine не используется. Открыта дверь для будущей фичи без миграции данных.

### 5.3. Разворот со смешанными страницами

Концепция: **один разворот может состоять из страниц разных семейств**. Это **норма**, не исключение.

**Случаи когда возникает** (массовые в практике OkeyBook):

1. **E-Standard, любое нечётное число учеников**: при 13, 15, 17... учениках — последний ученик остаётся один. Его портрет на левой странице, **правая** заполняется из общего раздела
2. **Light, неполное заполнение**: 7 учеников = 6 на левой (полная сетка 3×2) + 1 на правой балансированно + место для общего фото справа
3. **Medium, неполное заполнение**: 1-7 учеников — левая частично заполнена, правая = общий раздел
4. **Mini, при 25-30 учеников**: первый разворот полный (24), на втором — 1-6 учеников + общее фото

**Реализация в алгоритме**:
- Алгоритм после применения правила student-section смотрит: разворот заполнен полностью (left+right) или только left?
- Если только left → переходит к следующей секции пресета (обычно common-section) с флагом `start_on_right_page=true`
- Следующая секция применяет своё правило, выбирая мастер с `page_type ∈ (page-right, page-any)`, и кладёт его на «висящую» правую страницу того же разворота
- Развороту присваивается флаг `mixed_pages=true`

**В UI**: партнёр в редакторе видит обычный разворот. Замена шаблона работает постранично — левую можно сменить из её family, правую из её.

### 5.4. Корешок и сшивка

- **Корешок** — внутренний отступ дизайна каждой страницы. Никакая логика rule engine с ним не работает.
- **Фото через сшивку запрещено**. Исключение: `J-Spread` — фотограф снимает специально без лиц на сгибе, `page_type='spread'`.

---

## 6. Модель данных

### 6.1. Новые таблицы

```sql
CREATE TABLE template_families (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  aliases TEXT[] DEFAULT '{}',
  deprecated BOOLEAN DEFAULT false,
  version TEXT NOT NULL,
  tenant_id UUID NULL,
  params JSONB DEFAULT '{}',
  density_config JSONB DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_template_families_tenant ON template_families(tenant_id);

CREATE TABLE rules (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES template_families(id),
  family_version TEXT NOT NULL,
  priority INT NOT NULL DEFAULT 0,
  rule_json JSONB NOT NULL,
  tenant_id UUID NULL,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_rules_family ON rules(family_id, family_version, priority DESC) WHERE enabled = true;
CREATE INDEX idx_rules_tenant ON rules(tenant_id);

CREATE TABLE presets (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  sections JSONB NOT NULL,
  print_type TEXT NOT NULL,                  -- 'layflat' | 'soft' | 'tryumo'
  pages_per_spread INT NOT NULL DEFAULT 2,   -- 2 обычно, 3 для трюмо
  tenant_id UUID NULL,
  version TEXT NOT NULL,
  parent_preset_id TEXT NULL,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_presets_tenant ON presets(tenant_id, print_type) WHERE enabled = true;
```

### 6.2. Изменения существующих таблиц

```sql
ALTER TABLE album_layouts
  ADD COLUMN preset_id TEXT REFERENCES presets(id),
  ADD COLUMN rules_version TEXT,
  ADD COLUMN decision_trace JSONB DEFAULT '[]';

-- album_layouts.spreads[] внутри JSONB добавляются поля:
--   mixed_pages: boolean — флаг разворота со смешанными страницами
--   user_edited: boolean — партнёр менял этот разворот вручную?
--   user_edits: {...}

ALTER TABLE spread_templates
  ADD COLUMN family_id TEXT REFERENCES template_families(id),
  ADD COLUMN page_type TEXT DEFAULT 'page-any',
  ADD COLUMN series_id TEXT,                  -- NULL в MVP
  ADD COLUMN density TEXT NULL,               -- для student-section мастеров
  ADD COLUMN params JSONB DEFAULT '{}';       -- для параметрических: {parametric: true, grid_modes: [...]}

CREATE INDEX idx_spread_templates_family ON spread_templates(family_id, density);
CREATE INDEX idx_spread_templates_series ON spread_templates(series_id) WHERE series_id IS NOT NULL;

-- Заложено для будущей виньетки с детскими фото (в MVP не используется):
ALTER TABLE children ADD COLUMN secondary_portraits JSONB DEFAULT '[]';
```

### 6.3. Кэш раскладок

```sql
CREATE TABLE layout_cache (
  input_hash TEXT PRIMARY KEY,
  layout JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_accessed_at TIMESTAMPTZ DEFAULT NOW(),
  access_count INT DEFAULT 1
);
CREATE INDEX idx_layout_cache_accessed ON layout_cache(last_accessed_at);
```

TTL: 7 дней, чистка через cron.

---

## 7. Формат JSON-правил

### 7.1. Структура правила

```typescript
type Rule = {
  id: string;
  family_id: string;
  family_version: string;
  priority: number;
  when: WhenClause;
  produces: ProducesSpread | ProducesPage | ProducesSequence;
  consumes: ConsumesClause;
  balance?: BalanceClause;
  variants?: Rule[];
  display_name?: string;
  description?: string;
  enabled?: boolean;
};
```

### 7.2. Оператор `when`

```typescript
type WhenClause = { [field: string]: WhenOperator };

type WhenOperator =
  | number | string | boolean                  // эквивалент {eq: value}
  | { eq: any } | { neq: any }
  | { gte: number } | { lte: number } | { gt: number } | { lt: number }
  | { between: [number, number] }
  | { in: any[] } | { not_in: any[] }
  | { has: true | false }
  | { count_gte: number } | { count_lte: number }
  | { count_between: [number, number] };
```

**Доступные поля контекста**:

| Поле | Тип | Описание |
|---|---|---|
| `subjects_count` | number | Число учителей-предметников |
| `students_count` | number | Общее число учеников |
| `students_remaining` | number | Сколько учеников ещё не размещено |
| `current_student_index` | number | Индекс следующего ученика |
| `head_teacher.has_photo` | boolean | Есть ли фото классрука |
| `head_teacher.has_text` | boolean | Есть ли приветственный текст |
| `common_photos.full_class.count` | number | Число общих фото |
| `common_photos.half_class.count` | number | Число полкласса |
| `common_photos.spread.count` | number | Число J-Spread фото |
| `common_photos.quarter.count` | number | Число четверть-класса фото |
| `common_photos.sixth.count` | number | Число фото для коллажа |
| `print_type` | string | 'layflat' / 'soft' / 'tryumo' |
| `section.position` | string | 'first' / 'middle' / 'last' |
| `section.density` | string | значение параметра density |
| `section.has_quote` | boolean | значение параметра has_quote |
| `section.has_friend_photos` | boolean | значение параметра has_friend_photos |
| `section.friend_photos_max` | number | максимум фото с друзьями |
| `prev_spread.right_page_empty` | boolean | Висит ли свободная правая страница |
| `friend_photos_count` | number | Число фото с друзьями у текущего ученика |

### 7.3. Оператор `produces`

```typescript
type ProducesSpread = {
  type: 'spread';
  left_master: string | MasterSelector;
  right_master: string | MasterSelector;
  start_on_right_page?: boolean;
};

type ProducesPage = {
  type: 'page';
  side: 'left' | 'right' | 'any';
  master: string | MasterSelector;
};

type ProducesSequence = {
  type: 'sequence';
  steps: Array<ProducesSpread | ProducesPage>;
};

type MasterSelector = {
  parametric: string;
  params: Record<string, string | number>;
};
```

### 7.4. Оператор `bind`

```typescript
type Bind = { [placeholder_label: string]: BindExpression };

type BindExpression =
  | string                                     // путь: 'input.head_teacher.photo'
  | { template: string; params: Record<string, BindExpression> }
  | { expr: string };                          // вычисляемое выражение
```

Примеры путей:
- `input.head_teacher.photo`
- `input.subjects[0].name`
- `input.common_photos.half_class[0]`
- `input.students[$current_student_index].portrait` (`$` — переменная)

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

```typescript
type ConsumesClause = {
  students?: number | string;
  common_photos?: {
    full_class?: number;
    half_class?: number;
    spread?: number;
    quarter?: number;
    sixth?: number;
  };
};
```

### 7.6. Оператор `variants`

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
    }
  ]
}
```

### 7.7. Полные примеры по семействам

#### 7.7.1. `head-teacher` — новое правило с F-Head-WithClassPhoto-L (v1.1)

Когда у партнёра есть **и** общее фото, **и** 2 полкласса одновременно — система использует специальный мастер с общим фото внизу левой страницы:

```json
{
  "id": "t-class-0-classphoto-and-halfs",
  "family_id": "head-teacher",
  "family_version": "1.0",
  "priority": 110,
  "when": {
    "subjects_count": 0,
    "common_photos.full_class.count": { "gte": 1 },
    "common_photos.half_class.count": { "gte": 2 },
    "print_type": "layflat"
  },
  "produces": {
    "type": "spread",
    "left_master": "F-Head-WithClassPhoto-L",
    "right_master": "G-HalfClass"
  },
  "bind": {
    "F-Head-WithClassPhoto-L": {
      "headteacherphoto": "input.head_teacher.photo",
      "headteachername": "input.head_teacher.name",
      "headteacherrole": "input.head_teacher.role",
      "headtextframe": "input.head_teacher.text",
      "classphotoframe": "input.common_photos.full_class[0]"
    },
    "G-HalfClass": {
      "halfleftphoto": "input.common_photos.half_class[0]",
      "halfrightphoto": "input.common_photos.half_class[1]"
    }
  },
  "consumes": {
    "common_photos": { "full_class": 1, "half_class": 2 }
  }
}
```

Партнёр в редакторе может заменить **любую** страницу:
- Левую → видит другие F-Head-* из семейства head-teacher
- Правую → видит G-FullClass и др. из семейства class-photo

#### 7.7.2. Базовые правила subjects=0..8

```json
[
  {
    "id": "t-class-0-half-class",
    "family_id": "head-teacher",
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
    "consumes": { "common_photos": { "half_class": 2 } }
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
    },
    "bind": {
      "F-Head-SmallGrid": {
        "headteacherphoto": "input.head_teacher.photo",
        "headteachername": "input.head_teacher.name",
        "teacherphoto_{i}": {
          "template": "input.subjects[{i}-1].photo",
          "params": { "i": { "range": [1, "subjects_count"] } }
        }
      }
    },
    "balance": { "placeholder_centering": true }
  }
]
```

**Приоритеты**: правило `t-class-0-classphoto-and-halfs` (priority=110) срабатывает раньше базовых 100/90/80. Если есть и общее, и полкласса — выбирается новый мастер. Иначе — базовые.

#### 7.7.3. `subject-teachers` (правая страница при subjects≥9)

```json
{
  "id": "subject-teachers-3x3",
  "family_id": "subject-teachers",
  "priority": 100,
  "when": { "subjects_count": { "between": [9, 9] } },
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

**Решение spec'а 15.05** (по 🔴 каталога): при subjects ≥ 9 общие фото и полкласса **не используются** на учительском развороте — переходят в начало `common-section`.

#### 7.7.4. `student-section` density=standard

```json
[
  {
    "id": "student-section-standard-full",
    "family_id": "student-section",
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
        "studentquote_left": {
          "expr": "section.has_quote ? input.students[$current_student_index].quote : null"
        }
      },
      "E-Student-Standard-Right": {
        "studentportrait_right": "input.students[$current_student_index + 1].portrait",
        "studentname_right": "input.students[$current_student_index + 1].full_name",
        "studentquote_right": {
          "expr": "section.has_quote ? input.students[$current_student_index + 1].quote : null"
        }
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
                                             // (разворот со смешанными страницами)
    },
    "consumes": { "students": 1 }
  }
]
```

#### 7.7.5. `student-section` density=light: два пути

**Путь А — параметрический мастер** (если дизайнер сделал гибкий IDML):

```json
{
  "id": "student-section-light-adaptive-parametric",
  "family_id": "student-section",
  "priority": 100,
  "when": {
    "section.density": "light",
    "students_remaining": { "between": [1, 6] }
  },
  "produces": {
    "type": "page",
    "side": "left",
    "master": {
      "parametric": "L-Grid-Page",
      "params": {
        "grid_mode": "$expr: select_grid_mode(students_remaining)",
        "slot_count": "min(students_remaining, 6)"
      }
    }
  },
  "bind": {
    "L-Grid-Page": {
      "studentportrait_{i}": {
        "template": "input.students[$current_student_index + {i} - 1].portrait",
        "params": { "i": { "range": [1, "$slot_count"] } }
      }
    }
  },
  "consumes": { "students": "min(students_remaining, 6)" }
}
```

**Путь Б — N отдельных мастеров** (если дизайнер сделал отдельные IDML):

```json
[
  {
    "id": "student-section-light-1",
    "when": { "section.density": "light", "students_remaining": 1 },
    "produces": { "type": "page", "side": "left", "master": "L-Grid-1" },
    "consumes": { "students": 1 }
  },
  {
    "id": "student-section-light-2",
    "when": { "section.density": "light", "students_remaining": 2 },
    "produces": { "type": "page", "side": "left", "master": "L-Grid-2" },
    "consumes": { "students": 2 }
  }
  // ... для 3, 4, 5, 6
]
```

**Какой путь использовать**: алгоритм смотрит в БД — если есть мастер с `params.parametric=true` для нужной плотности → Путь А. Иначе → Путь Б. Парсер IDML принимает **оба** формата.

#### 7.7.6. `student-section` density=light overflow (>12 учеников)

```json
{
  "id": "student-section-light-overflow",
  "family_id": "student-section",
  "priority": 200,
  "when": {
    "section.density": "light",
    "students_remaining": { "gte": 13 }
  },
  "produces": {
    "type": "spread",
    "left_master": { "parametric": "L-Grid-Page", "params": { "slot_count": 6 } },
    "right_master": { "parametric": "L-Grid-Page", "params": { "slot_count": 6 } }
  },
  "consumes": { "students": 12 }
}
```

Каскад: при 17 учениках → overflow (12) → остаток 5 → adaptive (1 страница) + разворот со смешанными страницами (правая = common-section).

#### 7.7.7. `student-section` density=maximum (для Индивидуального)

```json
{
  "id": "student-section-maximum",
  "family_id": "student-section",
  "priority": 100,
  "when": {
    "section.density": "maximum",
    "students_remaining": { "gte": 1 }
  },
  "produces": {
    "type": "spread",
    "left_master": "E-Max-Left",
    "right_master": "E-Max-Right"
  },
  "bind": {
    "E-Max-Left": {
      "studentportrait": "input.students[$current_student_index].portrait",
      "studentname": "input.students[$current_student_index].full_name",
      "studentquote": {
        "expr": "section.has_quote ? input.students[$current_student_index].quote : null"
      }
    },
    "E-Max-Right": {
      "studentphoto_{i}": {
        "template": "input.students[$current_student_index].friend_photos[{i}-1]",
        "params": { "i": { "range": [1, "section.friend_photos_max"] } },
        "skip_if": "!section.has_friend_photos"
      }
    }
  },
  "consumes": { "students": 1 }
}
```

В Индивидуальном пресете правило применится **столько раз сколько учеников** — каждый получит свой двухстраничный разворот.

#### 7.7.8. `common-section`

```json
{
  "id": "common-half",
  "family_id": "common-section",
  "priority": 60,
  "when": { "common_photos.half_class.count": { "gte": 2 } },
  "produces": {
    "type": "page",
    "side": "any",
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

#### 7.7.9. `intro` (только soft)

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
    "side": "right",
    "master": "S-Intro"
  },
  "bind": {
    "S-Intro": { "classphotoframe": "input.common_photos.full_class[0]" }
  },
  "consumes": { "common_photos": { "full_class": 1 } }
}
```

#### 7.7.10. `final` (только soft)

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

---

## 8. Формат JSON-пресетов

### 8.1. Структура пресета

```typescript
type Preset = {
  id: string;
  display_name: string;
  print_type: 'layflat' | 'soft' | 'tryumo';
  pages_per_spread: number;                    // 2 (обычный) или 3 (трюмо)
  version: string;
  sections: Section[];
  parent_preset_id?: string;
  tenant_id: string | null;
};

type Section = {
  family_id: string;
  params?: {
    density?: 'maximum' | 'universal' | 'standard' | 'medium' | 'light' | 'mini';
    has_quote?: boolean;
    has_friend_photos?: boolean;
    friend_photos_max?: 2 | 3 | 4;
    portrait_source?: string;                  // в MVP всегда 'default'
  };
  enabled_when?: WhenClause;
  display_name?: string;
};
```

### 8.2. Условные секции

```json
{
  "id": "standard",
  "display_name": "Стандарт",
  "print_type": "layflat",
  "pages_per_spread": 2,
  "sections": [
    { "family_id": "intro", "enabled_when": { "print_type": "soft" } },
    { "family_id": "head-teacher" },
    { "family_id": "student-section", "params": { "density": "standard", "has_quote": true } },
    { "family_id": "common-section" },
    { "family_id": "final", "enabled_when": { "print_type": "soft" } }
  ]
}
```

### 8.3. Полные примеры базовых пресетов OkeyBook

#### 8.3.1. Стандарт (layflat)

```json
{
  "id": "standard",
  "display_name": "Стандарт",
  "print_type": "layflat",
  "pages_per_spread": 2,
  "version": "1.0",
  "sections": [
    { "family_id": "head-teacher" },
    { "family_id": "student-section", "params": { "density": "standard", "has_quote": true } },
    { "family_id": "common-section" }
  ]
}
```

#### 8.3.2. Универсал (layflat)

```json
{
  "id": "universal",
  "display_name": "Универсал",
  "print_type": "layflat",
  "pages_per_spread": 2,
  "version": "1.0",
  "sections": [
    { "family_id": "head-teacher" },
    { "family_id": "student-section", "params": { "density": "universal", "has_quote": true, "has_friend_photos": true, "friend_photos_max": 4 } },
    { "family_id": "common-section" }
  ]
}
```

#### 8.3.3. Максимум (layflat)

```json
{
  "id": "maximum",
  "display_name": "Максимум",
  "print_type": "layflat",
  "pages_per_spread": 2,
  "version": "1.0",
  "sections": [
    { "family_id": "head-teacher" },
    { "family_id": "student-section", "params": { "density": "maximum", "has_quote": true, "has_friend_photos": true, "friend_photos_max": 4 } },
    { "family_id": "common-section" }
  ]
}
```

#### 8.3.4. Индивидуальный (layflat) — НОВЫЙ в v1.1

```json
{
  "id": "individual",
  "display_name": "Индивидуальный",
  "print_type": "layflat",
  "pages_per_spread": 2,
  "version": "1.0",
  "sections": [
    { "family_id": "head-teacher" },
    {
      "family_id": "student-section",
      "display_name": "Основной раздел",
      "params": { "density": "maximum", "has_quote": true, "has_friend_photos": true, "friend_photos_max": 4 }
    },
    {
      "family_id": "student-section",
      "display_name": "Виньетка",
      "params": { "density": "mini" }
    },
    { "family_id": "common-section" }
  ]
}
```

**Здесь и реализуется** функция бывшего I-Personal: каждому ученику — отдельный разворот (density=maximum), в конце все ученики ещё раз мелко в виньетке. Точная практика OkeyBook.

#### 8.3.5. Мини (soft)

```json
{
  "id": "mini-soft",
  "display_name": "Мини",
  "print_type": "soft",
  "pages_per_spread": 2,
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

В Мини виньетка (density=mini) = **единственный** раздел учеников.

### 8.4. Редактирование партнёром

Партнёр в `/app` (фаза N или последующая) видит список пресетов своего тенанта + копии глобальных. Действия:
1. **Копировать глобальный** — создаётся `preset` с `parent_preset_id`, `tenant_id=<партнёр>`
2. **Редактировать** — менять порядок секций, добавлять/удалять, менять параметры
3. **Удалить** — soft delete

Партнёр НЕ может редактировать глобальные пресеты OkeyBook напрямую.

---

## 9. Алгоритм `buildFromRules`

### 9.1. Вход и выход

```typescript
function buildFromRules(input: AlbumInput, preset_id: string, tenant_id: string): AlbumLayout;

type AlbumLayout = {
  spreads: SpreadInstance[];
  decision_trace: DecisionTraceEntry[];
  rules_version: string;
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
  mixed_pages?: { left_rule_id: string; right_rule_id: string };
  inputs: Record<string, any>;
  balanced?: boolean;
};
```

### 9.2. Псевдокод

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
        pending_right_page: null,
        warnings: []
    }

    for section_index, section in enumerate(preset.sections):
        if section.enabled_when and not evaluateWhen(section.enabled_when, input, state):
            continue

        validateSectionParams(section, state.warnings)  // матрица §4.4

        family = loadFamily(section.family_id, tenant_id)
        rules = loadRules(family.id, family.version, tenant_id)

        section_complete = false
        while not section_complete:
            context = buildContext(input, state, section, section_index)
            applicable_rule = first(r for r in rules if evaluateWhen(r.when, context))
            if not applicable_rule:
                section_complete = true
                break

            variant = pickVariant(applicable_rule, context)
            spread_or_page = applyRule(variant, context, input)
            state.decision_trace.append({...})

            if spread_or_page.type == 'spread':
                state.spreads.append(spread_or_page)
            elif spread_or_page.type == 'page' and spread_or_page.side == 'left':
                state.pending_right_page = { spread_index: len(state.spreads) }
                state.spreads.append(new SpreadInstance(left=spread_or_page))
            elif spread_or_page.type == 'page' and spread_or_page.side == 'right':
                if state.pending_right_page:
                    state.spreads[state.pending_right_page.spread_index].right = spread_or_page
                    state.spreads[state.pending_right_page.spread_index].mixed_pages = true
                    state.pending_right_page = null
                else:
                    state.spreads.append(new SpreadInstance(right=spread_or_page))

            advanceCursors(state, variant.consumes, context)

            if no_data_consumed(variant, context):
                section_complete = true                 // защита от бесконечного цикла

    // Phase 1 balancing
    for spread in state.spreads:
        if spread.has_unfilled_placeholders:
            balance(spread)

    return { spreads, decision_trace, rules_version, preset_id, status, warnings }
```

### 9.3. Защита от бесконечного цикла

Если правило срабатывает, но **ничего не потребляет** (consumes=0) — секция останавливается с warning.

### 9.4. Обработка смешанных страниц

Когда секция X завершилась с `pending_right_page`:
1. Алгоритм переходит к секции X+1
2. Контекст содержит `prev_spread.right_page_empty = true`
3. Правила следующей секции (обычно common-section) учитывают это (priority повышен для `page-right` мастеров)
4. Первое сработавшее → его `produces` кладётся в `state.spreads[last].right`, `mixed_pages = true`

---

## 10. Балансировка paginate-aware

### 10.1. Phase 1 — локальная (MVP)

После применения правила, если мастер имеет N placeholder'ов, а данных оказалось M < N:
1. Применяет существующую функцию `balanceUnusedPlaceholders` из `lib/album-builder/balance.ts` (готово)
2. Скрывает «лишние» placeholder'ы с наибольшим `sort_order`
3. Симметрично центрирует оставшиеся

### 10.2. Phase 2 — проход оптимизации (после MVP)

Алгоритм ищет «плохие» развороты после генерации:
- Одинокие ученики в Standard
- Сильно неполные сетки
- Дыры в общем разделе

Реализуется как `optimizeLayout(layout, input, preset)` после основного прохода. **Не включается в MVP**.

### 10.3. Phase 3 — UI ручной правки

Уже реализовано в **фазе М** (12.05.2026). После rule engine добавляется фильтрация TemplatePickerModal по family_id.

---

## 11. Параметрические мастера vs N отдельных

### 11.1. Два пути

**Путь А — параметрический мастер**: один IDML с диапазоном допустимых сеток.
**Путь Б — N отдельных мастеров**: по одному IDML на каждое число учеников.

Архитектура поддерживает **оба** пути одновременно. Какой использовать — продуктовое решение, зависит от готовности дизайнера сделать «гибкий» мастер.

### 11.2. Путь А: параметрический мастер

Дизайнер делает **один** IDML с примером полного заполнения (например 4×3 = 12 портретов). В Script Label страницы указывает:
- `grid_modes_supported`: список ID режимов
- Эталонную геометрию ячейки
- Декоративные элементы

В БД:
```json
{
  "parametric": true,
  "grid_modes": [
    { "id": "1x1", "slot_count": 1, "rows": 1, "cols": 1 },
    { "id": "2x1", "slot_count": 2, "rows": 1, "cols": 2 },
    { "id": "3+3", "slot_count": 6, "rows": 2, "cols": 3 },
    { "id": "4+4+4", "slot_count": 12, "rows": 3, "cols": 4 }
  ],
  "slot_template": {
    "label_prefix": "studentportrait_",
    "size_mm": { "width": 35, "height": 50 },
    "spacing_mm": 5
  }
}
```

**Плюс**: ~11 файлов сэкономлено на каждой плотности.
**Минус**: дизайнер должен сделать гибкий IDML.

### 11.3. Путь Б: N отдельных мастеров

L-Grid-1.idml (1 ученик), L-Grid-2.idml (2 ученика), ..., L-Grid-6.idml (6 учеников). В БД — N строк `spread_templates` с фиксированной геометрией каждой.

**Плюс**: просто, надёжно.
**Минус**: больше работы, изменение стиля = править все N.

### 11.4. Выбор алгоритмом

1. Есть ли мастер с `params.parametric=true` для нужной семьи + density → использовать (Путь А)
2. Иначе — найти мастер с фиксированным `slot_count` → использовать (Путь Б)
3. Иначе — fallback на ближайший меньший + балансировка (Phase 1)

Парсер IDML принимает **оба** формата.

### 11.5. Кандидаты на параметризацию

| Параметрический мастер | Family | Density | Grid modes | Экономия |
|---|---|---|---|---|
| `L-Grid-Page` | student-section | light | 1×1 .. 3+3 (1..6) | 5 мастеров |
| `N-Grid-Page` | student-section | mini | 12 режимов (1..12) | 11 мастеров |
| `M-Grid-Page` | student-section | medium | 1×1 .. 2×2 (1..4) | 3 мастера |
| `G-Teachers-Grid` | subject-teachers | — | 3×3, 4×3, 4×4 | 2 мастера |

Итого экономия при Пути А для всех — **21 мастер** на серию.

---

## 12. Версионирование, миграции, кэш

### 12.1. `rules_version` для каждого альбома

```
preset:individual@1.0|head-teacher@1.0|subject-teachers@1.0|class-photo@1.0|student-section@1.0|common-section@1.0
```

При пересборке альбома используются **зафиксированные** версии, не текущие.

### 12.2. Изменение правила = новая версия семейства

OkeyBook меняет правило → новая версия `head-teacher@1.1`. Действия:
1. INSERT новых `rules` с `family_version='1.1'`
2. UPDATE `template_families.version`
3. Существующие альбомы помнят `head-teacher@1.0`
4. Новые альбомы используют `1.1`

### 12.3. Миграция альбомов

Опционально:
```sql
UPDATE album_layouts SET status='needs_rebuild' WHERE rules_version LIKE '%head-teacher@1.0%';
```

### 12.4. Aliases

```json
{ "id": "homeroom-section", "aliases": ["head-teacher"] }
```

### 12.5. Совместимость со старым `buildAlbum`

```typescript
export async function buildAlbum(input, options) {
  if (options.preset_id && hasRuleEnginePreset(options.preset_id)) {
    return buildFromRules(input, options.preset_id, options.tenant_id);
  }
  return buildFromMonolithic(input, options);
}
```

### 12.6. Кэш

`layout_cache.input_hash = SHA256(canonicalJson({ input, preset_id, rules_version }))`. TTL 7 дней.

---

## 13. План реализации

### РЭ.1. Миграция БД (один коммит)
- Создание таблиц `template_families`, `rules`, `presets`, `layout_cache`
- ALTER `spread_templates`, `album_layouts`, `children` (для `secondary_portraits`)
- `rule-engine-migration.sql`

### РЭ.2. Типы и Zod-схемы (один коммит)

### РЭ.3. Каталог JSON-файлов глобальных данных (один коммит)
- `docs/rule-engine-data/families/*.json` — 7 семейств
- `docs/rule-engine-data/rules/*.json`
- `docs/rule-engine-data/presets/*.json` — 7 базовых пресетов (Стандарт, Универсал, Максимум, **Индивидуальный**, Медиум, Лайт, Мини)
- `scripts/seed-rule-engine.ts`

### РЭ.4. Правила head-teacher + subject-teachers + class-photo (один коммит)
- Включая новое правило `t-class-0-classphoto-and-halfs` с F-Head-WithClassPhoto-L
- Variants для subjects=10..24
- Vitest

### РЭ.5. Правила student-section: maximum, universal, standard (один коммит)
- С поддержкой параметров секции (has_quote, has_friend_photos, friend_photos_max)
- Включая правила одинокого ученика (смешанные страницы)

### РЭ.6. Правила student-section: medium, light, mini + параметрические мастера (два коммита)
- РЭ.6.1: декларация параметрических мастеров в БД (поддержка Пути А)
- РЭ.6.2: правила выбора grid_mode + overflow + fallback на Путь Б

### РЭ.7. Правила common-section + intro + final (один коммит)

### РЭ.8. Базовые пресеты (один коммит)
- 7 пресетов в обеих печатях (layflat + soft через enabled_when)

### РЭ.9. `buildFromRules` — алгоритм (один коммит)
- `lib/rule-engine/build.ts`, `evaluate.ts`, `apply.ts`, `balance.ts`
- Валидация параметров секции (матрица §4.4)
- Интеграция с `lib/album-builder/index.ts` (фолбэк на старый)

### РЭ.10. Тесты vitest (~50 тестов, один коммит)

### РЭ.11. UI: TemplatePickerModal фильтрация по family_id (один коммит)

### РЭ.12. UI: Редактор пресетов (опционально, после запуска)

### РЭ.13. Документация и обновление контекста (один коммит)
- `yearbook-context-vN.md` → vN+1
- `designer-tz v1.3`
- README для `lib/rule-engine/`

**Оценка**: 10 коммитов основной работы. Скорость **2-3 коммита в неделю** → **3-5 недель** до MVP. С запасом до сентября — ОК.

---

## Приложение А: Решения spec'а

### А.1. T-Class subjects=9+, общие фото и полкласса
При subjects ≥ 9 общие фото и полкласса **не используются** на учительском развороте. Переходят в начало `common-section`.

### А.2. S-Intro для layflat
Нет S-Intro в layflat. Layflat начинается с учительского разворота.

### А.3. S-Final-Soft-L: какое фото
Дефолт — последнее `common_photos.full_class`. Fallback: первое `half_class`. Fallback: пустой placeholder.

### А.4. Виньетка
- В **Мини** пресете — единственный раздел учеников (density=mini)
- В **Индивидуальном** пресете — после основного раздела (density=maximum)
- В будущем возможна виньетка с детскими фото из садика (portrait_source='secondary_1') — структура заложена, не реализуется в MVP

### А.5. E-Maximum 4+ фото с друзьями
Warning + обрезка до 4. Партнёр в редакторе может добавить второй разворот вручную.

### А.6. E-Maximum-1 одинокий
Не нужен. Maximum применяется когда учеников много.

### А.7. Mini 25-30 overflow
В MVP — простой каскад. Phase 2 реализует «перераспределение с соседями».

### А.8. Medium 9+
Полные по 8 + остаток с балансировкой.

### А.9. I-Personal — удалено (v1.1)
Отдельное семейство НЕ создаётся. Функцию выполняет `student-section` с `density=maximum`. В пресете «Индивидуальный» две секции: maximum + mini (виньетка).

### А.10. Трюмо — заложено структурно (v1.1)
`print_type='tryumo'` + `pages_per_spread=3` зарезервированы. Реализация после MVP, требует расширения парсера и SpreadInstance до 3 страниц.

### А.11. Параметрические мастера — оба пути (v1.1)
Архитектура поддерживает и параметрический (один IDML с диапазоном), и N отдельных. Парсер принимает оба формата.

### А.12. F-Head-WithClassPhoto-L — новый мастер (v1.1)
Один новый одностраничный мастер (page-left, family=head-teacher) + правило `t-class-0-classphoto-and-halfs` с priority=110. G-HalfClass переиспользуется. Постраничная модель сохраняется.

### А.13. Серии мастеров (series_id) — заложено (v1.1)
Колонка `series_id` в БД есть, NULL по умолчанию. В MVP один глобальный комплект `okeybook-default`.

### А.14. Комбинированные мастера M/L/N-Combined-Page (v1.2, уточнено в v1.3)

**Проблема**: для density medium/light/mini при маленьком остатке учеников (1-2-3-4 шт) полная сетка `M/L/N-Grid-Page` выглядит сильно неполной даже после балансировки. Plus у партнёра часто есть общее фото класса которое некуда поставить. Postpage-модель v1.1 эту композицию не покрывала чисто — разворот со смешанными страницами (Grid слева + J-Full справа) не давал визуально цельной композиции.

**Решение**: добавлен отдельный продуктовый вид страницы — **Combined-мастера** для плотностей medium/light/mini:
- `M-Combined-Page` (medium): **2** портрета + 1 общее фото
- `L-Combined-Page` (light): **3** портрета + 1 общее фото
- `N-Combined-Page` (mini): **4** портрета + 1 общее фото

Это **отдельные** мастера со своей композицией, не «сетка минус слоты». Геометрия портретов в Combined отличается от Grid (другие размеры, другое расположение).

**Где НЕ применяются**: для Standard/Universal/Maximum (density max/universal/standard) комбинированные мастера НЕ добавляются. Одинокий ученик в этих плотностях обрабатывается классическим разворотом со смешанными страницами (E-* слева + J-* справа).

**Алгоритмическая интеграция**:
- В `spread_templates.params` добавлен флаг `has_class_photo_bottom: true` для комбинированных мастеров
- Константа `MAX_SLOTS_COMBINED` в `lib/rule-engine/`:
  ```typescript
  const MAX_SLOTS_COMBINED: Record<Density, number> = {
    medium: 2,
    light: 3,
    mini: 4,
  };
  ```
- Правило `student-section-combined` с priority выше базового срабатывает когда:
  - `section.density` ∈ {medium, light, mini}
  - `students_remaining <= MAX_SLOTS_COMBINED[density]`
  - `common_photos.full_class.count >= 1`
  → выбирает Combined-вариант, привязывает оставшихся учеников + одно общее фото, увеличивает счётчик потреблённых общих фото
- Если условие НЕ выполнено (остаток больше — например Light с 4-6 учениками) → срабатывает базовое правило с `L-Grid-Page` (полная или неполная сетка с балансировкой)

**Примеры**:

*Light с 7 учениками*: остаток 7 > 6 → левая страница `L-Grid-Page` 6 портретов (полная). Остаток 1 ≤ 3 + есть общее → правая `L-Combined-Page` 1 портрет + общее фото.

*Light с 9 учениками*: остаток 9 > 6 → левая `L-Grid-Page` 6. Остаток 3 ≤ 3 + есть общее → правая `L-Combined-Page` 3 + общее.

*Light с 4 учениками*: остаток 4 > 3 (превышает Combined) → левая `L-Grid-Page` 4 (неполная сетка с балансировкой), правая — общий раздел.

*Light с 3 учениками*: остаток 3 ≤ 3 + есть общее → одна страница `L-Combined-Page` 3 + общее, остаток 0 → переход к общему разделу.

**В UI**: при замене шаблона партнёр в `TemplatePickerModal` для страницы student-section видит оба варианта — `L-Grid-Page` и `L-Combined-Page`. Может переключаться вручную.

### А.15. Изменения меток после сверки с реальным IDML (v1.2)

- `G-HalfClass`: метки унифицированы как `halfphoto_1`, `halfphoto_2` (вместо `halfleftphoto`/`halfrightphoto`)
- `E-Max-Left`: убран `studentquote`, осталось только `studentportrait` + `studentname`
- `E-Max-Right`: добавлен `studentquote` (раньше был только список фото с друзьями)
- `E-Universal-Left` и `E-Universal-Right`: каждая страница — отдельный ученик со своими портретом+ФИО+цитатой+2 фото с друзьями. `capacity_per_spread = 2` остался прежним, но интерпретация изменилась (две независимые страницы, не одна спред-композиция)
- `G-Teachers-3x4` вместо `G-Teachers-4x3` (соответствует физической геометрии 3×4)
- `J-Quarter` разделён на `J-Quarter-Left` + `J-Quarter-Right`
- `J-Quote` удалён из MVP
- `S-Intro` сокращён до `classphotoframe` (для теста, метки `albumtitle`/`albumyear`/`schoolname` отложены)
- `M-Grid-Page` добавил `studentquote_N` (его в IDML 4 шт — у Medium есть цитаты в отличие от Light/Mini)

Правила в РЭ.4-РЭ.7 пишутся под актуальные имена и метки из ТЗ v1.4.

---

## Приложение Б: Глоссарий

| Термин | Значение |
|---|---|
| **Мастер** | Шаблон одной страницы IDML с placeholder'ами и декоративными элементами. `spread_templates`. |
| **Семейство (family)** | Группа мастеров одного назначения + правила. `template_families`. |
| **Пресет (preset)** | Комплектация = упорядоченный список секций. `presets`. |
| **Секция (section)** | Одно вхождение семейства в пресет с конкретными параметрами. |
| **Правило (rule)** | «При условиях X используй мастер Y, привяжи данные Z». `rules`. |
| **Density** | Параметр `student-section`. 6 значений: maximum, universal, standard, medium, light, mini. |
| **Page type** | Тип страницы мастера: page-left, page-right, page-any, spread. |
| **Серия мастеров (series)** | Комплект одного визуального стиля. Заложено в БД, не используется в MVP. |
| **Разворот со смешанными страницами** | Левая и правая страницы из разных семейств. Норма для нечётных в Standard и неполных сеток. Флаг `mixed_pages=true`. |
| **Параметрический мастер** | Один IDML с диапазоном grid_modes. Альтернатива: N отдельных. Оба пути поддерживаются. |
| **Variants** | Множественные правильные ответы. Default выбирает алгоритм, партнёр переключает в редакторе. |
| **Decision trace** | Лог решений алгоритма для каждого разворота. `album_layouts.decision_trace`. |
| **Rules version** | Snapshot версий семейств участвовавших в сборке. `album_layouts.rules_version`. |
| **Балансировка** | 3 фазы: locale (MVP), optimize (после), UI (фаза М). |
| **Параметры секции** | Опции в `Section.params`: density, has_quote, has_friend_photos, friend_photos_max, portrait_source. Матрица допустимости — §4.4. |
| **Трюмо (tryumo)** | Фотопапка из 3 створок. `print_type='tryumo'`, `pages_per_spread=3`. После MVP. |

---

**Конец спецификации v1.1.**

Следующий шаг: реализация подэтапов РЭ.1-РЭ.13 + параллельно ТЗ дизайнеру v1.3.
