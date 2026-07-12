/**
 * Frame codec + reassembler unit tests (`tywrap-frame/1`).
 *
 * Pure fragment/reassemble functions from src/runtime/frame-codec.ts — no
 * transport wiring. Covers round-trip (1 frame / many frames / multibyte +
 * emoji), the codepoint-boundary slicing invariant, and every framing-error
 * path the spec enumerates: malformed frame, duplicate seq, seq gap,
 * totalBytes mismatch, wrong frameProtocol, unknown encoding, plus the
 * timed-out-id-then-late-frame discard case.
 *
 * The CROSS-LANGUAGE PARITY block documents the exact wire frames a Python
 * decoder must accept (mirror: test/python/test_frame_codec.py).
 *
 * @see docs/transport-framing.md
 */

import { describe, it, expect } from 'vitest';

import {
  encodeFrames,
  parseChunkFrame,
  Reassembler,
  utf8ByteLength,
  type EncodeFramesOptions,
} from '../src/runtime/frame-codec.js';
import { FRAME_PROTOCOL_ID, type ChunkFrame } from '../src/runtime/transport.js';
import { BridgeProtocolError } from '../src/runtime/errors.js';

// =============================================================================
// HELPERS
// =============================================================================

const RESPONSE_OPTS = (maxFrameBytes: number, id = 1): EncodeFramesOptions => ({
  id,
  stream: 'response',
  maxFrameBytes,
});

/** Round-trip a logical string through encode -> reassemble at a frame ceiling. */
function roundTrip(logical: string, maxFrameBytes: number, id = 1): string | null {
  const frames = encodeFrames(logical, RESPONSE_OPTS(maxFrameBytes, id));
  const reassembler = new Reassembler();
  let out: string | null = null;
  for (const frame of frames) {
    out = reassembler.accept(frame);
  }
  return out;
}

/** A structurally valid frame, mutable for negative-path tests. */
function validFrame(overrides: Partial<ChunkFrame> = {}): ChunkFrame {
  return {
    __tywrap_frame__: 'chunk',
    frameProtocol: FRAME_PROTOCOL_ID,
    stream: 'response',
    id: 7,
    seq: 0,
    total: 1,
    totalBytes: utf8ByteLength('hi'),
    encoding: 'utf8-slice',
    data: 'hi',
    ...overrides,
  };
}

// =============================================================================
// UTF-8 BYTE LENGTH
// =============================================================================

describe('utf8ByteLength', () => {
  it('counts ASCII as one byte each', () => {
    expect(utf8ByteLength('hello')).toBe(5);
  });

  it('counts multibyte codepoints by their UTF-8 width', () => {
    expect(utf8ByteLength('é')).toBe(2); // é
    expect(utf8ByteLength('中')).toBe(3); // 中
    expect(utf8ByteLength('\u{1f600}')).toBe(4); // 😀
  });

  it('matches Buffer/TextEncoder byte length for mixed content', () => {
    const s = 'aé中\u{1f600}z';
    expect(utf8ByteLength(s)).toBe(new TextEncoder().encode(s).length);
  });
});

// =============================================================================
// ROUND-TRIP
// =============================================================================

