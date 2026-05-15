# ТЗ дизайнеру: мастера для OkeyBook

**Версия:** 1.3
**Дата:** 15.05.2026

Один IDML-файл, все мастера внутри. Каждый мастер = **одна** master-страница в палитре Pages (постраничная модель). Имя master-страницы = имя мастера. Все placeholder'ы — `Window → Output → Script Label`. Метки **lowercase**, точное написание из словаря §3.

Размер страницы, шрифты, фоны, декор — на усмотрение дизайнера. Bleed 3 мм, CMYK.

---

## 1. Соответствие префикса семейству

| Префикс | Семейство | page_type по умолчанию |
|---|---|---|
| `F-` | head-teacher | page-left (layflat) / page-any (soft) |
| `G-` (Teachers) | subject-teachers | page-right |
| `G-` (Class/Half) | class-photo | page-right или page-any |
| `E-` | student-section (maximum/universal/standard) | page-left / page-right / page-any |
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
| `F-Head-WithPhoto` | page-any | `headteacherphoto`, `headteachername`, `headteacherrole`, `headtextframe` |
| `F-Head-SmallGrid` | page-any | `headteacherphoto`, `headteachername`, `headteacherrole`, `headtextframe`, `teacherphoto_1..4`, `teachername_1..4`, `teacherrole_1..4` |
| `F-Head-LargeGrid` | page-any | `headteacherphoto`, `headteachername`, `headteacherrole`, `headtextframe`, `teacherphoto_1..8`, `teachername_1..8`, `teacherrole_1..8` |
| `F-Head-WithClassPhoto-L` | page-left | `headteacherphoto`, `headteachername`, `headteacherrole`, `headtextframe`, `classphotoframe` |

### 2.2. G — Учителя-предметники (subject-teachers)

| Имя мастера | page_type | Метки |
|---|---|---|
| `G-Teachers-3x3` | page-right | `teacherphoto_1..9`, `teachername_1..9`, `teacherrole_1..9` |
| `G-Teachers-4x3` | page-right | `teacherphoto_1..12`, `teachername_1..12`, `teacherrole_1..12` |
| `G-Teachers-4x4` | page-right | `teacherphoto_1..16`, `teachername_1..16`, `teacherrole_1..16` |

### 2.3. G — Общие фото (class-photo)

| Имя мастера | page_type | Метки |
|---|---|---|
| `G-FullClass` | page-any | `classphotoframe` |
| `G-HalfClass` | page-any | `halfleftphoto`, `halfrightphoto` |

### 2.4. E — Личный раздел (student-section, плотности maximum/universal/standard)

| Имя мастера | density | page_type | Метки |
|---|---|---|---|
| `E-Max-Left` | maximum | page-left | `studentportrait`, `studentname`, `studentquote` |
| `E-Max-Right` | maximum | page-right | `studentphoto_1..4` (фото с друзьями) |
| `E-Universal-Left` | universal | page-left | `studentportrait`, `studentname`, `studentquote`, `studentphoto_1..4` |
| `E-Universal-Right` | universal | page-right | `studentportrait`, `studentname`, `studentquote`, `studentphoto_1..4` |
| `E-Standard-Left` | standard | page-left | `studentportrait`, `studentname`, `studentquote` |
| `E-Standard-Right` | standard | page-right | `studentportrait`, `studentname`, `studentquote` |

### 2.5. M — Сетка Medium (student-section, density=medium)

Один из двух путей (на выбор). Решить с Сергеем.

**Путь А — параметрический (1 мастер):**

| Имя мастера | page_type | Метки | grid_modes |
|---|---|---|---|
| `M-Grid-Page` | page-any | `studentportrait_1..4`, `studentname_1..4` | 1×1, 2×1, 3×1, 2×2 |

**Путь Б — отдельные мастера (4 мастера):**

| Имя мастера | page_type | Метки |
|---|---|---|
| `M-Grid-1` | page-any | `studentportrait_1`, `studentname_1` |
| `M-Grid-2` | page-any | `studentportrait_1..2`, `studentname_1..2` |
| `M-Grid-3` | page-any | `studentportrait_1..3`, `studentname_1..3` |
| `M-Grid-4` | page-any | `studentportrait_1..4`, `studentname_1..4` |

### 2.6. L — Сетка Light (student-section, density=light)

**Путь А — параметрический (1 мастер):**

| Имя мастера | page_type | Метки | grid_modes |
|---|---|---|---|
| `L-Grid-Page` | page-any | `studentportrait_1..6`, `studentname_1..6` | 1×1, 2×1, 3×1, 2×2, 3+2, 3×2 |

**Путь Б — отдельные мастера (6 мастеров):**

| Имя мастера | page_type | Метки |
|---|---|---|
| `L-Grid-1` | page-any | `studentportrait_1`, `studentname_1` |
| `L-Grid-2` | page-any | `studentportrait_1..2`, `studentname_1..2` |
| `L-Grid-3` | page-any | `studentportrait_1..3`, `studentname_1..3` |
| `L-Grid-4` | page-any | `studentportrait_1..4`, `studentname_1..4` |
| `L-Grid-5` | page-any | `studentportrait_1..5`, `studentname_1..5` |
| `L-Grid-6` | page-any | `studentportrait_1..6`, `studentname_1..6` |

