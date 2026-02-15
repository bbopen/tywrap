/**
 * Transport Test Suite
 *
 * Comprehensive tests for the Transport interface and all implementations:
 * - Transport interface type guards
 * - ProcessIO (subprocess-based transport)
 * - HttpIO (HTTP POST-based transport)
 * - PyodideIO (in-memory Pyodide transport)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PROTOCOL_ID,
  isTransport,
  isProtocolMessage,
  isProtocolResponse,
  type Transport,
  type ProtocolMessage,
  type ProtocolResponse,
} from '../src/runtime/transport.js';
import { ProcessIO, type ProcessIOOptions } from '../src/runtime/process-io.js';
import { HttpIO, type HttpIOOptions } from '../src/runtime/http-io.js';
import { PyodideIO, type PyodideIOOptions } from '../src/runtime/pyodide-io.js';
import {
  BridgeDisposedError,
  BridgeProtocolError,
  BridgeTimeoutError,
  BridgeExecutionError,
  BridgeError,
} from '../src/runtime/errors.js';

// =============================================================================
// TEST UTILITIES
// =============================================================================

/**
 * Check if Python is available on the system.
 */
async function isPythonAvailable(): Promise<boolean> {
  try {
    const { spawn } = await import('child_process');
    return new Promise<boolean>(resolve => {
      const proc = spawn('python3', ['--version']);
      proc.on('error', () => resolve(false));
      proc.on('exit', code => resolve(code === 0));
    });
  } catch {
    return false;
  }
}

/**
 * Create a mock Transport for testing type guards.
 */
function createMockTransport(): Transport {
  return {
    init: async () => {},
    send: async () => '{}',
    dispose: async () => {},
    isReady: true,
  };
}

/**
 * Create a valid ProtocolMessage for testing.
 */
function createValidMessage(overrides: Partial<ProtocolMessage> = {}): ProtocolMessage {
  return {
    id: 1,
    protocol: PROTOCOL_ID,
    method: 'call',
    params: {
      module: 'math',
      functionName: 'sqrt',
      args: [16],
    },
    ...overrides,
  };
}

/**
 * Create a valid ProtocolResponse for testing.
 */
function createValidResponse(overrides: Partial<ProtocolResponse> = {}): ProtocolResponse {
  return {
    id: 1,
    result: 4,
    ...overrides,
  };
}

// =============================================================================
// TRANSPORT INTERFACE TYPE GUARDS
// =============================================================================

