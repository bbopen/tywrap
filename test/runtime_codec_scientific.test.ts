/**
 * Scientific codec integration tests (SciPy, Torch, Sklearn)
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { NodeBridge } from '../src/runtime/node.js';
import { resolvePythonExecutable } from '../src/utils/python.js';
import { isNodejs } from '../src/utils/runtime.js';

const describeNodeOnly = isNodejs() ? describe : describe.skip;

const scriptPath = 'runtime/python_bridge.py';
const isCi =
  ['1', 'true'].includes((process.env.CI ?? '').toLowerCase()) ||
  ['1', 'true'].includes((process.env.GITHUB_ACTIONS ?? '').toLowerCase()) ||
  ['1', 'true'].includes((process.env.ACT ?? '').toLowerCase());
const scientificTimeoutMs = isCi ? 60_000 : 30_000;
const bridgeTimeoutMs = isCi ? 60_000 : 30_000;

const resolvePythonForTests = async (): Promise<string | null> => {
  const explicit = process.env.TYWRAP_CODEC_PYTHON?.trim();
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

const hasModule = (pythonPath: string, moduleName: string): boolean => {
  const res = spawnSync(pythonPath, ['-c', `import ${moduleName}`], { encoding: 'utf-8' });
  return res.status === 0;
};

describeNodeOnly('Scientific Codecs', () => {
  it(
    'serializes scipy sparse matrices',
    async () => {
      const pythonPath = await resolvePythonForTests();
      if (!pythonAvailable(pythonPath) || !existsSync(scriptPath)) return;
      if (!pythonPath || !hasModule(pythonPath, 'scipy')) return;

      const bridge = new NodeBridge({
        scriptPath,
        pythonPath,
        enableJsonFallback: true,
        timeoutMs: bridgeTimeoutMs,
      });

      try {
        const result = await bridge.call<{
          format: string;
          shape: number[];
          data: unknown[];
          indices?: number[];
          indptr?: number[];
        }>('scipy.sparse', 'csr_matrix', [
          [
            [1, 0],
            [0, 2],
          ],
        ]);

        expect(result.format).toBe('csr');
        expect(result.shape).toEqual([2, 2]);
        expect(result.data).toEqual([1, 2]);
        expect(result.indices).toEqual([0, 1]);
        expect(result.indptr).toEqual([0, 1, 2]);
      } finally {
        await bridge.dispose();
      }
    },
    scientificTimeoutMs
  );

  it(
    'serializes torch tensors',
    async () => {
      const pythonPath = await resolvePythonForTests();
      if (!pythonAvailable(pythonPath) || !existsSync(scriptPath)) return;
      if (!pythonPath || !hasModule(pythonPath, 'torch')) return;

      const bridge = new NodeBridge({
        scriptPath,
        pythonPath,
        enableJsonFallback: true,
        timeoutMs: bridgeTimeoutMs,
      });

      try {
        const result = await bridge.call<{
          data: unknown;
          shape?: number[];
          dtype?: string;
          device?: string;
        }>('torch', 'tensor', [
          [
            [1, 2],
            [3, 4],
          ],
        ]);

        expect(result.shape).toEqual([2, 2]);
        expect(result.device).toBe('cpu');
        expect(result.data).toEqual([
          [1, 2],
          [3, 4],
        ]);
      } finally {
        await bridge.dispose();
      }
    },
    scientificTimeoutMs
  );

  it(
    'serializes sklearn estimators',
    async () => {
      const pythonPath = await resolvePythonForTests();
      if (!pythonAvailable(pythonPath) || !existsSync(scriptPath)) return;
      if (!pythonPath || !hasModule(pythonPath, 'sklearn')) return;

      const bridge = new NodeBridge({
        scriptPath,
        pythonPath,
        enableJsonFallback: true,
        timeoutMs: bridgeTimeoutMs,
      });

      try {
        const result = await bridge.call<{
          className: string;
          module: string;
          params: Record<string, unknown>;
        }>('sklearn.linear_model', 'LinearRegression', []);

        expect(result.className).toBe('LinearRegression');
        expect(result.module).toContain('sklearn');
        expect(result.params).toHaveProperty('fit_intercept');
      } finally {
        await bridge.dispose();
      }
    },
    scientificTimeoutMs
  );
});