describe('encodeFrames + Reassembler round-trip', () => {
  it('round-trips a payload that fits in a single frame', () => {
    const logical = JSON.stringify({ id: 1, result: [1, 2, 3] });
    const frames = encodeFrames(logical, RESPONSE_OPTS(1024));
    expect(frames).toHaveLength(1);
    expect(frames[0]?.total).toBe(1);
    expect(frames[0]?.seq).toBe(0);
    expect(roundTrip(logical, 1024)).toBe(logical);
  });

  it('round-trips a payload across many frames', () => {
    const logical = JSON.stringify({ id: 1, result: 'x'.repeat(5000) });
    const frames = encodeFrames(logical, RESPONSE_OPTS(256));
    expect(frames.length).toBeGreaterThan(1);
    expect(frames.every(f => utf8ByteLength(f.data) <= 256)).toBe(true);
    // total + totalBytes are repeated identically on every frame.
    expect(new Set(frames.map(f => f.total))).toEqual(new Set([frames.length]));
    expect(new Set(frames.map(f => f.totalBytes))).toEqual(new Set([utf8ByteLength(logical)]));
    expect(roundTrip(logical, 256)).toBe(logical);
  });

  it('emits exactly one empty frame for an empty payload', () => {
    const frames = encodeFrames('', RESPONSE_OPTS(64));
    expect(frames).toHaveLength(1);
    expect(frames[0]?.data).toBe('');
    expect(frames[0]?.totalBytes).toBe(0);
    expect(roundTrip('', 64)).toBe('');
  });

  it('round-trips multibyte + emoji exactly, never splitting a codepoint', () => {
    // Mix 1/2/3/4-byte codepoints; a tiny ceiling forces many splits.
    const logical = '中文é\u{1f600}\u{1f389}日本語ABC\u{1f9d1}‍\u{1f680}';
    const frames = encodeFrames(logical, RESPONSE_OPTS(5));
    expect(frames.length).toBeGreaterThan(1);
    for (const f of frames) {
      // No frame exceeds the byte ceiling...
      expect(utf8ByteLength(f.data)).toBeLessThanOrEqual(5);
      // ...and every frame's data is itself valid UTF-16 / decodes cleanly
      // (no lone surrogate from a split astral codepoint).
      expect(() =>
        new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(f.data))
      ).not.toThrow();
    }
    expect(roundTrip(logical, 5)).toBe(logical);
  });

  it('keeps a 4-byte emoji whole even at the minimum frame ceiling (4)', () => {
    const logical = '\u{1f600}\u{1f601}\u{1f602}';
    const frames = encodeFrames(logical, RESPONSE_OPTS(4));
    expect(frames).toHaveLength(3);
    expect(frames.map(f => f.data)).toEqual(['\u{1f600}', '\u{1f601}', '\u{1f602}']);
    expect(roundTrip(logical, 4)).toBe(logical);
  });

  it('handles a large multi-frame payload (smoke)', () => {
    const logical = JSON.stringify({
      rows: Array.from({ length: 2000 }, (_, i) => ({ i, v: '中'.repeat(3) })),
    });
    expect(roundTrip(logical, 1000)).toBe(logical);
  });

  it('accepts frames out of order and still reassembles', () => {
    const logical = 'abcdefghij';
    const frames = encodeFrames(logical, RESPONSE_OPTS(4));
    const reassembler = new Reassembler();
    let out: string | null = null;
    for (const f of [...frames].reverse()) {
      out = reassembler.accept(f);
    }
    expect(out).toBe(logical);
  });

  it('reassembles simultaneously interleaved stream ids without mixing their payloads', () => {
    const first = 'first stream payload with enough content to chunk';
    const second = 'second stream payload with enough content to chunk';
    const firstFrames = encodeFrames(first, RESPONSE_OPTS(8, 101));
    const secondFrames = encodeFrames(second, RESPONSE_OPTS(8, 202));
    const reassembler = new Reassembler();
    const completed = new Map<number, string>();

    for (let index = 0; index < Math.max(firstFrames.length, secondFrames.length); index += 1) {
      for (const frame of [firstFrames[index], secondFrames[index]]) {
        if (!frame) continue;
        const payload = reassembler.accept(frame);
        if (payload !== null) completed.set(frame.id, payload);
      }
    }

    expect(completed).toEqual(
      new Map([
        [101, first],
        [202, second],
      ])
    );
  });
});

// =============================================================================
// encodeFrames — INPUT VALIDATION
// =============================================================================

describe('encodeFrames input validation', () => {
  it('rejects a non-integer maxFrameBytes', () => {
    expect(() => encodeFrames('x', RESPONSE_OPTS(3.5))).toThrow(BridgeProtocolError);
  });

  it('rejects maxFrameBytes below the 4-byte single-codepoint floor', () => {
    expect(() => encodeFrames('x', RESPONSE_OPTS(3))).toThrow(/maxFrameBytes/);
  });

  it('stamps stream and id onto every frame', () => {
    const frames = encodeFrames('abcdef', { id: 99, stream: 'request', maxFrameBytes: 4 });
    expect(frames.every(f => f.id === 99 && f.stream === 'request')).toBe(true);
  });
});

// =============================================================================
// parseChunkFrame — MALFORMED / WRONG PROTOCOL / WRONG ENCODING
// =============================================================================

