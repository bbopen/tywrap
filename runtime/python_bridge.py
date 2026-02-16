#!/usr/bin/env python3
import sys
import json
import importlib
import importlib.util
import os
import traceback
import base64
import datetime as dt
import decimal
import uuid
from pathlib import Path, PurePath

from safe_codec import SafeCodec, CodecError

# Ensure the working directory is importable so local modules can be resolved when
# the bridge is launched as a script from a different directory.
try:
    cwd = os.getcwd()
    if cwd and cwd not in sys.path:
        sys.path.insert(0, cwd)
except (OSError, ValueError, TypeError, AttributeError) as exc:
    # Non-fatal: continue without cwd in path.
    try:
        sys.stderr.write(f'[tywrap] Warning: could not add cwd to sys.path: {exc}\n')
    except (OSError, ValueError):
        pass

instances = {}

FALLBACK_JSON = os.environ.get('TYWRAP_CODEC_FALLBACK', '').lower() == 'json'
PROTOCOL = 'tywrap/1'
PROTOCOL_VERSION = 1
BRIDGE_NAME = 'python-subprocess'
# Why: include a stable version in envelopes so decoders can reject incompatible changes.
CODEC_VERSION = 1


class CodecConfigError(ValueError):
    """Codec configuration error."""


class CodecMaxBytesParseError(CodecConfigError):
    """Invalid TYWRAP_CODEC_MAX_BYTES value."""

    def __init__(self) -> None:
        super().__init__('TYWRAP_CODEC_MAX_BYTES must be an integer byte count')


class PayloadTooLargeError(ValueError):
    """Response payload exceeds configured size limit."""

    def __init__(self, payload_bytes: int, max_bytes: int) -> None:
        super().__init__(
            f'Response payload is {payload_bytes} bytes which exceeds TYWRAP_CODEC_MAX_BYTES={max_bytes}'
        )


class RequestMaxBytesParseError(CodecConfigError):
    """Invalid TYWRAP_REQUEST_MAX_BYTES value."""

    def __init__(self) -> None:
        super().__init__('TYWRAP_REQUEST_MAX_BYTES must be an integer byte count')


class RequestTooLargeError(ValueError):
    """Request payload exceeds configured size limit."""

    def __init__(self, payload_bytes: int, max_bytes: int) -> None:
        super().__init__(
            f'Request payload is {payload_bytes} bytes which exceeds TYWRAP_REQUEST_MAX_BYTES={max_bytes}'
        )


def get_codec_max_bytes():
    """
    Return the optional max payload size (bytes) for JSONL responses.

    Why: the subprocess transport writes a single JSON line per response; limiting size avoids
    accidental large payloads that can spike memory or clog IPC, and keeps failures explicit.
    """
    raw = os.environ.get('TYWRAP_CODEC_MAX_BYTES')
    if raw is None:
        return None
    raw = str(raw).strip()
    if not raw:
        return None
    try:
        value = int(raw)
    except Exception as exc:
        raise CodecMaxBytesParseError() from exc
    if value <= 0:
        return None
    return value


# Why: parse once at startup to avoid per-response env lookups.
CODEC_MAX_BYTES = get_codec_max_bytes()

# Why: use SafeCodec for final JSON encoding to reject NaN/Infinity and handle
# edge cases like numpy scalars. We use sys.maxsize for SafeCodec's internal limit
# to preserve the original "no limit unless TYWRAP_CODEC_MAX_BYTES is set" behavior.
# The explicit size check in encode_response() provides the specific error message
# mentioning the env var name, which is important for debugging.
_response_codec = SafeCodec(
    allow_nan=False,
    max_payload_bytes=sys.maxsize,
)


def get_request_max_bytes():
    """
    Return the optional max payload size (bytes) for JSONL requests.

    Why: cap request sizes to avoid oversized JSON payloads that can exhaust memory or hang
    downstream parsers. This keeps the bridge failure mode explicit.
    """
    raw = os.environ.get('TYWRAP_REQUEST_MAX_BYTES')
    if raw is None:
        return None
    raw = str(raw).strip()
    if not raw:
        return None
    try:
        value = int(raw)
    except Exception as exc:
        raise RequestMaxBytesParseError() from exc
    if value <= 0:
        return None
    return value


