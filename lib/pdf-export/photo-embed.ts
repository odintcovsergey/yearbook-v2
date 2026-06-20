/**
 * Photo embedding pipeline (фаза 3.4).
 *
 * Самый критичный модуль для качества финального PDF: для каждого
 * `photo placeholder` ищем оригинал фото по filename, ресэмплим через
 * sharp к целевому dpi, и embed'им в PDFDocument как JPEG.
 *
 * Алгоритм (см. docs/phase-3-spec.md §4.1):
 *
 * 1. Из instance.data[label] получаем photo URL (selection WebP в YC).
 * 2. Для quality='high'/'medium': lookup filename через urlToFilename
 *    мапу, потом ищем в `originals[]` запись с тем же filename.
 * 3. Если оригинал найден — fetch'аем его, ресэмплим к pixel-разрешению
 *    `mm × dpi / 25.4` с cover crop, конвертируем в JPEG.
 * 4. Если оригинала нет — fallback на selection WebP + warning
 *    `no_original` (это мотивирует партнёра загрузить оригиналы через
 *    retouch workflow фазы 3.B).
 * 5. Для quality='preview' оригиналы не ищем — selection WebP без
 *    resample (быстро, малый размер файла).
 *
 * Параллелизм: в фазе 3.4 — последовательная обработка (один placeholder
 * за раз). Экономим RAM (Vercel serverless лимит 1024 МБ free / 3008 МБ
 * pro). Скорость 1 сек на фото × 30 фото = 30 сек, укладываемся в
 * Vercel sync timeout 60 сек. Параллелизм через семафор — 3.X если
 * упрёмся в производительность.
 *
 * Oval (circle photo) — clip-mask через Bezier-аппроксимацию круга
 * (4 кубических кривых, magic constant 0.5522847498). Используется
 * для учительских аватарок в F-Head-*Grid и G-Teachers-*.
 */

import sharp from 'sharp';
import {
  PDFDocument,
  PDFImage,
  PDFPage,
  rgb,
  degrees,
  pushGraphicsState,
  popGraphicsState,
  moveTo,
  lineTo,
  appendBezierCurve,
  closePath,
  clip,
  endPath,
} from 'pdf-lib';
import { mmToPixels, mmToPt, placeholderToPdfBox } from './units';
import { ycGetObjectBuffer } from '@/lib/storage';
import { computeCrop, computeAutoZoomForRotation } from '@/lib/photo-transform';
import type {
  AlbumExportInput,
  OriginalPhoto,
  PageBoxes,
  PdfWarning,
} from './types';
import type { PhotoPlaceholder } from '@/lib/album-builder/types';

/**
 * Контекст embedder'а — то что нужно для одной операции embed'а.
 * Передаётся из pipeline.ts.
 */
export type PhotoEmbedContext = {
  pdfDoc: PDFDocument;
  pageBoxes: PageBoxes;
  profile: AlbumExportInput['profile'];
  originals: OriginalPhoto[];
  urlToFilename: Record<string, string>;
  warnings: PdfWarning[];
  /**
   * Кэш сетевых загрузок исходников фото на время одного экспорта.
   * Ключ — `orig:<storage_path>` (оригинал из приватного бакета) или
   * `sel:<photoUrl>` (selection WebP). Значение — Promise с буфером (или null
   * при ошибке). Хранение именно Promise дедуплицирует параллельные запросы:
   * префетч и рендер одного и того же портрета (встречается и в блоке, и на
   * обложке) грузят его ровно один раз. Опционально — если не задан, загрузка
   * идёт без кэша (старое поведение). См. prefetchPhotoSources.
   */
  sourceCache?: Map<string, Promise<Buffer | null>>;
  /**
   * Кэш ГОТОВЫХ ресэмплов (JPEG-буфер под целевой размер+трансформ). Заполняется
   * параллельным префетчем (prefetchResampledPhotos) ДО последовательного
   * рендера, чтобы тяжёлый sharp-ресэмплинг шёл на нескольких ядрах, а рендер
   * только встраивал готовые буферы. Ключ — resampleKey. Опционально.
   */
  resampledCache?: Map<string, Buffer>;
};

/**
 * Ключ кэша ресэмпла: url + целевой размер (мм×dpi) + трансформ. Позиция и форма
 * рамки (circle/corner/rotation_deg) на ресэмпл НЕ влияют — это draw-time.
 */
