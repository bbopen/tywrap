/**
 * Configuration system
 *
 * Loads configuration from defaults, optional config file and CLI overrides
 * with basic validation of known options.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  TywrapOptions,
  OutputConfig,
  RuntimeConfig,
  PerformanceConfig,
  DevelopmentConfig,
} from '../types/index.js';
import { getDefaultPythonPath } from '../utils/python.js';

/**
 * Public configuration type. Currently identical to {@link TywrapOptions}.
 */
export type TywrapConfig = TywrapOptions;

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer U>
    ? Array<U>
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

/**
 * Default configuration values used when options are not supplied.
 */
const DEFAULT_CONFIG: TywrapConfig = {
  pythonModules: {},
  output: { dir: './generated', format: 'esm', declaration: false, sourceMap: false },
  runtime: { node: { pythonPath: getDefaultPythonPath(), timeout: 30000 } },
  performance: { caching: false, batching: false, compression: 'none' },
  development: { hotReload: false, sourceMap: false, validation: 'none' },
  types: { presets: [] },
  debug: false,
};

/**
 * Recursively merge two configuration objects. Arrays are overwritten by
 * overrides instead of concatenated.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function ensureConfigObject(value: unknown, configFile: string): Partial<TywrapOptions> {
  if (!isPlainObject(value)) {
    throw new Error(`Configuration file must export an object: ${configFile}`);
  }
  return value as Partial<TywrapOptions>;
}

function merge<T>(base: T, override: DeepPartial<T>): T {
  const result = new Map<string, unknown>(Object.entries(base as Record<string, unknown>));
  for (const [key, val] of Object.entries(override)) {
    if (val === undefined) {
      continue;
    }
    const current = result.get(key);
    if (isPlainObject(val) && isPlainObject(current)) {
      result.set(key, merge(current, val));
    } else {
      result.set(key, val);
    }
  }
  return Object.fromEntries(result) as T;
}

function safeExists(path: string): boolean {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- config path is user-controlled and resolved
  return existsSync(path);
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
    'types',
    'debug',
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

  if (config.types) {
    const presets = config.types.presets;
    const validPresets = new Set([
      'numpy',
      'pandas',
      'pydantic',
      'stdlib',
      'scipy',
      'torch',
      'sklearn',
    ]);
    if (presets !== undefined) {
      if (!Array.isArray(presets) || presets.some(p => typeof p !== 'string')) {
        throw new Error('types.presets must be an array of strings');
      }
      for (const preset of presets) {
        if (!validPresets.has(preset)) {
          throw new Error(
            `types.presets contains invalid value "${preset}". Allowed: ${Array.from(validPresets).join(', ')}`
          );
        }
      }
    }
  }

  if (typeof config.debug !== 'boolean') {
    throw new Error('debug must be a boolean');
  }
}

/**
 * Create a configuration object by merging defaults with overrides.
 *
 * @param overrides CLI or programmatic overrides
 */
export function createConfig(overrides: DeepPartial<TywrapOptions> = {}): TywrapConfig {
  const merged = merge(DEFAULT_CONFIG, overrides);
  validateConfig(merged);
  return merged;
}

export interface ResolveConfigOptions {
  configFile?: string;
  overrides?: DeepPartial<TywrapOptions>;
  cwd?: string;
  requireConfig?: boolean;
}

/**
 * Resolve configuration by loading a config file (JSON/JS/TS) and merging
 * defaults with any overrides.
 */
export async function resolveConfig(options: ResolveConfigOptions = {}): Promise<TywrapConfig> {
  const cwd = options.cwd ?? process.cwd();
  const overrides = options.overrides ?? {};
  const configFile = options.configFile ? resolve(cwd, options.configFile) : undefined;
  let fileConfig: DeepPartial<TywrapOptions> = {};

  if (configFile) {
    if (!safeExists(configFile)) {
      if (options.requireConfig) {
        throw new Error(`Configuration file not found: ${configFile}`);
      }
    } else {
      fileConfig = await loadConfigFile(configFile);
    }
  }

  const merged = merge(merge(DEFAULT_CONFIG, fileConfig), overrides);
  validateConfig(merged);
  return merged;
}

/**
 * Load a tywrap config file. Supports JSON, JS/CJS/ESM, and TS files.
 */
export async function loadConfigFile(configFile: string): Promise<Partial<TywrapOptions>> {
  const ext = extname(configFile).toLowerCase();
  const resolved = resolve(configFile);

  if (!safeExists(resolved)) {
    throw new Error(`Configuration file not found: ${resolved}`);
  }

  if (ext === '.json') {
    const txt = await safeReadFileAsync(resolved);
    try {
      const parsed = JSON.parse(txt) as unknown;
      return ensureConfigObject(parsed, resolved);
    } catch (err) {
      throw new Error(`Failed to parse JSON config ${resolved}: ${(err as Error).message}`);
    }
  }

  if (ext === '.cjs') {
    const require = createRequire(import.meta.url);
    // eslint-disable-next-line security/detect-non-literal-require -- config path is user-controlled and resolved
    const mod = require(resolved) as Record<string, unknown>;
    const loaded = mod.default ?? mod;
    return ensureConfigObject(loaded ?? {}, resolved);
  }

  if (ext === '.js' || ext === '.mjs') {
    const mod = (await import(pathToFileURL(resolved).href)) as Record<string, unknown>;
    const loaded = mod.default ?? mod;
    return ensureConfigObject(loaded ?? {}, resolved);
  }

  if (ext === '.ts' || ext === '.mts' || ext === '.cts') {
    const ts = await import('typescript');
    const source = await safeReadFileAsync(resolved);
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
      fileName: resolved,
    });
    const require = createRequire(import.meta.url);
    const nodeModule = require('module') as typeof import('module');
    const moduleCtor = nodeModule.Module as unknown as typeof import('module').Module & {
      _nodeModulePaths: (path: string) => string[];
    };
    const mod = new moduleCtor(resolved) as import('module').Module & {
      _compile: (code: string, filename: string) => void;
    };
    mod.filename = resolved;
    mod.paths = moduleCtor._nodeModulePaths(dirname(resolved));
    mod._compile(output.outputText, resolved);
    const loaded = (mod.exports as Record<string, unknown>).default ?? mod.exports;
    return ensureConfigObject(loaded ?? {}, resolved);
  }

  throw new Error(`Unsupported configuration file extension: ${ext}`);
}

async function safeReadFileAsync(path: string): Promise<string> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- config path is user-controlled and resolved
  return readFile(path, 'utf-8');
}

/**
 * Type helper for authoring tywrap configs with full type inference.
 */
export function defineConfig(config: TywrapConfig): TywrapConfig {
  return config;
}
