/**
 * Transport Test Suite
 *
 * Comprehensive tests for the Transport interface and all implementations:
 * - Transport interface type guards
 * - SubprocessTransport (subprocess-based transport)
 * - HttpTransport (HTTP POST-based transport)
 * - PyodideTransport (in-memory Pyodide transport)
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
import { SubprocessTransport, type SubprocessTransportOptions } from '../src/runtime/subprocess-transport.js';
import { HttpTransport, type HttpTransportOptions } from '../src/runtime/http-transport.js';
import { PyodideTransport, type PyodideTransportOptions } from '../src/runtime/pyodide-transport.js';
import { PooledTransport } from '../src/runtime/pooled-transport.js';
import { RpcClient } from '../src/runtime/rpc-client.js';
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
    capabilities: () => ({
      backend: 'subprocess',
      supportsArrow: true,
      supportsBinary: true,
      supportsChunking: false,
      supportsStreaming: false,
      maxFrameBytes: Number.POSITIVE_INFINITY,
    }),
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
        capabilities: () => ({
          backend: 'http' as const,
          supportsArrow: true,
          supportsBinary: true,
          supportsChunking: false,
          supportsStreaming: false,
          maxFrameBytes: Number.POSITIVE_INFINITY,
        }),
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
        capabilities: () => ({
          backend: 'subprocess' as const,
          supportsArrow: true,
          supportsBinary: true,
          supportsChunking: false,
          supportsStreaming: false,
          maxFrameBytes: Number.POSITIVE_INFINITY,
        }),
      };
      expect(isTransport(incomplete)).toBe(false);
    });

    it('returns false for objects missing capabilities method', () => {
      const incomplete = {
        init: () => Promise.resolve(),
        send: () => Promise.resolve(''),
        dispose: () => Promise.resolve(),
        isReady: true,
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

describe('SubprocessTransport', () => {
  // Skip tests if Python is not available
  let pythonAvailable: boolean;

  interface SubprocessTransportInternals {
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
      const transport = new SubprocessTransport({ bridgeScript: '/path/to/bridge.py' });
      expect(transport).toBeInstanceOf(SubprocessTransport);
    });

    it('uses default pythonPath when not specified', () => {
      const transport = new SubprocessTransport({ bridgeScript: '/path/to/bridge.py' });
      expect(transport).toBeDefined();
    });

    it('accepts custom pythonPath', () => {
      const transport = new SubprocessTransport({
        bridgeScript: '/path/to/bridge.py',
        pythonPath: '/usr/local/bin/python3',
      });
      expect(transport).toBeDefined();
    });

    it('accepts custom environment variables', () => {
      const transport = new SubprocessTransport({
        bridgeScript: '/path/to/bridge.py',
        env: { CUSTOM_VAR: 'value' },
      });
      expect(transport).toBeDefined();
    });

    it('accepts custom maxLineLength', () => {
      const transport = new SubprocessTransport({
        bridgeScript: '/path/to/bridge.py',
        maxLineLength: 1024 * 1024,
      });
      expect(transport).toBeDefined();
    });

    it('accepts restartAfterRequests option', () => {
      const transport = new SubprocessTransport({
        bridgeScript: '/path/to/bridge.py',
        restartAfterRequests: 100,
      });
      expect(transport).toBeDefined();
    });
  });

  describe('lifecycle', () => {
    it('starts in idle state', () => {
      const transport = new SubprocessTransport({ bridgeScript: '/path/to/bridge.py' });
      expect(transport.state).toBe('idle');
      expect(transport.isReady).toBe(false);
      expect(transport.isDisposed).toBe(false);
    });

    it('transitions to disposed state after dispose', async () => {
      const transport = new SubprocessTransport({ bridgeScript: '/path/to/bridge.py' });
      await transport.dispose();
      expect(transport.state).toBe('disposed');
      expect(transport.isReady).toBe(false);
      expect(transport.isDisposed).toBe(true);
    });

    it('double dispose is idempotent', async () => {
      const transport = new SubprocessTransport({ bridgeScript: '/path/to/bridge.py' });
      await transport.dispose();
      await transport.dispose(); // Should not throw
      expect(transport.isDisposed).toBe(true);
    });

    it('rejects send after dispose', async () => {
      const transport = new SubprocessTransport({ bridgeScript: '/path/to/bridge.py' });
      await transport.dispose();
      const message = JSON.stringify(createValidMessage());
      await expect(transport.send(message, 1000)).rejects.toThrow(BridgeDisposedError);
    });
  });

  describe('send - validation', () => {
    it('rejects when process is not running (process exited)', async () => {
      const transport = new SubprocessTransport({ bridgeScript: '/path/to/bridge.py' });

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
      const transport = new SubprocessTransport({ bridgeScript: '/path/to/bridge.py' });
      const writes: string[] = [];
      let firstWrite = true;

      const internals = transport as unknown as SubprocessTransportInternals;
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

      // The write is scheduled on the per-request write mutex (W5), so it lands
      // on a microtask rather than synchronously; flush before asserting.
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(writes).toHaveLength(1);

      internals.handleStdinDrain();
      expect(writes).toHaveLength(1);

      internals.handleResponseLine(JSON.stringify({ id: messageId, result: 4 }));
      await expect(pending).resolves.toContain(`"id":${messageId}`);
    });

    it('does not replay queued writes when drain write returns false', async () => {
      const transport = new SubprocessTransport({ bridgeScript: '/path/to/bridge.py' });
      const writes: string[] = [];
      let writeCount = 0;

      const internals = transport as unknown as SubprocessTransportInternals;
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

      // Writes are scheduled on the per-request write mutex (W5): the first send
      // writes on a microtask (returns false -> draining), the second chains
      // behind it and is queued because the stream is now draining. Flush the
      // mutex chain before asserting the single in-flight write.
      await new Promise(resolve => setTimeout(resolve, 0));
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

    it('correlates responses using the top-level request id when args contain nested id fields', async () => {
      const transport = new SubprocessTransport({ bridgeScript: '/path/to/bridge.py' });

      const internals = transport as unknown as SubprocessTransportInternals;
      internals._state = 'ready';
      internals.processExited = false;
      internals.process = {
        stdin: {
          write: (): boolean => true,
        },
      };

      const requestId = 1;
      const message = JSON.stringify(
        createValidMessage({
          id: requestId,
          params: {
            module: 'builtins',
            functionName: 'str',
            args: [{ id: 999, value: 'nested' }],
          },
        })
      );

      const pending = transport.send(message, 1000);
      internals.handleResponseLine(JSON.stringify({ id: requestId, result: 'ok' }));

      await expect(pending).resolves.toContain(`"id":${requestId}`);
    });

    it('accepts id=0 for request/response correlation', async () => {
      const transport = new SubprocessTransport({ bridgeScript: '/path/to/bridge.py' });

      const internals = transport as unknown as SubprocessTransportInternals;
      internals._state = 'ready';
      internals.processExited = false;
      internals.process = {
        stdin: {
          write: (): boolean => true,
        },
      };

      const message = JSON.stringify(createValidMessage({ id: 0 }));
      const pending = transport.send(message, 1000);

      internals.handleResponseLine(JSON.stringify({ id: 0, result: 'zero' }));
      await expect(pending).resolves.toContain('"id":0');
    });

    it('rejects pending requests when an unexpected response id arrives', async () => {
      const transport = new SubprocessTransport({ bridgeScript: '/path/to/bridge.py' });

      const internals = transport as unknown as SubprocessTransportInternals;
      internals._state = 'ready';
      internals.processExited = false;
      internals.process = {
        stdin: {
          write: (): boolean => true,
        },
      };

      const messageId = 401;
      const pending = transport.send(JSON.stringify(createValidMessage({ id: messageId })), 50);

      internals.handleResponseLine(JSON.stringify({ id: 999, result: 'wrong id' }));

      await expect(pending).rejects.toThrow(BridgeProtocolError);
      await expect(pending).rejects.toThrow(/Unexpected response id 999/);
    });

    it('ignores late responses for requests that already timed out', async () => {
      const transport = new SubprocessTransport({ bridgeScript: '/path/to/bridge.py' });

      const internals = transport as unknown as SubprocessTransportInternals;
      internals._state = 'ready';
      internals.processExited = false;
      internals.process = {
        stdin: {
          write: (): boolean => true,
        },
      };

      const messageId = 402;
      const pending = transport.send(JSON.stringify(createValidMessage({ id: messageId })), 10);

      await expect(pending).rejects.toThrow(BridgeTimeoutError);
      expect(() =>
        internals.handleResponseLine(JSON.stringify({ id: messageId, result: 'late result' }))
      ).not.toThrow(BridgeProtocolError);
    });

    it('includes stderr diagnostics when stdin write fails', async () => {
      const transport = new SubprocessTransport({ bridgeScript: '/path/to/bridge.py' });

      const internals = transport as unknown as SubprocessTransportInternals;
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

describe('HttpTransport', () => {
  // Store original fetch
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    // Restore original fetch
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('creates instance with required options', () => {
      const transport = new HttpTransport({ baseURL: 'http://localhost:8000' });
      expect(transport).toBeInstanceOf(HttpTransport);
    });

    it('normalizes URL by removing trailing slash', () => {
      const transport = new HttpTransport({ baseURL: 'http://localhost:8000/' });
      expect(transport).toBeDefined();
    });

    it('accepts custom headers', () => {
      const transport = new HttpTransport({
        baseURL: 'http://localhost:8000',
        headers: { Authorization: 'Bearer token' },
      });
      expect(transport).toBeDefined();
    });

    it('accepts custom defaultTimeoutMs', () => {
      const transport = new HttpTransport({
        baseURL: 'http://localhost:8000',
        defaultTimeoutMs: 5000,
      });
      expect(transport).toBeDefined();
    });
  });

  describe('lifecycle', () => {
    it('is ready immediately after construction', () => {
      const transport = new HttpTransport({ baseURL: 'http://localhost:8000' });
      expect(transport.isReady).toBe(true);
    });

    it('init is a no-op', async () => {
      const transport = new HttpTransport({ baseURL: 'http://localhost:8000' });
      await transport.init(); // Should not throw
      expect(transport.isReady).toBe(true);
    });

    it('init can be called multiple times', async () => {
      const transport = new HttpTransport({ baseURL: 'http://localhost:8000' });
      await transport.init();
      await transport.init();
      await transport.init();
      expect(transport.isReady).toBe(true);
    });

    it('dispose marks as not ready', async () => {
      const transport = new HttpTransport({ baseURL: 'http://localhost:8000' });
      expect(transport.isReady).toBe(true);
      await transport.dispose();
      expect(transport.isReady).toBe(false);
    });

    it('double dispose is idempotent', async () => {
      const transport = new HttpTransport({ baseURL: 'http://localhost:8000' });
      await transport.dispose();
      await transport.dispose();
      expect(transport.isReady).toBe(false);
    });
  });

  describe('send', () => {
    it('rejects when disposed', async () => {
      const transport = new HttpTransport({ baseURL: 'http://localhost:8000' });
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

      const transport = new HttpTransport({
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

      const transport = new HttpTransport({ baseURL: 'http://localhost:8000' });
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

      const transport = new HttpTransport({ baseURL: 'http://localhost:8000' });
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

      const transport = new HttpTransport({ baseURL: 'http://localhost:8000' });
      const message = JSON.stringify(createValidMessage());

      await expect(transport.send(message, 1000)).rejects.toThrow(BridgeExecutionError);
      await expect(transport.send(message, 1000)).rejects.toThrow(/HTTP 404/);
    });

    it('handles network errors', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new TypeError('fetch failed: network error'));
      globalThis.fetch = mockFetch;

      const transport = new HttpTransport({ baseURL: 'http://localhost:8000' });
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

      const transport = new HttpTransport({ baseURL: 'http://localhost:8000' });
      const message = JSON.stringify(createValidMessage());

      await expect(transport.send(message, 100)).rejects.toThrow(BridgeTimeoutError);
      await expect(transport.send(message, 100)).rejects.toThrow(/timed out/);
    });

    it('handles external abort signal', async () => {
      const controller = new AbortController();
      controller.abort();

      const transport = new HttpTransport({ baseURL: 'http://localhost:8000' });
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
      const transport = new HttpTransport({ baseURL: 'http://localhost:8000' });
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

      const transport = new HttpTransport({
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

      const transport = new HttpTransport({ baseURL: 'http://localhost:8000' });
      const message = JSON.stringify(createValidMessage());

      await expect(transport.send(message, 1000)).rejects.toThrow(BridgeExecutionError);
      await expect(transport.send(message, 1000)).rejects.toThrow(/HTTP 500/);
    });

    it('re-throws BridgeTimeoutError as-is', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new BridgeTimeoutError('Custom timeout'));
      globalThis.fetch = mockFetch;

      const transport = new HttpTransport({ baseURL: 'http://localhost:8000' });
      const message = JSON.stringify(createValidMessage());

      await expect(transport.send(message, 1000)).rejects.toThrow(BridgeTimeoutError);
      await expect(transport.send(message, 1000)).rejects.toThrow('Custom timeout');
    });

    it('re-throws BridgeExecutionError as-is', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new BridgeExecutionError('Custom error'));
      globalThis.fetch = mockFetch;

      const transport = new HttpTransport({ baseURL: 'http://localhost:8000' });
      const message = JSON.stringify(createValidMessage());

      await expect(transport.send(message, 1000)).rejects.toThrow(BridgeExecutionError);
      await expect(transport.send(message, 1000)).rejects.toThrow('Custom error');
    });

    it('wraps unknown errors', async () => {
      const mockFetch = vi.fn().mockRejectedValue('string error');
      globalThis.fetch = mockFetch;

      const transport = new HttpTransport({ baseURL: 'http://localhost:8000' });
      const message = JSON.stringify(createValidMessage());

      await expect(transport.send(message, 1000)).rejects.toThrow(BridgeExecutionError);
      await expect(transport.send(message, 1000)).rejects.toThrow(/Request failed/);
    });
  });
});

// =============================================================================
// PYODIDEIO TESTS
// =============================================================================

describe('PyodideTransport', () => {
  describe('constructor', () => {
    it('creates instance with default options', () => {
      const transport = new PyodideTransport();
      expect(transport).toBeInstanceOf(PyodideTransport);
    });

    it('accepts custom indexURL', () => {
      const transport = new PyodideTransport({
        indexURL: 'https://custom-cdn.example.com/pyodide/',
      });
      expect(transport).toBeDefined();
    });

    it('accepts packages option', () => {
      const transport = new PyodideTransport({
        packages: ['numpy', 'pandas'],
      });
      expect(transport).toBeDefined();
    });
  });

  describe('lifecycle', () => {
    it('starts in idle state', () => {
      const transport = new PyodideTransport();
      expect(transport.state).toBe('idle');
      expect(transport.isReady).toBe(false);
      expect(transport.isDisposed).toBe(false);
    });

    it('transitions to disposed state after dispose', async () => {
      const transport = new PyodideTransport();
      await transport.dispose();
      expect(transport.state).toBe('disposed');
      expect(transport.isReady).toBe(false);
      expect(transport.isDisposed).toBe(true);
    });

    it('double dispose is idempotent', async () => {
      const transport = new PyodideTransport();
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
      const transport = new PyodideTransport();
      expect(isTransport(transport)).toBe(true);
    });

    it('has init method', () => {
      const transport = new PyodideTransport();
      expect(typeof transport.init).toBe('function');
    });

    it('has send method', () => {
      const transport = new PyodideTransport();
      expect(typeof transport.send).toBe('function');
    });

    it('has dispose method', () => {
      const transport = new PyodideTransport();
      expect(typeof transport.dispose).toBe('function');
    });

    it('has isReady property', () => {
      const transport = new PyodideTransport();
      expect('isReady' in transport).toBe(true);
      expect(typeof transport.isReady).toBe('boolean');
    });
  });

  describe('send - with mocked Pyodide', () => {
    it('validates message JSON', async () => {
      // Create transport and mock the Pyodide instance
      const transport = new PyodideTransport();

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
      const transport = new PyodideTransport();

      (transport as any)._state = 'ready';
      (transport as any).py = {
        globals: {
          get: () => null,
        },
      };

      const invalidMessage = JSON.stringify({ args: [] }); // Missing id/method/protocol/params
      await expect(transport.send(invalidMessage, 1000)).rejects.toThrow(BridgeProtocolError);
      await expect(transport.send(invalidMessage, 1000)).rejects.toThrow(/missing required fields/);
    });

    it('rejects legacy type-only message envelopes', async () => {
      const transport = new PyodideTransport();

      (transport as any)._state = 'ready';
      (transport as any).py = {
        globals: {
          get: () => null,
        },
      };

      const legacyMessage = JSON.stringify({
        id: 1,
        protocol: PROTOCOL_ID,
        type: 'call',
        module: 'math',
      });

      await expect(transport.send(legacyMessage, 1000)).rejects.toThrow(BridgeProtocolError);
      await expect(transport.send(legacyMessage, 1000)).rejects.toThrow(/missing required fields/);
    });

    it('rejects when Pyodide not initialized', async () => {
      const transport = new PyodideTransport();

      (transport as any)._state = 'ready';
      (transport as any).py = undefined;

      const message = JSON.stringify(createValidMessage());
      await expect(transport.send(message, 1000)).rejects.toThrow(BridgeProtocolError);
      await expect(transport.send(message, 1000)).rejects.toThrow(/not initialized/);
    });

    it('rejects when dispatch function not found', async () => {
      const transport = new PyodideTransport();

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
      const transport = new PyodideTransport();

      const expectedResponse = JSON.stringify({
        ...createValidResponse(),
        protocol: PROTOCOL_ID,
      });
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

      const parsedMessage = JSON.parse(message);
      expect(parsedMessage).toMatchObject({
        id: 1,
        protocol: PROTOCOL_ID,
        method: 'call',
      });
      expect(parsedMessage.params).toMatchObject({
        module: 'math',
        functionName: 'sqrt',
      });
      expect(result).toBe(expectedResponse);
      expect(mockDispatch).toHaveBeenCalledWith(message);
    });

    it('cleans up Pyodide proxy after dispatch', async () => {
      const transport = new PyodideTransport();

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
      const transport = new PyodideTransport();

      const errorResponse = JSON.stringify({
        id: 1,
        protocol: PROTOCOL_ID,
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

    it('returns unknown-method protocol error envelopes as-is', async () => {
      const transport = new PyodideTransport();
      const mockDispatch = vi.fn().mockImplementation((message: string) => {
        const parsed = JSON.parse(message);
        return JSON.stringify({
          id: parsed.id,
          protocol: PROTOCOL_ID,
          error: {
            type: 'ValueError',
            message: `Unknown method: ${parsed.method as string}`,
          },
        });
      });

      (transport as any)._state = 'ready';
      (transport as any).py = {
        globals: {
          get: () => mockDispatch,
        },
      };

      const unknownMethodMessage = JSON.stringify({
        id: 1,
        protocol: PROTOCOL_ID,
        method: 'unknown_method',
        params: {},
      });

      const response = await transport.send(unknownMethodMessage, 1000);
      expect(JSON.parse(response)).toEqual({
        id: 1,
        protocol: PROTOCOL_ID,
        error: {
          type: 'ValueError',
          message: 'Unknown method: unknown_method',
        },
      });
    });

    it('handles invalid JSON response from Python', async () => {
      const transport = new PyodideTransport();

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

    it('rejects responses with invalid id types', async () => {
      const transport = new PyodideTransport();
      const mockDispatch = vi.fn().mockReturnValue(
        JSON.stringify({
          id: 'not-a-number',
          protocol: PROTOCOL_ID,
          result: null,
        })
      );

      (transport as any)._state = 'ready';
      (transport as any).py = {
        globals: {
          get: () => mockDispatch,
        },
      };

      const message = JSON.stringify(createValidMessage());
      await expect(transport.send(message, 1000)).rejects.toThrow(
        /Invalid JSON response from Python/
      );
    });
  });

});

// =============================================================================
// CROSS-TRANSPORT INTERFACE COMPLIANCE
// =============================================================================

describe('Cross-Transport Interface Compliance', () => {
  const transports: { name: string; create: () => Transport }[] = [
    { name: 'SubprocessTransport', create: () => new SubprocessTransport({ bridgeScript: '/path/to/bridge.py' }) },
    { name: 'HttpTransport', create: () => new HttpTransport({ baseURL: 'http://localhost:8000' }) },
    { name: 'PyodideTransport', create: () => new PyodideTransport() },
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
        // Note: init may throw for some transports (e.g., PyodideTransport without Pyodide)
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

      it('has a capabilities() method returning a stable descriptor before and after dispose', async () => {
        const transport = create();
        expect(typeof transport.capabilities).toBe('function');
        const before = transport.capabilities();
        await transport.dispose();
        const after = transport.capabilities();
        // Capabilities are static, not lifecycle-dependent.
        expect(after).toEqual(before);
        // Chunking/streaming are not implemented on any backend yet (0.8.0).
        expect(before.supportsChunking).toBe(false);
        expect(before.supportsStreaming).toBe(false);
      });
    });
  });
});

// =============================================================================
// TRANSPORT CAPABILITIES DESCRIPTORS
// =============================================================================

describe('TransportCapabilities descriptors', () => {
  it('SubprocessTransport reports the subprocess capability matrix', () => {
    const transport = new SubprocessTransport({ bridgeScript: '/path/to/bridge.py' });
    // maxFrameBytes is the JSONL line-length limit (default 100MB).
    expect(transport.capabilities()).toEqual({
      backend: 'subprocess',
      supportsArrow: true,
      supportsBinary: true,
      supportsChunking: false,
      supportsStreaming: false,
      maxFrameBytes: 100 * 1024 * 1024,
    });
  });

  it('SubprocessTransport.maxFrameBytes honors a custom maxLineLength', () => {
    const transport = new SubprocessTransport({
      bridgeScript: '/path/to/bridge.py',
      maxLineLength: 1024 * 1024,
    });
    expect(transport.capabilities().maxFrameBytes).toBe(1024 * 1024);
  });

  it('HttpTransport reports the http capability matrix', () => {
    const transport = new HttpTransport({ baseURL: 'http://localhost:8000' });
    expect(transport.capabilities()).toEqual({
      backend: 'http',
      supportsArrow: true,
      supportsBinary: true,
      supportsChunking: false,
      supportsStreaming: false,
      maxFrameBytes: Number.POSITIVE_INFINITY,
    });
  });

  it('PyodideTransport reports the pyodide capability matrix (JSON-only, no Arrow)', () => {
    const transport = new PyodideTransport();
    expect(transport.capabilities()).toEqual({
      backend: 'pyodide',
      supportsArrow: false,
      supportsBinary: true,
      supportsChunking: false,
      supportsStreaming: false,
      maxFrameBytes: Number.POSITIVE_INFINITY,
    });
  });

  it('PooledTransport reports its worker backend (subprocess) capabilities', () => {
    const transport = new PooledTransport({
      createTransport: () => new SubprocessTransport({ bridgeScript: '/path/to/bridge.py' }),
    });
    expect(transport.capabilities()).toEqual({
      backend: 'subprocess',
      supportsArrow: true,
      supportsBinary: true,
      supportsChunking: false,
      supportsStreaming: false,
      maxFrameBytes: 100 * 1024 * 1024,
    });
  });

  it('RpcClient.capabilities() delegates to the held transport descriptor', () => {
    const subprocess = new RpcClient({
      transport: new SubprocessTransport({ bridgeScript: '/path/to/bridge.py' }),
    });
    expect(subprocess.capabilities()).toEqual(subprocess.transport.capabilities());
    expect(subprocess.capabilities().backend).toBe('subprocess');

    const pyodide = new RpcClient({ transport: new PyodideTransport() });
    expect(pyodide.capabilities()).toEqual({
      backend: 'pyodide',
      supportsArrow: false,
      supportsBinary: true,
      supportsChunking: false,
      supportsStreaming: false,
      maxFrameBytes: Number.POSITIVE_INFINITY,
    });
  });
});
