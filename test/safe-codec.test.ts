/**
 * SafeCodec Test Suite
 *
 * Comprehensive tests for the SafeCodec class that provides unified
 * validation and serialization for JS<->Python boundary crossing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SafeCodec, type CodecOptions } from '../src/runtime/safe-codec.js';
import {
  BridgeCodecError,
  BridgeProtocolError,
  BridgeExecutionError,
} from '../src/runtime/errors.js';

// ═══════════════════════════════════════════════════════════════════════════
// CODEC OPTIONS DEFAULTS
// ═══════════════════════════════════════════════════════════════════════════

describe('CodecOptions defaults', () => {
  it('applies default values when no options provided', () => {
    const codec = new SafeCodec();
    // Test defaults by verifying behavior
    // rejectSpecialFloats defaults to true
    expect(() => codec.encodeRequest(NaN)).toThrow(BridgeCodecError);
    // rejectNonStringKeys defaults to true
    const mapWithNumberKey = new Map<number, string>([[1, 'value']]);
    expect(() => codec.encodeRequest(mapWithNumberKey)).toThrow(BridgeCodecError);
    // maxPayloadBytes defaults to 10MB (tested via a smaller payload that should pass)
    expect(() => codec.encodeRequest({ small: 'data' })).not.toThrow();
  });

  it('allows custom options to override defaults', () => {
    const codec = new SafeCodec({
      rejectSpecialFloats: false,
      rejectNonStringKeys: false,
      maxPayloadBytes: 100,
    });

    // NaN should be allowed (converts to null in JSON)
    const payload = codec.encodeRequest({ value: NaN });
    expect(payload).toContain('null');

    // Map with number key should fail at JSON.stringify level, not our validation
    // Note: Map with non-string keys cannot be serialized to JSON anyway
    // So we test with a valid plain object that would normally pass
    const smallData = { a: 1 };
    expect(() => codec.encodeRequest(smallData)).not.toThrow();

    // But exceeding the custom limit should still throw
    const largeData = { data: 'x'.repeat(200) };
    expect(() => codec.encodeRequest(largeData)).toThrow(BridgeCodecError);
  });

  it('uses bytesHandling default of base64', () => {
    const codec = new SafeCodec();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const payload = codec.encodeRequest({ data: bytes });
    const parsed = JSON.parse(payload);
    expect(parsed.data.__tywrap_bytes__).toBe(true);
    expect(parsed.data.b64).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ENCODE REQUEST - SPECIAL FLOAT REJECTION
// ═══════════════════════════════════════════════════════════════════════════

describe('encodeRequest - Special Float Rejection', () => {
  let codec: SafeCodec;

  beforeEach(() => {
    codec = new SafeCodec({ rejectSpecialFloats: true });
  });

  it('rejects NaN at top level', () => {
    expect(() => codec.encodeRequest(NaN)).toThrow(BridgeCodecError);
    expect(() => codec.encodeRequest(NaN)).toThrow(/non-finite number.*NaN or Infinity/);
    expect(() => codec.encodeRequest(NaN)).toThrow(/at root/);
  });

  it('rejects Infinity at top level', () => {
    expect(() => codec.encodeRequest(Infinity)).toThrow(BridgeCodecError);
    expect(() => codec.encodeRequest(Infinity)).toThrow(/non-finite number/);
  });

  it('rejects -Infinity at top level', () => {
    expect(() => codec.encodeRequest(-Infinity)).toThrow(BridgeCodecError);
    expect(() => codec.encodeRequest(-Infinity)).toThrow(/non-finite number/);
  });

  it('rejects NaN nested in objects', () => {
    const data = { a: { b: { c: NaN } } };
    expect(() => codec.encodeRequest(data)).toThrow(BridgeCodecError);
    expect(() => codec.encodeRequest(data)).toThrow(/at a\.b\.c/);
  });

  it('rejects NaN nested in arrays', () => {
    const data = [1, 2, [3, NaN]];
    expect(() => codec.encodeRequest(data)).toThrow(BridgeCodecError);
    expect(() => codec.encodeRequest(data)).toThrow(/at \[2\]\[1\]/);
  });

  it('rejects Infinity nested in mixed structures', () => {
    const data = { arr: [1, { deep: Infinity }] };
    expect(() => codec.encodeRequest(data)).toThrow(BridgeCodecError);
    expect(() => codec.encodeRequest(data)).toThrow(/at arr\[1\]\.deep/);
  });

  it('passes valid numbers', () => {
    expect(() => codec.encodeRequest(0)).not.toThrow();
    expect(() => codec.encodeRequest(42)).not.toThrow();
    expect(() => codec.encodeRequest(-3.14159)).not.toThrow();
    expect(() => codec.encodeRequest(Number.MAX_VALUE)).not.toThrow();
    expect(() => codec.encodeRequest(Number.MIN_VALUE)).not.toThrow();
    expect(() => codec.encodeRequest({ nested: [1, 2, 3] })).not.toThrow();
  });

  it('can be disabled via rejectSpecialFloats: false', () => {
    const permissiveCodec = new SafeCodec({ rejectSpecialFloats: false });
    // NaN becomes null in JSON
    const payload = permissiveCodec.encodeRequest({ value: NaN });
    expect(JSON.parse(payload)).toEqual({ value: null });
    // Infinity becomes null in JSON
    const payload2 = permissiveCodec.encodeRequest({ value: Infinity });
    expect(JSON.parse(payload2)).toEqual({ value: null });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ENCODE REQUEST - NON-STRING KEY REJECTION
// ═══════════════════════════════════════════════════════════════════════════

describe('encodeRequest - Non-String Key Rejection', () => {
  let codec: SafeCodec;

  beforeEach(() => {
    codec = new SafeCodec({ rejectNonStringKeys: true });
  });

  it('rejects Map with number keys', () => {
    const map = new Map<number, string>([
      [1, 'one'],
      [2, 'two'],
    ]);
    expect(() => codec.encodeRequest({ data: map })).toThrow(BridgeCodecError);
    expect(() => codec.encodeRequest({ data: map })).toThrow(/Non-string key.*Map/);
    expect(() => codec.encodeRequest({ data: map })).toThrow(/1.*number/);
  });

  it('rejects Map with object keys', () => {
    const objKey = { id: 1 };
    const map = new Map<object, string>([[objKey, 'value']]);
    expect(() => codec.encodeRequest({ data: map })).toThrow(BridgeCodecError);
    expect(() => codec.encodeRequest({ data: map })).toThrow(/Non-string key.*Map/);
    expect(() => codec.encodeRequest({ data: map })).toThrow(/object/);
  });

  it('rejects Map with symbol keys', () => {
    const sym = Symbol('test');
    const map = new Map<symbol, string>([[sym, 'value']]);
    expect(() => codec.encodeRequest({ data: map })).toThrow(BridgeCodecError);
    expect(() => codec.encodeRequest({ data: map })).toThrow(/symbol/);
  });

  it('passes Map with string keys', () => {
    const map = new Map<string, number>([
      ['a', 1],
      ['b', 2],
    ]);
    // Note: JSON.stringify doesn't serialize Maps to objects by default
    // It will serialize to {} or needs a replacer, so we just verify validation passes
    expect(() => codec.encodeRequest({ data: map })).not.toThrow();
  });

  it('passes plain objects with string keys', () => {
    const obj = { a: 1, b: 2, nested: { c: 3 } };
    expect(() => codec.encodeRequest(obj)).not.toThrow();
  });

  it('rejects objects with symbol keys', () => {
    const sym = Symbol('hidden');
    const obj = { visible: 'value', [sym]: 'hidden' };
    expect(() => codec.encodeRequest(obj)).toThrow(BridgeCodecError);
    expect(() => codec.encodeRequest(obj)).toThrow(/Symbol key found/);
  });

  it('detects non-string keys in nested structures', () => {
    const innerMap = new Map<number, string>([[42, 'answer']]);
    const data = { outer: { inner: innerMap } };
    expect(() => codec.encodeRequest(data)).toThrow(BridgeCodecError);
    expect(() => codec.encodeRequest(data)).toThrow(/at outer\.inner/);
  });

  it('detects non-string keys in Maps nested in arrays', () => {
    const map = new Map<number, string>([[1, 'one']]);
    const data = [{ maps: [map] }];
    expect(() => codec.encodeRequest(data)).toThrow(BridgeCodecError);
  });

  it('can be disabled via rejectNonStringKeys: false', () => {
    const permissiveCodec = new SafeCodec({ rejectNonStringKeys: false });
    const map = new Map<number, string>([[1, 'one']]);
    // Validation should pass (though JSON.stringify still won't serialize Map properly)
    expect(() => permissiveCodec.encodeRequest({ data: map })).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ENCODE REQUEST - SIZE LIMITS
// ═══════════════════════════════════════════════════════════════════════════

describe('encodeRequest - Size Limits', () => {
  it('rejects payload exceeding maxPayloadBytes', () => {
    const codec = new SafeCodec({ maxPayloadBytes: 100 });
    const largeData = { data: 'x'.repeat(200) };
    expect(() => codec.encodeRequest(largeData)).toThrow(BridgeCodecError);
    expect(() => codec.encodeRequest(largeData)).toThrow(/exceeds maximum/);
    expect(() => codec.encodeRequest(largeData)).toThrow(/100 bytes/);
  });

  it('passes payload under limit', () => {
    const codec = new SafeCodec({ maxPayloadBytes: 1000 });
    const smallData = { data: 'x'.repeat(50) };
    expect(() => codec.encodeRequest(smallData)).not.toThrow();
  });

  it('allows custom limit to be set', () => {
    const tinyCodec = new SafeCodec({ maxPayloadBytes: 50 });
    const smallData = { a: 1 };
    expect(() => tinyCodec.encodeRequest(smallData)).not.toThrow();
    const biggerData = { data: 'x'.repeat(100) };
    expect(() => tinyCodec.encodeRequest(biggerData)).toThrow(BridgeCodecError);
  });

  it('default limit is 10MB', () => {
    const codec = new SafeCodec();
    // Just under 10MB should pass (we use a smaller value for test speed)
    const safeData = { data: 'x'.repeat(1000) };
    expect(() => codec.encodeRequest(safeData)).not.toThrow();
  });

  it('calculates size in bytes not characters (handles unicode)', () => {
    const codec = new SafeCodec({ maxPayloadBytes: 50 });
    // Multi-byte unicode characters: emoji is typically 4 bytes
    const emojiData = { data: '\u{1F600}'.repeat(10) }; // 10 emoji = 40+ bytes
    // The JSON encoding will be larger due to unicode escape sequences or UTF-8
    const payload = JSON.stringify(emojiData);
    const actualBytes = new TextEncoder().encode(payload).length;
    if (actualBytes > 50) {
      expect(() => codec.encodeRequest(emojiData)).toThrow(BridgeCodecError);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ENCODE REQUEST - SERIALIZATION ERRORS
// ═══════════════════════════════════════════════════════════════════════════

describe('encodeRequest - Serialization Errors', () => {
  it('circular references throw BridgeCodecError by default', () => {
    const codec = new SafeCodec();
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(() => codec.encodeRequest(circular)).toThrow(BridgeCodecError);
    expect(() => codec.encodeRequest(circular)).toThrow(/JSON serialization failed/);
  });

  it('circular references throw BridgeCodecError when validation guardrails are disabled', () => {
    const codec = new SafeCodec({ rejectSpecialFloats: false, rejectNonStringKeys: false });
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(() => codec.encodeRequest(circular)).toThrow(BridgeCodecError);
    expect(() => codec.encodeRequest(circular)).toThrow(/JSON serialization failed/);
  });

  it('BigInt throws BridgeCodecError', () => {
    const codec = new SafeCodec();
    const data = { value: BigInt(12345678901234567890n) };
    expect(() => codec.encodeRequest(data)).toThrow(BridgeCodecError);
    expect(() => codec.encodeRequest(data)).toThrow(/JSON serialization failed/);
  });

  it('functions are omitted by JSON.stringify', () => {
    const codec = new SafeCodec();
    const data = { fn: () => 'test' };
    // Functions are converted to undefined/omitted by JSON.stringify
    // Actually they're just omitted, so this should not throw
    const payload = codec.encodeRequest(data);
    expect(JSON.parse(payload)).toEqual({});
  });

  it('undefined values are handled by JSON.stringify', () => {
    const codec = new SafeCodec();
    const data = { a: undefined, b: 1 };
    const payload = codec.encodeRequest(data);
    // undefined properties are omitted
    expect(JSON.parse(payload)).toEqual({ b: 1 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ENCODE REQUEST - BYTES HANDLING
// ═══════════════════════════════════════════════════════════════════════════

describe('encodeRequest - Bytes Handling', () => {
  it('encodes Uint8Array to base64 with marker (default)', () => {
    const codec = new SafeCodec({ bytesHandling: 'base64' });
    const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const payload = codec.encodeRequest({ data: bytes });
    const parsed = JSON.parse(payload);
    expect(parsed.data.__tywrap_bytes__).toBe(true);
    expect(parsed.data.b64).toBe('SGVsbG8='); // base64 of "Hello"
  });

  it('encodes ArrayBuffer to base64 with marker', () => {
    const codec = new SafeCodec({ bytesHandling: 'base64' });
    const buffer = new Uint8Array([1, 2, 3, 4]).buffer;
    const payload = codec.encodeRequest({ data: buffer });
    const parsed = JSON.parse(payload);
    expect(parsed.data.__tywrap_bytes__).toBe(true);
    expect(parsed.data.b64).toBeDefined();
  });

  it('rejects binary data when bytesHandling is reject', () => {
    const codec = new SafeCodec({ bytesHandling: 'reject' });
    const bytes = new Uint8Array([1, 2, 3]);
    expect(() => codec.encodeRequest({ data: bytes })).toThrow(BridgeCodecError);
    expect(() => codec.encodeRequest({ data: bytes })).toThrow(/binary data found/);
    expect(() => codec.encodeRequest({ data: bytes })).toThrow(/bytesHandling: reject/);
  });

  it('passes through binary data when bytesHandling is passthrough', () => {
    const codec = new SafeCodec({ bytesHandling: 'passthrough' });
    const bytes = new Uint8Array([1, 2, 3]);
    // passthrough means we don't transform, but JSON.stringify will still fail
    // to serialize Uint8Array properly (it becomes an object with indices)
    const payload = codec.encodeRequest({ data: bytes });
    const parsed = JSON.parse(payload);
    expect(parsed.data).toEqual({ '0': 1, '1': 2, '2': 3 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DECODE RESPONSE - BASIC
// ═══════════════════════════════════════════════════════════════════════════

describe('decodeResponse - Basic', () => {
  let codec: SafeCodec;

  beforeEach(() => {
    codec = new SafeCodec();
  });

  it('parses valid JSON', () => {
    const result = codec.decodeResponse<{ a: number }>('{"a": 1}');
    expect(result).toEqual({ a: 1 });
  });

  it('decodes Python bytes envelope (__type__: bytes) to Uint8Array', () => {
    const payload = JSON.stringify({
      id: 1,
      result: { __type__: 'bytes', encoding: 'base64', data: 'SGVsbG8=' }, // "Hello"
    });
    const result = codec.decodeResponse<Uint8Array>(payload);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(Array.from(result)).toEqual([72, 101, 108, 108, 111]);
  });

  it('parses arrays', () => {
    const result = codec.decodeResponse<number[]>('[1, 2, 3]');
    expect(result).toEqual([1, 2, 3]);
  });

  it('parses primitives', () => {
    expect(codec.decodeResponse<number>('42')).toBe(42);
    expect(codec.decodeResponse<string>('"hello"')).toBe('hello');
    expect(codec.decodeResponse<boolean>('true')).toBe(true);
    expect(codec.decodeResponse<null>('null')).toBe(null);
  });

  it('throws BridgeCodecError on invalid JSON', () => {
    expect(() => codec.decodeResponse('not json')).toThrow(BridgeCodecError);
    expect(() => codec.decodeResponse('not json')).toThrow(/JSON parse failed/);
  });

  it('throws BridgeCodecError on malformed JSON', () => {
    expect(() => codec.decodeResponse('{"a": }')).toThrow(BridgeCodecError);
    expect(() => codec.decodeResponse('{unterminated')).toThrow(BridgeCodecError);
  });

  it('respects maxPayloadBytes on response', () => {
    const smallCodec = new SafeCodec({ maxPayloadBytes: 50 });
    const largePayload = JSON.stringify({ data: 'x'.repeat(100) });
    expect(() => smallCodec.decodeResponse(largePayload)).toThrow(BridgeCodecError);
    expect(() => smallCodec.decodeResponse(largePayload)).toThrow(/exceeds maximum/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DECODE RESPONSE - ERROR DETECTION
// ═══════════════════════════════════════════════════════════════════════════

describe('decodeResponse - Error Detection', () => {
  let codec: SafeCodec;

  beforeEach(() => {
    codec = new SafeCodec();
  });

  it('detects { error: { type, message } } format', () => {
    const errorPayload = JSON.stringify({
      error: {
        type: 'ValueError',
        message: 'invalid argument',
      },
    });
    expect(() => codec.decodeResponse(errorPayload)).toThrow(BridgeExecutionError);
  });

  it('throws BridgeExecutionError with formatted message', () => {
    const errorPayload = JSON.stringify({
      error: {
        type: 'TypeError',
        message: 'expected int, got str',
      },
    });
    expect(() => codec.decodeResponse(errorPayload)).toThrow('TypeError: expected int, got str');
  });

  it('includes traceback in error cause if present', () => {
    const errorPayload = JSON.stringify({
      error: {
        type: 'RuntimeError',
        message: 'something failed',
        traceback:
          'Traceback (most recent call last):\n  File "test.py", line 1\nRuntimeError: something failed',
      },
    });
    try {
      codec.decodeResponse(errorPayload);
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BridgeExecutionError);
      const bridgeErr = err as BridgeExecutionError;
      expect(bridgeErr.traceback).toContain('Traceback');
      expect(bridgeErr.traceback).toContain('line 1');
    }
  });

  it('does not treat partial error format as error', () => {
    // Missing message field
    const partialError1 = JSON.stringify({ error: { type: 'Error' } });
    const result1 = codec.decodeResponse<{ error: { type: string } }>(partialError1);
    expect(result1.error.type).toBe('Error');

    // Missing type field
    const partialError2 = JSON.stringify({ error: { message: 'oops' } });
    const result2 = codec.decodeResponse<{ error: { message: string } }>(partialError2);
    expect(result2.error.message).toBe('oops');

    // Error is not an object
    const nonObjectError = JSON.stringify({ error: 'string error' });
    const result3 = codec.decodeResponse<{ error: string }>(nonObjectError);
    expect(result3.error).toBe('string error');
  });

  it('handles error with empty traceback', () => {
    const errorPayload = JSON.stringify({
      error: {
        type: 'CustomError',
        message: 'test error',
        traceback: '',
      },
    });
    try {
      codec.decodeResponse(errorPayload);
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BridgeExecutionError);
      const bridgeErr = err as BridgeExecutionError;
      expect(bridgeErr.traceback).toBe('');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DECODE RESPONSE - POST-DECODE VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

describe('decodeResponse - Post-decode Validation', () => {
  // NOTE: JSON.parse cannot produce NaN/Infinity from standard JSON
  // However, we can test that the validation logic is in place by
  // checking that valid JSON passes through correctly

  it('passes valid JSON with finite numbers', () => {
    const codec = new SafeCodec({ rejectSpecialFloats: true });
    const payload = JSON.stringify({ value: 3.14159, nested: [1, 2, 3] });
    const result = codec.decodeResponse<{ value: number; nested: number[] }>(payload);
    expect(result.value).toBeCloseTo(3.14159);
    expect(result.nested).toEqual([1, 2, 3]);
  });

  it('handles null values correctly', () => {
    const codec = new SafeCodec({ rejectSpecialFloats: true });
    const payload = JSON.stringify({ value: null, list: [null, 1, null] });
    const result = codec.decodeResponse<{ value: null; list: (null | number)[] }>(payload);
    expect(result.value).toBeNull();
    expect(result.list).toEqual([null, 1, null]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DECODE RESPONSE ASYNC - ARROW INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════

describe('decodeResponseAsync - Arrow Integration', () => {
  let codec: SafeCodec;

  beforeEach(() => {
    codec = new SafeCodec();
  });

  it('handles simple JSON without Arrow markers', async () => {
    const payload = JSON.stringify({ simple: 'data' });
    const result = await codec.decodeResponseAsync<{ simple: string }>(payload);
    expect(result).toEqual({ simple: 'data' });
  });

  it('respects maxPayloadBytes', async () => {
    const smallCodec = new SafeCodec({ maxPayloadBytes: 50 });
    const largePayload = JSON.stringify({ data: 'x'.repeat(100) });
    await expect(smallCodec.decodeResponseAsync(largePayload)).rejects.toThrow(BridgeCodecError);
  });

  it('throws BridgeCodecError on invalid JSON', async () => {
    await expect(codec.decodeResponseAsync('not json')).rejects.toThrow(BridgeCodecError);
    await expect(codec.decodeResponseAsync('not json')).rejects.toThrow(/JSON parse failed/);
  });

  it('detects Python error responses', async () => {
    const errorPayload = JSON.stringify({
      error: {
        type: 'ValueError',
        message: 'test error',
      },
    });
    await expect(codec.decodeResponseAsync(errorPayload)).rejects.toThrow(BridgeExecutionError);
    await expect(codec.decodeResponseAsync(errorPayload)).rejects.toThrow('ValueError: test error');
  });

  it('includes traceback in async error', async () => {
    const errorPayload = JSON.stringify({
      error: {
        type: 'RuntimeError',
        message: 'async error',
        traceback: 'Full traceback here',
      },
    });
    try {
      await codec.decodeResponseAsync(errorPayload);
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BridgeExecutionError);
      const bridgeErr = err as BridgeExecutionError;
      expect(bridgeErr.traceback).toBe('Full traceback here');
    }
  });

  it('rejects malformed envelope error payloads in async decode', async () => {
    const payload = JSON.stringify({
      id: 1,
      protocol: 'tywrap/1',
      error: {},
    });
    await expect(codec.decodeResponseAsync(payload)).rejects.toThrow(BridgeProtocolError);
    await expect(codec.decodeResponseAsync(payload)).rejects.toThrow(
      /Invalid response "error" payload/
    );
  });

  // NOTE: Full Arrow decoding tests would require mocking the Arrow decoder
  // or having apache-arrow installed. The decodeValueAsync function from
  // codec.ts handles the actual Arrow decoding.
});

// ═══════════════════════════════════════════════════════════════════════════
// ROUND-TRIP TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('Round-trip encoding/decoding', () => {
  let codec: SafeCodec;

  beforeEach(() => {
    codec = new SafeCodec();
  });

  it('round-trips simple objects', () => {
    const original = { a: 1, b: 'hello', c: [1, 2, 3] };
    const encoded = codec.encodeRequest(original);
    const decoded = codec.decodeResponse<typeof original>(encoded);
    expect(decoded).toEqual(original);
  });

  it('round-trips nested structures', () => {
    const original = {
      level1: {
        level2: {
          level3: {
            value: 'deep',
            numbers: [1, 2, 3],
          },
        },
      },
    };
    const encoded = codec.encodeRequest(original);
    const decoded = codec.decodeResponse<typeof original>(encoded);
    expect(decoded).toEqual(original);
  });

  it('round-trips arrays of objects', () => {
    const original = [
      { id: 1, name: 'first' },
      { id: 2, name: 'second' },
    ];
    const encoded = codec.encodeRequest(original);
    const decoded = codec.decodeResponse<typeof original>(encoded);
    expect(decoded).toEqual(original);
  });

  it('round-trips with special values converted', () => {
    const permissiveCodec = new SafeCodec({ rejectSpecialFloats: false });
    const original = { normal: 42, special: NaN };
    const encoded = permissiveCodec.encodeRequest(original);
    const decoded = permissiveCodec.decodeResponse<{ normal: number; special: null }>(encoded);
    // NaN becomes null in JSON
    expect(decoded.normal).toBe(42);
    expect(decoded.special).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════

describe('Edge Cases', () => {
  let codec: SafeCodec;

  beforeEach(() => {
    codec = new SafeCodec();
  });

  it('handles empty objects', () => {
    const encoded = codec.encodeRequest({});
    const decoded = codec.decodeResponse<Record<string, never>>(encoded);
    expect(decoded).toEqual({});
  });

  it('handles empty arrays', () => {
    const encoded = codec.encodeRequest([]);
    const decoded = codec.decodeResponse<never[]>(encoded);
    expect(decoded).toEqual([]);
  });

  it('handles deeply nested structures without stack overflow', () => {
    // Create a moderately deep structure
    let deep: Record<string, unknown> = { value: 'leaf' };
    for (let i = 0; i < 100; i++) {
      deep = { nested: deep };
    }
    expect(() => codec.encodeRequest(deep)).not.toThrow();
  });

  it('handles arrays with holes correctly', () => {
    const sparse = [1, , 3]; // sparse array with hole
    const encoded = codec.encodeRequest(sparse);
    const decoded = codec.decodeResponse<(number | null)[]>(encoded);
    // JSON converts holes to null
    expect(decoded).toEqual([1, null, 3]);
  });

  it('handles Date objects (converted to ISO strings by default)', () => {
    const data = { timestamp: new Date('2024-01-01T00:00:00Z') };
    const encoded = codec.encodeRequest(data);
    const decoded = codec.decodeResponse<{ timestamp: string }>(encoded);
    expect(decoded.timestamp).toBe('2024-01-01T00:00:00.000Z');
  });

  it('handles very large numbers', () => {
    const data = { big: Number.MAX_SAFE_INTEGER, small: Number.MIN_SAFE_INTEGER };
    const encoded = codec.encodeRequest(data);
    const decoded = codec.decodeResponse<typeof data>(encoded);
    expect(decoded.big).toBe(Number.MAX_SAFE_INTEGER);
    expect(decoded.small).toBe(Number.MIN_SAFE_INTEGER);
  });

  it('handles unicode strings', () => {
    const data = {
      emoji: '\u{1F600}\u{1F389}',
      chinese: '\u4E2D\u6587',
      arabic: '\u0627\u0644\u0639\u0631\u0628\u064A\u0629',
    };
    const encoded = codec.encodeRequest(data);
    const decoded = codec.decodeResponse<typeof data>(encoded);
    expect(decoded).toEqual(data);
  });

  it('handles strings with escape sequences', () => {
    const data = { text: 'line1\nline2\ttab\r\nwindows' };
    const encoded = codec.encodeRequest(data);
    const decoded = codec.decodeResponse<typeof data>(encoded);
    expect(decoded.text).toBe('line1\nline2\ttab\r\nwindows');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DECODE RESPONSE - PROTOCOL VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

describe('decodeResponse - Protocol Validation', () => {
  let codec: SafeCodec;

  beforeEach(() => {
    codec = new SafeCodec();
  });

  it('accepts response without protocol field (backwards compatibility)', () => {
    const payload = JSON.stringify({ id: 1, result: 42 });
    const result = codec.decodeResponse<number>(payload);
    expect(result).toBe(42);
  });

  it('accepts response with correct protocol version', () => {
    const payload = JSON.stringify({ id: 1, protocol: 'tywrap/1', result: { data: 'test' } });
    const result = codec.decodeResponse<{ data: string }>(payload);
    expect(result).toEqual({ data: 'test' });
  });

  it('rejects response with wrong protocol version', () => {
    const payload = JSON.stringify({ id: 1, protocol: 'tywrap/0', result: 42 });
    expect(() => codec.decodeResponse(payload)).toThrow(BridgeProtocolError);
    expect(() => codec.decodeResponse(payload)).toThrow(/Invalid protocol version/);
  });

  it('rejects response with unknown protocol', () => {
    const payload = JSON.stringify({ id: 1, protocol: 'unknown/1', result: 42 });
    expect(() => codec.decodeResponse(payload)).toThrow(BridgeProtocolError);
    expect(() => codec.decodeResponse(payload)).toThrow(/expected "tywrap\/1"/);
  });

  it('validates protocol before extracting error response', () => {
    // If protocol is wrong, we should reject before checking for Python errors
    const payload = JSON.stringify({
      id: 1,
      protocol: 'wrong/1',
      error: { type: 'ValueError', message: 'test' },
    });
    expect(() => codec.decodeResponse(payload)).toThrow(BridgeProtocolError);
    expect(() => codec.decodeResponse(payload)).toThrow(/Invalid protocol version/);
  });

  it('rejects malformed envelope error payloads', () => {
    const nonObjectErrorPayload = JSON.stringify({
      id: 1,
      protocol: 'tywrap/1',
      error: 'oops',
    });
    expect(() => codec.decodeResponse(nonObjectErrorPayload)).toThrow(BridgeProtocolError);
    expect(() => codec.decodeResponse(nonObjectErrorPayload)).toThrow(
      /Invalid response "error" payload/
    );

    const missingFieldsPayload = JSON.stringify({
      id: 1,
      protocol: 'tywrap/1',
      error: {},
    });
    expect(() => codec.decodeResponse(missingFieldsPayload)).toThrow(BridgeProtocolError);
    expect(() => codec.decodeResponse(missingFieldsPayload)).toThrow(
      /Invalid response "error" payload/
    );
  });

  it('rejects envelopes that contain both result and error', () => {
    const payload = JSON.stringify({
      id: 1,
      protocol: 'tywrap/1',
      result: 42,
      error: { type: 'ValueError', message: 'oops' },
    });
    expect(() => codec.decodeResponse(payload)).toThrow(BridgeProtocolError);
    expect(() => codec.decodeResponse(payload)).toThrow(/both "result" and "error"/);
  });

  it('does not validate protocol on non-envelope responses', () => {
    // User data that happens to contain 'protocol' key should not trigger validation
    // Only responses with 'id' field are treated as protocol envelopes
    const payload = JSON.stringify({ protocol: 'http', url: 'https://example.com' });
    const result = codec.decodeResponse<{ protocol: string; url: string }>(payload);
    expect(result).toEqual({ protocol: 'http', url: 'https://example.com' });
  });
});
