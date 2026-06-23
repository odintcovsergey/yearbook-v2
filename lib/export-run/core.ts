/**
 * Базовые константы/типы/ошибки ядра экспорта — без зависимостей на pdf/
 * typography, чтобы не было циклических импортов (index реэкспортирует).
 */

/**
 * Порог «маленький / большой» по числу разворотов вёрстки.
 * <= порога — синхронный экспорт в HTTP-запросе (мгновенно, как сейчас).
 * >  порога — фоновая очередь (воркер на VDS, без лимита времени).
 *
 * Решение Сергея (ТЗ №2): ориентир ~30, уточняется по реальному поведению.
 * Считаем по СЫРОМУ числу разворотов layout (album_layouts.spreads.length).
 * Тюнится без передеплоя через env EXPORT_SYNC_SPREAD_THRESHOLD.
 */
export const SYNC_SPREAD_THRESHOLD = Number(process.env.EXPORT_SYNC_SPREAD_THRESHOLD) || 30

export type ExportKind = 'pdf' | 'typography'

/**
 * Стабильный ключ файла очереди в S3 («храним только последний файл на
 * альбом»): новый рендер той же задачи затирает прошлый. Синхронный путь
 * по-прежнему пишет по timestamp'у (история album_exports).
 */
export function queueStorageKey(albumId: string, kind: ExportKind, slug: string, ext: string): string {
  const safeSlug = slug.replace(/[^a-zA-Z0-9_-]/g, '') || kind
  return kind === 'typography'
    ? `${albumId}/exports/queue_typography.zip`
    : `${albumId}/exports/queue_${safeSlug}.${ext}`
}

/**
 * Ошибка с кодом и HTTP-статусом — чтобы синхронный роут отдал ровно тот же
 * ответ, что и раньше, а воркер записал понятный текст в export_jobs.error.
 */
export class ExportRunError extends Error {
  code: string
  httpStatus: number
  constructor(message: string, code: string, httpStatus = 500) {
    super(message)
    this.name = 'ExportRunError'
    this.code = code
    this.httpStatus = httpStatus
  }
}
