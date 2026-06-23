/**
 * lib/export-run — общее ядро экспорта альбома (ТЗ №2, фоновая очередь).
 *
 * Здесь живёт «загрузить данные альбома → отрендерить существующим кодом
 * lib/pdf-export → залить в S3 → (для PDF) записать историю», вынесенное из
 * двух обработчиков app/api/layout/route.ts. Эти функции зовут И синхронный
 * путь (малые альбомы, как сейчас), И воркер очереди (большие альбомы).
 * Логика рендера/вёрстки НЕ менялась — переиспользуем exportAlbumPdf /
 * exportAlbumTypography как есть.
 */
export { SYNC_SPREAD_THRESHOLD, queueStorageKey, ExportRunError, type ExportKind } from './core'
export { mapExportProfile, slugifyForFilename, renderFilename } from './profile'
export { executePdfExport, type PdfExportOutput } from './pdf'
export { executeTypographyExport, type TypographyExportOutput } from './typography'
export { loadExportProfileBySlug } from './load-profile'
export { notifyExportReady, type ExportNotifyEvent } from './notify'
