# Фаза 3 — PDF-экспорт layout'ов

**Дата:** 10.05.2026
**Версия:** 1 (после ответов на 6 open questions + 4 уточнения)
**Статус:** черновик, готов к началу разработки

---

## 1. Цель

Партнёр после автосборки и ручной правки layout'а (фаза 2) может одной
кнопкой выгрузить альбом в PDF — типографского качества, готовый к
печати. Реальные шрифты (не Arial fallback), фото в высоком разрешении
из оригиналов, корректные размеры и bleed для типографии.

Архитектура поддерживает несколько **профилей экспорта** — print
(типография, 300 dpi, 30-80 МБ) и client-preview (для согласования с
клиентом, 150 dpi, 5-10 МБ). Расширение списка профилей — конфигурацией
в БД, без изменений кода.

Параллельно подключаются настоящие шрифты в редактор (`@font-face`
Geologica) — Konva начинает рисовать как InDesign.

## 2. Что НЕ входит в фазу 3

Выделено в самостоятельные фазы для контроля скоупа:

- **Per-student PDF-режим** — фаза 3.A (после уточнения у дизайнера про
  конкретные требования типографий: P1/P2/P3). Архитектура заложена
  через `child_ids[]` в SpreadInstance + stub-профиль
  `okeybook-per-student` возвращающий 501.
- **Обложки** — фаза 4. Требует отдельного template_set
  `okeybook-cover-default` с cover-мастерами от дизайнера, отдельного
  cover-engine, mini-canvas редактора. Архитектура `export_profiles`
  поддержит cover-профили без переделки фазы 3.
- **Фоны разворотов** — фаза 4. `background_url` в `spread_templates`
  всегда null после фазы 3; PDF builder уже умеет рисовать background
  как первый слой если url не null — поэтому в фазе 4 при заполнении
  url'ов фоны появятся автоматически.
- **Retouch workflow Вариант A** (multi-upload оригиналов по filename) —
  фаза 3.B, после фазы 3 или параллельно.
- **JPG-pages driver** для типографий типа Фабрика Фотокниг — фаза 3.X
  по запросу. Архитектура `export_profiles.format` поддерживает,
  но реализован только PDF driver.
- **CMYK конверсия** — параметр `color_mode` в схеме есть, реализуется
  только RGB. Если конкретная типография потребует — час работы через
  sharp + ICC профиль.
- **Crop marks / registration / color bars** — современные RIP-системы
  типографии добавляют сами при импозиции. Если потребуется — параметр
  экспорта.
- **Async-генерация с polling** — фаза 3.X если упрёмся в таймауты.
  В MVP sync с лимитом 80 разворотов.
- **Inline-edit текста в редакторе** — фаза 4 (затрагивает
  родительский флоу).
- **ИИ-цветокор / ИИ-ретушь** — фаза 5+, стратегическая интеграция
  (Imagen AI / Aftershoot AI / собственная модель).

---

## 3. Архитектура

### 3.1 Что меняется в БД

Три миграции, все аддитивные:

