/**
 * Растеризация одностраничного PDF в JPEG (для JPG-вывода типографии).
 *
 * Берёт готовый PDF-файл (тот же рендер pdf-lib, что и для PDF-выгрузки) и
 * превращает страницу в картинку через pdfjs-dist + @napi-rs/canvas. Так JPG
 * ГАРАНТИРОВАННО совпадает с PDF (растеризуем ровно его), а не рисуется заново.
 *
 * ВАЖНО: работает только если шрифты в PDF встроены ЦЕЛИКОМ (subset:false) —
 * наш loadFonts так и делает. С subset:true pdfjs роняет глифы (особенно
 * кириллицу). См. font-loader.ts (там subset:false и предупреждение).
 *
 * Нативные зависимости (@napi-rs/canvas) подгружаются ЛЕНИВО (dynamic import) —
 * только когда реально нужен JPG, чтобы не тянуть их в PDF-путь/клиент.
 */

import type { PdfWarning } from './types';

let rasterizerPromise: Promise<{
  getDocument: (args: unknown) => { promise: Promise<PdfjsDoc> };
  createCanvas: (w: number, h: number) => NapiCanvas;
}> | null = null;

type PdfjsDoc = {
  getPage: (n: number) => Promise<PdfjsPage>;
  destroy?: () => Promise<void>;
};
type PdfjsPage = {
  getViewport: (args: { scale: number }) => { width: number; height: number };
  render: (args: { canvasContext: unknown; viewport: unknown }) => { promise: Promise<void> };
};
type NapiCanvas = {
  width: number;
  height: number;
  getContext: (t: '2d') => unknown;
  toBuffer: (mime: 'image/jpeg', quality?: number) => Buffer;
};

/** Лениво грузит pdfjs (legacy, без воркера) + napi canvas. */
async function getRasterizer() {
  if (!rasterizerPromise) {
    rasterizerPromise = (async () => {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const { createCanvas } = await import('@napi-rs/canvas');
      return {
        getDocument: (args: unknown) =>
          (pdfjs as unknown as { getDocument: (a: unknown) => { promise: Promise<PdfjsDoc> } }).getDocument(
            args,
          ),
        createCanvas: createCanvas as unknown as (w: number, h: number) => NapiCanvas,
      };
    })();
  }
  return rasterizerPromise;
}

/**
 * Растеризует ПЕРВУЮ страницу PDF в JPEG.
 *
 * @param pdfBytes — одностраничный PDF (mediaBox = размер файла).
 * @param dpi — целевое разрешение (300 для типографии).
 * @param jpegQuality — качество JPEG 1..100.
 * @returns JPEG-байты, либо бросает (caller решает fallback).
 */
export async function rasterizePdfToJpeg(
  pdfBytes: Uint8Array,
  dpi: number,
  jpegQuality: number,
): Promise<Uint8Array> {
  const { getDocument, createCanvas } = await getRasterizer();

  const doc = await getDocument({
    data: new Uint8Array(pdfBytes),
    disableWorker: true,
    // Не тянем системные шрифты — у нас всё встроено в PDF.
    useSystemFonts: false,
    isEvalSupported: false,
  }).promise;
  try {
    const page = await doc.getPage(1);
    // pdf-lib пишет mediaBox в пунктах (1pt = 1/72"). scale = dpi/72.
    const viewport = page.getViewport({ scale: dpi / 72 });
    const canvas = createCanvas(
      Math.max(1, Math.ceil(viewport.width)),
      Math.max(1, Math.ceil(viewport.height)),
    );
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    const buf = canvas.toBuffer('image/jpeg', Math.round(jpegQuality));
    return new Uint8Array(buf);
  } finally {
    await doc.destroy?.();
  }
}

/**
 * Растеризует с мягким fallback: при ошибке возвращает null и пишет warning,
 * чтобы caller мог оставить PDF-файл вместо JPG (выгрузка не падает целиком).
 */
export async function rasterizePdfToJpegSafe(
  pdfBytes: Uint8Array,
  dpi: number,
  jpegQuality: number,
  fileName: string,
  warnings: PdfWarning[],
): Promise<Uint8Array | null> {
  try {
    return await rasterizePdfToJpeg(pdfBytes, dpi, jpegQuality);
  } catch (e) {
    warnings.push({
      code: 'image_decode_failed',
      detail: `растеризация в JPG не удалась для ${fileName}: ${(e as Error).message}`,
      context: { file: fileName },
    });
    return null;
  }
}
