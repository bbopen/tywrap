# Configuration Guide

Complete configuration reference covering all options from basic setup to
advanced optimization.

## Top-Level Fields

| Field              | Description                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `pythonModules`    | Mapping of module names to wrapper configuration                                                                         |
| `pythonImportPath` | Extra directories to prepend to `PYTHONPATH` during IR generation (useful for local modules not installed into your env) |
| `output`           | Output directory, module format and artifact options                                                                     |
| `runtime`          | Settings for Node, Pyodide or HTTP runtimes                                                                              |
| `performance`      | Caching and optimization controls                                                                                        |
| `types`            | Type mapping presets and customization                                                                                   |

## Configuration File Formats

tywrap supports multiple configuration formats:

- **TypeScript**: `tywrap.config.ts` (recommended)
- **JavaScript**: `tywrap.config.js`
- **JSON**: `tywrap.config.json`
- **Programmatic**: Direct API calls

When `--config` is omitted, the CLI searches for `tywrap.config.ts`, `.mts`,
`.js`, `.mjs`, `.cjs`, and `.json` in that order.

### Basic JSON Configuration

```json
{
  "pythonModules": {
    "module_name": { "runtime": "node", "typeHints": "strict" }
  },
  "output": { "dir": "./generated", "format": "esm" },
  "runtime": {},
  "performance": { "caching": true }
}
```

### TypeScript Configuration

```typescript
// tywrap.config.ts
import { defineConfig } from 'tywrap';

export default defineConfig({
  pythonImportPath: ['./python', './vendor'],
  pythonModules: {
    numpy: {
      version: '1.24.0',
      runtime: 'pyodide',
      functions: ['array', 'zeros', 'ones'],
      typeHints: 'strict',
    },
    pandas: {
      runtime: 'node',
      alias: 'pd',
    },
  },
  output: {
    dir: './src/generated',
    format: 'esm',
    declaration: true,
    sourceMap: true,
  },
  performance: {
    caching: true,
    batching: true,
    compression: 'auto',
  },
});
```

## Local Modules and `pythonImportPath`

If you're wrapping local modules/packages that are not installed into your
Python environment, add one or more directories to `pythonImportPath`. tywrap
will prepend these entries to `PYTHONPATH` when running the `tywrap_ir`
subprocess. Existing `PYTHONPATH` (if set) is preserved.

Notes:

- Paths are passed through as provided (use absolute paths or paths relative to
  where you run the CLI).
- This affects IR discovery/import, not your runtime bridge configuration.

## Python Modules Configuration

### Basic Module Setup

```json
{
  "pythonModules": {
    "math": {
      "runtime": "node",
      "typeHints": "strict"
    }
  }
}
```

### Advanced Module Configuration

```json
{
  "pythonModules": {
    "numpy": {
      "version": "1.24.0",
      "runtime": "pyodide",
      "functions": ["array", "zeros", "ones", "eye"],
      "classes": ["ndarray", "matrix"],
      "alias": "np",
      "typeHints": "strict"
    },
    "./custom_module.py": {
      "runtime": "node",
      "typeHints": "loose"
    }
  }
}
```

### Module Options

| Option            | Type                                      | Default     | Description                            |
| ----------------- | ----------------------------------------- | ----------- | -------------------------------------- |
| `runtime`         | `'node' \| 'pyodide' \| 'http' \| 'auto'` | `'auto'`    | Runtime environment                    |
| `version`         | `string`                                  | Latest      | Specific package version               |
| `functions`       | `string[]`                                | All         | Specific functions to wrap             |
| `classes`         | `string[]`                                | All         | Specific classes to wrap               |
| `exclude`         | `string[]`                                | `[]`        | Exclude specific exports by exact name |
| `excludePatterns` | `string[]`                                | `[]`        | Exclude exports by regex pattern       |
| `alias`           | `string`                                  | Module name | Import alias in generated code         |
| `typeHints`       | `'strict' \| 'loose' \| 'ignore'`         | `'strict'`  | Type hint processing                   |

