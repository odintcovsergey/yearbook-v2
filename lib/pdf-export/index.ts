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
import { renderAllSpreads, renderTypographyUnits } from './pipeline';
import { adaptTemplateSetToFormat } from '@/lib/export-typography/adapt';
import type { AcceptMode } from '@/lib/export-typography/plan';
import type { CoverRenderUnit } from '@/lib/export-typography/covers';
import type { PrinterFormat } from '@/lib/printers/types';
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
  OriginalPhoto,
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

// ─── Типографская выгрузка (ТЗ экспорта 20.06.2026) ──────────────────────────

/** Один готовый файл выгрузки (одностраничный PDF под именем КНИГА-НОМЕР). */
export type TypographyExportFile = {
  /** Имя без расширения, напр. "000-01". */
  name: string;
  ext: 'pdf';
  bytes: Uint8Array;
  book_id: string;
};

export type TypographyExportResult = {
  files: TypographyExportFile[];
  warnings: PdfWarning[];
  /** Суммарно визуальных разворотов (для лимита/диагностики). */
  totalSpreads: number;
  hasPersonal: boolean;
  /** Сколько файлов-обложек попало в выгрузку. */
  coverCount: number;
  /** Статус адаптации под формат заказа. */
  adaptStatus: 'native' | 'adapted' | 'incompatible';
  adaptWarning?: string;
};

/**
 * Главный entry point типографской выгрузки.
 *
 *  1. Адаптирует набор под формат заказа (uniform-масштаб; native если формат
 *     не выбран; incompatible-семейство → как есть + warning).
 *  2. Рендерит все файлы (по книгам 000/00X; разворотами/постранично) в один
 *     PDFDocument — по странице на файл.
 *  3. Режет на одностраничные PDF под именами КНИГА-НОМЕР.
 *
 * Возвращает массив именованных файлов — endpoint пакует их в zip и
 * выкладывает в хранилище. JPG-вывод (по профилю) — отдельный заход.
 */
export async function exportAlbumTypography(
  input: AlbumExportInput,
  opts: {
    acceptMode: AcceptMode;
    targetFormat: PrinterFormat | null;
    coverUnits?: CoverRenderUnit[];
  },
): Promise<TypographyExportResult> {
  const warnings: PdfWarning[] = [];

  // 1. Адаптация набора под формат заказа.
  const adapt = adaptTemplateSetToFormat(input.templateSet, opts.targetFormat);
  const adaptedInput: AlbumExportInput = { ...input, templateSet: adapt.templateSet };

  // 2. Документ + шрифты.
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(input.album.name);
  pdfDoc.setCreator('OkeyBook');
  pdfDoc.setProducer('OkeyBook Typography Export (pdf-lib)');
  pdfDoc.setCreationDate(new Date());
  const fontRegistry = await loadFonts(pdfDoc);

  // 3. Рендер юнитов (по странице на файл, в порядке книг/файлов) + обложки.
  const rendered = await renderTypographyUnits(
    pdfDoc,
    fontRegistry,
    adaptedInput,
    opts.acceptMode,
    opts.coverUnits ?? [],
  );
  warnings.push(...fontRegistry.warnings, ...rendered.warnings);

  // 4. Режем общий документ на одностраничные PDF по именам файлов.
  const files: TypographyExportFile[] = [];
  for (const rf of rendered.files) {
    const single = await PDFDocument.create();
    const [pg] = await single.copyPages(pdfDoc, [rf.page_index]);
    single.addPage(pg);
    const bytes = await single.save();
    files.push({ name: rf.file_name, ext: 'pdf', bytes, book_id: rf.book_id });
  }

  return {
    files,
    warnings,
    totalSpreads: rendered.plan.total_spreads,
    hasPersonal: rendered.plan.has_personal,
    coverCount: (opts.coverUnits ?? []).length,
    adaptStatus: adapt.status,
    adaptWarning: adapt.warning,
  };
}
