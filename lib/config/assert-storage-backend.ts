/**
 * Fail-fast барьер на STORAGE_BACKEND в проде.
 *
 * Зачем: вся маршрутизация хранилища (lib/storage.ts — фото, lib/blob-storage.ts —
 * фоны/декор/рефки) держится на одной переменной STORAGE_BACKEND. Дефолт при её
 * отсутствии = 'supabase' (см. storageBackend()). Если в проде переменная
 * потеряется/слетит, приложение МОЛЧА уедет писать/читать/удалять в мёртвые
 * Supabase/Yandex storage — тихая потеря данных (тот же класс, что баг delete_album).
 *
 * Барьер: в production (NODE_ENV==='production') при STORAGE_BACKEND !== 'timeweb'
 * (включая «не задана») — громко падаем при СТАРТЕ сервера, а не стартуем тихо.
 * В dev/test поведение НЕ трогаем — там бэкенд может быть другим осознанно.
 *
 * Чистая функция (без чтения process.env внутри) — чтобы юнит-тестировать без
 * мутаций глобального окружения. Вызывается из instrumentation.ts register().
 */

export interface StorageBackendEnv {
  nodeEnv: string | undefined
  storageBackend: string | undefined
}

/**
 * Бросает Error, если в production STORAGE_BACKEND не 'timeweb'.
 * В любом не-production окружении — ничего не делает.
 */
export function assertStorageBackendOrThrow(env: StorageBackendEnv): void {
  if (env.nodeEnv !== 'production') return
  if (env.storageBackend === 'timeweb') return

  throw new Error(
    `FATAL: STORAGE_BACKEND must be 'timeweb' in production, got '${env.storageBackend ?? ''}'. ` +
      `Refusing to start to avoid silent data loss to dead Supabase/Yandex storage.`,
  )
}
