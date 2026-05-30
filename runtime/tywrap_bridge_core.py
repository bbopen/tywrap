"""
Shared tywrap bridge core: protocol dispatch + value (de)serialization.

This module is the SINGLE source of truth for the "tywrap/1" server-side
protocol. It is imported by:

  - runtime/python_bridge.py  (the Node/Bun/Deno subprocess server and the HTTP
    server), which owns I/O concerns: the stdin/stdout JSONL loop, env-var size
    guards, the real OS pid, bridge='python-subprocess', and the final SafeCodec
    encode wrapper.

  - the in-WASM Pyodide server (src/runtime/pyodide-io.ts). Pyodide cannot read
    this file from disk, so it is shipped as a build-time-generated TypeScript
    string constant (src/runtime/pyodide-bootstrap-core.generated.ts) produced by
    scripts/generate-pyodide-bootstrap.mjs and exec'd into a module registered in
    sys.modules. A conformance drift guard (test/runtime_conformance.test.ts)
    asserts the generated constant stays byte-identical to this file.

CROSS-LANGUAGE CONTRACT (Python <-> the TypeScript decoder in src/utils/codec.ts
and the request encoder in src/runtime/safe-codec.ts):

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
import traceback
import uuid
from pathlib import Path, PurePath

# Protocol constants. These MUST match src/runtime/protocol.ts (PROTOCOL_ID,
# TYWRAP_PROTOCOL_VERSION) and the codec version baked into marker envelopes.
PROTOCOL = 'tywrap/1'
PROTOCOL_VERSION = 1
CODEC_VERSION = 1


class ProtocolError(Exception):
    """Raised for malformed requests (bad protocol/id/method/params)."""


class InstanceHandleError(ValueError):
    """Raised when an instance handle is unknown or no longer valid."""


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
    - { "__tywrap_bytes__": true, "b64": "..." }  (JS SafeCodec.encodeRequest)
    - { "__type__": "bytes", "encoding": "base64", "data": "..." }  (legacy/compat)

    Why: TS SafeCodec encodes Uint8Array/ArrayBuffer as base64 objects, but
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


def deserialize(value):
    """
    Recursively deserialize request values into Python-native types.

    Why: requests are JSON-only; we need a small set of explicit decoders
    (currently bytes) to restore Python semantics at the boundary.
    """
    decoded = _deserialize_bytes_envelope(value)
    if decoded is not _NO_DESERIALIZE:
        return decoded

    if isinstance(value, list):
        return [deserialize(item) for item in value]
    if isinstance(value, dict):
        # Preserve dict shape while decoding nested values.
        return {k: deserialize(v) for k, v in value.items()}
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
    try:
        import numpy as np  # noqa: F401
    except Exception:
        return False
    return isinstance(obj, np.ndarray)


def is_pandas_dataframe(obj):
    try:
        import pandas as pd  # noqa: F401
    except Exception:
        return False
    return isinstance(obj, pd.DataFrame)


def is_pandas_series(obj):
    try:
        import pandas as pd  # noqa: F401
    except Exception:
        return False
    return isinstance(obj, pd.Series)


def is_scipy_sparse(obj):
    try:
        import scipy.sparse as sp  # noqa: F401
    except Exception:
        return False
    try:
        return sp.issparse(obj)
    except Exception:
        return False


def is_torch_tensor(obj):
    try:
        import torch  # noqa: F401
    except Exception:
        return False
    try:
        return torch.is_tensor(obj)
    except Exception:
        return False


def is_sklearn_estimator(obj):
    try:
        from sklearn.base import BaseEstimator  # noqa: F401
    except Exception:
        return False
    return isinstance(obj, BaseEstimator)


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
        flat = obj.flatten() if hasattr(obj, 'ndim') and obj.ndim > 1 else obj
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
    """JSON fallback for ndarray (larger payloads, potential dtype loss)."""
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
    """JSON fallback for DataFrame: records orientation."""
    try:
        data = obj.to_dict(orient='records')
    except Exception as exc:
        raise RuntimeError('JSON fallback failed for pandas.DataFrame') from exc
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
    """JSON fallback for Series (potentially lossy dtype/NA representation)."""
    try:
        data = obj.to_list()  # type: ignore
    except Exception:
        try:
            data = obj.to_dict()  # type: ignore
        except Exception as exc:
            raise RuntimeError('JSON fallback failed for pandas.Series') from exc
    return {
        '__tywrap__': 'series',
        'codecVersion': CODEC_VERSION,
        'encoding': 'json',
        'data': data,
        'name': getattr(obj, 'name', None),
    }


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
        raise RuntimeError(f'Unsupported scipy sparse format: {fmt}')

    dtype = None
    try:
        dtype = str(obj.dtype)
    except Exception:
        dtype = None
    if getattr(obj.dtype, 'kind', None) == 'c':
        raise RuntimeError('Complex sparse matrices are not supported by JSON codec')

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
    """
    tensor = obj.detach()
    if getattr(tensor, 'device', None) is not None and tensor.device.type != 'cpu':
        if not torch_allow_copy:
            raise RuntimeError(
                'Torch tensor is on a non-CPU device; set TYWRAP_TORCH_ALLOW_COPY=1 to allow CPU transfer'
            )
        tensor = tensor.to('cpu')
    if hasattr(tensor, 'is_contiguous') and not tensor.is_contiguous():
        if not torch_allow_copy:
            raise RuntimeError(
                'Torch tensor is not contiguous; set TYWRAP_TORCH_ALLOW_COPY=1 to allow contiguous copy'
            )
        tensor = tensor.contiguous()
    try:
        arr = tensor.numpy()
    except Exception as exc:
        raise RuntimeError('Failed to convert torch.Tensor to numpy') from exc

    return {
        '__tywrap__': 'torch.tensor',
        'codecVersion': CODEC_VERSION,
        'encoding': 'ndarray',
        'value': serialize_ndarray(arr, force_json_markers=force_json_markers),
        'shape': list(tensor.shape),
        'dtype': str(tensor.dtype),
        'device': str(tensor.device),
    }


