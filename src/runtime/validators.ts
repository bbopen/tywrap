import { BridgeValidationError } from './errors.js';

/**
 * Pure validation functions for runtime value checking.
 *
 * These functions are used by BoundedContext and can also be used
 * independently for validation in CLI tools, config loading, etc.
 */

/**
 * Error thrown when validation fails.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** A serializable return-contract description emitted by the code generator. */
export type ReturnSchema =
  | { kind: 'any' }
  | {
      kind: 'primitive';
      type: 'number' | 'string' | 'boolean' | 'null' | 'undefined' | 'Uint8Array' | 'object';
    }
  | { kind: 'literal'; value: string | number | boolean | null }
  | { kind: 'array'; element: ReturnSchema }
  | { kind: 'tuple'; elements: ReturnSchema[] }
  | {
      kind: 'record';
      fields?: Record<string, { schema: ReturnSchema; optional?: boolean }>;
      values?: ReturnSchema;
    }
  | { kind: 'union'; options: ReturnSchema[] }
  | { kind: 'ref'; name: string }
  | {
      kind: 'marker';
      marker:
        | 'dataframe'
        | 'series'
        | 'ndarray'
        | 'scipy.sparse'
        | 'torch.tensor'
        | 'sklearn.estimator';
      dims?: number;
      dtype?: string;
    };

export type ReturnValidator<T = unknown> = (result: T) => T;

export interface DecodedShapeMetadata {
  marker:
    | 'dataframe'
    | 'series'
    | 'ndarray'
    | 'scipy.sparse'
    | 'torch.tensor'
    | 'sklearn.estimator';
  dims?: number;
  dtype?: string;
}

const decodedShapeMetadata = new WeakMap<object, DecodedShapeMetadata>();

/** @internal Preserve wire provenance after codec decoding changes the JS shape. */
export function tagDecodedShape<T>(value: T, metadata: DecodedShapeMetadata): T {
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
    decodedShapeMetadata.set(value as object, metadata);
  }
  return value;
}

function isObjectLike(value: unknown): value is object {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

/** A short, bounded description suitable for an error message. */
export function describeReceivedShape(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'undefined';
  }
  if (isObjectLike(value)) {
    const marker = decodedShapeMetadata.get(value);
    if (marker) {
      const details = [marker.dims === undefined ? undefined : `${marker.dims}d`, marker.dtype]
        .filter(Boolean)
        .join(', ');
      return `${marker.marker}${details ? ` (${details})` : ''}`;
    }
  }
  if (value instanceof Uint8Array) {
    return `Uint8Array(${value.byteLength})`;
  }
  if (Array.isArray(value)) {
    return `array(${value.length})`;
  }
  if (typeof value === 'object') {
    const name = (value as { constructor?: { name?: unknown } }).constructor?.name;
    return typeof name === 'string' && name !== 'Object' ? name : 'object';
  }
  return typeof value;
}

function renderSchema(schema: ReturnSchema): string {
  switch (schema.kind) {
    case 'any':
      return 'unknown';
    case 'primitive':
      return schema.type;
    case 'literal':
      return JSON.stringify(schema.value);
    case 'array':
      return `${renderSchema(schema.element)}[]`;
    case 'tuple':
      return `[${schema.elements.map(renderSchema).join(', ')}]`;
    case 'record':
      return 'record';
    case 'union':
      return schema.options.map(renderSchema).join(' | ');
    case 'ref':
      return schema.name;
    case 'marker':
      return schema.marker;
  }
}

interface CheckState {
  readonly definitions: Readonly<Record<string, ReturnSchema>>;
  readonly pairs: WeakMap<object, Set<string>>;
}

