"""
Shared tywrap bridge core: protocol dispatch + value (de)serialization.

This module is the SINGLE source of truth for the "tywrap/1" server-side
protocol. It is imported by:

  - runtime/python_bridge.py  (the Node/Bun/Deno subprocess server and the HTTP
    server), which owns I/O concerns: the stdin/stdout JSONL loop, env-var size
    guards, the real OS pid, bridge='python-subprocess', and the final BridgeCodec
    encode wrapper.

  - the in-WASM Pyodide server (src/runtime/pyodide-transport.ts). Pyodide cannot read
    this file from disk, so it is shipped as a build-time-generated TypeScript
    string constant (src/runtime/pyodide-bootstrap-core.generated.ts) produced by
    scripts/generate-pyodide-bootstrap.mjs and exec'd into a module registered in
    sys.modules. A conformance drift guard (test/runtime_conformance.test.ts)
    asserts the generated constant stays byte-identical to this file.

CROSS-LANGUAGE CONTRACT (Python <-> the TypeScript decoder in src/utils/codec.ts
and the request encoder in src/runtime/bridge-codec.ts):

  * Every value-type "marker" envelope carries {'__tywrap__': <type>,
    'codecVersion': 1, 'encoding': ...}. The 6 markers are: ndarray, dataframe,
    series, scipy.sparse, torch.tensor, sklearn.estimator.
  * bytes round-trip both ways via base64 envelopes (see _deserialize_bytes_*
    and the bytes branch of default_encoder).
  * NaN/Infinity are rejected (the JS client cannot parse the non-standard tokens
    that allow_nan=True would emit).

PURITY: This module depends only on the standard library plus LAZY optional
imports (numpy/pandas/scipy/torch/sklearn/pyarrow are each imported inside the
function that needs them). It performs no stdin/stdout I/O and reads no env vars,
so it runs unchanged under CPython-in-WASM (Pyodide).

force_json_markers: a *parameter* threaded through every serializer (including
the nested torch.tensor -> ndarray call). When True, ndarray/dataframe/series are
forced down their JSON path regardless of pyarrow availability. Pyodide passes
True (Arrow is unavailable in WASM); the subprocess server passes the boolean
derived from TYWRAP_CODEC_FALLBACK=json so that "Node in json-fallback mode" and
"Pyodide" produce byte-identical marker envelopes.
"""

import base64
import datetime as dt
import decimal
import importlib
import importlib.util
import json
import math
import re
import sys
import traceback
import uuid
from pathlib import Path, PurePath

# Protocol constants. These MUST match src/runtime/protocol.ts (PROTOCOL_ID,
# TYWRAP_PROTOCOL_VERSION) and the codec version baked into marker envelopes.
PROTOCOL = 'tywrap/1'
PROTOCOL_VERSION = 1
CODEC_VERSION = 1
MAX_SERIALIZE_DEPTH = 900
MAX_SERIALIZE_NODES = 1_000_000
_SERIALIZE_PATH_IDENTIFIER = re.compile(r'^[A-Za-z_$][\w$]*$', re.ASCII)


class ProtocolError(Exception):
    """Raised for malformed requests (bad protocol/id/method/params)."""


class ImportNotAllowedError(PermissionError):
    """Raised when a requested module import is not on the active allowlist."""

    def __init__(self, module_name):
        super().__init__(
            f'Import of module {module_name!r} is not permitted by the tywrap bridge '
            'allowlist; add it to TYWRAP_ALLOWED_MODULES (subprocess) or the '
            'allowed_modules parameter to enable it'
        )


class AttributeNotAllowedError(PermissionError):
    """Raised when access to a private/dunder attribute is denied by policy."""

    def __init__(self, attr_name):
        super().__init__(
            f'Access to attribute {attr_name!r} is not permitted by the tywrap bridge: '
            'underscore-prefixed (private/dunder) attributes are blocked to prevent '
            'sandbox-escape via attributes like __globals__/__subclasses__/__builtins__; '
            'set TYWRAP_ALLOW_PRIVATE_ATTRS=1 (subprocess) or pass allow_private_attrs=True '
            'to override'
        )


# =============================================================================
# IMPORT / ATTRIBUTE ALLOWLIST (trust boundary enforcement)
# =============================================================================
#
# The bridge dispatches call requests by importing the requested module and
# getattr-ing the requested function/class method. That is an
# arbitrary import+getattr+call surface, so two complementary guards live here.
# Both are PURE (no env reads) so the rules behave identically under the
# subprocess server and the in-WASM Pyodide server; the subprocess server derives
# the parameters from env vars (TYWRAP_ALLOWED_MODULES / TYWRAP_ALLOW_PRIVATE_ATTRS)
# and threads them in, exactly like force_json_markers / torch_allow_copy.
#
# 1. MODULE ALLOWLIST (opt-in, default = allow all):
#    allowed_modules=None means "no restriction" so existing configurations keep
#    working unchanged. When a caller supplies a set, only those modules (plus the
#    stdlib the bridge itself needs to serialize results, see _BRIDGE_REQUIRED_MODULES)
#    may be imported; submodules of an allowed module are permitted (e.g. allowing
#    'scipy' also allows 'scipy.sparse'). A non-allowlisted import fails LOUDLY with
#    ImportNotAllowedError rather than silently importing.
#
# 2. PRIVATE-ATTRIBUTE BLOCK (default ON):
#    getattr of any name starting with '_' (single-underscore private OR dunder) is
#    rejected. This blocks the classic escape chain (obj.__class__.__subclasses__()
#    /__globals__/__builtins__/__import__) without depending on the module allowlist.
#    tywrap-generated wrappers never reference underscore-prefixed names (the IR
#    analyzer skips them), so this does not regress generated code. Set
#    allow_private_attrs=True to restore unrestricted getattr for trusted callers.

# Stdlib modules the bridge's own serialization/handlers may need to import even
# when a caller-supplied allowlist is active. Optional codec deps (numpy, pandas,
# scipy, torch, sklearn, pyarrow) are intentionally NOT here: if a caller restricts
# modules, they must opt those in explicitly. These names cover only what the
# bridge core itself imports.
_BRIDGE_REQUIRED_MODULES = frozenset(
    {
        'base64',
        'datetime',
        'decimal',
        'importlib',
        'json',
        'math',
        'sys',
        'traceback',
        'uuid',
        'pathlib',
    }
)


def _top_level_package(module_name):
    """Return the top-level package of a dotted module name ('a.b.c' -> 'a')."""
    return module_name.split('.', 1)[0]


