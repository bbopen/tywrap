import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const isCi =
  ['1', 'true'].includes((process.env.CI ?? '').toLowerCase()) ||
  ['1', 'true'].includes((process.env.GITHUB_ACTIONS ?? '').toLowerCase()) ||
  ['1', 'true'].includes((process.env.ACT ?? '').toLowerCase());

export default defineConfig({
  resolve: {
    alias: {
      'tywrap/runtime': resolve(__dirname, 'src/runtime/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    testTimeout: isCi ? 30000 : 5000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.d.ts',
        '**/node_modules/**',
        '**/dist/**',
        '**/generated/**',
        '**/test/**',
        '**/tools/**',
        '**/scripts/**',
      ],
    },
  }
});
