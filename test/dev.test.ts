import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { createConfig, resolveConfig } from '../src/config/index.js';
import {
  createBridgeReloader,
  startNodeWatchSession,
  type NodeWatchSession,
  type NodeWatchEvent,
} from '../src/dev.js';
import { NodeBridge } from '../src/runtime/node.js';
import { clearRuntimeBridge, getRuntimeBridge } from '../src/runtime/index.js';
import type { RuntimeExecution } from '../src/types/index.js';
import { getDefaultPythonPath } from '../src/utils/python.js';
import { isNodejs } from '../src/utils/runtime.js';

const execFileAsync = promisify(execFile);
const LEGACY_DEVELOPMENT_MESSAGE =
  'Legacy config field "development" is no longer supported. Use createBridgeReloader() or startNodeWatchSession() from "tywrap/dev" instead.';
const LEGACY_MODULE_WATCH_MESSAGE =
  'Legacy config field "pythonModules.<module>.watch" is no longer supported. Use startNodeWatchSession() from "tywrap/dev" instead.';

const describeNodeOnly = isNodejs() ? describe : describe.skip;

class FakeBridge implements RuntimeExecution {
  disposed = false;

  constructor(readonly label: unknown) {}

  async call<T = unknown>(): Promise<T> {
    return this.label as T;
  }

  async instantiate<T = unknown>(): Promise<T> {
    return `${String(this.label)}-handle` as T;
  }

  async callMethod<T = unknown>(): Promise<T> {
    return this.label as T;
  }

  async disposeInstance(): Promise<void> {}

  async dispose(): Promise<void> {
    this.disposed = true;
  }
}

class SnapshotPythonBridge implements RuntimeExecution {
  private readonly source: string;

  constructor(
    private readonly modulePath: string,
    private readonly pythonPath: string
  ) {
    this.source = readFileSync(modulePath, 'utf-8');
  }

