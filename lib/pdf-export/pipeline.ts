/**
 * PDF rendering pipeline (фаза 3.3).
 *
 * Orchestrator: для каждого SpreadInstance из `layout.spreads`
 * находит SpreadTemplate в template_set и вызывает renderSpread,
 * который добавляет 1 или 2 страницы в PDFDocument.
 *
 * Что в фазе 3.3:
 *   - Page setup: mediaBox = trim + 2×bleed, TrimBox/BleedBox
 *   - Iterate placeholders, drawing stubs:
 *     · photo / oval (circle photo) → серый прямоугольник
 *     · text → drawText без line wrap, базовый vertical=top
 *   - Двухстраничные мастера (is_spread=true) разделяются на
 *     2 страницы: левая (x_mm < page_w), правая (x_mm >= page_w
 *     с пересчётом x_mm -= page_w).
 *   - Rotation поддерживается через rotate: degrees(rotation_deg).
 *   - Warnings: template_not_found, placeholder_off_page.
 *
 * Что в фазе 3.4 (следующий подэтап):
 *   - Photo embedding: lookup оригинала по filename, sharp resample,
 *     embedJpg, замена серых заглушек на реальные фото.
 *
 * Что в фазе 3.5:
 *   - Text shaping: line wrap, auto_fit, vertical_align.
 *
 * Что в фазе 4:
 *   - Background images разворотов (background_url из БД).
 *
 * См. docs/phase-3-spec.md §3.4, §4.1 (фаза 3.4), §4.3 (фаза 3.5).
 */

import { PDFDocument, PDFImage, PDFPage } from 'pdf-lib';
import { computePageBoxes, mmToPt } from './units';
import type { FontRegistry } from './font-loader';
import { embedPhotoOnPage, type PhotoEmbedContext } from './photo-embed';
import { drawTextShaped } from './text-shaping';
import { parseScale, parseOffset, parseRotate } from '@/lib/photo-transform';
import { parseFontSizeMult, parseColor } from '@/lib/text-style';
import { applyBalanceFromData } from '@/lib/balance-overrides';
import { segmentToSpreads } from '@/lib/album-builder/segment-to-spreads';
import type {
  AlbumExportInput,
  PageBoxes,
  PdfWarning,
  SpreadInstance,
  SpreadTemplate,
} from './types';
import type {
  Placeholder,
  PhotoPlaceholder,
  TextPlaceholder,
} from '@/lib/album-builder/types';

/**
 * Контекст рендера, передаваемый между функциями pipeline.
 * Накапливает warnings, держит ссылку на FontRegistry.
 */
type RenderContext = {
  pdfDoc: PDFDocument;
  fontRegistry: FontRegistry;
  pageBoxes: PageBoxes;
  warnings: PdfWarning[];
  /** Профиль экспорта (для spread_export флага и других решений рендера). */
  profile: AlbumExportInput['profile'];
  /** Подконтекст для photo-embed (передаётся в embedPhotoOnPage). */
  photoCtx: PhotoEmbedContext;
  /**
   * Embed'нутая картинка фона набора (template_sets.default_background_url).
   * null = фон не задан или не загрузился — рисуем без подложки.
   */
  background: PDFImage | null;
  /**
   * Сторона разворота для одностраничного мастера (pageHint='single'):
   * 'left' — фон смещаем так, чтобы видна была левая половина разворота;
   * 'right' — наоборот. Считается через segmentToSpreads до рендера.
   * Для is_spread мастеров не используется (pageHint='spread' либо
   * split на 'left'/'right' в renderSpread уже несёт нужную семантику).
   */
  sideByIndex: ReadonlyMap<number, 'left' | 'right'>;
};

/**
 * Главная функция pipeline'а — рендерит все SpreadInstance в PDFDocument.
 *
 * @returns total page count (для записи в album_exports.page_count)
 */
