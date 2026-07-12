/**
 * Data-plane baseline benchmarks (measure-first, NO perf gating).
 *
 * Purpose: capture indicative baselines for the hot data-plane paths so the
 * 0.8.0 release can layer real perf gates on top of a known harness. These
 * benchmarks DO NOT assert thresholds — they only assert that the measured
 * work actually happened, then print timing/throughput numbers. Absolute
 * numbers are machine-dependent; the value is the relative harness.
 *
 * Coverage (per expert review D1):
 * - Arrow encode+decode round-trip for an ndarray and a DataFrame.
 * - 100k-row DataFrame decode latency.
 * - Size-check overhead for a ~5MB payload (codec max-bytes guard cost).
 * - PooledTransport (TransportPool) throughput for repeated small calls.
 *
 * Gated behind TYWRAP_PERF_BUDGETS=1 so the normal suite is unaffected.
 * Run with: TYWRAP_PERF_BUDGETS=1 NODE_OPTIONS=--expose-gc npm test
 *
 * Uses synthetic in-memory data only (apache-arrow devDependency) — no live
 * Python subprocess is required.
 */

import { performance } from 'node:perf_hooks';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as arrow from 'apache-arrow';
import { BridgeCodec } from '../src/runtime/bridge-codec.js';
import { PooledTransport } from '../src/runtime/pooled-transport.js';
import type { Transport } from '../src/runtime/transport.js';
import {
  decodeValueAsync,
  registerArrowDecoder,
  clearArrowDecoder,
  type ArrowTable,
} from '../src/utils/codec.js';
import { isNodejs } from '../src/utils/runtime.js';

const shouldRun = isNodejs() && process.env.TYWRAP_PERF_BUDGETS === '1';
const describeBench = shouldRun ? describe : describe.skip;

// Benchmarks iterate; the default 5s local testTimeout is too tight for them.
const BENCH_TIMEOUT_MS = 60_000;

// Iteration/size knobs must be positive integers — 0, negatives, and fractions
// would divide-by-zero in the per-op math or feed nonsensical sizes, so clamp.
const readEnvNumber = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.floor(parsed);
};

const runGc = (): void => {
  if (global.gc) {
    global.gc();
  }
};

/**
 * Time a synchronous closure across `iterations`, returning total/per-op stats.
 */
function timeSync(iterations: number, fn: () => void): { totalMs: number; perOpMs: number } {
  runGc();
  const start = performance.now();
  for (let i = 0; i < iterations; i += 1) {
    fn();
  }
  const totalMs = performance.now() - start;
  return { totalMs, perOpMs: totalMs / iterations };
}

/**
 * Time an async closure across `iterations`, returning total/per-op stats.
 */
async function timeAsync(
  iterations: number,
  fn: () => Promise<void>
): Promise<{ totalMs: number; perOpMs: number }> {
  runGc();
  const start = performance.now();
  for (let i = 0; i < iterations; i += 1) {
    await fn();
  }
  const totalMs = performance.now() - start;
  return { totalMs, perOpMs: totalMs / iterations };
}

function report(
  label: string,
  stats: { totalMs: number; perOpMs: number },
  iterations: number
): void {
  console.log(
    `[data-plane-bench] ${label}: ${stats.perOpMs.toFixed(4)} ms/op ` +
      `(${iterations} ops, ${stats.totalMs.toFixed(1)} ms total)`
  );
}

function reportThroughput(label: string, opsPerSec: number, totalMs: number, ops: number): void {
  console.log(
    `[data-plane-bench] ${label}: ${opsPerSec.toFixed(0)} ops/sec ` +
      `(${ops} ops, ${totalMs.toFixed(1)} ms total)`
  );
}

/**
 * Build a base64-encoded Arrow IPC payload for a single-column ("values") table.
 *
 * Mirrors how the Python bridge ships ndarray/DataFrame columns: a flat Arrow
 * column that the JS codec decodes (and reshapes for ndarrays).
 */
