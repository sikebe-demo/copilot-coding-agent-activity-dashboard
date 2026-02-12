import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['unit-tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['lib.ts', 'src/**/*.ts'],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
      },
    },
  },
});
