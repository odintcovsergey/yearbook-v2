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
import { resolveReadUrl } from '@/lib/blob-storage';
import type { FontRegistry } from './font-loader';
import {
  embedPhotoOnPage,
  collectPhotoUrlsFromSpreads,
  prefetchPhotoSources,
  prefetchResampledPhotos,
  type PhotoEmbedContext,
  type ResampleRequest,
} from './photo-embed';
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
import {
  planTypographyExport,
  type AcceptMode,
  type ExportUnit,
  type TypographyExportPlan,
} from '@/lib/export-typography/plan';
import type { CoverRenderUnit } from '@/lib/export-typography/covers';
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
  /**
   * Модель «поля»: отступ контента от корешка (мм) у набора. null = legacy
   * авто-зеркало. Прокидывается в resolvePlaceholdersForSide (см.
   * mirror-placeholders.ts). Один на весь набор.
   */
  spineMarginMm: number | null;
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
  const { ctx, templateById } = await buildRenderContext(pdfDoc, fontRegistry, input);
  const { layout } = input;
  const warnings = ctx.warnings;

  // ── Параллельная предзагрузка фото ──────────────────────────────────────
  //
  // Раньше каждое фото грузилось последовательно внутри рендера (узкое место —
  // сетевой fetch, не sharp), из-за чего большие альбомы падали по таймауту.
  // Здесь собираем ВСЕ URL фото альбома и грузим их пулом (~8 одновременно) в
  // photoCtx.sourceCache ДО цикла. Сам рендер остаётся последовательным (RAM),
  // но теперь каждое фото уже в кэше — сеть не блокирует. Логика выбора
  // источника (оригинал/selection) и ресэмплинг не меняются → вид PDF тот же.
  const photoUrls = collectPhotoUrlsFromSpreads(layout.spreads);
  await prefetchPhotoSources(ctx.photoCtx, photoUrls, 8);
  // Параллельный ресэмпл всех фото в кэш — главный ускоритель (sharp по ядрам).
  await prefetchResampledPhotos(
    ctx.photoCtx,
    collectResampleRequests(ctx, templateById, layout.spreads),
    4,
  );

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
 * Строит общий RenderContext (pageBoxes, photoCtx с кэшем, карты фонов и сторон,
 * индекс мастеров). Вынесено из renderAllSpreads, чтобы типографский рендер
 * (renderTypographyUnits) переиспользовал ровно ту же подготовку — те же фоны,
 * стороны и зеркало page-any, что и обычный экспорт/превью.
 */
async function buildRenderContext(
  pdfDoc: PDFDocument,
  fontRegistry: FontRegistry,
  input: AlbumExportInput,
): Promise<{ ctx: RenderContext; templateById: Map<string, SpreadTemplate> }> {
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
    // Кэш сетевых загрузок исходников на время экспорта (дедуп + база под
    // параллельный префетч ниже).
    sourceCache: new Map(),
    // Кэш готовых ресэмплов (параллельный sharp до рендера).
    resampledCache: new Map(),
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

  // softShift для soft-альбомов — ТА ЖЕ сегментация, что в редакторе
  // (page.tsx передаёт softShift: isSoftAlbum). Иначе сторона страницы
  // (left/right) разойдётся между превью и PDF → зеркало page-any и фоны
  // сядут на разные стороны. Дефолт 'layflat' (старое поведение).
  const visualSpreads = segmentToSpreads(layout.spreads, templateById, {
    softShift: input.effectivePrintType === 'soft',
  });

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
      const loaded = await loadBackground(pdfDoc, path, spreadAspect, warnings, profile.jpeg_quality);
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
    spineMarginMm: templateSet.spine_margin_mm ?? null,
  };

  return { ctx, templateById };
}

// ─── Типографская выгрузка (ТЗ экспорта 20.06.2026) ──────────────────────────
//
// Рендерит сохранённую вёрстку в ОТДЕЛЬНЫЕ файлы под профиль типографии:
// нарезка по книгам (000/00X), приём разворотами/постранично, имена
// КНИГА-НОМЕР. Каждый ExportUnit добавляет РОВНО ОДНУ страницу в pdfDoc
// (постранично — обычная страница / половина is_spread-мастера; разворотами —
// широкая страница с двумя сторонами). Дальше endpoint режет pdfDoc на
// одностраничные файлы по этим именам и пакует в zip.
//
// Формат заказа применяется на уровне набора (adaptTemplateSetToFormat) ДО
// вызова — здесь input.templateSet уже в размерах формата, рендер не меняется.

