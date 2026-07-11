/**
 * PooledTransport - Manages multiple Transport instances for concurrent request handling.
 *
 * Provides semaphore-based concurrency control with configurable limits per worker
 * and a wait queue for callers when all workers are at capacity.
 *
 * @see https://github.com/bbopen/tywrap/issues/149
 */

import { DisposableBase } from './bounded-context.js';
import {
  BridgeDisposedError,
  BridgeTimeoutError,
  BridgeExecutionError,
  BridgeProtocolError,
} from './errors.js';
import type { Transport, TransportCapabilities } from './transport.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Configuration options for the PooledTransport.
 */
export interface PooledTransportOptions {
  /** Factory function to create transports */
  createTransport: () => Transport;

  /** Maximum number of workers in the pool */
  maxWorkers?: number;

  /** Minimum number of workers to pre-spawn during init. Default: 0 (lazy) */
  minWorkers?: number;

  /** Timeout for waiting in queue (ms). Default: 30000 */
  queueTimeoutMs?: number;

  /** Maximum concurrent requests per worker. Default: 1 */
  maxConcurrentPerWorker?: number;

  /**
   * Callback invoked after each worker is created and initialized.
   * Use this for per-worker warmup (e.g., importing modules, running setup).
   */
  onWorkerReady?: (worker: TransportLease) => Promise<void>;

  /**
   * Optional callback used only for background replacement workers after a
   * fatal timeout/crash. This lets callers publish a replacement only after it
   * is proven ready, without charging hidden work to normal request startup.
   */
  onReplacementWorkerReady?: (worker: TransportLease) => Promise<void>;
}

/**
 * A pooled worker with its transport and current in-flight request count.
 */