```sql
-- migrations/2026-05-10-export-profiles.sql
CREATE TABLE export_profiles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid REFERENCES tenants(id) ON DELETE CASCADE,
  slug            text NOT NULL,
  name            text NOT NULL,
  is_default      boolean NOT NULL DEFAULT false,
  purpose         text NOT NULL CHECK (purpose IN ('typography','preview')),
  format          text NOT NULL CHECK (format IN ('pdf','jpg-pages')),
  quality         text NOT NULL CHECK (quality IN ('high','medium','preview')),
  include_bleed   boolean NOT NULL DEFAULT true,
  color_mode      text NOT NULL DEFAULT 'rgb' CHECK (color_mode IN ('rgb','cmyk')),
  dpi             integer NOT NULL DEFAULT 300,
  jpeg_quality    integer NOT NULL DEFAULT 92,
  filename_template text NOT NULL DEFAULT '{album_name}_{date}.{ext}',
  pages_mode      text NOT NULL DEFAULT 'all_common'
                    CHECK (pages_mode IN ('all_common','per_student','per_student_individual_only')),
  target_size_mb  integer,
  enabled         boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX export_profiles_tenant_slug
  ON export_profiles (COALESCE(tenant_id::text, 'global'), slug);

-- migrations/2026-05-10-album-exports.sql
CREATE TABLE album_exports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id        uuid NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  profile_id      uuid NOT NULL REFERENCES export_profiles(id) ON DELETE RESTRICT,
  storage_path    text NOT NULL,
  filename        text NOT NULL,
  file_size       bigint NOT NULL,
  page_count      integer NOT NULL,
  layout_snapshot jsonb NOT NULL,
  warnings        jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL REFERENCES users(id),
  expires_at      timestamptz NOT NULL
);
CREATE INDEX album_exports_album_id ON album_exports (album_id, created_at DESC);
CREATE INDEX album_exports_expires_at ON album_exports (expires_at);

-- migrations/2026-05-10-okeybook-default-bleed.sql
UPDATE template_sets SET bleed_mm = 5 WHERE slug = 'okeybook-default';
```

**Seed профилей (3 глобальных):**

```sql
-- В migrations/2026-05-10-export-profiles-seed.sql
INSERT INTO export_profiles (slug, name, is_default, purpose, format, quality,
  include_bleed, dpi, jpeg_quality, filename_template, pages_mode) VALUES
('okeybook-print',          'Печать (типография)',  true,  'typography', 'pdf', 'high',
   true,  300, 92, '{album_name}_{date}.pdf', 'all_common'),
('okeybook-client-preview', 'Превью для клиента',   false, 'preview',    'pdf', 'preview',
   false, 150, 80, '{album_name}_preview_{date}.pdf', 'all_common'),
('okeybook-per-student',    'Индивидуальные комплекты (в разработке)', false, 'typography', 'pdf', 'high',
   true,  300, 92, '{student_name}_{album_name}.pdf', 'per_student');
```

Третий профиль создаётся для UI-видимости, но при выборе endpoint
возвращает 501 Not Implemented — реализация в фазе 3.A.

### 3.2 Изменение типов SpreadInstance

В `lib/album-builder/types.ts` добавляется опциональное поле:

```typescript
export type SpreadInstance = {
  spread_index: number;
  template_id: string;
  template_name: string;
  data: Record<string, string | null>;
  child_ids?: string[]; // ← новое: null/undefined = общий разворот
                        //         [child_id] = индивидуальный
                        //         [a, b]     = разделяемый между двумя (Стандарт E-Student-Standard)
};
```

В фазе 3 поле существует, но НЕ заполняется builder'ом и НЕ
используется PDF-engine'ом. Заполнение и использование — фаза 3.A.
Это важно: миграция типов в фазе 3.A не требует изменения структуры
JSON в `album_layouts.spreads`.

### 3.3 Frontend структура

```
app/app/
  page.tsx                                — фикс URL ?album= (3.0)
  _components/
    AlbumSpreadCanvas.tsx                 — Geologica fontFamily (3.8)
    ExportPanel.tsx                       — 🆕 dropdown профилей + кнопка + история (3.7)
  album/
    [id]/
      layout/
        page.tsx                          — Geologica fontFamily (3.8)
public/fonts/
  Geologica-Regular.ttf                   — 🆕 (3.5)
  Geologica-Bold.ttf                      — 🆕 (3.5)
  Geologica-Italic.ttf                    — 🆕 (3.5)
app/globals.css                           — 🆕 @font-face Geologica (3.8)
```

### 3.4 Backend структура

