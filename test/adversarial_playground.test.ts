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
    process.env.TYWRAP_ADVERSARIAL_PYTHON?.trim() ||
    process.env.TYWRAP_CODEC_PYTHON?.trim();
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
  if (!pythonAvailable(pythonPath)) {
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
  if (!pythonAvailable(pythonPath)) {
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

const delay = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

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
          /Protocol error from Python bridge|Invalid JSON/
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
          /Protocol error from Python bridge/
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
      const bridge = await createBridge();
      if (!bridge) return;

      try {
        await expect(callAdversarial(bridge, 'crash_process', [1])).rejects.toThrow(
          /Python process exited|Python process error/
        );
        await delay(200);

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
    const fixtureCases: Array<{ script: string; pattern: RegExp }> = [
      {
        script: 'wrong_protocol_bridge.py',
        pattern: /Invalid protocol/,
      },
      {
        script: 'missing_id_bridge.py',
        pattern: /Invalid response id/,
      },
      {
        script: 'string_id_bridge.py',
        pattern: /Invalid response id/,
      },
      {
        script: 'unexpected_id_bridge.py',
        pattern: /Unexpected response id/,
      },
      {
        script: 'invalid_json_bridge.py',
        pattern: /Invalid JSON/,
      },
      {
        script: 'noisy_bridge.py',
        pattern: /Protocol error from Python bridge/,
      },
    ];

    for (const { script, pattern } of fixtureCases) {
      it(
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
