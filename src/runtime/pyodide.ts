/**
 * Pyodide runtime bridge.
 *
 * PyodideBridge is a thin facade: it extends DisposableBase (lifecycle) and
 * implements PythonRuntime by HOLDING an RpcClient over a PyodideTransport
 * for in-memory Python execution in browser environments via WebAssembly.
 *
 * @see https://github.com/bbopen/tywrap/issues/149
 */

import { BasePythonBridge } from './base-bridge.js';
import { RpcClient } from './rpc-client.js';
import { PyodideTransport } from './pyodide-transport.js';
import type { CodecOptions } from './bridge-codec.js';

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
 * - Full BridgeCodec validation (NaN/Infinity rejection, key validation)
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
export class PyodideBridge extends BasePythonBridge {
  private readonly rpc: RpcClient;

  /**
   * Create a new PyodideBridge instance.
   *
   * @param options - Configuration options for the bridge
   */
  constructor(options: PyodideBridgeOptions = {}) {
    super();

    const transport = new PyodideTransport({
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
  // RPC DELEGATION (the held RpcClient; never PyodideTransport directly)
  // ===========================================================================

  /**
   * Expose the held RpcClient to BasePythonBridge's shared delegating methods.
   */
  protected getRpcClient(): RpcClient {
    return this.rpc;
  }
}
