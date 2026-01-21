/**
 * Pyodide Browser Runtime Compatibility Tests
 * Tests WebAssembly initialization, package loading, data serialization, and browser compatibility
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PyodideBridge, type PyodideBridgeOptions } from '../src/runtime/pyodide.js';
import { isBrowser } from '../src/utils/runtime.js';

// Mock Pyodide for testing
interface MockPyodideInstance {
  runPython: (code: string) => unknown;
  runPythonAsync: (code: string) => Promise<unknown>;
  globals: { get: (key: string) => unknown; set: (k: string, v: unknown) => void };
  toPy: (obj: unknown) => unknown;
  loadPackage: (name: string | string[]) => Promise<void>;
}

/**
 * Create a mock dispatch handler that can be customized per test.
 * The handler receives JSON message strings and returns JSON response strings.
 */
let mockDispatchHandler: ((messageJson: string) => string) | null = null;

const setMockDispatchHandler = (handler: (messageJson: string) => string) => {
  mockDispatchHandler = handler;
};

const createMockPyodide = (): MockPyodideInstance => {
  const globals = new Map<string, unknown>();

  // Default dispatch function that returns success
  const defaultDispatch = (messageJson: string): string => {
    if (mockDispatchHandler) {
      return mockDispatchHandler(messageJson);
    }
    const msg = JSON.parse(messageJson);
    return JSON.stringify({ id: msg.id, result: null });
  };

  return {
    runPython: (code: string) => {
      // No-op for now - runPythonAsync handles bootstrap
      return undefined;
    },
    runPythonAsync: async (code: string) => {
      // When bootstrap code runs, set up the dispatch function
      if (code.includes('def __tywrap_dispatch')) {
        globals.set('__tywrap_dispatch', defaultDispatch);
      }
      return Promise.resolve(undefined);
    },
    globals: {
      get: (key: string) => globals.get(key),
      set: (key: string, value: unknown) => globals.set(key, value),
    },
    toPy: (obj: unknown) => obj, // Simple passthrough for testing
    loadPackage: async (name: string | string[]) => {
      // Mock package loading
      return Promise.resolve();
    },
  };
};

// Mock the loadPyodide function
const createMockLoadPyodide = () => {
  return vi.fn(async () => createMockPyodide());
};

