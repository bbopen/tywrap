/**
 * BridgeProtocol - Unified abstraction for JS<->Python communication.
 *
 * Combines BoundedContext + SafeCodec + Transport into a single base class
 * that handles all cross-boundary concerns:
 * - Lifecycle management (init/dispose state machine)
 * - Request/response encoding with validation
 * - Transport-agnostic message passing
 * - Bounded execution (timeout, retry, abort)
 *
 * Subclasses (NodeBridge, HttpBridge, PyodideBridge) only need to:
 * 1. Create their transport in their constructor
 * 2. Pass it to super() via BridgeProtocolOptions
 * 3. Optionally override doInit() and doDispose() for additional setup/teardown
 *
 * @see https://github.com/bbopen/tywrap/issues/149
 */

import type { BridgeInfo } from '../types/index.js';

import { BoundedContext, type ExecuteOptions } from './bounded-context.js';
import { BridgeProtocolError } from './errors.js';
import { SafeCodec, type CodecOptions } from './safe-codec.js';
import { TYWRAP_PROTOCOL_VERSION } from './protocol.js';
import { PROTOCOL_ID, type Transport, type ProtocolMessage } from './transport.js';

// =============================================================================
// TYPES
// =============================================================================

export interface GetBridgeInfoOptions {
  /**
   * If true, bypasses the cached info and queries the bridge again.
   * This is useful when you want up-to-date instance counts or diagnostics.
   */
  refresh?: boolean;
}

/**
 * Configuration options for BridgeProtocol.
 */
export interface BridgeProtocolOptions {
  /** The transport to use for communication */
  transport: Transport;

  /** Codec options for validation/serialization */
  codec?: CodecOptions;

  /** Default timeout for operations in ms. Default: 30000 (30s) */
  defaultTimeoutMs?: number;
}

function validateBridgeInfoPayload(value: unknown): BridgeInfo {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    throw new BridgeProtocolError(`Invalid bridge info payload: expected object, got ${kind}`);
  }

  interface BridgeInfoWire {
    protocol?: unknown;
    protocolVersion?: unknown;
    bridge?: unknown;
    pythonVersion?: unknown;
    pid?: unknown;
    codecFallback?: unknown;
    arrowAvailable?: unknown;
    scipyAvailable?: unknown;
    torchAvailable?: unknown;
    sklearnAvailable?: unknown;
    instances?: unknown;
  }

  const formatValue = (val: unknown): string => {
    try {
      const serialized = JSON.stringify(val);
      return serialized ?? String(val);
    } catch {
      return String(val);
    }
  };

  const obj = value as BridgeInfoWire;

  const protocol = obj.protocol;
  if (protocol !== PROTOCOL_ID) {
    throw new BridgeProtocolError(
      `Invalid bridge info payload: protocol expected "${PROTOCOL_ID}", got ${formatValue(protocol)}`
    );
  }

  const protocolVersion = obj.protocolVersion;
  if (protocolVersion !== TYWRAP_PROTOCOL_VERSION) {
    throw new BridgeProtocolError(
      `Invalid bridge info payload: protocolVersion expected ${TYWRAP_PROTOCOL_VERSION}, got ${formatValue(protocolVersion)}`
    );
  }

  const bridge = obj.bridge;
  if (bridge !== 'python-subprocess') {
    throw new BridgeProtocolError(
      `Invalid bridge info payload: bridge expected "python-subprocess", got ${formatValue(bridge)}`
    );
  }

  const pythonVersion = obj.pythonVersion;
  if (typeof pythonVersion !== 'string' || pythonVersion.length === 0) {
    throw new BridgeProtocolError(
      `Invalid bridge info payload: pythonVersion expected non-empty string, got ${formatValue(pythonVersion)}`
    );
  }

  const pid = obj.pid;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    throw new BridgeProtocolError(
      `Invalid bridge info payload: pid expected positive integer, got ${formatValue(pid)}`
    );
  }

  const codecFallback = obj.codecFallback;
  if (codecFallback !== 'json' && codecFallback !== 'none') {
    throw new BridgeProtocolError(
      `Invalid bridge info payload: codecFallback expected "json" or "none", got ${formatValue(codecFallback)}`
    );
  }

  const arrowAvailable = obj.arrowAvailable;
  if (typeof arrowAvailable !== 'boolean') {
    throw new BridgeProtocolError(
      `Invalid bridge info payload: arrowAvailable expected boolean, got ${formatValue(arrowAvailable)}`
    );
  }

  const scipyAvailable = obj.scipyAvailable;
  if (typeof scipyAvailable !== 'boolean') {
    throw new BridgeProtocolError(
      `Invalid bridge info payload: scipyAvailable expected boolean, got ${formatValue(scipyAvailable)}`
    );
  }

  const torchAvailable = obj.torchAvailable;
  if (typeof torchAvailable !== 'boolean') {
    throw new BridgeProtocolError(
      `Invalid bridge info payload: torchAvailable expected boolean, got ${formatValue(torchAvailable)}`
    );
  }

  const sklearnAvailable = obj.sklearnAvailable;
  if (typeof sklearnAvailable !== 'boolean') {
    throw new BridgeProtocolError(
      `Invalid bridge info payload: sklearnAvailable expected boolean, got ${formatValue(sklearnAvailable)}`
    );
  }

  const instances = obj.instances;
  if (typeof instances !== 'number' || !Number.isInteger(instances) || instances < 0) {
    throw new BridgeProtocolError(
      `Invalid bridge info payload: instances expected non-negative integer, got ${formatValue(instances)}`
    );
  }

  return {
    protocol: PROTOCOL_ID,
    protocolVersion: TYWRAP_PROTOCOL_VERSION,
    bridge: 'python-subprocess',
    pythonVersion,
    pid,
    codecFallback,
    arrowAvailable,
    scipyAvailable,
    torchAvailable,
    sklearnAvailable,
    instances,
  };
}

