# Roadmap

This file tracks the near-term release path for `tywrap`. It is the maintainer
view of what is shipping now, what is next, and what is intentionally deferred.

The detailed technical appendix for the scientific data plane lives in
[docs/codec-roadmap.md](./docs/codec-roadmap.md).

## Recently Shipped

### v0.9.0: typed value-RPC — the honesty release

`v0.9.0` narrowed tywrap to one job done well: typed value-RPC between
TypeScript and Python (roadmap #260–#270). The stateful instance API is gone
(#264–#266) — a handle lived in one pool worker while calls routed to any
worker, so instance methods silently broke under pooling; generated classes now
expose only static and classmethod members routed through ordinary calls. The
generated types stopped lying (#267): a return tywrap cannot back with a
declaration or a codec is `unknown`, `bytes` maps to `Uint8Array`, `set[T]` to
`T[]`. Decoded returns are validated against the declared type at runtime, with
`BridgeValidationError` carrying the declared type, received shape, and call
site (#268). The IR is a pinned, versioned contract (#269): generation writes a
byte-stable `<module>.contract.json`, `generate --check` catches drift,
`contractInput` regenerates without spawning Python, and `IR_VERSION 0.4.0` is
enforced on both sides. Result caching and request retries are removed, the
subprocess transport stack collapsed from six layers to a merged pool/transport
with atomic restarts, framing negotiation is gone (always-on), and `SECURITY.md`
documents the bridge trust model (#262, #263). Docs claim what the tool does,
not more (#261).

### v0.8.0: large-payload transport

`v0.8.0` is the second half of the scientific data plane (#237). When a request
or response exceeds the single-line JSONL ceiling, the subprocess bridge now
splits it into `tywrap-frame/1` frames and reassembles it byte-for-byte. Framing
is negotiated at startup and additive, so the wire protocol stays `tywrap/1`, a
0.7.x bridge and a 0.8.0 client still talk, and an oversize payload to a bridge
that cannot chunk fails loud. `NodeBridge` enables chunking by default — it
engages only above the frame ceiling, so small-payload traffic is unchanged, and
raising `codec.maxPayloadBytes` is what carries genuinely large results — with
reassembly bounded so a huge payload can't exhaust memory. SciPy/Torch/Sklearn
envelopes now reject unsupported cases explicitly (#234), and a dedicated
`data-plane-perf` CI job gates the chunked paths against the 0.7.0 baselines
(#233). This completes #237.

### v0.7.0: the scientific data plane — foundation

`v0.7.0` is the foundation half of the data plane: measure-first benchmarks that
seed 0.8.0's perf gates, frictionless Arrow auto-registration (#232), a
`TransportCapabilities` descriptor plus a capability matrix across Node, Pyodide,
and HTTP (#235), and capture of the Python member categories the IR used to drop
— `@classmethod`, `@property`, `cached_property` via `inspect.classify_class_attrs`
— which bumped the IR schema to `0.3.0` (the one breaking change; regenerate
wrappers). It also added a `tywrap/dev` watch/reload smoke (#228) and folded in
the complexity cleanup deferred from 0.6.1. The wire protocol was unchanged.

### v0.6.1: maintenance (complexity and dedup)

`v0.6.1` is internal-only — no API, behavior, or wire-protocol changes. It
removed two dead exports, broke the eleven worst complexity hotspots into
smaller output-preserving helpers (cache-key generation, type-hint validation,
the dev watch/reload paths, the subprocess write queue, module discovery, path
and interpreter resolution, an annotation-parser helper), and factored the
duplicated request/response dispatch in the codec and RPC client into one path.
Static-analysis actionable complexity dropped from 14 to 3.

### v0.6.0: one breaking cleanup pass

`v0.6.0` collected the rest of the 0.5.0 refactor plan into a single breaking
release so users take the import and name churn once, before the data plane adds
new surface. The wire protocol did not change, so a 0.5.x client and a 0.6.0
bridge still talk.

- trimmed `src/index.ts` to its real public surface; `SafeCodec` (renamed
  `BridgeCodec`) and the `Transport` contract moved to `tywrap/runtime`
- standardized the runtime vocabulary on the four-layer glossary (`*IO` →
  `*Transport`, `IntelligentCache` → `ArtifactCache`,
  `WorkerPool`/`PooledWorker` → `TransportPool`/`TransportLease`, `marker` →
  `typeTag`); on-the-wire keys unchanged
- stricter per-section config validation; dropped the dead per-module `runtime`
  field (#230)
- the Python bridge blocks private-attribute access by default
  (`TYWRAP_ALLOW_PRIVATE_ATTRS=1` to opt out) and validates module names before
  discovery, closing two escape paths
- single-sourced `VERSION` and `IR_VERSION` with a TS↔Python drift check (#229)
- deleted four dead modules and collapsed the generator's three duplicated
  call-emission paths into one, output byte-preserved

### v0.5.1: install with no native build (Node 25+)

`v0.5.1` removed the dead TypeScript analyzer and the `tree-sitter`,
`tree-sitter-python`, and `web-tree-sitter` packages. That native parser had no
prebuilt binary for newer Node, so `npm install tywrap` broke on Node 25; the
analyzer was unused (code generation runs through the Python `tywrap-ir`
extractor), so deleting it fixes the install with no loss of capability. Closes
the analyzer-removal half of #238; a Node 25 fresh-install CI smoke guards the
regression.

### v0.5.0: bridge composition

`v0.5.0` made the bridges hold an `RpcClient` instead of extending a shared
protocol base. Pyodide now speaks the same wire protocol as the subprocess
bridge — the six scientific markers and `meta` work the same in the browser —
and a cross-backend conformance suite runs every backend against the same cases.
Breaking: `BridgeProtocol` is renamed to `RpcClient`.

### v0.4.0: development hot reload and contract cleanup

`v0.4.0` established the development reload story: `tywrap/dev` as the public
entrypoint, Node watch sessions that regenerate wrappers and swap the active
bridge, and structured generation failures that keep the last known good output
and bridge live.

## Now

The typed value-RPC contract pass (#260) is complete as of `v0.9.0`, and the
scientific data plane (#237) as of `v0.8.0`. The next release theme is not yet
locked; candidates are drawn from **Later** below.

See [docs/codec-roadmap.md](./docs/codec-roadmap.md) for the deeper technical
appendix behind the data-plane work.

## Later

These items are intentionally deferred:

- GPU-native transport such as DLPack or Arrow CUDA
- HTTP server lifecycle management owned by Tywrap
- app-level HMR beyond Tywrap wrapper regeneration and bridge reload
- unsafe default model-serialization paths such as implicit pickle or joblib