function check(schema: ReturnSchema, value: unknown, state: CheckState): boolean {
  if (schema.kind === 'any') {
    return true;
  }

  if (schema.kind === 'ref') {
    const definition = state.definitions[schema.name];
    if (!definition) {
      return true;
    } // unresolved/erased types deliberately degrade to unknown.
    if (isObjectLike(value)) {
      const seen = state.pairs.get(value) ?? new Set<string>();
      if (seen.has(schema.name)) {
        return true;
      }
      seen.add(schema.name);
      state.pairs.set(value, seen);
    }
    return check(definition, value, state);
  }

  switch (schema.kind) {
    case 'primitive':
      if (schema.type === 'null') {
        return value === null;
      }
      if (schema.type === 'undefined') {
        return value === undefined;
      }
      if (schema.type === 'Uint8Array') {
        return value instanceof Uint8Array;
      }
      if (schema.type === 'object') {
        return isPlainObject(value);
      }
      return typeof value === schema.type;
    case 'literal':
      return Object.is(value, schema.value);
    case 'array':
      return Array.isArray(value) && value.every(item => check(schema.element, item, state));
    case 'tuple':
      return (
        Array.isArray(value) &&
        value.length === schema.elements.length &&
        schema.elements.every((entry, index) => check(entry, value[index], state))
      );
    case 'record': {
      if (!isPlainObject(value)) {
        return false;
      }
      if (schema.fields) {
        for (const [key, field] of Object.entries(schema.fields)) {
          if (!(key in value)) {
            if (field.optional) {
              continue;
            }
            return false;
          }
          if (!check(field.schema, value[key], state)) {
            return false;
          }
        }
      }
      return (
        !schema.values ||
        Object.values(value).every(item => check(schema.values as ReturnSchema, item, state))
      );
    }
    case 'union':
      return schema.options.some(option => check(option, value, state));
    case 'marker': {
      const metadata = isObjectLike(value) ? decodedShapeMetadata.get(value) : undefined;
      if (metadata?.marker !== schema.marker) {
        return false;
      }
      return (
        (schema.dims === undefined || metadata.dims === schema.dims) &&
        (schema.dtype === undefined || metadata.dtype === schema.dtype)
      );
    }
  }
}

/**
 * Construct a cycle-safe structural validator for one generated callable.
 * Unknown/Any/void schemas intentionally validate nothing.
 */
export function createReturnValidator<T = unknown>(
  schema: ReturnSchema,
  callSite: string,
  definitions: Readonly<Record<string, ReturnSchema>> = {}
): ReturnValidator<T> {
  const declaredType = renderSchema(schema);
  return (result: T): T => {
    if (!check(schema, result, { definitions, pairs: new WeakMap<object, Set<string>>() })) {
      throw new BridgeValidationError({
        declaredType,
        receivedShape: describeReceivedShape(result),
        callSite,
      });
    }
    return result;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// TYPE GUARDS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if a value is a finite number (not NaN, not Infinity).
 */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Check if a value is a positive finite number.
 */
export function isPositiveNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

/**
 * Check if a value is a non-negative finite number.
 */
export function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

/**
 * Check if a value is a non-empty string.
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Check if a value is a plain object (not null, not array).
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// ═══════════════════════════════════════════════════════════════════════════
// ASSERTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Assert that a value is a finite number.
 *
 * @param value - The value to check
 * @param name - The name of the parameter (for error messages)
 * @returns The value as a number
 * @throws ValidationError if the value is not a finite number
 */
export function assertFiniteNumber(value: unknown, name: string): number {
  if (!isFiniteNumber(value)) {
    const actual = typeof value === 'number' ? String(value) : typeof value;
    throw new ValidationError(`${name} must be a finite number, got: ${actual}`);
  }
  return value;
}

/**
 * Assert that a value is a positive number (> 0).
 *
 * @param value - The value to check
 * @param name - The name of the parameter (for error messages)
 * @returns The value as a number
 * @throws ValidationError if the value is not a positive number
 */
export function assertPositive(value: unknown, name: string): number {
  const num = assertFiniteNumber(value, name);
  if (num <= 0) {
    throw new ValidationError(`${name} must be positive, got: ${num}`);
  }
  return num;
}

/**
 * Assert that a value is a non-negative number (>= 0).
 *
 * @param value - The value to check
 * @param name - The name of the parameter (for error messages)
 * @returns The value as a number
 * @throws ValidationError if the value is not a non-negative number
 */
export function assertNonNegative(value: unknown, name: string): number {
  const num = assertFiniteNumber(value, name);
  if (num < 0) {
    throw new ValidationError(`${name} must be non-negative, got: ${num}`);
  }
  return num;
}

/**
 * Assert that a value is a string.
 *
 * @param value - The value to check
 * @param name - The name of the parameter (for error messages)
 * @returns The value as a string
 * @throws ValidationError if the value is not a string
 */
export function assertString(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new ValidationError(`${name} must be a string, got: ${typeof value}`);
  }
  return value;
}

/**
 * Assert that a value is a non-empty string.
 *
 * @param value - The value to check
 * @param name - The name of the parameter (for error messages)
 * @returns The value as a string
 * @throws ValidationError if the value is not a non-empty string
 */
export function assertNonEmptyString(value: unknown, name: string): string {
  const str = assertString(value, name);
  if (str.length === 0) {
    throw new ValidationError(`${name} must not be empty`);
  }
  return str;
}

/**
 * Assert that a value is an array.
 *
 * @param value - The value to check
 * @param name - The name of the parameter (for error messages)
 * @returns The value as an array
 * @throws ValidationError if the value is not an array
 */
export function assertArray<T = unknown>(value: unknown, name: string): T[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(`${name} must be an array, got: ${typeof value}`);
  }
  return value as T[];
}