When `functions`/`classes` are not explicitly configured for a module, tywrap
applies a small default exclude list to avoid generating wrappers for common
decorator helpers: `dataclass`, `property`, `staticmethod`, `classmethod`,
`abstractmethod`, `cached_property`.

## Output Configuration

### Format Options

```json
{
  "output": {
    "dir": "./generated",
    "format": "esm",
    "declaration": true,
    "sourceMap": true,
    "annotatedJSDoc": true
  }
}
```

### Output Options

| Option           | Type                       | Default         | Description                       |
| ---------------- | -------------------------- | --------------- | --------------------------------- |
| `dir`            | `string`                   | `'./generated'` | Output directory                  |
| `format`         | `'esm' \| 'cjs' \| 'both'` | `'esm'`         | Module format                     |
| `declaration`    | `boolean`                  | `false`         | Generate matching `.d.ts` files, including preserved simple generics when representable |
| `sourceMap`      | `boolean`                  | `false`         | Generate source maps              |
| `annotatedJSDoc` | `boolean`                  | `false`         | Include type annotations in JSDoc |

## Runtime Configuration

These fields are part of the typed config surface. Today the CLI uses
`runtime.node.pythonPath`, `runtime.node.virtualEnv`, and `runtime.node.timeout`
during IR extraction. Your application still creates `NodeBridge`,
`PyodideBridge`, or `HttpBridge` itself at runtime.

### Node.js Runtime

```json
{
  "runtime": {
    "node": {
      "pythonPath": "/usr/local/bin/python3",
      "virtualEnv": "./venv",
      "timeout": 30000
    }
  }
}
```

### Pyodide Runtime (Browser)

```json
{
  "runtime": {
    "pyodide": {
      "indexURL": "https://cdn.jsdelivr.net/pyodide/v0.28.0/full/",
      "packages": ["numpy", "scipy", "matplotlib"]
    }
  }
}
```

### HTTP Runtime

```json
{
  "runtime": {
    "http": {
      "baseURL": "https://api.example.com/python",
      "timeout": 10000,
      "headers": {
        "Authorization": "Bearer your-token",
        "Content-Type": "application/json"
      }
    }
  }
}
```

### Runtime Options

#### Node.js Options

| Option       | Type     | Default     | Description               |
| ------------ | -------- | ----------- | ------------------------- |
| `pythonPath` | `string` | `'python3'` | Path to Python executable |
| `virtualEnv` | `string` | -           | Virtual environment path  |
| `timeout`    | `number` | `30000`     | Subprocess timeout (ms)   |

#### Pyodide Options

| Option     | Type       | Default | Description            |
| ---------- | ---------- | ------- | ---------------------- |
| `indexURL` | `string`   | CDN URL | Pyodide package index  |
| `packages` | `string[]` | `[]`    | Pre-installed packages |

#### HTTP Options

| Option    | Type                     | Default  | Description          |
| --------- | ------------------------ | -------- | -------------------- |
| `baseURL` | `string`                 | Required | API base URL         |
| `timeout` | `number`                 | `10000`  | Request timeout (ms) |
| `headers` | `Record<string, string>` | `{}`     | HTTP headers         |

## Performance Configuration

### Caching and Optimization

```json
{
  "performance": {
    "caching": true,
    "batching": true,
    "compression": "auto"
  }
}
```

## Type Mapping Configuration

Use presets to opt into richer mappings for common ecosystems.

```json
{
  "types": {
    "presets": ["stdlib", "pandas"]
  }
}
```

### Type Mapping Options

| Option    | Type                                                                                   | Default | Description                                   |
| --------- | -------------------------------------------------------------------------------------- | ------- | --------------------------------------------- |
| `presets` | `('numpy' \| 'pandas' \| 'pydantic' \| 'stdlib' \| 'scipy' \| 'torch' \| 'sklearn')[]` | `[]`    | Enable opt-in mappings for specific libraries |

