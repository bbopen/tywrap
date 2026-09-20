# Value extension prototypes

These rules are candidates for #337 and #339. They do not change the 0.11 codec
policy. The prototypes live under `test/prototypes`. Shipped wrappers cannot
import them.

## Exact integer option

The generation option is `integerMode: 'bigint'` for one callable. It maps every
Python `int` parameter and result to TypeScript `bigint`. Safe integers use the
same type. Python `bool` remains `boolean`. Calls without the option keep the
safe `number` rule.

The generated wrapper requires `exactIntegerDecimalV2` in the bridge's
`meta.valueCapabilities`. It sends `params.valuePolicy.integer = 'bigint-v2'` on
each call. A new bridge rejects unknown policies. An old bridge lacks the
capability, so the wrapper rejects the call before sending a tag.

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
generated return validator must require `bigint`. It must reject an ordinary
number and a raw tag. Arrow int64 keeps its current Arrow encoding and decoded
type.

Both prototypes walk nested arrays and string-keyed records within depth and
node limits. They reject unsupported values and malformed envelopes. Encoders
reject cycles with paths. Ordinary records cannot use `__tywrap__` as a key
because the decoder reserves it for envelopes.

The prototype counts UTF-8 bytes of compact JSON. Python emits Unicode
characters directly, as `JSON.stringify` does. Both paths reject unpaired
surrogates. Production must check raw wire bytes before parsing; object-level
checks do not prove equal byte counts for alternate numeric JSON spellings.

The bounded tests must round trip positive and negative values beyond 64 bits.
They must cover floats, booleans, nested records, malformed tags, digit limits,
byte limits, and old bridges. Production work needs separate review of
capability negotiation, generated types, and migration cost.

## Dataclass output option

The generation option is `dataclassReturns: 'validated-v2'` for a callable with
an annotated dataclass result. Dataclass inputs remain unsupported. Ordinary
class instances do not qualify.

The generator compiles `dataclasses.fields` into a structural TypeScript record.
It includes fields with defaults and `init=False`. An instance returns those
fields. `Optional[T]` permits `null`; a default does not make a returned
property optional.

The generated wrapper requires `dataclassFieldsV2` in `meta.valueCapabilities`.
It sends `params.valuePolicy.dataclass = 'fields-v2'` on each call. The Python
encoder accepts only the compiled dataclass type. It emits a version 2 envelope
with `module.qualname` identity and an ordered `fields` record. It rejects
unsupported fields and cycles with paths. It applies depth, node, and byte
limits. It does not call `dataclasses.asdict` or create object handles.

The TypeScript decoder checks marker, version, encoding, type identity, and
fields before it removes the envelope. It returns a plain record. A
module-private `WeakMap` stores verified type identity. The return validator
reads that entry before it checks field keys and values. A plain record cannot
claim dataclass origin. A nested dataclass gets its own entry.

The Python prototype checks the declared root dataclass type. It serializes
nested dataclasses by their observed runtime type and does not check a compiled
field contract. The TypeScript decoder rejects unexpected nested identities or
field values. Server-side field validation remains open.

The bounded prototype still needs a generated `Promise<Point>` wrapper from the
actual compiler model. It must return `{x: 1, y: 2}` and reject missing, extra,
and wrong typed fields. It must test defaults, optional fields, nesting, cycles,
unsupported fields, depth, and byte limits. Production work needs independent
review of identity, generated types, and migration cost.