describe('parseChunkFrame rejects malformed frames', () => {
  it('rejects a non-object', () => {
    expect(() => parseChunkFrame(null)).toThrow(BridgeProtocolError);
    expect(() => parseChunkFrame('frame')).toThrow(BridgeProtocolError);
  });

  it('rejects a non-chunk discriminator', () => {
    expect(() => parseChunkFrame(validFrame({ __tywrap_frame__: 'error' }))).toThrow(/chunk/);
  });

  it('rejects an unknown frameProtocol', () => {
    expect(() => parseChunkFrame(validFrame({ frameProtocol: 'tywrap-frame/2' }))).toThrow(
      /unknown frameProtocol/
    );
  });

  it('rejects an unsupported encoding (utf8-base64 not emitted in 0.8.0)', () => {
    expect(() => parseChunkFrame(validFrame({ encoding: 'utf8-base64' }))).toThrow(
      /unsupported encoding/
    );
  });

  it('rejects a bad stream', () => {
    expect(() =>
      parseChunkFrame(validFrame({ stream: 'sideways' as unknown as ChunkFrame['stream'] }))
    ).toThrow(/stream/);
  });

  it('rejects a non-integer id / seq / total / totalBytes', () => {
    expect(() => parseChunkFrame(validFrame({ id: 1.5 }))).toThrow(/id/);
    expect(() => parseChunkFrame(validFrame({ seq: -1 }))).toThrow(/seq/);
    expect(() => parseChunkFrame(validFrame({ total: 0 }))).toThrow(/total/);
    expect(() => parseChunkFrame(validFrame({ totalBytes: -1 }))).toThrow(/totalBytes/);
  });

  it('rejects non-string data', () => {
    expect(() => parseChunkFrame(validFrame({ data: 123 as unknown as string }))).toThrow(/data/);
  });

  it('rejects seq >= total', () => {
    expect(() => parseChunkFrame(validFrame({ seq: 2, total: 2 }))).toThrow(/out of range/);
  });
});

// =============================================================================
// Reassembler — FRAMING ERRORS
// =============================================================================

describe('Reassembler framing errors', () => {
  it('rejects a duplicate seq', () => {
    const r = new Reassembler();
    const [a] = encodeFrames('abcdefgh', RESPONSE_OPTS(4)); // total 2
    expect(a).toBeDefined();
    r.accept(a as ChunkFrame);
    expect(() => r.accept(a as ChunkFrame)).toThrow(/duplicate seq/);
  });

  it('rejects a totalBytes mismatch across frames of one id', () => {
    const r = new Reassembler();
    const frames = encodeFrames('abcdefgh', RESPONSE_OPTS(4)); // 2 frames
    r.accept(frames[0] as ChunkFrame);
    const tampered: ChunkFrame = { ...(frames[1] as ChunkFrame), totalBytes: 999 };
    expect(() => r.accept(tampered)).toThrow(/totalBytes mismatch/);
  });

  it('rejects a total mismatch across frames of one id', () => {
    const r = new Reassembler();
    const frames = encodeFrames('abcdefgh', RESPONSE_OPTS(4)); // 2 frames
    r.accept(frames[0] as ChunkFrame);
    const tampered: ChunkFrame = { ...(frames[1] as ChunkFrame), total: 5 };
    expect(() => r.accept(tampered)).toThrow(/total mismatch/);
  });

  it('detects a totalBytes lie even on a single complete frame', () => {
    const r = new Reassembler();
    const frame = validFrame({ totalBytes: 999, data: 'hi', total: 1, seq: 0 });
    expect(() => r.accept(frame)).toThrow(/byte length .* != declared totalBytes/);
  });

  it('rejects an unknown frameProtocol mid-stream', () => {
    const r = new Reassembler();
    expect(() => r.accept(validFrame({ frameProtocol: 'bogus/1' }))).toThrow(
      /unknown frameProtocol/
    );
  });

  it('does NOT complete (returns null) when a seq is missing', () => {
    // Build a 3-frame stream but deliver only seq 0 and seq 2: the stream never
    // reaches `total` frames, so accept() returns null and never reassembles a
    // gapped payload. (A duplicate would be needed to hit `total` frames, and
    // that is rejected separately.)
    const r = new Reassembler();
    const frames = encodeFrames('abcdefghij', RESPONSE_OPTS(4)); // 3 frames
    expect(frames).toHaveLength(3);
    expect(r.accept(frames[0] as ChunkFrame)).toBeNull();
    expect(r.accept(frames[2] as ChunkFrame)).toBeNull();
    expect(r.isPending((frames[0] as ChunkFrame).id)).toBe(true);
  });

  it('drops in-flight state when a frame in the id is rejected', () => {
    const r = new Reassembler();
    const frames = encodeFrames('abcdefgh', RESPONSE_OPTS(4));
    const id = (frames[0] as ChunkFrame).id;
    r.accept(frames[0] as ChunkFrame);
    expect(r.isPending(id)).toBe(true);
    expect(() => r.accept({ ...(frames[1] as ChunkFrame), total: 9 })).toThrow();
    expect(r.isPending(id)).toBe(false);
  });
});

