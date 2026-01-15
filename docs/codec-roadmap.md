# Codec Roadmap (SciPy, Torch, Sklearn)

This is a forward-looking plan for adding codecs beyond numpy/pandas. The focus is on explicit, loss-aware serialization with no silent fallbacks.

## Current Support

- SciPy sparse matrices (CSR/CSC/COO) via JSON envelopes.
- Torch tensors via ndarray envelope (CPU only; explicit copy opt-in).
- Sklearn estimators via JSON metadata envelopes.

## Goals

- Provide predictable, versioned envelopes for common scientific objects.
- Keep failures explicit unless a user opts into lossy fallbacks.
- Avoid heavy implicit conversions (CPU/GPU) without clear config.

## Envelope Conventions

All tywrap codec envelopes share:

- `__tywrap__`: string marker identifying the envelope type.
- `codecVersion`: currently `1` (decoders treat missing as legacy v0 for backward compatibility).
- `encoding`: how the payload is encoded.

### Size Limits

The subprocess JSONL transport is not streaming: large results must fit in memory and be serialized as a single JSON line.

- Set `TYWRAP_CODEC_MAX_BYTES` (bytes, UTF-8) to cap the maximum serialized response size emitted by the Python bridge.
  - If exceeded, the call fails with an explicit error instead of attempting a silent fallback.

## SciPy (sparse matrices)

Targets:
- `scipy.sparse.csr_matrix`, `csc_matrix`, `coo_matrix`

Envelope (current):
```
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
- Only `csr`/`csc`/`coo` formats are supported.
- Complex sparse matrices are rejected (explicit failure; no silent coercion).
- No dense fallback: callers should convert explicitly if needed.

## Torch (tensors)

Targets:
- `torch.Tensor` (CPU tensors only by default)

Envelope (current):
```
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
- Opt-in copy/transfer via `TYWRAP_TORCH_ALLOW_COPY=1`.

## Sklearn (models + outputs)

Targets:
- Primary outputs (predictions, scores) via existing numpy/pandas codecs.
- Optional model metadata envelope (no full model pickling by default).

Envelope (current):
```
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

## Implementation Phases

1. Define envelope specs and validation tests (round-trip + size limits).
2. Implement Python bridge serialization with feature detection.
3. Implement JS decoder + type mapping presets.
4. Add performance gates and CI coverage for the new codecs.

## Open Questions

- GPU handling: do we allow implicit device transfers?
- Max payload sizes: per-call limits vs global caps beyond `TYWRAP_CODEC_MAX_BYTES`?