export async function renderAllSpreads(
  pdfDoc: PDFDocument,
  fontRegistry: FontRegistry,
  input: AlbumExportInput
): Promise<{ pageCount: number; warnings: PdfWarning[] }> {
  const { layout, templateSet, profile } = input;
  const warnings: PdfWarning[] = [];

  const pageBoxes = computePageBoxes(
    templateSet.page_width_mm,
    templateSet.page_height_mm,
    templateSet.bleed_mm,
    profile.include_bleed
  );

  // PhotoEmbedContext shares pdfDoc/pageBoxes/warnings с RenderContext'ом.
  // Используем общий warnings array через передачу ссылки.
  const photoCtx: PhotoEmbedContext = {
    pdfDoc,
    pageBoxes,
    profile,
    originals: input.originals,
    urlToFilename: input.urlToFilename,
    warnings,
  };

  // Индекс мастеров для O(1) lookup'а (вместо .find() на каждый разворот).
  const templateById = new Map<string, SpreadTemplate>();
  for (const t of templateSet.spreads) {
    templateById.set(t.id, t);
  }

  // Фоновое изображение набора — embed один раз, переиспользуем на всех страницах.
  const background = await loadBackground(
    pdfDoc,
    templateSet.default_background_url ?? null,
    warnings,
  );

  // Карта spread_index → 'left'|'right' для одностраничных мастеров.
  // segmentToSpreads группирует страницы как в визуальном редакторе.
  // Для is_spread мастеров значение не пишется (фон у них рисуется как 'spread').
  // softShift пока всегда false — для soft-альбомов первая страница может
  // быть правой первого разворота, но это уточнение оставим следующей итерации
  // (сейчас типография обычно печатает в layflat/pages-mode, где это не критично).
  const sideByIndex = new Map<number, 'left' | 'right'>();
  if (background) {
    const visualSpreads = segmentToSpreads(layout.spreads, templateById);
    for (const vs of visualSpreads) {
      if (vs.isSpread) continue;
      if (vs.leftIdx !== undefined) {
        const leftSpread = layout.spreads[vs.leftIdx];
        if (leftSpread) sideByIndex.set(leftSpread.spread_index, 'left');
      }
      if (vs.rightIdx !== undefined) {
        const rightSpread = layout.spreads[vs.rightIdx];
        if (rightSpread) sideByIndex.set(rightSpread.spread_index, 'right');
      }
    }
  }

  const ctx: RenderContext = {
    pdfDoc,
    fontRegistry,
    pageBoxes,
    warnings,
    profile,
    photoCtx,
    background,
    sideByIndex,
  };

  let pageCount = 0;

  for (const instance of layout.spreads) {
    const template = templateById.get(instance.template_id);
    if (!template) {
      warnings.push({
        code: 'template_not_found',
        detail: `template_id=${instance.template_id} (${instance.template_name}) для spread_index=${instance.spread_index} не найден в template_set; разворот пропущен`,
        context: { spread_index: instance.spread_index },
      });
      continue;
    }
    pageCount += await renderSpread(ctx, instance, template);
  }

  return { pageCount, warnings };
}

/**
 * Рендер одного SpreadInstance в PDFDocument.
 *
 * Если template.is_spread=false → одна страница (все placeholders как есть).
 * Если template.is_spread=true:
 *   - profile.spread_export=true → одна ШИРОКАЯ страница (spread mode,
 *     для layflat / клиентского превью); placeholders как есть
 *   - profile.spread_export=false (дефолт) → две страницы (pages mode,
 *     стандарт типографии); placeholders делятся по середине разворота
 *
 * @returns количество добавленных страниц (1 или 2)
 */
