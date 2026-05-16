# Фаза КЭ — Контент-редактор фото (scale + offset)

**Версия:** v1.1
**Дата:** 16.05.2026
**Статус:** ТЗ согласовано, начат код (КЭ.1)
**Связано:** roadmap-after-phase-3.md (август 2026 — боеготовность к партнёрке)

## Решения по вопросам (16.05.2026)

| # | Вопрос | Решение |
|---|---|---|
| 1 | UI размещение | **Inline popover** над фреймом (плавающий toolbar) |
| 2 | Range scale max | **200%** (без излишней пикселизации) |
| 3 | Touchpad vs slider | **Touchpad + 2 numeric input'а** для точной правки |
| 4 | PDF rounding | Принимается — sharp.extract округляет до пикселей, визуально совпадает с Konva |
| 5 | Mobile | **Только desktop** |
| 6 | Touch (iPad) | **Поддержать через pointer events** — большинство партнёров на десктопе, но iPad-поддержка как плюс |

## 1. Проблема

Сейчас (после фаз Л и М) в редакторе макета каждый photo-placeholder
показывает фото жёстко через `object-fit: cover` с центрированием по
короткой стороне. То же поведение в PDF-экспорте (`sharp.resize({
fit: 'cover', position: 'centre' })`).

Это означает:
- Партнёр не может подвинуть горизонт в групповом фото (типичный случай:
  в общем фото класса небо занимает половину кадра, нужно сдвинуть вниз)
- Не может приблизить лицо в портрете если автоматический crop срезал
  его сверху/снизу
- Не может уменьшить фото внутри фрейма (например для коллажа из 6
  частей оригинального снимка)

В InDesign это решается двумя инструментами:
- **Scale** — увеличение фото внутри фрейма (zoom 100-400%)
- **Position** — двумерный сдвиг (X/Y) внутри фрейма

Без этого инструмента партнёр не может довести альбом до публикуемого
качества — даже идеально подобранные фото нужно слегка подкручивать.
Это **блокирующая дыра** на пути к августовскому запуску партнёрки.

## 2. Решение — Content Transform

Добавить в `album_layouts.spreads[].data` два новых класса служебных
ключей по образцу существующих `__hidden__<label>` и `__pos__<label>`:

- `__scale__<label>` — число, scale factor (1.0 = базовый cover crop,
  значения < 1.0 запрещены, > 1.0 = zoom-in). Default = 1.0.
- `__offset__<label>` — строка `"x,y"` где x/y в диапазоне `[-1, 1]`,
  доля от width/height фрейма. (0, 0) = центрировано. Default = "0,0".

Эти ключи интерпретируются в **трёх местах** одинаково:

1. **AlbumSpreadCanvas** (`PhotoSlot` в Konva)
2. **PDF-экспорт** (`embedPhotoOnPage` через sharp `extract` + `resize`)
3. **Превью миниатюр** (тот же AlbumSpreadCanvas) — автоматически
   так как использует общий компонент

Формат хранения как у `__hidden__` и `__pos__` — это уже устоявшаяся
конвенция «служебные ключи внутри data», адаптер AlbumLayout→BuildResult
(`normalizeBindings`) их пропускает как обычные строки. Никаких новых
типов SQL/JSON колонок не нужно.

### 2.1. Конкретные ключи в data

```json
{
  "studentportrait": "https://storage.yandexcloud.net/.../portrait.webp",
  "studentname": "Иванов Иван",
  "__scale__studentportrait": "1.25",
  "__offset__studentportrait": "0,-0.15"
}
```

В этом примере фото портрета увеличено до 125% и сдвинуто на 15%
от высоты вверх (горизонт ниже центра).

### 2.2. Math — что значит scale и offset

Базовый случай (scale=1.0, offset=0,0):
- Применяется `getCoverCrop(img, frameW, frameH)` — текущее поведение
- Картинка фитится в фрейм по короткой стороне, центрируется

Со scale > 1.0:
- Вычисляется новый crop размером `(coverCropW/scale, coverCropH/scale)`
- Этот crop вписывается в frame как раньше — но за счёт того что crop
  меньше натурального cover, видимая часть приближена

С offset (после применения scale):
- Точка `(coverCropCenterX, coverCropCenterY)` смещается на
  `(offsetX * remainingW, offsetY * remainingH)`
