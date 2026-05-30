# tywrap — Refactoring Plan, Reconciled Against the Maintainer Roadmap

> **Provenance.** This plan synthesizes three independent inputs against live source:
> 1. `01-expert-review.md` — a 10-reviewer expert synthesis (grades, quick wins, A–H roadmap).
> 2. `architect-verdicts/*.json` — 8 per-theme architect agents, each required to verify the review's
>    claims against source and record refutations; plus `00-sequencing.json`, a cross-cutting release pass.
> 3. `signals/` — `ts-fx` static signals (complexity, dead-code, duplicates, layering, ESM/bound checks)
>    and `signals/github-issues-digest.md` — the 11 open maintainer roadmap issues (#228–#238).
>
> Every file:line in this document was asserted by an architect against the working tree and the
> load-bearing facts were re-spot-checked on 2026-05-29 (no commits since the architects ran).
>
> **⚠️ Hardened by an independent codex-paired review (2026-05-29) — see [`03-hardened-review.md`](03-hardened-review.md).**
> That pass ran `codex exec` as an adversarial second reviewer on all 8 themes. Verdict: SHIP, ready-with-changes;
> no theme refuted at its foundation. It corrected **two factual errors in this document** (now fixed inline
> and marked `[CORRECTED 2026-05-29]`), surfaced 13 risks, and flagged one strategic fork (delete vs. resurrect
> `bridge-core.ts` as a unified protocol client). Read `03-hardened-review.md` before executing any theme.

---

## 1. The headline reconciliation

**The refactor workflow and the maintainer's roadmap agree on the work but collide on version numbers.**

The 8 architects, working only from the expert review and `ts-fx` signals, proposed shipping a big-bang
breaking release they named **"v0.5.0"**. But the maintainer has *already* assigned 0.5.0 to a different
workstream:

| Roadmap bucket | Issue | What it is | Covered by the refactor workflow? |
|---|---|---|---|
| **0.4.x stabilization** | #236 | Remove TS analyzer/tree-sitter (#238, **p1**), stabilize dev/hot-reload (#228), tywrap↔tywrap-ir compat contract (#229), clean up deprecated runtime surface (#230) | **Yes — this is ~all of the refactor work** |
| **0.5.0 data plane** | #237 | Chunked transport for large payloads (#231, **p1**), frictionless Arrow (#232), scientific codec perf gates (#233), harden SciPy/Torch/Sklearn envelopes (#234), transport capability matrix (#235) | **No — barely touched** |

So the refactor workflow's themes are **structural / dead-code / correctness / IR / test** work that maps
almost entirely onto the maintainer's **0.4.x stabilization (#236)** bucket. The maintainer's actual
**0.5.0 (#237)** is a **data-plane** effort — large-payload transport and scientific codec hardening — that
the refactor workflow did not plan (the expert review's perf D-series and test E2/E3 *feed* it, but no
architect designed it).

**Resolution (2026-05-29, maintainer): ship one decisive major-version-breaking release** containing all 8
themes **plus the T9 vocabulary cleanup** (§5a) — no staging, no backward-compat. The reconciliation insight
still holds and still shapes the work (the refactor *is* #236 stabilization in scope; the **0.5.0 data plane
#237 is a separate workstream** that follows on the clean foundation this release builds), but there is no
longer a 0.4.x/0.5.0/1.0 split to manage. The earlier "decision point" in §4 is now a settled decision; the
"Breaks public surface?" column in §2 below is **informational only** (everything ships together).

---

## 2. Theme → issue map

All 8 themes are **DO IT** (every architect confirmed the core claim against source). Verdicts, scope
corrections, and full step lists live in `architect-verdicts/`. Effort/risk are the architects' calibrated
values (several downgraded the review's estimates after reading source).

| # | Theme | Verdict | Risk / Effort | Serves issue(s) | Breaks public surface? |
|---|---|---|---|---|---|
| T1 | **trim-public-api** (curate `src/index.ts`; move `SafeCodec`/`Transport` to `./runtime`) | DO | low / small | #230, #235 | **Yes** (removes/moves root exports) |
| T2 | **delete-dead-code** (5 modules + drain-relocate `protocol.ts`) | DO | low / small | #230; **unlocks #238** | No (never in exports map) |
| T3 | **python-ir** (retire `analyzer.ts` + drop tree-sitter; member capture; single-source `IR_VERSION`; pytest suites) | DO | medium / large | **#238**, **#229** | Partial (IR schema + regenerated wrappers) |
| T4 | **config-loading** (schema validators; demote dead `runtime` field; single-source `VERSION`; timeout JSDoc) | DO | medium / medium | #230, #229 | Partial (stricter validation rejects bad input) |
| T5 | **runtime-transport** (`BridgeProtocol.dispatch`; `SafeCodec`-owned id-correlation; node warmup unification) | DO | medium / medium | #235; foundation for #231 | **Yes** (id-mismatch now throws) |
| T6 | **test-architecture** (62 silent-skips → `skipIf`; delete dead tests; A1/A3/E2 coverage) | DO | medium / large | #228; feeds #233 | No (test-only) |
| T7 | **decompose-hotspots** (codec / annotation-parser / mapper / config dispatch tables) | DO | low / medium | — (internal quality) | No (output preserved) |
| T8 | **generator-codegen** (`emit-call.ts`; kill 3× call-emission triplication) | DO | medium / medium | — (internal quality) | No (output byte-preserved except 1 labeled cast change) |
| **T9** | **vocabulary-cleanup** (standardize invented/vibe-coded names on a 4-layer glossary — see [`glossary.md`](glossary.md)) | DO | low / medium | community readability; enables #229/#235 clarity | **Yes** (renames public API) |

**Not on the refactor plan but on the roadmap (need their own design pass):**
`#231` chunked transport (p1), `#232` Arrow frictionless, `#233` codec perf gates, `#234` scientific
envelopes, `#235` capability docs/matrix — the entire **0.5.0 data plane**. Plus `#238`'s fresh-install
Node 25 smoke test and `#228`'s living-app watch/reload smoke are net-new tasks no theme owns. See §7.

---

## 3. The #238 conflict — already resolved by the architects

Before the issues were retrieved, the open risk was: **`decompose-hotspots` had picked `analyzer.ts` as its
top target (`extractImports` 27/92, `extractParameters` 23/85), but #238 (p1) mandates *deleting* the TS
analyzer outright.** Decomposing code slated for deletion would be wasted effort.

**The architects independently caught and resolved this**, three ways:

- `decompose-hotspots` **refuted its own top target**: *"analyzer.ts has ZERO non-test, non-dead importers …
  Decomposing it is wasted work; it should be DELETED by the other theme."* It explicitly excludes
  `analyzer.ts` and `validation.ts` from its scope.
- `python-ir` owns the deletion: *"RETIRE `src/core/analyzer.ts` (PyAnalyzer) entirely … drop tree-sitter
  deps from package.json if unused."*
- `delete-dead-code` removes `parallel-processor.ts`, which is `analyzer.ts`'s **only** non-test importer.

**The deletion chain (re-verified against source 2026-05-29):**

```
T1 trim-public-api ──▶ un-blinds the dead-code scan (barrel no longer masks dead modules)
        │
T2 delete-dead-code ──▶ removes parallel-processor.ts  ──▶  analyzer.ts now has 0 src importers
        │                                                   (grep: only importer was parallel-processor)
T3 python-ir ──▶ deletes analyzer.ts  ──▶  tree-sitter / tree-sitter-python / web-tree-sitter
                                            now used nowhere (grep: only analyzer.ts referenced them)
                                            ──▶  drop all three from package.json  ──▶  #238 satisfied
```

`#238`'s remaining acceptance criterion — *"package validation includes a fresh-install smoke path that
catches Node 25 install regressions"* — is **not** covered by any theme. It's a packaging/CI task; see §7.

---

## 4. Release sequence — one decisive breaking release

> **DECISION (2026-05-29, maintainer):** ship this as **one clean, forward, decisive major-version-breaking
> release**. No backward-compat, no deprecation shims, no staged 0.4.x/0.5.0/1.0 tranches — *if nothing prior
> works, that is acceptable and expected.* This supersedes the architects' staged `v0.5.0-prep → v0.5.0 → v1.0.0`
> proposal and the earlier semver-honest staging. tywrap is pre-1.0 with ~0 users; the breaking budget is
> free, so spend it once and emerge clean.

This collapses all themes into a single release. **Version label: `0.5.0`** `[DECIDED 2026-05-29, maintainer]`
— semver-clean (pre-1.0, a minor bump may break). **Consequence:** the maintainer's current ROADMAP earmarks
`0.5.0` for the *data plane* (#237), so that workstream **shifts to `0.6.0`** (it always followed this refactor
anyway — see "The data plane" below). `ROADMAP.md` (a source file) will need that relabel at execution time.
The content below is one atomic breaking change; given ~0 users, a migration guide is optional.

### What ships, and the load-bearing order

The order is dictated by the un-blinding chain (§3) and the protocol-client work (§6), **not** by a
break/non-break split (everything breaks; that is the point):

1. **T1 trim-public-api** — curate `src/index.ts` to its real public surface (~20 symbols); move `SafeCodec`/
   `CodecOptions` + the `Transport` contract to `tywrap/runtime` (the one deliberate escape hatch — **not** a
   new `tywrap/internal`, which re-freezes the masking). Add the `api-surface` characterization test **plus a
   TSD type-level surface lock** in `test-d/` (an `Object.keys()` snapshot can't catch the type-only moves).
   **Why first:** curating the barrel un-blinds the dead-code scan so T2 is statically provable.
2. **T2 delete-dead-code** — delete `parallel-processor.ts`, `bundle-optimizer.ts`, `memory-profiler.ts`,
   `optimized-node.ts`; **harvest `bridge-core.ts`'s correlated-RPC design into the new `RpcClient`
   (§6) before deleting it**; drain-and-relocate `protocol.ts`'s version constant into `transport.ts`. Delete
   the dead test files **including `test/parallel-processor.test.ts` and `performance-integration.test.skip.ts`**
   `[CORRECTED]`. Removes the only `utils→core` layering edge.
3. **T9 vocabulary-cleanup** — apply the standardized glossary (§5a / `glossary.md`) as part of the same
   churn. **Why here:** it renames public API and internal symbols; doing it in the same breaking release
   means one rename pass, not two. It rides on top of T1's curated surface and feeds every later theme's
   final names (e.g. the §6 `RpcClient` name is a T9 decision).
   **T5.0 (milestone zero — Pyodide server parity) `[TEAM 2026-05-29]`** — *before any rename or deletion:*
   `pyodide-io.ts` `BOOTSTRAP_PYTHON` is a **second, impoverished Python server** (`json.dumps` only, no
   `__tywrap__` markers, no `meta`) vs `runtime/python_bridge.py`'s full 6-marker + `handle_meta`. Port/share
   the dispatcher+codec so Pyodide returns all 6 markers and answers `meta`. Then build a **cross-backend
   protocol conformance suite** (node × pyodide × http over inline JSON, Arrow, all 6 markers, oversized
   failure, cancellation, Python errors, `capabilities()`) and keep it green as the gate for the rest of T5.
4. **T5 runtime-transport** `[RESCOPED BY TEAM 2026-05-29 — see 04-bridge-architecture-decision.md]` — the
   bridge layer becomes **composition, 4 concepts**: `Bridge` facade → holds an **`RpcClient`** → holds a
   `BridgeCodec` + a `Transport`. The keystone is **splitting `BoundedContext` into `DisposableBase`
   (lifecycle only) + a `PythonRuntime` contract (the 4 RPC methods, implemented ONLY by the bridge facades)**.
   That split deletes — *by construction* — the leaked RPC throwing-stubs in **three** files (`process-io.ts`,
   `pooled-transport.ts`, **and `worker-pool.ts:547`** `[+1 vs earlier]`), PyodideIO's dead 4th client, and
   node-warmup's hand-rolled client. **This REVERSES the earlier B7 deferral** (§5 T5 had punted the
   BoundedContext/RuntimeExecution split to a follow-up — it is now the core of T5). `RpcClient` is the one
   id-generation + correlation + encode/decode site; bridges **hold** it (not extend it). Add an **additive**
   `decodeProtocolResponse(payload, {expectedId, arrow})`; leave legacy `decodeResponse*` untouched.
5. **T3 python-ir** — capture the dropped member categories (**`@classmethod` and `@property` are dropped,
   not mislabeled** `[CORRECTED]` — rebuild on `inspect.classify_class_attrs`); delete `analyzer.ts` + drop
   the three tree-sitter deps (**closes #238**); single-source `IR_VERSION` with a CI drift check (**closes
   #229**); bump the IR schema and regenerate all goldens. Sequence **last among the output-changing themes**
   so its golden re-bless absorbs T7/T8's output changes too.
6. **T4 config-loading** — per-section validators (drop the `Field`/`assertField` DSL); `baseURL` validated
   as non-empty string only `[CORRECTED]`; `VERSION` from a **build-generated `src/version.ts`** (not a
   `package.json` import — blocked by `rootDir`) `[CORRECTED]`; demote the dead per-module `runtime` field.
7. **T7 decompose-hotspots** + **T8 generator-codegen** — internal refactors, **gated by full-output
   characterization snapshots taken first**; co-bless regenerated goldens with T3. `annotation-parser.parse`
   is the highest-risk extraction (precedence-sensitive fall-through), not "flat dispatch" `[CORRECTED]`.
8. **T6 test-architecture** — truth-telling (62 silent-skips → `it.skipIf` with synchronous `spawnSync`
   probes `[CORRECTED]`; delete dead tests in lockstep with T2); then A1/A3/E2 real coverage RED→GREEN after
   T5 lands.

**Net-new tasks not owned by any theme** (do in the same release): `#238` fresh-install Node 25 smoke;
`#228` living-app watch/reload smoke; the security/doc-accuracy must-dos from the expert review (§7).

### Single release gate

`check:all` (format, lint, build, type tests, unit) green; `npm run test:types` green **including the new
TSD surface lock**; Python `core` + `data` suites green; living-app smoke green; `ts-fx` re-scan confirms the
dead modules, the `utils→core` edge, and the flagged dup pairs are gone and the complexity hotspots dropped;
a **without-Python** run proves the converted tests *skip* (not vacuously pass); a `grep` confirms zero
surviving uses of the retired vocabulary (§5a).

### The data plane (#237) — now `0.6.0`, the release *after* this one

The data plane — #231 chunked transport (p1), #232 frictionless Arrow, #233 codec perf gates, #234 scientific
envelopes, #235 capability matrix — is a **separate workstream** the refactor themes do not cover. It was the
maintainer's original "0.5.0" theme, but since the refactor now takes the `0.5.0` label, **this moves to
`0.6.0`.** It depends on the unified `RpcClient` + the `TransportCapabilities` descriptor from T5 (where
chunked transport hooks in), on Pyodide server parity (T5.0), and on the expert review's **D1 "measure first"**
(Arrow/large-payload benchmarks gate D3/D4/D5). Cut it on the clean foundation `0.5.0` establishes.

---

## 5. Per-theme detail (condensed)

Full `proposal` / `breakingChanges` / `verificationPlan` / `steps` for each are in `architect-verdicts/`.
Highlights and the scope corrections that matter:

- **T1 trim-public-api** — target root ≈ `defineConfig`/`resolveConfig`, `generate`, the 6 `Bridge*Error`
  classes, Arrow codec helpers, runtime-detection fns, public type family, `VERSION`. **Scope correction:**
  do **not** create `tywrap/internal` (re-freezes the masking); leave plumbing as plain file-level exports
  for tests' deep `../src/runtime/*.js` paths (not in the exports map → already non-public). Only `SafeCodec`
  + `Transport` get a deliberate home at `tywrap/runtime`. Delete the deprecated `RuntimeBridge` re-export.

- **T2 delete-dead-code** — `cache.ts` and `logger.ts` **stay** (many live consumers). **Scope correction:**
  `protocol.ts` is *partially* dead — `TYWRAP_PROTOCOL_VERSION` is live; relocate it before deleting. The
  review's "100ms setInterval pump runs in prod" framing is wrong (it's in never-called `init()`, and
  unref'd). `optimized-node.test.ts` tests the *live* `NodeBridge` → keep it (fold into `runtime_node`),
  even though the `optimized-node.ts` shim is deleted.
  **[CORRECTED 2026-05-29]** The test-deletion list must also include **`test/parallel-processor.test.ts`**
  (live, 23 KB, imports `ParallelProcessor` at `:5`) and **`test/performance-integration.test.skip.ts`**
  (imports it at `:21`). The architect verdict omitted the first — deleting `parallel-processor.ts` without
  removing both **breaks `npm test` and `npm run typecheck`**. Also gate `protocol.ts` deletion on repointing
  `bridge-core.ts:4` and `test/runtime_node.test.ts:14` (sequence after `bridge-core.ts` is gone, or co-edit).

- **T3 python-ir** — **[CORRECTED 2026-05-29]** The original "captured but mislabeled" framing was
  **empirically wrong** (confirmed on the live Python 3.14 interpreter): **`@classmethod` is DROPPED
  entirely** (`getattr` returns a bound method → `ismethoddescriptor=False` → the `ir.py:483` predicate
  returns False), **`@property` is DROPPED** (no property branch; `IRClass` has no accessor field), and
  **only `@staticmethod` is captured-but-mislabeled.** `functools.cached_property` is also **silently
  discarded** today (passes `ismethoddescriptor` but `inspect.signature()` raises). So the loss is *broader*
  than the review claimed — an implementer must build a **capture** fix, not a relabel. Use
  **`inspect.classify_class_attrs`** as the classification spine, add `IRAccessor` as a **new** `IRClass`
  field (separate from `fields`), add `method_kind` to `IRFunction`, and handle `cached_property` **before**
  any `signature()` call. The `IRCache` None bug is a cache-*effectiveness* bug, **not** data loss (and
  `optimized_ir.py` isn't on the `generate()` path). **Skip** the `ir.py` module split (716 lines, cohesive;
  split breaks `optimized_ir.py` imports). Overloads need Python 3.11+ (`typing.get_overloads`); 3.10
  degrades with a warning.

- **T4 config-loading** — **Do not "fix"** the `createRequire(import.meta.url)` calls at `config/index.ts:278,326`
  (valid ESM; `ts-fx` flagged them as false positives). `timeout` vs `timeoutMs` is **already bridged**
  (`tywrap.ts:172`) — it's a naming/DX issue, not a bug; keep the name `timeout`, add JSDoc (no break).
  The per-module `runtime` field is genuinely dead input (never read by `generate()`) → demote/remove +
  stop the CLI emitting it. No `AutoBridge` exists → `--runtime auto` is a no-op alias.

- **T5 runtime-transport** `[RESCOPED BY TEAM 2026-05-29 — 04-bridge-architecture-decision.md is authoritative]`
  — pyodide-io is a **4-method** family; `executeWorkerCall` is the general base; correlation is **not** a
  transport-layer contract today. The team decision makes the fix **composition, not a base class**: bridges
  *hold* one `RpcClient` (the single id-generation + correlation + encode/decode site); the `BoundedContext` →
  `DisposableBase` + `PythonRuntime` split is now the **core** of T5, **not** a deferred follow-up
  `[REVERSES the earlier "keep B7 as a separate follow-up"]`. That split removes the leaked RPC throwing-stubs
  in **three** files — `process-io.ts:382-419`, `pooled-transport.ts:216-260`, **and `worker-pool.ts:547-590`**
  (`WorkerPool extends BoundedContext` at `:108`; the third file was missed earlier and confirmed by codex).
  Also: **milestone T5.0** brings the Pyodide in-WASM server to protocol parity *first* (it's a second,
  marker-less, meta-less Python server), gated by a cross-backend conformance suite. `timed-out-request-tracker.ts`
  is **KEPT** (LIVE — imported by `process-io.ts`, not bridge-core-only). `protocol.ts` is **drained**
  (relocate `PROTOCOL_VERSION` to `transport.ts`) then deleted, not flat-deleted.

- **T6 test-architecture** — **Scope corrections:** count is **62**, not 63. The Path-Utilities dup pair is
  a **near-false-positive** (Bun-native vs tywrap `pathUtils`, different code under test) → extract a shared
  fixture, **keep both**. ParallelProcessor dup pairs die with the dead test files (no dedup needed). A1/A3/E2
  new coverage depends on T5's source fixes landing first.

- **T7 decompose-hotspots** — **Sharply narrowed** from the digest: only **live** functions —
  `codec.ts:356 decodeEnvelopeCore`, `annotation-parser.ts:280 parse`, `mapper.ts:478 mapPresetType`,
  `config/index.ts:120/259`, optional `tywrap.ts:123 generate`. Excludes `analyzer.ts`/`validation.ts`
  (dead → T2/T3). Leave `splitTopLevel` alone (irreducible state machine, **not** a dispatch-table
  candidate). Each target is a flat dispatch over a tagged discriminant → dispatch table, near-zero risk,
  gated by existing tests asserting exact error strings.

- **T8 generator-codegen** — **Downgraded** review's "large" to **medium**: the 3 copies
  (`generator.ts:531-585/800-856/998-1052`) are mechanically identical (differ only by indent, error label,
  terminal RPC verb). Extract `emit-call.ts` (`CallDescriptor` + `emitCallPrelude`/`emitArgGuards`),
  collapsing the 6 `as any` casts to one. **Decline** the proposed ts-decl/runtime-shim 3-way split.
  **Must** be gated by a *full-output* characterization snapshot first — current tests assert substrings and
  won't catch a whitespace regression.

## 5a. T9 — vocabulary cleanup

The full rename table and the four-layer model are in **[`glossary.md`](glossary.md)**; reconciled from an
independent `codex exec` sounding-board pass ([`codex-audits/vocabulary-cleanup.md`](codex-audits/vocabulary-cleanup.md)).
The essence:

- **Four layers, one word each, never shared:** **Transport** moves bytes · **`RpcClient`** owns ids +
  request/response correlation · **`*Bridge`** is the public Python-execution facade · **`BridgeCodec`** /
  value-envelope decode serializes values. Most of the codebase's confusion is these four borrowing each
  other's names (`BridgeCore` vs `BridgeProtocol`, `*IO` vs `Transport`, `ProtocolEnvelope` vs `CodecEnvelope`).
- **Highest-value renames:** `ProcessIO`/`HttpIO`/`PyodideIO` → `SubprocessTransport`/`HttpTransport`/
  `PyodideTransport`; `BridgeProtocol`+`BridgeCore` → one **`RpcClient`** (codex's term — the dead
  `bridge-core.ts` already uses `RpcRequest`/`RpcResponse`); `SafeCodec` → `BridgeCodec` (drop the
  vibe-adjective); `IntelligentCache` → `ArtifactCache`; `WorkerPool`/`PooledWorker` →
  `TransportPool`/`TransportLease` ("worker" wrongly implies Worker Threads); `BoundedContext` →
  `DisposableBase` (+ split out a `PythonRuntime` contract); collapse `TYWRAP_PROTOCOL*` to one
  `PROTOCOL_ID`+`PROTOCOL_VERSION`; disambiguate "envelope" → `RpcResponse` (the `{id,result|error}` wrapper)
  vs `ValueEnvelope` (the `{__tywrap__:…}` typed value); `marker` → `typeTag`.
- **Cross-language coherence:** rename Python `runtime/safe_codec.py` `SafeCodec` and the protocol constants
  in lockstep; the **wire keys** (`__tywrap__`, the JSONL line shapes) **stay** — only code identifiers change.
- **Sequencing:** runs as **step 3** of the single release — after T1 curates the real public surface, and as
  the spine for T5's `RpcClient`. Rename via the type-checker one layer at a time; regenerate wrappers +
  goldens once (folds into T3's re-bless); a `grep`-to-zero of retired names is a release gate. The glossary
  becomes the vocabulary section of the planned `docs/dev/architecture.md` (hardened-review §7).

---

## 6. False-positive ledger — the do-NOT-do list

The architects refuted **24** review/signal claims against source. Acting on these blindly would have
introduced bugs or wasted effort. The full list is in `architect-verdicts/00-sequencing.json`; the
load-bearing ones:

| Claim (from review / `ts-fx`) | Verdict | Why |
|---|---|---|
| Move plumbing behind `tywrap/internal` | **REFUTED** | Re-freezes modules into the exports map; re-creates the exact dead-code masking. Deep `src/runtime/*.js` test paths are already non-public. |
| Flat-delete `protocol.ts` | **WRONG** | Breaks the **live** `TYWRAP_PROTOCOL_VERSION` (`bridge-protocol.ts:24/92/94/163`). Relocate to `transport.ts` first. |
| `analyzer.ts extractImports/extractParameters` are top decompose targets | **REFUTED** | Dead (only importer is dead `parallel-processor.ts`). **Delete, don't decompose.** |
| `validation.ts validateTypeHints` is a hotspot to decompose | **REFUTED** | Zero src importers — dead. |
| `splitTopLevel` is accidental complexity | **PARTIALLY REFUTED** | Irreducible char-scanner state machine; do **not** dispatch-table it. |
| `createRequire` flags at `config/index.ts:278/326` | **FALSE POSITIVES** | `createRequire(import.meta.url)` is valid ESM — must not be "fixed". |
| `@property`/`@classmethod` both dropped from IR | **CONFIRMED — and broader** *[corrected 2026-05-29]* | `@classmethod` **and** `@property` are **DROPPED** by the `ir.py:483` predicate; only `@staticmethod` is captured-but-mislabeled; `cached_property` is silently discarded too. Verified on the interpreter. (Supersedes the earlier "mislabeled" claim.) |
| `IRCache` None bug = data loss | **REFUTED** | Cache-effectiveness bug; `optimized_ir.py` isn't on the `generate()` path. |
| `timeout`/`timeoutMs` mismatch is a bug | **REFUTED** | Already bridged at `tywrap.ts:172`; it's a naming/DX issue. |
| Config per-module `runtime` is "required" and load-bearing | **type-level only** | Never read at runtime → safe to demote/remove. |
| pyodide-io duplication is a 2-method pair | **WIDER** | It's a 4-method family — collapse all four. |
| node warmup + `executeWorkerCall` are peers to merge | **REFUTED** | `executeWorkerCall` is the general base; warmup is the clone. |
| A3: bolt id-checks onto HttpIO/PyodideIO | **REFUTED approach** | Own correlation once in `BridgeProtocol`/`SafeCodec`, don't re-duplicate. |
| Delete `optimized-node.test.ts` (dead) | **PARTLY WRONG** | It tests the **live** `NodeBridge` → keep (fold in). |
| `trim-public-api` `B4 tywrap/internal` | **REFUTED** | (see row 1). |
| "63 silent-skips" | **MISCOUNT** | Verified **62**. |

---

## 7. Coverage gaps — what this plan does NOT cover

The refactor workflow planned the **structural/correctness half** of the roadmap. These remain unowned:

**Roadmap issues with no theme (the entire 0.5.0 data plane + net-new tasks):**
- **#231** versioned/chunked transport for large payloads (**p1**) — only the *hook point* exists (T5's
  `dispatch`); the transport itself is undesigned.
- **#232** frictionless Arrow registration · **#233** scientific codec validation + perf gates · **#234**
  SciPy/Torch/Sklearn envelope hardening · **#235** transport capability matrix (T1+T5 expose the contract;
  the docs/matrix is unplanned).
- **#238** fresh-install **Node 25** smoke path (packaging/CI; net-new).
- **#228** living-app **watch/reload** end-to-end smoke (T6 does truth-telling; the reload exercise is net-new).

**Expert-review must-dos that aren't refactors (on the path to 1.0):**
- **Security:** C1 arbitrary import+getattr allowlist (`python_bridge.py:707-728`); C2 module-name injection
  into `python -c` (`discovery.ts:100-106`); C3 `SECURITY.md` + disclosure policy; C4 Pyodide CDN SRI;
  C5 document config-file code execution.
- **Perf (the 0.5.0 prerequisite):** **D1 measure first** (Arrow/large-payload/pool benchmarks) → then
  D3 base64 wire inflation, D4 special-float re-scan, D5 ndarray decode.
- **Docs/DX:** G1 error-handling examples + phantom `validate-config` CLI; G2 error catalog; G7 migration
  guide (becomes the 0.5.0 migration doc); G8 codec failure modes.
- **OSS polish:** H1 hero demo (GIF/asciinema); H3 issue/PR templates + `CODE_OF_CONDUCT`.

A separate design pass should turn #231–#235 into themes the way this workflow handled the structural set —
ideally after D1 lands, since the data-plane perf work is unmeasured today.

---

## 8. How to read the evidence

```
reports/2026-05-29-codebase-review-and-refactor-plan/
├── 00-README.md                 ← start here (index + provenance)
├── 01-expert-review.md          ← 10-reviewer expert synthesis (the upstream input)
├── 02-refactor-plan.md          ← this file (reconciled plan)
├── architect-verdicts/          ← 8 theme verdicts + 00-sequencing.json (full proposals/steps/refutations)
└── signals/                     ← ts-fx ndjson + digests + github-issues-digest.md
```

Recovery note: the architects' structured outputs were recovered intact from the workflow agent
transcripts. An earlier in-session debugging pass had clobbered the working-copy `refactor-synthesis.json`
with placeholder stubs (`"test summary"`, `"test plan"`); the verdicts here are the real, full payloads,
not those stubs.
