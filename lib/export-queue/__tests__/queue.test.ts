import { describe, it, expect, beforeEach, vi } from 'vitest'

// Управляемый мок supabase-клиента: цепочечный билдер записывает вызовы в
// ctx.ops, терминалы (single/maybeSingle) и await (then) возвращают то, что
// вернёт текущий handler(ctx). Так проверяем логику очереди без реальной БД.
const h = vi.hoisted(() => {
  let handler: (ctx: { table: string; ops: Array<[string, unknown[]]> }) => unknown = () => ({
    data: null,
    error: null,
  })
  const makeBuilder = (table: string) => {
    const ctx = { table, ops: [] as Array<[string, unknown[]]> }
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'insert', 'update', 'eq', 'in', 'or', 'order', 'limit', 'lt', 'gt']) {
      b[m] = (...args: unknown[]) => {
        ctx.ops.push([m, args])
        return b
      }
    }
    for (const m of ['single', 'maybeSingle']) {
      b[m] = async () => {
        ctx.ops.push([m, []])
        return handler(ctx)
      }
    }
    ;(b as { then: unknown }).then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(handler(ctx)).then(res, rej)
    return b
  }
  return {
    setHandler: (fn: typeof handler) => {
      handler = fn
    },
    supabaseAdmin: { from: (t: string) => makeBuilder(t) },
  }
})

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: h.supabaseAdmin }))

import { enqueueExportJob, claimNextJob, markJobFailed, markJobDone } from '@/lib/export-queue'

const hasOp = (ctx: { ops: Array<[string, unknown[]]> }, op: string) =>
  ctx.ops.some(([m]) => m === op)
const updateArg = (ctx: { ops: Array<[string, unknown[]]> }) =>
  (ctx.ops.find(([m]) => m === 'update')?.[1]?.[0] ?? {}) as Record<string, unknown>

const fakeJob = { id: 'job-new', album_id: 'a', tenant_id: 't', kind: 'pdf', status: 'queued' }
const existingJob = { id: 'job-existing', album_id: 'a', tenant_id: 't', kind: 'pdf', status: 'processing' }
const claimedJob = { id: 'j1', album_id: 'a', tenant_id: 't', kind: 'pdf', status: 'processing' }

describe('enqueueExportJob', () => {
  beforeEach(() => h.setHandler(() => ({ data: null, error: null })))

  it('успешная постановка → новая задача, deduped:false', async () => {
    h.setHandler((ctx) => (hasOp(ctx, 'insert') ? { data: fakeJob, error: null } : { data: null }))
    const { job, deduped } = await enqueueExportJob({
      albumId: 'a', tenantId: 't', kind: 'pdf', payload: { profile_slug: 'x' }, createdBy: 'u',
    })
    expect(deduped).toBe(false)
    expect(job.id).toBe('job-new')
  })

  it('конфликт уникального индекса (23505) → возвращает существующую активную, deduped:true', async () => {
    h.setHandler((ctx) =>
      hasOp(ctx, 'insert')
        ? { data: null, error: { code: '23505', message: 'duplicate key value' } }
        : { data: existingJob, error: null },
    )
    const { job, deduped } = await enqueueExportJob({
      albumId: 'a', tenantId: 't', kind: 'pdf', payload: {}, createdBy: 'u',
    })
    expect(deduped).toBe(true)
    expect(job.id).toBe('job-existing')
  })
})

describe('claimNextJob', () => {
  beforeEach(() => h.setHandler(() => ({ data: null, error: null })))

  it('забирает кандидата условным апдейтом queued→processing', async () => {
    h.setHandler((ctx) =>
      hasOp(ctx, 'update')
        ? { data: claimedJob, error: null } // условный апдейт вернул строку
        : { data: [{ id: 'j1', attempts: 0 }], error: null }, // список кандидатов
    )
    const job = await claimNextJob('w1')
    expect(job?.id).toBe('j1')
  })

  it('нет queued → null', async () => {
    h.setHandler(() => ({ data: [], error: null }))
    expect(await claimNextJob('w1')).toBeNull()
  })
})

describe('смена статусов', () => {
  it('markJobFailed ставит failed + текст ошибки', async () => {
    let captured: Record<string, unknown> = {}
    h.setHandler((ctx) => {
      if (hasOp(ctx, 'update')) captured = updateArg(ctx)
      return { data: null, error: null }
    })
    await markJobFailed('job-1', 'boom произошёл')
    expect(captured.status).toBe('failed')
    expect(String(captured.error)).toContain('boom')
  })

  it('markJobDone ставит done + путь файла', async () => {
    let captured: Record<string, unknown> = {}
    h.setHandler((ctx) => {
      if (hasOp(ctx, 'update')) captured = updateArg(ctx)
      return { data: null, error: null }
    })
    await markJobDone('job-1', {
      storage_path: 'a/exports/queue_x.pdf', filename: 'x.pdf', file_size: 100, page_count: 5, warnings: [],
    })
    expect(captured.status).toBe('done')
    expect(captured.storage_path).toBe('a/exports/queue_x.pdf')
  })
})
