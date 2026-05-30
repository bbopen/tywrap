#!/usr/bin/env python3
"""
Reference tywrap Python bridge server (subprocess + HTTP transports).

This module owns the I/O concerns and process identity for the Node/Bun/Deno
subprocess transport and the HTTP transport:
  - the stdin/stdout JSONL request/response loop (main())
  - env-var size guards (TYWRAP_CODEC_MAX_BYTES / TYWRAP_REQUEST_MAX_BYTES)
  - TYWRAP_CODEC_FALLBACK=json marker mode and TYWRAP_TORCH_ALLOW_COPY
  - the real OS pid and bridge='python-subprocess' identity
  - the final SafeCodec.encode wrapper (NaN rejection + numpy scalar coercion +
    the explicit byte-size limit error message)

The protocol dispatch, request deserialization, and the 6 __tywrap__ marker
serializers live in the shared, pure module tywrap_bridge_core (so the in-WASM
Pyodide server can run the SAME code). Those names are re-exported below for
backward compatibility, since this package ships runtime/ and external importers
may reference e.g. serialize() or dispatch_request().
"""
import sys
import json
import os
import importlib  # noqa: F401  (re-exported for compat / used by handlers via core)

from safe_codec import SafeCodec, CodecError

import tywrap_bridge_core as core

# Re-export the shared protocol/serialization surface so existing importers of
# python_bridge keep working after the extraction (codex-flagged: runtime/ ships).
from tywrap_bridge_core import (  # noqa: F401
    PROTOCOL,
    PROTOCOL_VERSION,
    CODEC_VERSION,
    ProtocolError,
    InstanceHandleError,
    deserialize,
    arrow_available,
    module_available,
    is_numpy_array,
    is_pandas_dataframe,
    is_pandas_series,
    is_scipy_sparse,
    is_torch_tensor,
    is_sklearn_estimator,
    serialize_ndarray_json,
    serialize_dataframe_json,
    serialize_series_json,
    serialize_sparse_matrix,
    serialize_sklearn_estimator,
    serialize_pydantic,
    serialize_stdlib,
    require_protocol,
    require_str,
    coerce_list,
    coerce_dict,
    build_error_payload,
)

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
TORCH_ALLOW_COPY = os.environ.get('TYWRAP_TORCH_ALLOW_COPY', '').lower() in ('1', 'true', 'yes')
BRIDGE_NAME = 'python-subprocess'


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


def serialize(obj):
    """
    Backward-compatible result serializer (subprocess identity).

    Threads the env-derived TYWRAP_CODEC_FALLBACK / TYWRAP_TORCH_ALLOW_COPY flags
    into the shared core serializer. Kept as a module-level function so existing
    importers of python_bridge.serialize keep working.
    """
    return core.serialize(obj, force_json_markers=FALLBACK_JSON, torch_allow_copy=TORCH_ALLOW_COPY)


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


def handle_meta():
    """
    Return bridge metadata for capability detection (subprocess identity).

    Why: the Node side uses this to decide whether optional codecs can be used.
    Kept for backward compatibility; delegates to the shared core builder with the
    real pid and bridge='python-subprocess'.
    """
    return core.build_meta(
        instances,
        bridge=BRIDGE_NAME,
        pid=os.getpid(),
        python_version=sys.version.split()[0],
        codec_fallback='json' if FALLBACK_JSON else 'none',
    )


def dispatch_request(msg):
    """
    Dispatch a validated request to the correct handler (subprocess identity).

    Why: keep main() focused on I/O. Delegates routing/validation/serialization to
    the shared core, supplying the subprocess pid/bridge and the env-derived flags.
    Returns (mid, result) to preserve the historical signature for any importer.
    """
    out = core.dispatch_request(
        msg,
        instances,
        bridge=BRIDGE_NAME,
        pid=os.getpid(),
        force_json_markers=FALLBACK_JSON,
        allow_nan=False,
        python_version=sys.version.split()[0],
        torch_allow_copy=TORCH_ALLOW_COPY,
    )
    return out['id'], out['result']


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
                out = {'id': mid, 'protocol': PROTOCOL, 'result': result}
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
