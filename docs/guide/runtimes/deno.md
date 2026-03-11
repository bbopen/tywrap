# Deno Runtime Guide

tywrap works with [Deno](https://deno.land/) 1.46+ using the same `NodeBridge` as Node.js. Deno requires the `npm:` prefix for npm imports.

## ⚠️ Deno Deploy Limitation

**Deno Deploy does NOT support subprocess execution.** Because `NodeBridge` spawns a Python subprocess, it cannot run in Deno Deploy.

**Alternatives for Deno Deploy:**
- Use [`PyodideBridge`](/guide/runtimes/browser) — runs Python in-browser via WebAssembly (no subprocess)
- Use [`HttpBridge`](/guide/runtimes/http) — connects to a remote Python server over HTTP

## Installation

```bash
deno add npm:tywrap
pip install tywrap-ir
```

## Basic Setup

```typescript
import { NodeBridge } from 'npm:tywrap';
import { setRuntimeBridge } from 'npm:tywrap/runtime';

setRuntimeBridge(new NodeBridge({
  pythonPath: 'python3',
  timeoutMs: 30000,
}));
```

## Required Permissions

Deno requires explicit permission flags for subprocess execution:

```bash
deno run \
  --allow-run=python3 \
  --allow-read \
  --allow-env \
  your-script.ts
```

| Flag | Reason |
|------|--------|
| `--allow-run=python3` | Spawn the Python subprocess |
| `--allow-read` | Read Python scripts and config files |
| `--allow-env` | Read `TYWRAP_*` and `PATH` environment variables |

## Type Checking

```bash
deno check src/index.ts
```

## Configuration Options

See the [Node.js guide](./node) for the full `NodeBridgeOptions` reference — all options work identically in Deno.

## When to Use Each Bridge in Deno

| Scenario | Bridge | Notes |
|----------|--------|-------|
| Local Deno script | `NodeBridge` | Needs `--allow-run` |
| Deno Deploy | `PyodideBridge` | WebAssembly, no subprocess |
| Deno Deploy + heavy Python libs | `HttpBridge` | Python runs on a separate server |

## Environment Variables

The same `TYWRAP_*` env vars work under Deno. See the [environment variables reference](/reference/env-vars).

## Troubleshooting

**`PermissionDenied: Requires run access to "python3"`** — Add `--allow-run=python3` to your `deno run` command.

**`NotSupported: Subprocess access is not allowed`** — You are running in Deno Deploy. Switch to [`PyodideBridge`](/guide/runtimes/browser) or [`HttpBridge`](/guide/runtimes/http).

See the [Node.js troubleshooting guide](./node) for additional patterns.
