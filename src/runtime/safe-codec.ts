/**
 * SafeCodec - Unified validation and serialization for JS<->Python boundary crossing.
 *
 * Provides safe encoding/decoding with configurable guardrails for:
 * - Special float rejection (NaN, Infinity)
 * - Non-string key detection
 * - Payload size limits
 * - Binary data handling
 */

import { BridgeProtocolError, BridgeExecutionError } from './errors.js';
import { containsSpecialFloat } from './validators.js';
import { decodeValueAsync as decodeArrowValue } from '../utils/codec.js';
import { PROTOCOL_ID } from './transport.js';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Configuration options for SafeCodec behavior.
 */
export interface CodecOptions {
  /** Reject NaN/Infinity in arguments. Default: true */
  rejectSpecialFloats?: boolean;
  /** Reject non-string keys in objects. Default: true */
  rejectNonStringKeys?: boolean;
  /** Max payload size in bytes. Default: 10MB */
  maxPayloadBytes?: number;
  /** How to handle bytes/bytearray. Default: 'base64' */
  bytesHandling?: 'base64' | 'reject' | 'passthrough';
}

/**
 * Python error response format from the bridge.
 */
interface PythonErrorResponse {
  error: {
    type: string;
    message: string;
    traceback?: string;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_MAX_PAYLOAD_BYTES = 10 * 1024 * 1024; // 10MB

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if a value is a plain object (not null, not array, not Map/Set/etc).
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Build a path string for error messages.
 */
function buildPath(basePath: string, key: string | number): string {
  if (basePath === '') {
    return typeof key === 'number' ? `[${key}]` : key;
  }
  return typeof key === 'number' ? `${basePath}[${key}]` : `${basePath}.${key}`;
}

/**
 * Recursively check for non-string keys in objects and Maps.
 * Throws BridgeProtocolError with path indication if found.
 */
function assertStringKeys(value: unknown, path: string = ''): void {
  if (value === null || typeof value !== 'object') {
    return;
  }

  // Check Map instances for non-string keys
  if (value instanceof Map) {
    for (const key of value.keys()) {
      if (typeof key !== 'string') {
        const keyDesc = typeof key === 'symbol' ? key.toString() : String(key);
        const location = path ? ` at ${path}` : '';
        throw new BridgeProtocolError(
          `Non-string key found in Map${location}: ${keyDesc} (${typeof key})`
        );
      }
    }
    // Recurse into Map values
    for (const [key, val] of value.entries()) {
      assertStringKeys(val, buildPath(path, key));
    }
    return;
  }

  // Check arrays
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      assertStringKeys(item, buildPath(path, index));
    }
    return;
  }

  // Check plain objects for symbol keys
  if (isPlainObject(value)) {
    // Symbol keys are not enumerated by Object.keys, use getOwnPropertySymbols
    const symbolKeys = Object.getOwnPropertySymbols(value);
    const firstSymbol = symbolKeys[0];
    if (firstSymbol !== undefined) {
      const symbolDesc = firstSymbol.toString();
      const location = path ? ` at ${path}` : '';
      throw new BridgeProtocolError(
        `Symbol key found in object${location}: ${symbolDesc}`
      );
    }

    // Recurse into object values
    for (const [key, item] of Object.entries(value)) {
      assertStringKeys(item, buildPath(path, key));
    }
  }
}

/**
 * Check if a value is a Python error response.
 */
function isPythonErrorResponse(value: unknown): value is PythonErrorResponse {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const obj = value as Record<string, unknown>;
  if (!obj.error || typeof obj.error !== 'object' || obj.error === null) {
    return false;
  }
  const error = obj.error as Record<string, unknown>;
  return typeof error.type === 'string' && typeof error.message === 'string';
}

/**
 * Type guard for protocol result response.
 * Checks if the value is an object with an id and result field.
 * The protocol field is optional as Python may not always include it.
 */
interface ProtocolResultResponse {
  id: number;
  protocol?: string;
  result: unknown;
}

function isProtocolResultResponse(value: unknown): value is ProtocolResultResponse {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return typeof obj.id === 'number' && 'result' in obj;
}

