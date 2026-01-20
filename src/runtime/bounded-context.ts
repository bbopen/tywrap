/**
 * BoundedContext - Unified abstraction for cross-boundary concerns.
 *
 * This base class provides consistent handling of:
 * - Lifecycle management (init/dispose state machine)
 * - Validation helpers
 * - Error classification
 * - Bounded execution (timeout, retry)
 * - Resource ownership tracking
 *
 * All runtime bridges (NodeBridge, PyodideBridge, HttpBridge) extend this class.
 *
 * @see https://github.com/bbopen/tywrap/issues/149
 */

import type { RuntimeExecution } from '../types/index.js';
import {
  BridgeDisposedError,
  BridgeError,
  BridgeExecutionError,
  BridgeProtocolError,
  BridgeTimeoutError,
} from './errors.js';
import type { Disposable } from './disposable.js';
import { disposeAll } from './disposable.js';
import {
  assertFiniteNumber,
  assertNonEmptyString,
  assertPositive,
  assertString,
  ValidationError,
} from './validators.js';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lifecycle states for a BoundedContext.
 *
 * State transitions:
 * - idle → initializing → ready (on successful init)
 * - idle → initializing → idle (on failed init, allows retry)
 * - ready → disposing → disposed (on dispose)
 * - disposed → (terminal, no further transitions)
 */
export type ContextState = 'idle' | 'initializing' | 'ready' | 'disposing' | 'disposed';

/**
 * Options for bounded execution.
 */
export interface ExecuteOptions<T = unknown> {
  /** Timeout in milliseconds. Default: 30000 (30s). Set to 0 to disable. */
  timeoutMs?: number;
  /** Number of retry attempts on retryable errors. Default: 0. */
  retries?: number;
  /** Base delay between retries in ms. Multiplied by attempt number. Default: 100. */
  retryDelayMs?: number;
  /** Optional validation function applied to the result. */
  validate?: (result: T) => T;
  /** Optional abort signal for external cancellation. */
  signal?: AbortSignal;
}

// ═══════════════════════════════════════════════════════════════════════════
// BOUNDED CONTEXT BASE CLASS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Abstract base class for runtime bridges with unified boundary management.
 *
 * Provides lifecycle management, validation, error classification,
 * bounded execution, and resource tracking.
 */
export abstract class BoundedContext implements RuntimeExecution {
  // ═══════════════════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════════════════

  private _state: ContextState = 'idle';
  private _initPromise?: Promise<void>;
  private readonly _resources = new Set<Disposable>();

  /**
   * Current lifecycle state of the context.
   */
  get state(): ContextState {
    return this._state;
  }

  /**
   * Whether the context is ready for operations.
   */
  get isReady(): boolean {
    return this._state === 'ready';
  }