def _is_module_allowed(module_name, allowed_modules):
    """
    Return True when module_name may be imported under the active policy.

    allowed_modules=None disables enforcement (allow all). Otherwise a module is
    allowed when it (or its top-level package) is explicitly listed, or it is one
    of the stdlib modules the bridge itself requires.
    """
    if allowed_modules is None:
        return True
    if module_name in allowed_modules or module_name in _BRIDGE_REQUIRED_MODULES:
        return True
    top = _top_level_package(module_name)
    return top in allowed_modules or top in _BRIDGE_REQUIRED_MODULES


def import_allowed_module(module_name, allowed_modules):
    """
    Import module_name only if permitted by the allowlist, else raise loudly.

    This is the single chokepoint every handler routes module imports through.
    """
    if not _is_module_allowed(module_name, allowed_modules):
        raise ImportNotAllowedError(module_name)
    return importlib.import_module(module_name)


def get_allowed_attr(obj, attr_name, *, allow_private_attrs):
    """
    getattr(obj, attr_name) with the private/dunder block applied.

    Rejects any underscore-prefixed name unless allow_private_attrs is True. This
    is the single chokepoint every handler routes attribute access through.
    """
    if not allow_private_attrs and attr_name.startswith('_'):
        raise AttributeNotAllowedError(attr_name)
    return getattr(obj, attr_name)


def resolve_allowed_attr_path(root, dotted_name, *, allow_private_attrs):
    """
    Resolve a possibly-dotted attribute path from root, applying the
    private/dunder getattr guard to EVERY segment.

    A single segment (the common case, e.g. a module-level function) behaves
    exactly like get_allowed_attr. Dotted names exist because @classmethod and
    @staticmethod are invoked through their owning class: the generated wrapper
    emits call(module, 'Class.method', ...), so the bridge must walk
    module -> Class -> method. Guarding each segment means 'Class._secret' or
    '_Hidden.method' are rejected exactly as a direct private getattr would be —
    the dotted path opens no access the single-getattr path did not already.
    """
    obj = root
    for segment in dotted_name.split('.'):
        obj = get_allowed_attr(obj, segment, allow_private_attrs=allow_private_attrs)
    return obj


class CodecError(Exception):
    """Raised when value encoding fails (e.g. NaN/Infinity not allowed)."""


# =============================================================================
# REQUEST-SIDE DESERIALIZATION (bytes envelopes -> Python bytes)
# =============================================================================

_NO_DESERIALIZE = object()
_ERR_BYTES_MISSING_B64 = 'Invalid bytes envelope: missing b64'
_ERR_BYTES_MISSING_DATA = 'Invalid bytes envelope: missing data'
_ERR_BYTES_INVALID_BASE64 = 'Invalid bytes envelope: invalid base64'


def _deserialize_bytes_envelope(value):
    """
    Decode base64-encoded bytes envelopes from JS into Python bytes.

    Supported shapes:
    - { "__tywrap_bytes__": true, "b64": "..." }  (JS BridgeCodec.encodeRequest)
    - { "__type__": "bytes", "encoding": "base64", "data": "..." }  (legacy/compat)

    Why: TS BridgeCodec encodes Uint8Array/ArrayBuffer as base64 objects, but
    Python handlers expect real bytes/bytearray to preserve behavior (e.g., len()).
    """
    if not isinstance(value, dict):
        return _NO_DESERIALIZE

    if value.get('__tywrap_bytes__') is True:
        b64 = value.get('b64')
        if not isinstance(b64, str):
            raise ProtocolError(_ERR_BYTES_MISSING_B64)
        try:
            return base64.b64decode(b64, validate=True)
        except Exception as exc:
            raise ProtocolError(_ERR_BYTES_INVALID_BASE64) from exc

    if value.get('__type__') == 'bytes' and value.get('encoding') == 'base64':
        data = value.get('data')
        if not isinstance(data, str):
            raise ProtocolError(_ERR_BYTES_MISSING_DATA)
        try:
            return base64.b64decode(data, validate=True)
        except Exception as exc:
            raise ProtocolError(_ERR_BYTES_INVALID_BASE64) from exc

    return _NO_DESERIALIZE


def deserialize(value, *, has_envelope_markers=True):
    """
    Recursively deserialize request values into Python-native types.

    Why: requests are JSON-only; we need a small set of explicit decoders
    (currently bytes) to restore Python semantics at the boundary.
    """
    if not has_envelope_markers:
        return value
    decoded = _deserialize_bytes_envelope(value)
    if decoded is not _NO_DESERIALIZE:
        return decoded

    if isinstance(value, list):
        return [deserialize(item, has_envelope_markers=True) for item in value]
    if isinstance(value, dict):
        # Preserve dict shape while decoding nested values.
        return {k: deserialize(v, has_envelope_markers=True) for k, v in value.items()}
    return value


# =============================================================================
# CAPABILITY DETECTION (lazy, best-effort)
# =============================================================================

def arrow_available():
    """Return True when pyarrow can be imported."""
    try:
        import pyarrow  # noqa: F401
    except (ImportError, OSError):
        return False
    return True


def module_available(module_name):
    """
    Lightweight feature detection for optional codec dependencies via find_spec.

    Why: exposes availability in bridge metadata without importing heavy modules.
    """
    try:
        return importlib.util.find_spec(module_name) is not None
    except (ImportError, AttributeError, TypeError, ValueError):
        return False


def is_numpy_array(obj):
    """Return whether obj is an ndarray without importing NumPy."""
    np = sys.modules.get('numpy')
    if np is None:
        return False
    return isinstance(obj, np.ndarray)


def is_pandas_dataframe(obj):
    """Return whether obj is a DataFrame without importing pandas."""
    pd = sys.modules.get('pandas')
    if pd is None:
        return False
    return isinstance(obj, pd.DataFrame)


def is_pandas_series(obj):
    """Return whether obj is a Series without importing pandas."""
    pd = sys.modules.get('pandas')
    if pd is None:
        return False
    return isinstance(obj, pd.Series)


def is_scipy_sparse(obj):
    """Return whether obj is sparse without importing SciPy."""
    sp = sys.modules.get('scipy.sparse')
    if sp is None:
        return False
    try:
        return sp.issparse(obj)
    except Exception:
        return False


def is_torch_tensor(obj):
    """Return whether obj is a Tensor without importing PyTorch."""
    torch = sys.modules.get('torch')
    if torch is None:
        return False
    try:
        return torch.is_tensor(obj)
    except Exception:
        return False


def is_sklearn_estimator(obj):
    """Return whether obj is an estimator without importing scikit-learn."""
    sklearn_base = sys.modules.get('sklearn.base')
    if sklearn_base is None:
        return False
    return isinstance(obj, sklearn_base.BaseEstimator)


# =============================================================================
# MARKER SERIALIZERS (6 __tywrap__ value types)
# =============================================================================
#
# Each serializer accepts force_json_markers. When True, the Arrow path is never
# taken (used by Pyodide and by the subprocess server in TYWRAP_CODEC_FALLBACK=json
# mode). The JSON fallback envelopes are byte-identical across both callers, which
# is what the conformance suite asserts.

