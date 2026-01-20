/**
 * WorkerPool - Manages multiple Transport instances for concurrent request handling.
 *
 * Provides semaphore-based concurrency control with configurable limits per worker
 * and a wait queue for callers when all workers are at capacity.
 *
 * @see https://github.com/bbopen/tywrap/issues/149
 */

import { BoundedContext } from './bounded-context.js';
import { BridgeTimeoutError, BridgeExecutionError } from './errors.js';
import type { Transport } from './transport.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Configuration options for the WorkerPool.
 */
export interface WorkerPoolOptions {
  /** Factory function to create transports */
  createTransport: () => Transport;

  /** Maximum number of workers in the pool */
  maxWorkers: number;

  /** Timeout for waiting in queue (ms). Default: 30000 */
  queueTimeoutMs?: number;

  /** Maximum concurrent requests per worker. Default: 1 */
  maxConcurrentPerWorker?: number;
}

/**
 * A pooled worker with its transport and current in-flight request count.
 */
export interface PooledWorker {
  /** The underlying transport instance */
  transport: Transport;

  /** Number of requests currently being processed by this worker */
  inFlightCount: number;
}

/**
 * Internal representation of a waiter in the queue.
 */
interface QueuedWaiter {
  /** Resolve function to fulfill the promise with a worker */
  resolve: (worker: PooledWorker) => void;

  /** Reject function to reject the promise with an error */
  reject: (error: Error) => void;

  /** Timeout timer for queue timeout */
  timer: NodeJS.Timeout;
}

// =============================================================================
// WORKER POOL
// =============================================================================

/**
 * Pool of Transport workers with semaphore-based concurrency control.
 *
 * Features:
 * - Lazy worker creation (workers created on demand)
 * - Configurable concurrency per worker
 * - Wait queue with timeout for callers when pool is at capacity
 * - Automatic cleanup of timers and workers on disposal
 *
 * @example
 * ```typescript
 * const pool = new WorkerPool({
 *   createTransport: () => new ProcessIO({ pythonPath: 'python3' }),
 *   maxWorkers: 4,
 *   maxConcurrentPerWorker: 2,
 *   queueTimeoutMs: 5000,
 * });
 *
 * await pool.init();
 *
 * // Use withWorker for automatic acquire/release
 * const result = await pool.withWorker(async (worker) => {
 *   return worker.transport.send(message, timeout);
 * });
 *
 * await pool.dispose();
 * ```
 */
export class WorkerPool extends BoundedContext {
  private readonly options: Required<WorkerPoolOptions>;
  private readonly workers: PooledWorker[] = [];
  private readonly waitQueue: QueuedWaiter[] = [];

  /**
   * Create a new WorkerPool.
   *
   * @param options - Pool configuration options
   */
  constructor(options: WorkerPoolOptions) {
    super();

    // Validate required options
    if (typeof options.createTransport !== 'function') {
      throw new BridgeExecutionError('createTransport must be a function');
    }
    if (typeof options.maxWorkers !== 'number' || options.maxWorkers < 1) {
      throw new BridgeExecutionError('maxWorkers must be a positive number');
    }

    this.options = {
      createTransport: options.createTransport,
      maxWorkers: options.maxWorkers,
      queueTimeoutMs: options.queueTimeoutMs ?? 30000,
      maxConcurrentPerWorker: options.maxConcurrentPerWorker ?? 1,
    };
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  /**
   * Initialize the pool.
   * Workers are created lazily, so this is a no-op.
   */
  protected async doInit(): Promise<void> {
    // Lazy initialization - workers created on demand in acquire()
  }

  /**
   * Dispose the pool and all workers.
   *
   * - Rejects all waiters in the queue
   * - Disposes all transport instances
   * - Clears internal state
   */
  protected async doDispose(): Promise<void> {
    // Reject all waiters in the queue
    for (const waiter of this.waitQueue) {
      clearTimeout(waiter.timer);
      waiter.reject(new BridgeExecutionError('Pool disposed'));
    }
    this.waitQueue.length = 0;

    // Dispose all workers
    const errors: Error[] = [];
    for (const worker of this.workers) {
      try {
        await worker.transport.dispose();
      } catch (e) {
        errors.push(e instanceof Error ? e : new Error(String(e)));
      }
    }
    this.workers.length = 0;

    // Report errors if any
    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Multiple errors during worker disposal');
    }
  }

  // ===========================================================================
  // WORKER MANAGEMENT
  // ===========================================================================

  /**
   * Acquire a worker from the pool.
   *
   * This method:
   * - Returns an available worker if one exists (inFlightCount < maxConcurrentPerWorker)
   * - Creates a new worker if under the maxWorkers limit
   * - Waits in queue if all workers are at capacity
   *
   * @returns Promise resolving to a pooled worker
   * @throws BridgeTimeoutError if queue timeout expires
   * @throws BridgeExecutionError if pool is disposed while waiting
   */
  async acquire(): Promise<PooledWorker> {
    // Check for disposed state
    if (this.isDisposed) {
      throw new BridgeExecutionError('Pool has been disposed');
    }

    // Find an available worker (one with capacity)
    const availableWorker = this.findAvailableWorker();
    if (availableWorker) {
      availableWorker.inFlightCount++;
      return availableWorker;
    }

    // Create a new worker if under the limit
    if (this.workers.length < this.options.maxWorkers) {
      const newWorker = await this.createWorker();
      newWorker.inFlightCount++;
      return newWorker;
    }

    // All workers at capacity - wait in queue
    return this.waitForWorker();
  }

