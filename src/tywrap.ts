/**
 * Main tywrap API entry point
 */

import { CodeGenerator } from './core/generator.js';
import { TypeMapper } from './core/mapper.js';
import { parseAnnotationToPythonType } from './core/annotation-parser.js';
import { createConfig } from './config/index.js';
import type {
  TywrapOptions,
  PythonFunction,
  PythonModule as TSPythonModule,
  PythonClass,
  Parameter,
  PythonType,
} from './types/index.js';
import { fsUtils, pathUtils, processUtils, isWindows } from './utils/runtime.js';
import { globalCache } from './utils/cache.js';
import { globalParallelProcessor } from './utils/parallel-processor.js';
import { resolvePythonExecutable } from './utils/python.js';
import { computeIrCacheFilename } from './utils/ir-cache.js';

// Collect unknown typing constructs encountered during annotation parsing (per-generate run)
let unknownTypeNamesCollector: Map<string, number> = new Map();
function recordUnknown(name: string): void {
  const prev = unknownTypeNamesCollector.get(name) ?? 0;
  unknownTypeNamesCollector.set(name, prev + 1);
}

/**
 * Main tywrap function
 */
export interface TywrapInstance {
  mapper: TypeMapper;
  generator: CodeGenerator;
  options: Partial<TywrapOptions>;
}

export async function tywrap(options: Partial<TywrapOptions> = {}): Promise<TywrapInstance> {
  const mapper = new TypeMapper({ presets: options.types?.presets });
  const generator = new CodeGenerator(mapper);

  globalCache.setDebug(options.debug ?? false);
  globalParallelProcessor.setDebug(options.debug ?? false);

  return {
    mapper,
    generator,
    options,
  };
}

export default tywrap;

/**
 * Append minimal tsd tests for a generated module (optional dev aid)
 */
export async function emitTypeTestsForModule(
  moduleName: string,
  outDir = 'test-d/generated'
): Promise<void> {
  const { writeFile, mkdir } = await import('fs/promises');
  const { join } = await import('path');
  try {
    await mkdir(outDir, { recursive: true });
  } catch {}
  const filePath = join(outDir, `${moduleName}.test-d.ts`);
  const content = `import { expectType } from 'tsd';
import * as mod from '../../generated/${moduleName}.generated.ts';

// Opportunistic: ensure module namespace is an object
expectType<Record<string, unknown>>(mod);
`;
  await writeFile(filePath, content, 'utf-8');
}

export interface GenerateRunOptions {
  /**
   * If true, do not write files; instead compare generated output to what's on disk.
   * Intended for CI to ensure wrappers are checked in and up to date.
   */
  check?: boolean;
}

export interface GenerateResult {
  written: string[];
  warnings: string[];
  /**
   * Only set when `GenerateRunOptions.check === true`.
   * Lists files that are missing or differ from what would be generated.
   */
  outOfDate?: string[];
}

