# tywrap Vocabulary Standardization (T9)

> The canonical naming table for the big-bang refactor. tywrap was built fast and accumulated invented,
> overlapping, and adjective-heavy names ("vibe-coded vocabulary"). Because the next release breaks
> everything anyway, it is the one cheap moment to standardize on functionally descriptive, conventional
> names — so the open-source community can read the code. Reconciled from an independent `codex exec`
> sounding-board pass ([`codex-audits/vocabulary-cleanup.md`](codex-audits/vocabulary-cleanup.md)); codex's
> suggestions were adopted on the merits (it found the dead `bridge-core.ts` already used the better names).

## The spine: four layers that must NOT share names

The single biggest source of confusion is that four distinct layers borrowed each other's words
(`BridgeCore` vs `BridgeProtocol` vs `Transport` vs `*IO`; `SafeCodec` vs `codec.ts`; `ProtocolEnvelope` vs
`CodecEnvelope`). Lock one word per layer:

| Layer | Canonical word | Responsibility | Conventional analog |
|---|---|---|---|
| **Transport** | `Transport` | Moves bytes/JSONL lines to/from one runtime. No RPC semantics. | gRPC channel, Thrift `TTransport` |
| **RPC client** | `RpcClient` | Owns request-id generation **and** request/response correlation over a Transport. | JSON-RPC client, Thrift `TProtocol` |
| **Bridge** | `*Bridge` | The **public** Python-execution facade adopters use (`NodeBridge`, `HttpBridge`, `PyodideBridge`). | gRPC stub |
| **Codec** | `BridgeCodec` / value-envelope decode | Encodes requests / decodes responses; (de)serializes typed values with size + special-float guards. | protobuf (de)serializer |

A reader who internalizes "Transport moves bytes; RpcClient correlates ids; Bridge is the public facade;
Codec serializes values" can place every symbol. The renames below enforce exactly that.

## Rename table

`PUB` = part of the published API (`package.json#exports`) → renaming is a breaking change (fine: big-bang).
`INT` = internal only.

### Transport layer
| Current | → New | | Why |
|---|---|---|---|
| `ProcessIO` | `SubprocessTransport` | INT | "IO" suffix is non-standard and collides conceptually with `Transport`; this *is* a transport. |
| `HttpIO` | `HttpTransport` | INT | same. |
| `PyodideIO` | `PyodideTransport` | INT | same. |
| `WorkerPool` | `TransportPool` | INT | "Worker" wrongly implies Worker Threads / Web Workers; it pools transport/process slots. |
| `PooledWorker` | `TransportLease` | INT | a leased slot from the pool, not a worker thread. |
| `PooledTransport` | `PooledTransport` *(keep)* | INT | accurate: a `Transport` backed by a `TransportPool`. |
| `Transport` / `TransportOptions` | *(keep)* | PUB→`tywrap/runtime` | already the right word; it's the layer anchor. |
| *(new)* `TransportCapabilities` | **add** | PUB→`tywrap/runtime` | `[TEAM 2026-05-29]` a readonly member on the `Transport` interface: `{ backend: 'subprocess'\|'http'\|'pyodide'; supportsArrow; supportsBinary; supportsChunking; supportsStreaming; maxFrameBytes }`. This is the **compile-time** anchor for the 0.5.0 capability matrix (#235), reconciled at runtime with `BridgeInfo` via `RpcClient.capabilities()`. Chunked transport (#231) framing lives in `RpcClient`, gated by `transport.capabilities()`. See [`04-bridge-architecture-decision.md`](04-bridge-architecture-decision.md). |

### RPC / protocol layer
> **Finalized 2026-05-29 by the bridge-architecture team** (see `04-bridge-architecture-decision.md`): bridges
> **hold** the `RpcClient` via composition (they do NOT extend a protocol base). The `BoundedContext` split into
> `DisposableBase` + `PythonRuntime` is the keystone that removes the leaked RPC throwing-stubs in **three**
> files (`process-io.ts`, `pooled-transport.ts`, `worker-pool.ts`). This confirms the table below — no new names.
| Current | → New | | Why |
|---|---|---|---|
| `BridgeProtocol` + `BridgeCore` | **`RpcClient`** | INT | one authoritative correlated-RPC client (§6 of hardened review). `bridge-core.ts` is dead but already uses the better names — harvest then delete. codex preferred `RpcClient` over `ProtocolClient`: it owns ids/pending/correlation, not "protocol" abstractly. |
| `ProtocolMessage` / `ProtocolResponse` | `RpcRequest` / `RpcResponse` | PUB→`tywrap/runtime` | JSON-RPC's own vocabulary; `bridge-core.ts:7` already defines `RpcRequest`/`RpcResponse`. |
| `isProtocolMessage` / `isProtocolResponse` | `isRpcRequest` / `isRpcResponse` | PUB→`tywrap/runtime` | follow the type rename. |
| `PROTOCOL_ID` | `PROTOCOL_ID` *(keep)* | INT→`tywrap/runtime` | good; consolidate into one protocol module with the version. |
| `TYWRAP_PROTOCOL`, `TYWRAP_PROTOCOL_VERSION` | **delete** → `PROTOCOL_VERSION` | INT | dead duplicates; keep a single `PROTOCOL_VERSION` next to `PROTOCOL_ID`. Align with Python `PROTOCOL`/`PROTOCOL_VERSION`. |
| `RuntimeExecution` (contract) | `PythonRuntime` | INT | the `call`/`instantiate`/`callMethod`/`disposeInstance` contract — name it for what it abstracts. |
| `BoundedContext` | `DisposableBase` (+ split out `PythonRuntime`) | INT | "bounded" is meaningless; the base is a disposable lifecycle. It is *wrongly* coupled to the RPC contract today (transports ship fake bridge methods) — split per hardened-review B7. |
| `BridgeInfo.bridge: 'python-subprocess'` | `BridgeInfo.backend: 'subprocess'\|'http'\|'pyodide'` | PUB | the field is too narrow and only validated as subprocess; `backend` with an enum is honest. |

### Codec / value layer
| Current | → New | | Why |
|---|---|---|---|
| `SafeCodec` | `BridgeCodec` | PUB→`tywrap/runtime` | drop the vibe-adjective "safe"; "Bridge" ties it to `BridgeCodecError`. **Not** bare `Codec` (collides with `utils/codec.ts` value decoding). Rename Python `runtime/safe_codec.py` `SafeCodec` coherently. |
| `CodecOptions` | `BridgeCodecOptions` | PUB→`tywrap/runtime` | follow. |
| `ProtocolEnvelope` (the `{id,result\|error}` wrapper) | use `RpcResponse` | INT | it *is* the RPC response; stop calling it an envelope. |
| `CodecEnvelope` (the `{__tywrap__:…}` typed value) | `ValueEnvelope` | INT | reserve "envelope" for the **value** wrapper only. |
| `marker` (the `__tywrap__` string) | `typeTag` | INT | it's a type discriminant; "marker" is vague. (Wire key `__tywrap__` stays — it's the cross-language contract.) |
| `decodeEnvelopeCore`, `decodeResponseEnvelope`, `extractResultFromResponseEnvelope` | align to `decodeValueEnvelope` / `decodeRpcResponse` | INT | name by which envelope they handle. Add the additive `decodeProtocolResponse(payload,{expectedId,arrow})` as `decodeRpcResponse`. |

