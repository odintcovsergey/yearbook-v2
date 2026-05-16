# ТЗ дизайнеру: мастера для OkeyBook

**Версия:** 1.4
**Дата:** 16.05.2026

Один IDML-файл, все мастера внутри. Каждый мастер = **одна** master-страница в палитре Pages (постраничная модель). Имя master-страницы = имя мастера. Все placeholder'ы — `Window → Output → Script Label`. Метки **lowercase**, точное написание из словаря §3.

Размер страницы, шрифты, фоны, декор — на усмотрение дизайнера. Bleed 3 мм, CMYK.

**Изменения vs v1.3 (после сверки с присланным IDML «Белый плотные разворотами»):**
- `G-Teachers-4x3` → `G-Teachers-3x4` (соответствует физической сетке 3 ряда × 4 колонки)
- `J-Quarter` → разделён на `J-Quarter-Left` + `J-Quarter-Right`
- `J-Quote` — удалён из MVP (можно добавить позже)
- `G-HalfClass` метки: `halfphoto_1`, `halfphoto_2` (вместо `halfleftphoto`/`halfrightphoto`)
- `E-Max-Left`: убран `studentquote` (только `studentportrait`, `studentname`)
- `E-Max-Right`: добавлен `studentquote` (был только фото с друзьями)
- `E-Universal-Left` и `E-Universal-Right`: каждая страница — **отдельный ученик** со своими портретом, ФИО, цитатой и 2 фото с друзьями (capacity_per_spread = 2)
- `F-Head-LargeGrid`, `G-Teachers-*`: добавлены `teachername_N` + `teacherrole_N` к каждому слоту
- `S-Intro`: метки сокращены до `classphotoframe` (для теста)
- **НОВОЕ: 3 комбинированных мастера** `M-Combined-Page`, `L-Combined-Page`, `N-Combined-Page` (см. §2.10)

---

## 1. Соответствие префикса семейству

| Префикс | Семейство | page_type по умолчанию |
|---|---|---|
| `F-` | head-teacher | page-left (layflat) / page-any (soft) |
| `G-` (Teachers) | subject-teachers | page-right |
| `G-` (Class/Half) | class-photo | page-right или page-any |
| `E-` | student-section (maximum/universal/standard) | page-left / page-right |
| `M-` | student-section, density=medium | page-any |
| `L-` | student-section, density=light | page-any |
| `N-` | student-section, density=mini (виньетка) | page-any |
| `J-` | common-section | page-any (или spread) |
| `S-Intro` | intro (только soft) | page-right |
| `S-Final` | final (только soft) | page-left |

---

## 2. Список мастеров

### 2.1. F — Учительская страница с классруком (head-teacher)

| Имя мастера | page_type | Метки |
|---|---|---|
| `F-Head-WithPhoto` | page-any | `headteacherphoto` (photo); `headteachername`, `headteacherrole`, `headtextframe` (text) |
| `F-Head-SmallGrid` | page-any | `headteacherphoto`, `teacherphoto_1..4` (photo); `headteachername`, `headteacherrole`, `headtextframe`, `teachername_1..4`, `teacherrole_1..4` (text) |
| `F-Head-LargeGrid` | page-any | `headteacherphoto`, `teacherphoto_1..8` (photo); `headteachername`, `headteacherrole`, `headtextframe`, `teachername_1..8`, `teacherrole_1..8` (text) |
| `F-Head-WithClassPhoto-L` | page-left | `headteacherphoto`, `classphotoframe` (photo); `headteachername`, `headteacherrole`, `headtextframe` (text) |

### 2.2. G — Учителя-предметники (subject-teachers)

| Имя мастера | page_type | Метки |
|---|---|---|
| `G-Teachers-3x3` | page-right | `teacherphoto_1..9` (photo); `teachername_1..9`, `teacherrole_1..9` (text) |
| `G-Teachers-3x4` | page-right | `teacherphoto_1..12` (photo); `teachername_1..12`, `teacherrole_1..12` (text) |
| `G-Teachers-4x4` | page-right | `teacherphoto_1..16` (photo); `teachername_1..16`, `teacherrole_1..16` (text) |

