import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['apps/**/*.spec.ts', 'packages/**/*.spec.ts'],
    reporters: ['default'],
  },
});