- `remainingW = naturalImageW - finalCropW` (сколько ещё можно сдвинуть
  не выйдя за границы изображения)
- Аналогично для Y. Это даёт что offset=±1 это максимальный сдвиг до
  края изображения; offset=0 это центрирование.

Граничные случаи:
- Если scale настолько большой что crop меньше 1 px → откатить к
  максимально возможному scale (с warning)
- offset clamp'ится в `[-1, 1]` всегда

### 2.3. Дефолты для существующих альбомов

`__scale__<label>` отсутствует → scale=1.0 (текущее поведение)
`__offset__<label>` отсутствует → offset=(0,0) (центрирование)

Обратная совместимость гарантирована — существующие layout'ы рендерятся
точно так же как и раньше.

## 3. Реализация по местам

### 3.1. AlbumSpreadCanvas — PhotoSlot

Файл: `app/app/_components/AlbumSpreadCanvas.tsx`

Текущий `getCoverCrop(img, targetW, targetH)` принимает дополнительные
параметры `scale: number, offsetX: number, offsetY: number` и
возвращает crop с учётом transform.

Новая сигнатура `PhotoSlot`:
```tsx
function PhotoSlot({
  placeholder,
  url,
  scale = 1,        // НОВОЕ
  offsetX = 0,      // НОВОЕ
  offsetY = 0,      // НОВОЕ
}: { ... })
```

Вызывающий код (внутри AlbumSpreadCanvas main render loop) парсит
`data[__scale__<label>]` и `data[__offset__<label>]` для каждого
photo-placeholder и передаёт в PhotoSlot.

Парсинг с учётом некорректных значений:
```ts
function parseScale(v: string | null | undefined): number {
  if (!v) return 1;
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 4) : 1;
}

function parseOffset(v: string | null | undefined): [number, number] {
  if (!v || typeof v !== 'string') return [0, 0];
  const parts = v.split(',').map((x) => Number(x.trim()));
  if (parts.length !== 2 || parts.some((p) => !Number.isFinite(p))) return [0, 0];
  return [clamp(parts[0], -1, 1), clamp(parts[1], -1, 1)];
}
```

Круглые портреты (`is_circle: true`) — тот же transform применяется
до clip-маски. Тестируется отдельным юнит-тестом.

### 3.2. PDF-экспорт — embedPhotoOnPage

Файл: `lib/pdf-export/photo-embed.ts`

После `fetchPhotoSource` вычисляются те же crop x/y/w/h что в Konva
(можно вынести в общий `lib/photo-transform/index.ts` чтобы код был
один). Потом через sharp:

```ts
const cropParams = computeCrop(img, placeholder, scale, offsetX, offsetY);
resampled = await sharp(photoSource.buffer)
  .rotate()
  .extract({  // НОВОЕ: применяем crop с transform до resize
    left: Math.round(cropParams.cropX),
    top: Math.round(cropParams.cropY),
    width: Math.round(cropParams.cropW),
    height: Math.round(cropParams.cropH),
  })
  .resize(targetW_px, targetH_px, {
    fit: 'fill',  // изменилось с 'cover' — мы уже вырезали нужную часть
  })
  .jpeg({ quality: ..., mozjpeg: true })
  .toBuffer();
```

`scale` и `offsetX/Y` извлекаются из `instance.data[__scale__<label>]`
и `instance.data[__offset__<label>]` тем же парсером что в Konva.

**Важно:** `sharp.extract` ожидает целочисленные пиксели. Crop вычисляется
в натуральных координатах изображения (по `img.naturalWidth/Height`,
которые в PDF-export получаем через `sharp(buffer).metadata()`).

### 3.3. Shared модуль — lib/photo-transform/index.ts

Один источник правды для логики scale/offset → crop params. Используется
и в Konva и в sharp. Тестируется отдельно.

```ts
// lib/photo-transform/index.ts

export type CropParams = {
  /** Натуральные координаты исходного изображения */
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
};

/**
 * Вычисляет CropParams для фото внутри photo-placeholder.
 *
 * @param naturalW Натуральная ширина исходного изображения (px)
 * @param naturalH Натуральная высота
 * @param targetRatio Отношение width/height фрейма-получателя
 * @param scale Коэффициент масштабирования (1 = базовый cover)
 * @param offsetX Сдвиг по X в долях [-1, 1] от свободного места
 * @param offsetY Сдвиг по Y в долях [-1, 1]
 */
export function computeCrop(
  naturalW: number,
  naturalH: number,
  targetRatio: number,
  scale: number,
  offsetX: number,
  offsetY: number,
): CropParams { ... }

export function parseScale(v: unknown): number { ... }
export function parseOffset(v: unknown): [number, number] { ... }

/** Сериализация назад в data-ключи (для UI который пишет в data) */
export function serializeScale(scale: number): string { ... }
export function serializeOffset(x: number, y: number): string { ... }
```

