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

## SciPy (sparse matrices)

Targets:
- `scipy.sparse.csr_matrix`, `csc_matrix`, `coo_matrix`

Proposed envelope:
```
{ "__tywrap__": "scipy.sparse", "format": "csr|csc|coo", "dtype": "...", "shape": [r, c], "data": "...", "indices": "...", "indptr": "...", "encoding": "npy|arrow|json" }
```

Notes:
- Prefer dense conversion only behind an explicit `allowDenseFallback` option.
- JSON fallback should include warnings and size caps.

## Torch (tensors)

Targets:
- `torch.Tensor` (CPU tensors only by default)

Proposed envelope:
```
{ "__tywrap__": "torch.tensor", "dtype": "...", "shape": [...], "strides": [...], "device": "cpu|cuda", "encoding": "npy|arrow|raw" }
```

Notes:
- Default to CPU tensors; require opt-in for `.cpu()` conversion.
- Preserve dtype and strides; reject non-contiguous tensors unless explicitly allowed.
- Explore DLPack as a future fast path once stable across runtimes.

## Sklearn (models + outputs)

Targets:
- Primary outputs (predictions, scores) via existing numpy/pandas codecs.
- Optional model metadata envelope (no full model pickling by default).

Proposed envelope:
```
{ "__tywrap__": "sklearn.model", "class": "...", "version": "...", "params": {...} }
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
- Max payload sizes: per-call limits vs global caps?
- Versioning: should envelopes carry `codecVersion`?
