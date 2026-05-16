# ТЗ дизайнеру: мастера для OkeyBook

**Версия:** 1.5
**Дата:** 16.05.2026

Один IDML-файл, все мастера внутри. Каждый мастер = **одна** master-страница в палитре Pages (постраничная модель). Имя master-страницы = имя мастера. Все placeholder'ы — `Window → Output → Script Label`. Метки **lowercase**, точное написание из словаря §3.

Размер страницы, шрифты, фоны, декор — на усмотрение дизайнера. Bleed 3 мм, CMYK.

**Изменения vs v1.4** (после сверки с присланным IDML «Белыи плотные разворотами1»): уточнены размеры сеток в Combined-мастерах. Это **не сетка-плюс-фото**, а отдельный продуктовый вид страницы для маленького остатка учеников: `M-Combined-Page` = 2 портрета, `L-Combined-Page` = 3 портрета, `N-Combined-Page` = 4 портрета. Все остальные пункты ТЗ v1.4 остаются.

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

### 2.10. Combined — Маленькая сетка + общее фото

**Назначение:** отдельный продуктовый вид страницы для случаев когда после раздела учеников остался **маленький** остаток (1..N), и у партнёра есть общее фото класса. Combined-страница содержит **меньшее** число портретов (свои меньшие размеры сетки) + одно общее фото внизу. Это **отдельный** мастер, не «обычная сетка минус слоты».

**Применяется только в плотностях `medium`, `light`, `mini`.** Для Standard/Universal/Maximum (E-*) комбинированные не нужны — остаток собирается через разворот со смешанными страницами (E-* слева + J-* справа).

| Имя мастера | density | Слотов портретов | Применяется когда остаток | page_type | Метки |
|---|---|---|---|---|---|
| `M-Combined-Page` | medium | 2 | 1-2 ученика | page-any | `studentportrait_1..2`, `classphotoframe` (photo); `studentname_1..2`, `studentquote_1..2` (text) |
| `L-Combined-Page` | light | 3 | 1-3 ученика | page-any | `studentportrait_1..3`, `classphotoframe` (photo); `studentname_1..3` (text) |
| `N-Combined-Page` | mini | 4 | 1-4 ученика | page-any | `studentportrait_1..4`, `classphotoframe` (photo); `studentname_1..4` (text) |

**Геометрия:** на усмотрение дизайнера. Портреты вверху, одно общее фото внизу, или другая компоновка — главное чтобы Combined-страница смотрелась как самостоятельная композиция, а не как обрезанная сетка.

**Параметрический:** число заполненных портретов меняется от 1 до максимума (M=2, L=3, N=4). При неполном заполнении балансировка скрывает лишние слоты сверху. `classphotoframe` остаётся всегда.

**Когда срабатывает в алгоритме:** правило `student-section` с приоритетом выше базового — если `students_remaining <= max_slots_combined[density]` + у партнёра есть хотя бы одно общее фото → выбирает Combined-вариант. Иначе → обычный `Grid-Page`.

**Пример Light, 7 учеников:** левая страница = `L-Grid-Page` с 6 портретами (полная сетка), правая страница = `L-Combined-Page` с 1 портретом + общее фото внизу.

**Пример Light, 9 учеников:** левая = `L-Grid-Page` 6, правая = `L-Combined-Page` 3 + общее.

**Пример Light, 4 учеников:** одна страница = `L-Combined-Page` 3 + общее, остаётся ещё 1 ученик → следующая страница `L-Combined-Page` 1 + общее (если есть второе общее фото) или `L-Grid-Page` с 1 портретом.

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
| Combined | 3 |
| **Всего** | **30** |
