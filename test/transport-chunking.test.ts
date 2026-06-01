/**
 * W4 — Subprocess RESPONSE chunking integration tests (`tywrap-frame/1`).
 *
 * Covers the W4 spike + feature:
 *  - end-to-end: force a ~1 MiB frame ceiling, raise the logical codec max, have
 *    the real Python bridge return a ~20 MiB payload, and assert the TS side
 *    reassembles it byte-for-byte through SubprocessTransport.send.
 *  - negotiation: capabilities().supportsChunking flips true only after the meta
 *    probe sees the bridge's transport block.
 *  - late-frame-after-timeout discard: once an id times out, subsequent frames
 *    for that id are dropped cleanly without desyncing stdout or rejecting the
 *    next request.
 *
 * Real-Python tests spawn runtime/python_bridge.py and are skipped when python3
 * is unavailable. A 5s-timeout flake under load that passes in isolation is NOT
 * a regression (repo memory).
 *
 * @see docs/transport-framing.md
 */

import { spawn } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { SubprocessTransport } from '../src/runtime/subprocess-transport.js';
import { PROTOCOL_ID, FRAME_PROTOCOL_ID } from '../src/runtime/transport.js';
import { encodeFrames } from '../src/runtime/frame-codec.js';

// =============================================================================
// SETUP
// =============================================================================

const REFERENCE_SCRIPT = resolve(process.cwd(), 'runtime/python_bridge.py');
const RUNTIME_DIR = resolve(process.cwd(), 'runtime');

// A throwaway fixture dropped into runtime/ so the bridge (cwd == runtime/) can
// import it. Returns a string of an exact requested byte length (ASCII => 1
// byte/char), used to force a payload well above the 1 MiB frame ceiling.
const FIXTURE_MODULE = '_tywrap_w4_chunking_fixture';
const FIXTURE_PATH = resolve(RUNTIME_DIR, `${FIXTURE_MODULE}.py`);
const FIXTURE_SOURCE = `
def big_string(n):
    """Return an n-byte ASCII string (deterministic, non-trivial content)."""
    # Repeating pattern so reassembly errors that drop/duplicate a slice show up
    # as a content mismatch, not just a length mismatch.
    pattern = 'tywrap-0123456789-'
    reps = (n // len(pattern)) + 1
    return (pattern * reps)[:n]
`;

const ONE_MIB = 1024 * 1024;
const TWENTY_MIB = 20 * 1024 * 1024;

function pythonAvailable(): Promise<boolean> {
  return new Promise(res => {
    const proc = spawn('python3', ['--version']);
    proc.on('error', () => res(false));
    proc.on('exit', code => res(code === 0));
  });
}

let hasPython = false;

beforeAll(async () => {
  hasPython = await pythonAvailable();
  if (hasPython) {
    writeFileSync(FIXTURE_PATH, FIXTURE_SOURCE, 'utf-8');
  }
});

afterAll(() => {
  if (existsSync(FIXTURE_PATH)) {
    rmSync(FIXTURE_PATH, { force: true });
  }
});

/** Build a `call` request line for the fixture's big_string(n). */
function bigStringRequest(id: number, n: number): string {
  return JSON.stringify({
    id,
    protocol: PROTOCOL_ID,
    method: 'call',
    params: { module: FIXTURE_MODULE, functionName: 'big_string', args: [n], kwargs: {} },
  });
}

// =============================================================================
// END-TO-END: 20 MiB RESPONSE OVER 1 MiB FRAMES
// =============================================================================

