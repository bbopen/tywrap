/**
 * RpcClient - the single correlated-RPC client for JS<->Python communication.
 *
 * It HOLDS a Transport and a codec (BridgeCodec) and is, in turn, HELD by the
 * bridge facades (NodeBridge/HttpBridge/PyodideBridge) via composition — it is
 * NOT a base class bridges extend. It owns the one place where the wire frame
 * is built and correlated: id generation, {id, protocol} stamping, codec
 * encode/decode, and transport.send. It composes DisposableBase to obtain its
 * lifecycle (init/dispose) and single-attempt bounded execution (timeout/abort), but it
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

import type { BridgeBackend, BridgeInfo } from '../types/index.js';

import { DisposableBase, type ExecuteOptions } from './bounded-context.js';
import { BridgeProtocolError } from './errors.js';
import { BridgeCodec, type CodecOptions } from './bridge-codec.js';
import {
  PROTOCOL_ID,
  TYWRAP_PROTOCOL_VERSION,
  type Transport,
  type TransportCapabilities,
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
    transport?: unknown;
  }

  /** Honest set of backend identities a `meta` payload may report. */
  const KNOWN_BRIDGES: readonly BridgeBackend[] = ['python-subprocess', 'pyodide', 'http'];

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

  // Accept the honest BridgeBackend union (subprocess/pyodide/http). All
  // backends speak the identical "tywrap/1" protocol; relaxing this from the
  // old hardcoded 'python-subprocess' lets the Pyodide/HTTP facades route
  // getBridgeInfo() through this same validator without being rejected.
  const bridge = obj.bridge;
  if (typeof bridge !== 'string' || !KNOWN_BRIDGES.includes(bridge as BridgeBackend)) {
    throw new BridgeProtocolError(
      `Invalid bridge info payload: bridge expected one of ${KNOWN_BRIDGES.map(b => `"${b}"`).join(
        ', '
      )}, got ${formatValue(bridge)}`
    );
  }

  const pythonVersion = obj.pythonVersion;
  if (typeof pythonVersion !== 'string' || pythonVersion.length === 0) {
    throw new BridgeProtocolError(
      `Invalid bridge info payload: pythonVersion expected non-empty string, got ${formatValue(pythonVersion)}`
    );
  }

  // pid is OPTIONAL across backends: subprocess reports a real OS pid (positive
  // integer); in-WASM Pyodide (and HTTP) have no local process and report null.
  // Accept a positive integer OR null; reject any other shape (e.g. 0, negative,
  // non-integer, string).
  const pid = obj.pid;
  if (pid !== null && (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0)) {
    throw new BridgeProtocolError(
      `Invalid bridge info payload: pid expected positive integer or null, got ${formatValue(pid)}`
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

  const info: BridgeInfo = {
    protocol: PROTOCOL_ID,
    protocolVersion: TYWRAP_PROTOCOL_VERSION,
    bridge: bridge as BridgeBackend,
    pythonVersion,
    pid,
    codecFallback,
    arrowAvailable,
    scipyAvailable,
    torchAvailable,
    sklearnAvailable,
    instances,
  };
  return info;
}

// =============================================================================
// RPC CLIENT
// =============================================================================

/**
 * RpcClient holds a BridgeCodec + Transport and composes DisposableBase for
 * lifecycle/bounded-execution. It is the one correlated-RPC client; bridge
 * facades HOLD an instance and delegate their PythonRuntime methods to it.
 *
 * @example
 * ```typescript
 * class NodeBridge extends DisposableBase implements PythonRuntime {
 *   private readonly rpc: RpcClient;
 *   constructor(options: NodeBridgeOptions) {
 *     super();
 *     const transport = new SubprocessTransport(options);
 *     this.rpc = new RpcClient({ transport, defaultTimeoutMs: options.timeout });
 *     this.trackResource(this.rpc);
 *   }
 *   // call and getBridgeInfo delegate to this.rpc.*
 * }
 * ```
 */
export class RpcClient extends DisposableBase {
  /** Codec instance for validation and serialization */
  readonly codec: BridgeCodec;

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
    this.codec = new BridgeCodec(options.codec);
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
   * @param options - Execution options (timeout, validation, and abort)
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
    return this.sendVia(message, options, responseStr => this.codec.decodeResponse<T>(responseStr));
  }

  /**
   * Async version that uses decodeResponseAsync for Arrow support.
   *
   * Use this method when the response may contain encoded DataFrames,
   * ndarrays, or other Arrow-encoded data structures.
   *
   * @param message - The protocol message (without id field)
   * @param options - Execution options (timeout, validation, and abort)
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
    return this.sendVia(message, options, responseStr =>
      this.codec.decodeResponseAsync<T>(responseStr)
    );
  }

  /**
   * Shared body for sendMessage/sendMessageAsync: stamp the frame, run the
   * encode -> transport.send -> decode pipeline inside this.execute() (which
   * supplies auto-init and exactly-one-attempt timeout/abort handling), where the only difference between
   * the sync and Arrow-aware paths is the supplied `decode` step.
   *
   * Behavior-preserving extraction of the two twins; ordering, the
   * `options?.timeoutMs ?? this.defaultTimeoutMs` fallback, and the
   * `this.execute(..., options)` wrapping are unchanged.
   */
  private async sendVia<T>(
    message: Omit<ProtocolMessage, 'id' | 'protocol'>,
    options: ExecuteOptions<T> | undefined,
    decode: (responseStr: string) => T | Promise<T>
  ): Promise<T> {
    const fullMessage = this.stampMessage(message);

    return this.execute(async () => {
      // 1. Encode request (validates args)
      const encoded = this.codec.encodeRequest(fullMessage);

      // 2. Send via transport
      const responseStr = await this.transport.send(
        encoded,
        options?.timeoutMs ?? this.defaultTimeoutMs,
        options?.signal,
        fullMessage.id
      );

      // 3. Decode response (sync or Arrow-aware, per caller)
      return decode(responseStr);
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
    const fullMessage = this.stampMessage(message);
    const encoded = this.codec.encodeRequest(fullMessage);
    const responseStr = await transport.send(
      encoded,
      opts?.timeoutMs ?? this.defaultTimeoutMs,
      opts?.signal,
      fullMessage.id
    );
    return this.codec.decodeResponseAsync<T>(responseStr);
  }

  /**
   * Stamp a partial message into a full wire frame: assign the next request id
   * and the protocol marker. The single id counter + protocol stamping live
   * here so every send path (sendMessage/sendMessageAsync/sendOn) is correlated
   * identically.
   */
  private stampMessage(message: Omit<ProtocolMessage, 'id' | 'protocol'>): ProtocolMessage {
    return {
      ...message,
      id: this.generateId(),
      protocol: PROTOCOL_ID,
    };
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
   * Fetch bridge diagnostics and feature availability.
   *
   * The Python bridge supports a `meta` method that returns protocol and environment info
   * (including optional codec availability and a fixed zero instance count).
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

    if (info.instances !== 0) {
      throw new BridgeProtocolError(
        `Invalid bridge info payload: instances expected 0, got ${String(info.instances)}`
      );
    }

    this.bridgeInfoCache = info;
    return info;
  }

  /**
   * Report the underlying transport's static capability descriptor.
   *
   * This returns the transport-level flags (Arrow/binary carriage, framing,
   * chunking/streaming, max frame size) WITHOUT any network round-trip — the
   * descriptor is authoritative for what the wire channel can do. It is
   * deliberately distinct from {@link getBridgeInfo}, which reports the *Python
   * environment* (which optional libraries are importable). Callers that need
   * both — "can this transport carry Arrow AND does this Python have pyarrow?" —
   * should consult both: the transport descriptor for the channel, the bridge
   * info for library availability.
   */
  capabilities(): TransportCapabilities {
    return this.transport.capabilities();
  }
}
