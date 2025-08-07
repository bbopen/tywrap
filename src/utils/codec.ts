/**
 * Codec utilities for transporting rich Python values over JSON
 *
 * Python bridge emits envelopes like:
 * { "__tywrap__": "dataframe", "encoding": "arrow", "b64": "..." }
 * Optionally with ndarray fallback: { "__tywrap__": "ndarray", "encoding": "json", ... }
 */

// Avoid hard dependency on apache-arrow types at compile time to keep install optional.
export type ArrowTable = { readonly numCols?: number; readonly numRows?: number } & Record<
  string,
  unknown
>;

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
    };

export type DecodedValue = ArrowTable | Uint8Array | unknown;

let arrowTableFrom: ((bytes: Uint8Array) => ArrowTable | Uint8Array) | undefined;

export function registerArrowDecoder(
  decoder: (bytes: Uint8Array) => ArrowTable | Uint8Array
): void {
  arrowTableFrom = decoder;
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
  const bin = globalThis.atob ? globalThis.atob(b64) : '';
  const arr = Array.from(bin, c => c.charCodeAt(0));
  return new Uint8Array(arr);
}

async function tryDecodeArrowTable(bytes: Uint8Array): Promise<ArrowTable | Uint8Array> {
  if (arrowTableFrom) {
    try {
      return arrowTableFrom(bytes);
    } catch {
      // fall through to raw bytes
    }
  }
  return bytes;
}

/**
 * Decode values produced by the Python bridge.
 */
export async function decodeValueAsync(value: unknown): Promise<DecodedValue> {
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
    return await tryDecodeArrowTable(bytes);
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
      return fromBase64(String((value as { b64: string }).b64));
    }
    if ((value as { encoding?: unknown }).encoding === 'json' && 'data' in (value as object)) {
      return (value as { data: unknown }).data;
    }
  }
  return value as unknown;
}

/**
 * Synchronous best-effort decode. Arrow decoding falls back to raw bytes.
 */
export function decodeValue(value: unknown): DecodedValue {
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
    // Synchronous path uses registered decoder when available; otherwise raw bytes
    if (arrowTableFrom) {
      try {
        return arrowTableFrom(bytes);
      } catch {
        // ignore
      }
    }
    return bytes;
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
      return fromBase64(String((value as { b64: string }).b64));
    }
    if ((value as { encoding?: unknown }).encoding === 'json' && 'data' in (value as object)) {
      return (value as { data: unknown }).data;
    }
  }
  return value as unknown;
}
