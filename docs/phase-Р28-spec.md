# Фаза РЭ.28 — Партнёрские дизайны (сценарий A — клон template_set с resize)

**Спецификация v1.0**
**Дата:** 21.05.2026
**Статус:** утверждена 21.05.2026 (browser-чат с Сергеем, после закрытия РЭ.27).
**Зависит от:** РЭ.22 (семантический engine), РЭ.24 (каталог партнёра /app/templates), РЭ.27 (`print_type` уехал в альбом, дубль-пресеты слиты).
**Открывает путь к:** РЭ.29+ (партнёрский IDML — загрузка собственного template_set с нуля).
**Эстимация:** 6-7 коммитов основной фазы + миграция БД. 1-2 сессии.

---

## 1. Зачем фаза существует

После РЭ.24 партнёр видит каталог из 3 глобальных template_set'ов в `/app/templates` и может выбрать один для альбома. Но **подстроить под свою типографию** размеры не может — все дизайны жёстко A4 (210×297) или 226×288 от OkeyBook.

Это блокирует партнёров с собственной типографией где другие размеры. Например партнёр работает с типографией где разворот 19×29 вместо 20×30 — сейчас приходится использовать «как есть», с обрезкой типографией. Или партнёр делает «премиум» формат на 225×305 — снова без шаблона.

**Цель РЭ.28:** дать партнёру возможность **скопировать** глобальный template_set с **изменёнными размерами**. Мастера, placeholder'ы — всё ресайзится пропорционально новому размеру страницы. Партнёр видит свой дизайн в каталоге рядом с глобальными, может использовать в альбомах.

### 1.1. Ограничения сценария A

Это **простой** сценарий: «такой же дизайн, другие размеры». Адекватно работает когда:
- Партнёр хочет тот же дизайн что у OkeyBook, но в своих размерах.
- Разница пропорций (соотношения сторон) ≤ 10%.
- Партнёр согласен что мастера пересчитываются автоматически — без правки положения placeholder'ов вручную.

Не покрывает (это **РЭ.29+** — сценарий B):
- Партнёр хочет **другой** дизайн (другие мастера, другая структура секций).
- Загрузка собственного IDML с нуля.
- Графическое редактирование placeholder'ов в UI.

### 1.2. Архитектурный отказ от ранних предположений

В Р24-spec §14 был кратко описан план РЭ.28. Сейчас детализируем:

- **Глубокая копия, не ссылка.** Партнёрский клон — независимая копия всех мастеров. Если глобальный template_set обновится — клон остаётся как был.
- **Resize с округлением до целых пикселей при 300 DPI.** Это даёт детерминированную и типографически корректную геометрию.
- **Защита от больших расхождений пропорций.** 5% порог warning, 10% — запрет.

---

## 2. Модель данных

### 2.1. Что уже есть в БД (подтверждено через information_schema 21.05.2026)

**`template_sets`** (15 колонок):
- `id` uuid PK
- `tenant_id` uuid NULL — `NULL` = глобальный, иначе партнёр (поле есть)
- `name` text NOT NULL
- `print_type` text NOT NULL (legacy, на уровне РЭ.27 значение живёт в `albums.print_type`)
- `page_width_mm`, `page_height_mm` numeric NOT NULL — главное что меняем
- `spread_width_mm`, `spread_height_mm` numeric NOT NULL — пересчитывается
- `bleed_mm` numeric NULL — припуск под обрез
- `is_global` boolean NULL — legacy дубль `tenant_id IS NULL`
- `slug`, `facing_pages`, `page_binding` — опциональные мета
- `cover_preview_url`, `description` — UI поля
- `created_at`, `updated_at` — служебные

**`spread_templates`** (25 колонок), главное:
- `template_set_id` uuid NOT NULL — FK
- `width_mm`, `height_mm` numeric NOT NULL — размер мастера
- `placeholders` jsonb NOT NULL — массив объектов с `x_mm, y_mm, width_mm, height_mm, rotation_deg, ...`

В проде 3 template_set'а, все `tenant_id=NULL`. Партнёрских пока нет.

### 2.2. Миграция БД (РЭ.28.1)

