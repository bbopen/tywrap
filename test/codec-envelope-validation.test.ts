/**
 * #234 envelope-hardening: JS-side re-validation matrix.
 *
 * These cover the cheap-but-worth-it second line of defense the codec decoders
 * added in 0.8.0: validate the scientific envelopes (scipy.sparse / torch.tensor
 * / sklearn.estimator) for internal consistency and reject clearly. The decoders
 * never reconstruct a Python object — they only validate and either pass the
 * payload through or throw an actionable error.
 *
 * The Python side (runtime/tywrap_bridge_core.py) is the primary producer and is
 * exercised end-to-end by test/runtime_conformance.test.ts; this suite locks the
 * JS decoder's defensive validation against hand-crafted/corrupt envelopes.
 */

import { describe, it, expect } from 'vitest';
import { decodeValue, type ValueEnvelope } from '../src/utils/codec.js';

describe('#234 codec envelope re-validation (JS decoder)', () => {
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
  });
});
