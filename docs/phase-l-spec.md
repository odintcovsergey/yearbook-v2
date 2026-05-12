# Фаза Л — Доделка редактора макета до полного MVP

**Дата создания (v1):** 12.05.2026 (первая версия)
**Дата создания (v2 актуальная):** 12.05.2026 (после обнаружения готовой фазы 2)
**Статус:** спецификация (Л.0)
**Оценка:** 7-9 дней работы, 5 подэтапов (Л.1-Л.5)

---

## 1. Контекст и переосмысление

### Что обнаружилось

Изначально я планировал писать редактор макета **с нуля**. При начале работы обнаружилось что **фаза 2 продукта B (Canvas-редактор) уже полностью реализована** 09.05.2026 — 17 коммитов, контекст v44, страница `/app/album/[id]/layout` работает.

Что уже есть и работает в проде:

| Компонент | Файл | Что делает |
|---|---|---|
| Страница редактора | `app/app/album/[id]/layout/page.tsx` | Полноэкранный редактор с header, canvas-областью, палитрой, навигацией ◀▶ |
| Konva-канвас | `app/app/_components/AlbumSpreadCanvas.tsx` | Рендер реальных фото и текста, режимы preview/edit |
| Палитра фото | `app/app/_components/PhotoPalette.tsx` | Поиск, фильтр (selections/originals), секции по типу, бейджи использования |
| Save indicator | `app/app/_components/SaveIndicator.tsx` | Статус saved/pending/saving/error в header'е |
| Strip миниатюр | `app/app/_components/LayoutPreviewStrip.tsx` | Миниатюры разворотов в Обзоре альбома с кнопкой «Открыть редактор» |
| Auto-save | в page.tsx | Дебаунс 2 сек, beforeunload protection, refresh-aware api() |
| Drag-and-drop | через @dnd-kit | Палитра → photo placeholder + swap photo↔photo |
| БД | `album_layouts.has_user_edits boolean` | Флаг ручных правок (фаза 2.1) |
| Confirm пересборки | в page.tsx | Если has_user_edits=true → confirm перед потерей правок |
| Реальные шрифты | через @font-face | NotoSerif/OpenSans/Slimamif в Konva (фаза 3.8) |

### Что НЕ сделано — это и есть фаза Л

| Дыра | Подэтап |
|---|---|
| **Редактирование текста** (ФИО, год, заголовки) — TextSlot только рендерит, нет click-handler | Л.1 |
| **Замена фото из-вне палитры** — загрузить новое или заменить оригинал прямо в редакторе | Л.2 |
| **Undo/Redo (Ctrl+Z)** — упомянуто в backlog v44, не сделано | Л.3 |
| **Read-only после `workflow_status='submitted'`** | Л.4 |
| **Бейджик «редактировался N раз»** в карточке Обзора | Л.4 |
| **Контекстное меню на placeholder** (Очистить слот, Заменить на…) | Л.4 backlog v44 |
| **Onboarding tooltip + клавиатурные подсказки** | Л.5 |

### Что НЕ входит в Л (отложено в Фазу М)

- Перетаскивание разворотов (изменение порядка)
- Замена шаблона разворота
- Добавление/удаление разворотов
- Полная история версий в БД
- Согласование клиентом (комментарии)
- Touch-events для drag (backlog v44)
- Виртуализация PhotoPalette для альбомов 1000+ фото

---

## 2. Решения по продукту (от Сергея 12.05.2026)

| Решение | Значение | Обоснование |
|---|---|---|
| **Приоритет** | Баланс: текст+фото + приличный UI | Подтверждено |
| **Drag-and-drop** | @dnd-kit (уже используется, не меняем) | Уже работает в фазе 2.6 — не трогаем |
| **Undo/Redo** | Базовый Ctrl+Z + Ctrl+Shift+Z (история в памяти, не в БД) | Из backlog v44, прямой запрос |
| **Мобильная** | View-only режим на экранах <768px | Редактирование на телефоне физически неудобно; партнёр должен показать клиенту с телефона |

---

## 3. Архитектура данных