export type TypographyRenderedFile = {
  /** Имя файла без расширения, напр. "000-01". */
  file_name: string;
  book_id: string;
  /** Индекс соответствующей страницы в pdfDoc. */
  page_index: number;
};

/** Группа «мастер + его данные» для отрисовки одной стороны разворота. */
type RenderGroup = { instance: SpreadInstance; template: SpreadTemplate };

export async function renderTypographyUnits(
  pdfDoc: PDFDocument,
  fontRegistry: FontRegistry,
  input: AlbumExportInput,
  acceptMode: AcceptMode,
  coverUnits: CoverRenderUnit[] = [],
): Promise<{
  files: TypographyRenderedFile[];
  warnings: PdfWarning[];
  plan: TypographyExportPlan;
}> {
  const { ctx, templateById } = await buildRenderContext(pdfDoc, fontRegistry, input);
  const warnings = ctx.warnings;

  // Та же параллельная предзагрузка фото, что и в обычном экспорте.
  const photoUrls = collectPhotoUrlsFromSpreads(input.layout.spreads);
  await prefetchPhotoSources(ctx.photoCtx, photoUrls, 8);
  // Параллельный ресэмпл фото (внутренних + обложек) в кэш — основной ускоритель.
  await prefetchResampledPhotos(
    ctx.photoCtx,
    [
      ...collectResampleRequests(ctx, templateById, input.layout.spreads),
      ...collectCoverResampleRequests(coverUnits),
    ],
    4,
  );

  const plan = planTypographyExport(input.layout.spreads, templateById, {
    acceptMode,
    softShift: input.effectivePrintType === 'soft',
  });

  const files: TypographyRenderedFile[] = [];
  for (const book of plan.books) {
    for (const unit of book.units) {
      const pageIndexBefore = pdfDoc.getPageCount();
      const added = await renderTypographyUnit(ctx, templateById, unit);
      if (!added) continue; // мастер не найден — страница не добавлена, файл пропускаем
      files.push({
        file_name: unit.file_name,
        book_id: book.book_id,
        page_index: pageIndexBefore,
      });
    }
  }

  // Обложки (000-00 / 00X-00) — каждая отдельной страницей-файлом.
  for (const cover of coverUnits) {
    const pageIndexBefore = pdfDoc.getPageCount();
    await renderCoverPage(ctx, cover);
    files.push({
      file_name: cover.file_name,
      // book_id из префикса имени ("000-00" → "000").
      book_id: cover.file_name.split('-')[0],
      page_index: pageIndexBefore,
    });
  }

  return { files, warnings, plan };
}

/**
 * Рендер одной обложки на отдельную страницу. Полотно = задняя|корешок|передняя
 * (плейсхолдеры уже разложены layoutCover + adaptCoverToFormat — абсолютные
 * координаты по всему полотну). Фон — первым слоем во всю страницу, поверх —
 * плейсхолдеры через общий drawPlaceholder (фото/текст/декор).
 *
 * Вылеты пока не добавляем (рендерим обрезной размер полотна) — bleed/overhang
 * обложки уточним отдельно. Глобальные стили текстов обложки (по группам) тоже
 * пока не применяются — только пер-плейсхолдер правки из data.
 */
