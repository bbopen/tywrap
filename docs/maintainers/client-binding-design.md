# Explicit runtime binding design

Status: the bounded [#340](https://github.com/bbopen/tywrap/issues/340) prototype at `65bed95` passed independent review and CI. Public generation support remains future work.

## Proposed client API

The prototype adds `<module>.generated.client.ts` beside the existing wrapper. The existing `<module>.generated.ts` keeps its exports.

Tests invoke the internal prototype renderer directly. There is no public generation option. Default `generate()` output remains unchanged.

```ts
import { NodeBridge } from 'tywrap/node';
import { bindRuntime } from './generated/math.generated.client.js';

const bridgeA = new NodeBridge({ pythonPath: '/env/a/bin/python' });
const bridgeB = new NodeBridge({ pythonPath: '/env/b/bin/python' });
const a = bindRuntime(bridgeA);
const b = bindRuntime(bridgeB);

const [left, right] = await Promise.all([a.api.sqrt(9), b.api.sqrt(16)]);
await a.api.sqrt(25);
await b.api.sqrt(36);

a.dispose();
b.dispose();
await Promise.all([bridgeA.dispose(), bridgeB.dispose()]);
```

`bindRuntime(runtime: BoundRuntime)` captures the supplied bridge. It returns a handle with `api` and `dispose()`. `BoundRuntime` contains only the bridge's `call` method. A full bridge also satisfies this type.

Python names stay inside `api`. For example, a Python `dispose` function becomes `handle.api.dispose()`. It cannot replace handle disposal.

The companion module also avoids collisions with generated names such as `Client` and `createClient` in the existing module.

`api` contains generated module functions. It contains plain namespaces for supported class and static methods.

```ts
const pets = bindRuntime(petBridge);
const dog = await pets.api.Pet.createDog('Rex');
```

`Pet` above is a namespace of calls. It is not a Python object handle or a JavaScript constructor.

## Types and generated code

The companion must emit each signature from the same Python model as the legacy wrapper. It must preserve each overload and generic parameter.

```ts
export interface BoundApi {
  identity<T>(value: T): Promise<unknown>;
  select(value: number): Promise<number>;
  select(value: string): Promise<string>;
  scale(value: number): Promise<number>;
  scale(value: number, factor?: number): Promise<number>;
  Client: {
    label(value: string): Promise<string>;
  };
}
```

This block shows the required declaration form for the fixture. `select` has two Python `@overload` branches.

The compiler keeps `identity`'s generic input. Its result is `unknown` because the runtime cannot validate an unresolved type variable. Bound and legacy calls must emit that same return type.

`scale` has a trailing optional Python parameter. These are separate typing checks.

Actual signatures follow the source module. `Parameters<>` and `ReturnType<>` cannot define `BoundApi` because they lose overloads.

The compiler should emit one private implementation for each callable. That implementation shapes arguments, applies guards, calls the bridge, and validates the result.

The legacy entrypoint chooses `getRuntimeBridge()` for each call. A bound entrypoint uses its captured bridge. Both entrypoints call the same private implementation.

The private implementation lives in `<module>.generated.core.ts`. The existing wrapper and companion import it in the prototype.

The prototype renderer generates both forms from one compiled module and one generator. It does not accept a separate template. It rejects source maps until each emitted file can carry its own map.

The compiler must allocate collision-free import aliases. Python names can map to helper-like TypeScript names.

A future public generation option could add `bindingPrototype` to `GeneratedCode`:

```ts
interface GeneratedCode {
  typescript: string;
  declaration: string;
  bindingPrototype?: {
    core: { typescript: string; declaration: string };
    client: { typescript: string; declaration: string };
  };
}
```

The prototype test writes the renderer's three source files to a temporary directory. The proposed `GeneratedCode` field is not implemented.

Production integration must add both files to `emitOrCompareFiles()`. It must handle optional declarations, source maps, and configured output formats.

The proposed names end in `.generated.core.ts` and `.generated.client.ts`. They cannot equal another module's `.generated.ts` path.

The compiler must still check all emitted paths for duplicates before writing. It must never overwrite an existing file with another module's artifact.

Only configured Python modules enter the generation loop. Core and companion files are output artifacts, never new input modules.

## Ownership and failure

The supplied bridge is borrowed. `handle.dispose()` closes only that handle. It never calls `runtime.dispose()` or changes the global registry.

Disposal is idempotent. A call started after disposal rejects with `BridgeDisposedError`. A call started before disposal keeps its selected bridge.

If the owner disposes the bridge during a call, the bridge controls that call's result. The handle does not extend the bridge lifetime.

Argument, conversion, bridge, and return-validation failures reject the generated promise. They do not close the handle or affect another handle.

The owner disposes each bridge once all users finish. Two handles may borrow one bridge without taking joint ownership.

## Reload

An existing bound handle never changes its bridge. The caller creates a new handle from `reloader.current()` after a successful reload.

The current reloader disposes its previous bridge after a swap. Calls on an old handle then follow that bridge's disposed behavior.

Legacy wrappers read the registry on each call. They use the new bridge after the reloader publishes it.

A failed reload keeps the current bridge. A bound handle for that bridge remains usable.

## Prototype evidence

- Generate one module with a function, an overload, a generic, and a supported class or static method.
- Run two clients against distinct Python environments for the same generated module. Check interleaved and concurrent calls.
- Check that bound calls do not write the registry. Check that legacy imports still use the registry.
- Check argument, conversion, and return validation through both entrypoints.
- Check client disposal, shared borrowing, bridge disposal, failed calls, and reload behavior.
- Test Node and another bridge type where the test environment supports both.
- Compare emitted bytes for the original and revised generator on a small and a representative module.

The Python fixture exports `create_client`, `dispose`, `identity`, `select`, `scale`, and `Client.label`. It checks names and signatures together.

Two fixture directories provide the same Python module name and signature set. Each returns a different environment label.

| Check | Expected result |
| --- | --- |
| Bind A and B with no global bridge | `a.api.environment()` returns `A`; `b.api.environment()` returns `B`; `getRuntimeBridge()` still throws. |
| Interleave and use `Promise.all` | Every call returns the label from its own Python directory. |
| Call Python collision names | `a.api.createClient()` and `a.api.dispose()` call Python; `a.api.Client.label('x')` returns `A:x`. |
| Check generated types | `identity<string>('x')` accepts a string and returns `Promise<unknown>`; `select` keeps correlated number and string branches; both `scale` call forms compile. |
| Trigger an argument or Python failure on A | A rejects; B still resolves; neither handle closes. |
| Call `invalidReturn()` on A | A rejects with `BridgeValidationError`; B still resolves. |
| Borrow one bridge in two handles | Disposing one handle leaves the other usable and does not dispose the bridge. |
| Dispose A twice | Both disposals succeed; later A calls reject with `BridgeDisposedError`; B stays usable. |
| Dispose the bridge owner | Later calls through its handle reject through the bridge's existing disposed behavior. |
| Reload successfully | The old bound handle keeps its old bridge; a new handle uses `reloader.current()`; legacy calls use the new global bridge. |
| Reload fails | The existing bound handle and global bridge keep the previous bridge. |

The mixed-runtime check pairs `NodeBridge` with an HTTP test backend. Both use the same generated companion.

The size report records raw UTF-8 bytes for legacy and opt-in source files, plus their generated declarations.

Use `binding_fixture` for the small case and `test/fixtures/python/advanced_types.py` for the larger case.

For each case, record `legacy.ts`, `legacy.d.ts`, `opt-in.ts total`, and `opt-in.d.ts total` in bytes.

Compute source delta as `opt-in.ts total - legacy.ts`. Divide that delta by the number of generated callables.

The opt-in prototype at `65bed95` passed all 22 jobs in [CI run 35503626271](https://github.com/bbopen/tywrap/actions/runs/35503626271). The Node 22 and Python 3.11 test job measured these raw UTF-8 bytes:

| Module | Calls | Legacy `.ts` | Opt-in `.ts` total | Source increase | Legacy `.d.ts` | Opt-in `.d.ts` total | Declaration increase |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `binding_fixture` | 12 | 7,300 | 10,113 | 2,813 (38.5%) | 1,897 | 5,023 | 3,126 (164.8%) |
| `advanced_types` | 19 | 22,779 | 28,918 | 6,139 (27.0%) | 11,236 | 24,377 | 13,141 (117.0%) |

The opt-in files add about 234 and 323 source bytes per callable, respectively. The declaration total more than doubles because it retains the legacy declarations and adds core and client declarations. This cost would apply when a future caller requests the three-file form. Production integration needs a package-size and editor-load budget. It can then decide whether to share more declarations before making the option public. The prototype has no public generation flag, so these measurements do not change default output.

This design excludes transport pooling, Python object handles, and coroutine scheduling.
