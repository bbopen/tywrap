/**
 * W5 — Subprocess REQUEST chunking integration tests (`tywrap-frame/1`).
 *
 * Mirror of the W4 response-chunking suite, on the request stream:
 *  - end-to-end: force a ~1 MiB frame ceiling, send a ~20 MiB request payload
 *    (an echo round-trip), and assert the real Python bridge reassembles the
 *    request from `stream:'request'` frames before json.loads and the call
 *    succeeds with byte-for-byte fidelity.
 *  - the per-logical-request write mutex keeps one request's frames contiguous
 *    so two concurrent large requests round-trip correctly (no interleaving
 *    desync of the Python reassembler).
 *  - TYWRAP_REQUEST_MAX_BYTES is enforced on the REASSEMBLED size (not per
 *    frame): an over-limit reassembled request fails LOUD.
 *  - abort during a request-frame burst stops further frames and rejects the
 *    logical send.
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
import { PROTOCOL_ID } from '../src/runtime/transport.js';
import { utf8ByteLength } from '../src/runtime/frame-codec.js';
import { BridgeTimeoutError } from '../src/runtime/errors.js';
import { getDefaultPythonPath } from '../src/utils/python.js';

// =============================================================================
// SETUP
// =============================================================================

const REFERENCE_SCRIPT = resolve(process.cwd(), 'runtime/python_bridge.py');
const RUNTIME_DIR = resolve(process.cwd(), 'runtime');

// A throwaway fixture dropped into runtime/ so the bridge (cwd == runtime/) can
// import it. `echo` returns its argument verbatim, so a large request argument
// drives a large request payload (forced through request frames) and the
// returned value pins reassembly fidelity end-to-end.
const FIXTURE_MODULE = '_tywrap_w5_request_chunking_fixture';
const FIXTURE_PATH = resolve(RUNTIME_DIR, `${FIXTURE_MODULE}.py`);
const FIXTURE_SOURCE = `
def echo(value):
    """Return the argument verbatim (request round-trip fidelity probe)."""
    return value


def big_string(n):
    """Return an n-byte ASCII string with a repeating, position-sensitive pattern."""
    pattern = 'tywrap-0123456789-'
    reps = (n // len(pattern)) + 1
    return (pattern * reps)[:n]
`;

const ONE_MIB = 1024 * 1024;
const TWENTY_MIB = 20 * 1024 * 1024;

function pythonAvailable(): Promise<boolean> {
  return new Promise(res => {
    const proc = spawn(getDefaultPythonPath(), ['--version']);
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

/** Build a `call` request line for echo(arg). */
function echoRequest(id: number, arg: string): string {
  return JSON.stringify({
    id,
    protocol: PROTOCOL_ID,
    method: 'call',
    params: { module: FIXTURE_MODULE, functionName: 'echo', args: [arg], kwargs: {} },
  });
}

/** Build a deterministic n-byte ASCII string (matches the fixture's pattern). */
function bigAsciiString(n: number): string {
  const pattern = 'tywrap-0123456789-';
  const reps = Math.floor(n / pattern.length) + 1;
  return pattern.repeat(reps).slice(0, n);
}

// =============================================================================
// END-TO-END: ~20 MiB REQUEST OVER 1 MiB FRAMES
// =============================================================================

