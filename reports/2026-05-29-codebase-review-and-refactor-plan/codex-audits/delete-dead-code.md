**(a) CONFIRM, with patch caveats.**

I found no production reachability for the six modules via `src/index.ts` or `package.json` exports: the public barrel exports runtime pieces but not these modules ([src/index.ts](/Users/brettbonner/tywrap/src/index.ts:10), [src/index.ts](/Users/brettbonner/tywrap/src/index.ts:80)), and the package exports only `.`, `./node`, `./pyodide`, `./http`, `./runtime`, `./dev` ([package.json](/Users/brettbonner/tywrap/package.json:8)). `OptimizedNodeBridge` is explicitly described as not exported ([README.md](/Users/brettbonner/tywrap/README.md:102), [docs/guide/runtimes/node.md](/Users/brettbonner/tywrap/docs/guide/runtimes/node.md:23)).

`globalParallelProcessor.setDebug(...)` is not behaviorally meaningful beyond assigning a boolean: `tywrap()` calls it once ([src/tywrap.ts](/Users/brettbonner/tywrap/src/tywrap.ts:47)), and `setDebug` only writes `this.debug` ([src/utils/parallel-processor.ts](/Users/brettbonner/tywrap/src/utils/parallel-processor.ts:780)). Importing the module does construct `globalParallelProcessor` ([src/utils/parallel-processor.ts](/Users/brettbonner/tywrap/src/utils/parallel-processor.ts:955)), but the constructor only sets options/debug state ([src/utils/parallel-processor.ts](/Users/brettbonner/tywrap/src/utils/parallel-processor.ts:146)); workers/timers start only in `init()`/`processQueue()` ([src/utils/parallel-processor.ts](/Users/brettbonner/tywrap/src/utils/parallel-processor.ts:179), [src/utils/parallel-processor.ts](/Users/brettbonner/tywrap/src/utils/parallel-processor.ts:656)). So deleting the import removes module load and singleton construction, not a runtime bridge/generate behavior.

Counterexample to the proposed deletion list: `test/parallel-processor.test.ts` imports `ParallelProcessor` ([test/parallel-processor.test.ts](/Users/brettbonner/tywrap/test/parallel-processor.test.ts:5)), but your test deletion list omits it. Deleting `src/utils/parallel-processor.ts` without deleting or rewriting that test will break tests/typecheck.

**(b) Refactor Critique**

Relocating `TYWRAP_PROTOCOL_VERSION` to `transport.ts` is reasonable: `transport.ts` already owns `PROTOCOL_ID` ([src/runtime/transport.ts](/Users/brettbonner/tywrap/src/runtime/transport.ts:19)), and `bridge-protocol.ts` already imports `PROTOCOL_ID` from there ([src/runtime/bridge-protocol.ts](/Users/brettbonner/tywrap/src/runtime/bridge-protocol.ts:24)). The value must remain aligned with Python’s `PROTOCOL_VERSION = 1` ([runtime/python_bridge.py](/Users/brettbonner/tywrap/runtime/python_bridge.py:32)) because `handle_meta()` returns it ([runtime/python_bridge.py](/Users/brettbonner/tywrap/runtime/python_bridge.py:758)) and JS validates it ([src/runtime/bridge-protocol.ts](/Users/brettbonner/tywrap/src/runtime/bridge-protocol.ts:91)).

Compile/runtime break risks are mechanical: update every remaining `protocol.js` import. Current live imports are `bridge-protocol.ts` ([src/runtime/bridge-protocol.ts](/Users/brettbonner/tywrap/src/runtime/bridge-protocol.ts:24)), `bridge-core.ts` ([src/runtime/bridge-core.ts](/Users/brettbonner/tywrap/src/runtime/bridge-core.ts:4)), and `runtime_node.test.ts` ([test/runtime_node.test.ts](/Users/brettbonner/tywrap/test/runtime_node.test.ts:14)). If `bridge-core.ts` is deleted and the other two imports move, deleting `protocol.ts` is clean.

Deleting `performance-integration.test.ts` is acceptable only because `BundleOptimizer` itself is deleted; that test covers private AST helpers via `as any`, not a public behavior ([test/performance-integration.test.ts](/Users/brettbonner/tywrap/test/performance-integration.test.ts:24)). But deleting `optimized-node.test.ts` is more questionable: it imports `NodeBridge as OptimizedNodeBridge`, not the shim ([test/optimized-node.test.ts](/Users/brettbonner/tywrap/test/optimized-node.test.ts:4)), and includes real Python/pool behavior coverage ([test/optimized-node.test.ts](/Users/brettbonner/tywrap/test/optimized-node.test.ts:228)). Rename or fold useful cases into `runtime_node.test.ts` instead of blindly deleting.

Safer sequence: first move `PROTOCOL_VERSION` and update imports/assertions; then delete dead source; then delete/merge tests, including `parallel-processor.test.ts`; then run `npm run typecheck`, `npm run lint`, and targeted runtime tests.

**(c) Readability Comments To Add**

In [src/runtime/transport.ts](/Users/brettbonner/tywrap/src/runtime/transport.ts:19), replace/add:

```ts
/**
 * Wire protocol identifier echoed on every JS/Python request envelope.
 *
 * Keep this aligned with runtime/python_bridge.py's PROTOCOL. This is separate
 * from PROTOCOL_VERSION: the string identifies the JSONL envelope family, while
 * the numeric version gates the bridge metadata schema.
 */
export const PROTOCOL_ID = 'tywrap/1';

/**
 * Bridge metadata schema version returned by the Python `meta` handler.
 *
 * BridgeProtocol validates this against `protocolVersion` from getBridgeInfo().
 * Bump only when JS and Python agree on a breaking metadata contract change.
 */
export const PROTOCOL_VERSION = 1;
```

In [src/runtime/bridge-protocol.ts](/Users/brettbonner/tywrap/src/runtime/bridge-protocol.ts:91), add before the version check:

```ts
  // PROTOCOL_ID validates the request/response envelope; PROTOCOL_VERSION
  // validates the Python bridge metadata payload returned by `meta`.
```

In [runtime/python_bridge.py](/Users/brettbonner/tywrap/runtime/python_bridge.py:32), add above the constants:

```py
# Keep these aligned with src/runtime/transport.ts.
# PROTOCOL is the JSONL envelope id; PROTOCOL_VERSION is the bridge metadata schema version.
```