// =============================================================================
// Reassembler — TIMED-OUT ID, LATE FRAME DISCARD
// =============================================================================

describe('Reassembler timed-out id + late-frame discard', () => {
  it('discards every late frame for a timed-out id and never crashes', () => {
    const r = new Reassembler();
    const id = 42;
    const frames = encodeFrames('x'.repeat(40), RESPONSE_OPTS(8, id)); // several frames
    expect(frames.length).toBeGreaterThan(2);

    // First frame arrives, then the request times out before the rest.
    expect(r.accept(frames[0] as ChunkFrame)).toBeNull();
    r.discard(id);
    expect(r.isPending(id)).toBe(false);

    // Late frames trickle in: every one is silently dropped, no throw, no
    // reassembled payload returned.
    for (let i = 1; i < frames.length; i += 1) {
      expect(r.accept(frames[i] as ChunkFrame)).toBeNull();
    }

    // After the final (total-1) frame the id is forgotten and the slot is reusable.
    const reuse = encodeFrames('fresh', RESPONSE_OPTS(64, id));
    expect(r.accept(reuse[0] as ChunkFrame)).toBe('fresh');
  });

  it('discard before any frame still drops the whole late stream', () => {
    const r = new Reassembler();
    const id = 5;
    const frames = encodeFrames('abcdefghijkl', RESPONSE_OPTS(4, id)); // 3 frames
    r.discard(id);
    for (const f of frames) {
      expect(r.accept(f as ChunkFrame)).toBeNull();
    }
    // id forgotten after the final frame -> fresh stream completes.
    const fresh = encodeFrames('ok', RESPONSE_OPTS(64, id));
    expect(r.accept(fresh[0] as ChunkFrame)).toBe('ok');
  });

  it('discard is idempotent (double discard tracks a single late stream)', () => {
    // Two discards of the same id collapse to one discard marker: the next
    // final-looking frame for that id is dropped once and clears the marker
    // (the marker is NOT a counter), so a subsequent stream completes normally.
    const r = new Reassembler();
    r.discard(1);
    r.discard(1);
    // One stray final-frame-shaped frame is dropped and clears the marker.
    const stray = encodeFrames('stray', RESPONSE_OPTS(64, 1));
    expect(r.accept(stray[0] as ChunkFrame)).toBeNull();
    // The marker is now clear; a fresh stream for the same id reassembles.
    const fresh = encodeFrames('ok', RESPONSE_OPTS(64, 1));
    expect(r.accept(fresh[0] as ChunkFrame)).toBe('ok');
  });

  it('interleaves two ids independently', () => {
    const r = new Reassembler();
    const a = encodeFrames('aaaaaaaa', RESPONSE_OPTS(4, 1)); // 2 frames
    const b = encodeFrames('bbbbbbbb', RESPONSE_OPTS(4, 2)); // 2 frames
    expect(r.accept(a[0] as ChunkFrame)).toBeNull();
    expect(r.accept(b[0] as ChunkFrame)).toBeNull();
    expect(r.pendingCount).toBe(2);
    expect(r.accept(b[1] as ChunkFrame)).toBe('bbbbbbbb');
    expect(r.accept(a[1] as ChunkFrame)).toBe('aaaaaaaa');
    expect(r.pendingCount).toBe(0);
  });
});

// =============================================================================
// CROSS-LANGUAGE PARITY
// =============================================================================
//
// These vectors are the exact wire frames a Python decoder MUST accept and a
// Python encoder MUST emit. test/python/test_frame_codec.py asserts the same
// frames (same field order is irrelevant — JSON objects are unordered — but the
// `data` slices and totals MUST match byte-for-byte).

