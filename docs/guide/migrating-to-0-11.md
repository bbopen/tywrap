# Migrating to 0.11

This guide covers tywrap 0.11.0 and tywrap-ir 0.3.1.

## Large Python integers

Python `int` results still use TypeScript `number`. The supported range is
`-9007199254740991` through `9007199254740991`, inclusive.

Earlier versions could round larger integers when JavaScript parsed the response.
The new serializer rejects those values before writing JSON. This applies to root
results, nested containers, supported NumPy scalars, and model dumps.

For example, a result containing `{"items": [9007199254740993]}` now fails at
`result.items[0]`. The error identifies the unsafe value and suggests an explicit
string or an Arrow integer column.

Return a string when the value represents an identifier or must remain an exact
decimal integer:

```python
def large_identifier() -> str:
    return str(9007199254740993)
```

The generated return type is `Promise<string>`. Convert that string with
JavaScript `BigInt` if your application needs integer arithmetic. Validate any
string that comes from an untrusted source before using it.

Keep integer columns in Arrow tables when you need the existing Arrow int64
representation. Arrow int64 remains exact and can decode as JavaScript `bigint`.
JSON fallback does not provide that representation and rejects unsafe integers.

Booleans and finite floats remain supported. Converting an integer to a Python
`float` can lose precision before tywrap receives it. Use a string when exactness
matters. Tagged bigint transport remains a separate design proposal.

## NumPy and Torch float16

The Arrow decoder now converts float16 storage words into their numeric values
before reshaping the result. For example, `[15872, 49280]` becomes the intended
`[1.5, -2.25]`. Remove application code that manually decodes those storage words.

The conversion preserves signed zero, finite subnormal values, and finite extrema.
NumPy arrays and nested Torch tensors use the same conversion. Non-finite results
continue to reject under the existing policy.

The scientific envelope format, JSON fallback, and Arrow int64 behavior stay
compatible. Torch bfloat16 keeps its existing float32 transport conversion.

## Return types that cannot be validated

An unresolved Python `object` result now produces `Promise<unknown>`. Python
objects can include strings and numbers, which TypeScript's `object` type excludes.

An unresolved generic result also becomes `unknown`. Earlier wrappers could
declare `Promise<T>` while accepting any returned value. A generic input remains
generic, but its type alone cannot prove that Python returned the same type.
This also applies when the unresolved type parameter appears in a nested result.

Generation reports the unresolved conversion. `--fail-on-warn` rejects that
diagnostic. Use a supported concrete return annotation or overload when the
Python API has a known result type. Otherwise, check the value before using it:

```ts
const result = await generatedFunction(input);
if (typeof result !== 'string') {
  throw new TypeError('Expected a string result');
}
console.log(result.toUpperCase());
```

The current value contract does not resolve every Python annotation. For example,
`Literal` results become `unknown`, while their existing literal checks remain.
Other unresolved returns retain available marker, container or record checks.
These partial checks do not prove a precise TypeScript return type.
Type-only Protocol methods keep their declared generic signatures.

Supported string and integer overloads retain their corresponding return types.
Use Python 3.11 or later to extract registered overloads. Python 3.10 keeps the
implementation signature when its typing module cannot expose the overloads.

## Coroutine results

The updated Node and Pyodide bridges await Python coroutine results. Generated
wrappers use the function's resolved result type, such as `Promise<string>`.
Upgrade the generator and runtime together, then regenerate wrappers.

An HTTP client still depends on its server. Use a compatible server that awaits
Python results; upgrading the TypeScript client does not update that server.

## Regenerate wrappers

Upgrade both packages:

```bash
npm install tywrap@0.11.0
python3 -m pip install --upgrade tywrap-ir==0.3.1
```

Use the Python executable selected by `runtime.node.pythonPath` and
`runtime.node.virtualEnv` instead of `python3` when your configuration differs.
The new extractor captures generic parameters used only in overload annotations.
Its IR schema remains `0.4.0`, so the schema check alone cannot detect an older
extractor or an older saved contract.

Extract fresh IR when regenerating:

```bash
npx tywrap generate --no-cache
```

This bypasses the on-disk IR cache. It does not replace existing cache entries.
If you enable caching again, first remove the old generated IR files from
`.tywrap/cache` so generation extracts and caches the updated contracts.

If you use `contractInput`, temporarily omit it to extract fresh contracts with
the updated Python package. Review each new `<module>.contract.json` in your
output directory. Replace the corresponding pinned input file with that contract,
or point `contractInput` to the new file. Then restore the setting.
The `--no-cache` option does not replace a pinned input contract.

Regenerate wrappers with the upgraded generator. Python `int` return validators
then check the safe integer range as well as the JavaScript value type.
Regeneration also applies the reviewed callable-contract diagnostics.

Update any tests that expected a rounded integer or float16 storage words.
Assert the corrected value or the specific conversion error instead.

Run your generated calls against the upgraded runtime before deploying them.
An old wrapper cannot add the new generated return checks by itself, although the
upgraded Python serializer still rejects unsafe integer results.
