/**
 * Scientific codec integration tests (SciPy, Torch, Sklearn)
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { NodeBridge } from '../src/runtime/node.js';
import { isNodejs } from '../src/utils/runtime.js';
import { PYTHON, PYTHON_AVAILABLE, hasPythonModule } from './helpers/python-probe.js';

const describeNodeOnly = isNodejs() ? describe : describe.skip;

const scriptPath = 'runtime/python_bridge.py';
const isCi =
  ['1', 'true'].includes((process.env.CI ?? '').toLowerCase()) ||
  ['1', 'true'].includes((process.env.GITHUB_ACTIONS ?? '').toLowerCase()) ||
  ['1', 'true'].includes((process.env.ACT ?? '').toLowerCase());
const scientificTimeoutMs = isCi ? 60_000 : 30_000;
const bridgeTimeoutMs = isCi ? 60_000 : 30_000;

// Synchronous availability gates feeding it.skipIf(...). A missing interpreter or
// scientific module makes the test SKIP loudly instead of silently early-returning
// (which would report a vacuous pass). PYTHON is the resolved interpreter path.
const BASE_OK = PYTHON_AVAILABLE && existsSync(scriptPath);
const SCIPY_OK = BASE_OK && hasPythonModule('scipy');
const SKLEARN_OK = BASE_OK && hasPythonModule('sklearn');
const ARROW_OK = BASE_OK && hasPythonModule('pyarrow');
const NUMPY_ARROW_OK = ARROW_OK && hasPythonModule('numpy');
const TORCH_ARROW_OK = ARROW_OK && hasPythonModule('torch');
// PYTHON is non-null whenever any *_OK gate is true; this assertion keeps the
// bridge constructor calls below type-safe without re-probing inside each test.
const pythonPath = PYTHON as string;

describeNodeOnly('Scientific Codecs', () => {
  it.skipIf(!SCIPY_OK)(
    'serializes scipy sparse matrices',
    async () => {
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

  // Torch tensor serialization requires pyarrow for Arrow encoding of ndarrays.
  // Multi-dimensional arrays are flattened on encode and reshaped on decode.
  it.skipIf(!TORCH_ARROW_OK)(
    'serializes torch tensors',
    async () => {
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

  it.skipIf(!SKLEARN_OK)(
    'serializes sklearn estimators',
    async () => {
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
 * #234 envelope hardening — torch device/contiguous opt-in behavior end to end
 * over the real subprocess bridge. A CPU non-contiguous tensor (`.t()` of a 2D
 * tensor) is the portable, GPU-free way to exercise the TYWRAP_TORCH_ALLOW_COPY
 * gate: rejected by default, accepted (with a contiguous copy) when opted in.
 */
const TORCH_OK = BASE_OK && hasPythonModule('torch');