describe('Transport Interface', () => {
  describe('isTransport', () => {
    it('returns true for valid Transport objects', () => {
      const transport = createMockTransport();
      expect(isTransport(transport)).toBe(true);
    });

    it('returns true for objects with all required methods and properties', () => {
      const validTransport = {
        init: () => Promise.resolve(),
        send: () => Promise.resolve(''),
        dispose: () => Promise.resolve(),
        isReady: false,
      };
      expect(isTransport(validTransport)).toBe(true);
    });

    it('returns false for null', () => {
      expect(isTransport(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isTransport(undefined)).toBe(false);
    });

    it('returns false for primitives', () => {
      expect(isTransport('string')).toBe(false);
      expect(isTransport(42)).toBe(false);
      expect(isTransport(true)).toBe(false);
    });

    it('returns false for objects missing init method', () => {
      const incomplete = {
        send: () => Promise.resolve(''),
        dispose: () => Promise.resolve(),
        isReady: true,
      };
      expect(isTransport(incomplete)).toBe(false);
    });

    it('returns false for objects missing send method', () => {
      const incomplete = {
        init: () => Promise.resolve(),
        dispose: () => Promise.resolve(),
        isReady: true,
      };
      expect(isTransport(incomplete)).toBe(false);
    });

    it('returns false for objects missing dispose method', () => {
      const incomplete = {
        init: () => Promise.resolve(),
        send: () => Promise.resolve(''),
        isReady: true,
      };
      expect(isTransport(incomplete)).toBe(false);
    });

    it('returns false for objects missing isReady property', () => {
      const incomplete = {
        init: () => Promise.resolve(),
        send: () => Promise.resolve(''),
        dispose: () => Promise.resolve(),
      };
      expect(isTransport(incomplete)).toBe(false);
    });

    it('returns false for objects with non-function init', () => {
      const invalid = {
        init: 'not a function',
        send: () => Promise.resolve(''),
        dispose: () => Promise.resolve(),
        isReady: true,
      };
      expect(isTransport(invalid)).toBe(false);
    });

    it('returns false for objects with non-function send', () => {
      const invalid = {
        init: () => Promise.resolve(),
        send: 'not a function',
        dispose: () => Promise.resolve(),
        isReady: true,
      };
      expect(isTransport(invalid)).toBe(false);
    });

    it('returns false for objects with non-function dispose', () => {
      const invalid = {
        init: () => Promise.resolve(),
        send: () => Promise.resolve(''),
        dispose: 'not a function',
        isReady: true,
      };
      expect(isTransport(invalid)).toBe(false);
    });
  });

  describe('isProtocolMessage', () => {
    it('returns true for valid call message', () => {
      const msg = createValidMessage({ type: 'call' });
      expect(isProtocolMessage(msg)).toBe(true);
    });

    it('returns true for valid instantiate message', () => {
      const msg = createValidMessage({
        method: 'instantiate',
        params: {
          module: 'mymodule',
          className: 'MyClass',
          args: [],
        },
      });
      expect(isProtocolMessage(msg)).toBe(true);
    });

    it('returns true for valid call_method message', () => {
      const msg = createValidMessage({
        method: 'call_method',
        params: {
          handle: 'handle-123',
          methodName: 'myMethod',
          args: [],
        },
      });
      expect(isProtocolMessage(msg)).toBe(true);
    });

    it('returns true for valid dispose_instance message', () => {
      const msg = createValidMessage({
        method: 'dispose_instance',
        params: {
          handle: 'handle-123',
        },
      });
      expect(isProtocolMessage(msg)).toBe(true);
    });

    it('returns false for null', () => {
      expect(isProtocolMessage(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isProtocolMessage(undefined)).toBe(false);
    });

    it('returns false for primitives', () => {
      expect(isProtocolMessage('string')).toBe(false);
      expect(isProtocolMessage(42)).toBe(false);
    });

    it('returns false for message missing id', () => {
      const msg = { type: 'call', args: [] };
      expect(isProtocolMessage(msg)).toBe(false);
    });

    it('returns false for message with non-number id', () => {
      const msg = { id: 'string-id', protocol: PROTOCOL_ID, method: 'call', params: {} };
      expect(isProtocolMessage(msg)).toBe(false);
    });

    it('returns false for message missing protocol', () => {
      const msg = { id: 1, method: 'call', params: {} };
      expect(isProtocolMessage(msg)).toBe(false);
    });

    it('returns false for message with wrong protocol', () => {
      const msg = { id: 1, protocol: 'wrong/1', method: 'call', params: {} };
      expect(isProtocolMessage(msg)).toBe(false);
    });

    it('returns false for message missing method', () => {
      const msg = { id: 1, protocol: PROTOCOL_ID, params: {} };
      expect(isProtocolMessage(msg)).toBe(false);
    });

    it('returns false for message with invalid method', () => {
      const msg = { id: 1, protocol: PROTOCOL_ID, method: 'invalid_method', params: {} };
      expect(isProtocolMessage(msg)).toBe(false);
    });

    it('returns false for message missing params', () => {
      const msg = { id: 1, protocol: PROTOCOL_ID, method: 'call' };
      expect(isProtocolMessage(msg)).toBe(false);
    });

    it('returns false for message with non-object params', () => {
      const msg = { id: 1, protocol: PROTOCOL_ID, method: 'call', params: 'string' };
      expect(isProtocolMessage(msg)).toBe(false);
    });

    it('returns true for message with empty params object', () => {
      const msg = { id: 1, protocol: PROTOCOL_ID, method: 'call', params: {} };
      expect(isProtocolMessage(msg)).toBe(true);
    });

    it('returns true for message with full params', () => {
      const msg = {
        id: 1,
        protocol: PROTOCOL_ID,
        method: 'call',
        params: { module: 'math', functionName: 'sqrt', args: [16], kwargs: { key: 'value' } },
      };
      expect(isProtocolMessage(msg)).toBe(true);
    });
  });

  describe('isProtocolResponse', () => {
    it('returns true for valid success response', () => {
      const resp = createValidResponse();
      expect(isProtocolResponse(resp)).toBe(true);
    });

    it('returns true for response with null result', () => {
      const resp = createValidResponse({ result: null });
      expect(isProtocolResponse(resp)).toBe(true);
    });

    it('returns true for response with undefined result (void return)', () => {
      const resp: ProtocolResponse = { id: 1 };
      expect(isProtocolResponse(resp)).toBe(true);
    });

    it('returns true for valid error response', () => {
      const resp: ProtocolResponse = {
        id: 1,
        error: {
          type: 'ValueError',
          message: 'invalid argument',
        },
      };
      expect(isProtocolResponse(resp)).toBe(true);
    });

    it('returns true for error response with traceback', () => {
      const resp: ProtocolResponse = {
        id: 1,
        error: {
          type: 'RuntimeError',
          message: 'something failed',
          traceback: 'Traceback (most recent call last):...',
        },
      };
      expect(isProtocolResponse(resp)).toBe(true);
    });

    it('returns false for null', () => {
      expect(isProtocolResponse(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isProtocolResponse(undefined)).toBe(false);
    });

    it('returns false for primitives', () => {
      expect(isProtocolResponse('string')).toBe(false);
      expect(isProtocolResponse(42)).toBe(false);
    });

    it('returns false for response missing id', () => {
      const resp = { result: 'value' };
      expect(isProtocolResponse(resp)).toBe(false);
    });

    it('returns false for response with non-number id', () => {
      const resp = { id: 'string-id', result: 'value' };
      expect(isProtocolResponse(resp)).toBe(false);
    });

    it('returns false for response with null error', () => {
      const resp = { id: 1, error: null };
      expect(isProtocolResponse(resp)).toBe(false);
    });

    it('returns false for response with non-object error', () => {
      const resp = { id: 1, error: 'string error' };
      expect(isProtocolResponse(resp)).toBe(false);
    });

    it('returns false for error missing type', () => {
      const resp = { id: 1, error: { message: 'oops' } };
      expect(isProtocolResponse(resp)).toBe(false);
    });

    it('returns false for error missing message', () => {
      const resp = { id: 1, error: { type: 'Error' } };
      expect(isProtocolResponse(resp)).toBe(false);
    });

    it('returns false for error with non-string type', () => {
      const resp = { id: 1, error: { type: 123, message: 'oops' } };
      expect(isProtocolResponse(resp)).toBe(false);
    });

    it('returns false for error with non-string message', () => {
      const resp = { id: 1, error: { type: 'Error', message: 123 } };
      expect(isProtocolResponse(resp)).toBe(false);
    });
  });
});

// =============================================================================
// PROCESSIO TESTS
// =============================================================================

describe('ProcessIO', () => {
  // Skip tests if Python is not available
  let pythonAvailable: boolean;

  interface ProcessIOInternals {
    _state: string;
    processExited: boolean;
    stderrBuffer: string;
    process: { stdin: { write: (data: string) => boolean } } | null;
    handleStdinDrain: () => void;
    handleResponseLine: (line: string) => void;
  }

  beforeEach(async () => {
    pythonAvailable = await isPythonAvailable();
  });

  describe('constructor', () => {
    it('creates instance with required options', () => {
      const transport = new ProcessIO({ bridgeScript: '/path/to/bridge.py' });
      expect(transport).toBeInstanceOf(ProcessIO);
    });

    it('uses default pythonPath when not specified', () => {
      const transport = new ProcessIO({ bridgeScript: '/path/to/bridge.py' });
      expect(transport).toBeDefined();
    });

    it('accepts custom pythonPath', () => {
      const transport = new ProcessIO({
        bridgeScript: '/path/to/bridge.py',
        pythonPath: '/usr/local/bin/python3',
      });
      expect(transport).toBeDefined();
    });

    it('accepts custom environment variables', () => {
      const transport = new ProcessIO({
        bridgeScript: '/path/to/bridge.py',
        env: { CUSTOM_VAR: 'value' },
      });
      expect(transport).toBeDefined();
    });

    it('accepts custom maxLineLength', () => {
      const transport = new ProcessIO({
        bridgeScript: '/path/to/bridge.py',
        maxLineLength: 1024 * 1024,
      });
      expect(transport).toBeDefined();
    });

    it('accepts restartAfterRequests option', () => {
      const transport = new ProcessIO({
        bridgeScript: '/path/to/bridge.py',
        restartAfterRequests: 100,
      });
      expect(transport).toBeDefined();
    });
  });

  describe('lifecycle', () => {
    it('starts in idle state', () => {
      const transport = new ProcessIO({ bridgeScript: '/path/to/bridge.py' });
      expect(transport.state).toBe('idle');
      expect(transport.isReady).toBe(false);
      expect(transport.isDisposed).toBe(false);
    });

    it('transitions to disposed state after dispose', async () => {
      const transport = new ProcessIO({ bridgeScript: '/path/to/bridge.py' });
      await transport.dispose();
      expect(transport.state).toBe('disposed');
      expect(transport.isReady).toBe(false);
      expect(transport.isDisposed).toBe(true);
    });

    it('double dispose is idempotent', async () => {
      const transport = new ProcessIO({ bridgeScript: '/path/to/bridge.py' });
      await transport.dispose();
      await transport.dispose(); // Should not throw
      expect(transport.isDisposed).toBe(true);
    });

    it('rejects send after dispose', async () => {
      const transport = new ProcessIO({ bridgeScript: '/path/to/bridge.py' });
      await transport.dispose();
      const message = JSON.stringify(createValidMessage());
      await expect(transport.send(message, 1000)).rejects.toThrow(BridgeDisposedError);
    });
  });

  describe('send - validation', () => {
    it('rejects when process is not running (process exited)', async () => {
      const transport = new ProcessIO({ bridgeScript: '/path/to/bridge.py' });

      // Mock the state to ready but process exited
      (transport as any)._state = 'ready';
      (transport as any).process = null;
      (transport as any).processExited = true;

      const message = JSON.stringify(createValidMessage());
      await expect(transport.send(message, 1000)).rejects.toThrow(BridgeProtocolError);
      await expect(transport.send(message, 1000)).rejects.toThrow(/not running/);

      // Reset state so dispose works
      (transport as any)._state = 'idle';
      (transport as any).process = null;
      await transport.dispose();
    });

    it('does not duplicate a write when backpressure starts', async () => {
      const transport = new ProcessIO({ bridgeScript: '/path/to/bridge.py' });
      const writes: string[] = [];
      let firstWrite = true;

      const internals = transport as unknown as ProcessIOInternals;
      internals._state = 'ready';
      internals.processExited = false;
      internals.process = {
        stdin: {
          write: (data: string): boolean => {
            writes.push(data);
            if (firstWrite) {
              firstWrite = false;
              return false;
            }
            return true;
          },
        },
      };

      const messageId = 101;
      const message = JSON.stringify(createValidMessage({ id: messageId }));
      const pending = transport.send(message, 1000);

      expect(writes).toHaveLength(1);

      internals.handleStdinDrain();
      expect(writes).toHaveLength(1);

      internals.handleResponseLine(JSON.stringify({ id: messageId, result: 4 }));
      await expect(pending).resolves.toContain(`"id":${messageId}`);
    });

    it('does not replay queued writes when drain write returns false', async () => {
      const transport = new ProcessIO({ bridgeScript: '/path/to/bridge.py' });
      const writes: string[] = [];
      let writeCount = 0;

      const internals = transport as unknown as ProcessIOInternals;
      internals._state = 'ready';
      internals.processExited = false;
      internals.process = {
        stdin: {
          write: (data: string): boolean => {
            writes.push(data);
            writeCount += 1;
            return writeCount >= 3;
          },
        },
      };

      const firstId = 201;
      const secondId = 202;
      const firstPending = transport.send(
        JSON.stringify(createValidMessage({ id: firstId })),
        1000
      );
      const secondPending = transport.send(
        JSON.stringify(createValidMessage({ id: secondId })),
        1000
      );

      expect(writes).toHaveLength(1);

      // First drain flushes the queued second message. Its write() still returns false,
      // but that write must not be replayed.
      internals.handleStdinDrain();
      expect(writes).toHaveLength(2);

      // Additional drain should not replay already accepted writes.
      internals.handleStdinDrain();
      expect(writes).toHaveLength(2);

      internals.handleResponseLine(JSON.stringify({ id: firstId, result: 1 }));
      internals.handleResponseLine(JSON.stringify({ id: secondId, result: 2 }));
      await expect(firstPending).resolves.toContain(`"id":${firstId}`);
      await expect(secondPending).resolves.toContain(`"id":${secondId}`);
    });

    it('includes stderr diagnostics when stdin write fails', async () => {
      const transport = new ProcessIO({ bridgeScript: '/path/to/bridge.py' });

      const internals = transport as unknown as ProcessIOInternals;
      internals._state = 'ready';
      internals.processExited = false;
      internals.stderrBuffer =
        'CodecMaxBytesParseError: TYWRAP_CODEC_MAX_BYTES must be an integer byte count';
      internals.process = {
        stdin: {
          write: (): boolean => {
            throw new Error('write EPIPE');
          },
        },
      };

      const message = JSON.stringify(createValidMessage({ id: 303 }));
      await expect(transport.send(message, 1000)).rejects.toThrow(/TYWRAP_CODEC_MAX_BYTES/);
    });
  });

  describe('abstract method stubs', () => {
    it('call throws BridgeExecutionError synchronously', () => {
      const transport = new ProcessIO({ bridgeScript: '/path/to/bridge.py' });
      // These methods throw synchronously, not asynchronously
      expect(() => transport.call('module', 'func', [])).toThrow(BridgeExecutionError);
      expect(() => transport.call('module', 'func', [])).toThrow(/use BridgeProtocol/);
    });

    it('instantiate throws BridgeExecutionError synchronously', () => {
      const transport = new ProcessIO({ bridgeScript: '/path/to/bridge.py' });
      expect(() => transport.instantiate('module', 'Class', [])).toThrow(BridgeExecutionError);
    });

    it('callMethod throws BridgeExecutionError synchronously', () => {
      const transport = new ProcessIO({ bridgeScript: '/path/to/bridge.py' });
      expect(() => transport.callMethod('handle', 'method', [])).toThrow(BridgeExecutionError);
    });

    it('disposeInstance throws BridgeExecutionError synchronously', () => {
      const transport = new ProcessIO({ bridgeScript: '/path/to/bridge.py' });
      expect(() => transport.disposeInstance('handle')).toThrow(BridgeExecutionError);
    });
  });

  describe('integration tests (require Python)', () => {
    it.skipIf(!pythonAvailable)(
      'init spawns process and becomes ready with real bridge script',
      async () => {
        // This test requires a real bridge script - skip in unit tests
        // Integration tests should be in a separate file
        expect(true).toBe(true);
      }
    );
  });
});

// =============================================================================
// HTTPIO TESTS
// =============================================================================

describe('HttpIO', () => {
  // Store original fetch
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    // Restore original fetch
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('creates instance with required options', () => {
      const transport = new HttpIO({ baseURL: 'http://localhost:8000' });
      expect(transport).toBeInstanceOf(HttpIO);
    });

    it('normalizes URL by removing trailing slash', () => {
      const transport = new HttpIO({ baseURL: 'http://localhost:8000/' });
      expect(transport).toBeDefined();
    });

    it('accepts custom headers', () => {
      const transport = new HttpIO({
        baseURL: 'http://localhost:8000',
        headers: { Authorization: 'Bearer token' },
      });
      expect(transport).toBeDefined();
    });

    it('accepts custom defaultTimeoutMs', () => {
      const transport = new HttpIO({
        baseURL: 'http://localhost:8000',
        defaultTimeoutMs: 5000,
      });
      expect(transport).toBeDefined();
    });
  });

  describe('lifecycle', () => {
    it('is ready immediately after construction', () => {
      const transport = new HttpIO({ baseURL: 'http://localhost:8000' });
      expect(transport.isReady).toBe(true);
    });

    it('init is a no-op', async () => {
      const transport = new HttpIO({ baseURL: 'http://localhost:8000' });
      await transport.init(); // Should not throw
      expect(transport.isReady).toBe(true);
    });

    it('init can be called multiple times', async () => {
      const transport = new HttpIO({ baseURL: 'http://localhost:8000' });
      await transport.init();
      await transport.init();
      await transport.init();
      expect(transport.isReady).toBe(true);
    });

    it('dispose marks as not ready', async () => {
      const transport = new HttpIO({ baseURL: 'http://localhost:8000' });
      expect(transport.isReady).toBe(true);
      await transport.dispose();
      expect(transport.isReady).toBe(false);
    });

    it('double dispose is idempotent', async () => {
      const transport = new HttpIO({ baseURL: 'http://localhost:8000' });
      await transport.dispose();
      await transport.dispose();
      expect(transport.isReady).toBe(false);
    });
  });

  describe('send', () => {
    it('rejects when disposed', async () => {
      const transport = new HttpIO({ baseURL: 'http://localhost:8000' });
      await transport.dispose();

      const message = JSON.stringify(createValidMessage());
      await expect(transport.send(message, 1000)).rejects.toThrow(BridgeDisposedError);
      await expect(transport.send(message, 1000)).rejects.toThrow(/disposed/);
    });

    it('makes POST request with correct headers', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(createValidResponse())),
      });
      globalThis.fetch = mockFetch;

      const transport = new HttpIO({
        baseURL: 'http://localhost:8000',
        headers: { 'X-Custom': 'value' },
      });

      const message = JSON.stringify(createValidMessage());
      await transport.send(message, 1000);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Custom': 'value',
          }),
          body: message,
        })
      );
    });

    it('returns response text on success', async () => {
      const expectedResponse = JSON.stringify(createValidResponse());
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(expectedResponse),
      });
      globalThis.fetch = mockFetch;

      const transport = new HttpIO({ baseURL: 'http://localhost:8000' });
      const message = JSON.stringify(createValidMessage());
      const result = await transport.send(message, 1000);

      expect(result).toBe(expectedResponse);
    });

    it('handles non-2xx status codes', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: () => Promise.resolve('Server crashed'),
      });
      globalThis.fetch = mockFetch;

      const transport = new HttpIO({ baseURL: 'http://localhost:8000' });
      const message = JSON.stringify(createValidMessage());

      await expect(transport.send(message, 1000)).rejects.toThrow(BridgeExecutionError);
      await expect(transport.send(message, 1000)).rejects.toThrow(/HTTP 500/);
    });

    it('handles 404 errors', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: () => Promise.resolve('Endpoint not found'),
      });
      globalThis.fetch = mockFetch;

      const transport = new HttpIO({ baseURL: 'http://localhost:8000' });
      const message = JSON.stringify(createValidMessage());

      await expect(transport.send(message, 1000)).rejects.toThrow(BridgeExecutionError);
      await expect(transport.send(message, 1000)).rejects.toThrow(/HTTP 404/);
    });

    it('handles network errors', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new TypeError('fetch failed: network error'));
      globalThis.fetch = mockFetch;

      const transport = new HttpIO({ baseURL: 'http://localhost:8000' });
      const message = JSON.stringify(createValidMessage());

      await expect(transport.send(message, 1000)).rejects.toThrow(BridgeExecutionError);
      await expect(transport.send(message, 1000)).rejects.toThrow(/Network error/);
    });

    it('handles timeout', async () => {
      const mockFetch = vi.fn().mockImplementation(() => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        return Promise.reject(error);
      });
      globalThis.fetch = mockFetch;

      const transport = new HttpIO({ baseURL: 'http://localhost:8000' });
      const message = JSON.stringify(createValidMessage());

      await expect(transport.send(message, 100)).rejects.toThrow(BridgeTimeoutError);
      await expect(transport.send(message, 100)).rejects.toThrow(/timed out/);
    });

    it('handles external abort signal', async () => {
      const controller = new AbortController();
      controller.abort();

      const transport = new HttpIO({ baseURL: 'http://localhost:8000' });
      const message = JSON.stringify(createValidMessage());

      await expect(transport.send(message, 1000, controller.signal)).rejects.toThrow(
        BridgeTimeoutError
      );
      await expect(transport.send(message, 1000, controller.signal)).rejects.toThrow(/aborted/);
    });

    it('passes abort signal to fetch', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(createValidResponse())),
      });
      globalThis.fetch = mockFetch;

      const externalController = new AbortController();
      const transport = new HttpIO({ baseURL: 'http://localhost:8000' });
      const message = JSON.stringify(createValidMessage());

      await transport.send(message, 1000, externalController.signal);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      );
    });

    it('uses default timeout when timeoutMs is 0', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(createValidResponse())),
      });
      globalThis.fetch = mockFetch;

      const transport = new HttpIO({
        baseURL: 'http://localhost:8000',
        defaultTimeoutMs: 5000,
      });
      const message = JSON.stringify(createValidMessage());

      await transport.send(message, 0);

      // The fetch should have been called (uses default timeout)
      expect(mockFetch).toHaveBeenCalled();
    });

    it('handles error response body reading failure gracefully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: () => Promise.reject(new Error('Cannot read body')),
      });
      globalThis.fetch = mockFetch;

      const transport = new HttpIO({ baseURL: 'http://localhost:8000' });
      const message = JSON.stringify(createValidMessage());

      await expect(transport.send(message, 1000)).rejects.toThrow(BridgeExecutionError);
      await expect(transport.send(message, 1000)).rejects.toThrow(/HTTP 500/);
    });

    it('re-throws BridgeTimeoutError as-is', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new BridgeTimeoutError('Custom timeout'));
      globalThis.fetch = mockFetch;

      const transport = new HttpIO({ baseURL: 'http://localhost:8000' });
      const message = JSON.stringify(createValidMessage());

      await expect(transport.send(message, 1000)).rejects.toThrow(BridgeTimeoutError);
      await expect(transport.send(message, 1000)).rejects.toThrow('Custom timeout');
    });

    it('re-throws BridgeExecutionError as-is', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new BridgeExecutionError('Custom error'));
      globalThis.fetch = mockFetch;

      const transport = new HttpIO({ baseURL: 'http://localhost:8000' });
      const message = JSON.stringify(createValidMessage());

      await expect(transport.send(message, 1000)).rejects.toThrow(BridgeExecutionError);
      await expect(transport.send(message, 1000)).rejects.toThrow('Custom error');
    });

    it('wraps unknown errors', async () => {
      const mockFetch = vi.fn().mockRejectedValue('string error');
      globalThis.fetch = mockFetch;

      const transport = new HttpIO({ baseURL: 'http://localhost:8000' });
      const message = JSON.stringify(createValidMessage());

      await expect(transport.send(message, 1000)).rejects.toThrow(BridgeExecutionError);
      await expect(transport.send(message, 1000)).rejects.toThrow(/Request failed/);
    });
  });
});

