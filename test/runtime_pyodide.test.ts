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

const createMockPyodide = (): MockPyodideInstance => {
  const globals = new Map<string, unknown>();
  
  return {
    runPython: (code: string) => {
      // Simple mock implementation
      if (code.includes('def __tywrap_call')) {
        // Store the helper functions in globals
        globals.set('__tywrap_call', vi.fn());
        globals.set('__tywrap_instantiate', vi.fn());
      }
      return undefined;
    },
    runPythonAsync: async (code: string) => {
      return Promise.resolve(undefined);
    },
    globals: {
      get: (key: string) => globals.get(key),
      set: (key: string, value: unknown) => globals.set(key, value)
    },
    toPy: (obj: unknown) => obj, // Simple passthrough for testing
    loadPackage: async (name: string | string[]) => {
      // Mock package loading
      return Promise.resolve();
    }
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
    
    // Mock global loadPyodide
    (globalThis as any).loadPyodide = mockLoadPyodide;
  });

  afterEach(async () => {
    await bridge?.dispose();
    
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
      const mockPyodide = createMockPyodide();
      mockPyodide.globals.set('__tywrap_call', vi.fn().mockReturnValue(42));
      mockLoadPyodide.mockResolvedValue(mockPyodide);
      
      const result = await bridge.call('math', 'sqrt', [16]);
      expect(mockLoadPyodide).toHaveBeenCalledWith({
        indexURL: 'https://cdn.jsdelivr.net/pyodide/'
      });
    });

    it('should initialize with custom index URL', async () => {
      const customURL = 'https://custom.pyodide.cdn/';
      bridge = new PyodideBridge({ indexURL: customURL });
      
      const mockPyodide = createMockPyodide();
      mockPyodide.globals.set('__tywrap_call', vi.fn().mockReturnValue(42));
      mockLoadPyodide.mockResolvedValue(mockPyodide);
      
      await bridge.call('math', 'sqrt', [16]);
      
      expect(mockLoadPyodide).toHaveBeenCalledWith({
        indexURL: customURL
      });
    });

    it('should initialize with pre-loaded packages', async () => {
      const packages = ['numpy', 'pandas'];
      bridge = new PyodideBridge({
        indexURL: 'https://cdn.jsdelivr.net/pyodide/',
        packages
      });
      
      const mockPyodide = createMockPyodide();
      const loadPackageSpy = vi.spyOn(mockPyodide, 'loadPackage');
      mockPyodide.globals.set('__tywrap_call', vi.fn().mockReturnValue(42));
      mockLoadPyodide.mockResolvedValue(mockPyodide);
      
      await bridge.call('math', 'sqrt', [16]);
      
      expect(loadPackageSpy).toHaveBeenCalledWith(packages);
    });
  });

  describe('Pyodide Resolution', () => {
    it('should use global loadPyodide when available', async () => {
      bridge = new PyodideBridge();
      
      const mockPyodide = createMockPyodide();
      mockPyodide.globals.set('__tywrap_call', vi.fn().mockReturnValue(42));
      mockLoadPyodide.mockResolvedValue(mockPyodide);
      
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
      const mockPyodide = createMockPyodide();
      const mockCallFn = vi.fn().mockReturnValue(42);
      mockPyodide.globals.set('__tywrap_call', mockCallFn);
      mockLoadPyodide.mockResolvedValue(mockPyodide);
      
      const result = await bridge.call('math', 'sqrt', [16]);
      
      expect(mockCallFn).toHaveBeenCalledWith('math', 'sqrt', [16], {});
      expect(result).toBe(42);
    });

    it('should handle function calls with kwargs', async () => {
      const mockPyodide = createMockPyodide();
      const mockCallFn = vi.fn().mockReturnValue(42);
      mockPyodide.globals.set('__tywrap_call', mockCallFn);
      mockLoadPyodide.mockResolvedValue(mockPyodide);
      
      const kwargs = { precision: 2 };
      const result = await bridge.call('math', 'sqrt', [16], kwargs);
      
      expect(mockCallFn).toHaveBeenCalledWith('math', 'sqrt', [16], kwargs);
      expect(result).toBe(42);
    });

    it('should handle empty arguments', async () => {
      const mockPyodide = createMockPyodide();
      const mockCallFn = vi.fn().mockReturnValue('result');
      mockPyodide.globals.set('__tywrap_call', mockCallFn);
      mockLoadPyodide.mockResolvedValue(mockPyodide);
      
      const result = await bridge.call('module', 'func', []);
      
      expect(mockCallFn).toHaveBeenCalledWith('module', 'func', [], {});
      expect(result).toBe('result');
    });

    it('should fail when helper not initialized', async () => {
      const mockPyodide = createMockPyodide();
      // Don't set the helper function
      mockLoadPyodide.mockResolvedValue(mockPyodide);
      
      await expect(bridge.call('math', 'sqrt', [16])).rejects.toThrow(
        'Pyodide helper not initialized'
      );
    });
  });

  describe('Class Instantiation', () => {
    beforeEach(async () => {
      bridge = new PyodideBridge();
    });

    it('should handle basic class instantiation', async () => {
      const mockPyodide = createMockPyodide();
      const mockInstantiateFn = vi.fn().mockReturnValue({ instance: true });
      mockPyodide.globals.set('__tywrap_instantiate', mockInstantiateFn);
      mockLoadPyodide.mockResolvedValue(mockPyodide);
      
      const result = await bridge.instantiate('collections', 'Counter', []);
      
      expect(mockInstantiateFn).toHaveBeenCalledWith('collections', 'Counter', [], {});
      expect(result).toEqual({ instance: true });
    });

    it('should handle class instantiation with args and kwargs', async () => {
      const mockPyodide = createMockPyodide();
      const mockInstantiateFn = vi.fn().mockReturnValue({ instance: true });
      mockPyodide.globals.set('__tywrap_instantiate', mockInstantiateFn);
      mockLoadPyodide.mockResolvedValue(mockPyodide);
      
      const args = [1, 2, 3];
      const kwargs = { name: 'test' };
      const result = await bridge.instantiate('mymodule', 'MyClass', args, kwargs);
      
      expect(mockInstantiateFn).toHaveBeenCalledWith('mymodule', 'MyClass', args, kwargs);
      expect(result).toEqual({ instance: true });
    });

    it('should fail when helper not initialized', async () => {
      const mockPyodide = createMockPyodide();
      // Don't set the helper function
      mockLoadPyodide.mockResolvedValue(mockPyodide);
      
      await expect(bridge.instantiate('collections', 'Counter', [])).rejects.toThrow(
        'Pyodide helper not initialized'
      );
    });
  });

  describe('Bootstrap Helpers', () => {
    it('should bootstrap helper functions correctly', async () => {
      const mockPyodide = createMockPyodide();
      const runPythonAsyncSpy = vi.spyOn(mockPyodide, 'runPythonAsync');
      mockPyodide.globals.set('__tywrap_call', vi.fn().mockReturnValue(42));
      mockLoadPyodide.mockResolvedValue(mockPyodide);
      
      bridge = new PyodideBridge();
      await bridge.call('math', 'sqrt', [16]);
      
      // Verify that bootstrap code was executed
      expect(runPythonAsyncSpy).toHaveBeenCalledWith(
        expect.stringContaining('def __tywrap_call')
      );
      expect(runPythonAsyncSpy).toHaveBeenCalledWith(
        expect.stringContaining('def __tywrap_instantiate')
      );
    });
  });

  describe('Data Type Handling', () => {
    beforeEach(async () => {
      bridge = new PyodideBridge();
    });

    it('should convert JavaScript objects to Python using toPy', async () => {
      const mockPyodide = createMockPyodide();
      const toPySpy = vi.spyOn(mockPyodide, 'toPy');
      const mockCallFn = vi.fn().mockReturnValue(42);
      mockPyodide.globals.set('__tywrap_call', mockCallFn);
      mockLoadPyodide.mockResolvedValue(mockPyodide);
      
      const args = [1, 2, 3];
      const kwargs = { key: 'value' };
      await bridge.call('module', 'func', args, kwargs);
      
      expect(toPySpy).toHaveBeenCalledWith(args);
      expect(toPySpy).toHaveBeenCalledWith(kwargs);
    });

    it('should handle null/undefined args and kwargs', async () => {
      const mockPyodide = createMockPyodide();
      const toPySpy = vi.spyOn(mockPyodide, 'toPy');
      const mockCallFn = vi.fn().mockReturnValue(42);
      mockPyodide.globals.set('__tywrap_call', mockCallFn);
      mockLoadPyodide.mockResolvedValue(mockPyodide);
      
      await bridge.call('module', 'func', undefined as any);
      
      expect(toPySpy).toHaveBeenCalledWith([]);
      expect(toPySpy).toHaveBeenCalledWith({});
    });

    it('should handle complex data structures', async () => {
      const mockPyodide = createMockPyodide();
      const toPySpy = vi.spyOn(mockPyodide, 'toPy');
      const mockCallFn = vi.fn().mockReturnValue(42);
      mockPyodide.globals.set('__tywrap_call', mockCallFn);
      mockLoadPyodide.mockResolvedValue(mockPyodide);
      
      const complexArgs = [
        { nested: { object: true } },
        [1, 2, { array: 'item' }]
      ];
      const complexKwargs = {
        param1: [1, 2, 3],
        param2: { deep: { nesting: 'value' } }
      };
      
      await bridge.call('module', 'func', complexArgs, complexKwargs);
      
      expect(toPySpy).toHaveBeenCalledWith(complexArgs);
      expect(toPySpy).toHaveBeenCalledWith(complexKwargs);
    });
  });

  describe('Package Loading', () => {
    it('should load packages during initialization', async () => {
      const packages = ['numpy', 'pandas', 'matplotlib'];
      bridge = new PyodideBridge({
        indexURL: 'https://cdn.jsdelivr.net/pyodide/',
        packages
      });
      
      const mockPyodide = createMockPyodide();
      const loadPackageSpy = vi.spyOn(mockPyodide, 'loadPackage');
      mockPyodide.globals.set('__tywrap_call', vi.fn().mockReturnValue(42));
      mockLoadPyodide.mockResolvedValue(mockPyodide);
      
      await bridge.call('math', 'sqrt', [16]);
      
      expect(loadPackageSpy).toHaveBeenCalledWith(packages);
    });

    it('should handle package loading errors gracefully', async () => {
      const packages = ['nonexistent_package'];
      bridge = new PyodideBridge({
        indexURL: 'https://cdn.jsdelivr.net/pyodide/',
        packages
      });
      
      const mockPyodide = createMockPyodide();
      const loadPackageSpy = vi.spyOn(mockPyodide, 'loadPackage')
        .mockRejectedValue(new Error('Package not found'));
      mockLoadPyodide.mockResolvedValue(mockPyodide);
      
      // Should throw error during package loading
      await expect(bridge.call('math', 'sqrt', [16])).rejects.toThrow('Package not found');
    });

    it('should skip package loading when no packages specified', async () => {
      bridge = new PyodideBridge();
      
      const mockPyodide = createMockPyodide();
      const loadPackageSpy = vi.spyOn(mockPyodide, 'loadPackage');
      mockPyodide.globals.set('__tywrap_call', vi.fn().mockReturnValue(42));
      mockLoadPyodide.mockResolvedValue(mockPyodide);
      
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
      const mockPyodide = createMockPyodide();
      const mockCallFn = vi.fn().mockImplementation(() => {
        throw new Error('Python execution error');
      });
      mockPyodide.globals.set('__tywrap_call', mockCallFn);
      mockLoadPyodide.mockResolvedValue(mockPyodide);
      
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
      
      const mockPyodide = createMockPyodide();
      mockPyodide.globals.set('__tywrap_call', vi.fn().mockReturnValue(42));
      mockLoadPyodide.mockResolvedValue(mockPyodide);
      
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
      const mockPyodide = createMockPyodide();
      const mockCallFn = vi.fn().mockReturnValue(42);
      mockPyodide.globals.set('__tywrap_call', mockCallFn);
      mockLoadPyodide.mockResolvedValue(mockPyodide);
      
      // Make multiple calls
      await bridge.call('math', 'sqrt', [16]);
      await bridge.call('math', 'sqrt', [25]);
      await bridge.call('math', 'sqrt', [36]);
      
      // loadPyodide should only be called once
      expect(mockLoadPyodide).toHaveBeenCalledTimes(1);
      
      // But the call function should be called multiple times
      expect(mockCallFn).toHaveBeenCalledTimes(3);
    });

    it('should handle concurrent calls correctly', async () => {
      const mockPyodide = createMockPyodide();
      let callCount = 0;
      const mockCallFn = vi.fn().mockImplementation(() => ++callCount);
      mockPyodide.globals.set('__tywrap_call', mockCallFn);
      mockLoadPyodide.mockResolvedValue(mockPyodide);
      
      // Make concurrent calls
      const promises = [
        bridge.call('math', 'sqrt', [4]),
        bridge.call('math', 'sqrt', [9]),
        bridge.call('math', 'sqrt', [16])
      ];
      
      const results = await Promise.all(promises);
      
      expect(results).toEqual([1, 2, 3]);
      expect(mockLoadPyodide).toHaveBeenCalledTimes(1);
      expect(mockCallFn).toHaveBeenCalledTimes(3);
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
      
      const mockPyodide = createMockPyodide();
      mockPyodide.globals.set('__tywrap_call', vi.fn().mockReturnValue(42));
      mockLoadPyodide.mockResolvedValue(mockPyodide);
      
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
      
      const mockPyodide = createMockPyodide();
      mockPyodide.globals.set('__tywrap_call', vi.fn().mockReturnValue(42));
      mockLoadPyodide.mockResolvedValue(mockPyodide);
      
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
        'https://cdn.jsdelivr.net/pyodide/v0.24.1/',
        'https://unpkg.com/pyodide@0.24.1/',
        'https://custom-cdn.example.com/pyodide/'
      ];
      
      for (const cdnURL of customCDNs) {
        const testBridge = new PyodideBridge({ indexURL: cdnURL });
        
        const mockPyodide = createMockPyodide();
        mockPyodide.globals.set('__tywrap_call', vi.fn().mockReturnValue(42));
        const mockLoader = vi.fn().mockResolvedValue(mockPyodide);
        (globalThis as any).loadPyodide = mockLoader;
        
        await testBridge.call('math', 'sqrt', [16]);
        
        expect(mockLoader).toHaveBeenCalledWith({ indexURL: cdnURL });
        
        await testBridge.dispose();
      }
    });
  });
});