  /**
   * Release a worker back to the pool.
   *
   * Decrements the worker's in-flight count and notifies any waiters
   * that a worker may be available.
   *
   * @param worker - The worker to release
   */
  release(worker: PooledWorker): void {
    // Validate the worker belongs to this pool
    if (!this.workers.includes(worker)) {
      return;
    }

    // Decrement in-flight count (minimum 0)
    worker.inFlightCount = Math.max(0, worker.inFlightCount - 1);

    // If there are waiters and this worker has capacity, fulfill the first waiter
    if (this.waitQueue.length > 0 && worker.inFlightCount < this.options.maxConcurrentPerWorker) {
      const waiter = this.waitQueue.shift();
      if (waiter) {
        clearTimeout(waiter.timer);
        worker.inFlightCount++;
        waiter.resolve(worker);
      }
    }
  }

  /**
   * Execute a function with an acquired worker, automatically releasing afterward.
   *
   * This is the recommended way to use the pool, as it ensures proper cleanup
   * even if the function throws an error.
   *
   * @param fn - Async function to execute with the worker
   * @returns Promise resolving to the function's return value
   *
   * @example
   * ```typescript
   * const result = await pool.withWorker(async (worker) => {
   *   return worker.transport.send(message, timeout);
   * });
   * ```
   */
  async withWorker<T>(fn: (worker: PooledWorker) => Promise<T>): Promise<T> {
    const worker = await this.acquire();
    try {
      return await fn(worker);
    } finally {
      this.release(worker);
    }
  }

  // ===========================================================================
  // POOL STATISTICS
  // ===========================================================================

  /**
   * Current number of workers in the pool.
   */
  get workerCount(): number {
    return this.workers.length;
  }

  /**
   * Number of callers waiting in the queue.
   */
  get queueLength(): number {
    return this.waitQueue.length;
  }

  /**
   * Total number of in-flight requests across all workers.
   */
  get totalInFlight(): number {
    return this.workers.reduce((sum, w) => sum + w.inFlightCount, 0);
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  /**
   * Find an available worker with capacity for another request.
   */
  private findAvailableWorker(): PooledWorker | undefined {
    return this.workers.find(w => w.inFlightCount < this.options.maxConcurrentPerWorker);
  }

  /**
   * Create a new worker and add it to the pool.
   */
  private async createWorker(): Promise<PooledWorker> {
    const transport = this.options.createTransport();

    // Initialize the transport
    await transport.init();

    const worker: PooledWorker = {
      transport,
      inFlightCount: 0,
    };

    this.workers.push(worker);
    return worker;
  }

  /**
   * Wait in queue for a worker to become available.
   */
  private waitForWorker(): Promise<PooledWorker> {
    return new Promise<PooledWorker>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Remove this waiter from the queue
        const index = this.waitQueue.findIndex(w => w.timer === timer);
        if (index !== -1) {
          this.waitQueue.splice(index, 1);
        }
        reject(
          new BridgeTimeoutError(
            `Timed out waiting for available worker after ${this.options.queueTimeoutMs}ms`
          )
        );
      }, this.options.queueTimeoutMs);

      // Unref the timer so it doesn't keep the Node.js process alive
      if (typeof timer.unref === 'function') {
        timer.unref();
      }

      this.waitQueue.push({ resolve, reject, timer });
    });
  }

  // ===========================================================================
  // RUNTIME EXECUTION (Not implemented - WorkerPool is just for worker management)
  // ===========================================================================

  /**
   * Not implemented - WorkerPool does not execute Python calls directly.
   * Use the BridgeProtocol layer with a pooled worker's transport.
   */
  async call<T = unknown>(
    _module: string,
    _functionName: string,
    _args: unknown[],
    _kwargs?: Record<string, unknown>
  ): Promise<T> {
    throw new BridgeExecutionError(
      'WorkerPool does not implement call() - use withWorker() to get a transport'
    );
  }

  /**
   * Not implemented - WorkerPool does not execute Python calls directly.
   */
  async instantiate<T = unknown>(
    _module: string,
    _className: string,
    _args: unknown[],
    _kwargs?: Record<string, unknown>
  ): Promise<T> {
    throw new BridgeExecutionError(
      'WorkerPool does not implement instantiate() - use withWorker() to get a transport'
    );
  }

  /**
   * Not implemented - WorkerPool does not execute Python calls directly.
   */
  async callMethod<T = unknown>(
    _handle: string,
    _methodName: string,
    _args: unknown[],
    _kwargs?: Record<string, unknown>
  ): Promise<T> {
    throw new BridgeExecutionError(
      'WorkerPool does not implement callMethod() - use withWorker() to get a transport'
    );
  }

  /**
   * Not implemented - WorkerPool does not execute Python calls directly.
   */
  async disposeInstance(_handle: string): Promise<void> {
    throw new BridgeExecutionError(
      'WorkerPool does not implement disposeInstance() - use withWorker() to get a transport'
    );
  }
}
