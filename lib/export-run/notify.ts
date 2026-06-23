/**
 * Точка расширения для уведомлений о готовности экспорта (ТЗ №2, §4).
 *
 * СЕЙЧАС: ничего не делает (внутрисистемный индикатор статуса в кабинете
 * достаточен — UI опрашивает export_status). Воркер зовёт эту функцию при
 * переходе задачи в 'done' / 'failed'.
 *
 * ПОЗЖЕ (отдельным ТЗ): сюда подключится внешний канал — Telegram-бот/канал
 * партнёра. Архитектурно это единственное место, куда добавится отправка,
 * без переделки очереди/воркера. НЕ реализуем сейчас.
 */

export type ExportNotifyEvent = {
  jobId: string
  albumId: string
  tenantId: string
  kind: 'pdf' | 'typography'
  status: 'done' | 'failed'
  filename?: string
  error?: string
}

export async function notifyExportReady(_event: ExportNotifyEvent): Promise<void> {
  // TODO(Telegram): отправить уведомление о готовности/ошибке экспорта.
  // Заглушка: внутрисистемный статус (export_jobs.status + опрос в кабинете)
  // уже информирует партнёра. Внешний канал — отдельное ТЗ.
  return
}
