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
      // Torch tensor serialization requires pyarrow for Arrow encoding of ndarrays
      // Multi-dimensional arrays are flattened on encode and reshaped on decode
      if (!hasModule(pythonPath, 'pyarrow')) return;

      const bridge = new NodeBridge({
        scriptPath,
        pythonPath,
        // Use Arrow encoding (pyarrow required) - flatten+reshape handles multi-dim arrays
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

/**
 * ndarray flatten+reshape tests
 * Tests the Arrow encoding path where multi-dimensional arrays are flattened
 * on Python side and reshaped on JS side.
 */
describeNodeOnly('ndarray Flatten+Reshape', () => {
  it(
    'handles 1D arrays (no reshape needed)',
    async () => {
      const pythonPath = await resolvePythonForTests();
      if (!pythonAvailable(pythonPath) || !existsSync(scriptPath)) return;
      if (!pythonPath || !hasModule(pythonPath, 'numpy')) return;
      if (!hasModule(pythonPath, 'pyarrow')) return;

      const bridge = new NodeBridge({
        scriptPath,
        pythonPath,
        timeoutMs: bridgeTimeoutMs,
      });

      try {
        const result = await bridge.call<number[]>('numpy', 'array', [[1, 2, 3, 4, 5]]);
        expect(result).toEqual([1, 2, 3, 4, 5]);
      } finally {
        await bridge.dispose();
      }
    },
    scientificTimeoutMs
  );

  it(
    'handles 3D arrays',
    async () => {
      const pythonPath = await resolvePythonForTests();
      if (!pythonAvailable(pythonPath) || !existsSync(scriptPath)) return;
      if (!pythonPath || !hasModule(pythonPath, 'numpy')) return;
      if (!hasModule(pythonPath, 'pyarrow')) return;

      const bridge = new NodeBridge({
        scriptPath,
        pythonPath,
        timeoutMs: bridgeTimeoutMs,
      });

      try {
        // Create a 2x3x4 array via numpy.arange().reshape()
        // We'll use builtins.eval to construct this
        const result = await bridge.call<number[][][]>(
          'builtins',
          'eval',
          ['__import__("numpy").arange(24).reshape(2, 3, 4).tolist()']
        );

        // Verify shape by checking nested structure
        expect(result.length).toBe(2);
        expect(result[0].length).toBe(3);
        expect(result[0][0].length).toBe(4);
        // Verify values
        expect(result[0][0]).toEqual([0, 1, 2, 3]);
        expect(result[1][2]).toEqual([20, 21, 22, 23]);
      } finally {
        await bridge.dispose();
      }
    },
    scientificTimeoutMs
  );

  it(
    'handles 3D torch tensors with Arrow encoding',
    async () => {
      const pythonPath = await resolvePythonForTests();
      if (!pythonAvailable(pythonPath) || !existsSync(scriptPath)) return;
      if (!pythonPath || !hasModule(pythonPath, 'torch')) return;
      if (!hasModule(pythonPath, 'pyarrow')) return;

      const bridge = new NodeBridge({
        scriptPath,
        pythonPath,
        timeoutMs: bridgeTimeoutMs,
      });

      try {
        // Create a 2x3x2 tensor
        const result = await bridge.call<{
          data: number[][][];
          shape?: number[];
          dtype?: string;
          device?: string;
        }>('torch', 'tensor', [
          [
            [[1, 2], [3, 4], [5, 6]],
            [[7, 8], [9, 10], [11, 12]],
          ],
        ]);

        expect(result.shape).toEqual([2, 3, 2]);
        expect(result.device).toBe('cpu');
        expect(result.data).toEqual([
          [[1, 2], [3, 4], [5, 6]],
          [[7, 8], [9, 10], [11, 12]],
        ]);
      } finally {
        await bridge.dispose();
      }
    },
    scientificTimeoutMs
  );

  it(
    'handles single-element arrays',
    async () => {
      const pythonPath = await resolvePythonForTests();
      if (!pythonAvailable(pythonPath) || !existsSync(scriptPath)) return;
      if (!pythonPath || !hasModule(pythonPath, 'numpy')) return;
      if (!hasModule(pythonPath, 'pyarrow')) return;

      const bridge = new NodeBridge({
        scriptPath,
        pythonPath,
        timeoutMs: bridgeTimeoutMs,
      });

      try {
        const result = await bridge.call<number[]>('numpy', 'array', [[42]]);
        expect(result).toEqual([42]);
      } finally {
        await bridge.dispose();
      }
    },
    scientificTimeoutMs
  );

  it(
    'handles single-element multi-dimensional arrays',
    async () => {
      const pythonPath = await resolvePythonForTests();
      if (!pythonAvailable(pythonPath) || !existsSync(scriptPath)) return;
      if (!pythonPath || !hasModule(pythonPath, 'torch')) return;
      if (!hasModule(pythonPath, 'pyarrow')) return;

      const bridge = new NodeBridge({
        scriptPath,
        pythonPath,
        timeoutMs: bridgeTimeoutMs,
      });

      try {
        // Create a 1x1x1 tensor
        const result = await bridge.call<{
          data: number[][][];
          shape?: number[];
        }>('torch', 'tensor', [[[[99]]]]);

        expect(result.shape).toEqual([1, 1, 1]);
        expect(result.data).toEqual([[[99]]]);
      } finally {
        await bridge.dispose();
      }
    },
    scientificTimeoutMs
  );

  it(
    'preserves dtype for float arrays',
    async () => {
      const pythonPath = await resolvePythonForTests();
      if (!pythonAvailable(pythonPath) || !existsSync(scriptPath)) return;
      if (!pythonPath || !hasModule(pythonPath, 'torch')) return;
      if (!hasModule(pythonPath, 'pyarrow')) return;

      const bridge = new NodeBridge({
        scriptPath,
        pythonPath,
        timeoutMs: bridgeTimeoutMs,
      });

      try {
        const result = await bridge.call<{
          data: number[][];
          shape?: number[];
          dtype?: string;
        }>('torch', 'tensor', [
          [[1.5, 2.5], [3.5, 4.5]],
        ]);

        expect(result.shape).toEqual([2, 2]);
        expect(result.data).toEqual([[1.5, 2.5], [3.5, 4.5]]);
        // dtype should be float32 or float64
        expect(result.dtype).toMatch(/float/);
      } finally {
        await bridge.dispose();
      }
    },
    scientificTimeoutMs
  );

  it(
    'handles 4D tensors (image-like batches)',
    async () => {
      const pythonPath = await resolvePythonForTests();
      if (!pythonAvailable(pythonPath) || !existsSync(scriptPath)) return;
      if (!pythonPath || !hasModule(pythonPath, 'torch')) return;
      if (!hasModule(pythonPath, 'pyarrow')) return;

      const bridge = new NodeBridge({
        scriptPath,
        pythonPath,
        timeoutMs: bridgeTimeoutMs,
      });

      try {
        // Create a 2x2x2x2 tensor (batch x channels x height x width)
        const input = [
          [
            [[1, 2], [3, 4]],
            [[5, 6], [7, 8]],
          ],
          [
            [[9, 10], [11, 12]],
            [[13, 14], [15, 16]],
          ],
        ];

        const result = await bridge.call<{
          data: number[][][][];
          shape?: number[];
        }>('torch', 'tensor', [input]);

        expect(result.shape).toEqual([2, 2, 2, 2]);
        expect(result.data).toEqual(input);
      } finally {
        await bridge.dispose();
      }
    },
    scientificTimeoutMs
  );
});
