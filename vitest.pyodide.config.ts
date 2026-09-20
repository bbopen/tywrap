import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'test/runtime_pyodide_real.conformance.ts',
      'test/runtime_pyodide_browser.conformance.ts',
    ],
    testTimeout: 300_000,
  },
});
