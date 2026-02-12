import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['unit-tests/**/*.test.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['lib.ts'],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
      },
    },
  },
});