async function renderSpread(
  ctx: RenderContext,
  instance: SpreadInstance,
  template: SpreadTemplate
): Promise<number> {
  // БТ.1.2/БТ.1.4: применяем балансировку (hidden + pos) до любого деления
  // на страницы. Использует shared модуль lib/balance-overrides — тот же
  // что AlbumSpreadCanvas, гарантирует согласованность preview ↔ PDF.
  const effectivePlaceholders = applyBalanceFromData(
    template.placeholders,
    instance.data,
  );

  if (!template.is_spread) {
    await renderPage(ctx, instance, template, effectivePlaceholders, 'single');
    return 1;
  }

  // Двухстраничный мастер. Два режима:
  if (ctx.profile.spread_export) {
    // Spread mode: одна широкая PDF-страница на весь разворот
    await renderPage(ctx, instance, template, effectivePlaceholders, 'spread');
    return 1;
  }

  // Pages mode (default): разрезаем по вертикальной середине разворота
  // на 2 PDF-страницы. Placeholders с x_mm < page_w_mm — на левую, остальные
  // на правую (с пересчётом x_mm на относительный).
  const page_w_mm = ctx.pageBoxes.trim_width_mm;
  const leftPlaceholders: Placeholder[] = [];
  const rightPlaceholders: Placeholder[] = [];
  for (const ph of effectivePlaceholders) {
    if (ph.x_mm < page_w_mm) {
      leftPlaceholders.push(ph);
    } else {
      rightPlaceholders.push({ ...ph, x_mm: ph.x_mm - page_w_mm } as Placeholder);
    }
  }

  await renderPage(ctx, instance, template, leftPlaceholders, 'left');
  await renderPage(ctx, instance, template, rightPlaceholders, 'right');
  return 2;
}

/**
 * Рендер одной PDF страницы.
 *
 * `pageHint` нужен только для warning context'ов (`'left' | 'right' | 'single'`).
 * На рендер не влияет.
 */
async function renderPage(
  ctx: RenderContext,
  instance: SpreadInstance,
  template: SpreadTemplate,
  placeholders: Placeholder[],
  pageHint: 'single' | 'left' | 'right' | 'spread'
): Promise<void> {
  const { pdfDoc, pageBoxes } = ctx;

  // Для spread mode размер страницы удваивается по ширине (spread_width_mm).
  // Bleed остаётся тот же (по 5мм со всех сторон).
  const isSpreadPage = pageHint === 'spread';
  const trim_w_mm = isSpreadPage
    ? pageBoxes.trim_width_mm * 2
    : pageBoxes.trim_width_mm;
  const trim_h_mm = pageBoxes.trim_height_mm;
  const media_w_mm = trim_w_mm + pageBoxes.bleed_mm * 2;
  const media_h_mm = pageBoxes.media_height_mm;

  const page = pdfDoc.addPage([mmToPt(media_w_mm), mmToPt(media_h_mm)]);

  // TrimBox/BleedBox только если печатаем с bleed (typography профиль).
  if (pageBoxes.bleed_mm > 0) {
    page.setTrimBox(
      mmToPt(pageBoxes.bleed_mm),
      mmToPt(pageBoxes.bleed_mm),
      mmToPt(trim_w_mm),
      mmToPt(trim_h_mm)
    );
    page.setBleedBox(0, 0, mmToPt(media_w_mm), mmToPt(media_h_mm));
  }

  // Фон набора — первый слой, под placeholder'ами.
  // Для одностраничных мастеров (pageHint='single') берём сторону из ctx.sideByIndex.
  if (ctx.background) {
    const bgSide: 'spread' | 'left' | 'right' =
      pageHint === 'spread'
        ? 'spread'
        : pageHint === 'left' || pageHint === 'right'
          ? pageHint
          : ctx.sideByIndex.get(instance.spread_index) ?? 'left';
    drawBackground(page, ctx.background, ctx.pageBoxes, trim_w_mm, bgSide);
  }

  // Для spread mode placeholderToPdfBox должна работать с увеличенной
  // шириной trim. Создаём локальный pageBoxes override для spread.
  const localPageBoxes = isSpreadPage
    ? { ...pageBoxes, trim_width_mm: trim_w_mm, media_width_mm: media_w_mm }
    : pageBoxes;
  const localCtx: RenderContext = isSpreadPage
    ? { ...ctx, pageBoxes: localPageBoxes, photoCtx: { ...ctx.photoCtx, pageBoxes: localPageBoxes } }
    : ctx;

  // Рисуем placeholders по порядку (sort_order из IDML).
  // Последовательно (await) — экономим RAM на sharp+fetch буферах.
  for (const ph of placeholders) {
    await drawPlaceholder(localCtx, page, ph, instance, pageHint);
  }
}

/**
 * Дисптачер по типу placeholder'а.
 *
 * Async с фазы 3.4 — drawPhoto делает fetch+sharp+embedJpg.
 */
