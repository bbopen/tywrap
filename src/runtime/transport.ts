/**
 * Transport layer for BridgeProtocol.
 *
 * Provides an abstract I/O channel for all bridge communications across
 * the JS-Python boundary. Concrete implementations handle different runtimes:
 * - ProcessIO: Child process with stdio streams (Node.js)
 * - HttpIO: HTTP POST requests (remote Python server)
 * - PyodideIO: In-memory Pyodide calls (browser/WASM)
 *
 * @see https://github.com/bbopen/tywrap/issues/149
 */

import type { Disposable } from './disposable.js';

// =============================================================================
// PROTOCOL CONSTANTS
// =============================================================================

/** Protocol identifier for tywrap communication */
export const PROTOCOL_ID = 'tywrap/1';

// =============================================================================
// PROTOCOL TYPES
// =============================================================================

/**
 * Protocol message format for all transports.
 *
 * Each method corresponds to a BridgeProtocol operation:
 * - `call`: Invoke a module-level function
 * - `instantiate`: Create a new class instance
 * - `call_method`: Invoke a method on an existing instance
 * - `dispose_instance`: Release an instance handle
 * - `meta`: Get bridge metadata
 */
export interface ProtocolMessage {
  /** Unique message identifier for request-response correlation */
  id: number;

  /** Protocol identifier (must be 'tywrap/1') */
  protocol: typeof PROTOCOL_ID;

  /** The method to invoke */
  method: 'call' | 'instantiate' | 'call_method' | 'dispose_instance' | 'meta';

  /** Method parameters */
  params: {
    /** Python module path (for call and instantiate) */
    module?: string;

    /** Function name (for call) */
    functionName?: string;

    /** Class name (for instantiate) */
    className?: string;

    /** Instance handle (for call_method and dispose_instance) */
    handle?: string;

    /** Method name (for call_method) */
    methodName?: string;

    /** Positional arguments */
    args?: unknown[];

    /** Keyword arguments */
    kwargs?: Record<string, unknown>;
  };
}

/**
 * Protocol response format from the Python side.
 *
 * A response contains either a result or an error, never both.
 * The `id` field correlates the response to its originating request.
 */
export interface ProtocolResponse {
  /** Message identifier matching the originating request */
  id: number;

  /** Protocol identifier (echoed back from request) */
  protocol?: string;

  /** Successful result value (undefined if error occurred) */
  result?: unknown;

  /** Error information (undefined if operation succeeded) */
  error?: {
    /** Python exception type name */
    type: string;
    /** Error message */
    message: string;
    /** Optional Python traceback for debugging */
    traceback?: string;
  };
}

// =============================================================================
// TRANSPORT INTERFACE
// =============================================================================

/**
 * Abstract transport for sending messages across the JS-Python boundary.
 *
 * Transport implementations handle the low-level I/O details while
 * providing a consistent interface for the higher-level BridgeProtocol.
 *
 * Lifecycle:
 * 1. Create transport instance
 * 2. Call `init()` to establish the connection
 * 3. Use `send()` to exchange messages
 * 4. Call `dispose()` to release resources
 *
 * Implementations:
 * - ProcessIO: Spawns a Python child process, communicates via stdio
 * - HttpIO: Sends HTTP POST requests to a Python server
 * - PyodideIO: Calls Pyodide directly in-memory (WASM)
 *
 * @example
 * ```typescript
 * const transport = new ProcessIO({ pythonPath: 'python3' });
 * await transport.init();
 *
 * const response = await transport.send(
 *   JSON.stringify({ id: '1', type: 'call', module: 'math', functionName: 'sqrt', args: [16] }),
 *   5000
 * );
 *
 * await transport.dispose();
 * ```
 */
export interface Transport extends Disposable {
  /**
   * Initialize the transport.
   *
   * This method establishes the underlying connection (e.g., spawns a process,
   * opens a connection). It must be called before `send()` can be used.
   *
   * This method should be idempotent - calling it multiple times after
   * successful initialization should be a no-op.
   *
   * @throws BridgeError if initialization fails
   */
  init(): Promise<void>;

  /**
   * Send a message and wait for the response.
   *
   * @param message - The JSON-encoded protocol message to send
   * @param timeoutMs - Timeout in milliseconds (0 = no timeout)
   * @param signal - Optional AbortSignal for external cancellation
   * @returns The raw response string (JSON-encoded ProtocolResponse)
   *
   * @throws BridgeTimeoutError if the operation times out or is aborted
   * @throws BridgeDisposedError if the transport has been disposed
   * @throws BridgeProtocolError if the message format is invalid
   * @throws BridgeError for other transport-level failures
   */
  send(message: string, timeoutMs: number, signal?: AbortSignal): Promise<string>;

  /**
   * Whether the transport is ready to send messages.
   *
   * Returns `true` after successful `init()` and before `dispose()`.
   * Returns `false` in all other states.
   */
  readonly isReady: boolean;
}

// =============================================================================
// TRANSPORT OPTIONS
// =============================================================================

/**
 * Base options for creating a Transport.
 *
 * Concrete transport implementations may extend this with
 * additional configuration options.
 */
export interface TransportOptions {
  /**
   * Default timeout for operations in milliseconds.
   *
   * This timeout applies to individual `send()` calls when
   * no explicit timeout is provided.
   *
   * @default 30000 (30 seconds)
   */
  defaultTimeoutMs?: number;
}

// =============================================================================
// TYPE GUARDS
// =============================================================================

/**
 * Type guard to check if a value implements the Transport interface.
 *
 * @param value - The value to check
 * @returns True if the value has all required Transport methods and properties
 *
 * @example
 * ```typescript
 * function useTransport(maybeTransport: unknown) {
 *   if (isTransport(maybeTransport)) {
 *     await maybeTransport.init();
 *     // TypeScript now knows maybeTransport is Transport
 *   }
 * }
 * ```
 */
export function isTransport(value: unknown): value is Transport {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as Transport).init === 'function' &&
    typeof (value as Transport).send === 'function' &&
    typeof (value as Transport).dispose === 'function' &&
    'isReady' in value
  );
}

/**
 * Type guard to check if a value is a valid ProtocolMessage.
 *
 * @param value - The value to check
 * @returns True if the value conforms to the ProtocolMessage structure
 */
export function isProtocolMessage(value: unknown): value is ProtocolMessage {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const msg = value as ProtocolMessage;

  return (
    typeof msg.id === 'number' &&
    msg.protocol === PROTOCOL_ID &&
    typeof msg.method === 'string' &&
    ['call', 'instantiate', 'call_method', 'dispose_instance', 'meta'].includes(msg.method) &&
    typeof msg.params === 'object' &&
    msg.params !== null
  );
}

/**
 * Type guard to check if a value is a valid ProtocolResponse.
 *
 * @param value - The value to check
 * @returns True if the value conforms to the ProtocolResponse structure
 */
export function isProtocolResponse(value: unknown): value is ProtocolResponse {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const resp = value as ProtocolResponse;

  if (typeof resp.id !== 'number') {
    return false;
  }

  // Must have either result or error (or neither for void returns)
  if (resp.error !== undefined) {
    if (typeof resp.error !== 'object' || resp.error === null) {
      return false;
    }
    const err = resp.error;
    return typeof err.type === 'string' && typeof err.message === 'string';
  }

  return true;
}
