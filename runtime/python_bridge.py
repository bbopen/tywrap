#!/usr/bin/env python3
import sys
import json
import importlib
import os
import traceback

instances = {}

FALLBACK_JSON = os.environ.get('TYWRAP_CODEC_FALLBACK', '').lower() == 'json'


def serialize(obj):
    try:
        import numpy as np  # noqa: F401
        if hasattr(obj, 'tolist') and hasattr(obj, 'shape'):
            try:
                import pyarrow as pa  # type: ignore
                import base64
                # numpy array -> Arrow tensor (fallback to tolist when not supported)
                try:
                    arr = pa.array(obj)
                    sink = pa.BufferOutputStream()
                    with pa.ipc.new_stream(sink, arr.type) as writer:
                        writer.write(arr)
                    buf = sink.getvalue()
                    b64 = base64.b64encode(buf.to_pybytes()).decode('ascii')
                    return { '__tywrap__': 'ndarray', 'encoding': 'arrow', 'b64': b64, 'shape': getattr(obj, 'shape', None) }
                except Exception:
                    if not FALLBACK_JSON:
                        raise
            except Exception:
                if not FALLBACK_JSON:
                    raise
            if FALLBACK_JSON:
                return { '__tywrap__': 'ndarray', 'encoding': 'json', 'data': obj.tolist(), 'shape': getattr(obj, 'shape', None) }
            raise RuntimeError('Arrow encoding unavailable for ndarray; install pyarrow or set TYWRAP_CODEC_FALLBACK=json to enable JSON fallback')
    except Exception:
        pass
    try:
        import pandas as pd  # noqa: F401
        # Pandas DataFrame
        if hasattr(obj, 'to_dict') and getattr(type(obj), '__name__', '') == 'DataFrame':
            try:
                import pyarrow as pa  # type: ignore
                import pyarrow.feather as feather  # type: ignore
                import base64
                try:
                    table = pa.Table.from_pandas(obj)  # type: ignore
                    sink = pa.BufferOutputStream()
                    feather.write_feather(table, sink)
                    buf = sink.getvalue()
                    b64 = base64.b64encode(buf.to_pybytes()).decode('ascii')
                    return { '__tywrap__': 'dataframe', 'encoding': 'arrow', 'b64': b64 }
                except Exception:
                    if not FALLBACK_JSON:
                        raise
            except Exception:
                if not FALLBACK_JSON:
                    raise
            if FALLBACK_JSON:
                return { '__tywrap__': 'dataframe', 'encoding': 'json', 'data': obj.to_dict(orient='records') }
            raise RuntimeError('Arrow encoding unavailable for pandas.DataFrame; install pyarrow or set TYWRAP_CODEC_FALLBACK=json to enable JSON fallback')
        # Pandas Series
        if getattr(type(obj), '__name__', '') == 'Series':
            try:
                import pyarrow as pa  # type: ignore
                import base64
                try:
                    arr = pa.Array.from_pandas(obj)  # type: ignore
                    sink = pa.BufferOutputStream()
                    with pa.ipc.new_stream(sink, arr.type) as writer:
                        writer.write(arr)
                    buf = sink.getvalue()
                    b64 = base64.b64encode(buf.to_pybytes()).decode('ascii')
                    return { '__tywrap__': 'series', 'encoding': 'arrow', 'b64': b64, 'name': getattr(obj, 'name', None) }
                except Exception:
                    if not FALLBACK_JSON:
                        raise
            except Exception:
                if not FALLBACK_JSON:
                    raise
            try:
                data = obj.to_list()  # type: ignore
            except Exception:
                data = obj.to_dict()  # type: ignore
            if FALLBACK_JSON:
                return { '__tywrap__': 'series', 'encoding': 'json', 'data': data, 'name': getattr(obj, 'name', None) }
            raise RuntimeError('Arrow encoding unavailable for pandas.Series; install pyarrow or set TYWRAP_CODEC_FALLBACK=json to enable JSON fallback')
    except Exception:
        pass
    return obj

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

def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
            mid = msg.get('id')
            method = msg.get('method')
            params = msg.get('params') or {}
            try:
                if method == 'call':
                    result = handle_call(params)
                elif method == 'instantiate':
                    result = handle_instantiate(params)
                else:
                    raise ValueError('Unknown method')
                out = { 'id': mid, 'result': result }
            except Exception as e:
                out = {
                    'id': mid,
                    'error': { 'type': type(e).__name__, 'message': str(e), 'traceback': traceback.format_exc() }
                }
        except Exception as e:
            out = { 'id': -1, 'error': { 'type': type(e).__name__, 'message': str(e) } }
        sys.stdout.write(json.dumps(out) + '\n')
        sys.stdout.flush()

if __name__ == '__main__':
    main()


