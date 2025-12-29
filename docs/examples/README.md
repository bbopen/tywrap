# Examples

Copy-pasteable examples for using tywrap with the supported runtimes.

## Generate Wrappers

Create `tywrap.config.ts`:

```ts
import { defineConfig } from 'tywrap';

export default defineConfig({
  pythonModules: {
    math: { runtime: 'node', typeHints: 'strict' },
    collections: { runtime: 'node', typeHints: 'strict' },
  },
  output: {
    dir: './generated',
    format: 'esm',
    declaration: true,
    sourceMap: true,
  },
});
```

Generate:

```sh
npx tywrap generate
```

## Node.js Runtime

```ts
import { NodeBridge } from 'tywrap/node';
import { setRuntimeBridge } from 'tywrap/runtime';

setRuntimeBridge(new NodeBridge({ pythonPath: 'python3' }));

import { sqrt } from './generated/math.generated.js';
console.log(await sqrt(16));
```

## Browser Runtime (Pyodide)

```ts
import { PyodideBridge } from 'tywrap/pyodide';
import { setRuntimeBridge } from 'tywrap/runtime';

setRuntimeBridge(
  new PyodideBridge({
    indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.28.0/full/',
  })
);

import { sin, pi } from './generated/math.generated.js';
console.log(await sin(pi / 4));
```

## Generated Classes

Generated classes have an async `create(...)` constructor and an explicit `disposeHandle()`:

```ts
import { Counter } from './generated/collections.generated.js';

const counter = await Counter.create([1, 2, 2]);
console.log(await counter.mostCommon(1));
await counter.disposeHandle();
```

## More Docs

- [Getting started](../getting-started.md)
- [Configuration](../configuration.md)
- [Node runtime](../runtimes/nodejs.md)
- [Browser runtime](../runtimes/browser.md)
- [Troubleshooting](../troubleshooting/README.md)
- [Type mapping](../type-mapping-matrix.md)