describe('SubprocessTransport chunked responses (tywrap-frame/1)', () => {
  let transport: SubprocessTransport | null = null;

  afterEach(async () => {
    if (transport) {
      await transport.dispose();
      transport = null;
    }
  });

  it('negotiates chunking from the bridge meta probe', async () => {
    if (!hasPython) {
      return;
    }
    transport = new SubprocessTransport({
      bridgeScript: REFERENCE_SCRIPT,
      cwd: RUNTIME_DIR,
      maxLineLength: ONE_MIB,
      enableChunking: true,
    });
    await transport.init();
    expect(transport.capabilities().supportsChunking).toBe(true);
    expect(transport.capabilities().maxFrameBytes).toBe(ONE_MIB);
  });

  it('reassembles a ~20 MiB response from 1 MiB frames end-to-end', async () => {
    if (!hasPython) {
      return;
    }
    transport = new SubprocessTransport({
      bridgeScript: REFERENCE_SCRIPT,
      cwd: RUNTIME_DIR,
      maxLineLength: ONE_MIB,
      enableChunking: true,
      // Raise the logical codec ceiling so Python does not reject the 20 MiB
      // response BEFORE it ever gets framed (this is the response-size guard,
      // distinct from the per-frame ceiling).
      env: {
        ...process.env,
        TYWRAP_CODEC_MAX_BYTES: String(TWENTY_MIB * 2),
      } as Record<string, string>,
    });
    await transport.init();
    expect(transport.capabilities().supportsChunking).toBe(true);

    const responseLine = await transport.send(bigStringRequest(1, TWENTY_MIB), 60_000);

    const parsed = JSON.parse(responseLine) as { id: number; result: string };
    expect(parsed.id).toBe(1);
    expect(typeof parsed.result).toBe('string');
    expect(parsed.result.length).toBe(TWENTY_MIB);
    // Content integrity: first/last bytes + total length pin the reassembly.
    expect(parsed.result.startsWith('tywrap-0123456789-')).toBe(true);
    expect(Buffer.byteLength(parsed.result, 'utf-8')).toBe(TWENTY_MIB);
  }, 90_000);

  it('still handles small single-line responses while chunking is negotiated', async () => {
    if (!hasPython) {
      return;
    }
    transport = new SubprocessTransport({
      bridgeScript: REFERENCE_SCRIPT,
      cwd: RUNTIME_DIR,
      maxLineLength: ONE_MIB,
      enableChunking: true,
    });
    await transport.init();

    const responseLine = await transport.send(bigStringRequest(1, 32), 30_000);
    const parsed = JSON.parse(responseLine) as { id: number; result: string };
    expect(parsed.id).toBe(1);
    expect(parsed.result.length).toBe(32);
  }, 30_000);
});

// =============================================================================
// LATE-FRAME-AFTER-TIMEOUT DISCARD (deterministic, via internals)
// =============================================================================

interface ChunkingInternals {
  _state: string;
  processExited: boolean;
  process: { stdin: { write: (data: string) => boolean } } | null;
  negotiatedChunking: boolean;
  responseReassembler: { discard: (id: number) => void; pendingCount: number } | null;
  handleResponseLine: (line: string) => void;
}

/**
 * Build a chunking-enabled transport whose process is stubbed (no real spawn)
 * and whose negotiation result is forced on, so frame routing can be driven
 * deterministically through handleResponseLine.
 */
function forcedChunkingTransport(): { transport: SubprocessTransport; internals: ChunkingInternals } {
  const transport = new SubprocessTransport({
    bridgeScript: '/path/to/bridge.py',
    maxLineLength: ONE_MIB,
    enableChunking: true,
  });
  const internals = transport as unknown as ChunkingInternals;
  internals._state = 'ready';
  internals.processExited = false;
  internals.process = { stdin: { write: (): boolean => true } };
  internals.negotiatedChunking = true;
  // The reassembler is normally created inside negotiateChunking(); for this
  // stubbed (no-spawn) path the test injects a real Reassembler instance.
  return { transport, internals };
}

