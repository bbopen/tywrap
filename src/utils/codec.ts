/**
 * Codec utilities for transporting rich Python values over JSON
 *
 * Python bridge emits envelopes like:
 * { "__tywrap__": "dataframe", "encoding": "arrow", "b64": "..." }
 * Optionally with ndarray fallback: { "__tywrap__": "ndarray", "encoding": "json", ... }
 * SciPy sparse: { "__tywrap__": "scipy.sparse", "encoding": "json", "format": "csr", ... }
 * Torch tensors: { "__tywrap__": "torch.tensor", "encoding": "ndarray", "value": { ... } }
 * Sklearn estimators: { "__tywrap__": "sklearn.estimator", "encoding": "json", ... }
 */

// Avoid hard dependency on apache-arrow types at compile time to keep install optional.
export type ArrowTable = { readonly numCols?: number; readonly numRows?: number } & Record<
  string,
  unknown
>;

export interface SparseMatrix {
  format: 'csr' | 'csc' | 'coo';
  shape: readonly number[];
  data: readonly unknown[];
  indices?: readonly number[];
  indptr?: readonly number[];
  row?: readonly number[];
  col?: readonly number[];
  dtype?: string;
}

export interface TorchTensor {
  data: unknown;
  shape?: readonly number[];
  dtype?: string;
  device?: string;
}

export interface SklearnEstimator {
  className: string;
  module: string;
  version?: string;
  params: Record<string, unknown>;
}

export type CodecEnvelope =
  | {
      readonly __tywrap__: 'dataframe';
      readonly codecVersion?: number;
      readonly encoding: 'arrow';
      readonly b64: string;
    }
  | {
      readonly __tywrap__: 'dataframe';
      readonly codecVersion?: number;
      readonly encoding: 'json';
      readonly data: unknown;
    }
  | {
      readonly __tywrap__: 'series';
      readonly codecVersion?: number;
      readonly encoding: 'arrow' | 'json';
      readonly b64?: string;
      readonly data?: unknown;
      readonly name?: string | null;
    }
  | {
      readonly __tywrap__: 'ndarray';
      readonly codecVersion?: number;
      readonly encoding: 'arrow' | 'json';
      readonly b64?: string; // when encoding=arrow
      readonly data?: unknown; // when encoding=json
      readonly shape?: readonly number[];
    }
  | {
      readonly __tywrap__: 'scipy.sparse';
      readonly codecVersion?: number;
      readonly encoding: 'json';
      readonly format: 'csr' | 'csc' | 'coo';
      readonly shape: readonly number[];
      readonly data: readonly unknown[];
      readonly indices?: readonly number[];
      readonly indptr?: readonly number[];
      readonly row?: readonly number[];
      readonly col?: readonly number[];
      readonly dtype?: string;
    }
  | {
      readonly __tywrap__: 'torch.tensor';
      readonly codecVersion?: number;
      readonly encoding: 'ndarray';
      readonly value: unknown;
      readonly shape?: readonly number[];
      readonly dtype?: string;
      readonly device?: string;
    }
  | {
      readonly __tywrap__: 'sklearn.estimator';
      readonly codecVersion?: number;
      readonly encoding: 'json';
      readonly className: string;
      readonly module: string;
      readonly version?: string;
      readonly params: Record<string, unknown>;
    };

export type DecodedValue =
  | ArrowTable
  | Uint8Array
  | SparseMatrix
  | TorchTensor
  | SklearnEstimator
  | unknown;

let arrowTableFrom: ((bytes: Uint8Array) => ArrowTable | Uint8Array) | undefined;

export function registerArrowDecoder(
  decoder: (bytes: Uint8Array) => ArrowTable | Uint8Array
): void {
  arrowTableFrom = decoder;
}

export function clearArrowDecoder(): void {
  arrowTableFrom = undefined;
}

/**
 * Whether an Arrow decoder has been registered for this process.
 */
export function hasArrowDecoder(): boolean {
  return typeof arrowTableFrom === 'function';
}

function isObject(value: unknown): value is { [k: string]: unknown } {
  return typeof value === 'object' && value !== null;
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(item => typeof item === 'number');
}

function fromBase64(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(b64, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
  }
  if (globalThis.atob) {
    const bin = globalThis.atob(b64);
    const arr = Array.from(bin, c => c.charCodeAt(0));
    return new Uint8Array(arr);
  }
  throw new Error('Base64 decoding is not available in this runtime');
}

function requireArrowDecoder(): (bytes: Uint8Array) => ArrowTable | Uint8Array {
  if (!arrowTableFrom) {
    throw new Error(
      'Arrow decoder not registered. Call registerArrowDecoder(...) or set TYWRAP_CODEC_FALLBACK=json in Python.'
    );
  }
  return arrowTableFrom;
}

