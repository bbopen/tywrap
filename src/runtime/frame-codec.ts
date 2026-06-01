/**
 * Pure frame codec + reassembler for the `tywrap-frame/1` framing protocol.
 *
 * This module is the transport-agnostic core of large-payload chunking: it
 * fragments one complete logical JSON message into {@link ChunkFrame}s and
 * reassembles a stream of frames back into the original string. It performs NO
 * I/O and knows nothing about subprocesses, stdin/stdout, or timeouts — the
 * transport layer (W4/W5) wires these functions into the read/write loop.
 *
 * Encoding is `utf8-slice` (plan decision #6, docs/transport-framing.md): the
 * logical payload is already valid-UTF-8 JSON, so each frame's `data` is a raw
 * substring split on a UTF-8 codepoint boundary at or before `maxFrameBytes`
 * UTF-8 bytes. Reassembly is plain concatenation — no base64, no ~33% inflation,
 * no extra decode pass. A frame's `data` MUST NOT split a multi-byte UTF-8
 * sequence; {@link encodeFrames} guarantees this by snapping every boundary back
 * to the nearest codepoint boundary.
 *
 * The mirror implementation lives in `runtime/frame_codec.py`; the two MUST
 * agree byte-for-byte on the wire (see test/frame-codec.test.ts and
 * test/python/test_frame_codec.py for the cross-language parity vectors).
 *
 * @see docs/transport-framing.md
 */

import { BridgeProtocolError } from './errors.js';
import {
  FRAME_PROTOCOL_ID,
  type ChunkFrame,
  type ChunkFrameEncoding,
} from './transport.js';

// =============================================================================
// OPTIONS
// =============================================================================

/** Which logical stream a set of frames belongs to. */
export type FrameStream = ChunkFrame['stream'];

/** Options for {@link encodeFrames}. */
export interface EncodeFramesOptions {
  /** RPC correlation id, shared with the logical {@link ProtocolMessage.id}. */
  readonly id: number;

  /** Which logical stream these frames belong to (`request` or `response`). */
  readonly stream: FrameStream;

  /**
   * Maximum UTF-8 byte length of a single frame's `data` field. Each frame's
   * `data` is guaranteed to be at most this many UTF-8 bytes, snapped back to a
   * codepoint boundary so no multi-byte sequence is split. Must be a positive
   * integer large enough to hold at least one codepoint (>= 4 bytes).
   */
  readonly maxFrameBytes: number;
}

// =============================================================================
// UTF-8 HELPERS (pure, codepoint-boundary aware)
// =============================================================================

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

/** UTF-8 byte length of a single Unicode codepoint. */
function utf8ByteLengthOfCodePoint(codePoint: number): number {
  if (codePoint <= 0x7f) {
    return 1;
  }
  if (codePoint <= 0x7ff) {
    return 2;
  }
  if (codePoint <= 0xffff) {
    return 3;
  }
  return 4;
}

/** Exact UTF-8 byte length of a JS string (no allocation of the encoded bytes). */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const ch of value) {
    bytes += utf8ByteLengthOfCodePoint(ch.codePointAt(0) ?? 0);
  }
  return bytes;
}

// =============================================================================
// ENCODE
// =============================================================================

/**
 * Fragment a complete logical JSON message into `tywrap-frame/1` frames.
 *
 * Splits `logicalJson` on UTF-8 codepoint boundaries so each frame's `data` is
 * at most `maxFrameBytes` UTF-8 bytes and never splits a multi-byte sequence.
 * `totalBytes` is the exact UTF-8 byte length of the full message; `total` is
 * the resulting frame count; `seq` is zero-based and dense.
 *
 * An empty `logicalJson` still produces exactly one (empty) frame so the
 * receiver always sees `total >= 1` and a well-formed stream.
 *
 * @throws BridgeProtocolError if `maxFrameBytes` is not a positive integer of at
 *   least 4 bytes (the worst-case single-codepoint size).
 */