Тесты в `lib/photo-transform/__tests__/index.test.ts`:
- scale=1, offset=0,0 → совпадает с getCoverCrop (baseline)
- scale=2, offset=0,0 → cropW/H ровно в 2 раза меньше
- scale=1, offset=1,0 → cropX в максимальном правом положении
- scale=1, offset=-1,0 → cropX = 0
- scale=2, offset=1,1 → одновременно зум и сдвиг в угол
- portrait-orientation image (naturalH > naturalW) в landscape frame
- наоборот (landscape image в portrait frame)
- негативные scale, offset вне [-1,1] → clamp
- naturalW=0 или naturalH=0 → fallback CropParams нулей

### 3.4. UI в редакторе — Photo Transform Panel

Когда пользователь делает **click** (не double-click — он уже занят
заменой фото) по photo-placeholder с фотографией → справа от canvas
открывается панель «Кадрирование» с тремя контролами:

#### Контрол 1 — Ползунок Scale (%):

```
Масштаб: 100% ────●──────────── 400%
                  150%
```

Range slider 100-400 step 1. По умолчанию 100. Внизу подпись с
текущим значением в %.

#### Контрол 2 — Touch-pad Position:

Квадратик 120×120px справа от slider. Внутри — точка-курсор которую
можно drag'нуть. Координаты точки маппятся в (-1, 1) → пишется в
`__offset__<label>`.

Дополнительно — крестообразное reset (центр) при double-click.

#### Контрол 3 — Кнопка «Сброс»

Удаляет `__scale__<label>` и `__offset__<label>` из data → фото
возвращается к default cover crop.

#### Сохранение в data

Изменения применяются **с debounce 300ms** (чтобы не спамить серверу
при drag слайдера). Через `PATCH /api/layout?action=update_data`:

```ts
{
  album_id: ...,
  layout_id: ...,
  spread_index: N,
  data_updates: {
    __scale__studentportrait: "1.5",
    __offset__studentportrait: "0,-0.2"
  }
}
```

API endpoint новый — `update_data` в `app/api/layout/route.ts`.

### 3.5. API endpoint

`POST /api/layout?action=update_data`

```ts
body: {
  album_id: string (uuid),
  layout_id: string (uuid),
  spread_index: number,
  data_updates: Record<string, string | null>,  // null = удалить ключ
}
```

Логика:
1. assertAlbumAccess + view_as как в других /api/layout endpoint'ах
2. SELECT album_layouts → spreads
3. Найти spread по spread_index
4. Применить data_updates: для null значений → delete key; иначе set
5. UPDATE album_layouts SET spreads = ..., has_user_edits = true, updated_at = now()
6. logAction 'album_layout.update_data'
7. Вернуть `{ ok: true, spread: updated_spread_instance }`

