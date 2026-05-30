VERDICT: mixed. The config diagnosis is mostly confirmed; the VERSION proposal is likely not build-clean; the “verbatim extraction is behavior-preserving” claim is only conditionally true.

**(a) Diagnosis**

1. Confirmed: `moduleConfig.runtime` is dead in `generate()`. `generate()` binds `moduleConfig` at [src/tywrap.ts](/Users/brettbonner/tywrap/src/tywrap.ts:155), then reads `exclude`/`excludePatterns` at [src/tywrap.ts](/Users/brettbonner/tywrap/src/tywrap.ts:207), `functions` at [src/tywrap.ts](/Users/brettbonner/tywrap/src/tywrap.ts:233), `classes` at [src/tywrap.ts](/Users/brettbonner/tywrap/src/tywrap.ts:249), and cache inputs `version`/`typeHints` at [src/tywrap.ts](/Users/brettbonner/tywrap/src/tywrap.ts:625) and [src/tywrap.ts](/Users/brettbonner/tywrap/src/tywrap.ts:641). Runtime selection comes from top-level `runtime.node` only: [src/tywrap.ts](/Users/brettbonner/tywrap/src/tywrap.ts:138), [src/tywrap.ts](/Users/brettbonner/tywrap/src/tywrap.ts:172).

2. Confirmed: `validateConfig()` skips `runtime.http`, `runtime.pyodide`, and per-module config. The types define all three runtime sections at [src/types/index.ts](/Users/brettbonner/tywrap/src/types/index.ts:332), with pyodide/http fields at [src/types/index.ts](/Users/brettbonner/tywrap/src/types/index.ts:338) and [src/types/index.ts](/Users/brettbonner/tywrap/src/types/index.ts:349). Validation only inspects `runtime.node`: [src/config/index.ts](/Users/brettbonner/tywrap/src/config/index.ts:157). `pythonModules` is only top-level-allowed at [src/config/index.ts](/Users/brettbonner/tywrap/src/config/index.ts:122), plus legacy `watch` detection at [src/config/index.ts](/Users/brettbonner/tywrap/src/config/index.ts:102).

3. Refute “zero-risk” extraction, but not the basic idea. Same-file extraction can preserve behavior if it preserves `import.meta.url`/`import.meta.resolve` usage at [src/config/index.ts](/Users/brettbonner/tywrap/src/config/index.ts:278) and [src/config/index.ts](/Users/brettbonner/tywrap/src/config/index.ts:312), keeps `compile.call(mod, ...)` because `_compile` needs `this` at [src/config/index.ts](/Users/brettbonner/tywrap/src/config/index.ts:345), and preserves `finally` cleanup at [src/config/index.ts](/Users/brettbonner/tywrap/src/config/index.ts:380). Moving helpers to another module, destructuring `_compile`, changing temp filename randomness, or moving cleanup outside the `try/finally` would change behavior.

**VERSION / CLI concerns**

The proposed `import '../package.json' with { type: 'json' }` is likely not clean under this tsconfig: `rootDir` is `./src` at [tsconfig.json](/Users/brettbonner/tywrap/tsconfig.json:16), `include` is `src/**/*`/`types/**/*` at [tsconfig.json](/Users/brettbonner/tywrap/tsconfig.json:35), and package.json is outside `src` at [package.json](/Users/brettbonner/tywrap/package.json:1). `resolveJsonModule` is enabled at [tsconfig.json](/Users/brettbonner/tywrap/tsconfig.json:31), but that does not make an out-of-root imported JSON source fit `rootDir`. Cleanest: generate `src/version.ts` from `package.json` before `tsc`, then `export { VERSION } from './version.js'`. Avoid `createRequire()` in public `src/index.ts`; the package root export is public ESM at [package.json](/Users/brettbonner/tywrap/package.json:8), and the repo explicitly checks Deno/Bun entrypoints at [package.json](/Users/brettbonner/tywrap/package.json:60).

Confirm: `--runtime` is effectively dead. It flows into `buildModulesConfig()` at [src/cli.ts](/Users/brettbonner/tywrap/src/cli.ts:53), generate overrides at [src/cli.ts](/Users/brettbonner/tywrap/src/cli.ts:233), and init templates at [src/cli.ts](/Users/brettbonner/tywrap/src/cli.ts:75). `--python`, not `--runtime`, sets top-level runtime at [src/cli.ts](/Users/brettbonner/tywrap/src/cli.ts:257). Deprecate `--runtime` now with a warning, then remove it unless real top-level runtime selection is implemented.

**(b) Refactor Critique**

Plain small validators are cleaner than a Field/assertField mini-DSL here. The section shapes are irregular: `output` enums/booleans at [src/config/index.ts](/Users/brettbonner/tywrap/src/config/index.ts:137), presets membership at [src/config/index.ts](/Users/brettbonner/tywrap/src/config/index.ts:181), runtime branches at [src/types/index.ts](/Users/brettbonner/tywrap/src/types/index.ts:332), and module arrays/enums at [src/types/index.ts](/Users/brettbonner/tywrap/src/types/index.ts:311). A DSL will hide more than it removes.

Be careful with stricter validation. `HttpConfig.baseURL` is only typed as `string` at [src/types/index.ts](/Users/brettbonner/tywrap/src/types/index.ts:350), and `HttpIO` passes it directly to `fetch()` after trimming a trailing slash at [src/runtime/http-io.ts](/Users/brettbonner/tywrap/src/runtime/http-io.ts:72) and [src/runtime/http-io.ts](/Users/brettbonner/tywrap/src/runtime/http-io.ts:169). Browser-relative URLs may be legitimate. Validate non-empty string; don’t require absolute URL unless documented.

Also validate section objects before assuming defaults saved you. `merge()` replaces non-plain overrides at [src/config/index.ts](/Users/brettbonner/tywrap/src/config/index.ts:82), and validation currently assumes object-ish `runtime` at [src/config/index.ts](/Users/brettbonner/tywrap/src/config/index.ts:157).

**(c) Newcomer Comments**

Add/keep these:

- [src/config/index.ts](/Users/brettbonner/tywrap/src/config/index.ts:307): explain the bare `tywrap` rewrite is only for temp-file ESM evaluation, not a general import resolver.
- [src/config/index.ts](/Users/brettbonner/tywrap/src/config/index.ts:321): add “Do not call `_compile` unbound; Node expects `this` to be the Module instance.”
- [src/config/index.ts](/Users/brettbonner/tywrap/src/config/index.ts:361): explain temp `.mjs` plus `node_modules` symlink: Node ESM import needs a real file URL and resolves dependencies from that file’s directory.
- [src/types/index.ts](/Users/brettbonner/tywrap/src/types/index.ts:295): document `auto` as legacy accepted config metadata; no AutoBridge exists.
- [src/types/index.ts](/Users/brettbonner/tywrap/src/types/index.ts:313): make `runtime` optional/deprecated or remove; comment that bridge choice is not per-module.
- New `src/version.ts`: “Generated from package.json by the build; do not edit.”