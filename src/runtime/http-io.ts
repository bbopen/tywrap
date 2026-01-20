/**
 * HTTP Transport for BridgeProtocol.
 *
 * Provides stateless HTTP POST-based communication with a Python server.
 * Each request is independent - no connection state is maintained.
 *
 * @see https://github.com/bbopen/tywrap/issues/149
 */

import {
  BridgeDisposedError,
  BridgeExecutionError,
  BridgeProtocolError,
  BridgeTimeoutError,
} from './errors.js';
import type { Transport } from './transport.js';

// =============================================================================
// OPTIONS
// =============================================================================

/**
 * Configuration options for HttpIO transport.
 */
export interface HttpIOOptions {
  /** Base URL for the Python server (e.g., 'http://localhost:8000') */
  baseURL: string;

  /** Additional headers to include in each request */
  headers?: Record<string, string>;

  /** Default timeout in milliseconds. Default: 30000 (30 seconds) */
  defaultTimeoutMs?: number;
}

// =============================================================================
// HTTP TRANSPORT
// =============================================================================

/**
 * HTTP-based transport for BridgeProtocol.
 *
 * This transport sends protocol messages as HTTP POST requests to a Python
 * server. It is stateless - each request is independent and the transport
 * is always ready after construction.
 *
 * Features:
 * - Stateless design (init/dispose are no-ops)
 * - Timeout handling via AbortController
 * - External signal support for cancellation
 * - Proper error classification
 *
 * @example
 * ```typescript
 * const transport = new HttpIO({ baseURL: 'http://localhost:8000' });
 * await transport.init(); // No-op but follows Transport contract
 *
 * const response = await transport.send(
 *   JSON.stringify({ id: '1', type: 'call', module: 'math', functionName: 'sqrt', args: [16] }),
 *   5000
 * );
 *
 * await transport.dispose(); // Marks as disposed
 * ```
 */
export class HttpIO implements Transport {
  private readonly baseURL: string;
  private readonly headers: Record<string, string>;
  private readonly defaultTimeoutMs: number;
  private _isDisposed = false;

  constructor(options: HttpIOOptions) {
    // Normalize URL - remove trailing slash
    this.baseURL = options.baseURL.replace(/\/$/, '');
    this.headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30000;
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  /**
   * Initialize the transport.
   *
   * HTTP is stateless, so this is a no-op. The transport is ready
   * immediately after construction.
   */
  async init(): Promise<void> {
    // HTTP is stateless - nothing to initialize
  }

  /**
   * Dispose the transport.
   *
   * Marks the transport as disposed. Subsequent send() calls will fail.
   */
  async dispose(): Promise<void> {
    this._isDisposed = true;
  }

  /**
   * Whether the transport is ready to send messages.
   *
   * Returns true unless dispose() has been called.
   */
  get isReady(): boolean {
    return !this._isDisposed;
  }

  // ===========================================================================
  // SEND
  // ===========================================================================

  /**
   * Send a message to the Python server and wait for the response.
   *
   * @param message - The JSON-encoded protocol message to send
   * @param timeoutMs - Timeout in milliseconds (0 = no timeout, negative = use default)
   * @param signal - Optional AbortSignal for external cancellation
   * @returns The raw response string (JSON-encoded ProtocolResponse)
   *
   * @throws BridgeDisposedError if the transport has been disposed
   * @throws BridgeTimeoutError if the operation times out or is aborted
   * @throws BridgeExecutionError if the server returns a non-2xx status
   * @throws BridgeProtocolError if the response cannot be read
   */
  async send(message: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
    if (this._isDisposed) {
      throw new BridgeDisposedError('Transport has been disposed');
    }

    // Determine effective timeout
    // 0 = no timeout (per interface contract), negative = use default
    const effectiveTimeout = timeoutMs === 0 ? 0 : timeoutMs > 0 ? timeoutMs : this.defaultTimeoutMs;

    // Create abort controller for timeout
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    // Set up timeout if enabled
    if (effectiveTimeout > 0) {
      timeoutId = setTimeout(() => {
        controller.abort();
      }, effectiveTimeout);
    }

    // Handle external signal - abort our controller when external aborts
    const externalAbortHandler = (): void => {
      controller.abort();
    };

    if (signal) {
      // Check if already aborted
      if (signal.aborted) {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
        throw new BridgeTimeoutError('Operation aborted');
      }
      signal.addEventListener('abort', externalAbortHandler, { once: true });
    }

    try {
      const response = await fetch(this.baseURL, {
        method: 'POST',
        headers: this.headers,
        body: message,
        signal: controller.signal,
      });

      // Handle non-2xx status codes
      if (!response.ok) {
        const errorBody = await this.safeReadText(response);
        throw new BridgeExecutionError(
          `HTTP ${response.status}: ${errorBody || response.statusText}`,
          { code: `HTTP_${response.status}` }
        );
      }

      // Read response body
      const responseText = await response.text();
      return responseText;
    } catch (error) {
      // Handle abort errors (timeout or external signal)
      if (error instanceof Error && error.name === 'AbortError') {
        // Determine if it was timeout or external abort
        if (signal?.aborted) {
          throw new BridgeTimeoutError('Operation aborted');
        }
        throw new BridgeTimeoutError(`Request timed out after ${effectiveTimeout}ms`);
      }

      // Re-throw bridge errors as-is
      if (
        error instanceof BridgeTimeoutError ||
        error instanceof BridgeExecutionError ||
        error instanceof BridgeProtocolError
      ) {
        throw error;
      }

      // Wrap network errors
      if (error instanceof TypeError) {
        // fetch throws TypeError for network failures
        throw new BridgeExecutionError(`Network error: ${error.message}`, { cause: error });
      }

      // Wrap unknown errors
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new BridgeExecutionError(`Request failed: ${errorMessage}`, {
        cause: error instanceof Error ? error : undefined,
      });
    } finally {
      // Clean up timeout
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }

      // Clean up external signal listener
      if (signal) {
        signal.removeEventListener('abort', externalAbortHandler);
      }
    }
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  /**
   * Safely read response body as text, returning empty string on failure.
   */
  private async safeReadText(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch {
      return '';
    }
  }
}