Валидация:
- Ключи в `data_updates` должны соответствовать regex
  `/^(__scale__|__offset__|__hidden__|__pos__)?[a-z][a-z0-9_]*$/`
  (только snake_case + опциональный префикс из whitelist'а)
- Значения length ≤ 4096 chars
- spread_index ∈ [0, spreads.length - 1]

### 3.6. UI: индикация что фрейм имеет transform

Маленький бейдж в углу photo-placeholder когда `__scale__` или
`__offset__` присутствует с не-default значением:
- ⚙️ иконка в правом верхнем углу с tooltip «Кадрирован вручную»

Это помогает партнёру понять что фрейм отличается от автоматического
crop.

## 4. План коммитов

### КЭ.1 — Shared модуль + тесты
`lib/photo-transform/index.ts` с `computeCrop`, `parseScale`,
`parseOffset`, `serializeScale`, `serializeOffset` + 8-12 unit тестов.
Никаких изменений в продакшн коде. Можно мержить независимо.

### КЭ.2 — AlbumSpreadCanvas integration
Использовать `computeCrop` вместо `getCoverCrop`. Парсить `__scale__`/
`__offset__` из data. Регрессионный тест: data без новых ключей рендерится
точно так же как до КЭ.2.

### КЭ.3 — API endpoint update_data
Новый endpoint в `app/api/layout/route.ts` + audit_log.

### КЭ.4 — Photo Transform Panel UI
Компонент `app/app/_components/PhotoTransformPanel.tsx`. Slider + touchpad
+ reset. State + debounce + apiVA call.

### КЭ.5 — Интеграция Panel в LayoutEditorPage
Click на photo с url → set selectedPhotoLabel → панель открывается
справа. Закрытие при клике вне или Esc.

### КЭ.6 — Бейдж "Кадрирован вручную" в AlbumSpreadCanvas
Маленькая Konva-иконка для placeholder'ов с non-default transform.

### КЭ.7 — PDF-экспорт integration
`lib/pdf-export/photo-embed.ts` использует те же `computeCrop` + `sharp.extract`.
Сравнить два PDF (до/после) на простом альбоме — без изменений если
data не содержит transform-ключей.

### КЭ.8 — Контекст vN + checklist

## 5. Что НЕ входит в фазу КЭ

Эти фичи могут понадобиться, но за рамками текущего ТЗ:

- **Rotation внутри фрейма** — InDesign это делает через отдельный угол.
  Сложнее (нужны два независимых rotation: фрейма от horizontal и фото
  от фрейма). Отложено.
- **Crop через manual rectangle drag** — InDesign в "Direct Selection
  Tool" даёт менять crop-rectangle напрямую. Touchpad+slider покрывает
  90% случаев, более продвинутый UI на потом.
- **Авто-fit "Fill Frame Proportionally" vs "Fit Content Proportionally"** —
  сейчас работаем только в cover-режиме (fill frame), без fit-режима.
  Это IDML-feature на уровне placeholder, не на уровне data. Отложено.
- **Прокидывание crop из IDML мастера** — мастера сейчас приходят без
  start crop'а (всегда `fit: fill_proportional` default cover).
  Если в будущем добавим поддержку `fit: fit_content_proportional` —
  это будет в отдельной фазе.

## 6. Эстимация

| Коммит | Сложность | Часы |
|---|---|---|
| КЭ.1 (shared + тесты) | S | 2-3 |
| КЭ.2 (Canvas integration) | M | 2-3 |
| КЭ.3 (API endpoint) | S | 1-2 |
| КЭ.4 (Panel UI) | L | 4-6 |
| КЭ.5 (интеграция в editor) | M | 2-3 |
| КЭ.6 (бейдж) | S | 1 |
| КЭ.7 (PDF) | M | 3-4 |
| КЭ.8 (контекст) | S | 1 |
| **Итого** | | **16-23 часов** |

При темпе 2-3 коммита в сессии — 3-4 рабочие сессии. Реалистично
закрыть фазу за неделю.

## 7. Acceptance criteria

После КЭ.7:

1. Партнёр открывает «тест 2026» (rule engine universal), кликает по
   групповой фотографии класса на развороте 1. Справа появляется
   панель кадрирования.
2. Двигая slider до 150% и touchpad вверх — видит как фото зумится
   и горизонт смещается вниз в реальном времени (в Konva canvas).
3. Закрывает панель (Esc или клик вне). Изменения сохранены — при
   повторном открытии редактора видны.
4. Нажимает «Экспорт PDF» (или через handleExport). В PDF тот же
   crop применяется.
5. Альбомы где партнёр не трогал transform → визуально идентичны
   старым (regression).
6. PDF-экспорт без transform-ключей → идентичен старым PDF'ам байт
   в байт (или максимально близок, с точностью до sharp resample
   noise который и так есть).

## 8. Связь с другими фазами

- **Партнёрка август 2026** — КЭ блокирует запуск партнёрки.
  Без неё партнёр не сможет довести альбом до публикации.
- **Балансировка (placeholder_centering / hide_unfilled)** — отдельная
  фаза. Они работают на уровне __hidden__<label> и __pos__<label>
  которые уже есть. Текущая фаза КЭ их не трогает.
- **Rule engine (РЭ)** — параллельная работа. КЭ не зависит от того
  через какой движок собран layout (legacy или rules). Транформ
  применяется на уровне рендера, движок не задействован.
