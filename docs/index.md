---
layout: home

---

## Quick Start

```bash
npm install tywrap
pip install tywrap-ir
npx tywrap init
npx tywrap generate
```

```typescript
import { NodeBridge } from 'tywrap/node';
import { setRuntimeBridge } from 'tywrap/runtime';
import * as math from './generated/math.generated.js';

setRuntimeBridge(new NodeBridge({ pythonPath: 'python3' }));
const result = await math.sqrt(16); // 4 — fully typed
```

> ⚠️ **Experimental** — APIs may change before v1.0.0. See [Releases](https://github.com/bbopen/tywrap/releases) for breaking changes.

> If tywrap saves you time, a ⭐ on [GitHub](https://github.com/bbopen/tywrap) helps others find it.
