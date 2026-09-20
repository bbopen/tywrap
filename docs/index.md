---
layout: home

---

## Try it

Install the TypeScript package and Python generator. Then create a config and
generate wrappers for the Python modules you want to call.

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
const result = await math.sqrt(16); // 4
```

See the [getting started guide](/guide/getting-started) to configure your own
Python module and choose a runtime bridge.

> Experimental: APIs may change before v1.0.0. See [Releases](https://github.com/bbopen/tywrap/releases) for breaking changes.