async function renderCoverPage(
  ctx: RenderContext,
  cover: CoverRenderUnit,
): Promise<void> {
  const trim_w_mm = cover.width_mm;
  const trim_h_mm = cover.height_mm;
  const coverBoxes: PageBoxes = {
    trim_width_mm: trim_w_mm,
    trim_height_mm: trim_h_mm,
    bleed_mm: 0,
    media_width_mm: trim_w_mm,
    media_height_mm: trim_h_mm,
  };

  const page = ctx.pdfDoc.addPage([mmToPt(trim_w_mm), mmToPt(trim_h_mm)]);

  // Фон обложки — одна картинка во всё полотно (не категорийная 3-версии).
  if (cover.background_url) {
    try {
      // Резолвим через resolveReadUrl (Timeweb-aware), как фон разворотов:
      // в БД лежит относительный ключ (covers/<id>/<uuid>.jpg) — без резолва
      // fetch уходил по ключу как по HTTP-пути → 404 → серый фон обложки.
      // Расширение для PNG/JPG берём из исходного ключа (в signed-URL — query).
      const isPngByExt = cover.background_url.toLowerCase().endsWith('.png');
      const bgUrl = await resolveReadUrl('template-backgrounds', cover.background_url);
      const res = bgUrl ? await fetch(bgUrl, { cache: 'no-store' }) : null;
      if (res && res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        const isPng = isPngByExt || buf[0] === 0x89;
        const img = isPng
          ? await ctx.pdfDoc.embedPng(buf)
          : await ctx.pdfDoc.embedJpg(buf);
        page.drawImage(img, {
          x: 0,
          y: 0,
          width: mmToPt(trim_w_mm),
          height: mmToPt(trim_h_mm),
        });
      }
    } catch (e) {
      ctx.warnings.push({
        code: 'photo_not_found',
        detail: `фон обложки ${cover.file_name}: ${(e as Error).message}`,
      });
    }
  }

  const localCtx: RenderContext = {
    ...ctx,
    pageBoxes: coverBoxes,
    photoCtx: { ...ctx.photoCtx, pageBoxes: coverBoxes },
  };
  const instance: SpreadInstance = {
    spread_index: 0,
    template_id: '__cover__',
    template_name: 'cover',
    data: cover.data,
  };
  for (const ph of cover.placeholders) {
    await drawPlaceholder(localCtx, page, ph, instance, 'single');
  }
}

/**
 * Рендерит один ExportUnit как РОВНО одну страницу. Возвращает false, если
 * мастер не найден (страница не добавлена — warning уже записан).
 */
async function renderTypographyUnit(
  ctx: RenderContext,
  templateById: Map<string, SpreadTemplate>,
  unit: ExportUnit,
): Promise<boolean> {
  const left = unit.left;
  if (!left) return false;
  const leftTpl = templateById.get(left.template_id);
  if (!leftTpl) {
    ctx.warnings.push({
      code: 'template_not_found',
      detail: `template_id=${left.template_id} (${left.template_name}) для файла ${unit.file_name} не найден; файл пропущен`,
      context: { spread_index: left.spread_index },
    });
    return false;
  }

  if (unit.mode === 'page') {
    if (unit.is_spread_master && unit.spread_half) {
      // Половина широкого мастера на отдельной странице (постранично).
      await renderSpreadHalfPage(ctx, left, leftTpl, unit.spread_half);
    } else {
      await renderPage(
        ctx,
        left,
        leftTpl,
        resolveEffectivePlaceholders(ctx, left, leftTpl),
        'single',
      );
    }
    return true;
  }

  // mode === 'spread' (разворотами).
  if (unit.is_spread_master) {
    // Широкий мастер целиком — одна широкая страница (готовый spread-режим).
    await renderPage(
      ctx,
      left,
      leftTpl,
      resolveEffectivePlaceholders(ctx, left, leftTpl),
      'spread',
    );
    return true;
  }

  // Обычная пара (два разных мастера) или висящая страница → широкий холст с
  // двумя сторонами и вылетами ТОЛЬКО по внешним краям.
  const right = unit.right;
  let rightGroup: RenderGroup | undefined;
  if (right) {
    const rightTpl = templateById.get(right.template_id);
    if (rightTpl) {
      rightGroup = { instance: right, template: rightTpl };
    } else {
      ctx.warnings.push({
        code: 'template_not_found',
        detail: `template_id=${right.template_id} (${right.template_name}) для правой стороны ${unit.file_name} не найден; сторона пропущена`,
        context: { spread_index: right.spread_index },
      });
    }
  }
  await renderCombinedWidePage(ctx, { instance: left, template: leftTpl }, rightGroup);
  return true;
}

/**
 * Постранично: рендерит ОДНУ половину (left/right) широкого is_spread-мастера
 * как обычную страницу. Та же логика деления по середине, что у renderSpread
 * в pages-режиме, но рендерит ровно одну из половин.
 */
async function renderSpreadHalfPage(
  ctx: RenderContext,
  instance: SpreadInstance,
  template: SpreadTemplate,
  half: 'left' | 'right',
): Promise<void> {
  const eff = resolveEffectivePlaceholders(ctx, instance, template);
  const page_w_mm = ctx.pageBoxes.trim_width_mm;
  const placeholders: Placeholder[] =
    half === 'left'
      ? eff.filter((ph) => ph.x_mm < page_w_mm)
      : eff
          .filter((ph) => ph.x_mm >= page_w_mm)
          .map((ph) => ({ ...ph, x_mm: ph.x_mm - page_w_mm }) as Placeholder);
  await renderPage(ctx, instance, template, placeholders, half);
}

