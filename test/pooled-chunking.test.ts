/**
 * W6 — Pool composition for `tywrap-frame/1` chunked transport.
 *
 * The riskiest integration slice: prove chunking composes with the pool and the
 * per-worker warmup path. Specifically:
 *
 *  - Each leased worker subprocess uses the packaged `tywrap-frame/1` codec.
 *    PooledTransport initializes every worker before making it available.
 *  - The PooledTransport static capabilities() descriptor is built from an
 *    un-initialized probe transport, so it reports the always-on subprocess
 *    framing capability and is memoized to exactly one probe.
 *  - A chunked request AND a chunked response both complete correctly when routed
 *    through a pool lease (PooledTransport.send -> withWorker -> worker.send).
 *  - A per-worker warmup callback composes with framing and the worker still
 *    chunks correctly afterward.
 *
 * Real-Python tests spawn runtime/python_bridge.py through SubprocessTransport
 * workers and are skipped when python3 is unavailable. A 5s-timeout flake under
 * load that passes in isolation is NOT a regression (repo memory).
 *
 * @see docs/transport-framing.md
 * @see docs/transport-capabilities.md
 */

import { spawn } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { PooledTransport } from '../src/runtime/pooled-transport.js';
import { SubprocessTransport } from '../src/runtime/subprocess-transport.js';
import type { TransportLease } from '../src/runtime/pooled-transport.js';
import { PROTOCOL_ID } from '../src/runtime/transport.js';
import { utf8ByteLength } from '../src/runtime/frame-codec.js';
import { getDefaultPythonPath } from '../src/utils/python.js';

// =============================================================================
// SETUP
// =============================================================================

const REFERENCE_SCRIPT = resolve(process.cwd(), 'runtime/python_bridge.py');
const RUNTIME_DIR = resolve(process.cwd(), 'runtime');

// A throwaway fixture dropped into runtime/ so each worker (cwd == runtime/) can
// import it. `echo` round-trips a request payload; `big_string` drives a large
// response payload. Both pin reassembly fidelity through the pool lease.
const FIXTURE_MODULE = '_tywrap_w6_pool_chunking_fixture';
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

function bigAsciiString(n: number): string {
  const pattern = 'tywrap-0123456789-';
  const reps = Math.floor(n / pattern.length) + 1;
  return pattern.repeat(reps).slice(0, n);
}

function echoRequest(id: number, arg: string): string {
  return JSON.stringify({
    id,
    protocol: PROTOCOL_ID,
    method: 'call',
    params: { module: FIXTURE_MODULE, functionName: 'echo', args: [arg], kwargs: {} },
  });
}

function bigStringRequest(id: number, n: number): string {
  return JSON.stringify({
    id,
    protocol: PROTOCOL_ID,
    method: 'call',
    params: { module: FIXTURE_MODULE, functionName: 'big_string', args: [n], kwargs: {} },
  });
}

/** Build a chunking-enabled SubprocessTransport worker factory for the pool. */
function chunkingWorkerFactory(extraEnv: Record<string, string> = {}): () => SubprocessTransport {
  return () =>
    new SubprocessTransport({
      bridgeScript: REFERENCE_SCRIPT,
      cwd: RUNTIME_DIR,
      maxLineLength: ONE_MIB,
      // Generous reassembly cap so the 20 MiB lease tests reassemble; the
      // default 10 MiB bound (which correctly rejects oversize) is exercised
      // separately in test/transport-chunking.test.ts.
      maxReassemblyBytes: TWENTY_MIB * 4,
      env: { ...process.env, ...extraEnv } as Record<string, string>,
    });
}

// =============================================================================
// CAPABILITIES HONESTY (no Python required)
// =============================================================================

describe('PooledTransport chunking capability descriptor', () => {
  it('reports the configured supportsChunking:true from the static probe', () => {
    const pool = new PooledTransport({
      createTransport: chunkingWorkerFactory(),
      maxWorkers: 2,
    });
    // The static descriptor reads an uninitialized probe built by the same
    // factory. Subprocess framing is always on and lifecycle-independent.
    const caps = pool.capabilities();
    expect(caps.backend).toBe('subprocess');
    expect(caps.supportsChunking).toBe(true);
    expect(caps.supportsStreaming).toBe(false);
    expect(caps.maxFrameBytes).toBe(ONE_MIB);
  });

  it('memoizes the probe so at most one transport is ever built for capabilities()', () => {
    let built = 0;
    const pool = new PooledTransport({
      createTransport: () => {
        built += 1;
        return new SubprocessTransport({
          bridgeScript: REFERENCE_SCRIPT,
          maxLineLength: ONE_MIB,
        });
      },
      maxWorkers: 4,
    });

    const first = pool.capabilities();
    const second = pool.capabilities();
    const third = pool.capabilities();

    // The probe is built once; repeated reads return the same memoized object.
    expect(built).toBe(1);
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(first.supportsChunking).toBe(true);
  });
});

