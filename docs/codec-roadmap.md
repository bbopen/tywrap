# Codec Roadmap (SciPy, Torch, Sklearn)

This is a forward-looking plan for adding codecs beyond numpy/pandas. The focus is on explicit, loss-aware serialization with no silent fallbacks.

## Current Support

- SciPy sparse matrices (CSR/CSC/COO) via JSON envelopes.
- Torch tensors via ndarray envelope (CPU only; explicit copy opt-in).
- Sklearn estimators via JSON metadata envelopes.

## Supported vs. Explicit Failure (envelope hardening)

The scientific codecs are deliberately narrow: a known-supported value round-trips,
and everything else fails **loudly** with an actionable message — tywrap never
silently coerces, densifies, pickles, or emits a payload the JS side cannot decode.
The Python serializer (`runtime/tywrap_bridge_core.py`) is the producer; the JS
decoder (`src/utils/codec.ts`) re-validates the envelope it receives as a cheap
second line of defense (it validates only — it never reconstructs a Python object).

### SciPy sparse

| | Behavior |
|---|---|
| **Supported** | `csr` / `csc` / `coo`; int / float / bool dtypes; empty matrices; any shape. dtype + shape preserved. |
| **Explicit failure (Python)** | Any other format (`dia`, `bsr`, `lil`, …) → names the supported set. Complex dtype → rejected (no silent coercion). |
| **Explicit failure (JS re-validation)** | `indptr` length ≠ majorAxis + 1; `indices`/`data` (or COO `row`/`col`/`data`) length mismatch; any index non-integer or out of `[0, minorAxis)`; non-2-item shape. |

### Torch tensors

| | Behavior |
|---|---|
| **Supported** | CPU, contiguous, strided tensors: scalar / 1D / ND; int / float dtypes; Arrow or JSON nested ndarray. shape / dtype / device metadata preserved. |
| **Opt-in (lossy/transfer)** | Non-CPU device **or** non-contiguous layout → rejected **unless** `TYWRAP_TORCH_ALLOW_COPY=1` (then a CPU / contiguous copy is made). Default is rejection. |
| **Explicit failure (Python), NOT opt-in-able** | Sparse (any non-strided layout: COO/CSR/CSC/BSR/BSC), quantized, `meta`, and complex tensors are rejected categorically — `TYWRAP_TORCH_ALLOW_COPY` does **not** bypass them (they have no faithful dense-CPU JSON/Arrow representation). |
| **Explicit failure (JS re-validation)** | `shape` dim negative/non-integer; `shape` element-count disagrees with the nested ndarray `shape`; `device` an empty string; nested `value` not an ndarray envelope. |

### Sklearn estimators

| | Behavior |
|---|---|
| **Supported** | Metadata only: `className`, `module`, `version`, and `get_params(deep=False)` when every param value is plain JSON (primitives / arrays / plain objects). |
| **Explicit failure (Python)** | Any non-JSON param (callable, nested estimator/object, numpy array, NaN/Infinity) → rejected with the **offending param name** and a reminder that estimators are metadata-only (no pickle/joblib). |
| **Explicit failure (JS re-validation)** | `params` not a plain JSON object; any nested param value that is a function / symbol / bigint / class instance / non-finite number. |
| **Never** | `pickle` / `joblib`. Full-model serialization stays an explicit, opt-in follow-up. |

## Goals

- Provide predictable, versioned envelopes for common scientific objects.
- Keep failures explicit unless a user opts into lossy fallbacks.
- Avoid heavy implicit conversions (CPU/GPU) without clear config.

## DX Defaults (Decisions)

- Arrow is the default for ndarray/dataframe/series. The JS runtime auto-registers an Arrow decoder when `apache-arrow` is importable, so users do not have to wire it manually. Node/Bun/Deno and HTTP bridges register eagerly during `init()`; in addition, the codec lazily imports `apache-arrow` on the first Arrow-encoded response (cached for the process) so callers that bypass `init()` still work.
- `apache-arrow` is an **optional** dependency: it is not in tywrap's runtime `dependencies` (declared as an optional peer). Installing tywrap never pulls it in or fails without it.
- No silent lossy fallback: if an Arrow-encoded payload arrives and `apache-arrow` is unavailable, decoding fails with an actionable error telling you to `npm install apache-arrow` or set `TYWRAP_CODEC_FALLBACK=json` on the Python side. tywrap never quietly downgrades Arrow data to JSON.
- JSON fallback is opt-in only (via `TYWRAP_CODEC_FALLBACK=json`) and remains explicitly lossy for dtype/NA fidelity.
- GPU handling stays explicit: no implicit `.cpu()` or contiguous copies. Opt-in copy/transfer remains available, and GPU-native transport is a follow-up track (DLPack/Arrow CUDA).
- Large payloads should not be forced through single-line JSONL forever; add an artifact/chunked transport to keep responses reliable without silent truncation.