### Что меняем в БД

**Ничего по обязательным колонкам.** `album_layouts.has_user_edits boolean` от фазы 2.1 уже выполняет роль `edited_at` из моей первоначальной спеки.

**Опциональное расширение** (Л.4, если решим что нужно):
```sql
-- Уже применено в проде Сергеем при первой версии спеки.
-- НЕ используется в API/UI на момент Л.0, но колонки на месте
-- (nullable с default, ничего не ломают).
ALTER TABLE album_layouts
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS edited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rebuild_warnings jsonb DEFAULT '[]'::jsonb;
```

Решение по использованию: в Л.4, когда буду делать бейджик «редактировался N раз» — заполняю `edited_at = NOW(), edited_by = auth.userId` параллельно с `has_user_edits = true`. Это позволит показывать «Иван правил 5 минут назад» точнее чем «когда-то правил».

### Структура `spreads[].data` — не меняем

```typescript
type SpreadInstance = {
  spread_index: number;
  template_id: string;
  template_name: string;
  data: Record<string, string | null>;
  // URL фото — для photo-placeholder'ов, текст — для text-placeholder'ов
};
```

Редактор работает с `data[label]` точно так же как `buildAlbum`. PDF-экспорт без изменений.

---

## 4. Подэтапы

### Л.0 — Спецификация (этот документ) — ✅

Без кода. Коммит — `docs(Л.0): спецификация фазы Л v2 — доделка существующего`.

---

### Л.1 — Редактирование текста (1-2 дня)

**Цель:** партнёр кликает на текст (ФИО, год, заголовок) → правит → сохраняется автоматически (auto-save уже работает).

**Что в `AlbumSpreadCanvas` сейчас:**
- `TextSlot` рисует `<Text>` Konva-компонент с реальным шрифтом
- Никаких click-handler'ов, никакой реакции на клик
- В `edit` режиме на канвасе работают только photo-placeholder'ы (через DOM-overlay DropZone)

**Что меняем:**

1. **DOM-overlay для text-placeholder'ов** (по аналогии с DropZone):
   - Прозрачный `<div>` поверх каждого text-placeholder'а
   - `cursor: text`, hover ring как у photo
   - При клике → callback на родителя `onTextClick(label)`
   - Видим только в `mode='edit'`

2. **Inline-edit прямо на канвасе:**
   - При клике появляется `<textarea>` поверх text-placeholder'а
   - Стили textarea — точно совпадают с Konva text (font-family, font-size, color, align)
   - Конвертация pt → px через тот же `PT_TO_MM` коэффициент и обратно
   - Autofocus + select-all при появлении
   - Esc — отмена (восстановить предыдущее значение)
   - Enter без Shift — подтвердить и закрыть
   - Shift+Enter — перенос строки внутри textarea
   - Blur (клик вне) — подтвердить и закрыть
   - На время редактирования Konva Text скрыт чтобы не было визуального дубля

3. **Сохранение:**
   - При подтверждении (Enter / Blur) — вызываем существующий setLayout (как в drag-and-drop):
     ```ts
     setLayout(prev => {
       const newSpreads = prev.spreads.map((s, idx) =>
         idx === currentIdx
           ? { ...s, data: { ...s.data, [label]: newValue } }
           : s
       )
       return { ...prev, spreads: newSpreads }
     })
     ```
   - Auto-save (existing) подхватит изменения через 2 сек

4. **На мобиле (<768px):**
   - Inline-edit не доступен (страница в view-only режиме согласно решению)
   - Конкретный механизм mobile view-only — в Л.4 (там и read-only после submitted)

**Backend:** изменений нет, save_album_layout уже работает с `data[label]: string`.

**Файлы:**
- `app/app/_components/AlbumSpreadCanvas.tsx` — добавить TextDropZone (по аналогии с DropZone), props `onTextClick`
- `app/app/_components/TextInlineEditor.tsx` — НОВЫЙ, textarea-оверлей
- `app/app/album/[id]/layout/page.tsx` — state `editingText: { label, value } | null`, рендерить TextInlineEditor когда editingText не null