```
lib/pdf-export/
  index.ts                                — 🆕 публичный API: exportAlbumPdf
  pipeline.ts                             — 🆕 orchestrator: layout → PDF Bytes
  font-loader.ts                          — 🆕 loadFonts() в pdf-lib
  photo-embed.ts                          — 🆕 lookup оригинала + sharp resample
  text-shaping.ts                         — 🆕 line wrap, auto_fit, vertical_align
  units.ts                                — 🆕 mm↔pt + bleed/trim/media boxes
  types.ts                                — 🆕 ExportProfile, ExportContext, PdfWarning
app/api/layout/route.ts                   — 🆕 action=export, list_export_profiles, list_album_exports
app/api/tenant/route.ts                   — без изменений
```

### 3.5 Backend endpoints

| Endpoint | Что делает | Уже есть |
|---|---|---|
| `GET /api/layout?action=album_layout` | Загрузка layout'а | ✅ фаза 1.4 |
| `GET /api/layout?action=list_export_profiles` | 🆕 Список доступных профилей для UI | 🆕 фаза 3.6 |
| `GET /api/layout?action=list_album_exports&album_id=X` | 🆕 История экспортов альбома | 🆕 фаза 3.6 |
| `POST /api/layout?action=export` | 🆕 Запуск экспорта (sync, лимит 80 spreads) | 🆕 фаза 3.6 |

### 3.6 Поток данных

```
Партнёр в Обзоре альбома видит ExportPanel:
  → GET ?action=list_export_profiles    → 3 профиля
  → GET ?action=list_album_exports      → последние 10 экспортов
  → выбирает профиль okeybook-print
  → клик «Экспортировать»

POST /api/layout?action=export {album_id, profile_slug=okeybook-print}
  → assertAlbumAccess (с поддержкой view_as)
  → load профиль (если pages_mode=per_student → 501)
  → load album_layout, template_set, album_input (children, teachers, photos)
  → проверка: spreads.length <= 80, иначе 400 «слишком большой альбом»
  → exportAlbumPdf(layout, templateSet, albumInput, profile)
      → for each spread:
        → resolve placeholders (data values + template positions)
        → for photo placeholders:
          → lookup original by filename
          → sharp resample к dpi профиля + cover crop
          → fallback на selection WebP + warning
        → for text placeholders:
          → embed font → measure → line wrap → draw
        → draw page (mediaBox = page + bleed×2, trimBox = page)
      → save PDF Bytes
  → upload в YC: album_id/exports/<timestamp>_<profile_slug>.pdf
  → INSERT в album_exports (с layout_snapshot)
  → audit_log
  → return { export_id, download_url (presigned 1h), warnings, file_size }

UI:
  → показывает прогресс «Экспортируется...» (sync request)
  → при ответе → presigned download URL открывается в новой вкладке
  → ExportPanel обновляет историю экспортов
```

---

## 4. Детальные спецификации

### 4.1 Photo embedding pipeline (3.4)

**Самый критичный pipeline — определяет качество финального PDF.**

Входные данные на каждый photo placeholder:
- `placeholder.x_mm, y_mm, width_mm, height_mm` — позиция и размер рамки
- `placeholder.label` — `studentPhoto`, `headTeacherPhoto`, `friendPhoto_1` и т.д.
- `data[label]` — `photo_id` от builder'а или `null` (если slot пустой)
- `profile.dpi` — 300 (high) / 150 (medium) / native (preview)
- `profile.jpeg_quality` — 92 / 80 / 80

**Алгоритм:**

