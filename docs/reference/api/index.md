# API Reference

This page covers the public programmatic API exported by `tywrap`.

## Core API

### `defineConfig(config)`

Type-safe helper for `tywrap.config.ts`.

```ts
import { defineConfig } from 'tywrap';

export default defineConfig({
  pythonModules: {
    math: { runtime: 'node', typeHints: 'strict' },
  },
});
```

### `resolveConfig(options?)`

Loads a config file, merges defaults, and applies overrides.

```ts
import { resolveConfig } from 'tywrap';

const config = await resolveConfig({
  configFile: './tywrap.config.ts',
  overrides: { debug: true },
});
```

### `generate(options, runOptions?)`

Generates wrapper files from config.

```ts
import { generate } from 'tywrap';

await generate({
  pythonModules: {
    math: { runtime: 'node', typeHints: 'strict' },
  },
  output: {
    dir: './generated',
    format: 'esm',
    declaration: false,
    sourceMap: false,
  },
});
```

`runOptions.check` switches generation into compare-only mode, the same behavior
used by `tywrap generate --check`.

### `tywrap(options?)`

Creates the lower-level mapper and generator objects for advanced use.

```ts
import { tywrap } from 'tywrap';

const instance = await tywrap({
  types: { presets: ['stdlib'] },
});
```

## Runtime Registry

Generated wrappers call into a shared runtime bridge.

```ts
import { setRuntimeBridge, clearRuntimeBridge } from 'tywrap/runtime';
import { NodeBridge } from 'tywrap/node';

const bridge = new NodeBridge({ pythonPath: 'python3' });
setRuntimeBridge(bridge);

// later
clearRuntimeBridge();
```

## Runtime Bridges

tywrap does not create bridges from config for you. Your application constructs
one explicitly.

### `NodeBridge`

`NodeBridge` runs Python in a subprocess and is the default bridge for Node.js,
Bun, and local Deno.

```ts
import { NodeBridge } from 'tywrap/node';

const bridge = new NodeBridge({
  pythonPath: 'python3',
  virtualEnv: './venv',
  timeoutMs: 30000,
});

const result = await bridge.call('math', 'sqrt', [16]);
const info = await bridge.getBridgeInfo({ refresh: true });
```

| Option                    | Default         | Notes                                           |
| ------------------------- | --------------- | ----------------------------------------------- |
| `pythonPath`              | auto-detect     | Python executable                               |
| `scriptPath`              | built-in bridge | Custom `python_bridge.py`                       |
| `virtualEnv`              | —               | Virtual environment root                        |
| `cwd`                     | `process.cwd()` | Subprocess working directory                    |
| `timeoutMs`               | `30000`         | Per-call timeout                                |
| `queueTimeoutMs`          | `30000`         | Wait time when the worker pool is saturated     |
| `minProcesses`            | `1`             | Minimum worker count                            |
| `maxProcesses`            | `1`             | Maximum worker count                            |
| `maxConcurrentPerProcess` | `10`            | Concurrent requests per worker                  |
| `inheritProcessEnv`       | `false`         | Pass full parent env through                    |
| `enableCache`             | `false`         | Cache pure function results                     |
| `env`                     | `{}`            | Extra subprocess env vars                       |
| `codec`                   | —               | `CodecOptions` for validation and byte handling |
| `warmupCommands`          | `[]`            | Per-worker startup calls                        |

Deprecated compatibility fields still exist on the interface: `maxIdleTime`,
`maxRequestsPerProcess`, `enableJsonFallback`, and `maxLineLength`.

### `PyodideBridge`

`PyodideBridge` runs Python in the browser through WebAssembly.

```ts
import { PyodideBridge } from 'tywrap/pyodide';

const bridge = new PyodideBridge({
  indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.28.0/full/',
  packages: ['numpy'],
  timeoutMs: 30000,
});
```

| Option      | Default     | Notes                        |
| ----------- | ----------- | ---------------------------- |
| `indexURL`  | Pyodide CDN | Package index URL            |
| `packages`  | `[]`        | Packages to load during init |
| `timeoutMs` | `30000`     | Default operation timeout    |
| `codec`     | —           | `CodecOptions`               |

### `HttpBridge`

`HttpBridge` sends protocol messages over HTTP POST to a compatible server.

```ts
import { HttpBridge } from 'tywrap/http';

const bridge = new HttpBridge({
  baseURL: 'https://api.example.com/python',
  timeoutMs: 10000,
  headers: { Authorization: 'Bearer token' },
});
```

| Option      | Default  | Notes                   |
| ----------- | -------- | ----------------------- |
| `baseURL`   | required | Server endpoint URL     |
| `headers`   | `{}`     | Extra request headers   |
| `timeoutMs` | `30000`  | Default request timeout |
| `codec`     | —        | `CodecOptions`          |

## HTTP Server Contract

`HttpBridge` sends the same JSON protocol used by the other transports. The
request body is a serialized `ProtocolMessage`, and the server must reply with a
serialized `ProtocolResponse`.

Request shape:

```json
{
  "id": 1,
  "protocol": "tywrap/1",
  "method": "call",
  "params": {
    "module": "math",
    "functionName": "sqrt",
    "args": [16],
    "kwargs": {}
  }
}
```

Success response:

```json
{
  "id": 1,
  "protocol": "tywrap/1",
  "result": 4
}
```

Error response:

```json
{
  "id": 1,
  "protocol": "tywrap/1",
  "error": {
    "type": "ValueError",
    "message": "math domain error",
    "traceback": "..."
  }
}
```

## Codec Utilities

```ts
import {
  autoRegisterArrowDecoder,
  registerArrowDecoder,
  clearArrowDecoder,
  decodeValue,
  decodeValueAsync,
} from 'tywrap';
```

- `autoRegisterArrowDecoder()` tries to load `apache-arrow` and register a
  decoder.
- `registerArrowDecoder(fn)` installs a custom Arrow decoder.
- `clearArrowDecoder()` removes the current Arrow decoder.
- `decodeValue()` and `decodeValueAsync()` decode runtime envelopes such as
  ndarray, sparse matrix, torch tensor, and sklearn estimator payloads.

## Error Types

```ts
import {
  BridgeError,
  BridgeCodecError,
  BridgeProtocolError,
  BridgeTimeoutError,
  BridgeDisposedError,
  BridgeExecutionError,
} from 'tywrap';
```

## Key Types

```ts
interface TywrapOptions {
  pythonModules: Record<string, PythonModuleConfig>;
  pythonImportPath?: string[];
  output: OutputConfig;
  runtime: RuntimeConfig;
  performance: PerformanceConfig;
  development: DevelopmentConfig;
  types?: TypeMappingConfig;
  debug?: boolean;
}
```

For the full exported type surface, see `src/index.ts`.