def serialize_ndarray(obj, *, force_json_markers):
    """
    Encode a NumPy ndarray. Arrow IPC (compact, lossless) by default; JSON when
    force_json_markers is set or pyarrow is unavailable in fallback mode.

    Note: pa.array() only handles 1D arrays; multi-dimensional arrays are
    flattened with shape metadata for JS-side reconstruction. See
    https://github.com/apache/arrow-js/issues/115
    """
    if force_json_markers:
        return serialize_ndarray_json(obj)
    try:
        import pyarrow as pa  # type: ignore
    except Exception as exc:
        raise RuntimeError(
            'Arrow encoding unavailable for ndarray; install pyarrow or set TYWRAP_CODEC_FALLBACK=json to enable JSON fallback'
        ) from exc
    try:
        original_shape = list(obj.shape) if hasattr(obj, 'shape') else None
        flat = obj.flatten() if hasattr(obj, 'ndim') and obj.ndim != 1 else obj
        arr = pa.array(flat)
        table = pa.Table.from_arrays([arr], names=['value'])
        sink = pa.BufferOutputStream()
        with pa.ipc.new_stream(sink, table.schema) as writer:
            writer.write_table(table)
        buf = sink.getvalue()
        b64 = base64.b64encode(buf.to_pybytes()).decode('ascii')
        return {
            '__tywrap__': 'ndarray',
            'codecVersion': CODEC_VERSION,
            'encoding': 'arrow',
            'b64': b64,
            'shape': original_shape,
            'dtype': str(obj.dtype) if hasattr(obj, 'dtype') else None,
        }
    except Exception as exc:
        raise RuntimeError('Arrow encoding failed for ndarray') from exc


def serialize_ndarray_json(obj):
    """JSON fallback for ndarray values that JavaScript can represent safely."""
    dtype = obj.dtype
    dtype_label = str(dtype)

    if not dtype.isnative:
        raise RuntimeError(
            f'JSON ndarray encoding does not support big-endian dtype={dtype_label}; '
            "convert to native byte order with a.byteswap().view(a.dtype.newbyteorder('='))"
        )

    if dtype.kind in ('i', 'u'):
        # JSON numbers become JavaScript Number values. Scan only on this explicit
        # fallback path and reject before tolist() can silently round an integer.
        js_safe_integer_max = 2**53 - 1
        if obj.size and (
            (obj < -js_safe_integer_max).any() or (obj > js_safe_integer_max).any()
        ):
            raise RuntimeError(
                f'JSON ndarray encoding cannot safely represent dtype={dtype_label} values '
                'outside the JavaScript safe integer range; use Arrow encoding or '
                "cast/encode explicitly (e.g. .astype('float64') or str)"
            )
    elif dtype.kind == 'M':
        raise RuntimeError(
            f'JSON ndarray encoding does not support dtype={dtype_label}; use Arrow encoding '
            "or convert explicitly (e.g. .astype('datetime64[ms]').astype(str) or int with "
            'declared unit)'
        )
    elif dtype.kind == 'm':
        raise RuntimeError(
            f'JSON ndarray encoding does not support dtype={dtype_label}; use Arrow encoding '
            "or convert explicitly (e.g. .astype('timedelta64[ms]').astype(str) or int with "
            'declared unit)'
        )
    elif dtype.kind == 'V':
        if dtype.fields is not None:
            raise RuntimeError(
                f'JSON ndarray encoding does not support structured dtype={dtype_label}; '
                'encode each named field explicitly (e.g. as a plain JSON object)'
            )
        raise RuntimeError(
            f'JSON ndarray encoding does not support void dtype={dtype_label}; convert the '
            "raw bytes explicitly (e.g. .view('uint8'))"
        )
    elif dtype.kind == 'O':
        raise RuntimeError(
            f'JSON ndarray encoding does not support object dtype={dtype_label}; cast to a '
            'concrete numeric dtype or encode elements explicitly as plain JSON'
        )
    elif dtype.kind == 'S':
        raise RuntimeError(
            f'JSON ndarray encoding does not support byte-string dtype={dtype_label}; '
            'decode elements and return a plain JSON list explicitly'
        )
    elif dtype.kind == 'U':
        raise RuntimeError(
            f'JSON ndarray encoding does not support unicode dtype={dtype_label}; convert '
            'explicitly to plain JSON strings with .tolist()'
        )
    elif dtype.kind == 'c':
        raise RuntimeError(
            f'JSON ndarray encoding does not support complex dtype={dtype_label}; encode '
            '.real and .imag arrays explicitly'
        )
    elif dtype.kind == 'f' and dtype.itemsize > 8:
        raise RuntimeError(
            f'JSON ndarray encoding does not support float dtype={dtype_label} wider than '
            "64 bits; cast explicitly (e.g. .astype('float64')) or use Arrow encoding"
        )
    elif dtype.kind not in ('b', 'f'):
        raise RuntimeError(
            f'JSON ndarray encoding does not support dtype={dtype_label}; cast to bool, '
            'integer, or float dtype, or encode values explicitly as plain JSON'
        )

    try:
        data = obj.tolist()
    except Exception as exc:
        raise RuntimeError('JSON fallback failed for ndarray') from exc
    return {
        '__tywrap__': 'ndarray',
        'codecVersion': CODEC_VERSION,
        'encoding': 'json',
        'data': data,
        'shape': getattr(obj, 'shape', None),
        'dtype': dtype.name,
    }


def serialize_dataframe(obj, *, force_json_markers):
    """
    Encode a pandas DataFrame. Feather/Arrow-IPC (uncompressed, so apache-arrow
    in JS can read it) by default; JSON when force_json_markers is set.
    """
    if force_json_markers:
        return serialize_dataframe_json(obj)
    try:
        import pyarrow as pa  # type: ignore
        import pyarrow.feather as feather  # type: ignore
    except Exception as exc:
        raise RuntimeError(
            'Arrow encoding unavailable for pandas.DataFrame; install pyarrow or set TYWRAP_CODEC_FALLBACK=json to enable JSON fallback'
        ) from exc
    try:
        table = pa.Table.from_pandas(obj)  # type: ignore
        sink = pa.BufferOutputStream()
        feather.write_feather(table, sink, compression='uncompressed')
        buf = sink.getvalue()
        b64 = base64.b64encode(buf.to_pybytes()).decode('ascii')
        return {
            '__tywrap__': 'dataframe',
            'codecVersion': CODEC_VERSION,
            'encoding': 'arrow',
            'b64': b64,
        }
    except Exception as exc:
        raise RuntimeError('Arrow encoding failed for pandas.DataFrame') from exc


