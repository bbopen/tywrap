# API Reference

Public API for tywrap’s programmatic interface and CLI.

## Core API

### `tywrap(options?: Partial<TywrapOptions>): Promise<TywrapInstance>`

Creates a tywrap instance (advanced use).

```ts
import { tywrap } from 'tywrap';

const instance = await tywrap({
  pythonModules: { math: { runtime: 'node', typeHints: 'strict' } },
});
```

### `generate(options: Partial<TywrapOptions>)`

Generates wrappers from configuration.

```ts
import { generate } from 'tywrap';

await generate({
  pythonModules: { math: { runtime: 'node', typeHints: 'strict' } },
  output: {
    dir: './generated',
    format: 'esm',
    declaration: false,
    sourceMap: false,
  },
});
```

Returns:

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

`failures` is the structured fatal-generation channel. A result may still carry
human-readable warning strings for compatibility, but callers should use
`failures` to detect modules that could not produce IR.

### `defineConfig(config: TywrapConfig)`

Type-safe helper for config files.

```ts
import { defineConfig } from 'tywrap';

export default defineConfig({
  pythonModules: { math: { runtime: 'node', typeHints: 'strict' } },
});
```

### `resolveConfig({ configFile, overrides, requireConfig })`

Loads a config file (JSON/JS/TS) and merges defaults with overrides.

```ts
import { resolveConfig } from 'tywrap';

const config = await resolveConfig({
  configFile: './tywrap.config.ts',
  overrides: { debug: true },
});
```

## Runtime Registry

Generated wrappers call into a shared runtime bridge:

```ts
import { setRuntimeBridge } from 'tywrap/runtime';
import { NodeBridge } from 'tywrap/node';

const bridge = new NodeBridge({ pythonPath: 'python3' });
setRuntimeBridge(bridge);
```

## Runtime Bridges

### `NodeBridge`

Python subprocess bridge for Node.js.

NodeBridge is the public Node.js bridge. Process pooling and related throughput
controls are configured on `NodeBridge` directly.

```ts
import { NodeBridge } from 'tywrap/node';

const bridge = new NodeBridge({
  pythonPath: '/usr/bin/python3',
  virtualEnv: './venv',
});

const result = await bridge.call('math', 'sqrt', [16]);
const info = await bridge.getBridgeInfo({ refresh: true });
```

**Options**:

```ts
interface NodeBridgeOptions {
  pythonPath?: string;
  scriptPath?: string;
  virtualEnv?: string;
  cwd?: string;
  timeoutMs?: number;
  maxLineLength?: number;
  inheritProcessEnv?: boolean;
  enableJsonFallback?: boolean;
  env?: Record<string, string | undefined>;
}
```

### `PyodideBridge`

Browser WebAssembly runtime bridge.

```ts
import { PyodideBridge } from 'tywrap/pyodide';

const bridge = new PyodideBridge({
  indexURL: 'https://cdn.jsdelivr.net/pyodide/',
  packages: ['numpy'],
});
```

**Options**:

```ts
interface PyodideBridgeOptions {
  indexURL?: string;
  packages?: string[];
}
```

### `HttpBridge`

HTTP runtime bridge (expects compatible server endpoints).

```ts
import { HttpBridge } from 'tywrap/http';

const bridge = new HttpBridge({
  baseURL: 'https://api.example.com/python',
  timeout: 10000,
  headers: { Authorization: 'Bearer token' },
});
```

**Options**:

```ts
interface HttpBridgeOptions {
  baseURL: string;
  timeout?: number;
  headers?: Record<string, string>;
}
```

## Codec Utilities

```ts
import {
  decodeValue,
  decodeValueAsync,
  autoRegisterArrowDecoder,
  registerArrowDecoder,
  clearArrowDecoder,
} from 'tywrap';

// NodeBridge auto-registers when apache-arrow is installed.
// If you're decoding outside the bridge, call autoRegisterArrowDecoder() or register manually:
const arrowReady = await autoRegisterArrowDecoder();
// if (!arrowReady) throw new Error('Install apache-arrow or enable JSON fallback');
// registerArrowDecoder(bytes => bytes);

const value = await decodeValueAsync(pythonValue);
```

Arrow-encoded payloads throw unless a decoder is registered or JSON fallback is
enabled on the Python bridge.

## Error Types

```ts
import {
  BridgeError,
  BridgeProtocolError,
  BridgeTimeoutError,
  BridgeDisposedError,
  BridgeExecutionError,
} from 'tywrap';
```

Use these to differentiate protocol issues from Python execution failures.

## Key Types

```ts
interface TywrapOptions {
  pythonModules: Record<string, PythonModuleConfig>;
  output: OutputConfig;
  runtime: RuntimeConfig;
  performance: PerformanceConfig;
  debug?: boolean;
}
```

For the full type surface, refer to `src/types/index.ts`.

## Dev Helpers

```ts
import { createBridgeReloader, startNodeWatchSession } from 'tywrap/dev';
```

- `startNodeWatchSession(...)` is the Node-only helper for wrapper regeneration
  plus bridge swap.
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

## CLI API

```bash
tywrap init [options]
tywrap generate [options]
tywrap --version
```

### `tywrap init`

- `--format ts|json`
- `--modules "math,numpy"`
- `--runtime node|pyodide|http|auto`
- `--output-dir ./generated`
- `--force`

### `tywrap generate`

- `--config ./tywrap.config.ts`
- `--modules "math,numpy"`
- `--runtime node|pyodide|http|auto`
- `--python /usr/bin/python3`
- `--output-dir ./generated`
- `--format esm|cjs|both`
- `--declaration`
- `--source-map`
- `--cache/--no-cache`
- `--debug`
- `--fail-on-warn`
