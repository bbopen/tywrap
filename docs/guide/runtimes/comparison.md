# Runtime Comparison

tywrap supports five runtime configurations. Choose based on your environment.

## Feature Matrix

| Feature                        | Node.js | Bun | Deno (experimental) |  Browser (Pyodide)   |    HTTP     |
| ------------------------------ | :-----: | :-: | :-----------------: | :------------------: | :---------: |
| Python subprocess              | yes    | yes | yes              | no                 | no        |
| Deno Deploy / serverless       | no     | no  | no               | yes                | yes       |
| Apache Arrow transport         | yes    | yes | yes              | yes                | yes       |
| Virtual environment support    | yes    | yes | yes              | no                 | Server-side |
| Process pooling (experimental) | yes    | yes | yes              | no                 | no        |
| Development hot reload         | yes    | no  | no               | Manual bridge reload | External |
| Tested in CI                   | yes    | yes | no (untested)    | yes                | yes       |

## Import Paths

| Runtime                       | Import                                           |
| ----------------------------- | ------------------------------------------------ |
| Node.js                       | `import { NodeBridge } from 'tywrap/node'`       |
| Bun                           | `import { NodeBridge } from 'tywrap/node'`       |
| Deno (experimental, untested) | `import { NodeBridge } from 'npm:tywrap'`        |
| Browser                       | `import { PyodideBridge } from 'tywrap/pyodide'` |
| HTTP                          | `import { HttpBridge } from 'tywrap/http'`       |

## Decision Guide

```
Do you need subprocess-based Python execution?
├── Yes → Does your environment support subprocess?
│   ├── Node.js or Bun → Use NodeBridge (import from 'tywrap/node' or 'tywrap')
│   ├── Deno (experimental, untested) → Use NodeBridge with --allow-run=python3
│   └── Deno Deploy / serverless → Continue ↓
└── No (browser, edge, serverless) →
    ├── Can you load ~50MB WebAssembly? → Use PyodideBridge
    └── Need heavy Python libs or can't load WASM → Use HttpBridge
```

## Bridge Reference

| Bridge          | Export           | Guide                                             |
| --------------- | ---------------- | ------------------------------------------------- |
| `NodeBridge`    | `tywrap/node`    | [Node.js](./node) · [Bun](./bun) · [Deno](./deno) |
| `PyodideBridge` | `tywrap/pyodide` | [Browser](./browser)                              |
| `HttpBridge`    | `tywrap/http`    | [HTTP](./http)                                    |