export function resampleKey(
  photoUrl: string,
  ph: PhotoPlaceholder,
  dpi: number,
  scale: number,
  offsetX: number,
  offsetY: number,
  rotateDeg: number,
): string {
  return `${photoUrl}|${ph.width_mm}x${ph.height_mm}|${dpi}|${scale}|${offsetX},${offsetY}|${rotateDeg}`;
}

/** Запрос на предварительный ресэмпл одного фото. */
export type ResampleRequest = {
  photoUrl: string;
  ph: PhotoPlaceholder;
  scale: number;
  offsetX: number;
  offsetY: number;
  rotateDeg: number;
};

/**
 * Загрузка с кэшем по ключу. Если кэш есть и ключ уже грузится/загружен —
 * возвращаем тот же Promise (дедуп). Иначе запускаем loader, кладём Promise в
 * кэш сразу (до await), чтобы конкурентные вызовы подхватили его, а не
 * запустили второй сетевой запрос.
 */
function cachedLoad(
  cache: Map<string, Promise<Buffer | null>> | undefined,
  key: string,
  loader: () => Promise<Buffer | null>,
): Promise<Buffer | null> {
  if (!cache) return loader();
  const existing = cache.get(key);
  if (existing) return existing;
  const p = loader();
  cache.set(key, p);
  return p;
}

/**
 * Результат поиска фото для embed'а — буфер байт + метаданные источника.
 * Если null — фото вообще не доступно (не нашли photo_url или fetch
 * упал), pipeline.ts рисует серый прямоугольник как заглушку.
 */
type PhotoSource = {
  buffer: Buffer;
  source: 'original' | 'selection';
  /** filename для warning'ов и debug. */
  filename: string;
};

/**
 * Главная функция: embed'ит фото из instance.data в указанную позицию
 * на странице.
 *
 * Если photoUrl null/empty — ничего не делается (пустой слот).
 * Если все попытки получить буфер упали — рисуется серый прямоугольник
 * + warning. PDF не валится — экспорт продолжается с дегрейдом.
 */
