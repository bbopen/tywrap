/**
 * PyodideTransport - In-memory Pyodide communication for browser environments.
 *
 * This transport implements the Transport interface for direct in-memory
 * communication with Pyodide (Python compiled to WebAssembly). It is designed
 * for browser environments where Python code runs within the same process.
 *
 * Key features:
 * - Zero network overhead (in-memory calls)
 * - Automatic Pyodide loading from CDN or module
 * - Python package loading support
 * - Proper proxy cleanup to prevent memory leaks
 *
 * @see https://github.com/bbopen/tywrap/issues/149
 */

import { DisposableBase } from './bounded-context.js';
import { BridgeProtocolError } from './errors.js';
import { PYODIDE_BRIDGE_CORE_SOURCE } from './pyodide-bootstrap-core.generated.js';
import {
  PROTOCOL_ID,
  type Transport,
  type TransportCapabilities,
  type ProtocolMessage,
  type ProtocolResponse,
} from './transport.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Options for configuring the PyodideTransport.
 */
export interface PyodideTransportOptions {
  /** URL for Pyodide CDN. Default: official CDN */
  indexURL?: string;
  /** Python packages to load during initialization */
  packages?: string[];
}

/**
 * Pyodide loader function type.
 * Avoids direct dependency on pyodide types.
 */
type LoadPyodide = (options: { indexURL: string }) => Promise<PyodideInstance>;

/**
 * Minimal Pyodide instance interface.
 * Avoids direct dependency on pyodide types.
 */
interface PyodideInstance {
  runPython: (code: string) => unknown;
  runPythonAsync: (code: string) => Promise<unknown>;
  globals: { get: (key: string) => unknown; set: (k: string, v: unknown) => void };
  toPy: (obj: unknown) => unknown;
  loadPackage: (name: string | string[]) => Promise<void>;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Default Pyodide CDN URL */
const DEFAULT_INDEX_URL = 'https://cdn.jsdelivr.net/pyodide/v0.28.0/full/';

/**
 * Bootstrap Python code that sets up the dispatch function.
 *
 * This is injected into Pyodide once at init. It does two things:
 *
 *  1. Loads the SHARED bridge core (the exact same code runtime/python_bridge.py
 *     imports) by exec'ing the build-time-embedded source into a fresh module and
 *     registering it in sys.modules as 'tywrap_bridge_core'. Pyodide has no
 *     filesystem to import from, so the source is shipped as a string constant
 *     (PYODIDE_BRIDGE_CORE_SOURCE) kept in sync with the .py by a drift-guard test.
 *
 *  2. Defines the single dispatch entry point __tywrap_dispatch(message_json) the
 *     JS transport calls. It routes through core.dispatch_request and encodes the
 *     response through core.encode_value, mirroring the reference server's error
 *     ladder so the on-the-wire envelopes are byte-identical.
 *
 * CONTRACT (Pyodide side): markers are forced to JSON (force_json_markers=True)
 * because pyarrow is not available in WASM, NaN/Infinity are rejected
 * (allow_nan=False), the bridge identifies itself as 'pyodide' with pid=None, and
 * arrowAvailable is reported False. These choices match the JS-side decoder and
 * the relaxed BridgeInfo validator (bridge in {python-subprocess, pyodide, http},
 * pid number|null).
 *
 * The PYODIDE_CORE_MODULE_NAME must match the import name used inside the core
 * module's own docstring/contract and the conformance harness.
 */
const PYODIDE_CORE_MODULE_NAME = 'tywrap_bridge_core';

// Exported so the cross-backend conformance suite can run the EXACT bootstrap
// source (this string, with the generated core constant inlined and the real
// __tywrap_dispatch error ladder) under CPython — proving the glue, not just the
// shared core module. It is not part of the public package surface.
export const BOOTSTRAP_PYTHON = `
import sys as __tywrap_sys
import json as __tywrap_json
import types as __tywrap_types

# Load the shared bridge core from the embedded source into a real module so the
# Pyodide server runs the IDENTICAL protocol/serialization code as the reference
# subprocess server. Registering in sys.modules lets the core's own internal
# 'import sys' (used lazily in dispatch_request for meta) resolve normally.
__tywrap_core_source = ${JSON.stringify(PYODIDE_BRIDGE_CORE_SOURCE)}
__tywrap_core = __tywrap_types.ModuleType(${JSON.stringify(PYODIDE_CORE_MODULE_NAME)})
__tywrap_sys.modules[${JSON.stringify(PYODIDE_CORE_MODULE_NAME)}] = __tywrap_core
exec(compile(__tywrap_core_source, '<tywrap_bridge_core>', 'exec'), __tywrap_core.__dict__)

__tywrap_instances = {}
__tywrap_protocol = __tywrap_core.PROTOCOL


def __tywrap_dispatch(message_json):
    """
    Dispatch a protocol message and return a JSON response string.

    Mirrors runtime/python_bridge.py main()'s error ladder: ProtocolError ->
    error envelope WITHOUT traceback; any other handler error -> error envelope
    WITH traceback. The final encode goes through core.encode_value(allow_nan=False)
    so NaN/Infinity is rejected with the same wording the subprocess server uses.
    """
    core = __tywrap_core
    mid = None
    try:
        msg = __tywrap_json.loads(message_json)
        if isinstance(msg, dict) and isinstance(msg.get('id'), int):
            mid = msg.get('id')
        try:
            out = core.dispatch_request(
                msg,
                __tywrap_instances,
                bridge='pyodide',
                pid=None,
                force_json_markers=True,
                allow_nan=False,
                arrow_available_override=False,
            )
        except core.ProtocolError as e:
            out = core.build_error_payload(mid, e, include_traceback=False)
        except Exception as e:
            out = core.build_error_payload(mid, e, include_traceback=True)
    except Exception as e:
        # Malformed JSON / unexpected pre-dispatch failure: well-formed error,
        # no traceback (matches the reference's outer handler).
        out = core.build_error_payload(mid, e, include_traceback=False)

    try:
        return core.encode_value(out, allow_nan=False)
    except core.CodecError as e:
        # The subprocess server's encode_response() converts CodecError -> ValueError
        # so the NaN/Infinity rejection surfaces with type 'ValueError'. Match that
        # so the error envelope is byte-identical across backends.
        err_out = core.build_error_payload(mid, ValueError(str(e)), include_traceback=False)
        return __tywrap_json.dumps(err_out)
    except Exception as e:
        # Any other encoding failure: well-formed error envelope, no traceback,
        # exactly as the subprocess server's fallback does.
        err_out = core.build_error_payload(mid, e, include_traceback=False)
        return __tywrap_json.dumps(err_out)
`;

// =============================================================================
// PYODIDE IO TRANSPORT
// =============================================================================

/**
 * Transport implementation for in-memory Pyodide communication.
 *
 * This transport extends DisposableBase for lifecycle management and
 * implements the Transport interface for message-based communication. It is a
 * pure transport: it moves bytes via send() and carries no RPC methods (those
 * live on PythonRuntime, implemented by PyodideBridge through an RpcClient).
 *
 * @example
 * ```typescript
 * const transport = new PyodideTransport({ packages: ['numpy'] });
 * await transport.init();
 *
 * const response = await transport.send(
 *   JSON.stringify({
 *     id: 1,
 *     protocol: 'tywrap/1',
 *     method: 'call',
 *     params: { module: 'math', functionName: 'sqrt', args: [16], kwargs: {} }
 *   }),
 *   5000
 * );
 *
 * await transport.dispose();
 * ```
 */
export class PyodideTransport extends DisposableBase implements Transport {
  private readonly indexURL: string;
  private readonly packages: readonly string[];
  private py?: PyodideInstance;

