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
      readonly encoding: 'arrow';
      readonly b64: string;
    }
  | {
      readonly __tywrap__: 'series';
      readonly encoding: 'arrow' | 'json';
      readonly b64?: string;
      readonly data?: unknown;
      readonly name?: string | null;
    }
  | {
      readonly __tywrap__: 'ndarray';
      readonly encoding: 'arrow' | 'json';
      readonly b64?: string; // when encoding=arrow
      readonly data?: unknown; // when encoding=json
      readonly shape?: readonly number[];
    }
  | {
      readonly __tywrap__: 'scipy.sparse';
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
      readonly encoding: 'ndarray';
      readonly value: unknown;
      readonly shape?: readonly number[];
      readonly dtype?: string;
      readonly device?: string;
    }
  | {
      readonly __tywrap__: 'sklearn.estimator';
      readonly encoding: 'json';
      readonly className: string;
      readonly module: string;
      readonly version?: string;
      readonly params: Record<string, unknown>;
    };

export type DecodedValue = ArrowTable | Uint8Array | SparseMatrix | TorchTensor | SklearnEstimator | unknown;

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

function decodeEnvelope<T>(value: unknown, decodeArrow: (bytes: Uint8Array) => T): T | unknown {
  if (!isObject(value)) {
    return value;
  }
  const marker = (value as { __tywrap__?: unknown }).__tywrap__;
  if (
    (marker === 'dataframe' || marker === 'series') &&
    (value as { encoding?: unknown }).encoding === 'arrow' &&
    typeof (value as { b64?: unknown }).b64 === 'string'
  ) {
    const bytes = fromBase64(String((value as { b64: string }).b64));
    return decodeArrow(bytes);
  }
  if (
    marker === 'dataframe' &&
    (value as { encoding?: unknown }).encoding === 'json' &&
    'data' in (value as object)
  ) {
    return (value as { data: unknown }).data;
  }
  if (
    marker === 'series' &&
    (value as { encoding?: unknown }).encoding === 'json' &&
    'data' in (value as object)
  ) {
    return (value as { data: unknown }).data;
  }
  if (marker === 'ndarray') {
    if (
      (value as { encoding?: unknown }).encoding === 'arrow' &&
      typeof (value as { b64?: unknown }).b64 === 'string'
    ) {
      const bytes = fromBase64(String((value as { b64: string }).b64));
      return decodeArrow(bytes);
    }
    if ((value as { encoding?: unknown }).encoding === 'json' && 'data' in (value as object)) {
      return (value as { data: unknown }).data;
    }
  }
  if (
    marker === 'scipy.sparse' &&
    (value as { encoding?: unknown }).encoding === 'json' &&
    typeof (value as { format?: unknown }).format === 'string' &&
    Array.isArray((value as { shape?: unknown }).shape) &&
    Array.isArray((value as { data?: unknown }).data)
  ) {
    const sparse = value as {
      format: 'csr' | 'csc' | 'coo';
      shape: readonly number[];
      data: readonly unknown[];
      indices?: readonly number[];
      indptr?: readonly number[];
      row?: readonly number[];
      col?: readonly number[];
      dtype?: string;
    };
    return {
      format: sparse.format,
      shape: sparse.shape,
      data: sparse.data,
      indices: sparse.indices,
      indptr: sparse.indptr,
      row: sparse.row,
      col: sparse.col,
      dtype: sparse.dtype,
    } satisfies SparseMatrix;
  }
  if (marker === 'torch.tensor' && (value as { encoding?: unknown }).encoding === 'ndarray') {
    const torchValue = value as {
      value?: unknown;
      shape?: readonly number[];
      dtype?: string;
      device?: string;
    };
    if ('value' in (torchValue as object)) {
      const decoded = decodeEnvelope(torchValue.value, decodeArrow);
      return {
        data: decoded,
        shape: torchValue.shape,
        dtype: torchValue.dtype,
        device: torchValue.device,
      } satisfies TorchTensor;
    }
  }
  if (
    marker === 'sklearn.estimator' &&
    (value as { encoding?: unknown }).encoding === 'json' &&
    typeof (value as { className?: unknown }).className === 'string' &&
    typeof (value as { module?: unknown }).module === 'string' &&
    isObject((value as { params?: unknown }).params)
  ) {
    const estimator = value as {
      className: string;
      module: string;
      version?: string;
      params: Record<string, unknown>;
    };
    return {
      className: estimator.className,
      module: estimator.module,
      version: estimator.version,
      params: estimator.params,
    } satisfies SklearnEstimator;
  }
  return value as unknown;
}

/**
 * Decode values produced by the Python bridge.
 */
export async function decodeValueAsync(value: unknown): Promise<DecodedValue> {
  return await decodeEnvelope(value, tryDecodeArrowTable);
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