async function drawPlaceholder(
  ctx: RenderContext,
  page: PDFPage,
  ph: Placeholder,
  instance: SpreadInstance,
  pageHint: string
): Promise<void> {
  // Проверка границ: placeholder выходит за страницу = warning + clip
  // (само рисование продолжается, pdf-lib не нарисует за mediaBox).
  if (
    ph.x_mm < 0 ||
    ph.y_mm < 0 ||
    ph.x_mm + ph.width_mm > ctx.pageBoxes.trim_width_mm + 0.5 || // допуск 0.5 мм
    ph.y_mm + ph.height_mm > ctx.pageBoxes.trim_height_mm + 0.5
  ) {
    ctx.warnings.push({
      code: 'placeholder_off_page',
      detail: `${instance.template_name} (${pageHint}): label=${ph.label} x=${ph.x_mm} y=${ph.y_mm} w=${ph.width_mm} h=${ph.height_mm} выходит за trim`,
      context: {
        spread_index: instance.spread_index,
        label: ph.label,
      },
    });
  }

  if (ph.type === 'photo') {
    await drawPhoto(ctx, page, ph, instance);
  } else {
    drawText(ctx, page, ph, instance);
  }
}

/**
 * Рендер фото placeholder'а: реальный embed через photo-embed.ts.
 *
 * С фазы 3.4 это уже не заглушка — мы lookup'аем оригинал по filename
 * (если quality='high'/'medium'), ресэмплим через sharp к нужному dpi,
 * и embed'им в PDF как JPEG. Поддерживаются прямоугольные и круглые
 * (is_circle=true) фоторамки.
 *
 * Если photo URL пустой — слот остаётся пустым (Konva рисует серый
 * прямоугольник, в PDF — ничего, чтобы не было визуального шума).
 * Если все попытки fetch+sharp упали — рисуется серый прямоугольник
 * как visual fallback (логика внутри embedPhotoOnPage).
 */
async function drawPhoto(
  ctx: RenderContext,
  page: PDFPage,
  ph: PhotoPlaceholder,
  instance: SpreadInstance
): Promise<void> {
  const photoUrl = instance.data[ph.label];
  // КЭ.7 — пробрасываем scale + offset из служебных ключей data.
  // parseScale/parseOffset возвращают (1, 0, 0) если ключи отсутствуют →
  // встроенная обратная совместимость: без transform-ключей crop как
  // раньше (sharp fit:'cover' для baseline).
  // Р.2 — пробрасываем __rotate__<label> (default 0 → без поворота).
  const scale = parseScale(instance.data[`__scale__${ph.label}`]);
  const [offsetX, offsetY] = parseOffset(instance.data[`__offset__${ph.label}`]);
  const rotateDeg = parseRotate(instance.data[`__rotate__${ph.label}`]);
  await embedPhotoOnPage(
    ctx.photoCtx,
    page,
    ph,
    photoUrl,
    instance.spread_index,
    scale,
    offsetX,
    offsetY,
    rotateDeg,
  );
}

/**
 * Простой text рендер без line wrap / auto_fit / vertical_align.
 *
 * Содержимое: instance.data[label] ?? placeholder.default_text ?? пусто.
 * Если пусто — ничего не рисуем (text-плейсхолдер с null значением
 * = пустой слот, как в Konva canvas).
 *
 * В фазе 3.5 (text-shaping.ts) этот рендер заменяется на полный:
 * line wrap по словам, auto_fit с уменьшением font_size до min_size_pt,
 * vertical_align относительно bounding box, multi-line поддержка.
 */
/**
 * Рендер текстового placeholder'а через text-shaping модуль (фаза 3.5).
 *
 * Полная поддержка:
 * - Line wrap по словам (длинные цитаты переносятся)
 * - auto_fit: уменьшение font_size до min_size_pt чтобы влезло single-line
 * - vertical_align: top/middle/bottom внутри placeholder bounding box
 * - align: left/center/right/justify
 * - text_overflow warning если block высоты превышает placeholder height
 *
 * До 3.5 был drawTextSimple — рисовал плоско на font_size_pt без
 * переносов и без vertical_align (длинные цитаты выезжали за рамку).
 */
