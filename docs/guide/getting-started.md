# Getting Started with tywrap

This guide covers installation, basic configuration, and creating your first
TypeScript wrapper for a Python library.

## Prerequisites

- Node.js ≥20.0.0, Bun ≥1.1.0, or Deno ≥1.46.0 (Deno subprocess support is
  experimental and untested in CI)
- Python 3.10+ with target libraries installed
- Basic TypeScript knowledge

## Installation

Choose your preferred package manager:

```bash
# npm
npm install tywrap

# pnpm
pnpm add tywrap

# yarn
yarn add tywrap

# bun
bun add tywrap

# deno
deno add npm:tywrap
```

Install the Python IR extractor in the environment that will run code
generation:

```bash
pip install tywrap-ir
```

`tywrap` and `tywrap-ir` are versioned independently. Install the latest
published release of each package unless you need to pin them explicitly.

## Configuration

Create a `tywrap.config.ts` in your project root (or run `npx tywrap init`):

```ts
import { defineConfig } from 'tywrap';

export default defineConfig({
  pythonModules: {
    math: {
      typeHints: 'strict',
    },
  },
  output: {
    dir: './generated',
    format: 'esm',
    declaration: false,
    sourceMap: false,
  },
  runtime: {
    node: {
      pythonPath: 'python3',
    },
  },
});
```

## Generation

Run the tywrap CLI to generate TypeScript wrappers:

```bash
# Using npx
npx tywrap generate

# Using the CLI directly (if installed globally)
tywrap generate

# Using programmatic API
node -e "import('tywrap').then(async tw => { const cfg = await tw.resolveConfig({ configFile: './tywrap.config.ts' }); await tw.generate(cfg); })"
```

Run `tywrap generate --help` to see all available options and defaults.

The CLI searches for `tywrap.config.ts`, `.mts`, `.js`, `.mjs`, `.cjs`, and
`.json` when `--config` is not provided.

The config file drives code generation. Your application still creates a runtime
bridge with `NodeBridge`, `PyodideBridge`, or `HttpBridge`.

## Usage

After generation, import and use your Python library with full TypeScript
support:

```typescript
// Import the generated wrapper
import { NodeBridge } from 'tywrap/node';
import { setRuntimeBridge } from 'tywrap/runtime';
import * as math from './generated/math.generated.js';

const bridge = new NodeBridge({ pythonPath: 'python3' });
setRuntimeBridge(bridge);

// Types are precise where tywrap can resolve them.
async function example() {
  const result = await math.sqrt(16); // TypeScript knows this returns Promise<number>
  const power = await math.pow(2, 3); // Full autocompletion and type checking

  console.log(`√16 = ${result}`); // 4
  console.log(`2³ = ${power}`); // 8
}

example().catch(console.error);
```

## Runtime return validation

Generated wrappers validate returns at runtime after decoding. If a Python
function returns a value that does not match its annotation, tywrap throws
`BridgeValidationError` with the wrapped call site and received shape. Fix the
Python annotation or function. Use `-> Any` only when that return is
intentionally untyped.

## Custom Module Example

Create a wrapper for a custom Python module:

### Python Module

Create `my_utils.py`:

```python
"""Custom utility functions with type hints."""

def greet(name: str, excited: bool = False) -> str:
    """Generate a greeting message."""
    message = f"Hello, {name}!"
    return message + " 🎉" if excited else message

def calculate_area(width: float, height: float) -> float:
    """Calculate rectangular area."""
    return width * height

def add(a: float, b: float, precision: int = 2) -> float:
    """Add two numbers."""
    return round(a + b, precision)

def multiply(a: float, b: float, precision: int = 2) -> float:
    """Multiply two numbers."""
    return round(a * b, precision)
```

### Configuration

Update your `tywrap.config.ts`:

```json
{
  "pythonImportPath": [],
  "pythonModules": {
    "my_utils": {
      "runtime": "node",
      "typeHints": "strict"
    }
  },
  "output": {
    "dir": "./generated",
    "format": "esm",
    "declaration": true,
    "sourceMap": true
  }
}
```

If `my_utils` is not importable from your current working directory or your
Python environment, add the directory that contains it to `pythonImportPath`:

```json
{
  "pythonImportPath": ["./python"],
  "pythonModules": {
    "my_utils": { "runtime": "node", "typeHints": "strict" }
  }
}
```

### Generate and Import

```bash
npx tywrap generate
```