```typescript
async function embedPhoto(
  ctx: ExportContext,
  placeholder: Placeholder,
  photoId: string | null
): Promise<PdfImage | null> {
  if (!photoId) return null  // пустой слот, рамка не рисуется

  // 1. Найти запись о фото в albumInput
  const photo = ctx.albumInput.photos.find(p => p.id === photoId)
  if (!photo) {
    ctx.warnings.push({code: 'photo_not_found', detail: photoId})
    return null
  }

  // 2. Вычислить целевое разрешение
  const targetWidthPx = Math.ceil(placeholder.width_mm * ctx.profile.dpi / 25.4)
  const targetHeightPx = Math.ceil(placeholder.height_mm * ctx.profile.dpi / 25.4)

  // 3. Lookup оригинала по filename (если профиль quality='high')
  let imageBuffer: Buffer | null = null
  let source: 'original' | 'selection' = 'selection'

  if (ctx.profile.quality !== 'preview') {
    const original = await findOriginalByFilename(ctx.albumId, photo.filename)
    if (original) {
      imageBuffer = await downloadFromYc(original.storage_path)
      source = 'original'
    }
  }

  // 4. Fallback на selection WebP
  if (!imageBuffer) {
    imageBuffer = await downloadFromYc(photo.storage_path)
    source = 'selection'
    if (ctx.profile.quality === 'high') {
      ctx.warnings.push({
        code: 'no_original',
        detail: `${photo.filename}: использован selection WebP вместо оригинала`
      })
    }
  }

  // 5. Sharp resample + cover crop
  const resampled = await sharp(imageBuffer)
    .rotate()  // авто-ориентация по EXIF
    .resize(targetWidthPx, targetHeightPx, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: ctx.profile.jpeg_quality, mozjpeg: true })
    .toBuffer()

  // 6. Embed в PDF
  return await ctx.pdfDoc.embedJpg(resampled)
}
```

**Personal spread фото** — обрабатываются отдельно. В фазе 3 они не входят
в `album_layouts.spreads` (это фаза 3.A). В фазе 3 PDF не включает personal
spread секцию.

**Связь selection ↔ original**: только по `filename`. БД не имеет FK
между `photos` и `original_photos`. Это намеренно: фотограф загружает
оригиналы независимо, и если он залил `DSC1234.jpg` — система автоматически
предполагает что это retouched версия selection с тем же filename.

**Warnings:**
- `photo_not_found` — критично, photo_id невалидный
- `no_original` — info, использован WebP fallback (мотивация партнёра
  загрузить оригиналы через retouch workflow фазы 3.B)

### 4.2 Font loading (3.2 + 3.5)

**Шрифты в репо:** `public/fonts/` — Geologica family (Regular, Bold,
Italic). Geologica — open-source через OFL license, можно коммитить
в репо. ~600 KB на все три файла.

**В Konva (3.8):** `app/globals.css`:

```css
@font-face {
  font-family: 'Geologica';
  src: url('/fonts/Geologica-Regular.ttf') format('truetype');
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: 'Geologica';
  src: url('/fonts/Geologica-Bold.ttf') format('truetype');
  font-weight: 700;
  font-display: swap;
}
@font-face {
  font-family: 'Geologica';
  src: url('/fonts/Geologica-Italic.ttf') format('truetype');
  font-style: italic;
  font-display: swap;
}
```

В `AlbumSpreadCanvas.tsx`: `fontFamily="Geologica, Arial, sans-serif"` —
fallback на Arial если шрифт не загрузился. Document.fonts.ready
ожидание перед измерениями текста — не делаем, Konva перерисует
автоматически при font-ready event.

**В PDF (3.2):** `lib/pdf-export/font-loader.ts`:

```typescript
export async function loadFonts(pdfDoc: PDFDocument): Promise<FontRegistry> {
  const regular = await pdfDoc.embedFont(
    await fs.readFile('public/fonts/Geologica-Regular.ttf'),
    { subset: true }
  )
  const bold = await pdfDoc.embedFont(
    await fs.readFile('public/fonts/Geologica-Bold.ttf'),
    { subset: true }
  )
  const italic = await pdfDoc.embedFont(
    await fs.readFile('public/fonts/Geologica-Italic.ttf'),
    { subset: true }
  )
  return {
    resolve(family: string, weight: string): PDFFont {
      // Все запросы Geologica → bold/italic/regular
      // Запросы других семейств → fallback на Geologica + warning
      if (family !== 'Geologica') {
        ctx.warnings.push({code: 'font_not_found', detail: family})
      }
      if (weight === 'bold' || weight === '700') return bold
      if (weight === 'italic') return italic
      return regular
    }
  }
}
```

