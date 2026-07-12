---
layout: home

---

## Quick Start

```bash
npm install tywrap
pip install tywrap-ir  # Python component for code generation
npx tywrap init
npx tywrap generate
```

`tywrap` and `tywrap-ir` are versioned independently. Install the latest
published release of each package unless you need to pin them explicitly.

```typescript
import { NodeBridge } from 'tywrap/node';
import { setRuntimeBridge } from 'tywrap/runtime';
import * as math from './generated/math.generated.js';

setRuntimeBridge(new NodeBridge({ pythonPath: 'python3' }));
const result = await math.sqrt(16); // 4, typed from the Python annotation
```

## Development Hot Reload

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

Use `reloadNow()` for an explicit rebuild or `close()` to stop watching. Node
gets full hot reload, Pyodide gets manual bridge replacement through
`createBridgeReloader(...)`, and HTTP reload remains external to tywrap.

> Experimental: APIs may change before v1.0.0. See [Releases](https://github.com/bbopen/tywrap/releases) for breaking changes.

> If tywrap saves you time, a ⭐ on [GitHub](https://github.com/bbopen/tywrap) helps others find it.
