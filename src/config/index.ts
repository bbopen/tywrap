/**
 * Configuration system
 *
 * Loads configuration from defaults, optional config file and CLI overrides
 * with basic validation of known options.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  TywrapOptions,
  OutputConfig,
  RuntimeConfig,
  PerformanceConfig,
  DevelopmentConfig,
} from '../types/index.js';

/**
 * Public configuration type. Currently identical to {@link TywrapOptions}.
 */
export type TywrapConfig = TywrapOptions;

/**
 * Default configuration values used when options are not supplied.
 */
const DEFAULT_CONFIG: TywrapConfig = {
  pythonModules: {},
  output: { dir: './generated', format: 'esm', declaration: false, sourceMap: false },
  runtime: { node: { pythonPath: 'python3', timeout: 30000 } },
  performance: { caching: true, batching: false, compression: 'none' },
  development: { hotReload: false, sourceMap: false, validation: 'none' },
};

/**
 * Recursively merge two configuration objects. Arrays are overwritten by
 * overrides instead of concatenated.
 */
function merge<T>(base: T, override: Partial<T>): T {
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, val] of Object.entries(override)) {
    if (val === undefined) {
      continue;
    }
    const current = result[key];
    if (
      val &&
      typeof val === 'object' &&
      !Array.isArray(val) &&
      current &&
      typeof current === 'object' &&
      !Array.isArray(current)
    ) {
      result[key] = merge(current, val as Record<string, unknown>);
    } else {
      result[key] = val;
    }
  }
  return result as T;
}

/**
 * Validate configuration values and throw user-friendly errors when invalid.
 */
function validateConfig(config: TywrapConfig): void {
  const allowedTopLevel = new Set([
    'pythonModules',
    'output',
    'runtime',
    'performance',
    'development',
  ]);
  for (const key of Object.keys(config)) {
    if (!allowedTopLevel.has(key)) {
      throw new Error(`Unknown configuration option \"${key}\"`);
    }
  }

  const out: OutputConfig = config.output;
  if (typeof out.dir !== 'string') {
    throw new Error('output.dir must be a string');
  }
  if (!['esm', 'cjs', 'both'].includes(out.format)) {
    throw new Error('output.format must be one of "esm", "cjs" or "both"');
  }
  if (typeof out.declaration !== 'boolean' || typeof out.sourceMap !== 'boolean') {
    throw new Error('output.declaration and output.sourceMap must be boolean');
  }

  const runtime: RuntimeConfig = config.runtime;
  if (runtime.node) {
    if (runtime.node.pythonPath !== undefined && typeof runtime.node.pythonPath !== 'string') {
      throw new Error('runtime.node.pythonPath must be a string');
    }
    if (runtime.node.timeout !== undefined) {
      if (typeof runtime.node.timeout !== 'number' || runtime.node.timeout < 0) {
        throw new Error('runtime.node.timeout must be a non-negative number');
      }
    }
  }

  const perf: PerformanceConfig = config.performance;
  if (typeof perf.caching !== 'boolean') {
    throw new Error('performance.caching must be a boolean');
  }
  if (typeof perf.batching !== 'boolean') {
    throw new Error('performance.batching must be a boolean');
  }
  const validCompression = ['auto', 'gzip', 'brotli', 'none'];
  if (!validCompression.includes(perf.compression)) {
    throw new Error(`performance.compression must be one of ${validCompression.join(', ')}`);
  }

  const dev: DevelopmentConfig = config.development;
  if (typeof dev.hotReload !== 'boolean') {
    throw new Error('development.hotReload must be a boolean');
  }
  if (typeof dev.sourceMap !== 'boolean') {
    throw new Error('development.sourceMap must be a boolean');
  }
  const validValidation = ['runtime', 'compile', 'both', 'none'];
  if (!validValidation.includes(dev.validation)) {
    throw new Error(`development.validation must be one of ${validValidation.join(', ')}`);
  }
}

/**
 * Create a configuration object by merging defaults, an optional configuration
 * file and CLI overrides.
 *
 * @param overrides CLI or programmatic overrides
 * @param configFile Path to configuration file (JSON). If the file does not
 *        exist it will be ignored.
 */
export function createConfig(
  overrides: Partial<TywrapOptions> = {},
  configFile = './tywrap.config.json',
): TywrapConfig {
  let fileConfig: Partial<TywrapOptions> = {};
  const resolved = resolve(configFile);
  if (existsSync(resolved)) {
    try {
      const txt = readFileSync(resolved, 'utf-8');
      fileConfig = JSON.parse(txt) as Partial<TywrapOptions>;
    } catch (err) {
      throw new Error(`Failed to read configuration file ${configFile}: ${(err as Error).message}`);
    }
  }

  const merged = merge(merge(DEFAULT_CONFIG, fileConfig), overrides);
  validateConfig(merged);
  return merged;
}