`subset: true` — pdf-lib встраивает только использованные глифы (~50 KB
на семью вместо 600 KB).

### 4.3 Text rendering (3.5)

Каждый text placeholder в IDML имеет: `font_family`, `font_size_pt`,
`font_weight`, `color` (hex), `align` (left/center/right/justify),
`vertical_align` (top/middle/bottom), `auto_fit` (boolean),
`min_size_pt`.

**Алгоритм рендера:**

1. Резолв шрифта через FontRegistry.
2. Замер ширины текста при `font_size_pt`.
3. Если `text_width > placeholder.width_mm` И `auto_fit=true`:
   - Уменьшаем размер шрифта пока не влезет, минимум `min_size_pt`.
   - Если даже на min_size не влезает — line wrap по словам.
4. Если `auto_fit=false` И не влезает — line wrap.
5. Vertical_align: вычисляем где разместить block внутри placeholder
   bounding box.
6. Draw текст через `page.drawText(line, {x, y, font, size, color})`.

**Нюанс кириллицы:** Geologica поддерживает кириллицу полностью. Если
будут проблемы — fallback на Inter (тоже cyrillic-complete).

### 4.4 Профили экспорта и схема (3.1, 3.7)

**Поля профиля:**

| Поле | Типография | Превью | Per-student |
|---|---|---|---|
| `purpose` | typography | preview | typography |
| `format` | pdf | pdf | pdf |
| `quality` | high | preview | high |
| `include_bleed` | true | false | true |
| `dpi` | 300 | 150 | 300 |
| `jpeg_quality` | 92 | 80 | 92 |
| `filename_template` | `{album_name}_{date}.pdf` | `{album_name}_preview_{date}.pdf` | `{student_name}_{album_name}.pdf` |
| `pages_mode` | all_common | all_common | per_student |

**Filename templates** — поддерживаются переменные:
- `{album_name}` — название альбома (slugified, замена пробелов на _)
- `{date}` — `YYYY-MM-DD`
- `{datetime}` — `YYYY-MM-DD_HH-MM`
- `{student_name}` — для per-student режима (фаза 3.A)
- `{ext}` — `pdf` / `jpg`
- Если в один день несколько экспортов — добавляется `_2`, `_3`

**`pages_mode='all_common'`** в фазе 3 — единственный реализованный.
Остальные режимы — фаза 3.A (per-student) и не делаются.

### 4.5 Endpoint POST /api/layout?action=export (3.6)

**Запрос:** `{album_id: uuid, profile_slug: string}`

**Авторизация:** owner/manager/viewer тенанта альбома, или
superadmin/staff main с `view_as`.

**Validation:**
- `album_id` — uuid
- профиль существует и `enabled=true`
- альбом имеет `album_layouts` запись с `spreads.length > 0`
- `spreads.length <= 80`
- если `profile.pages_mode != 'all_common'` → **501** с body:
  `{error: 'Per-student режим в разработке (фаза 3.A)'}`

**Execution:**

```typescript
const result = await exportAlbumPdf({
  album, layout, templateSet, albumInput, profile
})
// result: { pdfBytes: Buffer, pageCount: number, warnings: PdfWarning[] }

const filename = renderFilename(profile.filename_template, { album, date })
const storagePath = `${album.id}/exports/${timestamp}_${profile.slug}.pdf`
await ycUpload(storagePath, result.pdfBytes, 'application/pdf')

const record = await supabase.from('album_exports').insert({
  album_id, tenant_id, profile_id: profile.id,
  storage_path: storagePath, filename,
  file_size: result.pdfBytes.length,
  page_count: result.pageCount,
  layout_snapshot: layout.spreads,
  warnings: result.warnings,
  created_by: auth.userId,
  expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
}).select().single()

const downloadUrl = await getPresignedDownloadUrl(storagePath, 3600)

return { export_id: record.id, download_url: downloadUrl,
         warnings: result.warnings, file_size: result.pdfBytes.length,
         filename }
```

