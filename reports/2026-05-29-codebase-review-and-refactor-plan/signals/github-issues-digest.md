# tywrap open GitHub issues (maintainer roadmap)

### #238 Remove the TS analyzer and tree-sitter from the required install path
Labels: area:runtime-node, area:tooling, area:docs, priority:p1

The TypeScript-side Python analyzer should be fully removed in the `0.4.x` line so the supported Tywrap install and generate path standardizes on `tywrap_ir` and no longer depends on native `tree-sitter` builds. This work should also tighten the supported Node story, including reliable installation on Node 25.

## Acceptance Criteria

- the TypeScript-side analyzer and its `tree-sitter` parser path are fully removed rather than left as a parallel supported implementation
- `tree-sitter`, `tree-sitter-python`, and any unused parser-only dependencies are no longer required for the normal `npm install tywrap` path
- Tywrap generation and docs clearly treat `tywrap_ir` as the single supported analysis source of truth
- package validation includes a fresh-install smoke path that catches Node 25 install regressions before release

---

### #237 Roadmap: 0.5.0 data plane
Labels: roadmap

This umbrella issue tracks the `0.5.0` data-plane release. Use it as the release bucket for large-payload transport and scientific codec hardening.

See also: [docs/codec-roadmap.md](https://github.com/bbopen/tywrap/blob/main/docs/codec-roadmap.md)

## Tracking

- [ ] #231 Add versioned artifact/chunked transport for large payloads
- [ ] #232 Make Arrow registration frictionless across the runtime story
- [ ] #233 Expand scientific codec validation and perf gates
- [ ] #234 Harden scientific envelope behavior for SciPy, Torch, and Sklearn
- [ ] #235 Expose transport capability expectations for the 0.5.0 data plane

---

### #236 Roadmap: 0.4.x stabilization
Labels: roadmap

This umbrella issue tracks the focused stabilization work for the `0.4.x` line after the `v0.4.0` hot-reload and config-contract release.

## Tracking

- [ ] #238 Remove the TS analyzer and tree-sitter from the required install path
- [ ] #228 Stabilize tywrap/dev examples and hot-reload coverage
- [ ] #229 Define and enforce tywrap ↔ tywrap-ir compatibility contract
- [ ] #230 Clean up deprecated runtime surface after v0.4.0

---

### #235 Expose transport capability expectations for the 0.5.0 data plane
Labels: area:runtime-node, area:codec, priority:p2

Expose transport capability expectations for the `0.5.0` data plane so Node, Pyodide, and HTTP support boundaries stay easy to understand.

## Acceptance Criteria

- runtime and docs make clear which transports support which data-plane features
- HTTP and Pyodide boundaries stay explicit where Tywrap intentionally does not own the lifecycle or transport path
- examples and docs avoid implying unsupported transport capabilities

---

### #234 Harden scientific envelope behavior for SciPy, Torch, and Sklearn
Labels: area:codec, priority:p2

Harden SciPy, Torch, and Sklearn envelope behavior so supported cases are explicit and unsupported cases fail clearly.

## Acceptance Criteria

- supported envelopes and explicit failure behavior are documented and tested
- lossy or device-transfer behavior remains opt-in
- unsupported cases fail clearly instead of falling back silently

---

### #233 Expand scientific codec validation and perf gates
Labels: area:codec, area:ci, priority:p2

Expand scientific codec validation and performance gates so the `0.5.0` data-plane work is backed by real transport and payload-scale coverage.

## Acceptance Criteria

- targeted tests cover large scientific payloads and the relevant transport paths
- perf-budget or payload-scale checks exist where transport behavior matters
- release gating includes the relevant scientific suites for the new data-plane work

---

### #232 Make Arrow registration frictionless across the runtime story
Labels: area:codec, area:docs, priority:p2

Make Arrow registration easier across the runtime story so the scientific happy path does not require avoidable manual decoder setup.

## Acceptance Criteria

- decoder setup is easier by default or through a simpler documented path
- docs and examples reflect the default Arrow path clearly
- common scientific usage no longer requires avoidable manual wiring

---

### #231 Add versioned artifact/chunked transport for large payloads
Labels: area:runtime-node, area:codec, priority:p1

Add a versioned artifact or chunked transport path for large payloads so scientific results do not depend on single-line JSONL size ceilings.

## Acceptance Criteria

- large payloads no longer depend on single-line JSONL transport
- protocol and versioning expectations are explicit
- failures remain explicit with no silent fallback to lossy behavior

---

### #230 Clean up deprecated runtime surface after v0.4.0
Labels: area:runtime-node, area:docs, priority:p2

Clean up the remaining deprecated runtime surface after `v0.4.0` so new examples and docs reflect the public API rather than compatibility shims.

## Acceptance Criteria

- deprecated aliases and options are documented with a clear removal path
- new examples avoid deprecated APIs and compatibility-only imports
- any removals that should wait for a later major release are explicitly deferred and documented as such

---

### #229 Define and enforce tywrap ↔ tywrap-ir compatibility contract
Labels: area:tooling, area:docs, priority:p2

Define and enforce the compatibility contract between `tywrap` and `tywrap-ir` so users get explicit expectations and explicit failures when versions drift.

## Acceptance Criteria

- compatibility expectations are documented in maintainers docs and user-facing release guidance where appropriate
- mismatch behavior is explicit and friendly instead of implicit or surprising
- release guidance explains how `tywrap` and `tywrap-ir` version independently

---

### #228 Stabilize tywrap/dev examples and hot-reload coverage
Labels: area:runtime-node, area:examples, priority:p2

Stabilize the shipped `tywrap/dev` workflow so the development hot-reload story is backed by examples and regression coverage, not just API surface.

## Acceptance Criteria

- living-app or an equivalent end-to-end smoke path exercises watch/reload behavior
- docs cover reload failure and recovery behavior clearly
- hot-reload examples stay aligned with the shipped `tywrap/dev` API and avoid deprecated paths
