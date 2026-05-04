# IDML Reconnaissance — «Плотные Мастер Белый»

**Дата:** 04.05.2026
**Файл:** `docs/templates/Плотные Мастер Белый.idml`
**Цель:** разведка структуры IDML до старта парсера (фаза 0, шаг 0.1.5).
**Статус:** решения по всем расхождениям зафиксированы Сергеем (см. §5, §7, §9).

---

## 1. Метаданные документа (Resources/Preferences.xml)

| Параметр | pt | mm |
|---|---|---|
| `PageWidth` | 640.6299212598426 | **226.0** |
| `PageHeight` | 816.3779527559055 | **288.0** |
| `DocumentBleedTopOffset` и т.д. | 0 | 0 |

Прочее:
- `FacingPages = "true"` — facing-pages (развороты включены).
- `PageBinding = "LeftToRight"` — корешок слева, страницы справа.
- `HorizontalMeasurementUnits = "Millimeters"` — для линейки в InDesign (на парсер не влияет, всё в pt).
- `VerticalMeasurementUnits = "Millimeters"`.
- `PointsPerInch = 72` → 1 mm = 2.83464566929 pt (используем как константу).
- **`RulerOrigin = "SpreadOrigin"`** — линейка отсчитывается от origin'а спреда. Это совпадает с фактической координатной системой (см. §3).
- Никаких bleed/slug в этом шаблоне (всё нули). В фазе 1 при добавлении других шаблонов учитываем, что `bleed_mm` может быть >0.

---

## 2. Полный список master-страниц (39 шт)

Группировка по префиксу:

### E — student (8 мастеров)

| Name | Pages | Rect | Oval | TF | Labels | Назначение |
|---|---|---|---|---|---|---|
| E-Ind-Right-3 | 1 | 3 | 0 | 0 | 3 | Правая страница ребёнка для **Индивидуальной** (детский сад): 3 фото с друзьями |
| E-Max-Left | 1 | 1 | 0 | 1 | 2 | Максимум: левая страница, портрет + имя |
| E-Max-Right | 1 | 4 | 0 | 1 | 5 | Максимум: правая страница, 4 фото + цитата |
| E-Student-Default | **2** | 6 | 0 | 4 | 10 | Универсал (разворот на 2 учеников): портрет + имя + цитата + 2 фото с друзьями ×2 |
| E-Student-Left | 1 | 3 | 0 | 2 | 5 | Универсал: левая страница 1 ученика (портрет + имя + цитата + 2 фото) |
| E-Student-Right | 1 | 3 | 0 | 2 | 5 | Универсал: правая страница 1 ученика |
| E-Student-Standard | **2** | 2 | 0 | 4 | 6 | Стандарт (разворот на 2 учеников): портрет + имя + цитата ×2 |

### D — student / Медиум (3 мастера)

| Name | Pages | Rect | Oval | TF | Labels | Назначение |
|---|---|---|---|---|---|---|
| D-Medium-Left | 1 | 4 | 0 | 8 | 12 | Сетка 2×2 на 4 учеников (портрет + имя + цитата) |
| D-Medium-Right | 1 | 4 | 0 | 8 | 12 | То же, зеркальная для правой страницы |
| D-Medium-Last-WithPhoto | 1 | 3 | 0 | 4 | 7 | Последняя страница: 2 ученика + общее фото класса |

### F — head_teacher / левая страница учительского разворота (6)

| Name | Ovals | Labels | Назначение |
|---|---|---|---|
| F-Head-WithPhoto | 0 | 5 | Классрук + общее фото (нет предметников); подходит для subjects=0 и 9-16 |
| F-Head-WithPhoto-R | 0 | 5 | Зеркальная (правая) |
| F-Head-SmallGrid | **4** | 16 | Классрук + 4 предметника (подходит для subjects 1-4) |
| F-Head-SmallGrid-R | **4** | 16 | Зеркальная |
| F-Head-LargeGrid | **8** | 28 | Классрук + 8 предметников (subjects 5-8 или 17-24) |
| F-Head-LargeGrid-R | **8** | 28 | Зеркальная |

### G — subjects/group / правая страница учительского разворота (5)