```sql
-- Новое поле: трейсинг клонов (аналог parent_preset_id из РЭ.24)
ALTER TABLE template_sets
  ADD COLUMN IF NOT EXISTS parent_template_set_id uuid NULL
    REFERENCES template_sets(id) ON DELETE SET NULL;

COMMENT ON COLUMN template_sets.parent_template_set_id IS
  'РЭ.28: для партнёрских клонов — ссылка на исходный глобальный '
  'template_set из которого был сделан клон. NULL для оригиналов. '
  'ON DELETE SET NULL — если оригинал когда-то удалён, клон остаётся, '
  'просто теряет связь.';

-- Индекс для агрегаций «какие клоны делались с этого оригинала»
CREATE INDEX IF NOT EXISTS idx_template_sets_parent
  ON template_sets(parent_template_set_id)
  WHERE parent_template_set_id IS NOT NULL;
```

**Аддитивно, zero-downtime.** Существующие 3 template_set'а получают `parent_template_set_id=NULL` автоматически (они и есть оригиналы).

### 2.3. ⚠️ Перед написанием миграции

Согласно правилу из РЭ.27 (см. `phase-Р27-summary.md` §Уроки фазы):

```sql
-- 1. Проверить что колонка parent_template_set_id ещё не существует:
SELECT column_name FROM information_schema.columns
WHERE table_name = 'template_sets'
  AND column_name = 'parent_template_set_id';
-- Ожидание: 0 строк.

-- 2. Проверить что FK на template_sets.id корректен (это самоссылка):
-- Самоссылка возможна (PG это поддерживает) — пример из РЭ.24 (presets.parent_preset_id).
```

Только после этих проверок применяем `ALTER TABLE`.

---

## 3. Утилиты ресайза (РЭ.28.2)

Главная инженерная часть фазы. Чистые функции в `lib/template-set-clone/` — без зависимости от Supabase, тестируются напрямую (паттерн как с `filter-by-purchase` из РЭ.25.3 и `print-type-resolver` из РЭ.27.3).

### 3.1. Константа DPI

```typescript
// lib/template-set-clone/constants.ts
/**
 * РЭ.28: типографское разрешение. Используется для округления
 * mm-значений при resize'е. 300 DPI — стандарт коммерческой полиграфии.
 *
 * Шаг округления = 25.4 / DPI = ~0.0847 мм.
 *
 * Если в будущем партнёру понадобится другой DPI (240 эконом / 600 премиум),
 * добавим параметр в API. Сейчас — хардкод 300.
 */
export const PRINT_DPI = 300;

/** Шаг округления в мм. Все mm-значения после resize кратны этому. */
export const MM_STEP = 25.4 / PRINT_DPI; // ≈ 0.0847 мм
```

### 3.2. Округление mm-значения до целых пикселей

```typescript
// lib/template-set-clone/round-to-pixels.ts
import { MM_STEP } from './constants';

/**
 * РЭ.28: округляет миллиметровое значение до ближайшего целого пикселя
 * при текущем DPI (300). Гарантирует что в типографском растре значение
 * попадёт в ровную клетку.
 *
 * Пример: roundMmToPx(91.21031920840365) → 91.1947... (1077 px)
 *
 * Все mm-значения template_set'а и его мастеров после resize'а проходят
 * через эту функцию — чтобы клон был «чистым» в пикселях.
 */
export function roundMmToPx(mm: number): number {
  const px = Math.round(mm / MM_STEP);
  return px * MM_STEP;
}

/** Перевод mm → px для UI отображения подсказки «≈ NNNN px». */
export function mmToPx(mm: number): number {
  return Math.round(mm / MM_STEP);
}
```

### 3.3. Проверка совместимости пропорций

```typescript
// lib/template-set-clone/aspect-compatibility.ts

export type AspectCompatibilityLevel = 'ok' | 'warning' | 'blocked';

export type AspectCompatibilityResult = {
  level: AspectCompatibilityLevel;
  /** Разница пропорций в процентах. Например 5.2 значит «новый аспект отличается на 5.2%». */
  aspect_diff_percent: number;
  /** Текст для UI (русский). */
  message: string;
};

/**
 * РЭ.28: оценивает насколько целевые размеры совместимы с исходным
 * template_set'ом по соотношению сторон.
 *
 * < 5%  → 'ok'      — тихо клонируем, разница незаметна.
 * 5-10% → 'warning' — даём клонировать, но партнёр видит предупреждение.
 * > 10% → 'blocked' — не даём клонировать, мастера будут искажены
 *                     (круги станут овалами, отступы поедут).
 *
 * Аспект = page_width / page_height. Сравниваем абсолютную разницу
 * аспектов через max(a/b, b/a) - 1 — это даёт честную метрику в обе
 * стороны (если новый шире-уже исходного — то же значение).
 */
export function checkAspectCompatibility(
  originalWidthMm: number,
  originalHeightMm: number,
  targetWidthMm: number,
  targetHeightMm: number,
): AspectCompatibilityResult {
  // ...
}
```