/**
 * Разворотами: рендерит широкую страницу (2 страницы по ширине) с двумя
 * сторонами от РАЗНЫХ мастеров. Вылеты — только по внешним краям (по центру,
 * в корешке, лишних вылетов нет — это и есть правильный разворотный файл).
 *
 * Фон берём у левой страницы (у визуального разворота источник один) и рисуем
 * как 'spread'. Плейсхолдеры правой стороны сдвигаются на ширину страницы.
 * Зеркало page-any у каждой стороны уже учтено (resolveEffectivePlaceholders
 * берёт сторону из sideByIndex).
 */
async function renderCombinedWidePage(
  ctx: RenderContext,
  left: RenderGroup,
  right: RenderGroup | undefined,
): Promise<void> {
  const { pdfDoc, pageBoxes } = ctx;
  const page_w_mm = pageBoxes.trim_width_mm;
  const trim_w_mm = page_w_mm * 2;
  const trim_h_mm = pageBoxes.trim_height_mm;
  const media_w_mm = trim_w_mm + pageBoxes.bleed_mm * 2;
  const media_h_mm = pageBoxes.media_height_mm;

  const page = pdfDoc.addPage([mmToPt(media_w_mm), mmToPt(media_h_mm)]);
  if (pageBoxes.bleed_mm > 0) {
    page.setTrimBox(
      mmToPt(pageBoxes.bleed_mm),
      mmToPt(pageBoxes.bleed_mm),
      mmToPt(trim_w_mm),
      mmToPt(trim_h_mm),
    );
    page.setBleedBox(0, 0, mmToPt(media_w_mm), mmToPt(media_h_mm));
  }

  // Фон разворота (целая версия) — первый слой.
  const bg = ctx.bgByPageIndex.get(left.instance.spread_index) ?? null;
  if (bg) drawBackground(page, bg, pageBoxes, trim_w_mm, 'spread');

  // localCtx с расширенной шириной — чтобы placeholderToPdfBox/проверки границ
  // работали на широкий холст (как в renderPage spread-режиме).
  const localPageBoxes = {
    ...pageBoxes,
    trim_width_mm: trim_w_mm,
    media_width_mm: media_w_mm,
  };
  const localCtx: RenderContext = {
    ...ctx,
    pageBoxes: localPageBoxes,
    photoCtx: { ...ctx.photoCtx, pageBoxes: localPageBoxes },
  };

  for (const ph of resolveEffectivePlaceholders(ctx, left.instance, left.template)) {
    await drawPlaceholder(localCtx, page, ph, left.instance, 'left');
  }
  if (right) {
    const rightPh = resolveEffectivePlaceholders(ctx, right.instance, right.template).map(
      (ph) => ({ ...ph, x_mm: ph.x_mm + page_w_mm }) as Placeholder,
    );
    for (const ph of rightPh) {
      await drawPlaceholder(localCtx, page, ph, right.instance, 'right');
    }
  }
}

/**
 * Разрешает финальные плейсхолдеры страницы: балансировка (hidden/pos) →
 * z-порядок декора → авто-зеркало page-any по стороне (из sideByIndex). Та же
 * цепочка, что в канвасе/превью, — гарантирует совпадение PDF ↔ редактор.
 * Вынесено из renderSpread, чтобы типографский рендер использовал ту же логику.
 */
function resolveEffectivePlaceholders(
  ctx: RenderContext,
  instance: SpreadInstance,
  template: SpreadTemplate,
): Placeholder[] {
  const side = ctx.sideByIndex.get(instance.spread_index) ?? 'single';
  return resolvePlaceholdersForSide(
    orderPlaceholdersForRender(
      applyBalanceFromData(template.placeholders, instance.data) as RenderPlaceholder[],
    ),
    side,
    template.page_type,
    template.width_mm,
    ctx.spineMarginMm,
  ) as Placeholder[];
}

