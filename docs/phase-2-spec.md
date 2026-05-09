# Фаза 2 — Canvas-рендер и редактирование layout'а

**Дата:** 09.05.2026
**Версия:** 1 (после ответов на 16 open questions)
**Статус:** черновик, готов к началу разработки

---

## 1. Цель

Партнёр в кабинете после автосборки (фаза 1.4) видит **визуальный
превью** разворотов с реально вставленными фото. Если автосборка
ошиблась с выбором — партнёр **редактирует** layout: drag-and-drop
заменяет фото, swap'ает между placeholder'ами, добавляет фото из
палитры.

Изменения сохраняются в `album_layouts.spreads` через debounced
auto-save. Пересборка («Собрать автоматически») спрашивает confirm
если есть правки партнёра.

## 2. Что НЕ входит в фазу 2

- Reorder разворотов (drag всего spread'а) — фаза 2.X
- Inline edit текста — фаза 4 (затрагивает родительский флоу)
- Undo через Cmd+Z — фаза 2.X (state history)
- PDF-экспорт — фаза 3
- Реальные шрифты — фаза 3 (вместе с PDF)
- Server-side thumbnails (imgproxy) — фаза 2.X если упрёмся в perf

---

## 3. Архитектура

### 3.1 Что меняется в БД

Одна миграция:

```sql
ALTER TABLE album_layouts
  ADD COLUMN has_user_edits BOOLEAN NOT NULL DEFAULT false;
```

Флаг ставится в `true` при `save_album_layout` (action 2.5). Сбрасывается
в `false` при `build_album` (партнёр сознательно пересобирает с нуля).

В UI (Обзор → «Пересобрать»): если `has_user_edits=true` — показывается
`window.confirm('У альбома есть ваши правки. Они будут потеряны при
пересборке. Продолжить?')`.

### 3.2 Frontend структура

```
app/app/
  page.tsx                                — добавляется LayoutPreviewStrip в Обзоре
  _components/
    LayoutPreviewStrip.tsx                — горизонтальная полоса миниатюр
    AlbumSpreadCanvas.tsx                 — Konva canvas рендер SpreadInstance
  album/
    [id]/
      layout/
        page.tsx                          — fullscreen редактор
        _components/
          PhotoPalette.tsx                — палитра фото (selections + originals toggle)
          SaveIndicator.tsx               — статус «Сохраняется...» / «Сохранено»
          DragDropProvider.tsx            — обёртка над @dnd-kit/core
```

### 3.3 Backend endpoints

| Endpoint | Что делает | Уже есть |
|---|---|---|
| `GET /api/layout?action=album_layout` | Загрузка layout'а | ✅ фаза 1.4 |
| `POST /api/layout?action=build_album` | Полная пересборка | ✅ фаза 1.3 (расширяется: ставит `has_user_edits=false`) |
| `POST /api/layout?action=save_album_layout` | **Новый** — сохранение правок партнёра | 🆕 фаза 2.5 |
| `GET /api/tenant?action=album_photos` | **Новый** — список всех фото альбома для палитры | 🆕 фаза 2.4 |

### 3.4 Поток данных

```
Открытие модала альбома (фаза 1.4)
  → GET ?action=album_layout
  → Обзор показывает LayoutPreviewStrip с миниатюрами
  → клик «Открыть редактор» → переход на /app/album/[id]/layout

На странице редактора:
  → GET ?action=album_layout (полный layout)
  → GET ?action=album_photos (палитра — все фото альбома)
  → GET ?action=template_set_detail (placeholder'ы для рендера)

Drag-and-drop:
  → onDrop → mutate spreads в client state
  → debounce 2s → POST ?action=save_album_layout
  → SaveIndicator: «Сохраняется...» → «Сохранено»

«Пересобрать» в Обзоре:
  → если has_user_edits → confirm()
  → POST ?action=build_album → has_user_edits=false
```

---

## 4. Детальные спецификации

### 4.1 `GET /api/tenant?action=album_photos`

**Зачем:** палитра редактора показывает все фото альбома + флаг
использования.

**Параметры:**
- `album_id` (UUID) — обязательный
- `view_as` (UUID) — опциональный для OkeyBook staff

**Доступ:** owner/manager/viewer тенанта-владельца + staff с view_as +
superadmin.

**Response:**

```typescript
{
  photos: Array<{
    id: string,
    filename: string,           // "DSC08521.jpg"
    storage_path: string,       // "album_id/portrait/ts_filename.jpg"
    thumb_path: string | null,
    type: 'portrait' | 'group' | 'teacher',  // photos.type
    source: 'selections' | 'originals',       // откуда взято
    child_id: string | null,    // для портретов и группы — ID ребёнка
    teacher_id: string | null,  // для учителей
    selection_types: ('portrait_page' | 'portrait_cover' | 'group')[],
                                // массив селекшенов где это фото есть (пустой = unselected)
  }>
}
```

**Логика:**

1. Загрузить все `photos WHERE album_id = X` (это `selections` фото)
2. Загрузить все `originals WHERE album_id = X` — добавить с
   `source='originals'`, `type='portrait'` по умолчанию (originals
   не имеют type)
3. Для каждого `photo` из selections — определить `selection_types`
   через JOIN с selections + photo_teachers

**Замечание про originals:** в текущем коде originals не связаны с
конкретными детьми/учителями. Палитра показывает их как «общий
пул» (без `child_id`). Это нормально — партнёр сам решает какому
ученику какое фото.

### 4.2 `POST /api/layout?action=save_album_layout`

**Зачем:** сохранение правок партнёра без пересборки.

**Тело:**

```typescript
{
  album_id: string,                  // UUID
  spreads: SpreadInstance[],         // полный массив с правками
}
```

**Доступ:** owner/manager (НЕ viewer) + staff с view_as + superadmin.

**Валидация:**
- album_id — UUID формат
- spreads — массив, каждый элемент с обязательными полями
  `spread_index`, `template_id`, `template_name`, `data`
- album_layouts должен существовать (была хотя бы одна build)
- spreads.length должен совпадать с существующим layout (партнёр
  не может добавлять/удалять spread'ы — только править)

**Логика:**

1. assertAlbumAccess
2. Загрузить existing `album_layouts` для проверки наличия
3. UPDATE `album_layouts` SET spreads=$1, has_user_edits=true,
   updated_at=NOW() WHERE album_id=$2
4. logAction('album_layout.save', 'album', albumId, {spreads_count})

**Response:**

```typescript
{
  ok: true,
  layout_id: string,
  updated_at: string
}
```

### 4.3 `AlbumSpreadCanvas` компонент

Konva-based, рисует один `SpreadInstance` (одна страница ИЛИ один
двойной разворот).

**Props:**

```typescript
type Props = {
  instance: SpreadInstance,
  template: SpreadTemplate,           // соответствует instance.template_id
  containerWidth: number,             // pixel width в layout
  mode: 'preview' | 'edit',           // preview = read-only, edit = drag-enabled
  onDrop?: (label: string, photoId: string) => void,
  onSwap?: (fromLabel: string, toLabel: string) => void,
}
```

**Что рисует:**

1. Фон spread'а (как в существующем `SpreadCanvas`)
2. Для каждого `placeholder` из `template.placeholders`:
   - **photo placeholder**: если `instance.data[placeholder.label]` —
     URL → `<Image>` с `crop='center-middle'` (по аналогии с IDML
     `fit_proportional`)
   - **photo placeholder без URL**: тонкая рамка (B4=б)
   - **text placeholder**: `<Text>` с близким fallback (B3=б)
3. В `mode='edit'`: hover на placeholder → highlight, drop target

**Загрузка изображений:**

```typescript
function useImage(url: string | null) {
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    if (!url) return setImage(null)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = url
    img.onload = () => setImage(img)
    img.onerror = () => setImage(null)
  }, [url])
  return image
}
```

15 строк, без зависимости (D3=б).

### 4.4 `LayoutPreviewStrip` компонент

Горизонтальная полоса миниатюр в Обзоре после `result-блока` 1.4.

**Props:**

```typescript
type Props = {
  layout: SmartFillLayout,             // из album_layout endpoint
  template: TemplateSetDetailResponse, // для placeholder'ов
  onOpenEditor: () => void,            // переход на /album/[id]/layout
}
```

**Render:**

```jsx
<div className="bg-gray-50 rounded-lg p-3 mb-4">
  <div className="flex items-center justify-between mb-2">
    <div className="text-xs text-gray-500 uppercase">
      Превью разворотов ({layout.spreads.length})
    </div>
    <button onClick={onOpenEditor} className="btn-secondary text-xs">
      Открыть редактор
    </button>
  </div>
  <div className="flex gap-2 overflow-x-auto pb-2">
    {layout.spreads.map((s, i) => (
      <div key={i} className="flex-shrink-0">
        <AlbumSpreadCanvas
          instance={s}
          template={findTemplate(s.template_id)}
          containerWidth={250}
          mode="preview"
        />
        <div className="text-xs text-center text-gray-500 mt-1">{i + 1}</div>
      </div>
    ))}
  </div>
</div>
```

### 4.5 `/app/album/[id]/layout/page.tsx` — редактор

Fullscreen layout. Структура:

```
┌──────────────────────────────────────────────────────┐
│ Header: ← К альбому | Школа 89 | [● Сохранено]      │
├─────────────────────────┬────────────────────────────┤
│                         │  ПАЛИТРА                   │
│   Spread N of 11        │  ☐ Показать оригиналы     │
│   ┌─────────────────┐   │  ─────                    │
│   │ AlbumSpread     │   │  📷 Портреты              │
│   │ Canvas          │   │  ┌───┐ ┌───┐ ┌───┐       │
│   │ (большой)       │   │  │   │ │ ✓ │ │   │       │
│   │                 │   │  └───┘ └───┘ └───┘       │
│   │                 │   │  ...                      │
│   └─────────────────┘   │  📷 Группы                │
│   ◀ ▶ N навигация       │  ...                      │
│                         │                            │
└─────────────────────────┴────────────────────────────┘
```

**Состояние:**

```typescript
const [layout, setLayout] = useState<SmartFillLayout | null>(null)
const [photos, setPhotos] = useState<AlbumPhoto[]>([])
const [templates, setTemplates] = useState<SpreadTemplate[]>([])
const [currentSpreadIdx, setCurrentSpreadIdx] = useState(0)
const [showOriginals, setShowOriginals] = useState(false)
const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved')
```

**Drag-and-drop:**

@dnd-kit/core c пользовательскими `useDraggable` (фото в палитре +
photo placeholder с фото) и `useDroppable` (placeholder).

```typescript
function handleDragEnd(event: DragEndEvent) {
  const { active, over } = event
  if (!over) return

  const sourceType = active.data.current?.type  // 'palette' | 'placeholder'
  const targetType = over.data.current?.type    // всегда 'placeholder'

  if (sourceType === 'palette') {
    // Drop из палитры в placeholder
    const photoId = active.id as string
    const targetLabel = over.id as string
    replaceInPlaceholder(targetLabel, photoId)
  } else if (sourceType === 'placeholder') {
    // Swap между placeholder'ами
    const sourceLabel = active.id as string
    const targetLabel = over.id as string
    swapPlaceholders(sourceLabel, targetLabel)
  }
}
```

**Auto-save:**

```typescript
const debouncedSave = useDebounce(layout, 2000)

useEffect(() => {
  if (!debouncedSave || saveStatus === 'saved') return
  saveLayout(debouncedSave)
}, [debouncedSave])

async function saveLayout(layout: SmartFillLayout) {
  setSaveStatus('saving')
  const r = await api('/api/layout?action=save_album_layout', {
    method: 'POST',
    body: JSON.stringify({ album_id, spreads: layout.spreads })
  })
  setSaveStatus(r.ok ? 'saved' : 'error')
}
```

**beforeunload:**

```typescript
useEffect(() => {
  const handler = (e: BeforeUnloadEvent) => {
    if (saveStatus !== 'saved') {
      e.preventDefault()
      e.returnValue = ''
    }
  }
  window.addEventListener('beforeunload', handler)
  return () => window.removeEventListener('beforeunload', handler)
}, [saveStatus])
```

### 4.6 `PhotoPalette` компонент

Группировка по типам, переключатель originals.

```jsx
<div className="palette">
  <div className="filter">
    <input
      type="checkbox"
      checked={showOriginals}
      onChange={...}
    />
    Показать оригиналы
  </div>

  <Section title="Портреты" type="portrait" />
  <Section title="Групповые" type="group" />
  <Section title="Учителя" type="teacher" />
</div>
```

Каждое фото — `useDraggable` с `id=photo.id`, `data={type:'palette',
photoId, sourceType: photo.type}`.

Если фото уже использовано в layout — pill-метка «✓ в развороте N»
поверх миниатюры.

---

## 5. План коммитов

| Подэтап | Что | ~Время |
|---|---|---|
| **2.1** | Миграция `album_layouts.has_user_edits` + расширение `build_album` (сбрасывать флаг) | ~30 мин |
| **2.2** | `AlbumSpreadCanvas` компонент (read-only, рендер photo + text) | ~3 часа |
| **2.3** | `LayoutPreviewStrip` в Обзоре + клик «Открыть редактор» (без редактора) | ~1 час |
| **2.4** | Endpoint `GET /api/tenant?action=album_photos` + `PhotoPalette` компонент | ~2 часа |
| **2.5** | Endpoint `POST /api/layout?action=save_album_layout` | ~30 мин |
| **2.6** | `/app/album/[id]/layout/page.tsx` — fullscreen редактор + DragDrop + auto-save | ~4 часа |
| **2.7** | Confirm-диалог при «Пересобрать» если `has_user_edits=true` | ~30 мин |
| **2.8** | Финальный smoke + контекст v43 → v44 | ~1 час |

**Итого:** ~13 часов разработки + smoke + докос. Реалистичный срок:
**1-2 недели** активной работы.

---

## 6. Критерии приёмки фазы 2

- [ ] Партнёр видит миниатюры разворотов в Обзоре после автосборки
- [ ] Клик «Открыть редактор» → fullscreen страница с canvas
- [ ] Палитра показывает фото селекшенов сгруппированно
- [ ] Переключатель «Показать оригиналы» добавляет originals
- [ ] Drag фото из палитры на placeholder заменяет его
- [ ] Drag placeholder на placeholder делает swap
- [ ] Через 2 сек после последнего drop'а — auto-save с индикатором
- [ ] beforeunload предупреждает при unsaved changes
- [ ] «Пересобрать» с правками просит confirm
- [ ] Smoke на 2 альбомах (Красночетайская и Школа 89)
- [ ] tsc clean, build clean, smoke 58/58

---

## 7. Open вопросы (на потом)

### 7.1 Что показывать в палитре для originals без child_id?

Originals не связаны с детьми. На MVP показываем как «общий пул»
без группировки по детям. В фазе 2.X можно сделать UI для linking
originals к ребёнку.

### 7.2 Mobile/touch поддержка drag-and-drop

@dnd-kit/core поддерживает touch events. Но layout fullscreen 
страницы заточен под desktop. На MVP туда не лезем — партнёр-фотограф
работает с десктопа.

### 7.3 Что если template_set удалён?

Маловероятно (single okeybook-default), но защита: `GET ?action=template_set_detail`
возвращает 404 → редактор показывает «Шаблон удалён, обратитесь в
поддержку». В MVP не ломаем, но fallback нужен.

### 7.4 Конфликт правок партнёра и менеджера OkeyBook

Если партнёр редактирует layout одновременно с менеджером через
view_as — last-write-wins. Real-time sync — вне MVP.

### 7.5 Optimistic UI для save

Сейчас save синхронный (debounce 2s, потом POST, ждём ответа).
Можно сделать optimistic — UI обновляется сразу, save в фоне.
Текущая схема проще, для MVP достаточно. Если будут жалобы на
«тормозит» — переделаем.
