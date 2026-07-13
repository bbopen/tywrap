# Bun Runtime Guide

tywrap works with [Bun](https://bun.sh/) 1.1+ using the same `NodeBridge` as Node.js. No separate bridge is needed.

## Installation

```bash
bun add tywrap
pip install tywrap-ir
```

## Basic Setup

```typescript
import { NodeBridge } from 'tywrap/node';
import { setRuntimeBridge } from 'tywrap/runtime';

setRuntimeBridge(new NodeBridge({
  pythonPath: 'python3',
  virtualEnv: '.venv',
  timeoutMs: 30000,
}));
```

Both `'tywrap/node'` and `'tywrap'` work on Bun. Use `'tywrap/node'` for smaller bundles through tree-shaking.

## Configuration Options

`NodeBridge` accepts the same options under Bun as under Node.js. See the [Node.js guide](./node) for the full option reference.

Key options:

| Option | Default | Description |
|--------|---------|-------------|
| `pythonPath` | auto-detect | Path to `python3` executable |
| `virtualEnv` | not set | Path to virtual environment directory |
| `timeoutMs` | `30000` | Request timeout in milliseconds |
| `inheritProcessEnv` | `false` | Set `true` to pass full `process.env` to subprocess |

## bunfig.toml

The repository's `bunfig.toml` contains these build and run settings:

```toml
[build]
target = "bun"
format = "esm"
splitting = true
sourcemap = "external"
external = ["pyodide"]

[dev]
hot = true
```

## Running Bun-Specific Tests

```bash
npm run test:bun
```

Or directly:

```bash
LC_ALL=C LANG=C bun run vitest --run test/runtime_bun.test.ts
```

## Virtual Environments

```typescript
setRuntimeBridge(new NodeBridge({
  pythonPath: '.venv/bin/python',
  virtualEnv: '.venv',
}));
```

## Environment Variables

The same `TYWRAP_*` env vars work under Bun. See the [environment variables reference](/reference/env-vars).

## Troubleshooting

`python3: command not found`: set `pythonPath` explicitly or ensure Python is on `PATH`.

For a subprocess timeout, increase `timeoutMs`. Verify `pip install tywrap-ir` ran in the correct environment.

The [Node.js troubleshooting guide](./node) has more patterns that also apply to Bun.
