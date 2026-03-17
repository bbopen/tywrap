# tywrap

[![npm version](https://img.shields.io/npm/v/tywrap.svg)](https://www.npmjs.com/package/tywrap)
[![PyPI version](https://img.shields.io/pypi/v/tywrap-ir.svg)](https://pypi.org/project/tywrap-ir/)
[![CI](https://github.com/bbopen/tywrap/actions/workflows/ci.yml/badge.svg)](https://github.com/bbopen/tywrap/actions/workflows/ci.yml)
[![Coverage](https://codecov.io/gh/bbopen/tywrap/branch/main/graph/badge.svg)](https://codecov.io/gh/bbopen/tywrap)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm downloads](https://img.shields.io/npm/dm/tywrap.svg)](https://www.npmjs.com/package/tywrap)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Docs](https://img.shields.io/badge/docs-bbopen.github.io%2Ftywrap-blue)](https://bbopen.github.io/tywrap)

TypeScript wrapper for Python libraries with full type safety.

> **⚠️ Experimental** — APIs may change before v1.0.0. See the
> [releases page](https://github.com/bbopen/tywrap/releases) for breaking
> changes.

## Features

- **Full Type Safety** - TypeScript definitions generated from Python source
  analysis
- **Multi-Runtime** - Node.js (subprocess) and browsers (Pyodide)
- **Rich Data Types** - numpy, pandas, scipy, torch, sklearn, and stdlib types
- **Efficient Serialization** - Apache Arrow binary format with JSON fallback

## Why tywrap?

| Feature                         | tywrap    | pythonia  | node-calls-python | pymport   |
| ------------------------------- | --------- | --------- | ----------------- | --------- |
| Auto-generated TypeScript types | ✅        | ❌        | ❌                | ❌        |
| Browser / WASM (Pyodide)        | ✅        | ❌        | ❌                | ❌        |
| numpy / pandas type mappings    | ✅        | ❌        | ❌                | ❌        |
| Node.js + Bun + Deno            | All three | Node only | Node only         | Node only |
| Apache Arrow binary transport   | ✅        | ❌        | ❌                | ❌        |

## Requirements

- Node.js 20+ (or Bun 1.1+ / Deno 1.46+)
- Python 3.10+ with `tywrap-ir`:

  ```bash
  pip install tywrap-ir
  ```

## Quick Start

```bash
npm install tywrap
pip install tywrap-ir  # Python component for code generation
npx tywrap init        # Create config (and package.json scripts if present)
npx tywrap generate    # Generate wrappers
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

> If tywrap saves you time, a ⭐ on [GitHub](https://github.com/bbopen/tywrap)
> helps others find it.

## Runtime Bridges

### Node.js

```typescript
import { NodeBridge } from 'tywrap/node';
const bridge = new NodeBridge({
  pythonPath: 'python3',
  virtualEnv: './venv',
  timeoutMs: 30000,
});
```

NodeBridge is the default, correctness-first bridge. OptimizedNodeBridge is a
performance-focused prototype (process pooling + optional caching) and is not a
drop-in replacement yet. See `ROADMAP.md` for the unification plan.

Both bridges share a common JSONL core for protocol validation and timeouts.

By default, NodeBridge inherits only PATH/PYTHON*/TYWRAP\_* from `process.env`
to keep the subprocess environment minimal. Set `inheritProcessEnv: true` if you
need the full environment.

You can cap payload sizes with `TYWRAP_CODEC_MAX_BYTES` (responses) and
`TYWRAP_REQUEST_MAX_BYTES` (requests) to keep JSONL traffic bounded.

### Browser (Pyodide)

```typescript
import { PyodideBridge } from 'tywrap/pyodide';
const bridge = new PyodideBridge({
  indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.28.0/full/',
});
await bridge.init();
```

### Deno / Bun

```typescript
import { NodeBridge } from 'npm:tywrap'; // Deno
import { NodeBridge } from 'tywrap'; // Bun
```

## Configuration

```typescript
// tywrap.config.ts
import { defineConfig } from 'tywrap';

export default defineConfig({
  pythonModules: {
    pandas: {
      runtime: 'node',
      typeHints: 'strict',
      classes: ['DataFrame'],
      functions: ['read_csv'],
    },
    numpy: {
      runtime: 'node',
      typeHints: 'strict',
      alias: 'np',
    },
  },
  output: { dir: './src/generated' },
});
```

See [Configuration Guide](https://bbopen.github.io/tywrap/guide/configuration)
for all options.

## Supported Data Types

| Python                                | TypeScript               | Notes            |
| ------------------------------------- | ------------------------ | ---------------- |
| `numpy.ndarray`                       | `Uint8Array` / `array`   | Arrow or JSON    |
| `pandas.DataFrame`                    | Arrow Table / `object[]` | Arrow or JSON    |
| `scipy.sparse.*`                      | `SparseMatrix`           | CSR, CSC, COO    |
| `torch.Tensor`                        | `TorchTensor`            | CPU only         |
| `sklearn estimator`                   | `SklearnEstimator`       | Params only      |
| `datetime`, `Decimal`, `UUID`, `Path` | `string`                 | Standard formats |

For Arrow encoding with numpy/pandas:

```typescript
import { registerArrowDecoder } from 'tywrap';
import { tableFromIPC } from 'apache-arrow';
registerArrowDecoder(bytes => tableFromIPC(bytes));
```

## Documentation

- [Getting Started](https://bbopen.github.io/tywrap/guide/getting-started)
- [Configuration](https://bbopen.github.io/tywrap/guide/configuration)
- [API Reference](https://bbopen.github.io/tywrap/reference/api/)
- [Troubleshooting](https://bbopen.github.io/tywrap/troubleshooting/)

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
- [PyPI](https://pypi.org/project/tywrap-ir/)
- [Issues](https://github.com/bbopen/tywrap/issues)
