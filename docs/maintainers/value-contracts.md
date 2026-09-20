# Value contracts

The frozen internal prototype is [value-contracts.v2.json](value-contracts.v2.json).
That JSON file owns the policy. The TypeScript interface mirrors it and has revision 2.

Each contract names a logical value, its wire encoding, its decoded JavaScript value, and its constraints. Sequences, fixed tuples, records, and unions compose child contracts. A union has two to 32 alternatives. The compiler rejects a union if one wire value could decode two ways. Contract depth stops at 64. Named records can inline within that limit. Recursive aliases stay unsupported until a reviewed reference graph exists. The prototype covers float16 ndarrays and Torch tensors. Other Arrow types keep their existing rules. In particular, Arrow int64 may decode as `bigint`. Unsupported conversions carry a reason and guidance.

The wire stays at `tywrap/1` and scientific `codecVersion: 1`. Existing Arrow envelopes, JSON fallback, and transports keep their shape. The producer rejects unsafe Python integers before it writes JSON. A generated wrapper that consumes this interface must keep `number` for Python `int` and add a safe-integer return constraint. Regenerate wrappers after that compiler change. Do not return `bigint` under an existing `Promise<number>`.

Migration for users with large Python integers: convert them to strings in Python with an explicit return annotation, or keep integer columns in Arrow tables. JSON fallback for ndarray and pandas values still rejects unsafe integers. This is a behavior change from silent rounding to a call error.

The [fixed proof fixtures](value-contract-fixtures.v2.json) cover integer boundaries, binary16 values, unions, fixed tuples, and nested paths. The focused tests also compare every finite binary16 storage word with an independent float32 bit reference. They test signed zero with `Object.is`.

The Python serializer checks plain integers, NumPy scalar integers, and model dumps during its existing value walk. It also checks terminal estimator parameters and Series name metadata before JSON output. A JSON ndarray or sparse matrix checks integer data before it creates an envelope. Sparse metadata checks shapes and indices. The TypeScript decoder converts float16 Arrow storage during extraction, before it reshapes the ndarray. Torch uses that same ndarray path. These checks do not walk Arrow payloads again for schema validation.

## Exact bigint extension for #337

This extension is a design sketch. The 0.11 policy still rejects unsafe plain Python integers.

Choose an explicit callable option, `integerMode: 'bigint'`. When enabled, map Python `int` to TypeScript `bigint` for both parameters and returns. The return validator must require `typeof value === 'bigint'`, including every record and sequence member. Keep `bool` separate. Calls without the option keep `number` and the safe range.

Add a version 2 integer value envelope with a canonical signed decimal string. A sample value is `{"__tywrap__":"integer","codecVersion":2,"encoding":"decimal","value":"18446744073709551617"}`. The request encoder and Python request decoder must validate the same grammar and digit limit. The response encoder and TypeScript decoder must do the same. Use `BigInt` only after validation. Keep Arrow int64 columns on their current Arrow path.

The bridge must advertise exact integer support during capability negotiation. A generated bigint wrapper must reject an older bridge before its first call. The new bridge must emit version 2 integer envelopes only when the call opts in. An older client therefore continues to receive the 0.11 safe integer policy. Unknown integer envelopes, mixed versions, oversized strings, and malformed decimal values must fail with a path. Do not guess a conversion.

Acceptance evidence still needed: a bounded prototype must round trip positive and negative values beyond 64 bits through nested records and arrays. It must test bigint inputs, malformed tags, payload limits, and both mixed-version directions. An independent review must approve the wire grammar, capability rule, generated types, and migration cost before #337 can close.

## Dataclass return extension for #339

This extension is a design sketch. Dataclass inputs remain unsupported and need a separate input contract. Users must pass a plain record through an explicitly typed function if they need that behavior now.

For an annotated dataclass return, compile a structural TypeScript record from `dataclasses.fields`. Include each instance field in the output, including fields with defaults or `init=False`. A default does not make a returned field optional. A field annotated `Optional[T]` permits `null`. Compose nested dataclasses, records, and sequences only when every field has a supported value contract. Reject ordinary class instances and unsupported fields with their result paths.

Use a version 2 dataclass envelope with a declared type identity and a `fields` record. For example, `Point(1, 2)` would carry `{"__tywrap__":"dataclass","codecVersion":2,"encoding":"fields","type":"fixtures.values_torture.Point","fields":{"x":1,"y":2}}`. The TypeScript decoder returns `{x: 1, y: 2}`. The generated validator must check the type identity, exact field names, field values, and required fields. It must reject extra fields unless the compiled contract allows them. The Python encoder must use the current bounded value walk. It must detect cycles and enforce depth, node, and payload limits without calling `dataclasses.asdict` as a shortcut.

The bridge must advertise dataclass value support. A generated dataclass wrapper must reject an older bridge before calling it. A new bridge must send the envelope only when the wrapper requests it. This leaves existing value RPC and ordinary class behavior unchanged.

Acceptance evidence still needed: a generated `Promise<Point>` wrapper must return the exact plain record and reject missing, extra, or wrong typed fields. Tests must cover optional and defaulted fields, nested values, cycles, unsupported fields, depth, and payload limits. An independent review must approve the type identity, version rule, and migration cost before #339 can close.
