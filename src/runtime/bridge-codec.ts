/**
 * BridgeCodec - Unified validation and serialization for JS<->Python boundary crossing.
 *
 * Provides safe encoding/decoding with configurable guardrails for:
 * - Special float rejection (NaN, Infinity)
 * - Non-string key detection
 * - Payload size limits
 * - Binary data handling
 */

import { BridgeCodecError, BridgeProtocolError, BridgeExecutionError } from './errors.js';
import { containsSpecialFloat } from './validators.js';
import { decodeValueAsync as decodeArrowValue } from '../utils/codec.js';
import { PROTOCOL_ID } from './transport.js';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Configuration options for BridgeCodec behavior.
 */
export interface CodecOptions {
  /** Reject NaN/Infinity in arguments. Default: true */
  rejectSpecialFloats?: boolean;
  /** Reject non-string keys in objects. Default: true */
  rejectNonStringKeys?: boolean;
  /** Max payload size in bytes. Default: 10MB */
  maxPayloadBytes?: number;
  /** How to handle bytes/bytearray. Default: 'base64' */
  bytesHandling?: 'base64' | 'reject';
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

interface NormalizedPythonError {
  type: string;
  message: string;
  traceback?: string;
}

interface RpcResponse {
  id: number;
  protocol?: string;
  result?: unknown;
  error?: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_MAX_PAYLOAD_BYTES = 10 * 1024 * 1024; // 10MB
const ERROR_PAYLOAD_SNIPPET_LENGTH = 200;

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

const SCIENTIFIC_MARKERS = new Set([
  'dataframe',
  'series',
  'ndarray',
  'scipy.sparse',
  'torch.tensor',
  'sklearn.estimator',
]);

function scientificMarkerFrom(value: unknown, errorMessage: string): string | undefined {
  const match = /^(?:Invalid|Unsupported) ([a-z.]+) envelope/.exec(errorMessage);
  if (match?.[1] && SCIENTIFIC_MARKERS.has(match[1])) {
    return match[1];
  }
  if (isPlainObject(value) && typeof value.__tywrap__ === 'string') {
    return SCIENTIFIC_MARKERS.has(value.__tywrap__) ? value.__tywrap__ : undefined;
  }
  return undefined;
}

/**
 * Validate request-only restrictions in one traversal.
 *
 * Request validation historically checked every finite number before checking
 * structure. Keep that precedence while combining the walks: capture the first
 * structural error (Map, Set, or symbol key) in traversal order, and prefer
 * the special-float error after the traversal.
 */
function assertValidRequestValues(
  value: unknown,
  rejectSpecialFloats: boolean,
  rejectNonStringKeys: boolean,
  path: string = ''
): void {
  let specialFloatPath: string | undefined;
  let structuralError: BridgeCodecError | undefined;
  const specialVisited = new WeakSet<object>();
  const structVisited = new WeakSet<object>();

  const visit = (current: unknown, currentPath: string, structuralScope: boolean): void => {
    if (typeof current === 'number' && !Number.isFinite(current)) {
      if (rejectSpecialFloats) {
        specialFloatPath ??= currentPath || 'root';
      }
      return;
    }
    if (current === null || typeof current !== 'object') {
      return;
    }

    if (current instanceof Map || current instanceof Set) {
      // JSON.stringify serializes every Map and Set as {}, including Maps with
      // string keys — reject unconditionally. Special-float validation
      // historically does not inspect Map/Set contents, so no recursion.
      if (structuralScope && !structVisited.has(current)) {
        structVisited.add(current);
        const location = currentPath ? ` at ${currentPath}` : '';
        structuralError ??= new BridgeCodecError(
          current instanceof Map
            ? `Cannot encode request: Map found${location}; convert it to a plain object before sending`
            : `Cannot encode request: Set found${location}; convert it to an array before sending`,
          { codecPhase: 'encode' }
        );
      }
      return;
    }

    const needsSpecialWalk = rejectSpecialFloats && !specialVisited.has(current);
    const needsStructWalk = structuralScope && !structVisited.has(current);
    if (!needsSpecialWalk && !needsStructWalk) {
      return;
    }
    if (needsSpecialWalk) {
      specialVisited.add(current);
    }
    if (needsStructWalk) {
      structVisited.add(current);
    }

    if (Array.isArray(current)) {
      for (const [index, item] of current.entries()) {
        visit(item, buildPath(currentPath, index), structuralScope);
      }
      return;
    }

    const plainObject = isPlainObject(current);
    if (plainObject && needsStructWalk && rejectNonStringKeys) {
      // Symbol keys are not enumerated by Object.keys, use getOwnPropertySymbols
      const firstSymbol = Object.getOwnPropertySymbols(current)[0];
      if (firstSymbol !== undefined) {
        const location = currentPath ? ` at ${currentPath}` : '';
        structuralError ??= new BridgeCodecError(
          `Symbol key found in object${location}: ${firstSymbol.toString()}`,
          { codecPhase: 'encode' }
        );
      }
    }
    // Special-float detection historically traversed every non-array object
    // with enumerable values, including class instances. Structural validation
    // remains restricted to arrays and plain objects, matching its prior scope.
    if (needsSpecialWalk || plainObject) {
      for (const [key, item] of Object.entries(current)) {
        visit(item, buildPath(currentPath, key), structuralScope && plainObject);
      }
    }
  };

  visit(value, path, true);
  if (rejectSpecialFloats && specialFloatPath !== undefined) {
    throw new BridgeCodecError(
      `Cannot encode request: contains non-finite number (NaN or Infinity) at ${specialFloatPath}`,
      { codecPhase: 'encode', valueType: 'number' }
    );
  }
  if (structuralError !== undefined) {
    throw structuralError;
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
 * Type guard for the RPC response wrapper ({ id, result | error }).
 * Responses must include a numeric id.
 */
function isRpcResponse(value: unknown): value is RpcResponse {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return typeof obj.id === 'number';
}

function hasOwnKey(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeErrorPayload(err: unknown): NormalizedPythonError | null {
  if (!err || typeof err !== 'object' || Array.isArray(err)) {
    return null;
  }
  const candidate = err as Record<string, unknown>;
  if (typeof candidate.type !== 'string' || typeof candidate.message !== 'string') {
    return null;
  }
  if (hasOwnKey(candidate, 'traceback') && typeof candidate.traceback !== 'string') {
    return null;
  }
  const normalized: NormalizedPythonError = {
    type: candidate.type,
    message: candidate.message,
  };
  if (typeof candidate.traceback === 'string') {
    normalized.traceback = candidate.traceback;
  }
  return normalized;
}

function describeInvalidErrorPayload(err: unknown): string {
  if (!err || typeof err !== 'object' || Array.isArray(err)) {
    return 'expected an object with string "type" and "message" fields';
  }
  const candidate = err as Record<string, unknown>;
  if (typeof candidate.type !== 'string') {
    return '"type" must be a string';
  }
  if (typeof candidate.message !== 'string') {
    return '"message" must be a string';
  }
  if (hasOwnKey(candidate, 'traceback') && typeof candidate.traceback !== 'string') {
    return '"traceback" must be a string when provided';
  }
  return 'expected an object with string "type" and "message" fields';
}

function summarizePayloadForError(payload: string): string {
  const trimmed = payload.trim();
  if (!trimmed) {
    return '[empty payload]';
  }
  if (trimmed.length <= ERROR_PAYLOAD_SNIPPET_LENGTH) {
    return trimmed;
  }
  return `${trimmed.slice(0, ERROR_PAYLOAD_SNIPPET_LENGTH)}...`;
}

/**
 * Validate the protocol version in a response.
 * Only validates when the response looks like an RPC response (has 'id' field).
 * Throws if protocol is present but doesn't match expected version.
 * Allows missing protocol for backwards compatibility.
 */
function validateProtocolVersion(value: unknown): void {
  if (value === null || typeof value !== 'object') {
    return;
  }
  const obj = value as Record<string, unknown>;
  // Only validate protocol on RPC responses (responses with 'id' field)
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
function findSpecialFloatPath(
  value: unknown,
  path: string = '',
  visited: WeakSet<object> = new WeakSet<object>()
): string | undefined {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return path || 'root';
  }
  if (value === null || typeof value !== 'object') {
    return undefined;
  }
  if (visited.has(value)) {
    return undefined;
  }
  visited.add(value);
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const result = findSpecialFloatPath(item, buildPath(path, index), visited);
      if (result !== undefined) {
        return result;
      }
    }
  }
  if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      const result = findSpecialFloatPath(item, buildPath(path, key), visited);
      if (result !== undefined) {
        return result;
      }
    }
  }
  return undefined;
}

// ═══════════════════════════════════════════════════════════════════════════
// BRIDGE CODEC CLASS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * BridgeCodec provides unified validation and serialization for JS<->Python
 * boundary crossing with configurable guardrails.
 *
 * @example
 * ```typescript
 * const codec = new BridgeCodec({ rejectSpecialFloats: true });
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
export class BridgeCodec {
  private readonly rejectSpecialFloats: boolean;
  private readonly rejectNonStringKeys: boolean;
  private readonly maxPayloadBytes: number;
  private readonly bytesHandling: 'base64' | 'reject';
  private readonly reviveValueBound: (key: string, value: unknown) => unknown;
  private static readonly base64Pattern =
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

  constructor(options: CodecOptions = {}) {
    this.rejectSpecialFloats = options.rejectSpecialFloats ?? true;
    this.rejectNonStringKeys = options.rejectNonStringKeys ?? true;
    this.maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
    this.bytesHandling = options.bytesHandling ?? 'base64';
    this.reviveValueBound = this.reviveValue.bind(this);
  }

  private assertValidBase64(b64: string): void {
    if (!BridgeCodec.base64Pattern.test(b64)) {
      throw new BridgeCodecError('Invalid base64 in bytes envelope', {
        codecPhase: 'decode',
        valueType: 'bytes',
      });
    }
  }

  /**
   * Convert base64 string to Uint8Array.
   *
   * Why: Python bridge represents bytes/bytearray as base64 envelopes. Decoding them here
   * restores ergonomic JS types at the boundary.
   */
  private fromBase64(b64: string): Uint8Array {
    this.assertValidBase64(b64);

    if (typeof Buffer !== 'undefined') {
      const buf = Buffer.from(b64, 'base64');
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
    }
    if (globalThis.atob) {
      const bin = globalThis.atob(b64);
      const arr = Array.from(bin, c => c.charCodeAt(0));
      return new Uint8Array(arr);
    }
    throw new BridgeCodecError('Base64 decoding is not available in this runtime', {
      codecPhase: 'decode',
      valueType: 'bytes',
    });
  }

  /**
   * JSON.parse reviver that decodes bytes envelopes.
   *
   * Supported shapes:
   * - { "__tywrap_bytes__": true, "b64": "..." } (JS BridgeCodec.encodeRequest; also allowed in responses)
   * - { "__type__": "bytes", "encoding": "base64", "data": "..." } (Python BridgeCodec default encoder)
   */
  private reviveValue(_key: string, value: unknown): unknown {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return value;
    }
    const obj = value as Record<string, unknown>;

    if (obj.__tywrap_bytes__ === true && typeof obj.b64 === 'string') {
      try {
        return this.fromBase64(obj.b64);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        throw new BridgeCodecError(`Bytes envelope decode failed: ${errorMessage}`, {
          codecPhase: 'decode',
          valueType: 'bytes',
        });
      }
    }

    if (obj.__type__ === 'bytes' && obj.encoding === 'base64' && typeof obj.data === 'string') {
      try {
        return this.fromBase64(obj.data);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        throw new BridgeCodecError(`Bytes envelope decode failed: ${errorMessage}`, {
          codecPhase: 'decode',
          valueType: 'bytes',
        });
      }
    }

    return value;
  }

  private toBridgeExecutionError(error: NormalizedPythonError): BridgeExecutionError {
    const bridgeError = new BridgeExecutionError(`${error.type}: ${error.message}`);
    bridgeError.traceback = error.traceback;
    return bridgeError;
  }

  /**
   * Shared prelude for both decode paths: size guard, JSON parse (with bytes
   * revival), protocol-version validation, and RPC-envelope unwrapping.
   *
   * Behavior-preserving extraction of the common head of decodeResponse and
   * decodeResponseAsync; the only divergence between the two is what they do
   * with the returned result (sync returns it as-is, async applies Arrow
   * decoding) and so that divergence stays in the callers.
   */
  private parseResponseResult(payload: string): unknown {
    // Check payload size first
    const payloadBytes = new TextEncoder().encode(payload).length;
    if (payloadBytes > this.maxPayloadBytes) {
      throw new BridgeCodecError(
        `Response payload size ${payloadBytes} bytes exceeds maximum ${this.maxPayloadBytes} bytes`,
        { codecPhase: 'decode', valueType: 'payload' }
      );
    }

    // Parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload, this.reviveValueBound);
    } catch (err) {
      if (err instanceof BridgeCodecError || err instanceof BridgeProtocolError) {
        throw err;
      }
      const errorMessage = err instanceof Error ? err.message : String(err);
      throw new BridgeCodecError(
        `JSON parse failed: ${errorMessage}. Payload snippet: ${summarizePayloadForError(payload)}`,
        { codecPhase: 'decode', valueType: 'json' }
      );
    }

    // Validate protocol version (if present)
    validateProtocolVersion(parsed);

    return this.extractResultFromRpcResponse(parsed);
  }

  /**
   * Post-decode guard: reject non-finite numbers (NaN/Infinity) when enabled.
   * Shared by both decode paths.
   */
  private assertNoSpecialFloats(value: unknown): void {
    if (this.rejectSpecialFloats && containsSpecialFloat(value)) {
      const floatPath = findSpecialFloatPath(value);
      throw new BridgeCodecError(
        `Response contains non-finite number (NaN or Infinity) at ${floatPath}`,
        { codecPhase: 'decode', valueType: 'number' }
      );
    }
  }

  private extractResultFromRpcResponse(parsed: unknown): unknown {
    if (isRpcResponse(parsed)) {
      const response = parsed;
      const hasResult = hasOwnKey(response, 'result');
      const hasError = hasOwnKey(response, 'error');

      if (hasResult && hasError) {
        throw new BridgeProtocolError('Protocol response cannot include both "result" and "error"');
      }

      if (hasError) {
        const normalizedError = normalizeErrorPayload(response.error);
        if (!normalizedError) {
          const details = describeInvalidErrorPayload(response.error);
          throw new BridgeProtocolError(`Invalid response "error" payload: ${details}`);
        }
        throw this.toBridgeExecutionError(normalizedError);
      }

      if (!hasResult) {
        throw new BridgeProtocolError('Protocol response missing "result" or "error" field');
      }

      return response.result;
    }

    if (isPythonErrorResponse(parsed)) {
      throw this.toBridgeExecutionError(parsed.error);
    }

    return parsed;
  }

  /**
   * Validate and encode a request payload.
   * Called before sending to Python.
   *
   * @param message - The message to encode
   * @returns JSON string ready to send
   * @throws BridgeCodecError if validation fails or encoding fails
   */
  encodeRequest(message: unknown): string {
    // Reject, in one traversal, values JSON.stringify would silently mangle:
    // non-finite numbers, Map/Set, and (optionally) non-string keys.
    assertValidRequestValues(message, this.rejectSpecialFloats, this.rejectNonStringKeys);

    // Serialize to JSON with error handling
    let payload: string;
    try {
      payload = JSON.stringify(message, (key, value) => {
        // Handle bytes based on configuration
        if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
          switch (this.bytesHandling) {
            case 'reject':
              throw new BridgeCodecError(
                `Cannot encode request: binary data found at ${key || 'root'} (bytesHandling: reject)`,
                { codecPhase: 'encode', valueType: 'bytes' }
              );
            case 'base64': {
              const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
              const b64 = this.toBase64(bytes);
              return { __tywrap_bytes__: true, b64 };
            }
          }
        }
        return value;
      });
    } catch (err) {
      if (err instanceof BridgeCodecError) {
        throw err;
      }
      if (err instanceof BridgeProtocolError) {
        throw err;
      }
      const errorMessage = err instanceof Error ? err.message : String(err);
      throw new BridgeCodecError(`JSON serialization failed: ${errorMessage}`, {
        codecPhase: 'encode',
      });
    }

    // Check payload size
    const payloadBytes =
      typeof Buffer !== 'undefined'
        ? Buffer.byteLength(payload, 'utf8')
        : new TextEncoder().encode(payload).length;
    if (payloadBytes > this.maxPayloadBytes) {
      throw new BridgeCodecError(
        `Payload size ${payloadBytes} bytes exceeds maximum ${this.maxPayloadBytes} bytes`,
        { codecPhase: 'encode', valueType: 'payload' }
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
   * @throws BridgeCodecError if payload is invalid or decoding fails
   * @throws BridgeProtocolError if the RPC response is invalid
   * @throws BridgeExecutionError if response contains a Python error
   */
  decodeResponse<T>(payload: string): T {
    const result = this.parseResponseResult(payload);

    // Post-decode validation for special floats if enabled
    this.assertNoSpecialFloats(result);

    return result as T;
  }

  /**
   * Async version that applies Arrow decoders.
   * Use this when the response may contain encoded DataFrames or ndarrays.
   *
   * @param payload - The JSON string received from Python
   * @returns Decoded and validated result with Arrow decoding applied
   * @throws BridgeCodecError if payload is invalid or decoding fails
   * @throws BridgeProtocolError if the RPC response is invalid
   * @throws BridgeExecutionError if response contains a Python error
   */
  async decodeResponseAsync<T>(payload: string): Promise<T> {
    const result = this.parseResponseResult(payload);

    // Apply Arrow decoding to the result
    let decoded: unknown;
    try {
      decoded = await decodeArrowValue(result);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const marker = scientificMarkerFrom(result, errorMessage);
      const genuineArrowError =
        errorMessage.startsWith('Arrow decode failed:') ||
        errorMessage.startsWith(
          'Received an Arrow-encoded payload but no Arrow decoder is available.'
        );
      throw new BridgeCodecError(
        genuineArrowError
          ? `Arrow decoding failed: ${errorMessage}`
          : `Scientific envelope decoding failed (${marker ?? 'unknown'}): ${errorMessage}`,
        {
          codecPhase: 'decode',
          valueType: genuineArrowError ? 'arrow' : (marker ?? 'scientific-envelope'),
        }
      );
    }

    // Post-decode validation for special floats if enabled
    // Note: Arrow decoders can introduce NaN/Infinity from binary representations.
    this.assertNoSpecialFloats(decoded);

    // Return-contract validation is intentionally downstream of this codec. At
    // this boundary we guarantee only a sound wire envelope and decoded value;
    // generated wrappers validate the Python annotation after Arrow/JSON decode.
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
    throw new BridgeCodecError('Base64 encoding is not available in this runtime', {
      codecPhase: 'encode',
      valueType: 'bytes',
    });
  }
}
