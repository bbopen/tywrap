# Callable compilation contracts

`tywrap_ir` emits IR 0.4. `validateIrContract()` accepts unknown JSON and checks every required IR field. Each diagnostic has a JSON path.

`compileContract()` is an internal pure step. It accepts validated IR, a parser-mapped module, a value conversion description, capability descriptions, and a generator. It returns the resolved module, callable records, local diagnostics, and TypeScript and declaration file content.

The compiler does not read files. It does not start Python. It does not read a cache. It does not write files. It does not access a runtime registry.

`generate()` owns Python discovery, cache reads, output comparison, and writes. It validates IR and maps annotations, then calls `compileContract()` before emission. Offline contract files omit extractor metadata for stable bytes. The reader restores an empty metadata object.

## Resolved callable data

The compiler records each parameter, result, overload parameter, and overload result with its logical Python type, direction, source path, and conversion result. It creates one resolved module model for declarations, call wrappers, and return validators.

Each value conversion uses revision 2 of [value-contracts.v2.json](value-contracts.v2.json). Do not infer a wire rule from the TypeScript type.

| Case | Result |
| --- | --- |
| `int` | JSON number, JavaScript number, safe-integer constraint |
| nested `dict[str, T]` | JSON record with the child conversion at every value path |
| `str | int` | Selected union alternative with one child contract per option |
| `tuple[int, str]` | Exact JSON array with a contract for each index |
| float16 ndarray | Existing Arrow or JSON-fallback envelope and finite number result |
| float16 Torch tensor | Existing Torch envelope containing the float16 ndarray conversion |

The compiler requires an explicit float16 dtype. An untyped ndarray or Torch tensor stays unresolved.

The compiler keeps Arrow int64 behavior outside this prototype. Existing Arrow int64 values can decode as `bigint`.

## Diagnostics and fallback

Known unsupported cases create error diagnostics. The compiler changes the affected generated type to `unknown`. `generate()` returns each diagnostic as a warning, so `--fail-on-warn` rejects strict builds.

- Coroutines require the capability owned by #338.
- Dataclasses require an adapter owned by #339.
- Non-string record keys require an explicit conversion.

Unresolved annotations create warning diagnostics. They retain the generator's current fallback and do not claim a supported conversion.

IR overload signatures stay separate from the implementation signature. Generated declarations retain each input-to-result relation. At runtime, the wrapper selects a result validator when exactly one supported overload matches the bound arguments. Ambiguous calls use the implementation validator.

## Deferred work

Revision 2 does not describe references or recursive aliases. The compiler reports these cases as unresolved. A later value-contract revision can give them a supported conversion.

The client-binding work may consume the resolved callable model later. It must remain opt-in. It must not add files to default generation or mutate the global runtime registry.