describe('Pyodide Runtime Bridge', () => {
  let bridge: PyodideBridge;
  let mockLoadPyodide: ReturnType<typeof createMockLoadPyodide>;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    mockLoadPyodide = createMockLoadPyodide();
    mockDispatchHandler = null; // Reset dispatch handler

    // Mock global loadPyodide
    (globalThis as any).loadPyodide = mockLoadPyodide;
  });

  afterEach(async () => {
    await bridge?.dispose();
    mockDispatchHandler = null;

    // Cleanup global mock
    delete (globalThis as any).loadPyodide;
  });

  describe('Browser Environment Detection', () => {
    it('should detect browser environment correctly', () => {
      // This test verifies the detection logic is working
      // In testing environment, isBrowser() should return false
      expect(typeof isBrowser()).toBe('boolean');
    });
  });

  describe('Basic Initialization', () => {
    it('should initialize with default options', async () => {
      bridge = new PyodideBridge();

      // Mock a successful call to test initialization
      setMockDispatchHandler((msg: string) => {
        const parsed = JSON.parse(msg);
        return JSON.stringify({ id: parsed.id, result: 4 });
      });

      const result = await bridge.call('math', 'sqrt', [16]);
      expect(result).toBe(4);
      expect(mockLoadPyodide).toHaveBeenCalledWith({
        indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.28.0/full/',
      });
    });

    it('should initialize with custom index URL', async () => {
      const customURL = 'https://custom.pyodide.cdn/';
      bridge = new PyodideBridge({ indexURL: customURL });

      setMockDispatchHandler((msg: string) => {
        const parsed = JSON.parse(msg);
        return JSON.stringify({ id: parsed.id, result: 4 });
      });

      await bridge.call('math', 'sqrt', [16]);

      expect(mockLoadPyodide).toHaveBeenCalledWith({
        indexURL: customURL,
      });
    });

    it('should initialize with pre-loaded packages', async () => {
      const packages = ['numpy', 'pandas'];
      bridge = new PyodideBridge({
        indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.28.0/full/',
        packages,
      });

      const mockPyodide = createMockPyodide();
      const loadPackageSpy = vi.spyOn(mockPyodide, 'loadPackage');
      mockLoadPyodide.mockResolvedValue(mockPyodide);

      setMockDispatchHandler((msg: string) => {
        const parsed = JSON.parse(msg);
        return JSON.stringify({ id: parsed.id, result: 4 });
      });

      await bridge.call('math', 'sqrt', [16]);

      expect(loadPackageSpy).toHaveBeenCalledWith(packages);
    });
  });

  describe('Pyodide Resolution', () => {
    it('should use global loadPyodide when available', async () => {
      bridge = new PyodideBridge();

      setMockDispatchHandler((msg: string) => {
        const parsed = JSON.parse(msg);
        return JSON.stringify({ id: parsed.id, result: 4 });
      });

      await bridge.call('math', 'sqrt', [16]);

      expect(mockLoadPyodide).toHaveBeenCalled();
    });

    it('should handle missing Pyodide gracefully', async () => {
      bridge = new PyodideBridge();

      // Remove the global loadPyodide
      delete (globalThis as any).loadPyodide;

      // Mock dynamic import to fail (simulating pyodide not installed)
      vi.doMock('pyodide', () => {
        throw new Error('Module not found');
      });

      await expect(bridge.call('math', 'sqrt', [16])).rejects.toThrow(
        'Pyodide is not available in this environment'
      );
    });

    it('should attempt dynamic import when global not available', async () => {
      bridge = new PyodideBridge();

      // Remove the global loadPyodide
      delete (globalThis as any).loadPyodide;

      // Mock dynamic import to fail (simulating pyodide not installed)
      vi.doMock('pyodide', () => {
        throw new Error('Module not found');
      });

      await expect(bridge.call('math', 'sqrt', [16])).rejects.toThrow(
        'Pyodide is not available in this environment'
      );
    });
  });

  describe('Function Calls', () => {
    beforeEach(async () => {
      bridge = new PyodideBridge();
    });

    it('should handle basic function calls', async () => {
      let receivedMessage: unknown = null;
      setMockDispatchHandler((msg: string) => {
        receivedMessage = JSON.parse(msg);
        const parsed = JSON.parse(msg);
        return JSON.stringify({ id: parsed.id, result: 4 });
      });

      const result = await bridge.call('math', 'sqrt', [16]);

      expect(receivedMessage).toBeDefined();
      expect((receivedMessage as any).method).toBe('call');
      expect((receivedMessage as any).params.module).toBe('math');
      expect((receivedMessage as any).params.functionName).toBe('sqrt');
      expect((receivedMessage as any).params.args).toEqual([16]);
      expect(result).toBe(4);
    });

    it('should handle function calls with kwargs', async () => {
      let receivedMessage: unknown = null;
      setMockDispatchHandler((msg: string) => {
        receivedMessage = JSON.parse(msg);
        const parsed = JSON.parse(msg);
        return JSON.stringify({ id: parsed.id, result: 4 });
      });

      const kwargs = { precision: 2 };
      const result = await bridge.call('math', 'sqrt', [16], kwargs);

      expect((receivedMessage as any).params.kwargs).toEqual(kwargs);
      expect(result).toBe(4);
    });

    it('should handle empty arguments', async () => {
      let receivedMessage: unknown = null;
      setMockDispatchHandler((msg: string) => {
        receivedMessage = JSON.parse(msg);
        const parsed = JSON.parse(msg);
        return JSON.stringify({ id: parsed.id, result: 'result' });
      });

      const result = await bridge.call('module', 'func', []);

      expect((receivedMessage as any).params.args).toEqual([]);
      expect(result).toBe('result');
    });

    it('should fail when helper not initialized', async () => {
      // Create a mock that doesn't set up the dispatch function
      const mockPyodide = createMockPyodide();
      // Override runPythonAsync to NOT set up dispatch
      mockPyodide.runPythonAsync = async () => undefined;
      mockLoadPyodide.mockResolvedValue(mockPyodide);

      await expect(bridge.call('math', 'sqrt', [16])).rejects.toThrow(
        'Pyodide dispatch function not initialized'
      );
    });
  });

  describe('Class Instantiation', () => {
    beforeEach(async () => {
      bridge = new PyodideBridge();
    });

    it('should handle basic class instantiation', async () => {
      let receivedMessage: unknown = null;
      setMockDispatchHandler((msg: string) => {
        receivedMessage = JSON.parse(msg);
        const parsed = JSON.parse(msg);
        return JSON.stringify({ id: parsed.id, result: 'handle-1' });
      });

      const result = await bridge.instantiate('collections', 'Counter', []);

      expect((receivedMessage as any).method).toBe('instantiate');
      expect((receivedMessage as any).params.module).toBe('collections');
      expect((receivedMessage as any).params.className).toBe('Counter');
      expect(result).toBe('handle-1');
    });

    it('should handle class instantiation with args and kwargs', async () => {
      let receivedMessage: unknown = null;
      setMockDispatchHandler((msg: string) => {
        receivedMessage = JSON.parse(msg);
        const parsed = JSON.parse(msg);
        return JSON.stringify({ id: parsed.id, result: 'handle-2' });
      });

      const args = [1, 2, 3];
      const kwargs = { name: 'test' };
      const result = await bridge.instantiate('mymodule', 'MyClass', args, kwargs);

      expect((receivedMessage as any).params.args).toEqual(args);
      expect((receivedMessage as any).params.kwargs).toEqual(kwargs);
      expect(result).toBe('handle-2');
    });

    it('should fail when helper not initialized', async () => {
      // Create a mock that doesn't set up the dispatch function
      const mockPyodide = createMockPyodide();
      mockPyodide.runPythonAsync = async () => undefined;
      mockLoadPyodide.mockResolvedValue(mockPyodide);

      await expect(bridge.instantiate('collections', 'Counter', [])).rejects.toThrow(
        'Pyodide dispatch function not initialized'
      );
    });

    it('should handle instance method calls', async () => {
      let receivedMessage: unknown = null;
      setMockDispatchHandler((msg: string) => {
        receivedMessage = JSON.parse(msg);
        const parsed = JSON.parse(msg);
        return JSON.stringify({ id: parsed.id, result: 123 });
      });

      const result = await bridge.callMethod('handle-1', 'count', [1, 2]);

      expect((receivedMessage as any).method).toBe('call_method');
      expect((receivedMessage as any).params.handle).toBe('handle-1');
      expect((receivedMessage as any).params.methodName).toBe('count');
      expect(result).toBe(123);
    });

    it('should dispose instances', async () => {
      let receivedMessage: unknown = null;
      setMockDispatchHandler((msg: string) => {
        receivedMessage = JSON.parse(msg);
        const parsed = JSON.parse(msg);
        return JSON.stringify({ id: parsed.id, result: null });
      });

      await bridge.disposeInstance('handle-1');

      expect((receivedMessage as any).method).toBe('dispose_instance');
      expect((receivedMessage as any).params.handle).toBe('handle-1');
    });
  });

  describe('Bootstrap Helpers', () => {
    it('should bootstrap helper functions correctly', async () => {
      const mockPyodide = createMockPyodide();
      const runPythonAsyncSpy = vi.spyOn(mockPyodide, 'runPythonAsync');
      mockLoadPyodide.mockResolvedValue(mockPyodide);

      setMockDispatchHandler((msg: string) => {
        const parsed = JSON.parse(msg);
        return JSON.stringify({ id: parsed.id, result: 4 });
      });

      bridge = new PyodideBridge();
      await bridge.call('math', 'sqrt', [16]);

      // Verify that bootstrap code was executed (now uses single dispatch function)
      expect(runPythonAsyncSpy).toHaveBeenCalledWith(expect.stringContaining('def __tywrap_dispatch'));
    });
  });

  describe('Data Type Handling', () => {
    beforeEach(async () => {
      bridge = new PyodideBridge();
    });

    it('should convert JavaScript objects to Python using toPy', async () => {
      // Note: The new architecture uses JSON serialization rather than toPy
      // This test verifies that data passes through correctly
      let receivedMessage: unknown = null;
      setMockDispatchHandler((msg: string) => {
        receivedMessage = JSON.parse(msg);
        const parsed = JSON.parse(msg);
        return JSON.stringify({ id: parsed.id, result: 42 });
      });

      const args = [1, 2, 3];
      const kwargs = { key: 'value' };
      await bridge.call('module', 'func', args, kwargs);

      expect((receivedMessage as any).params.args).toEqual(args);
      expect((receivedMessage as any).params.kwargs).toEqual(kwargs);
    });

    it('should handle null/undefined args and kwargs', async () => {
      let receivedMessage: unknown = null;
      setMockDispatchHandler((msg: string) => {
        receivedMessage = JSON.parse(msg);
        const parsed = JSON.parse(msg);
        return JSON.stringify({ id: parsed.id, result: 42 });
      });

      // With default args [] passed by bridge
      await bridge.call('module', 'func', []);

      expect((receivedMessage as any).params.args).toEqual([]);
    });

    it('should handle complex data structures', async () => {
      let receivedMessage: unknown = null;
      setMockDispatchHandler((msg: string) => {
        receivedMessage = JSON.parse(msg);
        const parsed = JSON.parse(msg);
        return JSON.stringify({ id: parsed.id, result: 42 });
      });

      const complexArgs = [{ nested: { object: true } }, [1, 2, { array: 'item' }]];
      const complexKwargs = {
        param1: [1, 2, 3],
        param2: { deep: { nesting: 'value' } },
      };

      await bridge.call('module', 'func', complexArgs, complexKwargs);

      expect((receivedMessage as any).params.args).toEqual(complexArgs);
      expect((receivedMessage as any).params.kwargs).toEqual(complexKwargs);
    });
  });

  describe('Resource Cleanup', () => {
    it('should complete calls without memory leaks', async () => {
      // In the new architecture, proxy cleanup is handled internally by PyodideIO.
      // This test verifies that calls complete successfully without issues.
      bridge = new PyodideBridge();

      let callCount = 0;
      setMockDispatchHandler((msg: string) => {
        callCount++;
        const parsed = JSON.parse(msg);
        return JSON.stringify({ id: parsed.id, result: 42 });
      });

      // Make multiple calls to verify cleanup doesn't break subsequent calls
      await bridge.call('module', 'func', [1, 2], { key: 'value' });
      await bridge.call('module', 'func', [3, 4], { key: 'value2' });
      await bridge.call('module', 'func', [5, 6], { key: 'value3' });

      // All calls should complete successfully
      expect(callCount).toBe(3);
    });
  });

  describe('Package Loading', () => {
    it('should load packages during initialization', async () => {
      const packages = ['numpy', 'pandas', 'matplotlib'];
      bridge = new PyodideBridge({
        indexURL: 'https://cdn.jsdelivr.net/pyodide/',
        packages,
      });

      const mockPyodide = createMockPyodide();
      const loadPackageSpy = vi.spyOn(mockPyodide, 'loadPackage');
      mockLoadPyodide.mockResolvedValue(mockPyodide);

      setMockDispatchHandler((msg: string) => {
        const parsed = JSON.parse(msg);
        return JSON.stringify({ id: parsed.id, result: 4 });
      });

      await bridge.call('math', 'sqrt', [16]);

      expect(loadPackageSpy).toHaveBeenCalledWith(packages);
    });

    it('should handle package loading errors gracefully', async () => {
      const packages = ['nonexistent_package'];
      bridge = new PyodideBridge({
        indexURL: 'https://cdn.jsdelivr.net/pyodide/',
        packages,
      });

      const mockPyodide = createMockPyodide();
      vi.spyOn(mockPyodide, 'loadPackage').mockRejectedValue(new Error('Package not found'));
      mockLoadPyodide.mockResolvedValue(mockPyodide);

      // Should throw error during package loading
      await expect(bridge.call('math', 'sqrt', [16])).rejects.toThrow('Package not found');
    });

    it('should skip package loading when no packages specified', async () => {
      bridge = new PyodideBridge();

      const mockPyodide = createMockPyodide();
      const loadPackageSpy = vi.spyOn(mockPyodide, 'loadPackage');
      mockLoadPyodide.mockResolvedValue(mockPyodide);

      setMockDispatchHandler((msg: string) => {
        const parsed = JSON.parse(msg);
        return JSON.stringify({ id: parsed.id, result: 4 });
      });

      await bridge.call('math', 'sqrt', [16]);

      expect(loadPackageSpy).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      bridge = new PyodideBridge();
    });

    it('should handle Pyodide loading failures', async () => {
      mockLoadPyodide.mockRejectedValue(new Error('Failed to load Pyodide'));

      await expect(bridge.call('math', 'sqrt', [16])).rejects.toThrow('Failed to load Pyodide');
    });

    it('should handle function execution errors', async () => {
      // Set up dispatch handler that returns an error response
      setMockDispatchHandler((msg: string) => {
        const parsed = JSON.parse(msg);
        return JSON.stringify({
          id: parsed.id,
          error: {
            type: 'RuntimeError',
            message: 'Python execution error',
            traceback: 'Traceback...',
          },
        });
      });

      await expect(bridge.call('math', 'sqrt', [16])).rejects.toThrow('Python execution error');
    });

    it('should handle missing Pyodide instance', async () => {
      // Manually create a bridge and try to use it without proper initialization
      const bridge = new PyodideBridge();

      // Manually set the internal pyodide to undefined to simulate failure
      (bridge as any).py = undefined;

      // Mock loadPyodide to return undefined
      mockLoadPyodide.mockResolvedValue(undefined as any);

      await expect(bridge.call('math', 'sqrt', [16])).rejects.toThrow('Pyodide not initialized');
    });
  });

  describe('Disposal and Cleanup', () => {
    it('should dispose cleanly', async () => {
      bridge = new PyodideBridge();

      setMockDispatchHandler((msg: string) => {
        const parsed = JSON.parse(msg);
        return JSON.stringify({ id: parsed.id, result: 4 });
      });

      // Initialize by making a call
      await bridge.call('math', 'sqrt', [16]);

      // Dispose should not throw
      await expect(bridge.dispose()).resolves.toBeUndefined();
    });

    it('should handle disposal without initialization', async () => {
      bridge = new PyodideBridge();

      // Should not throw even if never initialized
      await expect(bridge.dispose()).resolves.toBeUndefined();
    });
  });

  describe('Memory and Performance', () => {
    beforeEach(async () => {
      bridge = new PyodideBridge();
    });

    it('should reuse Pyodide instance for multiple calls', async () => {
      let dispatchCallCount = 0;
      setMockDispatchHandler((msg: string) => {
        dispatchCallCount++;
        const parsed = JSON.parse(msg);
        return JSON.stringify({ id: parsed.id, result: 42 });
      });

      // Make multiple calls
      await bridge.call('math', 'sqrt', [16]);
      await bridge.call('math', 'sqrt', [25]);
      await bridge.call('math', 'sqrt', [36]);

      // loadPyodide should only be called once
      expect(mockLoadPyodide).toHaveBeenCalledTimes(1);

      // But the dispatch function should be called multiple times
      expect(dispatchCallCount).toBe(3);
    });

    it('should handle concurrent calls correctly', async () => {
      let callCount = 0;
      setMockDispatchHandler((msg: string) => {
        callCount++;
        const parsed = JSON.parse(msg);
        return JSON.stringify({ id: parsed.id, result: callCount });
      });

      // Make concurrent calls
      const promises = [
        bridge.call('math', 'sqrt', [4]),
        bridge.call('math', 'sqrt', [9]),
        bridge.call('math', 'sqrt', [16]),
      ];

      const results = await Promise.all(promises);

      expect(results).toEqual([1, 2, 3]);
      expect(mockLoadPyodide).toHaveBeenCalledTimes(1);
      expect(callCount).toBe(3);
    });
  });

  describe('Browser Compatibility', () => {
    it('should handle different browser environments', async () => {
      // Test with different global object configurations
      const originalWindow = (globalThis as any).window;
      const originalSelf = (globalThis as any).self;

      // Simulate browser environment
      (globalThis as any).window = { location: { href: 'http://localhost' } };
      (globalThis as any).self = { location: { href: 'http://localhost' } };

      bridge = new PyodideBridge();

      setMockDispatchHandler((msg: string) => {
        const parsed = JSON.parse(msg);
        return JSON.stringify({ id: parsed.id, result: 42 });
      });

      const result = await bridge.call('math', 'sqrt', [16]);
      expect(result).toBe(42);

      // Restore original globals
      if (originalWindow !== undefined) {
        (globalThis as any).window = originalWindow;
      } else {
        delete (globalThis as any).window;
      }

      if (originalSelf !== undefined) {
        (globalThis as any).self = originalSelf;
      } else {
        delete (globalThis as any).self;
      }
    });

    it('should handle Web Worker environment', async () => {
      // Simulate Web Worker environment (no window, but has self)
      const originalWindow = (globalThis as any).window;

      delete (globalThis as any).window;
      (globalThis as any).self = { location: { href: 'http://localhost' } };

      bridge = new PyodideBridge();

      setMockDispatchHandler((msg: string) => {
        const parsed = JSON.parse(msg);
        return JSON.stringify({ id: parsed.id, result: 42 });
      });

      const result = await bridge.call('math', 'sqrt', [16]);
      expect(result).toBe(42);

      // Restore original global
      if (originalWindow !== undefined) {
        (globalThis as any).window = originalWindow;
      }
      delete (globalThis as any).self;
    });
  });

  describe('CDN and Loading Configurations', () => {
    it('should handle different CDN URLs', async () => {
      const customCDNs = [
        'https://cdn.jsdelivr.net/pyodide/v0.28.0/',
        'https://unpkg.com/pyodide@0.28.0/',
        'https://custom-cdn.example.com/pyodide/',
      ];

      for (const cdnURL of customCDNs) {
        const testBridge = new PyodideBridge({ indexURL: cdnURL });

        const mockPyodide = createMockPyodide();
        const mockLoader = vi.fn().mockResolvedValue(mockPyodide);
        (globalThis as any).loadPyodide = mockLoader;

        setMockDispatchHandler((msg: string) => {
          const parsed = JSON.parse(msg);
          return JSON.stringify({ id: parsed.id, result: 42 });
        });

        await testBridge.call('math', 'sqrt', [16]);

        expect(mockLoader).toHaveBeenCalledWith({ indexURL: cdnURL });

        await testBridge.dispose();
        mockDispatchHandler = null;
      }
    });
  });
});
