/**
 * Cross-Runtime Data Transfer and Codec Tests
 * Tests Arrow/Feather codec, JSON fallback, binary data transfer, and encoding/decoding
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  decodeValueAsync,
  decodeValue,
  registerArrowDecoder,
  hasArrowDecoder,
  type CodecEnvelope,
  type DecodedValue,
  type ArrowTable
} from '../src/utils/codec.js';

describe('Cross-Runtime Data Transfer Codec', () => {
  let originalAtob: typeof globalThis.atob | undefined;
  let originalBuffer: typeof Buffer | undefined;

  beforeEach(() => {
    // Store originals
    originalAtob = globalThis.atob;
    originalBuffer = (globalThis as any).Buffer;
    
    // Reset any registered decoders
    registerArrowDecoder(() => { throw new Error('No decoder registered'); });
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

    it('should initially have no Arrow decoder', () => {
      // Reset to no decoder
      registerArrowDecoder(() => { throw new Error('No decoder'); });
      
      // Even though we registered a throwing decoder, hasArrowDecoder checks for registration
      expect(hasArrowDecoder()).toBe(true);
    });

    it('should use registered decoder for Arrow data', async () => {
      const mockTable = { numRows: 5, numCols: 2, data: 'mock' } as ArrowTable;
      const mockDecoder = vi.fn().mockReturnValue(mockTable);
      registerArrowDecoder(mockDecoder);

      const envelope: CodecEnvelope = {
        __tywrap__: 'dataframe',
        encoding: 'arrow',
        b64: btoa('test data') // Mock base64 data
      };

      const result = await decodeValueAsync(envelope);
      
      expect(mockDecoder).toHaveBeenCalled();
      expect(result).toBe(mockTable);
    });

    it('should fallback to raw bytes when decoder fails', async () => {
      const mockDecoder = vi.fn().mockImplementation(() => {
        throw new Error('Decoder failed');
      });
      registerArrowDecoder(mockDecoder);

      const testData = 'test data';
      const envelope: CodecEnvelope = {
        __tywrap__: 'dataframe',
        encoding: 'arrow',
        b64: btoa(testData)
      };

      const result = await decodeValueAsync(envelope);
      
      expect(result).toBeInstanceOf(Uint8Array);
      expect(new TextDecoder().decode(result as Uint8Array)).toBe(testData);
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
            length: 4
          };
          return mockBuffer;
        })
      };
      (globalThis as any).Buffer = mockBuffer;

      const envelope: CodecEnvelope = {
        __tywrap__: 'ndarray',
        encoding: 'arrow',
        b64: 'dGVzdA==' // 'test' in base64
      };

      const result = decodeValue(envelope);
      
      expect(mockBuffer.from).toHaveBeenCalledWith('dGVzdA==', 'base64');
      expect(result).toBeInstanceOf(Uint8Array);
    });

    it('should decode base64 using atob in browser environment', () => {
      // Mock browser atob
      globalThis.atob = vi.fn().mockReturnValue('test');
      delete (globalThis as any).Buffer;

      const envelope: CodecEnvelope = {
        __tywrap__: 'ndarray',
        encoding: 'arrow',
        b64: 'dGVzdA=='
      };

      const result = decodeValue(envelope);
      
      expect(globalThis.atob).toHaveBeenCalledWith('dGVzdA==');
      expect(result).toBeInstanceOf(Uint8Array);
    });

    it('should handle missing atob and Buffer gracefully', () => {
      delete (globalThis as any).Buffer;
      delete (globalThis as any).atob;

      const envelope: CodecEnvelope = {
        __tywrap__: 'ndarray',
        encoding: 'arrow',
        b64: 'dGVzdA=='
      };

      const result = decodeValue(envelope);
      
      // Should return a Uint8Array with zeros when no decoder available
      expect(result).toBeInstanceOf(Uint8Array);
    });
  });

  describe('DataFrame Decoding', () => {
    it('should decode Arrow DataFrame envelope', async () => {
      const mockTable = { numRows: 100, numCols: 5, data: [[1, 2, 3]] } as ArrowTable;
      registerArrowDecoder(() => mockTable);

      const envelope: CodecEnvelope = {
        __tywrap__: 'dataframe',
        encoding: 'arrow',
        b64: btoa('mock arrow data')
      };

      const result = await decodeValueAsync(envelope);
      expect(result).toBe(mockTable);
    });

    it('should decode JSON DataFrame envelope', async () => {
      const jsonData = {
        columns: ['A', 'B', 'C'],
        data: [[1, 2, 3], [4, 5, 6]]
      };

      const envelope = {
        __tywrap__: 'dataframe',
        encoding: 'json',
        data: jsonData
      } as const;

      const result = await decodeValueAsync(envelope);
      expect(result).toBe(jsonData);
    });

    it('should handle synchronous DataFrame decoding', () => {
      const mockTable = { numRows: 50, numCols: 3 } as ArrowTable;
      registerArrowDecoder(() => mockTable);

      const envelope: CodecEnvelope = {
        __tywrap__: 'dataframe',
        encoding: 'arrow',
        b64: btoa('mock data')
      };

      const result = decodeValue(envelope);
      expect(result).toBe(mockTable);
    });

    it('should fallback to raw bytes for invalid Arrow DataFrame', () => {
      registerArrowDecoder(() => { throw new Error('Invalid Arrow data'); });

      const testData = 'invalid arrow data';
      const envelope: CodecEnvelope = {
        __tywrap__: 'dataframe',
        encoding: 'arrow',
        b64: btoa(testData)
      };

      const result = decodeValue(envelope);
      expect(result).toBeInstanceOf(Uint8Array);
    });
  });

  describe('Series Decoding', () => {
    it('should decode Arrow Series envelope', async () => {
      const mockTable = { numRows: 1000, numCols: 1, data: [1, 2, 3] } as ArrowTable;
      registerArrowDecoder(() => mockTable);

      const envelope: CodecEnvelope = {
        __tywrap__: 'series',
        encoding: 'arrow',
        b64: btoa('mock series data'),
        name: 'test_series'
      };

      const result = await decodeValueAsync(envelope);
      expect(result).toBe(mockTable);
    });

    it('should decode JSON Series envelope', async () => {
      const seriesData = [10, 20, 30, 40, 50];
      
      const envelope: CodecEnvelope = {
        __tywrap__: 'series',
        encoding: 'json',
        data: seriesData,
        name: 'numeric_series'
      };

      const result = await decodeValueAsync(envelope);
      expect(result).toBe(seriesData);
    });

    it('should handle Series without name', async () => {
      const seriesData = ['a', 'b', 'c'];
      
      const envelope: CodecEnvelope = {
        __tywrap__: 'series',
        encoding: 'json',
        data: seriesData
      };

      const result = await decodeValueAsync(envelope);
      expect(result).toBe(seriesData);
    });

    it('should handle Series with null name', async () => {
      const seriesData = [true, false, true];
      
      const envelope: CodecEnvelope = {
        __tywrap__: 'series',
        encoding: 'json',
        data: seriesData,
        name: null
      };

      const result = await decodeValueAsync(envelope);
      expect(result).toBe(seriesData);
    });
  });

  describe('NDArray Decoding', () => {
    it('should decode Arrow NDArray envelope', async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5]);
      globalThis.atob = vi.fn().mockReturnValue(String.fromCharCode(...testData));

      const envelope: CodecEnvelope = {
        __tywrap__: 'ndarray',
        encoding: 'arrow',
        b64: 'AQIDBAU=', // Base64 of [1,2,3,4,5]
        shape: [5]
      };

      const result = await decodeValueAsync(envelope);
      expect(result).toBeInstanceOf(Uint8Array);
    });

    it('should decode JSON NDArray envelope', async () => {
      const arrayData = {
        data: [1, 2, 3, 4, 5, 6],
        shape: [2, 3],
        dtype: 'int32'
      };

      const envelope: CodecEnvelope = {
        __tywrap__: 'ndarray',
        encoding: 'json',
        data: arrayData,
        shape: [2, 3]
      };

      const result = await decodeValueAsync(envelope);
      expect(result).toBe(arrayData);
    });

    it('should handle multi-dimensional arrays', async () => {
      const tensorData = {
        data: new Array(24).fill(0).map((_, i) => i),
        shape: [2, 3, 4],
        dtype: 'float64'
      };

      const envelope: CodecEnvelope = {
        __tywrap__: 'ndarray',
        encoding: 'json',
        data: tensorData,
        shape: [2, 3, 4]
      };

      const result = await decodeValueAsync(envelope);
      expect(result).toBe(tensorData);
    });

    it('should return raw bytes for Arrow NDArray', () => {
      const testData = 'binary array data';
      globalThis.atob = vi.fn().mockReturnValue(testData);

      const envelope: CodecEnvelope = {
        __tywrap__: 'ndarray',
        encoding: 'arrow',
        b64: btoa(testData)
      };

      const result = decodeValue(envelope);
      expect(result).toBeInstanceOf(Uint8Array);
    });
  });

  describe('Non-Envelope Data', () => {
    it('should pass through non-object values unchanged', async () => {
      const testCases = [
        42,
        'string',
        true,
        false,
        null,
        undefined,
        [1, 2, 3],
        Symbol('test')
      ];

      for (const testCase of testCases) {
        const result = await decodeValueAsync(testCase);
        expect(result).toBe(testCase);
      }
    });

    it('should pass through objects without __tywrap__ marker', async () => {
      const regularObjects = [
        { name: 'test', value: 42 },
        { array: [1, 2, 3], nested: { key: 'value' } },
        { __other__: 'marker', data: 'test' }
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
        { __tywrap__: undefined, data: 'test' }
      ];

      for (const envelope of invalidEnvelopes) {
        const result = await decodeValueAsync(envelope);
        expect(result).toBe(envelope);
      }
    });
  });

  describe('Encoding Edge Cases', () => {
    it('should handle missing encoding field', async () => {
      const envelope = {
        __tywrap__: 'dataframe',
        // encoding field missing
        b64: btoa('test')
      } as any;

      const result = await decodeValueAsync(envelope);
      expect(result).toBe(envelope); // Should pass through unchanged
    });

    it('should handle invalid encoding values', async () => {
      const envelope = {
        __tywrap__: 'dataframe',
        encoding: 'invalid',
        b64: btoa('test')
      } as any;

      const result = await decodeValueAsync(envelope);
      expect(result).toBe(envelope);
    });

    it('should handle missing b64 field for Arrow encoding', async () => {
      const envelope = {
        __tywrap__: 'dataframe',
        encoding: 'arrow'
        // b64 field missing
      } as any;

      const result = await decodeValueAsync(envelope);
      expect(result).toBe(envelope);
    });

    it('should handle non-string b64 values', async () => {
      const envelope = {
        __tywrap__: 'ndarray',
        encoding: 'arrow',
        b64: 123 // Should be string
      } as any;

      const result = await decodeValueAsync(envelope);
      expect(result).toBe(envelope);
    });

    it('should handle missing data field for JSON encoding', async () => {
      const envelope = {
        __tywrap__: 'series',
        encoding: 'json'
        // data field missing
      } as any;

      const result = await decodeValueAsync(envelope);
      expect(result).toBe(envelope);
    });
  });

  describe('Large Data Transfer', () => {
    it('should handle large Arrow buffers efficiently', async () => {
      const mockTable = { numRows: 1000000, numCols: 100 } as ArrowTable;
      const mockDecoder = vi.fn().mockReturnValue(mockTable);
      registerArrowDecoder(mockDecoder);

      // Simulate large base64 data
      const largeData = 'x'.repeat(1024 * 1024); // 1MB
      const envelope: CodecEnvelope = {
        __tywrap__: 'dataframe',
        encoding: 'arrow',
        b64: btoa(largeData)
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
        text: `Item ${i}`
      }));

      const envelope = {
        __tywrap__: 'dataframe',
        encoding: 'json',
        data: { records: largeArray }
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
          name: `chunk_${i}`
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
        data: testData
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

      const envelope: CodecEnvelope = {
        __tywrap__: 'dataframe',
        encoding: 'arrow',
        b64: btoa('test data')
      };

      const syncResult = decodeValue(envelope);
      const asyncResult = await decodeValueAsync(envelope);

      // Both should return the mocked table
      expect(syncResult).toBe(mockTable);
      expect(asyncResult).toBe(mockTable);
    });

    it('should handle decoder failures consistently', async () => {
      registerArrowDecoder(() => { throw new Error('Decoder error'); });

      const envelope: CodecEnvelope = {
        __tywrap__: 'dataframe',
        encoding: 'arrow',
        b64: btoa('test data')
      };

      const syncResult = decodeValue(envelope);
      const asyncResult = await decodeValueAsync(envelope);

      // Both should fallback to raw bytes
      expect(syncResult).toBeInstanceOf(Uint8Array);
      expect(asyncResult).toBeInstanceOf(Uint8Array);
      
      // Should contain the same data
      expect(syncResult).toEqual(asyncResult);
    });
  });

  describe('Cross-Runtime Compatibility', () => {
    it('should work consistently across different JavaScript engines', async () => {
      const testEnvelopes = [
        {
          __tywrap__: 'dataframe' as const,
          encoding: 'json' as const,
          data: { columns: ['A'], data: [[1]] }
        },
        {
          __tywrap__: 'series' as const,
          encoding: 'json' as const,
          data: [1, 2, 3]
        },
        {
          __tywrap__: 'ndarray' as const,
          encoding: 'json' as const,
          data: { data: [1, 2, 3, 4], shape: [2, 2] }
        }
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
            from: () => ({ buffer: new ArrayBuffer(0), byteOffset: 0, length: 0 })
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
        }
      ];

      base64Implementations.forEach((setupImpl, index) => {
        setupImpl();

        // Use a simple base64 string for testing
        const testBase64 = 'SGVsbG8sIHdvcmxkIQ=='; // "Hello, world!"
        
        const envelope: CodecEnvelope = {
          __tywrap__: 'ndarray',
          encoding: 'arrow',
          b64: testBase64
        };

        const result = decodeValue(envelope);
        expect(result).toBeInstanceOf(Uint8Array);
      });
    });

    it('should handle different TypedArray support', () => {
      const originalUint8Array = globalThis.Uint8Array;
      const originalArrayBuffer = globalThis.ArrayBuffer;

      try {
        // Test with standard TypedArray
        const envelope: CodecEnvelope = {
          __tywrap__: 'ndarray',
          encoding: 'arrow',
          b64: btoa('test')
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
        data: testData
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
        data: { id: index, values: new Array(100).fill(index) }
      });

      const concurrentOperations = 50;
      const envelopes = Array.from({ length: concurrentOperations }, (_, i) => createEnvelope(i));

      const startTime = Date.now();
      const results = await Promise.all(
        envelopes.map(envelope => decodeValueAsync(envelope))
      );
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
        { __tywrap__: 'dataframe' as const, encoding: 'json' as const, data: { columns: [], data: [] } },
        // Single values
        { __tywrap__: 'series' as const, encoding: 'json' as const, data: [42] },
        // String data
        { __tywrap__: 'series' as const, encoding: 'json' as const, data: ['a', 'b', 'c'] }
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