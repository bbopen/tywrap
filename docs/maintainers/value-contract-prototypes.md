# Value extension prototypes

These rules are candidates for #337 and #339. They do not change the 0.11 codec policy. The prototypes live under `test/prototypes` and cannot enable either feature in shipped wrappers.

## Exact integer option

The generation option is `integerMode: 'bigint'` for one callable. It changes every Python `int` in that callable's parameters and result to TypeScript `bigint`. Safe integers use the same type as large integers in this mode. Python `bool` remains `boolean`. Calls without the option keep the safe `number` rule.

The generated wrapper first calls `meta` and requires `valueCapabilities` to contain `exactIntegerDecimalV2`. The option then travels on each `call` request as `params.valuePolicy.integer = 'bigint-v2'`. A new bridge rejects an unknown value policy. An old bridge lacks the capability, so the wrapper rejects it before sending a tagged value. A new bridge sends tagged integers only for an opted call. Existing clients never opt in.

The version 2 integer envelope is `{"__tywrap__":"integer","codecVersion":2,"encoding":"decimal","value":"18446744073709551617"}`. The `value` string must match `^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$`. This rejects `-0`, leading zeros, a leading plus, spaces, exponents, and Unicode digits. It allows at most 4096 decimal digits, excluding the sign. The ASCII value occupies at most 4097 bytes. The existing request and response payload byte limits still apply to the whole message. Both decoders reject an unknown version, extra envelope fields, an invalid decimal, or an oversized value before calling `BigInt` or Python `int`.

The request encoder tags every `bigint`, including safe values. The Python request decoder yields `int`. The Python response encoder tags every `int`, including safe values. The TypeScript response decoder yields `bigint`. Both walk nested arrays and string-keyed records within the existing depth and node limits. They reject cycles and unsupported values with paths. Arrow int64 keeps its existing Arrow encoding and decoded type.

The generated return validator requires `bigint` at every integer node. It must reject an ordinary number and a raw tagged record. A wrapper with `integerMode: 'bigint'` therefore cannot expose `Promise<number>` for a Python integer.

The bounded prototype must round trip positive and negative values larger than 64 bits through nested arrays and records in both directions. It must test malformed envelopes, the 4096-digit boundary, whole-message byte limits, and old/new bridge combinations. Production work needs a separate review of capability negotiation, generated types, and migration cost.

## Dataclass output option

The generation option is `dataclassReturns: 'validated-v2'` for a callable with an annotated dataclass result. Dataclass inputs remain unsupported. An ordinary class instance does not qualify. The generator compiles `dataclasses.fields` into a structural TypeScript record. It includes fields with defaults and `init=False` because an instance returns them. `Optional[T]` permits `null`; a default does not make the returned property optional.

The generated wrapper first calls `meta` and requires `valueCapabilities` to contain `dataclassFieldsV2`. It sends `params.valuePolicy.dataclass = 'fields-v2'` on each call. The Python encoder accepts only the compiled dataclass type. It emits a version 2 envelope with the canonical `module.qualname` identity and an ordered `fields` record. It rejects unsupported fields and cycles with paths. It uses the existing depth, node, and payload limits. It does not call `dataclasses.asdict` or create object handles.

The TypeScript decoder validates the marker, version, encoding, type identity, and field record before it strips the envelope. It returns a plain record and stores its verified type identity in a module-private `WeakMap`. The generated return validator reads that `WeakMap` before it checks exact keys and field values. An ordinary record cannot claim dataclass origin, even if it has matching keys. A nested dataclass gets its own verified entry. A malformed or unknown version fails before the decoder returns a record.

The bounded prototype must show a generated `Promise<Point>` wrapper returning `{x: 1, y: 2}` from the actual compiler model. It must reject missing, extra, and wrong typed fields. It must test optional/defaulted fields, nesting, cycles, unsupported fields, depth, and byte limits. Production work needs an independent review of identity, generated types, and migration cost.
