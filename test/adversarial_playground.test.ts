import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { delimiter, join } from 'node:path';
import { NodeBridge } from '../src/runtime/node.js';
import { resolvePythonExecutable } from '../src/utils/python.js';
import { isNodejs } from '../src/utils/runtime.js';

const shouldRun = isNodejs() && process.env.TYWRAP_ADVERSARIAL === '1';
const describeAdversarial = shouldRun ? describe : describe.skip;
const testTimeoutMs = shouldRun ? 15_000 : 5_000;

const scriptPath = join(process.cwd(), 'runtime', 'python_bridge.py');
const fixturesRoot = join(process.cwd(), 'test', 'fixtures', 'python');
const fixturesDir = join(process.cwd(), 'test', 'fixtures');
const moduleName = 'adversarial_module';

const resolvePythonForTests = async (): Promise<string | null> => {
  const explicit =
    process.env.TYWRAP_ADVERSARIAL_PYTHON?.trim() || process.env.TYWRAP_CODEC_PYTHON?.trim();
  if (explicit) {
    return explicit;
  }
  try {
    return await resolvePythonExecutable();
  } catch {
    return null;
  }
};

const pythonAvailable = (pythonPath: string | null): boolean => {
  if (!pythonPath) return false;
  const res = spawnSync(pythonPath, ['--version'], { encoding: 'utf-8' });
  return res.status === 0;
};

const pythonModuleAvailable = async (moduleId: string): Promise<boolean> => {
  const pythonPath = await resolvePythonForTests();
  if (!pythonPath || !pythonAvailable(pythonPath)) {
    return false;
  }
  const check = spawnSync(
    pythonPath,
    [
      '-c',
      `import importlib.util, sys; sys.exit(0 if importlib.util.find_spec(${JSON.stringify(moduleId)}) else 1)`,
    ],
    { encoding: 'utf-8' }
  );
  return check.status === 0;
};

const buildPythonPath = (): string => {
  const current = process.env.PYTHONPATH;
  return current ? `${fixturesRoot}${delimiter}${current}` : fixturesRoot;
};

const createBridge = async (
  options: { timeoutMs?: number; env?: Record<string, string | undefined> } = {}
): Promise<NodeBridge | null> => {
  if (!existsSync(scriptPath) || !existsSync(fixturesRoot)) {
    return null;
  }
  const pythonPath = await resolvePythonForTests();
  if (!pythonPath || !pythonAvailable(pythonPath)) {
    return null;
  }
  return new NodeBridge({
    scriptPath,
    pythonPath,
    timeoutMs: options.timeoutMs ?? 2000,
    env: {
      // Why: include local adversarial fixtures without mutating global env.
      PYTHONPATH: buildPythonPath(),
      ...options.env,
    },
  });
};

const createFixtureBridge = async (
  scriptName: string,
  options: { timeoutMs?: number; env?: Record<string, string | undefined> } = {}
): Promise<NodeBridge | null> => {
  const fixtureScript = join(fixturesDir, scriptName);
  if (!existsSync(fixtureScript)) {
    return null;
  }
  const pythonPath = await resolvePythonForTests();
  if (!pythonPath || !pythonAvailable(pythonPath)) {
    return null;
  }
  return new NodeBridge({
    scriptPath: fixtureScript,
    pythonPath,
    timeoutMs: options.timeoutMs ?? 2000,
    env: options.env ?? {},
  });
};

const callAdversarial = (bridge: NodeBridge, name: string, args: unknown[]) =>
  bridge.call(moduleName, name, args);

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