describe('SubprocessTransport chunked requests (tywrap-frame/1)', () => {
  let transport: SubprocessTransport | null = null;

  afterEach(async () => {
    if (transport) {
      await transport.dispose();
      transport = null;
    }
  });

  it('reassembles a ~20 MiB request from 1 MiB frames and echoes it back', async () => {
    if (!hasPython) {
      return;
    }
    transport = new SubprocessTransport({
      bridgeScript: REFERENCE_SCRIPT,
      cwd: RUNTIME_DIR,
      maxLineLength: ONE_MIB,
      enableChunking: true,
      // Raise the logical codec ceiling so the ~20 MiB echo RESPONSE is not
      // rejected before framing (this is the response-size guard). The request
      // side has no byte limit here (TYWRAP_REQUEST_MAX_BYTES unset). The TS
      // reassembly cap must rise too so the echoed 20 MiB response reassembles.
      maxReassemblyBytes: TWENTY_MIB * 2,
      env: {
        ...process.env,
        TYWRAP_CODEC_MAX_BYTES: String(TWENTY_MIB * 2),
      } as Record<string, string>,
    });
    await transport.init();
    expect(transport.capabilities().supportsChunking).toBe(true);

    const arg = bigAsciiString(TWENTY_MIB);
    const request = echoRequest(1, arg);
    // Sanity: the request really does exceed the per-frame ceiling, so the
    // chunked write path (not the single-line path) is exercised.
    expect(utf8ByteLength(request)).toBeGreaterThan(ONE_MIB);

    const responseLine = await transport.send(request, 60_000);
    const parsed = JSON.parse(responseLine) as { id: number; result: string };
    expect(parsed.id).toBe(1);
    expect(typeof parsed.result).toBe('string');
    expect(parsed.result.length).toBe(TWENTY_MIB);
    expect(parsed.result).toBe(arg);
  }, 120_000);

  it('keeps concurrent large requests contiguous via the write mutex', async () => {
    if (!hasPython) {
      return;
    }
    transport = new SubprocessTransport({
      bridgeScript: REFERENCE_SCRIPT,
      cwd: RUNTIME_DIR,
      maxLineLength: ONE_MIB,
      enableChunking: true,
      env: {
        ...process.env,
        TYWRAP_CODEC_MAX_BYTES: String(TWENTY_MIB * 4),
      } as Record<string, string>,
    });
    await transport.init();

    // Two large requests issued without awaiting between them: their frame
    // bursts must not interleave on stdin, or the Python reassembler would mix
    // ids and desync. Distinct payloads pin which response goes with which id.
    const argA = `A:${bigAsciiString(3 * ONE_MIB)}`;
    const argB = `B:${bigAsciiString(3 * ONE_MIB)}`;
    const pa = transport.send(echoRequest(10, argA), 60_000);
    const pb = transport.send(echoRequest(11, argB), 60_000);

    const [ra, rb] = await Promise.all([pa, pb]);
    const parsedA = JSON.parse(ra) as { id: number; result: string };
    const parsedB = JSON.parse(rb) as { id: number; result: string };
    expect(parsedA.id).toBe(10);
    expect(parsedA.result).toBe(argA);
    expect(parsedB.id).toBe(11);
    expect(parsedB.result).toBe(argB);
  }, 120_000);

  it('still sends small single-line requests while chunking is negotiated', async () => {
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

    const responseLine = await transport.send(echoRequest(1, 'small'), 30_000);
    const parsed = JSON.parse(responseLine) as { id: number; result: string };
    expect(parsed.id).toBe(1);
    expect(parsed.result).toBe('small');
  }, 30_000);
});

// =============================================================================
// TYWRAP_REQUEST_MAX_BYTES ENFORCED ON THE REASSEMBLED SIZE (LOUD)
// =============================================================================