### 3.4. Главная функция: resize одного placeholder

```typescript
// lib/template-set-clone/resize-placeholder.ts

/**
 * РЭ.28: пересчитывает координаты и размер одного placeholder
 * при изменении размера страницы.
 *
 * scale = newPageWidth / oldPageWidth (по X)
 *         newPageHeight / oldPageHeight (по Y)
 *
 * Каждое из 4 полей (x_mm, y_mm, width_mm, height_mm) умножается на
 * соответствующий scale и округляется до целого пикселя через roundMmToPx.
 *
 * rotation_deg, label, type, fit, и остальные поля копируются как есть.
 *
 * Возвращает НОВЫЙ объект — не мутирует входной.
 */
export function resizePlaceholder<P extends {
  x_mm: number; y_mm: number; width_mm: number; height_mm: number;
}>(placeholder: P, scaleX: number, scaleY: number): P {
  // ...
}
```

### 3.5. Главная функция: подготовка клона template_set

```typescript
// lib/template-set-clone/prepare-clone.ts

export type CloneRequest = {
  source_template_set: {
    id: string;
    name: string;
    page_width_mm: number;
    page_height_mm: number;
    spread_width_mm: number;
    spread_height_mm: number;
    bleed_mm: number | null;
    print_type: string;
    facing_pages: boolean | null;
    page_binding: string | null;
    description: string | null;
  };
  source_masters: Array<{
    name: string;
    /* ...все колонки spread_templates кроме id, template_set_id, created_at */
    width_mm: number;
    height_mm: number;
    placeholders: unknown[];
    /* ... */
  }>;
  /** Что задал партнёр в форме. */
  new_name: string;
  new_page_width_mm: number;
  new_page_height_mm: number;
  new_bleed_mm: number | null;
};

export type ClonePlan = {
  /** Готовая запись для INSERT в template_sets. */
  new_template_set: {
    name: string;
    tenant_id: string;
    parent_template_set_id: string;
    page_width_mm: number;
    page_height_mm: number;
    spread_width_mm: number;
    spread_height_mm: number;
    bleed_mm: number | null;
    print_type: string;
    is_global: false;
    facing_pages: boolean | null;
    page_binding: string | null;
    description: string | null;
    slug: null;
    /* остальные поля по умолчанию */
  };
  /** Список мастеров для INSERT в spread_templates (id и template_set_id заполнит API). */
  new_masters: Array<{ /* ...пересчитанные мастера */ }>;
  /** Метаинформация для UI. */
  resize_info: {
    scale_x: number;
    scale_y: number;
    aspect_check: AspectCompatibilityResult;
    masters_count: number;
    placeholders_resized: number;
  };
};

/**
 * РЭ.28: строит ПЛАН клонирования template_set'а с новыми размерами.
 *
 * Не выполняет операций в БД — только готовит структуры данных.
 * API подэтапа 28.3 принимает ClonePlan и делает INSERT'ы в транзакции.
 *
 * Логика:
 * 1. Считаем scale_x = new_page_width / old_page_width,
 *           scale_y = new_page_height / old_page_height.
 * 2. checkAspectCompatibility — если 'blocked', throw.
 * 3. Перебираем мастеров, для каждого:
 *    - width_mm * scale_x → roundMmToPx
 *    - height_mm * scale_y → roundMmToPx
 *    - placeholders.map(p => resizePlaceholder(p, scale_x, scale_y))
 * 4. Пересчитываем spread_width_mm / spread_height_mm:
 *    - если facing_pages=true: spread_width = new_page_width * 2
 *    - иначе: spread_width = new_page_width
 *    - spread_height = new_page_height
 *    Оба через roundMmToPx.
 * 5. bleed_mm — копируется из формы (если задано) или из source (если нет).
 *    Округляется через roundMmToPx.
 *
 * Что НЕ резайзится:
 * - rotation_deg, label, type, fit, original_label, и т.д. — копируются как есть.
 * - print_type — копируется без изменений (отдельная семантика, см. РЭ.27).
 * - background_url (если есть в мастере) — копируется как ссылка, не клонируется файл.
 */
export function prepareTemplateSetClone(request: CloneRequest): ClonePlan {
  // ...
}
```

