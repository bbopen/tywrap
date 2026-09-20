# Value extension prototypes

These rules are candidates for #337 and #339. They do not change the 0.11 codec
policy. The prototypes live under `test/prototypes`. Shipped wrappers cannot
import them.

## Exact integer option

The proposed public option is `integerMode: 'bigint'` for one callable. It would
map every Python `int` parameter and result to TypeScript `bigint`. Safe
integers use the same type. Python `bool` remains `boolean`. Calls without the
option keep the safe `number` rule.

The default value-contract revision 2 represents Python `int` as a safe JSON
`number`. The bounded revision 3 compiler proof selects
`EXACT_INTEGER_VALUE_CONVERSION` for a module with one callable. It emits a
`bigint` wrapper and validator through a test-only runtime binding. A public
per-callable option and production bridge adapter are not implemented.

The proposed generated wrapper must require `exactIntegerDecimalV2` in the
bridge's `meta.valueCapabilities`. It must send
`params.valuePolicy.integer = 'bigint-v2'` on each call. A new bridge must
reject unknown policies. An old bridge lacks the capability, so the wrapper must
reject the call before sending a tag. The bound proof checks the capability
before its private adapter encodes arguments. That adapter sends the policy to
the Python prototype. The default bridge does not implement this mode.

The version 2 integer envelope is
`{"__tywrap__":"integer","codecVersion":2,"encoding":"decimal","value":"18446744073709551617"}`.
`codecVersion` uses the parsed JSON numeric value. The lexemes `2`, `2.0`, and
`2e0` all mean version 2. Booleans and strings do not. The decimal must match
`^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$`. This excludes `-0`, leading zeros, plus
signs, spaces, exponents, and Unicode digits. The value permits at most 4096
digits, excluding the sign. It uses at most 4097 ASCII bytes. Whole request and
response byte limits still apply.

The TypeScript encoder tags every `bigint`, including safe values. The Python
request decoder requires the tag at each declared integer node. It rejects raw
JSON numbers there. It uses the trusted resolved value contract to distinguish
integer nodes from float nodes. A generated wrapper must not let a client supply
or change that contract.

`JSON.stringify(1.0)` emits `1`. The Python decoder converts that token to
`float` only at a declared float node. `JSON.stringify(-0)` emits `0`, so the
TypeScript encoder uses
`{"__tywrap__":"float","codecVersion":2,"encoding":"negative-zero"}` for
negative zero. The Python decoder accepts that tag only at a float node. It
rejects malformed float tags and nonfinite numbers.

The Python response encoder tags every `int`, including safe values. The
TypeScript response decoder returns `bigint` at declared integer nodes. The
generated revision 3 return validator requires `bigint`. The prototype decoder
rejects an ordinary number and a raw tag. Arrow int64 keeps its current Arrow
encoding and decoded type.

Both prototypes walk nested arrays and string-keyed records within depth and
node limits. They reject unsupported values and malformed envelopes. Encoders
reject cycles with paths. Ordinary records cannot use `__tywrap__` as a key
because the decoder reserves it for envelopes.

The prototype counts UTF-8 bytes of compact JSON. Python emits Unicode
characters directly, as `JSON.stringify` does. Both paths reject unpaired
surrogates. Production must check raw wire bytes before parsing; object-level
checks do not prove equal byte counts for alternate numeric JSON spellings.

The bounded tests round trip positive and negative values beyond 64 bits. They
cover floats, booleans, nested records, malformed tags, digit limits, byte
limits, and old bridges. `test/value_extensions_generated_integer.test.ts` uses
analyzer IR to check `bigint` input, `bigint[]` input, `Promise<bigint>` output,
and the generated bigint return validator. It also checks signed zero and that
an incapable bridge receives no exact request. The same fixture under revision 2
keeps `number` types and uses an ordinary call. Production still needs a public
opt-in selector, bridge capability negotiation, and application migration
measurements.

### Exact integer migration cost

Opting in changes every declared Python `int` at that callable to TypeScript
`bigint`, including values within the safe number range. Callers must update
number arithmetic, comparisons, and stored JSON. `JSON.stringify` rejects a
plain `bigint`, so callers that persist results need an explicit encoding.

Each tagged integer adds 73 JSON bytes beyond its decimal digits. For example,
`7` uses one byte as a JSON number and 74 bytes in the version 2 envelope.
Nested collections multiply that cost by their integer count. Teams must measure
representative call payloads against the byte limit before enabling the option.

For a compact `{"args": [...]}` payload with three integers, a boolean, and a
float, the safe-value example grows from 28 to 247 UTF-8 bytes (8.82 times).
Using one 81-bit and one 131-bit integer grows the same shape from 91 to 310
bytes (3.41 times). These figures exclude the surrounding RPC envelope and do
not estimate application traffic.

The client must check the bridge capability before it sends tagged values. This
requires a coordinated client and bridge rollout. Old bridges reject the opted
call. Arrow int64 columns keep their current type and wire format.

Before production adoption, inventory generated call sites that use `int`,
measure payload growth, and typecheck downstream callers after the opt-in. The
prototype has not measured those application-specific costs.

## Dataclass output option

The generation option is `dataclassReturns: 'validated-v2'` for a callable with
an annotated dataclass result. Dataclass inputs remain unsupported. Ordinary
class instances do not qualify.

The generator compiles `dataclasses.fields` into a structural TypeScript record.
It includes fields with defaults and `init=False`. An instance returns those
fields. `Optional[T]` permits `null`; a default does not make a returned
property optional.

The proposed generated wrapper must require `dataclassFieldsV2` in
`meta.valueCapabilities`. It must send
`params.valuePolicy.dataclass = 'fields-v2'` on each call. The Python prototype
encoder accepts only the declared dataclass type. It emits a version 2 envelope
with `module.qualname` identity and an ordered `fields` record. It rejects
unsupported fields and cycles with paths. It applies depth, node, and byte
limits. It does not call `dataclasses.asdict` or create object handles.

The TypeScript prototype decoder checks marker, version, encoding, type
identity, and exact fields before it removes the envelope. It returns a plain
record. A module-private `WeakMap` stores verified type identity. The prototype
origin check reads that entry. A plain record cannot claim dataclass origin. A
nested dataclass gets its own entry. The current generated return validator
checks required field types but does not check origin or reject extra keys. The
adapter must perform those checks before it calls the validator.

The Python prototype checks the declared root dataclass type. It serializes
nested dataclasses by their observed runtime type and does not check a compiled
field contract. The TypeScript decoder rejects unexpected nested identities or
field values. Server-side field validation remains open.

The bounded Point proof in `test/value_extensions_generated_point.test.ts` uses
analyzer IR from an importable Python module. The compiler emits
`Promise<Point>` with required numeric `x` and `y`, including a defaulted `y`. A
bound prototype adapter returns `{x: 1, y: 2}` and rejects missing, extra, wrong
typed fields, and untagged records before the generated validator runs. The
generated validator independently rejects wrong field types. The binding rejects
a bridge without the Point policy adapter.

The Python prototype tests optional fields, nesting, cycles, unsupported fields,
depth, and byte limits separately. Production still needs bridge capability
negotiation, a server-side compiled field contract, and an independent design
review. The default runtime has no dataclass adapter.
