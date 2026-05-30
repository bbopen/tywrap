**(a) Verdict**

Hypothesis A is mostly correct on reachability; Hypothesis B is false. At HEAD `391d247d81ebd45da4fc574278f068bf6fca7818`, all three shipped bridges extend `BridgeProtocol`: `NodeBridge` imports it and extends it, then passes a `PooledTransport` built from `ProcessIO` into `super()` ([src/runtime/node.ts](/Users/brettbonner/tywrap/src/runtime/node.ts:20), [node.ts](/Users/brettbonner/tywrap/src/runtime/node.ts:306), [node.ts](/Users/brettbonner/tywrap/src/runtime/node.ts:352), [node.ts](/Users/brettbonner/tywrap/src/runtime/node.ts:376)); `HttpBridge` extends it over `HttpIO` ([src/runtime/http.ts](/Users/brettbonner/tywrap/src/runtime/http.ts:10), [http.ts](/Users/brettbonner/tywrap/src/runtime/http.ts:64), [http.ts](/Users/brettbonner/tywrap/src/runtime/http.ts:72)); `PyodideBridge` extends it over `PyodideIO` ([src/runtime/pyodide.ts](/Users/brettbonner/tywrap/src/runtime/pyodide.ts:10), [pyodide.ts](/Users/brettbonner/tywrap/src/runtime/pyodide.ts:66), [pyodide.ts](/Users/brettbonner/tywrap/src/runtime/pyodide.ts:74)). `BridgeProtocol` itself composes `BoundedContext`, `SafeCodec`, and `Transport` ([src/runtime/bridge-protocol.ts](/Users/brettbonner/tywrap/src/runtime/bridge-protocol.ts:21), [bridge-protocol.ts](/Users/brettbonner/tywrap/src/runtime/bridge-protocol.ts:228), [bridge-protocol.ts](/Users/brettbonner/tywrap/src/runtime/bridge-protocol.ts:229)) and is public API ([src/index.ts](/Users/brettbonner/tywrap/src/index.ts:18)).

`BridgeCore` is dead production code. At HEAD, repo grep found no production importers outside its own file; the only external importer is its unit test ([test/bridge-core.test.ts](/Users/brettbonner/tywrap/test/bridge-core.test.ts:3)). It is not exported from public API, while `BridgeProtocol`, `Transport`, `ProcessIO`, `HttpIO`, `PyodideIO`, `WorkerPool`, and `PooledTransport` are ([src/index.ts](/Users/brettbonner/tywrap/src/index.ts:18), [src/index.ts](/Users/brettbonner/tywrap/src/index.ts:22), [src/index.ts](/Users/brettbonner/tywrap/src/index.ts:35), [src/index.ts](/Users/brettbonner/tywrap/src/index.ts:39)). Chronology supports this: `af86fa57bff0d2a56253af7f735dce8b26f10141` on 2026-01-19 introduced `BridgeCore` and rewired NodeBridge to it; `a15b6df327bdacd943d28c2ebdb2ac410b00e76e` on 2026-01-20 introduced ADR-002 `BridgeProtocol`, `Transport`, and the `*-io` transports; then `54053431b3e48f1c8b34e9fb550158da25d07886` on 2026-01-21 explicitly migrated `node.ts`, `http.ts`, and `pyodide.ts` onto `BridgeProtocol` and removed Node’s `BridgeCore` worker plumbing. `a4f6c0a9d4e4a669fffd64438a78b2b9abc49378` on 2026-01-20 introduced `BoundedContext`.

The picture is still messier than A. `BridgeProtocol` is live, but not clean: `getBridgeInfo()` is exposed on the common core ([src/runtime/bridge-protocol.ts](/Users/brettbonner/tywrap/src/runtime/bridge-protocol.ts:465)) while its validator hard-codes `bridge === "python-subprocess"` ([bridge-protocol.ts](/Users/brettbonner/tywrap/src/runtime/bridge-protocol.ts:98)) and the public `BridgeInfo` type only permits `'python-subprocess'` ([src/types/index.ts](/Users/brettbonner/tywrap/src/types/index.ts:367)). Pyodide’s embedded dispatcher has no `meta` branch and falls through to unknown method ([src/runtime/pyodide-io.ts](/Users/brettbonner/tywrap/src/runtime/pyodide-io.ts:167)). So the live architecture is ADR-002, but it carries Node-centric assumptions.

**(b) Target Architecture**

Use the ADR-002 shape, but make it honest and versioned:

`Bridge` facade -> `ProtocolCore` -> `Codec` -> `Transport`.

