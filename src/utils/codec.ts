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

export type ValueEnvelope =
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

// Why: lazy auto-registration (on first Arrow decode) imports apache-arrow at most
// once per process. We cache the in-flight/settled attempt so concurrent decodes
// share a single dynamic import, and a missing module is not re-probed on every call.
let lazyRegistration: Promise<boolean> | undefined;

// Why: the lazy decode path imports apache-arrow through the default Node loader, which
// is hard to simulate-as-absent in a test env where the dependency IS installed. This
// internal seam lets the unit suite exercise the "apache-arrow missing" clear-failure
// branch deterministically. It is intentionally NOT re-exported from the package root
// (see test/api_surface.test.ts) and is reset by clearArrowDecoder().
let lazyArrowLoaderOverride: ArrowModuleLoader | undefined;

/** @internal Test-only: override the loader used by lazy auto-registration. */
export const _setLazyArrowLoaderForTesting = (loader: ArrowModuleLoader | undefined): void => {
  lazyArrowLoaderOverride = loader;
  lazyRegistration = undefined;
};

export function registerArrowDecoder(
  decoder: (bytes: Uint8Array) => ArrowTable | Uint8Array
): void {
  arrowTableFrom = decoder;
}

export function clearArrowDecoder(): void {
  arrowTableFrom = undefined;
  // Why: reset the cached import attempt so tests (and reload helpers) can exercise
  // the auto-registration path again from a clean slate.
  lazyRegistration = undefined;
  lazyArrowLoaderOverride = undefined;
}

/**
 * Whether an Arrow decoder has been registered for this process.
 */
export function hasArrowDecoder(): boolean {
  return typeof arrowTableFrom === 'function';
}

type ArrowModuleLoader = () => unknown | Promise<unknown>;

/**
 * Detect Node.js runtime capabilities without hard dependencies.
 *
 * Why: keep browser/bundler builds safe while still enabling Node-only paths.
 */
function isNodeRuntime(): boolean {
  return (
    typeof process !== 'undefined' &&
    typeof (process as { versions?: { node?: string } }).versions?.node === 'string'
  );
}

/**
 * Validate the Arrow module shape and register its IPC decoder.
 *
 * Why: centralize tableFromIPC checks so callers get consistent errors and can
 * rely on a single registration path.
 */
function registerArrowDecoderFromModule(module: { tableFromIPC?: unknown }): void {
  const tableFromIPC = module.tableFromIPC;
  if (typeof tableFromIPC !== 'function') {
    throw new Error('apache-arrow does not export tableFromIPC');
  }
  registerArrowDecoder((bytes: Uint8Array) => tableFromIPC(bytes));
}

/**
 * Attempt to lazily register an Arrow decoder at runtime.
 *
 * Why: keep apache-arrow optional while letting NodeBridge (or callers) enable
 * Arrow decoding when the module is present.
 */