def serialize_dataframe_json(obj):
    """JSON fallback for DataFrame values that JavaScript can represent safely."""
    import pandas as pd  # type: ignore

    _validate_pandas_json_index(obj.index, pd, 'DataFrame')
    json_columns = [_pandas_json_object_key(column) for column in obj.columns]
    supported_json_columns = [column for column in json_columns if column is not None]
    if not obj.columns.is_unique or len(set(supported_json_columns)) != len(
        supported_json_columns
    ):
        raise RuntimeError(
            'JSON pandas.DataFrame encoding requires column labels to remain unique after '
            'JSON object-key coercion; rename columns or make them distinct before applying '
            '.columns.astype(str)'
        )
    for column, dtype in obj.dtypes.items():
        if isinstance(dtype, pd.CategoricalDtype):
            raise RuntimeError(
                f'JSON pandas.DataFrame encoding does not support categorical dtype in '
                f'column {column!r}; use Arrow encoding or convert explicitly '
                "(e.g. .astype(str))"
            )
    try:
        data = (
            [{} for _ in range(len(obj.index))]
            if len(obj.columns) == 0
            else obj.to_dict(orient='records')
        )
    except Exception as exc:
        raise RuntimeError('JSON fallback failed for pandas.DataFrame') from exc
    for row_number, row in enumerate(data):
        for column, value in row.items():
            row[column] = _normalize_pandas_json_scalar(
                value,
                f'DataFrame cell at row {row_number}, column {column!r}',
                pd,
            )
    return {
        '__tywrap__': 'dataframe',
        'codecVersion': CODEC_VERSION,
        'encoding': 'json',
        'data': data,
    }


def serialize_series(obj, *, force_json_markers):
    """
    Encode a pandas Series as a single-column Arrow Table stream (the JS decoder
    contract is "table-like"); JSON when force_json_markers is set.
    """
    if force_json_markers:
        return serialize_series_json(obj)
    try:
        import pyarrow as pa  # type: ignore
    except Exception as exc:
        raise RuntimeError(
            'Arrow encoding unavailable for pandas.Series; install pyarrow or set TYWRAP_CODEC_FALLBACK=json to enable JSON fallback'
        ) from exc
    try:
        arr = pa.Array.from_pandas(obj)  # type: ignore
        table = pa.Table.from_arrays([arr], names=['value'])
        sink = pa.BufferOutputStream()
        with pa.ipc.new_stream(sink, table.schema) as writer:
            writer.write_table(table)
        buf = sink.getvalue()
        b64 = base64.b64encode(buf.to_pybytes()).decode('ascii')
        return {
            '__tywrap__': 'series',
            'codecVersion': CODEC_VERSION,
            'encoding': 'arrow',
            'b64': b64,
            'name': getattr(obj, 'name', None),
        }
    except Exception as exc:
        raise RuntimeError('Arrow encoding failed for pandas.Series') from exc


def serialize_series_json(obj):
    """JSON fallback for Series values that JavaScript can represent safely."""
    import pandas as pd  # type: ignore

    _validate_pandas_json_index(obj.index, pd, 'Series')
    if isinstance(obj.dtype, pd.CategoricalDtype):
        raise RuntimeError(
            'JSON pandas.Series encoding does not support categorical dtype; use Arrow '
            "encoding or convert explicitly (e.g. .astype(str))"
        )
    try:
        data = obj.to_list()  # type: ignore
    except Exception as exc:
        raise RuntimeError('JSON fallback failed for pandas.Series') from exc
    data = [
        _normalize_pandas_json_scalar(value, f'Series value at position {position}', pd)
        for position, value in enumerate(data)
    ]
    return {
        '__tywrap__': 'series',
        'codecVersion': CODEC_VERSION,
        'encoding': 'json',
        'data': data,
        'name': getattr(obj, 'name', None),
    }


def _validate_pandas_json_index(index, pd, container_name):
    """Reject index metadata that records/list-oriented JSON would discard."""
    if isinstance(index, pd.MultiIndex):
        raise RuntimeError(
            f'JSON pandas.{container_name} encoding does not support MultiIndex; use Arrow '
            'encoding or flatten the index explicitly with .reset_index()'
        )
    if not (
        isinstance(index, pd.RangeIndex)
        and index.start == 0
        and index.step == 1
        and index.stop == len(index)
        and index.name is None
    ):
        raise RuntimeError(
            f'JSON pandas.{container_name} encoding requires an unnamed RangeIndex starting '
            'at 0 with step 1; use Arrow encoding or normalize explicitly with '
            '.reset_index(drop=True)'
        )


def _pandas_json_object_key(value):
    """Return json.dumps' object-key spelling, or None for unsupported keys."""
    try:
        encoded = json.dumps({value: None})
    except (TypeError, ValueError):
        return None
    return next(iter(json.loads(encoded)))


def _normalize_pandas_json_scalar(value, location, pd):
    """Normalize pandas nulls and reject values outside the plain JSON domain."""
    np = sys.modules.get('numpy')
    if np is not None and isinstance(value, np.generic):
        value = value.item()
    if value is None or value is pd.NA or value is pd.NaT:
        return None
    if type(value) is bool:
        return value
    if type(value) is int:
        js_safe_integer_max = 2**53 - 1
        if value < -js_safe_integer_max or value > js_safe_integer_max:
            raise RuntimeError(
                f'JSON pandas encoding cannot safely represent {location} integer values '
                'outside the JavaScript safe integer range; use Arrow encoding or '
                "cast/encode explicitly (e.g. .astype('float64') or str)"
            )
        return value
    if type(value) is float:
        if not math.isfinite(value):
            raise RuntimeError(
                f'JSON pandas encoding cannot represent non-finite {location} float values '
                '(NaN or Infinity); use .fillna(...) for intentional missing values or '
                'Arrow encoding'
            )
        return value
    if type(value) is str:
        return value
    raise RuntimeError(
        f'JSON pandas encoding does not support {location} value of type '
        f'{type(value).__name__}; use Arrow encoding or convert explicitly '
        '(e.g. .astype(str))'
    )