/**
 * Validate the protocol version in a response.
 * Only validates when the response looks like a protocol envelope (has 'id' field).
 * Throws if protocol is present but doesn't match expected version.
 * Allows missing protocol for backwards compatibility.
 */
function validateProtocolVersion(value: unknown): void {
  if (value === null || typeof value !== 'object') {
    return;
  }
  const obj = value as Record<string, unknown>;
  // Only validate protocol on protocol envelopes (responses with 'id' field)
  // This avoids false positives on user data that happens to contain 'protocol' key
  if (!('id' in obj)) {
    return;
  }
  if ('protocol' in obj && obj.protocol !== PROTOCOL_ID) {
    throw new BridgeProtocolError(
      `Invalid protocol version: expected "${PROTOCOL_ID}", got "${obj.protocol}"`
    );
  }
}

/**
 * Find the path to a special float in a value structure.
 * Returns undefined if no special float is found.
 */
function findSpecialFloatPath(value: unknown, path: string = ''): string | undefined {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return path || 'root';
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const result = findSpecialFloatPath(item, buildPath(path, index));
      if (result !== undefined) {
        return result;
      }
    }
  }
  if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      const result = findSpecialFloatPath(item, buildPath(path, key));
      if (result !== undefined) {
        return result;
      }
    }
  }
  return undefined;
}

// ═══════════════════════════════════════════════════════════════════════════
// SAFE CODEC CLASS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * SafeCodec provides unified validation and serialization for JS<->Python
 * boundary crossing with configurable guardrails.
 *
 * @example
 * ```typescript
 * const codec = new SafeCodec({ rejectSpecialFloats: true });
 *
 * // Encoding a request
 * const payload = codec.encodeRequest({ data: [1, 2, 3] });
 *
 * // Decoding a response
 * const result = codec.decodeResponse<MyType>(responsePayload);
 *
 * // Async decoding with Arrow support
 * const dataframe = await codec.decodeResponseAsync<ArrowTable>(arrowPayload);
 * ```
 */
export class SafeCodec {
  private readonly rejectSpecialFloats: boolean;
  private readonly rejectNonStringKeys: boolean;
  private readonly maxPayloadBytes: number;
  private readonly bytesHandling: 'base64' | 'reject' | 'passthrough';

  constructor(options: CodecOptions = {}) {
    this.rejectSpecialFloats = options.rejectSpecialFloats ?? true;
    this.rejectNonStringKeys = options.rejectNonStringKeys ?? true;
    this.maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
    this.bytesHandling = options.bytesHandling ?? 'base64';
  }

  /**
   * Validate and encode a request payload.
   * Called before sending to Python.
   *
   * @param message - The message to encode
   * @returns JSON string ready to send
   * @throws BridgeProtocolError if validation fails or encoding fails
   */
  encodeRequest(message: unknown): string {
    // Validate special floats if enabled
    if (this.rejectSpecialFloats && containsSpecialFloat(message)) {
      const floatPath = findSpecialFloatPath(message);
      throw new BridgeProtocolError(
        `Cannot encode request: contains non-finite number (NaN or Infinity) at ${floatPath}`
      );
    }

    // Validate string keys if enabled
    if (this.rejectNonStringKeys) {
      assertStringKeys(message);
    }

    // Serialize to JSON with error handling
    let payload: string;
    try {
      payload = JSON.stringify(message, (key, value) => {
        // Handle bytes based on configuration
        if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
          switch (this.bytesHandling) {
            case 'reject':
              throw new BridgeProtocolError(
                `Cannot encode request: binary data found at ${key || 'root'} (bytesHandling: reject)`
              );
            case 'base64': {
              const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
              const b64 = this.toBase64(bytes);
              return { __tywrap_bytes__: true, b64 };
            }
            case 'passthrough':
            default:
              return value;
          }
        }
        return value;
      });
    } catch (err) {
      if (err instanceof BridgeProtocolError) {
        throw err;
      }
      const errorMessage = err instanceof Error ? err.message : String(err);
      throw new BridgeProtocolError(`JSON serialization failed: ${errorMessage}`);
    }