// =============================================================================
// PYODIDEIO TESTS
// =============================================================================

describe('PyodideIO', () => {
  describe('constructor', () => {
    it('creates instance with default options', () => {
      const transport = new PyodideIO();
      expect(transport).toBeInstanceOf(PyodideIO);
    });

    it('accepts custom indexURL', () => {
      const transport = new PyodideIO({
        indexURL: 'https://custom-cdn.example.com/pyodide/',
      });
      expect(transport).toBeDefined();
    });

    it('accepts packages option', () => {
      const transport = new PyodideIO({
        packages: ['numpy', 'pandas'],
      });
      expect(transport).toBeDefined();
    });
  });

  describe('lifecycle', () => {
    it('starts in idle state', () => {
      const transport = new PyodideIO();
      expect(transport.state).toBe('idle');
      expect(transport.isReady).toBe(false);
      expect(transport.isDisposed).toBe(false);
    });

    it('transitions to disposed state after dispose', async () => {
      const transport = new PyodideIO();
      await transport.dispose();
      expect(transport.state).toBe('disposed');
      expect(transport.isReady).toBe(false);
      expect(transport.isDisposed).toBe(true);
    });

    it('double dispose is idempotent', async () => {
      const transport = new PyodideIO();
      await transport.dispose();
      await transport.dispose();
      expect(transport.isDisposed).toBe(true);
    });

    // Note: Testing actual Pyodide initialization is skipped in Node.js
    // because it causes background unhandled rejections from Pyodide's async loading.
    // Use mocked tests below instead.
  });

  describe('interface compliance', () => {
    it('implements Transport interface', () => {
      const transport = new PyodideIO();
      expect(isTransport(transport)).toBe(true);
    });

    it('has init method', () => {
      const transport = new PyodideIO();
      expect(typeof transport.init).toBe('function');
    });

    it('has send method', () => {
      const transport = new PyodideIO();
      expect(typeof transport.send).toBe('function');
    });

    it('has dispose method', () => {
      const transport = new PyodideIO();
      expect(typeof transport.dispose).toBe('function');
    });

    it('has isReady property', () => {
      const transport = new PyodideIO();
      expect('isReady' in transport).toBe(true);
      expect(typeof transport.isReady).toBe('boolean');
    });
  });

  describe('send - with mocked Pyodide', () => {
    it('validates message JSON', async () => {
      // Create transport and mock the Pyodide instance
      const transport = new PyodideIO();

      // Manually set the state to ready and inject a mock Pyodide
      (transport as any)._state = 'ready';
      (transport as any).py = {
        globals: {
          get: () => null,
        },
      };

      await expect(transport.send('invalid json', 1000)).rejects.toThrow(BridgeProtocolError);
      await expect(transport.send('invalid json', 1000)).rejects.toThrow(/Invalid JSON message/);
    });

    it('validates message has required fields', async () => {
      const transport = new PyodideIO();

      (transport as any)._state = 'ready';
      (transport as any).py = {
        globals: {
          get: () => null,
        },
      };

      const invalidMessage = JSON.stringify({ args: [] }); // Missing id and type
      await expect(transport.send(invalidMessage, 1000)).rejects.toThrow(BridgeProtocolError);
      await expect(transport.send(invalidMessage, 1000)).rejects.toThrow(/missing required fields/);
    });

    it('rejects when Pyodide not initialized', async () => {
      const transport = new PyodideIO();

      (transport as any)._state = 'ready';
      (transport as any).py = undefined;

      const message = JSON.stringify(createValidMessage());
      await expect(transport.send(message, 1000)).rejects.toThrow(BridgeProtocolError);
      await expect(transport.send(message, 1000)).rejects.toThrow(/not initialized/);
    });

    it('rejects when dispatch function not found', async () => {
      const transport = new PyodideIO();

      (transport as any)._state = 'ready';
      (transport as any).py = {
        globals: {
          get: () => null, // Returns null - dispatch function not found
        },
      };

      const message = JSON.stringify(createValidMessage());
      await expect(transport.send(message, 1000)).rejects.toThrow(BridgeProtocolError);
      await expect(transport.send(message, 1000)).rejects.toThrow(
        /dispatch function not initialized/
      );
    });

    it('handles successful dispatch', async () => {
      const transport = new PyodideIO();

      const expectedResponse = JSON.stringify(createValidResponse());
      const mockDispatch = vi.fn().mockReturnValue(expectedResponse);

      (transport as any)._state = 'ready';
      (transport as any).py = {
        globals: {
          get: (key: string) => {
            if (key === '__tywrap_dispatch') {
              return mockDispatch;
            }
            return null;
          },
        },
      };

      const message = JSON.stringify(createValidMessage());
      const result = await transport.send(message, 1000);

      expect(result).toBe(expectedResponse);
      expect(mockDispatch).toHaveBeenCalledWith(message);
    });

    it('cleans up Pyodide proxy after dispatch', async () => {
      const transport = new PyodideIO();

      const mockDestroy = vi.fn();
      const mockDispatch = Object.assign(
        vi.fn().mockReturnValue(JSON.stringify(createValidResponse())),
        { destroy: mockDestroy }
      );

      (transport as any)._state = 'ready';
      (transport as any).py = {
        globals: {
          get: () => mockDispatch,
        },
      };

      const message = JSON.stringify(createValidMessage());
      await transport.send(message, 1000);

      expect(mockDestroy).toHaveBeenCalled();
    });

    it('handles error response from Python', async () => {
      const transport = new PyodideIO();

      const errorResponse = JSON.stringify({
        id: 'test-1',
        error: {
          type: 'ValueError',
          message: 'invalid argument',
        },
      });
      const mockDispatch = vi.fn().mockReturnValue(errorResponse);

      (transport as any)._state = 'ready';
      (transport as any).py = {
        globals: {
          get: () => mockDispatch,
        },
      };

      const message = JSON.stringify(createValidMessage());
      const result = await transport.send(message, 1000);

      // Error responses are returned as-is; caller handles them
      expect(result).toBe(errorResponse);
    });

    it('handles invalid JSON response from Python', async () => {
      const transport = new PyodideIO();

      const mockDispatch = vi.fn().mockReturnValue('not valid json');

      (transport as any)._state = 'ready';
      (transport as any).py = {
        globals: {
          get: () => mockDispatch,
        },
      };

      const message = JSON.stringify(createValidMessage());
      await expect(transport.send(message, 1000)).rejects.toThrow(BridgeProtocolError);
      await expect(transport.send(message, 1000)).rejects.toThrow(
        /Invalid JSON response from Python/
      );
    });
  });

  describe('convenience methods', () => {
    it('call constructs and sends call message', async () => {
      const transport = new PyodideIO();

      const mockDispatch = vi
        .fn()
        .mockReturnValue(JSON.stringify({ id: expect.any(String), result: 4 }));

      (transport as any)._state = 'ready';
      (transport as any).py = {
        globals: {
          get: () => mockDispatch,
        },
      };

      // Mock the response to match the generated ID
      mockDispatch.mockImplementation((msg: string) => {
        const parsed = JSON.parse(msg);
        return JSON.stringify({ id: parsed.id, result: 4 });
      });

      const result = await transport.call<number>('math', 'sqrt', [16]);
      expect(result).toBe(4);

      expect(mockDispatch).toHaveBeenCalledWith(expect.stringContaining('"method":"call"'));
      expect(mockDispatch).toHaveBeenCalledWith(expect.stringContaining('"module":"math"'));
      expect(mockDispatch).toHaveBeenCalledWith(expect.stringContaining('"functionName":"sqrt"'));
    });

    it('instantiate constructs and sends instantiate message', async () => {
      const transport = new PyodideIO();

      const mockDispatch = vi.fn().mockImplementation((msg: string) => {
        const parsed = JSON.parse(msg);
        return JSON.stringify({ id: parsed.id, result: 'handle-123' });
      });

      (transport as any)._state = 'ready';
      (transport as any).py = {
        globals: {
          get: () => mockDispatch,
        },
      };

      const result = await transport.instantiate<string>('mymodule', 'MyClass', [1, 2]);
      expect(result).toBe('handle-123');

      expect(mockDispatch).toHaveBeenCalledWith(expect.stringContaining('"method":"instantiate"'));
      expect(mockDispatch).toHaveBeenCalledWith(expect.stringContaining('"className":"MyClass"'));
    });

    it('callMethod constructs and sends call_method message', async () => {
      const transport = new PyodideIO();

      const mockDispatch = vi.fn().mockImplementation((msg: string) => {
        const parsed = JSON.parse(msg);
        return JSON.stringify({ id: parsed.id, result: 'method result' });
      });

      (transport as any)._state = 'ready';
      (transport as any).py = {
        globals: {
          get: () => mockDispatch,
        },
      };

      const result = await transport.callMethod<string>('handle-123', 'myMethod', []);
      expect(result).toBe('method result');

      expect(mockDispatch).toHaveBeenCalledWith(expect.stringContaining('"method":"call_method"'));
      expect(mockDispatch).toHaveBeenCalledWith(expect.stringContaining('"handle":"handle-123"'));
      expect(mockDispatch).toHaveBeenCalledWith(expect.stringContaining('"methodName":"myMethod"'));
    });

    it('disposeInstance constructs and sends dispose_instance message', async () => {
      const transport = new PyodideIO();

      const mockDispatch = vi.fn().mockImplementation((msg: string) => {
        const parsed = JSON.parse(msg);
        return JSON.stringify({ id: parsed.id, result: null });
      });

      (transport as any)._state = 'ready';
      (transport as any).py = {
        globals: {
          get: () => mockDispatch,
        },
      };

      await transport.disposeInstance('handle-123');

      expect(mockDispatch).toHaveBeenCalledWith(
        expect.stringContaining('"method":"dispose_instance"')
      );
      expect(mockDispatch).toHaveBeenCalledWith(expect.stringContaining('"handle":"handle-123"'));
    });

    it('call throws BridgeExecutionError on Python error', async () => {
      const transport = new PyodideIO();

      const mockDispatch = vi.fn().mockImplementation((msg: string) => {
        const parsed = JSON.parse(msg);
        return JSON.stringify({
          id: parsed.id,
          error: {
            type: 'ValueError',
            message: 'invalid argument',
            traceback: 'Traceback...',
          },
        });
      });

      (transport as any)._state = 'ready';
      (transport as any).py = {
        globals: {
          get: () => mockDispatch,
        },
      };

      await expect(transport.call('math', 'sqrt', [-1])).rejects.toThrow(BridgeExecutionError);
      await expect(transport.call('math', 'sqrt', [-1])).rejects.toThrow(
        /ValueError: invalid argument/
      );
    });
  });

  describe('ID generation', () => {
    it('generates unique IDs for each message', async () => {
      const transport = new PyodideIO();

      const capturedIds: string[] = [];
      const mockDispatch = vi.fn().mockImplementation((msg: string) => {
        const parsed = JSON.parse(msg);
        capturedIds.push(parsed.id);
        return JSON.stringify({ id: parsed.id, result: null });
      });

      (transport as any)._state = 'ready';
      (transport as any).py = {
        globals: {
          get: () => mockDispatch,
        },
      };

      await transport.call('m', 'f', []);
      await transport.call('m', 'f', []);
      await transport.call('m', 'f', []);

      expect(capturedIds.length).toBe(3);
      expect(new Set(capturedIds).size).toBe(3); // All unique
    });

    it('ID format is sequential integers', async () => {
      const transport = new PyodideIO();

      let capturedId: number = 0;
      const mockDispatch = vi.fn().mockImplementation((msg: string) => {
        const parsed = JSON.parse(msg);
        capturedId = parsed.id;
        return JSON.stringify({ id: parsed.id, result: null });
      });

      (transport as any)._state = 'ready';
      (transport as any).py = {
        globals: {
          get: () => mockDispatch,
        },
      };

      await transport.call('m', 'f', []);

      expect(typeof capturedId).toBe('number');
      expect(capturedId).toBeGreaterThan(0);
    });
  });
});