def serialize_sparse_matrix(obj):
    """
    Serialize scipy sparse matrices into structured JSON envelopes (json-only;
    there is no Arrow path). Preserves sparsity; rejects unsupported formats and
    complex dtypes explicitly.
    """
    try:
        fmt = obj.getformat()
    except Exception as exc:
        raise RuntimeError('Failed to inspect scipy sparse matrix format') from exc

    if fmt not in ('csr', 'csc', 'coo'):
        raise RuntimeError(
            f'Unsupported scipy sparse format: {fmt}; only csr/csc/coo are supported. '
            'Convert explicitly (e.g. matrix.tocsr()) before returning'
        )

    dtype = None
    try:
        dtype = str(obj.dtype)
    except Exception:
        dtype = None
    if getattr(obj.dtype, 'kind', None) == 'c':
        raise RuntimeError(
            'Complex scipy sparse matrices are not supported by the JSON codec; '
            'split into real/imag components explicitly before returning'
        )

    if fmt in ('csr', 'csc'):
        data = obj.data.tolist()
        indices = obj.indices.tolist()
        indptr = obj.indptr.tolist()
        return {
            '__tywrap__': 'scipy.sparse',
            'codecVersion': CODEC_VERSION,
            'encoding': 'json',
            'format': fmt,
            'shape': list(obj.shape),
            'data': data,
            'indices': indices,
            'indptr': indptr,
            'dtype': dtype,
        }

    # coo
    data = obj.data.tolist()
    row = obj.row.tolist()
    col = obj.col.tolist()
    return {
        '__tywrap__': 'scipy.sparse',
        'codecVersion': CODEC_VERSION,
        'encoding': 'json',
        'format': fmt,
        'shape': list(obj.shape),
        'data': data,
        'row': row,
        'col': col,
        'dtype': dtype,
    }


def serialize_torch_tensor(obj, *, force_json_markers, torch_allow_copy=False):
    """
    Serialize torch.Tensor values via the nested ndarray envelope. CPU-only by
    default; device/copy behavior is explicit. force_json_markers is threaded
    into the nested ndarray serialization so Pyodide gets a JSON ndarray value.

    Rejection order is significant: the categorical rejections (sparse / quantized
    / meta / complex) are checked BEFORE the device/contiguous opt-in branch so
    they fail with a clear, specific message and are NOT bypassable by
    TYWRAP_TORCH_ALLOW_COPY. The opt-in only governs the lossy-but-lossless device
    transfer and contiguous copy, never an unrepresentable layout/dtype.
    """
    import torch  # already importable: is_torch_tensor() gated the dispatch

    tensor = obj.detach()
    source_device = None
    source_dtype = None

    # Sparse tensors (COO/CSR/CSC/BSR/BSC -> any non-strided layout) have no dense
    # numpy representation without a densify step, which is not the round-trip this
    # envelope promises. Reject explicitly rather than emitting a misleading
    # "not contiguous" error or silently densifying.
    layout = getattr(tensor, 'layout', None)
    if getattr(tensor, 'is_sparse', False) or (
        layout is not None and layout != torch.strided
    ):
        raise RuntimeError(
            f'Torch sparse tensors are not supported (layout={layout}); '
            'convert to a dense CPU tensor explicitly (e.g. tensor.to_dense()) before returning'
        )

    # Quantized tensors carry a qscheme/scale/zero_point that numpy() cannot
    # represent; .numpy() raises an opaque "unsupported ScalarType" deep in torch.
    # Reject up front with an actionable message.
    if getattr(tensor, 'is_quantized', False):
        raise RuntimeError(
            'Torch quantized tensors are not supported; dequantize explicitly '
            '(e.g. tensor.dequantize()) before returning'
        )

    # Meta tensors have shape/dtype but NO storage; copying to CPU yields garbage,
    # so this is never a lossy-but-honest transfer the opt-in could authorize.
    if getattr(tensor, 'is_meta', False) or (
        getattr(tensor, 'device', None) is not None and tensor.device.type == 'meta'
    ):
        raise RuntimeError(
            'Torch meta tensors carry no data and cannot be serialized; '
            'materialize the tensor on a real device before returning'
        )

    # Complex tensors round-trip to numpy complex arrays, which are not
    # JSON-serializable and have no codec envelope. Reject explicitly instead of
    # emitting Python complex tuples that the JS decoder cannot parse.
    if torch.is_complex(tensor):
        raise RuntimeError(
            f'Torch complex tensors are not supported (dtype={tensor.dtype}); '
            'split into real/imag components explicitly before returning'
        )

    if getattr(tensor, 'device', None) is not None and tensor.device.type != 'cpu':
        if not torch_allow_copy:
            raise RuntimeError(
                'Torch tensor is on a non-CPU device; set TYWRAP_TORCH_ALLOW_COPY=1 to allow CPU transfer'
            )
        source_device = str(tensor.device)
        tensor = tensor.to('cpu')
    if hasattr(tensor, 'is_contiguous') and not tensor.is_contiguous():
        if not torch_allow_copy:
            raise RuntimeError(
                'Torch tensor is not contiguous; set TYWRAP_TORCH_ALLOW_COPY=1 to allow contiguous copy'
            )
        tensor = tensor.contiguous()
    if tensor.dtype == torch.bfloat16:
        source_dtype = str(tensor.dtype)
        tensor = tensor.float()
    try:
        arr = tensor.numpy()
    except Exception as exc:
        raise RuntimeError('Failed to convert torch.Tensor to numpy') from exc

    envelope = {
        '__tywrap__': 'torch.tensor',
        'codecVersion': CODEC_VERSION,
        'encoding': 'ndarray',
        'value': serialize_ndarray(arr, force_json_markers=force_json_markers),
        'shape': list(tensor.shape),
        'dtype': str(tensor.dtype),
        'device': str(tensor.device),
    }
    if source_dtype is not None:
        envelope['sourceDtype'] = source_dtype
    if source_device is not None:
        envelope['sourceDevice'] = source_device
    return envelope


def serialize_sklearn_estimator(obj):
    """Serialize sklearn estimators as metadata only (json-only); no pickling."""
    try:
        import sklearn  # noqa: F401
    except Exception as exc:
        raise RuntimeError('scikit-learn is not available') from exc

    params = obj.get_params(deep=False)

    # Metadata-only: NEVER pickle/joblib. Every param value must be plain JSON
    # (no callables, nested estimators, numpy arrays, or other objects). Probe
    # each value individually so the error names the offending param instead of
    # failing opaquely on the whole dict. allow_nan=False also rejects NaN/Inf
    # params here for parity with the response codec.
    for key, value in params.items():
        try:
            json.dumps(value, allow_nan=False)
        except (TypeError, ValueError) as exc:
            raise RuntimeError(
                f'scikit-learn estimator param {key!r} is not JSON-serializable '
                f'(got {type(value).__name__}); estimators are serialized as metadata only '
                '(no pickle/joblib), so every param must be a plain JSON value. '
                'Sanitize or drop the param before returning'
            ) from exc

    return {
        '__tywrap__': 'sklearn.estimator',
        'codecVersion': CODEC_VERSION,
        'encoding': 'json',
        'className': obj.__class__.__name__,
        'module': obj.__class__.__module__,
        'version': getattr(sklearn, '__version__', None),
        'params': params,
    }


_NO_PYDANTIC = object()


