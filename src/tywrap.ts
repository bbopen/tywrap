/**
 * Main tywrap API entry point
 */

import { CodeGenerator } from './core/generator.js';
import { TypeMapper } from './core/mapper.js';
import { createConfig } from './config/index.js';
import type {
  TywrapOptions,
  PythonFunction,
  PythonModule as TSPythonModule,
  PythonClass,
  Parameter,
  PythonType,
} from './types/index.js';
import { fsUtils, pathUtils, processUtils, hashUtils } from './utils/runtime.js';
import { globalCache } from './utils/cache.js';
import { globalParallelProcessor } from './utils/parallel-processor.js';
import { resolvePythonExecutable } from './utils/python.js';

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
    // reset collector for each module
    unknownTypeNamesCollector = new Map();
    // Prefer Python IR extractor over TS analyzer with optional cache
    const cacheKey = await computeCacheKey(moduleKey, options);
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
      const fetchResult = await fetchPythonIr(moduleKey, pythonPath);
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
  pythonPath: string
): Promise<{ ir: unknown | null; error?: string }> {
  if (!processUtils.isAvailable()) {
    return { ir: null, error: 'Subprocess operations not available in this runtime' };
  }
  try {
    const result = await processUtils.exec(pythonPath, [
      '-m',
      'tywrap_ir',
      '--module',
      moduleName,
      '--no-pretty',
    ]);
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

    // Fallback to invoking local __main__.py
    const localMain = pathUtils.join(process.cwd(), 'tywrap_ir', 'tywrap_ir', '__main__.py');
    const fallback = await processUtils.exec(pythonPath, [
      localMain,
      '--module',
      moduleName,
      '--no-pretty',
    ]);
    if (fallback.code !== 0) {
      return {
        ir: null,
        error: `tywrap_ir failed. stderr: ${fallback.stderr.trim() || result.stderr.trim() || 'empty'}`,
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
  const mapParam = (p: Record<string, unknown>): Parameter => ({
    name: String(p.name ?? ''),
    type: parseAnnotationToPythonType(p.annotation),
    optional: Boolean(p.default),
    varArgs: p.kind === 'VAR_POSITIONAL',
    kwArgs: p.kind === 'VAR_KEYWORD',
  });

  const mapFunc = (f: Record<string, unknown>): PythonFunction => ({
    name: String(f.name ?? ''),
    signature: {
      parameters: Array.isArray(f.parameters)
        ? (f.parameters as unknown[]).map(v => mapParam((v ?? {}) as Record<string, unknown>))
        : [],
      returnType: parseAnnotationToPythonType(f.returns),
      isAsync: Boolean(f.is_async),
      isGenerator: Boolean(f.is_generator),
    },
    docstring: (f.docstring as string | undefined) ?? undefined,
    decorators: [],
    isAsync: Boolean(f.is_async),
    isGenerator: Boolean(f.is_generator),
    returnType: parseAnnotationToPythonType(f.returns),
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
            type: parseAnnotationToPythonType(p.annotation),
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

function unknownType(): PythonType {
  return { kind: 'custom', name: 'Any', module: 'typing' };
}

// Parse Python IR annotation string -> PythonType
function parseAnnotationToPythonType(annotation: unknown, depth = 0): PythonType {
  if (annotation === null || annotation === undefined) {
    return unknownType();
  }
  if (depth > 100) {
    return unknownType();
  }
  const raw = String(annotation).trim();

  // Handle built-in class repr: <class 'int'>
  const classMatch = raw.match(/^<class ['"][^'"]+['"]>$/);
  if (classMatch) {
    const inner = (raw.match(/^<class ['"]([^'"]+)['"]>$/) ?? [])[1] ?? '';
    const name = (inner.split('.').pop() ?? '').toString();
    return mapSimpleName(name);
  }

  // PEP 604 unions: int | str | None
  if (raw.includes(' | ')) {
    const parts = splitTopLevel(raw, '|');
    const types = parts.map(p => parseAnnotationToPythonType(p.trim(), depth + 1));
    return { kind: 'union', types };
  }

  // typing.Union[...]
  if (raw.startsWith('typing.Union[') || raw.startsWith('Union[')) {
    const inner = raw.slice(raw.indexOf('[') + 1, raw.lastIndexOf(']'));
    const parts = splitTopLevel(inner, ',');
    const types = parts.map(p => parseAnnotationToPythonType(p.trim(), depth + 1));
    return { kind: 'union', types };
  }

  // Optional[T]
  if (raw.startsWith('typing.Optional[') || raw.startsWith('Optional[')) {
    const inner = raw.slice(raw.indexOf('[') + 1, raw.lastIndexOf(']'));
    const base = parseAnnotationToPythonType(inner, depth + 1);
    return { kind: 'optional', type: base };
  }

  // Literal[...] -> literal values union
  if (raw.startsWith('typing.Literal[') || raw.startsWith('Literal[')) {
    const inner = raw.slice(raw.indexOf('[') + 1, raw.lastIndexOf(']'));
    const parts = splitTopLevel(inner, ',');
    if (parts.length === 1) {
      return mapLiteral(String(parts[0] ?? '').trim());
    }
    return { kind: 'union', types: parts.map(p => mapLiteral(String(p).trim())) } as PythonType;
  }

  // typing_extensions wrappers: ClassVar[T], Final[T], Required[T], NotRequired[T]
  const extMatch = raw.match(
    /^(typing\.|typing_extensions\.)?(ClassVar|Final|Required|NotRequired)\[(.*)\]$/
  );
  if (extMatch) {
    const inner = extMatch[3] ?? '';
    const base = parseAnnotationToPythonType(inner, depth + 1);
    return base;
  }

  // LiteralString
  if (raw === 'typing.LiteralString' || raw === 'LiteralString') {
    return { kind: 'primitive', name: 'str' } as PythonType;
  }

  // Callable[[...], R]
  if (raw.startsWith('typing.Callable[') || raw.startsWith('Callable[')) {
    const inner = raw.slice(raw.indexOf('[') + 1, raw.lastIndexOf(']'));
    const parts = splitTopLevel(inner, ',');
    if (parts.length >= 2) {
      const paramsPart = (parts[0] ?? '').trim();
      const returnPart = parts.slice(1).join(',').trim();
      const paramInner =
        paramsPart.startsWith('[') && paramsPart.endsWith(']') ? paramsPart.slice(1, -1) : '';
      const paramTypes = ((): PythonType[] => {
        const trimmed = paramInner.trim();
        if (trimmed === '...' || trimmed === 'Ellipsis') {
          return [{ kind: 'custom', name: '...' } as PythonType];
        }
        return trimmed
          ? splitTopLevel(trimmed, ',').map(p => parseAnnotationToPythonType(p.trim(), depth + 1))
          : [];
      })();
      const returnType = parseAnnotationToPythonType(returnPart, depth + 1);
      return { kind: 'callable', parameters: paramTypes, returnType } as PythonType;
    }
  }

  // Mapping[K, V] / Dict[K, V] normalization
  if (raw.startsWith('typing.Mapping[') || raw.startsWith('Mapping[')) {
    const inner = raw.slice(raw.indexOf('[') + 1, raw.lastIndexOf(']'));
    const parts = splitTopLevel(inner, ',');
    const itemTypes = parts.map(p => parseAnnotationToPythonType(p.trim(), depth + 1));
    return { kind: 'collection', name: 'dict', itemTypes } as PythonType;
  }

  // Annotated[T, ...] -> annotated node with base and metadata
  if (raw.startsWith('typing.Annotated[') || raw.startsWith('Annotated[')) {
    const inner = raw.slice(raw.indexOf('[') + 1, raw.lastIndexOf(']'));
    const parts = splitTopLevel(inner, ',');
    if (parts.length > 0) {
      const base = parseAnnotationToPythonType((parts[0] ?? '').trim(), depth + 1);
      const metaParts = parts.slice(1).map(p => String(p).trim());
      return { kind: 'annotated', base, metadata: metaParts } as PythonType;
    }
  }

  // Collections: list[T], dict[K,V], tuple[...], set[T]
  const coll = normalizeCollectionName(raw);
  if (coll) {
    const { name, inner } = coll;
    const itemParts =
      name === 'dict' ? splitTopLevel(inner ?? '', ',') : splitTopLevel(inner ?? '', ',');
    const itemTypes = (inner ? itemParts : []).map(p =>
      parseAnnotationToPythonType(p.trim(), depth + 1)
    );
    return { kind: 'collection', name, itemTypes };
  }

  // typing.Callable[...] unlikely for now - treat as custom

  // Bare names like int, str, float, bool, bytes, None
  return mapSimpleName(raw);
}

function mapSimpleName(name: string): PythonType {
  const n = name.replace(/^typing\./, '').trim();
  if (n === 'int' || n === 'float' || n === 'str' || n === 'bool' || n === 'bytes') {
    // cast to the specific union type without using any
    return { kind: 'primitive', name: n };
  }
  // Track unknown typing-ish names for diagnostics
  if (
    n === 'Any' ||
    n === 'Never' ||
    n === 'LiteralString' ||
    n === 'ClassVar' ||
    n === 'Final' ||
    n === 'TypeAlias' ||
    n === 'Required' ||
    n === 'NotRequired'
  ) {
    try {
      recordUnknown(n);
    } catch {}
  }
  if (n === 'None' || n.toLowerCase() === 'nonetype') {
    return { kind: 'primitive', name: 'None' };
  }
  if (n === 'list' || n === 'List') {
    return { kind: 'collection', name: 'list', itemTypes: [] };
  }
  if (n === 'dict' || n === 'Dict') {
    return { kind: 'collection', name: 'dict', itemTypes: [] };
  }
  if (n === 'tuple' || n === 'Tuple') {
    return { kind: 'collection', name: 'tuple', itemTypes: [] };
  }
  if (n === 'set' || n === 'Set') {
    return { kind: 'collection', name: 'set', itemTypes: [] };
  }
  return { kind: 'custom', name: n };
}

function normalizeCollectionName(
  raw: string
): { name: 'list' | 'dict' | 'tuple' | 'set' | 'frozenset'; inner?: string } | null {
  const m = raw.match(/^(typing\.)?(List|Dict|Tuple|Set|list|dict|tuple|set)\[(.*)\]$/);
  if (!m) {
    return null;
  }
  const nameRaw = String(m[2] ?? '');
  const name =
    nameRaw.toLowerCase() === 'list'
      ? 'list'
      : nameRaw.toLowerCase() === 'dict'
        ? 'dict'
        : nameRaw.toLowerCase() === 'tuple'
          ? 'tuple'
          : 'set';
  return { name, inner: String(m[3] ?? '') };
}

function splitTopLevel(input: string, sep: '|' | ','): string[] {
  const results: string[] = [];
  let level = 0;
  let cur = '';
  let guard = 0;
  for (let i = 0; i < input.length; i++) {
    // Depth/length guard to avoid pathological recursion/loops
    guard++;
    if (guard > 20000) {
      // Bail out safely; push remaining and break
      if (cur.trim()) {
        results.push(cur.trim());
      }
      break;
    }
    const ch = input.charAt(i);
    if (ch === '[' || ch === '(') {
      level++;
    }
    if (ch === ']' || ch === ')') {
      level = Math.max(0, level - 1);
    }
    if (level === 0 && input.slice(i, i + sep.length) === sep) {
      results.push(cur.trim());
      cur = '';
      i += sep.length - 1;
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) {
    results.push(cur.trim());
  }
  return results;
}

function mapLiteral(text: string): PythonType {
  // strip quotes if present
  const t = text.trim();
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
    return { kind: 'literal', value: t.slice(1, -1) } as PythonType;
  }
  if (t === 'True' || t === 'False') {
    return { kind: 'literal', value: t === 'True' } as PythonType;
  }
  if (t === 'None') {
    return { kind: 'literal', value: null } as PythonType;
  }
  const num = Number(t);
  if (!Number.isNaN(num)) {
    return { kind: 'literal', value: num } as PythonType;
  }
  // fallback
  return { kind: 'custom', name: t } as PythonType;
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
  const normalized = JSON.stringify(keyObject);
  const digest = await hashUtils.sha256Hex(normalized);
  return `ir_${moduleName}_${digest.slice(0, 16)}.json`;
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
