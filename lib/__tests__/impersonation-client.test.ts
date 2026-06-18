/**
 * Тесты confirmDestructive — доп-стоп на удаление под impersonation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  setImpersonationPartner,
  isImpersonating,
  confirmDestructive,
} from '@/lib/impersonation-client'

describe('confirmDestructive', () => {
  beforeEach(() => {
    setImpersonationPartner(null)
    ;(globalThis as any).window = { confirm: vi.fn(() => true) }
  })

  it('вне impersonation — обычный confirm без предупреждения', () => {
    confirmDestructive('Удалить альбом?')
    const arg = (globalThis as any).window.confirm.mock.calls[0][0]
    expect(arg).toBe('Удалить альбом?')
    expect(isImpersonating()).toBe(false)
  })

  it('под impersonation — добавляет предупреждение о кабинете партнёра', () => {
    setImpersonationPartner('Фотостудия Солнышко')
    expect(isImpersonating()).toBe(true)
    confirmDestructive('Удалить альбом?')
    const arg = (globalThis as any).window.confirm.mock.calls[0][0]
    expect(arg).toContain('Фотостудия Солнышко')
    expect(arg).toContain('данные ПАРТНЁРА')
    expect(arg).toContain('Удалить альбом?')  // исходное сообщение сохранено
  })

  it('возвращает результат window.confirm', () => {
    ;(globalThis as any).window.confirm = vi.fn(() => false)
    expect(confirmDestructive('x')).toBe(false)
    ;(globalThis as any).window.confirm = vi.fn(() => true)
    expect(confirmDestructive('x')).toBe(true)
  })
})
