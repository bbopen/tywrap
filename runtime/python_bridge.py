#!/usr/bin/env python3
"""
Reference tywrap Python subprocess bridge.

This module implements only the stdin/stdout subprocess loop for the Node/Bun/
Deno transport. `HttpBridge` connects to an HTTP server provided by the
operator; tywrap does not ship that server or an HTTP transport in this module.
The operator is responsible for securing any network exposure.

This module owns the I/O concerns and process identity for the Node/Bun/Deno
subprocess transport:
  - the stdin/stdout JSONL request/response loop (main())
  - env-var size guards (TYWRAP_CODEC_MAX_BYTES / TYWRAP_REQUEST_MAX_BYTES)
  - TYWRAP_CODEC_FALLBACK=json marker mode and TYWRAP_TORCH_ALLOW_COPY
  - the import/attribute allowlist policy (TYWRAP_ALLOWED_MODULES /
    TYWRAP_ALLOW_PRIVATE_ATTRS), threaded into core.dispatch_request
  - the real OS pid and bridge='python-subprocess' identity
  - the final BridgeCodec.encode wrapper (NaN rejection + numpy scalar coercion +
    the explicit byte-size limit error message)

SECURITY / TRUST MODEL: the bridge imports the requested module and getattrs the
requested function/class/method, so call/instantiate/call_method are an arbitrary
import+getattr+call surface. Two guards (implemented in tywrap_bridge_core) bound
that surface:
  * TYWRAP_ALLOWED_MODULES (comma/space separated): when set, only those modules
    (plus the stdlib the bridge itself needs) may be imported; anything else fails
    with ImportNotAllowedError. UNSET = no restriction (preserves prior behavior).
  * TYWRAP_ALLOW_PRIVATE_ATTRS=1: opt out of the default block on underscore-prefixed
    (private/dunder) attribute access, which otherwise prevents the classic
    __globals__/__subclasses__/__builtins__ escape chain.
The bridge does NOT sandbox the called code itself; only trusted Python should be
exposed. See SECURITY.md for the full threat model.

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

from safe_codec import BridgeCodec, CodecError

import tywrap_bridge_core as core
from frame_codec import FRAME_PROTOCOL_ID, FrameError, Reassembler, encode_frames

# Re-export the shared protocol/serialization surface so existing importers of
# python_bridge keep working after the extraction (codex-flagged: runtime/ ships).
from tywrap_bridge_core import (  # noqa: F401
    PROTOCOL,
    PROTOCOL_VERSION,
    CODEC_VERSION,
    ProtocolError,
    InstanceHandleError,
    ImportNotAllowedError,
    AttributeNotAllowedError,
    import_allowed_module,
    get_allowed_attr,
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


def parse_allowed_modules():
    """
    Parse TYWRAP_ALLOWED_MODULES into an allowlist set, or None when unset.

    Why: returning None preserves the historical "import anything" behavior so
    existing configurations keep working; supplying the env var (comma- and/or
    whitespace-separated module names) switches the bridge into allowlist mode,
    where only the listed modules plus the stdlib the bridge itself needs may be
    imported. An empty/blank value is treated as unset (no restriction).
    """
    raw = os.environ.get('TYWRAP_ALLOWED_MODULES')
    if raw is None:
        return None
    names = {name.strip() for chunk in raw.split(',') for name in chunk.split()}
    names.discard('')
    if not names:
        return None
    return frozenset(names)


# Why: parse once at startup. None => no allowlist (prior behavior preserved).
ALLOWED_MODULES = parse_allowed_modules()
# Why: underscore-prefixed (private/dunder) attribute access is blocked by default
# to prevent sandbox-escape via __globals__/__subclasses__/__builtins__; this opts out.
ALLOW_PRIVATE_ATTRS = os.environ.get('TYWRAP_ALLOW_PRIVATE_ATTRS', '').lower() in ('1', 'true', 'yes')


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

# Why: use BridgeCodec for final JSON encoding to reject NaN/Infinity and handle
# edge cases like numpy scalars. We use sys.maxsize for BridgeCodec's internal limit
# to preserve the original "no limit unless TYWRAP_CODEC_MAX_BYTES is set" behavior.
# The explicit size check in encode_response() provides the specific error message
# mentioning the env var name, which is important for debugging.
_response_codec = BridgeCodec(
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


class TransportFrameBytesParseError(CodecConfigError):
    """Invalid TYWRAP_TRANSPORT_MAX_FRAME_BYTES value."""

    def __init__(self) -> None:
        super().__init__('TYWRAP_TRANSPORT_MAX_FRAME_BYTES must be a positive integer byte count')


def negotiate_chunking():
    """
    Resolve the chunked-transport (``tywrap-frame/1``) negotiation from env.

    The subprocess transport spawns this bridge with three env vars
    (see docs/transport-framing.md):

      * ``TYWRAP_TRANSPORT_CHUNKING=1``       -- enable framing
      * ``TYWRAP_TRANSPORT_FRAME_PROTOCOL``   -- must equal ``tywrap-frame/1``
      * ``TYWRAP_TRANSPORT_MAX_FRAME_BYTES``  -- the JS-side JSONL line ceiling

    Returns ``(enabled, max_frame_bytes)``. Chunking is enabled ONLY when all
    three agree: the flag is truthy, the advertised frame protocol matches the
    one this bridge implements, and the max-frame size is a positive integer.
    A mismatched frame protocol (a future framing version this bridge does not
    speak) leaves chunking disabled -- the bridge then advertises
    ``supportsChunking: false`` and oversize responses fail LOUD (no silent
    single-frame fallback), exactly as an old un-negotiated bridge would.

    :raises TransportFrameBytesParseError: if the flag/protocol are set to enable
        chunking but the max-frame-bytes value is not a positive integer.
    """
    flag = os.environ.get('TYWRAP_TRANSPORT_CHUNKING', '').lower() in ('1', 'true', 'yes')
    if not flag:
        return False, None
    frame_protocol = os.environ.get('TYWRAP_TRANSPORT_FRAME_PROTOCOL', '')
    if frame_protocol != FRAME_PROTOCOL_ID:
        # A framing protocol this bridge does not implement: stay single-frame.
        return False, None
    raw = os.environ.get('TYWRAP_TRANSPORT_MAX_FRAME_BYTES', '')
    raw = str(raw).strip()
    try:
        value = int(raw)
    except Exception as exc:
        raise TransportFrameBytesParseError() from exc
    if value <= 0:
        raise TransportFrameBytesParseError()
    return True, value


# Why: parse once at startup. CHUNKING_ENABLED gates the chunked write path and
# the transport block advertised in meta; MAX_FRAME_BYTES is the negotiated
# per-frame UTF-8 byte ceiling.
CHUNKING_ENABLED, MAX_FRAME_BYTES = negotiate_chunking()

# The transport negotiation block echoed back in the `meta` response so the JS
# side learns this bridge can reassemble chunked frames. None => omitted (an old
# bridge / un-negotiated process is indistinguishable on the wire).
TRANSPORT_INFO = (
    {
        'frameProtocol': FRAME_PROTOCOL_ID,
        'supportsChunking': True,
        'maxFrameBytes': MAX_FRAME_BYTES,
    }
    if CHUNKING_ENABLED
    else None
)


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
        transport_info=TRANSPORT_INFO,
    )


def dispatch_request(msg, *, has_envelope_markers=True):
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
        allowed_modules=ALLOWED_MODULES,
        allow_private_attrs=ALLOW_PRIVATE_ATTRS,
        transport_info=TRANSPORT_INFO,
        has_envelope_markers=has_envelope_markers,
    )
    return out['id'], out['result']


def encode_response(out):
    """
    Serialize the response and enforce size limits.

    Why: keep payload size checks outside the main loop for clarity and lint compliance.
    Uses BridgeCodec to reject NaN/Infinity and handle edge cases like numpy scalars.
    """
    try:
        payload = _response_codec.encode(out)
    except CodecError as exc:
        # Convert CodecError to ValueError for consistent error handling
        raise ValueError(str(exc)) from exc
    payload_utf8 = payload.encode('utf-8')
    payload_bytes = len(payload_utf8)
    if CODEC_MAX_BYTES is not None and payload_bytes > CODEC_MAX_BYTES:
        raise PayloadTooLargeError(payload_bytes, CODEC_MAX_BYTES)
    return payload, payload_utf8


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


def write_response(payload: str, payload_utf8: bytes, response_id) -> bool:
    """
    Write a fully-encoded JSONL response, fragmenting it into ``tywrap-frame/1``
    frames when chunking is negotiated and the payload exceeds the per-frame
    ceiling.

    Why: a single response can exceed the JS-side JSONL line ceiling
    (``maxLineLength``). When the subprocess transport negotiated chunking (the
    three ``TYWRAP_TRANSPORT_*`` env vars), an oversize response is split into
    frames, each written as its own JSONL line and flushed one at a time so the
    OS pipe provides backpressure. The TS reassembler (W3) rebuilds the single
    logical response before the codec ever sees it. Small responses (or any
    response when chunking was not negotiated) keep going out as one JSONL line
    exactly as before. There is NO silent single-frame fallback for an oversize
    response on an un-negotiated bridge: it is written whole and the JS line
    ceiling rejects it LOUD, by design.

    Frames require an integer correlation id. A response with a non-integer id
    (only reachable on a malformed request whose error envelope carries id=None)
    is never large enough to chunk, so it is always written as a single line.

    Returns False if the parent's stdin/our stdout closed mid-write (BrokenPipe),
    so the caller can exit the loop cleanly.
    """
    if not CHUNKING_ENABLED or MAX_FRAME_BYTES is None:
        return write_payload(payload)

    payload_bytes = len(payload_utf8)
    if payload_bytes <= MAX_FRAME_BYTES:
        return write_payload(payload)

    if not isinstance(response_id, int) or isinstance(response_id, bool):
        # Cannot correlate frames without an integer id; emit as one line. This
        # only happens for tiny malformed-request error envelopes (id=None),
        # which never exceed a sane frame ceiling.
        return write_payload(payload)

    frames = encode_frames(
        payload,
        id=response_id,
        stream='response',
        max_frame_bytes=MAX_FRAME_BYTES,
        total_bytes=payload_bytes,
    )
    for frame in frames:
        # One frame per JSONL line; flush per frame so the pipe backpressures
        # and the TS reader can interleave reassembly with the write.
        if not write_payload(_response_codec.encode(frame)):
            return False
    return True


# Reassembles `tywrap-frame/1` REQUEST frames (W5) back into a single logical
# request line. Created only when chunking is negotiated; None means no request
# framing is expected and every line is a normal single-line request. Restricted
# to the 'request' stream. No reassembly-bytes cap here: the request size is
# already bounded by the TS codec's maxPayloadBytes on the sending side, and
# TYWRAP_REQUEST_MAX_BYTES is enforced on the complete payload after reassembly
# (process_request_line), preserving the W5 post-reassembly semantics.
_request_reassembler = (
    Reassembler(expected_stream='request') if CHUNKING_ENABLED else None
)


def _try_parse_frame_line(line):
    """
    Return a frame dict if ``line`` is a ``tywrap-frame/1`` envelope, else None.

    Why: a request frame is a JSON object carrying ``__tywrap_frame__``. We only
    treat a line as a frame when chunking was negotiated AND it parses as such an
    object; anything else (including invalid JSON) falls through to the normal
    single-line request path, which reports the JSON error exactly as before.
    Structural validity (protocol, seq/total ranges, etc.) is enforced by the
    Reassembler, not here.
    """
    try:
        parsed = json.loads(line)
    except json.JSONDecodeError:
        return None
    if isinstance(parsed, dict) and '__tywrap_frame__' in parsed:
        return parsed
    return None


def process_request_line(line):
    """
    Process one complete logical request line and write its response.

    ``line`` is the full logical JSON request: either a single line read from
    stdin, or the payload reassembled from ``tywrap-frame/1`` request frames.
    TYWRAP_REQUEST_MAX_BYTES is enforced on this complete payload (so for a
    chunked request the limit applies to the REASSEMBLED size, not per frame).

    Returns True to keep the loop running, or False if the parent's stdin / our
    stdout closed mid-write (BrokenPipe), so main() can exit cleanly.
    """
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
            has_envelope_markers = '__tywrap' in line or '__type__' in line
            mid, result = dispatch_request(msg, has_envelope_markers=has_envelope_markers)
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
        payload, payload_utf8 = encode_response(out)
        # Correlate frames by the response id when chunking; out always
        # carries the request id (or None for a malformed-request envelope).
        response_id = out.get('id') if isinstance(out, dict) else None
        if not write_response(payload, payload_utf8, response_id):
            return False
    except Exception as e:  # noqa: BLE001
        # Why: fallback error keeps responses well-formed even if serialization fails.
        err_out = build_error_payload(mid, e, include_traceback=False)
        try:
            # Error envelopes are tiny; write as a single line regardless of
            # chunking so a serialization failure never recurses into framing.
            if not write_payload(json.dumps(err_out)):
                return False
        except Exception:
            return False
    return True


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        # W5: when chunking is negotiated, a line may be a `tywrap-frame/1`
        # REQUEST frame. Reassemble per id; only the completed logical request is
        # handed to process_request_line (which then enforces the request-size
        # guard on the reassembled payload). Non-frame lines are normal requests.
        if _request_reassembler is not None:
            frame = _try_parse_frame_line(line)
            if frame is not None:
                try:
                    reassembled = _request_reassembler.accept(frame)
                except FrameError as exc:
                    # A framing-protocol violation desyncs the request stream and
                    # there is no correlatable response to write (the id may be
                    # malformed). Fail LOUD on stderr and stop the loop so the
                    # transport restarts the bridge rather than silently
                    # mis-parsing subsequent frames.
                    emit_protocol_diagnostic(f'Request frame error: {exc}')
                    return
                if reassembled is None:
                    # More frames needed for this id; await the rest.
                    continue
                if not process_request_line(reassembled):
                    return
                continue

        if not process_request_line(line):
            return


if __name__ == '__main__':
    main()