async function tryDecodeArrowTable(bytes: Uint8Array): Promise<ArrowTable | Uint8Array> {
  const decoder = requireArrowDecoder();
  try {
    return decoder(bytes);
  } catch (err) {
    throw new Error(`Arrow decode failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

type MaybePromise<T> = T | Promise<T>;

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

// Why: decoding needs to reject incompatible envelopes before we attempt to interpret payloads.
const CODEC_VERSION = 1;

function assertCodecVersion(envelope: { codecVersion?: unknown }, marker: string): void {
  if (!('codecVersion' in envelope)) {
    return;
  }
  const version = envelope.codecVersion;
  if (version === undefined) {
    return;
  }
  if (typeof version !== 'number' || !Number.isFinite(version)) {
    throw new Error(`Invalid ${marker} envelope: codecVersion must be a number`);
  }
  if (version !== CODEC_VERSION) {
    throw new Error(`Unsupported ${marker} envelope codecVersion: ${version}`);
  }
}

function decodeEnvelopeCore<T>(
  value: unknown,
  decodeArrow: (bytes: Uint8Array) => MaybePromise<T>,
  recurse: (value: unknown) => MaybePromise<T | unknown>
): MaybePromise<T | unknown> {
  if (!isObject(value)) {
    return value;
  }
  const marker = (value as { __tywrap__?: unknown }).__tywrap__;
  if (typeof marker !== 'string') {
    return value as unknown;
  }

  if (
    marker === 'dataframe' ||
    marker === 'series' ||
    marker === 'ndarray' ||
    marker === 'scipy.sparse' ||
    marker === 'torch.tensor' ||
    marker === 'sklearn.estimator'
  ) {
    assertCodecVersion(value as { codecVersion?: unknown }, marker);
  }

  if (marker === 'dataframe') {
    const encoding = (value as { encoding?: unknown }).encoding;
    if (encoding === 'arrow') {
      const b64 = (value as { b64?: unknown }).b64;
      if (typeof b64 !== 'string') {
        throw new Error('Invalid dataframe envelope: missing b64');
      }
      const bytes = fromBase64(b64);
      return decodeArrow(bytes);
    }
    if (encoding === 'json') {
      if (!('data' in (value as object))) {
        throw new Error('Invalid dataframe envelope: missing data');
      }
      return (value as { data: unknown }).data;
    }
    throw new Error(`Invalid dataframe envelope: unsupported encoding ${String(encoding)}`);
  }

  if (marker === 'series') {
    const encoding = (value as { encoding?: unknown }).encoding;
    if (encoding === 'arrow') {
      const b64 = (value as { b64?: unknown }).b64;
      if (typeof b64 !== 'string') {
        throw new Error('Invalid series envelope: missing b64');
      }
      const bytes = fromBase64(b64);
      return decodeArrow(bytes);
    }
    if (encoding === 'json') {
      if (!('data' in (value as object))) {
        throw new Error('Invalid series envelope: missing data');
      }
      return (value as { data: unknown }).data;
    }
    throw new Error(`Invalid series envelope: unsupported encoding ${String(encoding)}`);
  }

  if (marker === 'ndarray') {
    const encoding = (value as { encoding?: unknown }).encoding;
    if (encoding === 'arrow') {
      const b64 = (value as { b64?: unknown }).b64;
      if (typeof b64 !== 'string') {
        throw new Error('Invalid ndarray envelope: missing b64');
      }
      const bytes = fromBase64(b64);
      return decodeArrow(bytes);
    }
    if (encoding === 'json') {
      if (!('data' in (value as object))) {
        throw new Error('Invalid ndarray envelope: missing data');
      }
      return (value as { data: unknown }).data;
    }
    throw new Error(`Invalid ndarray envelope: unsupported encoding ${String(encoding)}`);
  }

  if (marker === 'scipy.sparse') {
    const encoding = (value as { encoding?: unknown }).encoding;
    if (encoding !== 'json') {
      throw new Error(`Invalid scipy.sparse envelope: unsupported encoding ${String(encoding)}`);
    }
    const format = (value as { format?: unknown }).format;
    if (format !== 'csr' && format !== 'csc' && format !== 'coo') {
      throw new Error(`Invalid scipy.sparse envelope: unsupported format ${String(format)}`);
    }
    const shape = (value as { shape?: unknown }).shape;
    if (
      !Array.isArray(shape) ||
      shape.length !== 2 ||
      typeof shape[0] !== 'number' ||
      typeof shape[1] !== 'number'
    ) {
      throw new Error('Invalid scipy.sparse envelope: shape must be a 2-item number[]');
    }
    const data = (value as { data?: unknown }).data;
    if (!Array.isArray(data)) {
      throw new Error('Invalid scipy.sparse envelope: data must be an array');
    }
    const dtypeValue = (value as { dtype?: unknown }).dtype;
    const dtype = typeof dtypeValue === 'string' ? dtypeValue : undefined;

    if (format === 'coo') {
      const row = (value as { row?: unknown }).row;
      const col = (value as { col?: unknown }).col;
      if (!Array.isArray(row) || !Array.isArray(col)) {
        throw new Error('Invalid scipy.sparse envelope: coo requires row and col arrays');
      }
      return {
        format,
        shape,
        data,
        row,
        col,
        dtype,
      } satisfies SparseMatrix;
    }

    const indices = (value as { indices?: unknown }).indices;
    const indptr = (value as { indptr?: unknown }).indptr;
    if (!Array.isArray(indices) || !Array.isArray(indptr)) {
      throw new Error('Invalid scipy.sparse envelope: csr/csc requires indices and indptr arrays');
    }
    return {
      format,
      shape,
      data,
      indices,
      indptr,
      dtype,
    } satisfies SparseMatrix;
  }

  if (marker === 'torch.tensor') {
    const encoding = (value as { encoding?: unknown }).encoding;
    if (encoding !== 'ndarray') {
      throw new Error(`Invalid torch.tensor envelope: unsupported encoding ${String(encoding)}`);
    }
    if (!('value' in (value as object))) {
      throw new Error('Invalid torch.tensor envelope: missing value');
    }
    const nested = (value as { value: unknown }).value;
    if (!isObject(nested) || (nested as { __tywrap__?: unknown }).__tywrap__ !== 'ndarray') {
      throw new Error('Invalid torch.tensor envelope: value must be an ndarray envelope');
    }
    const decoded = recurse(nested);
    const shapeValue = (value as { shape?: unknown }).shape;
    const shape = isNumberArray(shapeValue) ? shapeValue : undefined;
    const dtypeValue = (value as { dtype?: unknown }).dtype;
    const dtype = typeof dtypeValue === 'string' ? dtypeValue : undefined;
    const deviceValue = (value as { device?: unknown }).device;
    const device = typeof deviceValue === 'string' ? deviceValue : undefined;

    if (isPromiseLike(decoded)) {
      return decoded.then(data => ({ data, shape, dtype, device })) as Promise<T | unknown>;
    }
    return { data: decoded, shape, dtype, device } satisfies TorchTensor;
  }

  if (marker === 'sklearn.estimator') {
    const encoding = (value as { encoding?: unknown }).encoding;
    if (encoding !== 'json') {
      throw new Error(`Invalid sklearn.estimator envelope: unsupported encoding ${String(encoding)}`);
    }
    const className = (value as { className?: unknown }).className;
    const module = (value as { module?: unknown }).module;
    const params = (value as { params?: unknown }).params;
    if (typeof className !== 'string' || typeof module !== 'string' || !isObject(params)) {
      throw new Error('Invalid sklearn.estimator envelope: expected className/module strings + params object');
    }
    const versionValue = (value as { version?: unknown }).version;
    if (versionValue !== undefined && typeof versionValue !== 'string') {
      throw new Error('Invalid sklearn.estimator envelope: version must be a string when provided');
    }
    const version = typeof versionValue === 'string' ? versionValue : undefined;
    return {
      className,
      module,
      version,
      params,
    } satisfies SklearnEstimator;
  }

  return value as unknown;
}

function decodeEnvelope<T>(value: unknown, decodeArrow: (bytes: Uint8Array) => T): T | unknown {
  const recurse: (value: unknown) => MaybePromise<T | unknown> = v =>
    decodeEnvelopeCore(v, decodeArrow, recurse);
  const decoded = decodeEnvelopeCore(value, decodeArrow, recurse);
  if (isPromiseLike(decoded)) {
    throw new Error('Unexpected Promise return from decodeValue; use decodeValueAsync instead.');
  }
  return decoded;
}

async function decodeEnvelopeAsync<T>(
  value: unknown,
  decodeArrow: (bytes: Uint8Array) => Promise<T>
): Promise<T | unknown> {
  const recurse: (value: unknown) => MaybePromise<T | unknown> = v =>
    decodeEnvelopeCore(v, decodeArrow, recurse);
  return await decodeEnvelopeCore(value, decodeArrow, recurse);
}

/**
 * Decode values produced by the Python bridge.
 */
export async function decodeValueAsync(value: unknown): Promise<DecodedValue> {
  return await decodeEnvelopeAsync(value, tryDecodeArrowTable);
}

/**
 * Synchronous decode. Arrow decoding requires a registered decoder.
 */
export function decodeValue(value: unknown): DecodedValue {
  const decodeArrow = (bytes: Uint8Array): DecodedValue => {
    const decoder = requireArrowDecoder();
    try {
      return decoder(bytes);
    } catch (err) {
      throw new Error(`Arrow decode failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  return decodeEnvelope(value, decodeArrow);
}
