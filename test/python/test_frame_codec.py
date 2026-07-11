"""
Frame codec + reassembler unit tests (``tywrap-frame/1``), Python side.

Mirror of test/frame-codec.test.ts for runtime/frame_codec.py. Pure
fragment/reassemble functions — no transport wiring. Covers round-trip (1 frame
/ many frames / multibyte + emoji), the codepoint-boundary slicing invariant,
and every framing-error path the spec enumerates: malformed frame, duplicate
seq, seq gap, totalBytes mismatch, wrong frameProtocol, unknown encoding, plus
the timed-out-id-then-late-frame discard case.

The CROSS-LANGUAGE PARITY block asserts the exact wire frames the TypeScript
decoder also accepts/emits (see test/frame-codec.test.ts).

Run with: pytest test/python/test_frame_codec.py -v
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

# Add runtime to path for import (matches test/python/test_bridge_codec.py).
sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'runtime'))

from frame_codec import (  # noqa: E402
    FRAME_PROTOCOL_ID,
    FRAME_PROTOCOL_VERSION,
    FrameError,
    Reassembler,
    encode_frames,
    parse_chunk_frame,
    utf8_byte_length,
)


# ═══════════════════════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════════════════════


def round_trip(logical: str, max_frame_bytes: int, frame_id: int = 1) -> str | None:
    """Round-trip a logical string through encode -> reassemble."""
    frames = encode_frames(
        logical, id=frame_id, stream='response', max_frame_bytes=max_frame_bytes
    )
    reassembler = Reassembler()
    out: str | None = None
    for frame in frames:
        out = reassembler.accept(frame)
    return out


def valid_frame(**overrides: object) -> dict:
    """A structurally valid frame, mutable for negative-path tests."""
    frame = {
        '__tywrap_frame__': 'chunk',
        'frameProtocol': FRAME_PROTOCOL_ID,
        'stream': 'response',
        'id': 7,
        'seq': 0,
        'total': 1,
        'totalBytes': utf8_byte_length('hi'),
        'encoding': 'utf8-slice',
        'data': 'hi',
    }
    frame.update(overrides)
    return frame


# ═══════════════════════════════════════════════════════════════════════════
# CONSTANTS
# ═══════════════════════════════════════════════════════════════════════════


class TestConstants:
    def test_frame_protocol_id(self) -> None:
        assert FRAME_PROTOCOL_ID == 'tywrap-frame/1'

    def test_frame_protocol_version_derived(self) -> None:
        assert FRAME_PROTOCOL_VERSION == 1
        assert FRAME_PROTOCOL_VERSION == int(FRAME_PROTOCOL_ID.split('/')[1])


# ═══════════════════════════════════════════════════════════════════════════
# UTF-8 BYTE LENGTH
# ═══════════════════════════════════════════════════════════════════════════


class TestUtf8ByteLength:
    def test_ascii(self) -> None:
        assert utf8_byte_length('hello') == 5

    def test_multibyte(self) -> None:
        assert utf8_byte_length('é') == 2  # é
        assert utf8_byte_length('中') == 3  # 中
        assert utf8_byte_length('\U0001f600') == 4  # 😀

    def test_mixed(self) -> None:
        s = 'aé中\U0001f600z'
        assert utf8_byte_length(s) == len(s.encode('utf-8'))


# ═══════════════════════════════════════════════════════════════════════════
# ROUND-TRIP
# ═══════════════════════════════════════════════════════════════════════════


class TestRoundTrip:
    def test_uses_precomputed_total_bytes(self) -> None:
        logical = 'hello\U0001f600'
        frames = encode_frames(
            logical,
            id=1,
            stream='response',
            max_frame_bytes=64,
            total_bytes=len(logical.encode('utf-8')),
        )

        assert frames[0]['totalBytes'] == len(logical.encode('utf-8'))

    def test_single_frame(self) -> None:
        logical = json.dumps({'id': 1, 'result': [1, 2, 3]})
        frames = encode_frames(logical, id=1, stream='response', max_frame_bytes=1024)
        assert len(frames) == 1
        assert frames[0]['total'] == 1
        assert frames[0]['seq'] == 0
        assert round_trip(logical, 1024) == logical

    def test_many_frames(self) -> None:
        logical = json.dumps({'id': 1, 'result': 'x' * 5000})
        frames = encode_frames(logical, id=1, stream='response', max_frame_bytes=256)
        assert len(frames) > 1
        assert all(utf8_byte_length(f['data']) <= 256 for f in frames)
        # total + totalBytes are repeated identically on every frame.
        assert {f['total'] for f in frames} == {len(frames)}
        assert {f['totalBytes'] for f in frames} == {utf8_byte_length(logical)}
        assert round_trip(logical, 256) == logical

    def test_empty_payload_one_empty_frame(self) -> None:
        frames = encode_frames('', id=1, stream='response', max_frame_bytes=64)
        assert len(frames) == 1
        assert frames[0]['data'] == ''
        assert frames[0]['totalBytes'] == 0
        assert round_trip('', 64) == ''

    def test_multibyte_emoji_never_splits_codepoint(self) -> None:
        logical = '中文é\U0001f600\U0001f389日本語ABC'
        frames = encode_frames(logical, id=1, stream='response', max_frame_bytes=5)
        assert len(frames) > 1
        for f in frames:
            assert utf8_byte_length(f['data']) <= 5
            # Each frame's data is valid UTF-8 on its own (no split sequence).
            f['data'].encode('utf-8').decode('utf-8')
        assert round_trip(logical, 5) == logical

    def test_4byte_emoji_whole_at_min_ceiling(self) -> None:
        logical = '\U0001f600\U0001f601\U0001f602'
        frames = encode_frames(logical, id=1, stream='response', max_frame_bytes=4)
        assert len(frames) == 3
        assert [f['data'] for f in frames] == ['\U0001f600', '\U0001f601', '\U0001f602']
        assert round_trip(logical, 4) == logical

    def test_out_of_order_reassembly(self) -> None:
        logical = 'abcdefghij'
        frames = encode_frames(logical, id=1, stream='response', max_frame_bytes=4)
        reassembler = Reassembler()
        out: str | None = None
        for f in reversed(frames):
            out = reassembler.accept(f)
        assert out == logical


# ═══════════════════════════════════════════════════════════════════════════
# encode_frames — INPUT VALIDATION
# ═══════════════════════════════════════════════════════════════════════════


class TestEncodeValidation:
    def test_rejects_non_int_max(self) -> None:
        with pytest.raises(FrameError):
            encode_frames('x', id=1, stream='response', max_frame_bytes=3.5)  # type: ignore[arg-type]

    def test_rejects_max_below_floor(self) -> None:
        with pytest.raises(FrameError) as exc:
            encode_frames('x', id=1, stream='response', max_frame_bytes=3)
        assert 'max_frame_bytes' in str(exc.value)

    def test_rejects_bool_max(self) -> None:
        # bool is an int subclass; True == 1 would otherwise sneak past >= 4.
        with pytest.raises(FrameError):
            encode_frames('x', id=1, stream='response', max_frame_bytes=True)  # type: ignore[arg-type]

    def test_rejects_bad_stream(self) -> None:
        with pytest.raises(FrameError):
            encode_frames('x', id=1, stream='sideways', max_frame_bytes=64)

    def test_stamps_id_and_stream(self) -> None:
        frames = encode_frames('abcdef', id=99, stream='request', max_frame_bytes=4)
        assert all(f['id'] == 99 and f['stream'] == 'request' for f in frames)


# ═══════════════════════════════════════════════════════════════════════════
# parse_chunk_frame — MALFORMED / WRONG PROTOCOL / WRONG ENCODING
# ═══════════════════════════════════════════════════════════════════════════


class TestParseMalformed:
    def test_non_object(self) -> None:
        with pytest.raises(FrameError):
            parse_chunk_frame(None)
        with pytest.raises(FrameError):
            parse_chunk_frame('frame')

    def test_non_chunk_discriminator(self) -> None:
        with pytest.raises(FrameError) as exc:
            parse_chunk_frame(valid_frame(__tywrap_frame__='error'))
        assert 'chunk' in str(exc.value)

    def test_unknown_protocol(self) -> None:
        with pytest.raises(FrameError) as exc:
            parse_chunk_frame(valid_frame(frameProtocol='tywrap-frame/2'))
        assert exc.value.code == 'FRAME_UNKNOWN_PROTOCOL'

    def test_unsupported_encoding(self) -> None:
        with pytest.raises(FrameError) as exc:
            parse_chunk_frame(valid_frame(encoding='utf8-base64'))
        assert 'unsupported encoding' in str(exc.value)

    def test_bad_stream(self) -> None:
        with pytest.raises(FrameError):
            parse_chunk_frame(valid_frame(stream='sideways'))

    def test_non_int_fields(self) -> None:
        with pytest.raises(FrameError):
            parse_chunk_frame(valid_frame(id=1.5))
        with pytest.raises(FrameError):
            parse_chunk_frame(valid_frame(seq=-1))
        with pytest.raises(FrameError):
            parse_chunk_frame(valid_frame(total=0))
        with pytest.raises(FrameError):
            parse_chunk_frame(valid_frame(totalBytes=-1))

    def test_bool_id_rejected(self) -> None:
        # bool is an int subclass; the validator must reject it explicitly.
        with pytest.raises(FrameError):
            parse_chunk_frame(valid_frame(id=True))

    def test_non_string_data(self) -> None:
        with pytest.raises(FrameError):
            parse_chunk_frame(valid_frame(data=123))

    def test_seq_ge_total(self) -> None:
        with pytest.raises(FrameError) as exc:
            parse_chunk_frame(valid_frame(seq=2, total=2))
        assert 'out of range' in str(exc.value)


# ═══════════════════════════════════════════════════════════════════════════
# Reassembler — FRAMING ERRORS
# ═══════════════════════════════════════════════════════════════════════════


class TestReassemblerErrors:
    def test_duplicate_seq(self) -> None:
        r = Reassembler()
        frames = encode_frames('abcdefgh', id=1, stream='response', max_frame_bytes=4)
        r.accept(frames[0])
        with pytest.raises(FrameError) as exc:
            r.accept(frames[0])
        assert exc.value.code == 'FRAME_DUPLICATE_SEQ'

    def test_total_bytes_mismatch(self) -> None:
        r = Reassembler()
        frames = encode_frames('abcdefgh', id=1, stream='response', max_frame_bytes=4)
        r.accept(frames[0])
        tampered = dict(frames[1])
        tampered['totalBytes'] = 999
        with pytest.raises(FrameError) as exc:
            r.accept(tampered)
        assert exc.value.code == 'FRAME_INCONSISTENT'

    def test_total_mismatch(self) -> None:
        r = Reassembler()
        frames = encode_frames('abcdefgh', id=1, stream='response', max_frame_bytes=4)
        r.accept(frames[0])
        tampered = dict(frames[1])
        tampered['total'] = 5
        with pytest.raises(FrameError) as exc:
            r.accept(tampered)
        assert exc.value.code == 'FRAME_INCONSISTENT'

    def test_total_bytes_lie_on_single_frame(self) -> None:
        r = Reassembler()
        frame = valid_frame(totalBytes=999, data='hi', total=1, seq=0)
        with pytest.raises(FrameError) as exc:
            r.accept(frame)
        assert exc.value.code == 'FRAME_BYTES_MISMATCH'

    def test_unknown_protocol_mid_stream(self) -> None:
        r = Reassembler()
        with pytest.raises(FrameError) as exc:
            r.accept(valid_frame(frameProtocol='bogus/1'))
        assert exc.value.code == 'FRAME_UNKNOWN_PROTOCOL'

    def test_seq_gap_never_completes(self) -> None:
        # 3-frame stream, deliver only seq 0 and seq 2: never reaches `total`
        # frames, so accept() returns None and never reassembles a gapped payload.
        r = Reassembler()
        frames = encode_frames('abcdefghij', id=1, stream='response', max_frame_bytes=4)
        assert len(frames) == 3
        assert r.accept(frames[0]) is None
        assert r.accept(frames[2]) is None
        assert r.is_pending(frames[0]['id']) is True

    def test_rejected_frame_drops_state(self) -> None:
        r = Reassembler()
        frames = encode_frames('abcdefgh', id=1, stream='response', max_frame_bytes=4)
        frame_id = frames[0]['id']
        r.accept(frames[0])
        assert r.is_pending(frame_id) is True
        tampered = dict(frames[1])
        tampered['total'] = 9
        with pytest.raises(FrameError):
            r.accept(tampered)
        assert r.is_pending(frame_id) is False


# ═══════════════════════════════════════════════════════════════════════════
# Reassembler — TIMED-OUT ID, LATE FRAME DISCARD
# ═══════════════════════════════════════════════════════════════════════════


class TestLateFrameDiscard:
    def test_discards_late_frames_no_crash(self) -> None:
        r = Reassembler()
        frame_id = 42
        frames = encode_frames('x' * 40, id=frame_id, stream='response', max_frame_bytes=8)
        assert len(frames) > 2

        # First frame arrives, then the request times out before the rest.
        assert r.accept(frames[0]) is None
        r.discard(frame_id)
        assert r.is_pending(frame_id) is False

        # Late frames trickle in: every one is silently dropped.
        for f in frames[1:]:
            assert r.accept(f) is None

        # After the final frame the id is forgotten -> the slot is reusable.
        reuse = encode_frames('fresh', id=frame_id, stream='response', max_frame_bytes=64)
        assert r.accept(reuse[0]) == 'fresh'

    def test_discard_before_any_frame(self) -> None:
        r = Reassembler()
        frame_id = 5
        frames = encode_frames('abcdefghijkl', id=frame_id, stream='response', max_frame_bytes=4)
        r.discard(frame_id)
        for f in frames:
            assert r.accept(f) is None
        fresh = encode_frames('ok', id=frame_id, stream='response', max_frame_bytes=64)
        assert r.accept(fresh[0]) == 'ok'

    def test_discard_idempotent(self) -> None:
        # Two discards of the same id collapse to one discard marker: the next
        # final-looking frame for that id is dropped once and clears the marker
        # (the marker is not a counter), so a subsequent stream completes.
        r = Reassembler()
        r.discard(1)
        r.discard(1)
        # One stray final-frame-shaped frame is dropped and clears the marker.
        stray = encode_frames('stray', id=1, stream='response', max_frame_bytes=64)
        assert r.accept(stray[0]) is None
        # The marker is now clear; a fresh stream for the same id reassembles.
        fresh = encode_frames('ok', id=1, stream='response', max_frame_bytes=64)
        assert r.accept(fresh[0]) == 'ok'

    def test_interleaved_ids_independent(self) -> None:
        r = Reassembler()
        a = encode_frames('aaaaaaaa', id=1, stream='response', max_frame_bytes=4)
        b = encode_frames('bbbbbbbb', id=2, stream='response', max_frame_bytes=4)
        assert r.accept(a[0]) is None
        assert r.accept(b[0]) is None
        assert r.pending_count == 2
        assert r.accept(b[1]) == 'bbbbbbbb'
        assert r.accept(a[1]) == 'aaaaaaaa'
        assert r.pending_count == 0


# ═══════════════════════════════════════════════════════════════════════════
# CROSS-LANGUAGE PARITY
# ═══════════════════════════════════════════════════════════════════════════
#
# These vectors are the exact wire frames the TypeScript codec also emits and
# accepts (see test/frame-codec.test.ts). The `data` slices and totals MUST
# match byte-for-byte across languages.


class TestCrossLanguageParity:
    def test_ascii_split_at_4_bytes(self) -> None:
        logical = 'helloworld!!'  # 12 ASCII bytes
        frames = encode_frames(logical, id=1, stream='response', max_frame_bytes=4)
        assert [f['data'] for f in frames] == ['hell', 'owor', 'ld!!']
        assert [f['seq'] for f in frames] == [0, 1, 2]
        assert frames[0]['total'] == 3
        assert frames[0]['totalBytes'] == 12

    def test_multibyte_split_snaps_to_codepoint(self) -> None:
        # '中中中' = 9 UTF-8 bytes; at a 4-byte ceiling each 3-byte char gets its
        # own frame (a second char would be 6 bytes > 4).
        logical = '中中中'
        frames = encode_frames(logical, id=2, stream='response', max_frame_bytes=4)
        assert [f['data'] for f in frames] == ['中', '中', '中']
        assert frames[0]['totalBytes'] == 9
        assert frames[0]['total'] == 3

    def test_documented_spec_example_frame(self) -> None:
        data = '{"id":42,"result":null}'
        frame = {
            '__tywrap_frame__': 'chunk',
            'frameProtocol': FRAME_PROTOCOL_ID,
            'stream': 'response',
            'id': 42,
            'seq': 0,
            'total': 1,
            'totalBytes': utf8_byte_length(data),
            'encoding': 'utf8-slice',
            'data': data,
        }
        r = Reassembler()
        assert r.accept(frame) == data

    def test_encode_produces_spec_wire_shape(self) -> None:
        frames = encode_frames('{"x":1}', id=3, stream='request', max_frame_bytes=1024)
        assert frames[0] == {
            '__tywrap_frame__': 'chunk',
            'frameProtocol': 'tywrap-frame/1',
            'stream': 'request',
            'id': 3,
            'seq': 0,
            'total': 1,
            'totalBytes': 7,
            'encoding': 'utf8-slice',
            'data': '{"x":1}',
        }

    def test_frame_json_roundtrips_through_jsonl(self) -> None:
        # A frame must survive json.dumps -> json.loads (the JSONL wire) and
        # then reassemble — proving the dict is JSON-clean.
        frames = encode_frames(
            '中文data', id=9, stream='response', max_frame_bytes=4
        )
        r = Reassembler()
        out: str | None = None
        for f in frames:
            wire = json.loads(json.dumps(f))
            out = r.accept(wire)
        assert out == '中文data'


# ═══════════════════════════════════════════════════════════════════════════
# REASSEMBLER RESOURCE BOUNDS (codex adversarial review fix)
# ═══════════════════════════════════════════════════════════════════════════


class TestReassemblerResourceBounds:
    """Resource bounds — mirror of src/runtime/frame-codec.ts."""

    def test_caps_concurrent_streams(self) -> None:
        r = Reassembler()
        # 1024 distinct ids, each an incomplete (total=2) stream -> held pending.
        for frame_id in range(1024):
            assert (
                r.accept(valid_frame(id=frame_id, seq=0, total=2, data='x', totalBytes=2))
                is None
            )
        assert r.pending_count == 1024
        with pytest.raises(FrameError) as exc:
            r.accept(valid_frame(id=999999, seq=0, total=2, data='x', totalBytes=2))
        assert exc.value.code == 'FRAME_TOO_MANY_STREAMS'

    def test_fifo_bounds_discard_set(self) -> None:
        r = Reassembler()
        for frame_id in range(5000):
            r.discard(frame_id)
        assert r.discarded_count == 4096


# ═══════════════════════════════════════════════════════════════════════════
# REASSEMBLER PAYLOAD + STREAM BOUNDS (mirror of the TS suite)
# ═══════════════════════════════════════════════════════════════════════════


class TestReassemblerPayloadAndStreamBounds:
    """Exercise max_reassembly_bytes + expected_stream — mirror of
    src/runtime/frame-codec.ts 'Reassembler payload + stream bounds'."""

    def test_rejects_declared_total_bytes_over_cap(self) -> None:
        r = Reassembler(max_reassembly_bytes=100)
        with pytest.raises(FrameError) as exc:
            r.accept(valid_frame(id=1, seq=0, total=1, data='x', totalBytes=101))
        assert exc.value.code == 'FRAME_PAYLOAD_TOO_LARGE'
        # Refused before buffering.
        assert r.pending_count == 0

    def test_rejects_accumulated_bytes_over_cap(self) -> None:
        r = Reassembler(max_reassembly_bytes=10)
        # Declares totalBytes=8 (under cap) but overshoots across frames.
        assert (
            r.accept(valid_frame(id=2, seq=0, total=3, data='aaaaaa', totalBytes=8)) is None
        )
        with pytest.raises(FrameError) as exc:
            r.accept(valid_frame(id=2, seq=1, total=3, data='bbbbbb', totalBytes=8))
        assert exc.value.code == 'FRAME_PAYLOAD_TOO_LARGE'

    def test_enforces_expected_stream(self) -> None:
        ok = Reassembler(expected_stream='response')
        assert (
            ok.accept(
                valid_frame(id=3, seq=0, total=1, data='hi', totalBytes=2, stream='response')
            )
            == 'hi'
        )
        wrong = Reassembler(expected_stream='response')
        with pytest.raises(FrameError) as exc:
            wrong.accept(
                valid_frame(id=4, seq=0, total=1, data='hi', totalBytes=2, stream='request')
            )
        assert exc.value.code == 'FRAME_WRONG_STREAM'
