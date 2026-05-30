I would approve the direction, but not as written. The main idea is right; a few details need tightening before implementation.

**Q1. Share vs Port**

Share is the right call. Porting the serializer into `BOOTSTRAP_PYTHON` recreates the exact failure mode T5.0 is trying to kill. The current reference logic in [runtime/python_bridge.py](/Users/brettbonner/tywrap/runtime/python_bridge.py) is already mostly pure enough to extract.

Caveats:

- Do not rely on runtime `fs` reads from the browser bundle. Build-time inlining or generated TS is fine; browser/runtime filesystem lookup is not.
- Prefer a generated TS string constant made from `runtime/tywrap_bridge_core.py`. Add the generated step to `npm run build`, and make tests assert the generated/bootstrap source is current.
- Pyodide FS write is feasible, but the current `PyodideInstance` interface has no `FS`; direct `exec` into a `types.ModuleType` registered in `sys.modules` may be less invasive.
- “No SafeCodec import in core” is fine, but then core must not become a second half-copy of SafeCodec. Either extract the shared default encoder behavior into core and let `safe_codec.py` reuse it, or add conformance coverage for every SafeCodec behavior you copy into core.

**Q2. Conformance Matrix**

Good start, but incomplete.

Add these cases:

- `instantiate` / `call_method` / `dispose_instance`, including `meta.instances` before and after.
- stdlib serialization explicitly: `datetime`, `date`, `time`, `timedelta`, `Decimal`, `UUID`, `Path`.
- SafeCodec edge cases: bytes response, set/frozenset response, numpy scalar, pandas scalar/NaT where modules exist, complex rejection.
- legacy bytes request envelope as well as `Uint8Array`.
- Python-returned nested NaN/Infinity, not just top-level.
- pydantic model serialization. It already exists in the reference serializer; excluding it leaves another drift vector.
- Node default Arrow mode and Node `TYWRAP_CODEC_FALLBACK=json` mode. `force_json_markers=True` should match the explicit fallback path.
- malformed request shape parity: bad protocol, bad id, missing params, unknown method.

For HTTP, avoid a “faithful fixture” unless it literally calls the same core. A fake HTTP server can become the third divergent implementation. If practical, make the HTTP row wrap the real `python_bridge.py` or the extracted core.

Real Pyodide can remain optional, but you need a non-optional test that executes the Pyodide bootstrap/core under CPython. Since `pyodide` is a peer dependency and absent locally, an optional-only real-Pyodide row will not protect CI.

**Q3. Parity / Wire-Compat Risks**

Relax the meta validator. Do not make Pyodide lie with `bridge='python-subprocess'` and fake pid. Truthful meta is the right contract.

But the design misses two local surfaces:

- [src/types/index.ts](/Users/brettbonner/tywrap/src/types/index.ts:367) types `BridgeInfo.bridge` as only `'python-subprocess'` and `pid` as `number`. That must widen to something like `'python-subprocess' | 'pyodide' | 'http'` and `number | null`.
- [src/runtime/bridge-core.ts](/Users/brettbonner/tywrap/src/runtime/bridge-core.ts:388) also hardcodes `python-subprocess`, separate from `bridge-protocol.ts`.

Use a known union, not “any non-empty string”; this is still a validator.

I would keep `pid: null` for Pyodide rather than omit it, because the meta shape is already documented/tested as a fixed payload.

On deleting functions from `python_bridge.py`: repo-local imports do not appear to depend on them, but it is still low-risk to re-export/import the old names into `python_bridge.py` instead of making them disappear. This package ships `runtime/`, so accidental external imports are plausible.

For `force_json_markers`, make it a parameter through every serializer, including nested `torch.tensor -> ndarray`. Do not use a mutable global override.

**Q4. Node/HTTP Wire Bytes**

Yes, this design can silently change Node/HTTP bytes unless guarded.

High-risk spots:

- dict key order in marker envelopes and meta payloads;
- exception class names and messages after moving `ProtocolError`;
- traceback inclusion rules: protocol/request errors currently omit traceback, handler errors include it;
- `SafeCodec.encode()` behavior for bytes, sets, numpy/pandas scalars, Pydantic, and NaN wording;
- `codecFallback` and Arrow failure messages;
- package contents: add `runtime/tywrap_bridge_core.py` to the packaging test.

For Node, keep final response encoding through existing `SafeCodec` and preserve the current `main()` error ladder. Add golden-ish tests comparing representative raw responses before/after, especially meta, bytes, JSON fallback ndarray, and NaN failure.