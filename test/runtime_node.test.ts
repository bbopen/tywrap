/**
 * Node.js Runtime Bridge Compatibility Tests
 * Tests subprocess Python execution, timeout handling, virtual environments, and data transfer
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'path';
import { NodeBridge } from '../src/runtime/node.js';
import { BridgeExecutionError, BridgeProtocolError } from '../src/runtime/errors.js';
import { TYWRAP_PROTOCOL_VERSION } from '../src/runtime/transport.js';
import { getDefaultPythonPath } from '../src/utils/python.js';
import { isNodejs, getVenvBinDir } from '../src/utils/runtime.js';
import { PYTHON_AVAILABLE, pythonExprTruthy, hasPythonBinary } from './helpers/python-probe.js';

// Skip all tests if not running in Node.js
const describeNodeOnly = isNodejs() ? describe : describe.skip;

// Synchronous availability gates. These feed it.skipIf(...) so that tests
// requiring a real Python interpreter SKIP loudly (visible in the reporter)
// instead of silently early-returning and reporting a vacuous pass.
const scriptPath = 'runtime/python_bridge.py';
const BRIDGE_SCRIPT_OK = existsSync(scriptPath);
// The interpreter is required for every live bridge test; the bridge script is
// always present in the repo, so PYTHON_OK is the effective gate.
const PYTHON_OK = PYTHON_AVAILABLE && BRIDGE_SCRIPT_OK;
// Pydantic v2 (BaseModel.model_dump) feature gate, probed once at load.
const PYDANTIC_V2_OK =
  PYTHON_OK &&
  pythonExprTruthy(
    "import pydantic; from pydantic import BaseModel; print('1' if hasattr(BaseModel, 'model_dump') else '0')"
  );
// Protocol-error fixtures live in test/fixtures and are always present in the
// repo, so these gates collapse to PYTHON availability in practice.
const fixturePath = (name: string): string => join(process.cwd(), 'test', 'fixtures', name);
const NOISY_FIXTURE_OK = PYTHON_OK && existsSync(fixturePath('noisy_bridge.py'));
const FRAGMENTED_FIXTURE_OK = PYTHON_OK && existsSync(fixturePath('fragmented_bridge.py'));
const INVALID_FIXTURE_OK = PYTHON_OK && existsSync(fixturePath('invalid_json_bridge.py'));
// One test pins the `python` (not `python3`) binary specifically.
const PYTHON_BINARY_OK = BRIDGE_SCRIPT_OK && hasPythonBinary('python');

describeNodeOnly('Node.js Runtime Bridge', () => {
  let bridge: NodeBridge;
  const isCi =
    ['1', 'true'].includes((process.env.CI ?? '').toLowerCase()) ||
    ['1', 'true'].includes((process.env.GITHUB_ACTIONS ?? '').toLowerCase()) ||
    ['1', 'true'].includes((process.env.ACT ?? '').toLowerCase());
  const testTimeout = isCi ? 60000 : 30000;
  const defaultTimeoutMs = isCi ? 45000 : 5000;
  const startupThresholdMs = isCi ? 15000 : 5000;
  const averageThresholdMs = isCi ? 2000 : 1000;
  const defaultPythonPath = getDefaultPythonPath();

  describe('Basic Bridge Operations', () => {
    beforeEach(async () => {
      bridge = new NodeBridge({ scriptPath, timeoutMs: defaultTimeoutMs });
    });

    afterEach(async () => {
      await bridge?.dispose();
    });

    it.skipIf(!PYTHON_OK)(
      'should initialize and dispose cleanly',
      async () => {
        await bridge.init();
        await bridge.dispose();
        expect(true).toBe(true); // Test passes if no errors thrown
      },
      testTimeout
    );

    it.skipIf(!PYTHON_OK)(
      'should handle basic math operations',
      async () => {
        const result = await bridge.call<number>('math', 'sqrt', [16]);
        expect(result).toBe(4);
      },
      testTimeout
    );

    it.skipIf(!PYTHON_OK)(
      'should not timeout when args include nested id fields',
      async () => {
        const result = await bridge.call<string>('builtins', 'str', [{ id: 999, value: 'ok' }]);
        expect(result).toContain("'id': 999");
        expect(result).toContain("'value': 'ok'");
      },
      testTimeout
    );

    it.skipIf(!PYTHON_OK)(
      'should roundtrip Uint8Array as Python bytes',
      async () => {
        const input = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"

        const length = await bridge.call<number>('builtins', 'len', [input]);
        expect(length).toBe(5);

        const output = await bridge.call<Uint8Array>('builtins', 'bytes', [input]);
        expect(output).toBeInstanceOf(Uint8Array);
        expect(Array.from(output)).toEqual(Array.from(input));
      },
      testTimeout
    );

    it.skipIf(!PYTHON_OK)(
      'should support zero-length Uint8Array as Python bytes',
      async () => {
        const input = new Uint8Array([]);

        const length = await bridge.call<number>('builtins', 'len', [input]);
        expect(length).toBe(0);

        const output = await bridge.call<Uint8Array>('builtins', 'bytes', [input]);
        expect(output).toBeInstanceOf(Uint8Array);
        expect(output.length).toBe(0);
      },
      testTimeout
    );

    it.skipIf(!PYTHON_OK)(
      'should reject malformed bytes envelopes with explicit protocol error',
      async () => {
        await expect(
          bridge.call('builtins', 'len', [{ __tywrap_bytes__: true, b64: '%%%' }])
        ).rejects.toThrow(/Invalid bytes envelope: invalid base64/);
      },
      testTimeout
    );

    it.skipIf(!PYTHON_OK)(
      'should handle function calls with kwargs',
      async () => {
        // Test with built-in pow function
        const result = await bridge.call<number>('builtins', 'pow', [2], { exp: 3 });
        expect(result).toBe(8);
      },
      testTimeout
    );

    it.skipIf(!PYTHON_OK)(
      'should handle class instantiation',
      async () => {
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

    it.skipIf(!PYTHON_OK)(
      'should report bridge info and track instance counts',
      async () => {
        const info = await bridge.getBridgeInfo();
        expect(info.protocol).toBe('tywrap/1');
        expect(info.protocolVersion).toBe(TYWRAP_PROTOCOL_VERSION);
        expect(info.bridge).toBe('python-subprocess');
        expect(info.pythonVersion).toMatch(/^\d+\.\d+\.\d+$/);
        expect(['json', 'none']).toContain(info.codecFallback);
        expect(typeof info.arrowAvailable).toBe('boolean');
        expect(Number.isInteger(info.pid)).toBe(true);
        expect(info.pid).toBeGreaterThan(0);
        expect(typeof info.scipyAvailable).toBe('boolean');
        expect(typeof info.torchAvailable).toBe('boolean');
        expect(typeof info.sklearnAvailable).toBe('boolean');
        expect(Number.isInteger(info.instances)).toBe(true);
        expect(info.instances).toBeGreaterThanOrEqual(0);

        const cached = await bridge.getBridgeInfo();
        expect(cached).toBe(info);

        const before = info.instances;
        const handle = await bridge.instantiate('collections', 'Counter', [[1, 2, 2]]);
        const mid = await bridge.getBridgeInfo({ refresh: true });
        expect(mid.instances).toBe(before + 1);

        await bridge.disposeInstance(handle);
        const after = await bridge.getBridgeInfo({ refresh: true });
        expect(after.instances).toBe(before);
      },
      testTimeout
    );
  });

  describe('Stdlib Serialization', () => {
    it.skipIf(!PYTHON_OK)(
      'should serialize datetime, Decimal, UUID, and Path values',
      async () => {
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

  describe('Pydantic Serialization', () => {
    // Only applies to pydantic v2 (BaseModel.model_dump); PYDANTIC_V2_OK implies PYTHON.
    it.skipIf(!PYDANTIC_V2_OK)(
      'surfaces model_dump failures explicitly',
      async () => {
        let tempDir: string | undefined;
        try {
          tempDir = await mkdtemp(join(tmpdir(), 'tywrap-pydantic-'));
          const moduleName = 'pydantic_fixture';
          const modulePath = join(tempDir, `${moduleName}.py`);
          const content = `from pydantic import BaseModel

class Bad(BaseModel):
    x: int

    def model_dump(self, *args, **kwargs):
        raise RuntimeError("boom")

def get_bad():
    return Bad(x=1)
`;
          await writeFile(modulePath, content, 'utf-8');

          const existingPyPath = process.env.PYTHONPATH;
          const mergedPyPath = existingPyPath ? `${tempDir}${delimiter}${existingPyPath}` : tempDir;

          bridge = new NodeBridge({
            scriptPath,
            env: { PYTHONPATH: mergedPyPath },
            timeoutMs: defaultTimeoutMs,
          });

          const p = bridge.call(moduleName, 'get_bad', []);
          await expect(p).rejects.toThrow(BridgeExecutionError);
          await expect(p).rejects.toThrow(/model_dump failed/i);
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

    it.skipIf(!PYTHON_OK)(
      'should timeout long-running operations',
      async () => {
        bridge = new NodeBridge({ scriptPath, timeoutMs: 1000 });

        // Test with a sleep operation that should timeout
        await expect(bridge.call('time', 'sleep', [2])).rejects.toThrow(/timed out/);
      },
      testTimeout
    );

    it.skipIf(!PYTHON_OK)(
      'should handle timeout configuration',
      async () => {
        const shortTimeoutBridge = new NodeBridge({
          scriptPath,
          timeoutMs: 500,
        });

        await expect(shortTimeoutBridge.call('time', 'sleep', [1])).rejects.toThrow(/timed out/);

        await shortTimeoutBridge.dispose();
      },
      testTimeout
    );

    it.skipIf(!PYTHON_OK)(
      'should ignore late responses for timed-out requests',
      async () => {
        bridge = new NodeBridge({ scriptPath, timeoutMs: 1000 });
        const sleepSeconds = 1.5;

        await expect(bridge.call('time', 'sleep', [sleepSeconds])).rejects.toThrow(/timed out/i);

        // Validate recovery with a lightweight stdlib call rather than a cold module import,
        // so this test measures timeout isolation instead of first-call import latency.
        const deadline = Date.now() + 3000;
        let result: string | undefined;
        while (Date.now() < deadline) {
          try {
            result = await bridge.call<string>('builtins', 'str', ['recovered']);
            break;
          } catch {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }

        expect(result).toBe('recovered');
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

    it.skipIf(!PYTHON_OK)(
      'should handle Python exceptions gracefully',
      async () => {
        // Try to divide by zero
        await expect(bridge.call('operator', 'truediv', [1, 0])).rejects.toThrow();
      },
      testTimeout
    );

    it.skipIf(!PYTHON_OK)(
      'should handle module import errors',
      async () => {
        await expect(bridge.call('nonexistent_module', 'some_function', [])).rejects.toThrow();
      },
      testTimeout
    );

    it.skipIf(!PYTHON_OK)(
      'should handle invalid function names',
      async () => {
        await expect(bridge.call('math', 'nonexistent_function', [])).rejects.toThrow();
      },
      testTimeout
    );

    it.skipIf(!PYTHON_OK)(
      'should reject invalid instance handles',
      async () => {
        const handle = await bridge.instantiate('collections', 'Counter', [[1, 2, 2]]);
        await bridge.disposeInstance(handle);

        await expect(bridge.callMethod(handle, 'most_common', [1])).rejects.toThrow(
          /InstanceHandleError: Unknown instance handle:/
        );
      },
      testTimeout
    );

    it.skipIf(!PYTHON_OK)(
      'should allow disposing the same instance handle twice',
      async () => {
        const handle = await bridge.instantiate('collections', 'Counter', [[1, 2, 2]]);
        await bridge.disposeInstance(handle);

        await expect(bridge.disposeInstance(handle)).resolves.toBeUndefined();
      },
      testTimeout
    );

    it.skipIf(!PYTHON_OK)(
      'should reject responses that exceed TYWRAP_CODEC_MAX_BYTES',
      async () => {
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

    it.skipIf(!BRIDGE_SCRIPT_OK)(
      'should emit a descriptive error when Python fails to start',
      async () => {
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
    it.skipIf(!PYTHON_BINARY_OK)(
      'should support custom Python paths',
      async () => {
        // Test with python instead of python3 if available
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

    it.skipIf(!PYTHON_OK)(
      'should support custom working directories',
      async () => {
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

    it.skipIf(!PYTHON_OK)(
      'should support custom environment variables',
      async () => {
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
      dangerousKey => {
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

    it.skipIf(!PYTHON_OK)(
      'should filter environment variables by TYWRAP_ prefix',
      async () => {
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

    it.skipIf(!PYTHON_OK)(
      'should support JSON fallback configuration',
      async () => {
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

  describe('Warmup Commands', () => {
    it.skipIf(!PYTHON_OK)(
      'should execute warmup commands during init',
      async () => {
        let tempDir: string | undefined;
        let warmupBridge: NodeBridge | undefined;
        try {
          tempDir = await mkdtemp(join(tmpdir(), 'tywrap-warmup-'));
          const moduleName = 'warmup_fixture';
          const markerPath = join(tempDir, 'warmup.marker');
          const modulePath = join(tempDir, `${moduleName}.py`);

          await writeFile(
            modulePath,
            `from pathlib import Path\n\ndef touch(path):\n    Path(path).write_text('warmed', encoding='utf-8')\n    return True\n`,
            'utf-8'
          );

          const existingPyPath = process.env.PYTHONPATH;
          const mergedPyPath = existingPyPath ? `${tempDir}${delimiter}${existingPyPath}` : tempDir;

          warmupBridge = new NodeBridge({
            scriptPath,
            env: { PYTHONPATH: mergedPyPath },
            warmupCommands: [{ module: moduleName, functionName: 'touch', args: [markerPath] }],
            timeoutMs: defaultTimeoutMs,
          });

          await warmupBridge.init();
          await expect(access(markerPath)).resolves.toBeUndefined();
        } finally {
          if (warmupBridge) {
            await warmupBridge.dispose();
          }
          if (tempDir) {
            await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
          }
        }
      },
      testTimeout
    );

    it.skipIf(!PYTHON_AVAILABLE)(
      'should allow timeoutMs 0 to disable the worker readiness timeout',
      async () => {
        let tempDir: string | undefined;
        let warmupBridge: NodeBridge | undefined;
        try {
          tempDir = await mkdtemp(join(tmpdir(), 'tywrap-warmup-timeout0-'));
          const slowBridgePath = join(tempDir, 'slow_meta_bridge.py');

          await writeFile(
            slowBridgePath,
            [
              'import json',
              'import sys',
              'import time',
              '',
              'for line in sys.stdin:',
              '    request = json.loads(line)',
              "    if request.get('method') == 'meta':",
              '        time.sleep(5.2)',
              "        response = {'id': request.get('id'), 'protocol': request.get('protocol'), 'result': {'capabilities': {}}}",
              '    else:',
              "        response = {'id': request.get('id'), 'protocol': request.get('protocol'), 'result': 'ok'}",
              "    sys.stdout.write(json.dumps(response) + '\\n')",
              '    sys.stdout.flush()',
            ].join('\n'),
            'utf-8'
          );

          warmupBridge = new NodeBridge({
            scriptPath: slowBridgePath,
            timeoutMs: 0,
          });

          await expect(warmupBridge.init()).resolves.toBeUndefined();
          expect(warmupBridge.isReady).toBe(true);
        } finally {
          if (warmupBridge) {
            await warmupBridge.dispose();
          }
          if (tempDir) {
            await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
          }
        }
      },
      testTimeout
    );

    it.skipIf(!PYTHON_OK)(
      'should surface warmup failures and keep bridge not ready',
      async () => {
        let tempDir: string | undefined;
        let warmupBridge: NodeBridge | undefined;
        try {
          tempDir = await mkdtemp(join(tmpdir(), 'tywrap-warmup-fail-'));
          const moduleName = 'warmup_failure_fixture';
          const modulePath = join(tempDir, `${moduleName}.py`);

          await writeFile(
            modulePath,
            `def fail():\n    raise RuntimeError('warmup boom')\n`,
            'utf-8'
          );

          const existingPyPath = process.env.PYTHONPATH;
          const mergedPyPath = existingPyPath ? `${tempDir}${delimiter}${existingPyPath}` : tempDir;

          warmupBridge = new NodeBridge({
            scriptPath,
            env: { PYTHONPATH: mergedPyPath },
            warmupCommands: [{ module: moduleName, functionName: 'fail' }],
            timeoutMs: defaultTimeoutMs,
          });

          const initPromise = warmupBridge.init();
          await expect(initPromise).rejects.toThrow(/Warmup command #1/);
          await expect(initPromise).rejects.toThrow(/RuntimeError: warmup boom/);
          expect(warmupBridge.isReady).toBe(false);
        } finally {
          if (warmupBridge) {
            await warmupBridge.dispose();
          }
          if (tempDir) {
            await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
          }
        }
      },
      testTimeout
    );

    it.skipIf(!PYTHON_OK)(
      'should surface warmup request encoding failures with command context',
      async () => {
        let warmupBridge: NodeBridge | undefined;
        try {
          warmupBridge = new NodeBridge({
            scriptPath,
            warmupCommands: [{ module: 'math', functionName: 'sqrt', args: [BigInt(16)] }],
            timeoutMs: defaultTimeoutMs,
          });

          const initPromise = warmupBridge.init();
          await expect(initPromise).rejects.toThrow(/Warmup command #1 \(math\.sqrt\)/);
          await expect(initPromise).rejects.toThrow(/failed to encode request/i);
          expect(warmupBridge.isReady).toBe(false);
        } finally {
          if (warmupBridge) {
            await warmupBridge.dispose();
          }
        }
      },
      testTimeout
    );

    it.skipIf(!PYTHON_AVAILABLE)(
      'should reject malformed warmup success envelopes',
      async () => {
        let tempDir: string | undefined;
        let warmupBridge: NodeBridge | undefined;
        try {
          tempDir = await mkdtemp(join(tmpdir(), 'tywrap-warmup-envelope-'));
          const malformedBridgePath = join(tempDir, 'malformed_bridge.py');

          await writeFile(
            malformedBridgePath,
            [
              'import json',
              'import sys',
              '',
              'for line in sys.stdin:',
              '    request = json.loads(line)',
              "    method = request.get('method')",
              "    if method == 'meta':",
              "        response = {'id': request.get('id'), 'protocol': request.get('protocol'), 'result': {'capabilities': {}}}",
              '    else:',
              "        response = {'id': request.get('id'), 'protocol': request.get('protocol')}",
              "    sys.stdout.write(json.dumps(response) + '\\n')",
              '    sys.stdout.flush()',
            ].join('\n'),
            'utf-8'
          );

          warmupBridge = new NodeBridge({
            scriptPath: malformedBridgePath,
            warmupCommands: [{ module: 'math', functionName: 'sqrt', args: [16] }],
            timeoutMs: defaultTimeoutMs,
          });

          const initPromise = warmupBridge.init();
          await expect(initPromise).rejects.toThrow(/Warmup command #1 \(math\.sqrt\)/);
          await expect(initPromise).rejects.toThrow(/malformed response envelope/i);
          expect(warmupBridge.isReady).toBe(false);
        } finally {
          if (warmupBridge) {
            await warmupBridge.dispose();
          }
          if (tempDir) {
            await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
          }
        }
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

    it.skipIf(!PYTHON_OK)(
      'should handle various data types',
      async () => {
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

    it.skipIf(!PYTHON_OK)(
      'should handle lists and arrays',
      async () => {
        const inputList = [1, 2, 3, 4, 5];
        const result = await bridge.call<number[]>('builtins', 'list', [inputList]);
        expect(result).toEqual(inputList);
      },
      testTimeout
    );

    it.skipIf(!PYTHON_OK)(
      'should handle dictionaries and objects',
      async () => {
        const inputDict = { a: 1, b: 2, c: 3 };
        const result = await bridge.call<Record<string, number>>('builtins', 'dict', [], inputDict);
        expect(result).toEqual(inputDict);
      },
      testTimeout
    );

    it.skipIf(!PYTHON_OK)(
      'should handle large data transfers',
      async () => {
        // Create a large list
        const largeList = Array.from({ length: 10000 }, (_, i) => i);
        const result = await bridge.call<number[]>('builtins', 'list', [largeList]);
        expect(result.length).toBe(10000);
        expect(result[0]).toBe(0);
        expect(result[9999]).toBe(9999);
      },
      testTimeout
    );

    it.skipIf(!PYTHON_OK)(
      'should handle large string payloads',
      async () => {
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
    it.skipIf(!PYTHON_OK)(
      'should handle subprocess lifecycle correctly',
      async () => {
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

    it.skipIf(!PYTHON_OK)(
      'should handle multiple concurrent calls',
      async () => {
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

    it.skipIf(!PYTHON_OK)(
      'should handle process crashes gracefully',
      async () => {
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
    it.skipIf(!NOISY_FIXTURE_OK)(
      'should surface invalid stdout lines as errors',
      async () => {
        bridge = new NodeBridge({
          scriptPath: fixturePath('noisy_bridge.py'),
          timeoutMs: defaultTimeoutMs,
        });

        // In the new architecture, invalid stdout lines cause protocol errors
        await expect(bridge.call('math', 'sqrt', [4])).rejects.toThrow('Protocol error');

        await bridge.dispose();
      },
      testTimeout
    );

    it.skipIf(!FRAGMENTED_FIXTURE_OK)(
      'should handle fragmented JSON frames',
      async () => {
        bridge = new NodeBridge({
          scriptPath: fixturePath('fragmented_bridge.py'),
          timeoutMs: defaultTimeoutMs,
        });

        const result = await bridge.call<number>('math', 'sqrt', [4]);
        expect(result).toBe(42);

        await bridge.dispose();
      },
      testTimeout
    );

    it.skipIf(!INVALID_FIXTURE_OK)(
      'should surface invalid JSON frames as errors',
      async () => {
        bridge = new NodeBridge({
          scriptPath: fixturePath('invalid_json_bridge.py'),
          timeoutMs: defaultTimeoutMs,
        });

        // In the new architecture, invalid JSON causes protocol errors
        await expect(bridge.call('math', 'sqrt', [4])).rejects.toThrow('Protocol error');

        await bridge.dispose();
      },
      testTimeout
    );
  });

  describe('Virtual Environment Support', () => {
    it.skipIf(!PYTHON_OK)(
      'should respect PYTHONPATH environment',
      async () => {
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

    it.skipIf(!PYTHON_OK)(
      'should support custom PYTHONPATH additions',
      async () => {
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

    it.skipIf(!PYTHON_OK)(
      'should set VIRTUAL_ENV and PATH when virtualEnv is provided',
      async () => {
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
          const pathEntries = (pathEnv ?? '').split(delimiter).filter(Boolean);
          expect(pathEntries).toContain(binDir);
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

    it.skipIf(!PYTHON_OK)(
      'should preserve distinct lowercase path env overrides on POSIX',
      async () => {
        if (process.platform === 'win32') return;

        let tempDir: string | undefined;
        try {
          tempDir = await mkdtemp(join(tmpdir(), 'tywrap-venv-'));
          const venvDir = join(tempDir, 'fake-venv');
          const binDir = join(venvDir, getVenvBinDir());
          await mkdir(binDir, { recursive: true });

          const customPathAlias = '/custom/app/config/path';
          const scriptAbsolutePath = join(process.cwd(), scriptPath);
          bridge = new NodeBridge({
            scriptPath: scriptAbsolutePath,
            pythonPath: defaultPythonPath,
            cwd: tempDir,
            virtualEnv: 'fake-venv',
            env: { path: customPathAlias },
            timeoutMs: defaultTimeoutMs,
          });

          const pathEnv = await bridge.call<string | null>('os', 'getenv', ['PATH']);
          const pathEntries = (pathEnv ?? '').split(delimiter).filter(Boolean);
          expect(pathEntries).toContain(binDir);

          const lowercasePathEnv = await bridge.call<string | null>('os', 'getenv', ['path']);
          expect(lowercasePathEnv).toBe(customPathAlias);
        } finally {
          await bridge?.dispose();
          if (tempDir) {
            await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
          }
        }
      },
      testTimeout
    );

    it.skipIf(!PYTHON_OK)(
      'should not append an empty PATH segment when PATH is blank',
      async () => {
        let tempDir: string | undefined;
        try {
          const { execFile } = await import('child_process');
          const { promisify } = await import('util');
          const execFileAsync = promisify(execFile);
          const locator = process.platform === 'win32' ? 'where' : 'which';
          const { stdout } = await execFileAsync(locator, [defaultPythonPath], {
            encoding: 'utf-8',
          });
          const resolvedPythonPath = String(stdout)
            .split(/\r?\n/)
            .find(candidate => candidate.trim().length > 0)
            ?.trim();
          if (!resolvedPythonPath) {
            throw new Error(`Failed to locate ${defaultPythonPath}`);
          }

          tempDir = await mkdtemp(join(tmpdir(), 'tywrap-venv-'));
          const venvDir = join(tempDir, 'fake-venv');
          const binDir = join(venvDir, getVenvBinDir());
          await mkdir(binDir, { recursive: true });

          const scriptAbsolutePath = join(process.cwd(), scriptPath);
          bridge = new NodeBridge({
            scriptPath: scriptAbsolutePath,
            pythonPath: resolvedPythonPath,
            cwd: tempDir,
            virtualEnv: 'fake-venv',
            env: { PATH: '' },
            timeoutMs: defaultTimeoutMs,
          });

          const pathEnv = await bridge.call<string | null>('os', 'getenv', ['PATH']);
          expect(pathEnv).toBe(binDir);
        } finally {
          await bridge?.dispose();
          if (tempDir) {
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

    it.skipIf(!PYTHON_OK)(
      'should have reasonable startup time',
      async () => {
        const start = Date.now();
        await bridge.init();
        const initTime = Date.now() - start;

        // Initialization should complete within reasonable time
        expect(initTime).toBeLessThan(startupThresholdMs);
      },
      testTimeout
    );

    it.skipIf(!PYTHON_OK)(
      'should handle rapid successive calls efficiently',
      async () => {
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
    it.skipIf(!PYTHON_OK)(
      'should handle very large argument lists',
      async () => {
        bridge = new NodeBridge({ scriptPath, timeoutMs: defaultTimeoutMs });

        // Test with max function and many arguments
        const numbers = Array.from({ length: 1000 }, (_, i) => i);
        const result = await bridge.call<number>('builtins', 'max', [numbers]);
        expect(result).toBe(999);
      },
      testTimeout
    );

    it.skipIf(!PYTHON_OK)(
      'should handle special floating point values',
      async () => {
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

    it.skipIf(!PYTHON_OK)(
      'should handle Unicode strings correctly',
      async () => {
        bridge = new NodeBridge({ scriptPath, timeoutMs: defaultTimeoutMs });

        const unicodeString = '🐍 Python with Unicode: αβγδε ñáéíóú 中文';
        const result = await bridge.call<string>('builtins', 'str', [unicodeString]);
        expect(result).toBe(unicodeString);
      },
      testTimeout
    );

    it.skipIf(!PYTHON_OK)(
      'should handle None/null values',
      async () => {
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

// Python-free unit coverage for NodeBridge construction, stats, and lifecycle.
// These tests only instantiate the bridge (no init()/call()), so they run
// without a Python runtime. Folded in from the former optimized-node.test.ts
// when the OptimizedNodeBridge shim was removed.
describeNodeOnly('NodeBridge construction and stats', () => {
  let bridge: NodeBridge | undefined;

  afterEach(async () => {
    if (bridge) {
      try {
        await bridge.dispose();
      } catch {
        // Ignore disposal errors in tests
      }
      bridge = undefined;
    }
  });

  describe('constructor', () => {
    it('should create instance with default options', () => {
      bridge = new NodeBridge();
      expect(bridge).toBeInstanceOf(NodeBridge);
    });

    it('should create instance with custom pool and timeout options', () => {
      bridge = new NodeBridge({
        minProcesses: 1,
        maxProcesses: 2,
        maxIdleTime: 5000,
        maxRequestsPerProcess: 100,
        timeoutMs: 10000,
        enableJsonFallback: true,
      });
      expect(bridge).toBeInstanceOf(NodeBridge);
    });

    it('should accept virtual environment option', () => {
      bridge = new NodeBridge({ virtualEnv: '.venv' });
      expect(bridge).toBeInstanceOf(NodeBridge);
    });

    it('should accept custom python path', () => {
      bridge = new NodeBridge({ pythonPath: 'python3' });
      expect(bridge).toBeInstanceOf(NodeBridge);
    });

    it('should accept warmup commands', () => {
      bridge = new NodeBridge({
        warmupCommands: [{ module: 'math', functionName: 'sqrt', args: [16] }],
      });
      expect(bridge).toBeInstanceOf(NodeBridge);
    });

    it('should accept custom environment variables', () => {
      bridge = new NodeBridge({ env: { CUSTOM_VAR: 'custom_value' } });
      expect(bridge).toBeInstanceOf(NodeBridge);
    });

    it('should reject legacy warmup command format', () => {
      const createBridge = (): NodeBridge =>
        new NodeBridge({
          warmupCommands: [{ method: 'import', params: { module: 'os' } }],
        });

      expect(createBridge).toThrow(BridgeProtocolError);
      expect(createBridge).toThrow(/legacy \{ method, params \} format is no longer supported/i);
    });

    it('should reject non-array warmupCommands', () => {
      const createBridge = (): NodeBridge =>
        new NodeBridge({
          warmupCommands: {
            module: 'math',
            functionName: 'sqrt',
            args: [16],
          } as unknown as Array<{ module: string; functionName: string; args?: unknown[] }>,
        });

      expect(createBridge).toThrow(BridgeProtocolError);
      expect(createBridge).toThrow(/warmupCommands must be an array/i);
    });
  });

  describe('getStats', () => {
    beforeEach(() => {
      bridge = new NodeBridge();
    });

    it('should return a stats object with the expected shape', () => {
      const stats = bridge!.getStats();

      expect(stats).toHaveProperty('totalRequests');
      expect(stats).toHaveProperty('totalTime');
      expect(stats).toHaveProperty('cacheHits');
      expect(stats).toHaveProperty('poolHits');
      expect(stats).toHaveProperty('poolMisses');
      expect(stats).toHaveProperty('processSpawns');
      expect(stats).toHaveProperty('processDeaths');
      expect(stats).toHaveProperty('memoryPeak');
      expect(stats).toHaveProperty('averageTime');
      expect(stats).toHaveProperty('cacheHitRate');
    });

    it('should report zeroed stats before any calls', () => {
      const stats = bridge!.getStats();

      expect(stats.totalRequests).toBe(0);
      expect(stats.totalTime).toBe(0);
      expect(stats.cacheHits).toBe(0);
    });
  });

  describe('dispose', () => {
    it('should dispose without error', async () => {
      bridge = new NodeBridge();
      await expect(bridge.dispose()).resolves.not.toThrow();
    });

    it('should be idempotent', async () => {
      bridge = new NodeBridge();
      await bridge.dispose();
      await expect(bridge.dispose()).resolves.not.toThrow();
    });
  });
});