def serialize_pydantic(obj):
    """
    Serialize Pydantic v2 models via model_dump(by_alias=True, mode='json')
    without importing Pydantic. Returns _NO_PYDANTIC when obj is not a model.
    """
    model_dump = getattr(obj, 'model_dump', None)
    if not callable(model_dump):
        return _NO_PYDANTIC
    try:
        try:
            return model_dump(by_alias=True, mode='json')
        except TypeError:
            # Older Pydantic versions may not support `mode=...`.
            return model_dump(by_alias=True)
    except Exception as exc:
        raise RuntimeError(f'model_dump failed: {exc}') from exc


def serialize_stdlib(obj):
    """Coerce common stdlib scalar types to JSON-safe forms; None otherwise."""
    if isinstance(obj, dt.datetime):
        return obj.isoformat()
    if isinstance(obj, dt.date):
        return obj.isoformat()
    if isinstance(obj, dt.time):
        return obj.isoformat()
    if isinstance(obj, dt.timedelta):
        return obj.total_seconds()
    if isinstance(obj, decimal.Decimal):
        return str(obj)
    if isinstance(obj, uuid.UUID):
        return str(obj)
    if isinstance(obj, (Path, PurePath)):
        return str(obj)
    return None


_NO_SCIENTIFIC = object()


def _check_serialize_depth(depth, path):
    if depth > MAX_SERIALIZE_DEPTH:
        raise RuntimeError(
            f'Scientific envelope serialization maximum depth '
            f'{MAX_SERIALIZE_DEPTH} exceeded at {path}'
        )


def _check_serialize_nodes(nodes, path):
    if nodes > MAX_SERIALIZE_NODES:
        raise RuntimeError(
            f'Scientific envelope serialization maximum visited nodes '
            f'{MAX_SERIALIZE_NODES} exceeded at {path}'
        )


def _serialize_scientific(obj, *, force_json_markers, torch_allow_copy, depth, path):
    """Serialize a supported scientific value, or return _NO_SCIENTIFIC."""
    package = type(obj).__module__.split('.', 1)[0]

    if package == 'numpy' and 'numpy' in sys.modules:
        if is_numpy_array(obj):
            _check_serialize_depth(depth, path)
            return serialize_ndarray(obj, force_json_markers=force_json_markers)
    elif package == 'pandas' and 'pandas' in sys.modules:
        if is_pandas_dataframe(obj):
            _check_serialize_depth(depth, path)
            return serialize_dataframe(obj, force_json_markers=force_json_markers)
        if is_pandas_series(obj):
            _check_serialize_depth(depth, path)
            return serialize_series(obj, force_json_markers=force_json_markers)
    elif package == 'scipy' and 'scipy.sparse' in sys.modules:
        if is_scipy_sparse(obj):
            _check_serialize_depth(depth, path)
            return serialize_sparse_matrix(obj)
    elif package == 'torch' and 'torch' in sys.modules:
        if is_torch_tensor(obj):
            _check_serialize_depth(depth, path)
            _check_serialize_depth(depth + 1, _serialize_path(path, 'value'))
            return serialize_torch_tensor(
                obj, force_json_markers=force_json_markers, torch_allow_copy=torch_allow_copy
            )
    elif 'sklearn.base' in sys.modules and is_sklearn_estimator(obj):
        # No package gate here, unlike the branches above: subclassing
        # BaseEstimator is sklearn's documented extension point, so user-defined
        # estimators live outside the 'sklearn' package and must still get the
        # estimator serializer (and its param-naming errors).
        _check_serialize_depth(depth, path)
        return serialize_sklearn_estimator(obj)

    return _NO_SCIENTIFIC


def _serialize_path(base, key):
    """Build a decoder-compatible JSONPath-like result path."""
    if isinstance(key, int):
        return f'{base}[{key}]'
    if _SERIALIZE_PATH_IDENTIFIER.fullmatch(key):
        return f'{base}.{key}'
    return f'{base}[{json.dumps(key, ensure_ascii=False)}]'


def _invalid_key_path(base, key):
    """Name a dict key that cannot be represented by JSON."""
    return f'{base}[{key!r}]'


def _needs_serialize_visit(value):
    """Return whether value needs container or scientific traversal work."""
    if type(value) in (type(None), bool, int, float, str):
        return False
    if type(value) in (dict, list, tuple):
        return True
    package = type(value).__module__.split('.', 1)[0]
    if package in ('numpy', 'pandas', 'scipy', 'torch'):
        return True
    return 'sklearn.base' in sys.modules and is_sklearn_estimator(value)


def _serialize_leaf(value):
    """Apply non-container conversions without allocating a traversal frame."""
    if type(value) in (type(None), bool, int, float, str):
        return value
    pydantic_value = serialize_pydantic(value)
    if pydantic_value is not _NO_PYDANTIC:
        return pydantic_value
    stdlib_value = serialize_stdlib(value)
    if stdlib_value is not None:
        return stdlib_value
    return value


def serialize(obj, *, force_json_markers, torch_allow_copy=False):
    """
    Top-level result serializer.

    Scientific codecs are type-first and only inspect packages that the value can
    belong to. A value from an optional package implies that package is already in
    sys.modules, so these checks never cold-import the scientific stack. The
    package dispatch deliberately precedes the JSON-native fast path: e.g. a
    package-defined subclass of dict still receives its relevant codec check.
    Every other value is left untouched so the shared JSON encoder applies the
    exact same default conversion at the root and at any nested depth.
    """
    root = [None]
    active_ids = set()
    stack = [('visit', obj, 0, 'result', root, 0)]
    visited_nodes = 0

    # Repeated aliases have value semantics and are intentionally serialized twice.
    while stack:
        frame = stack.pop()
        action = frame[0]
        if action == 'dict':
            _, current, depth, path, parent, key, output, iterator = frame
            try:
                item_key, item = next(iterator)
            except StopIteration:
                active_ids.remove(id(current))
                parent[key] = output
                continue
            stack.append(frame)
            if not (isinstance(item_key, (str, int, float, bool)) or item_key is None):
                invalid_path = _invalid_key_path(path, item_key)
                raise TypeError(
                    f'keys must be str, int, float, bool or None, not '
                    f'{type(item_key).__name__} at {invalid_path}'
                )
            child_key = next(iter(json.loads(json.dumps({item_key: None}))))
            child_path = _serialize_path(path, child_key)
            if _needs_serialize_visit(item):
                stack.append(('visit', item, depth + 1, child_path, output, item_key))
            else:
                output[item_key] = _serialize_leaf(item)
            continue
        if action == 'sequence':
            _, current, depth, path, parent, key, output, index = frame
            if index == len(output):
                active_ids.remove(id(current))
                parent[key] = output if type(current) is list else tuple(output)
                continue
            stack.append(('sequence', current, depth, path, parent, key, output, index + 1))
            item = current[index]
            if _needs_serialize_visit(item):
                stack.append(
                    ('visit', item, depth + 1, _serialize_path(path, index), output, index)
                )
            else:
                output[index] = _serialize_leaf(item)
            continue

        _, current, depth, path, parent, key = frame
        try:
            scientific = _serialize_scientific(
                current,
                force_json_markers=force_json_markers,
                torch_allow_copy=torch_allow_copy,
                depth=depth,
                path=path,
            )
        except Exception as exc:
            if path == 'result':
                raise
            raise RuntimeError(f'Scientific value serialization failed at {path}: {exc}') from exc
        if scientific is not _NO_SCIENTIFIC:
            # Recognized envelopes are terminal containers to the JS decoder.
            visited_nodes += 1
            _check_serialize_nodes(visited_nodes, path)
            if scientific.get('__tywrap__') == 'torch.tensor':
                nested_path = _serialize_path(path, 'value')
                try:
                    visited_nodes += 1
                    _check_serialize_nodes(visited_nodes, nested_path)
                except Exception as exc:
                    if path == 'result':
                        raise
                    raise RuntimeError(
                        f'Scientific value serialization failed at {path}: {exc}'
                    ) from exc
            parent[key] = scientific
            continue

        container_type = type(current)
        if container_type in (dict, list, tuple):
            _check_serialize_depth(depth, path)
            visited_nodes += 1
            _check_serialize_nodes(visited_nodes, path)
            current_id = id(current)
            if current_id in active_ids:
                raise RuntimeError(f'Circular reference detected at {path}')
            active_ids.add(current_id)

            if container_type is dict:
                output = {}
                parent[key] = output
                stack.append(
                    ('dict', current, depth, path, parent, key, output, iter(current.items()))
                )
                continue

            output = [None] * len(current)
            if container_type is list:
                parent[key] = output
            stack.append(('sequence', current, depth, path, parent, key, output, 0))
            continue

        parent[key] = _serialize_leaf(current)

    return root[0]