/**
 * Assert that a value is a plain object (not null, not array).
 *
 * @param value - The value to check
 * @param name - The name of the parameter (for error messages)
 * @returns The value as a Record
 * @throws ValidationError if the value is not a plain object
 */
export function assertObject(value: unknown, name: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    throw new ValidationError(`${name} must be an object, got: ${actual}`);
  }
  return value;
}

// ═══════════════════════════════════════════════════════════════════════════
// SPECIAL FLOAT DETECTION (for codec validation)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if a value contains non-finite numbers (NaN, Infinity, -Infinity).
 * Recursively checks arrays and objects.
 *
 * This is used to detect values that cannot be safely serialized to JSON,
 * as JSON.stringify converts NaN/Infinity to null, which can cause
 * silent data corruption.
 *
 * @param value - The value to check
 * @returns True if the value contains NaN or Infinity anywhere
 */
function containsSpecialFloatRecursive(value: unknown, visited: WeakSet<object>): boolean {
  if (typeof value === 'number') {
    return !Number.isFinite(value);
  }
  if (value === null || typeof value !== 'object') {
    return false;
  }
  if (visited.has(value)) {
    return false;
  }
  visited.add(value);
  if (Array.isArray(value)) {
    return value.some(item => containsSpecialFloatRecursive(item, visited));
  }
  if (isPlainObject(value)) {
    return Object.values(value).some(item => containsSpecialFloatRecursive(item, visited));
  }
  return false;
}

export function containsSpecialFloat(value: unknown): boolean {
  return containsSpecialFloatRecursive(value, new WeakSet<object>());
}

/**
 * Assert that a value does not contain non-finite numbers.
 *
 * @param value - The value to check
 * @param name - The name of the parameter (for error messages)
 * @throws ValidationError if the value contains NaN or Infinity
 */
export function assertNoSpecialFloats(value: unknown, name: string): void {
  if (containsSpecialFloat(value)) {
    throw new ValidationError(
      `${name} contains non-finite numbers (NaN or Infinity) which cannot be serialized to JSON`
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PATH VALIDATION (for CLI security)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sanitize a string for use in a cache key filename.
 * Removes or replaces characters that could cause path traversal or invalid filenames.
 *
 * @param value - The string to sanitize
 * @returns A safe string for use in filenames
 */
export function sanitizeForFilename(value: string): string {
  // Replace path separators and traversal patterns
  return value
    .replace(/\.\./g, '__')
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, '_');
}

/**
 * Check if a string looks like a path traversal attempt.
 *
 * @param value - The string to check
 * @returns True if the string contains path traversal patterns
 */
export function containsPathTraversal(value: string): boolean {
  return value.includes('..') || value.includes('/') || value.includes('\\');
}