**Критерии приёмки Л.1:**
- ☑ В режиме edit text-placeholder'ы реагируют на hover (ring)
- ☑ Клик на text → появляется textarea точно поверх с теми же стилями
- ☑ Текст можно править, Enter подтверждает, Esc отменяет
- ☑ Shift+Enter добавляет перенос строки
- ☑ Изменения сохраняются через существующий auto-save
- ☑ Если текст пустой после редактирования — `data[label] = null` (слот пустой)
- ☑ `tsc` + `next build` зелёные
- ☑ Протестировано на портретном развороте (ФИО) и общем (заголовок)

---

### Л.2 — Замена фото расширенными способами (2-3 дня)

**Цель:** 3 варианта замены фото — кроме существующего drag-from-palette.

**Что есть сейчас:**
- Drag фото из палитры → photo placeholder (работает)
- Swap photo↔photo внутри одного разворота через drag (работает)
- Палитра показывает все фото альбома с фильтром по типу

**Что добавляем:**

**Вариант 1 — Контекстное меню на photo-placeholder** (фундамент для двух следующих):

Правый клик на photo placeholder → popover-меню:
- **«Очистить слот»** — `data[label] = null`
- **«Заменить из палитры»** — открывает palette с фильтром на этот тип + подсветка слота назначения (для UX подсказки куда драгать)
- **«Загрузить новое фото»** — file picker (см. вариант 2)
- **«Заменить оригинал»** — file picker (см. вариант 3, только если у photo есть `original_path`)

Backlog v44 уже упоминал contextual menu — это то самое.

**Вариант 2 — «Загрузить новое фото» из редактора:**