```typescript
import { NodeBridge } from 'tywrap/node';
import { setRuntimeBridge } from 'tywrap/runtime';
import {
  greet,
  calculate_area,
  add,
  multiply,
} from './generated/my_utils.generated.js';

const bridge = new NodeBridge({ pythonPath: 'python3' });
setRuntimeBridge(bridge);

async function demo() {
  // Function calls with type safety
  const greeting = await greet('World', true);
  console.log(greeting); // "Hello, World! 🎉"

  const area = await calculate_area(10.5, 8.2);
  console.log(`Area: ${area}`); // Area: 86.1

  // Use value-returning module functions instead of live class handles.
  const sum = await add(3.14159, 2.71828, 3);
  const product = await multiply(sum, 2, 3);

  console.log(`Sum: ${sum}`); // Sum: 5.86
  console.log(`Product: ${product}`); // Product: 11.72
}
```

## Runtime Options

### Node.js (Default)

```json
{
  "pythonModules": {
    "numpy": { "runtime": "node" }
  },
  "runtime": {
    "node": {
      "pythonPath": "/usr/local/bin/python3",
      "virtualEnv": "./venv",
      "timeout": 30000
    }
  }
}
```

### Browser (Pyodide)

```json
{
  "pythonModules": {
    "numpy": { "runtime": "pyodide" }
  },
  "runtime": {
    "pyodide": {
      "indexURL": "https://cdn.jsdelivr.net/pyodide/v0.28.0/full/",
      "packages": ["numpy", "scipy"]
    }
  }
}
```

### HTTP API

```json
{
  "pythonModules": {
    "my_api": { "runtime": "http" }
  },
  "runtime": {
    "http": {
      "baseURL": "https://api.example.com/python",
      "timeout": 10000,
      "headers": {
        "Authorization": "Bearer token"
      }
    }
  }
}
```

## Development Workflow (Hot Reload)

Use `tywrap/dev` for development hot reload: wrapper regeneration plus bridge
replacement.

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

For Pyodide, use `createBridgeReloader(...)` from `tywrap/dev` for manual bridge
replacement. For HTTP, restart or redeploy the remote server outside tywrap.

`startNodeWatchSession(...)` watches local package directories as directory
trees and refreshes them when nested directories change. A structured generation
failure leaves the last known good wrappers and bridge live. See
[Watch & Reload](./dev-reload.md) for the reload lifecycle events
and the full failure / recovery contract.

### Build Integration

Run `tywrap generate --check` in CI to ensure generated wrappers are committed
and up to date. Structured generation failures exit with code `1`; out-of-date
generated files exit with code `3`. After upgrading Python dependencies, run
`tywrap generate` to refresh the generated surface.

If you ran `tywrap init` in a Node project, it will also add `tywrap:generate`
and `tywrap:check` scripts to `package.json` (disable with `--no-scripts`).

## Performance Tips

1. Set `"caching": true` to reuse generation IR across rebuilds.
2. Limit `functions` and `classes` when a wrapper needs only part of a module.

`batching` and `compression` are accepted config fields in 0.9.0, but no current
generator or runtime code applies them.

```json
{
  "pythonModules": {
    "numpy": {
      "functions": ["array", "zeros", "ones"],
      "classes": ["ndarray"]
    }
  },
  "performance": {
    "caching": true,
    "batching": false,
    "compression": "none"
  }
}
```

## Common Patterns

### Error Handling

```typescript
try {
  const result = await math.sqrt(-1);
} catch (error) {
  if (error.message.includes('ValueError')) {
    console.error('Invalid input for sqrt');
  }
}
```

### Working with Arrays

```typescript
import { array, zeros } from './generated/numpy.generated.js';

// Assumes setRuntimeBridge(...) has been called during app startup.
// Create arrays with proper typing
const arr = await array([1, 2, 3, 4, 5]);
const empty = await zeros([3, 3]);
```

### Async/Await Best Practices

```typescript
// Good: Handle promises properly
const results = await Promise.all([
  math.sin(Math.PI / 2),
  math.cos(0),
  math.tan(Math.PI / 4),
]);

// Group independent calls with Promise.all
const [sinValue, cosValue, tanValue] = await Promise.all([
  math.sin(Math.PI / 2),
  math.cos(0),
  math.tan(Math.PI / 4),
]);
```

## Next Steps

- [Configuration Guide](/guide/configuration) - Complete configuration reference
- [Runtime Guides](/guide/runtimes/node) - Platform-specific setup
- [Examples](/examples/) - Usage patterns and examples
- [Troubleshooting](/troubleshooting/) - Common issues and solutions

## Support

- [Troubleshooting Guide](/troubleshooting/)
- [GitHub Issues](https://github.com/bbopen/tywrap/issues)
- [GitHub Discussions](https://github.com/bbopen/tywrap/discussions)
