/**
 * Transport layer for BridgeProtocol.
 *
 * Provides an abstract I/O channel for all bridge communications across
 * the JS-Python boundary. Concrete implementations handle different runtimes:
 * - SubprocessTransport: Child process with stdio streams (Node.js)
 * - HttpTransport: HTTP POST requests (remote Python server)
 * - PyodideTransport: In-memory Pyodide calls (browser/WASM)
 *
 * @see https://github.com/bbopen/tywrap/issues/149
 */

import type { Disposable } from './disposable.js';

// =============================================================================
// PROTOCOL CONSTANTS
// =============================================================================

/** Protocol identifier for tywrap communication. Single source of truth for the version. */
export const PROTOCOL_ID = 'tywrap/1';

/**
 * Numeric protocol version negotiated with the Python bridge. Derived from the
 * trailing number of {@link PROTOCOL_ID} so the two cannot drift — bump
 * PROTOCOL_ID alone and this follows.
 */
export const TYWRAP_PROTOCOL_VERSION = Number.parseInt(PROTOCOL_ID.split('/')[1] ?? '', 10);

/**
 * Framing protocol identifier for chunked large-payload transport.
 *
 * This is DISTINCT from {@link PROTOCOL_ID}: the logical RPC stays `tywrap/1`,
 * while `tywrap-frame/1` describes a separate layer (below {@link Transport.send})
 * that fragments one logical message across multiple wire frames and reassembles
 * it. An old bridge rejects any non-`tywrap/1` request, so the logical protocol
 * must NOT be bumped to negotiate chunking — a separate framing protocol,
 * advertised through a `tywrap/1` `meta` extension, is used instead.
 *
 * Subprocess-only for 0.8.0 (it is the only backend with a real frame ceiling —
 * the JSONL line-length limit). See docs/transport-framing.md.
 */
export const FRAME_PROTOCOL_ID = 'tywrap-frame/1';

/**
 * Numeric framing-protocol version. Derived from the trailing number of
 * {@link FRAME_PROTOCOL_ID} so the two cannot drift — bump FRAME_PROTOCOL_ID
 * alone and this follows (same pattern as {@link TYWRAP_PROTOCOL_VERSION}).
 */
export const FRAME_PROTOCOL_VERSION = Number.parseInt(FRAME_PROTOCOL_ID.split('/')[1] ?? '', 10);

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
// CHUNK FRAMING (tywrap-frame/1)
// =============================================================================

/**
 * Per-frame encoding for a {@link ChunkFrame}'s `data` field.
 *
 * - `utf8-slice` (the chosen default for 0.8.0): `data` is a raw substring of the
 *   complete logical JSON message, split on UTF-8 codepoint boundaries. Because
 *   the logical payload is already valid-UTF-8 JSON, the slices reassemble by
 *   simple concatenation — no inflation, no extra decode. See
 *   docs/transport-framing.md for the rationale (decision #6).
 * - `utf8-base64`: `data` is a base64-encoded chunk of the UTF-8 bytes, safe for
 *   arbitrary byte splits but ~33% larger on the wire with a memory-amplification
 *   cost. Reserved as an alternative; not emitted by tywrap in 0.8.0.
 */
export type ChunkFrameEncoding = 'utf8-base64' | 'utf8-slice';

/**
 * A single wire frame of the `tywrap-frame/1` framing protocol.
 *
 * A frame envelope is DISTINCT from the logical {@link ProtocolMessage} /
 * {@link ProtocolResponse}: it carries a slice of the bytes of ONE complete
 * logical JSON message (a request or a response), fragmented because the payload
 * exceeds the transport's frame ceiling. The framing layer reassembles all
 * frames for a given {@link ChunkFrame.id} back into the single logical message
 * before the JSON/codec path ever sees it.
 *
 * Correlation reuses the existing RPC `id`. `seq` is zero-based; `total` and
 * `totalBytes` are repeated on every frame so the receiver can validate the
 * stream is complete (no missing/duplicate `seq`, exact frame count, exact
 * reassembled byte length) before decoding.
 *
 * @see docs/transport-framing.md
 */
export interface ChunkFrame {
  /**
   * Frame-envelope discriminator.
   * - `'chunk'`: a normal data-carrying frame.
   * - `'error'`: a framing-layer error (e.g. the sender could not continue the
   *   stream); carries no further data frames for this `id`.
   */
  __tywrap_frame__: 'chunk' | 'error';