| Name | Ovals | Rect | Labels | Назначение |
|---|---|---|---|---|
| G-FullClass | 0 | 1 | 1 | Большое общее фото (`classPhotoFrame`) |
| G-HalfClass | 0 | 2 | 2 | 2 половины класса (`halfLeftPhoto`, `halfRightPhoto`) |
| G-Teachers-3x3 | **9** | 0 | 27 | 9 предметников (для subjects=9) |
| G-Teachers-4x3 | **12** | 0 | 36 | 12 предметников (для subjects 10-12) |
| G-Teachers-4x4 | **16** | 0 | 48 | 16 предметников (для subjects 13-16 и 17-24) |

### J — common / общий раздел (8)

> **В алгоритм buildAlbum фазы 0 не входят** (см. §9). Импортируются в БД, доступны в редакторе фаз 2-4.

| Name | Pages | Rect | Labels | Назначение |
|---|---|---|---|---|
| J-Half | 1 | 2 | 2 | 2 фото полкласса на странице (`halfPhoto_1/2`) |
| J-Quarter | 1 | 2 | 2 | 2 фото четверти класса (нет `-Right` версии) |
| J-HalfSixth | **2** | 8 | 8 | Разворот: 2 полкласса + 6 фото ⅙ |
| J-SixthSixth | **2** | 12 | 12 | Разворот: 12 фото ⅙ (по 6 на стр) |
| J-SixthFull | **2** | 7 | 7 | Разворот: 6 фото ⅙ + 1 общее фото |
| J-ClassPhoto | 1 | 1 | 1 | Большое общее фото на странице (левая) |
| J-ClassPhoto-Right | 1 | 1 | 1 | То же, правая страница |
| J-Collage | 1 | 6 | 6 | 6 фото коллажа (collagePhoto_1..6, нет `-Right` версии) |

### L — light/Лайт (5)

| Name | Rect | TF | Labels | Назначение |
|---|---|---|---|---|
| L-6-Left | 6 | 6 | 12 | 6 учеников на странице (портрет + имя), левая |
| L-6-Right | 6 | 6 | 12 | То же, правая |
| L-6-Last | 4 | 3 | 7 | Последняя страница: 3 ученика + общее фото |
| L-Overflow-Row | 4 | 3 | 7 | Доп.ряд: 3 ученика + общее фото |
| L-Overflow-Row-Right | 4 | 3 | 7 | Зеркальный |

### N — mini/Мини (3)

| Name | Rect | TF | Labels | Назначение |
|---|---|---|---|---|
| N-12-Left | 12 | 12 | 24 | 12 учеников на странице (портрет + имя), левая |
| N-12-Right | 12 | 12 | 24 | То же, правая |
| N-Overflow-Row | 5 | 4 | 9 | Доп.ряд: 4 ученика + общее фото |

### S — intro (2)

| Name | Pages | Labels | Назначение |
|---|---|---|---|
| S-Intro | 1 | 1 | Вступительная страница для soft-альбомов; единственный label — `classPhotoFrame` |
| S-Intro-Old | **2** | 1 | Legacy-вариант, 2 страницы; единственный label — `classPhotoFrame` |

**Итого: 7+3+6+5+8+5+3+2 = 39 мастеров.** Из них 6 двухстраничных: `E-Student-Default`, `E-Student-Standard`, `J-HalfSixth`, `J-SixthFull`, `J-SixthSixth`, `S-Intro-Old`.

---

## 3. Координатная система

### Откуда отсчитываются координаты

InDesign IDML хранит позиции в системе **спреда**, начало координат — **центр спреда** (для facing-pages с PageBinding=LeftToRight). Это подтверждается ItemTransform у `<Page>`:

| Тип мастера | Pages | Page1.ItemTransform | Page2.ItemTransform | Spread upper-left |
|---|---|---|---|---|
| Одностраничный | 1 | `1 0 0 1 -320.31 -408.19` (= -PW/2, -PH/2) | — | (-PW/2, -PH/2) |
| Двухстраничный (стандартный) | 2 | `1 0 0 1 -640.63 -408.19` (= -PW, -PH/2) | `1 0 0 1 0 -408.19` | (-PW, -PH/2) |
| `E-Student-Default` (нестандартный) | 2 | `1 0 0 1 -1179.21 -419.53` | `1 0 0 1 ~0 -419.53` | (-1179.21, -419.53) |