export async function embedPhotoOnPage(
  ctx: PhotoEmbedContext,
  page: PDFPage,
  ph: PhotoPlaceholder,
  photoUrl: string | null,
  spread_index: number,
  // КЭ.7 — transform параметры из служебных ключей data.
  // Default (1, 0, 0, 0) → старое поведение fit:'cover' (regression-safe,
  // байт-в-байт идентичен PDF до КЭ).
  scale: number = 1,
  offsetX: number = 0,
  offsetY: number = 0,
  // Р.2 — поворот фото внутри рамки (горизонт). Применяется на ВЕРХ
  // scale/offset: после извлечения crop'а sharp.rotate() поворачивает
  // изображение, а auto-zoom factor гарантирует что после поворота
  // центральная часть полностью покрывает целевую рамку без видимого
  // фона по углам. См. lib/photo-transform → computeAutoZoomForRotation.
  rotateDeg: number = 0,
): Promise<void> {
  const box = placeholderToPdfBox(
    ph.x_mm,
    ph.y_mm,
    ph.width_mm,
    ph.height_mm,
    ctx.pageBoxes
  );

  // Пустой слот — оставляем пустым (Konva canvas рисует серый, мы в
  // PDF — ничего, чтобы не было шума). Для отладки можно потом включить
  // тонкий бордер, но в фазе 3.4 — пусто.
  if (!photoUrl) return;

  // Ресэмпл через кэш: если фото уже подготовлено в параллельном префетче
  // (prefetchResampledPhotos), берём готовый JPEG-буфер и не трогаем sharp.
  // Иначе грузим источник и ресэмплим на месте. Ключ — url+целевой размер+трансформ.
  const key = resampleKey(photoUrl, ph, ctx.profile.dpi, scale, offsetX, offsetY, rotateDeg);
  let resampled = ctx.resampledCache?.get(key) ?? null;

  if (!resampled) {
    const photoSource = await fetchPhotoSource(ctx, photoUrl, ph, spread_index);
    if (!photoSource) {
      // Все попытки упали — серый прямоугольник как visual fallback.
      page.drawRectangle({
        x: box.x_pt,
        y: box.y_pt,
        width: box.width_pt,
        height: box.height_pt,
        color: rgb(0.92, 0.92, 0.92),
        rotate: degrees(ph.rotation_deg ?? 0),
      });
      return;
    }
    try {
      resampled = await resamplePhotoBuffer(
        photoSource.buffer,
        ph,
        ctx.profile.dpi,
        ctx.profile.jpeg_quality,
        scale,
        offsetX,
        offsetY,
        rotateDeg,
      );
      ctx.resampledCache?.set(key, resampled);
    } catch (e) {
      ctx.warnings.push({
        code: 'image_decode_failed',
        detail: `sharp decode error на ${photoSource.filename}: ${(e as Error).message}`,
        context: { spread_index, label: ph.label, filename: photoSource.filename },
      });
      // Серый прямоугольник как visual fallback
      page.drawRectangle({
        x: box.x_pt,
        y: box.y_pt,
        width: box.width_pt,
        height: box.height_pt,
        color: rgb(0.92, 0.92, 0.92),
        rotate: degrees(ph.rotation_deg ?? 0),
      });
      return;
    }
  }

  // Embed в pdf-lib
  let image: PDFImage;
  try {
    image = await ctx.pdfDoc.embedJpg(resampled);
  } catch (e) {
    ctx.warnings.push({
      code: 'image_decode_failed',
      detail: `pdf-lib embedJpg error на ${ph.label}: ${(e as Error).message}`,
      context: { spread_index, label: ph.label },
    });
    return;
  }

  // Рисуем — прямоугольник или с круглой clip-маской
  // Часть 2 ТЗ (6б): скруглённые углы фото-фрейма (corner_radius_mm). Приблизительно
  // в PDF — clip по rounded-rect. Применяем только без поворота (повёрнутое фото
  // редко и со скруглением не встречается). Свечение (glow) в PDF не делаем:
  // pdf-lib не умеет размытие (ТЗ допускает приблизительность / пропуск для PDF).
  const cornerRadiusMm = (ph as { corner_radius_mm?: number }).corner_radius_mm ?? 0;
  if (ph.is_circle) {
    drawImageInCircle(page, image, box, ph.rotation_deg ?? 0);
  } else if (cornerRadiusMm > 0 && (ph.rotation_deg ?? 0) === 0) {
    drawImageInRoundedRect(page, image, box, mmToPt(cornerRadiusMm));
  } else {
    page.drawImage(image, {
      x: box.x_pt,
      y: box.y_pt,
      width: box.width_pt,
      height: box.height_pt,
      rotate: degrees(ph.rotation_deg ?? 0),
    });
  }
}

/**
 * Рисует image, обрезанное по прямоугольнику со скруглёнными углами
 * (Часть 2 ТЗ, 6б). Clip-path: 4 прямых стороны + 4 дуги (Bezier, k=0.5523).
 * Радиус ограничен половиной меньшей стороны. Без поворота (caller это
 * гарантирует).
 */
function drawImageInRoundedRect(
  page: PDFPage,
  image: PDFImage,
  box: { x_pt: number; y_pt: number; width_pt: number; height_pt: number },
  radius_pt: number,
): void {
  const x = box.x_pt;
  const y = box.y_pt;
  const w = box.width_pt;
  const h = box.height_pt;
  const r = Math.min(radius_pt, w / 2, h / 2);
  const k = r * 0.5523; // bezier-приближение четверти окружности

  // Путь по контуру со скруглениями (против часовой, начиная с низа левой стороны).
  page.pushOperators(
    pushGraphicsState(),
    moveTo(x + r, y),
    lineTo(x + w - r, y),
    appendBezierCurve(x + w - r + k, y, x + w, y + r - k, x + w, y + r),
    lineTo(x + w, y + h - r),
    appendBezierCurve(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h),
    lineTo(x + r, y + h),
    appendBezierCurve(x + r - k, y + h, x, y + h - r + k, x, y + h - r),
    lineTo(x, y + r),
    appendBezierCurve(x, y + r - k, x + r - k, y, x + r, y),
    clip(),
    endPath(),
  );
  page.drawImage(image, { x, y, width: w, height: h });
  page.pushOperators(popGraphicsState());
}

/**
 * Собирает все URL фото из развёрстки (instance.data) для предзагрузки.
 *
 * Значения фото лежат в `instance.data[label]` как публичные/signed URL
 * (начинаются с `http`). Служебные ключи (`__scale__`, `__offset__`,
 * `__bg__`, `__hidden__` и т.п.) начинаются с `__` — пропускаем. Текстовые
 * значения (имена/цитаты) не начинаются с `http` — тоже отсеиваются. Декор
 * (template.url) сюда не попадает (его немного, грузится по ходу). Результат
 * дедуплицирован.
 */
