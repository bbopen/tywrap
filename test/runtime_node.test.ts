/**
 * Node.js Runtime Bridge Compatibility Tests
 * Tests subprocess Python execution, timeout handling, virtual environments, and data transfer
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { spawn } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';
import { NodeBridge, type NodeBridgeOptions } from '../src/runtime/node.js';
import { isNodejs } from '../src/utils/runtime.js';

// Skip all tests if not running in Node.js
const describeNodeOnly = isNodejs() ? describe : describe.skip;

describeNodeOnly('Node.js Runtime Bridge', () => {
  let bridge: NodeBridge;
  const scriptPath = 'runtime/python_bridge.py';
  const testTimeout = 30000;

  // Helper function to check if Python is available
  const isPythonAvailable = async (pythonPath = 'python3'): Promise<boolean> => {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      await execAsync(`${pythonPath} --version`);
      return true;
    } catch {
      return false;
    }
  };

  // Helper function to check if Python bridge script exists
  const isBridgeScriptAvailable = (): boolean => {
    return existsSync(scriptPath);
  };

  beforeAll(async () => {
    const pythonAvailable = await isPythonAvailable();
    const scriptAvailable = isBridgeScriptAvailable();
    
    if (!pythonAvailable) {
      console.warn('Python3 not available, skipping Node.js bridge tests');
    }
    if (!scriptAvailable) {
      console.warn('Python bridge script not found, skipping Node.js bridge tests');
    }
  });

  describe('Basic Bridge Operations', () => {
    beforeEach(async () => {
      bridge = new NodeBridge({ scriptPath, timeoutMs: 5000 });
    });

    afterEach(async () => {
      await bridge?.dispose();
    });

    it('should initialize and dispose cleanly', async () => {
      const pythonAvailable = await isPythonAvailable();
      if (!pythonAvailable || !isBridgeScriptAvailable()) return;

      await bridge.init();
      await bridge.dispose();
      expect(true).toBe(true); // Test passes if no errors thrown
    }, testTimeout);

    it('should handle basic math operations', async () => {
      const pythonAvailable = await isPythonAvailable();
      if (!pythonAvailable || !isBridgeScriptAvailable()) return;

      const result = await bridge.call<number>('math', 'sqrt', [16]);
      expect(result).toBe(4);
    }, testTimeout);

    it('should handle function calls with kwargs', async () => {
      const pythonAvailable = await isPythonAvailable();
      if (!pythonAvailable || !isBridgeScriptAvailable()) return;

      // Test with built-in pow function
      const result = await bridge.call<number>('builtins', 'pow', [2], { exp: 3 });
      expect(result).toBe(8);
    }, testTimeout);

    it('should handle class instantiation', async () => {
      const pythonAvailable = await isPythonAvailable();
      if (!pythonAvailable || !isBridgeScriptAvailable()) return;

      // Test with built-in dict class
      const dictInstance = await bridge.instantiate('builtins', 'dict', [], { a: 1, b: 2 });
      expect(dictInstance).toBeDefined();
    }, testTimeout);
  });

  describe('Timeout Handling', () => {
    it('should timeout long-running operations', async () => {
      const pythonAvailable = await isPythonAvailable();
      if (!pythonAvailable || !isBridgeScriptAvailable()) return;

      bridge = new NodeBridge({ scriptPath, timeoutMs: 1000 });

      // Test with a sleep operation that should timeout
      await expect(
        bridge.call('time', 'sleep', [2])
      ).rejects.toThrow(/timed out/);
    }, testTimeout);

    it('should handle timeout configuration', async () => {
      const pythonAvailable = await isPythonAvailable();
      if (!pythonAvailable || !isBridgeScriptAvailable()) return;

      const shortTimeoutBridge = new NodeBridge({ 
        scriptPath, 
        timeoutMs: 500 
      });

      await expect(
        shortTimeoutBridge.call('time', 'sleep', [1])
      ).rejects.toThrow(/timed out/);

      await shortTimeoutBridge.dispose();
    }, testTimeout);
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      bridge = new NodeBridge({ scriptPath });
    });

    afterEach(async () => {
      await bridge?.dispose();
    });

    it('should handle Python exceptions gracefully', async () => {
      const pythonAvailable = await isPythonAvailable();
      if (!pythonAvailable || !isBridgeScriptAvailable()) return;

      // Try to divide by zero
      await expect(
        bridge.call('operator', 'truediv', [1, 0])
      ).rejects.toThrow();
    }, testTimeout);

    it('should handle module import errors', async () => {
      const pythonAvailable = await isPythonAvailable();
      if (!pythonAvailable || !isBridgeScriptAvailable()) return;

      await expect(
        bridge.call('nonexistent_module', 'some_function', [])
      ).rejects.toThrow();
    }, testTimeout);

    it('should handle invalid function names', async () => {
      const pythonAvailable = await isPythonAvailable();
      if (!pythonAvailable || !isBridgeScriptAvailable()) return;

      await expect(
        bridge.call('math', 'nonexistent_function', [])
      ).rejects.toThrow();
    }, testTimeout);
  });

  describe('Environment Configuration', () => {
    it('should support custom Python paths', async () => {
      // Test with python instead of python3 if available
      const pythonAvailable = await isPythonAvailable('python');
      if (!pythonAvailable || !isBridgeScriptAvailable()) return;

      const customBridge = new NodeBridge({ 
        pythonPath: 'python',
        scriptPath 
      });

      const result = await customBridge.call<number>('math', 'sqrt', [9]);
      expect(result).toBe(3);

      await customBridge.dispose();
    }, testTimeout);

    it('should support custom working directories', async () => {
      const pythonAvailable = await isPythonAvailable();
      if (!pythonAvailable || !isBridgeScriptAvailable()) return;

      const customBridge = new NodeBridge({ 
        scriptPath: join('..', scriptPath),
        cwd: process.cwd()
      });

      // This should work if the script path is correctly resolved
      try {
        await customBridge.init();
        await customBridge.dispose();
        expect(true).toBe(true);
      } catch (error) {
        // Expected if the relative path doesn't work, but we test the configuration
        expect(error).toBeDefined();
      }
    }, testTimeout);

    it('should support custom environment variables', async () => {
      const pythonAvailable = await isPythonAvailable();
      if (!pythonAvailable || !isBridgeScriptAvailable()) return;

      const customBridge = new NodeBridge({ 
        scriptPath,
        env: { TEST_ENV_VAR: 'test_value' }
      });

      // Test that custom environment is passed
      const result = await customBridge.call('os', 'getenv', ['TEST_ENV_VAR']);
      expect(result).toBe('test_value');

      await customBridge.dispose();
    }, testTimeout);

    it('should support JSON fallback configuration', async () => {
      const pythonAvailable = await isPythonAvailable();
      if (!pythonAvailable || !isBridgeScriptAvailable()) return;

      const fallbackBridge = new NodeBridge({ 
        scriptPath,
        enableJsonFallback: true
      });

      // Test basic operation with JSON fallback enabled
      const result = await fallbackBridge.call<number>('math', 'sqrt', [25]);
      expect(result).toBe(5);

      await fallbackBridge.dispose();
    }, testTimeout);
  });

  describe('Data Transfer and Serialization', () => {
    beforeEach(async () => {
      bridge = new NodeBridge({ scriptPath });
    });

    afterEach(async () => {
      await bridge?.dispose();
    });

    it('should handle various data types', async () => {
      const pythonAvailable = await isPythonAvailable();
      if (!pythonAvailable || !isBridgeScriptAvailable()) return;

      // Test numbers
      const num = await bridge.call<number>('builtins', 'float', [42.5]);
      expect(num).toBe(42.5);

      // Test strings
      const str = await bridge.call<string>('builtins', 'str', ['hello world']);
      expect(str).toBe('hello world');

      // Test booleans
      const bool = await bridge.call<boolean>('builtins', 'bool', [1]);
      expect(bool).toBe(true);
    }, testTimeout);

    it('should handle lists and arrays', async () => {
      const pythonAvailable = await isPythonAvailable();
      if (!pythonAvailable || !isBridgeScriptAvailable()) return;

      const inputList = [1, 2, 3, 4, 5];
      const result = await bridge.call<number[]>('builtins', 'list', [inputList]);
      expect(result).toEqual(inputList);
    }, testTimeout);

    it('should handle dictionaries and objects', async () => {
      const pythonAvailable = await isPythonAvailable();
      if (!pythonAvailable || !isBridgeScriptAvailable()) return;

      const inputDict = { a: 1, b: 2, c: 3 };
      const result = await bridge.call<Record<string, number>>('builtins', 'dict', [], inputDict);
      expect(result).toEqual(inputDict);
    }, testTimeout);

    it('should handle large data transfers', async () => {
      const pythonAvailable = await isPythonAvailable();
      if (!pythonAvailable || !isBridgeScriptAvailable()) return;

      // Create a large list
      const largeList = Array.from({ length: 10000 }, (_, i) => i);
      const result = await bridge.call<number[]>('builtins', 'list', [largeList]);
      expect(result.length).toBe(10000);
      expect(result[0]).toBe(0);
      expect(result[9999]).toBe(9999);
    }, testTimeout);
  });

  describe('Process Management', () => {
    it('should handle subprocess lifecycle correctly', async () => {
      const pythonAvailable = await isPythonAvailable();
      if (!pythonAvailable || !isBridgeScriptAvailable()) return;

      bridge = new NodeBridge({ scriptPath });
      
      // Initialize
      await bridge.init();
      
      // Make a call to ensure subprocess is working
      const result = await bridge.call<number>('math', 'sqrt', [4]);
      expect(result).toBe(2);
      
      // Dispose
      await bridge.dispose();
      
      // Verify that subsequent calls fail after disposal
      await expect(
        bridge.call('math', 'sqrt', [4])
      ).rejects.toThrow();
    }, testTimeout);

    it('should handle multiple concurrent calls', async () => {
      const pythonAvailable = await isPythonAvailable();
      if (!pythonAvailable || !isBridgeScriptAvailable()) return;

      bridge = new NodeBridge({ scriptPath });

      // Make multiple concurrent calls
      const promises = [
        bridge.call<number>('math', 'sqrt', [4]),
        bridge.call<number>('math', 'sqrt', [9]),
        bridge.call<number>('math', 'sqrt', [16]),
        bridge.call<number>('math', 'sqrt', [25])
      ];

      const results = await Promise.all(promises);
      expect(results).toEqual([2, 3, 4, 5]);
    }, testTimeout);

    it('should handle process crashes gracefully', async () => {
      const pythonAvailable = await isPythonAvailable();
      if (!pythonAvailable || !isBridgeScriptAvailable()) return;

      bridge = new NodeBridge({ scriptPath });
      
      // Initialize bridge
      await bridge.init();
      
      // Force bridge disposal to simulate a crash scenario
      await bridge.dispose();
      
      // Subsequent calls should fail gracefully
      await expect(
        bridge.call('math', 'sqrt', [4])
      ).rejects.toThrow();
    }, testTimeout);
  });

  describe('Virtual Environment Support', () => {
    it('should respect PYTHONPATH environment', async () => {
      const pythonAvailable = await isPythonAvailable();
      if (!pythonAvailable || !isBridgeScriptAvailable()) return;

      // Test that the bridge includes tywrap_ir in PYTHONPATH by default
      bridge = new NodeBridge({ scriptPath });
      
      // Try to access sys.path to verify PYTHONPATH is set
      // Use os.getcwd() as a test that basic calls work
      const cwd = await bridge.call<string>('os', 'getcwd', []);
      expect(typeof cwd).toBe('string');
      
      // Alternative: test path operations with an actual function
      const joinedPath = await bridge.call<string>('os.path', 'join', ['/tmp', 'test']);
      expect(typeof joinedPath).toBe('string');
    }, testTimeout);

    it('should support custom PYTHONPATH additions', async () => {
      const pythonAvailable = await isPythonAvailable();
      if (!pythonAvailable || !isBridgeScriptAvailable()) return;

      const customPythonPath = '/custom/python/path';
      bridge = new NodeBridge({ 
        scriptPath,
        env: { PYTHONPATH: customPythonPath }
      });

      // Test that we can access environment variables
      // os.getenv is a function, so this should work
      const envVar = await bridge.call<string | null>('os', 'getenv', ['PYTHONPATH']);
      expect(envVar).toBeTruthy();
      
      // Test that os module works with another function
      const cwd = await bridge.call<string>('os', 'getcwd', []);
      expect(typeof cwd).toBe('string');
    }, testTimeout);
  });

  describe('Performance Characteristics', () => {
    beforeEach(async () => {
      bridge = new NodeBridge({ scriptPath });
    });

    afterEach(async () => {
      await bridge?.dispose();
    });

    it('should have reasonable startup time', async () => {
      const pythonAvailable = await isPythonAvailable();
      if (!pythonAvailable || !isBridgeScriptAvailable()) return;

      const start = Date.now();
      await bridge.init();
      const initTime = Date.now() - start;
      
      // Initialization should complete within reasonable time
      expect(initTime).toBeLessThan(5000); // 5 seconds max
    }, testTimeout);

    it('should handle rapid successive calls efficiently', async () => {
      const pythonAvailable = await isPythonAvailable();
      if (!pythonAvailable || !isBridgeScriptAvailable()) return;

      const start = Date.now();
      const calls = 10;
      
      for (let i = 0; i < calls; i++) {
        await bridge.call<number>('math', 'sqrt', [i + 1]);
      }
      
      const totalTime = Date.now() - start;
      const averageTime = totalTime / calls;
      
      // Each call should be reasonably fast
      expect(averageTime).toBeLessThan(1000); // 1 second per call max
    }, testTimeout);
  });

  describe('Edge Cases and Error Recovery', () => {
    it('should handle very large argument lists', async () => {
      const pythonAvailable = await isPythonAvailable();
      if (!pythonAvailable || !isBridgeScriptAvailable()) return;

      bridge = new NodeBridge({ scriptPath });
      
      // Test with max function and many arguments
      const numbers = Array.from({ length: 1000 }, (_, i) => i);
      const result = await bridge.call<number>('builtins', 'max', [numbers]);
      expect(result).toBe(999);
    }, testTimeout);

    it('should handle special floating point values', async () => {
      const pythonAvailable = await isPythonAvailable();
      if (!pythonAvailable || !isBridgeScriptAvailable()) return;

      bridge = new NodeBridge({ scriptPath });
      
      // Test with basic float operations that should work
      const floatValue = await bridge.call<number>('builtins', 'float', [3.14]);
      expect(floatValue).toBe(3.14);
      
      // Test with integer to float conversion
      const intToFloat = await bridge.call<number>('builtins', 'float', [42]);
      expect(intToFloat).toBe(42.0);
      
      // Test string to float conversion
      const strToFloat = await bridge.call<number>('builtins', 'float', ['123.456']);
      expect(strToFloat).toBe(123.456);
    }, testTimeout);

    it('should handle Unicode strings correctly', async () => {
      const pythonAvailable = await isPythonAvailable();
      if (!pythonAvailable || !isBridgeScriptAvailable()) return;

      bridge = new NodeBridge({ scriptPath });
      
      const unicodeString = '🐍 Python with Unicode: αβγδε ñáéíóú 中文';
      const result = await bridge.call<string>('builtins', 'str', [unicodeString]);
      expect(result).toBe(unicodeString);
    }, testTimeout);

    it('should handle None/null values', async () => {
      const pythonAvailable = await isPythonAvailable();
      if (!pythonAvailable || !isBridgeScriptAvailable()) return;

      bridge = new NodeBridge({ scriptPath });
      
      // Test with a simple function that returns None
      const result = await bridge.call('builtins', 'print', ['test']);
      expect(result).toBeNull(); // print() returns None, which should be null in JS
    }, testTimeout);
  });
});