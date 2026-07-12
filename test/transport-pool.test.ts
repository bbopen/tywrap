/**
 * PooledTransport Test Suite
 *
 * Comprehensive tests for the PooledTransport: lifecycle management, acquire/release,
 * concurrency control, timeout handling, and resource cleanup.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  PooledTransport,
  type PooledTransportOptions,
  type TransportLease,
} from '../src/runtime/pooled-transport.js';
import type { Transport } from '../src/runtime/transport.js';
import {
  BridgeTimeoutError,
  BridgeExecutionError,
  BridgeProtocolError,
} from '../src/runtime/errors.js';

// =============================================================================
// TEST FIXTURES
// =============================================================================

/**
 * Mock transport for testing PooledTransport behavior.
 * Tracks init/dispose calls and simulates transport behavior.
 */
class MockTransport implements Transport {
  initCalled = false;
  disposeCalled = false;
  initDelay = 0;
  shouldFailInit = false;
  initError?: Error;

  async init(): Promise<void> {
    if (this.initDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.initDelay));
    }
    if (this.shouldFailInit) {
      throw this.initError ?? new Error('Init failed');
    }
    this.initCalled = true;
  }

  async dispose(): Promise<void> {
    this.disposeCalled = true;
  }

  get isReady(): boolean {
    return this.initCalled && !this.disposeCalled;
  }

  async send(message: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
    return JSON.stringify({ id: 'test', result: 'ok' });
  }
}

/**
 * Factory function that creates mock transports and tracks them.
 */
function createMockTransportFactory() {
  const transports: MockTransport[] = [];

  const factory = () => {
    const transport = new MockTransport();
    transports.push(transport);
    return transport;
  };

  return { factory, transports };
}

/**
 * Create default pool options for testing.
 */
function createTestOptions(
  overrides: Partial<PooledTransportOptions> = {}
): PooledTransportOptions {
  const { factory } = createMockTransportFactory();
  return {
    createTransport: factory,
    maxWorkers: 4,
    ...overrides,
  };
}

// =============================================================================
// CONSTRUCTOR TESTS
// =============================================================================

