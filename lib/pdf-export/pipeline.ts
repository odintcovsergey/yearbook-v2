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

import { PDFDocument, PDFImage, PDFPage, degrees } from 'pdf-lib';
import sharp from 'sharp';
import { computePageBoxes, mmToPt, placeholderToPdfBox } from './units';
import { orderPlaceholdersForRender } from '@/lib/decorations/render-order';
import type { FontRegistry } from './font-loader';
import { embedPhotoOnPage, type PhotoEmbedContext } from './photo-embed';
import { drawTextShaped } from './text-shaping';
import { parseScale, parseOffset, parseRotate } from '@/lib/photo-transform';
import { parseFontSizeMult, parseColor } from '@/lib/text-style';
import { applyBalanceFromData } from '@/lib/balance-overrides';
import { segmentToSpreads } from '@/lib/album-builder/segment-to-spreads';
import { resolvePlaceholdersForSide } from '@/lib/album-builder/mirror-placeholders';
import {
  resolveBackgrounds,
  type SpreadBackgroundInput,
} from '@/lib/backgrounds/resolve-background';
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
  DecorationPlaceholder,
  RenderPlaceholder,
} from '@/lib/album-builder/types';

/**
 * Контекст рендера, передаваемый между функциями pipeline.
 * Накапливает warnings, держит ссылку на FontRegistry.
 */
/**
 * Готовые embed'ы трёх версий фона набора: целая (для is_spread мастера)
 * и две половины (для одностраничных мастеров — каждая ровно по ширине
 * одной страницы, рисуется без выноса за media box).
 */
