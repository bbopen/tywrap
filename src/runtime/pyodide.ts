/**
 * Pyodide runtime bridge for BridgeProtocol.
 *
 * PyodideBridge extends BridgeProtocol and uses PyodideIO transport for
 * in-memory Python execution in browser environments via WebAssembly.
 *
 * @see https://github.com/bbopen/tywrap/issues/149
 */

import { BridgeProtocol, type BridgeProtocolOptions } from './bridge-protocol.js';
import { PyodideIO, type PyodideIOOptions } from './pyodide-io.js';
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
export class PyodideBridge extends BridgeProtocol {
  /**
   * Create a new PyodideBridge instance.
   *
   * @param options - Configuration options for the bridge
   */
  constructor(options: PyodideBridgeOptions = {}) {
    // Create Pyodide transport
    const transport = new PyodideIO({
      indexURL: options.indexURL,
      packages: options.packages,
    });

    // Initialize BridgeProtocol with transport and codec options
    const protocolOptions: BridgeProtocolOptions = {
      transport,
      codec: options.codec,
      defaultTimeoutMs: options.timeoutMs,
    };

    super(protocolOptions);
  }
}