export function encodeFrames(logicalJson: string, opts: EncodeFramesOptions): ChunkFrame[] {
  const { id, stream, maxFrameBytes } = opts;

  if (!Number.isInteger(maxFrameBytes) || maxFrameBytes < 4) {
    throw new BridgeProtocolError(
      `encodeFrames: maxFrameBytes must be an integer >= 4 (got ${String(maxFrameBytes)})`,
      { code: 'FRAME_BAD_MAX_BYTES' }
    );
  }
  // Validate the protocol fields locally too (parseChunkFrame enforces them on
  // the decode side, but catching misuse at the encoder fails fast and keeps the
  // two sides symmetric with the Python encoder).
  if (stream !== 'request' && stream !== 'response') {
    throw new BridgeProtocolError(
      `encodeFrames: stream must be 'request' or 'response' (got ${String(stream)})`,
      { code: 'FRAME_BAD_STREAM' }
    );
  }
  if (!Number.isInteger(id)) {
    throw new BridgeProtocolError(`encodeFrames: id must be an integer (got ${String(id)})`, {
      code: 'FRAME_BAD_ID',
    });
  }

  const totalBytes = utf8ByteLength(logicalJson);
  const encoding: ChunkFrameEncoding = 'utf8-slice';

  // Walk codepoints, accumulating UTF-8 bytes into the current slice until the
  // next codepoint would exceed maxFrameBytes; that boundary is, by
  // construction, a codepoint boundary so no multi-byte sequence is split.
  const slices: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const ch of logicalJson) {
    const chBytes = utf8ByteLengthOfCodePoint(ch.codePointAt(0) ?? 0);
    if (currentBytes + chBytes > maxFrameBytes && current.length > 0) {
      slices.push(current);
      current = '';
      currentBytes = 0;
    }
    current += ch;
    currentBytes += chBytes;
  }
  // Always emit a final slice (covers the empty-string case: one empty frame).
  slices.push(current);

  const total = slices.length;
  return slices.map((data, seq) => ({
    __tywrap_frame__: 'chunk',
    frameProtocol: FRAME_PROTOCOL_ID,
    stream,
    id,
    seq,
    total,
    totalBytes,
    encoding,
    data,
  }));
}

// =============================================================================
// REASSEMBLE
// =============================================================================

/** Per-id accumulation state inside the {@link Reassembler}. */
interface StreamState {
  total: number;
  totalBytes: number;
  /** Running UTF-8 byte count of slices received so far (memory bound). */
  bytesSoFar: number;
  /** seq -> frame data slice. */
  readonly slices: Map<number, string>;
}

/**
 * Validates that a raw value is a structurally well-formed `tywrap-frame/1` data
 * frame. Returns the frame typed, or throws a {@link BridgeProtocolError}.
 *
 * Only `__tywrap_frame__: 'chunk'` frames flow through reassembly; `'error'`
 * frames are a transport-layer concern handled above this module.
 */
export function parseChunkFrame(value: unknown): ChunkFrame {
  if (value === null || typeof value !== 'object') {
    throw new BridgeProtocolError('frame: expected an object', {
      code: 'FRAME_MALFORMED',
    });
  }
  const f = value as Record<string, unknown>;

  if (f.__tywrap_frame__ !== 'chunk') {
    throw new BridgeProtocolError(
      `frame: __tywrap_frame__ must be "chunk" (got ${JSON.stringify(f.__tywrap_frame__)})`,
      { code: 'FRAME_MALFORMED' }
    );
  }
  if (f.frameProtocol !== FRAME_PROTOCOL_ID) {
    throw new BridgeProtocolError(
      `frame: unknown frameProtocol ${JSON.stringify(f.frameProtocol)} (expected ${FRAME_PROTOCOL_ID})`,
      { code: 'FRAME_UNKNOWN_PROTOCOL' }
    );
  }
  if (f.stream !== 'request' && f.stream !== 'response') {
    throw new BridgeProtocolError(
      `frame: stream must be "request" or "response" (got ${JSON.stringify(f.stream)})`,
      { code: 'FRAME_MALFORMED' }
    );
  }
  if (f.encoding !== 'utf8-slice') {
    // utf8-base64 is reserved in the schema but never emitted/accepted in 0.8.0.
    throw new BridgeProtocolError(
      `frame: unsupported encoding ${JSON.stringify(f.encoding)} (only "utf8-slice" in 0.8.0)`,
      { code: 'FRAME_MALFORMED' }
    );
  }
  if (!Number.isInteger(f.id)) {
    throw new BridgeProtocolError(`frame: id must be an integer (got ${JSON.stringify(f.id)})`, {
      code: 'FRAME_MALFORMED',
    });
  }
  if (!Number.isInteger(f.seq) || (f.seq as number) < 0) {
    throw new BridgeProtocolError(
      `frame: seq must be a non-negative integer (got ${JSON.stringify(f.seq)})`,
      { code: 'FRAME_MALFORMED' }
    );
  }
  if (!Number.isInteger(f.total) || (f.total as number) < 1) {
    throw new BridgeProtocolError(
      `frame: total must be an integer >= 1 (got ${JSON.stringify(f.total)})`,
      { code: 'FRAME_MALFORMED' }
    );
  }
  if (!Number.isInteger(f.totalBytes) || (f.totalBytes as number) < 0) {
    throw new BridgeProtocolError(
      `frame: totalBytes must be a non-negative integer (got ${JSON.stringify(f.totalBytes)})`,
      { code: 'FRAME_MALFORMED' }
    );
  }
  if (typeof f.data !== 'string') {
    throw new BridgeProtocolError(`frame: data must be a string (got ${typeof f.data})`, {
      code: 'FRAME_MALFORMED',
    });
  }
  if ((f.seq as number) >= (f.total as number)) {
    throw new BridgeProtocolError(
      `frame: seq ${String(f.seq)} out of range for total ${String(f.total)}`,
      { code: 'FRAME_MALFORMED' }
    );
  }
  return f as unknown as ChunkFrame;
}