  /**
   * Whether the context has been disposed.
   */
  get isDisposed(): boolean {
    return this._state === 'disposed';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIFECYCLE (addresses #142, #148)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Initialize the context.
   *
   * This method:
   * - Is idempotent (safe to call multiple times)
   * - Deduplicates concurrent calls (returns the same promise)
   * - Allows retry after failure (resets to idle state)
   * - Throws BridgeDisposedError if already disposed
   *
   * @throws BridgeDisposedError if the context has been disposed
   * @throws BridgeError subclass if initialization fails
   */
  async init(): Promise<void> {
    if (this._state === 'disposed') {
      throw new BridgeDisposedError('Context has been disposed');
    }
    if (this._state === 'ready') {
      return;
    }
    if (this._initPromise) {
      return this._initPromise;
    }

    this._state = 'initializing';
    this._initPromise = this.doInit()
      .then(() => {
        // Guard against dispose() being called during init
        if (this._state === 'initializing') {
          this._state = 'ready';
        }
      })
      .catch(err => {
        // Allow retry by resetting to idle
        this._state = 'idle';
        this._initPromise = undefined;
        throw this.classifyError(err);
      });

    return this._initPromise;
  }

  /**
   * Dispose the context and all tracked resources.
   *
   * This method:
   * - Is idempotent (safe to call multiple times)
   * - Disposes all tracked resources before calling doDispose()
   * - Collects errors from resource disposal and reports them
   * - Transitions to disposed state even if disposal errors occur
   *
   * @throws AggregateError if multiple disposal errors occur
   * @throws Error if a single disposal error occurs
   */
  async dispose(): Promise<void> {
    if (this._state === 'disposed') {
      return;
    }
    if (this._state === 'disposing') {
      // Another dispose is in progress; don't overlap
      return;
    }

    this._state = 'disposing';

    // Dispose all tracked resources
    const resourceErrors = await disposeAll(this._resources);
    this._resources.clear();

    // Call subclass dispose logic
    let doDisposeError: Error | undefined;
    try {
      await this.doDispose();
    } catch (e) {
      doDisposeError = e instanceof Error ? e : new Error(String(e));
    }

    // Always transition to disposed
    this._state = 'disposed';
    this._initPromise = undefined;

    // Report any errors
    const allErrors = doDisposeError ? [...resourceErrors, doDisposeError] : resourceErrors;

    if (allErrors.length === 1) {
      throw allErrors[0];
    }
    if (allErrors.length > 1) {
      throw new AggregateError(allErrors, 'Multiple errors during dispose');
    }
  }

  /**
   * Subclass initialization logic.
   * Called during init() after state transitions to 'initializing'.
   */
  protected abstract doInit(): Promise<void>;

  /**
   * Subclass disposal logic.
   * Called during dispose() after tracked resources are disposed.
   */
  protected abstract doDispose(): Promise<void>;

  // ═══════════════════════════════════════════════════════════════════════════
  // VALIDATION (addresses #141, #145, #146, #147)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Validate that a value is a finite number.
   * Wraps validation errors in appropriate BridgeError.
   *
   * @param value - The value to validate
   * @param name - Parameter name for error messages
   * @returns The validated number
   * @throws BridgeError if validation fails
   */
  protected validateNumeric(value: unknown, name: string): number {
    try {
      return assertFiniteNumber(value, name);
    } catch (error) {
      throw this.classifyError(error);
    }
  }

  /**
   * Validate that a value is a positive number.
   * Wraps validation errors in appropriate BridgeError.
   *
   * @param value - The value to validate
   * @param name - Parameter name for error messages
   * @returns The validated number
   * @throws BridgeError if validation fails
   */
  protected validatePositive(value: unknown, name: string): number {
    try {
      return assertPositive(value, name);
    } catch (error) {
      throw this.classifyError(error);
    }
  }

  /**
   * Validate that a value is a string.
   * Wraps validation errors in appropriate BridgeError.
   *
   * @param value - The value to validate
   * @param name - Parameter name for error messages
   * @returns The validated string
   * @throws BridgeError if validation fails
   */
  protected validateString(value: unknown, name: string): string {
    try {
      return assertString(value, name);
    } catch (error) {
      throw this.classifyError(error);
    }
  }

  /**
   * Validate that a value is a non-empty string.
   * Wraps validation errors in appropriate BridgeError.
   *
   * @param value - The value to validate
   * @param name - Parameter name for error messages
   * @returns The validated string
   * @throws BridgeError if validation fails
   */
  protected validateNonEmptyString(value: unknown, name: string): string {
    try {
      return assertNonEmptyString(value, name);
    } catch (error) {
      throw this.classifyError(error);
    }
  }

  /**
   * Validate input before processing.
   * Override in subclasses for domain-specific input validation.
   *
   * @param input - The input to validate
   * @returns The validated input
   */
  protected validateInput<T>(input: T): T {
    return input;
  }

  /**
   * Validate output before returning.
   * Override in subclasses for domain-specific output validation.
   *
   * @param output - The output to validate
   * @returns The validated output
   */
  protected validateOutput<T>(output: T): T {
    return output;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ERROR CLASSIFICATION (addresses #143)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Classify an error into the appropriate BridgeError subtype.
   *
   * This method:
   * - Passes through existing BridgeError instances
   * - Uses context state to determine appropriate error type
   * - Pattern-matches error messages for classification
   *
   * @param error - The error to classify
   * @returns A BridgeError instance
   */
  protected classifyError(error: unknown): BridgeError {
    // Pass through existing BridgeErrors
    if (error instanceof BridgeError) {
      return error;
    }

    const message = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error ? error : undefined;

    // Context state takes precedence
    if (this._state === 'disposed') {
      return new BridgeDisposedError(message, { cause });
    }

    // Pattern matching for classification
    const lowerMessage = message.toLowerCase();

    // Timeout patterns
    if (
      lowerMessage.includes('timeout') ||
      lowerMessage.includes('etimedout') ||
      lowerMessage.includes('timed out') ||
      lowerMessage.includes('aborted')
    ) {
      return new BridgeTimeoutError(message, { cause });
    }

    // Protocol patterns
    if (
      lowerMessage.includes('protocol') ||
      lowerMessage.includes('invalid json') ||
      lowerMessage.includes('parse error') ||
      lowerMessage.includes('unexpected token') ||
      lowerMessage.includes('not found') ||
      error instanceof ValidationError
    ) {
      return new BridgeProtocolError(message, { cause });
    }

    // Default to execution error
    return new BridgeExecutionError(message, { cause });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BOUNDED EXECUTION (addresses #141, #147, #148)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Execute an operation with bounded execution guarantees.
   *
   * This method:
   * - Auto-initializes if not ready
   * - Enforces timeout limits
   * - Supports retry on retryable errors
   * - Respects abort signals
   * - Validates results if a validator is provided
   *
   * @param operation - The async operation to execute
   * @param options - Execution options (timeout, retries, etc.)
   * @returns The operation result
   * @throws BridgeTimeoutError if the operation times out
   * @throws BridgeDisposedError if the context is disposed
   * @throws BridgeError for other failures
   */
  protected async execute<T>(
    operation: () => Promise<T>,
    options: ExecuteOptions<T> = {}
  ): Promise<T> {
    // Auto-initialize if needed
    if (this._state !== 'ready') {
      await this.init();
    }

    // Check disposed state after potential init
    if (this._state === 'disposed') {
      throw new BridgeDisposedError('Context disposed');
    }

    const { timeoutMs = 30000, retries = 0, retryDelayMs = 100, validate, signal } = options;

    let lastError: BridgeError | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      // Check for abort before each attempt
      if (signal?.aborted) {
        throw new BridgeTimeoutError('Operation aborted');
      }

      try {
        const result = await this.withTimeout(operation(), timeoutMs, signal);
        return validate ? validate(result) : result;
      } catch (error) {
        lastError = this.classifyError(error);

        // Retry if appropriate
        if (attempt < retries && this.isRetryable(lastError)) {
          await this.delay(retryDelayMs * (attempt + 1));
          continue;
        }

        throw lastError;
      }
    }

    // Should not reach here, but TypeScript doesn't know that
    /* istanbul ignore next */
    throw lastError ?? new BridgeExecutionError('Unexpected execution flow');
  }

  /**
   * Wrap a promise with a timeout.
   *
   * @param promise - The promise to wrap
   * @param ms - Timeout in milliseconds (0 or negative disables timeout)
   * @param signal - Optional abort signal
   * @returns The promise result
   * @throws BridgeTimeoutError if the timeout expires
   */
  private async withTimeout<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
    // Check if already aborted
    if (signal?.aborted) {
      throw new BridgeTimeoutError('Operation aborted');
    }

    // No timeout if ms is 0 or negative, but still honor abort signal
    if (ms <= 0 || !Number.isFinite(ms)) {
      if (!signal) {
        return promise;
      }
      // Wrap promise to honor abort signal even without timeout
      return new Promise<T>((resolve, reject) => {
        const abortHandler = (): void => {
          reject(new BridgeTimeoutError('Operation aborted'));
        };
        signal.addEventListener('abort', abortHandler, { once: true });
        promise
          .then(result => {
            signal.removeEventListener('abort', abortHandler);
            resolve(result);
          })
          .catch(error => {
            signal.removeEventListener('abort', abortHandler);
            reject(error);
          });
      });
    }

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new BridgeTimeoutError(`Operation timed out after ${ms}ms`));
      }, ms);

      // Handle external abort signal
      const abortHandler = (): void => {
        clearTimeout(timer);
        reject(new BridgeTimeoutError('Operation aborted'));
      };

      if (signal) {
        signal.addEventListener('abort', abortHandler, { once: true });
      }

      promise
        .then(result => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', abortHandler);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', abortHandler);
          reject(error);
        });
    });
  }

  /**
   * Determine if an error is retryable.
   * Override in subclasses to customize retry logic.
   *
   * @param error - The error to check
   * @returns True if the operation should be retried
   */
  protected isRetryable(error: BridgeError): boolean {
    // Timeout and connection errors are typically retryable
    if (error instanceof BridgeTimeoutError) {
      return true;
    }

    const message = error.message.toLowerCase();
    return (
      message.includes('econnreset') ||
      message.includes('econnrefused') ||
      message.includes('epipe') ||
      message.includes('connection reset')
    );
  }

  /**
   * Delay for a specified duration.
   *
   * @param ms - Milliseconds to delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RESOURCE OWNERSHIP (addresses #144, #148)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Track a disposable resource for automatic cleanup.
   *
   * When the context is disposed, all tracked resources will be
   * disposed automatically.
   *
   * @param resource - The resource to track
   * @returns The same resource (for chaining)
   */
  protected trackResource<T extends Disposable>(resource: T): T {
    this._resources.add(resource);
    return resource;
  }

  /**
   * Stop tracking a resource.
   *
   * Use this when a resource is disposed manually and should
   * not be disposed again during context disposal.
   *
   * @param resource - The resource to untrack
   * @returns True if the resource was being tracked
   */
  protected untrackResource(resource: Disposable): boolean {
    return this._resources.delete(resource);
  }

  /**
   * Number of currently tracked resources.
   */
  protected get resourceCount(): number {
    return this._resources.size;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ABSTRACT METHODS (RuntimeExecution interface)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Call a Python function.
   */
  abstract call<T = unknown>(
    module: string,
    functionName: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T>;

  /**
   * Instantiate a Python class.
   */
  abstract instantiate<T = unknown>(
    module: string,
    className: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T>;

  /**
   * Call a method on a Python instance.
   */
  abstract callMethod<T = unknown>(
    handle: string,
    methodName: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T>;

  /**
   * Dispose a Python instance.
   */
  abstract disposeInstance(handle: string): Promise<void>;
}