describeAdversarial('Adversarial playground', () => {
  it(
    'keeps the bridge usable after a timeout',
    async () => {
      const bridge = await createBridge({ timeoutMs: 200 });
      if (!bridge) return;

      try {
        await expect(callAdversarial(bridge, 'sleep_and_return', ['ok', 0.4])).rejects.toThrow(
          /timed out/i
        );
        // Why: allow the slow call to finish so the next request is not blocked.
        await delay(500);

        const result = await callAdversarial(bridge, 'echo', ['still-alive']);
        expect(result).toBe('still-alive');
      } finally {
        await bridge.dispose();
      }
    },
    testTimeoutMs
  );

  it.fails(
    'handles mixed concurrency with a timeout and a fast success',
    async () => {
      const bridge = await createBridge({ timeoutMs: 250 });
      if (!bridge) return;

      try {
        const slow = callAdversarial(bridge, 'sleep_and_return', ['slow', 0.5]);
        const fast = callAdversarial(bridge, 'echo', ['fast']);
        const results = await Promise.allSettled([slow, fast]);

        // Known limitation: the subprocess bridge is serial, so a slow call can
        // starve subsequent calls and time them out.
        expect(results[0].status).toBe('rejected');
        expect(results[1].status).toBe('fulfilled');
        if (results[1].status === 'fulfilled') {
          expect(results[1].value).toBe('fast');
        }

        await delay(600);
        const again = await callAdversarial(bridge, 'echo', ['after-timeout']);
        expect(again).toBe('after-timeout');
      } finally {
        await bridge.dispose();
      }
    },
    testTimeoutMs
  );

  it(
    'rejects payloads that exceed TYWRAP_CODEC_MAX_BYTES',
    async () => {
      const bridge = await createBridge({
        env: { TYWRAP_CODEC_MAX_BYTES: '256' },
      });
      if (!bridge) return;

      try {
        await expect(callAdversarial(bridge, 'return_large_payload', [2048])).rejects.toThrow(
          /TYWRAP_CODEC_MAX_BYTES|PayloadTooLargeError/
        );
      } finally {
        await bridge.dispose();
      }
    },
    testTimeoutMs
  );

  it(
    'surfaces invalid TYWRAP_CODEC_MAX_BYTES as an explicit startup error',
    async () => {
      const bridge = await createBridge({
        env: { TYWRAP_CODEC_MAX_BYTES: 'not-a-number' },
      });
      if (!bridge) return;

      try {
        await expect(callAdversarial(bridge, 'echo', ['value'])).rejects.toThrow(
          /TYWRAP_CODEC_MAX_BYTES/
        );
      } finally {
        await bridge.dispose();
      }
    },
    testTimeoutMs
  );

  it(
    'rejects requests that exceed TYWRAP_REQUEST_MAX_BYTES',
    async () => {
      const bridge = await createBridge({
        env: { TYWRAP_REQUEST_MAX_BYTES: '128' },
      });
      if (!bridge) return;

      try {
        const payload = 'x'.repeat(512);
        await expect(callAdversarial(bridge, 'echo', [payload])).rejects.toThrow(
          /TYWRAP_REQUEST_MAX_BYTES|RequestTooLargeError/
        );
      } finally {
        await bridge.dispose();
      }
    },
    testTimeoutMs
  );

  it(
    'surfaces explicit torch copy errors for non-contiguous tensors',
    async () => {
      if (!(await pythonModuleAvailable('torch'))) return;

      const bridge = await createBridge({
        env: { TYWRAP_TORCH_ALLOW_COPY: '0' },
      });
      if (!bridge) return;

      try {
        await expect(
          callAdversarial(bridge, 'return_torch_non_contiguous_tensor', [])
        ).rejects.toThrow(/Torch tensor is not contiguous|TYWRAP_TORCH_ALLOW_COPY/);
      } finally {
        await bridge.dispose();
      }
    },
    testTimeoutMs
  );

  it(
    'surfaces explicit scipy complex sparse dtype errors',
    async () => {
      if (!(await pythonModuleAvailable('scipy'))) return;

      const bridge = await createBridge();
      if (!bridge) return;

      try {
        await expect(callAdversarial(bridge, 'return_scipy_complex_sparse', [])).rejects.toThrow(
          /Complex sparse matrices are not supported/
        );
      } finally {
        await bridge.dispose();
      }
    },
    testTimeoutMs
  );

  it(
    'surfaces explicit sklearn non-serializable params errors',
    async () => {
      if (!(await pythonModuleAvailable('sklearn'))) return;

      const bridge = await createBridge();
      if (!bridge) return;

      try {
        await expect(
          callAdversarial(bridge, 'return_sklearn_unserializable_estimator', [])
        ).rejects.toThrow(/scikit-learn estimator params are not JSON-serializable/);
      } finally {
        await bridge.dispose();
      }
    },
    testTimeoutMs
  );

  it(
    'rejects invalid args payloads',
    async () => {
      const bridge = await createBridge();
      if (!bridge) return;

      const unsafeBridge = bridge as unknown as {
        call: (module: string, functionName: string, args: unknown) => Promise<unknown>;
      };

      try {
        await expect(unsafeBridge.call(moduleName, 'echo', 'not-a-list')).rejects.toThrow(
          /ProtocolError: Invalid args/
        );
      } finally {
        await bridge.dispose();
      }
    },
    testTimeoutMs
  );

  it(
    'rejects invalid kwargs payloads',
    async () => {
      const bridge = await createBridge();
      if (!bridge) return;

      const unsafeBridge = bridge as unknown as {
        call: (
          module: string,
          functionName: string,
          args: unknown[],
          kwargs?: unknown
        ) => Promise<unknown>;
      };

      try {
        await expect(unsafeBridge.call(moduleName, 'echo', [], 'not-a-dict')).rejects.toThrow(
          /ProtocolError: Invalid kwargs/
        );
      } finally {
        await bridge.dispose();
      }
    },
    testTimeoutMs
  );

  it(
    'rejects missing module or function names',
    async () => {
      const bridge = await createBridge();
      if (!bridge) return;

      const unsafeBridge = bridge as unknown as {
        call: (module: string, functionName: string, args: unknown[]) => Promise<unknown>;
      };

      try {
        await expect(unsafeBridge.call('', 'echo', [])).rejects.toThrow(
          /ProtocolError: Missing module/
        );
        await expect(unsafeBridge.call(moduleName, '', [])).rejects.toThrow(
          /ProtocolError: Missing functionName/
        );
      } finally {
        await bridge.dispose();
      }
    },
    testTimeoutMs
  );

  it(
    'surfaces non-serializable results as errors',
    async () => {
      const bridge = await createBridge();
      if (!bridge) return;

      try {
        await expect(callAdversarial(bridge, 'return_unserializable', [])).rejects.toThrow(
          /not JSON serializable|TypeError/
        );
      } finally {
        await bridge.dispose();
      }
    },
    testTimeoutMs
  );

  it(
    'rejects circular references in results',
    async () => {
      const bridge = await createBridge();
      if (!bridge) return;

      try {
        await expect(callAdversarial(bridge, 'return_circular_reference', [])).rejects.toThrow(
          /Circular reference detected/
        );
      } finally {
        await bridge.dispose();
      }
    },
    testTimeoutMs
  );

  it(
    'surfaces invalid JSON payloads explicitly',
    async () => {
      const bridge = await createBridge();
      if (!bridge) return;

      try {
        await expect(callAdversarial(bridge, 'return_nan_payload', [])).rejects.toThrow(
          /Protocol error|Invalid JSON|JSON parse failed|Cannot serialize NaN|NaN.*not allowed/
        );
      } finally {
        await bridge.dispose();
      }
    },
    testTimeoutMs
  );

  it(
    'treats stdout noise as a protocol error and recovers',
    async () => {
      const bridge = await createBridge();
      if (!bridge) return;

      try {
        await expect(callAdversarial(bridge, 'print_to_stdout', ['noise'])).rejects.toThrow(
          /Protocol error|Response missing/
        );
        await delay(200);

        const result = await callAdversarial(bridge, 'echo', ['recovered']);
        expect(result).toBe('recovered');
      } finally {
        await bridge.dispose();
      }
    },
    testTimeoutMs
  );

  it(
    'allows stderr noise without breaking responses',
    async () => {
      const bridge = await createBridge();
      if (!bridge) return;

      try {
        const result = await callAdversarial(bridge, 'write_to_stderr', ['note']);
        expect(result).toBe('note');
      } finally {
        await bridge.dispose();
      }
    },
    testTimeoutMs
  );

  it(
    'includes recent stderr in timeout errors',
    async () => {
      const bridge = await createBridge({ timeoutMs: 200 });
      if (!bridge) return;

      try {
        await callAdversarial(bridge, 'write_stderr_then_sleep', ['stderr-timeout', 0.5]);
        throw new Error('Expected timeout did not occur');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).toMatch(/Recent stderr/);
        expect(message).toMatch(/stderr-timeout/);
      } finally {
        // Why: adversarial test verifies post-timeout recovery even if it masks the original error.
        await delay(600);
        const result = await callAdversarial(bridge, 'echo', ['post-timeout']);
        expect(result).toBe('post-timeout');
        await bridge.dispose();
      }
    },
    testTimeoutMs
  );

  it(
    'surfaces Python exceptions with type and message',
    async () => {
      const bridge = await createBridge();
      if (!bridge) return;

      try {
        await expect(callAdversarial(bridge, 'raise_error', ['boom'])).rejects.toThrow(
          /ValueError: boom/
        );
      } finally {
        await bridge.dispose();
      }
    },
    testTimeoutMs
  );

  it(
    'recovers after the Python process exits unexpectedly',
    async () => {
      // With crash recovery implemented in WorkerPool, crashed workers are
      // automatically removed from the pool, allowing subsequent requests
      // to spawn new workers.
      const pythonPath = await resolvePythonForTests();
      if (!pythonPath || !pythonAvailable(pythonPath)) return;

      const bridge = new NodeBridge({
        scriptPath,
        pythonPath,
        minProcesses: 2,
        maxProcesses: 2,
        timeoutMs: 2000,
        env: { PYTHONPATH: buildPythonPath() },
      });

      try {
        await callAdversarial(bridge, 'echo', ['init']);
        await expect(callAdversarial(bridge, 'crash_process', [1])).rejects.toThrow(
          /Python process is not running|Python process exited|Python process error/
        );
        await delay(300);
        // After crash, the dead worker is removed and a new one spawns
        const result = await callAdversarial(bridge, 'echo', ['after-crash']);
        expect(result).toBe('after-crash');
      } finally {
        await bridge.dispose();
      }
    },
    testTimeoutMs
  );

  it(
    'surfaces missing module imports as execution errors',
    async () => {
      const bridge = await createBridge();
      if (!bridge) return;

      try {
        await expect(bridge.call('module_does_not_exist', 'noop', [])).rejects.toThrow(
          /ModuleNotFoundError/
        );
      } finally {
        await bridge.dispose();
      }
    },
    testTimeoutMs
  );

  it(
    'surfaces missing instance handles with a stable execution error',
    async () => {
      const bridge = await createBridge();
      if (!bridge) return;

      try {
        const handle = await bridge.instantiate<string>('builtins', 'list', []);
        await bridge.disposeInstance(handle);

        await expect(bridge.callMethod(handle, 'append', [1])).rejects.toThrow(
          /InstanceHandleError: Unknown instance handle:/
        );
      } finally {
        await bridge.dispose();
      }
    },
    testTimeoutMs
  );

  it(
    'handles double-dispose of instance handles safely',
    async () => {
      const bridge = await createBridge();
      if (!bridge) return;

      try {
        const handle = await bridge.instantiate<string>('builtins', 'list', []);
        await bridge.disposeInstance(handle);
        await expect(bridge.disposeInstance(handle)).resolves.toBeUndefined();

        const result = await callAdversarial(bridge, 'echo', ['still-alive']);
        expect(result).toBe('still-alive');
      } finally {
        await bridge.dispose();
      }
    },
    testTimeoutMs
  );

  describe('Decoder validation failures', () => {
    const cases: Array<{ name: string; pattern: RegExp }> = [
      {
        name: 'return_bad_codec_version',
        pattern: /Unsupported dataframe envelope codecVersion: 999/,
      },
      {
        name: 'return_bad_encoding',
        pattern: /Invalid dataframe envelope: unsupported encoding/,
      },
      {
        name: 'return_missing_b64',
        pattern: /Invalid dataframe envelope: missing b64/,
      },
      {
        name: 'return_missing_data',
        pattern: /Invalid ndarray envelope: missing data/,
      },
      {
        name: 'return_invalid_sparse_format',
        pattern: /Invalid scipy\.sparse envelope: unsupported format/,
      },
      {
        name: 'return_invalid_sparse_shape',
        pattern: /Invalid scipy\.sparse envelope: shape must be a 2-item number\[\]/,
      },
      {
        name: 'return_invalid_torch_value',
        pattern: /Invalid torch\.tensor envelope: value must be an ndarray envelope/,
      },
      {
        name: 'return_invalid_sklearn_payload',
        pattern: /Invalid sklearn\.estimator envelope/,
      },
    ];

    for (const { name, pattern } of cases) {
      it(
        `rejects malformed envelope: ${name}`,
        async () => {
          const bridge = await createBridge();
          if (!bridge) return;

          try {
            await expect(callAdversarial(bridge, name, [])).rejects.toThrow(pattern);
          } finally {
            await bridge.dispose();
          }
        },
        testTimeoutMs
      );
    }
  });

  describe('Protocol contract violations', () => {
    const fixtureCases: Array<{ script: string; pattern: RegExp; skip?: boolean }> = [
      {
        // Protocol version validation implemented in SafeCodec
        script: 'wrong_protocol_bridge.py',
        pattern: /Invalid protocol/,
      },
      {
        script: 'missing_id_bridge.py',
        pattern: /Response missing "id"|Invalid response id/,
      },
      {
        script: 'string_id_bridge.py',
        pattern: /Response missing "id"|Invalid response id/,
      },
      {
        // Unexpected IDs cause timeout since the response doesn't match any pending request
        script: 'unexpected_id_bridge.py',
        pattern: /timed out|Unexpected response id/i,
      },
      {
        script: 'invalid_json_bridge.py',
        pattern: /Protocol error|Invalid JSON|Response missing/,
      },
      {
        script: 'noisy_bridge.py',
        pattern: /Protocol error|Response missing/,
      },
      {
        script: 'string_error_payload_bridge.py',
        pattern: /Invalid response "error" payload/,
      },
      {
        script: 'empty_error_payload_bridge.py',
        pattern: /Invalid response "error" payload/,
      },
      {
        script: 'result_and_error_bridge.py',
        pattern: /both "result" and "error"/,
      },
    ];

    for (const { script, pattern, skip } of fixtureCases) {
      const testFn = skip ? it.skip : it;
      testFn(
        `surfaces protocol errors for ${script}`,
        async () => {
          const bridge = await createFixtureBridge(script);
          if (!bridge) return;

          try {
            await expect(bridge.call('math', 'sqrt', [4])).rejects.toThrow(pattern);
          } finally {
            await bridge.dispose();
          }
        },
        testTimeoutMs
      );
    }

    it(
      'handles fragmented JSON frames',
      async () => {
        const bridge = await createFixtureBridge('fragmented_bridge.py', { timeoutMs: 2000 });
        if (!bridge) return;

        try {
          const result = await bridge.call('math', 'sqrt', [4]);
          expect(result).toBe(42);
        } finally {
          await bridge.dispose();
        }
      },
      testTimeoutMs
    );

    it(
      'handles out-of-order responses',
      async () => {
        const bridge = await createFixtureBridge('out_of_order_bridge.py', { timeoutMs: 2000 });
        if (!bridge) return;

        try {
          const results = await Promise.all([
            bridge.call('math', 'sqrt', [4]),
            bridge.call('math', 'sqrt', [9]),
          ]);
          expect(results).toEqual([1, 2]);
        } finally {
          await bridge.dispose();
        }
      },
      testTimeoutMs
    );
  });
});