### 2.3. G — Общие фото (class-photo)

| Имя мастера | page_type | Метки |
|---|---|---|
| `G-FullClass` | page-any | `classphotoframe` |
| `G-HalfClass` | page-any | `halfphoto_1`, `halfphoto_2` |

### 2.4. E — Личный раздел (student-section, плотности maximum/universal/standard)

В Universal каждая страница содержит **отдельного** ученика со своими портретом, ФИО, цитатой и 2 фото с друзьями. capacity_per_spread = 2.

| Имя мастера | density | page_type | Метки |
|---|---|---|---|
| `E-Max-Left` | maximum | page-left | `studentportrait` (photo); `studentname` (text) |
| `E-Max-Right` | maximum | page-right | `studentphoto_1..4` (photo, фото с друзьями); `studentquote` (text) |
| `E-Universal-Left` | universal | page-left | `studentportrait`, `studentphoto_1..2` (photo); `studentname`, `studentquote` (text) |
| `E-Universal-Right` | universal | page-right | `studentportrait`, `studentphoto_1..2` (photo); `studentname`, `studentquote` (text) |
| `E-Standard-Left` | standard | page-left | `studentportrait` (photo); `studentname`, `studentquote` (text) |
| `E-Standard-Right` | standard | page-right | `studentportrait` (photo); `studentname`, `studentquote` (text) |

### 2.5. M — Сетка Medium (student-section, density=medium)

Параметрический мастер (один IDML с диапазоном 1..4 слотов, балансировка скрывает лишние).

| Имя мастера | page_type | Метки |
|---|---|---|
| `M-Grid-Page` | page-any | `studentportrait_1..4` (photo); `studentname_1..4`, `studentquote_1..4` (text) |

### 2.6. L — Сетка Light (student-section, density=light)

Параметрический мастер (один IDML с диапазоном 1..6 слотов).

| Имя мастера | page_type | Метки |
|---|---|---|
| `L-Grid-Page` | page-any | `studentportrait_1..6` (photo); `studentname_1..6` (text) |

### 2.7. N — Сетка Mini / виньетка (student-section, density=mini)

Параметрический мастер (один IDML с диапазоном 1..12 слотов).

| Имя мастера | page_type | Метки |
|---|---|---|
| `N-Grid-Page` | page-any | `studentportrait_1..12` (photo); `studentname_1..12` (text) |

### 2.8. J — Общий раздел (common-section)

| Имя мастера | page_type | Метки |
|---|---|---|
| `J-Spread` | spread | `spreadphoto` (photo) |
| `J-Full` | page-any | `classphotoframe` (photo) |
| `J-Half` | page-any | `halfphoto_1`, `halfphoto_2` (photo) |
| `J-Quarter-Left` | page-left | `quarterphoto_1`, `quarterphoto_2` (photo) |
| `J-Quarter-Right` | page-right | `quarterphoto_1`, `quarterphoto_2` (photo) |
| `J-Collage-4` | page-any | `collagephoto_1..4` (photo) |
| `J-Collage-6` | page-any | `collagephoto_1..6` (photo) |

### 2.9. S — Заглавный и финальный (только soft)

| Имя мастера | page_type | Метки |
|---|---|---|
| `S-Intro` | page-right | `classphotoframe` (photo) |
| `S-Final-Soft-L` | page-left | `classphotoframe` (photo); `finaltext` (text) |

### 2.10. Combined — Сетка + общее фото (НОВОЕ в v1.4)

**Назначение:** когда после раздела учеников остался хвост, который не помещается в полную сетку — комбинированный мастер показывает портреты сверху + одно общее фото снизу. Используется когда у партнёра есть общее фото класса и оставшихся учеников меньше полной сетки. Используются ВМЕСТО обычных `L-Grid-Page`/`N-Grid-Page`/`M-Grid-Page` в момент когда применимы (правило выберет автоматически).

**Применяется только в плотностях `medium`, `light`, `mini`.** Для Standard/Universal/Maximum (E-*) — НЕ нужны: остаток собирается через разворот со смешанными страницами (E-* слева + J-* справа).

