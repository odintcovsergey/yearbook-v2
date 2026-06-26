/**
 * Next.js instrumentation hook — выполняется ОДИН РАЗ при старте сервера
 * (next start / next dev), но НЕ во время `next build`. Идеальное место для
 * fail-fast проверок окружения: прод не должен подняться с битым конфигом.
 *
 * Здесь — барьер на STORAGE_BACKEND (см. lib/config/assert-storage-backend.ts):
 * в production без STORAGE_BACKEND=timeweb сервер откажется стартовать, чтобы не
 * уехать молча в мёртвые Supabase/Yandex storage. health-check деплоя поймает
 * отказ и откатит релиз (deploy.sh).
 *
 * Требует experimental.instrumentationHook=true в next.config.js (Next 14.2).
 */
export async function register() {
  // Только серверный nodejs-рантайм. В edge STORAGE_BACKEND неактуален, и бросок
  // там сломал бы edge-инициализацию; у нас edge-кода нет, но страхуемся.
  if (process.env.NEXT_RUNTIME === 'edge') return
  // Двойная страховка: во время сборки register() не зовётся, но если фаза билда
  // вдруг сюда дойдёт — не падаем (билд идёт с NODE_ENV=production и может не иметь
  // боевого STORAGE_BACKEND).
  if (process.env.NEXT_PHASE === 'phase-production-build') return

  const { assertStorageBackendOrThrow } = await import('./lib/config/assert-storage-backend')
  assertStorageBackendOrThrow({
    nodeEnv: process.env.NODE_ENV,
    storageBackend: process.env.STORAGE_BACKEND,
  })
}
