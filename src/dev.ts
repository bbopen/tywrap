/**
 * Dev-only bridge reload helpers.
 *
 * These helpers support wrapper regeneration plus runtime bridge replacement.
 * They do not provide application-level hot module reloading.
 */

import { watch as createWatcher, type FSWatcher } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, relative, resolve, sep } from 'node:path';

import { resolveConfig } from './config/index.js';
import { clearRuntimeBridge, getRuntimeBridge, setRuntimeBridge } from './runtime/index.js';
import type { Disposable } from './runtime/disposable.js';
import type { RuntimeExecution, TywrapOptions } from './types/index.js';
import { generate, type GenerateFailure } from './tywrap.js';
import { resolvePythonExecutable } from './utils/python.js';
import { isNodejs, processUtils } from './utils/runtime.js';

type BridgeFactory<T extends RuntimeExecution & Disposable> = () => T | Promise<T>;

interface Initializable {
  init(): Promise<void>;
}

type WatchTargetKind = 'file' | 'directory';
type WatchSourceKind = 'file' | 'tree';
type NodeWatchBridgeFactory<T extends RuntimeExecution & Disposable> = (
  config: TywrapOptions
) => T | Promise<T>;

const IGNORED_WATCH_DIRECTORY_NAMES = new Set([
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
]);

interface WatchTarget {
  moduleName: string;
  path: string;
  kind: WatchTargetKind;
}

interface WatchSource {
  path: string;
  kind: WatchSourceKind;
}

interface StageResult {
  config: TywrapOptions;
  tempDir: string;
  files: Map<string, string>;
  written: string[];
  warnings: string[];
  failures: GenerateFailure[];
  watchSources: WatchSource[];
  outputDir: string;
}

export interface BridgeReloaderOptions {
  setAsGlobal?: boolean;
}

export interface BridgeReloader<T extends RuntimeExecution & Disposable> {
  current(): T;
  reload(): Promise<T>;
  dispose(): Promise<void>;
}

export type NodeWatchEvent =
  | { type: 'watchPaths'; paths: string[] }
  | { type: 'change'; path: string; manual: boolean }
  | { type: 'reload-start'; path?: string; manual: boolean }
  | {
      type: 'reload-success';
      path?: string;
      manual: boolean;
      paths: string[];
      written: string[];
      warnings: string[];
    }
  | { type: 'reload-error'; path?: string; manual: boolean; error: Error };

export interface StartNodeWatchSessionOptions<T extends RuntimeExecution & Disposable> {
  configFile: string;
  createBridge: NodeWatchBridgeFactory<T>;
  extraWatchPaths?: string[];
  debounceMs?: number;
  onEvent?: (event: NodeWatchEvent) => void;
}

export interface NodeWatchSession {
  reloadNow(): Promise<boolean>;
  close(): Promise<void>;
}

interface PreparedWatchers {
  paths: string[];
  sources: WatchSource[];
  watchers: FSWatcher[];
}

function safeEmit(
  onEvent: StartNodeWatchSessionOptions<RuntimeExecution & Disposable>['onEvent'],
  event: NodeWatchEvent
): void {
  try {
    onEvent?.(event);
  } catch {
    // Dev hooks must not break reload handling.
  }
}

function isInitializable(value: unknown): value is Initializable {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as Initializable).init === 'function'
  );
}

async function initializeBridge<T extends RuntimeExecution & Disposable>(bridge: T): Promise<T> {
  if (isInitializable(bridge)) {
    await bridge.init();
  }
  return bridge;
}

function safeGetRuntimeBridge(): RuntimeExecution | null {
  try {
    return getRuntimeBridge();
  } catch {
    return null;
  }
}

