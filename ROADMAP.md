# Roadmap

This file tracks the near-term release path for `tywrap`. It is the maintainer
view of what is shipping now, what is next, and what is intentionally deferred.

The detailed technical appendix for the scientific data plane lives in
[docs/codec-roadmap.md](./docs/codec-roadmap.md).

## Recently Shipped

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

## Now (0.7.0): the scientific data plane — foundation

The scientific data plane (tracked under #237) makes large numpy/pandas/Arrow
payloads reliable and first-class. It is large, and the roadmap's own rule is
*measure first: benchmarks land before any perf gate*. The headline chunked
transport (#231) is still undesigned. So the theme ships in two releases.

`0.7.0` is the foundation half — everything buildable today with no
wire-protocol design pass:

- measure first: Arrow round-trip, large-payload decode, size-check overhead,
  and pool-throughput benchmarks land against current behavior so 0.8.0's perf
  gates have real baselines
- make Arrow registration frictionless — the JS runtime auto-registers an Arrow
  decoder when `apache-arrow` is present (#232)
- a `TransportCapabilities` descriptor on each backend, reconciled with the
  bridge `meta` report, plus a documented capability matrix across Node,
  Pyodide, and HTTP (#235) — the contract #231 chunking keys off
- capture the dropped Python member categories in `tywrap-ir` (`@classmethod`,
  `@property`, `cached_property` via `inspect.classify_class_attrs`), bump the IR
  schema, and regenerate goldens — the one breaking change
- stabilize the `tywrap/dev` examples with a watch/reload end-to-end smoke (#228)
- fold in the complexity cleanup deferred from 0.6.1 (decompose `generate` and
  `fetchPythonIr`; collapse the cross-bridge `call`/`instantiate` boilerplate)

See [docs/codec-roadmap.md](./docs/codec-roadmap.md) for the deeper technical
plan behind this release theme.

## Next (0.8.0): large-payload transport

The design-then-build half, built on 0.7.0's baselines and capability
descriptor:

- design and add a versioned artifact or chunked transport path so large
  payloads no longer depend on single-line JSONL (#231)
- expand scientific codec validation and set performance gates from the 0.7.0
  baselines (#233)
- harden SciPy, Torch, and Sklearn envelope behavior so supported cases are
  explicit and unsupported cases fail clearly (#234)

## Later

These items are intentionally not part of `0.7.0` or `0.8.0`:

- GPU-native transport such as DLPack or Arrow CUDA
- HTTP server lifecycle management owned by Tywrap
- app-level HMR beyond Tywrap wrapper regeneration and bridge reload
- unsafe default model-serialization paths such as implicit pickle or joblib
- broader runtime surface removals that should wait for a later major-version
  contract pass
