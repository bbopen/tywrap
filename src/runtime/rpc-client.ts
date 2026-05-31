/**
 * RpcClient - the single correlated-RPC client for JS<->Python communication.
 *
 * It HOLDS a Transport and a codec (SafeCodec) and is, in turn, HELD by the
 * bridge facades (NodeBridge/HttpBridge/PyodideBridge) via composition — it is
 * NOT a base class bridges extend. It owns the one place where the wire frame
 * is built and correlated: id generation, {id, protocol} stamping, codec
 * encode/decode, and transport.send. It composes DisposableBase to obtain its
 * lifecycle (init/dispose) and bounded execution (timeout/retry/abort), but it
 * carries no PythonRuntime contract obligation — the facade implements
 * PythonRuntime and delegates the four RPC methods to this client.
 *
 * Why composition (not inheritance): inheritance previously forced the RPC
 * contract onto a lifecycle base, leaking throwing RPC stubs into transports.
 * Holding one RpcClient keeps exactly one encode/decode/correlation site and
 * lets transports stay pure byte-movers.
 *
 * @see https://github.com/bbopen/tywrap/issues/149
 */

import type { BridgeInfo } from '../types/index.js';

import { DisposableBase, type ExecuteOptions } from './bounded-context.js';
import { BridgeProtocolError } from './errors.js';
import { SafeCodec, type CodecOptions } from './safe-codec.js';
import {
  PROTOCOL_ID,
  TYWRAP_PROTOCOL_VERSION,
  type Transport,
  type ProtocolMessage,
} from './transport.js';

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
 * Configuration options for RpcClient.
 */
export interface RpcClientOptions {
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
// RPC CLIENT
// =============================================================================

/**
 * RpcClient holds a SafeCodec + Transport and composes DisposableBase for
 * lifecycle/bounded-execution. It is the one correlated-RPC client; bridge
 * facades HOLD an instance and delegate their PythonRuntime methods to it.
 *
 * @example
 * ```typescript
 * class NodeBridge extends DisposableBase implements PythonRuntime {
 *   private readonly rpc: RpcClient;
 *   constructor(options: NodeBridgeOptions) {
 *     super();
 *     const transport = new ProcessIO(options);
 *     this.rpc = new RpcClient({ transport, defaultTimeoutMs: options.timeout });
 *     this.trackResource(this.rpc);
 *   }
 *   // call/instantiate/callMethod/disposeInstance delegate to this.rpc.*
 * }
 * ```
 */
export class RpcClient extends DisposableBase {
  /** Codec instance for validation and serialization */
  readonly codec: SafeCodec;

  /** Transport instance for message passing */
  readonly transport: Transport;

  /** Default timeout for operations in milliseconds */
  readonly defaultTimeoutMs: number;

  /** Counter for generating unique request IDs */
  private requestId = 0;

  /** Cached bridge diagnostics info (populated by getBridgeInfo). */
  private bridgeInfoCache?: BridgeInfo;

  /**
   * Create a new RpcClient instance.
   *
   * @param options - Configuration options including transport and codec settings
   */
  constructor(options: RpcClientOptions) {
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
   * Initialize the client by initializing the underlying transport.
   * Driven by the holding facade's lifecycle (facade.init() -> rpc.init()).
   */
  protected async doInit(): Promise<void> {
    await this.transport.init();
  }

  /**
   * Dispose the client.
   *
   * The transport is tracked as a resource and is disposed automatically by
   * DisposableBase. Here we only clear the cached bridge info.
   */
  protected async doDispose(): Promise<void> {
    this.bridgeInfoCache = undefined;
    // Transport is tracked and will be disposed by DisposableBase.
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
  async sendMessage<T>(
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
  async sendMessageAsync<T>(
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
   * Send a message over an EXPLICIT transport (not this.transport) with the
   * same id-generation + codec encode/decode as the normal send path, but
   * WITHOUT this.execute() and WITHOUT auto-init.
   *
   * This is the warmup path: NodeBridge runs warmup commands inside
   * transport.init() (worker spawn -> onWorkerReady), which happens DURING
   * rpc.init(). Routing those through this.execute() would auto-init this same
   * client and re-await the in-flight init() that is itself waiting on warmup,
   * deadlocking. So sendOn deliberately skips lifecycle: it only unifies the
   * id counter + codec, never the state machine.
   *
   * @param transport - The specific worker transport to send on
   * @param message - The protocol message (without id/protocol; stamped here)
   * @param opts - Optional timeout / abort signal
   */
  async sendOn<T>(
    transport: Transport,
    message: Omit<ProtocolMessage, 'id' | 'protocol'>,
    opts?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<T> {
    const fullMessage: ProtocolMessage = {
      ...message,
      id: this.generateId(),
      protocol: PROTOCOL_ID,
    };
    const encoded = this.codec.encodeRequest(fullMessage);
    const responseStr = await transport.send(
      encoded,
      opts?.timeoutMs ?? this.defaultTimeoutMs,
      opts?.signal
    );
    return this.codec.decodeResponseAsync<T>(responseStr);
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
  // RPC METHODS (delegated to by the facade's PythonRuntime implementation)
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
