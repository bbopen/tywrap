"""
Pure frame codec + reassembler for the ``tywrap-frame/1`` framing protocol.

This is the Python mirror of ``src/runtime/frame-codec.ts``. It fragments one
complete logical JSON message into chunk frames and reassembles a stream of
frames back into the original string. It performs NO I/O and reads NO env vars
(PURITY, matching ``tywrap_bridge_core``): the read/write loop in
``python_bridge.py`` (W4/W5) wires these functions onto stdin/stdout.

Encoding is ``utf8-slice`` (plan decision #6, docs/transport-framing.md): the
logical payload is already valid-UTF-8 JSON, so each frame's ``data`` is a raw
substring split on a UTF-8 codepoint boundary at or before ``max_frame_bytes``
UTF-8 bytes. Reassembly is plain concatenation -- no base64, no ~33% inflation.
A frame's ``data`` MUST NOT split a multi-byte UTF-8 sequence; ``encode_frames``
guarantees this by snapping every boundary back to the nearest codepoint
boundary.

The two implementations MUST agree byte-for-byte on the wire (see
test/python/test_frame_codec.py and test/frame-codec.test.ts for the
cross-language parity vectors).
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

# Framing protocol identifier; mirrors FRAME_PROTOCOL_ID in
# src/runtime/transport.ts. Any other value on the wire is rejected.
FRAME_PROTOCOL_ID = 'tywrap-frame/1'

# Numeric framing-protocol version, derived from the trailing number so the two
# cannot drift (same pattern as PROTOCOL_VERSION in tywrap_bridge_core).
FRAME_PROTOCOL_VERSION = int(FRAME_PROTOCOL_ID.split('/')[1])

# The single per-frame encoding tywrap emits/accepts in 0.8.0.
FRAME_ENCODING = 'utf8-slice'


class FrameError(Exception):
    """A framing-protocol violation (malformed/duplicate/inconsistent frame).

    Carries a stable ``code`` mirroring the BridgeProtocolError codes on the TS
    side so callers can branch on the failure class.
    """

    def __init__(self, message: str, *, code: str) -> None:
        super().__init__(message)
        self.code = code


def _utf8_bytes_of_codepoint(code_point: int) -> int:
    """UTF-8 byte length of a single Unicode codepoint."""
    if code_point <= 0x7F:
        return 1
    if code_point <= 0x7FF:
        return 2
    if code_point <= 0xFFFF:
        return 3
    return 4


def utf8_byte_length(value: str) -> int:
    """Exact UTF-8 byte length of a string."""
    return len(value.encode('utf-8'))


def encode_frames(
    logical_json: str,
    *,
    id: int,
    stream: str,
    max_frame_bytes: int,
) -> List[Dict[str, Any]]:
    """Fragment a complete logical JSON message into ``tywrap-frame/1`` frames.

    Splits ``logical_json`` on UTF-8 codepoint boundaries so each frame's
    ``data`` is at most ``max_frame_bytes`` UTF-8 bytes and never splits a
    multi-byte sequence. ``totalBytes`` is the exact UTF-8 byte length of the
    full message; ``total`` is the resulting frame count; ``seq`` is zero-based
    and dense.

    An empty ``logical_json`` still produces exactly one (empty) frame so the
    receiver always sees ``total >= 1`` and a well-formed stream.

    :raises FrameError: if ``max_frame_bytes`` is not an int >= 4, or ``stream``
        is not ``"request"``/``"response"``.
    """
    if not isinstance(max_frame_bytes, int) or isinstance(max_frame_bytes, bool) or max_frame_bytes < 4:
        raise FrameError(
            f'encode_frames: max_frame_bytes must be an int >= 4 (got {max_frame_bytes!r})',
            code='FRAME_BAD_MAX_BYTES',
        )
    if stream not in ('request', 'response'):
        raise FrameError(
            f'encode_frames: stream must be "request" or "response" (got {stream!r})',
            code='FRAME_MALFORMED',
        )

    total_bytes = utf8_byte_length(logical_json)

    # Walk codepoints, accumulating UTF-8 bytes into the current slice until the
    # next codepoint would exceed max_frame_bytes; that boundary is, by
    # construction, a codepoint boundary so no multi-byte sequence is split.
    slices: List[str] = []
    current_chars: List[str] = []
    current_bytes = 0
    for ch in logical_json:
        ch_bytes = _utf8_bytes_of_codepoint(ord(ch))
        if current_bytes + ch_bytes > max_frame_bytes and current_chars:
            slices.append(''.join(current_chars))
            current_chars = []
            current_bytes = 0
        current_chars.append(ch)
        current_bytes += ch_bytes
    # Always emit a final slice (covers the empty-string case: one empty frame).
    slices.append(''.join(current_chars))

    total = len(slices)
    return [
        {
            '__tywrap_frame__': 'chunk',
            'frameProtocol': FRAME_PROTOCOL_ID,
            'stream': stream,
            'id': id,
            'seq': seq,
            'total': total,
            'totalBytes': total_bytes,
            'encoding': FRAME_ENCODING,
            'data': data,
        }
        for seq, data in enumerate(slices)
    ]


def parse_chunk_frame(value: Any) -> Dict[str, Any]:
    """Validate that ``value`` is a structurally well-formed data frame.

    Returns the frame dict, or raises :class:`FrameError`. Only
    ``__tywrap_frame__ == "chunk"`` frames flow through reassembly; ``"error"``
    frames are a transport-layer concern handled above this module.
    """
    if not isinstance(value, dict):
        raise FrameError('frame: expected an object', code='FRAME_MALFORMED')

    if value.get('__tywrap_frame__') != 'chunk':
        raise FrameError(
            f'frame: __tywrap_frame__ must be "chunk" (got {value.get("__tywrap_frame__")!r})',
            code='FRAME_MALFORMED',
        )
    if value.get('frameProtocol') != FRAME_PROTOCOL_ID:
        raise FrameError(
            f'frame: unknown frameProtocol {value.get("frameProtocol")!r} '
            f'(expected {FRAME_PROTOCOL_ID})',
            code='FRAME_UNKNOWN_PROTOCOL',
        )
    if value.get('stream') not in ('request', 'response'):
        raise FrameError(
            f'frame: stream must be "request" or "response" (got {value.get("stream")!r})',
            code='FRAME_MALFORMED',
        )
    if value.get('encoding') != FRAME_ENCODING:
        # utf8-base64 is reserved in the schema but never emitted/accepted here.
        raise FrameError(
            f'frame: unsupported encoding {value.get("encoding")!r} '
            f'(only "utf8-slice" in 0.8.0)',
            code='FRAME_MALFORMED',
        )

    frame_id = value.get('id')
    if not _is_int(frame_id):
        raise FrameError(f'frame: id must be an integer (got {frame_id!r})', code='FRAME_MALFORMED')

    seq = value.get('seq')
    if not _is_int(seq) or seq < 0:
        raise FrameError(
            f'frame: seq must be a non-negative integer (got {seq!r})',
            code='FRAME_MALFORMED',
        )

    total = value.get('total')
    if not _is_int(total) or total < 1:
        raise FrameError(
            f'frame: total must be an integer >= 1 (got {total!r})',
            code='FRAME_MALFORMED',
        )

    total_bytes = value.get('totalBytes')
    if not _is_int(total_bytes) or total_bytes < 0:
        raise FrameError(
            f'frame: totalBytes must be a non-negative integer (got {total_bytes!r})',
            code='FRAME_MALFORMED',
        )

    data = value.get('data')
    if not isinstance(data, str):
        raise FrameError(
            f'frame: data must be a string (got {type(data).__name__})',
            code='FRAME_MALFORMED',
        )

    if seq >= total:
        raise FrameError(
            f'frame: seq {seq} out of range for total {total}',
            code='FRAME_MALFORMED',
        )

    return value


def _is_int(value: Any) -> bool:
    """True for a real integer (rejecting bool, which is an int subclass)."""
    return isinstance(value, int) and not isinstance(value, bool)


class Reassembler:
    """Accumulate ``tywrap-frame/1`` frames by ``id`` and reconstruct the string.

    Mirror of the TypeScript ``Reassembler`` class. A single instance handles
    many concurrent ids. Validation is enforced on every :meth:`accept`:

    - matching ``FRAME_PROTOCOL_ID`` on every frame;
    - consistent ``total`` / ``totalBytes`` across all frames of an id;
    - no duplicate ``seq``;
    - on completion, exactly ``total`` frames covering ``[0, total)``;
    - the concatenated payload's UTF-8 byte length equals ``totalBytes`` exactly;
    - the concatenated payload is valid UTF-8.

    Timed-out ids: the transport marks an id timed out via :meth:`discard`.
    Every subsequent frame for that id is dropped (returning ``None``) until its
    final frame arrives, at which point the id is forgotten so the slot can be
    reused. This prevents late multi-frame responses from desyncing the stream.
    """

    def __init__(self) -> None:
        # id -> {'total', 'totalBytes', 'slices': {seq: data}}
        self._streams: Dict[int, Dict[str, Any]] = {}
        self._discarded: set[int] = set()

    def accept(self, raw_frame: Any) -> Optional[str]:
        """Feed one frame.

        Returns the fully reassembled logical string when this frame completes
        the stream for its id, ``None`` if more frames are still needed (or the
        frame was dropped because its id is timed out).

        :raises FrameError: on any framing violation.
        """
        frame = parse_chunk_frame(raw_frame)
        frame_id = frame['id']
        seq = frame['seq']
        total = frame['total']
        total_bytes = frame['totalBytes']
        data = frame['data']

        # Late-frame discard: drop frames for a timed-out id; forget the id once
        # its declared final frame has been seen so the stream stays aligned and
        # the id can be reused.
        if frame_id in self._discarded:
            if seq == total - 1:
                self._discarded.discard(frame_id)
            return None

        state = self._streams.get(frame_id)
        if state is None:
            state = {'total': total, 'totalBytes': total_bytes, 'slices': {}}
            self._streams[frame_id] = state
        else:
            if state['total'] != total:
                del self._streams[frame_id]
                raise FrameError(
                    f'frame: total mismatch for id {frame_id} '
                    f'(saw {state["total"]}, frame says {total})',
                    code='FRAME_INCONSISTENT',
                )
            if state['totalBytes'] != total_bytes:
                del self._streams[frame_id]
                raise FrameError(
                    f'frame: totalBytes mismatch for id {frame_id} '
                    f'(saw {state["totalBytes"]}, frame says {total_bytes})',
                    code='FRAME_INCONSISTENT',
                )

        slices: Dict[int, str] = state['slices']
        if seq in slices:
            del self._streams[frame_id]
            raise FrameError(
                f'frame: duplicate seq {seq} for id {frame_id}',
                code='FRAME_DUPLICATE_SEQ',
            )
        slices[seq] = data

        if len(slices) < total:
            return None

        # All `total` frames present; the dense [0, total) range is guaranteed
        # because each seq is in range, unique, and there are exactly `total` of
        # them. Concatenate in seq order.
        del self._streams[frame_id]
        parts: List[str] = []
        for i in range(total):
            if i not in slices:
                # Unreachable given the count + uniqueness + range invariants,
                # but kept explicit rather than a silent gap.
                raise FrameError(
                    f'frame: missing seq {i} for id {frame_id}',
                    code='FRAME_SEQ_GAP',
                )
            parts.append(slices[i])
        payload = ''.join(parts)

        actual_bytes = utf8_byte_length(payload)
        if actual_bytes != total_bytes:
            raise FrameError(
                f'frame: reassembled byte length {actual_bytes} != declared '
                f'totalBytes {total_bytes} for id {frame_id}',
                code='FRAME_BYTES_MISMATCH',
            )

        # Strict UTF-8 validation. With utf8-slice the concatenation cannot
        # introduce invalid sequences (each slice is whole codepoints), but the
        # spec requires the check explicitly.
        try:
            payload.encode('utf-8').decode('utf-8')
        except UnicodeError as exc:  # pragma: no cover - defensive
            raise FrameError(
                f'frame: reassembled payload is not valid UTF-8 for id {frame_id}',
                code='FRAME_INVALID_UTF8',
            ) from exc

        return payload

    def discard(self, frame_id: int) -> None:
        """Mark an id as timed out / aborted.

        Drops any partial state immediately and discards every subsequent frame
        for this id until its declared final frame arrives. Idempotent.
        """
        self._streams.pop(frame_id, None)
        self._discarded.add(frame_id)

    def is_pending(self, frame_id: int) -> bool:
        """Whether any frame for ``frame_id`` is still being accumulated."""
        return frame_id in self._streams

    @property
    def pending_count(self) -> int:
        """Number of ids currently mid-reassembly (for diagnostics/tests)."""
        return len(self._streams)
