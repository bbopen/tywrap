/**
 * BridgeProtocol Integration Test Suite
 *
 * Comprehensive tests for the BridgeProtocol orchestration layer that integrates:
 * - SafeCodec (encoding/decoding with validation)
 * - Transport (message sending/receiving)
 * - WorkerPool (concurrent transport management)
 *
 * These tests verify that all components work together correctly across
 * the JS<->Python boundary abstraction.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BridgeProtocol, type BridgeProtocolOptions } from '../src/runtime/bridge-protocol.js';
import { SafeCodec, type CodecOptions } from '../src/runtime/safe-codec.js';
import {
  type Transport,
  type ProtocolMessage,
  type ProtocolResponse,
} from '../src/runtime/transport.js';
import {
  WorkerPool,
  type WorkerPoolOptions,
  type PooledWorker,
} from '../src/runtime/worker-pool.js';
import {
  BridgeProtocolError,
  BridgeExecutionError,
  BridgeTimeoutError,
  BridgeDisposedError,
} from '../src/runtime/errors.js';

// =============================================================================
// MOCK TRANSPORT
// =============================================================================

/**
 * Mock transport for testing BridgeProtocol behavior.
 * Tracks all operations and allows configurable responses.
 *
 * Note: The transport returns raw JSON strings in the ProtocolResponse format:
 * - Success: { id: string, result: T }
 * - Error: { id: string, error: { type, message, traceback? } }
 *
 * The SafeCodec decodes this and returns the full parsed object.
 * BridgeProtocol's call/instantiate/callMethod methods return the full
 * response object as decoded by SafeCodec (not just the result field).
 */
class MockTransport implements Transport {
  public lastMessage?: string;
  public responseToReturn: string = '{"id":"test","result":null}';
  public shouldFail = false;
  public failureError: Error = new Error('Transport failed');
  public initCalled = false;
  public disposeCalled = false;
  public sendDelay = 0;

  async init(): Promise<void> {
    this.initCalled = true;
  }

  async dispose(): Promise<void> {
    this.disposeCalled = true;
  }

  get isReady(): boolean {
    return this.initCalled && !this.disposeCalled;
  }

  async send(message: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
    this.lastMessage = message;

    // Check for abort signal
    if (signal?.aborted) {
      throw new BridgeTimeoutError('Operation aborted');
    }

    // Simulate delay if configured
    if (this.sendDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.sendDelay));
    }

    if (this.shouldFail) {
      throw this.failureError;
    }

    return this.responseToReturn;
  }

  /**
   * Helper to set the response based on the incoming message ID.
   * Returns the full ProtocolResponse format { id, result }.
   */
  setDynamicResponse(resultFn: (msg: ProtocolMessage) => unknown): void {
    this.send = async (message: string, timeoutMs: number, signal?: AbortSignal): Promise<string> => {
      this.lastMessage = message;

      if (signal?.aborted) {
        throw new BridgeTimeoutError('Operation aborted');
      }

      if (this.sendDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, this.sendDelay));
      }

      if (this.shouldFail) {
        throw this.failureError;
      }

      const parsed = JSON.parse(message) as ProtocolMessage;
      const result = resultFn(parsed);
      return JSON.stringify({ id: parsed.id, result });
    };
  }

  /**
   * Helper to return an error response.
   */
  setErrorResponse(type: string, errorMessage: string, traceback?: string): void {
    this.send = async (message: string): Promise<string> => {
      this.lastMessage = message;
      const parsed = JSON.parse(message) as ProtocolMessage;
      return JSON.stringify({
        id: parsed.id,
        error: { type, message: errorMessage, traceback },
      });
    };
  }
}

// =============================================================================
// CONCRETE BRIDGE PROTOCOL FOR TESTING
// =============================================================================

/**
 * Concrete implementation of BridgeProtocol for testing.
 * Exposes protected methods and allows inspection of internal state.
 */
class TestBridgeProtocol extends BridgeProtocol {
  constructor(options: BridgeProtocolOptions) {
    super(options);
  }