| Имя мастера | density | page_type | Метки |
|---|---|---|---|
| `M-Combined-Page` | medium | page-any | `studentportrait_1..4`, `classphotoframe` (photo); `studentname_1..4`, `studentquote_1..4` (text) |
| `L-Combined-Page` | light | page-any | `studentportrait_1..6`, `classphotoframe` (photo); `studentname_1..6` (text) |
| `N-Combined-Page` | mini | page-any | `studentportrait_1..12`, `classphotoframe` (photo); `studentname_1..12` (text) |

**Геометрия:** портреты вверху страницы (та же сетка что в обычном `M/L/N-Grid-Page`), одно общее фото снизу (`classphotoframe`). Дизайнер задаёт пропорции: примерно 70% высоты — сетка портретов, 30% — общее фото с подписью или без (на усмотрение дизайнера).

**Параметрический:** число заполненных портретов меняется (как в обычных Grid-Page). При неполном заполнении балансировка скрывает лишние слоты в сетке портретов сверху, `classphotoframe` остаётся всегда.

**Пример использования:** Light, 9 учеников. Левая страница = обычный `L-Grid-Page` с 6 портретами (полная сетка). Правая страница = `L-Combined-Page` с 3 портретами вверху + 1 общее фото внизу.

---

## 3. Словарь меток

### 3.1. Учителя

| Метка | Тип | Содержимое |
|---|---|---|
| `headteacherphoto` | photo | Фото классного руководителя |
| `headteachername` | text | ФИО классного руководителя |
| `headteacherrole` | text | Должность классного руководителя |
| `headtextframe` | text | Приветственный текст классного руководителя |
| `teacherphoto_N` | photo | Фото предметника N |
| `teachername_N` | text | ФИО предметника N |
| `teacherrole_N` | text | Должность предметника N |

### 3.2. Ученики

| Метка | Тип | Содержимое |
|---|---|---|
| `studentportrait` | photo | Основной портрет ученика (для E-Max-Left, E-Universal-Left/Right, E-Standard-Left/Right) |
| `studentportrait_N` | photo | Основной портрет ученика N в сетке (для M/L/N-Grid-Page и M/L/N-Combined-Page) |
| `studentname` | text | ФИО ученика (для E-* без _N) |
| `studentname_N` | text | ФИО ученика N в сетке (для M/L/N) |
| `studentquote` | text | Цитата ученика. На E-Max-Right (НЕ на Left), E-Universal-Left и -Right, E-Standard-Left и -Right |
| `studentquote_N` | text | Цитата ученика N в сетке (только M-Grid-Page и M-Combined-Page) |
| `studentphoto_N` | photo | Фото с друзьями. На E-Max-Right: 4 шт. На E-Universal-Left и -Right: 2 шт (своему ученику страницы) |

### 3.3. Общие фото

| Метка | Тип | Содержимое |
|---|---|---|
| `classphotoframe` | photo | Общее фото класса. Используется на G-FullClass, J-Full, F-Head-WithClassPhoto-L, S-Intro, S-Final-Soft-L, M/L/N-Combined-Page |
| `halfphoto_N` | photo | Фото половины класса. На G-HalfClass — 2 шт. На J-Half — 2 шт |
| `quarterphoto_N` | photo | Фото четверти класса (J-Quarter-Left/Right, по 2 на странице) |
| `collagephoto_N` | photo | Фото в коллаже (J-Collage-4/6) |
| `spreadphoto` | photo | Одно фото через весь разворот (J-Spread) |

### 3.4. Финальный

| Метка | Тип | Содержимое |
|---|---|---|
| `finaltext` | text | Прощальный текст на S-Final-Soft-L |

---

## 4. Сводка

| Категория | Мастеров |
|---|---|
| F (head-teacher) | 4 |
| G (subject-teachers) | 3 |
| G (class-photo) | 2 |
| E (student-section max/univ/std) | 6 |
| M (medium) | 1 |
| L (light) | 1 |
| N (mini / виньетка) | 1 |
| J (common-section) | 7 |
| S (intro/final) | 2 |
| **Combined (новое в v1.4)** | **3** |
| **Всего** | **30** |
