import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/isolated_consumer.conformance.ts'],
    testTimeout: 300_000,
  },
});
