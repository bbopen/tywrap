import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BridgeValidationError } from '../src/runtime/errors.js';
import { DecodedProvenance } from '../src/runtime/decoded-provenance.js';
import { HttpBridge } from '../src/runtime/http.js';
import { NodeBridge } from '../src/runtime/node.js';
import {
  createReturnValidator,
  describeReceivedShape,
  selectOverloadReturnValidator,
  tagDecodedShape,
  type ReturnSchema,
} from '../src/runtime/validators.js';
import { PYTHON_AVAILABLE, PYTHON } from './helpers/python-probe.js';

describe('generated return validators', () => {
  it('rejects a mistyped primitive return with its generated call site', () => {
    const validator = createReturnValidator(
      { kind: 'primitive', type: 'number' },
      'fixture.answer'
    );
    expect(() => validator('not a number')).toThrow(BridgeValidationError);
    expect(() => validator('not a number')).toThrow(
      /fixture\.answer.*expected number, received string/
    );
    expect(validator(42)).toBe(42);
  });

  it('checks the value contract number constraints at nested paths', () => {
    const validator = createReturnValidator(
      {
        kind: 'record',
        values: { kind: 'primitive', type: 'number', constraint: 'safe-integer' },
      },
      'fixture.counts'
    );
    expect(validator({ count: 42 })).toEqual({ count: 42 });
    expect(() => validator({ count: 1.5 })).toThrow(BridgeValidationError);
    expect(() => validator({ count: Number.MAX_SAFE_INTEGER + 1 })).toThrow(BridgeValidationError);
  });

  it('requires bigint at each exact integer position', () => {
    const validator = createReturnValidator(
      {
        kind: 'record',
        fields: {
          values: {
            schema: { kind: 'array', element: { kind: 'primitive', type: 'bigint' } },
          },
        },
      },
      'fixture.exactValues'
    );
    expect(validator({ values: [1n, 18446744073709551617n] })).toEqual({
      values: [1n, 18446744073709551617n],
    });
    expect(() => validator({ values: [1, 2n] })).toThrow(BridgeValidationError);
    expect(() => validator({ values: ['1'] })).toThrow(/expected bigint, received string/);
  });

  it('requires per-call provenance for a scalar float16 ndarray', () => {
    const validate = createReturnValidator<number>(
      { kind: 'marker', marker: 'ndarray', dims: 0, dtype: 'float16' },
      'fixture.scalar'
    );
    const valid = new DecodedProvenance();
    valid.recordRoot({ marker: 'ndarray', dims: 0, dtype: 'float16' });
    const wrongDtype = new DecodedProvenance();
    wrongDtype.recordRoot({ marker: 'ndarray', dims: 0, dtype: 'float32' });
    const wrongShape = new DecodedProvenance();
    wrongShape.recordRoot({ marker: 'ndarray', dims: 1, dtype: 'float16' });

    expect(() => validate(1.5)).toThrow(BridgeValidationError);
    expect(validate(1.5, valid)).toBe(1.5);
    expect(() => validate(1.5, wrongDtype)).toThrow(BridgeValidationError);
    expect(() => validate(1.5, wrongShape)).toThrow(BridgeValidationError);
    expect(validate(1.5, valid)).toBe(1.5);
  });

  it('checks nested scalar proofs at array indices and record keys', () => {
    const scalar = { kind: 'marker', marker: 'ndarray', dims: 0, dtype: 'float16' } as const;
    const rows = [[1.5]];
    const result = { rows, scalar: 1.5 };
    const proof = new DecodedProvenance();
    proof.recordChild(rows[0]!, 0, { marker: 'ndarray', dims: 0, dtype: 'float16' });
    proof.recordChild(result, 'scalar', { marker: 'ndarray', dims: 0, dtype: 'float16' });
    const validate = createReturnValidator(
      {
        kind: 'record',
        fields: {
          rows: { schema: { kind: 'array', element: { kind: 'tuple', elements: [scalar] } } },
          scalar: { schema: scalar },
        },
      },
      'fixture.nestedScalar'
    );
    expect(validate(result, proof)).toBe(result);
    expect(() => validate(result)).toThrow(BridgeValidationError);

    const stringIndex = new DecodedProvenance();
    stringIndex.recordChild(rows[0]!, '0', { marker: 'ndarray', dims: 0, dtype: 'float16' });
    stringIndex.recordChild(result, 'scalar', { marker: 'ndarray', dims: 0, dtype: 'float16' });
    expect(validate(result, stringIndex)).toBe(result);

    const wrongIndex = new DecodedProvenance();
    wrongIndex.recordChild(rows[0]!, 1, { marker: 'ndarray', dims: 0, dtype: 'float16' });
    wrongIndex.recordChild(result, 'scalar', { marker: 'ndarray', dims: 0, dtype: 'float16' });
    expect(() => validate(result, wrongIndex)).toThrow(BridgeValidationError);

    const other = { rows: [[1.5]], scalar: 1.5 };
    expect(() => validate(other, proof)).toThrow(BridgeValidationError);
  });

  it('uses declaration order when an optional-arity overload also matches', () => {
    const stringValue = { kind: 'primitive', type: 'string' } as const;
    const integerValue = { kind: 'primitive', type: 'number', constraint: 'safe-integer' } as const;
    const overloads = [
      {
        parameters: [
          { name: 'value', kind: 'positional-or-keyword', optional: false, value: stringValue },
        ],
        result: stringValue,
        selectable: true,
      },
      {
        parameters: [
          { name: 'value', kind: 'positional-or-keyword', optional: false, value: stringValue },
          { name: 'base', kind: 'positional-or-keyword', optional: true, value: integerValue },
        ],
        result: integerValue,
        selectable: true,
      },
    ] as const;
    const fallback = createReturnValidator({ kind: 'any' }, 'fixture.ambiguous');
    const oneArg = selectOverloadReturnValidator(
      overloads,
      ['key'],
      undefined,
      fallback,
      'fixture.ambiguous'
    );
    const twoArgs = selectOverloadReturnValidator(
      overloads,
      ['key', 2],
      undefined,
      fallback,
      'fixture.ambiguous'
    );
    expect(() => oneArg(4)).toThrow(BridgeValidationError);
    expect(oneArg('text')).toBe('text');
    expect(twoArgs(4)).toBe(4);
  });

  it('checks unions, optionals, tuples, TypedDict records, and no-op schemas', () => {
    const schema: ReturnSchema = {
      kind: 'tuple',
      elements: [
        {
          kind: 'union',
          options: [
            { kind: 'primitive', type: 'number' },
            { kind: 'primitive', type: 'null' },
          ],
        },
        { kind: 'ref', name: 'Movie' },
      ],
    };
    const validator = createReturnValidator(schema, 'fixture.movie', {
      Movie: {
        kind: 'record',
        fields: {
          title: { schema: { kind: 'primitive', type: 'string' } },
          year: { schema: { kind: 'primitive', type: 'number' } },
          tagline: { schema: { kind: 'primitive', type: 'string' }, optional: true },
        },
      },
    });
    expect(validator([null, { title: 'Alien', year: 1979 }])).toEqual([
      null,
      { title: 'Alien', year: 1979 },
    ]);
    expect(() => validator([false, { title: 'Alien', year: '1979' }])).toThrow(
      BridgeValidationError
    );
    expect(createReturnValidator({ kind: 'any' }, 'fixture.any')({ wrong: 'by design' })).toEqual({
      wrong: 'by design',
    });
  });

  it('uses decoded columnar provenance and never walks Arrow table elements', () => {
    const table = new Proxy(
      { numRows: 1, numCols: 1 },
      {
        get(target, property, receiver) {
          if (property === 'numRows' || property === 'numCols')
            return Reflect.get(target, property, receiver);
          throw new Error(`unexpected deep table access: ${String(property)}`);
        },
        ownKeys() {
          throw new Error('unexpected table enumeration');
        },
      }
    );
    tagDecodedShape(table, { marker: 'dataframe' });
    expect(
      createReturnValidator({ kind: 'marker', marker: 'dataframe' }, 'fixture.frame')(table)
    ).toBe(table);

    const array = tagDecodedShape([[1, 2]], { marker: 'ndarray', dims: 2, dtype: 'float64' });
    expect(
      createReturnValidator(
        { kind: 'marker', marker: 'ndarray', dims: 2, dtype: 'float64' },
        'fixture.matrix'
      )(array)
    ).toBe(array);
    expect(() =>
      createReturnValidator(
        { kind: 'marker', marker: 'ndarray', dims: 1, dtype: 'int64' },
        'fixture.matrix'
      )(array)
    ).toThrow(BridgeValidationError);
  });

  it('checks scientific marker, dimension, and dtype provenance', () => {
    const sparse = tagDecodedShape(
      {},
      {
        marker: 'scipy.sparse',
        dims: 2,
        dtype: 'float64',
      }
    );
    expect(
      createReturnValidator(
        { kind: 'marker', marker: 'scipy.sparse', dims: 2, dtype: 'float64' },
        'fixture.sparse'
      )(sparse)
    ).toBe(sparse);
    expect(() =>
      createReturnValidator(
        { kind: 'marker', marker: 'torch.tensor', dims: 2, dtype: 'float64' },
        'fixture.sparse'
      )(sparse)
    ).toThrow(BridgeValidationError);
    expect(() =>
      createReturnValidator(
        { kind: 'marker', marker: 'scipy.sparse', dims: 1, dtype: 'float64' },
        'fixture.sparse'
      )(sparse)
    ).toThrow(BridgeValidationError);
    expect(() =>
      createReturnValidator(
        { kind: 'marker', marker: 'scipy.sparse', dims: 2, dtype: 'int64' },
        'fixture.sparse'
      )(sparse)
    ).toThrow(BridgeValidationError);

    const tensor = tagDecodedShape(
      {},
      {
        marker: 'torch.tensor',
        dims: 1,
        dtype: 'float32',
      }
    );
    expect(
      createReturnValidator(
        { kind: 'marker', marker: 'torch.tensor', dims: 1, dtype: 'float32' },
        'fixture.tensor'
      )(tensor)
    ).toBe(tensor);
    expect(() =>
      createReturnValidator(
        { kind: 'marker', marker: 'torch.tensor', dims: 2, dtype: 'float32' },
        'fixture.tensor'
      )(tensor)
    ).toThrow(BridgeValidationError);
    expect(() =>
      createReturnValidator(
        { kind: 'marker', marker: 'torch.tensor', dims: 1, dtype: 'float64' },
        'fixture.tensor'
      )(tensor)
    ).toThrow(BridgeValidationError);

    const estimator = tagDecodedShape({}, { marker: 'sklearn.estimator' });
    expect(
      createReturnValidator(
        { kind: 'marker', marker: 'sklearn.estimator' },
        'fixture.estimator'
      )(estimator)
    ).toBe(estimator);
    expect(() =>
      createReturnValidator(
        { kind: 'marker', marker: 'scipy.sparse' },
        'fixture.estimator'
      )(estimator)
    ).toThrow(BridgeValidationError);
  });

  it('describes tagged ndarray arrays from provenance before their generic array shape', () => {
    const array = tagDecodedShape([[1, 2]], {
      marker: 'ndarray',
      dims: 2,
      dtype: 'float64',
    });
    expect(describeReceivedShape(array)).toBe('ndarray (2d, float64)');
  });

  it('terminates on a recursive forward reference', () => {
    const schema: ReturnSchema = { kind: 'ref', name: 'Node' };
    const definitions: Record<string, ReturnSchema> = {
      Node: {
        kind: 'record',
        fields: {
          value: { schema: { kind: 'primitive', type: 'number' } },
          next: { schema: { kind: 'ref', name: 'Node' }, optional: true },
        },
      },
    };
    const value: { value: number; next?: unknown } = { value: 1 };
    value.next = value;
    expect(createReturnValidator(schema, 'fixture.link', definitions)(value)).toBe(value);
  });
});