// =============================================================================
// LIVE: CHUNKING THROUGH A POOL LEASE
// =============================================================================

describe('PooledTransport chunked exchanges through a lease (live)', () => {
  let pool: PooledTransport | null = null;

  afterEach(async () => {
    if (pool) {
      await pool.dispose();
      pool = null;
    }
  });

  it('initializes framing on each leased worker', async () => {
    if (!hasPython) return;
    const frameCeilings: number[] = [];
    pool = new PooledTransport({
      createTransport: chunkingWorkerFactory(),
      maxWorkers: 2,
      minWorkers: 2,
      onWorkerReady: async worker => {
        frameCeilings.push(worker.transport.capabilities().maxFrameBytes);
      },
    });
    await pool.init();
    expect(frameCeilings).toEqual([ONE_MIB, ONE_MIB]);
  }, 30_000);

  it('reassembles a ~20 MiB chunked response routed through a pool lease', async () => {
    if (!hasPython) {
      return;
    }
    pool = new PooledTransport({
      createTransport: chunkingWorkerFactory({
        // Raise the logical codec ceiling so Python does not reject the 20 MiB
        // response BEFORE it is framed (response-size guard, distinct from the
        // per-frame ceiling).
        TYWRAP_CODEC_MAX_BYTES: String(TWENTY_MIB * 2),
      }),
      maxWorkers: 1,
      minWorkers: 1,
    });
    await pool.init();

    const responseLine = await pool.send(bigStringRequest(1, TWENTY_MIB), 60_000);
    const parsed = JSON.parse(responseLine) as { id: number; result: string };
    expect(parsed.id).toBe(1);
    expect(parsed.result.length).toBe(TWENTY_MIB);
    expect(parsed.result.startsWith('tywrap-0123456789-')).toBe(true);
    expect(Buffer.byteLength(parsed.result, 'utf-8')).toBe(TWENTY_MIB);
  }, 90_000);

  it('reassembles a ~20 MiB chunked request routed through a pool lease', async () => {
    if (!hasPython) {
      return;
    }
    pool = new PooledTransport({
      createTransport: chunkingWorkerFactory({
        TYWRAP_CODEC_MAX_BYTES: String(TWENTY_MIB * 2),
      }),
      maxWorkers: 1,
      minWorkers: 1,
    });
    await pool.init();

    const arg = bigAsciiString(TWENTY_MIB);
    const request = echoRequest(1, arg);
    // Sanity: the request exceeds the per-frame ceiling, so the chunked write
    // path (not the single-line path) is exercised under the lease.
    expect(utf8ByteLength(request)).toBeGreaterThan(ONE_MIB);

    const responseLine = await pool.send(request, 60_000);
    const parsed = JSON.parse(responseLine) as { id: number; result: string };
    expect(parsed.id).toBe(1);
    expect(parsed.result).toBe(arg);
  }, 120_000);

  it('still handles small single-line calls through the pool while chunking is negotiated', async () => {
    if (!hasPython) {
      return;
    }
    pool = new PooledTransport({
      createTransport: chunkingWorkerFactory(),
      maxWorkers: 2,
    });
    await pool.init();

    const responseLine = await pool.send(echoRequest(1, 'small'), 30_000);
    const parsed = JSON.parse(responseLine) as { id: number; result: string };
    expect(parsed.id).toBe(1);
    expect(parsed.result).toBe('small');
  }, 30_000);

  it('composes per-worker warmup with negotiation, then chunks correctly', async () => {
    if (!hasPython) {
      return;
    }
    const warmupSeen: number[] = [];
    pool = new PooledTransport({
      createTransport: chunkingWorkerFactory({
        TYWRAP_CODEC_MAX_BYTES: String(TWENTY_MIB * 2),
      }),
      maxWorkers: 1,
      minWorkers: 1,
      // Per-worker warmup runs after transport initialization; framing remains
      // available for subsequent calls.
      onWorkerReady: async (worker: TransportLease) => {
        expect(worker.transport.capabilities().supportsChunking).toBe(true);
        warmupSeen.push(1);
      },
    });
    await pool.init();
    expect(warmupSeen.length).toBe(1);

    // After warmup, a chunked response still reassembles correctly through the lease.
    const responseLine = await pool.send(bigStringRequest(5, 5 * ONE_MIB), 60_000);
    const parsed = JSON.parse(responseLine) as { id: number; result: string };
    expect(parsed.id).toBe(5);
    expect(parsed.result.length).toBe(5 * ONE_MIB);
  }, 60_000);
});