`stdlib` maps common Python stdlib types (datetime, UUID, Decimal, Path) to
JSON-friendly primitives.  
`pandas` maps `DataFrame` and `Series` to record-shaped unions. `scipy` maps
sparse matrix classes (csr/csc/coo) to structured sparse objects.  
`torch` maps `Tensor` to a structured tensor object.  
`sklearn` maps `BaseEstimator` to estimator metadata objects.

### Performance Options

| Option        | Type                                     | Default  | Description               |
| ------------- | ---------------------------------------- | -------- | ------------------------- |
| `caching`     | `boolean`                                | `false`  | Enable IR caching         |
| `batching`    | `boolean`                                | `false`  | Batch multiple operations |
| `compression` | `'auto' \| 'gzip' \| 'brotli' \| 'none'` | `'none'` | Output compression        |

## Development Reload Helpers

Development reload is no longer configured inside `tywrap.config.*`.

Use `tywrap/dev` instead:

```typescript
import { createBridgeReloader, startNodeWatchSession } from 'tywrap/dev';
```

Support matrix:

- **Node**: `startNodeWatchSession(...)` watches local modules, regenerates
  wrappers, and swaps the active bridge.
- **Node bridge config**: `createBridge(config)` receives the fully resolved
  config for that reload cycle, so runtime setting changes can flow into the
  next bridge instance.
- **Node watch trees**: directory-valued package roots and `extraWatchPaths`
  are watched as directory trees, with `__pycache__`, `.pytest_cache`,
  `.mypy_cache`, and `.ruff_cache` ignored.
- **Strict reloads**: if regeneration returns structured failures, tywrap keeps
  the last known good generated output and bridge in place.
- **Pyodide**: `createBridgeReloader(...)` provides manual bridge replacement
  only.
- **HTTP**: reload is external to tywrap because tywrap does not own the remote
  server lifecycle.

If an older config still contains `development` or `pythonModules[*].watch`,
tywrap now throws a migration error that points to `tywrap/dev`.

## Extension Hooks

tywrap supports a lightweight plugin system that allows hooking into the
generation lifecycle:

- `beforeGeneration(options)` – invoked before code generation begins.
- `afterGeneration(result)` – called after generation completes.
- `transformPythonType(type)` – modify analyzed Python types.
- `transformTypescriptCode(code)` – post-process generated TypeScript.

Hooks are optional; implement only what your plugin needs.

## Environment Variables

Most tywrap behavior is configured in `tywrap.config.*` or when you construct a
runtime bridge in application code. The supported `TYWRAP_*` environment
variables are mostly codec guardrails, logging, and repo test knobs:

```bash
export TYWRAP_CODEC_FALLBACK="json"
export TYWRAP_CODEC_MAX_BYTES="10485760"   # Max response payload size (bytes)
export TYWRAP_REQUEST_MAX_BYTES="1048576"  # Max request payload size (bytes)
export TYWRAP_TORCH_ALLOW_COPY="1"
export TYWRAP_LOG_LEVEL="INFO"
export TYWRAP_LOG_JSON="1"
```

Repo tests and benchmarks also use additional `TYWRAP_*` variables such as
`TYWRAP_PERF_BUDGETS`.

Python executable and virtual environment selection are not configured through
environment variables today. Set them in `tywrap.config.*` or on the bridge:

```ts
import { defineConfig } from 'tywrap';

export default defineConfig({
  runtime: {
    node: {
      pythonPath: '/usr/local/bin/python3',
      virtualEnv: './venv',
      timeout: 30000,
    },
  },
});
```

See [Environment Variables](/reference/env-vars) for the full implemented list.

## Advanced Configuration Patterns

### Multi-Environment Setup

```typescript
// tywrap.config.ts
import { defineConfig } from 'tywrap';

const isDev = process.env.NODE_ENV === 'development';

export default defineConfig({
  pythonModules: {
    numpy: {
      runtime: isDev ? 'node' : 'pyodide',
      typeHints: isDev ? 'loose' : 'strict',
    },
  },
  output: {
    dir: isDev ? './dev-generated' : './dist/generated',
    sourceMap: isDev,
  },
});
```