# Why: parse once at startup to avoid per-request env lookups.
REQUEST_MAX_BYTES = get_request_max_bytes()


class ProtocolError(Exception):
    pass


class InstanceHandleError(ValueError):
    """Raised when an instance handle is unknown or no longer valid."""

_NO_DESERIALIZE = object()
_ERR_BYTES_MISSING_B64 = 'Invalid bytes envelope: missing b64'
_ERR_BYTES_MISSING_DATA = 'Invalid bytes envelope: missing data'
_ERR_BYTES_INVALID_BASE64 = 'Invalid bytes envelope: invalid base64'


def _deserialize_bytes_envelope(value) -> object:
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


_PROTOCOL_DIAGNOSTIC_MAX = 2048


def emit_protocol_diagnostic(message: str) -> None:
    """
    Write bounded protocol diagnostics to stderr.

    Why: provide context for malformed requests without flooding stderr or breaking the JSONL
    stream expected by the JS side.
    """
    try:
        msg = str(message)
        if len(msg) > _PROTOCOL_DIAGNOSTIC_MAX:
            msg = msg[:_PROTOCOL_DIAGNOSTIC_MAX] + '...'
        sys.stderr.write(f'[tywrap] Protocol error: {msg}\n')
        sys.stderr.flush()
    except Exception:
        # Avoid raising from diagnostics
        pass


def arrow_available():
    """
    Return True when pyarrow can be imported.

    Why: advertise Arrow capability to the TS side without crashing startup when
    pyarrow is optional or missing.
    """
    try:
        import pyarrow
    except (ImportError, OSError):
        return False
    return True


def module_available(module_name: str) -> bool:
    """
    Lightweight feature detection for optional codec dependencies.

    Why: exposes availability in bridge metadata without importing heavy modules or triggering
    side effects, so the TS side can decide when to rely on optional codecs. These flags are
    best-effort hints; serialization still performs its own import checks for correctness.
    """
    try:
        return importlib.util.find_spec(module_name) is not None
    except (ImportError, AttributeError, TypeError, ValueError):
        # Why: guard against unusual importlib edge cases without masking other failures.
        return False


def is_numpy_array(obj):
    """
    Detect numpy arrays when NumPy is installed.

    Why: keep NumPy optional while enabling ndarray serialization.
    """
    try:
        import numpy as np  # noqa: F401
    except Exception:
        return False
    return isinstance(obj, np.ndarray)


def is_pandas_dataframe(obj):
    """
    Detect pandas DataFrame instances when pandas is installed.

    Why: avoid hard pandas dependency while enabling dataframe encoding.
    """
    try:
        import pandas as pd  # noqa: F401
    except Exception:
        return False
    return isinstance(obj, pd.DataFrame)


def is_pandas_series(obj):
    """
    Detect pandas Series instances when pandas is installed.

    Why: avoid hard pandas dependency while enabling series encoding.
    """
    try:
        import pandas as pd  # noqa: F401
    except Exception:
        return False
    return isinstance(obj, pd.Series)


def is_scipy_sparse(obj):
    """
    Detect scipy sparse matrices when scipy is installed.

    Why: allow sparse matrix encoding without importing scipy in all environments.
    """
    try:
        import scipy.sparse as sp  # noqa: F401
    except Exception:
        return False
    try:
        return sp.issparse(obj)
    except Exception:
        return False


def is_torch_tensor(obj):
    """
    Detect torch tensors when torch is installed.

    Why: allow tensor encoding without a hard torch dependency.
    """
    try:
        import torch  # noqa: F401
    except Exception:
        return False
    try:
        return torch.is_tensor(obj)
    except Exception:
        return False


def is_sklearn_estimator(obj):
    """
    Detect sklearn estimators for metadata-only serialization.

    Why: allow feature-gated estimator metadata without importing sklearn by default.
    """
    try:
        from sklearn.base import BaseEstimator  # noqa: F401
    except Exception:
        return False
    return isinstance(obj, BaseEstimator)


