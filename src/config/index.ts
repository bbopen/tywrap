/**
 * Configuration system
 *
 * Loads configuration from defaults, optional config file and CLI overrides
 * with basic validation of known options.
 */

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { readFile, rm, writeFile, mkdtemp, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  TywrapOptions,
  OutputConfig,
  RuntimeConfig,
  PerformanceConfig,
  PythonModuleConfig,
} from '../types/index.js';
import { getDefaultPythonPath } from '../utils/python.js';

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer U>
    ? Array<U>
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

/**
 * User-authored configuration shape accepted by defineConfig() and config files.
 */
export type TywrapConfig = DeepPartial<TywrapOptions>;

/**
 * Fully resolved configuration shape returned by createConfig() and resolveConfig().
 */
export type ResolvedTywrapConfig = TywrapOptions;

/**
 * Default configuration values used when options are not supplied.
 */
const DEFAULT_CONFIG: ResolvedTywrapConfig = {
  pythonModules: {},
  pythonImportPath: [],
  output: { dir: './generated', format: 'esm', declaration: false, sourceMap: false },
  runtime: { node: { pythonPath: getDefaultPythonPath(), timeout: 30000 } },
  performance: { caching: false, batching: false, compression: 'none' },
  types: { presets: [] },
  debug: false,
};

const LEGACY_DEVELOPMENT_MESSAGE =
  'Legacy config field "development" is no longer supported. Use createBridgeReloader() or startNodeWatchSession() from "tywrap/dev" instead.';

const LEGACY_MODULE_WATCH_MESSAGE =
  'Legacy config field "pythonModules.<module>.watch" is no longer supported. Use startNodeWatchSession() from "tywrap/dev" instead.';

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

function detectLegacyFields(config: TywrapConfig): void {
  const rawConfig = config as unknown as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(rawConfig, 'development')) {
    throw new Error(LEGACY_DEVELOPMENT_MESSAGE);
  }

  const pythonModules = rawConfig.pythonModules;
  if (!isPlainObject(pythonModules)) {
    return;
  }

  for (const moduleConfig of Object.values(pythonModules)) {
    if (
      isPlainObject(moduleConfig) &&
      Object.prototype.hasOwnProperty.call(moduleConfig, 'watch')
    ) {
      throw new Error(LEGACY_MODULE_WATCH_MESSAGE);
    }
  }
}

const ALLOWED_TOP_LEVEL = new Set([
  'pythonModules',
  'pythonImportPath',
  'output',
  'runtime',
  'performance',
  'types',
  'debug',
]);

const VALID_OUTPUT_FORMATS = ['esm', 'cjs', 'both'];
const VALID_COMPRESSION = ['auto', 'gzip', 'brotli', 'none'];
const VALID_TYPE_HINTS = ['strict', 'loose', 'ignore'];
const VALID_TYPE_PRESETS = new Set([
  'numpy',
  'pandas',
  'pydantic',
  'stdlib',
  'scipy',
  'torch',
  'sklearn',
]);

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function validatePythonModules(modules: Record<string, PythonModuleConfig>): void {
  for (const [name, moduleConfig] of Object.entries(modules)) {
    if (!isPlainObject(moduleConfig)) {
      throw new Error(`pythonModules.${name} must be an object`);
    }
    const scope = `pythonModules.${name}`;
    const { version, alias, functions, classes, exclude, excludePatterns, typeHints } =
      moduleConfig;
    if (version !== undefined && typeof version !== 'string') {
      throw new Error(`${scope}.version must be a string`);
    }
    if (alias !== undefined && typeof alias !== 'string') {
      throw new Error(`${scope}.alias must be a string`);
    }
    const stringArrayFields: ReadonlyArray<readonly [string, unknown]> = [
      ['functions', functions],
      ['classes', classes],
      ['exclude', exclude],
      ['excludePatterns', excludePatterns],
    ];
    for (const [field, value] of stringArrayFields) {
      if (value !== undefined && !isStringArray(value)) {
        throw new Error(`${scope}.${field} must be an array of strings`);
      }
    }
    if (typeHints !== undefined && !VALID_TYPE_HINTS.includes(typeHints)) {
      throw new Error(`${scope}.typeHints must be one of ${VALID_TYPE_HINTS.join(', ')}`);
    }
    // Note: `runtime` is a deprecated, dead per-module field (see PythonModuleConfig).
    // It is intentionally not validated so legacy configs keep loading; it has no effect.
  }
}

function validateOutput(out: OutputConfig): void {
  if (typeof out.dir !== 'string') {
    throw new Error('output.dir must be a string');
  }
  if (!VALID_OUTPUT_FORMATS.includes(out.format)) {
    throw new Error('output.format must be one of "esm", "cjs" or "both"');
  }
  if (typeof out.declaration !== 'boolean' || typeof out.sourceMap !== 'boolean') {
    throw new Error('output.declaration and output.sourceMap must be boolean');
  }
}

