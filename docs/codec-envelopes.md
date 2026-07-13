# Scientific Codec Envelopes

tywrap serializes supported SciPy, Torch, and Sklearn values with versioned
envelopes. The Python bridge produces them and the JavaScript codec validates
them before exposing decoded values to an application.

## Support and failures

### SciPy sparse matrices

| Case | Behavior |
| --- | --- |
| Supported | `csr`, `csc`, and `coo` matrices with integer, floating-point, or boolean dtypes. Empty matrices and any two-dimensional shape work. The dtype and shape are preserved. |
| Python rejection | Other formats, including `dia`, `bsr`, and `lil`, fail with the supported formats in the error. Complex dtypes fail rather than being coerced. |
| JavaScript validation | The decoder rejects an invalid `indptr` length, mismatched index and data lengths, non-integer or out-of-range indexes, and a shape that does not contain two items. |

### Torch tensors

| Case | Behavior |
| --- | --- |
| Supported | CPU, contiguous, strided tensors with integer or floating-point dtypes. Scalars and tensors of any dimension use an ndarray envelope. Shape, dtype, and device metadata are preserved. |
| Opt-in copy | Non-CPU tensors and non-contiguous layouts fail unless `TYWRAP_TORCH_ALLOW_COPY=1`. With that setting, the bridge creates a CPU, contiguous copy. |
| Python rejection | Sparse layouts, quantized tensors, `meta` tensors, and complex dtypes always fail. `TYWRAP_TORCH_ALLOW_COPY` does not change those cases. |
| JavaScript validation | The decoder rejects negative or non-integer dimensions, a nested ndarray shape that disagrees with the outer shape, an empty device string, and a non-ndarray nested value. |

### Sklearn estimators

| Case | Behavior |
| --- | --- |
| Supported | Metadata only: `className`, `module`, `version`, and `get_params(deep=False)` when every parameter is plain JSON. |
| Python rejection | A callable, nested estimator, NumPy array, non-finite number, or other non-JSON parameter fails with the parameter name. |
| JavaScript validation | The decoder requires `params` to be a plain JSON object and rejects functions, symbols, bigints, class instances, and non-finite numbers within it. |
| Excluded | The envelope never contains `pickle` or `joblib` data. |

## Envelope conventions

Every scientific envelope has these fields:

- `__tywrap__` identifies the envelope type.
- `codecVersion` is `1`. Decoders treat a missing version as legacy version `0`.
- `encoding` identifies the payload representation.

### SciPy sparse

Supported targets are `scipy.sparse.csr_matrix`, `csc_matrix`, and
`coo_matrix`. The block below is a schema sketch, not a literal payload:

```jsonc
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

There is no dense fallback. Convert a matrix explicitly before returning it if
your consumer needs a dense value.

### Torch tensor

The target is `torch.Tensor`. CPU tensors work by default. Schema sketch:

```jsonc
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

Set `TYWRAP_TORCH_ALLOW_COPY=1` only when the CPU transfer or contiguous copy
is acceptable for the call.

### Sklearn estimator

Sklearn prediction and score values use the existing NumPy and pandas codecs.
An estimator itself can use this metadata envelope (schema sketch):

```jsonc
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

## Arrow and JSON

Arrow is the default encoding for ndarrays, DataFrames, and Series when both
sides support it: the Python bridge needs `pyarrow` (reported as
`arrowAvailable` in `BridgeInfo`) and the JavaScript runtime needs the optional
`apache-arrow` peer dependency. The Pyodide transport is JSON-only because
pyarrow is not available in WASM.

If an Arrow payload arrives without the dependency, decoding fails with an
installation hint. Set `TYWRAP_CODEC_FALLBACK=json` on the Python side when a
JSON fallback is acceptable. JSON fallback is lossy for dtype and missing-value
fidelity.

## Size limits and transport framing

`TYWRAP_CODEC_MAX_BYTES` limits the serialized response size emitted by the
Python bridge. It accepts a byte count in UTF-8. A response that exceeds the
limit fails instead of changing encoding.

Subprocess messages larger than one JSONL line use the `tywrap-frame/1`
framing protocol. See [Transport framing](./transport-framing.md) for its size
limits, negotiation history, and backend support.

## Feature detection

The bridge `meta` response reports `scipyAvailable`, `torchAvailable`, and
`sklearnAvailable`. Each field says whether the matching Python package is
importable in that bridge environment.

## Runtime return validation

Generated module functions and static methods validate decoded results before
their promises resolve. A result that does not match its declared return type
throws `BridgeValidationError` with the declared type, received shape, and call
site.

Columnar values retain their decoded provenance. Validation checks the envelope
marker, dimensions, and dtype for DataFrame, Series, and ndarray returns
without walking Arrow data. Returns declared as `unknown`, `void`, or `Any` do
not receive a runtime check.
