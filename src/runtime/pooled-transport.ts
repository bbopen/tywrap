/**
 * PooledTransport - Transport adapter that wraps TransportPool for multi-process support.
 *
 * This transport implements the Transport interface by delegating to a TransportPool
 * of SubprocessTransport transports. Each send() acquires a worker, sends the message,
 * and releases the worker back to the pool.
 *
 * @see https://github.com/bbopen/tywrap/issues/149
 */

import { DisposableBase } from './bounded-context.js';
import { BridgeDisposedError, BridgeExecutionError } from './errors.js';
import type { Transport, TransportCapabilities } from './transport.js';
import { TransportPool, type TransportLease } from './transport-pool.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Options for creating a PooledTransport.
 */
interface PooledTransportOptions {
  /**
   * Factory function to create transports for each worker.
   *
   * Construction MUST be side-effect-free — spawn processes/open connections in
   * `init()`/`send()`, never in the constructor. The pool may build a probe
   * instance solely to read its {@link Transport.capabilities} descriptor.
   */
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
  onWorkerReady?: (worker: TransportLease) => Promise<void>;

  /**
   * Optional callback used only for background replacement workers.
   */
  onReplacementWorkerReady?: (worker: TransportLease) => Promise<void>;
}

// =============================================================================
// POOLED TRANSPORT
// =============================================================================

/**
 * Transport adapter that wraps TransportPool for multi-process message handling.
 *
 * PooledTransport presents a single Transport interface while internally
 * distributing requests across multiple worker transports (typically SubprocessTransport).
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
 *   createTransport: () => new SubprocessTransport({
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
export class PooledTransport extends DisposableBase implements Transport {
  private readonly poolOptions: Omit<
    Required<PooledTransportOptions>,
    'onWorkerReady' | 'onReplacementWorkerReady'
  > & {
    onWorkerReady?: (worker: TransportLease) => Promise<void>;
    onReplacementWorkerReady?: (worker: TransportLease) => Promise<void>;
  };
  private pool?: TransportPool;
  /** Memoized capability descriptor — built at most once (see {@link capabilities}). */
  private cachedCapabilities?: TransportCapabilities;

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
      onReplacementWorkerReady: options.onReplacementWorkerReady,
    };
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  /**
   * Initialize the pooled transport.
   *
   * Creates and initializes the internal TransportPool.
   * If minWorkers > 0, workers are pre-spawned during init.
   */
  protected async doInit(): Promise<void> {
    this.pool = new TransportPool({
      createTransport: this.poolOptions.createTransport,
      maxWorkers: this.poolOptions.maxWorkers,
      minWorkers: this.poolOptions.minWorkers,
      queueTimeoutMs: this.poolOptions.queueTimeoutMs,
      maxConcurrentPerWorker: this.poolOptions.maxConcurrentPerWorker,
      onWorkerReady: this.poolOptions.onWorkerReady,
      onReplacementWorkerReady: this.poolOptions.onReplacementWorkerReady,
    });

    await this.pool.init();
  }

  /**
   * Dispose the pooled transport.
   *
   * Disposes the internal TransportPool, which disposes all workers.
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

  /**
   * Static capability descriptor for the pool.
   *
   * A pool's wire behavior is exactly that of the workers it distributes across,
   * so this reads the descriptor from one probe transport built by the same
   * factory. `createTransport` MUST be construction-side-effect-free — the
   * built-in transports spawn nothing until `init()`/`send()`. The result is
   * memoized so at most one probe is ever built regardless of call count, and
   * this stays safe to call at any lifecycle point.
   */
  capabilities(): TransportCapabilities {
    this.cachedCapabilities ??= this.poolOptions.createTransport().capabilities();
    return this.cachedCapabilities;
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
}
