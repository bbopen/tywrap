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

/**
 * Compute a stable, safe filename for on-disk IR caching.
 *
 * Why: cache filenames must not include user-controlled module names to avoid
 * path traversal or invalid filename characters (especially on Windows).
 */
export async function computeIrCacheFilename(keyObject: IrCacheKeyObject): Promise<string> {
  const normalized = JSON.stringify(keyObject);
  const digest = await hashUtils.sha256Hex(normalized);
  // Hash-only filename: safe ASCII, no separators, stable length.
  return `ir_${digest.slice(0, 32)}.json`;
}