function makeArrowB64(values: ArrayLike<number>): string {
  const table = arrow.tableFromArrays({ values: Float64Array.from(values) });
  const ipc = arrow.tableToIPC(table, 'stream');
  return Buffer.from(ipc).toString('base64');
}

/**
 * Build a base64-encoded multi-column Arrow IPC payload (DataFrame-shaped).
 */
function makeDataframeArrowB64(rows: number, cols: number): string {
  const columns: Record<string, Float64Array> = {};
  for (let c = 0; c < cols; c += 1) {
    const col = new Float64Array(rows);
    for (let r = 0; r < rows; r += 1) {
      col[r] = r * (c + 1) + (r % 7);
    }
    columns[`col_${c}`] = col;
  }
  const table = arrow.tableFromArrays(columns);
  const ipc = arrow.tableToIPC(table, 'stream');
  return Buffer.from(ipc).toString('base64');
}

/**
 * Minimal in-memory Transport that echoes a fixed small response immediately.
 * Lets us measure PooledTransport/TransportPool dispatch overhead without a
 * live Python subprocess.
 */
class InMemoryEchoTransport implements Transport {
  private ready = false;
  private readonly response: string;

  constructor(response: string) {
    this.response = response;
  }

  async init(): Promise<void> {
    this.ready = true;
  }

  async dispose(): Promise<void> {
    this.ready = false;
  }

  get isReady(): boolean {
    return this.ready;
  }

  async send(_message: string, _timeoutMs: number, _signal?: AbortSignal): Promise<string> {
    return this.response;
  }
}