function validateRuntime(runtime: RuntimeConfig): void {
  if (runtime.node) {
    if (runtime.node.pythonPath !== undefined && typeof runtime.node.pythonPath !== 'string') {
      throw new Error('runtime.node.pythonPath must be a string');
    }
    if (runtime.node.virtualEnv !== undefined && typeof runtime.node.virtualEnv !== 'string') {
      throw new Error('runtime.node.virtualEnv must be a string');
    }
    if (
      runtime.node.timeout !== undefined &&
      (typeof runtime.node.timeout !== 'number' || runtime.node.timeout < 0)
    ) {
      throw new Error('runtime.node.timeout must be a non-negative number');
    }
  }
  if (runtime.http) {
    if (typeof runtime.http.baseURL !== 'string' || runtime.http.baseURL.length === 0) {
      throw new Error('runtime.http.baseURL must be a non-empty string');
    }
    if (
      runtime.http.timeout !== undefined &&
      (typeof runtime.http.timeout !== 'number' || runtime.http.timeout < 0)
    ) {
      throw new Error('runtime.http.timeout must be a non-negative number');
    }
  }
  if (runtime.pyodide) {
    if (runtime.pyodide.indexURL !== undefined && typeof runtime.pyodide.indexURL !== 'string') {
      throw new Error('runtime.pyodide.indexURL must be a string');
    }
    if (runtime.pyodide.packages !== undefined && !isStringArray(runtime.pyodide.packages)) {
      throw new Error('runtime.pyodide.packages must be an array of strings');
    }
  }
}

function validatePerformance(perf: PerformanceConfig): void {
  if (typeof perf.caching !== 'boolean') {
    throw new Error('performance.caching must be a boolean');
  }
  if (typeof perf.batching !== 'boolean') {
    throw new Error('performance.batching must be a boolean');
  }
  if (!VALID_COMPRESSION.includes(perf.compression)) {
    throw new Error(`performance.compression must be one of ${VALID_COMPRESSION.join(', ')}`);
  }
}

function validateTypes(types: NonNullable<ResolvedTywrapConfig['types']>): void {
  const presets = types.presets;
  if (presets === undefined) {
    return;
  }
  if (!isStringArray(presets)) {
    throw new Error('types.presets must be an array of strings');
  }
  for (const preset of presets) {
    if (!VALID_TYPE_PRESETS.has(preset)) {
      throw new Error(
        `types.presets contains invalid value "${preset}". Allowed: ${Array.from(VALID_TYPE_PRESETS).join(', ')}`
      );
    }
  }
}

/**
 * Validate configuration values and throw user-friendly errors when invalid.
 */
