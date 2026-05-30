# ts-fx Signal Digest (VERIFIED) — tywrap refactoring inputs

This digest captures deterministic `ts-fx` findings against the tywrap repo, **already adjudicated for false positives** by manual source inspection. Treat ts-fx as ONE signal among several; the expert review (`REVIEW.md` at repo root) is the other. Raw NDJSON lives in `/tmp/fx-tywrap/*.ndjson`.

## Reliability adjudication (IMPORTANT — ts-fx has false positives)

- **complexity** — RELIABLE. Deterministic cyclomatic/cognitive/maintainability metrics with disposition routing. Use the ranked list below as the authoritative hotspot inventory.
- **duplicates** — 2 REAL review-candidates (verified both methods live). NOTE: ts-fx found duplication ts-fx's threshold caught; the expert report separately found a 3× call-emission duplication in `generator.ts`. BOTH are real and DIFFERENT — they are complementary, not redundant.
- **verify-esm (require-in-ESM)** — 80% FALSE POSITIVE. ts-fx flags any `require(` token but does NOT recognize the `createRequire(import.meta.url)` ESM idiom. Verified verdicts:
  - `src/config/index.ts:280` — FALSE POSITIVE (createRequire)
  - `src/config/index.ts:327` — FALSE POSITIVE (createRequire)
  - `src/runtime/node.ts:404` — FALSE POSITIVE (createRequire)
  - `src/utils/codec.ts:178` — FALSE POSITIVE (nodeModule.createRequire)
  - `src/utils/memory-profiler.ts:491` — **TRUE POSITIVE** (bare `require('perf_hooks')`, no createRequire) — would throw `ReferenceError: require is not defined` under ESM. BUT this file is in the dead-code subsystem (never executed in production), which is itself evidence it is dead.
- **deadcode** — BLIND on this repo. ts-fx returned ZERO dead-code findings because the over-broad `src/index.ts` barrel re-exports nearly everything, so every internal module is statically "reachable" via the public API. This is itself a finding: **the barrel masks dead code**. The expert report's dead-code claim (parallel-processor / bundle-optimizer / memory-profiler / bridge-core / protocol / optimized-node) rests on DYNAMIC reachability (wired only via `setDebug` / only their own tests), which static export-graph analysis cannot see. Any deletion must be proven via call-graph + grep, not by trusting ts-fx's empty result.
- **graph cycles/hubs** — no import cycles detected (consistent with a cleanly layered core).
- **layout** — flags `god-file` (large files) — corroborates generator.ts size.
- **tests/duplicate** — 4 plausible duplicate-test pairs (verify before deleting).

## Complexity hotspots — ACTIONABLE + high (ts-fx, cyclomatic/cognitive)

Ranked by cognitive complexity. These are the authoritative decomposition targets:

| cyc/cog | sev | location | function |
|---|---|---|---|
| 62/106 | high | src/utils/codec.ts:356 | decodeEnvelopeCore |
| 27/92  | high | src/core/analyzer.ts:561 | extractImports |
| 38/91  | high | src/tywrap.ts:123 | generate |
| 23/85  | high | src/core/analyzer.ts:284 | extractParameters |
| 58/75  | high | src/core/annotation-parser.ts:280 | parse |
| 41/66  | high | src/core/mapper.ts:478 | mapPresetType |
| 26/39  | high | src/config/index.ts:120 | validateConfig |
| 17/36  | high | src/core/annotation-parser.ts:184 | splitTopLevel |
| 19/33  | high | src/config/index.ts:259 | loadConfigFile |
| 12/30  | high | src/utils/cache.ts:145 | generateKey |
| 25/27  | high | src/tywrap.ts:350 | fetchPythonIr |
| 16/28  | med  | src/dev.ts:447 | resolveWatchTargets |
| 17/26  | med  | src/core/validation.ts:193 | validateTypeHints |
| 18/25  | med  | src/dev.ts:789 | runReload |
| 11/25  | med  | src/core/analyzer.ts:713 | extractDocstring |
| 11/25  | med  | src/utils/bundle-optimizer.ts:238 | visit (DEAD CODE) |
| 11/23  | med  | src/core/analyzer.ts:226 | extractClass |
| 12/23  | med  | src/runtime/process-io.ts:822 | flushWriteQueue |
| 9/20   | low  | src/utils/parallel-processor.ts:535 | handleWorkerMessage (DEAD CODE) |

## Verified duplicate pairs (ts-fx, disposition=review)

- `src/runtime/bridge-protocol.ts` — `sendMessage` (line 284) vs `sendMessageAsync` (line 324), token similarity 0.93. Both live (callers at :470 and :379/405/431/451). Extract shared envelope-build/correlate core.
- `src/runtime/pyodide-io.ts` — `call` (line 376) vs `instantiate` (line 403), token similarity 0.92. Extract shared dispatch.

## Duplicate test pairs (ts-fx, verify before acting)

- ParallelProcessor constructor vs batch-size-default tests (NOTE: tests of dead code)
- ParallelProcessor event-subscribe duplicates (dead code)
- Path Utilities cross-platform duplicates
- Pyodide Resolution "missing gracefully" vs "dynamic import" tests
