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
import { computePageBoxes, mmToPt } from './units';
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

/**
 * Главный entry point PDF-экспорта.
 *
 * В фазе 3.2 — заглушка: создаёт пустой PDF с правильным размером
 * страницы (для smoke-проверки что fundament работает) и возвращает
 * его. В 3.3 заменяется на реальный pipeline через
 * `lib/pdf-export/pipeline.ts`.
 *
 * Документирует контракт: что именно ожидается на входе и на выходе.
 */
export async function exportAlbumPdf(
  input: AlbumExportInput
): Promise<ExportResult> {
  const { templateSet, profile, layout } = input;

  // 1. Создаём PDFDocument
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(input.album.name);
  pdfDoc.setCreator('OkeyBook');
  pdfDoc.setProducer('OkeyBook PDF Export (pdf-lib)');
  pdfDoc.setCreationDate(new Date());

  // 2. Загружаем шрифты (subset=true). В фазе 3.2 шрифты загружаются,
  // но в pipeline пока не используются.
  const fontRegistry = await loadFonts(pdfDoc);

  // 3. Считаем page boxes из template_set + profile.
  const pageBoxes = computePageBoxes(
    templateSet.page_width_mm,
    templateSet.page_height_mm,
    templateSet.bleed_mm,
    profile.include_bleed
  );

  const warnings: PdfWarning[] = [];

  // 4. TODO (фаза 3.3): для каждого SpreadInstance из layout.spreads
  // вызвать renderSpread(pdfDoc, instance, ...).
  //
  // В фазе 3.2 — рендерим пустые страницы правильного размера, чтобы
  // smoke-проверить что pdfDoc создаётся, шрифты загружаются и
  // page boxes считаются корректно.

  for (let i = 0; i < layout.spreads.length; i++) {
    const page = pdfDoc.addPage([
      mmToPt(pageBoxes.media_width_mm),
      mmToPt(pageBoxes.media_height_mm),
    ]);

    // TrimBox = trim-зона (без bleed)
    if (profile.include_bleed && pageBoxes.bleed_mm > 0) {
      page.setTrimBox(
        mmToPt(pageBoxes.bleed_mm),
        mmToPt(pageBoxes.bleed_mm),
        mmToPt(pageBoxes.trim_width_mm),
        mmToPt(pageBoxes.trim_height_mm)
      );
      // BleedBox = весь mediaBox (то же что mediaBox в нашем случае)
      page.setBleedBox(
        0,
        0,
        mmToPt(pageBoxes.media_width_mm),
        mmToPt(pageBoxes.media_height_mm)
      );
    }
  }

  // 5. Сериализация
  const pdfBytes = await pdfDoc.save();

  // 6. Мерджим warnings из всех источников
  warnings.push(...fontRegistry.warnings);

  return {
    pdfBytes,
    pageCount: layout.spreads.length,
    warnings,
  };
}
