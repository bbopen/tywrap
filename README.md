# tywrap

[![npm version](https://img.shields.io/npm/v/tywrap.svg)](https://www.npmjs.com/package/tywrap)
[![CI](https://github.com/bbopen/tywrap/actions/workflows/ci.yml/badge.svg)](https://github.com/bbopen/tywrap/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

TypeScript wrapper for Python libraries with full type safety.

> **⚠️ Experimental Software (v0.1.0)** - APIs may change between versions. Not recommended for production use until v1.0.0.

## Features

- **Full Type Safety** - TypeScript definitions generated from Python source analysis
- **Multi-Runtime** - Node.js (subprocess) and browsers (Pyodide)
- **Rich Data Types** - numpy, pandas, scipy, torch, sklearn, and stdlib types
- **Efficient Serialization** - Apache Arrow binary format with JSON fallback

## Requirements

- Node.js 20+ (or Bun 1.1+ / Deno 1.46+)
- Python 3.10+

## Quick Start

```bash
npm install tywrap
npx tywrap init      # Create config (and package.json scripts if present)
npx tywrap generate  # Generate wrappers
```

For CI (or to verify a dependency upgrade didn’t change the generated surface):

```bash
npx tywrap generate --check
```

```typescript
import { NodeBridge } from 'tywrap/node';
import { setRuntimeBridge } from 'tywrap/runtime';
import * as math from './generated/math.generated.js';

const bridge = new NodeBridge({ pythonPath: 'python3' });
setRuntimeBridge(bridge);

const result = await math.sqrt(16); // 4
```

## Runtime Bridges

### Node.js

```typescript
import { NodeBridge } from 'tywrap/node';
const bridge = new NodeBridge({
  pythonPath: 'python3',
  virtualEnv: './venv',
  timeoutMs: 30000
});
```

NodeBridge is the default, correctness-first bridge. OptimizedNodeBridge is a performance-focused
prototype (process pooling + optional caching) and is not a drop-in replacement yet. See
`ROADMAP.md` for the unification plan.

Both bridges share a common JSONL core for protocol validation and timeouts.

By default, NodeBridge inherits only PATH/PYTHON*/TYWRAP_* from `process.env` to keep
the subprocess environment minimal. Set `inheritProcessEnv: true` if you need the
full environment. Large JSONL responses are capped by `maxLineLength` (defaults to
`TYWRAP_CODEC_MAX_BYTES` when set, otherwise 1MB).

You can cap payload sizes with `TYWRAP_CODEC_MAX_BYTES` (responses) and `TYWRAP_REQUEST_MAX_BYTES`
(requests) to keep JSONL traffic bounded.

### Browser (Pyodide)

```typescript
import { PyodideBridge } from 'tywrap/pyodide';
const bridge = new PyodideBridge({
  indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/'
});
await bridge.init();
```

### Deno / Bun

```typescript
import { NodeBridge } from 'npm:tywrap';  // Deno
import { NodeBridge } from 'tywrap';       // Bun
```

## Configuration

```typescript
// tywrap.config.ts
import { defineConfig } from 'tywrap';

export default defineConfig({
  pythonModules: {
    'pandas': { classes: ['DataFrame'], functions: ['read_csv'] },
    'numpy': { alias: 'np' }
  },
  output: { dir: './src/generated' }
});
```

See [Configuration Guide](./docs/configuration.md) for all options.

## Supported Data Types

| Python | TypeScript | Notes |
|--------|-----------|-------|
| `numpy.ndarray` | `Uint8Array` / `array` | Arrow or JSON |
| `pandas.DataFrame` | Arrow Table / `object[]` | Arrow or JSON |
| `scipy.sparse.*` | `SparseMatrix` | CSR, CSC, COO |
| `torch.Tensor` | `TorchTensor` | CPU only |
| `sklearn estimator` | `SklearnEstimator` | Params only |
| `datetime`, `Decimal`, `UUID`, `Path` | `string` | Standard formats |

For Arrow encoding with numpy/pandas:

```typescript
import { registerArrowDecoder } from 'tywrap';
import { tableFromIPC } from 'apache-arrow';
registerArrowDecoder(bytes => tableFromIPC(bytes));
```

## Documentation

- [Getting Started](./docs/getting-started.md)
- [Configuration](./docs/configuration.md)
- [API Reference](./docs/api/README.md)
- [Troubleshooting](./docs/troubleshooting/README.md)

## Contributing

```bash
npm install
npm test
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

MIT © [tywrap contributors](LICENSE)

## Links

- [GitHub](https://github.com/bbopen/tywrap)
- [npm](https://www.npmjs.com/package/tywrap)
- [Issues](https://github.com/bbopen/tywrap/issues)
