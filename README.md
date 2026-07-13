# tywrap

[![npm version](https://img.shields.io/npm/v/tywrap.svg)](https://www.npmjs.com/package/tywrap)
[![PyPI version](https://img.shields.io/pypi/v/tywrap-ir.svg)](https://pypi.org/project/tywrap-ir/)
[![CI](https://github.com/bbopen/tywrap/actions/workflows/ci.yml/badge.svg)](https://github.com/bbopen/tywrap/actions/workflows/ci.yml)
[![Coverage](https://codecov.io/gh/bbopen/tywrap/branch/main/graph/badge.svg)](https://codecov.io/gh/bbopen/tywrap)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm downloads](https://img.shields.io/npm/dm/tywrap.svg)](https://www.npmjs.com/package/tywrap)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Docs](https://img.shields.io/badge/docs-bbopen.github.io%2Ftywrap-blue)](https://bbopen.github.io/tywrap)

TypeScript bindings for Python libraries, with precise types for fully
annotated, in-module, serializable Python returns and fallbacks where tywrap
cannot resolve a type.

> Experimental: APIs may change before v1.0.0. See the
> [releases page](https://github.com/bbopen/tywrap/releases) for breaking
> changes.

## Features

- **Accurate Type Coverage** - Precise TypeScript types for fully annotated,
  in-module, serializable Python returns, with fallbacks where resolution is not
  possible
- **Development Hot Reload** - Real Node watch sessions regenerate wrappers and
  swap the active bridge without re-importing generated modules
- **Generic-Aware Declarations** - Preserves simple `TypeVar` and callable
  `ParamSpec` generics in generated `.ts` and `.d.ts` output
- **Multi-Runtime** - Node.js and Bun (subprocess), browsers (Pyodide), and
  experimental, untested-in-CI Deno subprocess support
- **Rich Data Types** - numpy, pandas, scipy, torch, sklearn, and stdlib types
- **Efficient Serialization** - Apache Arrow binary format with JSON fallback
- **Large-Payload Transport** - the Node subprocess bridge chunks results that
  exceed the JSONL line ceiling and reassembles them, so big payloads aren't
  limited to a single line

## Why tywrap?

| Feature                         | tywrap    | pythonia  | node-calls-python | pymport   |
| ------------------------------- | --------- | --------- | ----------------- | --------- |
| Auto-generated TypeScript types | yes       | no       | no               | no       |
| Browser / WASM (Pyodide)        | yes       | no       | no               | no       |
| numpy / pandas type mappings    | yes       | no       | no               | no       |
| Node.js + Bun + Deno            | All three | Node only | Node only         | Node only |
| Apache Arrow binary transport   | yes       | no       | no               | no       |

## Requirements

- Node.js 20+ (or Bun 1.1+ / Deno 1.46+; Deno subprocess support is experimental
  and untested in CI)
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

`tywrap` and `tywrap-ir` are versioned independently. Install the latest
published release of each package unless you need to pin them explicitly.

For CI (or to verify a dependency upgrade didn’t change the generated surface):

```bash
npx tywrap generate --check
```

For local Node development, `tywrap/dev` watches local Python package trees and
regenerates wrappers. It swaps the active bridge only after a successful
generation, so a failed regeneration leaves the previous state in place.

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

NodeBridge is the public Node runtime bridge. It runs in single-process mode by
default and also supports pooled execution through `minProcesses`,
`maxProcesses`, and `maxConcurrentPerProcess`. Python workers process requests
serially, so `maxConcurrentPerProcess` defaults to `1` and lets the pool use
another process for concurrent calls when `maxProcesses` permits it.

`OptimizedNodeBridge` is now only a deprecated compatibility alias for older
deep imports. It is not part of the package exports and should not be used in
new code.

By default, NodeBridge inherits only PATH/PYTHON*/TYWRAP\_* from `process.env`
to keep the subprocess environment minimal. Set `inheritProcessEnv: true` if you
need the full environment.

A request or response larger than the JSONL line ceiling (`maxLineLength`) is
split into `tywrap-frame/1` frames and reassembled. NodeBridge negotiates this
by default, so large payloads aren't limited to one line. Chunking engages only
above the frame ceiling, and reassembly is bounded by the codec payload cap, so
a payload larger than that cap fails loud rather than buffering without limit.
Raise `codec.maxPayloadBytes` to carry large results. You can still
bound JSONL traffic explicitly with `TYWRAP_CODEC_MAX_BYTES` (responses) and
`TYWRAP_REQUEST_MAX_BYTES` (requests). See the
[transport framing](https://bbopen.github.io/tywrap/transport-framing) and
[capability matrix](https://bbopen.github.io/tywrap/transport-capabilities)
docs.

## Development Hot Reload

```typescript
import { startNodeWatchSession } from 'tywrap/dev';
import { NodeBridge } from 'tywrap/node';

const session = await startNodeWatchSession({
  configFile: './tywrap.config.ts',
  createBridge: async config =>
    new NodeBridge({
      pythonPath: config.runtime.node?.pythonPath ?? 'python3',
      timeoutMs: config.runtime.node?.timeout ?? 30000,
    }),
});
```

- **Node**: full watch + wrapper regeneration + bridge swap
- **Pyodide**: use `createBridgeReloader(...)` from `tywrap/dev` for manual
  bridge replacement
- **HTTP**: restart or redeploy the remote server outside tywrap

The Node watch session manages local package trees and refreshes nested
directory watchers when package layouts change. Structured generation failures
leave the last known good generated output and bridge active.

### Browser (Pyodide)

```typescript
import { PyodideBridge } from 'tywrap/pyodide';
const bridge = new PyodideBridge({
  indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.28.0/full/',
});
await bridge.init();
```

### Deno / Bun

Deno subprocess support is experimental and untested in CI.

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
- [Roadmap](./ROADMAP.md)

## Security

Read the [Security policy](./SECURITY.md) for the bridge trust model and
vulnerability reporting.

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
