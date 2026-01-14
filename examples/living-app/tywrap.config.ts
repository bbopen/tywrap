import { defineConfig } from 'tywrap';

// Why: `defineConfig` keeps config authoring type-safe and serves as a real-world test that
// tywrap can load a TS config which imports from the ESM tywrap package.
export default defineConfig({
  pythonModules: {
    'living_app.app': { runtime: 'node', typeHints: 'strict' },
  },
  output: {
    dir: './generated',
    format: 'esm',
    declaration: false,
    sourceMap: false,
  },
  runtime: {
    node: {
      virtualEnv: '.venv',
      timeout: 30_000,
    },
  },
  types: {
    presets: ['stdlib', 'numpy', 'pandas', 'pydantic'],
  },
});
