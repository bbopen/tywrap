---
layout: home

hero:
  name: tywrap
  text: TypeScript wrappers for Python libraries
  tagline: Auto-generate type-safe TypeScript bindings for any Python library — works in Node.js, Bun, Deno, and browsers via Pyodide.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/bbopen/tywrap

features:
  - icon: 🔒
    title: Full Type Safety
    details: TypeScript definitions generated directly from Python source analysis via AST — no manual type writing.
  - icon: 🌐
    title: Multi-Runtime
    details: One API across Node.js, Bun, Deno (subprocess), and browsers (Pyodide WebAssembly).
  - icon: ⚡
    title: Rich Data Types
    details: First-class support for numpy, pandas, scipy, torch, and sklearn with Apache Arrow binary transport.
  - icon: 🛠
    title: Zero-Config CLI
    details: Run `npx tywrap generate` and get production-ready TypeScript wrappers with a single command.
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