function drawText(
  ctx: RenderContext,
  page: PDFPage,
  ph: TextPlaceholder,
  instance: SpreadInstance
): void {
  const text = instance.data[ph.label] ?? ph.default_text ?? '';
  if (!text) return;

  const font = ctx.fontRegistry.resolve(
    ph.font_family,
    ph.font_weight,
    false // italic парсер не различает (см. font-loader.ts)
  );

  // Р.3 — overrides шрифта из служебных ключей. Default (1, null) →
  // используются placeholder.font_size_pt и placeholder.color.
  const fontSizeMult = parseFontSizeMult(instance.data[`__fontSize__${ph.label}`]);
  const colorOverride = parseColor(instance.data[`__color__${ph.label}`]);

  drawTextShaped(
    page,
    ph,
    text,
    font,
    ctx.pageBoxes,
    ctx.warnings,
    instance.spread_index,
    fontSizeMult,
    colorOverride
  );
}

// ─── Background ──────────────────────────────────────────────────────────
//
// Фон набора (template_sets.default_background_url) — путь в Supabase Storage
// bucket'е template-backgrounds. Грузим один раз перед циклом по страницам,
// embed в PDFDocument, дальше рисуем одну и ту же PDFImage на всех страницах
// с разными координатами (см. drawBackground).

async function loadBackground(
  pdfDoc: PDFDocument,
  path: string | null,
  warnings: PdfWarning[]
): Promise<PDFImage | null> {
  if (!path) return null;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    warnings.push({
      code: 'image_decode_failed',
      detail: 'background skipped: NEXT_PUBLIC_SUPABASE_URL env not set',
    });
    return null;
  }
  const url = `${supabaseUrl}/storage/v1/object/public/template-backgrounds/${path}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      warnings.push({
        code: 'image_decode_failed',
        detail: `background fetch failed: HTTP ${response.status} for ${path}`,
      });
      return null;
    }
    const buffer = await response.arrayBuffer();
    if (path.toLowerCase().endsWith('.png')) {
      return await pdfDoc.embedPng(buffer);
    }
    return await pdfDoc.embedJpg(buffer);
  } catch (err) {
    warnings.push({
      code: 'image_decode_failed',
      detail: `background load error for ${path}: ${(err as Error).message}`,
    });
    return null;
  }
}

/**
 * Рисует подложку набора первым слоем на странице.
 *
 * Координаты в pdf-lib идут от низа страницы (origin bottom-left).
 * Фон ложится в trim-зону (без bleed). Если у дизайнера фон без bleed
 * — на печатном листе в bleed-зоне останется белая полоса (типографии
 * обычно ок для теста; для финала дизайнер сам добавит bleed на PNG).
 *
 * - spread: фон ровно по ширине разворота (trim_w_mm уже = 2× ширины страницы).
 * - left:   фон растягивается на 2× ширины (фактически разворот), x=bleed.
 *           Правая половина выходит за mediaBox справа и обрезается.
 * - right:  фон растягивается на 2× ширины, x=bleed - trim_w_mm.
 *           Левая половина уходит за mediaBox слева.
 */
function drawBackground(
  page: PDFPage,
  image: PDFImage,
  pageBoxes: PageBoxes,
  trim_w_mm: number,
  side: 'spread' | 'left' | 'right'
): void {
  const trim_h_mm = pageBoxes.trim_height_mm;
  const bleed = pageBoxes.bleed_mm;

  let x_mm: number;
  let w_mm: number;
  if (side === 'spread') {
    x_mm = bleed;
    w_mm = trim_w_mm;
  } else if (side === 'left') {
    x_mm = bleed;
    w_mm = trim_w_mm * 2;
  } else {
    x_mm = bleed - trim_w_mm;
    w_mm = trim_w_mm * 2;
  }

  page.drawImage(image, {
    x: mmToPt(x_mm),
    y: mmToPt(bleed),
    width: mmToPt(w_mm),
    height: mmToPt(trim_h_mm),
  });
}