describe('SubprocessTransport chunked request size guard', () => {
  let transport: SubprocessTransport | null = null;

  afterEach(async () => {
    if (transport) {
      await transport.dispose();
      transport = null;
    }
  });

  it('rejects an over-limit reassembled request LOUD (limit applied post-reassembly)', async () => {
    if (!hasPython) {
      return;
    }
    // Per-frame ceiling 1 MiB, so individual frames are well under the 4 MiB
    // request limit; the limit can only trip AFTER the ~8 MiB request is
    // reassembled — proving enforcement is on the reassembled size, not the
    // frame. TYWRAP_CODEC_MAX_BYTES is raised so the (never-built) response
    // ceiling is not what trips.
    const requestLimit = 4 * ONE_MIB;
    transport = new SubprocessTransport({
      bridgeScript: REFERENCE_SCRIPT,
      cwd: RUNTIME_DIR,
      maxLineLength: ONE_MIB,
      enableChunking: true,
      env: {
        ...process.env,
        TYWRAP_REQUEST_MAX_BYTES: String(requestLimit),
        TYWRAP_CODEC_MAX_BYTES: String(TWENTY_MIB * 2),
      } as Record<string, string>,
    });
    await transport.init();
    expect(transport.capabilities().supportsChunking).toBe(true);

    const arg = bigAsciiString(8 * ONE_MIB);
    const request = echoRequest(1, arg);
    // The whole request exceeds the limit, but every frame is under it.
    expect(utf8ByteLength(request)).toBeGreaterThan(requestLimit);

    await expect(transport.send(request, 60_000)).rejects.toThrow(
      /TYWRAP_REQUEST_MAX_BYTES|RequestTooLargeError/
    );
  }, 120_000);

  it('accepts a chunked request whose reassembled size is under the limit', async () => {
    if (!hasPython) {
      return;
    }
    // Request limit 16 MiB; an ~8 MiB chunked request reassembles under it and
    // succeeds, confirming the guard does not over-reject legitimate chunked
    // payloads.
    transport = new SubprocessTransport({
      bridgeScript: REFERENCE_SCRIPT,
      cwd: RUNTIME_DIR,
      maxLineLength: ONE_MIB,
      enableChunking: true,
      env: {
        ...process.env,
        TYWRAP_REQUEST_MAX_BYTES: String(16 * ONE_MIB),
        TYWRAP_CODEC_MAX_BYTES: String(TWENTY_MIB * 2),
      } as Record<string, string>,
    });
    await transport.init();

    const arg = bigAsciiString(8 * ONE_MIB);
    const request = echoRequest(2, arg);
    expect(utf8ByteLength(request)).toBeGreaterThan(ONE_MIB);

    const responseLine = await transport.send(request, 60_000);
    const parsed = JSON.parse(responseLine) as { id: number; result: string };
    expect(parsed.id).toBe(2);
    expect(parsed.result).toBe(arg);
  }, 120_000);
});

// =============================================================================
// ABORT MID-BURST (deterministic, via internals)
// =============================================================================

interface RequestChunkingInternals {
  _state: string;
  processExited: boolean;
  process: { stdin: { write: (data: string) => boolean } } | null;
  negotiatedChunking: boolean;
  maxLineLength: number;
  pending: Map<number, { resolve: (v: string) => void; reject: (e: Error) => void }>;
}

describe('SubprocessTransport request-frame abort', () => {
  it('stops further request frames and rejects the send when aborted mid-burst', async () => {
    const transport = new SubprocessTransport({
      bridgeScript: '/path/to/bridge.py',
      // Tiny frame ceiling so even a small request fans out into many frames.
      maxLineLength: 8,
      enableChunking: true,
    });
    const internals = transport as unknown as RequestChunkingInternals;
    internals._state = 'ready';
    internals.processExited = false;
    internals.negotiatedChunking = true;

    const controller = new AbortController();
    const writtenFrames: string[] = [];
    let frameWrites = 0;
    internals.process = {
      stdin: {
        write: (data: string): boolean => {
          writtenFrames.push(data);
          frameWrites += 1;
          // Abort after the first frame reaches stdin: the burst must stop and
          // no further frames may be written.
          if (frameWrites === 1) {
            controller.abort();
          }
          return true;
        },
      },
    };

    // A request large enough (relative to the 8-byte ceiling) to require many
    // frames, so the abort lands while frames remain unwritten.
    const arg = 'x'.repeat(2000);
    const request = echoRequest(1, arg);

    await expect(transport.send(request, 60_000, controller.signal)).rejects.toThrow(
      BridgeTimeoutError
    );

    // The burst stopped early: far fewer frames than the full request would
    // produce reached stdin.
    const fullFrameCount = Math.ceil(utf8ByteLength(request) / 8);
    expect(writtenFrames.length).toBeLessThan(fullFrameCount);
    // And the pending entry was cleaned up (no lingering correlation).
    expect(internals.pending.has(1)).toBe(false);

    internals._state = 'idle';
    internals.process = null;
    await transport.dispose();
  });
});