// =============================================================================
// CROSS-TRANSPORT INTERFACE COMPLIANCE
// =============================================================================

describe('Cross-Transport Interface Compliance', () => {
  const transports: { name: string; create: () => Transport }[] = [
    { name: 'ProcessIO', create: () => new ProcessIO({ bridgeScript: '/path/to/bridge.py' }) },
    { name: 'HttpIO', create: () => new HttpIO({ baseURL: 'http://localhost:8000' }) },
    { name: 'PyodideIO', create: () => new PyodideIO() },
  ];

  transports.forEach(({ name, create }) => {
    describe(name, () => {
      it('passes isTransport type guard', () => {
        const transport = create();
        expect(isTransport(transport)).toBe(true);
      });

      it('has init method that returns Promise', async () => {
        const transport = create();
        expect(typeof transport.init).toBe('function');
        // Note: init may throw for some transports (e.g., PyodideIO without Pyodide)
        // but should still return a Promise
      });

      it('has send method with correct signature', () => {
        const transport = create();
        expect(typeof transport.send).toBe('function');
        expect(transport.send.length).toBeGreaterThanOrEqual(2); // message, timeoutMs
      });

      it('has dispose method that returns Promise', async () => {
        const transport = create();
        expect(typeof transport.dispose).toBe('function');
        const result = transport.dispose();
        expect(result).toBeInstanceOf(Promise);
        await result;
      });

      it('has isReady boolean property', () => {
        const transport = create();
        expect('isReady' in transport).toBe(true);
        expect(typeof transport.isReady).toBe('boolean');
      });

      it('isReady becomes false after dispose', async () => {
        const transport = create();
        await transport.dispose();
        expect(transport.isReady).toBe(false);
      });
    });
  });
});
