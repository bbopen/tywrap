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
export function containsSpecialFloat(value: unknown): boolean {
  if (typeof value === 'number') {
    return !Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.some(containsSpecialFloat);
  }
  if (isPlainObject(value)) {
    return Object.values(value).some(containsSpecialFloat);
  }
  return false;
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