def serialize_ndarray(obj):
    """
    Encode a NumPy ndarray for transport over the JSONL bridge.

    Why: Arrow IPC gives a compact, lossless binary payload that the JS side can decode as a
    Table. If JSON fallback is explicitly requested, honor it even when pyarrow is installed so
    callers don't unexpectedly need an Arrow decoder on the TypeScript side.

    Note: PyArrow's pa.array() only handles 1D arrays. For multi-dimensional arrays, we flatten
    before encoding and include shape metadata for reconstruction on the JS side. This maintains
    Arrow's binary efficiency while working with the current arrow-js implementation (which
    doesn't yet support FixedShapeTensorArray). See: https://github.com/apache/arrow-js/issues/115
    """
    if FALLBACK_JSON:
        return serialize_ndarray_json(obj)
    try:
        import pyarrow as pa  # type: ignore
    except Exception as exc:
        raise RuntimeError(
            'Arrow encoding unavailable for ndarray; install pyarrow or set TYWRAP_CODEC_FALLBACK=json to enable JSON fallback'
        ) from exc
    try:
        # Flatten multi-dimensional arrays for Arrow compatibility
        # pa.array() only handles 1D arrays; we preserve shape for JS-side reconstruction
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
        if FALLBACK_JSON:
            return serialize_ndarray_json(obj)
        raise RuntimeError('Arrow encoding failed for ndarray') from exc


def serialize_ndarray_json(obj):
    """
    JSON fallback for ndarray encoding.

    Why: this keeps the bridge usable in environments without pyarrow/Arrow decoding, at the
    cost of larger payloads and potential dtype loss.
    """
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


def serialize_dataframe(obj):
    """
    Encode a pandas DataFrame for transport.

    Why: we emit Feather (Arrow IPC file) as *uncompressed* because the JS apache-arrow reader
    does not implement record batch compression. Keeping this uncompressed makes Arrow mode
    work out-of-the-box for Node decoders.
    """
    if FALLBACK_JSON:
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
        # Use explicit uncompressed payloads so JS decoders (apache-arrow) can read them
        # without optional compression dependencies.
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
        if FALLBACK_JSON:
            return serialize_dataframe_json(obj)
        raise RuntimeError('Arrow encoding failed for pandas.DataFrame') from exc


def serialize_dataframe_json(obj):
    """
    JSON fallback for DataFrame encoding.

    Why: this keeps the example/runtime working without Arrow; it is easy to inspect but larger
    than Arrow and may not preserve all dtypes exactly.
    """
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


def serialize_series(obj):
    """
    Encode a pandas Series for transport.

    Why: encode as a single-column Arrow Table stream (not a raw Array schema) because the JS
    decoder contract is "table-like" and pyarrow's IPC writer expects a Schema, not a DataType.
    """
    if FALLBACK_JSON:
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
        if FALLBACK_JSON:
            return serialize_series_json(obj)
        raise RuntimeError('Arrow encoding failed for pandas.Series') from exc


def serialize_series_json(obj):
    """
    JSON fallback for Series encoding.

    Why: avoids requiring Arrow decoding support, at the cost of potentially lossy dtype/NA
    representation compared to Arrow.
    """
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
    Serialize scipy sparse matrices into structured JSON envelopes.

    Why: preserve sparsity and matrix shape without implicit dense conversion, keeping
    failures explicit when unsupported formats or dtypes are encountered.
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


def serialize_torch_tensor(obj):
    """
    Serialize torch.Tensor values via the ndarray envelope.

    Why: ensure CPU-only transport by default and make device/copy behavior explicit to callers.
    """
    allow_copy = os.environ.get('TYWRAP_TORCH_ALLOW_COPY', '').lower() in ('1', 'true', 'yes')
    tensor = obj.detach()
    if getattr(tensor, 'device', None) is not None and tensor.device.type != 'cpu':
        if not allow_copy:
            raise RuntimeError(
                'Torch tensor is on a non-CPU device; set TYWRAP_TORCH_ALLOW_COPY=1 to allow CPU transfer'
            )
        tensor = tensor.to('cpu')
    if hasattr(tensor, 'is_contiguous') and not tensor.is_contiguous():
        if not allow_copy:
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
        'value': serialize_ndarray(arr),
        'shape': list(tensor.shape),
        'dtype': str(tensor.dtype),
        'device': str(tensor.device),
    }


