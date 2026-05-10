# Шрифты для PDF-экспорта (фаза 3)

Здесь должны лежать **5 TTF-файлов** реальных шрифтов из IDML-макета
"Плотные Мастер Белый". Все семейства open-source, лицензии разрешают
коммитить файлы в репо.

## Список файлов

| Файл | Семейство | Назначение | Лицензия |
|---|---|---|---|
| `NotoSerif-Regular.ttf` | Noto Serif | Основной текстовый (75 вхождений) | SIL OFL |
| `NotoSerif-Bold.ttf` | Noto Serif | Заголовки, имена (3 вхождения) | SIL OFL |
| `OpenSans-Regular.ttf` | Open Sans | Описания (139 вхождений) | Apache 2.0 / OFL |
| `OpenSans-Italic.ttf` | Open Sans | На будущее (italic в БД пока нет) | Apache 2.0 / OFL |
| `Slimamif-Medium.ttf` | Slimamif | Декоративные надписи (6 вхождений) | FFC, free for commercial |

## Откуда скачать

### Noto Serif

1. Открой <https://fonts.google.com/noto/specimen/Noto+Serif>
2. Жми **Get font** → **Download all**
3. В скачанном zip найди:
   - `static/NotoSerif-Regular.ttf` → клади сюда как `NotoSerif-Regular.ttf`
   - `static/NotoSerif-Bold.ttf` → клади сюда как `NotoSerif-Bold.ttf`

### Open Sans

1. Открой <https://fonts.google.com/specimen/Open+Sans>
2. Жми **Get font** → **Download all**
3. В скачанном zip найди:
   - `static/OpenSans-Regular.ttf` → клади сюда как `OpenSans-Regular.ttf`
   - `static/OpenSans-Italic.ttf` → клади сюда как `OpenSans-Italic.ttf`

### Slimamif

1. Открой <http://dimka.com/fonts> (или зеркало <https://fontesk.com/slimamif-font/>)
2. Скачай Slimamif (один файл, обычно `Slimamif.ttf`)
3. Положи сюда и переименуй в `Slimamif-Medium.ttf`

## Проверка

После того как все 5 файлов на месте — должно быть так:

```
public/fonts/
├── NotoSerif-Regular.ttf
├── NotoSerif-Bold.ttf
├── OpenSans-Regular.ttf
├── OpenSans-Italic.ttf
├── Slimamif-Medium.ttf
└── README.md
```

Размер каждого файла — 200-500 КБ (Noto Serif обычно крупнее из-за
большого набора глифов для разных языков). Суммарно ~1.5-2 МБ в репо.

## Как используется

- **PDF-экспорт** (`lib/pdf-export/font-loader.ts`): все 5 файлов
  загружаются в PDFDocument через pdf-lib `embedFont(ttf, {subset: true})`.
  Subsetting встраивает только использованные глифы (~50 КБ на семью
  вместо ~400 КБ).

- **Konva-редактор** (фаза 3.8): `app/globals.css` подключает все 5
  через `@font-face`. Konva рисует текст реальными шрифтами вместо
  Arial fallback.

См. `docs/phase-3-spec.md` §4.2 для технических деталей.
