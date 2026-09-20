# Architecture decision for 0.11

Decision: proceed with the reviewed core and retain the extensions as bounded
prototypes. This decision does not replace release checks or publication verification.

## Decision

Adopt the pure callable compiler and revision 2 value contracts for the 0.11
corrections. Keep exact-integer transport, dataclass transport, and explicit
runtime binding as bounded design prototypes until their separate production
integration is approved.

The callable compiler resolves validated Python IR before TypeScript emission.
Its result describes parameter binding, overloads, return representations,
validation, capabilities, and diagnostics. The generator consumes that result.
Interpreter discovery, caching, and file writes remain outside pure compilation.

A precise generated return type requires a supported conversion and validation
path. Unresolved results become unknown, with diagnostics. Existing partial
runtime checks remain useful but cannot justify a precise declaration by themselves.
Type-only Protocol methods retain their declared signatures.

Python serialization and TypeScript decoding remain separate implementations.
The value contracts and independent end-to-end tests bind their behavior. This
change does not claim that both languages execute one shared codec implementation.

## What the design now proves

| Case | Verified path | Evidence |
| --- | --- | --- |
| Safe integers | Python rejects unsafe integers before JSON; generated validators enforce safe integer results; clean consumers exercise boundaries and rejection. | Accepted numeric and consumer histories; integrated [CI 35503216347](https://github.com/bbopen/tywrap/actions/runs/35503216347). |
| Float16 values | Real NumPy and Torch annotations pass analysis, generated typing, TypeScript compilation, bridge execution, decoding, and validation. Wrong dtype rejects. | NumPy conformance `1736b68`; real Torch `4db7002`, [CI 35503315287](https://github.com/bbopen/tywrap/actions/runs/35503315287). |
| Nested overload results | Generated overloads retain supported input/output relationships. Strict consumer compilation rejects invalid calls, and runtime validation rejects a wrong selected result. | Independent conformance `1736b68`, [CI 35500783650](https://github.com/bbopen/tywrap/actions/runs/35500783650). |
| Coroutine results | Generated implementations and declarations return Promise<string> without warnings. Node and actual Pyodide execute the calls and retain cancellation/reuse checks. | `54cef7c`, [CI 35503202358](https://github.com/bbopen/tywrap/actions/runs/35503202358). |

The numeric oracle checks every finite binary16 storage word against Python's
standard-library decoder. Mutation tests reject incorrect dtype, shape, codec
version, encoding, capability, and contract information.

Independent review also tested union ambiguity against the actual decoders. Core
correction `b11dae6` rejects colliding bytes and scientific records, including
extra keys and optional legacy fields. It preserves the reviewed disjoint
alternatives. [CI 35505214309](https://github.com/bbopen/tywrap/actions/runs/35505214309)
passed; `9e87968` changes only formatting. The combined merge still needs its
own complete checks.

## Extension decisions

The Point prototype at `f41bb44` uses actual Python analysis and a private adapter.
It derives field checks from the resolved contract and verifies capability before
dispatch. This is evidence for a dataclass design, not default dataclass support.

The explicit binding prototype at `65bed95` derives legacy and bound renderings
from one compiled module and generator. Handles borrow a call-capable runtime;
disposing a handle does not dispose the shared bridge. Tests cover two Python
environments, registry compatibility, failures, reload, disposal, and mixed runtimes.
It has no public generation option or production output integration.

Binding increases generated source by 38.5% and 27.0% in two measured fixtures.
Declarations increase by 164.8% and 117.0%. Public integration needs an explicit
size budget and should consider sharing declarations.

Exact integers use a separate revision 3 prototype. Revision 2 continues to use
safe JavaScript numbers. The proposed v3 leaf uses a decimal-string envelope and
JavaScript bigint. Runtime capability must be checked before any tagged request.
Source `1862f3e` passed full CI and independent review. Generated proof `d06e4fa`
passed nested round trips, validation and byte-limit checks on Linux, macOS and
Windows. The independently reviewed follow-up `577800b` adds nested version
rejection and preserves the accepted source files. The combined candidate must
pass complete CI. This evidence does not establish default production bigint
transport.

Measured compact argument envelopes grew from 28 to 247 bytes for a safe-integer
fixture and from 91 to 310 bytes for a larger-integer fixture. These measurements
cover argument envelopes, not complete RPC traffic. Default v2 safe-number
behavior and existing Arrow int64 semantics remain unchanged.

## Compatibility and performance

The default wire protocol remains tywrap/1. Unsafe JSON integers now reject instead
of risking rounding. Float16 values decode as numbers rather than storage words.
Some unresolved return annotations become unknown. Users must regenerate wrappers
and upgrade the matching runtime; migration guidance describes these changes.

At integrated `737fcff`, all 25 performance/framing tests passed, as did the full
release-command CI run. The 20 MiB chunked response took 1.89 times its same-run
single-frame control, within the 3.5-times budget. Retained heap for an 80 MiB
response was 160 MiB, within the 384 MiB budget.

These controls are not a benchmark against the published 0.10 package. They do not
prove zero release-to-release regression or measure Python application throughput.
The complete final candidate must pass the checks again after remaining changes.

## Release conditions

The architecture verdict is proceed. Independent source and prototype reviews
support the selected design. This verdict does not replace release acceptance.

The combined candidate must pass `CI=1 npm run check:all`, the required matrix,
scientific and consumer proofs, browser checks, and performance budgets. Its
repository reviews and CodeRabbit conversations must be resolved before merge.
Publication must verify both package versions and execute fresh installed
registry artifacts. No prototype is promoted to default production support by
this decision.
