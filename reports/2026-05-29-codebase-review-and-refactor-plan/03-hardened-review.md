# tywrap Refactor Plan — Hardened Review (codex-paired)

> **What this is.** An independent second review of `02-refactor-plan.md`, run as a workflow that paired
> each of the 8 themes with an adversarial **`codex exec`** audit (OpenAI's CLI agent, read-only, a clean
> session with no shared context), then synthesized the results and ran a final codex sparring pass against
> the whole plan. codex's role: code reviewer, sounding board, sparring partner — confirm or **refute** each
> diagnosis, critique for elegance, and prescribe the comments the new/difficult parts need.
>
> **Method.** 8 theme agents each (1) re-verified the architect's file:line claims against current source,
> (2) wrote a self-contained briefing, (3) ran `codex exec -s read-only -c model_reasoning_effort=<high|medium>`,
> (4) reconciled codex's verdict against the architect *on the merits, not by deference*. codex ran on all
> 8 themes (model: gpt-5.5). Raw transcripts are in [`codex-audits/`](codex-audits/).
>
> **Run:** `wf_19bb8c92-177` · 10 agents · ~16 min · 9 codex sessions.

---

## 1. Bottom line

**SHIP — ready-with-changes, all 8 themes.** Every core diagnosis survived a fresh source re-verification
*and* an adversarial codex audit; **no theme was refuted at its foundation.** codex returned **`confirms`**
on 2 themes (`trim-public-api`, `test-architecture`) and **`mixed`** on 6 — where "mixed" means *the
destination is right but the architect's framing or scoping needs correction*, not "don't do this." All 8
themes held **high** correctness confidence after reconciliation.

The plan is directionally correct but contains **two factual errors that must be fixed before execution**
(§2), **13 risks codex surfaced** (§5), and **one strategic fork** that contradicts the plan as written (§6).
24 Claude-vs-codex disagreements were logged and resolved; ~10 of them **changed the plan** (§4).

This document is the authoritative hardened overlay. `02-refactor-plan.md` carries the two must-fix
corrections inline (marked) and a pointer here for the rest.

---

## 2. Must-fix before execution (would ship broken or wrong code)

### M1 — `delete-dead-code` deletion list is build-incomplete *(build break)*
The plan's test-deletion list (`02-refactor-plan.md` §4 step 2, §5 T2) **omits `test/parallel-processor.test.ts`**
— a **live, 23 KB** file that imports `ParallelProcessor` at `:5`. `test/performance-integration.test.skip.ts:21`
also imports it. Deleting `src/utils/parallel-processor.ts` without removing **both** breaks `npm test`
**and** `npm run typecheck`. The architects listed only `bridge-core.test.ts`, `optimized-node.test.ts`,
and `performance-integration.test.ts`. **Add both files to the deletion list.**

### M2 — `python-ir` member-loss claim is empirically wrong *(silently-incorrect output)*
The plan (§5 T3, and the §6 false-positive ledger) states `@classmethod`/`@staticmethod` are "captured but
mislabeled" and only `@property`/`@overload` are "genuinely lost." **Confirmed false on the live
interpreter (Python 3.14)** — and independently re-verified by the synthesis agent, not taken from codex on
faith:

| Member | What the `ir.py:483` predicate actually does | Plan said | Truth |
|---|---|---|---|
| `@classmethod` | `getattr` returns a **bound method** → `ismethoddescriptor=False`, `isfunction=False` → **predicate returns False** | "mislabeled" | **DROPPED entirely** |
| `@property` | no property branch in the loop; `IRClass` has no accessor field | "dropped" | **DROPPED** (✓) |
| `@staticmethod` | unwraps to a plain function → captured, but indistinguishable from an instance method | "mislabeled" | **mislabeled** (✓ — the *only* one) |
| `functools.cached_property` | passes `ismethoddescriptor` so captured=True, but `inspect.signature()` **raises** → `_extract_function` returns `None` | *(not mentioned)* | **silently discarded today** |