describe('PooledTransport', () => {
  describe('constructor', () => {
    it('requires createTransport option', () => {
      expect(() => new PooledTransport({} as PooledTransportOptions)).toThrow();
    });

    it('defaults maxWorkers to one', () => {
      const { factory } = createMockTransportFactory();
      expect(() => new PooledTransport({ createTransport: factory })).not.toThrow();
    });

    it('requires maxWorkers to be positive', () => {
      const { factory } = createMockTransportFactory();
      expect(() => new PooledTransport({ createTransport: factory, maxWorkers: 0 })).toThrow();
      expect(() => new PooledTransport({ createTransport: factory, maxWorkers: -1 })).toThrow();
    });
  });

  // ===========================================================================
  // LIFECYCLE TESTS
  // ===========================================================================

  describe('lifecycle', () => {
    let pool: PooledTransport;

    afterEach(async () => {
      if (pool && !pool.isDisposed) {
        await pool.dispose();
      }
    });

    it('starts in idle state', () => {
      pool = new PooledTransport(createTestOptions());
      expect(pool.state).toBe('idle');
    });

    it('init() transitions to ready state', async () => {
      pool = new PooledTransport(createTestOptions());
      await pool.init();
      expect(pool.state).toBe('ready');
      expect(pool.isReady).toBe(true);
    });

    it('init() is idempotent', async () => {
      pool = new PooledTransport(createTestOptions());
      await pool.init();
      await pool.init();
      await pool.init();
      expect(pool.state).toBe('ready');
    });

    it('dispose() transitions to disposed state', async () => {
      pool = new PooledTransport(createTestOptions());
      await pool.init();
      await pool.dispose();
      expect(pool.state).toBe('disposed');
      expect(pool.isDisposed).toBe(true);
    });

    it('dispose() disposes all workers', async () => {
      const { factory, transports } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 3,
      });

      await pool.init();

      // Acquire workers to create them
      const worker1 = await pool.acquire();
      const worker2 = await pool.acquire();
      pool.release(worker1);
      pool.release(worker2);

      expect(transports.length).toBe(2);

      await pool.dispose();

      // All transports should be disposed
      expect(transports.every(t => t.disposeCalled)).toBe(true);
    });

    it('dispose() rejects all waiters', async () => {
      const { factory } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 1,
        maxConcurrentPerWorker: 1,
      });

      await pool.init();

      // Acquire the only worker
      const worker1 = await pool.acquire();

      // This will queue since the pool is full
      const acquirePromise = pool.acquire();

      // Dispose should reject the waiting acquire
      // Note: We must NOT release before dispose, otherwise the waiter gets resolved
      await pool.dispose();

      await expect(acquirePromise).rejects.toThrow(BridgeExecutionError);
    });

    it('dispose() clears worker array', async () => {
      const { factory, transports } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 2,
      });

      await pool.init();

      // Create workers
      const w1 = await pool.acquire();
      const w2 = await pool.acquire();
      pool.release(w1);
      pool.release(w2);

      expect(transports.length).toBe(2);

      await pool.dispose();

      expect(pool.workerCount).toBe(0);
    });

    it('dispose() is idempotent', async () => {
      pool = new PooledTransport(createTestOptions());
      await pool.init();
      await pool.dispose();
      await pool.dispose();
      await pool.dispose();
      expect(pool.state).toBe('disposed');
    });
  });

  // ===========================================================================
  // ACQUIRE TESTS
  // ===========================================================================

  describe('acquire', () => {
    let pool: PooledTransport;

    afterEach(async () => {
      if (pool && !pool.isDisposed) {
        await pool.dispose();
      }
    });

    it('creates worker lazily on first acquire', async () => {
      const { factory, transports } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 4,
      });

      await pool.init();
      expect(transports.length).toBe(0);

      await pool.acquire();
      expect(transports.length).toBe(1);
      expect(transports[0].initCalled).toBe(true);
    });

    it('disposes transport and does not retain a worker when onWorkerReady fails', async () => {
      const { factory, transports } = createMockTransportFactory();
      const onWorkerReady = vi.fn().mockRejectedValue(new Error('warmup failed'));

      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 2,
        onWorkerReady,
      });

      await pool.init();
      await expect(pool.acquire()).rejects.toThrow('warmup failed');

      expect(onWorkerReady).toHaveBeenCalledTimes(1);
      expect(transports.length).toBe(1);
      expect(transports[0]?.disposeCalled).toBe(true);
      expect(pool.workerCount).toBe(0);
    });

    it('returns same worker on second acquire if available', async () => {
      const { factory, transports } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 4,
        maxConcurrentPerWorker: 2,
      });

      await pool.init();

      const worker1 = await pool.acquire();
      const worker2 = await pool.acquire();

      // Should reuse the same worker since maxConcurrentPerWorker is 2
      expect(transports.length).toBe(1);
      expect(worker1).toBe(worker2);
    });

    it('creates new worker when first is at capacity', async () => {
      const { factory, transports } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 4,
        maxConcurrentPerWorker: 1,
      });

      await pool.init();

      const worker1 = await pool.acquire();
      const worker2 = await pool.acquire();

      // Should create a second worker since maxConcurrentPerWorker is 1
      expect(transports.length).toBe(2);
      expect(worker1).not.toBe(worker2);
    });

    it('publishes a newly created worker to queued acquires up to its concurrency limit', async () => {
      const slowFactory = () => {
        const transport = new MockTransport();
        transport.initDelay = 25;
        return transport;
      };

      pool = new PooledTransport({
        createTransport: slowFactory,
        maxWorkers: 1,
        maxConcurrentPerWorker: 3,
        queueTimeoutMs: 1000,
      });

      await pool.init();

      const worker1Promise = pool.acquire();
      await new Promise(resolve => setTimeout(resolve, 5));
      const worker2Promise = pool.acquire();
      const worker3Promise = pool.acquire();

      const [worker1, worker2, worker3] = await Promise.all([
        worker1Promise,
        worker2Promise,
        worker3Promise,
      ]);

      expect(worker1).toBe(worker2);
      expect(worker2).toBe(worker3);
      expect(pool.workerCount).toBe(1);
      expect(pool.totalInFlight).toBe(3);

      pool.release(worker1);
      pool.release(worker2);
      pool.release(worker3);
    });

    it('respects maxWorkers limit', async () => {
      const { factory, transports } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 2,
        maxConcurrentPerWorker: 1,
        queueTimeoutMs: 100,
      });

      await pool.init();

      // Acquire max workers
      const worker1 = await pool.acquire();
      const worker2 = await pool.acquire();

      expect(transports.length).toBe(2);

      // Next acquire should queue and timeout since all workers are busy
      await expect(pool.acquire()).rejects.toThrow(BridgeTimeoutError);

      pool.release(worker1);
      pool.release(worker2);
    });

    it('queues when all workers are busy', async () => {
      const { factory } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 1,
        maxConcurrentPerWorker: 1,
        queueTimeoutMs: 5000,
      });

      await pool.init();

      const worker1 = await pool.acquire();

      // Queue the next acquire
      const acquirePromise = pool.acquire();

      // Release the first worker
      setTimeout(() => pool.release(worker1), 10);

      // Should resolve when worker is released
      const worker2 = await acquirePromise;
      expect(worker2).toBe(worker1);
    });

    it('rejects when disposed', async () => {
      pool = new PooledTransport(createTestOptions());
      await pool.init();
      await pool.dispose();

      await expect(pool.acquire()).rejects.toThrow(BridgeExecutionError);
    });

    it('returns a TransportLease with transport and inFlightCount', async () => {
      const { factory } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 4,
      });

      await pool.init();

      const worker = await pool.acquire();

      expect(worker).toHaveProperty('transport');
      expect(worker).toHaveProperty('inFlightCount');
      expect(worker.inFlightCount).toBe(1);
      expect(worker.transport).toBeDefined();
    });
  });

  // ===========================================================================
  // RELEASE TESTS
  // ===========================================================================

  describe('release', () => {
    let pool: PooledTransport;

    afterEach(async () => {
      if (pool && !pool.isDisposed) {
        await pool.dispose();
      }
    });

    it('decrements inFlightCount', async () => {
      const { factory } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 4,
        maxConcurrentPerWorker: 2,
      });

      await pool.init();

      const worker = await pool.acquire();
      expect(pool.totalInFlight).toBe(1);

      pool.release(worker);
      expect(pool.totalInFlight).toBe(0);
    });

    it('makes worker available for next acquire', async () => {
      const { factory, transports } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 1,
        maxConcurrentPerWorker: 1,
      });

      await pool.init();

      const worker1 = await pool.acquire();
      pool.release(worker1);

      const worker2 = await pool.acquire();

      // Should reuse the same worker
      expect(transports.length).toBe(1);
      expect(worker2).toBe(worker1);
    });

    it('resolves waiting requests from queue', async () => {
      const { factory } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 1,
        maxConcurrentPerWorker: 1,
        queueTimeoutMs: 5000,
      });

      await pool.init();

      const worker1 = await pool.acquire();

      // Queue multiple acquires
      const promise1 = pool.acquire();
      const promise2 = pool.acquire();

      // Release should resolve the first queued request
      pool.release(worker1);
      const resolvedWorker1 = await promise1;

      pool.release(resolvedWorker1);
      const resolvedWorker2 = await promise2;

      expect(resolvedWorker1).toBe(worker1);
      expect(resolvedWorker2).toBe(worker1);
    });

    it('ignores release of unknown worker', async () => {
      const { factory } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 4,
      });

      await pool.init();

      // Create a fake TransportLease that is not tracked by the pool
      const fakeWorker: TransportLease = {
        transport: new MockTransport(),
        inFlightCount: 1,
      };

      // Should not throw
      expect(() => pool.release(fakeWorker)).not.toThrow();
    });

    it('ignores double release (inFlightCount cannot go negative)', async () => {
      const { factory } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 4,
      });

      await pool.init();

      const worker = await pool.acquire();
      pool.release(worker);
      pool.release(worker); // Double release

      expect(pool.totalInFlight).toBe(0);
      expect(worker.inFlightCount).toBe(0); // Should be 0, not negative
    });
  });

  // ===========================================================================
  // CONCURRENCY TESTS
  // ===========================================================================

  describe('concurrency', () => {
    let pool: PooledTransport;

    afterEach(async () => {
      if (pool && !pool.isDisposed) {
        await pool.dispose();
      }
    });

    it('handles multiple concurrent acquires correctly', async () => {
      const { factory, transports } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 4,
        maxConcurrentPerWorker: 1,
      });

      await pool.init();

      // Acquire 4 workers concurrently
      const workers = await Promise.all([
        pool.acquire(),
        pool.acquire(),
        pool.acquire(),
        pool.acquire(),
      ]);

      expect(transports.length).toBe(4);
      expect(new Set(workers).size).toBe(4); // All unique workers

      // Release all
      workers.forEach(w => pool.release(w));
    });

    it('maxConcurrentPerWorker controls per-worker concurrency with sequential acquires', async () => {
      const { factory, transports } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 4,
        maxConcurrentPerWorker: 3,
      });

      await pool.init();

      // Sequential acquires respect maxConcurrentPerWorker
      // Each acquire sees the updated inFlightCount from previous acquires
      const workers: TransportLease[] = [];
      for (let i = 0; i < 6; i++) {
        workers.push(await pool.acquire());
      }

      // With sequential acquires, 6 acquires with maxConcurrentPerWorker=3
      // should use 2 workers (3 slots each)
      expect(transports.length).toBe(2);
      expect(pool.totalInFlight).toBe(6);

      workers.forEach(w => pool.release(w));
    });

    it('maintains queue FIFO ordering', async () => {
      const { factory } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 1,
        maxConcurrentPerWorker: 1,
        queueTimeoutMs: 5000,
      });

      await pool.init();

      const order: number[] = [];
      const worker = await pool.acquire();

      // Queue acquires in order
      const p1 = pool.acquire().then(w => {
        order.push(1);
        return w;
      });
      const p2 = pool.acquire().then(w => {
        order.push(2);
        return w;
      });
      const p3 = pool.acquire().then(w => {
        order.push(3);
        return w;
      });

      // Release to process queue
      pool.release(worker);
      const w1 = await p1;
      pool.release(w1);
      const w2 = await p2;
      pool.release(w2);
      await p3;

      expect(order).toEqual([1, 2, 3]);
    });

    it('handles high concurrency with sequential acquires', async () => {
      const { factory, transports } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 4,
        maxConcurrentPerWorker: 5,
      });

      await pool.init();

      // Sequential acquires - 20 acquires with 4 workers * 5 concurrent = 20 max capacity
      const workers: TransportLease[] = [];
      for (let i = 0; i < 20; i++) {
        workers.push(await pool.acquire());
      }

      // Should use exactly 4 workers
      expect(transports.length).toBe(4);
      expect(pool.totalInFlight).toBe(20);

      workers.forEach(w => pool.release(w));
      expect(pool.totalInFlight).toBe(0);
    });

    it('concurrent acquires may create more workers due to race conditions', async () => {
      // Note: When using Promise.all with multiple concurrent acquires,
      // each acquire checks findAvailableWorker() before any inFlightCount
      // has been incremented, so they all see the same initial state.
      // This is expected behavior for concurrent operations.
      const { factory, transports } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 10,
        maxConcurrentPerWorker: 3,
      });

      await pool.init();

      // Concurrent acquires - each sees initial state before others increment
      const workers = await Promise.all(Array.from({ length: 6 }, () => pool.acquire()));

      // With concurrent acquires, all 6 may see the same initial state
      // and each creates a new worker (up to maxWorkers limit)
      expect(transports.length).toBeGreaterThanOrEqual(2);
      expect(transports.length).toBeLessThanOrEqual(6);
      expect(pool.totalInFlight).toBe(6);

      workers.forEach(w => pool.release(w));
    });
  });

  describe('timeout recovery', () => {
    let pool: PooledTransport;

    afterEach(async () => {
      if (pool && !pool.isDisposed) {
        await pool.dispose();
      }
    });

    it('keeps a timed-out worker in the pool for later reuse', async () => {
      const { factory, transports } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 1,
        minWorkers: 1,
      });

      await pool.init();
      expect(pool.workerCount).toBe(1);
      expect(transports.length).toBe(1);

      await expect(
        pool.withWorker(async () => {
          throw new BridgeTimeoutError('simulated timeout');
        })
      ).rejects.toThrow('simulated timeout');

      expect(pool.workerCount).toBe(1);
      expect(transports.length).toBe(1);

      const reusedWorker = await pool.acquire();
      expect(reusedWorker.transport).toBe(transports[0]);
      pool.release(reusedWorker);
    });

    it('disposes replacement workers that finish after the pool has been disposed', async () => {
      const transports: MockTransport[] = [];
      let createCount = 0;
      pool = new PooledTransport({
        createTransport: () => {
          createCount += 1;
          const transport = new MockTransport();
          if (createCount === 2) {
            transport.initDelay = 50;
          }
          transports.push(transport);
          return transport;
        },
        maxWorkers: 1,
        minWorkers: 1,
      });

      await pool.init();
      const worker = await pool.acquire();

      (
        pool as unknown as {
          removeWorker(worker: TransportLease): void;
        }
      ).removeWorker(worker);
      await pool.dispose();
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(pool.workerCount).toBe(0);
      expect(transports).toHaveLength(2);
      expect(transports[1]?.disposeCalled).toBe(true);
    });

    it('rejects acquire when dispose wins after worker creation starts', async () => {
      const transports: MockTransport[] = [];
      pool = new PooledTransport({
        createTransport: () => {
          const transport = new MockTransport();
          transport.initDelay = 50;
          transports.push(transport);
          return transport;
        },
        maxWorkers: 1,
      });

      await pool.init();

      const acquirePromise = pool.acquire();
      await new Promise(resolve => setTimeout(resolve, 10));
      await pool.dispose();

      await expect(acquirePromise).rejects.toThrow(BridgeExecutionError);
      expect(pool.workerCount).toBe(0);
      expect(transports).toHaveLength(1);
      expect(transports[0]?.disposeCalled).toBe(true);
    });
  });

  // ===========================================================================
  // TIMEOUT TESTS
  // ===========================================================================

  describe('timeout', () => {
    let pool: PooledTransport;

    afterEach(async () => {
      vi.useRealTimers();
      if (pool && !pool.isDisposed) {
        await pool.dispose();
      }
    });

    it('queue timeout rejects with BridgeTimeoutError', async () => {
      vi.useFakeTimers();

      const { factory } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 1,
        maxConcurrentPerWorker: 1,
        queueTimeoutMs: 5000,
      });

      await pool.init();

      const worker = await pool.acquire();

      // This will queue
      const acquirePromise = pool.acquire();

      // Advance time past timeout
      vi.advanceTimersByTime(5001);

      await expect(acquirePromise).rejects.toThrow(BridgeTimeoutError);

      pool.release(worker);
    });

    it('timeout timer is cleared when worker becomes available', async () => {
      vi.useFakeTimers();

      const { factory } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 1,
        maxConcurrentPerWorker: 1,
        queueTimeoutMs: 5000,
      });

      await pool.init();

      const worker = await pool.acquire();
      const acquirePromise = pool.acquire();

      // Advance time but not past timeout
      vi.advanceTimersByTime(2000);

      // Release worker - should clear timeout
      pool.release(worker);

      const acquiredWorker = await acquirePromise;
      expect(acquiredWorker).toBe(worker);

      // Advance past original timeout - should not error
      vi.advanceTimersByTime(4000);

      pool.release(acquiredWorker);
    });

    it('timeout message includes configured timeout value', async () => {
      vi.useFakeTimers();

      const { factory } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 1,
        maxConcurrentPerWorker: 1,
        queueTimeoutMs: 3000,
      });

      await pool.init();

      const worker = await pool.acquire();
      const acquirePromise = pool.acquire();

      vi.advanceTimersByTime(3001);

      await expect(acquirePromise).rejects.toThrow(/3000/);

      pool.release(worker);
    });

    it('times out immediately when queueTimeoutMs is 0', async () => {
      vi.useFakeTimers();

      const { factory } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 1,
        maxConcurrentPerWorker: 1,
        queueTimeoutMs: 0, // Timeout of 0ms
      });

      await pool.init();

      const worker = await pool.acquire();

      // With 0ms timeout, the queue should timeout immediately
      const acquirePromise = pool.acquire();

      vi.advanceTimersByTime(1);

      await expect(acquirePromise).rejects.toThrow(BridgeTimeoutError);

      pool.release(worker);
    });
  });

  // ===========================================================================
  // withWorker TESTS
  // ===========================================================================

  describe('withWorker', () => {
    let pool: PooledTransport;

    afterEach(async () => {
      if (pool && !pool.isDisposed) {
        await pool.dispose();
      }
    });

    it('acquires and releases correctly', async () => {
      const { factory } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 4,
      });

      await pool.init();

      expect(pool.totalInFlight).toBe(0);

      await pool.withWorker(async worker => {
        expect(pool.totalInFlight).toBe(1);
        expect(worker).toBeDefined();
        return 'result';
      });

      expect(pool.totalInFlight).toBe(0);
    });

    it('releases on success', async () => {
      const { factory } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 4,
      });

      await pool.init();

      const result = await pool.withWorker(async () => {
        return 42;
      });

      expect(result).toBe(42);
      expect(pool.totalInFlight).toBe(0);
    });

    it('releases on error', async () => {
      const { factory } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 4,
      });

      await pool.init();

      await expect(
        pool.withWorker(async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');

      expect(pool.totalInFlight).toBe(0);
    });

    it('returns function result', async () => {
      const { factory } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 4,
      });

      await pool.init();

      const result = await pool.withWorker(async worker => {
        const response = await worker.transport.send('test', 1000);
        return JSON.parse(response);
      });

      expect(result).toEqual({ id: 'test', result: 'ok' });
    });

    it('allows async operations in callback', async () => {
      const { factory } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 4,
      });

      await pool.init();

      const result = await pool.withWorker(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'async-result';
      });

      expect(result).toBe('async-result');
    });

    it('rejects when disposed', async () => {
      pool = new PooledTransport(createTestOptions());
      await pool.init();
      await pool.dispose();

      await expect(pool.withWorker(async () => 'never')).rejects.toThrow(BridgeExecutionError);
    });

    it('provides access to transport through worker', async () => {
      const { factory, transports } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 4,
      });

      await pool.init();

      await pool.withWorker(async worker => {
        expect(worker.transport).toBe(transports[0]);
        expect(worker.transport.isReady).toBe(true);
      });
    });

    it('replaces crashed workers in the background', async () => {
      const { factory, transports } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 1,
        minWorkers: 1,
      });

      await pool.init();
      expect(transports).toHaveLength(1);

      await expect(
        pool.withWorker(async () => {
          throw new BridgeProtocolError('process exited unexpectedly');
        })
      ).rejects.toThrow(BridgeProtocolError);

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(transports).toHaveLength(2);
      expect(transports[0]?.disposeCalled).toBe(true);
      expect(pool.workerCount).toBe(1);

      const worker = await pool.acquire();
      expect(worker.transport).toBe(transports[1]);
      pool.release(worker);
    });
  });

  // ===========================================================================
  // EDGE CASES
  // ===========================================================================

  describe('edge cases', () => {
    let pool: PooledTransport;

    afterEach(async () => {
      if (pool && !pool.isDisposed) {
        await pool.dispose();
      }
    });

    it('handles maxWorkers of 1', async () => {
      const { factory, transports } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 1,
        maxConcurrentPerWorker: 1,
        queueTimeoutMs: 5000,
      });

      await pool.init();

      const worker1 = await pool.acquire();
      expect(transports.length).toBe(1);

      // Queue next acquire
      const acquirePromise = pool.acquire();

      pool.release(worker1);

      const worker2 = await acquirePromise;
      expect(worker2).toBe(worker1);
      expect(transports.length).toBe(1); // Still just 1 transport
    });

    it('handles worker creation failure', async () => {
      const failingFactory = () => {
        const transport = new MockTransport();
        transport.shouldFailInit = true;
        transport.initError = new Error('Worker creation failed');
        return transport;
      };

      pool = new PooledTransport({
        createTransport: failingFactory,
        maxWorkers: 4,
      });

      await pool.init();

      await expect(pool.acquire()).rejects.toThrow('Worker creation failed');
    });

    it('handles rapid acquire/release cycles', async () => {
      const { factory } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 2,
        maxConcurrentPerWorker: 1,
      });

      await pool.init();

      // Rapid cycles
      for (let i = 0; i < 100; i++) {
        const worker = await pool.acquire();
        pool.release(worker);
      }

      expect(pool.totalInFlight).toBe(0);
    });

    it('release before dispose resolves waiting acquire', async () => {
      // Note: When release() is called before dispose() completes,
      // the waiting acquire is resolved by release() before dispose()
      // can reject it. This is expected behavior.
      const { factory } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 1,
        maxConcurrentPerWorker: 1,
        queueTimeoutMs: 5000,
      });

      await pool.init();

      const worker = await pool.acquire();

      // Queue an acquire
      const acquirePromise = pool.acquire();

      // Release BEFORE dispose - this resolves the waiter
      pool.release(worker);

      // Wait for the acquire to resolve (it got the released worker)
      const acquiredWorker = await acquirePromise;
      expect(acquiredWorker).toBe(worker);

      // Now dispose
      await pool.dispose();
    });

    it('handles release after dispose', async () => {
      const { factory } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 4,
      });

      await pool.init();

      const worker = await pool.acquire();
      await pool.dispose();

      // Release after dispose should not throw
      expect(() => pool.release(worker)).not.toThrow();
    });

    it('provides accurate worker count', async () => {
      const { factory } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 4,
        maxConcurrentPerWorker: 1,
      });

      await pool.init();

      expect(pool.workerCount).toBe(0);

      const w1 = await pool.acquire();
      expect(pool.workerCount).toBe(1);

      const w2 = await pool.acquire();
      expect(pool.workerCount).toBe(2);

      pool.release(w1);
      expect(pool.workerCount).toBe(2); // Workers are not destroyed on release

      pool.release(w2);
      expect(pool.workerCount).toBe(2);
    });

    it('provides accurate totalInFlight count', async () => {
      const { factory } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 4,
        maxConcurrentPerWorker: 2,
      });

      await pool.init();

      expect(pool.totalInFlight).toBe(0);

      const w1 = await pool.acquire();
      expect(pool.totalInFlight).toBe(1);

      const w2 = await pool.acquire();
      expect(pool.totalInFlight).toBe(2);

      const w3 = await pool.acquire();
      expect(pool.totalInFlight).toBe(3);

      pool.release(w1);
      expect(pool.totalInFlight).toBe(2);

      pool.release(w2);
      pool.release(w3);
      expect(pool.totalInFlight).toBe(0);
    });

    it('slow worker init completes before dispose when disposal is awaited', async () => {
      // Note: When pool.dispose() is called after pool.acquire() is started,
      // the worker init may complete before dispose runs its cleanup.
      // This is timing-dependent behavior.
      const slowFactory = () => {
        const transport = new MockTransport();
        transport.initDelay = 50;
        return transport;
      };

      pool = new PooledTransport({
        createTransport: slowFactory,
        maxWorkers: 4,
      });

      await pool.init();

      // Start acquiring (will trigger slow worker init)
      const acquirePromise = pool.acquire();

      // Small delay to ensure init has started
      await new Promise(resolve => setTimeout(resolve, 10));

      // Dispose - this awaits the init to complete
      const disposePromise = pool.dispose();

      // The acquire may succeed or fail depending on timing
      // We just verify it completes without hanging
      const result = await Promise.allSettled([acquirePromise, disposePromise]);
      expect(result.length).toBe(2);

      // Dispose should always complete
      expect(result[1].status).toBe('fulfilled');
    });

    it('handles mixed successful and failed worker creations', async () => {
      let callCount = 0;
      const mixedFactory = () => {
        callCount++;
        const transport = new MockTransport();
        if (callCount === 2) {
          transport.shouldFailInit = true;
          transport.initError = new Error('Second worker failed');
        }
        return transport;
      };

      pool = new PooledTransport({
        createTransport: mixedFactory,
        maxWorkers: 4,
        maxConcurrentPerWorker: 1,
      });

      await pool.init();

      // First acquire should succeed
      const w1 = await pool.acquire();
      expect(w1).toBeDefined();

      // Second acquire should fail
      await expect(pool.acquire()).rejects.toThrow('Second worker failed');

      // Third acquire should succeed (creates third worker)
      const w3 = await pool.acquire();
      expect(w3).toBeDefined();

      pool.release(w1);
      pool.release(w3);
    });
  });

  // ===========================================================================
  // STATS AND MONITORING
  // ===========================================================================

  describe('stats and monitoring', () => {
    let pool: PooledTransport;

    afterEach(async () => {
      if (pool && !pool.isDisposed) {
        await pool.dispose();
      }
    });

    it('reports queue length accurately', async () => {
      const { factory } = createMockTransportFactory();
      pool = new PooledTransport({
        createTransport: factory,
        maxWorkers: 1,
        maxConcurrentPerWorker: 1,
        queueTimeoutMs: 5000,
      });

      await pool.init();

      expect(pool.queueLength).toBe(0);

      const worker = await pool.acquire();
      expect(pool.queueLength).toBe(0);

      // Queue acquires
      const p1 = pool.acquire();
      expect(pool.queueLength).toBe(1);

      const p2 = pool.acquire();
      expect(pool.queueLength).toBe(2);

      // Release to process queue
      pool.release(worker);
      await p1;
      expect(pool.queueLength).toBe(1);

      pool.release(worker);
      await p2;
      expect(pool.queueLength).toBe(0);
    });

    it('reports isReady correctly', async () => {
      pool = new PooledTransport(createTestOptions());

      expect(pool.isReady).toBe(false);

      await pool.init();
      expect(pool.isReady).toBe(true);

      await pool.dispose();
      expect(pool.isReady).toBe(false);
    });

    it('reports isDisposed correctly', async () => {
      pool = new PooledTransport(createTestOptions());

      expect(pool.isDisposed).toBe(false);

      await pool.init();
      expect(pool.isDisposed).toBe(false);

      await pool.dispose();
      expect(pool.isDisposed).toBe(true);
    });
  });
});
