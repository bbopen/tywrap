# Bridge Architecture — Final Decision (team + codex)

> **How this was decided.** The maintainer's recollection (BridgeProtocol/Transport is the dead code; BridgeCore
> is the good/intended one — "Hypothesis B") conflicted with a source read ("Hypothesis A"). A team workflow
> settled it: 4 independent investigators (reachability, git history, types/capabilities, over-engineering) +
> an **independent `codex exec` external audit** established ground truth; 3 designers proposed target
> architectures from different philosophies; a decider scored them and ran a **second independent codex
> sparring pass** on the chosen direction. Run `wf_15be3112-f29` · 9 agents · 2 independent codex sessions.
> Raw codex transcripts: [`codex-audits/bridge-team/`](codex-audits/bridge-team/).

---

## 1. The verdict — Hypothesis A, decisively

**`BridgeProtocol`/`Transport` is the LIVE architecture; `BridgeCore` is the dead predecessor.** All five
investigators and both independent codex passes agree, and the git history is the clincher.

- **Live:** BridgeProtocol (src/runtime/bridge-protocol.ts) is the LIVE architecture — ADR-002. It extends BoundedContext (bounded-context.ts:75) and composes SafeCodec + a Transport; all three shipped bridges extend it: NodeBridge (node.ts:306, over a PooledTransport built from ProcessIO), HttpBridge (http.ts:64, over HttpIO), PyodideBridge (pyodide.ts:66, over PyodideIO). It is public API (src/index.ts:19) alongside Transport, ProcessIO, HttpIO, PyodideIO, WorkerPool, PooledTransport, BoundedContext. The real generate() path reaches it: generated wrappers call getRuntimeBridge().call/instantiate/callMethod/disposeInstance (generator.ts:588/894/1107/1112), implemented on BridgeProtocol.
- **Dead:** BridgeCore (src/runtime/bridge-core.ts) is DEAD. Zero production importers at HEAD — the only importer anywhere is its own unit test (test/bridge-core.test.ts:3). Not exported from src/index.ts. Last touched by a maintenance commit (#179, 84562d0). Hypothesis B is FALSE.
- **Smoking gun:** HYPOTHESIS A — decisively. Git chronology is the clincher: BridgeCore landed FIRST (#127 af86fa5 2026-01-19), then ADR-002 BridgeProtocol+Transport+ProcessIO/HttpIO/PyodideIO landed AFTER (a15b6df 2026-01-20), and migration 5405343 (2026-01-21) re-parented all three bridges onto BridgeProtocol IN THE SAME COMMIT that removed BridgeCore from node.ts. So BridgeProtocol is the newer architecture that superseded BridgeCore — the exact inverse of the maintainer's recollection (Hypothesis B). The maintainer was honestly mis-remembering: bridge-core IS the one they could safely deprecate, just for the opposite reason they thought (it's dead because it lost, not because it was the good-but-unwired design). Nuance worth stating to the maintainer plainly so the recollection is corrected, not just overruled.

**On the recollection, plainly:** it was inverted — and understandably so, because `bridge-core` vs
`bridge-protocol` is exactly the kind of name collision that causes this (which is itself a core argument for
the T9 vocabulary cleanup). But the **instinct was right**: the live bridge layer genuinely needs an overhaul.
It is over-engineered (inheritance leaks RPC stubs across *three* files), Node-centric (hardcoded
`bridge==='python-subprocess'`), and Pyodide ships a *second, impoverished* Python server. `BridgeCore` is
safe to delete — just because it *lost the migration*, not because it was the good-but-unwired design.

**Intended path (documented):** The documented forward path is ADR-002: BridgeProtocol composing BoundedContext (lifecycle) + SafeCodec (the 6-marker codec) + Transport (per-backend I/O), with WorkerPool/PooledTransport as Node concurrency policy. ADR-002 was fully implemented (migration 5405343) and the ADR doc deleted only as housekeeping (2f4921a: 'fully implemented and merged'). ROADMAP.md 0.5.0 (lines 46-65) frames the data plane as transport-layer work (chunked transport #231, capability matrix #235) — extending Transport/SafeCodec, never bridge-core. The existing T9 glossary + 03-hardened-review §6 already committed to building one authoritative RpcClient (harvesting bridge-core's correlated-RPC design, then deleting it) and to the *Transport / BridgeCodec / DisposableBase+PythonRuntime renames.

---

## 2. The chosen architecture

**Proposal 1 — 'RpcClient over Transport, three thin Bridge facades' — adopted as the spine, MERGED with Proposal 2's single best primitive: a typed TransportCapabilities descriptor on the Transport interface (the #235 capability matrix made compile-time, not just runtime BridgeInfo). Proposals 2 and 3 (ProtocolCore as a base class bridges EXTEND) are rejected on the inheritance-vs-composition axis: codex confirmed inheritance is 'already lying about the model' (BoundedContext implements RuntimeExecution, leaking the RPC contract onto lifecycle-only classes). Proposal 1's composition model (bridges HOLD an RpcClient that HOLDS a Transport + Codec) is the honest expression of the decision the team already made in 03-hardened-review §6 (one authoritative RpcClient used by bridge dispatch, warmup, and subprocess) and the T9 glossary (RpcClient / BridgeCodec / *Transport / DisposableBase+PythonRuntime). This is not a new direction — it formalizes the already-committed plan. Net: 4 concepts (Transport, Codec=BridgeCodec, RpcClient, Bridge facade), composition not a god-base, exactly one encode/decode/correlation site.**

Three reasons Proposal 1+capabilities wins. (1) ALIGNMENT WITH SETTLED DECISIONS: the existing glossary.md (T9) and 03-hardened-review.md §6 already chose the name RpcClient, already chose to harvest bridge-core's design then delete it, and already chose the *Transport/BridgeCodec/DisposableBase+PythonRuntime renames. Proposals 2/3 reintroduce a 'ProtocolCore base class bridges extend', which re-litigates a question the team closed. (2) THE OVER-ENGINEERING ROOT IS INHERITANCE: BoundedContext implements RuntimeExecution (bounded-context.ts:75) is the single cause of every leaked RPC stub. Codex independently confirmed the leak is in THREE files, not two — process-io.ts:382, pooled-transport.ts:216, AND worker-pool.ts:547 (my upstream writeup missed WorkerPool). Composition (split into DisposableBase lifecycle + a PythonRuntime contract implemented only by bridges) deletes all three stub-sets, PyodideIO's dead 4th client (pyodide-io.ts:376-468), and unifies node.ts's warmup client (561-755) by construction. Keeping the base-class model (Proposal 2/3) keeps the temptation to re-leak. (3) READABILITY: 4 concepts with one word each, zero throwing stubs, one protocol client — the cleanest story for the OSS community, which is a first-class goal. The capability-descriptor merge from Proposal 2 is additive and makes #235 type-enforced per backend, which neither Proposal 1 alone nor Proposal 3 delivered as cleanly. Two upstream corrections survived verification and are folded in: timed-out-request-tracker.ts is KEPT (process-io.ts imports it, not bridge-core-only), and protocol.ts is drained (relocate PROTOCOL_VERSION to transport.ts) not flat-deleted (TYWRAP_PROTOCOL_VERSION is live in bridge-protocol.ts). Codex's decisive add: Pyodide is a SECOND impoverished Python server (no markers, no meta) — server-side parity must be milestone zero, before any rename or chunking, or RpcClient is one clean client talking to inconsistent servers.

```
Four concepts, composition not inheritance. Top calls down only.\n\n  Generated TS wrapper\n        |  .call() / .instantiate() / .callMethod() / .disposeInstance()\n        v\n  Bridge facade (1 per backend): NodeBridge | HttpBridge | PyodideBridge\n    - implements PythonRuntime (the 4 RPC methods), delegating to an owned RpcClient\n    - constructs its Transport + BridgeCodec + RpcClient; owns backend init/dispose\n    - NodeBridge adds caching + pool wiring; Http/Pyodide add only construction\n        |  HOLDS-A (composition)\n        v\n  RpcClient (renamed from BridgeProtocol) — the ONE protocol client\n    - request-id generation + request/response correlation (one pending map)\n    - builds the wire frame {id, protocol, method, params}; version negotiation\n    - timeout / retry / abort (lifecycle via composed DisposableBase)\n    - encode via BridgeCodec -> transport.send(bytes) -> decode via BridgeCodec\n    - chunk-manifest framing for #231 lives HERE, gated by transport.capabilities()\n    - capabilities() = merge(transport.capabilities, python 'meta' report)\n        |                                  |\n        | codec.encode/decode              | transport.send(bytes,timeoutMs,signal)\n        v                                  v\n  BridgeCodec (renamed from SafeCodec)   Transport (interface)\n    - JSON + Arrow + the 6 markers          init/send/isReady/dispose\n      (dataframe, series, ndarray,          + NEW readonly capabilities: TransportCapabilities\n       scipy.sparse, torch.tensor,          { backend:'subprocess'|'http'|'pyodide';\n       sklearn.estimator)                     supportsArrow; supportsBinary;\n    - size guards; stateless after            supportsChunking; supportsStreaming;\n      construction (safe to share)             maxFrameBytes }\n    - pure: bytes <-> values               implemented by:\n                                            SubprocessTransport (was ProcessIO: spawn+stdio JSONL)\n                                            HttpTransport       (was HttpIO: fetch POST)\n                                            PyodideTransport    (was PyodideIO: in-mem runPython)\n                                              |  wrapped (Transport-in/Transport-out)\n                                              v\n                                            PooledTransport -> TransportPool (was WorkerPool; Node policy)\n\n  Cross-cutting base: DisposableBase (renamed from BoundedContext, NO RuntimeExecution)\n    - init/dispose state machine, bounded execute (timeout/retry/abort), resource\n      tracking, validators. Reused by RpcClient and transports. Carries ZERO RPC methods.\n  PythonRuntime contract (renamed from RuntimeExecution) — the 4 RPC methods — implemented\n    ONLY by the bridge facades.\n\n  Layer rule (the whole point): PythonRuntime is implemented in exactly the bridge facades;\n  RpcClient is the one correlation/framing/codec site; transports move bytes + declare\n  capabilities; DisposableBase is pure lifecycle. No class both moves bytes and stubs RPC.\n\n  SERVER side (must reach parity, milestone zero): runtime/python_bridge.py is the reference\n  Python server (6-marker serialize dispatch + handle_meta). Pyodide's inline BOOTSTRAP_PYTHON\n  (pyodide-io.ts:73) is today a SECOND, impoverished server (json.dumps only, no markers, no\n  meta) and must be brought to parity by sharing/porting the dispatcher+codec.
```

---

## 3. Keep / Rename / Deprecate / Delete

### Keep
- Transport interface (transport.ts:137-173) — minimal init/send/isReady/dispose; the correct per-backend seam; EXTEND with readonly capabilities: TransportCapabilities
- The three transport I/O bodies — ProcessIO spawn+stdio JSONL, HttpIO fetch POST, PyodideIO runPython/runPythonAsync (keep the byte-moving logic; strip inherited RPC stubs + dead client)
- BridgeCodec body (SafeCodec) + the 6-marker CodecEnvelope union (utils/codec.ts:43-102) + Arrow/JSON + size guards — orthogonal to transport; data-type growth must not touch Transport
- WorkerPool concurrency logic + PooledTransport wrap-a-Transport adapter — Node multiprocess policy; the wrap pattern is exactly how #231 chunked transport gets added; KEEP, drop their RPC stubs
- BridgeProtocol.sendMessage correct protocol-client body (bridge-protocol.ts:284-308: generateId -> encode -> transport.send -> decode) — becomes the core of RpcClient
- timed-out-request-tracker.ts — CORRECTION: it is NOT bridge-core-only; process-io.ts (LIVE) imports it. KEEP it.
- PROTOCOL_ID 'tywrap/1' (transport.ts:20); relocate TYWRAP_PROTOCOL_VERSION here as PROTOCOL_VERSION so id+version live together
- disposable.ts (Disposable interface + helpers) — the right lifecycle primitive; DisposableBase and Transport build on it
- The capability/meta surface BridgeInfo + getBridgeInfo + Python handle_meta (types/index.ts, bridge-protocol.ts:465, python_bridge.py:752) — KEEP as the runtime report; de-Node-ify (backend enum) and reconcile with the compile-time TransportCapabilities
- RuntimeExecution contract shape (call/instantiate/callMethod/disposeInstance) — KEEP the API; only change WHO implements it (bridge facades, via PythonRuntime) and rename it
- Generated-code call sites (generator.ts:588/894/1107/1112) and the public RPC method names — KEEP exactly; they delegate from Bridge facade to RpcClient
- runtime/python_bridge.py reference server (6-marker serialize + handle_meta) — KEEP as the protocol source of truth; the wire ('tywrap/1', JSONL shapes) does NOT change

### Rename (ties to the T9 glossary)
- BridgeProtocol -> RpcClient (bridge-protocol.ts -> rpc-client.ts). No longer a base class bridges extend; bridges HOLD one. The name says request/response RPC client, the one correlation/framing site.
- SafeCodec -> BridgeCodec (safe-codec.ts -> codec.ts in runtime/; rename Python runtime/safe_codec.py SafeCodec in lockstep). Drop the vibe-adjective 'safe'; not bare 'Codec' (collides with utils/codec.ts value decoding).
- ProcessIO -> SubprocessTransport (process-io.ts -> subprocess-transport.ts). The '-IO' suffix is non-standard and collides with Transport; this IS a transport.
- HttpIO -> HttpTransport (http-io.ts -> http-transport.ts). Already implements Transport with no stubs; rename + add capabilities().
- PyodideIO -> PyodideTransport (pyodide-io.ts -> pyodide-transport.ts). Delete its dead 4th protocol client; add server-side meta + marker parity to BOOTSTRAP_PYTHON.
- BoundedContext -> DisposableBase, AND remove `implements RuntimeExecution`; split the RPC contract out into PythonRuntime (bounded-context.ts -> disposable-base.ts). The keystone decoupling — name signals lifecycle/resource only.
- RuntimeExecution -> PythonRuntime (the call/instantiate/callMethod/disposeInstance contract; types/index.ts:428). Name it for what it abstracts; implemented only by bridge facades.
- WorkerPool -> TransportPool; PooledWorker -> TransportLease. 'Worker' wrongly implies Worker Threads / Web Workers; it pools transport/process slots.
- BridgeInfo.bridge: 'python-subprocess' -> BridgeInfo.backend: 'subprocess' | 'http' | 'pyodide' (types/index.ts:370) and relax the hard-coded validator (bridge-protocol.ts:99). The Node-centric assumption; prerequisite for the #235 matrix across all three backends.
- ProtocolMessage/ProtocolResponse -> RpcRequest/RpcResponse; isProtocolMessage/isProtocolResponse -> isRpcRequest/isRpcResponse (JSON-RPC vocabulary; bridge-core.ts already used RpcRequest/RpcResponse — harvest the names then delete the file).
- CodecEnvelope (the {__tywrap__:...} typed value) -> ValueEnvelope; reserve 'envelope' for the value wrapper; the {id,result|error} wrapper IS RpcResponse, stop calling it an envelope.

### Deprecate
- @deprecated RuntimeBridge re-export in src/index.ts (line 66-68) — points at base.ts; remove the export before/with deleting base.ts
- @deprecated NodeBridge legacy options (node.ts:85-100) — drop in the breaking release; emit no compat shim
- The runtime BridgeInfo flag bag (arrowAvailable/scipyAvailable/torchAvailable/sklearnAvailable/codecFallback) is not deleted but is SUPERSEDED as the source of truth by the compile-time TransportCapabilities descriptor; keep BridgeInfo as the runtime-reported view and reconcile the two in RpcClient.capabilities() (do not let them drift)

### Delete
- src/runtime/bridge-core.ts + test/bridge-core.test.ts — dead predecessor, zero production importers; harvest its correlated-RPC design (id gen, pending map, response-id validation, line buffering) into RpcClient FIRST, then delete
- src/runtime/base.ts (RuntimeBridge) — @deprecated shim ('Use BoundedContext instead'); a major break removes it (and its target BoundedContext is itself being split, so the deprecation is moot)
- src/runtime/optimized-node.ts — @deprecated re-export shim ('Import from ./node.js'); fold optimized-node.test.ts coverage into runtime_node first (it tests the LIVE NodeBridge)
- The leaked RPC stubs in THREE files (CORRECTION: not two): process-io.ts:382-419, pooled-transport.ts:216-260, AND worker-pool.ts:547-590 — removed for free once DisposableBase stops implementing RuntimeExecution
- PyodideIO's dead 4th protocol client (pyodide-io.ts:376-468: call/instantiate/callMethod/disposeInstance + its own generateId/parseResponse) — never reached; PyodideBridge goes through RpcClient
- node.ts hand-rolled warmup protocol client (generateWarmupId/sendWarmupRequest/executeWorkerCall + module-global warmupRequestId, node.ts:561-755) — route warmup through one per-worker RpcClient send path
- src/runtime/protocol.ts — DRAIN then delete: TYWRAP_PROTOCOL string == PROTOCOL_ID ('tywrap/1'), redundant; relocate the still-live numeric TYWRAP_PROTOCOL_VERSION to transport.ts as PROTOCOL_VERSION first (bridge-protocol.ts:24/92/163 consume it), then delete. The wire does NOT change.
- DO NOT DELETE timed-out-request-tracker.ts — CORRECTION to the upstream investigation: process-io.ts (LIVE) imports it, so it is NOT bridge-core-only; it must be kept (listed here so the plan does not mistakenly cut it)

---

## 4. Milestone zero — Pyodide server parity (codex's biggest-risk finding)

Before any rename or deletion: **`pyodide-io.ts` `BOOTSTRAP_PYTHON` is a second, impoverished Python server.**
It does `json.dumps` only — no `__tywrap__` marker serialization, no `meta` branch — while
`runtime/python_bridge.py` has the full 6-marker serialize + `handle_meta`. If only the JS client is unified,
the protocol still diverges underneath (capabilities, scientific markers). So **T5.0 Pyodide protocol parity is
the first refactor milestone**: port/share `python_bridge.py`'s dispatcher+codec into the bootstrap so Pyodide
can return all 6 markers and answer `meta`.

**De-risk gate (release precondition for the whole bridge refactor):** a **cross-backend protocol conformance
suite** — node × pyodide × http, each over inline JSON, Arrow, all 6 markers, oversized-payload failure,
cancellation, Python errors, and `capabilities()` output — must be green **before** any rename or deletion,
and the refactor proceeds behind it. This is the load-bearing safety net for the invisible-wire-compat risk.

---

## 5. codex's independent voice

codex was consulted twice, independently (clean sessions, neutral framing), per the maintainer's instruction.

**Audit (investigation):** confirmed Hypothesis A from its own reachability + git walk, and surfaced that the
live ADR-002 layer is *not* clean — Node-centric assumptions + the Pyodide-second-server problem. Full text:
[`codex-audits/bridge-team/00-codex-architecture-audit.md`](codex-audits/bridge-team/00-codex-architecture-audit.md).

**Sparring (on the decision):**

> Codex ran (high effort, read-only) and did NOT rubber-stamp; it independently re-walked the code. Verbatim-ish: "Yes, composition is the right call. Not because it saves boilerplate, but because inheritance is already lying about the model. BoundedContext implements RuntimeExecution and forces protocol methods onto lifecycle-only things (bounded-context.ts:75, :577). That leak creates fake runtime methods in transports (process-io.ts:382, pooled-transport.ts:216) and also in WorkerPool, which your writeup missed (worker-pool.ts:547). Meanwhile generated wrappers only need the four runtime methods (generator.ts:588/894/1107), so a facade delegating to an owned client is clean enough. Git history also supports this: BridgeCore was introduced in af86fa5, then superseded by ADR-002 in a15b6df and migration 5405343." Biggest unflagged risk (codex): "Pyodide is not merely missing meta; it is a second Python server implementation hidden inside a 'transport.' The inline bootstrap imports only json and importlib (pyodide-io.ts:73), hand-dispatches call/instantiate/call_method/dispose_instance with no meta branch (:131), and returns raw json.dumps(result) (:170). The subprocess bridge has real handle_meta() and routes meta through dispatch_request() (python_bridge.py:752, :823). If you only unify the JS client, protocol behavior can still diverge underneath, especially for capabilities and scientific marker serialization." The ONE thing codex would change: "make Pyodide server-side protocol parity the FIRST refactor milestone. Either share/extract the Python dispatcher/codec path or prove Pyodide matches it in the conformance suite before doing renames/chunking. Otherwise RpcClient becomes a neat single client talking to inconsistent servers." WEIGHING (not auto-deferring): both codex corrections were verified directly — WorkerPool does extend BoundedContext (worker-pool.ts:108) and stub 4 RPC methods (:547-590), and Pyodide's BOOTSTRAP_PYTHON does return marker-less json.dumps with no meta. Both are accepted and folded into planChanges (three-file stub inventory; new T5.0 Pyodide-parity milestone-zero). Codex's endorsement of composition over inheritance is accepted on the merits and directly settles the Proposal-1-vs-2/3 axis.

Full text: [`codex-audits/bridge-team/01-codex-decision-sparring.md`](codex-audits/bridge-team/01-codex-decision-sparring.md).

---

## 6. Open questions for the maintainer

1. Pyodide server parity scope: port python_bridge.py's dispatcher+codec wholesale into BOOTSTRAP_PYTHON, OR factor a shared pure-Python module both servers import? In-WASM has no subprocess and a different I/O model (in-memory runPython vs stdin/stdout JSONL), so a shared module is cleaner but must be Pyodide-loadable. Decide before T5.0.
2. Does Pyodide support Arrow at all in-WASM (pyarrow availability)? If not, PyodideTransport declares supportsArrow:false and BridgeCodec must JSON-fallback the 6 markers there — confirm the JSON-fallback path exists for every marker (ndarray has serialize_ndarray_json; verify dataframe/series/scipy/torch/sklearn have JSON fallbacks too).
3. Warmup re-routing under the pool: warmup runs in WorkerPool.onWorkerReady before the pool is wired into RpcClient. Use a per-worker RpcClient bound to one transport, or defer warmup to post-wiring? Either works; pick the one that preserves current startup-latency and request-id uniqueness under concurrency.
4. ~~Version label for the breaking release.~~ **RESOLVED 2026-05-29: `0.5.0`.** The data plane (#237) shifts to `0.6.0`; `ROADMAP.md` needs that relabel at execution time. The architecture decision itself is label-agnostic.
5. Should TransportCapabilities.maxFrameBytes / supportsChunking be wired into RpcClient's chunking path now (#231) or declared-but-unused in this release and consumed in the follow-on data-plane workstream? The descriptor should ship now (cheap, type-enforced); the chunking consumer can follow, but the conformance suite should at least assert capabilities() output now.

---

## 7. What changed in the plan

This decision is folded into the other docs (see each file's marked edits):

1. **02-refactor-plan.md** — In §4 step 4 (T5 runtime-transport) and §5 T5: re-scope from 'BridgeProtocol.dispatch + SafeCodec-owned id-correlation' to the composition target — RpcClient as the one protocol client that bridges HOLD (not extend), produced by splitting BoundedContext into DisposableBase (lifecycle) + PythonRuntime (the 4-method contract, implemented only by bridge facades). State that this split is what removes the leaked RPC stubs by construction. The plan's §5 T5 currently DEFERS the BoundedContext/RuntimeExecution split as a 'separate follow-up (review B7)' — that deferral is now REVERSED: the split is the core of T5, not a follow-up.

2. **02-refactor-plan.md** — Add a NEW milestone-zero before any rename/delete: 'T5.0 Pyodide server protocol parity'. pyodide-io.ts BOOTSTRAP_PYTHON (pyodide-io.ts:73-187) is a second, impoverished Python server — json.dumps with no __tywrap__ marker serialization and no meta branch — vs runtime/python_bridge.py's full 6-marker serialize + handle_meta. Port/share the dispatcher+codec so Pyodide can return all 6 markers and answer meta. Without this, the unified RpcClient is a clean client talking to inconsistent servers (codex's biggest-risk finding). Gate it with the conformance suite's pyodide x 6-markers x capabilities() rows.

3. **02-refactor-plan.md** — In §5 T5 / §6: correct the leaked-RPC-stub inventory — it is THREE files, not two. Add worker-pool.ts:547-590 (WorkerPool extends BoundedContext at :108 and stubs call/instantiate/callMethod/disposeInstance) to the existing process-io.ts and pooled-transport.ts entries. All three stub-sets are deleted by the DisposableBase/PythonRuntime split.

4. **02-refactor-plan.md** — In §5 T2 false-positive ledger / deletion list: change timed-out-request-tracker.ts from a delete candidate to an explicit KEEP — process-io.ts (LIVE) imports it, so it is NOT bridge-core-only. The upstream investigation's 'verify before deleting' resolves to KEEP.

5. **02-refactor-plan.md** — Add the de-risk gate as a release precondition for T5: a cross-backend protocol conformance suite (node x pyodide x http, each over inline JSON, Arrow, all 6 markers, oversized-payload failure, cancellation, Python errors, and capabilities() output) must be green BEFORE any rename or deletion; refactor behind it. This is the load-bearing safety net for the wire-compat risk.

6. **03-hardened-review.md** — In §6 (strategic fork, RESOLVED): record the final shape — the harvested RpcClient is HELD by bridges via composition (not extended), and the BoundedContext->DisposableBase + PythonRuntime split is part of T5, no longer deferred. Note that codex's independent sparring (01-codex-decision-sparring.md) confirmed composition on the merits ('inheritance is already lying about the model') and surfaced two corrections this review missed: WorkerPool also leaks RPC methods (worker-pool.ts:547), and Pyodide is a second Python server (no markers, no meta) needing server-side parity as milestone zero.

7. **03-hardened-review.md** — Add to the §5 risk list: 'Pyodide server-side protocol divergence' — pyodide-io.ts:73 BOOTSTRAP_PYTHON returns raw json.dumps with no marker codec and no meta handler, so Pyodide cannot today return any of the 6 scientific markers or report capabilities. JS-side RpcClient unification does NOT fix it. Mitigation: share/port python_bridge.py's dispatcher+codec into the bootstrap; cover in the conformance suite before renames.

8. **glossary.md** — Add the capability-matrix primitive merged from Proposal 2: a TransportCapabilities descriptor as a readonly member on the Transport interface — { backend: 'subprocess'|'http'|'pyodide'; supportsArrow; supportsBinary; supportsChunking; supportsStreaming; maxFrameBytes }. Note it makes #235 compile-time/type-enforced per backend, reconciled at runtime with BridgeInfo via RpcClient.capabilities(). The glossary already has the RpcClient/BridgeCodec/*Transport/DisposableBase+PythonRuntime/backend-enum rows; this adds the capabilities descriptor as the named #235 anchor and confirms the chosen direction is the formalization of the existing T9 table (no new names introduced).