describeNodeOnly('Torch opt-in copy (#234)', () => {
  it.skipIf(!TORCH_OK)(
    'rejects a non-contiguous tensor by default',
    async () => {
      const bridge = new NodeBridge({
        scriptPath,
        pythonPath,
        enableJsonFallback: true,
        timeoutMs: bridgeTimeoutMs,
      });
      try {
        await expect(
          bridge.call('builtins', 'eval', [
            '__import__("torch").tensor([[1.0, 2.0], [3.0, 4.0]]).t()',
          ])
        ).rejects.toThrow(/not contiguous/);
      } finally {
        await bridge.dispose();
      }
    },
    scientificTimeoutMs
  );

  it.skipIf(!TORCH_OK)(
    'accepts a non-contiguous tensor when TYWRAP_TORCH_ALLOW_COPY=1 (opt-in)',
    async () => {
      const bridge = new NodeBridge({
        scriptPath,
        pythonPath,
        enableJsonFallback: true,
        env: { TYWRAP_TORCH_ALLOW_COPY: '1' },
        timeoutMs: bridgeTimeoutMs,
      });
      try {
        const result = await bridge.call<{
          data: unknown;
          shape?: number[];
          device?: string;
        }>('builtins', 'eval', ['__import__("torch").tensor([[1.0, 2.0], [3.0, 4.0]]).t()']);
        // .t() of [[1,2],[3,4]] is [[1,3],[2,4]]; the contiguous copy round-trips.
        expect(result.shape).toEqual([2, 2]);
        expect(result.device).toBe('cpu');
        expect(result.data).toEqual([
          [1, 3],
          [2, 4],
        ]);
      } finally {
        await bridge.dispose();
      }
    },
    scientificTimeoutMs
  );

  it.skipIf(!TORCH_OK)(
    'still rejects a complex tensor even with TYWRAP_TORCH_ALLOW_COPY=1 (categorical, not opt-in-able)',
    async () => {
      const bridge = new NodeBridge({
        scriptPath,
        pythonPath,
        enableJsonFallback: true,
        env: { TYWRAP_TORCH_ALLOW_COPY: '1' },
        timeoutMs: bridgeTimeoutMs,
      });
      try {
        await expect(
          bridge.call('builtins', 'eval', ['__import__("torch").tensor([1+2j, 3+4j])'])
        ).rejects.toThrow(/[Cc]omplex tensors are not supported/);
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
  it.skipIf(!NUMPY_ARROW_OK)(
    'handles 1D arrays (no reshape needed)',
    async () => {
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

  it.skipIf(!NUMPY_ARROW_OK)(
    'handles 3D arrays',
    async () => {
      const bridge = new NodeBridge({
        scriptPath,
        pythonPath,
        timeoutMs: bridgeTimeoutMs,
      });

      try {
        // Create a 2x3x4 array via numpy.arange().reshape()
        // We'll use builtins.eval to construct this
        const result = await bridge.call<number[][][]>('builtins', 'eval', [
          '__import__("numpy").arange(24).reshape(2, 3, 4).tolist()',
        ]);

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

  it.skipIf(!TORCH_ARROW_OK)(
    'handles 3D torch tensors with Arrow encoding',
    async () => {
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
            [
              [1, 2],
              [3, 4],
              [5, 6],
            ],
            [
              [7, 8],
              [9, 10],
              [11, 12],
            ],
          ],
        ]);

        expect(result.shape).toEqual([2, 3, 2]);
        expect(result.device).toBe('cpu');
        expect(result.data).toEqual([
          [
            [1, 2],
            [3, 4],
            [5, 6],
          ],
          [
            [7, 8],
            [9, 10],
            [11, 12],
          ],
        ]);
      } finally {
        await bridge.dispose();
      }
    },
    scientificTimeoutMs
  );

  it.skipIf(!NUMPY_ARROW_OK)(
    'handles single-element arrays',
    async () => {
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

  it.skipIf(!TORCH_ARROW_OK)(
    'handles single-element multi-dimensional arrays',
    async () => {
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

  it.skipIf(!TORCH_ARROW_OK)(
    'preserves dtype for float arrays',
    async () => {
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
          [
            [1.5, 2.5],
            [3.5, 4.5],
          ],
        ]);

        expect(result.shape).toEqual([2, 2]);
        expect(result.data).toEqual([
          [1.5, 2.5],
          [3.5, 4.5],
        ]);
        // dtype should be float32 or float64
        expect(result.dtype).toMatch(/float/);
      } finally {
        await bridge.dispose();
      }
    },
    scientificTimeoutMs
  );

  it.skipIf(!TORCH_ARROW_OK)(
    'handles 4D tensors (image-like batches)',
    async () => {
      const bridge = new NodeBridge({
        scriptPath,
        pythonPath,
        timeoutMs: bridgeTimeoutMs,
      });

      try {
        // Create a 2x2x2x2 tensor (batch x channels x height x width)
        const input = [
          [
            [
              [1, 2],
              [3, 4],
            ],
            [
              [5, 6],
              [7, 8],
            ],
          ],
          [
            [
              [9, 10],
              [11, 12],
            ],
            [
              [13, 14],
              [15, 16],
            ],
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
