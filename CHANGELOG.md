# Changelog

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