// =============================================================================
// BRIDGE PROTOCOL BASE CLASS
// =============================================================================

/**
 * BridgeProtocol combines BoundedContext + SafeCodec + Transport
 * into a unified abstraction for all JS<->Python communication.
 *
 * This class provides:
 * - Automatic transport lifecycle management
 * - Request encoding with guardrails (special float rejection, key validation)
 * - Response decoding with Arrow support
 * - Full RuntimeExecution interface implementation
 *
 * Subclasses should:
 * 1. Create their transport in their constructor
 * 2. Pass it to super() via BridgeProtocolOptions
 * 3. Optionally override doInit() and doDispose() for additional setup/teardown
 *
 * @example
 * ```typescript
 * class NodeBridge extends BridgeProtocol {
 *   constructor(options: NodeBridgeOptions) {
 *     const transport = new ProcessIO(options);
 *     super({ transport, defaultTimeoutMs: options.timeout });
 *   }
 * }
 * ```
 */
export class BridgeProtocol extends BoundedContext {
  /** Codec instance for validation and serialization */
  protected readonly codec: SafeCodec;

  /** Transport instance for message passing */
  protected readonly transport: Transport;

  /** Default timeout for operations in milliseconds */
  protected readonly defaultTimeoutMs: number;

  /** Counter for generating unique request IDs */
  private requestId = 0;

  /** Cached bridge diagnostics info (populated by getBridgeInfo). */
  private bridgeInfoCache?: BridgeInfo;