### Caching / analysis / entry points
| Current | → New | | Why |
|---|---|---|---|
| `IntelligentCache` | `ArtifactCache` | INT | drop "intelligent"; it's a disk-backed TTL/artifact cache (**not** an LRU). |
| `globalCache` | `defaultCache` | INT | "default" reads better than "global" for an overridable singleton. |
| `ValidationEngine` | **delete** (dead) | INT | dead code (deleted in T3); if any part survives, `IrValidator`, not "engine". |
| `getRuntimeBridge` / `setRuntimeBridge` / `clearRuntimeBridge` | `getDefaultBridge` / `setDefaultBridge` / `clearDefaultBridge` | PUB→`tywrap/runtime` | they manage the *default* bridge singleton generated code uses; "default" is precise. (Generated wrappers import these → regenerate in the big-bang.) |
| `getBestPythonRuntime` | `selectDefaultRuntimeStrategy` | INT | "best" is subjective; it *selects a strategy* (returns `'node'` for Deno/Bun subprocess too). |
| `fetchPythonIr` | `runIrExtractor` | INT | it shells out to `python -m tywrap_ir`, it doesn't fetch over a network. |
| `tywrap()` factory | demote → `createGeneratorContext` (or make internal) | PUB | vestigial bag of mapper/generator; `generate()` is the real entry point. |
| `RuntimeBridge` (deprecated), `OptimizedNodeBridge` (dead) | **delete** | PUB/INT | deprecated alias + dead re-export; no replacement. |

## Cross-language coherence (do not skip)

Every renamed concept that crosses the JS↔Python boundary must move on **both** sides in the same change, or
the comments charter's "document contracts at both ends" principle is violated by drift:
- `SafeCodec` → `BridgeCodec` in **both** `src/runtime/safe-codec.ts` and `runtime/safe_codec.py`.
- `PROTOCOL_ID` / `PROTOCOL_VERSION` identical names in `src/runtime/transport.ts` and `runtime/python_bridge.py`.
- The wire keys themselves (`__tywrap__`, the `{id, protocol, method, params}` / `{id, result|error}` line
  shapes) **stay** — they are the actual on-the-wire contract; only the *code identifiers* change.

## How T9 sequences and ties in

- **When:** as **step 3** of the single release (see `02-refactor-plan.md` §4) — after T1 curates the public
  surface (so we rename the *real* surface, not dead exports) and as the spine for T5's `RpcClient`. Doing it
  inside the big-bang means **one** rename pass touching public API, not two.
- **How (mechanically):** rename via the type-checker, one layer at a time (Transport → RPC → Codec → cache/
  entry), `npm run typecheck` green after each; regenerate all wrappers + goldens once (folds into T3's
  re-bless); `grep` the retired names to zero as a release gate.
- **Comments charter link:** this glossary becomes the vocabulary section of the planned `docs/dev/architecture.md`
  (hardened-review §7). The four-layer model is the map newcomers read first; every layer's header
  doc-comment states its one word and what it does **not** do.
