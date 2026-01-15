#!/usr/bin/env python3
import sys
import json
import importlib
import os
import traceback
import base64
import datetime as dt
import decimal
import uuid
from pathlib import Path, PurePath

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


class ProtocolError(Exception):
    pass


def arrow_available():
    try:
        import pyarrow  # noqa: F401
    except Exception:
        return False
    return True


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


def serialize_ndarray(obj):
    """
    Encode a NumPy ndarray for transport over the JSONL bridge.

    Why: Arrow IPC gives a compact, lossless binary payload that the JS side can decode as a
    Table. If JSON fallback is explicitly requested, honor it even when pyarrow is installed so
    callers don't unexpectedly need an Arrow decoder on the TypeScript side.
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
        arr = pa.array(obj)
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
            'shape': getattr(obj, 'shape', None),
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
        raise ValueError('TYWRAP_CODEC_MAX_BYTES must be an integer byte count') from exc
    if value <= 0:
        return None
    return value


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
        return model_dump(by_alias=True, mode='json')
    except TypeError:
        # Older Pydantic versions may not support `mode=...`.
        return model_dump(by_alias=True)

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
    module_name = params.get('module')
    function_name = params.get('functionName')
    args = params.get('args') or []
    kwargs = params.get('kwargs') or {}
    mod = importlib.import_module(module_name)
    func = getattr(mod, function_name)
    res = func(*args, **kwargs)
    return serialize(res)


def handle_instantiate(params):
    module_name = params.get('module')
    class_name = params.get('className')
    args = params.get('args') or []
    kwargs = params.get('kwargs') or {}
    mod = importlib.import_module(module_name)
    cls = getattr(mod, class_name)
    obj = cls(*args, **kwargs)
    handle_id = str(id(obj))
    instances[handle_id] = obj
    return handle_id


def handle_call_method(params):
    handle_id = params.get('handle')
    method_name = params.get('methodName')
    args = params.get('args') or []
    kwargs = params.get('kwargs') or {}
    if handle_id not in instances:
        raise KeyError(f'Unknown handle: {handle_id}')
    obj = instances[handle_id]
    func = getattr(obj, method_name)
    res = func(*args, **kwargs)
    return serialize(res)


def handle_dispose_instance(params):
    handle_id = params.get('handle')
    if handle_id not in instances:
        raise KeyError(f'Unknown handle: {handle_id}')
    del instances[handle_id]
    return True


def handle_meta():
    return {
        'protocol': PROTOCOL,
        'protocolVersion': PROTOCOL_VERSION,
        'bridge': BRIDGE_NAME,
        'pythonVersion': sys.version.split()[0],
        'pid': os.getpid(),
        'codecFallback': 'json' if FALLBACK_JSON else 'none',
        'arrowAvailable': arrow_available(),
        'instances': len(instances),
    }


def require_protocol(msg):
    proto = msg.get('protocol')
    if proto != PROTOCOL:
        raise ProtocolError(f'Invalid protocol: {proto}')
    mid = msg.get('id')
    if not isinstance(mid, int):
        raise ProtocolError(f'Invalid request id: {mid}')
    return mid


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        mid = None
        out = None
        try:
            msg = json.loads(line)
            mid = require_protocol(msg)
            method = msg.get('method')
            if not isinstance(method, str):
                raise ProtocolError('Missing method')
            params = msg.get('params') or {}
            if not isinstance(params, dict):
                raise ProtocolError('Invalid params')
            try:
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
                    raise ValueError('Unknown method')
                out = { 'id': mid, 'protocol': PROTOCOL, 'result': result }
            except Exception as e:
                out = {
                    'id': mid,
                    'protocol': PROTOCOL,
                    'error': { 'type': type(e).__name__, 'message': str(e), 'traceback': traceback.format_exc() }
                }
        except Exception as e:
            out = {
                'id': mid if mid is not None else -1,
                'protocol': PROTOCOL,
                'error': { 'type': type(e).__name__, 'message': str(e) }
            }

        try:
            payload = json.dumps(out)
            max_bytes = get_codec_max_bytes()
            payload_bytes = len(payload.encode('utf-8'))
            if max_bytes is not None and payload_bytes > max_bytes:
                raise ValueError(
                    f'Response payload is {payload_bytes} bytes which exceeds TYWRAP_CODEC_MAX_BYTES={max_bytes}'
                )
            sys.stdout.write(payload + '\n')
        except Exception as e:
            err_out = {
                'id': mid if mid is not None else -1,
                'protocol': PROTOCOL,
                'error': {
                    'type': type(e).__name__,
                    'message': str(e)
                }
            }
            sys.stdout.write(json.dumps(err_out) + '\n')
        sys.stdout.flush()


if __name__ == '__main__':
    main()