def serialize_sklearn_estimator(obj):
    """
    Serialize sklearn estimators as metadata only.

    Why: avoid unsafe pickling while still exposing model identity and params to TypeScript.
    """
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
    Serialize Pydantic v2 models without importing Pydantic.

    Why: returning BaseModel instances is common in typed Python APIs. Converting via
    `model_dump` keeps Python type hints accurate (return the model), while the bridge still
    emits a JSON-serializable payload. We default to `by_alias=True` so alias_generator-based
    camelCase schemas round-trip cleanly to TypeScript.
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

def serialize(obj):
    if is_numpy_array(obj):
        return serialize_ndarray(obj)
    if is_pandas_dataframe(obj):
        return serialize_dataframe(obj)
    if is_pandas_series(obj):
        return serialize_series(obj)
    if is_scipy_sparse(obj):
        return serialize_sparse_matrix(obj)
    if is_torch_tensor(obj):
        return serialize_torch_tensor(obj)
    if is_sklearn_estimator(obj):
        return serialize_sklearn_estimator(obj)
    pydantic_value = serialize_pydantic(obj)
    if pydantic_value is not _NO_PYDANTIC:
        return pydantic_value
    stdlib_value = serialize_stdlib(obj)
    if stdlib_value is not None:
        return stdlib_value
    return obj


def serialize_stdlib(obj):
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


def handle_call(params):
    module_name = require_str(params, 'module')
    function_name = require_str(params, 'functionName')
    args = deserialize(coerce_list(params.get('args'), 'args'))
    kwargs = deserialize(coerce_dict(params.get('kwargs'), 'kwargs'))
    mod = importlib.import_module(module_name)
    func = getattr(mod, function_name)
    res = func(*args, **kwargs)
    return serialize(res)


def handle_instantiate(params):
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


def handle_call_method(params):
    handle_id = require_str(params, 'handle')
    method_name = require_str(params, 'methodName')
    args = deserialize(coerce_list(params.get('args'), 'args'))
    kwargs = deserialize(coerce_dict(params.get('kwargs'), 'kwargs'))
    if handle_id not in instances:
        raise InstanceHandleError(f'Unknown instance handle: {handle_id}')
    obj = instances[handle_id]
    func = getattr(obj, method_name)
    res = func(*args, **kwargs)
    return serialize(res)


def handle_dispose_instance(params):
    handle_id = require_str(params, 'handle')
    if handle_id not in instances:
        return False
    del instances[handle_id]
    return True


def handle_meta():
    """
    Return bridge metadata for capability detection.

    Why: the Node side uses this to decide whether optional codecs can be used.
    """
    return {
        'protocol': PROTOCOL,
        'protocolVersion': PROTOCOL_VERSION,
        'bridge': BRIDGE_NAME,
        'pythonVersion': sys.version.split()[0],
        'pid': os.getpid(),
        'codecFallback': 'json' if FALLBACK_JSON else 'none',
        'arrowAvailable': arrow_available(),
        'scipyAvailable': module_available('scipy'),
        'torchAvailable': module_available('torch'),
        'sklearnAvailable': module_available('sklearn'),
        'instances': len(instances),
    }


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
    """
    Return a required string parameter from a request.

    Why: keep request schema validation centralized and explicit for clearer errors.
    """
    value = params.get(key)
    if not isinstance(value, str) or not value:
        raise ProtocolError(f'Missing {key}')
    return value


def coerce_list(value, key):
    """
    Coerce an optional list parameter into a list.

    Why: normalize args inputs while rejecting invalid shapes early.
    """
    if value is None:
        return []
    if not isinstance(value, list):
        raise ProtocolError(f'Invalid {key}')
    return value


def coerce_dict(value, key):
    """
    Coerce an optional dict parameter into a dict.

    Why: normalize kwargs inputs while rejecting invalid shapes early.
    """
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ProtocolError(f'Invalid {key}')
    return value


