import { describe, it, expect } from 'vitest'
import { queueStorageKey, ExportRunError, SYNC_SPREAD_THRESHOLD } from '@/lib/export-run/core'

describe('queueStorageKey', () => {
  it('PDF — стабильный ключ по альбому и slug (новый рендер затирает прошлый)', () => {
    const k1 = queueStorageKey('alb-1', 'pdf', 'okeybook-print', 'pdf')
    const k2 = queueStorageKey('alb-1', 'pdf', 'okeybook-print', 'pdf')
    expect(k1).toBe(k2) // детерминирован → перезапись «последнего файла»
    expect(k1).toBe('alb-1/exports/queue_okeybook-print.pdf')
  })

  it('типография — единый zip-ключ на альбом', () => {
    expect(queueStorageKey('alb-9', 'typography', 'ignored', 'zip')).toBe(
      'alb-9/exports/queue_typography.zip',
    )
  })

  it('санитизирует slug (без спецсимволов в ключе)', () => {
    expect(queueStorageKey('a', 'pdf', 'bad/slug name', 'pdf')).toBe('a/exports/queue_badslugname.pdf')
  })

  it('пустой slug не ломает ключ', () => {
    expect(queueStorageKey('a', 'pdf', '', 'pdf')).toBe('a/exports/queue_pdf.pdf')
  })
})

describe('ExportRunError', () => {
  it('несёт код и HTTP-статус', () => {
    const e = new ExportRunError('нет вёрстки', 'layout_not_built', 404)
    expect(e).toBeInstanceOf(Error)
    expect(e.code).toBe('layout_not_built')
    expect(e.httpStatus).toBe(404)
    expect(e.message).toBe('нет вёрстки')
  })

  it('дефолтный статус 500', () => {
    expect(new ExportRunError('x', 'y').httpStatus).toBe(500)
  })
})

describe('порог очереди', () => {
  it('30 разворотов — ориентир Сергея', () => {
    expect(SYNC_SPREAD_THRESHOLD).toBe(30)
  })
})