**Timeouts:** Vercel sync limit 60s (free), 300s (pro). Sharp + pdf-lib
~1 секунда на разворот с 4-6 фото. Лимит 80 spreads = до 80 секунд.
На pro укладывается, на free возможны таймауты для крупных альбомов —
warning в UI «при таймауте — повторите попытку, экспорт сохраняется
после первого успешного завершения». Per-student async-режим = фаза 3.X.

### 4.6 ExportPanel компонент (3.7)

В Обзоре альбома, **под** LayoutPreviewStrip, новый блок:

```
┌──────────────────────────────────────────┐
│ ЭКСПОРТ                                  │
│                                          │
│ Профиль: [Печать (типография) ▾]         │
│   ⓘ 30-80 МБ, 300 dpi, с обрезной зоной  │
│                                          │
│ [📄 Экспортировать PDF]                  │
│                                          │
│ ─────────────────────────────────────    │
│ ИСТОРИЯ ЭКСПОРТОВ                        │
│ • 10.05.2026 14:32 · Печать · 47 МБ ⬇    │
│ • 10.05.2026 13:08 · Превью · 8 МБ  ⬇    │
│ • 09.05.2026 18:45 · Печать · 45 МБ ⬇    │
└──────────────────────────────────────────┘
```

Состояния:
- **Нет layout'а** → блок скрыт (нечего экспортировать)
- **Есть layout, has_user_edits=false** → подсказка «Layout собран
  автоматически. Рекомендуем проверить в редакторе перед экспортом.»
- **Загружается** → spinner, кнопка disabled
- **Successs** → toast «PDF готов» + auto-открытие presigned URL в
  новой вкладке + обновление истории

История экспортов — **последние 10 записей**, presigned URL генерится
по клику (не at-list-load, чтобы не спамить sigv4).

---

## 5. План коммитов

| # | Что | Файлы | Сообщение |
|---|---|---|---|
| 3.0 | URL hygiene: фикс `?album=` query при закрытии модала | `app/app/page.tsx` | `fix(layout/3.0): очистка ?album= при закрытии модала` |
| 3.1 | Миграции БД: export_profiles + album_exports + bleed_mm | `migrations/2026-05-10-*.sql`, схема | `feat(layout/3.1): миграции export_profiles + album_exports + bleed=5` |
| 3.2 | Фундамент `lib/pdf-export/`: типы, units, font-loader, sharp wrapper, pdf-lib обёртка | `lib/pdf-export/{types,units,font-loader,index}.ts`, `public/fonts/Geologica-*.ttf`, `package.json` (+ pdf-lib, sharp) | `feat(layout/3.2): фундамент lib/pdf-export (pdf-lib + sharp + Geologica)` |
| 3.3 | PDF Engine: рендер spread'а — page setup + iterate placeholders + background_url | `lib/pdf-export/pipeline.ts` | `feat(layout/3.3): PDF engine рендера разворота` |
| 3.4 | Photo embedding pipeline: lookup оригинала + sharp resample + fallback | `lib/pdf-export/photo-embed.ts` | `feat(layout/3.4): photo embedding с sharp resample` |
| 3.5 | Text rendering: line wrap + auto_fit + vertical_align + цвета | `lib/pdf-export/text-shaping.ts` | `feat(layout/3.5): text rendering с line wrap и auto_fit` |
| 3.6 | API: POST `?action=export` + GET `?action=list_export_profiles` + `list_album_exports` | `app/api/layout/route.ts` | `feat(layout/3.6): endpoint POST /api/layout?action=export` |
| 3.7 | UI: ExportPanel в Обзоре альбома | `app/app/_components/ExportPanel.tsx`, `app/app/page.tsx` | `feat(layout/3.7): ExportPanel — UI экспорта PDF` |
| 3.8 | Шрифты в Konva: `@font-face` Geologica + замена fallback Arial | `app/globals.css`, `app/app/_components/AlbumSpreadCanvas.tsx`, `app/app/album/[id]/layout/page.tsx` | `feat(layout/3.8): Geologica в Konva (редактор + LayoutPreviewStrip)` |
| 3.9 | E2E smoke на реальном альбоме + дебаг «теста» из v44 | (ad-hoc) | `fix(layout/3.9): дебаг теста + e2e smoke PDF-экспорта` |
| 3.10 | Контекст v45 + закрытие фазы 3 | `yearbook-context-v45.md` | `docs(layout/3.10): контекст v45 — фаза 3 PDF-экспорт закрыта` |