export function collectPhotoUrlsFromSpreads(
  spreads: ReadonlyArray<{ data?: Record<string, string | null> | null }>,
): string[] {
  const urls = new Set<string>();
  for (const sp of spreads) {
    const data = sp.data;
    if (!data) continue;
    for (const key of Object.keys(data)) {
      if (key.startsWith('__')) continue;
      const value = data[key];
      if (typeof value === 'string' && value.startsWith('http')) {
        urls.add(value);
      }
    }
  }
  return Array.from(urls);
}

/**
 * Запускает задачи с ограничением одновременности (пул воркеров). Задачи —
 * thunk'и, возвращающие Promise; ошибки внутри проглатываются на уровне самих
 * задач (loader'ы возвращают null). Завершается, когда все задачи отработали.
 */
async function runPool(
  tasks: ReadonlyArray<() => Promise<unknown>>,
  limit: number,
): Promise<void> {
  let next = 0;
  const workerCount = Math.min(Math.max(1, limit), tasks.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (next < tasks.length) {
      const idx = next++;
      await tasks[idx]();
    }
  });
  await Promise.all(workers);
}

/**
 * Предзагрузка исходников фото ПАРАЛЛЕЛЬНО (пул ~8-10) в кэш ctx.sourceCache
 * ДО последовательного цикла рендера. Раньше каждое фото грузилось по одному
 * внутри рендера (узкое место — сеть, не sharp), из-за чего большие альбомы
 * падали по таймауту. Здесь мы только наполняем кэш (сеть), ресэмплинг
 * остаётся пофото в рендере. Логика выбора источника (оригинал vs selection)
 * та же, что в fetchPhotoSource, поэтому рендер попадает в кэш.
 *
 * Не пушит warning'и (это делает fetchPhotoSource при реальном embed'е, чтобы
 * не задвоить). Если sourceCache не задан — no-op.
 */
export async function prefetchPhotoSources(
  ctx: PhotoEmbedContext,
  photoUrls: ReadonlyArray<string>,
  concurrency: number = 8,
): Promise<void> {
  if (!ctx.sourceCache || photoUrls.length === 0) return;
  const tasks = photoUrls.map((url) => () => primePhotoSource(ctx, url));
  await runPool(tasks, concurrency);
}

/**
 * Наполняет кэш для одного URL тем же ключом, который запросит рендер.
 * Зеркалит решение fetchPhotoSource: для не-preview профиля при наличии
 * оригинала грузим оригинал; если оригинала нет или он упал — selection.
 */
async function primePhotoSource(
  ctx: PhotoEmbedContext,
  photoUrl: string,
): Promise<void> {
  const filename =
    ctx.urlToFilename[storageKeyFromUrl(photoUrl)] ??
    extractFilenameFromUrl(photoUrl);

  if (ctx.profile.quality !== 'preview' && filename) {
    const original = ctx.originals.find((o) => o.filename === filename);
    if (original) {
      const buffer = await cachedLoad(
        ctx.sourceCache,
        `orig:${original.storage_path}`,
        () => fetchObjectBuffer(original.storage_path),
      );
      // Оригинал загружен — selection не понадобится, выходим.
      if (buffer) return;
      // Оригинал упал — грузим selection как fallback (рендер пойдёт туда же).
    }
  }

  await cachedLoad(ctx.sourceCache, `sel:${photoUrl}`, () =>
    fetchBuffer(photoUrl),
  );
}

/**
 * Ресэмпл исходного буфера фото в JPEG под целевой размер+трансформ. Чистая
 * sharp-логика (3 пути: fast/custom/rotate), вынесена из embedPhotoOnPage, чтобы
 * её можно было прогнать ПАРАЛЛЕЛЬНО в префетче. Бросает при ошибке декода.
 */