## Envelope Conventions

All tywrap codec envelopes share:

- `__tywrap__`: string marker identifying the envelope type.
- `codecVersion`: currently `1` (decoders treat missing as legacy v0 for backward compatibility).
- `encoding`: how the payload is encoded.

### Size Limits

The subprocess JSONL transport is not streaming: large results must fit in memory and be serialized as a single JSON line.

- Set `TYWRAP_CODEC_MAX_BYTES` (bytes, UTF-8) to cap the maximum serialized response size emitted by the Python bridge.
  - If exceeded, the call fails with an explicit error instead of attempting a silent fallback.
- Planned: add an artifact/chunked transport path for large payloads to avoid JSONL size ceilings.

### Feature Detection

Bridge metadata should surface optional codec availability to help the JS side decide when to rely on SciPy/Torch/Sklearn codecs.

## SciPy (sparse matrices)

Targets:
- `scipy.sparse.csr_matrix`, `csc_matrix`, `coo_matrix`

Envelope (current):

```json
{
  "__tywrap__": "scipy.sparse",
  "codecVersion": 1,
  "encoding": "json",
  "format": "csr" | "csc" | "coo",
  "dtype": "float64",
  "shape": [rows, cols],
  "data": [ ... ],

  // csr/csc only:
  "indices": [ ... ],
  "indptr": [ ... ],

  // coo only:
  "row": [ ... ],
  "col": [ ... ]
}
```

Notes:
- Only `csr`/`csc`/`coo` formats are supported; any other format is rejected with a message naming the supported set.
- Complex sparse matrices are rejected (explicit failure; no silent coercion).
- No dense fallback: callers should convert explicitly if needed.
- The JS decoder re-validates structural consistency (array lengths vs shape, index ranges) and rejects a corrupt envelope rather than passing it through.

## Torch (tensors)

Targets:
- `torch.Tensor` (CPU tensors only by default)

Envelope (current):

```json
{
  "__tywrap__": "torch.tensor",
  "codecVersion": 1,
  "encoding": "ndarray",
  "shape": [ ... ],
  "dtype": "float32",
  "device": "cpu" | "cuda:0" | ...,

  // Nested ndarray envelope:
  "value": {
    "__tywrap__": "ndarray",
    "codecVersion": 1,
    "encoding": "arrow" | "json",
    "b64": "...",        // when encoding="arrow"
    "data": [ ... ],     // when encoding="json"
    "shape": [ ... ]
  }
}
```

Notes:
- Default to CPU tensors; require opt-in for `.cpu()` conversion.
- Reject non-contiguous tensors unless explicitly allowed.
- Opt-in copy/transfer via `TYWRAP_TORCH_ALLOW_COPY=1` (covers non-CPU device + non-contiguous layout ONLY).
- Sparse / quantized / `meta` / complex tensors are rejected categorically and are **not** bypassable by `TYWRAP_TORCH_ALLOW_COPY`; convert explicitly (`to_dense()` / `dequantize()` / materialize / split real-imag) before returning.
- Future: GPU-native transport (DLPack/Arrow CUDA) to avoid implicit device transfers.

## Sklearn (models + outputs)

Targets:
- Primary outputs (predictions, scores) via existing numpy/pandas codecs.
- Optional model metadata envelope (no full model pickling by default).

Envelope (current):

```json
{
  "__tywrap__": "sklearn.estimator",
  "codecVersion": 1,
  "encoding": "json",
  "className": "LinearRegression",
  "module": "sklearn.linear_model._base",
  "version": "1.4.2",
  "params": { ... }
}
```

Notes:
- Avoid `pickle` or `joblib` without explicit opt-in due to security and size.
- Keep model serialization as an advanced, explicit feature.
- Every `get_params(deep=False)` value must be plain JSON; a callable, nested estimator, or other non-JSON param is rejected with the offending param name (no silent drop, no pickle). The JS decoder re-validates `params` is a plain JSON object.

## Implementation Phases

1. Define envelope specs and validation tests (round-trip + size limits).
2. Implement Python bridge serialization with feature detection.
3. Implement JS decoder + type mapping presets.
4. Make Arrow frictionless (auto-register decoder + living app on Arrow path).
5. Add payload scaling via artifact/chunked transport (protocol versioned if needed).
6. Improve scientific codec ergonomics (explicit GPU opt-in, SciPy format expansion, safe sklearn opt-ins).
7. Add performance gates and CI coverage for the new codecs.