    // Check payload size
    const payloadBytes = new TextEncoder().encode(payload).length;
    if (payloadBytes > this.maxPayloadBytes) {
      throw new BridgeProtocolError(
        `Payload size ${payloadBytes} bytes exceeds maximum ${this.maxPayloadBytes} bytes`
      );
    }

    return payload;
  }

  /**
   * Decode and validate a response payload.
   * Called after receiving from Python.
   *
   * @param payload - The JSON string received from Python
   * @returns Decoded and validated result
   * @throws BridgeProtocolError if payload is invalid
   * @throws BridgeExecutionError if response contains a Python error
   */
  decodeResponse<T>(payload: string): T {
    // Check payload size first
    const payloadBytes = new TextEncoder().encode(payload).length;
    if (payloadBytes > this.maxPayloadBytes) {
      throw new BridgeProtocolError(
        `Response payload size ${payloadBytes} bytes exceeds maximum ${this.maxPayloadBytes} bytes`
      );
    }

    // Parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      throw new BridgeProtocolError(`JSON parse failed: ${errorMessage}`);
    }

    // Validate protocol version (if present)
    validateProtocolVersion(parsed);

    // Check for Python error response
    if (isPythonErrorResponse(parsed)) {
      const error = new BridgeExecutionError(
        `${parsed.error.type}: ${parsed.error.message}`
      );
      error.traceback = parsed.error.traceback;
      throw error;
    }

    // Extract the result field from the response envelope
    const result = isProtocolResultResponse(parsed) ? parsed.result : parsed;

    // Post-decode validation for special floats if enabled
    if (this.rejectSpecialFloats && containsSpecialFloat(result)) {
      const floatPath = findSpecialFloatPath(result);
      throw new BridgeProtocolError(
        `Response contains non-finite number (NaN or Infinity) at ${floatPath}`
      );
    }

    return result as T;
  }

  /**
   * Async version that applies Arrow decoders.
   * Use this when the response may contain encoded DataFrames or ndarrays.
   *
   * @param payload - The JSON string received from Python
   * @returns Decoded and validated result with Arrow decoding applied
   * @throws BridgeProtocolError if payload is invalid
   * @throws BridgeExecutionError if response contains a Python error
   */
  async decodeResponseAsync<T>(payload: string): Promise<T> {
    // Check payload size first
    const payloadBytes = new TextEncoder().encode(payload).length;
    if (payloadBytes > this.maxPayloadBytes) {
      throw new BridgeProtocolError(
        `Response payload size ${payloadBytes} bytes exceeds maximum ${this.maxPayloadBytes} bytes`
      );
    }

    // Parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      throw new BridgeProtocolError(`JSON parse failed: ${errorMessage}`);
    }

    // Validate protocol version (if present)
    validateProtocolVersion(parsed);

    // Check for Python error response
    if (isPythonErrorResponse(parsed)) {
      const error = new BridgeExecutionError(
        `${parsed.error.type}: ${parsed.error.message}`
      );
      error.traceback = parsed.error.traceback;
      throw error;
    }

    // Extract the result field from the response envelope
    const result = isProtocolResultResponse(parsed) ? parsed.result : parsed;

    // Apply Arrow decoding to the result
    let decoded: unknown;
    try {
      decoded = await decodeArrowValue(result);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      throw new BridgeProtocolError(`Arrow decoding failed: ${errorMessage}`);
    }

    // Post-decode validation for special floats if enabled
    // Note: We check the result value since that's what we're returning
    if (this.rejectSpecialFloats && containsSpecialFloat(result)) {
      const floatPath = findSpecialFloatPath(result);
      throw new BridgeProtocolError(
        `Response contains non-finite number (NaN or Infinity) at ${floatPath}`
      );
    }

    return decoded as T;
  }

  /**
   * Convert Uint8Array to base64 string.
   */
  private toBase64(bytes: Uint8Array): string {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(bytes).toString('base64');
    }
    if (globalThis.btoa) {
      const binary = String.fromCharCode(...bytes);
      return globalThis.btoa(binary);
    }
    throw new BridgeProtocolError('Base64 encoding is not available in this runtime');
  }
}