  /** Framing protocol identifier (must equal {@link FRAME_PROTOCOL_ID}). */
  frameProtocol: string;

  /** Which logical stream this frame belongs to. */
  stream: 'request' | 'response';

  /** RPC correlation id, shared with the logical {@link ProtocolMessage.id}. */
  id: number;

  /** Zero-based sequence index of this frame within its stream. */
  seq: number;

  /** Total number of frames in this stream (repeated on every frame). */
  total: number;

  /**
   * Total byte length of the complete reassembled logical message (repeated on
   * every frame). Used to validate the reassembled payload exactly.
   */
  totalBytes: number;

  /** Per-frame payload encoding (see {@link ChunkFrameEncoding}). */
  encoding: ChunkFrameEncoding;

  /** This frame's slice of the logical message, encoded per {@link encoding}. */
  data: string;
}

// =============================================================================
// TRANSPORT CAPABILITIES
// =============================================================================

/**
 * Static, transport-level capability descriptor.
 *
 * Each backend exposes one of these via {@link Transport.capabilities} so callers
 * can reason about what the wire channel can carry WITHOUT round-tripping to
 * Python. These flags describe the transport itself (what bytes it can move and
 * how it frames them) — they are deliberately separate from the bridge's runtime
 * `meta` report ({@link BridgeInfo}), which describes the *Python environment*
 * (which optional libraries happen to be importable). The transport descriptor is
 * authoritative for transport-level flags; the meta report is authoritative for
 * library availability.
 *
 * Honest for TODAY's behavior: `supportsChunking` and `supportsStreaming` are
 * `false` on every backend — both are planned for 0.8.0 and no backend implements
 * them yet. See docs/transport-capabilities.md for the full matrix.
 */
export interface TransportCapabilities {
  /** Which backend this transport drives. */
  readonly backend: 'subprocess' | 'http' | 'pyodide';

  /**
   * Whether the transport can carry Arrow-encoded payloads (binary IPC frames)
   * on the wire. Pyodide is JSON-only (pyarrow is unavailable in WASM), so it is
   * `false` there; subprocess and HTTP can move Arrow bytes.
   */
  readonly supportsArrow: boolean;

  /**
   * Whether the transport can carry arbitrary binary data (e.g. Python `bytes`).
   * All current backends carry binary via base64 envelopes, so this is `true`
   * everywhere.
   */
  readonly supportsBinary: boolean;

  /**
   * Whether the transport splits a single logical message across multiple wire
   * frames. Not implemented on any backend yet (planned for 0.8.0) — always
   * `false`.
   */
  readonly supportsChunking: boolean;

  /**
   * Whether the transport can stream incremental results for a single request.
   * Not implemented on any backend yet (planned for 0.8.0) — always `false`.
   */
  readonly supportsStreaming: boolean;

  /**
   * Maximum size, in bytes, of a single wire frame the transport will accept.
   * `Number.POSITIVE_INFINITY` means the transport imposes no frame ceiling of
   * its own (a higher layer — e.g. the codec's payload limit — may still cap the
   * size). For the subprocess backend this is the JSONL line-length limit.
   */
  readonly maxFrameBytes: number;
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
 * - SubprocessTransport: Spawns a Python child process, communicates via stdio
 * - HttpTransport: Sends HTTP POST requests to a Python server
 * - PyodideTransport: Calls Pyodide directly in-memory (WASM)
 *
 * @example
 * ```typescript
 * const transport = new SubprocessTransport({ pythonPath: 'python3' });
 * await transport.init();
 *
 * const response = await transport.send(
 *   JSON.stringify({
 *     id: 1,
 *     protocol: 'tywrap/1',
 *     method: 'call',
 *     params: { module: 'math', functionName: 'sqrt', args: [16], kwargs: {} },
 *   }),
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

  /**
   * Static, transport-level capability descriptor.
   *
   * Returns what this transport can carry and how it frames messages, with
   * honest values for the transport's current behavior (see
   * {@link TransportCapabilities}). It does NOT depend on lifecycle state — it is
   * safe to call before `init()` and after `dispose()`.
   */
  capabilities(): TransportCapabilities;
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
    typeof (value as Transport).capabilities === 'function' &&
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