**Вывод для парсера:** не предполагаем фиксированный offset «-spread_width/2». Берём `(tx, ty)` напрямую из самого левого `<Page>.ItemTransform` — это и есть координаты верхнего-левого угла спреда. Для `E-Student-Default` `Page.GeometricBounds` даёт top=11.34 (а не 0), что и отражается в `ty=-419.53`. Парсер должен это безопасно обрабатывать.

### Формула преобразования

Для каждого фрейма (Rectangle/Oval/TextFrame):

```
ItemTransform: a b c d tx ty   (аффинная матрица 2x3)
PathPointType.Anchor: (x_local, y_local)

x_world_pt = a * x_local + c * y_local + tx
y_world_pt = b * x_local + d * y_local + ty
```

После применения трансформации к 4 углам берём `min/max` → получаем bounding box в координатах спреда (в pt). Затем:

```
x_norm_pt = x_min - spread_origin_x      (где spread_origin_x = leftmost Page.ItemTransform.tx)
y_norm_pt = y_min - spread_origin_y      (где spread_origin_y = leftmost Page.ItemTransform.ty)
width_pt  = x_max - x_min
height_pt = y_max - y_min

→ делим на 2.83464566929 → получаем mm
```

### Эмпирическая проверка (E-Student-Left, фрейм studentPortrait)

```
ItemTransform="1 0 0 1 355.844409 -95.338582"
Anchors:
  (-647.104, -227.811)
  (-647.104,  228.567)
  (-321.120,  228.567)
  (-321.120, -227.811)

После трансформации (a=d=1, b=c=0 → просто +tx, +ty):
  (-291.260, -323.149)
  (-291.260,  133.229)
  (  34.724,  133.229)
  (  34.724, -323.149)

bbox в spread coords:
  min=(-291.260, -323.149), max=(34.724, 133.229)
  width  = 325.984 pt = 115.000 mm
  height = 456.378 pt = 161.000 mm

Page.ItemTransform="1 0 0 1 -320.31496 -408.18898" → spread origin = (-320.315, -408.189)

Нормализация:
  x_norm = -291.260 - (-320.315) =  29.055 pt =  10.249 mm
  y_norm = -323.149 - (-408.189) =  85.040 pt =  30.000 mm
```

→ **studentPortrait = 10.25 × 30.00 mm, размер 115 × 161 mm** (полностью укладывается в страницу 226×288 mm с 10мм-отступом слева, как и задумано).

---

## 4. Реальные имена плейсхолдеров (полный словарь)

