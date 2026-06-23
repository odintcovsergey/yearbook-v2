/**
 * lib/export-queue — жизненный цикл задач фонового экспорта (таблица export_jobs).
 *
 * Чистый Postgres через PostgREST (supabase-js, service role) — без новой
 * зависимости pg и без Supabase-специфики. Один воркер на VDS забирает задачи
 * условным апдейтом (queued→processing); идемпотентность постановки держит
 * частичный уникальный индекс (album_id, kind) WHERE active.
 *
 * Статусы: queued → processing → done | failed.
 * Повтор (failed→queued) — кнопкой партнёра. Зависшие processing возвращает
 * в очередь watchdog воркера; при превышении max_attempts → failed.
 */
import { supabaseAdmin } from '@/lib/supabase'
import type { ExportKind } from '@/lib/export-run'

export type ExportJobStatus = 'queued' | 'processing' | 'done' | 'failed'

export type ExportJob = {
  id: string
  album_id: string
  tenant_id: string
  kind: ExportKind
  payload: Record<string, unknown>
  status: ExportJobStatus
  storage_path: string | null
  filename: string | null
  file_size: number | null
  page_count: number | null
  warnings: { code: string; detail: string }[]
  error: string | null
  attempts: number
  max_attempts: number
  progress_stage: string | null
  worker_id: string | null
  created_by: string
  requested_at: string
  started_at: string | null
  finished_at: string | null
  updated_at: string | null
}

const JOB_FIELDS =
  'id, album_id, tenant_id, kind, payload, status, storage_path, filename, ' +
  'file_size, page_count, warnings, error, attempts, max_attempts, ' +
  'progress_stage, worker_id, created_by, requested_at, started_at, finished_at, updated_at'

const PG_UNIQUE_VIOLATION = '23505'

/**
 * Поставить задачу. Идемпотентно: если для (album_id, kind) уже есть активная
 * (queued|processing) задача — возвращаем её (deduped:true), не плодим дубль.
 */
export async function enqueueExportJob(args: {
  albumId: string
  tenantId: string
  kind: ExportKind
  payload: Record<string, unknown>
  createdBy: string | null
}): Promise<{ job: ExportJob; deduped: boolean }> {
  const { albumId, tenantId, kind, payload, createdBy } = args

  const { data, error } = await supabaseAdmin
    .from('export_jobs')
    .insert({
      album_id: albumId,
      tenant_id: tenantId,
      kind,
      payload,
      status: 'queued',
      created_by: createdBy,
    })
    .select(JOB_FIELDS)
    .single()

  if (!error && data) {
    return { job: data as unknown as ExportJob, deduped: false }
  }

  // Конфликт уникального индекса → уже есть активная задача. Вернём её.
  if (error && (error.code === PG_UNIQUE_VIOLATION || /duplicate key|unique/i.test(error.message))) {
    const existing = await getActiveJob(albumId, kind)
    if (existing) return { job: existing, deduped: true }
  }
  throw new Error(`enqueue failed: ${error?.message ?? 'unknown'}`)
}

/** Активная (queued|processing) задача альбома по виду, если есть. */
export async function getActiveJob(albumId: string, kind: ExportKind): Promise<ExportJob | null> {
  const { data } = await supabaseAdmin
    .from('export_jobs')
    .select(JOB_FIELDS)
    .eq('album_id', albumId)
    .eq('kind', kind)
    .in('status', ['queued', 'processing'])
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as unknown as ExportJob) ?? null
}

/** Последняя задача альбома по виду (для UI «вернулся на страницу»). */
export async function getLatestJob(albumId: string, kind: ExportKind): Promise<ExportJob | null> {
  const { data } = await supabaseAdmin
    .from('export_jobs')
    .select(JOB_FIELDS)
    .eq('album_id', albumId)
    .eq('kind', kind)
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as unknown as ExportJob) ?? null
}