describe('return validator bridge propagation', () => {
  let bridge: HttpBridge | undefined;

  afterEach(async () => {
    await bridge?.dispose();
    bridge = undefined;
  });

  it('survives the mocked non-subprocess HTTP facade', async () => {
    const server = createServer((_, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ id: 1, result: 4 }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    bridge = new HttpBridge({ baseURL: `http://127.0.0.1:${address.port}` });
    const validate = vi.fn((value: number) => {
      if (value !== 4) throw new Error('wrong result');
    });
    try {
      await expect(bridge.call<number>('math', 'sqrt', [16], undefined, validate)).resolves.toBe(4);
      expect(validate).toHaveBeenCalledOnce();
      expect(validate).toHaveBeenCalledWith(4, expect.any(DecodedProvenance));
      const [, provenance] = validate.mock.calls[0] as unknown as [number, DecodedProvenance];
      expect(provenance.atRoot()).toBeUndefined();

      const reject = vi.fn((_value: number) => {
        throw new Error('one-argument validator rejected the value');
      });
      await expect(bridge.call<number>('math', 'sqrt', [16], undefined, reject)).rejects.toThrow(
        'one-argument validator rejected the value'
      );
      expect(reject).toHaveBeenCalledOnce();
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve()))
      );
    }
  });

  it.skipIf(!PYTHON_AVAILABLE)(
    'survives the Node facade and preserves BridgeValidationError',
    async () => {
      const node = new NodeBridge({
        pythonPath: PYTHON ?? undefined,
        scriptPath: 'runtime/python_bridge.py',
      });
      try {
        await expect(
          node.call<number>(
            'builtins',
            'str',
            [123],
            undefined,
            createReturnValidator({ kind: 'primitive', type: 'number' }, 'builtins.str')
          )
        ).rejects.toMatchObject({ name: 'BridgeValidationError', callSite: 'builtins.str' });
      } finally {
        await node.dispose();
      }
    }
  );
});