При выборе файла:
1. WebP сжатие на клиенте через `browser-image-compression` (тот же flow что в PhotosTab)
2. `POST /api/upload` с правильным type (по placeholder.label / контексту) → создаётся `photos` запись
3. В фоне — presigned URL → PUT оригинала → register_original (фаза Б.1.3, CORS уже настроен)
4. После завершения upload — авто-замена в текущем слоте (`data[label] = photo.storage_path`)
5. Прогресс отдельный (small spinner на placeholder'е) не блокирует редактор
6. Новое фото появляется в палитре автоматически (она дёргается из API)

**Вариант 3 — «Заменить оригинал»:**

Для photo у которой уже есть `original_path` (после фазы К всё новое имеет):
1. File picker (только image/jpeg, image/png, image/tiff)
2. Presigned URL для нового оригинала по пути `<album_id>/originals/<ts>_<filename>`
3. PUT в YC
4. POST `/api/workflow action=rebind_retouched` с `{album_id, photo_id, storage_path}` — существующий action из К.3
5. В UI правой панели — toast «Оригинал заменён, PDF будет использовать новую версию»

WebP и `data[label]` не меняются — макет визуально тот же. PDF-export при следующем экспорте возьмёт новый оригинал.

**Файлы:**
- `app/app/_components/PhotoContextMenu.tsx` — НОВЫЙ, popover с 4 действиями
- `app/app/_components/AlbumSpreadCanvas.tsx` — добавить `onContextMenu` callback на DropZone
- `app/app/album/[id]/layout/page.tsx` — обработчики каждого варианта, state для file inputs

**Backend:** существующие endpoint'ы достаточны:
- `/api/upload` (existing) для нового фото
- `/api/upload-url` upload_type='originals' (existing) для оригинала
- `/api/workflow rebind_retouched` (existing, К.3) для подмены оригинала

**Критерии приёмки Л.2:**
- ☑ Правый клик на photo → popover с 4 действиями
- ☑ «Очистить» обнуляет слот
- ☑ «Загрузить новое» открывает file picker, после загрузки фото в слоте + в палитре
- ☑ Оригинал загружается тоже (через фоновый Б.1.3)
- ☑ «Заменить оригинал» доступен только когда у photo есть original_path
- ☑ После замены оригинала toast «PDF возьмёт новую версию»
- ☑ На мобиле контекстное меню не открывается (view-only)

---

### Л.3 — Undo/Redo (1 день)

**Цель:** Ctrl+Z откатывает, Ctrl+Shift+Z повторяет.

**Что добавляем:**

1. **Хук `useEditorHistory`** в `app/app/album/[id]/layout/_hooks/useEditorHistory.ts`:
   - State: `past: SpreadInstance[][]`, `present: SpreadInstance[]`, `future: SpreadInstance[][]`
   - `push(snapshot)` — добавить в past, очистить future
   - `undo()` — present → past[top], past[top-1] → present
   - `redo()` — future[top] → present, present → past
   - Лимит 50 снимков в past (старые забываются)
   - При новом изменении — дебаунс 300мс перед push (чтобы не плодить шаги при наборе текста)

2. **Keyboard handlers:**
   - Ctrl+Z / Cmd+Z — `undo()`
   - Ctrl+Shift+Z / Cmd+Shift+Z — `redo()`
   - Ctrl+S / Cmd+S — `preventDefault` + триггер save немедленно (без ожидания debounce)
   - Esc — снять выделение / закрыть inline-editor (уже работает в Л.1)
   - Регистрируем глобально через `useEffect` с `window.addEventListener('keydown')`, только когда редактор открыт и `editingText` не активно (иначе ломаем undo в textarea)

3. **Кнопки в toolbar (опционально, если есть место):**
   - «↶ Отменить» — disabled если `past.length === 0`
   - «↷ Повторить» — disabled если `future.length === 0`

**При undo/redo:**
- Обновляем `layout.spreads` через setLayout
- Auto-save (existing) сохранит изменения через 2 сек
- Если undo выполнен но партнёр не делает новых изменений и закрывает редактор — последний save запишет состояние

**Файлы:**
- `app/app/album/[id]/layout/_hooks/useEditorHistory.ts` — НОВЫЙ
- `app/app/album/[id]/layout/page.tsx` — интеграция хука, keyboard handlers

**Критерии приёмки Л.3:**
- ☑ Ctrl+Z откатывает последнее изменение (drag, text edit, очистка)
- ☑ Ctrl+Shift+Z повторяет
- ☑ 50 шагов лимит, старые забываются
- ☑ Ctrl+S — мгновенное сохранение
- ☑ В textarea inline-editor Ctrl+Z работает по-нативному (не наш undo)
- ☑ После закрытия редактора история сбрасывается

---

### Л.4 — Read-only режим + бейджик + view_as защита (1-2 дня)

**Цель:** редактор корректно блокируется в нужных случаях.

**Что добавляем:**

1. **Read-only после `workflow_status = 'submitted'`:**
   - Загружаем `album.workflow_status` параллельно с layout
   - Если `status IN ('submitted', 'in_production', 'delivered')` → весь редактор в `mode='preview'`
   - Палитра скрыта (или показана с пометкой «только просмотр»)
   - Auto-save отключён
   - Header показывает badge «Передано в работу — только просмотр»
   - Исключение: `auth.role === 'superadmin'` всё ещё может править (для исправлений после передачи)

2. **Read-only при `view_as`:**
   - Если сотрудник OkeyBook открыл редактор через `?view_as=<tenant_id>` → mode='preview'
   - В Л можно править только от своего имени (как партнёр)
   - Бейдж «Просмотр от имени партнёра»

3. **Mobile view-only режим (<768px):**
   - `useEffect` с `window.matchMedia('(min-width: 768px)')`
   - На мобиле — компактный layout без палитры:
     - Header с названием альбома
     - Канвас текущего разворота (фит по ширине)
     - Кнопки ◀ ▶
     - Внизу — «Откройте на компьютере для редактирования»
   - Канвас в `mode='preview'`, никаких click-handler'ов
   - Сохранение query-параметра `?album=UUID` чтобы кнопка «Назад» работала

4. **Бейджик «Макет редактировался»** в карточке альбома (Обзор):
   - Если `has_user_edits = true` (из существующего поля) → бейдж рядом с названием альбома или над `LayoutPreviewStrip`
   - Текст: «✏️ Редактировался N мин/час/день назад» (если `edited_at` есть из расширения)
   - Если `edited_at` null но `has_user_edits=true` → просто «✏️ Редактировался»
   - Заполняем `edited_at` в `save_album_layout` параллельно с `has_user_edits=true`

5. **Защита от перезатирки при пересборке** — уже работает (confirm-диалог из 2.7), не трогаем.

**Файлы:**
- `app/app/album/[id]/layout/page.tsx` — readOnly mode logic, mobile detection
- `app/app/album/[id]/layout/MobileViewOnly.tsx` — НОВЫЙ компонент мобильной заглушки
- `app/api/layout/route.ts` — обновить `save_album_layout` чтобы заполнял edited_at/edited_by

**Критерии приёмки Л.4:**
- ☑ После «Передать в OkeyBook» (status='submitted') редактор открывается в preview без палитры
- ☑ Superadmin может править даже после submitted
- ☑ Через view_as сотрудник OkeyBook видит preview-режим
- ☑ На экране <768px — компактный mobile layout без редактирования
- ☑ В Обзоре альбома виден бейдж «Редактировался» если has_user_edits=true
- ☑ После любого save `edited_at` обновляется

---

### Л.5 — Onboarding + полировка (1 день)

**Цель:** партнёр который открывает редактор впервые понимает что делать.

**Что добавляем:**

1. **Onboarding tooltip при первом открытии:**
   - `localStorage.firstEditorOpenAt` — если null, показываем tooltip и записываем
   - Контент: «Кликни на фото или текст чтобы редактировать. Ctrl+Z для отмены. Перетягивай фото из правой панели в макет.»
   - Кнопка «Понял» закрывает

2. **Keyboard shortcuts help:**
   - Кнопка `?` в header (или клавиша `?` глобально)
   - Открывает модал со списком:
     - Ctrl+Z / Cmd+Z — отмена
     - Ctrl+Shift+Z — повтор
     - Esc — снять выделение
     - ← → — переключение разворотов (стрелки если фокус не в textarea)
     - Ctrl+S / Cmd+S — принудительное сохранение
     - Правый клик на фото — меню действий

3. **Стрелки ← → для навигации между разворотами:**
   - Глобальный keydown handler
   - Не срабатывает если фокус в textarea/input
   - Стрелка влево → setCurrentIdx(i => Math.max(0, i - 1))
   - Стрелка вправо → setCurrentIdx(i => Math.min(spreads.length - 1, i + 1))

4. **Audit log на основные действия:**
   - `layout.opened` при загрузке редактора
   - `layout.text_edited` при сохранении изменённого текста
   - `layout.photo_replaced` при замене фото
   - `layout.original_replaced` при замене оригинала
   - `layout.saved` уже пишется в `save_album_layout`?  Проверить — если нет, добавить

**Файлы:**
- `app/app/album/[id]/layout/_components/OnboardingTooltip.tsx` — НОВЫЙ
- `app/app/album/[id]/layout/_components/KeyboardShortcutsModal.tsx` — НОВЫЙ
- `app/app/album/[id]/layout/page.tsx` — навигация стрелками, кнопка ?
- `app/api/layout/route.ts` — audit log записи в `save_album_layout`

**Критерии приёмки Л.5:**
- ☑ При первом открытии — tooltip с инструкцией
- ☑ После закрытия tooltip больше не появляется (localStorage)
- ☑ Кнопка `?` в header открывает модал с шорткатами
- ☑ Стрелки ← → переключают развороты (не в textarea!)
- ☑ Audit log пишет действия

---

## 5. Технические решения

### Inline text editor — точное совпадение стилей

Это тонкое место. Konva рисует текст с одним набором правил (line-height, kerning), а HTML textarea — с другим. Если стили не совпадут точно — при клике текст «прыгнет».

**Решение:**
- `font-family` — копируем 1:1 из placeholder.font_family
- `font-size` — конвертация pt→px через `pt * PT_TO_MM / mm_per_pixel`
- `padding: 0`, `border: 0`, `outline: 0`, `background: transparent`
- `line-height` — пробуем default (1.0 или 1.2), при заметных скачках — фиксируем явный вычисленный
- `text-align` — копируем из placeholder.align
- `color` — копируем с учётом `isTooLight()` fallback из существующего кода
- Position — `position: absolute` с `top/left/width/height` в пикселях (scale-aware, как DropZone)

При неточном совпадении (выявленном на тесте) — добавляем корректирующий offset.

### Контекстное меню

Используем native browser `oncontextmenu` event. Из event берём `clientX/clientY` и позиционируем popover. Закрытие на клик вне или Esc.

### Защита прав на сервере

Существующий `save_album_layout` сейчас даёт сохранять любому owner/manager. В Л.4 расширяем:
- Проверка `album.workflow_status` — если submitted/in_production/delivered и роль не superadmin → 403
- Проверка view_as — если query param view_as есть и роль не superadmin → 403 (save_album_layout НЕ принимает view_as, в отличие от GET load)

### Мобильная стратегия

Mobile-flag через `window.matchMedia('(min-width: 768px)')` + слушаем `change`. Полная подмена UI ниже 768px. Конкретные devices: iPhone 13 mini = 375px (mobile), iPad mini = 768px (граница), iPad = 1024px (desktop).

---

## 6. Риски

| Риск | Митигация |
|---|---|
| Inline-edit стили не совпадут с Konva → прыжок текста | На каждом разворачивании текстового поля — пиксельная сверка через DevTools. Корректирующий offset если надо. |
| Контекстное меню перехватит native browser menu (там есть «Save Image As...») | Принимается — в редакторе native меню не нужно. Esc или клик вне закрывает popover. |
| Текстовые placeholder'ы есть не во всех мастерах одинаково — partнёр может удалить весь текст ФИО → пустой слот | Это by design. PDF-export рендерит пустой текст как пустой. Если партнёр потерял — Ctrl+Z или «Пересобрать макет». |
| Замена оригинала может конфликтовать с фазой К | Используем тот же rebind_retouched action — конфликта нет. UI просто новая точка входа. |
| Mobile view-only может ввести в заблуждение партнёра «почему ничего не работает» | Большое сообщение «Откройте на компьютере» + кнопка «Скопировать ссылку» чтобы партнёр мог переслать себе на ПК |

---

## 7. План коммитов

```
Л.0  docs(Л.0): спецификация фазы Л v2 — доделка существующего
Л.1a feat(Л.1a): TextDropZone в AlbumSpreadCanvas (hover, click handler)
Л.1b feat(Л.1b): TextInlineEditor — textarea-оверлей с точными стилями
Л.2a feat(Л.2a): PhotoContextMenu (Очистить, Заменить из палитры)
Л.2b feat(Л.2b): «Загрузить новое фото» из редактора
Л.2c feat(Л.2c): «Заменить оригинал» через rebind_retouched
Л.3  feat(Л.3): undo/redo (Ctrl+Z) через useEditorHistory
Л.4a feat(Л.4a): read-only после submitted + view_as
Л.4b feat(Л.4b): mobile view-only режим
Л.4c feat(Л.4c): бейдж «редактировался» в карточке Обзора + edited_at
Л.5a feat(Л.5a): onboarding tooltip + клавиши ← → для навигации
Л.5b feat(Л.5b): keyboard shortcuts modal + audit log
Л.6  docs(Л.6): контекст v55 — фаза Л закрыта
```

13 коммитов ожидаемо. Каждый деплоится независимо.

---

## 8. Что после Л

1. **Тестирование с реальным альбомом** — Сергей прогоняет полный цикл
2. **🔵 Фаза М** — расширения редактора (перетаскивание разворотов, замена шаблона, добавление/удаление, версии в БД, touch-events, виртуализация палитры)
3. **🔵 Фаза Н** — комментарии клиента на разворотах
4. **⏳ Фазы Г/Е/Д** — типография/обложка/размеры (ждут дизайнера)
5. **🟢 Бэкфилл оригиналов** для старых альбомов

После Л + Г + Е партнёрка полностью готова к запуску.