/** Задача по id. */
export async function getJob(jobId: string): Promise<ExportJob | null> {
  const { data } = await supabaseAdmin
    .from('export_jobs')
    .select(JOB_FIELDS)
    .eq('id', jobId)
    .maybeSingle()
  return (data as unknown as ExportJob) ?? null
}

/**
 * Атомарно забрать следующую queued-задачу (queued→processing).
 * Берём пачку кандидатов и пытаемся условным апдейтом «застолбить» —
 * выигрывает первый прошедший (.eq('status','queued')). attempts++.
 */
export async function claimNextJob(workerId: string): Promise<ExportJob | null> {
  const { data: candidates } = await supabaseAdmin
    .from('export_jobs')
    .select('id, attempts')
    .eq('status', 'queued')
    .order('requested_at', { ascending: true })
    .limit(5)

  for (const c of (candidates ?? []) as Array<{ id: string; attempts: number }>) {
    const { data: claimed } = await supabaseAdmin
      .from('export_jobs')
      .update({
        status: 'processing',
        started_at: new Date().toISOString(),
        worker_id: workerId,
        attempts: (c.attempts ?? 0) + 1,
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', c.id)
      .eq('status', 'queued')
      .select(JOB_FIELDS)
      .maybeSingle()
    if (claimed) return claimed as unknown as ExportJob
  }
  return null
}

/** Обновить грубую стадию прогресса («готовлю фото» / «собираю PDF»). */
export async function setJobStage(jobId: string, stage: string): Promise<void> {
  await supabaseAdmin
    .from('export_jobs')
    .update({ progress_stage: stage, updated_at: new Date().toISOString() })
    .eq('id', jobId)
}

/** Успех. */
export async function markJobDone(
  jobId: string,
  result: {
    storage_path: string
    filename: string
    file_size: number
    page_count: number | null
    warnings: { code: string; detail: string }[]
  },
): Promise<void> {
  await supabaseAdmin
    .from('export_jobs')
    .update({
      status: 'done',
      storage_path: result.storage_path,
      filename: result.filename,
      file_size: result.file_size,
      page_count: result.page_count,
      warnings: result.warnings,
      error: null,
      progress_stage: null,
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
}

/** Ошибка (повтор — вручную партнёром; авто-ретрая нет по решению Сергея). */
export async function markJobFailed(jobId: string, error: string): Promise<void> {
  await supabaseAdmin
    .from('export_jobs')
    .update({
      status: 'failed',
      error: error.slice(0, 2000),
      progress_stage: null,
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
}

/** Ручной повтор: failed→queued. Сбрасываем диагностику попытки. */
export async function retryJob(jobId: string): Promise<ExportJob | null> {
  const { data } = await supabaseAdmin
    .from('export_jobs')
    .update({
      status: 'queued',
      error: null,
      worker_id: null,
      started_at: null,
      finished_at: null,
      progress_stage: null,
      requested_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .eq('status', 'failed')
    .select(JOB_FIELDS)
    .maybeSingle()
  return (data as unknown as ExportJob) ?? null
}

/**
 * Watchdog: зависшие в processing дольше maxMinutes возвращаем в очередь;
 * если попыток уже >= max_attempts — помечаем failed.
 */
export async function requeueStuckJobs(maxMinutes = 30): Promise<number> {
  const cutoff = new Date(Date.now() - maxMinutes * 60_000).toISOString()
  const { data: stuck } = await supabaseAdmin
    .from('export_jobs')
    .select('id, attempts, max_attempts')
    .eq('status', 'processing')
    .lt('started_at', cutoff)

  let touched = 0
  for (const j of (stuck ?? []) as Array<{ id: string; attempts: number; max_attempts: number }>) {
    if ((j.attempts ?? 0) >= (j.max_attempts ?? 3)) {
      await markJobFailed(j.id, `Зависла: превышено число попыток (${j.attempts}).`)
    } else {
      await supabaseAdmin
        .from('export_jobs')
        .update({
          status: 'queued',
          worker_id: null,
          started_at: null,
          progress_stage: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', j.id)
        .eq('status', 'processing')
    }
    touched++
  }
  return touched
}