### 3.6. Unit-тесты

Минимум 15-20 тестов в `lib/template-set-clone/__tests__/`:

- **`round-to-pixels.test.ts`** (~5 тестов):
  - `roundMmToPx(0)` → 0
  - `roundMmToPx(0.0847)` → 0.0847 (1 px)
  - `roundMmToPx(91.21031)` округляется к ближайшему пикселю
  - `mmToPx(210)` → 2480 (A4 при 300 DPI)
  - Идемпотентность: `roundMmToPx(roundMmToPx(x)) === roundMmToPx(x)`.

- **`aspect-compatibility.test.ts`** (~5 тестов):
  - Идентичные размеры → `level='ok'`, `diff=0`.
  - 210×297 → 200×283 (одинаковый аспект, ~3% по сторонам) → `level='ok'`.
  - 210×297 → 200×270 (аспект чуть другой, ~6%) → `level='warning'`.
  - 210×297 → 200×200 (квадрат вместо прямоугольника, ~30%) → `level='blocked'`.
  - Симметрия: `diff(A→B) === diff(B→A)`.

- **`resize-placeholder.test.ts`** (~5 тестов):
  - Scale 1.0 → возвращает копию без изменений (но через округление).
  - Scale 2.0 → размеры удваиваются, координаты тоже.
  - Округление до пикселей применено.
  - rotation_deg, label, type — копируются как есть.
  - Возвращает НОВЫЙ объект (не мутирует входной).

- **`prepare-clone.test.ts`** (~5 тестов):
  - Идентичные размеры → plan с теми же значениями (но через округление).
  - Изменение размеров → пропорциональный resize всех мастеров.
  - blocked-аспект → throws.
  - facing_pages=true: spread_width = page_width * 2.
  - bleed_mm: переопределение из формы / fallback на source.

---

## 4. API (РЭ.28.3)

В `app/api/tenant/route.ts` добавляем три action'а:

### 4.1. `template_set_clone`

```typescript
POST /api/tenant
{
  "action": "template_set_clone",
  "source_template_set_id": "uuid",
  "new_name": "Стандарт 21×30 (моя типография)",
  "new_page_width_mm": 210,
  "new_page_height_mm": 300,
  "new_bleed_mm": 5         // опционально, если не задано — из источника
}
```

Логика:
1. `assertAuth` — партнёр или superadmin.
2. SELECT `template_sets` + связанных `spread_templates` по `source_template_set_id`.
3. Проверка доступа: исходный template_set должен быть **глобальным** (`tenant_id IS NULL`) или принадлежать партнёру.
4. Валидация полей: name непустое, размеры в разумных пределах (50-500 мм).
5. `prepareTemplateSetClone({source, new_*})` → ClonePlan.
6. Если `clone_plan.resize_info.aspect_check.level === 'blocked'` → 400 + сообщение.
7. **Транзакция:**
   - INSERT `template_sets` → получаем `new_template_set_id`.
   - INSERT `spread_templates` (все мастера, по N штук).
8. Audit log: `template_set.clone` с `source_id`, `new_id`, `resize_info`.
9. Response: `{ template_set_id: '...', warnings: [...] }`.

### 4.2. `template_set_my_list`

```typescript
GET /api/tenant?action=template_set_my_list
```

SELECT `template_sets` WHERE `tenant_id = auth.tenantId` ORDER BY `created_at DESC`.

Возвращает список **клонов партнёра** для UI «Мои дизайны». Глобальные **не включает** — для них есть существующий `designs_list`.

### 4.3. `template_set_delete`

```typescript
POST /api/tenant
{
  "action": "template_set_delete",
  "template_set_id": "uuid"
}
```