def serialize_sklearn_estimator(obj):
    """Serialize sklearn estimators as metadata only (json-only); no pickling."""
    try:
        import sklearn  # noqa: F401
    except Exception as exc:
        raise RuntimeError('scikit-learn is not available') from exc

    params = obj.get_params(deep=False)
    try:
        json.dumps(params)
    except Exception as exc:
        raise RuntimeError(
            'scikit-learn estimator params are not JSON-serializable; avoid returning estimators or sanitize params'
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


def serialize(obj, *, force_json_markers, torch_allow_copy=False):
    """
    Top-level result serializer. Dispatch order is significant: numpy ndarray ->
    dataframe -> series -> scipy.sparse -> torch -> sklearn -> Pydantic -> stdlib
    -> passthrough. The remaining SafeCodec value behaviors (numpy/pandas scalars,
    bytes, sets, complex rejection, NaN/Infinity) are applied later during JSON
    encoding by default_encoder.
    """
    if is_numpy_array(obj):
        return serialize_ndarray(obj, force_json_markers=force_json_markers)
    if is_pandas_dataframe(obj):
        return serialize_dataframe(obj, force_json_markers=force_json_markers)
    if is_pandas_series(obj):
        return serialize_series(obj, force_json_markers=force_json_markers)
    if is_scipy_sparse(obj):
        return serialize_sparse_matrix(obj)
    if is_torch_tensor(obj):
        return serialize_torch_tensor(
            obj, force_json_markers=force_json_markers, torch_allow_copy=torch_allow_copy
        )
    if is_sklearn_estimator(obj):
        return serialize_sklearn_estimator(obj)
    pydantic_value = serialize_pydantic(obj)
    if pydantic_value is not _NO_PYDANTIC:
        return pydantic_value
    stdlib_value = serialize_stdlib(obj)
    if stdlib_value is not None:
        return stdlib_value
    return obj


# =============================================================================
# JSON ENCODE: SafeCodec-equivalent value handling (NaN reject, scalars, bytes)
# =============================================================================
#
# This mirrors SafeCodec._default_encoder (runtime/safe_codec.py) for the VALUE
# behaviors that are part of the wire contract. The subprocess server still uses
# the real SafeCodec for its final encode (it also enforces size limits); this
# core encoder exists so the Pyodide server gets identical value handling without
# depending on safe_codec.py. The conformance suite asserts these behaviors match.

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
    Build a json.dumps default= encoder matching SafeCodec's value handling.

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
    JSON-encode a fully-serialized response value, applying the SafeCodec-equivalent
    default encoder and rejecting NaN/Infinity when allow_nan is False.

    Raises CodecError (wrapping the json.dumps ValueError) on NaN/Infinity, matching
    SafeCodec's "Cannot serialize NaN..." wording so error parity holds.
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
        if (
            'nan' in error_msg
            or 'infinity' in error_msg
            or 'inf' in error_msg
            or 'out of range float' in error_msg
        ):
            raise CodecError('Cannot serialize NaN - NaN/Infinity not allowed in JSON') from exc
        raise CodecError(f'JSON encoding failed: {exc}') from exc
    except TypeError as exc:
        raise CodecError(f'JSON encoding failed: {exc}') from exc


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


def handle_call(params, *, force_json_markers, torch_allow_copy):
    module_name = require_str(params, 'module')
    function_name = require_str(params, 'functionName')
    args = deserialize(coerce_list(params.get('args'), 'args'))
    kwargs = deserialize(coerce_dict(params.get('kwargs'), 'kwargs'))
    mod = importlib.import_module(module_name)
    func = getattr(mod, function_name)
    res = func(*args, **kwargs)
    return serialize(res, force_json_markers=force_json_markers, torch_allow_copy=torch_allow_copy)


def handle_instantiate(params, instances):
    module_name = require_str(params, 'module')
    class_name = require_str(params, 'className')
    args = deserialize(coerce_list(params.get('args'), 'args'))
    kwargs = deserialize(coerce_dict(params.get('kwargs'), 'kwargs'))
    mod = importlib.import_module(module_name)
    cls = getattr(mod, class_name)
    obj = cls(*args, **kwargs)
    handle_id = str(id(obj))
    instances[handle_id] = obj
    return handle_id


def handle_call_method(params, instances, *, force_json_markers, torch_allow_copy):
    handle_id = require_str(params, 'handle')
    method_name = require_str(params, 'methodName')
    args = deserialize(coerce_list(params.get('args'), 'args'))
    kwargs = deserialize(coerce_dict(params.get('kwargs'), 'kwargs'))
    if handle_id not in instances:
        raise InstanceHandleError(f'Unknown instance handle: {handle_id}')
    obj = instances[handle_id]
    func = getattr(obj, method_name)
    res = func(*args, **kwargs)
    return serialize(res, force_json_markers=force_json_markers, torch_allow_copy=torch_allow_copy)


def handle_dispose_instance(params, instances):
    handle_id = require_str(params, 'handle')
    if handle_id not in instances:
        return False
    del instances[handle_id]
    return True


def build_meta(instances, *, bridge, pid, python_version, codec_fallback, arrow_available_override=None):
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
    return {
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
        'instances': len(instances),
    }


def dispatch_request(
    msg,
    instances,
    *,
    bridge,
    pid,
    force_json_markers,
    allow_nan=False,
    python_version=None,
    torch_allow_copy=False,
    arrow_available_override=None,
):
    """
    Validate and route a request, returning the fully-serialized response dict
    ({'id', 'protocol', 'result'}). Raises ProtocolError for malformed requests
    and propagates handler exceptions to the caller, which is responsible for
    building the error envelope (so it controls traceback inclusion).

    allow_nan is accepted for signature symmetry; NaN rejection happens during
    the final encode_value() call, which the caller performs.
    """
    mid = require_protocol(msg)
    method = msg.get('method')
    if not isinstance(method, str):
        raise ProtocolError('Missing method')
    params = coerce_dict(msg.get('params'), 'params')
    if method == 'call':
        result = handle_call(
            params, force_json_markers=force_json_markers, torch_allow_copy=torch_allow_copy
        )
    elif method == 'instantiate':
        result = handle_instantiate(params, instances)
    elif method == 'call_method':
        result = handle_call_method(
            params, instances, force_json_markers=force_json_markers, torch_allow_copy=torch_allow_copy
        )
    elif method == 'dispose_instance':
        result = handle_dispose_instance(params, instances)
    elif method == 'meta':
        if python_version is None:
            import sys
            python_version = sys.version.split()[0]
        codec_fallback = 'json' if force_json_markers else 'none'
        result = build_meta(
            instances,
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
