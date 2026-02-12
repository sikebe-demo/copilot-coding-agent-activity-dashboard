import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['unit-tests/**/*.test.ts'],
    globals: true,
  },
});