  /**
   * Create a new PyodideTransport.
   *
   * @param options - Configuration options
   */
  constructor(options: PyodideTransportOptions = {}) {
    super();
    this.indexURL = options.indexURL ?? DEFAULT_INDEX_URL;
    this.packages = Object.freeze([...(options.packages ?? [])]);
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  /**
   * Initialize the Pyodide runtime.
   *
   * This method:
   * 1. Resolves the loadPyodide function (global or dynamic import)
   * 2. Loads Pyodide with the configured indexURL
   * 3. Loads any requested Python packages
   * 4. Bootstraps the dispatch helper function
   *
   * @throws BridgeProtocolError if Pyodide is not available
   */
  protected async doInit(): Promise<void> {
    const loadPyodideFn = await this.resolveLoadPyodide();
    if (!loadPyodideFn) {
      throw new BridgeProtocolError(
        'Pyodide is not available in this environment. ' +
          'Include the Pyodide script tag or install the pyodide package.'
      );
    }

    this.py = await loadPyodideFn({ indexURL: this.indexURL });

    if (this.packages.length > 0) {
      await this.py.loadPackage([...this.packages]);
    }

    await this.bootstrapDispatcher();
  }

  /**
   * Clean up Pyodide resources.
   *
   * Note: Pyodide does not have an explicit dispose mechanism.
   * We clear our reference and rely on garbage collection.
   */
  protected async doDispose(): Promise<void> {
    this.py = undefined;
  }

  // ===========================================================================
  // TRANSPORT INTERFACE
  // ===========================================================================

  /**
   * Send a protocol message to Pyodide and wait for the response.
   *
   * This method:
   * 1. Validates the transport is ready
   * 2. Calls the Python dispatch function with the JSON message
   * 3. Returns the JSON response string
   *
   * The timeout and abort signal are respected, though in-memory calls
   * are typically fast enough that timeouts rarely trigger.
   *
   * @param message - JSON-encoded ProtocolMessage
   * @param timeoutMs - Timeout in milliseconds (0 = no timeout)
   * @param signal - Optional AbortSignal for cancellation
   * @returns JSON-encoded ProtocolResponse
   *
   * @throws BridgeDisposedError if transport is disposed
   * @throws BridgeProtocolError if message is invalid or Pyodide not ready
   * @throws BridgeTimeoutError if operation times out or is aborted
   * @throws BridgeExecutionError for Python execution errors
   */
  async send(message: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
    return this.execute(
      async () => {
        if (!this.py) {
          throw new BridgeProtocolError('Pyodide not initialized');
        }

        // Validate message is parseable JSON
        let parsed: ProtocolMessage;
        try {
          parsed = JSON.parse(message) as ProtocolMessage;
        } catch (e) {
          throw new BridgeProtocolError(`Invalid JSON message: ${(e as Error).message}`);
        }

        // Validate required fields
        if (typeof parsed.id !== 'number' || !Number.isInteger(parsed.id)) {
          throw new BridgeProtocolError('Message missing required fields: id, method');
        }
        if (parsed.protocol !== PROTOCOL_ID || typeof parsed.method !== 'string') {
          throw new BridgeProtocolError('Message missing required fields: id, method');
        }
        if (!parsed.params || typeof parsed.params !== 'object' || Array.isArray(parsed.params)) {
          throw new BridgeProtocolError('Message missing required fields: id, method');
        }

        // Get the dispatch function
        const dispatchFn = this.py.globals.get('__tywrap_dispatch');
        if (!dispatchFn) {
          throw new BridgeProtocolError('Pyodide dispatch function not initialized');
        }

        try {
          // Call the dispatch function
          const invoke = dispatchFn as (messageJson: string) => string;
          const responseJson = invoke(message);

          // Validate response is valid JSON
          try {
            const response = JSON.parse(responseJson) as ProtocolResponse;
            if (typeof response.id !== 'number' || !Number.isInteger(response.id)) {
              throw new BridgeProtocolError('Invalid response from Python: missing numeric id');
            }
            if (response.protocol !== undefined && response.protocol !== PROTOCOL_ID) {
              throw new BridgeProtocolError(
                `Invalid protocol version: expected "${PROTOCOL_ID}", got "${response.protocol}"`
              );
            }
            if (response.error) {
              // Return the response as-is; let the caller handle the error
              return responseJson;
            }
            return responseJson;
          } catch {
            throw new BridgeProtocolError(`Invalid JSON response from Python: ${responseJson}`);
          }
        } finally {
          // Clean up the proxy
          this.destroyPyProxy(dispatchFn);
        }
      },
      { timeoutMs, signal }
    );
  }

  /**
   * Static capability descriptor for the Pyodide backend.
   *
   * The in-WASM server is JSON-only — pyarrow is unavailable in WASM, so the
   * bootstrap forces JSON markers and reports `arrowAvailable: false`; hence
   * `supportsArrow: false`. Binary still rides through base64 bytes envelopes.
   * Chunking/streaming are not implemented (0.8.0). Calls are in-memory string
   * passing with no framing, so there is no transport-level frame ceiling
   * (`maxFrameBytes: Number.POSITIVE_INFINITY`).
   */
  capabilities(): TransportCapabilities {
    return {
      backend: 'pyodide',
      supportsArrow: false,
      supportsBinary: true,
      supportsChunking: false,
      supportsStreaming: false,
      maxFrameBytes: Number.POSITIVE_INFINITY,
    };
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  /**
   * Resolve the loadPyodide function.
   *
   * First checks for a global loadPyodide (browser script tag include),
   * then falls back to dynamic import of the 'pyodide' module.
   */
  private async resolveLoadPyodide(): Promise<LoadPyodide | undefined> {
    // Check for global loadPyodide (browser script tag)
    const g = globalThis as unknown as { loadPyodide?: LoadPyodide };
    if (typeof g.loadPyodide === 'function') {
      return g.loadPyodide;
    }

    // Try dynamic import
    try {
      const mod = (await import('pyodide')) as unknown as { loadPyodide?: LoadPyodide };
      if (typeof mod.loadPyodide === 'function') {
        return mod.loadPyodide;
      }
    } catch {
      // Pyodide module not available
      // This is expected in most environments
    }

    return undefined;
  }

  /**
   * Bootstrap the Python dispatch function.
   */
  private async bootstrapDispatcher(): Promise<void> {
    if (!this.py) {
      return;
    }
    await this.py.runPythonAsync(BOOTSTRAP_PYTHON);
  }

  /**
   * Safely destroy a Pyodide proxy object.
   *
   * Pyodide proxy objects must be explicitly destroyed to prevent memory leaks.
   * This method checks if the value has a destroy method and calls it.
   */
  private destroyPyProxy(value: unknown): void {
    if (value && typeof (value as { destroy?: () => void }).destroy === 'function') {
      try {
        (value as { destroy: () => void }).destroy();
      } catch {
        // Ignore cleanup failures
      }
    }
  }
}
