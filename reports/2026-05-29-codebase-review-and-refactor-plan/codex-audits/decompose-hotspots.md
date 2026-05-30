**Findings**

Refute the load-bearing hypothesis as stated. `decodeEnvelopeCore` is mostly a tagged dispatch over `marker` at `src/utils/codec.ts:364-377`, but `parse` is not a simple single-discriminant dispatch. It has precedence-sensitive checks and intentional fall-through: pipe unions run before `typing.Union[...]` at `src/core/annotation-parser.ts:315-331`; `<class '...'>` is normalized before generic/simple fallback at `src/core/annotation-parser.ts:308-312`; `ParamSpec.args/kwargs` only returns when known or `~`-prefixed, otherwise falls through at `src/core/annotation-parser.ts:297-305`; `Callable[...]` falls through if `parts.length < 2` at `src/core/annotation-parser.ts:390-436`; `Annotated[...]` falls through if no parts at `src/core/annotation-parser.ts:452-466`.

Codec refactor is plausible but not zero-risk. Dataframe and series are truly shareable except interpolated marker text: compare `src/utils/codec.ts:380-396` and `src/utils/codec.ts:399-415`. But ndarray is not the same helper because Arrow decode extracts values and conditionally reshapes using `shape.length !== 1` at `src/utils/codec.ts:418-456`. Torch is also special: it validates a nested ndarray envelope and recurses via `recurse(nested)` at `src/utils/codec.ts:523-546`. Any dispatch table must preserve MaybePromise exactly, including sync wrapper rejection when a Promise leaks at `src/utils/codec.ts:580-587`.

Mapper is a better candidate than annotation parsing. It is a sequence of preset/module/name guards at `src/core/mapper.ts:506-620`, with reusable local builders at `src/core/mapper.ts:482-504`. A rule list can work, but keep builders inside `mapPresetType` unless you want to thread primitive factories everywhere.

`validateConfig` should be decomposed into ordered section validators, not a generic dispatch table. Error order is observable because it throws first failure: top-level keys at `src/config/index.ts:131-134`, output/import path at `src/config/index.ts:137-155`, runtime at `src/config/index.ts:157-167`, performance at `src/config/index.ts:169-179`, types at `src/config/index.ts:181-204`, debug at `src/config/index.ts:206-208`.

`loadConfigFile` is the weakest refactor target. Extension dispatch is not the complexity; `.ts/.mts/.cts` evaluation is. The tricky behavior is already localized at `src/config/index.ts:291-383`, including private CommonJS eval at `src/config/index.ts:321-355` and temp ESM import at `src/config/index.ts:358-383`. A loader map would mostly hide control flow.

Dead-path claim: for `generate`, yes, analyzer/validation are effectively dead. `generate` fetches Python IR and transforms it at `src/tywrap.ts:158-194`; it only calls `globalParallelProcessor.setDebug()` via `tywrap()` at `src/tywrap.ts:43-49`. However, analyzer is not globally dead: `ParallelProcessor.analyzeModulesParallel()` exists at `src/utils/parallel-processor.ts:198-214`, workers instantiate `PyAnalyzer` at `src/utils/parallel-processor.ts:790-800`, and call `analyzePythonModule` at `src/utils/parallel-processor.ts:842-850`. `ValidationEngine` appears source-unreferenced outside its own file from the current search, but it is exported as a class at `src/core/validation.ts:51`.

**Recommendations**

Codec: use a marker map only after a shared `KNOWN_ENVELOPE_MARKERS` version check. I’d skip `DecodeCtx` unless more context is added; `decodeArrow` and `recurse` are only two parameters and are explicit.

Annotation parser: do not use a naive `Rule[]` of prefix closures. If refactored, use named parser functions called in a fixed hand-written sequence, or a `Rule[]` whose contract explicitly says “return `undefined` to preserve fall-through even after prefix match.” That contract matters because of `Callable` and `Annotated`.

Generate: extracting `loadOrFetchIr`, `applyModuleExportFilters`, and `emitOrCheckFiles` is more useful than dispatch-table work; the loop mixes independent responsibilities at `src/tywrap.ts:159-337`.

**Comments To Add**

Add a doc-comment above `decodeEnvelopeCore` at `src/utils/codec.ts:356`: explain markers may decode sync or async and sync callers must not receive Promise.

Add a short comment above the dataframe/series helper if introduced near `src/utils/codec.ts:380`: “dataframe and series envelopes intentionally share Arrow/JSON decoding; marker only affects exact error text.”

Keep or tighten the ndarray reshape comment at `src/utils/codec.ts:431-434`; it already explains the surprising part.

Add a comment before parser rules at `src/core/annotation-parser.ts:293`: “Order is semantic; some prefix matches intentionally fall through.”

Add a comment near `src/config/index.ts:321` and `src/config/index.ts:358` only if extracting loaders; current comments at `src/config/index.ts:321-325` and `src/config/index.ts:358-360` are already the right kind.