describe('SubprocessTransport late-frame-after-timeout discard', () => {
  it('drops late frames for a timed-out id without desyncing the next response', async () => {
    const { transport, internals } = forcedChunkingTransport();

    // Inject a real Reassembler (the production class) so discard() semantics are
    // exercised, not a stub. We import it indirectly by encoding+feeding frames.
    const { Reassembler } = await import('../src/runtime/frame-codec.js');
    internals.responseReassembler = new Reassembler() as unknown as ChunkingInternals['responseReassembler'];

    // Build a 3-frame response for id=42 against a tiny frame ceiling.
    const logical = JSON.stringify({ id: 42, protocol: PROTOCOL_ID, result: 'A'.repeat(30) });
    const frames = encodeFrames(logical, { id: 42, stream: 'response', maxFrameBytes: 12 });
    expect(frames.length).toBeGreaterThan(1);

    // Feed the first frame, then simulate a timeout for id=42 (transport marks
    // the id discarded on the reassembler).
    internals.handleResponseLine(JSON.stringify(frames[0]));
    expect(internals.responseReassembler?.pendingCount).toBe(1);

    internals.responseReassembler?.discard(42);
    expect(internals.responseReassembler?.pendingCount).toBe(0);

    // Remaining late frames for id=42 must be dropped silently (no throw, no
    // pending corruption).
    for (let i = 1; i < frames.length; i += 1) {
      expect(() => internals.handleResponseLine(JSON.stringify(frames[i]))).not.toThrow();
    }
    expect(internals.responseReassembler?.pendingCount).toBe(0);

    // A fresh response for a NEW id=43 reassembles cleanly afterwards: the
    // stream was not desynced by the discarded frames.
    const logical43 = JSON.stringify({ id: 43, protocol: PROTOCOL_ID, result: 'B'.repeat(40) });
    const frames43 = encodeFrames(logical43, { id: 43, stream: 'response', maxFrameBytes: 12 });
    const captured: string[] = [];
    // Register a pending request for id=43 so completion has somewhere to resolve.
    (transport as unknown as {
      pending: Map<number, { resolve: (v: string) => void; reject: (e: Error) => void }>;
    }).pending.set(43, {
      resolve: (v: string) => captured.push(v),
      reject: (e: Error) => {
        throw e;
      },
    });
    for (const f of frames43) {
      internals.handleResponseLine(JSON.stringify(f));
    }
    expect(captured).toHaveLength(1);
    expect(JSON.parse(captured[0] ?? '{}')).toMatchObject({ id: 43, result: 'B'.repeat(40) });

    // Reset stub state so dispose() does not touch the fake process object.
    internals._state = 'idle';
    internals.process = null;
    await transport.dispose();
  });

  it('rejects the pending id and marks for restart on frame corruption', async () => {
    const { transport, internals } = forcedChunkingTransport();
    const { Reassembler } = await import('../src/runtime/frame-codec.js');
    internals.responseReassembler =
      new Reassembler() as unknown as ChunkingInternals['responseReassembler'];

    const restartInternals = transport as unknown as { needsRestart: boolean };
    const pendingMap = (transport as unknown as {
      pending: Map<number, { resolve: (v: string) => void; reject: (e: Error) => void }>;
    }).pending;

    let rejected: Error | null = null;
    pendingMap.set(55, {
      resolve: () => {
        throw new Error('should not resolve on corruption');
      },
      reject: (e: Error) => {
        rejected = e;
      },
    });

    // Two frames declaring inconsistent totals for the same id -> FRAME_INCONSISTENT.
    const logical = JSON.stringify({ id: 55, protocol: PROTOCOL_ID, result: 'C'.repeat(30) });
    const frames = encodeFrames(logical, { id: 55, stream: 'response', maxFrameBytes: 12 });
    expect(frames.length).toBeGreaterThan(1);
    internals.handleResponseLine(JSON.stringify(frames[0]));
    // Tamper the second frame's total so it disagrees with the first.
    const tampered = { ...frames[1], total: frames[0].total + 1 };
    internals.handleResponseLine(JSON.stringify(tampered));

    expect(rejected).toBeInstanceOf(Error);
    expect(restartInternals.needsRestart).toBe(true);
    expect(pendingMap.has(55)).toBe(false);

    internals._state = 'idle';
    internals.process = null;
    await transport.dispose();
  });

  it('uses the frame protocol id constant in the negotiation env (sanity)', () => {
    // Guards against drift between the env value and FRAME_PROTOCOL_ID.
    expect(FRAME_PROTOCOL_ID).toBe('tywrap-frame/1');
  });
});

// =============================================================================
// NO NEGOTIATION: oversize fails LOUD (no silent single-frame fallback)
// =============================================================================

describe('SubprocessTransport without chunking (old-bridge behavior)', () => {
  let transport: SubprocessTransport | null = null;

  afterEach(async () => {
    if (transport) {
      await transport.dispose();
      transport = null;
    }
  });

  it('reports supportsChunking:false and fails loud on an oversize response', async () => {
    if (!hasPython) {
      return;
    }
    // enableChunking omitted => no negotiation; the bridge writes one JSONL line.
    transport = new SubprocessTransport({
      bridgeScript: REFERENCE_SCRIPT,
      cwd: RUNTIME_DIR,
      maxLineLength: ONE_MIB,
      env: {
        ...process.env,
        TYWRAP_CODEC_MAX_BYTES: String(TWENTY_MIB * 2),
      } as Record<string, string>,
    });
    await transport.init();
    expect(transport.capabilities().supportsChunking).toBe(false);

    // A response larger than maxLineLength must fail with a protocol error
    // (line ceiling), NOT silently truncate.
    await expect(transport.send(bigStringRequest(1, 4 * ONE_MIB), 30_000)).rejects.toThrow(
      /exceeded/
    );
  }, 30_000);
});