`Transport` should own only connection semantics, streaming/chunk primitives, cancellation, and capability reporting. `Codec` should own JSON/Arrow/scientific envelopes: dataframe, series, ndarray, scipy.sparse, torch.tensor, sklearn.estimator. `ProtocolCore` should own request IDs, method envelopes, version negotiation, chunk manifests, error envelopes, and capability negotiation. `BoundedContext` should remain lifecycle/resource/error scaffolding only. `WorkerPool` is Node execution policy, not protocol.

Chunking belongs between protocol and transport: the protocol defines versioned frame/manifest semantics; each transport declares whether it supports inline JSON, Arrow bytes, chunked frames, artifacts, max frame size, bidirectional streaming, and binary bodies. The roadmap already says 0.5.0 needs versioned artifact/chunked transport and documented transport capabilities ([ROADMAP.md](/Users/brettbonner/tywrap/ROADMAP.md:48), [ROADMAP.md](/Users/brettbonner/tywrap/ROADMAP.md:53), [ROADMAP.md](/Users/brettbonner/tywrap/ROADMAP.md:61)); codec docs already define the six marker family and warn JSONL is not streaming ([docs/codec-roadmap.md](/Users/brettbonner/tywrap/docs/codec-roadmap.md:24), [docs/codec-roadmap.md](/Users/brettbonner/tywrap/docs/codec-roadmap.md:34), [docs/codec-roadmap.md](/Users/brettbonner/tywrap/docs/codec-roadmap.md:40)).

**(c) Action Table**

| File / class | Action | Reason |
|---|---|---|
| `bridge-protocol.ts` / `BridgeProtocol` | RENAME to `protocol-core.ts` / `ProtocolCore` | Live core, but name hides that it is lifecycle + codec + transport orchestration. |
| `bridge-core.ts` / `BridgeCore` | DELETE | Superseded by 2026-01-21 migration; no production importers at HEAD. |
| `transport.ts` / `Transport` | KEEP | Correct abstraction boundary; extend with capabilities/chunk primitives. |
| `bounded-context.ts` / `BoundedContext` | KEEP | Good lifecycle/resource base; do not mix protocol semantics into it. |
| `base.ts` / `RuntimeBridge` | DELETE | Deprecated shim only ([src/runtime/base.ts](/Users/brettbonner/tywrap/src/runtime/base.ts:4)). Major break should remove it. |
| `process-io.ts` / `ProcessIO` | RENAME to `node-process-transport.ts` | Live Node transport; name should say transport/backend. |
| `http-io.ts` / `HttpIO` | RENAME to `http-transport.ts` | Live HTTP transport; add binary/chunk capability declarations. |
| `pyodide-io.ts` / `PyodideIO` | RENAME to `pyodide-transport.ts` | Live Pyodide transport; add `meta`/capabilities parity. |
| `pooled-transport.ts` / `PooledTransport` | KEEP | Live Node adapter used by `NodeBridge` ([src/runtime/node.ts](/Users/brettbonner/tywrap/src/runtime/node.ts:352)). |
| `worker-pool.ts` / `WorkerPool` | KEEP | Useful Node pooling policy; keep out of protocol surface. |
| `safe-codec.ts` / `SafeCodec` | RENAME to `codec.ts` / `RuntimeCodec` | Live and central, but “safe” is vague; it owns envelope validation/Arrow decode. |
| `node.ts` / `NodeBridge` | KEEP | Public facade over process transport + pool. |
| `http.ts` / `HttpBridge` | KEEP | Public facade over HTTP transport. |
| `pyodide.ts` / `PyodideBridge` | KEEP | Public facade over Pyodide transport, but fix capability/meta parity. |

**(d) Biggest Risk**

The biggest risk is breaking invisible wire compatibility while cleaning names. The current system has protocol responsibilities split across `BridgeProtocol`, `SafeCodec`, `ProcessIO`, `runtime/python_bridge.py`, `runtime/safe_codec.py`, and Pyodide bootstrap code; `ProcessIO` already duplicates old `BridgeCore` concerns such as buffering, request correlation, and timeout tracking ([src/runtime/process-io.ts](/Users/brettbonner/tywrap/src/runtime/process-io.ts:180), [process-io.ts](/Users/brettbonner/tywrap/src/runtime/process-io.ts:249)). De-risk it by writing a protocol conformance suite before deleting anything: one matrix covering node/pyodide/http, inline JSON, Arrow envelopes, all six scientific markers, oversized payload failure, chunked payload success, cancellation, Python errors, and `capabilities()` output. Then refactor behind that suite and delete `BridgeCore` only after the suite proves the live path owns the behavior.