/**
 * Собирает запросы на ресэмпл всех фото развёрстки (для параллельного префетча).
 * Резолвит плейсхолдеры так же, как рендер, и для каждого photo-плейсхолдера с
 * URL извлекает трансформ из служебных ключей data. is_spread-мастер отдаёт оба
 * полукадра — оба нужны (постранично) либо склейка (разворотами).
 */
function collectResampleRequests(
  ctx: RenderContext,
  templateById: Map<string, SpreadTemplate>,
  spreads: SpreadInstance[],
): ResampleRequest[] {
  const reqs: ResampleRequest[] = [];
  for (const instance of spreads) {
    const tpl = templateById.get(instance.template_id);
    if (!tpl) continue;
    for (const ph of resolveEffectivePlaceholders(ctx, instance, tpl)) {
      if (ph.type !== 'photo') continue;
      const url = instance.data[ph.label];
      if (!url) continue;
      const [offsetX, offsetY] = parseOffset(instance.data[`__offset__${ph.label}`]);
      reqs.push({
        photoUrl: url,
        ph: ph as PhotoPlaceholder,
        scale: parseScale(instance.data[`__scale__${ph.label}`]),
        offsetX,
        offsetY,
        rotateDeg: parseRotate(instance.data[`__rotate__${ph.label}`]),
      });
    }
  }
  return reqs;
}

/** Запросы ресэмпла фото обложек (плейсхолдеры обложки + её data). */
function collectCoverResampleRequests(coverUnits: CoverRenderUnit[]): ResampleRequest[] {
  const reqs: ResampleRequest[] = [];
  for (const cover of coverUnits) {
    for (const ph of cover.placeholders) {
      if (ph.type !== 'photo') continue;
      const url = cover.data[ph.label];
      if (!url) continue;
      const [offsetX, offsetY] = parseOffset(cover.data[`__offset__${ph.label}`]);
      reqs.push({
        photoUrl: url,
        ph: ph as PhotoPlaceholder,
        scale: parseScale(cover.data[`__scale__${ph.label}`]),
        offsetX,
        offsetY,
        rotateDeg: parseRotate(cover.data[`__rotate__${ph.label}`]),
      });
    }
  }
  return reqs;
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
  const effectivePlaceholders = resolveEffectivePlaceholders(ctx, instance, template);

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
  _template: SpreadTemplate,
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
  if (!ph.url) return; // декор без url (не загрузился на Этапе 2б) — пропускаем
  const url = await resolveReadUrl('template-decorations', ph.url);

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
  warnings: PdfWarning[],
  jpegQuality: number
): Promise<BackgroundImages | null> {
  if (!path) return null;
  const url = await resolveReadUrl('template-backgrounds', path);
  if (!url) {
    warnings.push({
      code: 'image_decode_failed',
      detail: `background skipped: cannot resolve url for ${path}`,
    });
    return null;
  }
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
    const isPng = path.toLowerCase().endsWith('.png');

    // Промежуточную cover-версию держим БЕЗ потерь (png), чтобы нарезка на
    // половины не пересжимала JPEG дважды (раньше covered был q80, и левая/
    // правая половины получали q80 ещё раз — двойная потеря). Финал кодируем
    // ровно один раз: PNG без потерь либо JPEG с явным печатным качеством +
    // mozjpeg (как у фото). Без явного quality sharp ставил дефолт q80 → фон
    // в печати выходил мягким.
    const covered = await sharp(buffer)
      .resize(tW, tH, { fit: 'cover', position: 'centre' })
      .png()
      .toBuffer();

    const encode = (s: ReturnType<typeof sharp>): Promise<Buffer> =>
      isPng
        ? s.png().toBuffer()
        : s.jpeg({ quality: jpegQuality, mozjpeg: true }).toBuffer();

    // Нарезаем cover-версию на 3: целая (is_spread) + левая/правая половины.
    const halfWidth = Math.floor(tW / 2);
    const [coveredFinal, leftBuf, rightBuf] = await Promise.all([
      encode(sharp(covered)),
      encode(sharp(covered).extract({ left: 0, top: 0, width: halfWidth, height: tH })),
      encode(sharp(covered).extract({ left: halfWidth, top: 0, width: tW - halfWidth, height: tH })),
    ]);

    const embed = isPng
      ? (b: Buffer) => pdfDoc.embedPng(b)
      : (b: Buffer) => pdfDoc.embedJpg(b);

    const [spread, left, right] = await Promise.all([
      embed(coveredFinal),
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