Защита:
- Только если `tenant_id === auth.tenantId` (партнёр удаляет своё).
- Глобальные (`tenant_id IS NULL`) **никогда** не удаляются через этот action.
- **Проверка ссылок:** count `albums.template_set_id` + count `presets.template_set_id`. Если ≥ 1 — 409 Conflict + сообщение «Используется в N альбомах и M пресетах. Переключите их сначала.».

Если все проверки прошли:
- DELETE связанных `spread_templates` (CASCADE если есть FK, или вручную).
- DELETE `template_sets`.
- Audit log.

### 4.4. Защита: `template_set_my_list` + действующий `designs_list`

В существующем endpoint'е `designs_list` (или эквиваленте который читает UI каталога) фильтр уже учитывает «свои + глобальные» (см. Р24-spec §2.2). После РЭ.28 партнёр **автоматически** увидит свои клоны рядом с глобальными — без правок в `designs_list`.

---

## 5. UI (РЭ.28.4 + 28.5)

### 5.1. Каталог `/app/templates` — раздел «Мои дизайны»

После загрузки страницы — два секционных блока:
- **«Глобальные шаблоны OkeyBook»** (как сейчас).
- **«Мои дизайны»** — клоны партнёра (новый раздел, появляется если есть хотя бы один клон).

В каждом блоке — карточки template_set'ов с превью, размерами, кнопкой «Открыть» (на детальную страницу выбора пресета).

На карточке **глобального** шаблона — новая кнопка **«Создать на основе…»** (открывает модалку клонирования).

На карточке **своего** дизайна — кнопки **«Открыть»** + **«Удалить»** (последнее с confirm).

### 5.2. Модалка «Создать дизайн на основе X»

Открывается при клике «Создать на основе…» на глобальной карточке.

```
┌─────────────────────────────────────────────────────────┐
│  Создать дизайн на основе «Стандарт А4»            ✕   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Название:                                              │
│  [ Мой Стандарт 21×30                              ]   │
│                                                         │
│  Размеры страницы:                                      │
│  Ширина: [  210  ] мм   ≈ 2480 px                      │
│  Высота: [  297  ] мм   ≈ 3508 px                      │
│                                                         │
│  Припуск под обрез (опционально):                       │
│  [  3  ] мм   ≈ 35 px                                   │
│                                                         │
│  ┌──── ⚠ Внимание ────────────────────────────────┐    │
│  │  Соотношение сторон отличается от исходного    │    │
│  │  на 6.2%. Мастера могут быть немного           │    │
│  │  деформированы (овалы вместо кругов).          │    │
│  │  Рекомендуем выбрать дизайн ближе по           │    │
│  │  пропорциям к 21×30.                            │    │
│  └────────────────────────────────────────────────┘    │
│                                                         │
│  Исходный дизайн: «Стандарт А4», 40 мастеров           │
│  При клонировании создастся независимая копия.         │
│                                                         │
│              [ Отмена ]    [ Создать ]                  │
└─────────────────────────────────────────────────────────┘
```

UX-нюансы:
- При вводе мм-значения — рядом сразу обновляется px (для информации, не для редактирования).
- Цвет рамки и сообщения зависят от `aspect_check.level`:
  - `ok` — нет блока предупреждения, нейтральный.
  - `warning` — жёлтая рамка, иконка ⚠, разрешено создать.
  - `blocked` — красная рамка, иконка ⛔, кнопка «Создать» disabled.
- Дефолтные значения полей при открытии — копируются из исходного. Партнёр меняет только то что нужно.

### 5.3. После создания

API возвращает `template_set_id` нового клона. UI:
- Закрывает модалку.
- Обновляет список (через рефетч `designs_list` + `template_set_my_list`).
- Прокручивает к новой карточке + toast «Дизайн создан».

---

## 6. План подэтапов

| # | Что | Файлы | Коммитов |
|---|---|---|---|
| 28.0 | Spec + контекст | `docs/phase-Р28-spec.md`, контекст | 2 |
| 28.1 | Миграция БД (parent_template_set_id) | `migrations/2026-05-2N-template-sets-parent.sql` | 1 |
| 28.2 | Чистые утилиты + unit-тесты | `lib/template-set-clone/*`, `__tests__/*` | 1 |
| 28.3 | API: clone / my_list / delete | `app/api/tenant/route.ts` | 1 |
| 28.4 | UI каталога: «Мои дизайны» + кнопка «Создать на основе» | `app/app/templates/page.tsx` | 1 |
| 28.5 | UI модалка ввода размеров | `app/app/templates/_components/CloneModal.tsx` (новый) | 1 |
| 28.6 | Summary + закрытие | `docs/phase-Р28-summary.md`, контекст | 1 |