### 2.7. N — Сетка Mini / виньетка (student-section, density=mini)

**Путь А — параметрический (1 мастер):**

| Имя мастера | page_type | Метки | grid_modes |
|---|---|---|---|
| `N-Grid-Page` | page-any | `studentportrait_1..12`, `studentname_1..12` | 1×1 … 4×3 (12 режимов) |

**Путь Б — отдельные мастера (12 мастеров):**

| Имя мастера | page_type | Метки |
|---|---|---|
| `N-Grid-1` | page-any | `studentportrait_1`, `studentname_1` |
| `N-Grid-2` | page-any | `studentportrait_1..2`, `studentname_1..2` |
| `N-Grid-3` | page-any | `studentportrait_1..3`, `studentname_1..3` |
| `N-Grid-4` | page-any | `studentportrait_1..4`, `studentname_1..4` |
| `N-Grid-5` | page-any | `studentportrait_1..5`, `studentname_1..5` |
| `N-Grid-6` | page-any | `studentportrait_1..6`, `studentname_1..6` |
| `N-Grid-7` | page-any | `studentportrait_1..7`, `studentname_1..7` |
| `N-Grid-8` | page-any | `studentportrait_1..8`, `studentname_1..8` |
| `N-Grid-9` | page-any | `studentportrait_1..9`, `studentname_1..9` |
| `N-Grid-10` | page-any | `studentportrait_1..10`, `studentname_1..10` |
| `N-Grid-11` | page-any | `studentportrait_1..11`, `studentname_1..11` |
| `N-Grid-12` | page-any | `studentportrait_1..12`, `studentname_1..12` |

### 2.8. J — Общий раздел (common-section)

| Имя мастера | page_type | Метки |
|---|---|---|
| `J-Spread` | spread | `spreadphoto` |
| `J-Full` | page-any | `classphotoframe` |
| `J-Half` | page-any | `halfphoto_1`, `halfphoto_2` |
| `J-Quarter` | page-any | `quarterphoto_1..4` |
| `J-Collage-4` | page-any | `collagephoto_1..4` |
| `J-Collage-6` | page-any | `collagephoto_1..6` |
| `J-Quote` | page-any | `classphotoframe`, `commoncaption` |

### 2.9. S — Заглавный и финальный (только soft)

| Имя мастера | page_type | Метки |
|---|---|---|
| `S-Intro` | page-right | `albumtitle`, `albumyear`, `schoolname`, `classphotoframe` |
| `S-Final-Soft-L` | page-left | `finaltext`, `classphotoframe` |

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
| `studentportrait` | photo | Основной портрет ученика (для E-Max, E-Universal) |
| `studentportrait_N` | photo | Основной портрет ученика N в сетке (для M/L/N) |
| `studentname` | text | ФИО ученика |
| `studentname_N` | text | ФИО ученика N в сетке |
| `studentquote` | text | Цитата ученика |
| `studentphoto_N` | photo | Фото с друзьями (от 1 до 4 на одного ученика в Maximum/Universal) |

### 3.3. Общие фото

| Метка | Тип | Содержимое |
|---|---|---|
| `classphotoframe` | photo | Общее фото класса |
| `halfleftphoto` | photo | Фото половины класса (левая) |
| `halfrightphoto` | photo | Фото половины класса (правая) |
| `halfphoto_N` | photo | Фото половины класса (на J-Half, 2 штуки) |
| `quarterphoto_N` | photo | Фото четверти класса (на J-Quarter, 4 штуки) |
| `collagephoto_N` | photo | Фото в коллаже (на J-Collage-N) |
| `spreadphoto` | photo | Одно фото через весь разворот (на J-Spread) |
| `commoncaption` | text | Подпись / цитата к общему фото (на J-Quote) |

### 3.4. Заглавный / финальный

| Метка | Тип | Содержимое |
|---|---|---|
| `albumtitle` | text | Название альбома |
| `albumyear` | text | Год выпуска |
| `schoolname` | text | Название школы |
| `finaltext` | text | Прощальный текст |

---

## 4. Сводка

| Категория | Путь А (параметр.) | Путь Б (отдельные) |
|---|---|---|
| F (head-teacher) | 4 | 4 |
| G (subject-teachers) | 1 (G-Teachers-Grid 9/12/16) | 3 |
| G (class-photo) | 2 | 2 |
| E (student-section max/univ/std) | 6 | 6 |
| M (medium) | 1 | 4 |
| L (light) | 1 | 6 |
| N (mini / виньетка) | 1 | 12 |
| J (common-section) | 7 | 7 |
| S (intro/final) | 2 | 2 |
| **Всего** | **~25** | **~46** |

Параметрический путь — один IDML с диапазоном слотов и метаданными `grid_modes` в Script Label страницы. Отдельные мастера — один IDML на каждое число слотов. На выбор с Сергеем.