Промежуточные `.X.1` фиксы добавляются по ходу — как было в фазах 1 и 2.

---

## 6. Критерии приёмки фазы 3

### 6.1 Функциональные

- ✅ Партнёр в Обзоре альбома видит ExportPanel с двумя профилями
  (Печать и Превью).
- ✅ Клик «Экспортировать» с профилем `okeybook-print` создаёт PDF
  размером 30-80 МБ для альбома с 30 разворотов и 100+ фото.
- ✅ Клик с профилем `okeybook-client-preview` создаёт PDF 5-10 МБ
  без bleed.
- ✅ В PDF используется реальный шрифт Geologica (виден визуально).
- ✅ Размер PDF страницы соответствует mediaBox = page + 5мм bleed
  для print, page exactly для preview.
- ✅ Фото в PDF берутся из `original_photos` если найдены по filename;
  иначе fallback на selection WebP с warning.
- ✅ Sharp resample гарантирует что embedded JPEG не больше 300 dpi
  для целевой рамки (т.е. фото 6000×9000 в рамке 80×100 мм → 945×1181 пикс).
- ✅ В Обзоре после экспорта появляется запись в истории экспортов
  с download URL.
- ✅ Presigned URL валиден 1 час, файлы хранятся 90 дней.
- ✅ В Konva-редакторе и в LayoutPreviewStrip текст рисуется шрифтом
  Geologica (а не Arial fallback).
- ✅ URL `?album=UUID` корректно очищается при закрытии модала.

### 6.2 Технические

- ✅ TypeScript: `npx tsc --noEmit --project .` — пусто.
- ✅ Build: `npx next build` (с fake env) — зелёный.
- ✅ Лимит spreads.length ≤ 80 проверяется на сервере, при превышении
  возвращается 400 с понятной ошибкой.
- ✅ Профиль `okeybook-per-student` возвращает 501 с текстом про
  фазу 3.A.
- ✅ Audit log пишется на каждый экспорт (action=`album_export.create`).
- ✅ View_as поддерживается — менеджер OkeyBook может экспортировать
  PDF от имени партнёра.

### 6.3 Качество PDF

- ✅ Печатный PDF при открытии в Adobe Acrobat показывает корректный
  TrimBox и BleedBox.
- ✅ Все фото — в JPG, sRGB, не больше 300 dpi.
- ✅ Шрифты embedded и subsetted (проверка через Acrobat → Properties → Fonts).
- ✅ Текст selectable (не растрирован).
- ✅ Размер файла соответствует ожиданиям (см. 6.1).

### 6.4 UX

- ✅ Прогресс экспорта виден (spinner + текст «Экспортируется...»).
- ✅ Warning'и из экспорта показываются после успеха (например
  «5 фото без оригинала, использованы сжатые версии»).
- ✅ История экспортов сортирована по убыванию даты.
- ✅ Кнопка экспорта disabled пока layout не собран (`spreads.length === 0`).

---

## 7. Open вопросы (на потом)

### 7.1 Per-student PDF — фаза 3.A

