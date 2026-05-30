**(a) Parity**
Verdict: **PASS, with one transport-level RISK**

- Pyodide bootstrap does call the shared core with `bridge='pyodide'`, `pid=None`, `force_json_markers=True`, `allow_nan=False`, and `arrow_available_override=False`, so the server path cannot silently choose Arrow. See `src/runtime/pyodide-io.ts:128-136`.
- The shared serializers honor `force_json_markers` for ndarray/dataframe/series, and torch threads it into the nested ndarray envelope. Sparse and sklearn are JSON-only. See `runtime/tywrap_bridge_core.py:234-276`, `runtime/tywrap_bridge_core.py:284-320`, `runtime/tywrap_bridge_core.py:328-370`, `runtime/tywrap_bridge_core.py:399-425`, `runtime/tywrap_bridge_core.py:452-460`, `runtime/tywrap_bridge_core.py:478-486`.
- Meta is correct for Pyodide: `codecFallback` becomes `'json'` when `force_json_markers` is true, `pid` is `None`, and `arrowAvailable` is forced false. See `runtime/tywrap_bridge_core.py:767-794`, `runtime/tywrap_bridge_core.py:835-847`.
- Subprocess meta still reports `codecFallback='none'` when `TYWRAP_CODEC_FALLBACK` is unset: `FALLBACK_JSON` is env-derived, and `handle_meta()` passes `'json' if FALLBACK_JSON else 'none'`. See `runtime/python_bridge.py:75`, `runtime/python_bridge.py:218-224`.
- Bootstrap error ladder matches the reference shape: `ProtocolError` no traceback, handler errors with traceback, encode `CodecError` converted to `ValueError`. See `src/runtime/pyodide-io.ts:137-153`; reference ladder is `runtime/python_bridge.py:300-324`.
- The `sys.modules`/`exec` setup is sound: bootstrap imports `sys`, registers the module before `exec`, and the core’s lazy `import sys` in meta can resolve normally. See `src/runtime/pyodide-io.ts:94-106`, `runtime/tywrap_bridge_core.py:835-838`.
- Risk: production `PyodideIO.send()` pre-validates malformed requests in JS and throws instead of letting `__tywrap_dispatch()` return protocol error envelopes. That does not affect normal `BridgeProtocol` calls, but it means raw malformed-request parity is not true through the exposed transport. See `src/runtime/pyodide-io.ts:281-298`.

**(b) Conformance Suite**
Verdict: **GAP**

- The `pyodide-core` row imports `runtime/tywrap_bridge_core.py` directly under CPython; it does not execute `BOOTSTRAP_PYTHON` or the generated TS constant. See `test/runtime_conformance.test.ts:288-328` versus production bootstrap at `src/runtime/pyodide-io.ts:94-159`.
- The drift guard is a real source/string sync check, but only checks `generated.includes(JSON.stringify(source))`; it does not parse the generated module or execute the bootstrap. See `test/runtime_conformance.test.ts:986-997`.
- Marker comparison uses distinct processes (`node-json` and `pyodide-core`), but after this refactor both route through the same core, so it is not proving a separate Pyodide server implementation. See backend construction at `test/runtime_conformance.test.ts:350-361` and marker backend list at `test/runtime_conformance.test.ts:380-386`.
- Only ndarray has an exact `coreRes.result === nodeRes.result` equality assertion. Dataframe, series, sparse, torch, and sklearn mostly assert selected fields, so envelope drift in unasserted keys can pass. See exact ndarray comparison at `test/runtime_conformance.test.ts:968-979`; partial checks at `test/runtime_conformance.test.ts:801-930`.
- Silent no-op paths exist: most tests skip when Python/modules are unavailable, loops `continue` if a backend is missing, and the exact ndarray comparison returns early if `coreBackend` is absent. See `test/runtime_conformance.test.ts:400`, `test/runtime_conformance.test.ts:780`, `test/runtime_conformance.test.ts:783-786`, `test/runtime_conformance.test.ts:971`.

**(c) Wire Protocol**
Verdict: **GAP**