export async function resamplePhotoBuffer(
  sourceBuffer: Buffer,
  ph: PhotoPlaceholder,
  dpi: number,
  jpegQuality: number,
  scale: number,
  offsetX: number,
  offsetY: number,
  rotateDeg: number,
): Promise<Buffer> {
  const targetW_px = mmToPixels(ph.width_mm, dpi);
  const targetH_px = mmToPixels(ph.height_mm, dpi);
  const hasRotate = rotateDeg !== 0;
  const hasCustom = scale !== 1 || offsetX !== 0 || offsetY !== 0 || hasRotate;

  if (!hasCustom) {
    // FAST PATH: default crop (fit:'cover'). Байт-в-байт как раньше.
    return await sharp(sourceBuffer)
      .rotate()
      .resize(targetW_px, targetH_px, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: jpegQuality, mozjpeg: true })
      .toBuffer();
  }

  if (!hasRotate) {
    // CUSTOM PATH: computeCrop + extract + resize fit:'fill'.
    const rotated = sharp(sourceBuffer).rotate();
    const meta = await rotated.metadata();
    const natW = meta.width ?? 0;
    const natH = meta.height ?? 0;
    if (natW <= 0 || natH <= 0) {
      throw new Error(`invalid image dimensions: ${natW}x${natH}`);
    }
    const targetRatio = ph.width_mm / ph.height_mm;
    const crop = computeCrop(natW, natH, targetRatio, scale, offsetX, offsetY);
    const extLeft = Math.max(0, Math.round(crop.cropX));
    const extTop = Math.max(0, Math.round(crop.cropY));
    const extW = Math.max(1, Math.round(crop.cropW));
    const extH = Math.max(1, Math.round(crop.cropH));
    const safeW = Math.min(extW, natW - extLeft);
    const safeH = Math.min(extH, natH - extTop);
    return await rotated
      .extract({ left: extLeft, top: extTop, width: safeW, height: safeH })
      .resize(targetW_px, targetH_px, { fit: 'fill' })
      .jpeg({ quality: jpegQuality, mozjpeg: true })
      .toBuffer();
  }

  // ROTATE PATH (Р.2): base crop расширяем на auto-zoom, вращаем, обрезаем.
  const rotated = sharp(sourceBuffer).rotate();
  const meta = await rotated.metadata();
  const natW = meta.width ?? 0;
  const natH = meta.height ?? 0;
  if (natW <= 0 || natH <= 0) {
    throw new Error(`invalid image dimensions: ${natW}x${natH}`);
  }
  const targetRatio = ph.width_mm / ph.height_mm;
  const baseCrop = computeCrop(natW, natH, targetRatio, scale, offsetX, offsetY);
  const authZoom = computeAutoZoomForRotation(rotateDeg, targetRatio);
  const cx = baseCrop.cropX + baseCrop.cropW / 2;
  const cy = baseCrop.cropY + baseCrop.cropH / 2;
  const enlW = baseCrop.cropW * authZoom;
  const enlH = baseCrop.cropH * authZoom;
  let enlLeft = cx - enlW / 2;
  let enlTop = cy - enlH / 2;
  enlLeft = Math.max(0, enlLeft);
  enlTop = Math.max(0, enlTop);
  const maxW = natW - enlLeft;
  const maxH = natH - enlTop;
  const safeW = Math.max(1, Math.min(Math.round(enlW), Math.round(maxW)));
  const safeH = Math.max(1, Math.min(Math.round(enlH), Math.round(maxH)));
  const safeLeft = Math.max(0, Math.round(enlLeft));
  const safeTop = Math.max(0, Math.round(enlTop));
  const interW = Math.max(1, Math.round(targetW_px * authZoom));
  const interH = Math.max(1, Math.round(targetH_px * authZoom));
  return await rotated
    .extract({ left: safeLeft, top: safeTop, width: safeW, height: safeH })
    .resize(interW, interH, { fit: 'fill' })
    .rotate(rotateDeg, { background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .resize(targetW_px, targetH_px, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: jpegQuality, mozjpeg: true })
    .toBuffer();
}

/**
 * Параллельный ПРЕДВАРИТЕЛЬНЫЙ ресэмпл всех фото (пул ~4-6 — sharp использует
 * нативный threadpool) в ctx.resampledCache ДО последовательного рендера. Это
 * убирает основное замедление экспорта (sharp-ресэмплинг в 300dpi был serial).
 * Источники берёт из sourceCache (предзагружены сетью). Дедуп по resampleKey.
 * Ошибки декода глотаются — рендер сам нарисует серую заглушку + warning.
 */
