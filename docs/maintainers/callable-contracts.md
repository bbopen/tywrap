# Callable compilation contracts

`tywrap_ir` emits IR 0.4. `validateIrContract()` checks required fields in
unknown JSON. Each diagnostic has a JSON path. Validation stops after 100,000
array entries.

`compileContract()` is an internal pure step. It accepts validated IR,
exported-name selection, value conversions, capabilities, and a generator. It
maps callable types from the validated IR. The selection input cannot change
those types. It returns the resolved module, callable records, diagnostics, and
TypeScript and declaration content.

The compiler does not read files. It does not start Python. It does not read a
cache. It does not write files. It does not access a runtime registry.

`generate()` owns Python discovery, cache reads, output comparison, and writes.
It validates IR and maps annotations, then calls `compileContract()` before
emission. Offline contract files omit extractor metadata for stable bytes. The
reader restores an empty metadata object.

## Resolved callable data

The compiler records each parameter and result, including overloads. Each record
has a Python type, direction, source path, and conversion result. One resolved
module model serves declarations, call wrappers, and return validators.

Each value conversion uses revision 2 of
[value-contracts.v2.json](value-contracts.v2.json). Do not infer a wire rule
from the TypeScript type.

| Case                  | Result                                                                                |
| --------------------- | ------------------------------------------------------------------------------------- |
| `int`                 | JSON number, JavaScript number, safe-integer constraint                               |
| `bytes`               | Existing base64 envelope, decoded as `Uint8Array`                                     |
| nested `dict[str, T]` | JSON record with the child conversion at every value path                             |
| `str \| int`          | Selected union alternative with one child contract per option                         |
| `tuple[int, str]`     | Exact JSON array with a contract for each index                                       |
| float16 ndarray       | Existing Arrow or JSON-fallback envelope, decoded as a numeric scalar or nested array |
| float16 Torch tensor  | Outer `torch.float16` envelope with a nested `float16` ndarray                        |

The compiler requires an explicit float16 dtype. An untyped ndarray or Torch
tensor stays unresolved.

For an evaluated PyTorch annotation, use `torch.HalfTensor`. The compiler
accepts this exact class and leaves other Torch tensor classes unresolved.

NumPy can spell `NDArray[np.float16]` as
`numpy.ndarray[tuple[Any, ...], numpy.dtype[numpy.float16]]`. The compiler reads
the dtype argument, not the shape wildcard. Only a supported scientific result
clears its matching external-annotation IR warning. Other external annotations
remain warnings.

The codec records scalar ndarray dtype and rank for one call. A generated return
validator accepts a scalar only with matching proof. Nested proof follows its
parent and array index or record key. Array index `0` and `"0"` refer to the
same child. Equal numbers from separate calls do not share proof. Array and
tensor objects keep their identity-based marker proof.

The compiler keeps Arrow int64 behavior outside this prototype. Existing Arrow
int64 values can decode as `bigint`.

Selected local non-generic `TypedDict` classes use revision-2 record contracts
when every field has a supported conversion. Selected simple aliases use their
underlying supported contract. Foreign and recursive names remain unresolved.

## Diagnostics and fallback

Known unsupported cases create error diagnostics. The compiler changes the
affected generated type to `unknown`. `generate()` returns each diagnostic as a
warning, so `--fail-on-warn` rejects strict builds.

- The default compiler capability covers coroutine execution in the in-repo Node
  and Pyodide bridges. A caller can mark this capability unavailable when it
  uses an older or custom bridge. The compiler then emits `unknown` and an error
  diagnostic for async results.
- Dataclasses require an adapter owned by #339. The default capability stays
  unavailable. An explicit output record conversion can use the adapter
  capability when enabled.
- Non-string record keys require an explicit conversion.

Unresolved annotations create warning diagnostics. Their result type is
`unknown`, including an output that contains `object` or a type variable. Python
`object` can hold a primitive value. A type variable has no validated conversion
to the decoded result. Neither annotation justifies a precise TypeScript return.

The compiler keeps an existing best-effort return check when it widens a
declaration. For example, an unresolved `list[object]` still rejects a non-array
result, and a `DataFrame` annotation still requires a decoded marker.

`Literal` returns keep their exact-value validator, but stay `unknown` until a
literal value contract exists. Unresolved literal overloads cannot select a
precise return at runtime.

IR overload signatures stay separate from the implementation signature. The
extractor collects type variables from overload annotations. Generated
declarations retain each input-to-result relation. The hidden TypeScript
implementation accepts `unknown` values so it can cover every declared overload.

At runtime, the wrapper selects the first supported overload that matches bound
arguments. This follows TypeScript declaration order. The compiler warns when
overload inputs may overlap, including an omitted optional argument. Python 3.10
cannot expose registered overloads through `typing.get_overloads`; it keeps the
implementation signature and emits an IR warning.

## Deferred work

Revision 2 does not describe references or recursive aliases. The compiler
reports these cases as unresolved. A later value-contract revision can give them
a supported conversion.

The client-binding work may consume the resolved callable model later. It must
remain opt-in. It must not add files to default generation or mutate the global
runtime registry.
