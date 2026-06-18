/**
 * Vitest config — настройка тестов rule engine (РЭ.10).
 *
 * Запуск:
 *   npx vitest                 — watch mode
 *   npx vitest run             — однократный прогон
 *   npx vitest run --coverage  — с покрытием
 */

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['lib/**/__tests__/**/*.test.ts', 'lib/**/*.test.ts'],
    exclude: ['node_modules', '.next', 'dist'],
    // Заглушки env для модулей, читающих окружение на импорте (lib/supabase
    // падает без NEXT_PUBLIC_SUPABASE_URL). Нужны для unit-тестов lib/auth
    // (impersonation). Значения фиктивные — сети в тестах нет.
    env: {
      NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
      JWT_SECRET: 'test-jwt-secret-which-is-long-enough-for-hs256',
      DEFAULT_TENANT_ID: '00000000-0000-0000-0000-000000000001',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['lib/rule-engine/**/*.ts'],
      exclude: [
        'lib/rule-engine/__tests__/**',
        'lib/rule-engine/types.ts',
        'lib/rule-engine/schemas.ts',
      ],
    },
  },
});
