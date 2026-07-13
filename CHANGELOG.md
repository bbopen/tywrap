# Changelog

## [0.10.0](https://github.com/bbopen/tywrap/compare/v0.9.0...v0.10.0) (2026-07-13)

The scientific codec correctness release. Codec envelopes for numpy, pandas, scipy, torch, and sklearn now compose inside ordinary containers, validate what they claim, and refuse to serialize what they cannot preserve. Every behavior change in this release landed by flipping named rows in the menagerie truth table, and the pinned scientific CI job holds the line against library drift.

### Breaking

- **The ndarray JSON path stops lying (#308).** JSON ndarray envelopes now declare a canonical NumPy `dtype`, and the producer preflights the JSON domain: integers outside the JavaScript safe range, `datetime64`/`timedelta64`, big-endian dtypes, structured/object/string/complex arrays, and floats wider than 64 bits all reject with a conversion recipe instead of rounding, retyping, or erasing silently. `float16` stays supported and now declares itself. The Arrow path is unchanged.
- **The pandas JSON path stops lying (#312).** The DataFrame/Series JSON producers reject non-default indexes, `MultiIndex`, duplicate column labels (including labels that collide only after JSON key coercion, such as `1` and `"1"`), categorical dtypes, and non-scalar object cells, each with a recipe. `None`/`pd.NA`/`pd.NaT` become `null`; float `NaN` and `Inf` reject loudly instead of conflating a value with missing data. Zero-column frames keep their row count. NumPy scalars in object columns normalize and keep working.
- **Corrupt envelopes reject at decode (#306).** The JavaScript decoder validates `codecVersion: 1` envelopes instead of trusting them: shapes must be non-negative safe integers, declared dtypes must be present where the producer always emits them, JSON nesting and element counts must match the declared shape, Arrow extraction failures reject instead of returning empty arrays, Torch outer and nested shapes must agree exactly, and SciPy data must fit its declared dtype and 8/16/32-bit integer ranges. Scientific validation failures carry their own error text instead of being mislabeled as Arrow failures.
- **The synchronous decode path rejects scientific envelopes.** Scientific values always travel the async path; the sync path now fails with guidance instead of leaking raw envelope objects.

### Features

- **Nested composition (#309, #311).** Dict, list, and tuple returns can carry DataFrames, Series, ndarrays, sparse matrices, tensors, and estimator metadata at any depth. Both sides walk containers iteratively with cycle detection and path-bearing errors (`result.items[3].matrix`), a producer depth bound of 900 (under CPython's own recursion ceiling, so failures are tywrap's clear error rather than a `RecursionError`), a decoder depth bound of 2048, and container-only traversal budgets that leave large payload data untouched. Multi-output shapes such as a dict of a DataFrame plus an ndarray round-trip typed.
- **Runtime return validation covers all six markers (#307).** SciPy sparse, Torch tensor, and sklearn estimator returns now carry decoded provenance and validate against generated return schemas, the same way DataFrame, Series, and ndarray returns have since 0.9.0.
- **Torch bfloat16 transports exactly (#310).** bfloat16 tensors upcast to float32, which is exact for every bfloat16 value, and the envelope records `sourceDtype: 'torch.bfloat16'`. Opt-in device copies record `sourceDevice`. The supported dtype matrix (float16/32/64, int8 through int64, uint8, bool) is pinned by tests.
- **0-D arrays work on the Arrow path (#306).** Scalar ndarrays and scalar tensors round-trip instead of failing in `pa.array`.
- **The menagerie is executable truth (#305).** 101 one-call rows, each a named test asserting honest round-trip, documented loss, or loud failure, run in CI against pinned numpy 2.3.5, pandas 3.0.2, pyarrow 24.0.0, scipy 1.16.3, scikit-learn 1.8.0, and CPU torch 2.10.0.
- **Docs for agents and maintainers (#304, #315).** A deterministic adoption guide with expected output per step and a failure-signature table mapping exact error prefixes to fixes; a pipeline architecture reference; the menagerie discipline; a codec envelope reference; and a rewritten configuration guide that matches the real schema. The llms.txt index and bundle carry all of it.

### Internal

- Decode errors are typed (`ScientificDecodeError` with kind and marker) instead of being classified by message sniffing; the six-marker set is defined once; duplicated ndarray/tensor decode finishing and strict-versus-legacy field policies are extracted; Python JSON primitives share one safe-integer constant and key-coercion path (#314).
- `tywrap-ir` is unchanged at `0.3.0` (IR schema `0.4.0`); generated wrappers from 0.9.0 remain compatible.

## [0.9.0](https://github.com/bbopen/tywrap/compare/v0.8.0...v0.9.0) (2026-07-11)

Typed value-RPC, one job done well. 0.9.0 removes the stateful instance API whose handles silently broke under pooling, collapses the transport stack it no longer needs, and makes the generated types tell the truth: a type you see in a generated wrapper is now either backed by a declaration and a codec, or it is `unknown` — and what comes back over the wire is validated against it at runtime. Generated wrappers must be regenerated: the IR schema is now `0.4.0` on both sides, and a version mismatch fails generation with a clear message.

### Breaking

- **The stateful instance API is gone ([#264](https://github.com/bbopen/tywrap/issues/264), [#265](https://github.com/bbopen/tywrap/issues/265), [#266](https://github.com/bbopen/tywrap/issues/266)).** A handle lived in one pool worker while calls routed to any worker, so instance methods returned wrong results under `maxProcesses > 1`. The server no longer accepts `instantiate`/`call_method`/`dispose_instance` (structured unknown-method error), the client and wire protocol are call-only (`call | meta`), and generated classes expose only static and classmethod members routed through ordinary calls. Classes that lose members carry a migration note pointing at value-returning module functions.
- **Generated types degrade honestly ([#267](https://github.com/bbopen/tywrap/issues/267)).** A return type tywrap cannot resolve to a local declaration or a codec-backed value is emitted as `unknown` instead of a bare, undeclared TypeScript name — and every degrade feeds the generation report, so `--fail-on-warn` builds fail on them by design. Two long-catalogued type lies are fixed with the same stroke: Python `bytes` maps to `Uint8Array` (what the decoder actually delivers), and `set[T]` maps to `T[]` (sets arrive as arrays; sending a `Set` was already a loud error). Iterator-protocol returns (`Generator`, `Iterator`, `AsyncGenerator`, `AsyncIterator`) degrade to `unknown` for the same reason: the bridge rejects iterator objects loudly at serialization, so those annotations could never carry a value — while `Iterable[T]`/`Sequence[T]` keep mapping to types an actually-decoded list satisfies.
- **Returns are validated at runtime ([#268](https://github.com/bbopen/tywrap/issues/268)).** Every generated module-function and static-method call checks the decoded result against its declared type before the promise resolves; a Python function annotated `-> int` that returns a string now throws `BridgeValidationError` (with the declared type, the received shape, and the call site) instead of surfacing as a mistyped `Promise<number>`. Columnar values are checked by provenance — marker, dims, dtype — so DataFrame/ndarray returns validate by shape and the Arrow fast path stays walk-free. `unknown`, `void`, and `Any` returns validate nothing, by design.
- **The IR is a pinned, versioned contract ([#269](https://github.com/bbopen/tywrap/issues/269)).** Generation writes `<module>.contract.json` next to the generated code — byte-stable across machines and Python processes — so `generate --check` flags drift; `contractInput` regenerates from the pinned file without spawning Python; and `IR_VERSION` is `0.4.0` on both sides, checked at generation time with an actionable mismatch error.
- **Call results are never cached, and requests get exactly one attempt.** The heuristic `enableCache` result cache is removed (a "pure function" guess that could serve stale results), along with the request retry machinery (retries could reuse an in-flight request id and cross-wire responses). Timeouts and errors surface to the caller unchanged — once.
- **The codec rejects what JSON would mangle.** `Map` and `Set` values in requests fail loudly with a conversion hint instead of serializing as `{}`; `bytesHandling: 'passthrough'` is removed; non-finite numbers keep failing as before.
- **Pool and transport defaults tightened.** `maxConcurrentPerProcess` defaults to `1` (the Python bridge is a serial loop; concurrency comes from more workers, and pipelining is explicit opt-in). Pool limits are validated at `NodeBridge` construction (synchronous throw) rather than first use. The `TYWRAP_TRANSPORT_CHUNKING`/`TYWRAP_TRANSPORT_FRAME_PROTOCOL`/`TYWRAP_TRANSPORT_MAX_FRAME_BYTES` negotiation env vars are gone: the npm package ships its own Python bridge, so version skew is impossible and `tywrap-frame/1` framing is simply always on for the subprocess transport.

### Features

- **Security model documented.** `SECURITY.md` states the bridge trust model — the two bounds are the `TYWRAP_ALLOWED_MODULES` allowlist and the on-by-default private-attribute block (`TYWRAP_ALLOW_PRIVATE_ATTRS` opts out) — plus the server-author contract for network exposure and private vulnerability reporting. ([#262](https://github.com/bbopen/tywrap/issues/262), [#263](https://github.com/bbopen/tywrap/issues/263))
- **Docs describe what the types actually cover** — annotation-derived typing with `unknown` fallbacks, not "full type safety"; Deno marked experimental and untested in CI. ([#261](https://github.com/bbopen/tywrap/issues/261))

### Internal

- The subprocess transport stack collapsed from six layers to a merged pool/transport with atomic threshold restarts: a restarting worker can never receive dispatches, cancelled requests never count toward restart thresholds, and disposal fences out racing restarts so no orphan Python process survives.
- Python-side codec unified: `safe_codec.py` merged into `tywrap_bridge_core.py`; plain values no longer cold-import the scientific stack (first-call serialize cost 1.6 s → microseconds); duplicate first frames surface the duplicate-sequence protocol error instead of silently resetting reassembly.
- The test suite was rebuilt around discrimination: an adversarial cross-library menagerie (`test/menagerie/`) catalogues every round-trip behavior as honest/loud/known, ~2,600 lines of vacuous or tautological tests were removed, and the resurrected adversarial suite caught real cross-PR interactions before they shipped.
- `tywrap-ir` is published as `0.3.0` (IR schema `0.4.0`).

## [0.8.0](https://github.com/bbopen/tywrap/compare/v0.7.0...v0.8.0) (2026-06-01)

The large-payload transport release — the second half of the scientific data plane. A result that exceeds a single JSONL line no longer has to fit on one line: the subprocess bridge splits it into frames and reassembles it byte-for-byte. The wire protocol is unchanged (`tywrap/1`); framing is a separate, additive `tywrap-frame/1` protocol negotiated at startup, so a 0.7.x bridge and a 0.8.0 client still talk, and an oversize payload sent to a bridge that cannot chunk fails loudly instead of silently truncating.

### Features

- **Chunked transport for large payloads (`tywrap-frame/1`, [#231](https://github.com/bbopen/tywrap/issues/231)).** When a request or response exceeds the JSONL line ceiling, the subprocess bridge fragments it into frames and reassembles them. It is negotiated through the `meta` handshake (no protocol-version bump), subprocess-only (HTTP and Pyodide stay single-frame), and slices on UTF-8 codepoint boundaries — no base64 inflation. `NodeBridge` enables chunking by default; it engages only above the frame ceiling, so typical small-payload traffic is unchanged, and raising `codec.maxPayloadBytes` is what carries genuinely large results. Reassembly is bounded — declared and accumulated bytes (default 10 MiB, tracking the codec cap), concurrent streams, and the timed-out-id set — so an oversized or buggy payload fails loud rather than exhausting memory.
- **Scientific envelopes fail clearly ([#234](https://github.com/bbopen/tywrap/issues/234)).** SciPy, Torch, and Sklearn envelopes now reject unsupported cases explicitly — complex/sparse/quantized/meta tensors, non-CPU or non-contiguous tensors without `TYWRAP_TORCH_ALLOW_COPY`, and non-JSON-safe sklearn params — with matching JS-side re-validation. Lossy and device-transfer paths stay opt-in; nothing silently degrades.

### Internal

- Expanded scientific-codec validation and a dedicated `data-plane-perf` CI job that gates the chunked large-payload paths with same-run-relative perf budgets seeded from the 0.7.0 baselines. ([#233](https://github.com/bbopen/tywrap/issues/233))
- `TransportCapabilities.supportsChunking` now reports the **configured** capability (static, like `supportsArrow`); whether the connected bridge actually negotiated framing is a separate runtime fact on `BridgeInfo.transport.supportsChunking`.
- Request cancellation is identity-exact: a timed-out or aborted request is skipped at every write point — including the stdin backpressure queue and mid-burst frames — bound to the exact pending entry, so an abandoned call never executes on the Python side.

## [0.7.0](https://github.com/bbopen/tywrap/compare/v0.6.1...v0.7.0) (2026-06-01)

The foundation half of the scientific data plane. It lands the measurement, capability, and Arrow-ergonomics groundwork the large-payload transport work (0.8.0) builds on, and captures Python class members the IR used to drop. The wire protocol is unchanged, so a 0.6.x bridge and a 0.7.0 client still talk.

### Breaking changes

**The IR schema is now `0.3.0` and captures more class members.** `tywrap-ir` reads `@classmethod`, `@property`, and `functools.cached_property` (via `inspect.classify_class_attrs`) and labels `@staticmethod` correctly. Generated wrappers gain `static` members for class/static methods and `readonly` getters for properties, so **generated output changes for any class that uses those decorators** — classes without them are byte-identical. Regenerate your wrappers after upgrading. The TS↔Python IR-version check enforces the bump.

### Features

- Arrow decoding is frictionless: the runtime auto-registers an `apache-arrow` decoder when the package is present, with no manual wiring. JSON fallback stays opt-in (`TYWRAP_CODEC_FALLBACK=json`), and a missing `apache-arrow` fails with a clear, actionable error instead of silent lossy output. ([#232](https://github.com/bbopen/tywrap/issues/232))
- Each backend reports a `TransportCapabilities` descriptor (`backend`, `supportsArrow`, `supportsBinary`, `supportsChunking`, `supportsStreaming`, `maxFrameBytes`), surfaced on the bridge via `capabilities()`, with a documented capability matrix. ([#235](https://github.com/bbopen/tywrap/issues/235))
- `tywrap/dev` gains a watch/reload end-to-end smoke and documented reload failure/recovery behavior. ([#228](https://github.com/bbopen/tywrap/issues/228))

### Internal

- Measure-first data-plane benchmarks (Arrow round-trip, 100k-row decode, size-guard overhead, pool throughput) land as baselines for 0.8.0's perf gates — no gating yet.
- `generate()` and `fetchPythonIr()` are decomposed (cognitive complexity 91→16), and a shared `BasePythonBridge` removes the duplicated RPC delegation across the three bridges.
- The bridge dispatches `@classmethod`/`@staticmethod` through a dotted `call('Class.method')` and reads `@property`/`cached_property` through `call_method`, with the private-attribute guard re-applied per dotted segment.

## [0.6.1](https://github.com/bbopen/tywrap/compare/v0.6.0...v0.6.1) (2026-05-31)

A maintenance release. Nothing you call changes — no API, behavior, or wire-protocol changes.

Internal cleanup only: removed two dead exports, broke the eleven worst complexity hotspots into smaller helpers with their output unchanged (cache-key generation, type-hint validation, the dev watch/reload paths, the subprocess write queue, module discovery, path and interpreter resolution, and an annotation-parser helper), and factored the duplicated request/response dispatch in the codec and RPC client into one path. The static-analysis actionable-complexity count dropped from 14 to 3 — the remaining three are deferred to 0.7.0 or left as-is on purpose.

## [0.6.0](https://github.com/bbopen/tywrap/compare/v0.5.1...v0.6.0) (2026-05-31)

A cleanup release. There are no new features — this is one breaking pass that renames much of the runtime vocabulary, trims the public API, and tightens a couple of defaults, so the churn happens once instead of dribbling across several releases. If you only use the high-level `tywrap()`, `generate()`, and `defineConfig()` API, most of this won't touch you. The wire protocol is unchanged, so a 0.5.x client and a 0.6.0 bridge still talk to each other.

### Breaking changes

**The root export is smaller.** `tywrap` now exports just its real public surface: `defineConfig`, `resolveConfig`, `generate`, the `tywrap` factory, the `Bridge*Error` classes, the Arrow/codec helpers, the runtime-detection functions, the public types, and `VERSION`. The codec and transport plumbing moved to the `tywrap/runtime` entrypoint:

- Import `SafeCodec` (now `BridgeCodec`), `CodecOptions`, and the `Transport` contract from `tywrap/runtime` instead of `tywrap`.
- The deprecated `RuntimeBridge` alias is removed. `NodeBridge`, `PyodideBridge`, and `HttpBridge` are still on their `tywrap/node`, `tywrap/pyodide`, and `tywrap/http` subpaths.

**Runtime classes were renamed** onto a consistent four-layer vocabulary — a Transport moves bytes, an RpcClient correlates requests, a Bridge is the public facade, a BridgeCodec serializes values. Only the identifiers change:

| Before | After |
|---|---|
| `ProcessIO` | `SubprocessTransport` |
| `HttpIO` | `HttpTransport` |
| `PyodideIO` | `PyodideTransport` |
| `SafeCodec` | `BridgeCodec` |
| `IntelligentCache` | `ArtifactCache` |
| `WorkerPool` | `TransportPool` |
| `PooledWorker` | `TransportLease` |

The `{ id, result | error }` RPC wrapper is now `RpcResponse` and the `{ __tywrap__: … }` typed-value wrapper is `ValueEnvelope`; both used to be called "envelope".

**Config validation is stricter.** Each section is validated on load and bad input is rejected with a clear message. The dead per-module `runtime` field is removed — it was never read; configure the runtime under the top-level `runtime` key.

**The Python bridge blocks private attribute access by default.** A call through the bridge can no longer `getattr` an underscore-prefixed name, which closes the `__globals__` / `__subclasses__` escape path. Generated wrappers never reference private names, so generated code is unaffected. Set `TYWRAP_ALLOW_PRIVATE_ATTRS=1` to opt out. You can also restrict which modules the bridge may import with `TYWRAP_ALLOWED_MODULES` (unrestricted by default).

### Bug Fixes

- `VERSION` reported `0.3.0` on a 0.5.x package; it's now single-sourced from `package.json` at build time.
- Module names are validated before they reach `python -c` in discovery, closing a command-injection path.

### Internal

Removed four dead modules (`bundle-optimizer`, `memory-profiler`, `optimized-node`, `protocol`), decomposed the worst complexity hotspots (codec decode, the annotation parser, the type mapper) with output preserved, and collapsed the generator's three duplicated call-emission paths into one. `IR_VERSION` is single-sourced with a drift check between the TypeScript and Python sides, and Python-dependent tests now skip loudly instead of passing when no interpreter is present.

## [0.5.1](https://github.com/bbopen/tywrap/compare/v0.5.0...v0.5.1) (2026-05-31)

tywrap now installs with no native build, so it works on Node 25 and later.

The legacy TypeScript analyzer pulled in a native `tree-sitter` dependency with no prebuilt binary for newer Node, which broke `npm install` there. That analyzer was unused — code generation has run through the Python IR extractor (`tywrap-ir`) since 0.4.x — so it's removed, along with the `tree-sitter`, `tree-sitter-python`, and `web-tree-sitter` packages. Nothing you call changes. ([#238](https://github.com/bbopen/tywrap/issues/238))

## [0.5.0](https://github.com/bbopen/tywrap/compare/v0.4.0...v0.5.0) (2026-05-30)

Bridges no longer extend a shared protocol base class. Each one (Node, HTTP, Pyodide) now holds an `RpcClient`, and `BridgeProtocol` is renamed to `RpcClient`.

**Breaking:** replace `BridgeProtocol` with `RpcClient` in your imports. The `python_bridge` serializer helpers (`serialize_ndarray` and the rest) are no longer re-exported.

Pyodide now speaks the same wire protocol as the subprocess bridge, so the six scientific markers and `meta` work the same in the browser. A conformance suite runs every backend against the same cases.

### Bug Fixes

Minor fixes across the codec and runtime.

### Dependencies

Dependency updates.

## [0.4.0](https://github.com/bbopen/tywrap/compare/v0.3.1...v0.4.0) (2026-04-12)

### Features

* add development hot reload helpers through `tywrap/dev`
* add Node watch sessions that regenerate wrappers and swap the active bridge
* pass the resolved config into bridge recreation during reloads

### Bug Fixes

* add structured generation failures and CLI handling for fatal vs stale output states
* harden Node worker warmup, worker-pool publishing, and timeout recovery behavior
* reject legacy config-based reload fields and point users to the new dev helpers
* update docs to describe the real hot reload support matrix across Node, Pyodide, and HTTP

## [0.3.1](https://github.com/bbopen/tywrap/compare/v0.3.0...v0.3.1) (2026-04-11)


### Bug Fixes

* **ci:** allow publishing an existing release tag ([c657889](https://github.com/bbopen/tywrap/commit/c657889e32d8a12d9151c00f88461121af839845))
* **ci:** publish npm with node 24 trusted publishing ([0662f22](https://github.com/bbopen/tywrap/commit/0662f22692ccd91379a0db739b789c56174280e2))
* **ci:** use trusted publishing for npm release ([f30e947](https://github.com/bbopen/tywrap/commit/f30e947e911b310fb79de08e9b2566e87cbb6f96))

## [0.3.0](https://github.com/bbopen/tywrap/compare/v0.2.1...v0.3.0) (2026-03-22)


### Features

* safe TypeScript generic emission ([#210](https://github.com/bbopen/tywrap/issues/210)) ([c977786](https://github.com/bbopen/tywrap/commit/c977786b48ae9f8d4043569fe7ade105313a23f1))
* **docs:** add 3D hero visual — cinematic particle network ([#212](https://github.com/bbopen/tywrap/issues/212)) ([5740a4e](https://github.com/bbopen/tywrap/commit/5740a4e28d7703709461d741c79f75806ccc9f61))
* **docs:** redesign hero with llm copy block and extracted features ([#213](https://github.com/bbopen/tywrap/issues/213)) ([7875db3](https://github.com/bbopen/tywrap/commit/7875db30bd97d4ea481fd4a0bba5ecc368e0ebf8))
* **runtime:** add getBridgeInfo() meta call ([#188](https://github.com/bbopen/tywrap/issues/188)) ([bd16412](https://github.com/bbopen/tywrap/commit/bd16412de59d1499c769b574a3fa39a009ed1fab))
* tywrap promotion, docs site, and maintenance automation ([bab9301](https://github.com/bbopen/tywrap/commit/bab9301b3df6eab81ce7229ea701489d3f9b33e2))


### Bug Fixes

* address follow-up promotion bugs ([4342335](https://github.com/bbopen/tywrap/commit/434233588ea097bfc9538991067f7b4cbbcf7007))
* address PR 207 review comments ([31dfda4](https://github.com/bbopen/tywrap/commit/31dfda455f58def859268005c948118794f7ff28))
* address PR 207 ruff import review ([d248b9e](https://github.com/bbopen/tywrap/commit/d248b9e27cf04eb140180b0885127b5dd98b3183))
* address review findings across docs, CI, and metadata ([27f47a2](https://github.com/bbopen/tywrap/commit/27f47a28970d0feb58dc1e241ba3763eaf1f8617))
* **analyzer:** support tree-sitter 0.25 grammar exports ([c38a155](https://github.com/bbopen/tywrap/commit/c38a1550ab858f0f0f5dc0da31df5a90a0423a56))
* **ci:** resolve @types/react peer dep conflict breaking npm ci ([8228937](https://github.com/bbopen/tywrap/commit/8228937cae232487011c0bf8c833690110180973))
* **pyodide:** align bootstrap dispatcher with protocol envelope ([#197](https://github.com/bbopen/tywrap/issues/197)) ([79e6a95](https://github.com/bbopen/tywrap/commit/79e6a95a09c292540a13bbf2c4b7833764ddb24d))
* **runtime:** align Node warmup protocol and fail fast ([#196](https://github.com/bbopen/tywrap/issues/196)) ([30f4a40](https://github.com/bbopen/tywrap/commit/30f4a407d26efec26153c067fcf1b2aead826b9c))
* **runtime:** avoid empty PATH entries ([48adce8](https://github.com/bbopen/tywrap/commit/48adce861be5b675125d295323a88a1d4a8a2294))
* **runtime:** harden advanced typing and worker recovery ([4942383](https://github.com/bbopen/tywrap/commit/4942383ea0ece6b75b8ce99adc05fc1fe1056482))
* **runtime:** normalize worker thread errors ([9ffed1e](https://github.com/bbopen/tywrap/commit/9ffed1e651c94a614b54caecd0095e1a0e77c00e))
* **runtime:** preserve POSIX path aliases ([8fd9e37](https://github.com/bbopen/tywrap/commit/8fd9e3789c992b4ef8997b243180ca1debc49bce))
* **types:** unblock py310 advanced typing ([18ff997](https://github.com/bbopen/tywrap/commit/18ff997eeaf9f4a603c72a260b7d81ff5f3c73d2))
