/**
 * Validators Test Suite
 *
 * Tests for pure validation functions used by BoundedContext and CLI tools.
 */

import { describe, it, expect } from 'vitest';
import {
  // Type guards
  isFiniteNumber,
  isPositiveNumber,
  isNonNegativeNumber,
  isNonEmptyString,
  isPlainObject,
  // Assertions
  assertFiniteNumber,
  assertPositive,
  assertNonNegative,
  assertString,
  assertNonEmptyString,
  assertArray,
  assertObject,
  // Special float detection
  containsSpecialFloat,
  assertNoSpecialFloats,
  // Path validation
  sanitizeForFilename,
  containsPathTraversal,
  // Error
  ValidationError,
} from '../src/runtime/validators.js';

// ═══════════════════════════════════════════════════════════════════════════
// TYPE GUARDS
// ═══════════════════════════════════════════════════════════════════════════

describe('isFiniteNumber', () => {
  it('returns true for finite numbers', () => {
    expect(isFiniteNumber(0)).toBe(true);
    expect(isFiniteNumber(42)).toBe(true);
    expect(isFiniteNumber(-1)).toBe(true);
    expect(isFiniteNumber(3.14)).toBe(true);
    expect(isFiniteNumber(Number.MAX_VALUE)).toBe(true);
    expect(isFiniteNumber(Number.MIN_VALUE)).toBe(true);
  });

  it('returns false for non-finite numbers', () => {
    expect(isFiniteNumber(NaN)).toBe(false);
    expect(isFiniteNumber(Infinity)).toBe(false);
    expect(isFiniteNumber(-Infinity)).toBe(false);
  });

  it('returns false for non-numbers', () => {
    expect(isFiniteNumber('42')).toBe(false);
    expect(isFiniteNumber(null)).toBe(false);
    expect(isFiniteNumber(undefined)).toBe(false);
    expect(isFiniteNumber({})).toBe(false);
    expect(isFiniteNumber([])).toBe(false);
    expect(isFiniteNumber(true)).toBe(false);
  });
});

describe('isPositiveNumber', () => {
  it('returns true for positive numbers', () => {
    expect(isPositiveNumber(1)).toBe(true);
    expect(isPositiveNumber(0.001)).toBe(true);
    expect(isPositiveNumber(Number.MAX_VALUE)).toBe(true);
  });

  it('returns false for zero and negative numbers', () => {
    expect(isPositiveNumber(0)).toBe(false);
    expect(isPositiveNumber(-1)).toBe(false);
    expect(isPositiveNumber(-0.001)).toBe(false);
  });

  it('returns false for non-finite values', () => {
    expect(isPositiveNumber(Infinity)).toBe(false);
    expect(isPositiveNumber(NaN)).toBe(false);
  });
});

describe('isNonNegativeNumber', () => {
  it('returns true for zero and positive numbers', () => {
    expect(isNonNegativeNumber(0)).toBe(true);
    expect(isNonNegativeNumber(1)).toBe(true);
    expect(isNonNegativeNumber(0.001)).toBe(true);
  });

  it('returns false for negative numbers', () => {
    expect(isNonNegativeNumber(-1)).toBe(false);
    expect(isNonNegativeNumber(-0.001)).toBe(false);
  });

  it('returns false for non-finite values', () => {
    expect(isNonNegativeNumber(Infinity)).toBe(false);
    expect(isNonNegativeNumber(NaN)).toBe(false);
  });
});

describe('isNonEmptyString', () => {
  it('returns true for non-empty strings', () => {
    expect(isNonEmptyString('hello')).toBe(true);
    expect(isNonEmptyString(' ')).toBe(true);
    expect(isNonEmptyString('0')).toBe(true);
  });

  it('returns false for empty strings', () => {
    expect(isNonEmptyString('')).toBe(false);
  });

  it('returns false for non-strings', () => {
    expect(isNonEmptyString(42)).toBe(false);
    expect(isNonEmptyString(null)).toBe(false);
    expect(isNonEmptyString(undefined)).toBe(false);
    expect(isNonEmptyString([])).toBe(false);
  });
});

