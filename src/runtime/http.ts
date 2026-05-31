/**
 * HTTP runtime bridge.
 *
 * HttpBridge is a thin facade: it extends DisposableBase (lifecycle/resources)
 * and implements PythonRuntime by HOLDING an RpcClient over an HttpTransport
 * for stateless HTTP POST-based communication with a Python server.
 *
 * @see https://github.com/bbopen/tywrap/issues/149
 */

import type { PythonRuntime, BridgeInfo } from '../types/index.js';
import { autoRegisterArrowDecoder } from '../utils/codec.js';

import { DisposableBase } from './bounded-context.js';
import { RpcClient, type GetBridgeInfoOptions } from './rpc-client.js';
import { HttpTransport } from './http-transport.js';
import type { CodecOptions } from './bridge-codec.js';

// =============================================================================
// OPTIONS
// =============================================================================

/**
 * Configuration options for HttpBridge.
 */
export interface HttpBridgeOptions {
  /** Base URL for the Python server (e.g., 'http://localhost:8000') */
  baseURL: string;

  /** Additional headers to include in each request */
  headers?: Record<string, string>;

  /** Timeout in ms for requests. Default: 30000 (30 seconds) */
  timeoutMs?: number;

  /** Codec options for validation/serialization */
  codec?: CodecOptions;
}

// =============================================================================
// HTTP BRIDGE
// =============================================================================

/**
 * HTTP-based runtime bridge for executing Python code.
 *
 * HttpBridge provides a stateless HTTP transport for communication with
 * a Python server. Each request is independent - no connection state is
 * maintained between calls.
 *
 * Features:
 * - Stateless HTTP POST communication
 * - Timeout handling via AbortController
 * - Full BridgeCodec validation (NaN/Infinity rejection, key validation)
 * - Automatic Arrow decoding for DataFrames/ndarrays
 *
 * @example
 * ```typescript
 * const bridge = new HttpBridge({ baseURL: 'http://localhost:8000' });
 * await bridge.init();
 *
 * const result = await bridge.call('math', 'sqrt', [16]);
 * console.log(result); // 4.0
 *
 * await bridge.dispose();
 * ```
 */
export class HttpBridge extends DisposableBase implements PythonRuntime {
  private readonly rpc: RpcClient;

  /**
   * Create a new HttpBridge instance.
   *
   * @param options - Configuration options for the bridge
   */
  constructor(options: HttpBridgeOptions) {
    super();

    const transport = new HttpTransport({
      baseURL: options.baseURL,
      headers: options.headers,
      defaultTimeoutMs: options.timeoutMs,
    });

    this.rpc = new RpcClient({
      transport,
      codec: options.codec,
      defaultTimeoutMs: options.timeoutMs,
    });
    // One disposal chain: facade -> rpc -> transport.
    this.trackResource(this.rpc);
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  protected async doInit(): Promise<void> {
    // Best-effort: keep apache-arrow optional and avoid breaking non-Node runtimes.
    await autoRegisterArrowDecoder();
    await this.rpc.init();
  }

  /**
   * No facade-specific teardown: the RpcClient (and its transport) is tracked
   * as a resource and disposed automatically by DisposableBase.
   */
  protected async doDispose(): Promise<void> {
    // Intentionally empty; tracked resources handle disposal.
  }

  // ===========================================================================
  // RPC METHODS (delegate to the held RpcClient)
  // ===========================================================================

  async call<T = unknown>(
    module: string,
    functionName: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T> {
    await this.ensureReady();
    return this.rpc.call<T>(module, functionName, args, kwargs);
  }

  async instantiate<T = unknown>(
    module: string,
    className: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T> {
    await this.ensureReady();
    return this.rpc.instantiate<T>(module, className, args, kwargs);
  }

  async callMethod<T = unknown>(
    handle: string,
    methodName: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T> {
    await this.ensureReady();
    return this.rpc.callMethod<T>(handle, methodName, args, kwargs);
  }

  async disposeInstance(handle: string): Promise<void> {
    await this.ensureReady();
    return this.rpc.disposeInstance(handle);
  }

  async getBridgeInfo(options?: GetBridgeInfoOptions): Promise<BridgeInfo> {
    await this.ensureReady();
    return this.rpc.getBridgeInfo(options);
  }

  /**
   * Ensure the facade is initialized before delegating an RPC, replicating the
   * auto-init that the bounded execute path provided pre-composition.
   */
  private async ensureReady(): Promise<void> {
    if (!this.isReady) {
      await this.init();
    }
  }
}