  /**
   * Create a new BridgeProtocol instance.
   *
   * @param options - Configuration options including transport and codec settings
   */
  constructor(options: BridgeProtocolOptions) {
    super();
    this.codec = new SafeCodec(options.codec);
    this.transport = options.transport;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30000;

    // Track the transport for automatic cleanup during dispose
    this.trackResource(this.transport);
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  /**
   * Initialize the protocol.
   *
   * Initializes the underlying transport. Subclasses can override this
   * to add additional initialization logic, but must call super.doInit().
   */
  protected async doInit(): Promise<void> {
    await this.transport.init();
  }

  /**
   * Dispose the protocol.
   *
   * The transport is tracked as a resource and will be disposed automatically
   * by BoundedContext. Subclasses can override this to add additional cleanup,
   * but should not need to dispose the transport manually.
   */
  protected async doDispose(): Promise<void> {
    this.bridgeInfoCache = undefined;
    // Transport is tracked and will be disposed by BoundedContext
    // Subclasses can override to add additional cleanup
  }

  // ===========================================================================
  // MESSAGE SENDING
  // ===========================================================================

  /**
   * Send a protocol message and receive a typed response.
   *
   * This method:
   * 1. Generates a unique request ID
   * 2. Encodes the request with validation (special float rejection, etc.)
   * 3. Sends via transport with timeout/abort support
   * 4. Decodes and validates the response
   *
   * @param message - The protocol message (without id field)
   * @param options - Execution options (timeout, retries, validation)
   * @returns The typed response from Python
   *
   * @throws BridgeProtocolError if encoding/decoding fails
   * @throws BridgeExecutionError if Python returns an error
   * @throws BridgeTimeoutError if the operation times out
   */
  protected async sendMessage<T>(
    message: Omit<ProtocolMessage, 'id' | 'protocol'>,
    options?: ExecuteOptions<T>
  ): Promise<T> {
    const fullMessage: ProtocolMessage = {
      ...message,
      id: this.generateId(),
      protocol: PROTOCOL_ID,
    };

    return this.execute(async () => {
      // 1. Encode request (validates args)
      const encoded = this.codec.encodeRequest(fullMessage);

      // 2. Send via transport
      const responseStr = await this.transport.send(
        encoded,
        options?.timeoutMs ?? this.defaultTimeoutMs,
        options?.signal
      );

      // 3. Decode response (validates result)
      return this.codec.decodeResponse<T>(responseStr);
    }, options);
  }

  /**
   * Async version that uses decodeResponseAsync for Arrow support.
   *
   * Use this method when the response may contain encoded DataFrames,
   * ndarrays, or other Arrow-encoded data structures.
   *
   * @param message - The protocol message (without id field)
   * @param options - Execution options (timeout, retries, validation)
   * @returns The typed response from Python with Arrow decoding applied
   *
   * @throws BridgeProtocolError if encoding/decoding fails
   * @throws BridgeExecutionError if Python returns an error
   * @throws BridgeTimeoutError if the operation times out
   */
  protected async sendMessageAsync<T>(
    message: Omit<ProtocolMessage, 'id' | 'protocol'>,
    options?: ExecuteOptions<T>
  ): Promise<T> {
    const fullMessage: ProtocolMessage = {
      ...message,
      id: this.generateId(),
      protocol: PROTOCOL_ID,
    };

    return this.execute(async () => {
      // 1. Encode request (validates args)
      const encoded = this.codec.encodeRequest(fullMessage);

      // 2. Send via transport
      const responseStr = await this.transport.send(
        encoded,
        options?.timeoutMs ?? this.defaultTimeoutMs,
        options?.signal
      );

      // 3. Decode response with Arrow support
      return this.codec.decodeResponseAsync<T>(responseStr);
    }, options);
  }

  /**
   * Generate a unique request ID.
   *
   * Returns a monotonically increasing integer that ensures uniqueness
   * within a process lifetime.
   */
  private generateId(): number {
    return ++this.requestId;
  }

  // ===========================================================================
  // RUNTIME EXECUTION INTERFACE
  // ===========================================================================

  /**
   * Call a Python function.
   *
   * @param module - Python module path (e.g., 'numpy', 'mypackage.submodule')
   * @param functionName - Function name to call
   * @param args - Positional arguments
   * @param kwargs - Keyword arguments
   * @returns The function result
   */
  async call<T = unknown>(
    module: string,
    functionName: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T> {
    return this.sendMessageAsync<T>({
      method: 'call',
      params: {
        module,
        functionName,
        args,
        kwargs,
      },
    });
  }

  /**
   * Instantiate a Python class.
   *
   * @param module - Python module path containing the class
   * @param className - Class name to instantiate
   * @param args - Positional constructor arguments
   * @param kwargs - Keyword constructor arguments
   * @returns A handle to the created instance
   */
  async instantiate<T = unknown>(
    module: string,
    className: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T> {
    return this.sendMessageAsync<T>({
      method: 'instantiate',
      params: {
        module,
        className,
        args,
        kwargs,
      },
    });
  }

  /**
   * Call a method on a Python instance.
   *
   * @param handle - Instance handle returned from instantiate()
   * @param methodName - Method name to call
   * @param args - Positional arguments
   * @param kwargs - Keyword arguments
   * @returns The method result
   */
  async callMethod<T = unknown>(
    handle: string,
    methodName: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T> {
    return this.sendMessageAsync<T>({
      method: 'call_method',
      params: {
        handle,
        methodName,
        args,
        kwargs,
      },
    });
  }

  /**
   * Dispose a Python instance.
   *
   * Releases the instance handle on the Python side, allowing
   * the object to be garbage collected.
   *
   * @param handle - Instance handle to dispose
   */
  async disposeInstance(handle: string): Promise<void> {
    await this.sendMessageAsync<void>({
      method: 'dispose_instance',
      params: {
        handle,
      },
    });
  }

  /**
   * Fetch bridge diagnostics and feature availability.
   *
   * The Python bridge supports a `meta` method that returns protocol and environment info
   * (including optional codec availability and current instance count).
   */
  async getBridgeInfo(options: GetBridgeInfoOptions = {}): Promise<BridgeInfo> {
    if (!options.refresh && this.bridgeInfoCache) {
      return this.bridgeInfoCache;
    }

    const info = await this.sendMessage<BridgeInfo>(
      {
        method: 'meta',
        params: {},
      },
      {
        validate: validateBridgeInfoPayload,
      }
    );

    this.bridgeInfoCache = info;
    return info;
  }
}
