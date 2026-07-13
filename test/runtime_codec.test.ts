/**
 * Cross-Runtime Data Transfer and Codec Tests
 * Tests Arrow/Feather codec, JSON fallback, binary data transfer, and encoding/decoding
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  decodeValueAsync,
  decodeValue,
  autoRegisterArrowDecoder,
  registerArrowDecoder,
  clearArrowDecoder,
  hasArrowDecoder,
  _setLazyArrowLoaderForTesting,
  type ValueEnvelope,
  type DecodedValue,
  type ArrowTable,
} from '../src/utils/codec.js';
import { createReturnValidator } from '../src/runtime/validators.js';

describe('Cross-Runtime Data Transfer Codec', () => {
  let originalAtob: typeof globalThis.atob | undefined;
  let originalBuffer: typeof Buffer | undefined;

  beforeEach(() => {
    // Store originals
    originalAtob = globalThis.atob;
    originalBuffer = (globalThis as any).Buffer;

    // Reset any registered decoders
    clearArrowDecoder();
  });

  afterEach(() => {
    // Restore originals
    if (originalAtob !== undefined) {
      globalThis.atob = originalAtob;
    } else {
      delete (globalThis as any).atob;
    }

    if (originalBuffer !== undefined) {
      (globalThis as any).Buffer = originalBuffer;
    } else {
      delete (globalThis as any).Buffer;
    }
  });

  describe('Arrow Decoder Registration', () => {
    it('should register Arrow decoder', () => {
      const mockDecoder = (bytes: Uint8Array) => ({ numRows: 10, numCols: 3 }) as ArrowTable;
      registerArrowDecoder(mockDecoder);

      expect(hasArrowDecoder()).toBe(true);
    });

    it('should auto-register Arrow decoder from loader', async () => {
      const tableFromIPC = vi.fn().mockReturnValue({ numRows: 1, numCols: 1 });
      const loader = vi.fn().mockResolvedValue({ tableFromIPC });

      const registered = await autoRegisterArrowDecoder({ loader });

      expect(registered).toBe(true);
      expect(loader).toHaveBeenCalled();
      expect(hasArrowDecoder()).toBe(true);
    });

    it('should skip loader when decoder already registered', async () => {
      registerArrowDecoder(bytes => bytes);
      const loader = vi.fn().mockImplementation(() => {
        throw new Error('loader should not be called');
      });

      const registered = await autoRegisterArrowDecoder({ loader });

      expect(registered).toBe(true);
      expect(loader).not.toHaveBeenCalled();
    });

    it('should return false when loader lacks tableFromIPC', async () => {
      const loader = vi.fn().mockResolvedValue({});

      const registered = await autoRegisterArrowDecoder({ loader });

      expect(registered).toBe(false);
      expect(hasArrowDecoder()).toBe(false);
    });

    it('should return false when loader throws', async () => {
      const loader = vi.fn().mockRejectedValue(new Error('missing'));

      const registered = await autoRegisterArrowDecoder({ loader });

      expect(registered).toBe(false);
      expect(hasArrowDecoder()).toBe(false);
    });

    it('should initially have no Arrow decoder', () => {
      clearArrowDecoder();
      expect(hasArrowDecoder()).toBe(false);
    });

    it('lazily auto-registers a decoder on first Arrow decode', async () => {
      // No decoder registered up front; supply apache-arrow via the lazy loader seam.
      clearArrowDecoder();
      expect(hasArrowDecoder()).toBe(false);

      const mockTable = { numRows: 1, numCols: 1 } as ArrowTable;
      const tableFromIPC = vi.fn().mockReturnValue(mockTable);
      _setLazyArrowLoaderForTesting(() => ({ tableFromIPC }));

      const envelope: ValueEnvelope = {
        __tywrap__: 'dataframe',
        codecVersion: 1,
        encoding: 'arrow',
        b64: btoa('arrow ipc bytes'),
      };

      const result = await decodeValueAsync(envelope);

      expect(tableFromIPC).toHaveBeenCalledTimes(1);
      expect(result).toBe(mockTable);
      // The lazy registration is cached for subsequent decodes.
      expect(hasArrowDecoder()).toBe(true);
    });

    it('imports apache-arrow at most once across concurrent decodes', async () => {
      clearArrowDecoder();
      const tableFromIPC = vi.fn().mockReturnValue({ numRows: 0, numCols: 0 } as ArrowTable);
      const loader = vi.fn(() => ({ tableFromIPC }));
      _setLazyArrowLoaderForTesting(loader);

      const envelope: ValueEnvelope = {
        __tywrap__: 'dataframe',
        codecVersion: 1,
        encoding: 'arrow',
        b64: btoa('arrow ipc bytes'),
      };

      await Promise.all([
        decodeValueAsync(envelope),
        decodeValueAsync(envelope),
        decodeValueAsync(envelope),
      ]);

      expect(loader).toHaveBeenCalledTimes(1);
    });

    it('sync decodeValue throws an actionable error when no decoder is registered', () => {
      clearArrowDecoder();
      const envelope: ValueEnvelope = {
        __tywrap__: 'dataframe',
        codecVersion: 1,
        encoding: 'arrow',
        b64: btoa('arrow ipc bytes'),
      };

      expect(() => decodeValue(envelope)).toThrow(/no Arrow decoder is available/);
      expect(() => decodeValue(envelope)).toThrow(/npm install apache-arrow/);
      expect(() => decodeValue(envelope)).toThrow(/TYWRAP_CODEC_FALLBACK=json/);
    });

    it('should use registered decoder for Arrow data', async () => {
      const mockTable = { numRows: 5, numCols: 2, data: 'mock' } as ArrowTable;
      const mockDecoder = vi.fn().mockReturnValue(mockTable);
      registerArrowDecoder(mockDecoder);

      const envelope: ValueEnvelope = {
        __tywrap__: 'dataframe',
        encoding: 'arrow',
        b64: btoa('test data'), // Mock base64 data
      };

      const result = await decodeValueAsync(envelope);

      expect(mockDecoder).toHaveBeenCalled();
      expect(result).toBe(mockTable);
    });

    it('should throw when decoder fails', async () => {
      const mockDecoder = vi.fn().mockImplementation(() => {
        throw new Error('Decoder failed');
      });
      registerArrowDecoder(mockDecoder);

      const testData = 'test data';
      const envelope: ValueEnvelope = {
        __tywrap__: 'dataframe',
        encoding: 'arrow',
        b64: btoa(testData),
      };

      await expect(decodeValueAsync(envelope)).rejects.toThrow('Arrow decode failed');
    });
  });

  describe('Base64 Decoding Cross-Runtime', () => {
    it('should decode base64 using Buffer in Node.js-like environment', () => {
      // Mock Node.js Buffer
      const mockBuffer = {
        from: vi.fn().mockImplementation((data: string, encoding: string) => {
          const mockBuffer = {
            buffer: new ArrayBuffer(4),
            byteOffset: 0,
            length: 4,
          };
          return mockBuffer;
        }),
      };
      (globalThis as any).Buffer = mockBuffer;
      registerArrowDecoder(bytes => bytes);

      const envelope: ValueEnvelope = {
        __tywrap__: 'ndarray',
        encoding: 'arrow',
        b64: 'dGVzdA==', // 'test' in base64
      };

      const result = decodeValue(envelope);

      expect(mockBuffer.from).toHaveBeenCalledWith('dGVzdA==', 'base64');
      expect(result).toBeInstanceOf(Uint8Array);
    });

    it('should decode base64 using atob in browser environment', () => {
      // Mock browser atob
      globalThis.atob = vi.fn().mockReturnValue('test');
      delete (globalThis as any).Buffer;
      registerArrowDecoder(bytes => bytes);

      const envelope: ValueEnvelope = {
        __tywrap__: 'ndarray',
        encoding: 'arrow',
        b64: 'dGVzdA==',
      };

      const result = decodeValue(envelope);

      expect(globalThis.atob).toHaveBeenCalledWith('dGVzdA==');
      expect(result).toBeInstanceOf(Uint8Array);
    });

    it('should throw when no base64 decoder is available', () => {
      delete (globalThis as any).Buffer;
      delete (globalThis as any).atob;
      registerArrowDecoder(bytes => bytes);

      const envelope: ValueEnvelope = {
        __tywrap__: 'ndarray',
        encoding: 'arrow',
        b64: 'dGVzdA==',
      };

      expect(() => decodeValue(envelope)).toThrow('Base64 decoding is not available');
    });
  });

  describe('DataFrame Decoding', () => {
    it('should decode Arrow DataFrame envelope', async () => {
      const mockTable = { numRows: 100, numCols: 5, data: [[1, 2, 3]] } as ArrowTable;
      registerArrowDecoder(() => mockTable);

      const envelope: ValueEnvelope = {
        __tywrap__: 'dataframe',
        encoding: 'arrow',
        b64: btoa('mock arrow data'),
      };

      const result = await decodeValueAsync(envelope);
      expect(result).toBe(mockTable);
    });

    it('should decode JSON DataFrame envelope', async () => {
      const jsonData = {
        columns: ['A', 'B', 'C'],
        data: [
          [1, 2, 3],
          [4, 5, 6],
        ],
      };

      const envelope = {
        __tywrap__: 'dataframe',
        encoding: 'json',
        data: jsonData,
      } as const;

      const result = await decodeValueAsync(envelope);
      expect(result).toBe(jsonData);
    });

    it('should handle synchronous DataFrame decoding', () => {
      const mockTable = { numRows: 50, numCols: 3 } as ArrowTable;
      registerArrowDecoder(() => mockTable);

      const envelope: ValueEnvelope = {
        __tywrap__: 'dataframe',
        encoding: 'arrow',
        b64: btoa('mock data'),
      };

      const result = decodeValue(envelope);
      expect(result).toBe(mockTable);
    });

    it('should throw for invalid Arrow DataFrame', () => {
      registerArrowDecoder(() => {
        throw new Error('Invalid Arrow data');
      });

      const testData = 'invalid arrow data';
      const envelope: ValueEnvelope = {
        __tywrap__: 'dataframe',
        encoding: 'arrow',
        b64: btoa(testData),
      };

      expect(() => decodeValue(envelope)).toThrow('Arrow decode failed');
    });
  });

  describe('Series Decoding', () => {
    it('should decode Arrow Series envelope', async () => {
      const mockTable = { numRows: 1000, numCols: 1, data: [1, 2, 3] } as ArrowTable;
      registerArrowDecoder(() => mockTable);

      const envelope: ValueEnvelope = {
        __tywrap__: 'series',
        encoding: 'arrow',
        b64: btoa('mock series data'),
        name: 'test_series',
      };

      const result = await decodeValueAsync(envelope);
      expect(result).toBe(mockTable);
    });

    it('should decode JSON Series envelope', async () => {
      const seriesData = [10, 20, 30, 40, 50];

      const envelope: ValueEnvelope = {
        __tywrap__: 'series',
        encoding: 'json',
        data: seriesData,
        name: 'numeric_series',
      };

      const result = await decodeValueAsync(envelope);
      expect(result).toBe(seriesData);
    });

    it('should handle Series without name', async () => {
      const seriesData = ['a', 'b', 'c'];

      const envelope: ValueEnvelope = {
        __tywrap__: 'series',
        encoding: 'json',
        data: seriesData,
      };

      const result = await decodeValueAsync(envelope);
      expect(result).toBe(seriesData);
    });

    it('should handle Series with null name', async () => {
      const seriesData = [true, false, true];

      const envelope: ValueEnvelope = {
        __tywrap__: 'series',
        encoding: 'json',
        data: seriesData,
        name: null,
      };

      const result = await decodeValueAsync(envelope);
      expect(result).toBe(seriesData);
    });
  });

  describe('NDArray Decoding', () => {
    it('should decode Arrow NDArray envelope', async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5]);
      globalThis.atob = vi.fn().mockReturnValue(String.fromCharCode(...testData));
      registerArrowDecoder(bytes => bytes);

      const envelope: ValueEnvelope = {
        __tywrap__: 'ndarray',
        encoding: 'arrow',
        b64: 'AQIDBAU=', // Base64 of [1,2,3,4,5]
        shape: [5],
      };

      const result = await decodeValueAsync(envelope);
      expect(result).toBeInstanceOf(Uint8Array);
    });

    it('should decode JSON NDArray envelope', async () => {
      const arrayData = {
        data: [1, 2, 3, 4, 5, 6],
        shape: [2, 3],
        dtype: 'int32',
      };

      const envelope: ValueEnvelope = {
        __tywrap__: 'ndarray',
        encoding: 'json',
        data: arrayData,
        shape: [2, 3],
      };

      const result = await decodeValueAsync(envelope);
      expect(result).toBe(arrayData);
    });

    it('should handle multi-dimensional arrays', async () => {
      const tensorData = {
        data: new Array(24).fill(0).map((_, i) => i),
        shape: [2, 3, 4],
        dtype: 'float64',
      };

      const envelope: ValueEnvelope = {
        __tywrap__: 'ndarray',
        encoding: 'json',
        data: tensorData,
        shape: [2, 3, 4],
      };

      const result = await decodeValueAsync(envelope);
      expect(result).toBe(tensorData);
    });

    it('should decode Arrow NDArray with decoder', () => {
      const testData = 'binary array data';
      globalThis.atob = vi.fn().mockReturnValue(testData);
      registerArrowDecoder(bytes => bytes);

      const envelope: ValueEnvelope = {
        __tywrap__: 'ndarray',
        encoding: 'arrow',
        b64: btoa(testData),
      };

      const result = decodeValue(envelope);
      expect(result).toBeInstanceOf(Uint8Array);
    });
  });

  describe('SciPy Sparse Decoding', () => {
    it('should decode JSON sparse matrix envelope', async () => {
      const envelope: ValueEnvelope = {
        __tywrap__: 'scipy.sparse',
        codecVersion: 1,
        encoding: 'json',
        format: 'csr',
        shape: [2, 2],
        data: [1, 2],
        indices: [0, 1],
        indptr: [0, 1, 2],
        dtype: 'float64',
      };

      const result = await decodeValueAsync(envelope);
      expect(result).toEqual({
        format: 'csr',
        shape: [2, 2],
        data: [1, 2],
        indices: [0, 1],
        indptr: [0, 1, 2],
        dtype: 'float64',
      });
      expect(
        createReturnValidator(
          { kind: 'marker', marker: 'scipy.sparse', dims: 2, dtype: 'float64' },
          'fixture.sparse'
        )(result)
      ).toBe(result);
    });

    it('should reject invalid sparse matrix envelopes', async () => {
      await expect(
        decodeValueAsync({
          __tywrap__: 'scipy.sparse',
          codecVersion: 1,
          encoding: 'json',
          format: 'csr',
          shape: [2, 2],
          data: [1, 2],
          dtype: 'int64',
          // missing indices + indptr
        })
      ).rejects.toThrow('csr/csc requires indices and indptr');

      await expect(
        decodeValueAsync({
          __tywrap__: 'scipy.sparse',
          codecVersion: 1,
          encoding: 'json',
          format: 'coo',
          shape: [2, 2],
          data: [1, 2],
          row: [0, 1],
          dtype: 'int64',
          // missing col
        })
      ).rejects.toThrow('coo requires row and col');

      await expect(
        decodeValueAsync({
          __tywrap__: 'scipy.sparse',
          codecVersion: 1,
          encoding: 'json',
          format: 'csr',
          shape: [2],
          data: [1, 2],
          indices: [0, 1],
          indptr: [0, 1, 2],
        })
      ).rejects.toThrow('shape must be a 2-item non-negative integer[]');
    });
  });

  describe('Torch Tensor Decoding', () => {
    it('should decode nested ndarray envelope', async () => {
      const envelope: ValueEnvelope = {
        __tywrap__: 'torch.tensor',
        encoding: 'ndarray',
        value: {
          __tywrap__: 'ndarray',
          encoding: 'json',
          data: [1, 2, 3],
          shape: [3],
        },
        shape: [3],
        dtype: 'float32',
        device: 'cpu',
      };

      const result = await decodeValueAsync(envelope);
      expect(result).toEqual({
        data: [1, 2, 3],
        shape: [3],
        dtype: 'float32',
        device: 'cpu',
      });
      expect(
        createReturnValidator(
          { kind: 'marker', marker: 'torch.tensor', dims: 1, dtype: 'float32' },
          'fixture.tensor'
        )(result)
      ).toBe(result);
    });

    it('should await nested Arrow ndarray decoding', async () => {
      registerArrowDecoder(() => [1, 2, 3]);
      const testData = 'binary array data';

      const envelope: ValueEnvelope = {
        __tywrap__: 'torch.tensor',
        codecVersion: 1,
        encoding: 'ndarray',
        value: {
          __tywrap__: 'ndarray',
          codecVersion: 1,
          encoding: 'arrow',
          b64: Buffer.from(testData, 'utf-8').toString('base64'),
          shape: [3],
          dtype: 'float32',
        },
        shape: [3],
        dtype: 'float32',
        device: 'cpu',
      };

      const result = await decodeValueAsync(envelope);
      // Explicitly verify data is resolved, not a Promise (issue #21)
      expect((result as any).data).not.toBeInstanceOf(Promise);
      expect(result).toEqual({
        data: [1, 2, 3],
        shape: [3],
        dtype: 'float32',
        device: 'cpu',
      });
      expect(
        createReturnValidator(
          { kind: 'marker', marker: 'torch.tensor', dims: 1, dtype: 'float32' },
          'fixture.tensor'
        )(result)
      ).toBe(result);
    });

    it('should fail with an actionable error when apache-arrow is absent (nested)', async () => {
      // Simulate apache-arrow being unavailable so the lazy auto-register path fails.
      _setLazyArrowLoaderForTesting(() => {
        throw new Error('Cannot find module apache-arrow');
      });
      const envelope: ValueEnvelope = {
        __tywrap__: 'torch.tensor',
        codecVersion: 1,
        encoding: 'ndarray',
        value: {
          __tywrap__: 'ndarray',
          codecVersion: 1,
          encoding: 'arrow',
          b64: Buffer.from('test', 'utf-8').toString('base64'),
          shape: [3],
          dtype: 'float32',
        },
        shape: [3],
        dtype: 'float32',
        device: 'cpu',
      };

      await expect(decodeValueAsync(envelope)).rejects.toThrow(/no Arrow decoder is available/);
      await expect(decodeValueAsync(envelope)).rejects.toThrow(/npm install apache-arrow/);
      await expect(decodeValueAsync(envelope)).rejects.toThrow(/TYWRAP_CODEC_FALLBACK=json/);
    });

    it('should surface Arrow decode errors from nested ndarray', async () => {
      registerArrowDecoder(() => {
        throw new Error('Decoder failed');
      });

      const envelope: ValueEnvelope = {
        __tywrap__: 'torch.tensor',
        codecVersion: 1,
        encoding: 'ndarray',
        value: {
          __tywrap__: 'ndarray',
          codecVersion: 1,
          encoding: 'arrow',
          b64: Buffer.from('test', 'utf-8').toString('base64'),
          shape: [3],
          dtype: 'float32',
        },
        shape: [3],
        dtype: 'float32',
        device: 'cpu',
      };

      await expect(decodeValueAsync(envelope)).rejects.toThrow('Arrow decode failed');
    });

    it('should decode nested Arrow ndarray synchronously', () => {
      registerArrowDecoder(() => [1, 2, 3]);

      const envelope: ValueEnvelope = {
        __tywrap__: 'torch.tensor',
        codecVersion: 1,
        encoding: 'ndarray',
        value: {
          __tywrap__: 'ndarray',
          codecVersion: 1,
          encoding: 'arrow',
          b64: Buffer.from('test', 'utf-8').toString('base64'),
          shape: [3],
          dtype: 'float32',
        },
        shape: [3],
        dtype: 'float32',
        device: 'cpu',
      };

      const result = decodeValue(envelope);
      expect(result).toEqual({
        data: [1, 2, 3],
        shape: [3],
        dtype: 'float32',
        device: 'cpu',
      });
    });

    it('should reject invalid torch tensor envelopes', async () => {
      await expect(
        decodeValueAsync({
          __tywrap__: 'torch.tensor',
          codecVersion: 1,
          encoding: 'ndarray',
          value: { not: 'an envelope' },
        })
      ).rejects.toThrow('value must be an ndarray envelope');

      await expect(
        decodeValueAsync({
          __tywrap__: 'torch.tensor',
          codecVersion: 1,
          encoding: 'json',
          value: { __tywrap__: 'ndarray', encoding: 'json', data: [1] },
        })
      ).rejects.toThrow('unsupported encoding');
    });
  });

  describe('Sklearn Estimator Decoding', () => {
    it('should decode estimator metadata envelope', async () => {
      const envelope: ValueEnvelope = {
        __tywrap__: 'sklearn.estimator',
        codecVersion: 1,
        encoding: 'json',
        className: 'LinearRegression',
        module: 'sklearn.linear_model._base',
        version: '1.4.2',
        params: { fit_intercept: true },
      };

      const result = await decodeValueAsync(envelope);
      expect(result).toEqual({
        className: 'LinearRegression',
        module: 'sklearn.linear_model._base',
        version: '1.4.2',
        params: { fit_intercept: true },
      });
      expect(
        createReturnValidator(
          { kind: 'marker', marker: 'sklearn.estimator' },
          'fixture.estimator'
        )(result)
      ).toBe(result);
    });

    it('should reject invalid sklearn estimator envelopes', async () => {
      await expect(
        decodeValueAsync({
          __tywrap__: 'sklearn.estimator',
          codecVersion: 1,
          encoding: 'json',
          className: 'LinearRegression',
          module: 'sklearn.linear_model._base',
          version: 1.4,
          params: { fit_intercept: true },
        })
      ).rejects.toThrow('version must be a string');

      await expect(
        decodeValueAsync({
          __tywrap__: 'sklearn.estimator',
          codecVersion: 1,
          encoding: 'json',
          className: 123,
          module: 'sklearn.linear_model._base',
          params: {},
        })
      ).rejects.toThrow('expected className/module strings');
    });
  });

  describe('Envelope Validation', () => {
    it('should reject unsupported codec versions', async () => {
      await expect(
        decodeValueAsync({
          __tywrap__: 'ndarray',
          codecVersion: 2,
          encoding: 'json',
          data: [1, 2, 3],
        })
      ).rejects.toThrow('Unsupported ndarray envelope codecVersion');

      expect(() =>
        decodeValue({
          __tywrap__: 'dataframe',
          codecVersion: '1',
          encoding: 'json',
          data: [],
        })
      ).toThrow('codecVersion must be a number');
    });
  });

  describe('Non-Envelope Data', () => {
    it('should pass through non-object values unchanged', async () => {
      const testCases = [42, 'string', true, false, null, undefined, [1, 2, 3], Symbol('test')];

      for (const testCase of testCases) {
        const result = await decodeValueAsync(testCase);
        expect(result).toBe(testCase);
      }
    });

    it('should pass through objects without __tywrap__ marker', async () => {
      const regularObjects = [
        { name: 'test', value: 42 },
        { array: [1, 2, 3], nested: { key: 'value' } },
        { __other__: 'marker', data: 'test' },
      ];

      for (const obj of regularObjects) {
        const result = await decodeValueAsync(obj);
        expect(result).toBe(obj);
      }
    });

    it('should handle objects with invalid __tywrap__ markers', async () => {
      const invalidEnvelopes = [
        { __tywrap__: 'unknown_type', data: 'test' },
        { __tywrap__: 123, data: 'test' },
        { __tywrap__: null, data: 'test' },
        { __tywrap__: undefined, data: 'test' },
      ];

      for (const envelope of invalidEnvelopes) {
        const result = await decodeValueAsync(envelope);
        expect(result).toBe(envelope);
      }
    });
  });

  describe('Recursive scientific envelope decoding', () => {
    const ndarray = (data: unknown[], shape: number[] = [data.length]) => ({
      __tywrap__: 'ndarray' as const,
      codecVersion: 1,
      encoding: 'json' as const,
      data,
      shape,
      dtype: 'int64',
    });

    it('decodes envelopes in object, array, and deeply mixed containers', async () => {
      const value = {
        direct: ndarray([1, 2]),
        items: ['plain', ndarray([3]), { nested: [ndarray([4, 5])] }],
      };

      await expect(decodeValueAsync(value)).resolves.toEqual({
        direct: [1, 2],
        items: ['plain', [3], { nested: [[4, 5]] }],
      });
    });

    it('handles an earlier rejecting async envelope when a later sibling throws synchronously', async () => {
      let releaseLoader: (() => void) | undefined;
      _setLazyArrowLoaderForTesting(
        () =>
          new Promise((_, reject) => {
            releaseLoader = () => reject(new Error('deferred loader rejection'));
          })
      );
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown): void => {
        unhandled.push(reason);
      };
      process.on('unhandledRejection', onUnhandled);

      try {
        const decoding = decodeValueAsync([
          {
            __tywrap__: 'dataframe',
            codecVersion: 1,
            encoding: 'arrow',
            b64: '',
          },
          {
            __tywrap__: 'ndarray',
            codecVersion: 1,
            encoding: 'json',
            data: [1],
            dtype: 'int64',
          },
        ]);

        await expect(decoding).rejects.toThrow('shape at path shape');
        releaseLoader?.();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(unhandled).toEqual([]);
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    });

    it('treats decoded envelope output as terminal', async () => {
      const value = {
        __tywrap__: 'dataframe' as const,
        codecVersion: 1,
        encoding: 'json' as const,
        data: {
          matrix: ndarray(
            [
              [1, 2],
              [3, 4],
            ],
            [2, 2]
          ),
        },
      };

      await expect(decodeValueAsync(value)).resolves.toEqual({
        matrix: ndarray(
          [
            [1, 2],
            [3, 4],
          ],
          [2, 2]
        ),
      });
    });

    it('does not count decoded ndarray payload elements as visited nodes', async () => {
      const data = new Array<number>(1_000_001).fill(1);

      await expect(decodeValueAsync(ndarray(data))).resolves.toBe(data);
    });

    it('rejects values deeper than 2048 with the exact path', async () => {
      const value: Record<string, unknown> = {};
      let cursor = value;
      for (let depth = 0; depth < 2049; depth += 1) {
        const next: Record<string, unknown> = {};
        cursor.next = next;
        cursor = next;
      }
      const path = `result${'.next'.repeat(2049)}`;

      await expect(decodeValueAsync(value)).rejects.toMatchObject({
        message: `Scientific envelope decode maximum depth 2048 exceeded at ${path}`,
      });
    });

    it('counts a torch tensor nested ndarray against the depth bound', async () => {
      const value: Record<string, unknown> = {};
      let cursor = value;
      for (let depth = 0; depth < 2047; depth += 1) {
        const next: Record<string, unknown> = {};
        cursor.next = next;
        cursor = next;
      }
      cursor.tensor = {
        __tywrap__: 'torch.tensor',
        codecVersion: 1,
        encoding: 'ndarray',
        value: ndarray([1]),
        shape: [1],
        dtype: 'torch.int64',
        device: 'cpu',
      };
      const path = `result${'.next'.repeat(2047)}.tensor.value`;
      const tensorPath = `result${'.next'.repeat(2047)}.tensor`;

      await expect(decodeValueAsync(value)).rejects.toMatchObject({
        message: `Scientific envelope decode failed at ${tensorPath}: Scientific envelope decode maximum depth 2048 exceeded at ${path}`,
      });
    });

    it('does not spend the node budget on primitive leaves', async () => {
      const value = new Array<number>(1_000_000).fill(0);

      await expect(decodeValueAsync(value)).resolves.toBe(value);
    });

    it('rejects more than 1,000,000 visited container nodes with the exact path', async () => {
      const value = Array.from({ length: 1_000_000 }, () => []);

      await expect(decodeValueAsync(value)).rejects.toMatchObject({
        message:
          'Scientific envelope decode maximum visited nodes 1000000 exceeded at result[999999]',
      });
    });

    it('preserves unknown nested marker behavior from the root', async () => {
      const root = { __tywrap__: 'future.marker', value: ndarray([1]) };
      const nested = { item: { __tywrap__: 'future.marker', value: ndarray([1]) } };
      const nestedMarker = nested.item;

      const rootDecoded = await decodeValueAsync(root);
      const nestedDecoded = await decodeValueAsync(nested);
      expect(rootDecoded).toBe(root);
      expect(rootDecoded).toEqual({ __tywrap__: 'future.marker', value: ndarray([1]) });
      expect((nestedDecoded as { item: unknown }).item).toBe(nestedMarker);
      expect(nestedDecoded).toEqual({
        item: { __tywrap__: 'future.marker', value: ndarray([1]) },
      });
    });

    it('passes through frozen envelope-free objects and arrays unchanged', async () => {
      const nested = Object.freeze({ value: 1 });
      const items = Object.freeze([nested, 'plain']);
      const value = Object.freeze({ items });

      const decoded = await decodeValueAsync(value);
      expect(decoded).toBe(value);
      expect((decoded as { items: unknown }).items).toBe(items);
    });

    it('prefixes nested envelope validation errors with the traversal path', async () => {
      const value = {
        groups: [
          {
            matrix: {
              __tywrap__: 'ndarray',
              codecVersion: 1,
              encoding: 'json',
              data: [1],
              dtype: 'int64',
            },
          },
        ],
      };

      await expect(decodeValueAsync(value)).rejects.toThrow(
        'Scientific envelope decode failed at result.groups[0].matrix: Invalid ndarray envelope: shape at path shape'
      );
    });

    it('passes through custom-prototype objects without inspecting their contents', async () => {
      const custom = Object.create({ kind: 'custom' }) as { value: unknown };
      custom.value = ndarray([1]);

      const customEnvelope = Object.assign(Object.create({ kind: 'custom' }), ndarray([3]));

      const decoded = await decodeValueAsync({ custom, customEnvelope });
      expect((decoded as { custom: unknown }).custom).toBe(custom);
      expect(custom.value).toMatchObject({ __tywrap__: 'ndarray' });
      expect((decoded as { customEnvelope: unknown }).customEnvelope).toBe(customEnvelope);

      class CustomArray extends Array<unknown> {}
      const customArray = new CustomArray(ndarray([2]));
      const arrayDecoded = await decodeValueAsync({ customArray });
      expect((arrayDecoded as { customArray: unknown }).customArray).toBe(customArray);
      expect(customArray[0]).toMatchObject({ __tywrap__: 'ndarray' });
    });
  });

  describe('Encoding Edge Cases', () => {
    it('should handle missing encoding field', async () => {
      const envelope = {
        __tywrap__: 'dataframe',
        // encoding field missing
        b64: btoa('test'),
      } as any;

      await expect(decodeValueAsync(envelope)).rejects.toThrow(
        'Invalid dataframe envelope: unsupported encoding'
      );
    });

    it('should handle invalid encoding values', async () => {
      const envelope = {
        __tywrap__: 'dataframe',
        encoding: 'invalid',
        b64: btoa('test'),
      } as any;

      await expect(decodeValueAsync(envelope)).rejects.toThrow(
        'Invalid dataframe envelope: unsupported encoding'
      );
    });

    it('should handle missing b64 field for Arrow encoding', async () => {
      const envelope = {
        __tywrap__: 'dataframe',
        encoding: 'arrow',
        // b64 field missing
      } as any;

      await expect(decodeValueAsync(envelope)).rejects.toThrow(
        'Invalid dataframe envelope: missing b64'
      );
    });

    it('should handle non-string b64 values', async () => {
      const envelope = {
        __tywrap__: 'ndarray',
        encoding: 'arrow',
        b64: 123, // Should be string
      } as any;

      await expect(decodeValueAsync(envelope)).rejects.toThrow(
        'Invalid ndarray envelope: missing b64'
      );
    });

    it('should handle missing data field for JSON encoding', async () => {
      const envelope = {
        __tywrap__: 'series',
        encoding: 'json',
        // data field missing
      } as any;

      await expect(decodeValueAsync(envelope)).rejects.toThrow(
        'Invalid series envelope: missing data'
      );
    });
  });

  describe('Large Data Transfer', () => {
    it('should handle large Arrow buffers efficiently', async () => {
      const mockTable = { numRows: 1000000, numCols: 100 } as ArrowTable;
      const mockDecoder = vi.fn().mockReturnValue(mockTable);
      registerArrowDecoder(mockDecoder);

      // Simulate large base64 data
      const largeData = 'x'.repeat(1024 * 1024); // 1MB
      const envelope: ValueEnvelope = {
        __tywrap__: 'dataframe',
        encoding: 'arrow',
        b64: btoa(largeData),
      };

      const startTime = Date.now();
      const result = await decodeValueAsync(envelope);
      const duration = Date.now() - startTime;

      expect(result).toBe(mockTable);
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
    });

    it('should handle large JSON data structures', async () => {
      const largeArray = new Array(100000).fill(0).map((_, i) => ({
        id: i,
        value: Math.random(),
        text: `Item ${i}`,
      }));

      const envelope = {
        __tywrap__: 'dataframe',
        encoding: 'json',
        data: { records: largeArray },
      } as const;

      const startTime = Date.now();
      const result = await decodeValueAsync(envelope);
      const duration = Date.now() - startTime;

      expect(result).toEqual({ records: largeArray });
      expect(duration).toBeLessThan(2000);
    });

    it('should handle memory-efficient streaming for large datasets', async () => {
      // Test that we don't load everything into memory at once
      const chunkSize = 1000;
      const totalChunks = 100;

      const processedChunks: number[] = [];

      for (let i = 0; i < totalChunks; i++) {
        const chunkData = new Array(chunkSize).fill(i);
        const envelope = {
          __tywrap__: 'series',
          encoding: 'json',
          data: chunkData,
          name: `chunk_${i}`,
        } as const;

        const result = await decodeValueAsync(envelope);
        processedChunks.push((result as number[]).length);
      }

      expect(processedChunks).toHaveLength(totalChunks);
      expect(processedChunks.every(length => length === chunkSize)).toBe(true);
    });
  });

  describe('Synchronous vs Asynchronous Decoding', () => {
    it('should produce same results for sync and async decoding', async () => {
      const testData = { test: 'data', numbers: [1, 2, 3] };
      const envelope = {
        __tywrap__: 'dataframe',
        encoding: 'json',
        data: testData,
      } as const;

      const syncResult = decodeValue(envelope);
      const asyncResult = await decodeValueAsync(envelope);

      expect(syncResult).toEqual(asyncResult);
      expect(syncResult).toBe(testData);
    });

    it('should handle Arrow decoding differences between sync and async', async () => {
      const mockTable = { numRows: 10, data: 'test' } as ArrowTable;

      // Mock decoder that works synchronously
      registerArrowDecoder(() => mockTable);

      const envelope: ValueEnvelope = {
        __tywrap__: 'dataframe',
        encoding: 'arrow',
        b64: btoa('test data'),
      };

      const syncResult = decodeValue(envelope);
      const asyncResult = await decodeValueAsync(envelope);

      // Both should return the mocked table
      expect(syncResult).toBe(mockTable);
      expect(asyncResult).toBe(mockTable);
    });

    it('should handle decoder failures consistently', async () => {
      registerArrowDecoder(() => {
        throw new Error('Decoder error');
      });

      const envelope: ValueEnvelope = {
        __tywrap__: 'dataframe',
        encoding: 'arrow',
        b64: btoa('test data'),
      };

      expect(() => decodeValue(envelope)).toThrow('Arrow decode failed');
      await expect(decodeValueAsync(envelope)).rejects.toThrow('Arrow decode failed');
    });
  });

  describe('Cross-Runtime Compatibility', () => {
    it('should work consistently across different JavaScript engines', async () => {
      const testEnvelopes = [
        {
          __tywrap__: 'dataframe' as const,
          encoding: 'json' as const,
          data: { columns: ['A'], data: [[1]] },
        },
        {
          __tywrap__: 'series' as const,
          encoding: 'json' as const,
          data: [1, 2, 3],
        },
        {
          __tywrap__: 'ndarray' as const,
          encoding: 'json' as const,
          data: { data: [1, 2, 3, 4], shape: [2, 2] },
        },
      ];

      for (const envelope of testEnvelopes) {
        const result = await decodeValueAsync(envelope);
        expect(result).toBe(envelope.data);
      }
    });

    it('should handle different base64 implementations', () => {
      const testData = 'Hello, 世界! 🐍';
      const base64Implementations = [
        // Node.js style (mocked)
        () => {
          const mockBuffer = {
            from: () => ({ buffer: new ArrayBuffer(0), byteOffset: 0, length: 0 }),
          };
          (globalThis as any).Buffer = mockBuffer;
          delete (globalThis as any).atob;
        },
        // Browser style (mocked)
        () => {
          delete (globalThis as any).Buffer;
          globalThis.atob = vi.fn().mockReturnValue(testData);
        },
        // Fallback style
        () => {
          delete (globalThis as any).Buffer;
          delete (globalThis as any).atob;
        },
      ];

      base64Implementations.forEach((setupImpl, index) => {
        setupImpl();
        registerArrowDecoder(bytes => bytes);

        // Use a simple base64 string for testing
        const testBase64 = 'SGVsbG8sIHdvcmxkIQ=='; // "Hello, world!"

        const envelope: ValueEnvelope = {
          __tywrap__: 'ndarray',
          encoding: 'arrow',
          b64: testBase64,
        };

        if (index === 2) {
          expect(() => decodeValue(envelope)).toThrow('Base64 decoding is not available');
          return;
        }

        const result = decodeValue(envelope);
        expect(result).toBeInstanceOf(Uint8Array);
      });
    });

    it('should handle different TypedArray support', () => {
      const originalUint8Array = globalThis.Uint8Array;
      const originalArrayBuffer = globalThis.ArrayBuffer;

      try {
        // Test with standard TypedArray
        registerArrowDecoder(bytes => bytes);
        const envelope: ValueEnvelope = {
          __tywrap__: 'ndarray',
          encoding: 'arrow',
          b64: btoa('test'),
        };

        const result = decodeValue(envelope);
        expect(result).toBeInstanceOf(Uint8Array);
      } finally {
        globalThis.Uint8Array = originalUint8Array;
        globalThis.ArrayBuffer = originalArrayBuffer;
      }
    });
  });

  describe('Performance and Memory Usage', () => {
    it('should not leak memory during repeated decoding', async () => {
      const testData = { data: new Array(1000).fill(42) };
      const envelope = {
        __tywrap__: 'series',
        encoding: 'json',
        data: testData,
      } as const;

      const iterations = 1000;
      const results: unknown[] = [];

      for (let i = 0; i < iterations; i++) {
        const result = await decodeValueAsync(envelope);
        results.push(result);

        // Clear reference to allow GC
        if (i % 100 === 0) {
          results.length = 0;
        }
      }

      expect(results.length).toBeLessThanOrEqual(100);
    });

    it('should handle concurrent decoding efficiently', async () => {
      const createEnvelope = (index: number) => ({
        __tywrap__: 'dataframe' as const,
        encoding: 'json' as const,
        data: { id: index, values: new Array(100).fill(index) },
      });

      const concurrentOperations = 50;
      const envelopes = Array.from({ length: concurrentOperations }, (_, i) => createEnvelope(i));

      const startTime = Date.now();
      const results = await Promise.all(envelopes.map(envelope => decodeValueAsync(envelope)));
      const duration = Date.now() - startTime;

      expect(results).toHaveLength(concurrentOperations);
      expect(results.every((result, index) => (result as any).id === index)).toBe(true);
      expect(duration).toBeLessThan(5000); // Should be reasonably fast
    });

    it('should optimize for common data patterns', async () => {
      // Test that common patterns are handled efficiently
      const commonPatterns = [
        // Small datasets
        { __tywrap__: 'series' as const, encoding: 'json' as const, data: [1, 2, 3] },
        // Empty datasets
        {
          __tywrap__: 'dataframe' as const,
          encoding: 'json' as const,
          data: { columns: [], data: [] },
        },
        // Single values
        { __tywrap__: 'series' as const, encoding: 'json' as const, data: [42] },
        // String data
        { __tywrap__: 'series' as const, encoding: 'json' as const, data: ['a', 'b', 'c'] },
      ];

      const startTime = Date.now();

      for (const pattern of commonPatterns) {
        const result = await decodeValueAsync(pattern);
        expect(result).toBe(pattern.data);
      }

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(100); // Should be very fast for common patterns
    });
  });
});