function validateConfig(config: ResolvedTywrapConfig): void {
  detectLegacyFields(config);
  for (const key of Object.keys(config)) {
    if (!ALLOWED_TOP_LEVEL.has(key)) {
      throw new Error(`Unknown configuration option \"${key}\"`);
    }
  }

  if (config.pythonModules !== undefined) {
    if (!isPlainObject(config.pythonModules)) {
      throw new Error('pythonModules must be an object');
    }
    validatePythonModules(config.pythonModules);
  }

  if (config.pythonImportPath !== undefined && !isStringArray(config.pythonImportPath)) {
    throw new Error('pythonImportPath must be an array of strings');
  }

  validateOutput(config.output);
  validateRuntime(config.runtime);
  validatePerformance(config.performance);

  if (config.types) {
    validateTypes(config.types);
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
export function createConfig(overrides: DeepPartial<TywrapOptions> = {}): ResolvedTywrapConfig {
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
export async function resolveConfig(
  options: ResolveConfigOptions = {}
): Promise<ResolvedTywrapConfig> {
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

  // Dispatch by file extension. Each loader receives the resolved absolute path
  // and the lowercased extension and returns the parsed config object.
  const loader = CONFIG_LOADERS[ext];
  if (!loader) {
    throw new Error(`Unsupported configuration file extension: ${ext}`);
  }
  return loader(resolved, ext);
}

async function loadJsonConfig(resolved: string): Promise<Partial<TywrapOptions>> {
  const txt = await safeReadFileAsync(resolved);
  try {
    const parsed = JSON.parse(txt) as unknown;
    return ensureConfigObject(parsed, resolved);
  } catch (err) {
    throw new Error(`Failed to parse JSON config ${resolved}: ${(err as Error).message}`);
  }
}

async function loadCjsConfig(resolved: string): Promise<Partial<TywrapOptions>> {
  const require = createRequire(import.meta.url);
  // eslint-disable-next-line security/detect-non-literal-require -- config path is user-controlled and resolved
  const mod = require(resolved) as Record<string, unknown>;
  const loaded = mod.default ?? mod;
  return ensureConfigObject(loaded ?? {}, resolved);
}

async function loadEsmConfig(resolved: string): Promise<Partial<TywrapOptions>> {
  const mod = (await import(pathToFileURL(resolved).href)) as Record<string, unknown>;
  const loaded = mod.default ?? mod;
  return ensureConfigObject(loaded ?? {}, resolved);
}

async function loadTypeScriptConfig(
  resolved: string,
  ext: string
): Promise<Partial<TywrapOptions>> {
  const ts = await import('typescript');
  const source = await safeReadFileAsync(resolved);
  // Why: many configs want to `import { defineConfig } from 'tywrap'`. The tywrap package is ESM,
  // so evaluating a transpiled CommonJS config would try `require('tywrap')` and fail. Treat
  // `.ts`/`.mts` configs as ESM, and only treat `.cts` as CommonJS to match Node conventions.
  const emitCommonJs = ext === '.cts';
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: emitCommonJs ? ts.ModuleKind.CommonJS : ts.ModuleKind.ES2020,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: resolved,
  });

  let transpiledOutput = output.outputText;
  if (!emitCommonJs) {
    try {
      // Preserve support for `import { defineConfig } from 'tywrap'` when ESM config
      // is evaluated from an OS temp directory outside the package scope.
      const tywrapEntryHref = await import.meta.resolve('tywrap');
      transpiledOutput = transpiledOutput
        .replaceAll("'tywrap'", `'${tywrapEntryHref}'`)
        .replaceAll('\"tywrap\"', `\"${tywrapEntryHref}\"`);
    } catch {
      // Best-effort: leave source as-is when tywrap cannot be resolved.
    }
  }

  if (emitCommonJs) {
    // Why: `.cts` is explicitly CommonJS. We evaluate the transpiled output in-memory using
    // Node's Module internals (`Module._compile` / `_nodeModulePaths`) to avoid writing an extra
    // temp file. These are private Node APIs, so we keep this tooling path scoped and rely on
    // supported Node versions (see package.json engines).
    const require = createRequire(import.meta.url);
    const nodeModule = require('module') as typeof import('module');
    const moduleCtor = nodeModule.Module as unknown as typeof import('module').Module & {
      _nodeModulePaths?: (path: string) => string[];
    };
    if (typeof moduleCtor !== 'function') {
      throw new Error(
        '[tywrap] Unable to evaluate .cts config in-memory (emitCommonJs=true): missing Node Module constructor'
      );
    }
    const nodeModulePaths = moduleCtor._nodeModulePaths;
    if (typeof nodeModulePaths !== 'function') {
      throw new Error(
        '[tywrap] Unable to evaluate .cts config in-memory (emitCommonJs=true): missing Node private API Module._nodeModulePaths'
      );
    }
    const mod = new moduleCtor(resolved) as import('module').Module & {
      _compile?: (code: string, filename: string) => void;
    };
    const compile = mod._compile;
    if (typeof compile !== 'function') {
      throw new Error(
        '[tywrap] Unable to evaluate .cts config in-memory (emitCommonJs=true): missing Node private API Module._compile'
      );
    }
    mod.filename = resolved;
    mod.paths = nodeModulePaths(dirname(resolved));
    compile.call(mod, output.outputText, resolved);
    const loaded = (mod.exports as Record<string, unknown>).default ?? mod.exports;
    return ensureConfigObject(loaded ?? {}, resolved);
  }

  // Why: Node can't import ESM from a string without a custom loader. We write transpiled
  // output to a temporary `.mjs` file under the OS temp directory (not next to user config),
  // then clean up both file and temporary directory after loading.
  const tempDir = await mkdtemp(resolve(tmpdir(), 'tywrap-config-'));
  const tmpPath = resolve(tempDir, `.tywrap.config.${randomUUID()}.mjs`);
  try {
    const localNodeModules = resolve(process.cwd(), 'node_modules');
    if (safeExists(localNodeModules)) {
      const tempNodeModules = resolve(tempDir, 'node_modules');
      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- temp path is derived from OS temp directory
        await symlink(localNodeModules, tempNodeModules, 'dir');
      } catch {
        // Best-effort only; regular resolution may still succeed without a symlink.
      }
    }

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- temp path is derived from OS temp directory
    await writeFile(tmpPath, transpiledOutput, 'utf-8');
    const mod = (await import(pathToFileURL(tmpPath).href)) as Record<string, unknown>;
    const loaded = mod.default ?? mod;
    return ensureConfigObject(loaded ?? {}, resolved);
  } finally {
    await rm(tmpPath, { force: true });
    await rm(tempDir, { recursive: true, force: true });
  }
}

/**
 * Loaders for each supported configuration file extension. The map keys are the
 * lowercased extensions returned by `extname`; the matching loader parses the file.
 */
const CONFIG_LOADERS: Readonly<
  Record<string, (resolved: string, ext: string) => Promise<Partial<TywrapOptions>>>
> = {
  '.json': loadJsonConfig,
  '.cjs': loadCjsConfig,
  '.js': loadEsmConfig,
  '.mjs': loadEsmConfig,
  '.ts': loadTypeScriptConfig,
  '.mts': loadTypeScriptConfig,
  '.cts': loadTypeScriptConfig,
};

async function safeReadFileAsync(path: string): Promise<string> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- config path is user-controlled and resolved
  return readFile(path, 'utf-8');
}

/**
 * Type helper for authoring tywrap configs with full type inference.
 */
export function defineConfig<T extends TywrapConfig>(config: T): T {
  return config;
}
