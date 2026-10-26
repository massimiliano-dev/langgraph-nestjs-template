import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'api',
          root: './apps/api',
          include: ['test/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'evals',
          root: './evals',
          include: ['**/*.eval.test.ts'],
          exclude: ['**/node_modules/**'],
          environment: 'node',
          // Live mode calls a real model.
          testTimeout: 180_000,
        },
      },
    ],
  },
});
