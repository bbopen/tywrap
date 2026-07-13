import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NodeBridge } from '../../src/runtime/node.js';
import { isNodejs } from '../../src/utils/runtime.js';
import {
  hasPythonModule,
  pythonExprTruthy,
  PYTHON,
  PYTHON_AVAILABLE,
} from '../helpers/python-probe.js';

const scriptPath = join(process.cwd(), 'runtime', 'python_bridge.py');
const fixturesRoot = join(process.cwd(), 'test', 'menagerie');
const bridgeAvailable = isNodejs() && PYTHON_AVAILABLE && existsSync(scriptPath);

function hasPydanticV2(): boolean {
  return (
    hasPythonModule('pydantic') &&
    pythonExprTruthy(
      "from pydantic import BaseModel; print('1' if hasattr(BaseModel, 'model_dump') else '0')"
    )
  );
}

function makeBridge(): NodeBridge {
  const inherited = process.env.PYTHONPATH;
  return new NodeBridge({
    scriptPath,
    pythonPath: PYTHON ?? undefined,
    timeoutMs: 15_000,
    env: { PYTHONPATH: inherited ? `${fixturesRoot}${delimiter}${inherited}` : fixturesRoot },
  });
}

interface ArrowTableLike {
  toArray(): unknown[];
}

function tableRows(value: ArrowTableLike): unknown[] {
  return Array.from(value.toArray(), row =>
    typeof row === 'object' && row !== null ? Object.fromEntries(Object.entries(row)) : row
  );
}

describe.skipIf(!bridgeAvailable)('menagerie optional-library gate', () => {
  it.skipIf(!hasPydanticV2())(
    'round-trips pydantic v2 through model_dump',
    async () => {
      const bridge = makeBridge();
      try {
        await expect(
          bridge.call('fixtures.library_torture', 'pydantic_model_dump', [])
        ).resolves.toEqual({
          name: 'menagerie',
          count: 2,
        });
      } finally {
        await bridge.dispose();
      }
    },
    15_000
  );

  it.skipIf(!hasPythonModule('numpy') || !hasPythonModule('pyarrow'))(
    'round-trips ndarrays nested in a mapping while retaining scalar behavior',
    async () => {
      const bridge = makeBridge();
      try {
        await expect(
          bridge.call('fixtures.library_torture', 'numpy_adversarial', [])
        ).resolves.toEqual({
          array: [9007199254740993n, 9223372036854775807n],
          scalar: 9007199254740992,
          float_column: [1, 2.5],
        });
      } finally {
        await bridge.dispose();
      }
    },
    15_000
  );

  it.skipIf(!hasPythonModule('pandas') || !hasPythonModule('pyarrow'))(
    'round-trips timezone, categorical, MultiIndex, and empty frames nested in a mapping',
    async () => {
      const bridge = makeBridge();
      try {
        const result = await bridge.call<Record<string, ArrowTableLike>>(
          'fixtures.library_torture',
          'pandas_adversarial',
          []
        );
        expect(tableRows(result.frame)).toEqual([{ when: 1704067200000, category: 'a' }]);
        expect(tableRows(result.multi)).toEqual([{ value: 1n, side: 'left', n: 1n }]);
        expect(tableRows(result.empty)).toEqual([]);
      } finally {
        await bridge.dispose();
      }
    },
    15_000
  );

  it.skipIf(!hasPythonModule('pandas') || !hasPythonModule('pyarrow'))(
    'round-trips DataFrames nested in a list',
    async () => {
      const bridge = makeBridge();
      try {
        const result = await bridge.call<ArrowTableLike[]>(
          'fixtures.library_torture',
          'pandas_nested_list',
          []
        );
        expect(result.map(tableRows)).toEqual([[{ value: 1n }], [{ value: 2n }]]);
      } finally {
        await bridge.dispose();
      }
    },
    15_000
  );

  it.skipIf(!hasPythonModule('networkx'))(
    'rejects tuple-key graph dictionaries loudly',
    async () => {
      const bridge = makeBridge();
      try {
        await expect(
          bridge.call('fixtures.library_torture', 'networkx_tuple_key_shape', [])
        ).rejects.toThrow();
      } finally {
        await bridge.dispose();
      }
    },
    15_000
  );
});
