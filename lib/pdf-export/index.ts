/**
 * Публичный API PDF-экспорта (фаза 3).
 *
 * В подэтапе 3.2 (текущий) — фундамент готов:
 *   - Типы (types.ts)
 *   - Конверсии единиц + box geometry (units.ts)
 *   - Загрузка шрифтов (font-loader.ts)
 *
 * В 3.3-3.5 будут добавлены:
 *   - pipeline.ts — orchestrator: layout → PDF Bytes
 *   - photo-embed.ts — sharp resample + lookup оригинала
 *   - text-shaping.ts — line wrap, auto_fit, vertical_align
 *
 * exportAlbumPdf пока заглушка с TODO. Endpoint /api/layout?action=export
 * (фаза 3.6) будет вызывать его и пока вернёт 501 если pipeline
 * не реализован.
 *
 * См. docs/phase-3-spec.md §3.4, §4.5.
 */

import { PDFDocument } from 'pdf-lib';
import { loadFonts } from './font-loader';
import { renderAllSpreads } from './pipeline';
import type {
  AlbumExportInput,
  ExportResult,
  PdfWarning,
} from './types';

// Re-exports чтобы потребители (route handler) импортировали из одного места.
export type {
  AlbumExportInput,
  ExportResult,
  ExportProfile,
  PdfWarning,
  PdfWarningCode,
  PageBoxes,
  ExportPurpose,
  ExportFormat,
  ExportQuality,
  ExportColorMode,
  ExportPagesMode,
} from './types';
export {
  PT_PER_MM,
  MM_PER_PT,
  mmToPt,
  ptToMm,
  mmToPixels,
  computePageBoxes,
  flipY,
  placeholderToPdfBox,
  hexToRgb01,
} from './units';
export { loadFonts } from './font-loader';
export type { FontRegistry } from './font-loader';
export { renderAllSpreads } from './pipeline';

/**
 * Главный entry point PDF-экспорта.
 *
 * Pipeline (фаза 3.3):
 *   1. Создаёт PDFDocument с metadata
 *   2. Загружает все 5 шрифтов через loadFonts (subset=true)
 *   3. Вызывает renderAllSpreads — для каждого SpreadInstance
 *      добавляет 1 или 2 страницы (зависит от is_spread мастера),
 *      рисует placeholder'ы (заглушки фото в 3.3, реальные в 3.4)
 *   4. Сериализует PDF
 *
 * Возвращает PDF Bytes + page count + накопленные warnings от всех
 * подсистем (font registry + pipeline). Endpoint /api/layout?action=export
 * (фаза 3.6) загружает Bytes в YC и записывает warnings в album_exports.
 */
export async function exportAlbumPdf(
  input: AlbumExportInput
): Promise<ExportResult> {
  const warnings: PdfWarning[] = [];

  // 1. Создаём PDFDocument
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(input.album.name);
  pdfDoc.setCreator('OkeyBook');
  pdfDoc.setProducer('OkeyBook PDF Export (pdf-lib)');
  pdfDoc.setCreationDate(new Date());

  // 2. Загружаем шрифты (subset=true)
  const fontRegistry = await loadFonts(pdfDoc);

  // 3. Рендерим все SpreadInstance через pipeline
  const renderResult = await renderAllSpreads(pdfDoc, fontRegistry, input);

  // 4. Сериализация
  const pdfBytes = await pdfDoc.save();

  // 5. Мерджим warnings из всех источников
  warnings.push(...fontRegistry.warnings);
  warnings.push(...renderResult.warnings);

  return {
    pdfBytes,
    pageCount: renderResult.pageCount,
    warnings,
  };
}