describeBench('Data-plane baseline benchmarks (measure-first, no gating)', () => {
  beforeAll(() => {
    // Register the real apache-arrow IPC decoder so decodeValueAsync works.
    registerArrowDecoder((bytes: Uint8Array): ArrowTable | Uint8Array => {
      return arrow.tableFromIPC(bytes) as unknown as ArrowTable;
    });
  });

  afterAll(() => {
    clearArrowDecoder();
  });

  it(
    'Arrow encode+decode round-trip: ndarray',
    async () => {
      const length = readEnvNumber('TYWRAP_BENCH_NDARRAY_LEN', 1_000);
      const iterations = readEnvNumber('TYWRAP_BENCH_NDARRAY_ITERS', 500);
      const values = Float64Array.from({ length }, (_, i) => i * 1.5);

      // Encode happens once per op (synthetic producer side), decode each time.
      const stats = await timeAsync(iterations, async () => {
        const b64 = makeArrowB64(values);
        const envelope = {
          __tywrap__: 'ndarray',
          codecVersion: 1,
          encoding: 'arrow',
          b64,
          shape: [length],
        };
        const decoded = await decodeValueAsync(envelope);
        expect(Array.isArray(decoded) || ArrayBuffer.isView(decoded)).toBe(true);
      });

      report(`arrow ndarray round-trip (${length} elems)`, stats, iterations);
      expect(stats.totalMs).toBeGreaterThan(0);
    },
    BENCH_TIMEOUT_MS
  );

  it(
    'Arrow encode+decode round-trip: DataFrame',
    async () => {
      const rows = readEnvNumber('TYWRAP_BENCH_DF_ROWS', 1_000);
      const cols = readEnvNumber('TYWRAP_BENCH_DF_COLS', 8);
      const iterations = readEnvNumber('TYWRAP_BENCH_DF_ITERS', 300);

      const stats = await timeAsync(iterations, async () => {
        const b64 = makeDataframeArrowB64(rows, cols);
        const envelope = {
          __tywrap__: 'dataframe',
          codecVersion: 1,
          encoding: 'arrow',
          b64,
        };
        const decoded = await decodeValueAsync(envelope);
        expect(decoded).toBeTruthy();
      });

      report(`arrow dataframe round-trip (${rows}x${cols})`, stats, iterations);
      expect(stats.totalMs).toBeGreaterThan(0);
    },
    BENCH_TIMEOUT_MS
  );

  it(
    '100k-row DataFrame decode latency',
    async () => {
      const rows = readEnvNumber('TYWRAP_BENCH_DF_LARGE_ROWS', 100_000);
      const cols = readEnvNumber('TYWRAP_BENCH_DF_LARGE_COLS', 4);
      const iterations = readEnvNumber('TYWRAP_BENCH_DF_LARGE_ITERS', 20);

      // Build the payload once: we are measuring DECODE latency, not encode.
      const b64 = makeDataframeArrowB64(rows, cols);
      const envelope = {
        __tywrap__: 'dataframe',
        codecVersion: 1,
        encoding: 'arrow',
        b64,
      };

      const stats = await timeAsync(iterations, async () => {
        const decoded = await decodeValueAsync(envelope);
        expect(decoded).toBeTruthy();
      });

      report(`100k-row dataframe decode (${rows}x${cols})`, stats, iterations);
      expect(stats.perOpMs).toBeGreaterThan(0);
    },
    BENCH_TIMEOUT_MS
  );

  it(
    'size-check overhead for ~5MB payload (codec max-bytes guard)',
    () => {
      const targetBytes = readEnvNumber('TYWRAP_BENCH_PAYLOAD_BYTES', 5 * 1024 * 1024);
      const iterations = readEnvNumber('TYWRAP_BENCH_PAYLOAD_ITERS', 100);

      // ~5MB payload that passes the guard (maxPayloadBytes raised above target).
      const codec = new BridgeCodec({ maxPayloadBytes: targetBytes * 2 });
      // A long ASCII string is 1 byte/char under UTF-8, so length ~= byte size.
      const big = 'x'.repeat(targetBytes);
      const payload = JSON.stringify({ id: 1, protocol: 'tywrap/1', result: big });
      const payloadBytes = Buffer.byteLength(payload, 'utf8');

      const stats = timeSync(iterations, () => {
        const decoded = codec.decodeResponse<string>(payload);
        expect(decoded.length).toBe(targetBytes);
      });

      report(`5MB payload decode incl. size guard (${payloadBytes} bytes)`, stats, iterations);
      expect(stats.totalMs).toBeGreaterThan(0);
    },
    BENCH_TIMEOUT_MS
  );

  it(
    'PooledTransport throughput for repeated small calls',
    async () => {
      const totalCalls = readEnvNumber('TYWRAP_BENCH_POOL_CALLS', 10_000);
      const maxWorkers = readEnvNumber('TYWRAP_BENCH_POOL_WORKERS', 4);
      const concurrency = readEnvNumber('TYWRAP_BENCH_POOL_CONCURRENCY', 8);

      const response = JSON.stringify({ id: 1, protocol: 'tywrap/1', result: 'ok' });
      const message = JSON.stringify({
        id: 1,
        protocol: 'tywrap/1',
        method: 'call',
        params: { module: 'm', functionName: 'f', args: [1], kwargs: {} },
      });

      const transport = new PooledTransport({
        createTransport: () => new InMemoryEchoTransport(response),
        maxWorkers,
        maxConcurrentPerWorker: concurrency,
      });
      await transport.init();

      try {
        runGc();
        const start = performance.now();
        // Drive concurrency-wide batches to exercise the pool dispatch path.
        const batch = maxWorkers * concurrency;
        let sent = 0;
        while (sent < totalCalls) {
          const size = Math.min(batch, totalCalls - sent);
          await Promise.all(Array.from({ length: size }, () => transport.send(message, 5_000)));
          sent += size;
        }
        const totalMs = performance.now() - start;
        const opsPerSec = (totalCalls / totalMs) * 1000;

        reportThroughput(
          `pooled transport small calls (workers=${maxWorkers}, conc=${concurrency})`,
          opsPerSec,
          totalMs,
          totalCalls
        );
        expect(totalMs).toBeGreaterThan(0);
      } finally {
        await transport.dispose();
      }
    },
    BENCH_TIMEOUT_MS
  );
});