export async function prefetchResampledPhotos(
  ctx: PhotoEmbedContext,
  requests: ReadonlyArray<ResampleRequest>,
  concurrency: number = 4,
): Promise<void> {
  if (!ctx.resampledCache || requests.length === 0) return;
  const cache = ctx.resampledCache;

  // Дедуп по ключу (одно фото в нескольких книгах ресэмплим один раз).
  const seen = new Set<string>();
  const unique: Array<{ key: string; req: ResampleRequest }> = [];
  for (const req of requests) {
    const key = resampleKey(
      req.photoUrl,
      req.ph,
      ctx.profile.dpi,
      req.scale,
      req.offsetX,
      req.offsetY,
      req.rotateDeg,
    );
    if (seen.has(key) || cache.has(key)) continue;
    seen.add(key);
    unique.push({ key, req });
  }

  const tasks = unique.map(({ key, req }) => async () => {
    // Источник (оригинал/selection) — через тот же fetchPhotoSource (кэш буферов).
    const source = await fetchPhotoSource(ctx, req.photoUrl, req.ph, 0);
    if (!source) return; // рендер нарисует заглушку + photo_not_found
    try {
      const buf = await resamplePhotoBuffer(
        source.buffer,
        req.ph,
        ctx.profile.dpi,
        ctx.profile.jpeg_quality,
        req.scale,
        req.offsetX,
        req.offsetY,
        req.rotateDeg,
      );
      cache.set(key, buf);
    } catch {
      // оставляем рендеру (он повторит и запишет warning)
    }
  });
  await runPool(tasks, concurrency);
}

/**
 * Поиск фото для embed'а: оригинал → fallback на selection.
 *
 * Возвращает Buffer + метаданные source ('original' / 'selection').
 * Возвращает null если все попытки fetch'а упали.
 */
async function fetchPhotoSource(
  ctx: PhotoEmbedContext,
  photoUrl: string,
  ph: PhotoPlaceholder,
  spread_index: number
): Promise<PhotoSource | null> {
  // urlToFilename теперь ключуется по storage_path (signed URL не годится
  // как ключ — он non-deterministic). Извлекаем storage_path из signed URL.
  const filename = ctx.urlToFilename[storageKeyFromUrl(photoUrl)] ?? extractFilenameFromUrl(photoUrl);

  // 1. Если профиль не preview — пытаемся найти оригинал
  if (ctx.profile.quality !== 'preview' && filename) {
    const original = ctx.originals.find((o) => o.filename === filename);
    if (original) {
      // Бакет приватный — читаем байты напрямую через S3 (креды сервера),
      // без публичного HTTP-фетча. Через кэш: тот же оригинал (например, один
      // портрет в блоке и на обложке) грузится один раз.
      const buffer = await cachedLoad(
        ctx.sourceCache,
        `orig:${original.storage_path}`,
        () => fetchObjectBuffer(original.storage_path),
      );
      if (buffer) {
        return { buffer, source: 'original', filename };
      }
      // чтение упало — продолжаем к fallback
    }
    // Оригинал не найден ИЛИ fetch упал — warning + fallback
    if (ctx.profile.quality === 'high') {
      ctx.warnings.push({
        code: 'no_original',
        detail: `${filename}: оригинал не найден, использован сжатый WebP из selections`,
        context: { spread_index, label: ph.label, filename },
      });
    }
  }

  // 2. Fallback: selection WebP по photoUrl (через кэш — дедуп повторов).
  const buffer = await cachedLoad(
    ctx.sourceCache,
    `sel:${photoUrl}`,
    () => fetchBuffer(photoUrl),
  );
  if (!buffer) {
    ctx.warnings.push({
      code: 'photo_not_found',
      detail: `Не удалось скачать фото: ${photoUrl}`,
      context: { spread_index, label: ph.label, filename },
    });
    return null;
  }
  return { buffer, source: 'selection', filename };
}

/**
 * Скачать произвольный URL в Buffer. Возвращает null при ошибке fetch'а
 * или non-2xx статусе.
 *
 * Используется глобальный fetch (доступен в Node 18+ / Vercel runtime).
 */
async function fetchBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
}

/**
 * Извлекает оригинальное имя файла из YC public URL.
 *
 * Storage path для photos: `<album_id>/portrait/<ts>_<filename>`.
 * URL: `https://storage.yandexcloud.net/yearbook-photos/<storage_path>`.
 *
 * Парсим последний сегмент пути и ищем `_` — всё что после это и есть
 * filename. Если разделителя нет — вернётся весь segment.
 *
 * Используется как fallback когда `urlToFilename` мапы нет (на случай
 * если endpoint не передал её — фаза 3.6 обычно передаёт).
 */
function extractFilenameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const segments = u.pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    if (!last) return '';
    const underscoreIdx = last.indexOf('_');
    if (underscoreIdx === -1) return last;
    // Проверяем что префикс перед `_` — это unix-timestamp в миллисекундах
    // (10-13 цифр). Если да — возвращаем часть после `_`. Если нет — весь
    // сегмент (имя могло содержать `_` и не быть нашим форматом).
    const prefix = last.slice(0, underscoreIdx);
    if (/^\d{10,13}$/.test(prefix)) {
      return last.slice(underscoreIdx + 1);
    }
    return last;
  } catch {
    return '';
  }
}

/**
 * Извлекает storage_path (без 'yc:' и без имени бакета) из signed/публичного
 * YC URL — для lookup'а filename в urlToFilename мапе (она ключуется по
 * storage_path). pathname signed URL = `/<bucket>/<storage_path>`, query с
 * подписью отбрасывается. Возвращает '' если URL не парсится.
 */
function storageKeyFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const segments = u.pathname.split('/').filter(Boolean);
    // YC отдаёт signed URL в virtual-hosted стиле: имя бакета в ДОМЕНЕ
    // (yearbook-photos.storage.yandexcloud.net/<storage_path>) — тогда весь
    // путь и есть ключ. В path-style (storage.yandexcloud.net/<bucket>/<path>)
    // первый сегмент — имя бакета, его отбрасываем. Раньше код всегда резал
    // первый сегмент и в virtual-hosted терял id альбома → ключ не совпадал
    // с urlToFilename → оригинал не находился.
    if (u.hostname.startsWith('storage.')) {
      return segments.slice(1).join('/');
    }
    return segments.join('/');
  } catch {
    return '';
  }
}

/**
 * Читает байты объекта приватного бакета напрямую через S3 (креды сервера).
 * Возвращает null при ошибке (отсутствие объекта и т.п.) — семантика как у
 * fetchBuffer, чтобы вызывающий код мог уйти в fallback.
 */
async function fetchObjectBuffer(storage_path: string): Promise<Buffer | null> {
  try {
    return await ycGetObjectBuffer(storage_path);
  } catch {
    return null;
  }
}

/**
 * Рисует image в круглом clip-mask внутри bounding box.
 *
 * Используется для is_circle=true placeholder'ов (учительские аватарки
 * в F-Head-*Grid и G-Teachers-*).
 *
 * Реализация: PDF graphics state + Bezier-аппроксимация круга через
 * 4 кубические кривые (magic constant 0.5522847498). Это стандартный
 * подход для PDF/SVG/Quartz.
 *
 * Координаты в pt. cx/cy — центр круга, r — радиус. r вычисляется как
 * min(width, height) / 2 — если рамка не квадратная, круг вписывается.
 */
function drawImageInCircle(
  page: PDFPage,
  image: PDFImage,
  box: { x_pt: number; y_pt: number; width_pt: number; height_pt: number },
  rotation_deg: number
): void {
  const cx = box.x_pt + box.width_pt / 2;
  const cy = box.y_pt + box.height_pt / 2;
  const r = Math.min(box.width_pt, box.height_pt) / 2;
  const c = 0.5522847498 * r; // magic constant: cubic Bezier для круга

  // saveGraphicsState → определяем clip path → drawImage → restoreGraphicsState
  page.pushOperators(
    pushGraphicsState(),
    moveTo(cx - r, cy),
    appendBezierCurve(cx - r, cy + c, cx - c, cy + r, cx, cy + r),
    appendBezierCurve(cx + c, cy + r, cx + r, cy + c, cx + r, cy),
    appendBezierCurve(cx + r, cy - c, cx + c, cy - r, cx, cy - r),
    appendBezierCurve(cx - c, cy - r, cx - r, cy - c, cx - r, cy),
    closePath(),
    clip(),
    endPath() // n — no fill (clip path applied, без заливки)
  );

  page.drawImage(image, {
    x: box.x_pt,
    y: box.y_pt,
    width: box.width_pt,
    height: box.height_pt,
    rotate: degrees(rotation_deg),
  });

  page.pushOperators(popGraphicsState());
}
