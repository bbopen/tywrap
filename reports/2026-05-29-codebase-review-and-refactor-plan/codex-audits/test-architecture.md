**(a) Hypothesis**

CONFIRM, with caveats. A bare `return` from a Vitest `it()` body is just a resolved test, so it reports passed, not skipped. Current examples do exactly that: `runtime_node.test.ts:93-98`, `runtime_node.test.ts:106-110`, `runtime_codec_scientific.test.ts:49-52`, and generated wrappers `test/generated_numpy.test.ts:8-15`. The `beforeAll` only warns; it does not skip anything (`test/runtime_node.test.ts:69-79`). The repo already has the honest idiom in `test/generated_runtime.test.ts:18-20`, and `it.skipIf` is already used in `test/transport.test.ts:729`.

No, there is no Vitest magic where a bare `return` means skip. It only changes which assertions run if the new gate is not equivalent. Watch for per-test gates: `isPythonAvailable('python')` is specific at `test/runtime_node.test.ts:593-594`; Pydantic v2 is a second capability at `test/runtime_node.test.ts:341`; SciPy/Torch/Numpy/PyArrow gates vary by test in `test/runtime_codec_scientific.test.ts:50-52`, `90-94`, `171-173`. A coarse file-level skip would be wrong there.

**(b) Refactor Critique**

Direction is right, but env handling is the risky part. `skipIf` needs a boolean during test collection. A helper exporting `Promise<boolean>` is wrong. Top-level await can work in ESM because module evaluation completes before the importing test module continues, but it is cached per Vitest worker/module graph, not globally. Simpler: use sync probes via `spawnSync`, like the current scientific helper already does (`test/runtime_codec_scientific.test.ts:34-42`), or use global setup to stamp `process.env` flags. Use `ctx.skip()` only for genuinely async, per-test capability checks; collection-time `describe.skip`/`it.skipIf` is cleaner.

The ProcessIO restart bug is real only if the test creates an already in-flight request before the next send triggers restart. Restart is checked before the new request is registered (`src/runtime/process-io.ts:255-264`, `309-326`). `restartProcess()` kills and resets counters but does not reject pending (`src/runtime/process-io.ts:533-544`); only dispose rejects pending (`src/runtime/process-io.ts:350-356`). Worse, `killProcess()` removes exit/stdout/stderr listeners before killing (`src/runtime/process-io.ts:503-507`), so the normal exit rejection path (`src/runtime/process-io.ts:662-681`) will not save the old pending request. A sequential “send N+1” test is a non-bug; the test must assert the first in-flight promise rejects.

Deleting `bridge-core.test.ts` is probably okay if `BridgeCore` is truly dead; its only importer is the test (`test/bridge-core.test.ts:3`), while live bridges use `BridgeProtocol` (`src/runtime/bridge-protocol.ts:205`) and transports. But if `src/runtime/bridge-core.ts` remains, you are leaving untested exported code. Same with `BundleOptimizer`: no production callers showed up, but the live source still exists (`src/utils/bundle-optimizer.ts:74`). Prefer deleting dead source with dead tests, or explicitly documenting why source remains.

Do not miss `test/transport.test.ts:734`: it is the seventh `expect(true).toBe(true)` and the proposed refactor does not mention it.

**(c) Comments To Add**

Add a header in `test/helpers/env.ts`: “Capability flags are computed synchronously at module evaluation so Vitest can decide `skipIf` during collection. Do not export Promises here.”

Add a short comment near the first converted gate in `test/runtime_node.test.ts`: “Use `skipIf` for missing Python so unavailable environments report SKIPPED, not passed via early return.”

Add above the shared fixture in `test/fixtures/path-cases.ts`: “Used by both Node and Bun runtime tests; this looks duplicate by tokens, but validates the same path contract under different runtimes.” Cite callers at `test/runtime_bun.test.ts:348-359` and `test/runtime_utils.test.ts:201-213`.

Add in the folded optimized-node block: “These tests exercise `NodeBridge` through the historical OptimizedNodeBridge alias; the deprecated deep-import shim lives at `src/runtime/optimized-node.ts`.” The shim says this explicitly at `src/runtime/optimized-node.ts:1-25`; the old test currently aliases live code at `test/optimized-node.test.ts:4-5`.