**Итого:** 7 коммитов основной фазы + 1 миграция БД. 1-2 сессии.

⚠️ **Перед каждым подэтапом** — выгрузка реальной схемы через `information_schema.columns` (правило из РЭ.27).

---

## 7. Архитектурные развилки (утверждены 21.05.2026)

| # | Развилка | Решение |
|---|---|---|
| A | Глубина копирования | Полная глубокая копия (template_set + все spread_templates). Не ссылка. |
| B | Уровни совместимости пропорций | <5% ok / 5-10% warning / >10% blocked |
| C | print_type клона | Копируется из исходного. РЭ.27 позволяет переопределить на уровне альбома. |
| D | Удаление клона | Только если 0 ссылок из albums и presets. |
| E | slug у клона | NULL (поле опциональное, для UI достаточно name) |
| F | is_global у клона | false (явно, дубль `tenant_id IS NULL`) |
| G | Что партнёр редактирует | name, page_width, page_height, bleed_mm. spread_*, slug, is_global, print_type — из источника. |
| H | Округление | До целых пикселей при 300 DPI (хардкод). mm и px показываются рядом в UI. Шаг ~0.0847 мм. |

---

## 8. Что НЕ входит в РЭ.28 (явно)

1. **Загрузка собственного IDML.** Это сценарий B → РЭ.29+, открывается по реальному запросу первого партнёра.
2. **Графический редактор placeholder'ов.** Партнёр не может «передвинуть фото на 5мм влево» — мастера резайзятся пропорционально, ручное редактирование не предусмотрено.
3. **Расширенный DPI (240, 600).** Хардкод 300. Если придёт запрос — добавим параметр в API.
4. **Обновление клонов при изменении оригинала.** Клон — независимая копия. Если глобальный template_set обновится, клоны останутся как были.
5. **Шеринг клонов между партнёрами.** Клон видит только тот партнёр который его создал.
6. **Кастомный `cover_preview_url` у клона.** Берётся из источника как ссылка. Если файл удалили — превью пропадёт у клона тоже. Решение партнёр-уровневых превью — отдельная фаза.
7. **Аналитика resize-операций.** Audit log есть, но дашборда «сколько клонов было сделано» — нет.

---

## 9. Принципы

- **Аддитивная миграция схемы.** `parent_template_set_id` nullable. Старый код игнорирует.
- **Чистые утилиты с unit-тестами.** Resize-логика в `lib/template-set-clone/` без зависимостей от Supabase (паттерн РЭ.25.3, РЭ.27.3).
- **Транзакция при INSERT клона.** Если одна вставка `spread_templates` упала — откат всего (template_set + предыдущие мастера). Партнёр не получит «полу-клон».
- **Detерминированное округление.** Все mm → ближайший пиксель при 300 DPI. Идемпотентно: повторный resize того же значения даёт тот же результат.
- **Защита от плохой геометрии.** >10% разницы аспекта — blocked, не даём создать. Лучше отказать сразу чем разбираться с искажениями потом.
- **Tenant-aware строго.** Все запросы через `auth.tenantId`. Партнёр видит свои клоны + глобальные, чужих не видит никогда.
- **⚠️ Перед каждой миграцией — `information_schema.columns`** (правило из РЭ.27 уроков).

---

## 10. Связь с другими фазами

**РЭ.22 (engine):** функция `resizePlaceholder` работает по тем же координатам что engine. Если engine ожидает определённый формат placeholder'а — клон сохраняет формат.

**РЭ.24 (каталог):** `designs_list` уже фильтрует «свои + глобальные». После РЭ.28 партнёр автоматически видит клоны рядом с глобальными.

**РЭ.27 (print_type в альбом):** `print_type` клона копируется из источника, на сборку альбома не влияет — там значение из `albums.print_type`. Совместимо.

**РЭ.29+ (партнёрский IDML):** РЭ.28 решает 80% кейсов «другой размер, тот же дизайн». РЭ.29 нужен только если партнёр хочет совсем другой дизайн.

---

**Конец spec v1.0.**
