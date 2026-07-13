# Configuration

A `tywrap.config.ts` file configures wrapper generation. Use `defineConfig()`
for editor completion, or use JSON, JavaScript, or TypeScript. Without
`--config`, the CLI looks for `tywrap.config.ts`, `.mts`, `.js`, `.mjs`, `.cjs`,
then `.json`.

```ts
import { defineConfig } from 'tywrap';

export default defineConfig({
  pythonModules: {
    math: { typeHints: 'strict' },
    numpy: {
      functions: ['array', 'zeros', 'ones'],
      alias: 'np',
      typeHints: 'strict',
    },
  },
  pythonImportPath: ['./python'],
  output: {
    dir: './src/generated',
    format: 'esm',
    declaration: true,
    sourceMap: false,
    annotatedJSDoc: true,
  },
  runtime: {
    node: {
      pythonPath: 'python3',
      timeout: 30000,
    },
  },
  performance: {
    caching: true,
    batching: false,
    compression: 'none',
  },
  types: {
    presets: ['stdlib'],
  },
});
```

## Top-level fields

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `pythonModules` | `Record<string, PythonModuleConfig>` | `{}` | Modules to analyze and generate. |
| `pythonImportPath` | `string[]` | `[]` | Directories prepended to `PYTHONPATH` for discovery and IR extraction. |
| `contractInput` | `string \| Record<string, string>` | unset | A pinned contract file, or one path per module, used instead of starting Python. |
| `output` | `OutputConfig` | See below | Generated file location and format. |
| `runtime` | `RuntimeConfig` | Node settings | Runtime-related settings. Generation reads the Node settings. |
| `performance` | `PerformanceConfig` | See below | Generation cache controls and accepted compatibility settings. |
| `types` | `TypeMappingConfig` | `{ presets: [] }` | Extra mappings for supported library types. |
| `debug` | `boolean` | `false` | Enables debug logging. |

Unknown top-level fields fail validation. The loader also validates the value
types for the documented sections.

## Modules

Each `pythonModules` key is the Python module name passed to the IR extractor.
For local modules, add their parent directory to `pythonImportPath`.

```ts
export default defineConfig({
  pythonModules: {
    'my_package.statistics': {
      functions: ['mean', 'percentile'],
      classes: ['Summary'],
      exclude: ['internal_helper'],
      excludePatterns: ['^experimental_'],
      alias: 'stats',
      typeHints: 'strict',
    },
  },
  pythonImportPath: ['./python'],
});
```

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `version` | `string` | unset | Version value recorded in the IR cache key. |
| `functions` | `string[]` | all exports | Limits generated module functions. |
| `classes` | `string[]` | all exports | Limits generated classes. |
| `exclude` | `string[]` | `[]` | Excludes exact export names after selection. |
| `excludePatterns` | `string[]` | `[]` | Excludes exports matching JavaScript regular-expression source. Invalid patterns produce a generation warning. |
| `alias` | `string` | module name | Sets the generated module alias. |
| `typeHints` | `'strict' \| 'loose' \| 'ignore'` | `'strict'` at generation | Accepted for configuration compatibility and included in the IR cache key. It does not currently change analysis or emitted types. |

The former per-module `runtime` field is not part of new configurations. Set
runtime options under the top-level `runtime` field.

## Output

```ts
output: {
  dir: './generated',
  format: 'both',
  declaration: true,
  sourceMap: false,
  annotatedJSDoc: true,
}
```

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `dir` | `string` | `'./generated'` | Output directory. |
| `format` | `'esm' \| 'cjs' \| 'both'` | `'esm'` | Generated module format. |
| `declaration` | `boolean` | `false` | Writes a matching `.generated.d.ts` file. |
| `sourceMap` | `boolean` | `false` | Writes a `.generated.ts.map` file. |
| `annotatedJSDoc` | `boolean` | `false` | Adds source annotation strings to generated function JSDoc. |

Generation also writes `<module>.contract.json` beside each generated wrapper.
The contract is byte-stable and lets `generate --check` detect contract drift.

## Runtime settings

The configuration loader accepts Node, Pyodide, and HTTP settings. During
generation, the CLI reads `runtime.node.pythonPath` and
`runtime.node.virtualEnv` to run the Python IR extractor. Create `NodeBridge`,
`PyodideBridge`, or `HttpBridge` in application code for runtime calls.

```ts
runtime: {
  node: {
    pythonPath: 'python3',
    virtualEnv: './.venv',
    timeout: 30000,
  },
  pyodide: {
    indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.28.0/full/',
    packages: ['numpy'],
  },
  http: {
    baseURL: 'https://api.example.com/python',
    timeout: 10000,
    headers: { Authorization: 'Bearer token' },
  },
}
```

| Section | Fields | Notes |
| --- | --- | --- |
| `runtime.node` | `pythonPath?: string`, `virtualEnv?: string`, `timeout?: number` | Defaults to the platform Python command and a 30,000 ms timeout. |
| `runtime.pyodide` | `indexURL?: string`, `packages?: string[]` | Stored and type-checked by the configuration loader. |
| `runtime.http` | `baseURL: string`, `timeout?: number`, `headers?: Record<string, string>` | `baseURL` must be a non-empty string. |

## Performance settings

```ts
performance: {
  caching: true,
  batching: false,
  compression: 'none',
}
```

| Field | Type | Default | Current effect |
| --- | --- | --- | --- |
| `caching` | `boolean` | `false` | Reuses cached Python IR during generation. It does not cache function call results. |
| `batching` | `boolean` | `false` | Validated and retained in the resolved config, but no current generator or runtime code reads it. |
| `compression` | `'auto' \| 'gzip' \| 'brotli' \| 'none'` | `'none'` | Validated and included in the IR cache key, but no current generator or runtime code performs compression for it. |

## Type presets

Use `types.presets` to enable mappings for supported third-party annotations.

```ts
types: {
  presets: ['stdlib', 'pandas', 'scipy'],
}
```

Accepted presets are `numpy`, `pandas`, `pydantic`, `stdlib`, `scipy`, `torch`,
and `sklearn`. `numpy` is accepted as a no-op in 0.9.0. The other presets map
the library types implemented by the generator, such as `DataFrame`, sparse
matrix classes, `Tensor`, and `BaseEstimator`.

## Pinned contracts

Use `contractInput` to generate from a saved IR contract without starting a
Python process. A single path applies to every configured module. A record
selects an input path for each module.

```ts
export default defineConfig({
  pythonModules: {
    math: { typeHints: 'strict' },
  },
  contractInput: {
    math: './generated/math.contract.json',
  },
});
```

Contracts must declare IR version `0.4.0`. Generation reports the mismatch
when the contract version does not match the TypeScript generator.

## Configuration checks

Use `generate --check` in CI after committing generated wrappers and their
contracts. It compares the generated TypeScript, declaration files when
enabled, source maps when enabled, and contract files without writing them.

```bash
npx tywrap generate --check
```

See the [CLI reference](/reference/cli) for command-line overrides and exit
codes.
