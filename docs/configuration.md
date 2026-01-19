# Configuration Guide

Complete configuration reference covering all options from basic setup to advanced optimization.

## Top-Level Fields

| Field | Description |
|-------|-------------|
| `pythonModules` | Mapping of module names to wrapper configuration |
| `output` | Output directory, module format and artifact options |
| `runtime` | Settings for Node, Pyodide or HTTP runtimes |
| `performance` | Caching and optimization controls |
| `development` | Development-time features like hot reloading |
| `types` | Type mapping presets and customization |

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
  "performance": { "caching": true },
  "development": { "hotReload": false }
}
```

### TypeScript Configuration
```typescript
// tywrap.config.ts
import { defineConfig } from 'tywrap';

export default defineConfig({
  pythonModules: {
    numpy: { 
      version: '1.24.0',
      runtime: 'pyodide',
      functions: ['array', 'zeros', 'ones'],
      typeHints: 'strict'
    },
    pandas: {
      runtime: 'node',
      alias: 'pd'
    }
  },
  output: {
    dir: './src/generated',
    format: 'esm',
    declaration: true,
    sourceMap: true
  },
  performance: {
    caching: true,
    batching: true,
    compression: 'auto'
  }
});
```

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
      "typeHints": "strict",
      "watch": true
    },
    "./custom_module.py": {
      "runtime": "node",
      "typeHints": "loose",
      "watch": true
    }
  }
}
```

### Module Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `runtime` | `'node' \| 'pyodide' \| 'http' \| 'auto'` | `'auto'` | Runtime environment |
| `version` | `string` | Latest | Specific package version |
| `functions` | `string[]` | All | Specific functions to wrap |
| `classes` | `string[]` | All | Specific classes to wrap |
| `alias` | `string` | Module name | Import alias in generated code |
| `typeHints` | `'strict' \| 'loose' \| 'ignore'` | `'strict'` | Type hint processing |
| `watch` | `boolean` | `false` | Enable file watching in development |

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

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dir` | `string` | `'./generated'` | Output directory |
| `format` | `'esm' \| 'cjs' \| 'both'` | `'esm'` | Module format |
| `declaration` | `boolean` | `false` | Generate .d.ts files |
| `sourceMap` | `boolean` | `false` | Generate source maps |
| `annotatedJSDoc` | `boolean` | `false` | Include type annotations in JSDoc |

## Runtime Configuration

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
      "indexURL": "https://cdn.jsdelivr.net/pyodide/",
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
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `pythonPath` | `string` | `'python3'` | Path to Python executable |
| `virtualEnv` | `string` | - | Virtual environment path |
| `timeout` | `number` | `30000` | Subprocess timeout (ms) |

#### Pyodide Options  
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `indexURL` | `string` | CDN URL | Pyodide package index |
| `packages` | `string[]` | `[]` | Pre-installed packages |

#### HTTP Options
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `baseURL` | `string` | Required | API base URL |
| `timeout` | `number` | `10000` | Request timeout (ms) |
| `headers` | `Record<string, string>` | `{}` | HTTP headers |

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

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `presets` | `('numpy' \| 'pandas' \| 'pydantic' \| 'stdlib' \| 'scipy' \| 'torch' \| 'sklearn')[]` | `[]` | Enable opt-in mappings for specific libraries |

`stdlib` maps common Python stdlib types (datetime, UUID, Decimal, Path) to JSON-friendly primitives.  
`pandas` maps `DataFrame` and `Series` to record-shaped unions.
`scipy` maps sparse matrix classes (csr/csc/coo) to structured sparse objects.  
`torch` maps `Tensor` to a structured tensor object.  
`sklearn` maps `BaseEstimator` to estimator metadata objects.

### Performance Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `caching` | `boolean` | `false` | Enable IR caching |
| `batching` | `boolean` | `false` | Batch multiple operations |
| `compression` | `'auto' \| 'gzip' \| 'brotli' \| 'none'` | `'none'` | Output compression |

## Development Configuration

### Development Options
```json
{
  "development": {
    "hotReload": true,
    "sourceMap": true,
    "validation": "runtime"
  }
}
```

### Development Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `hotReload` | `boolean` | `false` | Enable hot reloading |
| `sourceMap` | `boolean` | `false` | Generate source maps |
| `validation` | `'runtime' \| 'compile' \| 'both' \| 'none'` | `'none'` | Validation level |

## Extension Hooks

tywrap supports a lightweight plugin system that allows hooking into the
generation lifecycle:

- `beforeGeneration(options)` – invoked before code generation begins.
- `afterGeneration(result)` – called after generation completes.
- `transformPythonType(type)` – modify analyzed Python types.
- `transformTypescriptCode(code)` – post-process generated TypeScript.

Hooks are optional; implement only what your plugin needs.

## Environment Variables

Override configuration with environment variables:

```bash
# Runtime configuration
export TYWRAP_PYTHON_PATH="/usr/local/bin/python3.11"
export TYWRAP_VIRTUAL_ENV="./venv"
export TYWRAP_CODEC_FALLBACK="json"
export TYWRAP_CODEC_MAX_BYTES="10485760"  # Max response payload size (bytes)
export TYWRAP_REQUEST_MAX_BYTES="1048576"  # Max request payload size (bytes)
export TYWRAP_TORCH_ALLOW_COPY="1"

