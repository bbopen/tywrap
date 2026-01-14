export default {
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
};