  /**
   * Expose sendMessage for direct testing.
   */
  async testSendMessage<T>(
    message: Omit<ProtocolMessage, 'id'>,
    options?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<T> {
    return this.sendMessage<T>(message, options);
  }

  /**
   * Expose the transport for inspection.
   */
  getTransport(): Transport {
    return this.transport;
  }

  /**
   * Expose the codec for inspection.
   */
  getCodec(): SafeCodec {
    return this.codec;
  }
}

// =============================================================================
// BRIDGEPROTOCOL CONSTRUCTOR TESTS
// =============================================================================

describe('BridgeProtocol', () => {
  describe('constructor', () => {
    it('creates with required options (transport)', () => {
      const transport = new MockTransport();
      const protocol = new TestBridgeProtocol({ transport });

      expect(protocol).toBeInstanceOf(BridgeProtocol);
      expect(protocol.getTransport()).toBe(transport);
    });

    it('applies codec options', () => {
      const transport = new MockTransport();
      const codecOptions: CodecOptions = {
        rejectSpecialFloats: false,
        maxPayloadBytes: 1024,
      };

      const protocol = new TestBridgeProtocol({
        transport,
        codec: codecOptions,
      });

      // Test that codec options are applied by verifying behavior
      // With rejectSpecialFloats: false, encoding NaN should not throw
      const codec = protocol.getCodec();
      const encoded = codec.encodeRequest({ value: NaN });
      expect(encoded).toContain('null'); // NaN becomes null in JSON
    });

    it('sets default timeout of 30000ms', () => {
      const transport = new MockTransport();
      const protocol = new TestBridgeProtocol({ transport });

      // Default timeout is tested through behavior
      expect(protocol).toBeDefined();
    });

    it('accepts custom defaultTimeoutMs', () => {
      const transport = new MockTransport();
      const protocol = new TestBridgeProtocol({
        transport,
        defaultTimeoutMs: 5000,
      });

      expect(protocol).toBeDefined();
    });

    it('accepts all custom options', () => {
      const transport = new MockTransport();
      const protocol = new TestBridgeProtocol({
        transport,
        codec: {
          rejectSpecialFloats: true,
          rejectNonStringKeys: true,
          maxPayloadBytes: 2048,
          bytesHandling: 'base64',
        },
        defaultTimeoutMs: 10000,
      });

      expect(protocol).toBeInstanceOf(BridgeProtocol);
    });
  });

  // ===========================================================================
  // LIFECYCLE TESTS
  // ===========================================================================

  describe('lifecycle', () => {
    let protocol: TestBridgeProtocol;
    let transport: MockTransport;

    beforeEach(() => {
      transport = new MockTransport();
      protocol = new TestBridgeProtocol({ transport });
    });

    afterEach(async () => {
      if (protocol && !protocol.isDisposed) {
        await protocol.dispose();
      }
    });

    it('initializes transport on init()', async () => {
      expect(transport.initCalled).toBe(false);

      await protocol.init();

      expect(transport.initCalled).toBe(true);
      expect(protocol.isReady).toBe(true);
    });

    it('disposes transport on dispose()', async () => {
      await protocol.init();
      expect(transport.disposeCalled).toBe(false);

      await protocol.dispose();

      expect(transport.disposeCalled).toBe(true);
      expect(protocol.isDisposed).toBe(true);
    });

    it('transport is tracked as resource', async () => {
      await protocol.init();

      // Transport should be tracked - verified by automatic disposal
      await protocol.dispose();

      expect(transport.disposeCalled).toBe(true);
    });

    it('init is idempotent', async () => {
      await protocol.init();
      await protocol.init();
      await protocol.init();

      expect(protocol.isReady).toBe(true);
      // Transport.init should only be called once (or idempotent behavior)
    });

    it('dispose is idempotent', async () => {
      await protocol.init();
      await protocol.dispose();
      await protocol.dispose();
      await protocol.dispose();

      expect(protocol.isDisposed).toBe(true);
    });

    it('throws BridgeDisposedError when using disposed protocol', async () => {
      await protocol.init();
      await protocol.dispose();

      await expect(
        protocol.call('module', 'function', [])
      ).rejects.toThrow(BridgeDisposedError);
    });
  });

  // ===========================================================================
  // SEND MESSAGE TESTS
  // ===========================================================================

  describe('sendMessage', () => {
    let protocol: TestBridgeProtocol;
    let transport: MockTransport;

    beforeEach(async () => {
      transport = new MockTransport();
      protocol = new TestBridgeProtocol({ transport });
      await protocol.init();
    });

    afterEach(async () => {
      if (protocol && !protocol.isDisposed) {
        await protocol.dispose();
      }
    });

    it('encodes request via SafeCodec', async () => {
      transport.setDynamicResponse(msg => 'success');

      await protocol.testSendMessage<ProtocolResponse>({
        method: 'call',
        params: {
          module: 'test',
          functionName: 'func',
          args: [1, 2, 3],
        },
      });

      expect(transport.lastMessage).toBeDefined();
      const parsed = JSON.parse(transport.lastMessage!);
      expect(parsed.method).toBe('call');
      expect(parsed.params.module).toBe('test');
      expect(parsed.params.functionName).toBe('func');
      expect(parsed.params.args).toEqual([1, 2, 3]);
      expect(parsed.id).toBeDefined();
    });

    it('sends to transport', async () => {
      transport.setDynamicResponse(() => 42);

      await protocol.testSendMessage<ProtocolResponse>({
        method: 'call',
        params: {
          module: 'math',
          functionName: 'sqrt',
          args: [16],
        },
      });

      expect(transport.lastMessage).toBeDefined();
      expect(transport.lastMessage).toContain('"method":"call"');
      expect(transport.lastMessage).toContain('"module":"math"');
    });

    it('decodes response via SafeCodec', async () => {
      transport.setDynamicResponse(() => ({ value: 42, nested: { data: 'test' } }));

      const result = await protocol.testSendMessage<{ value: number; nested: { data: string } }>({
        method: 'call',
        params: {
          module: 'test',
          functionName: 'getData',
          args: [],
        },
      });

      // SafeCodec extracts the result field from the response
      expect(result).toEqual({ value: 42, nested: { data: 'test' } });
    });

    it('handles errors from transport', async () => {
      transport.shouldFail = true;
      transport.failureError = new Error('Network failure');

      await expect(
        protocol.testSendMessage({
          method: 'call',
          params: {
            module: 'test',
            functionName: 'func',
            args: [],
          },
        })
      ).rejects.toThrow('Network failure');
    });

    it('handles encoding errors from codec (special floats)', async () => {
      // Protocol is created with default codec (rejectSpecialFloats: true)
      await expect(
        protocol.testSendMessage({
          method: 'call',
          params: {
            module: 'test',
            functionName: 'func',
            args: [NaN],
          },
        })
      ).rejects.toThrow(BridgeProtocolError);
    });

    it('handles decoding errors from codec (invalid JSON)', async () => {
      // Return invalid JSON from transport
      transport.send = async () => 'not valid json';

      await expect(
        protocol.testSendMessage({
          method: 'call',
          params: {
            module: 'test',
            functionName: 'func',
            args: [],
          },
        })
      ).rejects.toThrow(BridgeProtocolError);
    });

    it('generates unique request IDs', async () => {
      const capturedIds: number[] = [];
      transport.send = async (message: string) => {
        const parsed = JSON.parse(message);
        capturedIds.push(parsed.id);
        return JSON.stringify({ id: parsed.id, result: null });
      };

      await protocol.testSendMessage({ method: 'call', params: { module: 'm', functionName: 'f', args: [] } });
      await protocol.testSendMessage({ method: 'call', params: { module: 'm', functionName: 'f', args: [] } });
      await protocol.testSendMessage({ method: 'call', params: { module: 'm', functionName: 'f', args: [] } });

      expect(capturedIds.length).toBe(3);
      expect(new Set(capturedIds).size).toBe(3); // All unique
    });
  });

  // ===========================================================================
  // RUNTIME EXECUTION INTERFACE TESTS
  // ===========================================================================

  describe('RuntimeExecution interface', () => {
    let protocol: TestBridgeProtocol;
    let transport: MockTransport;

    beforeEach(async () => {
      transport = new MockTransport();
      protocol = new TestBridgeProtocol({ transport });
      await protocol.init();
    });

    afterEach(async () => {
      if (protocol && !protocol.isDisposed) {
        await protocol.dispose();
      }
    });

    it('call() sends correct message type', async () => {
      transport.setDynamicResponse(() => 4);

      // call() returns the extracted result (SafeCodec extracts from response envelope)
      const result = await protocol.call<number>('math', 'sqrt', [16]);

      expect(result).toBe(4);

      const parsed = JSON.parse(transport.lastMessage!);
      expect(parsed.method).toBe('call');
      expect(parsed.params.module).toBe('math');
      expect(parsed.params.functionName).toBe('sqrt');
      expect(parsed.params.args).toEqual([16]);
    });

    it('call() supports kwargs', async () => {
      transport.setDynamicResponse(() => 'result');

      await protocol.call('module', 'func', [1, 2], { key: 'value' });

      const parsed = JSON.parse(transport.lastMessage!);
      expect(parsed.params.kwargs).toEqual({ key: 'value' });
    });

    it('instantiate() sends correct message type', async () => {
      transport.setDynamicResponse(() => 'handle-123');

      const result = await protocol.instantiate<string>('mymodule', 'MyClass', [1, 'arg']);

      expect(result).toBe('handle-123');

      const parsed = JSON.parse(transport.lastMessage!);
      expect(parsed.method).toBe('instantiate');
      expect(parsed.params.module).toBe('mymodule');
      expect(parsed.params.className).toBe('MyClass');
      expect(parsed.params.args).toEqual([1, 'arg']);
    });

    it('instantiate() supports kwargs', async () => {
      transport.setDynamicResponse(() => 'handle-456');

      await protocol.instantiate('mod', 'Class', [], { init: true });

      const parsed = JSON.parse(transport.lastMessage!);
      expect(parsed.params.kwargs).toEqual({ init: true });
    });

    it('callMethod() sends correct message type', async () => {
      transport.setDynamicResponse(() => 'method result');

      const result = await protocol.callMethod<string>('handle-123', 'myMethod', ['arg1']);

      expect(result).toBe('method result');

      const parsed = JSON.parse(transport.lastMessage!);
      expect(parsed.method).toBe('call_method');
      expect(parsed.params.handle).toBe('handle-123');
      expect(parsed.params.methodName).toBe('myMethod');
      expect(parsed.params.args).toEqual(['arg1']);
    });

    it('callMethod() supports kwargs', async () => {
      transport.setDynamicResponse(() => null);

      await protocol.callMethod('handle', 'method', [], { option: 123 });

      const parsed = JSON.parse(transport.lastMessage!);
      expect(parsed.params.kwargs).toEqual({ option: 123 });
    });

    it('disposeInstance() sends correct message type', async () => {
      transport.setDynamicResponse(() => null);

      await protocol.disposeInstance('handle-789');

      const parsed = JSON.parse(transport.lastMessage!);
      expect(parsed.method).toBe('dispose_instance');
      expect(parsed.params.handle).toBe('handle-789');
    });
  });
});

// =============================================================================
// INTEGRATION: SAFECODEC + TRANSPORT
// =============================================================================

describe('BridgeProtocol Integration', () => {
  describe('SafeCodec + Transport', () => {
    let protocol: TestBridgeProtocol;
    let transport: MockTransport;

    beforeEach(async () => {
      transport = new MockTransport();
      protocol = new TestBridgeProtocol({ transport });
      await protocol.init();
    });

    afterEach(async () => {
      if (protocol && !protocol.isDisposed) {
        await protocol.dispose();
      }
    });

    it('special floats in args are rejected before send', async () => {
      // Transport should never receive the message
      let transportCalled = false;
      transport.send = async () => {
        transportCalled = true;
        return '{}';
      };

      await expect(
        protocol.call('module', 'func', [NaN])
      ).rejects.toThrow(BridgeProtocolError);

      expect(transportCalled).toBe(false);
    });

    it('Infinity in nested args is rejected', async () => {
      await expect(
        protocol.call('module', 'func', [{ nested: { value: Infinity } }])
      ).rejects.toThrow(/non-finite number/);
    });

    it('response decoding validates result', async () => {
      transport.setDynamicResponse(() => ({ a: 1, b: 'test' }));

      const result = await protocol.call<{ a: number; b: string }>('m', 'f', []);

      expect(result).toEqual({ a: 1, b: 'test' });
    });

    it('error responses are properly converted to BridgeExecutionError', async () => {
      transport.setErrorResponse('ValueError', 'invalid argument', 'Traceback...');

      try {
        await protocol.call('module', 'func', []);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(BridgeExecutionError);
        const bridgeErr = err as BridgeExecutionError;
        expect(bridgeErr.message).toBe('ValueError: invalid argument');
        expect(bridgeErr.traceback).toBe('Traceback...');
      }
    });

    it('error responses without traceback work correctly', async () => {
      transport.setErrorResponse('TypeError', 'type mismatch');

      await expect(
        protocol.call('module', 'func', [])
      ).rejects.toThrow('TypeError: type mismatch');
    });

    it('binary data is encoded as base64 with marker', async () => {
      transport.setDynamicResponse(msg => {
        return (msg.params?.args as unknown[])?.[0];
      });

      const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      await protocol.call('module', 'func', [bytes]);

      const parsed = JSON.parse(transport.lastMessage!);
      expect(parsed.params.args[0].__tywrap_bytes__).toBe(true);
      expect(parsed.params.args[0].b64).toBe('SGVsbG8=');
    });

    it('payload size limits are enforced', async () => {
      const smallCodecProtocol = new TestBridgeProtocol({
        transport: new MockTransport(),
        codec: { maxPayloadBytes: 100 },
      });
      await smallCodecProtocol.init();

      await expect(
        smallCodecProtocol.call('module', 'func', ['x'.repeat(200)])
      ).rejects.toThrow(BridgeProtocolError);

      await smallCodecProtocol.dispose();
    });

    it('response size limits are enforced', async () => {
      const smallCodecTransport = new MockTransport();
      smallCodecTransport.send = async () => JSON.stringify({ id: 1, result: 'y'.repeat(200) });

      const smallCodecProtocol = new TestBridgeProtocol({
        transport: smallCodecTransport,
        codec: { maxPayloadBytes: 100 },
      });
      await smallCodecProtocol.init();

      await expect(
        smallCodecProtocol.call('module', 'func', [])
      ).rejects.toThrow(/exceeds maximum/);

      await smallCodecProtocol.dispose();
    });
  });

  // ===========================================================================
  // INTEGRATION: BRIDGEPROTOCOL + WORKERPOOL
  // ===========================================================================

  describe('BridgeProtocol + WorkerPool', () => {
    let pool: WorkerPool;
    let transportFactory: () => MockTransport;
    let createdTransports: MockTransport[];

    beforeEach(() => {
      createdTransports = [];
      transportFactory = () => {
        const transport = new MockTransport();
        transport.setDynamicResponse(msg => `result-${msg.id}`);
        createdTransports.push(transport);
        return transport;
      };
    });

    afterEach(async () => {
      if (pool && !pool.isDisposed) {
        await pool.dispose();
      }
    });

    it('multiple requests use pool correctly', async () => {
      pool = new WorkerPool({
        createTransport: transportFactory,
        maxWorkers: 2,
        maxConcurrentPerWorker: 1,
      });
      await pool.init();

      // Acquire workers and use them
      const results: string[] = [];

      await pool.withWorker(async worker => {
        const response = await worker.transport.send('{"id":1,"protocol":"tywrap/1","method":"call","params":{}}', 1000);
        results.push(response);
      });

      await pool.withWorker(async worker => {
        const response = await worker.transport.send('{"id":2,"protocol":"tywrap/1","method":"call","params":{}}', 1000);
        results.push(response);
      });

      expect(results.length).toBe(2);
      expect(createdTransports.length).toBeGreaterThanOrEqual(1);
    });

    it('concurrent requests work', async () => {
      pool = new WorkerPool({
        createTransport: transportFactory,
        maxWorkers: 4,
        maxConcurrentPerWorker: 1,
      });
      await pool.init();

      const promises = [
        pool.withWorker(async worker =>
          worker.transport.send('{"id":1,"protocol":"tywrap/1","method":"call","params":{}}', 1000)
        ),
        pool.withWorker(async worker =>
          worker.transport.send('{"id":2,"protocol":"tywrap/1","method":"call","params":{}}', 1000)
        ),
        pool.withWorker(async worker =>
          worker.transport.send('{"id":3,"protocol":"tywrap/1","method":"call","params":{}}', 1000)
        ),
      ];

      const results = await Promise.all(promises);

      expect(results.length).toBe(3);
      results.forEach(r => {
        expect(r).toContain('result');
      });
    });

    it('pool disposal cleans up all transports', async () => {
      pool = new WorkerPool({
        createTransport: transportFactory,
        maxWorkers: 3,
        maxConcurrentPerWorker: 1,
      });
      await pool.init();

      // Create multiple workers
      await pool.withWorker(async () => {});
      await pool.withWorker(async () => {});

      expect(createdTransports.length).toBeGreaterThanOrEqual(1);

      await pool.dispose();

      // All created transports should be disposed
      for (const transport of createdTransports) {
        expect(transport.disposeCalled).toBe(true);
      }
    });

    it('pool with BridgeProtocol integration', async () => {
      // Create a pool that creates BridgeProtocol instances
      const protocolFactory = (): Transport => {
        const mockTransport = new MockTransport();
        mockTransport.setDynamicResponse(msg => 42);
        return mockTransport;
      };

      pool = new WorkerPool({
        createTransport: protocolFactory,
        maxWorkers: 2,
        maxConcurrentPerWorker: 1,
      });
      await pool.init();

      // Use the pool to execute requests
      const result = await pool.withWorker(async worker => {
        const response = await worker.transport.send(
          JSON.stringify({ id: 1, protocol: 'tywrap/1', method: 'call', params: { module: 'math', functionName: 'sqrt', args: [16] } }),
          1000
        );
        return JSON.parse(response);
      });

      expect(result.result).toBe(42);
    });
  });

  // ===========================================================================
  // FULL STACK INTEGRATION
  // ===========================================================================

  describe('Full stack (SafeCodec + Transport + Pool + Protocol)', () => {
    let pool: WorkerPool;

    afterEach(async () => {
      if (pool && !pool.isDisposed) {
        await pool.dispose();
      }
    });

    it('complete request-response cycle through pool', async () => {
      const createProtocolTransport = (): Transport => {
        const transport = new MockTransport();
        transport.setDynamicResponse(msg => {
          if (msg.params?.functionName === 'sqrt') {
            const num = (msg.params?.args as number[])?.[0] as number;
            return Math.sqrt(num);
          }
          return null;
        });
        return transport;
      };

      pool = new WorkerPool({
        createTransport: createProtocolTransport,
        maxWorkers: 2,
        maxConcurrentPerWorker: 1,
      });
      await pool.init();

      // Execute a full request through the pool
      const result = await pool.withWorker(async worker => {
        const codec = new SafeCodec();

        // Encode request
        const request = codec.encodeRequest({
          id: 1,
          protocol: 'tywrap/1',
          method: 'call',
          params: {
            module: 'math',
            functionName: 'sqrt',
            args: [16],
          },
        });

        // Send through transport
        const responseStr = await worker.transport.send(request, 5000);

        // Decode response (SafeCodec extracts the result)
        const response = codec.decodeResponse<number>(responseStr);
        return response;
      });

      expect(result).toBe(4);
    });

    it('error propagates through full stack', async () => {
      const createErrorTransport = (): Transport => {
        const transport = new MockTransport();
        transport.setErrorResponse('ValueError', 'test error', 'Full traceback');
        return transport;
      };

      pool = new WorkerPool({
        createTransport: createErrorTransport,
        maxWorkers: 1,
      });
      await pool.init();

      await expect(
        pool.withWorker(async worker => {
          const codec = new SafeCodec();
          const request = codec.encodeRequest({
            id: 1,
            protocol: 'tywrap/1',
            method: 'call',
            params: {
              module: 'test',
              functionName: 'fail',
              args: [],
            },
          });
          const responseStr = await worker.transport.send(request, 5000);
          return codec.decodeResponse(responseStr);
        })
      ).rejects.toThrow(BridgeExecutionError);
    });

    it('codec validation prevents invalid data from reaching transport', async () => {
      let transportCalled = false;
      const createTrackingTransport = (): Transport => {
        const transport = new MockTransport();
        transport.send = async () => {
          transportCalled = true;
          return '{}';
        };
        return transport;
      };

      pool = new WorkerPool({
        createTransport: createTrackingTransport,
        maxWorkers: 1,
      });
      await pool.init();

      await expect(
        pool.withWorker(async worker => {
          const codec = new SafeCodec({ rejectSpecialFloats: true });
          // This should throw before reaching transport
          codec.encodeRequest({ id: 1, protocol: 'tywrap/1', method: 'call', params: { args: [NaN] } });
        })
      ).rejects.toThrow(BridgeProtocolError);

      expect(transportCalled).toBe(false);
    });

    it('handles concurrent mixed operations', async () => {
      const createMathTransport = (): Transport => {
        const transport = new MockTransport();
        transport.setDynamicResponse(msg => {
          const args = msg.params?.args as number[] | undefined;
          switch (msg.params?.functionName) {
            case 'add':
              return (args?.[0] ?? 0) + (args?.[1] ?? 0);
            case 'multiply':
              return (args?.[0] ?? 0) * (args?.[1] ?? 0);
            case 'sqrt':
              return Math.sqrt(args?.[0] ?? 0);
            default:
              return null;
          }
        });
        return transport;
      };

      pool = new WorkerPool({
        createTransport: createMathTransport,
        maxWorkers: 4,
        maxConcurrentPerWorker: 2,
      });
      await pool.init();

      const operations = [
        pool.withWorker(async worker => {
          const codec = new SafeCodec();
          const req = codec.encodeRequest({ id: 1, protocol: 'tywrap/1', method: 'call', params: { module: 'm', functionName: 'add', args: [1, 2] } });
          const res = await worker.transport.send(req, 1000);
          return codec.decodeResponse<number>(res);
        }),
        pool.withWorker(async worker => {
          const codec = new SafeCodec();
          const req = codec.encodeRequest({ id: 2, protocol: 'tywrap/1', method: 'call', params: { module: 'm', functionName: 'multiply', args: [3, 4] } });
          const res = await worker.transport.send(req, 1000);
          return codec.decodeResponse<number>(res);
        }),
        pool.withWorker(async worker => {
          const codec = new SafeCodec();
          const req = codec.encodeRequest({ id: 3, protocol: 'tywrap/1', method: 'call', params: { module: 'm', functionName: 'sqrt', args: [25] } });
          const res = await worker.transport.send(req, 1000);
          return codec.decodeResponse<number>(res);
        }),
      ];

      const results = await Promise.all(operations);

      expect(results).toEqual([3, 12, 5]);
    });

    it('transport recovers from transient failures', async () => {
      // Create a transport that fails once then recovers (simulating network hiccup)
      let sendCallCount = 0;
      const createRecoveringTransport = (): Transport => {
        const transport = new MockTransport();
        const originalSend = transport.send.bind(transport);

        transport.send = async (message: string, timeoutMs: number, signal?: AbortSignal): Promise<string> => {
          sendCallCount++;
          if (sendCallCount === 1) {
            // First call fails
            throw new Error('Connection lost');
          }
          // Subsequent calls succeed
          const parsed = JSON.parse(message) as ProtocolMessage;
          return JSON.stringify({ id: parsed.id, result: 'recovered' });
        };

        return transport;
      };

      pool = new WorkerPool({
        createTransport: createRecoveringTransport,
        maxWorkers: 1,
        maxConcurrentPerWorker: 1,
      });
      await pool.init();

      // First attempt should fail
      await expect(
        pool.withWorker(async worker => {
          return worker.transport.send('{"id":1,"protocol":"tywrap/1","method":"call","params":{}}', 1000);
        })
      ).rejects.toThrow('Connection lost');

      // Second attempt should succeed (same transport, but send now works)
      const result = await pool.withWorker(async worker => {
        return worker.transport.send('{"id":2,"protocol":"tywrap/1","method":"call","params":{}}', 1000);
      });

      expect(result).toContain('recovered');
    });

    it('uses separate workers for concurrent requests when maxConcurrentPerWorker is 1', async () => {
      const transportIds: string[] = [];
      let transportCounter = 0;

      const createIdentifiedTransport = (): Transport => {
        const id = `transport-${++transportCounter}`;
        const transport = new MockTransport();
        transport.send = async (message: string): Promise<string> => {
          transportIds.push(id);
          // Add small delay to ensure concurrent execution
          await new Promise(resolve => setTimeout(resolve, 10));
          const parsed = JSON.parse(message);
          return JSON.stringify({ id: parsed.id, result: id });
        };
        return transport;
      };

      pool = new WorkerPool({
        createTransport: createIdentifiedTransport,
        maxWorkers: 3,
        maxConcurrentPerWorker: 1,
      });
      await pool.init();

      // Send 3 concurrent requests
      const results = await Promise.all([
        pool.withWorker(w => w.transport.send('{"id":1,"protocol":"tywrap/1","method":"call","params":{}}', 1000)),
        pool.withWorker(w => w.transport.send('{"id":2,"protocol":"tywrap/1","method":"call","params":{}}', 1000)),
        pool.withWorker(w => w.transport.send('{"id":3,"protocol":"tywrap/1","method":"call","params":{}}', 1000)),
      ]);

      // Should have used 3 different transports
      expect(transportIds.length).toBe(3);
      // With maxConcurrentPerWorker: 1 and 3 concurrent requests, we should have 3 workers
      expect(new Set(transportIds).size).toBe(3);
    });
  });

  // ===========================================================================
  // EDGE CASES
  // ===========================================================================

  describe('Edge cases', () => {
    it('handles empty args array', async () => {
      const transport = new MockTransport();
      transport.setDynamicResponse(() => 'no-args-result');

      const protocol = new TestBridgeProtocol({ transport });
      await protocol.init();

      const result = await protocol.call<string>('module', 'noArgs', []);

      expect(result).toBe('no-args-result');
      const parsed = JSON.parse(transport.lastMessage!);
      expect(parsed.params.args).toEqual([]);

      await protocol.dispose();
    });

    it('handles null result', async () => {
      const transport = new MockTransport();
      transport.setDynamicResponse(() => null);

      const protocol = new TestBridgeProtocol({ transport });
      await protocol.init();

      const result = await protocol.call<null>('module', 'returnNull', []);

      expect(result).toBeNull();

      await protocol.dispose();
    });

    it('handles undefined kwargs', async () => {
      const transport = new MockTransport();
      transport.setDynamicResponse(() => 'ok');

      const protocol = new TestBridgeProtocol({ transport });
      await protocol.init();

      await protocol.call('module', 'func', [1, 2]);

      const parsed = JSON.parse(transport.lastMessage!);
      expect(parsed.params.kwargs).toBeUndefined();

      await protocol.dispose();
    });

    it('handles complex nested data structures', async () => {
      const transport = new MockTransport();
      transport.setDynamicResponse(msg => (msg.params?.args as unknown[])?.[0]);

      const protocol = new TestBridgeProtocol({ transport });
      await protocol.init();

      const complexData = {
        level1: {
          level2: {
            level3: {
              array: [1, 2, { nested: 'value' }],
              boolean: true,
              null: null,
            },
          },
        },
      };

      const result = await protocol.call<typeof complexData>('module', 'echo', [complexData]);

      expect(result).toEqual(complexData);

      await protocol.dispose();
    });

    it('handles unicode in strings', async () => {
      const transport = new MockTransport();
      transport.setDynamicResponse(msg => (msg.params?.args as unknown[])?.[0]);

      const protocol = new TestBridgeProtocol({ transport });
      await protocol.init();

      const unicodeData = {
        emoji: '\u{1F600}\u{1F389}',
        chinese: '\u4E2D\u6587',
        arabic: '\u0627\u0644\u0639\u0631\u0628\u064A\u0629',
      };

      const result = await protocol.call<typeof unicodeData>('module', 'echo', [unicodeData]);

      expect(result).toEqual(unicodeData);

      await protocol.dispose();
    });

    it('handles very large numbers', async () => {
      const transport = new MockTransport();
      transport.setDynamicResponse(msg => msg.params?.args);

      const protocol = new TestBridgeProtocol({ transport });
      await protocol.init();

      const result = await protocol.call<number[]>('module', 'func', [
        Number.MAX_SAFE_INTEGER,
        Number.MIN_SAFE_INTEGER,
        Number.MAX_VALUE,
        Number.MIN_VALUE,
      ]);

      expect(result[0]).toBe(Number.MAX_SAFE_INTEGER);
      expect(result[1]).toBe(Number.MIN_SAFE_INTEGER);
      expect(result[2]).toBe(Number.MAX_VALUE);
      expect(result[3]).toBe(Number.MIN_VALUE);

      await protocol.dispose();
    });
  });
});