Ждём ответа дизайнера про P1/P2/P3 и про конкретные требования
типографий с которыми работает OkeyBook. Тогда решим:
- Один PDF с разделителями (P1)
- N отдельных PDF в ZIP (P2)
- N отдельных PDF только индивидуальной части (P3)
- Или несколько профилей под разные сценарии

Подготовка: SpreadInstance уже имеет `child_ids?: string[]` (поле
существует в типе с фазы 3, но не заполняется). В фазе 3.A:
1. Smart-fill начинает заполнять `child_ids` для индивидуальных мастеров
2. PDF builder фильтрует spreads по `child_id` для per-student режима
3. Personal_spread инжектится в album_layouts.spreads с `child_ids=[X]`
   (или остаётся отдельной секцией, решается в 3.A)

### 7.2 Обложки — фаза 4

В фазе 3 не делаем. Архитектура `export_profiles` готова к добавлению
профилей `okeybook-cover-print` и подобных. В фазе 4:
1. Импорт IDML с cover-мастерами в новый template_set `okeybook-cover-default`
2. Cover smart-fill (из `cover_selections` родителей)
3. Cover editor (mini-canvas, отдельная страница)
4. Cover PDF driver — переиспользует pipeline из фазы 3 для одного
   разворота обложки

### 7.3 Async экспорт с polling — фаза 3.X при необходимости

Если упрёмся в Vercel timeout для альбомов 60+ разворотов, или после
переезда на свой хостинг:
1. POST `?action=export` возвращает 202 + job_id
2. Worker (отдельный процесс или Vercel cron) делает экспорт в фоне
3. Клиент GET `?action=export_status&job_id=X` каждые 2 секунды
4. По готовности — download URL

В MVP не делаем, sync с лимитом 80 spreads.

### 7.4 JPG-pages driver — фаза 3.X по запросу

Когда конкретная типография потребует JPG страниц с определёнными
именами (Фабрика Фотокниг и т.д.):
1. В `lib/pdf-export/` добавляется параллельный driver `jpg-pages.ts`
2. Endpoint смотрит на `profile.format` и выбирает driver
3. Output — ZIP архив + manifest.txt
4. ~5-7 часов работы

### 7.5 ИИ-цветокор / ИИ-ретушь — фаза 5+

Стратегическая интеграция:
- Imagen AI / Aftershoot AI / собственный pipeline
- Партнёр настраивает API key типа сервиса
- После закрытия отбора — авто-ретушь selected фото
- Загрузка обратно в `original_photos` системой

Сейчас вне скоупа. Если конкуренты (Wfolio) вырастут на этой фиче
быстро — пересмотрим приоритет.

### 7.6 CMYK для требовательных типографий — фаза 3.X

Если конкретная типография не примет RGB:
1. В `export_profiles.color_mode='cmyk'` уже поддерживается схемой
2. Sharp + ICC профиль (например ISO Coated v2) → конвертация JPEG в CMYK
3. pdf-lib `setFillColor` принимает CMYK, минимальные изменения в text-shaping
4. ~3-4 часа работы

### 7.7 Crop marks / registration — фаза 3.X по запросу

Если конкретная типография не работает с RIP-системой имеющей авто-impose:
1. В `export_profiles.extras.crop_marks=true` — флаг
2. PDF builder рисует crop marks и registration marks в bleed-зоне
3. ~1 час работы

### 7.8 Дебаг «теста» из v44

В альбоме «тест» (id=`54bf48ee-5501-4c7f-a66a-1e8f8d2fc20e`) первый
spread на превью показывает только левую часть учительского разворота
вместо двух. Гипотезы:
- Smart-fill подобрал `F-Head-WithPhoto-R` (mirror_for_soft) вместо
  двухстраничного `F-Head-WithPhoto + G-...`
- ИЛИ канвас рендерит spread, но один placeholder имеет некорректные
  координаты

Дебаг — в подэтапе 3.9 одновременно с E2E smoke. Если найдём
системный баг — фикс отдельным коммитом.