  async call<T = unknown>(
    _module: string,
    functionName: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T> {
    const argsJson = JSON.stringify(args ?? []);
    const kwargsJson = JSON.stringify(kwargs ?? {});
    const script = [
      'import json',
      'namespace = {}',
      `source = ${JSON.stringify(this.source)}`,
      'exec(source, namespace)',
      `args = json.loads(${JSON.stringify(argsJson)})`,
      `kwargs = json.loads(${JSON.stringify(kwargsJson)})`,
      `result = namespace[${JSON.stringify(functionName)}](*args, **kwargs)`,
      'print(json.dumps(result))',
    ].join('\n');
    const result = await execFileAsync(this.pythonPath, ['-c', script]);
    return JSON.parse(result.stdout) as T;
  }

  async instantiate<T = unknown>(): Promise<T> {
    throw new Error('instantiate() is not supported in this test bridge');
  }

  async callMethod<T = unknown>(): Promise<T> {
    throw new Error('callMethod() is not supported in this test bridge');
  }

  async disposeInstance(): Promise<void> {}

  async dispose(): Promise<void> {}
}

async function delay(ms: number): Promise<void> {
  await new Promise(resolvePromise => setTimeout(resolvePromise, ms));
}

async function waitFor<T>(predicate: () => T | undefined, timeoutMs = 10000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = predicate();
    if (value !== undefined) {
      return value;
    }
    await delay(25);
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

async function writePythonModule(packageDir: string, body: string): Promise<void> {
  await rm(join(packageDir, '__pycache__'), { recursive: true, force: true });
  await writeFile(join(packageDir, '__init__.py'), body, 'utf-8');
}

async function writeNestedWatchPackage(
  packageDir: string,
  value: number,
  options: { useDeeperModule?: boolean } = {}
): Promise<void> {
  const nestedDir = join(packageDir, 'nested');
  const deeperDir = join(nestedDir, 'deeper');

  await rm(join(packageDir, '__pycache__'), { recursive: true, force: true });
  await rm(join(nestedDir, '__pycache__'), { recursive: true, force: true });
  await rm(join(deeperDir, '__pycache__'), { recursive: true, force: true });

  await mkdir(nestedDir, { recursive: true });
  await writeFile(join(nestedDir, '__init__.py'), '', 'utf-8');

  if (options.useDeeperModule) {
    await mkdir(deeperDir, { recursive: true });
    await writeFile(join(deeperDir, '__init__.py'), '', 'utf-8');
    await writeFile(
      join(deeperDir, 'value.py'),
      [`def answer() -> int:`, `    return ${value}`, ''].join('\n'),
      'utf-8'
    );
    await writeFile(join(nestedDir, 'value.py'), `from .deeper.value import answer\n`, 'utf-8');
  } else {
    await rm(deeperDir, { recursive: true, force: true });
    await writeFile(
      join(nestedDir, 'value.py'),
      [`def answer() -> int:`, `    return ${value}`, ''].join('\n'),
      'utf-8'
    );
  }

  await writeFile(join(packageDir, '__init__.py'), `from .nested.value import answer\n`, 'utf-8');
}

async function writeNamespacePackageRoot(
  rootDir: string,
  packageName: string,
  options: { answer?: number; pluginValue?: string } = {}
): Promise<string> {
  const packageDir = join(rootDir, packageName);
  await mkdir(packageDir, { recursive: true });
  await writeFile(
    join(packageDir, '__init__.py'),
    [
      'from pkgutil import extend_path',
      '__path__ = extend_path(__path__, __name__)',
      ...(options.answer === undefined
        ? []
        : [`def answer() -> int:`, `    return ${options.answer}`]),
      '',
    ].join('\n'),
    'utf-8'
  );

  if (options.pluginValue !== undefined) {
    await writeFile(
      join(packageDir, 'plugin.py'),
      `VALUE = ${JSON.stringify(options.pluginValue)}\n`
    );
  }

  return packageDir;
}

afterEach(() => {
  clearRuntimeBridge();
});

describe('Config migration errors', () => {
  it('rejects the legacy development block with an explicit migration error', () => {
    expect(() =>
      createConfig({
        pythonModules: {},
        output: { dir: './generated', format: 'esm', declaration: false, sourceMap: false },
        runtime: { node: { pythonPath: 'python3' } },
        performance: { caching: false, batching: false, compression: 'none' },
        development: {
          hotReload: true,
          sourceMap: false,
          validation: 'runtime',
        },
      } as never)
    ).toThrow(LEGACY_DEVELOPMENT_MESSAGE);
  });

  it('rejects pythonModules.<module>.watch during config resolution', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'tywrap-dev-config-'));
    const configPath = join(tempDir, 'tywrap.config.json');
    await writeFile(
      configPath,
      JSON.stringify(
        {
          pythonModules: {
            local_mod: {
              runtime: 'node',
              typeHints: 'strict',
              watch: true,
            },
          },
          output: { dir: './generated', format: 'esm', declaration: false, sourceMap: false },
          runtime: { node: { pythonPath: 'python3' } },
          performance: { caching: false, batching: false, compression: 'none' },
        },
        null,
        2
      ),
      'utf-8'
    );

    try {
      await expect(resolveConfig({ configFile: configPath, requireConfig: true })).rejects.toThrow(
        LEGACY_MODULE_WATCH_MESSAGE
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe('createBridgeReloader', () => {
  it('sets the global bridge on creation and reload, and existing wrapper-style calls observe the swap', async () => {
    let nextBridgeId = 1;
    const createdBridges: FakeBridge[] = [];

    const reloader = await createBridgeReloader(async () => {
      const bridge = new FakeBridge(`bridge-${nextBridgeId++}`);
      createdBridges.push(bridge);
      return bridge;
    });

    const callThroughRegistry = async (): Promise<string> =>
      getRuntimeBridge().call<string>('demo', 'value', []);

    expect(await callThroughRegistry()).toBe('bridge-1');
    expect(reloader.current()).toBe(createdBridges[0]);

    const reloadedBridge = await reloader.reload();
    expect(reloadedBridge).toBe(createdBridges[1]);
    expect(createdBridges[0]?.disposed).toBe(true);
    expect(getRuntimeBridge()).toBe(reloadedBridge);
    expect(await callThroughRegistry()).toBe('bridge-2');

    await reloader.dispose();
    expect(createdBridges[1]?.disposed).toBe(true);
    expect(() => getRuntimeBridge()).toThrow('No runtime bridge configured');
  });
});

describeNodeOnly('startNodeWatchSession', () => {
  it('watches local modules, ignores output writes, reloads on success, and preserves the last good bridge on failure', async () => {
    const tempDir = await mkdtemp(join(process.cwd(), '.tmp-tywrap-dev-watch-'));
    const packageDir = join(tempDir, 'watchpkg');
    const outputDir = join(tempDir, 'generated');
    const configPath = join(tempDir, 'tywrap.config.json');
    const events: NodeWatchEvent[] = [];
    const pythonPath = getDefaultPythonPath();
    const createBridge = async (_config: unknown) => {
      return new SnapshotPythonBridge(join(packageDir, '__init__.py'), pythonPath);
    };

    await mkdir(packageDir, { recursive: true });
    await writePythonModule(packageDir, ['def answer() -> int:', '    return 1', ''].join('\n'));
    await mkdir(join(outputDir, 'nested'), { recursive: true });
    await writeFile(join(outputDir, 'nested', 'stale.generated.ts'), '// stale output\n', 'utf-8');
    await writeFile(
      configPath,
      JSON.stringify(
        {
          pythonModules: {
            watchpkg: { runtime: 'node', typeHints: 'strict' },
          },
          pythonImportPath: [tempDir],
          output: { dir: outputDir, format: 'esm', declaration: false, sourceMap: false },
          runtime: { node: { pythonPath } },
          performance: { caching: false, batching: false, compression: 'none' },
        },
        null,
        2
      ),
      'utf-8'
    );

    let session: NodeWatchSession | undefined;
    try {
      session = await startNodeWatchSession({
        configFile: configPath,
        createBridge,
        extraWatchPaths: [tempDir],
        debounceMs: 75,
        onEvent: event => {
          events.push(event);
        },
      });

      const watchPathsEvent = await waitFor(
        () =>
          events.find(
            (event): event is Extract<NodeWatchEvent, { type: 'watchPaths' }> =>
              event.type === 'watchPaths'
          ),
        5000
      );
      expect(watchPathsEvent.paths).toEqual([configPath, packageDir, tempDir].sort());

      const generatedModule = (await import(
        pathToFileURL(join(outputDir, 'watchpkg.generated.ts')).href
      )) as {
        answer: () => Promise<number>;
      };

      expect(existsSync(join(outputDir, 'nested', 'stale.generated.ts'))).toBe(false);
      expect(await generatedModule.answer()).toBe(1);

      const reloadStartsBeforeIgnoredWrite = events.filter(
        event => event.type === 'reload-start'
      ).length;
      await writeFile(join(outputDir, 'ignored.txt'), 'ignore me', 'utf-8');
      await delay(300);
      expect(events.filter(event => event.type === 'reload-start').length).toBe(
        reloadStartsBeforeIgnoredWrite
      );

      await delay(1100);
      const reloadSuccessesBeforeUpdate = events.filter(
        (event): event is Extract<NodeWatchEvent, { type: 'reload-success' }> =>
          event.type === 'reload-success'
      ).length;
      await writePythonModule(packageDir, ['def answer() -> int:', '    return 2', ''].join('\n'));
      await waitFor(
        () =>
          events.filter(
            (event): event is Extract<NodeWatchEvent, { type: 'reload-success' }> =>
              event.type === 'reload-success'
          ).length > reloadSuccessesBeforeUpdate
            ? true
            : undefined,
        10000
      );
      expect(await generatedModule.answer()).toBe(2);

      await delay(1100);
      const reloadErrorsBeforeUpdate = events.filter(
        (event): event is Extract<NodeWatchEvent, { type: 'reload-error' }> =>
          event.type === 'reload-error'
      ).length;
      await writePythonModule(packageDir, ['def answer() -> int', '    return 99', ''].join('\n'));
      await waitFor(
        () =>
          events.filter(
            (event): event is Extract<NodeWatchEvent, { type: 'reload-error' }> =>
              event.type === 'reload-error'
          ).length > reloadErrorsBeforeUpdate
            ? true
            : undefined,
        10000
      );
      const latestReloadError = [...events]
        .reverse()
        .find(
          (event): event is Extract<NodeWatchEvent, { type: 'reload-error' }> =>
            event.type === 'reload-error'
        );
      expect(latestReloadError?.error.message).toContain('Generation failed for 1 module');
      expect(await generatedModule.answer()).toBe(2);

      await delay(1100);
      await writePythonModule(packageDir, ['def answer() -> int:', '    return 3', ''].join('\n'));
      await expect(session.reloadNow()).resolves.toBe(true);
      expect(await generatedModule.answer()).toBe(3);
    } finally {
      await session?.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 30000);

  it('passes the latest resolved config into createBridge on manual reloads', async () => {
    const tempDir = await mkdtemp(join(process.cwd(), '.tmp-tywrap-dev-config-bridge-'));
    const packageDir = join(tempDir, 'configpkg');
    const outputDir = join(tempDir, 'generated');
    const configPath = join(tempDir, 'tywrap.config.json');
    const seenTimeouts: number[] = [];

    const writeConfig = async (timeout: number): Promise<void> => {
      await writeFile(
        configPath,
        JSON.stringify(
          {
            pythonModules: {
              configpkg: { runtime: 'node', typeHints: 'strict' },
            },
            pythonImportPath: [tempDir],
            output: { dir: outputDir, format: 'esm', declaration: false, sourceMap: false },
            runtime: { node: { pythonPath: getDefaultPythonPath(), timeout } },
            performance: { caching: false, batching: false, compression: 'none' },
          },
          null,
          2
        ),
        'utf-8'
      );
    };

    await mkdir(packageDir, { recursive: true });
    await writePythonModule(packageDir, ['def answer() -> int:', '    return 0', ''].join('\n'));
    await writeConfig(30000);

    let session: NodeWatchSession | undefined;
    try {
      session = await startNodeWatchSession({
        configFile: configPath,
        debounceMs: 1000,
        createBridge: async config => {
          const timeout = config.runtime.node?.timeout ?? -1;
          seenTimeouts.push(timeout);
          return new FakeBridge(timeout);
        },
      });

      const generatedModule = (await import(
        pathToFileURL(join(outputDir, 'configpkg.generated.ts')).href
      )) as {
        answer: () => Promise<number>;
      };

      expect(await generatedModule.answer()).toBe(30000);
      expect(seenTimeouts).toEqual([30000]);

      await writeConfig(12345);
      await delay(100);
      await expect(session.reloadNow()).resolves.toBe(true);

      expect(await generatedModule.answer()).toBe(12345);
      expect(seenTimeouts).toEqual([30000, 12345]);
    } finally {
      await session?.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('reloads on nested package changes, refreshes new subdirectories, and ignores Python cache churn', async () => {
    const tempDir = await mkdtemp(join(process.cwd(), '.tmp-tywrap-dev-tree-watch-'));
    const packageDir = join(tempDir, 'treepkg');
    const outputDir = join(tempDir, 'generated');
    const configPath = join(tempDir, 'tywrap.config.json');
    const events: NodeWatchEvent[] = [];
    const pythonPath = getDefaultPythonPath();

    await mkdir(packageDir, { recursive: true });
    await writeNestedWatchPackage(packageDir, 1);
    await writeFile(
      configPath,
      JSON.stringify(
        {
          pythonModules: {
            treepkg: { runtime: 'node', typeHints: 'strict' },
          },
          pythonImportPath: [tempDir],
          output: { dir: outputDir, format: 'esm', declaration: false, sourceMap: false },
          runtime: { node: { pythonPath, timeout: 30000 } },
          performance: { caching: false, batching: false, compression: 'none' },
        },
        null,
        2
      ),
      'utf-8'
    );

    let session: NodeWatchSession | undefined;
    try {
      session = await startNodeWatchSession({
        configFile: configPath,
        debounceMs: 75,
        onEvent: event => {
          events.push(event);
        },
        createBridge: async config =>
          new NodeBridge({
            pythonPath: config.runtime.node?.pythonPath ?? pythonPath,
            cwd: tempDir,
            timeoutMs: config.runtime.node?.timeout ?? 30000,
          }),
      });

      const generatedModule = (await import(
        pathToFileURL(join(outputDir, 'treepkg.generated.ts')).href
      )) as {
        answer: () => Promise<number>;
      };

      expect(await generatedModule.answer()).toBe(1);

      await delay(250);
      const reloadStartsBeforeCacheWrite = events.filter(
        event => event.type === 'reload-start'
      ).length;
      await mkdir(join(packageDir, '__pycache__'), { recursive: true });
      await writeFile(join(packageDir, '__pycache__', 'ignored.pyc'), 'ignore me', 'utf-8');
      await delay(300);
      expect(events.filter(event => event.type === 'reload-start').length).toBe(
        reloadStartsBeforeCacheWrite
      );

      await delay(1100);
      const reloadSuccessesBeforeNestedUpdate = events.filter(
        (event): event is Extract<NodeWatchEvent, { type: 'reload-success' }> =>
          event.type === 'reload-success'
      ).length;
      await writeNestedWatchPackage(packageDir, 2, { useDeeperModule: true });
      await waitFor(
        () =>
          events.filter(
            (event): event is Extract<NodeWatchEvent, { type: 'reload-success' }> =>
              event.type === 'reload-success'
          ).length > reloadSuccessesBeforeNestedUpdate
            ? true
            : undefined,
        10000
      );
      expect(await generatedModule.answer()).toBe(2);

      await delay(1100);
      const reloadSuccessesBeforeDeeperUpdate = events.filter(
        (event): event is Extract<NodeWatchEvent, { type: 'reload-success' }> =>
          event.type === 'reload-success'
      ).length;
      await writeFile(
        join(packageDir, 'nested', 'deeper', 'value.py'),
        ['def answer() -> int:', '    return 3', ''].join('\n'),
        'utf-8'
      );
      await waitFor(
        () =>
          events.filter(
            (event): event is Extract<NodeWatchEvent, { type: 'reload-success' }> =>
              event.type === 'reload-success'
          ).length > reloadSuccessesBeforeDeeperUpdate
            ? true
            : undefined,
        10000
      );
      expect(await generatedModule.answer()).toBe(3);
    } finally {
      await session?.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 30000);

  it('watches every discovered package root for namespace-style packages', async () => {
    const tempDir = await mkdtemp(join(process.cwd(), '.tmp-tywrap-dev-namespace-watch-'));
    const rootA = join(tempDir, 'root-a');
    const rootB = join(tempDir, 'root-b');
    const packageName = 'namespacepkg';
    const outputDir = join(tempDir, 'generated');
    const configPath = join(tempDir, 'tywrap.config.json');
    const events: NodeWatchEvent[] = [];

    const packageDirA = await writeNamespacePackageRoot(rootA, packageName, { answer: 1 });
    const packageDirB = await writeNamespacePackageRoot(rootB, packageName, {
      pluginValue: 'initial',
    });

    await writeFile(
      configPath,
      JSON.stringify(
        {
          pythonModules: {
            [packageName]: { runtime: 'node', typeHints: 'strict' },
          },
          pythonImportPath: [rootA, rootB],
          output: { dir: outputDir, format: 'esm', declaration: false, sourceMap: false },
          runtime: { node: { pythonPath: getDefaultPythonPath() } },
          performance: { caching: false, batching: false, compression: 'none' },
        },
        null,
        2
      ),
      'utf-8'
    );

    let session: NodeWatchSession | undefined;
    try {
      session = await startNodeWatchSession({
        configFile: configPath,
        debounceMs: 75,
        onEvent: event => {
          events.push(event);
        },
        createBridge: async _config => new FakeBridge('namespace'),
      });

      const watchPathsEvent = await waitFor(
        () =>
          events.find(
            (event): event is Extract<NodeWatchEvent, { type: 'watchPaths' }> =>
              event.type === 'watchPaths'
          ),
        5000
      );

      expect(watchPathsEvent.paths).toEqual([configPath, packageDirA, packageDirB].sort());

      const reloadSuccessesBeforeUpdate = events.filter(
        (event): event is Extract<NodeWatchEvent, { type: 'reload-success' }> =>
          event.type === 'reload-success'
      ).length;
      await writeFile(join(packageDirB, 'plugin.py'), `VALUE = "updated"\n`, 'utf-8');
      await waitFor(
        () =>
          events.filter(
            (event): event is Extract<NodeWatchEvent, { type: 'reload-success' }> =>
              event.type === 'reload-success'
          ).length > reloadSuccessesBeforeUpdate
            ? true
            : undefined,
        10000
      );
    } finally {
      await session?.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 30000);

  it('does not reinstall watchers or a bridge after close wins a reload race', async () => {
    const tempDir = await mkdtemp(join(process.cwd(), '.tmp-tywrap-dev-close-race-'));
    const packageDir = join(tempDir, 'racepkg');
    const outputDir = join(tempDir, 'generated');
    const configPath = join(tempDir, 'tywrap.config.json');
    const events: NodeWatchEvent[] = [];
    let bridgeCreates = 0;
    let releaseReloadBridge: (() => void) | null = null;
    let signalReloadBridgeStarted!: () => void;
    const reloadBridgeStarted = new Promise<void>(resolve => {
      signalReloadBridgeStarted = resolve;
    });

    await mkdir(packageDir, { recursive: true });
    await writePythonModule(packageDir, ['def answer() -> int:', '    return 1', ''].join('\n'));
    await writeFile(
      configPath,
      JSON.stringify(
        {
          pythonModules: {
            racepkg: { runtime: 'node', typeHints: 'strict' },
          },
          pythonImportPath: [tempDir],
          output: { dir: outputDir, format: 'esm', declaration: false, sourceMap: false },
          runtime: { node: { pythonPath: getDefaultPythonPath(), timeout: 30000 } },
          performance: { caching: false, batching: false, compression: 'none' },
        },
        null,
        2
      ),
      'utf-8'
    );

    let session: NodeWatchSession | undefined;
    try {
      session = await startNodeWatchSession({
        configFile: configPath,
        debounceMs: 75,
        onEvent: event => {
          events.push(event);
        },
        createBridge: async _config => {
          bridgeCreates += 1;
          if (bridgeCreates === 1) {
            return new FakeBridge('initial');
          }

          signalReloadBridgeStarted();
          await new Promise<void>(resolve => {
            releaseReloadBridge = resolve;
          });
          return new FakeBridge('reloaded');
        },
      });

      await waitFor(
        () =>
          events.find(
            (event): event is Extract<NodeWatchEvent, { type: 'watchPaths' }> =>
              event.type === 'watchPaths'
          ),
        5000
      );
      const watchPathEventsBeforeReload = events.filter(
        event => event.type === 'watchPaths'
      ).length;

      const reloadPromise = session.reloadNow();
      await reloadBridgeStarted;
      const closePromise = session.close();
      releaseReloadBridge?.();

      await expect(reloadPromise).resolves.toBe(false);
      await closePromise;
      await delay(100);

      expect(events.filter(event => event.type === 'watchPaths').length).toBe(
        watchPathEventsBeforeReload
      );
      expect(() => getRuntimeBridge()).toThrow('No runtime bridge configured');
    } finally {
      releaseReloadBridge?.();
      await session?.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 30000);

  it('fails fast for modules that are not local Python source files or package directories', async () => {
    const tempDir = await mkdtemp(join(process.cwd(), '.tmp-tywrap-dev-nonlocal-'));
    const configPath = join(tempDir, 'tywrap.config.json');
    let createBridgeCalls = 0;

    await writeFile(
      configPath,
      JSON.stringify(
        {
          pythonModules: {
            math: { runtime: 'node', typeHints: 'strict' },
          },
          output: {
            dir: join(tempDir, 'generated'),
            format: 'esm',
            declaration: false,
            sourceMap: false,
          },
          runtime: { node: { pythonPath: getDefaultPythonPath() } },
          performance: { caching: false, batching: false, compression: 'none' },
        },
        null,
        2
      ),
      'utf-8'
    );

    try {
      await expect(
        startNodeWatchSession({
          configFile: configPath,
          createBridge: async _config => {
            createBridgeCalls += 1;
            return new FakeBridge('unused');
          },
        })
      ).rejects.toThrow(
        'Module "math" is not backed by a local Python source file or package directory and cannot be watched'
      );
      expect(createBridgeCalls).toBe(0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
