**(a) Hypothesis**

Mostly confirm for in-repo behavior, with one caveat: I would not call this “breaks no existing test” until the proposed characterization test is written against the new intended set.

Static checks support the core claim. The root package export is only `dist/index.js`/`.d.ts`, with subpaths for `./node`, `./pyodide`, `./http`, `./runtime`, and `./dev`; no deep runtime internals are exported by package map [package.json](/Users/brettbonner/tywrap/package.json:8). `src/runtime/index.ts` currently exposes only `setRuntimeBridge`, `getRuntimeBridge`, and `clearRuntimeBridge` [src/runtime/index.ts](/Users/brettbonner/tywrap/src/runtime/index.ts:9).

I found no `src/` import of the root barrel as a module. The real internal uses are relative: `dev.ts` imports registry functions from `./runtime/index.js` and `Disposable` from `./runtime/disposable.js` [src/dev.ts](/Users/brettbonner/tywrap/src/dev.ts:13); `safe-codec.ts` imports `containsSpecialFloat` and `decodeValueAsync as decodeArrowValue` directly [src/runtime/safe-codec.ts](/Users/brettbonner/tywrap/src/runtime/safe-codec.ts:11). The generated wrapper path is explicitly `tywrap/runtime`, not root [src/core/generator.ts](/Users/brettbonner/tywrap/src/core/generator.ts:1185).

Tests also support the claim: transport plumbing is imported by deep source paths [test/transport.test.ts](/Users/brettbonner/tywrap/test/transport.test.ts:12), validators by deep path [test/arch-stories.test.ts](/Users/brettbonner/tywrap/test/arch-stories.test.ts:25), `SafeCodec` by deep path [test/safe-codec.test.ts](/Users/brettbonner/tywrap/test/safe-codec.test.ts:9), and `WorkerPool` by deep path [test/worker-pool.test.ts](/Users/brettbonner/tywrap/test/worker-pool.test.ts:9). Bare `tywrap/runtime` tests only need registry functions [test/generated_runtime.test.ts](/Users/brettbonner/tywrap/test/generated_runtime.test.ts:5).

`decodeValue` staying root is fine: it is documented as public with `decodeValueAsync` [docs/reference/api/index.md](/Users/brettbonner/tywrap/docs/reference/api/index.md:243), and `decodeValueAsync` is live inside `SafeCodec.decodeResponseAsync` [src/runtime/safe-codec.ts](/Users/brettbonner/tywrap/src/runtime/safe-codec.ts:613). A type-only external consumer importing `CodecOptions` from root would break because root currently exports it [src/index.ts](/Users/brettbonner/tywrap/src/index.ts:21), and bridge option types expose `codec?: CodecOptions` [src/runtime/node.ts](/Users/brettbonner/tywrap/src/runtime/node.ts:72). Moving it to `tywrap/runtime` is therefore a public migration, not purely internal.

**(b) Critique**

Moving `SafeCodec`, `CodecOptions`, and protocol/transport types to `tywrap/runtime` is defensible because custom bridge authors need `Transport`, `ProtocolMessage`, and guards [src/runtime/transport.ts](/Users/brettbonner/tywrap/src/runtime/transport.ts:36), [src/runtime/transport.ts](/Users/brettbonner/tywrap/src/runtime/transport.ts:137). But `src/runtime/index.ts` currently describes itself as “Runtime bridge registry for generated wrappers” [src/runtime/index.ts](/Users/brettbonner/tywrap/src/runtime/index.ts:1), so broadening it needs documentation. A cleaner long-term API would be `./protocol` or `./runtime/protocol`, but that requires an exports-map addition [package.json](/Users/brettbonner/tywrap/package.json:25).

I am skeptical about keeping the whole disposable trio at root. The public dev API needs the `Disposable` type in generic constraints [src/dev.ts](/Users/brettbonner/tywrap/src/dev.ts:21), [src/dev.ts](/Users/brettbonner/tywrap/src/dev.ts:622), but `disposeAll` is an internal BoundedContext helper [src/runtime/bounded-context.ts](/Users/brettbonner/tywrap/src/runtime/bounded-context.ts:177). Keeping `Disposable` at root is justified; keeping `isDisposable`, `safeDispose`, and `disposeAll` is convenience, not necessity [src/runtime/disposable.ts](/Users/brettbonner/tywrap/src/runtime/disposable.ts:25).

The characterization test is useful, but exact `Object.keys()` alone misses type-only API drift. Add a TSD/API Extractor-style assertion for the root and `tywrap/runtime` declaration surfaces, because type exports like `CodecOptions` matter even when runtime keys do not [src/runtime/node.ts](/Users/brettbonner/tywrap/src/runtime/node.ts:24).

**(c) Comments To Add**

In `src/index.ts`, before runtime exports:
```ts
// Public root API only. Runtime internals may remain exported from their source
// modules for in-repo tests, but absence from this barrel means they are not part
// of the package API exposed by package.json#exports["."].
```
Place near [src/index.ts](/Users/brettbonner/tywrap/src/index.ts:10).

In `src/runtime/index.ts`, replace the header with:
```ts
/**
 * Runtime entrypoint for generated wrappers and advanced custom bridges.
 *
 * Generated code imports getRuntimeBridge from `tywrap/runtime`; keep the registry
 * stable. Protocol/codec/transport exports here are the narrow escape hatch for
 * users implementing their own bridge, not general root API.
 */
```
Place at [src/runtime/index.ts](/Users/brettbonner/tywrap/src/runtime/index.ts:1).

In `src/core/generator.ts`, before `bridgeDecl`:
```ts
// Generated wrappers depend on the stable `tywrap/runtime` registry subpath,
 // not the root barrel, so root API trimming must not affect generated code.
```
Place near [src/core/generator.ts](/Users/brettbonner/tywrap/src/core/generator.ts:1185).

In `src/runtime/safe-codec.ts`, above imports:
```ts
// These are internal relative dependencies. Do not route through the root barrel:
 // containsSpecialFloat enforces codec guardrails, and decodeValueAsync applies
 // Arrow/envelope decoding for async response paths.
```
Place near [src/runtime/safe-codec.ts](/Users/brettbonner/tywrap/src/runtime/safe-codec.ts:11).