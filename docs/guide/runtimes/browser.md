# Browser runtime guide

Run Python in the browser using Pyodide WebAssembly.

## Overview

- WebAssembly Python in the browser
- No server required for execution
- Pre-built packages via Pyodide
- Works well for notebooks, demos, and client-side analysis

## Quick start

### Install

```bash
npm install tywrap pyodide
```

### Configure

```json
{
  "pythonModules": {
    "numpy": { "runtime": "pyodide" },
    "matplotlib": { "runtime": "pyodide" }
  },
  "runtime": {
    "pyodide": {
      "indexURL": "https://cdn.jsdelivr.net/pyodide/v0.28.1/full/",
      "packages": ["numpy", "matplotlib", "scipy"]
    }
  }
}
```

### Use

```ts
import { PyodideBridge } from 'tywrap/pyodide';
import { setRuntimeBridge } from 'tywrap/runtime';
import { array } from './generated/numpy.generated.js';

const bridge = new PyodideBridge({
  indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.28.1/full/',
  packages: ['numpy'],
});

setRuntimeBridge(bridge);

const arr = await array([1, 2, 3]);
console.log(arr);
```

## Configuration options

```ts
interface PyodideBridgeOptions {
  indexURL?: string;
  packages?: string[];
}
```

The bridge loads the `packages` array during initialization. For additional package
loading, rely on Pyodide directly.

## Data transport

PyodideBridge uses JSON transport. It converts supported NumPy arrays and pandas
tables to JSON envelopes. It does not send Arrow payloads.

See [codec envelopes](../../codec-envelopes.md) for supported values and transport limits.

## Build integration

Run `tywrap generate` during your build. Load Pyodide at runtime from a CDN or your own server.

## Test coverage

The unit tests mock the Pyodide loader. The cross-backend suite runs the shared
Python bootstrap under CPython. Neither check proves browser execution.

Required CI also runs the pinned Pyodide package in Node WebAssembly and a
Chromium smoke test. The browser test loads local Pyodide assets and executes a
generated wrapper.