export async function autoRegisterArrowDecoder(
  options: { loader?: ArrowModuleLoader } = {}
): Promise<boolean> {
  if (hasArrowDecoder()) {
    return true;
  }
  const loader: ArrowModuleLoader | undefined =
    options.loader ??
    (isNodeRuntime()
      ? async (): Promise<unknown> => {
          try {
            const nodeModule = await import('node:module');
            const require = nodeModule.createRequire(import.meta.url);
            return require('apache-arrow') as unknown;
          } catch {
            return await import('apache-arrow');
          }
        }
      : undefined);
  if (!loader) {
    return false;
  }
  try {
    const arrowModule = await loader();
    // Another path may have registered a decoder while the import was in flight
    // (e.g. an explicit registerArrowDecoder() during concurrent startup/reload).
    // Don't clobber it — the explicit registration wins.
    if (hasArrowDecoder()) {
      return true;
    }
    registerArrowDecoderFromModule(arrowModule as { tableFromIPC?: unknown });
    return true;
  } catch {
    return false;
  }
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

// Why: a single, actionable message for both decode paths so users always know the two
// supported remedies — install the optional dependency, or opt into the lossy JSON fallback.
const ARROW_MISSING_MESSAGE =
  'Received an Arrow-encoded payload but no Arrow decoder is available. ' +
  'Install the optional dependency with `npm install apache-arrow`, or set ' +
  'TYWRAP_CODEC_FALLBACK=json on the Python side to receive JSON instead ' +
  '(lossy for dtype/NA fidelity). tywrap never silently downgrades Arrow payloads.';

function requireArrowDecoder(): (bytes: Uint8Array) => ArrowTable | Uint8Array {
  if (!arrowTableFrom) {
    throw new Error(ARROW_MISSING_MESSAGE);
  }
  return arrowTableFrom;
}

/**
 * Ensure an Arrow decoder is registered, lazily importing apache-arrow on first use.
 *
 * Why: keep apache-arrow optional and zero-config. The first Arrow-encoded payload
 * triggers a single best-effort dynamic import; if it succeeds the decoder is cached
 * for the rest of the process. If apache-arrow is absent we throw a clear, actionable
 * error rather than silently producing wrong data.
 */
async function ensureArrowDecoder(): Promise<(bytes: Uint8Array) => ArrowTable | Uint8Array> {
  if (arrowTableFrom) {
    return arrowTableFrom;
  }
  // Reuse a single import attempt across concurrent decodes.
  lazyRegistration ??= autoRegisterArrowDecoder(
    lazyArrowLoaderOverride ? { loader: lazyArrowLoaderOverride } : {}
  );
  await lazyRegistration;
  if (!arrowTableFrom) {
    throw new Error(ARROW_MISSING_MESSAGE);
  }
  return arrowTableFrom;
}

async function tryDecodeArrowTable(bytes: Uint8Array): Promise<ArrowTable | Uint8Array> {
  const decoder = await ensureArrowDecoder();
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

/**
 * Convert a typed array (Int32Array, Float64Array, BigInt64Array, etc.) to a plain JS array.
 *
 * Why: Arrow's column.toArray() returns typed arrays, but we need plain arrays for
 * JSON-compatible output and proper nested array reshaping.
 *
 * @param arr - Typed array or plain array
 * @returns Plain JavaScript array with values converted (BigInt → Number where safe)
 */
function typedArrayToPlain(arr: unknown): unknown[] {
  if (Array.isArray(arr)) {
    return arr;
  }
  // Handle typed arrays (Int32Array, Float64Array, BigInt64Array, etc.)
  if (ArrayBuffer.isView(arr) && 'length' in arr) {
    const values = Array.from(arr as unknown as ArrayLike<unknown>);
    return values.map(value => {
      // Convert BigInt to Number if within safe integer range
      if (typeof value === 'bigint') {
        if (value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
          return Number(value);
        }
      }
      return value; // Keep BigInt when too large (or preserve non-BigInt values)
    });
  }
  // Fallback: check if iterable before converting
  if (arr !== null && arr !== undefined && typeof arr === 'object' && Symbol.iterator in arr) {
    return Array.from(arr as Iterable<unknown>);
  }
  // Non-iterable: return empty array (shouldn't happen with valid Arrow data)
  return [];
}

/**
 * Extract values from an Arrow table as a plain JavaScript array.
 *
 * Why: Arrow decoding returns Table objects, not raw arrays. We need to extract
 * the column values and convert any typed arrays to plain arrays.
 */
function extractArrowValues(data: unknown): unknown[] | null {
  if (Array.isArray(data)) {
    return data;
  }
  // Arrow table - extract values from first column
  const table = data as ArrowTable & { getChildAt?: (i: number) => { toArray?: () => unknown } };
  if (typeof table.getChildAt === 'function') {
    const column = table.getChildAt(0);
    if (column && typeof column.toArray === 'function') {
      return typedArrayToPlain(column.toArray());
    }
  }
  return null;
}

/**
 * Reshape a flat array into a multi-dimensional nested array.
 *
 * Why: PyArrow's pa.array() only handles 1D arrays, so we flatten multi-dimensional
 * arrays before Arrow encoding and reshape after decoding. This maintains Arrow's
 * binary efficiency while working with current arrow-js (which doesn't yet support
 * FixedShapeTensorArray). See: https://github.com/apache/arrow-js/issues/115
 *
 * @param flat - Flat array of values (must be a plain array, not typed array)
 * @param shape - Target shape, e.g., [2, 3] for a 2x3 matrix
 * @returns Nested array with the specified shape
 */
function reshapeArray(flat: unknown[], shape: readonly number[]): unknown {
  if (shape.length === 0) {
    return flat[0];
  }
  if (shape.length === 1) {
    return flat;
  }

  const first = shape[0];
  if (first === undefined) {
    return [];
  }
  const rest = shape.slice(1);
  const chunkSize = rest.reduce((a, b) => a * b, 1);
  const result: unknown[] = [];

  for (let i = 0; i < first; i++) {
    const chunk = flat.slice(i * chunkSize, (i + 1) * chunkSize);
    result.push(reshapeArray(chunk, rest));
  }

  return result;
}

// Why: decoding needs to reject incompatible envelopes before we attempt to interpret payloads.
const CODEC_VERSION = 1;

function assertCodecVersion(envelope: { codecVersion?: unknown }, typeTag: string): void {
  if (!('codecVersion' in envelope)) {
    return;
  }
  const version = envelope.codecVersion;
  if (version === undefined) {
    return;
  }
  if (typeof version !== 'number' || !Number.isFinite(version)) {
    throw new Error(`Invalid ${typeTag} envelope: codecVersion must be a number`);
  }
  if (version !== CODEC_VERSION) {
    throw new Error(`Unsupported ${typeTag} envelope codecVersion: ${version}`);
  }
}

/**
 * Per-typeTag decode handler.
 *
 * Why: each scientific value envelope type (dataframe, series, ndarray, scipy.sparse,
 * torch.tensor, sklearn.estimator) has its own validation and decode logic. Splitting
 * the dispatch into one handler per type keeps each branch focused and testable while
 * preserving byte-identical decoded output.
 */
type EnvelopeHandler = <T>(
  value: { [k: string]: unknown },
  decodeArrow: (bytes: Uint8Array) => MaybePromise<T>,
  recurse: (value: unknown) => MaybePromise<T | unknown>
) => MaybePromise<T | unknown>;

/**
 * Decode an Arrow-or-JSON envelope (dataframe / series).
 *
 * Why: dataframe and series share identical arrow/json handling; the only difference
 * is the typeTag name used in error messages.
 */
function decodeArrowOrJsonEnvelope<T>(
  value: { [k: string]: unknown },
  decodeArrow: (bytes: Uint8Array) => MaybePromise<T>,
  typeTag: string
): MaybePromise<T | unknown> {
  const encoding = value.encoding;
  if (encoding === 'arrow') {
    const b64 = value.b64;
    if (typeof b64 !== 'string') {
      throw new Error(`Invalid ${typeTag} envelope: missing b64`);
    }
    const bytes = fromBase64(b64);
    return decodeArrow(bytes);
  }
  if (encoding === 'json') {
    if (!('data' in value)) {
      throw new Error(`Invalid ${typeTag} envelope: missing data`);
    }
    return value.data;
  }
  throw new Error(`Invalid ${typeTag} envelope: unsupported encoding ${String(encoding)}`);
}

const decodeDataframeEnvelope: EnvelopeHandler = (value, decodeArrow) =>
  decodeArrowOrJsonEnvelope(value, decodeArrow, 'dataframe');

const decodeSeriesEnvelope: EnvelopeHandler = (value, decodeArrow) =>
  decodeArrowOrJsonEnvelope(value, decodeArrow, 'series');

const decodeNdarrayEnvelope: EnvelopeHandler = (value, decodeArrow) => {
  const encoding = value.encoding;
  const shapeValue = value.shape;
  const shape = isNumberArray(shapeValue) ? shapeValue : undefined;

  if (encoding === 'arrow') {
    const b64 = value.b64;
    if (typeof b64 !== 'string') {
      throw new Error('Invalid ndarray envelope: missing b64');
    }
    const bytes = fromBase64(b64);
    const decoded = decodeArrow(bytes);

    // Extract values from Arrow table and reshape if needed
    // Arrow only handles 1D arrays, so we flatten on encode and reshape here
    // Reshape for: scalars (shape.length === 0) and multi-dim (shape.length > 1)
    // Skip reshape for: 1D arrays (shape.length === 1) - return as-is
    if (isPromiseLike(decoded)) {
      return decoded.then(data => {
        const values = extractArrowValues(data);
        if (!values) {
          return data; // Fallback: return raw data if extraction fails
        }
        // Reshape scalars and multi-dimensional arrays, but not 1D
        if (shape && shape.length !== 1) {
          return reshapeArray(values, shape);
        }
        return values;
      });
    }
    const values = extractArrowValues(decoded);
    if (!values) {
      return decoded; // Fallback: return raw data if extraction fails
    }
    // Reshape scalars and multi-dimensional arrays, but not 1D
    if (shape && shape.length !== 1) {
      return reshapeArray(values, shape);
    }
    return values;
  }
  if (encoding === 'json') {
    if (!('data' in value)) {
      throw new Error('Invalid ndarray envelope: missing data');
    }
    return value.data;
  }
  throw new Error(`Invalid ndarray envelope: unsupported encoding ${String(encoding)}`);
};

/**
 * Assert an array holds only integer indices within [0, bound). Used to re-validate
 * scipy.sparse index arrays on the JS side so a corrupt/oversized index can never
 * silently address out of the declared shape.
 *
 * Why: the JS decoder never reconstructs a Python object, but it IS the boundary a
 * downstream consumer trusts — validating index ranges here turns a corrupt payload
 * into a clear, early failure instead of a confusing downstream error.
 */
function assertIndexArrayInRange(arr: readonly unknown[], bound: number, label: string): void {
  for (let i = 0; i < arr.length; i += 1) {
    const idx = arr[i];
    if (typeof idx !== 'number' || !Number.isInteger(idx)) {
      throw new Error(
        `Invalid scipy.sparse envelope: ${label}[${i}] must be an integer, got ${String(idx)}`
      );
    }
    if (idx < 0 || idx >= bound) {
      throw new Error(
        `Invalid scipy.sparse envelope: ${label}[${i}]=${idx} is out of range [0, ${bound})`
      );
    }
  }
}

const decodeScipySparseEnvelope: EnvelopeHandler = value => {
  const encoding = value.encoding;
  if (encoding !== 'json') {
    throw new Error(`Invalid scipy.sparse envelope: unsupported encoding ${String(encoding)}`);
  }
  const format = value.format;
  if (format !== 'csr' && format !== 'csc' && format !== 'coo') {
    throw new Error(`Invalid scipy.sparse envelope: unsupported format ${String(format)}`);
  }
  const shape = value.shape;
  if (
    !Array.isArray(shape) ||
    shape.length !== 2 ||
    typeof shape[0] !== 'number' ||
    typeof shape[1] !== 'number'
  ) {
    throw new Error('Invalid scipy.sparse envelope: shape must be a 2-item number[]');
  }
  const rows = shape[0];
  const cols = shape[1];
  const data = value.data;
  if (!Array.isArray(data)) {
    throw new Error('Invalid scipy.sparse envelope: data must be an array');
  }
  const dtypeValue = value.dtype;
  const dtype = typeof dtypeValue === 'string' ? dtypeValue : undefined;

  if (format === 'coo') {
    const row = value.row;
    const col = value.col;
    if (!Array.isArray(row) || !Array.isArray(col)) {
      throw new Error('Invalid scipy.sparse envelope: coo requires row and col arrays');
    }
    // COO: one (row, col, value) triple per stored entry, so all three arrays
    // share a length; row/col index into [0, rows)/[0, cols) respectively.
    if (row.length !== data.length || col.length !== data.length) {
      throw new Error(
        `Invalid scipy.sparse envelope: coo row/col/data lengths must match ` +
          `(data=${data.length}, row=${row.length}, col=${col.length})`
      );
    }
    assertIndexArrayInRange(row, rows, 'row');
    assertIndexArrayInRange(col, cols, 'col');
    return {
      format,
      shape,
      data,
      row,
      col,
      dtype,
    } satisfies SparseMatrix;
  }

  const indices = value.indices;
  const indptr = value.indptr;
  if (!Array.isArray(indices) || !Array.isArray(indptr)) {
    throw new Error('Invalid scipy.sparse envelope: csr/csc requires indices and indptr arrays');
  }
  // CSR/CSC: one column-index (CSR) or row-index (CSC) per stored value, so
  // indices and data share a length. indptr partitions indices into one segment
  // per major axis (rows for CSR, cols for CSC), so indptr has majorAxis + 1
  // entries; the inner indices address the minor axis.
  if (indices.length !== data.length) {
    throw new Error(
      `Invalid scipy.sparse envelope: ${format} indices/data lengths must match ` +
        `(data=${data.length}, indices=${indices.length})`
    );
  }
  const majorAxis = format === 'csr' ? rows : cols;
  const minorAxis = format === 'csr' ? cols : rows;
  if (indptr.length !== majorAxis + 1) {
    throw new Error(
      `Invalid scipy.sparse envelope: ${format} indptr length must be ${majorAxis + 1} ` +
        `(${format === 'csr' ? 'rows' : 'cols'}+1), got ${indptr.length}`
    );
  }
  assertIndexArrayInRange(indices, minorAxis, 'indices');
  return {
    format,
    shape,
    data,
    indices,
    indptr,
    dtype,
  } satisfies SparseMatrix;
};

/** Product of a shape's dimensions (the element count). [] (scalar) -> 1. */
function shapeProduct(shape: readonly number[]): number {
  return shape.reduce((acc, dim) => acc * dim, 1);
}

const decodeTorchTensorEnvelope: EnvelopeHandler = <T>(
  value: { [k: string]: unknown },
  _decodeArrow: (bytes: Uint8Array) => MaybePromise<T>,
  recurse: (value: unknown) => MaybePromise<T | unknown>
): MaybePromise<T | unknown> => {
  const encoding = value.encoding;
  if (encoding !== 'ndarray') {
    throw new Error(`Invalid torch.tensor envelope: unsupported encoding ${String(encoding)}`);
  }
  if (!('value' in value)) {
    throw new Error('Invalid torch.tensor envelope: missing value');
  }
  const nested = value.value;
  if (!isObject(nested) || (nested as { __tywrap__?: unknown }).__tywrap__ !== 'ndarray') {
    throw new Error('Invalid torch.tensor envelope: value must be an ndarray envelope');
  }
  const shapeValue = value.shape;
  const shape = isNumberArray(shapeValue) ? shapeValue : undefined;
  // The tensor shape must be a non-negative-integer dimension list. A negative or
  // non-integer dim is a corrupt envelope, not a valid tensor.
  if (shape) {
    for (let i = 0; i < shape.length; i += 1) {
      const dim = shape[i] as number;
      if (!Number.isInteger(dim) || dim < 0) {
        throw new Error(
          `Invalid torch.tensor envelope: shape[${i}]=${dim} must be a non-negative integer`
        );
      }
    }
  }
  // Cross-check the tensor shape's element count against the nested ndarray's
  // declared shape (metadata only — no decode needed). A mismatch means the two
  // shapes disagree about how many elements the payload holds.
  const nestedShapeValue = (nested as { shape?: unknown }).shape;
  const nestedShape = isNumberArray(nestedShapeValue) ? nestedShapeValue : undefined;
  if (shape && nestedShape && shapeProduct(shape) !== shapeProduct(nestedShape)) {
    throw new Error(
      `Invalid torch.tensor envelope: shape ${JSON.stringify(shape)} ` +
        `(product ${shapeProduct(shape)}) disagrees with nested ndarray shape ` +
        `${JSON.stringify(nestedShape)} (product ${shapeProduct(nestedShape)})`
    );
  }
  const dtypeValue = value.dtype;
  const dtype = typeof dtypeValue === 'string' ? dtypeValue : undefined;
  const deviceValue = value.device;
  if (deviceValue !== undefined && (typeof deviceValue !== 'string' || deviceValue.length === 0)) {
    throw new Error(
      'Invalid torch.tensor envelope: device must be a non-empty string when provided'
    );
  }
  const device = typeof deviceValue === 'string' ? deviceValue : undefined;

  const decoded = recurse(nested);
  if (isPromiseLike(decoded)) {
    return decoded.then(data => ({ data, shape, dtype, device })) as Promise<T | unknown>;
  }
  return { data: decoded, shape, dtype, device } satisfies TorchTensor;
};

/**
 * Recursively assert a value is plain JSON (null | boolean | number | string |
 * JSON array | plain object of JSON). Rejects functions, symbols, bigints, class
 * instances, and any non-finite number — the things a metadata-only sklearn
 * envelope must never carry. This validates; it never reconstructs.
 */
function assertPlainJson(value: unknown, path: string): void {
  if (value === null) {
    return;
  }
  const t = typeof value;
  if (t === 'string' || t === 'boolean') {
    return;
  }
  if (t === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new Error(
        `Invalid sklearn.estimator envelope: ${path} must be a finite JSON number, got ${String(value)}`
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertPlainJson(item, `${path}[${i}]`));
    return;
  }
  if (t === 'object') {
    // Reject exotic objects (class instances, Map/Set, etc.): a JSON object is a
    // plain object whose prototype is Object.prototype or null.
    const proto = Object.getPrototypeOf(value as object);
    if (proto !== Object.prototype && proto !== null) {
      throw new Error(
        `Invalid sklearn.estimator envelope: ${path} must be a plain JSON object, ` +
          `got ${(value as object).constructor?.name ?? 'object'}`
      );
    }
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      assertPlainJson(v, `${path}.${k}`);
    }
    return;
  }
  // function | symbol | bigint | undefined
  throw new Error(
    `Invalid sklearn.estimator envelope: ${path} is not JSON-serializable (type ${t})`
  );
}

const decodeSklearnEstimatorEnvelope: EnvelopeHandler = value => {
  const encoding = value.encoding;
  if (encoding !== 'json') {
    throw new Error(`Invalid sklearn.estimator envelope: unsupported encoding ${String(encoding)}`);
  }
  const className = value.className;
  const module = value.module;
  const params = value.params;
  if (typeof className !== 'string' || typeof module !== 'string' || !isObject(params)) {
    throw new Error(
      'Invalid sklearn.estimator envelope: expected className/module strings + params object'
    );
  }
  // params must be a PLAIN JSON object end to end — metadata-only estimators never
  // carry callables, class instances, or nested non-JSON values. Validate (do not
  // reconstruct) so a corrupt envelope fails clearly instead of leaking a function
  // or exotic object to a downstream consumer.
  if (Object.getPrototypeOf(params) !== Object.prototype && Object.getPrototypeOf(params) !== null) {
    throw new Error('Invalid sklearn.estimator envelope: params must be a plain JSON object');
  }
  for (const [k, v] of Object.entries(params)) {
    assertPlainJson(v, `params.${k}`);
  }
  const versionValue = value.version;
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
};

// Why: dispatch over the __tywrap__ typeTag instead of a long if-chain so each type's
// decode logic lives in one focused handler. The typeTag strings are the on-the-wire keys
// emitted by the Python bridge and MUST stay byte-identical. A Map keyed by the typeTag
// avoids prototype-chain lookups when dispatching on attacker-controlled typeTag strings.
const ENVELOPE_HANDLERS: ReadonlyMap<string, EnvelopeHandler> = new Map([
  ['dataframe', decodeDataframeEnvelope],
  ['series', decodeSeriesEnvelope],
  ['ndarray', decodeNdarrayEnvelope],
  ['scipy.sparse', decodeScipySparseEnvelope],
  ['torch.tensor', decodeTorchTensorEnvelope],
  ['sklearn.estimator', decodeSklearnEstimatorEnvelope],
]);

function decodeEnvelopeCore<T>(
  value: unknown,
  decodeArrow: (bytes: Uint8Array) => MaybePromise<T>,
  recurse: (value: unknown) => MaybePromise<T | unknown>
): MaybePromise<T | unknown> {
  if (!isObject(value)) {
    return value;
  }
  const typeTag = (value as { __tywrap__?: unknown }).__tywrap__;
  if (typeof typeTag !== 'string') {
    return value as unknown;
  }

  const handler = ENVELOPE_HANDLERS.get(typeTag);
  if (!handler) {
    return value as unknown;
  }

  assertCodecVersion(value as { codecVersion?: unknown }, typeTag);
  return handler(value, decodeArrow, recurse);
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
