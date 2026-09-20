# Callable compilation contracts

`tywrap_ir` emits IR 0.4. `validateIrContract()` accepts unknown JSON and checks every required IR field. Each diagnostic has a JSON path.

`compileContract()` is an internal pure step. It accepts validated IR, a parser-mapped module, a value conversion description, capability descriptions, and a generator. It returns the resolved module, callable records, local diagnostics, and TypeScript and declaration file content.

The compiler does not read files. It does not start Python. It does not read a cache. It does not write files. It does not access a runtime registry.

`generate()` owns Python discovery, cache reads, output comparison, and writes. It validates IR before it maps annotations. It also preserves the current generated-file behavior while the value-contract prototype lacks union and reference nodes.

## Resolved callable data

The compiler records each parameter, result, and overload result with its logical Python type, direction, source path, and conversion result. It uses this record to create one resolved module model. The generator then uses that model for declarations, call wrappers, and return validators.

Each value conversion uses revision 1 of [value-contracts.v1.json](value-contracts.v1.json). Do not infer a wire rule from the TypeScript type.

| Case | Result |
| --- | --- |
| `int` | JSON number, JavaScript number, safe-integer constraint |
| nested `dict[str, T]` | JSON record with the child conversion at every value path |
| float16 ndarray | Existing Arrow or JSON-fallback envelope and finite number result |
| float16 Torch tensor | Existing Torch envelope containing the float16 ndarray conversion |

The compiler keeps Arrow int64 behavior outside this prototype. Existing Arrow int64 values can decode as `bigint`.

## Diagnostics and fallback

Known unsupported cases create error diagnostics. The compiler changes their generated result to `unknown`.

- Coroutines require the capability owned by #338.
- Dataclasses require an adapter owned by #339.
- Non-string record keys require an explicit conversion.

Unresolved annotations create warning diagnostics. They retain the generator's current explicit fallback. The compiler does not silently claim a supported transport.

IR overload signatures stay separate from the implementation signature. Generated declarations retain each input-to-result relation. The wrapper keeps the implementation signature for Python argument binding and runtime calls.

## Deferred work

Revision 1 does not describe union, reference, or heterogeneous tuple values. Do not route the compiler projection through default generation until that policy is explicit.

The client-binding work may consume the resolved callable model later. It must remain opt-in. It must not add files to default generation or mutate the global runtime registry.
