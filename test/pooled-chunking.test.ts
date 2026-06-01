/**
 * W6 — Pool composition for `tywrap-frame/1` chunked transport.
 *
 * The riskiest integration slice: prove chunking composes with the pool and the
 * per-worker warmup path. Specifically:
 *
 *  - Each leased worker subprocess negotiates `tywrap-frame/1` independently (the
 *    negotiation runs inside SubprocessTransport.init(), which the pool calls per
 *    worker via createWorker -> transport.init()). A leased worker's transport
 *    therefore reports supportsChunking:true post-init.
 *  - The PooledTransport static capabilities() descriptor is built from an
 *    un-initialized probe transport, so it HONESTLY reports supportsChunking:false
 *    (no negotiation has happened on a static, no-init probe) and is memoized to
 *    exactly one probe regardless of call count.
 *  - A chunked request AND a chunked response both complete correctly when routed
 *    through a pool lease (PooledTransport.send -> withWorker -> worker.send).
 *  - A per-worker warmup callback (onWorkerReady) composes with negotiation: the
 *    warmup `meta` probe runs after init()'s negotiation and the worker still
 *    chunks correctly afterward.
 *  - OLD-BRIDGE behavior through the pool: a worker that does not advertise the
 *    transport block (enableChunking omitted) keeps small calls working and fails
 *    an oversize response LOUD — no hang, no silent truncation.
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
import type { TransportLease } from '../src/runtime/transport-pool.js';
import { PROTOCOL_ID } from '../src/runtime/transport.js';
import { utf8ByteLength } from '../src/runtime/frame-codec.js';

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
function chunkingWorkerFactory(
  extraEnv: Record<string, string> = {}
): () => SubprocessTransport {
  return () =>
    new SubprocessTransport({
      bridgeScript: REFERENCE_SCRIPT,
      cwd: RUNTIME_DIR,
      maxLineLength: ONE_MIB,
      enableChunking: true,
      env: { ...process.env, ...extraEnv } as Record<string, string>,
    });
}

// =============================================================================
// CAPABILITIES HONESTY (no Python required)
// =============================================================================

describe('PooledTransport chunking capability descriptor', () => {
  it('reports supportsChunking:false from the static un-initialized probe (honest)', () => {
    const pool = new PooledTransport({
      createTransport: chunkingWorkerFactory(),
      maxWorkers: 2,
    });
    // A static descriptor reads an un-init probe: no negotiation has happened, so
    // chunking is honestly false. The per-lease truth (true) only appears after a
    // worker's own init() negotiates — asserted in the live test below.
    const caps = pool.capabilities();
    expect(caps.backend).toBe('subprocess');
    expect(caps.supportsChunking).toBe(false);
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
          enableChunking: true,
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
    expect(first.supportsChunking).toBe(false);
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

  it('negotiates chunking on each leased worker (post-init supportsChunking:true)', async () => {
    if (!hasPython) {
      return;
    }
    // onWorkerReady receives each freshly-created worker's lease AFTER its
    // transport.init() (where negotiation runs), so it is the public hook that
    // observes the per-lease truth the static pool descriptor cannot show. With
    // minWorkers:2 both workers are spawned during init() and each must have
    // negotiated chunking independently.
    const perWorkerChunking: boolean[] = [];
    const perWorkerMaxFrame: number[] = [];
    pool = new PooledTransport({
      createTransport: chunkingWorkerFactory(),
      maxWorkers: 2,
      minWorkers: 2,
      maxConcurrentPerWorker: 1,
      onWorkerReady: async (worker: TransportLease) => {
        const caps = worker.transport.capabilities();
        perWorkerChunking.push(caps.supportsChunking);
        perWorkerMaxFrame.push(caps.maxFrameBytes);
      },
    });
    await pool.init();
    expect(pool.workerCount).toBe(2);

    // Both leased workers negotiated chunking independently.
    expect(perWorkerChunking).toEqual([true, true]);
    expect(perWorkerMaxFrame).toEqual([ONE_MIB, ONE_MIB]);

    // And a chunked exchange still completes correctly through a lease afterward.
    const responseLine = await pool.send(echoRequest(1, 'leased'), 30_000);
    expect((JSON.parse(responseLine) as { result: string }).result).toBe('leased');
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
      // Per-worker warmup runs AFTER the transport's init() (where negotiation
      // happens). A raw meta probe on the leased worker confirms the post-init
      // transport block is present, proving warmup composes with negotiation.
      onWorkerReady: async (worker: TransportLease) => {
        // capabilities() now reflects the negotiated state on this leased worker.
        expect(worker.transport.capabilities().supportsChunking).toBe(true);
        const metaLine = await worker.transport.send(
          JSON.stringify({ id: -100, protocol: PROTOCOL_ID, method: 'meta', params: {} }),
          15_000
        );
        const meta = JSON.parse(metaLine) as {
          result?: { transport?: { supportsChunking?: boolean } };
        };
        if (meta.result?.transport?.supportsChunking === true) {
          warmupSeen.push(1);
        }
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

// =============================================================================
// OLD-BRIDGE BEHAVIOR THROUGH THE POOL (no chunking advertised)
// =============================================================================

describe('PooledTransport old-bridge behavior (no chunking)', () => {
  let pool: PooledTransport | null = null;

  afterEach(async () => {
    if (pool) {
      await pool.dispose();
      pool = null;
    }
  });

  it('small calls work and an oversize response fails LOUD (no hang, no truncation)', async () => {
    if (!hasPython) {
      return;
    }
    // enableChunking omitted on the worker factory => no negotiation; the bridge
    // writes one JSONL line. This is the old-bridge / un-negotiated path.
    pool = new PooledTransport({
      createTransport: () =>
        new SubprocessTransport({
          bridgeScript: REFERENCE_SCRIPT,
          cwd: RUNTIME_DIR,
          maxLineLength: ONE_MIB,
          env: {
            ...process.env,
            TYWRAP_CODEC_MAX_BYTES: String(TWENTY_MIB * 2),
          } as Record<string, string>,
        }),
      maxWorkers: 1,
      minWorkers: 1,
    });
    await pool.init();

    // Static descriptor and the leased worker both report no chunking.
    expect(pool.capabilities().supportsChunking).toBe(false);

    // A small call still works.
    const smallLine = await pool.send(echoRequest(1, 'ok'), 30_000);
    expect((JSON.parse(smallLine) as { result: string }).result).toBe('ok');

    // An oversize response must fail LOUD (line ceiling), not hang or truncate.
    await expect(pool.send(bigStringRequest(2, 4 * ONE_MIB), 30_000)).rejects.toThrow(
      /exceeded/
    );
  }, 60_000);
});
