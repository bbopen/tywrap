# Browser Runtime Guide

Run Python in the browser using Pyodide WebAssembly.

## Overview

- WebAssembly Python in the browser
- No server required for execution
- Pre-built packages via Pyodide
- Works well for notebooks, demos, and client-side analysis

## Quick Start

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
      "indexURL": "https://cdn.jsdelivr.net/pyodide/",
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
  indexURL: 'https://cdn.jsdelivr.net/pyodide/',
  packages: ['numpy']
});

setRuntimeBridge(bridge);

const arr = await array([1, 2, 3]);
console.log(arr);
```

## Configuration Options

```ts
interface PyodideBridgeOptions {
  indexURL?: string;
  packages?: string[];
}
```

The `packages` array is loaded during initialization. For additional package
loading, rely on Pyodide directly.

## Data Transport

Arrow envelopes are supported in the browser if you register an Arrow decoder:

```ts
import { registerArrowDecoder } from 'tywrap';

registerArrowDecoder(bytes => bytes);
```

## Build Integration

Run `tywrap generate` during your build and load Pyodide at runtime (CDN or self-hosted).
