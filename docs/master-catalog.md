# Каталог мастеров

**Дизайн:** Белый плотные разворотами
**Размер страницы:** 226 × 288 мм · разворот 452 × 288
**Template Set ID:** `08baf556-7831-44e9-9ba8-4af20f19ee44`

## Что есть в дизайне (30 мастеров)

| Мастер | Для чего | Метки (placeholders) |
|---|---|---|
| **E-Standard-Left** | Личная страница ученика (левая) | `studentportrait`, `studentname`, `studentquote` |
| **E-Standard-Right** | Личная страница ученика (правая) | `studentportrait`, `studentname`, `studentquote` |
| **E-Universal-Left** | Ученик + 2 доп фото (левая) | `studentportrait`, `studentname`, `studentquote`, `studentphoto_1..2` |
| **E-Universal-Right** | Ученик + 2 доп фото (правая) | `studentportrait`, `studentname`, `studentquote`, `studentphoto_1..2` |
| **E-Max-Left** | Большой портрет ученика (левая) | `studentportrait`, `studentname` |
| **E-Max-Right** | 4 доп фото + цитата (парная к E-Max-Left) | `studentphoto_1..4`, `studentquote` |
| **F-Head-WithPhoto** | Только классрук | `headteacherphoto`, `headteachername`, `headteacherrole`, `headtextframe` |
| **F-Head-SmallGrid** | Классрук + 4 учителя | + `teacherphoto_1..4`, `teachername_1..4`, `teacherrole_1..4` |
| **F-Head-LargeGrid** | Классрук + 8 учителей | + `teacherphoto_1..8`, `teachername_1..8`, `teacherrole_1..8` |
| **F-Head-WithClassPhoto-L** | Классрук + классфото (левая) | + `classphotoframe` |
| **G-Teachers-3x3** | Сетка 9 учителей (правая) | `teacherphoto_1..9`, `teachername_1..9`, `teacherrole_1..9` |
| **G-Teachers-3x4** | Сетка 12 учителей (правая) | `teacherphoto_1..12`, `teachername_1..12`, `teacherrole_1..12` |
| **G-Teachers-4x4** | Сетка 16 учителей (правая) | `teacherphoto_1..16`, `teachername_1..16`, `teacherrole_1..16` |
| **G-FullClass** | Классное фото на всю страницу | `classphotoframe` |
| **G-HalfClass** | 2 классных фото на странице | `halfphoto_1..2` |
| **J-Full** | 1 фото на всю страницу (общий раздел) | `classphotoframe` |
| **J-Half** | 2 фото на странице (общий раздел) | `halfphoto_1..2` |
| **J-Quarter-Left** | 2 фото четвертями (левая) | `quarterphoto_1..2` |
| **J-Quarter-Right** | 2 фото четвертями (правая) | `quarterphoto_1..2` |
| **J-Collage-4** | Коллаж 4 фото | `collagephoto_1..4` |
| **J-Collage-6** | Коллаж 6 фото | `collagephoto_1..6` |
| **J-Spread** | 1 фото на весь разворот (2 страницы) | `spreadphoto` |
| **L-Grid-Page** | Сетка 6 учеников | `studentportrait_1..6`, `studentname_1..6` |
| **L-Combined-Page** | 3 ученика + классфото | `studentportrait_1..3`, `studentname_1..3`, `classphotoframe` |
| **M-Grid-Page** | 4 ученика с цитатами | `studentportrait_1..4`, `studentname_1..4`, `studentquote_1..4` |
| **M-Combined-Page** | 2 ученика с цитатами + классфото | `studentportrait_1..2`, `studentname_1..2`, `studentquote_1..2`, `classphotoframe` |
| **N-Grid-Page** | Сетка 12 учеников | `studentportrait_1..12`, `studentname_1..12` |
| **N-Combined-Page** | 4 ученика + классфото | `studentportrait_1..4`, `studentname_1..4`, `classphotoframe` |
| **S-Intro** | Вступительная страница | `classphotoframe` |
| **S-Final-Soft-L** | Финальная страница soft-альбома (левая) | `classphotoframe`, `finaltext` |

## Что дорисовать

### Приоритет 1 — закрыть дыры

| Мастер | Зачем нужен |
|---|---|
| **F-Head-WithClassPhoto-R** | Зеркало L — правая страница «классрук + классфото» |
| **S-Final-Soft-R** | Правая страница финального разворота soft |
| **S-Final-Hard-L** | Финал для жёсткого переплёта (левая) |
| **S-Final-Hard-R** | Финал для жёсткого переплёта (правая) |

### Приоритет 2 — больше вариативности

| Мастер | Зачем нужен |
|---|---|
| **J-Spread-2** | Разворот с 2 крупными фото |
| **J-Spread-Collage** | Разворот-коллаж 4–6 фото |
| **J-Quarter-Top** / **J-Quarter-Bottom** | Горизонтальные четверти |
| **L-Combined-Page-R** | Правое зеркало |
| **M-Combined-Page-R** | Правое зеркало |
| **N-Combined-Page-R** | Правое зеркало |

### Приоритет 3 — для будущих пресетов

| Мастер | Зачем нужен |
|---|---|
| **G-Teachers-2x2** | Маленькая школа, 4 учителя |
| **G-Teachers-2x3** | Маленькая школа, 6 учителей |
| **E-Mini-Left** / **E-Mini-Right** | Плотный альбом (3–4 ученика на странице с цитатами) |
| **E-Quote-Heavy-Left** / **E-Quote-Heavy-Right** | Творческие классы с упором на цитату |

## Правила именования меток

- Только **lowercase**: `studentname`, не `studentName`
- Множественное число через **`_N`**: `studentphoto_1`, `studentphoto_2`
- Единственное — без числа: `studentportrait` (а не `_1`)
- Одинаковые объекты в разных мастерах называются **одинаково** (`classphotoframe` везде)