describe('isPlainObject', () => {
  it('returns true for plain objects', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
  });

  it('returns false for arrays', () => {
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject([1, 2, 3])).toBe(false);
  });

  it('returns false for null', () => {
    expect(isPlainObject(null)).toBe(false);
  });

  it('returns false for primitives', () => {
    expect(isPlainObject('string')).toBe(false);
    expect(isPlainObject(42)).toBe(false);
    expect(isPlainObject(true)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ASSERTIONS
// ═══════════════════════════════════════════════════════════════════════════

describe('assertFiniteNumber', () => {
  it('returns the value for finite numbers', () => {
    expect(assertFiniteNumber(42, 'test')).toBe(42);
    expect(assertFiniteNumber(0, 'test')).toBe(0);
    expect(assertFiniteNumber(-3.14, 'test')).toBe(-3.14);
  });

  it('throws ValidationError for NaN', () => {
    expect(() => assertFiniteNumber(NaN, 'value')).toThrow(ValidationError);
    expect(() => assertFiniteNumber(NaN, 'value')).toThrow(/value must be a finite number, got: NaN/);
  });

  it('throws ValidationError for Infinity', () => {
    expect(() => assertFiniteNumber(Infinity, 'value')).toThrow(ValidationError);
    expect(() => assertFiniteNumber(Infinity, 'value')).toThrow(/got: Infinity/);
  });

  it('throws ValidationError for non-numbers', () => {
    expect(() => assertFiniteNumber('42', 'value')).toThrow(ValidationError);
    expect(() => assertFiniteNumber('42', 'value')).toThrow(/got: string/);
  });
});

describe('assertPositive', () => {
  it('returns the value for positive numbers', () => {
    expect(assertPositive(1, 'test')).toBe(1);
    expect(assertPositive(0.001, 'test')).toBe(0.001);
  });

  it('throws ValidationError for zero', () => {
    expect(() => assertPositive(0, 'value')).toThrow(ValidationError);
    expect(() => assertPositive(0, 'value')).toThrow(/value must be positive, got: 0/);
  });

  it('throws ValidationError for negative numbers', () => {
    expect(() => assertPositive(-1, 'value')).toThrow(ValidationError);
    expect(() => assertPositive(-1, 'value')).toThrow(/must be positive/);
  });

  it('throws ValidationError for non-numbers', () => {
    expect(() => assertPositive('1', 'value')).toThrow(ValidationError);
  });
});

describe('assertNonNegative', () => {
  it('returns the value for zero and positive numbers', () => {
    expect(assertNonNegative(0, 'test')).toBe(0);
    expect(assertNonNegative(1, 'test')).toBe(1);
  });

  it('throws ValidationError for negative numbers', () => {
    expect(() => assertNonNegative(-1, 'value')).toThrow(ValidationError);
    expect(() => assertNonNegative(-1, 'value')).toThrow(/value must be non-negative, got: -1/);
  });
});

describe('assertString', () => {
  it('returns the value for strings', () => {
    expect(assertString('hello', 'test')).toBe('hello');
    expect(assertString('', 'test')).toBe('');
  });

  it('throws ValidationError for non-strings', () => {
    expect(() => assertString(42, 'value')).toThrow(ValidationError);
    expect(() => assertString(42, 'value')).toThrow(/value must be a string, got: number/);
  });
});

describe('assertNonEmptyString', () => {
  it('returns the value for non-empty strings', () => {
    expect(assertNonEmptyString('hello', 'test')).toBe('hello');
  });

  it('throws ValidationError for empty strings', () => {
    expect(() => assertNonEmptyString('', 'value')).toThrow(ValidationError);
    expect(() => assertNonEmptyString('', 'value')).toThrow(/value must not be empty/);
  });

  it('throws ValidationError for non-strings', () => {
    expect(() => assertNonEmptyString(42, 'value')).toThrow(ValidationError);
  });
});

describe('assertArray', () => {
  it('returns the value for arrays', () => {
    expect(assertArray([], 'test')).toEqual([]);
    expect(assertArray([1, 2, 3], 'test')).toEqual([1, 2, 3]);
  });

  it('throws ValidationError for non-arrays', () => {
    expect(() => assertArray({}, 'value')).toThrow(ValidationError);
    expect(() => assertArray({}, 'value')).toThrow(/value must be an array, got: object/);
    expect(() => assertArray('string', 'value')).toThrow(/got: string/);
  });
});

describe('assertObject', () => {
  it('returns the value for plain objects', () => {
    expect(assertObject({}, 'test')).toEqual({});
    expect(assertObject({ a: 1 }, 'test')).toEqual({ a: 1 });
  });

  it('throws ValidationError for null', () => {
    expect(() => assertObject(null, 'value')).toThrow(ValidationError);
    expect(() => assertObject(null, 'value')).toThrow(/value must be an object, got: null/);
  });

  it('throws ValidationError for arrays', () => {
    expect(() => assertObject([], 'value')).toThrow(ValidationError);
    expect(() => assertObject([], 'value')).toThrow(/got: array/);
  });

  it('throws ValidationError for primitives', () => {
    expect(() => assertObject('string', 'value')).toThrow(ValidationError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SPECIAL FLOAT DETECTION
// ═══════════════════════════════════════════════════════════════════════════

describe('containsSpecialFloat', () => {
  it('returns false for finite numbers', () => {
    expect(containsSpecialFloat(0)).toBe(false);
    expect(containsSpecialFloat(42)).toBe(false);
    expect(containsSpecialFloat(-3.14)).toBe(false);
  });

  it('returns true for NaN', () => {
    expect(containsSpecialFloat(NaN)).toBe(true);
  });

  it('returns true for Infinity', () => {
    expect(containsSpecialFloat(Infinity)).toBe(true);
    expect(containsSpecialFloat(-Infinity)).toBe(true);
  });

  it('returns false for non-number primitives', () => {
    expect(containsSpecialFloat('NaN')).toBe(false);
    expect(containsSpecialFloat(null)).toBe(false);
    expect(containsSpecialFloat(undefined)).toBe(false);
    expect(containsSpecialFloat(true)).toBe(false);
  });

  it('detects special floats in arrays', () => {
    expect(containsSpecialFloat([1, 2, 3])).toBe(false);
    expect(containsSpecialFloat([1, NaN, 3])).toBe(true);
    expect(containsSpecialFloat([1, Infinity, 3])).toBe(true);
  });

  it('detects special floats in nested arrays', () => {
    expect(containsSpecialFloat([[1, 2], [3, 4]])).toBe(false);
    expect(containsSpecialFloat([[1, 2], [NaN, 4]])).toBe(true);
  });

  it('detects special floats in objects', () => {
    expect(containsSpecialFloat({ a: 1, b: 2 })).toBe(false);
    expect(containsSpecialFloat({ a: 1, b: NaN })).toBe(true);
    expect(containsSpecialFloat({ a: Infinity })).toBe(true);
  });

  it('detects special floats in nested objects', () => {
    expect(containsSpecialFloat({ a: { b: { c: 1 } } })).toBe(false);
    expect(containsSpecialFloat({ a: { b: { c: NaN } } })).toBe(true);
  });

  it('detects special floats in mixed structures', () => {
    expect(containsSpecialFloat({ arr: [1, 2], obj: { x: 3 } })).toBe(false);
    expect(containsSpecialFloat({ arr: [1, Infinity], obj: { x: 3 } })).toBe(true);
    expect(containsSpecialFloat([{ a: 1 }, { b: NaN }])).toBe(true);
  });

  it('handles circular object references without recursion overflow', () => {
    const circular: { value: number; self?: unknown } = { value: 1 };
    circular.self = circular;
    expect(containsSpecialFloat(circular)).toBe(false);
  });

  it('detects special floats inside circular structures', () => {
    const child: { value: number; parent?: unknown } = { value: NaN };
    const root: { child: typeof child } = { child };
    child.parent = root;
    expect(containsSpecialFloat(root)).toBe(true);
  });
});

describe('assertNoSpecialFloats', () => {
  it('does not throw for finite values', () => {
    expect(() => assertNoSpecialFloats(42, 'test')).not.toThrow();
    expect(() => assertNoSpecialFloats([1, 2, 3], 'test')).not.toThrow();
    expect(() => assertNoSpecialFloats({ a: 1 }, 'test')).not.toThrow();
  });

  it('throws ValidationError for NaN', () => {
    expect(() => assertNoSpecialFloats(NaN, 'value')).toThrow(ValidationError);
    expect(() => assertNoSpecialFloats(NaN, 'value')).toThrow(/non-finite numbers/);
  });

  it('throws ValidationError for Infinity in nested structure', () => {
    expect(() => assertNoSpecialFloats({ deep: { value: Infinity } }, 'data')).toThrow(
      ValidationError
    );
  });

  it('throws ValidationError for special floats in circular structures', () => {
    const child: { value: number; parent?: unknown } = { value: Infinity };
    const root: { child: typeof child } = { child };
    child.parent = root;
    expect(() => assertNoSpecialFloats(root, 'data')).toThrow(ValidationError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PATH VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

describe('sanitizeForFilename', () => {
  it('passes through safe strings', () => {
    expect(sanitizeForFilename('hello')).toBe('hello');
    expect(sanitizeForFilename('my_file_123')).toBe('my_file_123');
  });

  it('replaces path traversal patterns', () => {
    // '../file' -> '__/file' (.. → __) -> '___file' (/ → _)
    expect(sanitizeForFilename('../file')).toBe('___file');
    // '..\\..\\file' -> '__\\__\\file' (.. → __) -> '______file' (\\ → _)
    expect(sanitizeForFilename('..\\..\\file')).toBe('______file');
  });

  it('replaces path separators', () => {
    expect(sanitizeForFilename('path/to/file')).toBe('path_to_file');
    expect(sanitizeForFilename('path\\to\\file')).toBe('path_to_file');
  });

  it('replaces invalid filename characters', () => {
    expect(sanitizeForFilename('file:name')).toBe('file_name');
    expect(sanitizeForFilename('file*name')).toBe('file_name');
    expect(sanitizeForFilename('file?name')).toBe('file_name');
    expect(sanitizeForFilename('file"name')).toBe('file_name');
    expect(sanitizeForFilename('file<name>')).toBe('file_name_');
    expect(sanitizeForFilename('file|name')).toBe('file_name');
  });

  it('replaces whitespace', () => {
    expect(sanitizeForFilename('file name')).toBe('file_name');
    expect(sanitizeForFilename('file  name')).toBe('file_name');
    expect(sanitizeForFilename('file\tname')).toBe('file_name');
  });
});

describe('containsPathTraversal', () => {
  it('returns false for safe paths', () => {
    expect(containsPathTraversal('hello')).toBe(false);
    expect(containsPathTraversal('my_file.txt')).toBe(false);
    expect(containsPathTraversal('some.thing.here')).toBe(false);
  });

  it('returns true for dot-dot sequences', () => {
    expect(containsPathTraversal('../file')).toBe(true);
    expect(containsPathTraversal('..\\file')).toBe(true);
    expect(containsPathTraversal('path/../file')).toBe(true);
  });

  it('returns true for forward slashes', () => {
    expect(containsPathTraversal('path/to/file')).toBe(true);
  });

  it('returns true for backslashes', () => {
    expect(containsPathTraversal('path\\to\\file')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION ERROR
// ═══════════════════════════════════════════════════════════════════════════

describe('ValidationError', () => {
  it('has correct name property', () => {
    const error = new ValidationError('test message');
    expect(error.name).toBe('ValidationError');
  });

  it('has correct message', () => {
    const error = new ValidationError('test message');
    expect(error.message).toBe('test message');
  });

  it('is instanceof Error', () => {
    const error = new ValidationError('test');
    expect(error).toBeInstanceOf(Error);
  });
});