/**
 * Accumulates `tywrap-frame/1` frames by `id` and reconstructs the logical JSON
 * string once a stream is complete.
 *
 * A single instance handles many concurrent ids (each correlated by
 * {@link ChunkFrame.id}). Validation is enforced on every {@link accept} so a
 * malformed/duplicate/inconsistent frame fails fast rather than corrupting an
 * in-flight reassembly:
 *
 * - matching {@link FRAME_PROTOCOL_ID} on every frame;
 * - consistent `total` / `totalBytes` across all frames of an id;
 * - no duplicate `seq`;
 * - on completion, exactly `total` frames covering `[0, total)`;
 * - the concatenated payload's UTF-8 byte length equals `totalBytes` exactly;
 * - the concatenated payload decodes as strict UTF-8.
 *
 * Timed-out ids: the transport marks an id timed out via {@link discard}. Every
 * subsequent frame for that id is dropped (returning `null`) until its final
 * frame arrives, at which point the id is forgotten so the slot can be reused.
 * This prevents late multi-frame responses from desyncing the stream.
 */
/**
 * Defensive bounds on per-id reassembly state. The peer is the local Python
 * bridge, but a buggy or corrupt bridge must not grow memory without limit:
 * cap how many distinct ids may be mid-reassembly at once (fail loud past the
 * cap), and FIFO-bound the timed-out-id discard set so a long-lived process
 * that times out many chunked requests whose final frames never arrive (e.g.
 * the bridge died mid-stream) does not leak markers forever.
 */
const MAX_CONCURRENT_STREAMS = 1024;
const MAX_DISCARDED_IDS = 4096;

export class Reassembler {
  private readonly streams = new Map<number, StreamState>();
  private readonly discarded = new Set<number>();
  private readonly maxReassemblyBytes: number;
  private readonly expectedStream: FrameStream | undefined;

  /**
   * @param options.maxReassemblyBytes Reject (fail loud) any stream whose
   *   declared OR accumulated payload exceeds this many UTF-8 bytes, so a huge
   *   response cannot be buffered into memory before a higher layer's size cap
   *   would reject it anyway. Default: no limit (`Infinity`).
   * @param options.expectedStream If set, every frame must carry this `stream`
   *   direction; a frame for the other direction is rejected. The response and
   *   request reassemblers are distinct instances, so this is defense-in-depth.
   */
  constructor(options: { maxReassemblyBytes?: number; expectedStream?: FrameStream } = {}) {
    this.maxReassemblyBytes = options.maxReassemblyBytes ?? Number.POSITIVE_INFINITY;
    this.expectedStream = options.expectedStream;
  }

