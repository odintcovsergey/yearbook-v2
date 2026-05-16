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
