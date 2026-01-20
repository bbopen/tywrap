/**
 * PyodideIO Transport - In-memory Pyodide communication for browser environments.
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

import { BoundedContext } from './bounded-context.js';
import { BridgeDisposedError, BridgeExecutionError, BridgeProtocolError } from './errors.js';
import type { Transport, ProtocolMessage, ProtocolResponse } from './transport.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Options for configuring the PyodideIO transport.
 */
export interface PyodideIOOptions {
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
const DEFAULT_INDEX_URL = 'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/';

/**
 * Bootstrap Python code that sets up the dispatch function.
 *
 * This code is injected into Pyodide during initialization and provides
 * a single entry point for all protocol messages. The dispatch function
 * parses JSON messages, routes to appropriate handlers, and returns
 * JSON responses.
 */
const BOOTSTRAP_PYTHON = `
import json
import importlib

__tywrap_instances = {}

def __tywrap_dispatch(message_json):
    """
    Dispatch a protocol message and return a JSON response.

    Args:
        message_json: JSON-encoded ProtocolMessage string

    Returns:
        JSON-encoded ProtocolResponse string
    """
    msg = None
    try:
        msg = json.loads(message_json)
        msg_id = msg['id']
        msg_type = msg['type']

        if msg_type == 'call':
            mod = importlib.import_module(msg['module'])
            fn = getattr(mod, msg['functionName'])
            result = fn(*msg.get('args', []), **msg.get('kwargs', {}))
            return json.dumps({'id': msg_id, 'result': result})

        elif msg_type == 'instantiate':
            mod = importlib.import_module(msg['module'])
            cls = getattr(mod, msg['className'])
            obj = cls(*msg.get('args', []), **msg.get('kwargs', {}))
            handle = str(id(obj))
            __tywrap_instances[handle] = obj
            return json.dumps({'id': msg_id, 'result': handle})

        elif msg_type == 'call_method':
            obj = __tywrap_instances[msg['handle']]
            method = getattr(obj, msg['methodName'])
            result = method(*msg.get('args', []), **msg.get('kwargs', {}))
            return json.dumps({'id': msg_id, 'result': result})

        elif msg_type == 'dispose_instance':
            __tywrap_instances.pop(msg['handle'], None)
            return json.dumps({'id': msg_id, 'result': None})

        else:
            return json.dumps({
                'id': msg_id,
                'error': {
                    'type': 'ValueError',
                    'message': f'Unknown message type: {msg_type}'
                }
            })

    except Exception as e:
        import traceback
        return json.dumps({
            'id': msg.get('id', 'unknown') if msg else 'unknown',
            'error': {
                'type': type(e).__name__,
                'message': str(e),
                'traceback': traceback.format_exc()
            }
        })
`;

// =============================================================================
// PYODIDE IO TRANSPORT
// =============================================================================

/**
 * Transport implementation for in-memory Pyodide communication.
 *
 * This transport extends BoundedContext for lifecycle management and
 * implements the Transport interface for message-based communication.
 *
 * @example
 * ```typescript
 * const transport = new PyodideIO({ packages: ['numpy'] });
 * await transport.init();
 *
 * const response = await transport.send(
 *   JSON.stringify({
 *     id: '1',
 *     type: 'call',
 *     module: 'math',
 *     functionName: 'sqrt',
 *     args: [16]
 *   }),
 *   5000
 * );
 *
 * await transport.dispose();
 * ```
 */
export class PyodideIO extends BoundedContext implements Transport {
  private readonly indexURL: string;
  private readonly packages: readonly string[];
  private py?: PyodideInstance;

  /**
   * Create a new PyodideIO transport.
   *
   * @param options - Configuration options
   */
  constructor(options: PyodideIOOptions = {}) {
    super();
    this.indexURL = options.indexURL ?? DEFAULT_INDEX_URL;
    this.packages = Object.freeze([...(options.packages ?? [])]);
  }

  // ===========================================================================
  // LIFECYCLE (BoundedContext implementation)
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
        if (!parsed.id || !parsed.type) {
          throw new BridgeProtocolError('Message missing required fields: id, type');
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

  // ===========================================================================
  // RUNTIME EXECUTION (BoundedContext abstract methods)
  // ===========================================================================

  /**
   * Call a Python function.
   *
   * Convenience method that constructs a 'call' message and sends it.
   */
  async call<T = unknown>(
    module: string,
    functionName: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T> {
    const message: ProtocolMessage = {
      id: this.generateId(),
      type: 'call',
      module,
      functionName,
      args: args ?? [],
      kwargs,
    };

    const responseJson = await this.send(JSON.stringify(message), 30000);
    return this.parseResponse<T>(responseJson);
  }

  /**
   * Instantiate a Python class.
   *
   * Convenience method that constructs an 'instantiate' message and sends it.
   */
  async instantiate<T = unknown>(
    module: string,
    className: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T> {
    const message: ProtocolMessage = {
      id: this.generateId(),
      type: 'instantiate',
      module,
      className,
      args: args ?? [],
      kwargs,
    };

    const responseJson = await this.send(JSON.stringify(message), 30000);
    return this.parseResponse<T>(responseJson);
  }

  /**
   * Call a method on a Python instance.
   *
   * Convenience method that constructs a 'call_method' message and sends it.
   */
  async callMethod<T = unknown>(
    handle: string,
    methodName: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T> {
    const message: ProtocolMessage = {
      id: this.generateId(),
      type: 'call_method',
      handle,
      methodName,
      args: args ?? [],
      kwargs,
    };

    const responseJson = await this.send(JSON.stringify(message), 30000);
    return this.parseResponse<T>(responseJson);
  }

  /**
   * Dispose a Python instance.
   *
   * Convenience method that constructs a 'dispose_instance' message and sends it.
   */
  async disposeInstance(handle: string): Promise<void> {
    const message: ProtocolMessage = {
      id: this.generateId(),
      type: 'dispose_instance',
      handle,
      args: [],
    };

    const responseJson = await this.send(JSON.stringify(message), 30000);
    this.parseResponse<void>(responseJson);
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
   * Parse a JSON response and extract the result or throw an error.
   */
  private parseResponse<T>(responseJson: string): T {
    const response = JSON.parse(responseJson) as ProtocolResponse;

    if (response.error) {
      const err = new BridgeExecutionError(
        `${response.error.type}: ${response.error.message}`,
        { code: response.error.type }
      );
      err.traceback = response.error.traceback;
      throw err;
    }

    return response.result as T;
  }

  /**
   * Generate a unique message ID.
   */
  private generateId(): string {
    return `pyodide-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
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
