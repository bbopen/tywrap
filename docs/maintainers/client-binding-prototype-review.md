# Explicit client binding prototype review

Reviewed code: draft [PR #355](https://github.com/bbopen/tywrap/pull/355) at `65bed9577254e68566827496a9693223da1e3e05`. Its base is the accepted callable compiler commit `42feeca0abd1314592be691faa6d608541dfc6d2`.

## Result

Accept the corrected internal prototype for this bounded review. It supports a shared callable core, a registry-backed legacy adapter, and a bound client companion. This verdict does not close issue #340 or approve a public generation option.

A fresh independent review found a provenance defect in the earlier head `1e6ff97`: the renderer accepted a separately supplied template, which could route generated calls to another module. A bounded reproduction confirmed that mismatch. At `65bed95`, the renderer generates both forms from one compiled `PythonModule` and one `CodeGenerator`. The reviewer rechecked the corrected code and found no remaining runtime or type fidelity defect in this prototype.

[CI run 35503626271](https://github.com/bbopen/tywrap/actions/runs/35503626271) passed all 22 jobs at the reviewed head. Its Node 22 and Python 3.11 job passed all 10 prototype tests. The matrix also passed Python 3.10 and 3.12, Bun, macOS, and Windows jobs. Local native tests were deferred because macOS memory pressure was level 2. Bounded local TypeScript parser checks and the independent source review supplemented CI.

## API and ownership

`bindRuntime(runtime)` returns `{ api, dispose }`. `BoundRuntime` requires only the bridge's `call` method. Calls in `api` capture that runtime. The handle borrows it: `dispose()` blocks later calls but never disposes the bridge or changes the registry. A call already started keeps its selected bridge. A second handle can borrow the same bridge.

Python function names stay inside `api`, so `api.dispose()` remains a Python call. Supported class and static methods appear in plain namespaces. The legacy adapter still reads the registry on each call. After a successful reload, an old bound handle keeps its old bridge and a new handle can bind the replacement. A failed reload leaves the current bridge usable.

The tests ran two clients against different Python directories with the same module name. They checked concurrent and interleaved calls, argument and return contracts, bytes, failures, class methods, shared borrowing, disposal, Node and HTTP bridges, reloads, an allocated runtime getter name, and rejection of source maps. A consumer typecheck covered generics and overloads. Python 3.10 checks the documented union fallback because its IR extractor cannot capture `@overload` signatures. The unresolved `TypeVar` output remains `Promise<unknown>` in both generated forms.

## Generated size

The [design record](client-binding-design.md) gives raw source and declaration bytes from the final CI run. On Node 22 and Python 3.11, source text grew by 38.5% for `binding_fixture` and 27.0% for `advanced_types`. Declaration text grew by 164.8% and 117.0%. The extra declarations retain the legacy API and describe the core and client APIs. This is a material package and editor cost for a future public option. Production integration needs a size budget and may share more declarations.

## Scope boundary

PR #355 is a draft prototype. It does not add a public `generate()` option or package export. It does not wire output paths, collision checks, optional declaration output, source maps, or configured output formats into production emission. The renderer rejects generated source maps. A future `generate()` option must also reject `output.sourceMap` before invoking this renderer until all emitted files can carry maps. The default `generate()` path remains unchanged by this PR.