- Success envelope shape is unchanged for subprocess: current `main()` still emits `{id, protocol, result}` and errors use `{id, protocol, error}`. See `runtime/python_bridge.py:300-307`, `runtime/python_bridge.py:318-324`; HEAD did the same at `HEAD:runtime/python_bridge.py:917-924`, `HEAD:runtime/python_bridge.py:935-943`.
- Meta field set and order match HEAD. Current core builds `protocol`, `protocolVersion`, `bridge`, `pythonVersion`, `pid`, `codecFallback`, `arrowAvailable`, `scipyAvailable`, `torchAvailable`, `sklearnAvailable`, `instances`; HEAD used the same order. See `runtime/tywrap_bridge_core.py:782-794` and `HEAD:runtime/python_bridge.py:758-770`.
- Marker envelope keys/order are materially the same as HEAD for JSON fallback and Arrow paths. Example: ndarray JSON current `runtime/tywrap_bridge_core.py:270-276` vs HEAD `HEAD:runtime/python_bridge.py:396-402`; torch current `runtime/tywrap_bridge_core.py:452-460` vs HEAD `HEAD:runtime/python_bridge.py:601-609`.
- But the claim of byte-identical wire output is false for handler errors with tracebacks. Current handler errors now include `runtime/tywrap_bridge_core.py` frames because dispatch moved into the core; HEAD tracebacks only traversed `runtime/python_bridge.py`. Current call chain is `runtime/python_bridge.py:300`, `runtime/python_bridge.py:235-245`, `runtime/tywrap_bridge_core.py:823-830`, `runtime/tywrap_bridge_core.py:727-730`; HEAD was `HEAD:runtime/python_bridge.py:917-924`, `HEAD:runtime/python_bridge.py:823-846`, `HEAD:runtime/python_bridge.py:707-715`.
- Size guard messages appear preserved. Current request/response messages are `runtime/python_bridge.py:87-112`, `runtime/python_bridge.py:261-262`, `runtime/python_bridge.py:289-292`; HEAD equivalents are `HEAD:runtime/python_bridge.py:46-72`, `HEAD:runtime/python_bridge.py:877-879`, `HEAD:runtime/python_bridge.py:906-909`.
- Behavioral change: `TYWRAP_TORCH_ALLOW_COPY` is now parsed once at import/startup, while HEAD read it inside `serialize_torch_tensor()` per call. See current `runtime/python_bridge.py:75-76`, `runtime/tywrap_bridge_core.py:428-456`; HEAD `HEAD:runtime/python_bridge.py:576-605`.

**(d) Correctness Bugs**
Verdict: **BUG/RISK**

- Exposed `PyodideIO.call/instantiate/callMethod` are a separate client path and still bypass `SafeCodec.decodeResponse`; they return `response.result` directly. That means direct `PyodideIO.call()` can expose raw marker envelopes instead of decoded values. See export at `src/index.ts:35-38`, direct methods at `src/runtime/pyodide-io.ts:348-440`, raw parse at `src/runtime/pyodide-io.ts:487-499`; BridgeProtocol decodes via codec at `src/runtime/bridge-protocol.ts:305-318`, `src/runtime/bridge-protocol.ts:345-358`.
- The “old function names re-exported” claim is incomplete. HEAD defined public-ish names like `serialize_ndarray`, `serialize_dataframe`, `serialize_series`, `serialize_torch_tensor`, and handler helpers. See `HEAD:runtime/python_bridge.py:338`, `HEAD:runtime/python_bridge.py:405`, `HEAD:runtime/python_bridge.py:461`, `HEAD:runtime/python_bridge.py:576`, `HEAD:runtime/python_bridge.py:707-749`. Current `python_bridge.py` only imports a subset from core and does not re-export those names. See `runtime/python_bridge.py:31-58`, `runtime/python_bridge.py:178-245`.
- The conformance test mutates `runtime/` by writing a fixture module there. That is recoverable via `afterAll`, but it means the test has repo-write side effects. See `test/runtime_conformance.test.ts:93-106`, `test/runtime_conformance.test.ts:342-346`, `test/runtime_conformance.test.ts:365-374`.
- The NaN detection substring heuristic is not new, but it is brittle and duplicated: both SafeCodec and core classify any `ValueError` containing `nan`, `infinity`, or `inf` as NaN/Infinity. See `runtime/safe_codec.py:150-157`, `runtime/tywrap_bridge_core.py:674-678`.
- Generator writing progress to stderr is fine for the stated `npm pack --json` concern; it avoids stdout corruption. See `scripts/generate-pyodide-bootstrap.mjs:44-48`.

**Prioritized Findings**

1. **Byte-identical wire output is not preserved for handler errors with traceback.** The traceback now includes `tywrap_bridge_core.py` frames. This violates the hard “wire bytes unchanged” constraint if tracebacks are part of the golden capture. See `runtime/tywrap_bridge_core.py:853-865`, `runtime/python_bridge.py:300-307`, and HEAD `HEAD:runtime/python_bridge.py:917-924`.

2. **The conformance suite does not execute the real Pyodide bootstrap.** It imports the `.py` core directly, while production uses generated TS source inside `BOOTSTRAP_PYTHON`. A broken template, escaping bug, or missing `__tywrap_dispatch` could pass. See `test/runtime_conformance.test.ts:288-328`, `src/runtime/pyodide-io.ts:94-159`.

3. **Marker parity assertions are too partial after ndarray.** Only ndarray compares backend results exactly; the other five marker rows allow unasserted envelope drift. See `test/runtime_conformance.test.ts:968-979` versus `test/runtime_conformance.test.ts:801-930`.

4. **Direct `PyodideIO` remains an inconsistent exposed client.** It bypasses response decoding and can return raw marker envelopes, unlike `PyodideBridge`/`BridgeProtocol`. See `src/index.ts:35-38`, `src/runtime/pyodide-io.ts:487-499`, `src/runtime/bridge-protocol.ts:316-318`.

5. **Compatibility re-exports are incomplete.** Several names present in HEAD are absent from current `runtime/python_bridge.py`, despite the compatibility claim. See current import list `runtime/python_bridge.py:31-58` and HEAD definitions at `HEAD:runtime/python_bridge.py:338-749`.

Validation: `npm run lint -- --quiet` passed.