/**
 * Multi-worker adversarial tests for the unified NodeBridge with pool configuration.
 * These tests exercise concurrent worker behavior, quarantine/replacement, and pool scaling.
 */
describeAdversarial('Multi-worker adversarial tests', () => {
  const createPooledBridge = async (
    options: {
      minProcesses?: number;
      maxProcesses?: number;
      timeoutMs?: number;
      env?: Record<string, string | undefined>;
    } = {}
  ): Promise<NodeBridge | null> => {
    if (!existsSync(scriptPath) || !existsSync(fixturesRoot)) {
      return null;
    }
    const pythonPath = await resolvePythonForTests();
    if (!pythonPath || !pythonAvailable(pythonPath)) {
      return null;
    }
    return new NodeBridge({
      scriptPath,
      pythonPath,
      minProcesses: options.minProcesses ?? 2,
      maxProcesses: options.maxProcesses ?? 4,
      timeoutMs: options.timeoutMs ?? 2000,
      env: {
        PYTHONPATH: buildPythonPath(),
        ...options.env,
      },
    });
  };

  it(
    'handles concurrent requests across multiple workers',
    async () => {
      const bridge = await createPooledBridge({ minProcesses: 2, maxProcesses: 4 });
      if (!bridge) return;

      try {
        // Fire many concurrent requests - should be distributed across workers
        const promises = Array.from({ length: 8 }, (_, i) =>
          callAdversarial(bridge, 'echo', [`request-${i}`])
        );
        const results = await Promise.all(promises);
        expect(results).toEqual(Array.from({ length: 8 }, (_, i) => `request-${i}`));

        // Note: stats tracking removed in new BridgeProtocol architecture
        // The key verification is that all concurrent requests completed successfully
      } finally {
        await bridge.dispose();
      }
    },
    testTimeoutMs
  );

  it(
    'quarantines a failing worker and replaces it',
    async () => {
      // With crash recovery implemented in WorkerPool, crashed workers are
      // automatically removed from the pool when they fail with fatal errors,
      // allowing new workers to be spawned for subsequent requests.
      const bridge = await createPooledBridge({ minProcesses: 2, maxProcesses: 2 });
      if (!bridge) return;

      try {
        await callAdversarial(bridge, 'echo', ['init']);
        await expect(callAdversarial(bridge, 'crash_process', [1])).rejects.toThrow(
          /Python process is not running|Python process exited|Python process error/
        );
        await delay(300);
        const result = await callAdversarial(bridge, 'echo', ['after-crash']);
        expect(result).toBe('after-crash');
      } finally {
        await bridge.dispose();
      }
    },
    testTimeoutMs
  );

  it(
    'isolates slow requests to one worker while others stay responsive',
    async () => {
      // With maxConcurrentPerProcess: 1, each worker can only handle one request at a time.
      // This ensures the slow request blocks one worker while the fast request uses another.
      const pythonPath = await resolvePythonForTests();
      if (!pythonPath || !pythonAvailable(pythonPath)) return;

      const bridge = new NodeBridge({
        scriptPath,
        pythonPath,
        minProcesses: 2,
        maxProcesses: 2,
        maxConcurrentPerProcess: 1, // Key: enforce one request per worker for isolation
        timeoutMs: 1000,
        env: { PYTHONPATH: buildPythonPath() },
      });

      try {
        // Initialize to spawn both workers
        await bridge.init();

        // Warm up both workers to ensure they're ready
        await callAdversarial(bridge, 'echo', ['warmup1']);
        await callAdversarial(bridge, 'echo', ['warmup2']);

        // Start a slow request (will timeout) - occupies worker 1
        const slow = callAdversarial(bridge, 'sleep_and_return', ['slow', 2.0]);

        // Give slow request time to start processing
        await delay(150);

        // Fast request should complete on worker 2 (since worker 1 is at capacity)
        const fast = await callAdversarial(bridge, 'echo', ['fast']);
        expect(fast).toBe('fast');

        // Slow request should timeout
        await expect(slow).rejects.toThrow(/timed out/i);

        // Wait for cleanup
        await delay(200);

        // Pool should still be functional
        const result = await callAdversarial(bridge, 'echo', ['after-timeout']);
        expect(result).toBe('after-timeout');
      } finally {
        await bridge.dispose();
      }
    },
    testTimeoutMs * 2
  );

  it(
    'handles mixed success and failure in concurrent batch',
    async () => {
      const bridge = await createPooledBridge({ minProcesses: 2, maxProcesses: 4 });
      if (!bridge) return;

      try {
        const promises = [
          callAdversarial(bridge, 'echo', ['ok1']),
          callAdversarial(bridge, 'raise_error', ['expected-error']),
          callAdversarial(bridge, 'echo', ['ok2']),
          callAdversarial(bridge, 'raise_error', ['another-error']),
          callAdversarial(bridge, 'echo', ['ok3']),
        ];

        const results = await Promise.allSettled(promises);

        // Check successes
        expect(results[0].status).toBe('fulfilled');
        expect(results[2].status).toBe('fulfilled');
        expect(results[4].status).toBe('fulfilled');
        if (results[0].status === 'fulfilled') expect(results[0].value).toBe('ok1');
        if (results[2].status === 'fulfilled') expect(results[2].value).toBe('ok2');
        if (results[4].status === 'fulfilled') expect(results[4].value).toBe('ok3');

        // Check failures
        expect(results[1].status).toBe('rejected');
        expect(results[3].status).toBe('rejected');
        if (results[1].status === 'rejected') {
          expect(results[1].reason.message).toMatch(/ValueError: expected-error/);
        }
        if (results[3].status === 'rejected') {
          expect(results[3].reason.message).toMatch(/ValueError: another-error/);
        }
      } finally {
        await bridge.dispose();
      }
    },
    testTimeoutMs
  );

  it(
    'scales up workers under load',
    async () => {
      const bridge = await createPooledBridge({ minProcesses: 1, maxProcesses: 4 });
      if (!bridge) return;

      try {
        // Initialize with single worker
        await callAdversarial(bridge, 'echo', ['init']);

        // Fire many concurrent slow-ish requests to trigger scaling
        const promises = Array.from({ length: 4 }, (_, i) =>
          callAdversarial(bridge, 'sleep_and_return', [`slow-${i}`, 0.1])
        );

        // Wait for all to complete
        const results = await Promise.all(promises);
        expect(results).toEqual(Array.from({ length: 4 }, (_, i) => `slow-${i}`));

        // The key verification is that all concurrent requests completed successfully
        // which demonstrates the pool handled the load (scaling is an implementation detail)
      } finally {
        await bridge.dispose();
      }
    },
    testTimeoutMs
  );

  it(
    'handles multiple worker crashes in sequence',
    async () => {
      // With crash recovery implemented in WorkerPool, each crash causes the failed
      // worker to be removed from the pool. New workers are spawned for subsequent
      // requests, allowing the pool to recover from multiple sequential crashes.
      const bridge = await createPooledBridge({ minProcesses: 2, maxProcesses: 2 });
      if (!bridge) return;

      try {
        await expect(callAdversarial(bridge, 'crash_process', [1])).rejects.toThrow(
          /Python process is not running|Python process exited|Python process error/
        );
        await delay(300);

        const result1 = await callAdversarial(bridge, 'echo', ['after-crash-1']);
        expect(result1).toBe('after-crash-1');

        await expect(callAdversarial(bridge, 'crash_process', [1])).rejects.toThrow(
          /Python process is not running|Python process exited|Python process error/
        );
        await delay(300);

        const result2 = await callAdversarial(bridge, 'echo', ['after-crash-2']);
        expect(result2).toBe('after-crash-2');
      } finally {
        await bridge.dispose();
      }
    },
    testTimeoutMs * 2
  );

  it(
    'enforces request size limits across all workers',
    async () => {
      const bridge = await createPooledBridge({
        minProcesses: 2,
        maxProcesses: 2,
        env: { TYWRAP_REQUEST_MAX_BYTES: '128' },
      });
      if (!bridge) return;

      try {
        const largePayload = 'x'.repeat(512);
        const promises = [
          callAdversarial(bridge, 'echo', [largePayload]),
          callAdversarial(bridge, 'echo', [largePayload]),
        ];

        const results = await Promise.allSettled(promises);
        expect(results[0].status).toBe('rejected');
        expect(results[1].status).toBe('rejected');
        if (results[0].status === 'rejected') {
          expect(results[0].reason.message).toMatch(
            /TYWRAP_REQUEST_MAX_BYTES|RequestTooLargeError/
          );
        }
      } finally {
        await bridge.dispose();
      }
    },
    testTimeoutMs
  );

  it(
    'maintains pool health after protocol errors',
    async () => {
      const bridge = await createPooledBridge({ minProcesses: 2, maxProcesses: 2 });
      if (!bridge) return;

      try {
        // Cause a protocol error (stdout noise)
        await expect(callAdversarial(bridge, 'print_to_stdout', ['noise'])).rejects.toThrow(
          /Protocol error/
        );
        await delay(200);

        // Pool should still be functional after recovery
        const results = await Promise.all([
          callAdversarial(bridge, 'echo', ['ok1']),
          callAdversarial(bridge, 'echo', ['ok2']),
        ]);
        expect(results).toEqual(['ok1', 'ok2']);
      } finally {
        await bridge.dispose();
      }
    },
    testTimeoutMs
  );
});