An implementer following the plan would build a *relabel* fix and **silently leave every `@classmethod`
missing from generated wrappers.** The fix must treat classmethod as dropped, use **`inspect.classify_class_attrs`**
as the classification spine (it returns `kind` ∈ {property, class method, static method, method} + the raw
descriptor whose `__func__` yields a faithful `(cls, x)` signature, MRO-aware), add `IRAccessor` as a **new**
`IRClass` field (separate from `fields`, which is data-shape for TypedDict/dataclass/Pydantic), add a
`method_kind` field to `IRFunction` so the TS generator drives receiver-stripping off `method_kind` rather
than name-based `self`/`cls` filtering, and handle `cached_property` explicitly **before** any `signature()`
call. The omission is **broader** than documented — which only strengthens the case for the rewrite.

---

## 3. Per-theme verdicts

| Theme | Confidence | codex | Ship readiness (gating change) |
|---|---|---|---|
| **trim-public-api** | high | confirms | Add a **TSD type-level surface lock** in `test-d/` (already runs via `npm run test:types`) — an `Object.keys()` snapshot can't catch the type-only move of `SafeCodec`/`CodecOptions` out of root. |
| **delete-dead-code** | high | mixed | **M1**: add `test/parallel-processor.test.ts` + `performance-integration.test.skip.ts` to the deletion list. Migrate unique pool/warmup coverage out of `optimized-node.test.ts` (tests live `NodeBridge`) before deleting it. |
| **python-ir** | high | mixed | **M2**: classmethod is dropped, not mislabeled; rebuild on `inspect.classify_class_attrs`; handle `cached_property`; gate on regenerating goldens after the `IR_VERSION 0.3.0` bump (it's in the cache key). |
| **config-loading** | high | mixed | `VERSION` **cannot** use `import ../package.json` (blocked by `rootDir:'./src'`, `tsconfig.json:16`) → generate `src/version.ts` at build. Validate `baseURL` as non-empty string only — **not** URL-parse (browser-relative URLs are legit). Drop the `Field`/`assertField` DSL. |
| **runtime-transport** | high | mixed | Add a **new additive** `SafeCodec.decodeProtocolResponse(payload,{expectedId,arrow})` owned by `BridgeProtocol.dispatch`; **do not** change the public `decodeResponse`/`decodeResponseAsync` signatures (67 test call-sites). Keep pyodide-io's 4 public RPC methods; dedup bodies only. See §6. |
| **test-architecture** | high | confirms | `env.ts` must use **synchronous `spawnSync`** probes (skipIf evaluates at *collection time* — Promises/top-level-await would mis-skip). Each silent-skip → `it.skipIf` with its **exact** current predicate. The A1 restart test must hold a genuinely in-flight request. |
| **decompose-hotspots** | high | mixed | **Downgrade `annotation-parser.parse`** from "flat dispatch, near-zero risk" to "precedence-sensitive with intentional fall-through, highest-risk." Drop `DecodeCtx`. Skip the loadConfigFile loader-map. Do `mapper` PRESET_TYPE_RULES first as the reference pattern. |
| **generator-codegen** | high | mixed | Write full-output `toMatchSnapshot` tests **before** editing. `emitOverloads` is a **separate** kind-aware helper (the optional-tail branch is function-only). Preserve the no-`__init__` ctor fallback. **`as any`→`as Record<string,unknown>` is NOT byte-only** — it type-errors in generated code; move it with the `__kwargs` local widening or keep `as any`. |

---

## 4. Disagreement ledger — where codex changed the plan

24 disagreements were logged and resolved (full list in the run output). The ones that **materially changed
the plan** (resolved on the merits — the synthesis agent re-verified, it did not auto-defer to codex):

1. **trim-public-api / characterization test** → `Object.keys()` is blind to type-only exports, and the
   `SafeCodec`/`CodecOptions`/`Transport` move is *exactly* a type-only migration. **Add a TSD surface lock
   in `test-d/`** (strict superset of the plan).
2. **delete-dead-code / deletion list** → incomplete (M1). Gating correction.
3. **python-ir / classmethod** → dropped, not mislabeled (M2). Confirmed on the interpreter.
4. **python-ir / classification spine** → use `inspect.classify_class_attrs`, not a hand-rolled
   `__dict__`/MRO walk (it handles kind + descriptor + inheritance; document own-vs-inherited intent).
5. **config-loading / VERSION** → `import ../package.json with {type:json}` is blocked by `rootDir:'./src'`
   (`resolveJsonModule` doesn't satisfy `rootDir`); generate `src/version.ts` at build; avoid `createRequire`
   in public ESM (`check:deno`/`check:bun` at `package.json:60-61`).
6. **config-loading / baseURL** → validate non-empty string only; URL-parsing would **regress** legitimate
   browser-relative baseURLs that flow straight to `fetch()` (`http-io.ts:169`). A hidden regression inside
   an intended-stricter change.
7. **runtime-transport / correlation seam + signature** → correlation is *protocol state*, not
   serialization. Keep `decodeResponse`/`decodeResponseAsync` public signatures intact (67 references);
   add an **additive** `decodeProtocolResponse` owned by `BridgeProtocol.dispatch`.
8. **runtime-transport / pyodide-io methods** → the 4 RPC methods are **public-exported and round-trip
   tested** (`test/transport.test.ts:1383+`) — dedup bodies into one private `dispatch`, but **keep** them
   and don't frame them as vestigial.
9. **test-architecture / env.ts + gates** → synchronous probes (collection-time skipIf); each skip keeps its
   **own** predicate (python-vs-python3 `:593`, Pydantic-v2 `:341`, per-module scipy/torch), not a blanket flag.
10. **decompose-hotspots / annotation-parser** → it's precedence-sensitive with **intentional fall-through**
    (Callable when `parts.length>=2`, Annotated with parts, ParamSpec) — the highest-risk extraction; a
    `Rule[]` contract must encode that `null` means *both* "no match" *and* "matched then inner-guard failed,
    fall through."
11. **generator-codegen / the `as any` cast** → **not** runtime-neutral: for keyword-only params without
    `**kwargs`, the emitted `__kwargs` local infers a narrow object-literal type and `Record<string,unknown>`
    is a **type error in generated user code**. Move the cast change with the local widening, or keep `as any`.

The remaining ~13 disagreements were lower-stakes refinements (drop `DecodeCtx`; keep the disposable trio at
root with a rationale comment; same-file helper extraction for the config transpile branches; etc.) — all
resolved in the plan's favor or as cheap supersets.

---

## 5. New risks codex surfaced (13)

Beyond M1/M2 above, codex flagged (each verified against source):

- **cached_property silent drop** (python-ir): passes the predicate but `signature()` raises → discarded
  today; handle as a readonly accessor **before** any `signature()` call.
- **PyAnalyzer deletion isn't fully zero-cost** (python-ir): `analyzePythonModule` does **source-only / no-import**
  analysis — a capability `ir.py` lacks (it `importlib.import_module`s the target). Deletion is correct but
  the **migration note must say** source-only analysis is being removed.
- **protocol.ts deletion ordering** (runtime-transport × delete-dead-code): deleting `protocol.ts` requires
  repointing `bridge-core.ts:4` **and** `test/runtime_node.test.ts:14`; `bridge-core.ts` is itself slated for
  deletion but still present + imported by `test/bridge-core.test.ts`. Sequence the two themes or co-edit.
- **public-API signature churn avoided** (runtime-transport): changing `decodeResponse*` = 67-reference test
  churn for zero functional gain; the additive `decodeProtocolResponse` avoids it.
- **A1 restart test false-confidence** (test-architecture): `killProcess` detaches exit/close listeners
  **before** SIGTERM (`process-io.ts:503-507`), so the normal exit-rejection path can't save an in-flight
  request during restart. A naive sequential send-N+1 test passes **without exercising the bug**. The test
  must hold a genuinely in-flight (un-awaited) request, then trigger restart.
- **collection-time skip hazard** (test-architecture): top-level-await/Promise exports would make `skipIf`
  read `undefined` and mis-skip silently → use synchronous `spawnSync`.
- **annotation-parser fall-through hazard** (decompose-hotspots): a naive `Rule[]` that treats "prefix
  matched" as "consume" silently changes parsing of edge/malformed annotations.
- **no-`__init__` constructor fallback** (generator-codegen): classes without `__init__` emit a permissive
  `static create(...args: unknown[])` and **skip** the descriptor pipeline (`generator.ts:903-914`); a
  descriptor-driven shared emitter that drops this early-out breaks every default-constructor class.
- **substring-only snapshot blindness** (generator-codegen): `generated_snapshot.test.ts` uses `toContain`
  only — can't catch whitespace, overload-order, or declaration-vs-body drift. Full-output characterization
  snapshots are mandatory **before** any generator edit.
- **CLI `--runtime` reference error** (config-loading): the architect cited `cli.ts:257` as the top-level
  override; that line is actually `--python`. `--runtime`'s value is itself effectively dead → deprecate
  with a warning, don't keep a silent no-op flag.

---

## 6. Strategic fork — delete `bridge-core.ts`, or resurrect it as the protocol client?

codex's sharpest point spans two themes and **contradicts the plan as written.** It argues
`runtime-transport` (T5) is **not cleanup — it's a transport-contract migration**, because there are
*multiple protocol clients today*:

- `BridgeProtocol` generates the id and decodes blindly, **without** id-equality (`bridge-protocol.ts:288,305`).
- The real demux/correlation lives in **`ProcessIO`** (`process-io.ts:249,309,607`).
- **Node warmup bypasses `BridgeProtocol` entirely**, hand-rolling ids + JSON parse + envelope validation
  (`node.ts:566,695`).
- `PooledTransport` assumes every worker transport has that same request/response `send()` contract
  (`pooled-transport.ts:174`).

> If id-equality is added only to `BridgeProtocol`, warmup and direct-transport paths still bypass it. If
> correlation is removed from `ProcessIO`, concurrent/pooled calls break unless the transport interface is
> redesigned.

**codex's one change:** don't delete `bridge-core.ts` — it *already* contains the shape T5 wants (id gen,
pending map, timeout tracking, response-id validation, protocol validation, line buffering:
`bridge-core.ts:59,107,218`). **Rename and shrink it into one authoritative `ProtocolClient`/`RpcClient`**
that `BridgeProtocol`, warmup, and subprocess handling all use.

This **directly conflicts** with `delete-dead-code` (T2), which deletes `bridge-core.ts`. The tension is
real and worth deciding **before T2 lands**:

- **Plan as written:** `bridge-core.ts` is dead (zero production importers — verified) → delete it; T5 builds
  the unified `dispatch` fresh on `BridgeProtocol`.
- **codex's view:** the duplicated protocol semantics are the system's *real* complexity; a single
  `ProtocolClient` extracted from `bridge-core.ts` attacks it at the root, where API-trimming and generator
  decomposition do not.

**RESOLVED (2026-05-29, maintainer).** The maintainer confirmed `bridge-core.ts` is *not* currently wired in
or working (correct — it has zero production importers; the live path is `BridgeProtocol + Transport`), and
chose the decisive path: **build one authoritative `RpcClient` that harvests `bridge-core.ts`'s
correlated-RPC design, then delete the orphaned file.** T5 is now scoped as a **transport-contract
migration** (not a dedup), and the unified client **must** own request-id generation + response-id
correlation for **all three** entry points — the bridge dispatch path, node warmup (`node.ts:566,695`), and
the `ProcessIO` subprocess transport (`process-io.ts:249,309,607`) — or the A3 fix is only partial. The
name `RpcClient` is the T9 vocabulary decision (codex preferred it over `ProtocolClient`; the dead
`bridge-core.ts` already uses `RpcRequest`/`RpcResponse`), replacing the muddy `BridgeCore`/`BridgeProtocol`/
`Transport` overlap. See `glossary.md` and `02-refactor-plan.md` §4 step 4 + §5a.

**FINALIZED by the bridge-architecture team workflow (2026-05-29) — see [`04-bridge-architecture-decision.md`](04-bridge-architecture-decision.md).**
A team of 4 investigators + an independent codex audit confirmed **Hypothesis A decisively** (smoking gun:
commit `5405343` re-parented all three bridges onto `BridgeProtocol` *and* removed `BridgeCore` from `node.ts`
in the same commit). The final shape: bridges **hold** the `RpcClient` via **composition, not inheritance** —
and the keystone is splitting `BoundedContext` into `DisposableBase` (lifecycle only) + a `PythonRuntime`
contract (implemented only by the bridge facades). That split is now **core to T5, no longer the deferred B7
follow-up**. codex's independent sparring (`codex-audits/bridge-team/01-codex-decision-sparring.md`) endorsed
composition on the merits ("inheritance is already lying about the model") and surfaced two things this review
missed: **(a) `WorkerPool` also leaks RPC stubs** (`worker-pool.ts:547`) — the throwing-stub problem is in
**three** files, not two; **(b) Pyodide is a second, impoverished Python server** (`pyodide-io.ts:73`
`BOOTSTRAP_PYTHON` does `json.dumps` only — no markers, no `meta`), so server-side parity is **milestone zero**
before any rename/chunking, behind a cross-backend conformance suite.

---

## 7. Comments & readability charter

The deliverable the brief asked for: how to comment this codebase so the open-source community can read it —
with codex's correction that the charter must produce **executable contracts, not performative prose.**

### codex's meta-correction (adopt first)
The repo **already has comment rot**: `ProcessIO` (`process-io.ts:157`) and `HttpIO` (`http-io.ts:58`) both
show a stale example (`id: '1'`, `type: 'call'`) that is *not* the real protocol shape (numeric `id`,
`protocol`, `method`, `params`). A charter focused on big explanatory blocks could **amplify** this. So:

- **Add `docs/dev/architecture.md`** — the authoritative generate path and runtime request path in one place
  (a map newcomers can hold in their head), instead of making every file narrate itself.
- **Every cross-language/cross-module contract comment must point to a test or fixture**, not just a sibling
  file — tests don't rot silently.
- **No new banner comments** — the code already over-uses section banners; more will bury the invariants.
- **Schema/change-log discipline for IR and protocol migrations** — comments can't carry version-migration
  burden; the `IR_VERSION`/protocol changes need a changelog, not a paragraph.

### Principles (specific to tywrap's domain)
1. **State the AUTHORITATIVE path at every fork.** Multiple analyzers exist (TS `PyAnalyzer` vs Python
   `tywrap_ir`; `ir.py` vs `optimized_ir.py`) — only `python -m tywrap_ir → emit_ir_json → extract_module_ir`
   feeds `generate()`. Wherever a reader could mistake a dead/alternate path for the live one, say which is real.
2. **Document cross-language contracts at BOTH ends, naming the sibling file:symbol.** `PROTOCOL_ID`/
   `PROTOCOL_VERSION` live in both `transport.ts` and `python_bridge.py:32-33` with no shared source;
   `IR_VERSION` couples `ir.py` to the TS `TYWRAP_IR_VERSION` (it's in the cache key). Comment each side
   pointing at the other.
3. **Explain id-correlation as a PROTOCOL responsibility** (not transport/serialization): after the refactor
   `BridgeProtocol.dispatch` owns id generation AND response-id equality; document the stale/cross-request/
   substituted-response hazard, or a bare integer compare looks pointless.
4. **Mark generated SOURCE TEXT as a byte-for-byte contract.** In `generator.ts`/`emit-call.ts` the exact
   whitespace, indentation (2 spaces free functions, 4 methods/ctors), and overload order are pinned by
   snapshots — tell readers not to reformat template strings or reorder emission; "indent" is literal emitted
   whitespace passed as data.
5. **Name where Python calling-convention drives TS codegen:** the kwargs-vs-plain-object routing
   (`renderLooksLikeKwargsExpr`), trailing-undefined trimming so omitted optionals fall through to Python
   defaults, the `*args`-as-array surrogate (a TS rest param can't precede another param), `cls`/`self`
   receiver stripping. These read as arbitrary without the Python reason.
6. **Explain the codec's dual sync/async (`MaybePromise`) discipline and per-marker divergence.**
   `decodeEnvelope` is sync when `decodeArrow` is sync and **throws** if a Promise leaks; ndarray reshapes
   (Arrow is 1D-only); torch recurses; dataframe/series share one helper differing only by the marker in the
   error string (asserted byte-for-byte). Say why some markers collapse into one helper and others don't.
7. **Distinguish "exported for in-repo tests via deep `../src/runtime/*.js`" from "public API in
   `package.json#exports`."** The root barrel `src/index.ts` IS the public contract; a file-level `export`
   on plumbing does NOT make it public. State this where trimming happens so nobody "helpfully" re-adds a
   symbol and re-blinds dead-code analysis.
8. **Flag intentional fall-through and order-dependence** in dispatch/parse chains (`annotation-parser`'s
   rule order is semantic; `validateConfig`'s section order determines which error users see first). Comment
   "order is load-bearing here" wherever a refactor to a table could silently lose it.
9. **Comment lifecycle/concurrency invariants that make a refactor safe.** `SafeCodec` is stateless/read-only
   after construction → safe to share across pool workers (say so where shared). `ProcessIO.restartProcess`
   does **not** reject `this.pending` and `killProcess` detaches exit listeners before SIGTERM → in-flight
   requests are orphaned (document this where restart/kill live).

### Hotspots (the new/difficult spots that need the comments)
The 9 consolidated hotspots — exact files, lines, and what each comment must say — are in the run output and
keyed per theme. Highlights: `src/runtime/index.ts` dual-role header (registry + advanced escape hatch);
`transport.ts`/`python_bridge.py:32-33` protocol-constant alignment; `ir.py` member loop (what each decorator
type loses); `tywrap.ts` authoritative-path banner above `fetchPythonIr`; `config/index.ts` `.cts`/`.mjs`
eval strategies (why `compile.call(mod,...)` and the temp-file dance are required); `bridge-protocol.ts`
`dispatch` correlation rationale; `env.ts` synchronous-probe warning; `annotation-parser.ts` fall-through
contract; `emit-call.ts` whitespace-is-contract.

---

## 8. codex's final sparring (verbatim excerpt)

> **(a) Biggest unflagged risk** — `consolidate-runtime-transport`: the plan treats request-id correlation
> as something you can "move into `BridgeProtocol.dispatch`," but the current transport abstraction is
> already a correlated RPC abstraction, not a byte transport. … The hazard is that there are multiple
> protocol clients today. If the team only adds id equality to `BridgeProtocol`, warmup and direct transport
> paths still bypass it. … **Blunt version: T5 is being described like cleanup, but it is a transport
> contract migration. Treat it as one.**
>
> **(b) Comments charter** — useful in intent, but it risks becoming performative … The repo already has
> comment rot [`process-io.ts:157`, `http-io.ts:58`]. … Newcomers need a map, runnable examples, and failing
> tests. They do not need every file to narrate itself.
>
> **(c) One change** — Keep or extract the essence of `BridgeCore` instead of deleting it outright, and make
> it the single protocol client. … rename and shrink it into a clear `ProtocolClient`/`RpcClient`, then make
> `BridgeProtocol`, warmup, and subprocess handling use that one path.

Full text: [`codex-audits/00-overall-sparring.md`](codex-audits/00-overall-sparring.md).

---

## 9. Recommended sequencing

**`trim-public-api` (T1) first** — the only theme codex flat-out confirms, and the un-blinding root of the
dependency chain: curating `src/index.ts` makes the `ts-fx` dead-code scan honest, which is the precondition
for `delete-dead-code` (T2) to safely remove `parallel-processor.ts`, which drops `analyzer.ts` to zero src
importers and unlocks its deletion + the tree-sitter removal in `python-ir` (T3, closing #238). T1 is
low-risk (only edits exports + adds a test); its one gating change (a TSD type-lock in `test-d/`) is cheap.

**Updated for the one-decisive-release decision (2026-05-29):** there is no longer a staged/deferred
split — everything ships in one breaking release (see `02-refactor-plan.md` §4). T1 still goes first
(un-blinding root) and lands its **full** curation including the root-export removals, the `tywrap/runtime`
move, and the TSD surface lock; rewrite the `src/runtime/index.ts` header doc-comment (dual role) alongside
it. Order then: **T1 → T2 (harvest `bridge-core` into `RpcClient`, §6, then delete) → T9 vocabulary →
T5 → T3 → T4 → T7/T8 → T6**, with the dead-test deletions in lockstep with T2 and all output-changing
goldens re-blessed once at T3.

---

## 10. Artifacts

```
codex-audits/
├── 00-overall-sparring.md      ← codex's plan-level adversarial take
├── trim-public-api.md          ← per-theme codex audits (read-only, gpt-5.5)
├── delete-dead-code.md
├── python-ir.md
├── config-loading.md
├── runtime-transport.md
├── test-architecture.md
├── decompose-hotspots.md
└── generator-codegen.md
```

Each `codex-audits/*.md` is codex's verbatim final message for that theme — the independent confirm/refute,
elegance critique, and comment prescriptions that this synthesis reconciled against the architect verdicts.