type BackgroundImages = {
  spread: PDFImage;
  left: PDFImage;
  right: PDFImage;
};

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
   * Категорийные фоны: для каждого spread_index — embed'нутые версии фона
   * ЕГО разворота (spread/left/right), уже cover-нарезанные и закэшированные
   * по url (один и тот же фон embed'ится один раз). null = у этого разворота
   * фона нет. Резолвится через resolveBackgrounds (ротация + приоритеты).
   */
  bgByPageIndex: ReadonlyMap<number, BackgroundImages | null>;
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

  // ── Категорийные фоны: резолв на каждый разворот + cover-нарезка + кэш ──
  //
  // 1) Группируем страницы в визуальные развороты (как в редакторе).
  // 2) Резолвим путь фона на каждый разворот (ротация по категории + приоритеты),
  //    тот же resolveBackgrounds что канвас/превью.
  // 3) Грузим и cover-нарезаем КАЖДЫЙ уникальный путь ровно один раз (кэш).
  // 4) Строим карты: spread_index → BackgroundImages и spread_index → 'left'|'right'.
  //
  // Aspect разворота (для cover): две trim-страницы рядом по ширине.
  const spreadAspect =
    (pageBoxes.trim_width_mm * 2) / pageBoxes.trim_height_mm;

  const visualSpreads = segmentToSpreads(layout.spreads, templateById);

  // Вход резолвера на каждый визуальный разворот: категория по ведущей странице.
  const bgInputs: SpreadBackgroundInput[] = visualSpreads.map((vs) => {
    const leadIdx = vs.leftIdx ?? vs.rightIdx;
    const page = leadIdx !== undefined ? layout.spreads[leadIdx] : undefined;
    const master = page ? templateById.get(page.template_id) : undefined;
    return {
      leadingPageRole: master?.page_role ?? null,
      sectionType: page?.section_type ?? null,
      masterOverrideUrl: master?.background_override_url ?? null,
      albumOverrideUrl: (page?.data?.['__bg__'] as string | undefined) ?? null,
    };
  });
  const bgPaths = resolveBackgrounds(
    bgInputs,
    input.backgrounds ?? [],
    templateSet.default_background_url ?? null,
  );

  // Кэш cover-нарезанных embed'ов по пути (один фон обрабатывается один раз).
  // Грузим ВСЕ уникальные фоны ПАРАЛЛЕЛЬНО (fetch + sharp cover дорогие) —
  // это снимает основное замедление экспорта от множества фонов. Уникальных
  // путей немного (≈ по числу категорий), память не раздувается.
  const bgCache = new Map<string, BackgroundImages | null>();
  const distinctPaths = Array.from(
    new Set(bgPaths.filter((p): p is string => !!p)),
  );
  await Promise.all(
    distinctPaths.map(async (path) => {
      const loaded = await loadBackground(pdfDoc, path, spreadAspect, warnings);
      bgCache.set(path, loaded);
    }),
  );

  const bgByPageIndex = new Map<number, BackgroundImages | null>();
  const sideByIndex = new Map<number, 'left' | 'right'>();
  for (let i = 0; i < visualSpreads.length; i++) {
    const vs = visualSpreads[i];
    const path = bgPaths[i];
    const images = path ? bgCache.get(path) ?? null : null;
    if (vs.leftIdx !== undefined) {
      const sp = layout.spreads[vs.leftIdx];
      if (sp) {
        bgByPageIndex.set(sp.spread_index, images);
        if (!vs.isSpread) sideByIndex.set(sp.spread_index, 'left');
      }
    }
    if (vs.rightIdx !== undefined && vs.rightIdx !== vs.leftIdx) {
      const sp = layout.spreads[vs.rightIdx];
      if (sp) {
        bgByPageIndex.set(sp.spread_index, images);
        if (!vs.isSpread) sideByIndex.set(sp.spread_index, 'right');
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
    bgByPageIndex,
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
  // Часть 1 ТЗ декора: z-порядок (__under перед базой, __over после) — тот же
  // orderPlaceholdersForRender, что и канвас, чтобы превью = PDF. Скрытый декор
  // уже отфильтрован applyBalanceFromData. Порядок выставляем ДО split на
  // страницы (split сохраняет относительный порядок).
  // Авто-зеркало page-any на правой странице — ФИНАЛЬНАЯ геометрическая
  // трансформация, ПОСЛЕ балансировки (см. mirror-placeholders.ts о порядке).
  // Сторона берётся из того же sideByIndex (segmentToSpreads), что и фоны, —
  // редактор и PDF видят одно и то же. pageWidthMm = template.width_mm (то же
  // координатное пространство, что у плейсхолдеров мастера).
  const side = ctx.sideByIndex.get(instance.spread_index) ?? 'single';
  const effectivePlaceholders = resolvePlaceholdersForSide(
    orderPlaceholdersForRender(
      applyBalanceFromData(template.placeholders, instance.data) as RenderPlaceholder[],
    ),
    side,
    template.page_type,
    template.width_mm,
  ) as Placeholder[];

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

  // Фон ЭТОГО разворота — первый слой, под placeholder'ами.
  // Для одностраничных мастеров (pageHint='single') берём сторону из ctx.sideByIndex.
  const pageBackground = ctx.bgByPageIndex.get(instance.spread_index) ?? null;
  if (pageBackground) {
    const bgSide: 'spread' | 'left' | 'right' =
      pageHint === 'spread'
        ? 'spread'
        : pageHint === 'left' || pageHint === 'right'
          ? pageHint
          : ctx.sideByIndex.get(instance.spread_index) ?? 'left';
    drawBackground(page, pageBackground, ctx.pageBoxes, trim_w_mm, bgSide);
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

  // Часть 1 ТЗ: привязанный декор (type:'decoration') — статичная картинка.
  // Тип Placeholder (фото|текст) не включает decoration (см. types.ts), поэтому
  // распознаём на рантайме и кастуем. Идёт ДО ветки text — иначе декор ушёл бы
  // в drawText и упал.
  if ((ph as { type: string }).type === 'decoration') {
    await drawDecoration(ctx, page, ph as unknown as DecorationPlaceholder, instance);
    return;
  }

  if (ph.type === 'photo') {
    await drawPhoto(ctx, page, ph, instance);
  } else {
    drawText(ctx, page, ph, instance);
  }
}

/**
 * Рендер привязанного декора (Часть 1 ТЗ) в PDF.
 *
 * Декор — статичная картинка из storage (bucket template-decorations), без
 * подстановки данных. Скачиваем по url, embed'им (PNG с альфой / JPEG),
 * рисуем в рамке placeholder'а. Позиция/скрытие/смещение уже применены
 * (applyBalanceFromData + orderPlaceholdersForRender) до этой точки.
 *
 * Ошибка скачивания/embed — warning, слот пустой (не валим весь экспорт ради
 * одной картинки декора).
 */
async function drawDecoration(
  ctx: RenderContext,
  page: PDFPage,
  ph: DecorationPlaceholder,
  instance: SpreadInstance,
): Promise<void> {
  const url = ph.url;
  if (!url) return; // декор без url (не загрузился на Этапе 2б) — пропускаем

  let buffer: Buffer;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    buffer = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    ctx.warnings.push({
      code: 'photo_not_found',
      detail: `Не удалось скачать декор: ${url} (${(e as Error).message})`,
      context: { spread_index: instance.spread_index, label: ph.label },
    });
    return;
  }

  // PNG (с прозрачностью — типично для рамок/ленточек) или JPEG. Определяем
  // по расширению url (upload кладёт .png/.jpg), с fallback на сигнатуру байт.
  const isPng = url.toLowerCase().endsWith('.png') || buffer[0] === 0x89;
  let image;
  try {
    image = isPng ? await ctx.pdfDoc.embedPng(buffer) : await ctx.pdfDoc.embedJpg(buffer);
  } catch (e) {
    ctx.warnings.push({
      code: 'image_decode_failed',
      detail: `pdf-lib embed декора ${url}: ${(e as Error).message}`,
      context: { spread_index: instance.spread_index, label: ph.label },
    });
    return;
  }

  const box = placeholderToPdfBox(ph.x_mm, ph.y_mm, ph.width_mm, ph.height_mm, ctx.pageBoxes);
  page.drawImage(image, {
    x: box.x_pt,
    y: box.y_pt,
    width: box.width_pt,
    height: box.height_pt,
    rotate: degrees(ph.rotation_deg ?? 0),
  });
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
  spreadAspect: number,
  warnings: PdfWarning[]
): Promise<BackgroundImages | null> {
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
    const buffer = Buffer.from(await response.arrayBuffer());

    const meta = await sharp(buffer).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (width === 0 || height === 0) {
      warnings.push({
        code: 'image_decode_failed',
        detail: `background metadata invalid for ${path}: ${width}x${height}`,
      });
      return null;
    }

    // «cover»: приводим фон к ПРОПОРЦИИ разворота с сохранением аспекта,
    // лишнее обрезаем по центру — ровно как канвас (SpreadBackgroundLayer).
    // Бокс вписываем в исходник (без апскейла): по широкой стороне режем.
    const srcAspect = width / height;
    let tW: number;
    let tH: number;
    if (srcAspect >= spreadAspect) {
      tH = height;
      tW = Math.max(1, Math.round(height * spreadAspect));
    } else {
      tW = width;
      tH = Math.max(1, Math.round(width / spreadAspect));
    }
    const covered = await sharp(buffer)
      .resize(tW, tH, { fit: 'cover', position: 'centre' })
      .toBuffer();

    // Нарезаем cover-версию на 3: целая (is_spread) + левая/правая половины.
    const halfWidth = Math.floor(tW / 2);
    const leftBuf = await sharp(covered)
      .extract({ left: 0, top: 0, width: halfWidth, height: tH })
      .toBuffer();
    const rightBuf = await sharp(covered)
      .extract({ left: halfWidth, top: 0, width: tW - halfWidth, height: tH })
      .toBuffer();

    const isPng = path.toLowerCase().endsWith('.png');
    const embed = isPng
      ? (b: Buffer) => pdfDoc.embedPng(b)
      : (b: Buffer) => pdfDoc.embedJpg(b);

    const [spread, left, right] = await Promise.all([
      embed(covered),
      embed(leftBuf),
      embed(rightBuf),
    ]);

    return { spread, left, right };
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
 * Координаты pdf-lib от низа страницы (origin bottom-left).
 * Фон ложится в trim-зону (без bleed). Для финальной типографии дизайнер
 * сам подготовит PNG с запасом на обрез.
 *
 * Использует предварительно нарезанные через sharp версии (см. loadBackground):
 * - spread: рисуется на всю ширину разворотного мастера
 * - left:   левая половина дизайна рисуется ровно по ширине левой страницы
 * - right:  правая половина — по ширине правой
 *
 * Никаких отрицательных координат и выноса за mediaBox — половинки
 * посчитаны заранее ровно по pixel'ам исходника.
 */
function drawBackground(
  page: PDFPage,
  images: BackgroundImages,
  pageBoxes: PageBoxes,
  trim_w_mm: number,
  side: 'spread' | 'left' | 'right'
): void {
  const trim_h_mm = pageBoxes.trim_height_mm;
  const bleed = pageBoxes.bleed_mm;
  const image = images[side];

  page.drawImage(image, {
    x: mmToPt(bleed),
    y: mmToPt(bleed),
    width: mmToPt(trim_w_mm),
    height: mmToPt(trim_h_mm),
  });
}
