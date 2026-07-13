/**
 * Scientific envelope JS-side re-validation matrix.
 *
 * These cover the decoder's second line of defense for all six scientific
 * envelopes. The checks validate internal consistency and reject clearly. The
 * decoders never reconstruct a Python object. They only validate and either pass the
 * payload through or throw an actionable error.
 *
 * The Python side (runtime/tywrap_bridge_core.py) is the primary producer and is
 * exercised end-to-end by test/runtime_conformance.test.ts; this suite locks the
 * JS decoder's defensive validation against hand-crafted/corrupt envelopes.
 */

import { describe, it, expect } from 'vitest';
import {
  clearArrowDecoder,
  decodeValue,
  registerArrowDecoder,
  type ValueEnvelope,
} from '../src/utils/codec.js';

describe('#234 codec envelope re-validation (JS decoder)', () => {
  describe('ndarray v1', () => {
    it('rejects missing and invalid shape dimensions with field-level detail', () => {
      const make = (shape: unknown): unknown => ({
        __tywrap__: 'ndarray',
        codecVersion: 1,
        encoding: 'json',
        data: [1],
        ...(shape === undefined ? {} : { shape }),
      });

      expect(() => decodeValue(make(undefined))).toThrow(
        /Invalid ndarray envelope: shape at path shape.*declared shape undefined.*actual type undefined/
      );
      expect(() => decodeValue(make([-1]))).toThrow(/shape\[0\]=-1.*declared shape \[-1\]/);
      expect(() => decodeValue(make([1.5]))).toThrow(/shape\[0\]=1.5.*actual type number/);
      expect(() => decodeValue(make([Number.POSITIVE_INFINITY]))).toThrow(
        /shape\[0\]=Infinity.*actual type number\(Infinity\)/
      );
      expect(() => decodeValue(make([Number.MAX_SAFE_INTEGER + 1]))).toThrow(
        /shape\[0\]=9007199254740992.*within the safe range/
      );
    });

    it('rejects JSON nesting and leaf-count mismatches', () => {
      expect(() =>
        decodeValue({
          __tywrap__: 'ndarray',
          codecVersion: 1,
          encoding: 'json',
          data: [[1, 2], [3]],
          shape: [2, 2],
          dtype: 'int64',
        })
      ).toThrow(
        /Invalid ndarray envelope: data at path data\[1\].*length 1, expected 2.*declared count 4, actual count 3/
      );

      expect(() =>
        decodeValue({
          __tywrap__: 'ndarray',
          codecVersion: 1,
          encoding: 'json',
          data: [7],
          shape: [],
          dtype: 'int64',
        })
      ).toThrow(/data at path data exceeds nesting depth 0.*actual count 1/);
    });

    it('keeps dtype-absent JSON array leaves legacy tolerant', () => {
      const data = [[['nested', 'object-leaf']]];
      expect(
        decodeValue({
          __tywrap__: 'ndarray',
          codecVersion: 1,
          encoding: 'json',
          data,
          shape: [1],
        })
      ).toEqual(data);
    });

    it('enforces strict leaves whenever a JSON dtype is declared', () => {
      const data = [[['nested', 'object-leaf']]];
      expect(() =>
        decodeValue({
          __tywrap__: 'ndarray',
          codecVersion: 1,
          encoding: 'json',
          data,
          shape: [1],
          dtype: "[('value', '<i4')]",
        })
      ).toThrow(/data at path data\[0\] exceeds nesting depth 1.*dtype "\[\('value', '<i4'\)\]"/);
      expect(() =>
        decodeValue({
          __tywrap__: 'ndarray',
          codecVersion: 1,
          encoding: 'json',
          data,
          shape: [1],
          dtype: 'object',
        })
      ).toThrow(/data at path data\[0\] exceeds nesting depth 1.*dtype "object"/);
    });

    it('accepts empty and float16 JSON arrays with declared dtype', () => {
      expect(
        decodeValue({
          __tywrap__: 'ndarray',
          codecVersion: 1,
          encoding: 'json',
          data: [],
          shape: [0],
          dtype: 'float64',
        })
      ).toEqual([]);
      expect(
        decodeValue({
          __tywrap__: 'ndarray',
          codecVersion: 1,
          encoding: 'json',
          data: [1.5, -2.25],
          shape: [2],
          dtype: 'float16',
        })
      ).toEqual([1.5, -2.25]);

      expect(() =>
        decodeValue({
          __tywrap__: 'ndarray',
          codecVersion: 1,
          encoding: 'json',
          data: [[1.5, -2.25]],
          shape: [1],
          dtype: 'float16',
        })
      ).toThrow(/data at path data\[0\] exceeds nesting depth 1.*dtype "float16"/);
    });

    it('requires Arrow dtype and rejects truncated base64 before decoding', () => {
      registerArrowDecoder(() => [1]);
      try {
        expect(() =>
          decodeValue({
            __tywrap__: 'ndarray',
            codecVersion: 1,
            encoding: 'arrow',
            b64: 'AAAA',
            shape: [1],
          })
        ).toThrow(/dtype at path dtype is required for Arrow encoding.*declared shape \[1\]/);

        expect(() =>
          decodeValue({
            __tywrap__: 'ndarray',
            codecVersion: 1,
            encoding: 'arrow',
            b64: 'AQI',
            shape: [1],
            dtype: 'uint8',
          })
        ).toThrow(
          /Invalid ndarray envelope: b64 at path b64 must be well-formed base64.*shape \[1\].*dtype "uint8".*length 3/
        );
      } finally {
        clearArrowDecoder();
      }
    });

    it('rejects Arrow element-count mismatch and extraction failure', () => {
      registerArrowDecoder(() => [1, 2]);
      try {
        expect(() =>
          decodeValue({
            __tywrap__: 'ndarray',
            codecVersion: 1,
            encoding: 'arrow',
            b64: 'AAAA',
            shape: [3],
            dtype: 'int64',
          })
        ).toThrow(/element count 2, expected 3.*declared shape \[3\].*dtype "int64"/);
      } finally {
        clearArrowDecoder();
      }

      registerArrowDecoder(() => ({ numRows: 1 }));
      try {
        expect(() =>
          decodeValue({
            __tywrap__: 'ndarray',
            codecVersion: 1,
            encoding: 'arrow',
            b64: 'AAAA',
            shape: [1],
            dtype: 'int64',
          })
        ).toThrow(/could not extract Arrow values.*actual count unknown, actual type object/);
      } finally {
        clearArrowDecoder();
      }
    });

    it('keeps missing-codecVersion envelopes legacy tolerant', () => {
      expect(
        decodeValue({ __tywrap__: 'ndarray', encoding: 'json', data: [1, 2] } as ValueEnvelope)
      ).toEqual([1, 2]);
    });
  });

  describe('scipy.sparse', () => {
    it('accepts supported CSR / CSC / COO envelopes (int/float/bool/empty)', () => {
      // CSR int
      expect(
        decodeValue({
          __tywrap__: 'scipy.sparse',
          codecVersion: 1,
          encoding: 'json',
          format: 'csr',
          shape: [2, 2],
          data: [1, 2],
          indices: [0, 1],
          indptr: [0, 1, 2],
          dtype: 'int64',
        })
      ).toMatchObject({ format: 'csr', data: [1, 2] });

      // CSC float
      expect(
        decodeValue({
          __tywrap__: 'scipy.sparse',
          codecVersion: 1,
          encoding: 'json',
          format: 'csc',
          shape: [2, 2],
          data: [1.5, 2.5],
          indices: [0, 1],
          indptr: [0, 1, 2],
          dtype: 'float64',
        })
      ).toMatchObject({ format: 'csc' });

      // COO bool
      expect(
        decodeValue({
          __tywrap__: 'scipy.sparse',
          codecVersion: 1,
          encoding: 'json',
          format: 'coo',
          shape: [2, 2],
          data: [true, true],
          row: [0, 1],
          col: [0, 1],
          dtype: 'bool',
        })
      ).toMatchObject({ format: 'coo', row: [0, 1], col: [0, 1] });

      // Empty CSR (no stored entries; indptr is rows+1 zeros)
      expect(
        decodeValue({
          __tywrap__: 'scipy.sparse',
          codecVersion: 1,
          encoding: 'json',
          format: 'csr',
          shape: [3, 3],
          data: [],
          indices: [],
          indptr: [0, 0, 0, 0],
          dtype: 'float64',
        })
      ).toMatchObject({ format: 'csr', data: [] });
    });

    it('accepts a large CSR envelope (length/range checks scale)', () => {
      const rows = 1000;
      const cols = 1000;
      const data = Array.from({ length: rows }, (_, i) => i + 1);
      const indices = Array.from({ length: rows }, (_, i) => i % cols);
      const indptr = Array.from({ length: rows + 1 }, (_, i) => Math.min(i, rows));
      expect(
        decodeValue({
          __tywrap__: 'scipy.sparse',
          codecVersion: 1,
          encoding: 'json',
          format: 'csr',
          shape: [rows, cols],
          data,
          indices,
          indptr,
          dtype: 'int64',
        })
      ).toMatchObject({ format: 'csr' });
    });

    it('rejects CSR indices/data length mismatch', () => {
      expect(() =>
        decodeValue({
          __tywrap__: 'scipy.sparse',
          codecVersion: 1,
          encoding: 'json',
          format: 'csr',
          shape: [2, 2],
          data: [1, 2, 3],
          indices: [0, 1],
          indptr: [0, 1, 2],
          dtype: 'int64',
        })
      ).toThrow(/indices\/data lengths must match/);
    });

    it('rejects CSR indptr of the wrong length (must be rows+1)', () => {
      expect(() =>
        decodeValue({
          __tywrap__: 'scipy.sparse',
          codecVersion: 1,
          encoding: 'json',
          format: 'csr',
          shape: [2, 2],
          data: [1, 2],
          indices: [0, 1],
          indptr: [0, 1], // should be length 3
          dtype: 'int64',
        })
      ).toThrow(/indptr length must be 3 \(rows\+1\)/);
    });

    it('rejects CSR indptr with structurally invalid contents', () => {
      const make = (indptr: number[]): ValueEnvelope => ({
        __tywrap__: 'scipy.sparse',
        codecVersion: 1,
        encoding: 'json',
        format: 'csr',
        shape: [2, 2],
        data: [1, 2],
        indices: [0, 1],
        indptr,
        dtype: 'int64',
      });
      // pointer out of [0, data.length]
      expect(() => decodeValue(make([0, 99, 2]))).toThrow(/out of range/);
      // must start at 0
      expect(() => decodeValue(make([1, 1, 2]))).toThrow(/must start at 0/);
      // must be non-decreasing
      expect(() => decodeValue(make([0, 2, 1]))).toThrow(/non-decreasing/);
      // must end at data.length
      expect(() => decodeValue(make([0, 1, 1]))).toThrow(/must end at data\.length/);
      // must be integers
      expect(() => decodeValue(make([0, 1.5, 2]))).toThrow(/must be an integer/);
    });

    it('rejects negative or fractional sparse dimensions', () => {
      const make = (shape: number[]): ValueEnvelope => ({
        __tywrap__: 'scipy.sparse',
        codecVersion: 1,
        encoding: 'json',
        format: 'csr',
        shape,
        data: [],
        indices: [],
        indptr: [0],
      });
      expect(() => decodeValue(make([-1, 2]))).toThrow(/non-negative integer/);
      expect(() => decodeValue(make([1.5, 2]))).toThrow(/non-negative integer/);
      expect(() => decodeValue(make([Number.MAX_SAFE_INTEGER + 1, 2]))).toThrow(/safe range/);
    });

    it('rejects CSC indptr of the wrong length (must be cols+1)', () => {
      expect(() =>
        decodeValue({
          __tywrap__: 'scipy.sparse',
          codecVersion: 1,
          encoding: 'json',
          format: 'csc',
          shape: [4, 2],
          data: [1, 2],
          indices: [0, 1],
          indptr: [0, 1, 2, 3], // should be cols+1 = 3
          dtype: 'int64',
        })
      ).toThrow(/indptr length must be 3 \(cols\+1\)/);
    });

    it('rejects CSR column index out of range', () => {
      expect(() =>
        decodeValue({
          __tywrap__: 'scipy.sparse',
          codecVersion: 1,
          encoding: 'json',
          format: 'csr',
          shape: [2, 2],
          data: [1, 2],
          indices: [0, 5], // 5 >= cols(2)
          indptr: [0, 1, 2],
          dtype: 'int64',
        })
      ).toThrow(/indices\[1\]=5 is out of range \[0, 2\)/);
    });

    it('rejects a non-integer index', () => {
      expect(() =>
        decodeValue({
          __tywrap__: 'scipy.sparse',
          codecVersion: 1,
          encoding: 'json',
          format: 'csr',
          shape: [2, 2],
          data: [1, 2],
          indices: [0, 1.5],
          indptr: [0, 1, 2],
          dtype: 'int64',
        })
      ).toThrow(/indices\[1\] must be an integer/);
    });

    it('rejects COO row/col/data length mismatch and out-of-range row', () => {
      expect(() =>
        decodeValue({
          __tywrap__: 'scipy.sparse',
          codecVersion: 1,
          encoding: 'json',
          format: 'coo',
          shape: [2, 2],
          data: [1, 2],
          row: [0],
          col: [0, 1],
          dtype: 'int64',
        })
      ).toThrow(/coo row\/col\/data lengths must match/);

      expect(() =>
        decodeValue({
          __tywrap__: 'scipy.sparse',
          codecVersion: 1,
          encoding: 'json',
          format: 'coo',
          shape: [2, 2],
          data: [1, 2],
          row: [0, 9], // 9 >= rows(2)
          col: [0, 1],
          dtype: 'int64',
        })
      ).toThrow(/row\[1\]=9 is out of range \[0, 2\)/);
    });

    it('rejects an unsupported format and a malformed shape', () => {
      expect(() =>
        decodeValue({
          __tywrap__: 'scipy.sparse',
          codecVersion: 1,
          encoding: 'json',
          format: 'dia',
          shape: [2, 2],
          data: [1],
        } as unknown as ValueEnvelope)
      ).toThrow(/unsupported format dia/);

      expect(() =>
        decodeValue({
          __tywrap__: 'scipy.sparse',
          codecVersion: 1,
          encoding: 'json',
          format: 'csr',
          shape: [2], // not 2-item
          data: [1],
          indices: [0],
          indptr: [0, 1],
        })
      ).toThrow(/shape must be a 2-item non-negative integer\[\]/);
    });

    it('rejects data outside the declared dtype domain and non-finite values', () => {
      const make = (data: unknown[], dtype: string): ValueEnvelope => ({
        __tywrap__: 'scipy.sparse',
        codecVersion: 1,
        encoding: 'json',
        format: 'csr',
        shape: [1, 1],
        data,
        indices: [0],
        indptr: [0, 1],
        dtype,
      });
      expect(() => decodeValue(make([1.5], 'int64'))).toThrow(
        'Invalid scipy.sparse envelope: data[0] at path data[0] is incompatible with declared shape [1,1] and dtype "int64"; actual count 1, actual type number with value 1.5'
      );
      expect(() => decodeValue(make([Number.NaN], 'float64'))).toThrow(
        'Invalid scipy.sparse envelope: data[0] at path data[0] must be finite for declared shape [1,1] and dtype "float64"; actual count 1, actual type number with value NaN'
      );
    });

    it('requires v1 dtype and bounds 8/16/32-bit integer data', () => {
      const make = (data: number[], dtype?: string): ValueEnvelope => ({
        __tywrap__: 'scipy.sparse',
        codecVersion: 1,
        encoding: 'json',
        format: 'csr',
        shape: [1, 1],
        data,
        indices: [0],
        indptr: [0, 1],
        ...(dtype === undefined ? {} : { dtype }),
      });
      expect(() => decodeValue(make([1]))).toThrow(
        /scipy\.sparse envelope: dtype at path dtype.*required/
      );
      expect(() => decodeValue(make([-1], 'uint8'))).toThrow(/data\[0\].*dtype "uint8".*value -1/);
      expect(() => decodeValue(make([999], 'uint8'))).toThrow(
        /data\[0\].*dtype "uint8".*value 999/
      );
      expect(() => decodeValue(make([128], 'int8'))).toThrow(/data\[0\].*dtype "int8".*value 128/);
      expect(() => decodeValue(make([32_768], 'int16'))).toThrow(
        /data\[0\].*dtype "int16".*value 32768/
      );
      expect(() => decodeValue(make([2 ** 31], 'int32'))).toThrow(
        /data\[0\].*dtype "int32".*value 2147483648/
      );
      expect(() => decodeValue(make([65_536], 'uint16'))).toThrow(
        /data\[0\].*dtype "uint16".*value 65536/
      );
      expect(() => decodeValue(make([2 ** 32], 'uint32'))).toThrow(
        /data\[0\].*dtype "uint32".*value 4294967296/
      );
      expect(decodeValue(make([255], 'uint8'))).toMatchObject({ data: [255] });
      expect(decodeValue(make([Number.MAX_SAFE_INTEGER + 1], 'int64'))).toMatchObject({
        data: [Number.MAX_SAFE_INTEGER + 1],
      });
    });
  });

  describe('torch.tensor', () => {
    it('accepts a consistent ND tensor envelope (JSON nested ndarray)', () => {
      expect(
        decodeValue({
          __tywrap__: 'torch.tensor',
          codecVersion: 1,
          encoding: 'ndarray',
          value: {
            __tywrap__: 'ndarray',
            codecVersion: 1,
            encoding: 'json',
            data: [
              [1, 2, 3],
              [4, 5, 6],
            ],
            shape: [2, 3],
          },
          shape: [2, 3],
          dtype: 'float32',
          device: 'cpu',
        })
      ).toMatchObject({ shape: [2, 3], device: 'cpu' });
    });

    it('accepts a scalar tensor (shape [] product 1 vs nested [1])', () => {
      expect(
        decodeValue({
          __tywrap__: 'torch.tensor',
          codecVersion: 1,
          encoding: 'ndarray',
          value: {
            __tywrap__: 'ndarray',
            codecVersion: 1,
            encoding: 'json',
            data: [5],
            shape: [1],
          },
          shape: [],
          dtype: 'int64',
          device: 'cpu',
        })
      ).toMatchObject({ shape: [], device: 'cpu' });
    });

    it('rejects a shape whose product disagrees with the nested ndarray shape', () => {
      expect(() =>
        decodeValue({
          __tywrap__: 'torch.tensor',
          codecVersion: 1,
          encoding: 'ndarray',
          value: {
            __tywrap__: 'ndarray',
            codecVersion: 1,
            encoding: 'json',
            data: [1, 2, 3, 4, 5, 6],
            shape: [2, 3],
          },
          shape: [2, 2], // product 4 != 6
          dtype: 'float32',
          device: 'cpu',
        })
      ).toThrow(/disagrees with nested ndarray shape/);
    });

    it('rejects equal-product but differently shaped tensor/ndarray metadata', () => {
      expect(() =>
        decodeValue({
          __tywrap__: 'torch.tensor',
          codecVersion: 1,
          encoding: 'ndarray',
          value: {
            __tywrap__: 'ndarray',
            codecVersion: 1,
            encoding: 'json',
            data: [[1, 2, 3, 4]],
            shape: [1, 4],
          },
          shape: [2, 2],
          dtype: 'float32',
        })
      ).toThrow(/exact shapes are required.*actual counts 4 and 4/);
    });

    it('rejects empty outer and nested dtype fields when present', () => {
      const base = {
        __tywrap__: 'torch.tensor' as const,
        codecVersion: 1,
        encoding: 'ndarray' as const,
        value: {
          __tywrap__: 'ndarray' as const,
          codecVersion: 1,
          encoding: 'json' as const,
          data: [1],
          shape: [1],
        },
        shape: [1],
        dtype: 'float32',
      };
      expect(() => decodeValue({ ...base, dtype: '' })).toThrow(/dtype at path dtype.*non-empty/);
      expect(() => decodeValue({ ...base, value: { ...base.value, dtype: '' } })).toThrow(
        /value\.dtype at path value\.dtype.*non-empty/
      );
      expect(() => decodeValue({ ...base, dtype: undefined })).toThrow(
        /torch\.tensor envelope: dtype at path dtype.*required/
      );
    });

    it('rejects a negative / non-integer shape dimension', () => {
      expect(() =>
        decodeValue({
          __tywrap__: 'torch.tensor',
          codecVersion: 1,
          encoding: 'ndarray',
          value: {
            __tywrap__: 'ndarray',
            codecVersion: 1,
            encoding: 'json',
            data: [1, 2],
            shape: [2],
          },
          shape: [-2],
          dtype: 'float32',
          device: 'cpu',
        })
      ).toThrow(/shape\[0\]=-2 must be a non-negative integer/);
    });

    it('rejects an empty-string device', () => {
      expect(() =>
        decodeValue({
          __tywrap__: 'torch.tensor',
          codecVersion: 1,
          encoding: 'ndarray',
          value: {
            __tywrap__: 'ndarray',
            codecVersion: 1,
            encoding: 'json',
            data: [1, 2],
            shape: [2],
          },
          shape: [2],
          dtype: 'float32',
          device: '',
        })
      ).toThrow(/device must be a non-empty string/);
    });

    it('preserves dtype and device provenance without changing transported metadata', () => {
      const result = decodeValue({
        __tywrap__: 'torch.tensor',
        codecVersion: 1,
        encoding: 'ndarray',
        value: {
          __tywrap__: 'ndarray',
          codecVersion: 1,
          encoding: 'json',
          data: [1, -2.5, 3.140625],
          shape: [3],
          dtype: 'float32',
        },
        shape: [3],
        dtype: 'torch.float32',
        device: 'cpu',
        sourceDtype: 'torch.bfloat16',
        sourceDevice: 'cuda:0',
      });

      expect(result).toMatchObject({
        data: [1, -2.5, 3.140625],
        shape: [3],
        dtype: 'torch.float32',
        device: 'cpu',
        sourceDtype: 'torch.bfloat16',
        sourceDevice: 'cuda:0',
      });
    });

    it.each([
      ['sourceDtype', ''],
      ['sourceDtype', 123],
      ['sourceDevice', ''],
      ['sourceDevice', false],
    ] as const)('rejects invalid optional %s provenance', (field, invalidValue) => {
      expect(() =>
        decodeValue({
          __tywrap__: 'torch.tensor',
          codecVersion: 1,
          encoding: 'ndarray',
          value: {
            __tywrap__: 'ndarray',
            codecVersion: 1,
            encoding: 'json',
            data: [1],
            shape: [1],
            dtype: 'float32',
          },
          shape: [1],
          dtype: 'torch.float32',
          [field]: invalidValue,
        })
      ).toThrow(new RegExp(`${field} must be a non-empty string when provided`));
    });

    it('rejects a nested value that is not an ndarray envelope', () => {
      expect(() =>
        decodeValue({
          __tywrap__: 'torch.tensor',
          codecVersion: 1,
          encoding: 'ndarray',
          value: { not: 'an envelope' },
        } as unknown as ValueEnvelope)
      ).toThrow(/value must be an ndarray envelope/);
    });
  });

  describe('sklearn.estimator', () => {
    it('accepts metadata-only envelopes with JSON-safe shallow params', () => {
      expect(
        decodeValue({
          __tywrap__: 'sklearn.estimator',
          codecVersion: 1,
          encoding: 'json',
          className: 'LinearRegression',
          module: 'sklearn.linear_model._base',
          version: '1.8.0',
          params: { fit_intercept: true, copy_X: true, n_jobs: null, positive: false },
        })
      ).toMatchObject({ className: 'LinearRegression' });
    });

    it('accepts nested plain-JSON params (arrays/objects of primitives)', () => {
      expect(
        decodeValue({
          __tywrap__: 'sklearn.estimator',
          codecVersion: 1,
          encoding: 'json',
          className: 'Pipeline',
          module: 'sklearn.pipeline',
          params: {
            steps: [
              ['a', 1],
              ['b', 2],
            ],
            memory: null,
            options: { verbose: false },
          },
        })
      ).toMatchObject({ className: 'Pipeline' });
    });

    it('rejects a callable param value (re-validation, not reconstruction)', () => {
      expect(() =>
        decodeValue({
          __tywrap__: 'sklearn.estimator',
          codecVersion: 1,
          encoding: 'json',
          className: 'Custom',
          module: 'pkg.mod',
          params: { fn: (): number => 1 } as unknown as Record<string, unknown>,
        })
      ).toThrow(/params\.fn is not JSON-serializable \(type function\)/);
    });

    it('rejects a class-instance param value', () => {
      class Inner {}
      expect(() =>
        decodeValue({
          __tywrap__: 'sklearn.estimator',
          codecVersion: 1,
          encoding: 'json',
          className: 'Custom',
          module: 'pkg.mod',
          params: { nested: new Inner() } as unknown as Record<string, unknown>,
        })
      ).toThrow(/params\.nested must be a plain JSON object, got Inner/);
    });

    it('rejects a non-finite numeric param', () => {
      expect(() =>
        decodeValue({
          __tywrap__: 'sklearn.estimator',
          codecVersion: 1,
          encoding: 'json',
          className: 'Custom',
          module: 'pkg.mod',
          params: { alpha: Number.POSITIVE_INFINITY },
        })
      ).toThrow(/params\.alpha must be a finite JSON number/);
    });

    it('rejects params that are not an object at all', () => {
      expect(() =>
        decodeValue({
          __tywrap__: 'sklearn.estimator',
          codecVersion: 1,
          encoding: 'json',
          className: 'Custom',
          module: 'pkg.mod',
          params: 'not-an-object',
        } as unknown as ValueEnvelope)
      ).toThrow(/expected className\/module strings \+ params object/);
    });

    it('rejects empty className and module metadata', () => {
      expect(() =>
        decodeValue({
          __tywrap__: 'sklearn.estimator',
          codecVersion: 1,
          encoding: 'json',
          className: '',
          module: 'sklearn.base',
          params: {},
        })
      ).toThrow(/className at path className.*declared class ""/);
      expect(() =>
        decodeValue({
          __tywrap__: 'sklearn.estimator',
          codecVersion: 1,
          encoding: 'json',
          className: 'Estimator',
          module: '',
          params: {},
        })
      ).toThrow(/module at path module.*declared module ""/);
    });
  });
});