# Note: NodeBridge uses TYWRAP_CODEC_MAX_BYTES as the default maxLineLength when set.

# Performance tuning
export TYWRAP_CACHE_DIR="./.tywrap/cache"
export TYWRAP_MEMORY_LIMIT="1024"
export TYWRAP_PERF_BUDGETS="1"
export TYWRAP_PERF_TIME_BUDGET_MS="2000"
export TYWRAP_PERF_MEMORY_BUDGET_MB="64"
export TYWRAP_CODEC_PERF_ITERATIONS="200"
export TYWRAP_CODEC_PERF_TIME_BUDGET_MS="500"
export TYWRAP_CODEC_PERF_MEMORY_BUDGET_MB="32"

# Development
export TYWRAP_VERBOSE="true"
export TYWRAP_HOT_RELOAD="true"
```

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
      typeHints: isDev ? 'loose' : 'strict'
    }
  },
  output: {
    dir: isDev ? './dev-generated' : './dist/generated',
    sourceMap: isDev
  },
  development: {
    hotReload: isDev,
    validation: isDev ? 'runtime' : 'none'
  }
});
```

### Monorepo Configuration
```typescript
// packages/core/tywrap.config.ts
export default defineConfig({
  pythonModules: {
    numpy: { runtime: 'node' },
    scipy: { runtime: 'node' }
  },
  output: {
    dir: './src/generated',
    format: 'esm'
  }
});

// packages/web/tywrap.config.ts  
export default defineConfig({
  pythonModules: {
    numpy: { runtime: 'pyodide' },
    matplotlib: { runtime: 'pyodide' }
  },
  output: {
    dir: './src/generated',
    format: 'esm'
  },
  runtime: {
    pyodide: {
      packages: ['numpy', 'matplotlib']
    }
  }
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
      'sklearn': { runtime: 'node', typeHints: 'loose' },
      'torch': { runtime: 'node', classes: ['Tensor'] }
    }),
    
    // Development-only modules
    ...(process.env.NODE_ENV === 'development' && {
      'debug_utils': { runtime: 'node', watch: true }
    })
  }
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
3. Environment variables
4. CLI flags
5. Programmatic overrides

```bash
# CLI overrides take highest precedence
tywrap generate --output-dir ./custom --format cjs
```

## Best Practices

### 1. Environment-Specific Configs
```typescript
// Use different configs per environment
const config = {
  development: './tywrap.dev.config.ts',
  production: './tywrap.prod.config.ts',
  test: './tywrap.test.config.ts'
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
    "caching": true,        // Always enable in CI/CD
    "batching": true,       // For multiple modules
    "compression": "auto"   // Let tywrap decide
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
      "typeHints": "loose",  // Relax type checking
      "functions": ["specific_function"]  // Limit scope
    }
  }
}
```

**Performance issues**:
```json
{
  "performance": {
    "caching": true,          // Enable caching
    "compression": "none"     // Disable compression
  }
}
```

For more troubleshooting, see [Troubleshooting Guide](./troubleshooting/README.md).

## Next Steps

- [Runtime Guides](./runtimes/nodejs.md) - Platform-specific configuration
- [Examples](./examples/README.md) - Configuration examples
- [API Reference](./api/README.md) - Complete API documentation
