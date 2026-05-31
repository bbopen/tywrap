# Roadmap

This file tracks the near-term release path for `tywrap`. It is the maintainer
view of what is shipping now, what is next, and what is intentionally deferred.

The detailed technical appendix for the scientific data plane lives in
[docs/codec-roadmap.md](./docs/codec-roadmap.md).

## Recently Shipped

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

## Now (0.6.0): one breaking cleanup pass

This is the rest of the 0.5.0 refactor plan that 0.5.0/0.5.1 did not ship —
collected into a single breaking release so users take the import and name churn
once, before the data plane adds new surface. Pre-1.0 with very few users, the
breaking budget is cheap; spend it here and emerge on clean names.

Internal cleanup (invisible to callers):

- delete the four remaining dead modules (`bundle-optimizer`, `memory-profiler`,
  `optimized-node`, `protocol` — drain its `PROTOCOL_VERSION` into `transport`
  first)
- decompose the live complexity hotspots (`decodeEnvelopeCore`,
  `annotation-parser.parse`, `mapPresetType`, the config dispatches) behind
  output-preserving characterization snapshots
- extract a shared call-emission path in the generator (three near-identical
  copies collapse to one, generated output byte-preserved)
- convert the silent test skips to `it.skipIf` so a missing Python interpreter
  skips loudly instead of passing vacuously
- fix `VERSION` (still reports `0.3.0`) by single-sourcing it from a
  build-generated module

Breaking surface and naming:

- trim `src/index.ts` to its real public surface and move `SafeCodec` plus the
  `Transport` contract to `tywrap/runtime`, locked by a type-level surface test
- standardize the runtime vocabulary on the four-layer glossary: `*IO` →
  `*Transport`, `SafeCodec` → `BridgeCodec`, `IntelligentCache` →
  `ArtifactCache`, `WorkerPool`/`PooledWorker` → `TransportPool`/`TransportLease`,
  `marker` → `typeTag`; the on-the-wire keys do not change, only code identifiers
- tighten config loading with per-section validators and demote the dead
  per-module `runtime` field (#230)
- single-source `IR_VERSION` (today duplicated across six files) and add a drift
  check, the foundation of the `tywrap` ↔ `tywrap-ir` compatibility contract
  (#229)
- land the security must-dos that change behavior: the import/`getattr` allowlist
  in the Python bridge and the module-name injection fix in discovery

## Next (0.7.0): the scientific data plane

The release that makes large scientific payloads reliable and first-class, built
on the clean foundation 0.6.0 establishes (this is the workstream that was
labeled 0.5.0 before the refactor took that number). Tracked under #237.

- measure first: Arrow, large-payload, and pool benchmarks land before any perf
  gate so the gates have real baselines
- add a versioned artifact or chunked transport path so large payloads no longer
  depend on single-line JSONL (#231)
- make Arrow registration frictionless across the runtime story (#232)
- expand scientific codec validation and performance gates (#233)
- harden SciPy, Torch, and Sklearn envelope behavior so supported cases are
  explicit and unsupported cases fail clearly (#234)
- document transport capability expectations across Node, Pyodide, and HTTP (#235)
- capture the dropped Python member categories in `tywrap-ir` (`@classmethod`,
  `@property`, `cached_property` via `inspect.classify_class_attrs`), bump the IR
  schema, and regenerate goldens
- stabilize the `tywrap/dev` examples with a watch/reload end-to-end smoke (#228)

See [docs/codec-roadmap.md](./docs/codec-roadmap.md) for the deeper technical
plan behind this release theme.

## Later

These items are intentionally not part of `0.6.0` or `0.7.0`:

- GPU-native transport such as DLPack or Arrow CUDA
- HTTP server lifecycle management owned by Tywrap
- app-level HMR beyond Tywrap wrapper regeneration and bridge reload
- unsafe default model-serialization paths such as implicit pickle or joblib
- broader runtime surface removals that should wait for a later major-version
  contract pass