def dispatch_request(msg):
    """
    Dispatch a validated request to the correct handler.

    Why: keep the main loop focused on I/O while this function handles validation and routing.
    """
    mid = require_protocol(msg)
    method = msg.get('method')
    if not isinstance(method, str):
        raise ProtocolError('Missing method')
    params = coerce_dict(msg.get('params'), 'params')
    if method == 'call':
        result = handle_call(params)
    elif method == 'instantiate':
        result = handle_instantiate(params)
    elif method == 'call_method':
        result = handle_call_method(params)
    elif method == 'dispose_instance':
        result = handle_dispose_instance(params)
    elif method == 'meta':
        result = handle_meta()
    else:
        raise ProtocolError(f'Unknown method: {method}')
    return mid, result


def build_error_payload(mid, exc, *, include_traceback):
    """
    Build a protocol error response.

    Why: ensure error formatting stays consistent while keeping exception handling centralized.
    """
    error = { 'type': type(exc).__name__, 'message': str(exc) }
    if include_traceback:
        error['traceback'] = traceback.format_exc()
    return {
        'id': mid if mid is not None else -1,
        'protocol': PROTOCOL,
        'error': error,
    }


def encode_response(out):
    """
    Serialize the response and enforce size limits.

    Why: keep payload size checks outside the main loop for clarity and lint compliance.
    Uses SafeCodec to reject NaN/Infinity and handle edge cases like numpy scalars.
    """
    try:
        payload = _response_codec.encode(out)
    except CodecError as exc:
        # Convert CodecError to ValueError for consistent error handling
        raise ValueError(str(exc)) from exc
    payload_bytes = len(payload.encode('utf-8'))
    if CODEC_MAX_BYTES is not None and payload_bytes > CODEC_MAX_BYTES:
        raise PayloadTooLargeError(payload_bytes, CODEC_MAX_BYTES)
    return payload


def write_payload(payload: str) -> bool:
    """
    Write a JSONL payload to stdout and flush.

    Why: centralize BrokenPipe handling so the main loop can exit cleanly when the
    parent process goes away.
    """
    try:
        sys.stdout.write(payload + '\n')
        sys.stdout.flush()
        return True
    except BrokenPipeError:
        return False


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        mid = None
        out = None
        try:
            if REQUEST_MAX_BYTES is not None:
                payload_bytes = len(line.encode('utf-8'))
                if payload_bytes > REQUEST_MAX_BYTES:
                    raise RequestTooLargeError(payload_bytes, REQUEST_MAX_BYTES)
            msg = json.loads(line)
            if isinstance(msg, dict):
                req_id = msg.get('id')
                if isinstance(req_id, int):
                    # Why: preserve request ids even when handlers raise.
                    mid = req_id
            try:
                mid, result = dispatch_request(msg)
                out = { 'id': mid, 'protocol': PROTOCOL, 'result': result }
            except ProtocolError as e:
                emit_protocol_diagnostic(str(e))
                out = build_error_payload(mid, e, include_traceback=False)
            except Exception as e:  # noqa: BLE001
                # Why: ensure any handler error becomes a protocol-compliant response.
                out = build_error_payload(mid, e, include_traceback=True)
        except RequestTooLargeError as e:
            emit_protocol_diagnostic(str(e))
            out = build_error_payload(mid, e, include_traceback=False)
        except json.JSONDecodeError as e:
            emit_protocol_diagnostic(f'Invalid JSON: {e}')
            out = build_error_payload(mid, e, include_traceback=False)
        except Exception as e:  # noqa: BLE001
            # Why: catch malformed input without breaking the JSONL protocol.
            out = build_error_payload(mid, e, include_traceback=False)

        try:
            payload = encode_response(out)
            if not write_payload(payload):
                return
        except Exception as e:  # noqa: BLE001
            # Why: fallback error keeps responses well-formed even if serialization fails.
            err_out = build_error_payload(mid, e, include_traceback=False)
            try:
                if not write_payload(json.dumps(err_out)):
                    return
            except Exception:
                return


if __name__ == '__main__':
    main()
