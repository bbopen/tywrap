**Verdict: mixed.** The property/overload/version/cache diagnoses are real. The classmethod claim is wrong for normal user-defined `@classmethod`: `inspect.getmembers(..., getattr)` returns a bound method, and `inspect.ismethoddescriptor` explicitly returns false for methods. `@staticmethod` is captured, but as a plain function, so semantics are lost.

**(a) Confirm / Refute**

- Confirm `@property` omission. `_extract_class` only admits `isfunction`, `ismethoddescriptor`, or `isbuiltin` members; there is no property branch (`tywrap_ir/tywrap_ir/ir.py:481-485`). `IRClass` has only `methods` and `fields`, no accessor slot (`tywrap_ir/tywrap_ir/ir.py:50-64`). CPython already classifies property separately (`inspect.py:541-554`, `inspect.py:644-646`).
- Refute “classmethods pass `ismethoddescriptor`.” `getmembers` uses `getattr` (`inspect.py:520-523`), and `ismethoddescriptor` explicitly returns false when `ismethod()` or `isfunction()` is true (`inspect.py:196-217`). So a normal `@classmethod` is dropped by this predicate, not merely mislabeled.
- Confirm `@staticmethod` is captured but mislabeled. Static methods are unwrapped by `getattr` to a function, so they satisfy `isfunction`; the IR has no `method_kind` field (`tywrap_ir/tywrap_ir/ir.py:38-48`) and TS strips both `self` and `cls` generically (`src/core/generator.ts:699-703`).
- Confirm overload loss. `_extract_function` reads one `inspect.signature(obj)` and returns one `IRFunction` (`tywrap_ir/tywrap_ir/ir.py:416-468`); `IRFunction` has no overloads field (`tywrap_ir/tywrap_ir/ir.py:38-48`).
- Confirm production `generate()` path is the non-optimized Python IR path. TS invokes `python -m tywrap_ir --module ... --ir-version ...` (`src/tywrap.ts:350-372`) or local `__main__.py` fallback (`src/tywrap.ts:392-413`); `__main__.py` calls `emit_ir_json` (`tywrap_ir/tywrap_ir/__main__.py:23-29`), which calls non-optimized `extract_module_ir` (`tywrap_ir/tywrap_ir/ir.py:704-715`).
- Confirm `optimized_ir.py` is off that path but has the `None` cache bug. `IRCache.get()` returns `None` on miss (`tywrap_ir/tywrap_ir/optimized_ir.py:77-86`), and `cached_function` treats `None` as miss (`tywrap_ir/tywrap_ir/optimized_ir.py:108-114`). The optimized entry is separate (`tywrap_ir/tywrap_ir/optimized_ir.py:412-417`) and only appears in Python optimized tests, not `src/tywrap.ts`.
- Qualify PyAnalyzer deletion. `PyAnalyzer` is not exported from `src/index.ts`; only `AnalysisResult` types are (`src/index.ts:85-132`). Its live source import is `parallel-processor` (`src/utils/parallel-processor.ts:12-16`), whose global instance is only debug-configured by `tywrap()` (`src/tywrap.ts:21`, `src/tywrap.ts:47-49`). But `PyAnalyzer` does provide source-string analysis (`src/core/analyzer.ts:56-58`), so deletion is “zero production generate cost,” not “zero capability cost.”

**(b) Refactor Critique**

- Prefer `inspect.classify_class_attrs` or `inspect.getmembers_static` over hand MRO walking. `classify_class_attrs` already returns `property`, `class method`, `static method`, `method`, defining class, and descriptor object (`inspect.py:541-560`, `inspect.py:637-650`). That is safer for inherited members, descriptor identity, and metaclass attributes than reimplementing MRO traversal.
- `cached_property` is not classified as `property` by CPython; it comes through as a descriptor/method-like object, so handle it explicitly before calling `_extract_function`, or it will hit `inspect.signature` and be discarded (`tywrap_ir/tywrap_ir/ir.py:416-419`).
- Do not strip `cls` twice. Current generator already filters `self` and `cls` (`src/core/generator.ts:699-703`); if Python IR also strips `cls`, TS must use `method_kind`, not name-based filtering.
- Accessors should be separate from `fields`. Today `fields` means TypedDict/NamedTuple/dataclass/Pydantic data (`tywrap_ir/tywrap_ir/ir.py:497-547`, `tywrap_ir/tywrap_ir/ir.py:549-617`) and TS maps those to `properties` (`src/tywrap.ts:554-566`). Mixing runtime properties into `fields` would blur data-shape aliases with callable instance wrappers.
- Bumping IR to `0.3.0` is correct if adding accessors/overloads/method kind, but it invalidates TS cache keys because `TYWRAP_IR_VERSION` is embedded in CLI calls and cache keys (`src/tywrap.ts:25`, `src/tywrap.ts:371`, `src/tywrap.ts:626`).
- Deleting PyAnalyzer should be bundled with deleting `parallel-processor` and its tests. `parallel-processor` has a public exported class in source (`src/utils/parallel-processor.ts:126`) and many tests import it directly, so this is a real cleanup, not just one file removal.

**(c) Comments To Add**

- `tywrap_ir/tywrap_ir/ir.py`, `_extract_class`, before member loop:  
  `# Keep descriptor classification explicit: getattr-based getmembers hides or unwraps property/classmethod/staticmethod in different ways, so a predicate-only scan silently drops accessors and class methods.`
- `tywrap_ir/tywrap_ir/ir.py`, classmethod branch:  
  `# classmethod stores the callable on __func__; inspect.signature(getattr(cls, name)) is already bound and loses the leading cls parameter.`
- `tywrap_ir/tywrap_ir/ir.py`, staticmethod branch:  
  `# staticmethod also stores the callable on __func__; tag it so the TS generator emits a static member instead of an instance method.`
- `tywrap_ir/tywrap_ir/ir.py`, overload extraction in `_extract_function`:  
  `# typing.get_overloads is the only runtime API that preserves @overload alternatives; inspect.signature sees only the final implementation.`
- `tywrap_ir/tywrap_ir/ir.py`, overload Python-version guard:  
  `# Python 3.10 cannot report overload alternatives, so emit one module warning instead of pretending the implementation signature is complete.`
- `src/tywrap.ts`, above `fetchPythonIr`:  
  `// This is the authoritative production analyzer path: generated wrappers come from python -m tywrap_ir, not the tree-sitter PyAnalyzer.`
- `src/core/analyzer.ts`, file header if kept:  
  `// Source-only experimental analyzer; it is not used by generate() and must not define wrapper IR semantics.`
- `tywrap_ir/tywrap_ir/optimized_ir.py`, `IRCache.get`:  
  `# A cached value may legitimately be None; use _MISS internally so None is distinguishable from an absent key.`
- `tywrap_ir/tywrap_ir/optimized_ir.py`, optimized extractor entry:  
  `# This optimized extractor is not used by the TypeScript generate() path; keep behavior aligned with ir.py but treat cache fixes as performance-only.`