  /**
   * Feed one frame. Returns the fully reassembled logical string when this
   * frame completes the stream for its id, `null` if more frames are still
   * needed (or the frame was dropped because its id is timed out).
   *
   * @throws BridgeProtocolError on any framing violation (malformed frame,
   *   wrong stream direction, declared/accumulated payload over the cap,
   *   duplicate `seq`, inconsistent `total`/`totalBytes`, byte-count mismatch,
   *   invalid UTF-8, or unknown `frameProtocol`).
   */
  accept(rawFrame: unknown): string | null {
    const frame = parseChunkFrame(rawFrame);
    const { id, seq, total, totalBytes, data, stream } = frame;

    if (this.expectedStream !== undefined && stream !== this.expectedStream) {
      throw new BridgeProtocolError(
        `frame: unexpected stream '${stream}' for id ${id} (this reassembler handles '${this.expectedStream}')`,
        { code: 'FRAME_WRONG_STREAM' }
      );
    }

    // Late-frame discard: drop frames for a timed-out id; forget the id once its
    // declared final frame has been seen so the stream stays aligned and the id
    // can be reused.
    if (this.discarded.has(id)) {
      if (seq === total - 1) {
        this.discarded.delete(id);
      }
      return null;
    }

    let state = this.streams.get(id);
    if (state === undefined) {
      if (this.streams.size >= MAX_CONCURRENT_STREAMS) {
        throw new BridgeProtocolError(
          `frame: too many concurrent reassembly streams (>= ${MAX_CONCURRENT_STREAMS}); refusing to buffer id ${id}`,
          { code: 'FRAME_TOO_MANY_STREAMS' }
        );
      }
      // Reject early: a declared payload past the cap can never be accepted by
      // the higher-layer size guard, so refuse to buffer it instead of OOMing.
      if (totalBytes > this.maxReassemblyBytes) {
        throw new BridgeProtocolError(
          `frame: declared payload ${totalBytes} bytes exceeds max reassembly ${this.maxReassemblyBytes} bytes for id ${id}`,
          { code: 'FRAME_PAYLOAD_TOO_LARGE' }
        );
      }
      state = { total, totalBytes, bytesSoFar: 0, slices: new Map<number, string>() };
      this.streams.set(id, state);
    } else {
      if (state.total !== total) {
        this.streams.delete(id);
        throw new BridgeProtocolError(
          `frame: total mismatch for id ${id} (saw ${state.total}, frame says ${total})`,
          { code: 'FRAME_INCONSISTENT' }
        );
      }
      if (state.totalBytes !== totalBytes) {
        this.streams.delete(id);
        throw new BridgeProtocolError(
          `frame: totalBytes mismatch for id ${id} (saw ${state.totalBytes}, frame says ${totalBytes})`,
          { code: 'FRAME_INCONSISTENT' }
        );
      }
    }

    if (state.slices.has(seq)) {
      this.streams.delete(id);
      throw new BridgeProtocolError(`frame: duplicate seq ${seq} for id ${id}`, {
        code: 'FRAME_DUPLICATE_SEQ',
      });
    }
    state.slices.set(seq, data);

    // Running memory bound: a peer that under-declares totalBytes then overshoots
    // is caught here (and the exact-count check at completion catches the rest)
    // before the full payload is buffered.
    state.bytesSoFar += utf8ByteLength(data);
    if (state.bytesSoFar > this.maxReassemblyBytes) {
      this.streams.delete(id);
      throw new BridgeProtocolError(
        `frame: accumulated payload exceeds max reassembly ${this.maxReassemblyBytes} bytes for id ${id}`,
        { code: 'FRAME_PAYLOAD_TOO_LARGE' }
      );
    }

    if (state.slices.size < total) {
      return null;
    }

    // All `total` frames present; the dense [0, total) range is guaranteed
    // because each seq is in range, unique, and there are exactly `total` of
    // them. Concatenate in seq order.
    this.streams.delete(id);
    let payload = '';
    for (let i = 0; i < total; i += 1) {
      const slice = state.slices.get(i);
      if (slice === undefined) {
        // Unreachable given the count + uniqueness + range invariants above,
        // but kept explicit rather than a silent gap.
        throw new BridgeProtocolError(`frame: missing seq ${i} for id ${id}`, {
          code: 'FRAME_SEQ_GAP',
        });
      }
      payload += slice;
    }

    const actualBytes = utf8ByteLength(payload);
    if (actualBytes !== totalBytes) {
      throw new BridgeProtocolError(
        `frame: reassembled byte length ${actualBytes} != declared totalBytes ${totalBytes} for id ${id}`,
        { code: 'FRAME_BYTES_MISMATCH' }
      );
    }

    // Strict UTF-8 validation: re-encode then decode in fatal mode. With
    // utf8-slice the concatenation cannot introduce invalid sequences (each
    // slice is whole codepoints), but the spec requires the check explicitly.
    try {
      utf8Decoder.decode(utf8Encoder.encode(payload));
    } catch (cause) {
      throw new BridgeProtocolError(`frame: reassembled payload is not valid UTF-8 for id ${id}`, {
        code: 'FRAME_INVALID_UTF8',
        cause,
      });
    }

    return payload;
  }

  /**
   * Mark an id as timed out / aborted. Any partial state is dropped immediately
   * and every subsequent frame for this id is discarded until its declared
   * final frame arrives. Idempotent.
   */
  discard(id: number): void {
    this.streams.delete(id);
    this.discarded.add(id);
    // Bound the discard set (FIFO): a timed-out id whose declared final frame
    // never arrives would otherwise linger forever. Set iteration order is
    // insertion order, so the first key is the oldest marker.
    if (this.discarded.size > MAX_DISCARDED_IDS) {
      const oldest = this.discarded.values().next().value;
      if (oldest !== undefined) {
        this.discarded.delete(oldest);
      }
    }
  }

  /** Whether any frame for `id` is still being accumulated (not yet complete). */
  isPending(id: number): boolean {
    return this.streams.has(id);
  }

  /** Number of ids currently mid-reassembly (for diagnostics/tests). */
  get pendingCount(): number {
    return this.streams.size;
  }

  /**
   * Number of timed-out ids whose late frames are still being dropped
   * (FIFO-bounded by `MAX_DISCARDED_IDS`; for diagnostics/tests).
   */
  get discardedCount(): number {
    return this.discarded.size;
  }
}
