import { describe, it, expect } from 'vitest';
import { decodeValue } from '../src/utils/codec.js';
import { isNodejs } from '../src/utils/runtime.js';

const shouldRun = isNodejs() && (process.env.CI || process.env.TYWRAP_PERF_BUDGETS === '1');
const describeBudget = shouldRun ? describe : describe.skip;

const readEnvNumber = (name: string, fallback: string): number =>
  Number(process.env[name] ?? fallback);

const runGc = (): void => {
  if (global.gc) {
    global.gc();
  }
};

describeBudget('Codec performance budgets', () => {
  it('decodes representative envelopes within time/memory budgets', () => {
    const iterations = readEnvNumber('TYWRAP_CODEC_PERF_ITERATIONS', '200');
    const timeBudgetMs = readEnvNumber('TYWRAP_CODEC_PERF_TIME_BUDGET_MS', '500');
    const memoryBudgetMb = readEnvNumber('TYWRAP_CODEC_PERF_MEMORY_BUDGET_MB', '32');
    const memoryBudgetBytes = memoryBudgetMb * 1024 * 1024;

    const sparseEnvelope = {
      __tywrap__: 'scipy.sparse',
      codecVersion: 1,
      encoding: 'json',
      format: 'csr',
      shape: [100, 100],
      data: Array.from({ length: 200 }, (_, idx) => idx % 7),
      indices: Array.from({ length: 200 }, (_, idx) => idx % 100),
      indptr: Array.from({ length: 101 }, (_, idx) => Math.min(idx * 2, 200)),
    } as const;

    const torchEnvelope = {
      __tywrap__: 'torch.tensor',
      codecVersion: 1,
      encoding: 'ndarray',
      value: {
        __tywrap__: 'ndarray',
        codecVersion: 1,
        encoding: 'json',
        data: [
          [1, 2],
          [3, 4],
        ],
        shape: [2, 2],
      },
      shape: [2, 2],
      dtype: 'float32',
      device: 'cpu',
    } as const;

    const sklearnEnvelope = {
      __tywrap__: 'sklearn.estimator',
      codecVersion: 1,
      encoding: 'json',
      className: 'LinearRegression',
      module: 'sklearn.linear_model._base',
      version: '1.4.2',
      params: {
        fit_intercept: true,
        copy_X: true,
      },
    } as const;

    runGc();
    const startMem = process.memoryUsage().heapUsed;
    const start = performance.now();

    for (let i = 0; i < iterations; i += 1) {
      decodeValue(sparseEnvelope);
      decodeValue(torchEnvelope);
      decodeValue(sklearnEnvelope);
    }

    const duration = performance.now() - start;
    runGc();
    const endMem = process.memoryUsage().heapUsed;
    const deltaMem = endMem - startMem;

    expect(duration).toBeLessThan(timeBudgetMs);
    expect(deltaMem).toBeLessThan(memoryBudgetBytes);
  });
});