class ManagedBridgeReloader<T extends RuntimeExecution & Disposable> implements BridgeReloader<T> {
  private currentBridge: T | null = null;
  private disposed = false;
  private queue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly createBridge: BridgeFactory<T>,
    private readonly options: Required<BridgeReloaderOptions>
  ) {}

  static async create<T extends RuntimeExecution & Disposable>(
    createBridge: BridgeFactory<T>,
    options: BridgeReloaderOptions = {}
  ): Promise<ManagedBridgeReloader<T>> {
    const manager = new ManagedBridgeReloader(createBridge, {
      setAsGlobal: options.setAsGlobal ?? true,
    });
    const initialBridge = await manager.prepareNextBridge();
    await manager.activatePreparedBridge(initialBridge);
    return manager;
  }

  current(): T {
    if (this.disposed || !this.currentBridge) {
      throw new Error('Bridge reloader has been disposed');
    }
    return this.currentBridge;
  }

  async prepareNextBridge(): Promise<T> {
    if (this.disposed) {
      throw new Error('Bridge reloader has been disposed');
    }
    return initializeBridge(await this.createBridge());
  }

  async activatePreparedBridge(nextBridge: T): Promise<T> {
    if (this.disposed) {
      await nextBridge.dispose();
      throw new Error('Bridge reloader has been disposed');
    }

    const previousBridge = this.currentBridge;
    this.currentBridge = nextBridge;

    if (this.options.setAsGlobal) {
      setRuntimeBridge(nextBridge);
    }

    if (previousBridge && previousBridge !== nextBridge) {
      previousBridge.dispose().catch(() => {
        // Keep the new bridge active even if old cleanup fails.
      });
    }

    return nextBridge;
  }

  async reload(): Promise<T> {
    return this.enqueue(async () => {
      const nextBridge = await this.prepareNextBridge();
      return this.activatePreparedBridge(nextBridge);
    });
  }

  async dispose(): Promise<void> {
    await this.enqueue(async () => {
      if (this.disposed) {
        return;
      }

      this.disposed = true;
      const activeBridge = this.currentBridge;
      this.currentBridge = null;

      if (this.options.setAsGlobal && activeBridge && safeGetRuntimeBridge() === activeBridge) {
        clearRuntimeBridge();
      }

      if (activeBridge) {
        await activeBridge.dispose().catch(() => {
          // Session shutdown is best-effort.
        });
      }
    });
  }

  private enqueue<R>(task: () => Promise<R>): Promise<R> {
    const result = this.queue.then(task, task);
    this.queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}

function normalizePaths(paths: Iterable<string>): string[] {
  return [...new Set(Array.from(paths, path => resolve(path)))].sort();
}

function normalizeWatchSources(sources: Iterable<WatchSource>): WatchSource[] {
  const entries = new Map<string, WatchSourceKind>();

  for (const source of sources) {
    const path = resolve(source.path);
    const existingKind = entries.get(path);
    if (existingKind === 'tree' || existingKind === source.kind) {
      continue;
    }
    entries.set(path, source.kind);
  }

  return [...entries.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, kind]) => ({ path, kind }));
}

function isSameOrNestedPath(candidate: string, root: string): boolean {
  const resolvedCandidate = resolve(candidate);
  const resolvedRoot = resolve(root);
  return (
    resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)
  );
}

function hasIgnoredWatchDirectory(path: string): boolean {
  return resolve(path)
    .split(sep)
    .filter(Boolean)
    .some(segment => IGNORED_WATCH_DIRECTORY_NAMES.has(segment));
}

function shouldIgnoreWatchPath(candidate: string, ignoredPaths: string[]): boolean {
  return (
    hasIgnoredWatchDirectory(candidate) ||
    ignoredPaths.some(ignoredPath => isSameOrNestedPath(candidate, ignoredPath))
  );
}

function buildFailureError(failures: GenerateFailure[]): Error {
  const heading =
    failures.length === 1
      ? 'Generation failed for 1 module:'
      : `Generation failed for ${failures.length} modules:`;
  const details = failures.map(failure => `- ${failure.message}`).join('\n');
  return new Error(`${heading}\n${details}`);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function maybeReadText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

async function listExistingManagedFiles(outputDir: string): Promise<Set<string>> {
  if (!(await pathExists(outputDir))) {
    return new Set();
  }

  const managedFiles = new Set<string>();
  const queue = [resolve(outputDir)];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const entries = await readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }

      if (
        entry.isFile() &&
        (entry.name.endsWith('.generated.ts') ||
          entry.name.endsWith('.generated.d.ts') ||
          entry.name.endsWith('.generated.ts.map'))
      ) {
        managedFiles.add(relative(outputDir, fullPath));
      }
    }
  }

  return managedFiles;
}

async function collectWatchDirectories(root: string, ignoredPaths: string[]): Promise<string[]> {
  const queue = [resolve(root)];
  const directories: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (shouldIgnoreWatchPath(current, ignoredPaths)) {
      continue;
    }

    let currentStats;
    try {
      currentStats = await stat(current);
    } catch {
      continue;
    }

    if (!currentStats.isDirectory()) {
      continue;
    }

    directories.push(current);

    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      queue.push(join(current, entry.name));
    }
  }

  return normalizePaths(directories);
}