# =============================================================================
# JSON CODEC: value handling and size-limited encode/decode
# =============================================================================
#
# This is the single Python implementation used by both the subprocess bridge and
# the embedded Pyodide core. BridgeCodec adds payload-size enforcement around the
# shared encoder; encode_value is the unbounded form used by the in-memory bridge.

def _is_nan_or_inf(value):
    if not isinstance(value, (int, float)):
        return False
    try:
        return math.isnan(value) or math.isinf(value)
    except (TypeError, ValueError):
        return False


def _is_numpy_scalar(obj):
    try:
        import numpy as np
    except ImportError:
        return False
    return isinstance(obj, (np.generic, np.ndarray)) and obj.ndim == 0


def _is_pandas_scalar(obj):
    try:
        import pandas as pd
    except ImportError:
        return False
    return isinstance(obj, (pd.Timestamp, pd.Timedelta, type(pd.NaT)))


def make_default_encoder(*, allow_nan):
    """
    Build a json.dumps default= encoder matching BridgeCodec's value handling.

    Raises CodecError for NaN/Infinity extracted from numpy scalars (json.dumps
    itself rejects top-level/nested NaN/Infinity floats when allow_nan=False).
    """

    def default_encoder(obj):
        # numpy/pandas scalars first (need .item() extraction).
        if _is_numpy_scalar(obj):
            extracted = obj.item()
            if not allow_nan and _is_nan_or_inf(extracted):
                raise CodecError('Cannot serialize NaN - NaN/Infinity not allowed in JSON')
            return extracted

        if _is_pandas_scalar(obj):
            try:
                import pandas as pd
            except ImportError:
                pass
            else:
                if obj is pd.NaT or (hasattr(pd, 'isna') and pd.isna(obj)):
                    return None
                if isinstance(obj, pd.Timestamp):
                    return obj.isoformat()
                if isinstance(obj, pd.Timedelta):
                    return obj.total_seconds()

        if isinstance(obj, dt.datetime):
            return obj.isoformat()
        if isinstance(obj, dt.date):
            return obj.isoformat()
        if isinstance(obj, dt.time):
            return obj.isoformat()
        if isinstance(obj, dt.timedelta):
            return obj.total_seconds()
        if isinstance(obj, decimal.Decimal):
            return str(obj)
        if isinstance(obj, uuid.UUID):
            return str(obj)
        if isinstance(obj, (Path, PurePath)):
            return str(obj)

        if isinstance(obj, (bytes, bytearray)):
            return {
                '__type__': 'bytes',
                'encoding': 'base64',
                'data': base64.b64encode(obj).decode('ascii'),
            }

        model_dump = getattr(obj, 'model_dump', None)
        if callable(model_dump):
            try:
                return model_dump(by_alias=True, mode='json')
            except TypeError:
                return model_dump(by_alias=True)

        if isinstance(obj, (set, frozenset)):
            return list(obj)

        if isinstance(obj, complex):
            raise TypeError(f'Object of type {type(obj).__name__} is not JSON serializable')

        raise TypeError(f'Object of type {type(obj).__name__} is not JSON serializable')

    return default_encoder


def encode_value(value, *, allow_nan):
    """
    JSON-encode a fully-serialized response value, applying the BridgeCodec-equivalent
    default encoder and rejecting NaN/Infinity when allow_nan is False.

    Raises CodecError (wrapping the json.dumps ValueError) on NaN/Infinity, matching
    BridgeCodec's "Cannot serialize NaN..." wording so error parity holds.
    """
    try:
        return json.dumps(value, default=make_default_encoder(allow_nan=allow_nan), allow_nan=allow_nan)
    except ValueError as exc:
        error_msg = str(exc).lower()
        # json.dumps(allow_nan=False) rejects NaN/Infinity with a ValueError whose
        # wording is Python-version dependent: 3.12+ appends the offending value
        # ("...not JSON compliant: nan"), but 3.10/3.11 emit only the canonical
        # "Out of range float values are not JSON compliant". Match that phrase too
        # so the typed error message is stable across versions.
        nonfinite_token = re.search(r'(^|[^a-z])(nan|inf|infinity)([^a-z]|$)', error_msg)
        if (
            not allow_nan and 'out of range float values are not json compliant' in error_msg
        ) or nonfinite_token:
            raise CodecError('Cannot serialize NaN - NaN/Infinity not allowed in JSON') from exc
        raise CodecError(f'JSON encoding failed: {exc}') from exc
    except TypeError as exc:
        raise CodecError(f'JSON encoding failed: {exc}') from exc


