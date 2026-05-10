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

import { PDFDocument, PDFPage, rgb, degrees } from 'pdf-lib';
import {
  computePageBoxes,
  mmToPt,
  placeholderToPdfBox,
  hexToRgb01,
} from './units';
import type { FontRegistry } from './font-loader';
import { embedPhotoOnPage, type PhotoEmbedContext } from './photo-embed';
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
  /** Подконтекст для photo-embed (передаётся в embedPhotoOnPage). */
  photoCtx: PhotoEmbedContext;
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

  const ctx: RenderContext = {
    pdfDoc,
    fontRegistry,
    pageBoxes,
    warnings,
    photoCtx,
  };

  // Индекс мастеров для O(1) lookup'а (вместо .find() на каждый разворот).
  const templateById = new Map<string, SpreadTemplate>();
  for (const t of templateSet.spreads) {
    templateById.set(t.id, t);
  }

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
 * Если template.is_spread=true → две страницы (placeholders делятся по
 * вертикальной середине разворота; для правой — `x_mm -= page_w`).
 *
 * @returns количество добавленных страниц (1 или 2)
 */
async function renderSpread(
  ctx: RenderContext,
  instance: SpreadInstance,
  template: SpreadTemplate
): Promise<number> {
  if (!template.is_spread) {
    await renderPage(ctx, instance, template, template.placeholders, 'single');
    return 1;
  }

  // Двухстраничный мастер. Разделяем placeholders по x_mm < page_w_mm.
  // Для правой страницы пересчитываем x_mm на относительный.
  const page_w_mm = ctx.pageBoxes.trim_width_mm;
  const leftPlaceholders: Placeholder[] = [];
  const rightPlaceholders: Placeholder[] = [];
  for (const ph of template.placeholders) {
    if (ph.x_mm < page_w_mm) {
      leftPlaceholders.push(ph);
    } else {
      // Сдвиг x_mm на левую границу правой страницы.
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
  pageHint: 'single' | 'left' | 'right'
): Promise<void> {
  const { pdfDoc, pageBoxes } = ctx;

  const page = pdfDoc.addPage([
    mmToPt(pageBoxes.media_width_mm),
    mmToPt(pageBoxes.media_height_mm),
  ]);

  // TrimBox/BleedBox только если печатаем с bleed (typography профиль).
  // Preview-профиль include_bleed=false — bleed=0, и сами boxes не имеют
  // смысла (они равны mediaBox).
  if (pageBoxes.bleed_mm > 0) {
    page.setTrimBox(
      mmToPt(pageBoxes.bleed_mm),
      mmToPt(pageBoxes.bleed_mm),
      mmToPt(pageBoxes.trim_width_mm),
      mmToPt(pageBoxes.trim_height_mm)
    );
    page.setBleedBox(
      0,
      0,
      mmToPt(pageBoxes.media_width_mm),
      mmToPt(pageBoxes.media_height_mm)
    );
  }

  // TODO (фаза 4): рисуем background_url первым слоем если он не null.
  // background_url — будущее поле SpreadTemplate (сейчас не в типе
  // album-builder'а, но в БД есть). Когда фаза 4 экстрактит фоны
  // из IDML и заполняет background_url — здесь будет drawImage(...).

  // Рисуем placeholders по порядку (sort_order из IDML).
  // Последовательно (await) — экономим RAM на sharp+fetch буферах.
  // Параллелизм через семафор — фаза 3.X если упрёмся в производительность.
  for (const ph of placeholders) {
    await drawPlaceholder(ctx, page, ph, instance, pageHint);
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
    drawTextSimple(ctx, page, ph, instance);
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
  await embedPhotoOnPage(ctx.photoCtx, page, ph, photoUrl, instance.spread_index);
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
function drawTextSimple(
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

  const color = hexToRgb01(ph.color);
  const box = placeholderToPdfBox(
    ph.x_mm,
    ph.y_mm,
    ph.width_mm,
    ph.height_mm,
    ctx.pageBoxes
  );

  // В 3.3 vertical_align='top' для всех. Базовая линия = y_top - font_size×0.8
  // (приблизительный ascender в pt).
  // В 3.5 будет точный расчёт через font.heightAtSize() и font.widthOfTextAtSize().
  const baselineOffsetPt = ph.font_size_pt * 0.8;
  const baselineY_pt = box.y_pt + box.height_pt - baselineOffsetPt;

  // Align: в 3.3 поддерживаем только left (это default IDML).
  // В 3.5 для center / right / justify будет width-aware расчёт.
  const x_pt = box.x_pt;

  page.drawText(text, {
    x: x_pt,
    y: baselineY_pt,
    size: ph.font_size_pt,
    font,
    color: rgb(color.r, color.g, color.b),
    rotate: degrees(ph.rotation_deg ?? 0),
  });
}