### Ученические
- `studentPortrait`, `studentName`, `studentQuote` (для E-Student-Left/Right/Default/Standard, E-Max-Left)
- `studentPortrait_1..12`, `studentName_1..12`, `studentQuote_1..4` (для D-Medium-*, L-6-*, N-12-*, *-Overflow*, *-Last*)
- `studentPhoto1..studentPhoto4` (для E-Student-Left/Right/Default = `studentPhoto1..2`; E-Max-Right и E-Ind-Right-3 = `studentPhoto1..studentPhoto4`/`studentPhoto1..3`) — **без подчёркивания** перед номером
- В 2-стр мастерах E-Student-Default/Standard ключи коллидируют между страницами → парсер генерирует суффиксы `_left`/`_right` (см. §5 #7, §6.3).

### Учительские
- `headTeacherName`, `headTeacherRole`, `headTeacherPhoto`, `headTextFrame` (во всех F-*)
- `teacherName_1..16`, `teacherPhoto_1..16` — единый стиль (строчная t, с `_`) во всех F и G мастерах
- **`TeacherRole_1..8` (заглавная T) — только в F-Head-SmallGrid/LargeGrid и их `-R` версиях**
- **`teacherRole_1..16` (строчная t) — в G-Teachers-3x3/4x3/4x4**

→ ⚠ **Реальный inconsistency в шаблоне.** Парсер нормализует к lowercase при импорте (см. §5 #6, §6.4).

### Общие фото
- `classPhotoFrame` (НЕ `classPhoto`) — везде где есть «общее фото класса»: G-FullClass, F-Head-WithPhoto, J-ClassPhoto[-Right], J-SixthFull, S-Intro, S-Intro-Old, L-6-Last, L-Overflow-Row, N-Overflow-Row, D-Medium-Last-WithPhoto
- `halfLeftPhoto`, `halfRightPhoto` (только в G-HalfClass) — половины класса
- `halfPhoto_1`, `halfPhoto_2` (J-Half, J-HalfSixth) — половины класса в общем разделе
- `quarterPhoto_1`, `quarterPhoto_2` (только J-Quarter) — фото четверти класса
- `collagePhoto_1..12` (J-Collage = 1..6, J-HalfSixth = 1..6, J-SixthFull = 1..6, J-SixthSixth = 1..12) — фото ⅙ класса / коллаж

### Intro
- В **S-Intro / S-Intro-Old нет** меток для текста и для intro-фото! Только `classPhotoFrame`. Два TextFrame'а в каждом мастере есть, но они **без `<Label>`**. Парсер их пропустит. В фазе 0 текст intro не подставляется (см. §5 #11).

---

## 5. Расхождения с ТЗ — решения

| # | ТЗ | Реально в шаблоне | Влияние | **Решение (Сергей, 04.05.2026)** |
|---|---|---|---|---|
| 1 | `classPhoto` | `classPhotoFrame` | Имя ключа в JSON и `buildAlbum` | **`classPhotoFrame` — канон.** ТЗ §5 пример обновит Сергей. `buildAlbum` использует `classPhotoFrame`. |
| 2 | `halfClass_1/2` (в G-HalfClass) | `halfLeftPhoto`/`halfRightPhoto` | Имена ключей в `buildAlbum` | **Канон.** `buildAlbum` использует `halfLeftPhoto`/`halfRightPhoto`. |
| 3 | J-Quarter подразумевал 4×¼ | Только 2×¼ на странице (1 мастер, нет `-Right`) | Раньше О-2 нуждался в 2 страницах | **Упразднено** — общий раздел снят с `buildAlbum` фазы 0 (см. §9). J-* остаются в БД, добавляются партнёром в редакторе фаз 2-4. |
| 4 | Лайт сетки 2×1/3×1/2×2/3×2 | Есть только L-6 (3×2) + Overflow + Last | Адаптивная сетка не реализована | **Принимаем фактический шаблон.** `buildAlbum config='light'`: L-6-Left/Right + Overflow/Last для 1-32 учеников. < 1 или > 32 → throw. Параллельно дизайнеру задача добавить L-2/L-3/L-4. |
| 5 | Мини сетки 2×2/2×3/3×3/4×3 | Только N-12 (4×3) + Overflow | Аналогично | **Принимаем фактический шаблон.** `buildAlbum config='mini'`: N-12-Left/Right + Overflow для 1-36 учеников. < 1 или > 36 → throw. Параллельно дизайнеру задача добавить N-4/N-6/N-9. |
| 6 | `TeacherRole_*` единым стилем | F-* → `TeacherRole_*`, G-* → `teacherRole_*` | Несовместимость регистра | **Парсер нормализует к lowercase** при импорте. Сохраняет оригинал в `placeholder.original_label` для отладки. JSON и `buildAlbum` работают только с lowercase. |
| 7 | E-Student-Standard как single-page | 2-стр, label'ы дублируются (`studentPortrait` ×2) | Конфликт ключей в `data: {label → value}` | **Парсер генерирует суффиксы `_left`/`_right` по странице.** `studentPortrait_left`, `studentPortrait_right` и т.п. При импорте пишет warning: `dup label '<label>' in <master>, generated _left/_right suffixes`. |
| 8 | `E-Student-Default` как чистый разворот | Нестандартный Page.ItemTransform (top=11.34pt) | Парсер не должен предполагать `tx=-PW` | **Парсер берёт `tx`/`ty` из leftmost Page.ItemTransform** (см. §6.1). Безопасно для любых мастеров. |
| 9 | E-Max левая = портрет/имя/цитата | Левая = портрет+имя; **цитата на правой** | Логика Maximum в `buildAlbum` | **Канон.** `buildAlbum config='maximum'`: левая = `studentPortrait`+`studentName`, правая = `studentPhoto1..4`+`studentQuote`. |
| 10 | F-Head-WithPhoto без classPhoto | Содержит `classPhotoFrame` | Учительский разворот для subjects=0 | **Канон.** Для subjects=0: пара = F-Head-WithPhoto + G-HalfClass. На левой заполняется `classPhotoFrame` + `headTeacher*` + `headTextFrame`. На правой — `halfLeftPhoto`/`halfRightPhoto`. |
| 11 | S-Intro имеет `introText`+`introPhoto` | Только `classPhotoFrame`, текст-фреймы без меток | Текст intro не подставляется | **Фаза 0**: в `buildAlbum` для `print_type='soft'` создаётся `SpreadInstance{template=S-Intro, data={classPhotoFrame: 'photo:uuid'}}`. Текст не пишем. Параллельно дизайнеру задача добавить метки `introText`/`introPhoto`. После обновления шаблона — повторный `import_idml` + минимальный коммит в `buildAlbum`. |
| 12 | Поворотов фреймов нет | TextFrame в F-Head-WithPhoto имеет `0 -1 1 0` (-90°) | Парсер должен сохранять угол | **`rotation_deg = atan2(b, a) * 180 / π`**, нормализуем к `[-180, 180]`. Для большинства фреймов = 0. Подтверждено. |
| 13 | 39 мастеров, все 8 префиксов | **Подтверждено** | — | ✓ |

---

## 6. Правила парсера (зафиксированы для 0.2)

1. **Координаты от leftmost Page.ItemTransform.** `spread_origin_x = leftmost Page.ItemTransform.tx`, `spread_origin_y = тот же Page.ItemTransform.ty`. Не используем хардкодом `-spread_width/2`. Безопасно для любых мастеров включая `E-Student-Default`.
2. **Фреймы без `<KeyValuePair Key="Label">` пропускаем** (декоративные элементы). Касается также неподписанных text-фреймов в `S-Intro`/`S-Intro-Old` — в фазе 0 они не попадают в плейсхолдеры.
3. **Дубли label'ов в одном мастере → суффиксы `_left`/`_right` по странице.** При импорте логировать warning. Касается `E-Student-Default` и `E-Student-Standard`.
4. **Регистр имён → lowercase при импорте.** Оригинал сохраняем в `placeholder.original_label` (служебное поле для отладки/фидбека дизайнеру). Все остальные слои (JSON, buildAlbum, UI) работают только с lowercase.
5. **Тип мастера по префиксу:**
   - `E-` / `D-` / `L-` / `N-` → `student`
   - `F-` → `head_teacher`
   - `G-` → `subjects`
   - `J-` → `common`
   - `S-` → `intro`
   - Тип `cover` в этом шаблоне отсутствует — CHECK-валидация в БД на ноль строк не сработает, это нормально.
6. **Поворот фреймов:** `rotation_deg = atan2(b, a) * 180 / π`, нормализованный к `[-180, 180]`. Для большинства фреймов = 0. Один TextFrame в F-Head-WithPhoto = -90°.
7. **Стили текста.** Если `Properties.AppliedFont`/`PointSize`/`FontStyle` в Story пустые — fallback: AppliedParagraphStyle из `Resources/Styles.xml` → если и там пусто — дефолты (Geologica, размер по контексту мастера). Точные дефолты подбираем в 0.3 при разборе Stories.

---

## 7. Решения по 8 вопросам §7

| # | Вопрос | Решение |
|---|---|---|
| 1 | classPhotoFrame vs classPhoto | **classPhotoFrame — канон** (см. §5 #1) |
| 2 | TeacherRole vs teacherRole | **Lowercase нормализация** (см. §5 #6, §6.4) |
| 3 | E-Student-Default/Standard дубли | **Парсер генерит `_left`/`_right` суффиксы + warning** (см. §5 #7, §6.3) |
| 4 | S-Intro без меток для текста | **Фаза 0 — только classPhotoFrame.** Дизайнеру параллельно задача добавить `introText`/`introPhoto`. После обновления шаблона — re-import + коммит (см. §5 #11) |
| 5 | Адаптивные сетки Лайт/Мини | **Принимаем фактический шаблон в фазе 0** (L-6 + overflow / N-12 + overflow). Дизайнеру параллельно задача добавить L-2/3/4 и N-4/6/9 (см. §5 #4, #5) |
| 6 | J-Quarter содержит 2 фото | **Не актуально — общий раздел упразднён в `buildAlbum` фазы 0** (см. §9) |
| 7 | E-Max-Right содержит studentQuote | **Канон.** `buildAlbum config='maximum'`: левая=портрет+имя, правая=4фото+цитата (см. §5 #9) |
| 8 | F-Head-WithPhoto + classPhotoFrame для subjects=0 | **Канон.** Для subjects=0 пара = F-Head-WithPhoto + G-HalfClass (см. §5 #10) |

---

## 8. Резюме разведки

- Структура шаблона совпадает с ожиданием ТЗ по основным параметрам: 226×288 мм, 39 мастеров, все 8 префиксов, координаты от центра спреда.
- Координатная схема: «leftmost Page.ItemTransform.tx/ty» — безопасная формула, работает для всех включая legacy `E-Student-Default`.
- Имена плейсхолдеров в реальном шаблоне отличаются от примеров в ТЗ. Все расхождения учтены в §5 с принятыми решениями. ТЗ обновит Сергей отдельно.
- Парсер из 0.2 пишем по правилам §6: leftmost-Page.ItemTransform, lowercase нормализация, `_left`/`_right` суффиксы при коллизиях, обработка поворотов.
- `buildAlbum` фазы 0 покрывает: soft-intro (только classPhotoFrame), учительский раздел (8 кейсов по subjects), ученические развороты (по реальному шаблону). **Общий раздел не входит** (см. §9).

---

## 9. Архитектурное решение по общему разделу (Сергей, 04.05.2026)

### Контекст

Изначально в `комплектации_краткое_описание.md` общий раздел задан как фиксированный набор О-1/О-2/О-3 + опциональные Д-1/Д-2. Это писалось для собственных фотографов OkeyBook с устоявшимся процессом.

### Проблема

Yearbook-v2 — мультиарендный SaaS с партнёрами-фотографами. Партнёры верстают альбомы по-своему: разные комбинации общих фото, разное число коллажей, разные приоритеты. Жёсткий алгоритм О-1/О-2/О-3 в `buildAlbum` либо станет ограничением для партнёров, либо потребует комплексных настроек.

### Решение

**В фазе 0 `buildAlbum` НЕ генерирует общий раздел вообще.** В алгоритм входят только:

1. **Soft-intro** (если `print_type='soft'`) — 1 страница `S-Intro` с `classPhotoFrame`.
2. **Учительский раздел** — пара F+G по `subjects.length`:
   - 0 → F-Head-WithPhoto + G-HalfClass (classPhotoFrame на левой)
   - 1-4 → F-Head-SmallGrid + G-HalfClass
   - 5-8 → F-Head-LargeGrid + G-HalfClass
   - 9 → F-Head-WithPhoto + G-Teachers-3x3
   - 10-12 → F-Head-WithPhoto + G-Teachers-4x3
   - 13-16 → F-Head-WithPhoto + G-Teachers-4x4
   - 17-24 → F-Head-LargeGrid + G-Teachers-4x4
3. **Ученические развороты** — по `config_type`, согласно реальному шаблону.

### Что не делаем

- Никаких правил О-1/О-2/О-3.
- Никаких J-* мастеров в `buildAlbum`.
- Никаких опциональных Д-1/Д-2.

### Что остаётся доступным

- J-* мастера импортируются парсером в `spread_templates` как обычно.
- В фазах 2-4 (UI редактор) партнёр будет вручную добавлять любые J-разворотов поверх обязательной структуры.
- Это снимает блокер #3 (J-Quarter с 2 слотами) — больше не актуально для алгоритма.

### Параллельные задачи дизайнеру (вне фазы 0)

- Добавить адаптивные сетки Лайт: `L-2`, `L-3`, `L-4` (для 8/12/16 учеников).
- Добавить адаптивные сетки Мини: `N-4`, `N-6`, `N-9` (для 8/12/18 учеников).
- Добавить в `S-Intro`/`S-Intro-Old` метки `introText` и `introPhoto`.
- Опционально: `J-Quarter-Right`, `J-Half-Right`, `J-Collage-Right` (для зеркальных разворотов в редакторе).

После прихода обновлённого шаблона — повторный `import_idml` перетрёт записи в БД, при необходимости минимальные коммиты в `buildAlbum`. Этот трек **НЕ блокирует фазу 0**.
