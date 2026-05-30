/**
 * Pyodide runtime bridge.
 *
 * PyodideBridge is a thin facade: it extends DisposableBase (lifecycle) and
 * implements PythonRuntime by HOLDING an RpcClient over a PyodideIO transport
 * for in-memory Python execution in browser environments via WebAssembly.
 *
 * @see https://github.com/bbopen/tywrap/issues/149
 */

import type { PythonRuntime, BridgeInfo } from '../types/index.js';

import { DisposableBase } from './bounded-context.js';
import { RpcClient, type GetBridgeInfoOptions } from './rpc-client.js';
import { PyodideIO } from './pyodide-io.js';
import type { CodecOptions } from './safe-codec.js';

// =============================================================================
// OPTIONS
// =============================================================================

/**
 * Configuration options for PyodideBridge.
 */
export interface PyodideBridgeOptions {
  /** URL for Pyodide CDN. Default: official CDN */
  indexURL?: string;

  /** Python packages to load during initialization */
  packages?: string[];

  /** Timeout in ms for operations. Default: 30000 (30 seconds) */
  timeoutMs?: number;

  /** Codec options for validation/serialization */
  codec?: CodecOptions;
}

// =============================================================================
// PYODIDE BRIDGE
// =============================================================================

/**
 * Browser-based runtime bridge for executing Python code via Pyodide.
 *
 * PyodideBridge provides in-memory Python execution using Pyodide (Python
 * compiled to WebAssembly). This enables running Python directly in the
 * browser without a server.
 *
 * Features:
 * - Zero network overhead (in-memory execution)
 * - Automatic Pyodide loading from CDN or module
 * - Python package loading support
 * - Full SafeCodec validation (NaN/Infinity rejection, key validation)
 * - Proper proxy cleanup to prevent memory leaks
 *
 * @example
 * ```typescript
 * const bridge = new PyodideBridge({
 *   packages: ['numpy'],
 * });
 * await bridge.init();
 *
 * const result = await bridge.call('math', 'sqrt', [16]);
 * console.log(result); // 4.0
 *
 * await bridge.dispose();
 * ```
 */
export class PyodideBridge extends DisposableBase implements PythonRuntime {
  private readonly rpc: RpcClient;

  /**
   * Create a new PyodideBridge instance.
   *
   * @param options - Configuration options for the bridge
   */
  constructor(options: PyodideBridgeOptions = {}) {
    super();

    const transport = new PyodideIO({
      indexURL: options.indexURL,
      packages: options.packages,
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
    // No facade-specific pre-init; the held RpcClient drives transport.init().
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
  // RPC METHODS (delegate to the held RpcClient; never PyodideIO directly)
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
