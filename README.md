# tywrap

[![npm version](https://img.shields.io/npm/v/tywrap.svg)](https://www.npmjs.com/package/tywrap)
[![CI](https://github.com/bbopen/tywrap/actions/workflows/ci.yml/badge.svg)](https://github.com/bbopen/tywrap/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

TypeScript wrapper for Python libraries with full type safety.

> **Warning: Experimental Software**
> **Version 0.1.0** - This project is in early experimental development. APIs may change significantly between versions. Not recommended for production use until version 1.0.0.

TypeScript is great, but many robust libraries exist only in Python, especially for data science and machine learning. Wouldn't it be great if you could use those libraries in your TypeScript project?

tywrap is a build-time code generation system that creates TypeScript wrappers for Python libraries, giving you type safety and IDE autocomplete for Python code.

## Features

- **Full Type Safety** - TypeScript type definitions generated from Python source analysis
- **Multi-Runtime Support** - Works in Node.js (subprocess) and browsers (via Pyodide)
- **IR-First Generation** - Python Intermediate Representation (IR) extractor analyzes modules and emits structured type information
- **Rich Data Type Support** - Native handling for numpy, pandas, scipy, torch, sklearn, and Python stdlib types
- **Efficient Serialization** - Apache Arrow binary format for high-performance data transfer (with JSON fallback)
- **Optional Caching** - Intelligent result caching system (opt-in via config)

## Requirements

- Node.js 20+ (or Bun 1.1+ / Deno 1.46+)
- Python 3.10+

## Quick Start

```bash
npm install tywrap
```

### Initialize a Config

```bash
npx tywrap init
```

This creates a `tywrap.config.ts` file. Edit it to specify which Python modules to wrap.

### Generate Wrappers

```bash
npx tywrap generate
```

### Basic Usage

```typescript
import { NodeBridge } from 'tywrap/node';
import { setRuntimeBridge } from 'tywrap/runtime';
import * as math from './generated/math.generated.js';

// Create a "bridge" - the runtime adapter that executes Python code
const bridge = new NodeBridge({
  pythonPath: 'python3',
  virtualEnv: './venv'
});

// Set as the active bridge for generated wrappers
setRuntimeBridge(bridge);

// Call Python functions with full type safety
const result = await math.sqrt(16);
console.log(result); // 4
```

## Runtime Support

tywrap provides **bridge** implementations—runtime adapters that handle communication between TypeScript and Python.

### Node.js (Primary)

The Node.js bridge spawns a Python subprocess and communicates via JSON-RPC:

```typescript
import { NodeBridge } from 'tywrap/node';
import { setRuntimeBridge } from 'tywrap/runtime';

const bridge = new NodeBridge({
  pythonPath: 'python3',
  virtualEnv: './venv',
  timeout: 30000  // Optional: request timeout in ms
});

setRuntimeBridge(bridge);
```

### Browser (Pyodide)

The browser bridge uses [Pyodide](https://pyodide.org/) to run Python in WebAssembly:

```typescript
import { PyodideBridge } from 'tywrap/pyodide';
import { setRuntimeBridge } from 'tywrap/runtime';

const bridge = new PyodideBridge({
  indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/'
});

await bridge.init();
setRuntimeBridge(bridge);
```

### Deno / Bun

Deno and Bun can use the Node.js bridge. Import via npm specifier:

```typescript
// Deno
import { NodeBridge, setRuntimeBridge } from 'npm:tywrap';

// Bun (same as Node.js)
import { NodeBridge, setRuntimeBridge } from 'tywrap';

const bridge = new NodeBridge({ pythonPath: 'python3' });
setRuntimeBridge(bridge);
```

### Working with Classes

Generated class wrappers use async factory methods:

```typescript
import { Counter } from './generated/collections.generated';

// Create instance (async because it calls Python)
const counter = await Counter.create(['a', 'b', 'b', 'c', 'b']);

// Call methods
const mostCommon = await counter.mostCommon(2);
console.log(mostCommon); // [['b', 3], ['c', 1]]

// Clean up when done
await counter.disposeHandle();
```

## Configuration

Create a `tywrap.config.ts` file:

```typescript
import { defineConfig } from 'tywrap';

export default defineConfig({
  pythonModules: {
    'pandas': {
      version: '2.1.0',
      classes: ['DataFrame'],
      functions: ['read_csv', 'concat']
    },
    'numpy': {
      version: '1.24.0',
      alias: 'np'
    },
    './custom_module.py': {
      // Local modules work too
    }
  },

  output: {
    dir: './src/generated',
    format: 'esm',
    declaration: true
  },

  performance: {
    caching: true,  // Enable result caching
    batching: true  // Batch multiple calls
  },

  debug: false  // Set true for verbose logging
});
```

Config file resolution: `tywrap.config.ts`, `.mts`, `.js`, `.mjs`, `.cjs`, `.json`.

See the [Configuration Guide](./docs/configuration.md) for all options.

## How It Works

1. **Python IR Extraction** - The `tywrap_ir` tool analyzes Python modules using AST parsing and emits a versioned JSON Intermediate Representation (IR) containing function signatures, class definitions, and type annotations.

2. **Type Mapping** - The IR is transformed into TypeScript types. Python's `int` becomes `number`, `List[str]` becomes `string[]`, etc.

3. **Code Generation** - TypeScript wrapper code is generated with proper async handling and bridge integration.

4. **Runtime Execution** - At runtime, the bridge serializes calls to Python and deserializes results back to JavaScript.

## Documentation

- [Getting Started Guide](./docs/getting-started.md) - Detailed setup instructions
- [Configuration Reference](./docs/configuration.md) - All configuration options
- [Node.js Runtime](./docs/runtimes/nodejs.md) - Node.js bridge details
- [Browser Runtime](./docs/runtimes/browser.md) - Pyodide integration
- [API Reference](./docs/api/README.md) - Complete API documentation
- [Examples](./docs/examples/README.md) - Real-world usage examples
- [Troubleshooting](./docs/troubleshooting/README.md) - Common issues and solutions
- [Release Notes](./docs/release.md) - Version history and upgrade guides

## Data Type Support

tywrap automatically serializes Python data types to JavaScript. The Python bridge wraps complex types in **envelopes**—metadata wrappers that preserve type information.

### Supported Types

| Python Type | JS/TS Type | Encoding | Notes |
|-------------|-----------|----------|-------|
| `numpy.ndarray` | `Uint8Array` or `array` | Arrow or JSON | Shape preserved |
| `pandas.DataFrame` | Arrow Table or `object[]` | Arrow or JSON | Column types preserved |
| `pandas.Series` | Arrow Table or `array` | Arrow or JSON | Name preserved |
| `scipy.sparse.*` | `SparseMatrix` | JSON | CSR, CSC, COO formats |
| `torch.Tensor` | `TorchTensor` | ndarray wrapper | CPU only by default |
| `sklearn estimator` | `SklearnEstimator` | JSON | Params only (no pickle) |
| `datetime.*` | `string` | ISO format | datetime, date, time |
| `timedelta` | `number` | seconds | Total seconds as float |
| `Decimal` | `string` | string | Preserves precision |
| `UUID` | `string` | string | Standard format |
| `Path` | `string` | string | Platform-neutral |

### Arrow Encoding (Recommended)

For numpy/pandas data, Arrow binary format is more efficient than JSON. Register a decoder at app startup:

```typescript
import { registerArrowDecoder } from 'tywrap';
import { tableFromIPC } from 'apache-arrow';

registerArrowDecoder(bytes => tableFromIPC(bytes));
```

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `TYWRAP_CODEC_FALLBACK=json` | Use JSON instead of Arrow (for dev or constrained environments) |
| `TYWRAP_TORCH_ALLOW_COPY=1` | Allow GPU→CPU transfer and non-contiguous tensor copying |

### Envelope Format

```json
{"__tywrap__": "dataframe", "encoding": "arrow", "b64": "..."}
{"__tywrap__": "ndarray", "encoding": "json", "data": [...], "shape": [3, 4]}
{"__tywrap__": "scipy.sparse", "format": "csr", "data": [...], "indices": [...]}
{"__tywrap__": "torch.tensor", "value": {...}, "dtype": "float32", "device": "cpu"}
{"__tywrap__": "sklearn.estimator", "className": "LinearRegression", "params": {...}}
```

See [codec-roadmap.md](./docs/codec-roadmap.md) for encoding details and planned features.

## Roadmap

### Implemented
- [x] Core TypeScript generation from Python IR
- [x] Node.js runtime bridge (subprocess)
- [x] Browser runtime bridge (Pyodide)
- [x] Python AST analysis and type extraction
- [x] Codec support: numpy, pandas, scipy sparse, torch tensors, sklearn estimators
- [x] Apache Arrow binary encoding (with JSON fallback)
- [x] Python stdlib type conversions (datetime, Decimal, UUID, Path)
- [x] Result caching system (opt-in)

### Planned
- [ ] Build tool plugins (Vite, Webpack, Rollup)
- [ ] Hot reload / watch mode
- [ ] Source map generation
- [ ] IDE extensions
- [ ] SharedArrayBuffer for zero-copy transfers
- [ ] Streaming results for large datasets

## Versioning

tywrap follows [Semantic Versioning](https://semver.org/):

- **0.x.x** - Experimental releases. Breaking changes may occur in any release.
- **1.x.x** - Stable API. Breaking changes only in major versions.

### Current Status (v0.1.0)

| Feature | Status |
|---------|--------|
| TypeScript generation | ✅ Working |
| Node.js bridge | ✅ Working |
| Pyodide bridge | ✅ Working |
| Type safety | ✅ Working |
| numpy/pandas codecs | ✅ Working |
| scipy/torch/sklearn codecs | ✅ Working |
| Deno/Bun | ⚠️ Uses Node bridge |
| API stability | ⚠️ May change |

## Contributing

We welcome contributions! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

To run tests locally:

```bash
npm install
npm test
```

For the full test matrix including Python library integration:

```bash
npm run test:python:suite:core
```

## License

MIT © [tywrap contributors](LICENSE)

## Links

- [GitHub Repository](https://github.com/bbopen/tywrap)
- [npm Package](https://www.npmjs.com/package/tywrap)
- [Issue Tracker](https://github.com/bbopen/tywrap/issues)