function normalizeForComparison(text: string): string {
  // Avoid false positives from CRLF vs LF (e.g. Windows checkouts)
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

async function safeReadFile(path: string): Promise<string | null> {
  try {
    return await fsUtils.readFile(path);
  } catch {
    return null;
  }
}

/**
 * Generate TypeScript wrappers for configured Python modules.
 * Minimal MVP implementation: resolves module file, analyzes, generates TS, writes to output.dir
 */
export async function generate(
  options: Partial<TywrapOptions>,
  runOptions: GenerateRunOptions = {}
): Promise<GenerateResult> {
  const checkMode = runOptions.check === true;
  const resolvedOptions = createConfig(options);
  const instance = await tywrap(resolvedOptions);
  const written: string[] = [];
  const outOfDate: string[] = [];
  const warnings: string[] = [];
  const outputDir = resolvedOptions.output.dir;
  const caching = resolvedOptions.performance.caching;
  const cacheDir = '.tywrap/cache';
  const pythonPath = await resolvePythonExecutable({
    pythonPath: resolvedOptions.runtime?.node?.pythonPath,
    virtualEnv: resolvedOptions.runtime?.node?.virtualEnv,
  });

  // Ensure directory exists (Node-only best-effort)
  if (!checkMode) {
    try {
      const modFs = await import('fs/promises');
      await modFs.mkdir(outputDir, { recursive: true });
    } catch {
      // ignore in non-node or if already exists
    }
  }

  const modules = resolvedOptions.pythonModules ?? {};
  for (const entry of Object.entries(modules)) {
    const moduleKey = entry[0];
    const moduleConfig = entry[1];
    // reset collector for each module
    unknownTypeNamesCollector = new Map();
    // Prefer Python IR extractor over TS analyzer with optional cache
    const cacheKey = await computeCacheKey(moduleKey, resolvedOptions);
    let ir: unknown | null = null;
    let irError: string | undefined;
    if (caching && fsUtils.isAvailable()) {
      try {
        const cached = await fsUtils.readFile(pathUtils.join(cacheDir, cacheKey));
        ir = JSON.parse(cached);
      } catch {
        ir = null;
      }
    }
    if (!ir) {
      const fetchResult = await fetchPythonIr(moduleKey, pythonPath, {
        timeoutMs: resolvedOptions.runtime?.node?.timeout,
        pythonImportPath: resolvedOptions.pythonImportPath,
      });
      ir = fetchResult.ir;
      irError = fetchResult.error;
      if (ir && caching && fsUtils.isAvailable() && !checkMode) {
        try {
          await fsUtils.writeFile(pathUtils.join(cacheDir, cacheKey), JSON.stringify(ir));
        } catch {}
      }
    }
    if (!ir) {
      warnings.push(`No IR produced for module ${moduleKey}${irError ? `: ${irError}` : ''}`);
      continue;
    }

    const moduleModel = transformIrToTsModel(ir);

    // Apply module-level export filtering (functions/classes + excludes).
    {
      const builtInDefaultExcludes = new Set([
        'dataclass',
        'property',
        'staticmethod',
        'classmethod',
        'abstractmethod',
        'cached_property',
      ]);

      const excludeExact = new Set((moduleConfig.exclude ?? []).map(String));
      const excludeRegexes: RegExp[] = [];
      for (const pattern of moduleConfig.excludePatterns ?? []) {
        try {
          excludeRegexes.push(new RegExp(String(pattern)));
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          warnings.push(
            `Module ${moduleKey}: invalid excludePatterns regex "${String(pattern)}": ${message}`
          );
        }
      }

      const shouldExclude = (name: string, applyBuiltInDefaults: boolean): boolean => {
        if (excludeExact.has(name)) {
          return true;
        }
        if (excludeRegexes.some(r => r.test(name))) {
          return true;
        }
        if (applyBuiltInDefaults && builtInDefaultExcludes.has(name)) {
          return true;
        }
        return false;
      };

      if (Array.isArray(moduleConfig.functions)) {
        const allow = new Set(moduleConfig.functions.map(String));
        for (const requested of allow) {
          if (!moduleModel.functions.some(f => f.name === requested)) {
            warnings.push(
              `Module ${moduleKey}: configured function "${requested}" not found in IR`
            );
          }
        }
        moduleModel.functions = moduleModel.functions.filter(
          f => allow.has(f.name) && !shouldExclude(f.name, false)
        );
      } else {
        moduleModel.functions = moduleModel.functions.filter(f => !shouldExclude(f.name, true));
      }

      if (Array.isArray(moduleConfig.classes)) {
        const allow = new Set(moduleConfig.classes.map(String));
        for (const requested of allow) {
          if (!moduleModel.classes.some(c => c.name === requested)) {
            warnings.push(`Module ${moduleKey}: configured class "${requested}" not found in IR`);
          }
        }
        moduleModel.classes = moduleModel.classes.filter(
          c => allow.has(c.name) && !shouldExclude(c.name, false)
        );
      } else {
        moduleModel.classes = moduleModel.classes.filter(c => !shouldExclude(c.name, true));
      }
    }

    // Generate module code
    const annotatedJSDoc = Boolean(resolvedOptions.output?.annotatedJSDoc);
    const gen = instance.generator.generateModuleDefinition(moduleModel, annotatedJSDoc);

    const baseName = moduleModel.name || 'module';
    const filesToEmit: Array<{ path: string; content: string }> = [
      { path: pathUtils.join(outputDir, `${baseName}.generated.ts`), content: gen.typescript },
    ];

    // Optional .d.ts emission (header-only declarations mirroring exports)
    if (resolvedOptions.output?.declaration) {
      filesToEmit.push({
        path: pathUtils.join(outputDir, `${baseName}.generated.d.ts`),
        content: renderDts(gen.typescript),
      });
    }

    // Optional source map emission (placeholder mapping for now)
    if (resolvedOptions.output?.sourceMap) {
      filesToEmit.push({
        path: pathUtils.join(outputDir, `${baseName}.generated.ts.map`),
        content: renderSourceMapPlaceholder(moduleModel.name),
      });
    }

    if (checkMode) {
      for (const file of filesToEmit) {
        const existing = await safeReadFile(file.path);
        if (existing === null) {
          outOfDate.push(file.path);
          continue;
        }
        if (normalizeForComparison(existing) !== normalizeForComparison(file.content)) {
          outOfDate.push(file.path);
        }
      }
    } else {
      for (const file of filesToEmit) {
        await fsUtils.writeFile(file.path, file.content);
        written.push(file.path);
      }
    }

    // Emit warning summary of unknown typing constructs (best-effort)
    if (unknownTypeNamesCollector.size > 0) {
      const entries = Array.from(unknownTypeNamesCollector.entries()).sort((a, b) => b[1] - a[1]);
      const unkList = entries
        .slice(0, 25)
        .map(([n, c]) => `${n}:${c}`)
        .join(', ');
      warnings.push(
        `Module ${baseName}: unknown typing constructs encountered: ${unkList}${entries.length > 25 ? '…' : ''}`
      );
      // Write JSON report
      if (!checkMode) {
        try {
          const reportsDir = pathUtils.join('.tywrap', 'reports');
          await fsUtils.writeFile(
            pathUtils.join(reportsDir, `${baseName}.json`),
            JSON.stringify({
              module: baseName,
              unknowns: Object.fromEntries(entries),
              generatedAt: new Date().toISOString(),
            })
          );
        } catch {
          // ignore
        }
      }
    }
  }

  if (checkMode) {
    return { written: [], warnings, outOfDate };
  }

  return { written, warnings };
}

/**
 * Invoke the Python IR CLI to get JSON IR for a module.
 */
async function fetchPythonIr(
  moduleName: string,
  pythonPath: string,
  options: { timeoutMs?: number; pythonImportPath?: string[] } = {}
): Promise<{ ir: unknown | null; error?: string }> {
  if (!processUtils.isAvailable()) {
    return { ir: null, error: 'Subprocess operations not available in this runtime' };
  }
  const delimiter = isWindows() ? ';' : ':';
  const extraPaths = (options.pythonImportPath ?? []).filter(Boolean);
  const existingPyPath =
    typeof process !== 'undefined' && typeof process.env === 'object' && process.env
      ? process.env.PYTHONPATH
      : undefined;
  const mergedPyPath = [...extraPaths, ...(existingPyPath ? [existingPyPath] : [])]
    .filter(Boolean)
    .join(delimiter);
  const env = mergedPyPath ? { PYTHONPATH: mergedPyPath } : undefined;
  try {
    const result = await processUtils.exec(
      pythonPath,
      ['-m', 'tywrap_ir', '--module', moduleName, '--no-pretty'],
      { timeoutMs: options.timeoutMs, env }
    );
    if (result.code === 0) {
      try {
        return { ir: JSON.parse(result.stdout) };
      } catch {
        return {
          ir: null,
          error: `Failed to parse tywrap_ir output. stderr: ${result.stderr.trim() || 'empty'}`,
        };
      }
    }

    const stderrText = result.stderr.trim();
    const isTywrapIrMissing =
      stderrText.includes('No module named') && stderrText.includes('tywrap_ir');
    if (!isTywrapIrMissing) {
      return { ir: null, error: `tywrap_ir failed. stderr: ${stderrText || 'empty'}` };
    }

    // Fallback to invoking local __main__.py (useful when running from the repo).
    const localMain = pathUtils.join(process.cwd(), 'tywrap_ir', 'tywrap_ir', '__main__.py');
    let localMainExists = false;
    if (fsUtils.isAvailable()) {
      try {
        await fsUtils.readFile(localMain);
        localMainExists = true;
      } catch {
        localMainExists = false;
      }
    }
    if (!localMainExists) {
      return {
        ir: null,
        error: `tywrap_ir not found on PYTHONPATH. stderr: ${stderrText || 'empty'}`,
      };
    }

    const fallback = await processUtils.exec(
      pythonPath,
      [localMain, '--module', moduleName, '--no-pretty'],
      { timeoutMs: options.timeoutMs, env }
    );
    if (fallback.code !== 0) {
      return {
        ir: null,
        error: `tywrap_ir failed. stderr: ${fallback.stderr.trim() || stderrText || 'empty'}`,
      };
    }
    try {
      return { ir: JSON.parse(fallback.stdout) };
    } catch {
      return {
        ir: null,
        error: `Failed to parse tywrap_ir fallback output. stderr: ${fallback.stderr.trim() || 'empty'}`,
      };
    }
  } catch (err) {
    return { ir: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Convert JSON IR from Python into the internal TypeScript model used by the generator.
 */
function transformIrToTsModel(ir: unknown): TSPythonModule {
  const obj: Record<string, unknown> =
    typeof ir === 'object' && ir !== null ? (ir as Record<string, unknown>) : {};
  const functions = (obj.functions as unknown[]) ?? [];
  const classes = (obj.classes as unknown[]) ?? [];
  const parseType = (annotation: unknown): PythonType =>
    parseAnnotationToPythonType(annotation, { onUnknownTypeName: recordUnknown });
  const mapParam = (p: Record<string, unknown>): Parameter => ({
    name: String(p.name ?? ''),
    type: parseType(p.annotation),
    optional: Boolean(p.default),
    varArgs: p.kind === 'VAR_POSITIONAL',
    kwArgs: p.kind === 'VAR_KEYWORD',
    positionalOnly: p.kind === 'POSITIONAL_ONLY',
    keywordOnly: p.kind === 'KEYWORD_ONLY',
  });

  const mapFunc = (f: Record<string, unknown>): PythonFunction => ({
    name: String(f.name ?? ''),
    signature: {
      parameters: Array.isArray(f.parameters)
        ? (f.parameters as unknown[]).map(v => mapParam((v ?? {}) as Record<string, unknown>))
        : [],
      returnType: parseType(f.returns),
      isAsync: Boolean(f.is_async),
      isGenerator: Boolean(f.is_generator),
    },
    docstring: (f.docstring as string | undefined) ?? undefined,
    decorators: [],
    isAsync: Boolean(f.is_async),
    isGenerator: Boolean(f.is_generator),
    returnType: parseType(f.returns),
    parameters: Array.isArray(f.parameters)
      ? (f.parameters as unknown[]).map(v => mapParam((v ?? {}) as Record<string, unknown>))
      : [],
  });

  const mapClass = (c: Record<string, unknown>): PythonClass => ({
    name: String(c.name ?? ''),
    bases: Array.isArray(c.bases) ? (c.bases as string[]) : [],
    methods: Array.isArray(c.methods)
      ? (c.methods as unknown[]).map(v => mapFunc((v ?? {}) as Record<string, unknown>))
      : [],
    properties: Array.isArray(c.fields)
      ? ((c.fields as unknown[]).map(v => {
          const p = (v ?? {}) as Record<string, unknown>;
          const optional = Boolean(p.default);
          return {
            name: String(p.name ?? ''),
            type: parseType(p.annotation),
            readonly: false,
            setter: false,
            getter: true,
            optional,
          } as unknown as never;
        }) as unknown as PythonClass['properties'])
      : [],
    docstring: (c.docstring as string | undefined) ?? undefined,
    decorators: (c.typed_dict as boolean) ? ['__typed_dict__'] : [],
    kind: (c.typed_dict as boolean)
      ? 'typed_dict'
      : (c.is_protocol as boolean)
        ? 'protocol'
        : (c.is_namedtuple as boolean)
          ? 'namedtuple'
          : (c.is_dataclass as boolean)
            ? 'dataclass'
            : (c.is_pydantic as boolean)
              ? 'pydantic'
              : 'class',
  });

  const moduleModel: TSPythonModule = {
    name: (obj.module as string) ?? 'module',
    path: undefined,
    version:
      typeof (obj.metadata as Record<string, unknown> | undefined)?.package_version === 'string'
        ? ((obj.metadata as Record<string, unknown> | undefined)?.package_version as string)
        : undefined,
    functions: functions.map(v => mapFunc((v ?? {}) as Record<string, unknown>)),
    classes: classes.map(v => mapClass((v ?? {}) as Record<string, unknown>)),
    imports: [],
    exports: [],
  };
  return moduleModel;
}

/**
 * Compute a stable cache key filename for a module and options
 */
async function computeCacheKey(
  moduleName: string,
  options: Partial<TywrapOptions>
): Promise<string> {
  const modules = options.pythonModules ?? {};
  const foundEntry = Object.entries(modules).find(([name]) => name === moduleName);
  const moduleConfig = foundEntry ? foundEntry[1] : undefined;
  const runtimePython = await resolvePythonExecutable({
    pythonPath: options.runtime?.node?.pythonPath,
    virtualEnv: options.runtime?.node?.virtualEnv,
  });
  const keyObject = {
    module: moduleName,
    moduleVersion: moduleConfig?.version ?? null,
    pythonImportPath: options.pythonImportPath ?? [],
    runtime: {
      pythonPath: runtimePython,
      virtualEnv: options.runtime?.node?.virtualEnv ?? null,
    },
    output: {
      format: options.output?.format ?? 'esm',
      declaration: options.output?.declaration ?? false,
      sourceMap: options.output?.sourceMap ?? false,
    },
    performance: {
      caching: options.performance?.caching ?? false,
      compression: options.performance?.compression ?? 'none',
    },
    typeHints: moduleConfig?.typeHints ?? 'strict',
  } as const;
  return await computeIrCacheFilename(keyObject);
}

/**
 * Very lightweight .d.ts emitter derived from generated TS wrappers
 * This is intentionally minimal and stable for our wrappers shape.
 */
function renderDts(generatedTs: string): string {
  const header = `// Generated by tywrap\n// Type Declarations\n// DO NOT EDIT MANUALLY\n\n`;
  const lines: string[] = [header];
  // Extract function exports
  const funcRegex = /export\s+async\s+function\s+(\w+)\s*\(([^)]*)\)\s*:\s*Promise<([^>]+)>/g;
  let m: RegExpExecArray | null;
  while ((m = funcRegex.exec(generatedTs)) !== null) {
    const name = m[1];
    const params = m[2];
    const ret = m[3];
    lines.push(`export function ${name}(${params}): Promise<${ret}>;`);
  }
  // Extract class exports and methods
  const classRegex = /export\s+class\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
  while ((m = classRegex.exec(generatedTs)) !== null) {
    const className = String(m[1] ?? '');
    const body = String(m[2] ?? '');
    // Constructor is always variadic unknown[] in current generator
    const methods: string[] = [];
    const methodRegex = /\n\s+async\s+(\w+)\s*\(([^)]*)\)\s*:\s*Promise<([^>]+)>/g;
    let mm: RegExpExecArray | null;
    while ((mm = methodRegex.exec(body)) !== null) {
      methods.push(`  ${mm[1]}(${mm[2]}): Promise<${mm[3]}>;`);
    }
    lines.push(`export class ${className} {`);
    lines.push(`  constructor(...args: unknown[]);`);
    if (methods.length > 0) {
      lines.push(methods.join('\n'));
    }
    lines.push('}');
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Minimal source map placeholder (stable, empty mappings)
 */
function renderSourceMapPlaceholder(moduleName: string | undefined): string {
  const safe = moduleName ?? 'module';
  const map = {
    version: 3,
    file: `${safe}.generated.ts`,
    sources: [],
    names: [],
    mappings: '',
  } as const;
  return JSON.stringify(map, null, 0);
}
