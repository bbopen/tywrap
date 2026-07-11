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

When `output.declaration` is enabled, `generate()` writes matching
`.generated.d.ts` files from the same generic-aware pass as the runtime wrapper
code. Simple `TypeVar` and callable `ParamSpec` declarations are preserved when
tywrap can represent them safely.

`generate()` returns:

```ts
interface GenerateFailure {
  module: string;
  code: 'ir-unavailable';
  message: string;
}

interface GenerateResult {
  written: string[];
  warnings: string[];
  failures: GenerateFailure[];
  outOfDate?: string[];
}
```

`failures` is the structured fatal-generation channel. Compatibility warnings
may still be present in `warnings`, but callers should use `failures` to detect
modules that could not produce IR.

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
| `maxConcurrentPerProcess` | `1`             | Concurrent requests per serial Python worker    |
| `inheritProcessEnv`       | `false`         | Pass full parent env through                    |
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

## Dev Helpers

```ts
import { createBridgeReloader, startNodeWatchSession } from 'tywrap/dev';
```

- `startNodeWatchSession(...)` is the Node-only development hot reload helper
  for wrapper regeneration plus bridge swap.
- `startNodeWatchSession(...)` passes the resolved config for that reload cycle
  into `createBridge(config)`.
- `startNodeWatchSession(...)` watches local package trees by attaching one
  watcher per discovered directory, then refreshing that tree when directories
  are added, removed, or renamed.
- `startNodeWatchSession(...)` keeps the last known good generated output and
  bridge live if a reload hits structured generation failures.
- `createBridgeReloader(...)` is the manual reload primitive for cases like
  Pyodide.
- HTTP server reload remains external to tywrap.

## Key Types

```ts
interface TywrapOptions {
  pythonModules: Record<string, PythonModuleConfig>;
  pythonImportPath?: string[];
  output: OutputConfig;
  runtime: RuntimeConfig;
  performance: PerformanceConfig;
  types?: TypeMappingConfig;
  debug?: boolean;
}
```

For the full exported type surface, see `src/index.ts`.
