/**
 * PooledTransport - Transport adapter that wraps WorkerPool for multi-process support.
 *
 * This transport implements the Transport interface by delegating to a WorkerPool
 * of ProcessIO transports. Each send() acquires a worker, sends the message,
 * and releases the worker back to the pool.
 *
 * @see https://github.com/bbopen/tywrap/issues/149
 */

import { BoundedContext } from './bounded-context.js';
import { BridgeDisposedError, BridgeExecutionError } from './errors.js';
import type { Transport } from './transport.js';
import { WorkerPool, type PooledWorker } from './worker-pool.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Options for creating a PooledTransport.
 */
export interface PooledTransportOptions {
  /** Factory function to create transports for each worker */
  createTransport: () => Transport;

  /** Maximum number of workers in the pool. Default: 1 */
  maxWorkers?: number;

  /** Minimum number of workers to pre-spawn during init. Default: 0 (lazy) */
  minWorkers?: number;

  /** Timeout for waiting in queue (ms). Default: 30000 */
  queueTimeoutMs?: number;

  /** Maximum concurrent requests per worker. Default: 10 */
  maxConcurrentPerWorker?: number;

  /**
   * Callback invoked after each worker is created and initialized.
   * Use this for per-worker warmup (e.g., importing modules, running setup).
   */
  onWorkerReady?: (worker: PooledWorker) => Promise<void>;
}

// =============================================================================
// POOLED TRANSPORT
// =============================================================================

/**
 * Transport adapter that wraps WorkerPool for multi-process message handling.
 *
 * PooledTransport presents a single Transport interface while internally
 * distributing requests across multiple worker transports (typically ProcessIO).
 *
 * Features:
 * - Lazy worker creation (transports created on demand)
 * - Configurable pool size and concurrency per worker
 * - Automatic worker acquisition and release
 * - Queue timeout for backpressure management
 *
 * @example
 * ```typescript
 * const transport = new PooledTransport({
 *   createTransport: () => new ProcessIO({
 *     bridgeScript: '/path/to/bridge.py',
 *   }),
 *   maxWorkers: 4,
 *   maxConcurrentPerWorker: 2,
 * });
 *
 * await transport.init();
 *
 * // send() automatically uses pool
 * const response = await transport.send(message, timeout);
 *
 * await transport.dispose();
 * ```
 */
export class PooledTransport extends BoundedContext implements Transport {
  private readonly poolOptions: Omit<Required<PooledTransportOptions>, 'onWorkerReady'> & {
    onWorkerReady?: (worker: PooledWorker) => Promise<void>;
  };
  private pool?: WorkerPool;

  /**
   * Create a new PooledTransport.
   *
   * @param options - Pool configuration options
   */
  constructor(options: PooledTransportOptions) {
    super();

    if (typeof options.createTransport !== 'function') {
      throw new BridgeExecutionError('createTransport must be a function');
    }

    this.poolOptions = {
      createTransport: options.createTransport,
      maxWorkers: options.maxWorkers ?? 1,
      minWorkers: options.minWorkers ?? 0,
      queueTimeoutMs: options.queueTimeoutMs ?? 30000,
      maxConcurrentPerWorker: options.maxConcurrentPerWorker ?? 10,
      onWorkerReady: options.onWorkerReady,
    };
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  /**
   * Initialize the pooled transport.
   *
   * Creates and initializes the internal WorkerPool.
   * If minWorkers > 0, workers are pre-spawned during init.
   */
  protected async doInit(): Promise<void> {
    this.pool = new WorkerPool({
      createTransport: this.poolOptions.createTransport,
      maxWorkers: this.poolOptions.maxWorkers,
      minWorkers: this.poolOptions.minWorkers,
      queueTimeoutMs: this.poolOptions.queueTimeoutMs,
      maxConcurrentPerWorker: this.poolOptions.maxConcurrentPerWorker,
      onWorkerReady: this.poolOptions.onWorkerReady,
    });

    await this.pool.init();
  }

  /**
   * Dispose the pooled transport.
   *
   * Disposes the internal WorkerPool, which disposes all workers.
   */
  protected async doDispose(): Promise<void> {
    if (this.pool) {
      await this.pool.dispose();
      this.pool = undefined;
    }
  }

  // ===========================================================================
  // TRANSPORT INTERFACE
  // ===========================================================================

  /**
   * Send a message through a pooled worker.
   *
   * This method:
   * 1. Acquires a worker from the pool (waiting if necessary)
   * 2. Sends the message through the worker's transport
   * 3. Releases the worker back to the pool
   *
   * @param message - The JSON-encoded protocol message
   * @param timeoutMs - Timeout in milliseconds (0 = no timeout)
   * @param signal - Optional AbortSignal for cancellation
   * @returns The raw JSON response string
   *
   * @throws BridgeDisposedError if transport is disposed
   * @throws BridgeTimeoutError if queue timeout or request timeout expires
   */
  async send(message: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
    if (this.isDisposed || !this.pool) {
      throw new BridgeDisposedError('Transport has been disposed');
    }

    return this.pool.withWorker(async worker => {
      return worker.transport.send(message, timeoutMs, signal);
    });
  }

  // ===========================================================================
  // POOL STATISTICS
  // ===========================================================================

  /**
   * Current number of workers in the pool.
   */
  get workerCount(): number {
    return this.pool?.workerCount ?? 0;
  }

  /**
   * Number of callers waiting in the queue.
   */
  get queueLength(): number {
    return this.pool?.queueLength ?? 0;
  }

  /**
   * Total number of in-flight requests across all workers.
   */
  get totalInFlight(): number {
    return this.pool?.totalInFlight ?? 0;
  }

  // ===========================================================================
  // RUNTIME EXECUTION (Not implemented - PooledTransport is just a transport)
  // ===========================================================================

  /**
   * Not implemented - PooledTransport is a transport, use BridgeProtocol.
   */
  async call<T = unknown>(
    _module: string,
    _functionName: string,
    _args: unknown[],
    _kwargs?: Record<string, unknown>
  ): Promise<T> {
    throw new BridgeExecutionError(
      'PooledTransport is a transport, use BridgeProtocol for operations'
    );
  }

  /**
   * Not implemented - PooledTransport is a transport, use BridgeProtocol.
   */
  async instantiate<T = unknown>(
    _module: string,
    _className: string,
    _args: unknown[],
    _kwargs?: Record<string, unknown>
  ): Promise<T> {
    throw new BridgeExecutionError(
      'PooledTransport is a transport, use BridgeProtocol for operations'
    );
  }

  /**
   * Not implemented - PooledTransport is a transport, use BridgeProtocol.
   */
  async callMethod<T = unknown>(
    _handle: string,
    _methodName: string,
    _args: unknown[],
    _kwargs?: Record<string, unknown>
  ): Promise<T> {
    throw new BridgeExecutionError(
      'PooledTransport is a transport, use BridgeProtocol for operations'
    );
  }

  /**
   * Not implemented - PooledTransport is a transport, use BridgeProtocol.
   */
  async disposeInstance(_handle: string): Promise<void> {
    throw new BridgeExecutionError(
      'PooledTransport is a transport, use BridgeProtocol for operations'
    );
  }
}
