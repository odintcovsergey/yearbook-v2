import { describe, it, expect } from 'vitest'
import { assertStorageBackendOrThrow } from '../assert-storage-backend'

describe('assertStorageBackendOrThrow', () => {
  describe('production', () => {
    it('не бросает при STORAGE_BACKEND=timeweb', () => {
      expect(() =>
        assertStorageBackendOrThrow({ nodeEnv: 'production', storageBackend: 'timeweb' }),
      ).not.toThrow()
    })

    it('бросает, когда переменная не задана (undefined)', () => {
      expect(() =>
        assertStorageBackendOrThrow({ nodeEnv: 'production', storageBackend: undefined }),
      ).toThrowError(/STORAGE_BACKEND must be 'timeweb' in production, got ''/)
    })

    it('бросает при STORAGE_BACKEND=supabase (тихий дефолт)', () => {
      expect(() =>
        assertStorageBackendOrThrow({ nodeEnv: 'production', storageBackend: 'supabase' }),
      ).toThrowError(/got 'supabase'/)
    })

    it('бросает при любом другом значении (yandex)', () => {
      expect(() =>
        assertStorageBackendOrThrow({ nodeEnv: 'production', storageBackend: 'yandex' }),
      ).toThrowError(/Refusing to start to avoid silent data loss/)
    })

    it('бросает при пустой строке', () => {
      expect(() =>
        assertStorageBackendOrThrow({ nodeEnv: 'production', storageBackend: '' }),
      ).toThrow()
    })
  })

  describe('не-production (поведение НЕ трогаем)', () => {
    it('development + undefined — не бросает', () => {
      expect(() =>
        assertStorageBackendOrThrow({ nodeEnv: 'development', storageBackend: undefined }),
      ).not.toThrow()
    })

    it('test + supabase — не бросает', () => {
      expect(() =>
        assertStorageBackendOrThrow({ nodeEnv: 'test', storageBackend: 'supabase' }),
      ).not.toThrow()
    })

    it('nodeEnv undefined + undefined — не бросает', () => {
      expect(() =>
        assertStorageBackendOrThrow({ nodeEnv: undefined, storageBackend: undefined }),
      ).not.toThrow()
    })
  })
})