### Monorepo Configuration

```typescript
// packages/core/tywrap.config.ts
export default defineConfig({
  pythonModules: {
    numpy: { runtime: 'node' },
    scipy: { runtime: 'node' },
  },
  output: {
    dir: './src/generated',
    format: 'esm',
  },
});

// packages/web/tywrap.config.ts
export default defineConfig({
  pythonModules: {
    numpy: { runtime: 'pyodide' },
    matplotlib: { runtime: 'pyodide' },
  },
  output: {
    dir: './src/generated',
    format: 'esm',
  },
  runtime: {
    pyodide: {
      packages: ['numpy', 'matplotlib'],
    },
  },
});
```

### Conditional Module Loading

```typescript
export default defineConfig({
  pythonModules: {
    // Core modules - always included
    math: { runtime: 'auto' },

    // Optional modules - only if available
    ...(process.env.INCLUDE_ML && {
      sklearn: { runtime: 'node', typeHints: 'loose' },
      torch: { runtime: 'node', classes: ['Tensor'] },
    }),

    // Local-only modules
    ...(process.env.NODE_ENV === 'development' && {
      debug_utils: { runtime: 'node' },
    }),
  },
});
```

## Configuration Validation

tywrap validates your configuration at build time:

```typescript
// Invalid configuration will show helpful errors
{
  "pythonModules": {
    "numpy": {
      "runtime": "invalid", // ❌ Error: Invalid runtime
      "typeHints": "maybe"  // ❌ Error: Invalid typeHints value
    }
  },
  "output": {
    "format": "umd" // ❌ Error: UMD format not supported
  }
}
```

## Configuration Merging

Configurations are merged in this order:

1. Default values
2. Configuration file
3. CLI flags or programmatic overrides

```bash
# CLI overrides take highest precedence
tywrap generate --output-dir ./custom --format cjs
```

## Best Practices

### 1. Environment-Specific Configs

```typescript
// Use different configs per environment
const config = {
  local: './tywrap.dev.config.ts',
  production: './tywrap.prod.config.ts',
  test: './tywrap.test.config.ts',
};
```

### 2. Module Organization

```json
{
  "pythonModules": {
    // Group related modules
    "numpy": { "runtime": "pyodide" },
    "scipy": { "runtime": "pyodide" },
    "matplotlib": { "runtime": "pyodide" },

    // Separate custom modules
    "./utils/math_helpers.py": { "runtime": "node" },
    "./utils/data_processing.py": { "runtime": "node" }
  }
}
```

### 3. Performance Optimization

```json
{
  "performance": {
    "caching": true, // Always enable in CI/CD
    "batching": true, // For multiple modules
    "compression": "auto" // Let tywrap decide
  }
}
```

### 4. Type Safety

```json
{
  "pythonModules": {
    "well_typed_module": { "typeHints": "strict" },
    "legacy_module": { "typeHints": "loose" },
    "untyped_module": { "typeHints": "ignore" }
  }
}
```

## Troubleshooting Configuration

### Common Issues

**Module not found**:

```bash
# Check Python path
python3 -c "import sys; print(sys.path)"

# Verify module installation
python3 -c "import your_module; print(your_module.__file__)"
```

**Type generation errors**:

```json
{
  "pythonModules": {
    "problematic_module": {
      "typeHints": "loose", // Relax type checking
      "functions": ["specific_function"] // Limit scope
    }
  }
}
```

**Performance issues**:

```json
{
  "performance": {
    "caching": true, // Enable caching
    "compression": "none" // Disable compression
  }
}
```

For more troubleshooting, see [Troubleshooting Guide](/troubleshooting/).

## Next Steps

- [Runtime Guides](/guide/runtimes/node) - Platform-specific configuration
- [Examples](/examples/) - Configuration examples
- [API Reference](/reference/api/) - Complete API documentation
