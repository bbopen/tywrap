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

  it.skipIf(!hasPythonModule('numpy'))(
    'records numpy scalar, int64, and NaN behavior',
    async () => {
      const bridge = makeBridge();
      try {
        await expect(
          bridge.call('fixtures.library_torture', 'numpy_adversarial', [])
        ).rejects.toThrow(/NaN|Infinity|serialize|ndarray/i);
      } finally {
        await bridge.dispose();
      }
    },
    15_000
  );

  it.skipIf(!hasPythonModule('pandas'))(
    'fails loudly for timezone, categorical, MultiIndex, and empty frames nested in a mapping',
    async () => {
      const bridge = makeBridge();
      try {
        await expect(
          bridge.call('fixtures.library_torture', 'pandas_adversarial', [])
        ).rejects.toThrow(/DataFrame|serialize/i);
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