export interface TransportLease {
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
  resolve: (worker: TransportLease) => void;

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
 * const pool = new PooledTransport({
 *   createTransport: () => new SubprocessTransport({ pythonPath: 'python3' }),
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
export class PooledTransport extends DisposableBase implements Transport {
  private readonly options: Omit<
    Required<PooledTransportOptions>,
    'onWorkerReady' | 'onReplacementWorkerReady'
  > & {
    onWorkerReady?: (worker: TransportLease) => Promise<void>;
    onReplacementWorkerReady?: (worker: TransportLease) => Promise<void>;
  };
  private readonly workers: TransportLease[] = [];
  private readonly waitQueue: QueuedWaiter[] = [];
  /** Tracks workers being created to prevent race condition in acquire() */
  private pendingCreations = 0;
  private cachedCapabilities?: TransportCapabilities;

  /**
   * Create a new PooledTransport.
   *
   * @param options - Pool configuration options
   */
  constructor(options: PooledTransportOptions) {
    super();

    // Validate required options
    if (typeof options.createTransport !== 'function') {
      throw new BridgeExecutionError('createTransport must be a function');
    }
    const maxWorkers = options.maxWorkers ?? 1;
    if (typeof maxWorkers !== 'number' || maxWorkers < 1) {
      throw new BridgeExecutionError('maxWorkers must be a positive number');
    }

    const minWorkers = options.minWorkers ?? 0;
    if (minWorkers > maxWorkers) {
      throw new BridgeExecutionError('minWorkers cannot exceed maxWorkers');
    }

    this.options = {
      createTransport: options.createTransport,
      maxWorkers,
      minWorkers,
      queueTimeoutMs: options.queueTimeoutMs ?? 30000,
      maxConcurrentPerWorker: options.maxConcurrentPerWorker ?? 1,
      onWorkerReady: options.onWorkerReady,
      onReplacementWorkerReady: options.onReplacementWorkerReady,
    };
  }

  async send(
    message: string,
    timeoutMs: number,
    signal?: AbortSignal,
    requestId?: number
  ): Promise<string> {
    if (this.isDisposed) {
      throw new BridgeDisposedError('Transport has been disposed');
    }
    if (!this.isReady) {
      await this.init();
    }
    return this.withWorker(worker => worker.transport.send(message, timeoutMs, signal, requestId));
  }

  capabilities(): TransportCapabilities {
    this.cachedCapabilities ??= this.options.createTransport().capabilities();
    return this.cachedCapabilities;
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  /**
   * Initialize the pool.
   *
   * If minWorkers > 0, pre-spawns workers during initialization.
   * Otherwise, workers are created lazily on demand.
   */
  protected async doInit(): Promise<void> {
    // Pre-spawn minimum workers if configured
    await this.fillToMinimumWorkers();
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
  async acquire(): Promise<TransportLease> {
    // Check for disposed state
    if (this.isDisposed || this.state === 'disposing') {
      throw new BridgeExecutionError('Pool has been disposed');
    }

    // Find an available worker (one with capacity)
    const availableWorker = this.findAvailableWorker();
    if (availableWorker) {
      availableWorker.inFlightCount++;
      return availableWorker;
    }

    // Create a new worker if under the limit
    // Include pendingCreations to prevent race condition where multiple
    // concurrent acquire() calls all pass the length check before any
    // worker is actually added to the array
    if (this.workers.length + this.pendingCreations < this.options.maxWorkers) {
      this.pendingCreations++;
      try {
        const newWorker = await this.createWorker();
        if (this.isShuttingDown()) {
          this.removeWorker(newWorker);
          throw new BridgeExecutionError('Pool has been disposed');
        }
        newWorker.inFlightCount++;
        this.publishAvailableWorker(newWorker);
        return newWorker;
      } finally {
        this.pendingCreations--;
      }
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
  release(worker: TransportLease): void {
    // Validate the worker belongs to this pool
    if (!this.workers.includes(worker)) {
      return;
    }

    // Decrement in-flight count (minimum 0)
    worker.inFlightCount = Math.max(0, worker.inFlightCount - 1);
    this.publishAvailableWorker(worker);
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
  async withWorker<T>(fn: (worker: TransportLease) => Promise<T>): Promise<T> {
    const worker = await this.acquire();
    let workerRemoved = false;

    try {
      return await fn(worker);
    } catch (error) {
      // If this is a fatal error indicating the worker is dead, remove it from the pool
      if (this.isFatalWorkerError(error)) {
        this.removeWorker(worker);
        workerRemoved = true;
      }
      throw error;
    } finally {
      // Only release if worker wasn't removed due to fatal error
      if (!workerRemoved) {
        this.release(worker);
      }
    }
  }

  // ===========================================================================
  // WORKER HEALTH
  // ===========================================================================

  /**
   * Check if an error indicates the worker is dead and should be removed.
   *
   * Fatal errors include:
   * - Process not running
   * - Process exited unexpectedly
   * - Pipe errors (EPIPE)
   * - Connection reset errors (ECONNRESET)
   */
  private isFatalWorkerError(error: unknown): boolean {
    if (error instanceof BridgeProtocolError) {
      const msg = error.message.toLowerCase();
      return (
        msg.includes('not running') ||
        msg.includes('process exited') ||
        msg.includes('epipe') ||
        msg.includes('econnreset')
      );
    }
    return false;
  }

  /**
   * Remove a worker from the pool.
   *
   * This is called when a worker is detected as dead (crashed, pipe error, etc.).
   * The worker's transport is disposed in the background.
   */
  private removeWorker(worker: TransportLease): void {
    const index = this.workers.indexOf(worker);
    if (index !== -1) {
      this.workers.splice(index, 1);
      // Dispose transport in background - don't await to avoid blocking
      worker.transport.dispose().catch(() => {
        // Ignore disposal errors for dead workers
      });
      if (this.state === 'ready') {
        this.scheduleReplacementWorker();
      }
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
  private findAvailableWorker(): TransportLease | undefined {
    return this.workers.find(w => w.inFlightCount < this.options.maxConcurrentPerWorker);
  }

  private getMinimumWorkerDeficit(): number {
    return Math.max(0, this.options.minWorkers - (this.workers.length + this.pendingCreations));
  }

  private isShuttingDown(): boolean {
    return this.isDisposed || this.state === 'disposing';
  }

  private async fillToMinimumWorkers(): Promise<void> {
    await this.spawnWorkers(this.getMinimumWorkerDeficit());
  }

  private async spawnWorkers(count: number): Promise<void> {
    if (count === 0) {
      return;
    }
    this.pendingCreations += count;
    try {
      await Promise.all(Array.from({ length: count }, () => this.spawnWorkerToPool()));
    } finally {
      this.pendingCreations = Math.max(0, this.pendingCreations - count);
    }
  }

  /**
   * Replace a removed worker in the background so the next caller does not pay
   * the full worker cold-start penalty after a timeout or crash.
   */
  private scheduleReplacementWorker(): void {
    if (this.state !== 'ready') {
      return;
    }
    if (this.workers.length + this.pendingCreations >= this.options.maxWorkers) {
      return;
    }

    this.pendingCreations++;
    const replacementReady = this.options.onReplacementWorkerReady ?? this.options.onWorkerReady;
    this.spawnWorkerToPool(replacementReady)
      .catch(() => {
        // Ignore background replacement failures. A later acquire() can retry.
      })
      .finally(() => {
        this.pendingCreations = Math.max(0, this.pendingCreations - 1);
      });
  }

  private async spawnWorkerToPool(onWorkerReady = this.options.onWorkerReady): Promise<void> {
    if (this.isShuttingDown()) {
      return;
    }

    const worker = await this.createWorker(onWorkerReady);
    if (this.isShuttingDown()) {
      this.removeWorker(worker);
      return;
    }

    this.publishAvailableWorker(worker);
  }

  private publishAvailableWorker(worker: TransportLease): void {
    while (
      this.waitQueue.length > 0 &&
      worker.inFlightCount < this.options.maxConcurrentPerWorker
    ) {
      const waiter = this.waitQueue.shift();
      if (!waiter) {
        return;
      }
      clearTimeout(waiter.timer);
      worker.inFlightCount++;
      waiter.resolve(worker);
    }
  }

  /**
   * Create a new worker and add it to the pool.
   *
   * If onWorkerReady is configured, calls it after the transport is initialized.
   * This is useful for per-worker warmup (importing modules, running setup).
   */
  private async createWorker(onWorkerReady = this.options.onWorkerReady): Promise<TransportLease> {
    const transport = this.options.createTransport();

    // Initialize the transport
    await transport.init();

    const worker: TransportLease = {
      transport,
      inFlightCount: 0,
    };

    try {
      // Call onWorkerReady callback if provided
      if (onWorkerReady) {
        await onWorkerReady(worker);
      }
    } catch (error) {
      // Ensure partially initialized workers do not leak when warmup fails.
      await transport.dispose().catch(() => {
        // Ignore disposal failures during warmup failure handling.
      });
      throw error;
    }

    if (this.state === 'disposing' || this.state === 'disposed') {
      await transport.dispose().catch(() => {
        // Ignore disposal failures if the pool was torn down mid-creation.
      });
      throw new BridgeExecutionError('Pool disposed during worker creation');
    }

    this.workers.push(worker);

    return worker;
  }

  /**
   * Wait in queue for a worker to become available.
   */
  private waitForWorker(): Promise<TransportLease> {
    return new Promise<TransportLease>((resolve, reject) => {
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
}