function toWatchSource(target: WatchTarget): WatchSource {
  return {
    path: target.path,
    kind: target.kind === 'directory' ? 'tree' : 'file',
  };
}

async function resolveExtraWatchSources(paths: string[]): Promise<WatchSource[]> {
  const sources: WatchSource[] = [];

  for (const watchPath of normalizePaths(paths)) {
    const watchStats = await stat(watchPath);
    if (watchStats.isDirectory()) {
      sources.push({ path: watchPath, kind: 'tree' });
      continue;
    }
    if (watchStats.isFile()) {
      sources.push({ path: watchPath, kind: 'file' });
      continue;
    }
    throw new Error(`Watch path "${watchPath}" is not a file or directory`);
  }

  return sources;
}

async function promoteManagedFiles(
  outputDir: string,
  nextFiles: Map<string, string>,
  previousManagedFiles: Set<string>
): Promise<Set<string>> {
  const touchedPaths = new Set<string>([...previousManagedFiles, ...nextFiles.keys()]);
  const previousContents = new Map<string, string | null>();

  for (const relativePath of touchedPaths) {
    previousContents.set(relativePath, await maybeReadText(join(outputDir, relativePath)));
  }

  try {
    await mkdir(outputDir, { recursive: true });

    for (const [relativePath, content] of nextFiles) {
      const destination = join(outputDir, relativePath);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, content, 'utf-8');
    }

    for (const relativePath of previousManagedFiles) {
      if (!nextFiles.has(relativePath)) {
        await rm(join(outputDir, relativePath), { force: true });
      }
    }

    return new Set(nextFiles.keys());
  } catch (error) {
    for (const [relativePath, previousContent] of previousContents) {
      const destination = join(outputDir, relativePath);
      if (previousContent === null) {
        await rm(destination, { force: true });
      } else {
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, previousContent, 'utf-8');
      }
    }
    throw error;
  }
}

async function resolveWatchTargets(config: TywrapOptions): Promise<WatchTarget[]> {
  const pythonPath = await resolvePythonExecutable({
    pythonPath: config.runtime?.node?.pythonPath,
    virtualEnv: config.runtime?.node?.virtualEnv,
  });

  const extraImportPaths = config.pythonImportPath ?? [];
  const mergedPyPath = [
    ...extraImportPaths,
    ...(process.env.PYTHONPATH ? [process.env.PYTHONPATH] : []),
  ]
    .filter(Boolean)
    .join(delimiter);
  const env = mergedPyPath ? { PYTHONPATH: mergedPyPath } : undefined;
  const timeoutMs = config.runtime?.node?.timeout ?? 30000;

  const watchTargets: WatchTarget[] = [];

  for (const moduleName of Object.keys(config.pythonModules ?? {})) {
    const resolutionScript = [
      'import importlib',
      'import importlib.util',
      'import json',
      'import sys',
      '',
      'module_name = sys.argv[1]',
      'spec = importlib.util.find_spec(module_name)',
      'if spec is None:',
      "    print(json.dumps({'missing': True}))",
      '    raise SystemExit(0)',
      '',
      'module_path = None',
      'module_origin = spec.origin',
      'if spec.submodule_search_locations:',
      '    try:',
      '        module = importlib.import_module(module_name)',
      '    except Exception:',
      '        module = None',
      '    if module is not None:',
      '        module_path = getattr(module, "__path__", None)',
      '        module_origin = getattr(module, "__file__", None) or spec.origin',
      'payload = {',
      "    'missing': False,",
      "    'origin': module_origin,",
      "    'locations': list(module_path) if module_path is not None else list(spec.submodule_search_locations or []),",
      "    'has_location': bool(spec.has_location),",
      '}',
      'print(json.dumps(payload))',
    ].join('\n');

    const result = await processUtils.exec(pythonPath, ['-c', resolutionScript, moduleName], {
      timeoutMs,
      env,
    });

    if (result.code !== 0) {
      throw new Error(
        `Failed to resolve watch target for module "${moduleName}": ${result.stderr.trim() || result.stdout.trim() || 'unknown error'}`
      );
    }

    let payload: {
      missing?: boolean;
      origin?: string | null;
      locations?: string[];
      has_location?: boolean;
    };
    try {
      payload = JSON.parse(result.stdout) as {
        missing?: boolean;
        origin?: string | null;
        locations?: string[];
        has_location?: boolean;
      };
    } catch (error) {
      throw new Error(
        `Failed to parse watch target for module "${moduleName}": ${(error as Error).message}`
      );
    }

    if (payload.missing) {
      throw new Error(`Module "${moduleName}" could not be resolved for watching`);
    }

    const packageLocations = Array.isArray(payload.locations) ? payload.locations : [];
    if (packageLocations.length > 0) {
      for (const location of packageLocations) {
        const packageDir = resolve(location);
        const stats = await stat(packageDir);
        if (!stats.isDirectory()) {
          throw new Error(
            `Module "${moduleName}" resolved to "${packageDir}", but it is not a package directory`
          );
        }
        watchTargets.push({ moduleName, path: packageDir, kind: 'directory' });
      }
      continue;
    }

    if (typeof payload.origin !== 'string' || !payload.origin.endsWith('.py')) {
      throw new Error(
        `Module "${moduleName}" is not backed by a local Python source file or package directory and cannot be watched`
      );
    }

    const modulePath = resolve(payload.origin);
    const stats = await stat(modulePath);
    if (!stats.isFile()) {
      throw new Error(
        `Module "${moduleName}" resolved to "${modulePath}", but it is not a Python source file`
      );
    }

    watchTargets.push({ moduleName, path: modulePath, kind: 'file' });
  }

  return watchTargets;
}

