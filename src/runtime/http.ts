/**
 * HTTP runtime bridge for BridgeProtocol.
 *
 * HttpBridge extends BridgeProtocol and uses HttpIO transport for
 * stateless HTTP POST-based communication with a Python server.
 *
 * @see https://github.com/bbopen/tywrap/issues/149
 */

import { BridgeProtocol, type BridgeProtocolOptions } from './bridge-protocol.js';
import { HttpIO } from './http-io.js';
import type { CodecOptions } from './safe-codec.js';
import { autoRegisterArrowDecoder } from '../utils/codec.js';

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
 * - Full SafeCodec validation (NaN/Infinity rejection, key validation)
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
export class HttpBridge extends BridgeProtocol {
  /**
   * Create a new HttpBridge instance.
   *
   * @param options - Configuration options for the bridge
   */
  constructor(options: HttpBridgeOptions) {
    // Create HTTP transport
    const transport = new HttpIO({
      baseURL: options.baseURL,
      headers: options.headers,
      defaultTimeoutMs: options.timeoutMs,
    });

    // Initialize BridgeProtocol with transport and codec options
    const protocolOptions: BridgeProtocolOptions = {
      transport,
      codec: options.codec,
      defaultTimeoutMs: options.timeoutMs,
    };

    super(protocolOptions);
  }

  protected async doInit(): Promise<void> {
    // Best-effort: keep apache-arrow optional and avoid breaking non-Node runtimes.
    await autoRegisterArrowDecoder();
    await super.doInit();
  }
}
