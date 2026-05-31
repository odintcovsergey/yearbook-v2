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
};

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

  // Resample через sharp к нужному pixel-разрешению.
  const targetW_px = mmToPixels(ph.width_mm, ctx.profile.dpi);
  const targetH_px = mmToPixels(ph.height_mm, ctx.profile.dpi);

  // КЭ.7 — определяем custom transform.
  // hasCustom=false → используем старую fast-path sharp.resize fit:'cover'
  //                   (regression-safe для всех существующих PDF)
  // hasCustom=true  → вычисляем CropParams через computeCrop, применяем
  //                   через sharp.extract + sharp.resize fit:'fill'
  // Р.2 — отдельная ветка с поворотом, выше custom: если rotateDeg≠0,
  //       расширяем crop до auto-zoom × и вращаем после resize.
  const hasRotate = rotateDeg !== 0;
  const hasCustom = scale !== 1 || offsetX !== 0 || offsetY !== 0 || hasRotate;

  let resampled: Buffer;
  try {
    if (!hasCustom) {
      // FAST PATH: исходное поведение для default crop. Байт-в-байт
      // идентично PDF до КЭ — никаких сюрпризов для уже-экспортированных
      // альбомов.
      resampled = await sharp(photoSource.buffer)
        .rotate() // авто-ориентация по EXIF
        .resize(targetW_px, targetH_px, {
          fit: 'cover',
          position: 'centre',
        })
        .jpeg({
          quality: ctx.profile.jpeg_quality,
          mozjpeg: true,
        })
        .toBuffer();
    } else if (!hasRotate) {
      // CUSTOM PATH: применяем computeCrop для извлечения пользовательского
      // crop, потом resize до целевого pixel-разрешения.
      //
      // Алгоритм:
      //   1. sharp().rotate() — авто-ориентация по EXIF (важно! делать ДО
      //      metadata чтобы получить ориентированные размеры)
      //   2. metadata() — натуральные width/height после EXIF rotate
      //   3. computeCrop(natW, natH, targetRatio, scale, offsetX, offsetY)
      //   4. sharp().extract({ left, top, width, height }) — округление
      //      до целых px (sharp требование). На практике незаметно при
      //      300dpi, но фиксируем как известный compromise (см. ТЗ КЭ.4).
      //   5. resize fit:'fill' — мы УЖЕ извлекли крошку, остаётся
      //      просто отресемплить до targetW_px × targetH_px.
      const rotated = sharp(photoSource.buffer).rotate();
      const meta = await rotated.metadata();
      const natW = meta.width ?? 0;
      const natH = meta.height ?? 0;
      if (natW <= 0 || natH <= 0) {
        throw new Error(`invalid image dimensions: ${natW}x${natH}`);
      }
      const targetRatio = ph.width_mm / ph.height_mm;
      const crop = computeCrop(natW, natH, targetRatio, scale, offsetX, offsetY);
      // Округление до целых px (требование sharp.extract).
      const extLeft = Math.max(0, Math.round(crop.cropX));
      const extTop = Math.max(0, Math.round(crop.cropY));
      const extW = Math.max(1, Math.round(crop.cropW));
      const extH = Math.max(1, Math.round(crop.cropH));
      // Защита от выхода за границы (округление вверх могло прибавить):
      const safeW = Math.min(extW, natW - extLeft);
      const safeH = Math.min(extH, natH - extTop);
      resampled = await rotated
        .extract({
          left: extLeft,
          top: extTop,
          width: safeW,
          height: safeH,
        })
        .resize(targetW_px, targetH_px, {
          fit: 'fill',
        })
        .jpeg({
          quality: ctx.profile.jpeg_quality,
          mozjpeg: true,
        })
        .toBuffer();
    } else {
      // ROTATE PATH (Р.2): тот же base crop, но расширенный на auto-zoom
      // factor вокруг центра crop'а. После поворота sharp.resize'ом
      // 'cover' обрезаем центральную часть до targetW × targetH —
      // background по углам не виден (auto-zoom гарантирует покрытие).
      //
      // Шаги:
      //   1. EXIF-rotate + metadata (как в CUSTOM PATH)
      //   2. computeCrop → base crop
      //   3. authZoom = computeAutoZoomForRotation(rotateDeg, aspect)
      //   4. enlargedCrop = base crop, расширенный в authZoom вокруг
      //      центра, clamp до [0, natW/H]
      //   5. extract enlargedCrop
      //   6. resize до (targetW_px*authZoom, targetH_px*authZoom)
      //      fit:'fill' — единая ось масштаба перед вращением
      //   7. rotate(rotateDeg, {background: white}) — повернёт картинку
      //      с белым фоном на углах bounding box'а
      //   8. resize(targetW_px, targetH_px, fit:'cover', position:'centre')
      //      — выйдет центральная часть нужного размера; background
      //      отрезается, поскольку authZoom рассчитан так чтобы
      //      повёрнутая картинка покрывала target.
      const rotated = sharp(photoSource.buffer).rotate();
      const meta = await rotated.metadata();
      const natW = meta.width ?? 0;
      const natH = meta.height ?? 0;
      if (natW <= 0 || natH <= 0) {
        throw new Error(`invalid image dimensions: ${natW}x${natH}`);
      }
      const targetRatio = ph.width_mm / ph.height_mm;
      const baseCrop = computeCrop(natW, natH, targetRatio, scale, offsetX, offsetY);
      const authZoom = computeAutoZoomForRotation(rotateDeg, targetRatio);
      // Центр base crop'а.
      const cx = baseCrop.cropX + baseCrop.cropW / 2;
      const cy = baseCrop.cropY + baseCrop.cropH / 2;
      // Расширенный crop. Может выйти за границы оригинала —
      // обрезаем по фактическим границам (это даст более узкую часть,
      // но не вернёт ошибку sharp.extract).
      const enlW = baseCrop.cropW * authZoom;
      const enlH = baseCrop.cropH * authZoom;
      let enlLeft = cx - enlW / 2;
      let enlTop = cy - enlH / 2;
      // Clamp к границам оригинала.
      enlLeft = Math.max(0, enlLeft);
      enlTop = Math.max(0, enlTop);
      const maxW = natW - enlLeft;
      const maxH = natH - enlTop;
      const safeW = Math.max(1, Math.min(Math.round(enlW), Math.round(maxW)));
      const safeH = Math.max(1, Math.min(Math.round(enlH), Math.round(maxH)));
      const safeLeft = Math.max(0, Math.round(enlLeft));
      const safeTop = Math.max(0, Math.round(enlTop));
      // Промежуточный размер до вращения. Сохраняем aspect рамки.
      const interW = Math.max(1, Math.round(targetW_px * authZoom));
      const interH = Math.max(1, Math.round(targetH_px * authZoom));
      resampled = await rotated
        .extract({
          left: safeLeft,
          top: safeTop,
          width: safeW,
          height: safeH,
        })
        .resize(interW, interH, {
          fit: 'fill',
        })
        .rotate(rotateDeg, {
          // Белый фон может выйти в видимой области если auto-zoom
          // оказался мал (на edge случаях). Чтобы не было видимых
          // артефактов на печати, выбираем фон под цвет страницы.
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        })
        .resize(targetW_px, targetH_px, {
          fit: 'cover',
          position: 'centre',
        })
        .jpeg({
          quality: ctx.profile.jpeg_quality,
          mozjpeg: true,
        })
        .toBuffer();
    }
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

  // Embed в pdf-lib
  let image: PDFImage;
  try {
    image = await ctx.pdfDoc.embedJpg(resampled);
  } catch (e) {
    ctx.warnings.push({
      code: 'image_decode_failed',
      detail: `pdf-lib embedJpg error на ${photoSource.filename}: ${(e as Error).message}`,
      context: { spread_index, label: ph.label, filename: photoSource.filename },
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
  const filename = ctx.urlToFilename[photoUrl] ?? extractFilenameFromUrl(photoUrl);

  // 1. Если профиль не preview — пытаемся найти оригинал
  if (ctx.profile.quality !== 'preview' && filename) {
    const original = ctx.originals.find((o) => o.filename === filename);
    if (original) {
      const buffer = await fetchBuffer(buildYcUrl(original.storage_path));
      if (buffer) {
        return { buffer, source: 'original', filename };
      }
      // fetch упал — продолжаем к fallback
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

  // 2. Fallback: selection WebP по photoUrl
  const buffer = await fetchBuffer(photoUrl);
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
 * Собирает public YC URL из storage_path.
 * Дублирует getPhotoUrl из @/lib/supabase, но без зависимости на
 * client (избегаем тянуть супабейс в pdf-export модуль).
 */
function buildYcUrl(storage_path: string): string {
  const bucket = process.env.YC_BUCKET_NAME ?? 'yearbook-photos';
  return `https://storage.yandexcloud.net/${bucket}/${storage_path}`;
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
