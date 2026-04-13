# Roadmap

This file tracks the near-term release path for `tywrap`. It is the maintainer
view of what is shipping now, what is next, and what is intentionally deferred.

The detailed technical appendix for the scientific data plane lives in
[docs/codec-roadmap.md](./docs/codec-roadmap.md).

## Recently Shipped

### v0.4.0: development hot reload and contract cleanup

`v0.4.0` established the real development reload story for Tywrap:

- `tywrap/dev` is the public development entrypoint
- Node watch sessions regenerate wrappers and swap the active bridge
- generated wrappers keep using the latest runtime bridge without re-imports
- structured generation failures keep the last known good output and bridge live
- placeholder config fields for reload behavior were removed in favor of the
  explicit dev API

The immediate `0.4.1` patch line is release hygiene, not a new roadmap theme.
It exists to keep the release and CI baseline stable after the `v0.4.0` cut.

## Now (0.4.x)

### Node 25 support, analyzer removal, and dev-contract stabilization

The `0.4.x` line is for tightening what `v0.4.0` introduced before the next
minor release expands scope again.

- remove the TypeScript-side analyzer and the required `tree-sitter` install
  path so `npm install tywrap` no longer depends on a native parser build for
  the supported Node story, including Node 25
- stabilize `tywrap/dev` examples and hot-reload coverage, especially around
  failure and recovery behavior
- define and document the `tywrap` to `tywrap-ir` compatibility contract so
  users get explicit expectations and explicit mismatch behavior
- clean up deprecated runtime surface in docs and examples so new usage follows
  the shipped public API rather than compatibility shims

This release line should treat `tywrap_ir` as the single supported analysis
path. The TypeScript analyzer is legacy internal code and should be fully
removed rather than carried forward as a parallel implementation.

## Next (0.5.0)

### Chunked transport and the scientific data plane

`v0.5.0` should be the release that makes large scientific payloads reliable and
first-class.

- add a versioned artifact or chunked transport path so large payloads no longer
  depend on single-line JSONL
- make Arrow registration easier across the runtime story so the common
  scientific path does not require avoidable manual setup
- expand scientific codec validation and performance gates so release quality is
  backed by real transport and payload-scale coverage
- harden SciPy, Torch, and Sklearn envelope behavior so supported cases are
  explicit and unsupported cases fail clearly
- document transport capability expectations so Node, Pyodide, and HTTP support
  boundaries stay easy to understand

See [docs/codec-roadmap.md](./docs/codec-roadmap.md) for the deeper technical
plan behind this release theme.

## Later

These items are intentionally not part of `0.4.x` or `0.5.0`:

- GPU-native transport such as DLPack or Arrow CUDA
- HTTP server lifecycle management owned by Tywrap
- app-level HMR beyond Tywrap wrapper regeneration and bridge reload
- unsafe default model-serialization paths such as implicit pickle or joblib
- broader runtime surface removals that should wait for a later major-version
  contract pass
