import { hashUtils } from './runtime.js';

export interface IrCacheKeyObject {
  module: string;
  moduleVersion: string | null;
  pythonImportPath?: readonly string[];
  runtime: {
    pythonPath: string;
    virtualEnv: string | null;
  };
  output: {
    format: 'esm' | 'cjs' | 'both';
    declaration: boolean;
    sourceMap: boolean;
  };
  performance: {
    caching: boolean;
    compression: 'auto' | 'gzip' | 'brotli' | 'none';
  };
  typeHints: 'strict' | 'loose' | 'ignore';
}

function stableSortForJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(v => stableSortForJson(v));
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = stableSortForJson(obj[key]);
    }
    return out;
  }
  return value;
}

/**
 * Compute a stable, safe filename for on-disk IR caching.
 *
 * Why: cache filenames must not include user-controlled module names to avoid
 * path traversal or invalid filename characters (especially on Windows).
 */
export async function computeIrCacheFilename(keyObject: IrCacheKeyObject): Promise<string> {
  // Canonicalize to avoid cache misses when key object property insertion order differs.
  const normalized = JSON.stringify(stableSortForJson(keyObject));
  const digest = await hashUtils.sha256Hex(normalized);
  // Hash-only filename: safe ASCII, no separators, stable length.
  return `ir_${digest.slice(0, 32)}.json`;
}