describe('cross-language parity vectors', () => {
  it('ASCII split at 4 bytes -> 3 frames with exact data slices', () => {
    const logical = 'helloworld!!'; // 12 ASCII bytes
    const frames = encodeFrames(logical, { id: 1, stream: 'response', maxFrameBytes: 4 });
    expect(frames.map(f => f.data)).toEqual(['hell', 'owor', 'ld!!']);
    expect(frames.map(f => f.seq)).toEqual([0, 1, 2]);
    expect(frames[0]?.total).toBe(3);
    expect(frames[0]?.totalBytes).toBe(12);
  });

  it('multibyte split snaps to codepoint boundaries (中 is 3 bytes)', () => {
    // '中中中' = 9 UTF-8 bytes; at a 4-byte ceiling each 3-byte char gets its
    // own frame (a second char would be 6 bytes > 4).
    const logical = '中中中';
    const frames = encodeFrames(logical, { id: 2, stream: 'response', maxFrameBytes: 4 });
    expect(frames.map(f => f.data)).toEqual(['中', '中', '中']);
    expect(frames[0]?.totalBytes).toBe(9);
    expect(frames[0]?.total).toBe(3);
  });

  it('the documented spec example frame parses and the encoding is utf8-slice', () => {
    const frame: ChunkFrame = {
      __tywrap_frame__: 'chunk',
      frameProtocol: FRAME_PROTOCOL_ID,
      stream: 'response',
      id: 42,
      seq: 0,
      total: 1,
      totalBytes: utf8ByteLength('{"id":42,"result":null}'),
      encoding: 'utf8-slice',
      data: '{"id":42,"result":null}',
    };
    const r = new Reassembler();
    expect(r.accept(frame)).toBe('{"id":42,"result":null}');
  });

  it('a frame produced by encodeFrames serializes to the spec wire shape', () => {
    const [frame] = encodeFrames('{"x":1}', { id: 3, stream: 'request', maxFrameBytes: 1024 });
    expect(frame).toBeDefined();
    const wire = JSON.parse(JSON.stringify(frame)) as Record<string, unknown>;
    expect(wire).toEqual({
      __tywrap_frame__: 'chunk',
      frameProtocol: 'tywrap-frame/1',
      stream: 'request',
      id: 3,
      seq: 0,
      total: 1,
      totalBytes: 7,
      encoding: 'utf8-slice',
      data: '{"x":1}',
    });
  });
});

// =============================================================================
// REASSEMBLER RESOURCE BOUNDS (codex adversarial review fix)
// =============================================================================

describe('Reassembler resource bounds', () => {
  it('caps concurrent reassembly streams and fails loud past the limit', () => {
    const r = new Reassembler();
    // 1024 distinct ids, each an incomplete (total:2) stream -> all held pending.
    for (let id = 0; id < 1024; id += 1) {
      expect(r.accept(validFrame({ id, seq: 0, total: 2, data: 'x', totalBytes: 2 }))).toBeNull();
    }
    expect(r.pendingCount).toBe(1024);
    expect(() =>
      r.accept(validFrame({ id: 999_999, seq: 0, total: 2, data: 'x', totalBytes: 2 }))
    ).toThrow(/too many concurrent reassembly streams/);
  });

  it('FIFO-bounds the discard set under repeated timeouts', () => {
    const r = new Reassembler();
    for (let id = 0; id < 5000; id += 1) {
      r.discard(id);
    }
    expect(r.discardedCount).toBe(4096);
  });
});

// =============================================================================
// REASSEMBLER PAYLOAD + STREAM BOUNDS (codex round-2 review fix)
// =============================================================================

describe('Reassembler payload + stream bounds', () => {
  it('rejects a stream whose DECLARED totalBytes exceeds maxReassemblyBytes (fail loud, early)', () => {
    const r = new Reassembler({ maxReassemblyBytes: 100 });
    expect(() =>
      r.accept(validFrame({ id: 1, seq: 0, total: 1, data: 'x', totalBytes: 101 }))
    ).toThrow(/exceeds max reassembly/);
    // Refused before buffering.
    expect(r.pendingCount).toBe(0);
  });

  it('rejects when ACCUMULATED bytes exceed maxReassemblyBytes mid-stream', () => {
    const r = new Reassembler({ maxReassemblyBytes: 10 });
    // Declares totalBytes:8 (under cap) but overshoots across frames.
    expect(
      r.accept(validFrame({ id: 2, seq: 0, total: 3, data: 'aaaaaa', totalBytes: 8 }))
    ).toBeNull();
    expect(() =>
      r.accept(validFrame({ id: 2, seq: 1, total: 3, data: 'bbbbbb', totalBytes: 8 }))
    ).toThrow(/accumulated payload exceeds max reassembly/);
  });

  it('enforces the expected stream direction', () => {
    const ok = new Reassembler({ expectedStream: 'response' });
    expect(
      ok.accept(
        validFrame({ id: 3, seq: 0, total: 1, data: 'hi', totalBytes: 2, stream: 'response' })
      )
    ).toBe('hi');

    const wrong = new Reassembler({ expectedStream: 'response' });
    expect(() =>
      wrong.accept(
        validFrame({ id: 4, seq: 0, total: 1, data: 'hi', totalBytes: 2, stream: 'request' })
      )
    ).toThrow(/unexpected stream/);
  });
});