async function generateToStage(configFile: string): Promise<StageResult> {
  const config = await resolveConfig({ configFile, requireConfig: true });
  const watchTargets = await resolveWatchTargets(config);
  const tempDir = await mkdtemp(join(tmpdir(), 'tywrap-dev-'));
  const stageOutputDir = join(tempDir, 'output');

  try {
    const result = await generate({
      ...config,
      output: {
        ...config.output,
        dir: stageOutputDir,
      },
      performance: {
        ...config.performance,
        caching: false,
      },
    });

    if (result.failures.length > 0) {
      throw buildFailureError(result.failures);
    }

    const files = new Map<string, string>();
    for (const writtenPath of result.written) {
      const relativePath = relative(stageOutputDir, writtenPath);
      files.set(relativePath, await readFile(writtenPath, 'utf-8'));
    }

    const outputDir = resolve(config.output.dir);
    const watchSources = normalizeWatchSources(watchTargets.map(toWatchSource));

    return {
      config,
      tempDir,
      files,
      written: result.written,
      warnings: result.warnings,
      failures: result.failures,
      watchSources,
      outputDir,
    };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

function buildIgnoredPaths(outputDir: string): string[] {
  return normalizePaths([
    outputDir,
    resolve(process.cwd(), '.tywrap', 'cache'),
    resolve(process.cwd(), '.tywrap', 'reports'),
  ]);
}

export async function createBridgeReloader<T extends RuntimeExecution & Disposable>(
  createBridge: BridgeFactory<T>,
  options: BridgeReloaderOptions = {}
): Promise<BridgeReloader<T>> {
  return ManagedBridgeReloader.create(createBridge, options);
}

export async function startNodeWatchSession<T extends RuntimeExecution & Disposable>(
  options: StartNodeWatchSessionOptions<T>
): Promise<NodeWatchSession> {
  if (!isNodejs()) {
    throw new Error('startNodeWatchSession() is only available in Node.js');
  }

  const configFile = resolve(options.configFile);
  const extraWatchPaths = normalizePaths(
    (options.extraWatchPaths ?? []).map(path => resolve(path))
  );
  const debounceMs = options.debounceMs ?? 100;

  let bridgeManager: ManagedBridgeReloader<T> | null = null;
  let currentBridgeConfig: TywrapOptions | null = null;
  let managedFiles = new Set<string>();
  let activeOutputDir: string | null = null;
  let activeWatchSources: WatchSource[] = [];
  let watchers: FSWatcher[] = [];
  let ignoredPaths: string[] = [];
  let reloadPromise: Promise<boolean> | null = null;
  let watcherRefreshPromise: Promise<void> = Promise.resolve();
  let queuedTrigger: { path?: string; manual: boolean } | null = null;
  let debounceTimer: NodeJS.Timeout | undefined;
  let lastReloadError: Error | null = null;
  let closed = false;

  const emit = (event: NodeWatchEvent): void => {
    safeEmit(options.onEvent, event);
  };

  const shouldIgnorePath = (path: string): boolean => shouldIgnoreWatchPath(path, ignoredPaths);

  const createBridgeForSession = async (): Promise<T> => {
    if (!currentBridgeConfig) {
      throw new Error('No resolved tywrap config is available for bridge creation');
    }
    return options.createBridge(currentBridgeConfig);
  };

  const closeWatchers = (): void => {
    const active = watchers;
    watchers = [];
    for (const watcher of active) {
      watcher.close();
    }
  };

  const closePreparedWatchers = (prepared: PreparedWatchers | null): void => {
    if (!prepared) {
      return;
    }
    for (const watcher of prepared.watchers) {
      watcher.close();
    }
  };

  const prepareWatchers = async (
    sources: WatchSource[],
    nextIgnoredPaths: string[]
  ): Promise<PreparedWatchers> => {
    const prepared: FSWatcher[] = [];
    const normalizedSources = normalizeWatchSources(sources);
    try {
      for (const source of normalizedSources) {
        if (source.kind === 'tree') {
          const directories = await collectWatchDirectories(source.path, nextIgnoredPaths);
          for (const directoryPath of directories) {
            const watcher = createWatcher(
              directoryPath,
              (eventType: string, filename: string | Buffer | null): void => {
                const fileName =
                  typeof filename === 'string'
                    ? filename
                    : filename instanceof Buffer
                      ? filename.toString()
                      : '';
                const changedPath = fileName.length > 0 ? resolve(directoryPath, fileName) : directoryPath;
                if (shouldIgnorePath(changedPath)) {
                  return;
                }
                if (eventType === 'rename' || fileName.length === 0) {
                  queueWatcherRefresh().catch(() => {
                    // Surface the next reload error rather than crashing the session.
                  });
                }
                emit({ type: 'change', path: changedPath, manual: false });
                scheduleReload({ path: changedPath, manual: false });
              }
            );
            watcher.on('error', () => {
              // Surface the next reload error rather than crashing the session.
            });
            prepared.push(watcher);
          }
          continue;
        }

        const watcher = createWatcher(source.path, () => {
          if (shouldIgnorePath(source.path)) {
            return;
          }
          emit({ type: 'change', path: source.path, manual: false });
          scheduleReload({ path: source.path, manual: false });
        });
        watcher.on('error', () => {
          // Surface the next reload error rather than crashing the session.
        });
        prepared.push(watcher);
      }

      return {
        paths: normalizePaths(normalizedSources.map(source => source.path)),
        sources: normalizedSources,
        watchers: prepared,
      };
    } catch (error) {
      closePreparedWatchers({
        paths: [],
        sources: [],
        watchers: prepared,
      });
      throw error;
    }
  };

  const commitWatchers = (prepared: PreparedWatchers): void => {
    closeWatchers();
    activeWatchSources = prepared.sources;
    watchers = prepared.watchers;
    emit({ type: 'watchPaths', paths: prepared.paths });
  };

  const refreshActiveWatchers = async (): Promise<void> => {
    if (closed || reloadPromise || activeWatchSources.length === 0) {
      return;
    }

    let prepared: PreparedWatchers | null = null;
    try {
      prepared = await prepareWatchers(activeWatchSources, ignoredPaths);
      if (closed || reloadPromise) {
        closePreparedWatchers(prepared);
        return;
      }
      commitWatchers(prepared);
    } catch {
      closePreparedWatchers(prepared);
    }
  };

  const queueWatcherRefresh = async (): Promise<void> => {
    watcherRefreshPromise = watcherRefreshPromise.then(
      () => refreshActiveWatchers(),
      () => refreshActiveWatchers()
    );
    return watcherRefreshPromise;
  };

  const runReload = async (trigger: { path?: string; manual: boolean }): Promise<boolean> => {
    if (closed) {
      return false;
    }

    emit({ type: 'reload-start', path: trigger.path, manual: trigger.manual });

    let stage: StageResult | null = null;
    let nextBridge: T | null = null;
    let preparedWatchers: PreparedWatchers | null = null;

    const abortReload = async (
      managerToDispose: ManagedBridgeReloader<T> | null = null
    ): Promise<boolean> => {
      if (preparedWatchers) {
        closePreparedWatchers(preparedWatchers);
        preparedWatchers = null;
      }
      if (nextBridge) {
        await nextBridge.dispose().catch(() => {});
        nextBridge = null;
      }
      if (managerToDispose) {
        await managerToDispose.dispose().catch(() => {});
      }
      return false;
    };

    try {
      stage = await generateToStage(configFile);
      if (closed) {
        return abortReload();
      }
      currentBridgeConfig = stage.config;
      const nextIgnoredPaths = buildIgnoredPaths(stage.outputDir);
      const extraWatchSources = await resolveExtraWatchSources(extraWatchPaths);
      const watchSources = normalizeWatchSources([
        { path: configFile, kind: 'file' },
        ...stage.watchSources,
        ...extraWatchSources,
      ]);
      const watchPaths = normalizePaths(watchSources.map(source => source.path));
      preparedWatchers = await prepareWatchers(watchSources, nextIgnoredPaths);
      if (closed) {
        return abortReload();
      }

      if (bridgeManager) {
        nextBridge = await bridgeManager.prepareNextBridge();
        if (closed) {
          return abortReload();
        }
      }

      const previousManagedFiles =
        activeOutputDir === stage.outputDir
          ? managedFiles
          : await listExistingManagedFiles(stage.outputDir);
      const promotedManagedFiles = await promoteManagedFiles(
        stage.outputDir,
        stage.files,
        previousManagedFiles
      );
      if (closed) {
        return abortReload();
      }

      if (bridgeManager && nextBridge) {
        await bridgeManager.activatePreparedBridge(nextBridge);
        nextBridge = null;
        if (closed) {
          return abortReload();
        }
      } else if (!bridgeManager) {
        const createdBridgeManager = await ManagedBridgeReloader.create(createBridgeForSession);
        if (closed) {
          return abortReload(createdBridgeManager);
        }
        bridgeManager = createdBridgeManager;
      }

      managedFiles = promotedManagedFiles;
      activeOutputDir = stage.outputDir;
      ignoredPaths = nextIgnoredPaths;
      commitWatchers(preparedWatchers);
      emit({
        type: 'reload-success',
        path: trigger.path,
        manual: trigger.manual,
        paths: watchPaths,
        written: [...stage.files.keys()].sort(),
        warnings: stage.warnings,
      });
      lastReloadError = null;
      return true;
    } catch (error) {
      lastReloadError = error instanceof Error ? error : new Error(String(error));
      if (preparedWatchers) {
        closePreparedWatchers(preparedWatchers);
      }
      if (nextBridge) {
        await nextBridge.dispose().catch(() => {});
      }
      emit({
        type: 'reload-error',
        path: trigger.path,
        manual: trigger.manual,
        error: lastReloadError,
      });
      return false;
    } finally {
      if (stage) {
        await rm(stage.tempDir, { recursive: true, force: true });
      }
    }
  };

  const flushReloadQueue = async (): Promise<boolean> => {
    const trigger = queuedTrigger ?? { manual: true };
    queuedTrigger = null;
    const success = await runReload(trigger);
    if (queuedTrigger) {
      return flushReloadQueue();
    }
    return success;
  };

  const enqueueReload = async (trigger: { path?: string; manual: boolean }): Promise<boolean> => {
    queuedTrigger = trigger;

    if (!reloadPromise) {
      reloadPromise = flushReloadQueue().finally(() => {
        reloadPromise = null;
      });
    }

    return reloadPromise;
  };

  const scheduleReload = (trigger: { path?: string; manual: boolean }): void => {
    if (closed) {
      return;
    }

    queuedTrigger = trigger;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      enqueueReload(trigger).catch(() => {
        // Reload errors are emitted via the session event hook.
      });
    }, debounceMs);
  };

  const initialSuccess = await enqueueReload({ manual: true });
  if (!initialSuccess) {
    closeWatchers();
    const disposeBridgeManager = async (
      manager: ManagedBridgeReloader<T> | null
    ): Promise<void> => {
      if (manager) {
        await manager.dispose();
      }
    };
    await disposeBridgeManager(bridgeManager);
    throw lastReloadError ?? new Error('Initial watch session setup failed');
  }

  return {
    async reloadNow(): Promise<boolean> {
      if (closed) {
        return false;
      }
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = undefined;
      }
      return enqueueReload({ manual: true });
    },
    async close(): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = undefined;
      }
      closeWatchers();
      await bridgeManager?.dispose();
    },
  };
}
