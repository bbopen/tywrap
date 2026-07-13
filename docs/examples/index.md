# Examples

Copy-pasteable examples for using tywrap with the supported runtimes.

## Generate Wrappers

Create `tywrap.config.ts`:

```ts
import { defineConfig } from 'tywrap';

export default defineConfig({
  pythonModules: {
    math: { typeHints: 'strict' },
    collections: { typeHints: 'strict' },
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

## Value-returning APIs

v0.9 generated wrappers do not keep live Python class instances. Expose an
operation as a value-returning module function instead:

```ts
import { median } from './generated/statistics.generated.js';

console.log(await median([1, 2, 2])); // 2
```

## More Docs

- [Getting started](/guide/getting-started)
- [Configuration](/guide/configuration)
- [Node runtime](/guide/runtimes/node)
- [Browser runtime](/guide/runtimes/browser)
- [Troubleshooting](/troubleshooting/)
- [Type mapping](/reference/type-mapping)