class BridgeCodec:
    """Safe JSON codec with explicit value handling and payload-size limits."""

    def __init__(self, allow_nan=False, max_payload_bytes=10 * 1024 * 1024):
        self.allow_nan = allow_nan
        self.max_payload_bytes = max_payload_bytes
        self._encoder = make_default_encoder(allow_nan=allow_nan)

    def encode(self, value):
        result = encode_value(value, allow_nan=self.allow_nan)
        if len(result.encode('utf-8')) > self.max_payload_bytes:
            raise CodecError(f'Payload exceeds {self.max_payload_bytes} bytes')
        return result

    def decode(self, payload):
        if len(payload.encode('utf-8')) > self.max_payload_bytes:
            raise CodecError(f'Payload exceeds {self.max_payload_bytes} bytes')
        try:
            return json.loads(payload)
        except json.JSONDecodeError as exc:
            raise CodecError(f'JSON decoding failed: {exc}') from exc

    def _default_encoder(self, obj):
        """Compatibility hook for callers that used the codec's JSON encoder."""
        return self._encoder(obj)


_default_codec = None


def get_default_codec():
    """Return the lazily-created default BridgeCodec instance."""
    global _default_codec
    if _default_codec is None:
        _default_codec = BridgeCodec()
    return _default_codec


def encode(value, *, allow_nan=False):
    """Encode a value with the default codec settings."""
    if allow_nan:
        return BridgeCodec(allow_nan=True).encode(value)
    return get_default_codec().encode(value)


def decode(payload):
    """Decode a JSON payload with the default codec settings."""
    return get_default_codec().decode(payload)


# =============================================================================
# REQUEST VALIDATION + HANDLERS + DISPATCH
# =============================================================================

def require_protocol(msg):
    if not isinstance(msg, dict):
        raise ProtocolError('Invalid request payload')
    proto = msg.get('protocol')
    if proto != PROTOCOL:
        raise ProtocolError(f'Invalid protocol: {proto}')
    mid = msg.get('id')
    if not isinstance(mid, int):
        raise ProtocolError(f'Invalid request id: {mid}')
    return mid


def require_str(params, key):
    value = params.get(key)
    if not isinstance(value, str) or not value:
        raise ProtocolError(f'Missing {key}')
    return value


def coerce_list(value, key):
    if value is None:
        return []
    if not isinstance(value, list):
        raise ProtocolError(f'Invalid {key}')
    return value


def coerce_dict(value, key):
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ProtocolError(f'Invalid {key}')
    return value


def handle_call(
    params,
    *,
    force_json_markers,
    torch_allow_copy,
    allowed_modules,
    allow_private_attrs,
    has_envelope_markers,
):
    module_name = require_str(params, 'module')
    function_name = require_str(params, 'functionName')
    args = deserialize(coerce_list(params.get('args'), 'args'), has_envelope_markers=has_envelope_markers)
    kwargs = deserialize(coerce_dict(params.get('kwargs'), 'kwargs'), has_envelope_markers=has_envelope_markers)
    mod = import_allowed_module(module_name, allowed_modules)
    # function_name may be dotted ('Class.method') for @classmethod/@staticmethod
    # calls, which the generated wrapper routes through call() rather than an
    # instance handle. resolve_allowed_attr_path guards each segment.
    func = resolve_allowed_attr_path(mod, function_name, allow_private_attrs=allow_private_attrs)
    res = func(*args, **kwargs)
    return serialize(res, force_json_markers=force_json_markers, torch_allow_copy=torch_allow_copy)


def build_meta(
    *,
    bridge,
    pid,
    python_version,
    codec_fallback,
    arrow_available_override=None,
):
    """
    Build the bridge metadata payload.

    Field order here is part of the wire contract (the JS validator and the
    documented BridgeInfo shape). Callers supply the backend-specific identity:
    the subprocess server passes bridge='python-subprocess' and a real pid; the
    Pyodide server passes bridge='pyodide' and pid=None.

    arrow_available_override: when not None, report this value for arrowAvailable
    instead of probing pyarrow. The Pyodide server forces markers to JSON
    unconditionally, so it advertises arrowAvailable=False regardless of whether
    pyarrow happens to be importable in the WASM environment.
    """
    arrow = arrow_available() if arrow_available_override is None else arrow_available_override
    meta = {
        'protocol': PROTOCOL,
        'protocolVersion': PROTOCOL_VERSION,
        'bridge': bridge,
        'pythonVersion': python_version,
        'pid': pid,
        'codecFallback': codec_fallback,
        'arrowAvailable': arrow,
        'scipyAvailable': module_available('scipy'),
        'torchAvailable': module_available('torch'),
        'sklearnAvailable': module_available('sklearn'),
        'instances': 0,
    }
    return meta


def dispatch_request(
    msg,
    *,
    bridge,
    pid,
    force_json_markers,
    allow_nan=False,
    python_version=None,
    torch_allow_copy=False,
    arrow_available_override=None,
    allowed_modules=None,
    allow_private_attrs=False,
    has_envelope_markers=True,
):
    """
    Validate and route a request, returning the fully-serialized response dict
    ({'id', 'protocol', 'result'}). Raises ProtocolError for malformed requests
    and propagates handler exceptions to the caller, which is responsible for
    building the error envelope (so it controls traceback inclusion).

    allow_nan is accepted for signature symmetry; NaN rejection happens during
    the final encode_value() call, which the caller performs.

    allowed_modules: None (default) disables the import allowlist so existing
    behavior is preserved. Supplying a set restricts call imports to
    those modules (plus the stdlib the bridge itself needs) and raises
    ImportNotAllowedError otherwise. allow_private_attrs=False (default) blocks
    getattr of underscore-prefixed names; True restores unrestricted access. See
    the IMPORT / ATTRIBUTE ALLOWLIST section above for the full trust model.
    """
    mid = require_protocol(msg)
    method = msg.get('method')
    if not isinstance(method, str):
        raise ProtocolError('Missing method')
    params = coerce_dict(msg.get('params'), 'params')
    if method == 'call':
        result = handle_call(
            params,
            force_json_markers=force_json_markers,
            torch_allow_copy=torch_allow_copy,
            allowed_modules=allowed_modules,
            allow_private_attrs=allow_private_attrs,
            has_envelope_markers=has_envelope_markers,
        )
    elif method == 'meta':
        if python_version is None:
            import sys
            python_version = sys.version.split()[0]
        codec_fallback = 'json' if force_json_markers else 'none'
        result = build_meta(
            bridge=bridge,
            pid=pid,
            python_version=python_version,
            codec_fallback=codec_fallback,
            arrow_available_override=arrow_available_override,
        )
    else:
        raise ProtocolError(f'Unknown method: {method}')
    return {'id': mid, 'protocol': PROTOCOL, 'result': result}


def build_error_payload(mid, exc, *, include_traceback):
    """
    Build a protocol error response. Protocol/validation errors omit traceback;
    handler errors include it. Field order matches the reference server.
    """
    error = {'type': type(exc).__name__, 'message': str(exc)}
    if include_traceback:
        error['traceback'] = traceback.format_exc()
    return {
        'id': mid if mid is not None else -1,
        'protocol': PROTOCOL,
        'error': error,
    }
