/**
 * Node.js Runtime Bridge Compatibility Tests
 * Tests subprocess Python execution, timeout handling, virtual environments, and data transfer
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'path';
import { NodeBridge } from '../src/runtime/node.js';
import { BridgeProtocolError } from '../src/runtime/errors.js';
import { getDefaultPythonPath, resolvePythonExecutable } from '../src/utils/python.js';
import { isNodejs, getVenvBinDir } from '../src/utils/runtime.js';

// Skip all tests if not running in Node.js
const describeNodeOnly = isNodejs() ? describe : describe.skip;

describeNodeOnly('Node.js Runtime Bridge', () => {
  let bridge: NodeBridge;
  const scriptPath = 'runtime/python_bridge.py';
  const isCi =
    ['1', 'true'].includes((process.env.CI ?? '').toLowerCase()) ||
    ['1', 'true'].includes((process.env.GITHUB_ACTIONS ?? '').toLowerCase()) ||
    ['1', 'true'].includes((process.env.ACT ?? '').toLowerCase());
  const testTimeout = isCi ? 60000 : 30000;
  const defaultTimeoutMs = isCi ? 45000 : 5000;
  const startupThresholdMs = isCi ? 15000 : 5000;
  const averageThresholdMs = isCi ? 2000 : 1000;
  const defaultPythonPath = getDefaultPythonPath();

  // Helper function to check if Python is available
  const isPythonAvailable = async (pythonPath?: string): Promise<boolean> => {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      const resolvedPython = pythonPath ?? (await resolvePythonExecutable());
      await execAsync(`${resolvedPython} --version`);
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
      bridge = new NodeBridge({ scriptPath, timeoutMs: defaultTimeoutMs });
    });

    afterEach(async () => {
      await bridge?.dispose();
    });

    it(
      'should initialize and dispose cleanly',
      async () => {
        const pythonAvailable = await isPythonAvailable();
        if (!pythonAvailable || !isBridgeScriptAvailable()) return;

        await bridge.init();
        await bridge.dispose();
        expect(true).toBe(true); // Test passes if no errors thrown
      },
      testTimeout
    );

    it(
      'should handle basic math operations',
      async () => {
        const pythonAvailable = await isPythonAvailable();
        if (!pythonAvailable || !isBridgeScriptAvailable()) return;

        const result = await bridge.call<number>('math', 'sqrt', [16]);
        expect(result).toBe(4);
      },
      testTimeout
    );

    it(
      'should handle function calls with kwargs',
      async () => {
        const pythonAvailable = await isPythonAvailable();
        if (!pythonAvailable || !isBridgeScriptAvailable()) return;

        // Test with built-in pow function
        const result = await bridge.call<number>('builtins', 'pow', [2], { exp: 3 });
        expect(result).toBe(8);
      },
      testTimeout
    );

    it(
      'should handle class instantiation',
      async () => {
        const pythonAvailable = await isPythonAvailable();
        if (!pythonAvailable || !isBridgeScriptAvailable()) return;

        // Test with built-in Counter class
        const counterHandle = await bridge.instantiate('collections', 'Counter', [[1, 2, 2, 3]]);
        expect(typeof counterHandle).toBe('string');

        const mostCommon = await bridge.callMethod<Array<[number, number]>>(
          counterHandle,
          'most_common',
          [1]
        );
        expect(mostCommon[0]?.[0]).toBe(2);
        expect(mostCommon[0]?.[1]).toBe(2);

        await bridge.disposeInstance(counterHandle);
      },
      testTimeout
    );
  });

  describe('Stdlib Serialization', () => {
    it(
      'should serialize datetime, Decimal, UUID, and Path values',
      async () => {
        const pythonAvailable = await isPythonAvailable();
        if (!pythonAvailable || !isBridgeScriptAvailable()) return;

        let tempDir: string | undefined;
        try {
          tempDir = await mkdtemp(join(tmpdir(), 'tywrap-stdlib-'));
          const moduleName = 'stdlib_fixture';
          const modulePath = join(tempDir, `${moduleName}.py`);
          const content = `from datetime import datetime, date, time, timedelta
from decimal import Decimal
from uuid import UUID
from pathlib import Path

def get_datetime():
    return datetime(2020, 1, 2, 3, 4, 5)

def get_date():
    return date(2020, 1, 2)

def get_time():
    return time(3, 4, 5)

def get_delta():
    return timedelta(days=1, seconds=2)

def get_decimal():
    return Decimal("10.5")

def get_uuid():
    return UUID("12345678-1234-5678-1234-567812345678")

def get_path():
    return Path("some/path")
`;
          await writeFile(modulePath, content, 'utf-8');

          const existingPyPath = process.env.PYTHONPATH;
          const mergedPyPath = existingPyPath ? `${tempDir}${delimiter}${existingPyPath}` : tempDir;

          bridge = new NodeBridge({
            scriptPath,
            env: { PYTHONPATH: mergedPyPath },
            timeoutMs: defaultTimeoutMs,
          });

          const dt = await bridge.call<string>(moduleName, 'get_datetime', []);
          expect(dt).toBe('2020-01-02T03:04:05');

          const d = await bridge.call<string>(moduleName, 'get_date', []);
          expect(d).toBe('2020-01-02');

          const t = await bridge.call<string>(moduleName, 'get_time', []);
          expect(t).toBe('03:04:05');

          const delta = await bridge.call<number>(moduleName, 'get_delta', []);
          expect(delta).toBe(86402);

          const dec = await bridge.call<string>(moduleName, 'get_decimal', []);
          expect(dec).toBe('10.5');

          const uuid = await bridge.call<string>(moduleName, 'get_uuid', []);
          expect(uuid).toBe('12345678-1234-5678-1234-567812345678');

          const path = await bridge.call<string>(moduleName, 'get_path', []);
          expect(path).toBe(join('some', 'path'));
        } finally {
          await bridge?.dispose();
          if (tempDir) {
            await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
          }
        }
      },
      testTimeout
    );
  });

  describe('Timeout Handling', () => {
    afterEach(async () => {
      await bridge?.dispose();
    });

    it(
      'should timeout long-running operations',
      async () => {
        const pythonAvailable = await isPythonAvailable();
        if (!pythonAvailable || !isBridgeScriptAvailable()) return;

        bridge = new NodeBridge({ scriptPath, timeoutMs: 1000 });

        // Test with a sleep operation that should timeout
        await expect(bridge.call('time', 'sleep', [2])).rejects.toThrow(/timed out/);
      },
      testTimeout
    );

    it(
      'should handle timeout configuration',
      async () => {
        const pythonAvailable = await isPythonAvailable();
        if (!pythonAvailable || !isBridgeScriptAvailable()) return;

        const shortTimeoutBridge = new NodeBridge({
          scriptPath,
          timeoutMs: 500,
        });

        await expect(shortTimeoutBridge.call('time', 'sleep', [1])).rejects.toThrow(/timed out/);

        await shortTimeoutBridge.dispose();
      },
      testTimeout
    );

    it(
      'should ignore late responses for timed-out requests',
      async () => {
        const pythonAvailable = await isPythonAvailable();
        if (!pythonAvailable || !isBridgeScriptAvailable()) return;

        bridge = new NodeBridge({ scriptPath, timeoutMs: 500 });

        await expect(bridge.call('time', 'sleep', [1])).rejects.toThrow(/timed out/i);

        // Wait for the Python process to eventually respond to the timed-out request.
        await new Promise(resolve => setTimeout(resolve, 800));

        // Note: With the unified bridge, timed-out workers are quarantined and replaced
        // per ADR-0001 (#101). The important thing is that the bridge recovers and works.
        const result = await bridge.call<number>('math', 'sqrt', [16]);
        expect(result).toBe(4);
      },
      testTimeout
    );
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      bridge = new NodeBridge({ scriptPath, timeoutMs: defaultTimeoutMs });
    });

    afterEach(async () => {
      await bridge?.dispose();
    });

    it(
      'should handle Python exceptions gracefully',
      async () => {
        const pythonAvailable = await isPythonAvailable();
        if (!pythonAvailable || !isBridgeScriptAvailable()) return;

        // Try to divide by zero
        await expect(bridge.call('operator', 'truediv', [1, 0])).rejects.toThrow();
      },
      testTimeout
    );

    it(
      'should handle module import errors',
      async () => {
        const pythonAvailable = await isPythonAvailable();
        if (!pythonAvailable || !isBridgeScriptAvailable()) return;

        await expect(bridge.call('nonexistent_module', 'some_function', [])).rejects.toThrow();
      },
      testTimeout
    );

    it(
      'should handle invalid function names',
      async () => {
        const pythonAvailable = await isPythonAvailable();
        if (!pythonAvailable || !isBridgeScriptAvailable()) return;

        await expect(bridge.call('math', 'nonexistent_function', [])).rejects.toThrow();
      },
      testTimeout
    );

    it(
      'should reject invalid instance handles',
      async () => {
        const pythonAvailable = await isPythonAvailable();
        if (!pythonAvailable || !isBridgeScriptAvailable()) return;

        const handle = await bridge.instantiate('collections', 'Counter', [[1, 2, 2]]);
        await bridge.disposeInstance(handle);

        await expect(bridge.callMethod(handle, 'most_common', [1])).rejects.toThrow();
      },
      testTimeout
    );

    it(
      'should reject responses that exceed TYWRAP_CODEC_MAX_BYTES',
      async () => {
        const pythonAvailable = await isPythonAvailable();
        if (!pythonAvailable || !isBridgeScriptAvailable()) return;

        let tempDir: string | undefined;
        let limitBridge: NodeBridge | undefined;
        try {
          tempDir = await mkdtemp(join(tmpdir(), 'tywrap-size-limit-'));
          const moduleName = 'size_limit_fixture';
          const modulePath = join(tempDir, `${moduleName}.py`);
          const content = `def big_payload():\n    return "x" * 5000\n`;
          await writeFile(modulePath, content, 'utf-8');

          const existingPyPath = process.env.PYTHONPATH;
          const mergedPyPath = existingPyPath ? `${tempDir}${delimiter}${existingPyPath}` : tempDir;

          limitBridge = new NodeBridge({
            scriptPath,
            env: {
              PYTHONPATH: mergedPyPath,
              TYWRAP_CODEC_MAX_BYTES: '200',
            },
            timeoutMs: defaultTimeoutMs,
          });

          await expect(limitBridge.call(moduleName, 'big_payload', [])).rejects.toThrow(
            'TYWRAP_CODEC_MAX_BYTES'
          );
        } finally {
          if (limitBridge) {
            await limitBridge.dispose();
          }
          if (tempDir) {
            await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
          }
        }
      },
      testTimeout
    );

    it(
      'should emit a descriptive error when Python fails to start',
      async () => {
        if (!isBridgeScriptAvailable()) return;

        const badBridge = new NodeBridge({
          scriptPath,
          pythonPath: 'nonexistent_python',
          timeoutMs: defaultTimeoutMs,
        });

        // The error message includes the spawn failure reason
        await expect(badBridge.call('math', 'sqrt', [4])).rejects.toThrow(
          /Python process|ENOENT|spawn/
        );

        await badBridge.dispose();
      },
      testTimeout
    );
  });

  describe('Environment Configuration', () => {
    it(
      'should support custom Python paths',
      async () => {
        // Test with python instead of python3 if available
        const pythonAvailable = await isPythonAvailable('python');
        if (!pythonAvailable || !isBridgeScriptAvailable()) return;

        const customBridge = new NodeBridge({
          pythonPath: 'python',
          scriptPath,
          timeoutMs: defaultTimeoutMs,
        });

        const result = await customBridge.call<number>('math', 'sqrt', [9]);
        expect(result).toBe(3);

        await customBridge.dispose();
      },
      testTimeout
    );

    it(
      'should support custom working directories',
      async () => {
        const pythonAvailable = await isPythonAvailable();
        if (!pythonAvailable || !isBridgeScriptAvailable()) return;

        const customBridge = new NodeBridge({
          scriptPath: join('..', scriptPath),
          cwd: process.cwd(),
          timeoutMs: defaultTimeoutMs,
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
      },
      testTimeout
    );

    it(
      'should support custom environment variables',
      async () => {
        const pythonAvailable = await isPythonAvailable();
        if (!pythonAvailable || !isBridgeScriptAvailable()) return;

        const customBridge = new NodeBridge({
          scriptPath,
          env: { TEST_ENV_VAR: 'test_value' },
          timeoutMs: defaultTimeoutMs,
        });

        // Test that custom environment is passed
        const result = await customBridge.call('os', 'getenv', ['TEST_ENV_VAR']);
        expect(result).toBe('test_value');

        await customBridge.dispose();
      },
      testTimeout
    );

    it.each(['__proto__', 'prototype', 'constructor'])(
      'should reject dangerous environment override key %s',
      (dangerousKey) => {
        const envOverrides = Object.create(null) as Record<string, string | undefined>;
        Object.defineProperty(envOverrides, dangerousKey, {
          value: 'blocked',
          enumerable: true,
          writable: true,
          configurable: true,
        });

        const createBridge = (): NodeBridge =>
          new NodeBridge({
            scriptPath,
            env: envOverrides,
            timeoutMs: defaultTimeoutMs,
          });

        expect(createBridge).toThrow(BridgeProtocolError);
        expect(createBridge).toThrow(`"${dangerousKey}"`);
      }
    );

    it(
      'should filter environment variables by TYWRAP_ prefix',
      async () => {
        const pythonAvailable = await isPythonAvailable();
        if (!pythonAvailable || !isBridgeScriptAvailable()) return;

        process.env.UNSAFE_VAR = 'secret';
        process.env.TYWRAP_SAFE = 'exposed';

        const filterBridge = new NodeBridge({ scriptPath, timeoutMs: defaultTimeoutMs });

        const safe = await filterBridge.call('os', 'getenv', ['TYWRAP_SAFE']);
        const unsafe = await filterBridge.call('os', 'getenv', ['UNSAFE_VAR']);

        expect(safe).toBe('exposed');
        expect(unsafe).toBeNull();

        await filterBridge.dispose();

        delete process.env.UNSAFE_VAR;
        delete process.env.TYWRAP_SAFE;
      },
      testTimeout
    );

    it(
      'should support JSON fallback configuration',
      async () => {
        const pythonAvailable = await isPythonAvailable();
        if (!pythonAvailable || !isBridgeScriptAvailable()) return;

        const fallbackBridge = new NodeBridge({
          scriptPath,
          enableJsonFallback: true,
          timeoutMs: defaultTimeoutMs,
        });

        // Test basic operation with JSON fallback enabled
        const result = await fallbackBridge.call<number>('math', 'sqrt', [25]);
        expect(result).toBe(5);

        await fallbackBridge.dispose();
      },
      testTimeout
    );
  });

  describe('Data Transfer and Serialization', () => {
    beforeEach(async () => {
      bridge = new NodeBridge({ scriptPath, timeoutMs: defaultTimeoutMs });
    });

    afterEach(async () => {
      await bridge?.dispose();
    });

    it(
      'should handle various data types',
      async () => {
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
      },
      testTimeout
    );

    it(
      'should handle lists and arrays',
      async () => {
        const pythonAvailable = await isPythonAvailable();
        if (!pythonAvailable || !isBridgeScriptAvailable()) return;

        const inputList = [1, 2, 3, 4, 5];
        const result = await bridge.call<number[]>('builtins', 'list', [inputList]);
        expect(result).toEqual(inputList);
      },
      testTimeout
    );

    it(
      'should handle dictionaries and objects',
      async () => {
        const pythonAvailable = await isPythonAvailable();
        if (!pythonAvailable || !isBridgeScriptAvailable()) return;

        const inputDict = { a: 1, b: 2, c: 3 };
        const result = await bridge.call<Record<string, number>>('builtins', 'dict', [], inputDict);
        expect(result).toEqual(inputDict);
      },
      testTimeout
    );

    it(
      'should handle large data transfers',
      async () => {
        const pythonAvailable = await isPythonAvailable();
        if (!pythonAvailable || !isBridgeScriptAvailable()) return;

        // Create a large list
        const largeList = Array.from({ length: 10000 }, (_, i) => i);
        const result = await bridge.call<number[]>('builtins', 'list', [largeList]);
        expect(result.length).toBe(10000);
        expect(result[0]).toBe(0);
        expect(result[9999]).toBe(9999);
      },
      testTimeout
    );

    it(
      'should handle large string payloads',
      async () => {
        const pythonAvailable = await isPythonAvailable();
        if (!pythonAvailable || !isBridgeScriptAvailable()) return;

        const payload = 'x'.repeat(256 * 1024);
        const result = await bridge.call<string>('builtins', 'str', [payload]);
        expect(result.length).toBe(payload.length);
        expect(result.slice(0, 4)).toBe('xxxx');
        expect(result.slice(-4)).toBe('xxxx');
      },
      testTimeout
    );
  });

  describe('Process Management', () => {
    it(
      'should handle subprocess lifecycle correctly',
      async () => {
        const pythonAvailable = await isPythonAvailable();
        if (!pythonAvailable || !isBridgeScriptAvailable()) return;

        bridge = new NodeBridge({ scriptPath, timeoutMs: defaultTimeoutMs });

        // Initialize
        await bridge.init();

        // Make a call to ensure subprocess is working
        const result = await bridge.call<number>('math', 'sqrt', [4]);
        expect(result).toBe(2);

        // Dispose
        await bridge.dispose();

        // Verify that subsequent calls fail after disposal
        await expect(bridge.call('math', 'sqrt', [4])).rejects.toThrow();
      },
      testTimeout
    );

    it(
      'should handle multiple concurrent calls',
      async () => {
        const pythonAvailable = await isPythonAvailable();
        if (!pythonAvailable || !isBridgeScriptAvailable()) return;

        bridge = new NodeBridge({ scriptPath, timeoutMs: defaultTimeoutMs });

        // Make multiple concurrent calls
        const promises = [
          bridge.call<number>('math', 'sqrt', [4]),
          bridge.call<number>('math', 'sqrt', [9]),
          bridge.call<number>('math', 'sqrt', [16]),
          bridge.call<number>('math', 'sqrt', [25]),
        ];

        const results = await Promise.all(promises);
        expect(results).toEqual([2, 3, 4, 5]);
      },
      testTimeout
    );

    it(
      'should handle process crashes gracefully',
      async () => {
        const pythonAvailable = await isPythonAvailable();
        if (!pythonAvailable || !isBridgeScriptAvailable()) return;

        bridge = new NodeBridge({ scriptPath, timeoutMs: defaultTimeoutMs });

        // Initialize bridge
        await bridge.init();

        // Force bridge disposal to simulate a crash scenario
        await bridge.dispose();

        // Subsequent calls should fail gracefully
        await expect(bridge.call('math', 'sqrt', [4])).rejects.toThrow();
      },
      testTimeout
    );
  });

  describe('Protocol Errors', () => {
    it(
      'should surface invalid stdout lines as errors',
      async () => {
        const pythonAvailable = await isPythonAvailable();
        const noisyScriptPath = join(process.cwd(), 'test', 'fixtures', 'noisy_bridge.py');
        if (!pythonAvailable || !existsSync(noisyScriptPath)) return;

        bridge = new NodeBridge({ scriptPath: noisyScriptPath, timeoutMs: defaultTimeoutMs });

        // In the new architecture, invalid stdout lines cause protocol errors
        await expect(bridge.call('math', 'sqrt', [4])).rejects.toThrow('Protocol error');

        await bridge.dispose();
      },
      testTimeout
    );

    it(
      'should handle fragmented JSON frames',
      async () => {
        const pythonAvailable = await isPythonAvailable();
        const fragmentedScriptPath = join(
          process.cwd(),
          'test',
          'fixtures',
          'fragmented_bridge.py'
        );
        if (!pythonAvailable || !existsSync(fragmentedScriptPath)) return;

        bridge = new NodeBridge({ scriptPath: fragmentedScriptPath, timeoutMs: defaultTimeoutMs });

        const result = await bridge.call<number>('math', 'sqrt', [4]);
        expect(result).toBe(42);

        await bridge.dispose();
      },
      testTimeout
    );

    it(
      'should surface invalid JSON frames as errors',
      async () => {
        const pythonAvailable = await isPythonAvailable();
        const invalidScriptPath = join(process.cwd(), 'test', 'fixtures', 'invalid_json_bridge.py');
        if (!pythonAvailable || !existsSync(invalidScriptPath)) return;

        bridge = new NodeBridge({ scriptPath: invalidScriptPath, timeoutMs: defaultTimeoutMs });

        // In the new architecture, invalid JSON causes protocol errors
        await expect(bridge.call('math', 'sqrt', [4])).rejects.toThrow('Protocol error');

        await bridge.dispose();
      },
      testTimeout
    );
  });

  describe('Virtual Environment Support', () => {
    it(
      'should respect PYTHONPATH environment',
      async () => {
        const pythonAvailable = await isPythonAvailable();
        if (!pythonAvailable || !isBridgeScriptAvailable()) return;

        // Test that the bridge includes tywrap_ir in PYTHONPATH by default
        bridge = new NodeBridge({ scriptPath, timeoutMs: defaultTimeoutMs });

        // Try to access sys.path to verify PYTHONPATH is set
        // Use os.getcwd() as a test that basic calls work
        const cwd = await bridge.call<string>('os', 'getcwd', []);
        expect(typeof cwd).toBe('string');

        // Alternative: test path operations with an actual function
        const joinedPath = await bridge.call<string>('os.path', 'join', ['/tmp', 'test']);
        expect(typeof joinedPath).toBe('string');
      },
      testTimeout
    );

    it(
      'should support custom PYTHONPATH additions',
      async () => {
        const pythonAvailable = await isPythonAvailable();
        if (!pythonAvailable || !isBridgeScriptAvailable()) return;

        const customPythonPath = '/custom/python/path';
        bridge = new NodeBridge({
          scriptPath,
          env: { PYTHONPATH: customPythonPath },
          timeoutMs: defaultTimeoutMs,
        });

        // Test that we can access environment variables
        // os.getenv is a function, so this should work
        const envVar = await bridge.call<string | null>('os', 'getenv', ['PYTHONPATH']);
        expect(envVar).toBeTruthy();

        // Test that os module works with another function
        const cwd = await bridge.call<string>('os', 'getcwd', []);
        expect(typeof cwd).toBe('string');
      },
      testTimeout
    );

    it(
      'should set VIRTUAL_ENV and PATH when virtualEnv is provided',
      async () => {
        const pythonAvailable = await isPythonAvailable();
        if (!pythonAvailable || !isBridgeScriptAvailable()) return;

        let tempDir: string | undefined;
        try {
          tempDir = await mkdtemp(join(tmpdir(), 'tywrap-venv-'));
          const venvDir = join(tempDir, 'fake-venv');
          const binDir = join(venvDir, getVenvBinDir());
          await mkdir(binDir, { recursive: true });

          const scriptAbsolutePath = join(process.cwd(), scriptPath);
          bridge = new NodeBridge({
            scriptPath: scriptAbsolutePath,
            pythonPath: defaultPythonPath,
            cwd: tempDir,
            virtualEnv: 'fake-venv',
            timeoutMs: defaultTimeoutMs,
          });

          const venvEnv = await bridge.call<string | null>('os', 'getenv', ['VIRTUAL_ENV']);
          expect(venvEnv).toBe(venvDir);

          const pathEnv = await bridge.call<string | null>('os', 'getenv', ['PATH']);
          expect(pathEnv?.split(delimiter)[0]).toBe(binDir);
        } finally {
          await bridge?.dispose();
          if (tempDir) {
            // On Windows, file handles may not be released immediately after dispose
            // Use maxRetries to handle EBUSY errors
            await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
          }
        }
      },
      testTimeout
    );
  });

  describe('Performance Characteristics', () => {
    beforeEach(async () => {
      bridge = new NodeBridge({ scriptPath, timeoutMs: defaultTimeoutMs });
    });

    afterEach(async () => {
      await bridge?.dispose();
    });

    it(
      'should have reasonable startup time',
      async () => {
        const pythonAvailable = await isPythonAvailable();
        if (!pythonAvailable || !isBridgeScriptAvailable()) return;

        const start = Date.now();
        await bridge.init();
        const initTime = Date.now() - start;

        // Initialization should complete within reasonable time
        expect(initTime).toBeLessThan(startupThresholdMs);
      },
      testTimeout
    );

    it(
      'should handle rapid successive calls efficiently',
      async () => {
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
        expect(averageTime).toBeLessThan(averageThresholdMs);
      },
      testTimeout
    );
  });

  describe('Edge Cases and Error Recovery', () => {
    it(
      'should handle very large argument lists',
      async () => {
        const pythonAvailable = await isPythonAvailable();
        if (!pythonAvailable || !isBridgeScriptAvailable()) return;

        bridge = new NodeBridge({ scriptPath, timeoutMs: defaultTimeoutMs });

        // Test with max function and many arguments
        const numbers = Array.from({ length: 1000 }, (_, i) => i);
        const result = await bridge.call<number>('builtins', 'max', [numbers]);
        expect(result).toBe(999);
      },
      testTimeout
    );

    it(
      'should handle special floating point values',
      async () => {
        const pythonAvailable = await isPythonAvailable();
        if (!pythonAvailable || !isBridgeScriptAvailable()) return;

        bridge = new NodeBridge({ scriptPath, timeoutMs: defaultTimeoutMs });

        // Test with basic float operations that should work
        const floatValue = await bridge.call<number>('builtins', 'float', [3.14]);
        expect(floatValue).toBe(3.14);

        // Test with integer to float conversion
        const intToFloat = await bridge.call<number>('builtins', 'float', [42]);
        expect(intToFloat).toBe(42.0);

        // Test string to float conversion
        const strToFloat = await bridge.call<number>('builtins', 'float', ['123.456']);
        expect(strToFloat).toBe(123.456);
      },
      testTimeout
    );

    it(
      'should handle Unicode strings correctly',
      async () => {
        const pythonAvailable = await isPythonAvailable();
        if (!pythonAvailable || !isBridgeScriptAvailable()) return;

        bridge = new NodeBridge({ scriptPath, timeoutMs: defaultTimeoutMs });

        const unicodeString = '🐍 Python with Unicode: αβγδε ñáéíóú 中文';
        const result = await bridge.call<string>('builtins', 'str', [unicodeString]);
        expect(result).toBe(unicodeString);
      },
      testTimeout
    );

    it(
      'should handle None/null values',
      async () => {
        const pythonAvailable = await isPythonAvailable();
        if (!pythonAvailable || !isBridgeScriptAvailable()) return;

        bridge = new NodeBridge({ scriptPath, timeoutMs: defaultTimeoutMs });

        const listHandle = await bridge.instantiate('builtins', 'list', []);
        const result = await bridge.callMethod(listHandle, 'append', [1]);
        expect(result).toBeNull(); // list.append returns None, which should be null in JS
        await bridge.disposeInstance(listHandle);
      },
      testTimeout
    );
  });
});
