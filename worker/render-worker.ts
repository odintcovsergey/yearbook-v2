/**
 * Воркер фоновой очереди экспорта (ТЗ №2). Запускается под systemd на VDS
 * (yearbook-render-worker.service, Restart=always, автозапуск).
 *
 * Цикл: атомарно забрать queued-задачу → отрендерить в ОТДЕЛЬНОМ дочернем
 * процессе (память изолирована и освобождается после задачи) → следующая.
 * Одновременно — 1 рендер (под 4 ГБ VDS). Зависшие processing возвращает в
 * очередь watchdog. Сам веб-сайт изолирован: тяжёлый рендер тут, не в Next.
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { claimNextJob, requeueStuckJobs } from '@/lib/export-queue'

const WORKER_ID = `vds-${process.pid}`
const POLL_MS = Number(process.env.EXPORT_WORKER_POLL_MS ?? 4000)
const STUCK_MIN = Number(process.env.EXPORT_WORKER_STUCK_MIN ?? 30)
const TSX_BIN = path.resolve(process.cwd(), 'node_modules/.bin/tsx')
const CHILD_SCRIPT = path.resolve(process.cwd(), 'worker/render-one-job.ts')

let stopping = false
process.on('SIGTERM', () => {
  stopping = true
})
process.on('SIGINT', () => {
  stopping = true
})

/** Рендер задачи в дочернем процессе; резолвится кодом выхода. */
function runChild(jobId: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(TSX_BIN, [CHILD_SCRIPT, jobId], {
      stdio: 'inherit',
      env: process.env,
    })
    child.on('exit', (code) => resolve(code ?? 1))
    child.on('error', (err) => {
      console.error('[export-worker] spawn error', err)
      resolve(1)
    })
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function loop(): Promise<void> {
  console.log(`[export-worker] start ${WORKER_ID}, poll=${POLL_MS}ms, stuck=${STUCK_MIN}min`)
  let lastWatchdog = 0
  while (!stopping) {
    try {
      const now = Date.now()
      if (now - lastWatchdog > 60_000) {
        const n = await requeueStuckJobs(STUCK_MIN)
        if (n) console.log(`[export-worker] watchdog requeued/failed ${n} stuck job(s)`)
        lastWatchdog = now
      }

      const job = await claimNextJob(WORKER_ID)
      if (job) {
        console.log(`[export-worker] claimed ${job.id} (${job.kind})`)
        const code = await runChild(job.id)
        console.log(`[export-worker] job ${job.id} child exit=${code}`)
        continue // сразу пробуем следующую задачу
      }
    } catch (e) {
      console.error('[export-worker] loop error', e)
    }
    await sleep(POLL_MS)
  }
  console.log('[export-worker] stopped')
  process.exit(0)
}

loop().catch((e) => {
  console.error('[export-worker] fatal', e)
  process.exit(1)
})
