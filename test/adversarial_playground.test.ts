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
});
