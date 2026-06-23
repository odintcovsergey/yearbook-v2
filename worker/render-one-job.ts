/**
 * Рендер ОДНОЙ задачи очереди экспорта — запускается воркером как отдельный
 * дочерний процесс (`tsx worker/render-one-job.ts <jobId>`).
 *
 * Зачем отдельный процесс: тяжёлый рендер (sharp + pdf-lib, сотни фото) живёт
 * в коротком процессе, который по завершении ОСВОБОЖДАЕТ память; падение/OOM
 * убивает только его, не воркер и не сайт. Переиспользует общий код
 * lib/export-run (тот же, что синхронный путь) — вёрстку не дублируем.
 */
import { getJob, markJobDone, markJobFailed, setJobStage } from '@/lib/export-queue'
import {
  executePdfExport,
  executeTypographyExport,
  loadExportProfileBySlug,
  queueStorageKey,
  notifyExportReady,
} from '@/lib/export-run'

async function main(): Promise<void> {
  const jobId = process.argv[2]
  if (!jobId) {
    console.error('usage: render-one-job <jobId>')
    process.exit(2)
  }

  const job = await getJob(jobId)
  if (!job) {
    console.error(`[render-one-job] job ${jobId} not found`)
    process.exit(2)
  }
  if (job.status !== 'processing') {
    // Уже обработана/перезахвачена — выходим без работы.
    console.log(`[render-one-job] job ${jobId} not in processing (${job.status}), skip`)
    process.exit(0)
  }

  try {
    if (job.kind === 'pdf') {
      const slug = String((job.payload as Record<string, unknown>).profile_slug ?? '')
      await setJobStage(jobId, 'Готовлю профиль')
      const profile = await loadExportProfileBySlug(slug, job.tenant_id)
      if (!profile) throw new Error(`Профиль экспорта "${slug}" не найден или отключён`)
      const key = queueStorageKey(job.album_id, 'pdf', profile.slug, 'pdf')
      await setJobStage(jobId, 'Собираю PDF')
      const out = await executePdfExport({
        albumId: job.album_id,
        profile,
        createdBy: job.created_by,
        storageKey: key,
        recordHistory: false,
      })
      await markJobDone(jobId, {
        storage_path: out.storagePath,
        filename: out.filename,
        file_size: out.fileSize,
        page_count: out.pageCount,
        warnings: out.warnings,
      })
    } else {
      const key = queueStorageKey(job.album_id, 'typography', '', 'zip')
      await setJobStage(jobId, 'Собираю файлы для типографии')
      const out = await executeTypographyExport({ albumId: job.album_id, storageKey: key })
      await markJobDone(jobId, {
        storage_path: out.storagePath,
        filename: out.filename,
        file_size: out.fileSize,
        page_count: out.fileCount,
        warnings: out.warnings,
      })
    }

    await notifyExportReady({
      jobId,
      albumId: job.album_id,
      tenantId: job.tenant_id,
      kind: job.kind,
      status: 'done',
    })
    console.log(`[render-one-job] done ${jobId} (${job.kind})`)
    process.exit(0)
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e)
    await markJobFailed(jobId, msg)
    await notifyExportReady({
      jobId,
      albumId: job.album_id,
      tenantId: job.tenant_id,
      kind: job.kind,
      status: 'failed',
      error: msg,
    })
    console.error(`[render-one-job] failed ${jobId}: ${msg}`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('[render-one-job] fatal', e)
  process.exit(1)
})
