/**
 * End-to-end smoke for the `tywrap/dev` watch + reload story.
 *
 * These exercise the public {@link startNodeWatchSession} contract documented in
 * docs/guide/dev-reload.md:
 *
 *   1. A change to a watched source triggers wrapper regeneration.
 *   2. The active runtime bridge is swapped in place — no process restart.
 *   3. A failed reload keeps the last-known-good output/bridge live and surfaces
 *      a structured failure (the `reload-error` event).
 *
 * The first two scenarios are fully hermetic: they configure an empty
 * `pythonModules` map so `startNodeWatchSession` never spawns a Python
 * interpreter (no IR extraction, no watch-target resolution), and drive change
 * detection through `extraWatchPaths`. They run on Node without `tywrap_ir`.
 *
 * The final scenario reaches the genuine `GenerateFailure` code path (which can
 * only be produced by the real IR extractor) and is gated with
 * `it.skipIf(!PYTHON_AVAILABLE)` so it SKIPS loudly when no interpreter is
 * present rather than failing locally.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  startNodeWatchSession,
  type NodeWatchEvent,
  type NodeWatchSession,
} from '../src/dev.js';
import { clearRuntimeBridge, getRuntimeBridge } from '../src/runtime/index.js';
import type { RuntimeExecution } from '../src/types/index.js';
import { getDefaultPythonPath } from '../src/utils/python.js';
import { isNodejs } from '../src/utils/runtime.js';
import { PYTHON, PYTHON_AVAILABLE } from './helpers/python-probe.js';

const describeNodeOnly = isNodejs() ? describe : describe.skip;

/**
 * Minimal bridge that records whether it was disposed and reports its label
 * through `call()` so a test can observe which generation is active in the
 * global registry. Satisfies `RuntimeExecution & Disposable`.
 */
class LabeledBridge implements RuntimeExecution {
  disposed = false;

  constructor(readonly label: string) {}

  async call<T = unknown>(): Promise<T> {
    return this.label as T;
  }

  async instantiate<T = unknown>(): Promise<T> {
    return `${this.label}-handle` as T;
  }

  async callMethod<T = unknown>(): Promise<T> {
    return this.label as T;
  }

  async disposeInstance(): Promise<void> {}

  async dispose(): Promise<void> {
    this.disposed = true;
  }
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

function countEvents(events: NodeWatchEvent[], type: NodeWatchEvent['type']): number {
  return events.filter(event => event.type === type).length;
}

/**
 * Write a config with no `pythonModules`. With an empty module map the watch
 * session resolves zero watch targets, so it never invokes the Python
 * interpreter — making the session hermetic.
 */
async function writeHermeticConfig(configPath: string, outputDir: string): Promise<void> {
  await writeFile(
    configPath,
    JSON.stringify(
      {
        pythonModules: {},
        output: { dir: outputDir, format: 'esm', declaration: false, sourceMap: false },
        runtime: { node: { pythonPath: getDefaultPythonPath() } },
        performance: { caching: false, batching: false, compression: 'none' },
      },
      null,
      2
    ),
    'utf-8'
  );
}

afterEach(() => {
  clearRuntimeBridge();
});

describeNodeOnly('dev watch/reload smoke', () => {
  it('regenerates and swaps the active bridge in place when a watched source changes', async () => {
    const tempDir = await mkdtemp(join(process.cwd(), '.tmp-tywrap-dev-smoke-'));
    const outputDir = join(tempDir, 'generated');
    const configPath = join(tempDir, 'tywrap.config.json');
    const watchedSource = join(tempDir, 'watched-source.txt');
    const events: NodeWatchEvent[] = [];
    const createdBridges: LabeledBridge[] = [];
    let nextBridgeId = 0;

    await writeHermeticConfig(configPath, outputDir);
    await writeFile(watchedSource, 'generation-0\n', 'utf-8');

    let session: NodeWatchSession | undefined;
    try {
      session = await startNodeWatchSession({
        configFile: configPath,
        extraWatchPaths: [watchedSource],
        debounceMs: 50,
        onEvent: event => {
          events.push(event);
        },
        createBridge: async _config => {
          const bridge = new LabeledBridge(`bridge-${nextBridgeId++}`);
          createdBridges.push(bridge);
          return bridge;
        },
      });

      // The session is up: the first bridge is live in the global registry and
      // the watcher reported the paths it is observing.
      const watchPathsEvent = await waitFor(
        () =>
          events.find(
            (event): event is Extract<NodeWatchEvent, { type: 'watchPaths' }> =>
              event.type === 'watchPaths'
          ),
        5000
      );
      expect(watchPathsEvent.paths).toContain(configPath);
      expect(watchPathsEvent.paths).toContain(watchedSource);

      const firstBridge = createdBridges[0];
      expect(firstBridge).toBeDefined();
      expect(await getRuntimeBridge().call<string>()).toBe('bridge-0');

      // Changing a watched source triggers a regeneration cycle.
      const reloadSuccessesBefore = countEvents(events, 'reload-success');
      await delay(60);
      await writeFile(watchedSource, 'generation-1\n', 'utf-8');

      await waitFor(
        () => (countEvents(events, 'reload-success') > reloadSuccessesBefore ? true : undefined),
        10000
      );

      // The reload produced a fresh bridge and made it the active one WITHOUT a
      // process restart: the registry now resolves the new bridge and the
      // previous one was disposed.
      expect(createdBridges.length).toBe(2);
      const secondBridge = createdBridges[1];
      expect(secondBridge).toBeDefined();
      expect(secondBridge).not.toBe(firstBridge);
      expect(await getRuntimeBridge().call<string>()).toBe('bridge-1');
      expect(firstBridge?.disposed).toBe(true);
      expect(secondBridge?.disposed).toBe(false);

      // A change event was observed for the edited source.
      const changeEvent = [...events]
        .reverse()
        .find(
          (event): event is Extract<NodeWatchEvent, { type: 'change' }> => event.type === 'change'
        );
      expect(changeEvent?.path).toBe(watchedSource);
    } finally {
      await session?.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 30000);

  it('keeps the last-known-good bridge live and surfaces a structured failure when a reload fails', async () => {
    const tempDir = await mkdtemp(join(process.cwd(), '.tmp-tywrap-dev-smoke-fail-'));
    const outputDir = join(tempDir, 'generated');
    const configPath = join(tempDir, 'tywrap.config.json');
    const events: NodeWatchEvent[] = [];
    const createdBridges: LabeledBridge[] = [];
    let bridgeCreateAttempts = 0;
    const failureMessage = 'simulated bridge construction failure';

    await writeHermeticConfig(configPath, outputDir);

    let session: NodeWatchSession | undefined;
    try {
      session = await startNodeWatchSession({
        configFile: configPath,
        debounceMs: 50,
        onEvent: event => {
          events.push(event);
        },
        createBridge: async _config => {
          bridgeCreateAttempts += 1;
          // First creation succeeds (initial good bridge); subsequent reloads
          // fail, modeling a regeneration cycle that cannot produce a usable
          // bridge.
          if (bridgeCreateAttempts > 1) {
            throw new Error(failureMessage);
          }
          const bridge = new LabeledBridge(`bridge-${createdBridges.length}`);
          createdBridges.push(bridge);
          return bridge;
        },
      });

      const goodBridge = createdBridges[0];
      expect(goodBridge).toBeDefined();
      expect(await getRuntimeBridge().call<string>()).toBe('bridge-0');

      // A manual reload now fails because createBridge throws. The session
      // reports failure (resolves false) rather than crashing.
      const reloadErrorsBefore = countEvents(events, 'reload-error');
      await expect(session.reloadNow()).resolves.toBe(false);

      // A structured reload-error event was emitted carrying the underlying Error.
      await waitFor(
        () => (countEvents(events, 'reload-error') > reloadErrorsBefore ? true : undefined),
        10000
      );
      const reloadError = [...events]
        .reverse()
        .find(
          (event): event is Extract<NodeWatchEvent, { type: 'reload-error' }> =>
            event.type === 'reload-error'
        );
      expect(reloadError).toBeDefined();
      expect(reloadError?.error).toBeInstanceOf(Error);
      expect(reloadError?.error.message).toContain(failureMessage);

      // Last-known-good recovery: the original bridge is still live in the
      // registry and was NOT disposed by the failed reload.
      expect(getRuntimeBridge()).toBe(goodBridge);
      expect(await getRuntimeBridge().call<string>()).toBe('bridge-0');
      expect(goodBridge?.disposed).toBe(false);
      expect(createdBridges.length).toBe(1);
    } finally {
      await session?.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 30000);

  // The genuine GenerateFailure path can only be produced by the real IR
  // extractor, so this scenario needs a Python interpreter. It SKIPS loudly when
  // none is available (e.g. local Node-only runs) rather than failing.
  it.skipIf(!PYTHON_AVAILABLE)(
    'surfaces a GenerateFailure and preserves last-good generated output when a watched module breaks',
    async () => {
      const pythonPath = PYTHON ?? getDefaultPythonPath();
      const tempDir = await mkdtemp(join(process.cwd(), '.tmp-tywrap-dev-smoke-genfail-'));
      const packageDir = join(tempDir, 'smokepkg');
      const outputDir = join(tempDir, 'generated');
      const configPath = join(tempDir, 'tywrap.config.json');
      const generatedFile = join(outputDir, 'smokepkg.generated.ts');
      const events: NodeWatchEvent[] = [];
      const createdBridges: LabeledBridge[] = [];

      const writeModule = async (body: string): Promise<void> => {
        await rm(join(packageDir, '__pycache__'), { recursive: true, force: true });
        await writeFile(join(packageDir, '__init__.py'), body, 'utf-8');
      };

      await mkdir(packageDir, { recursive: true });
      await writeModule(['def answer() -> int:', '    return 1', ''].join('\n'));
      await writeFile(
        configPath,
        JSON.stringify(
          {
            pythonModules: {
              smokepkg: { runtime: 'node', typeHints: 'strict' },
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
          createBridge: async _config => {
            const bridge = new LabeledBridge(`bridge-${createdBridges.length}`);
            createdBridges.push(bridge);
            return bridge;
          },
        });

        // Initial generation succeeded and wrote a wrapper to disk.
        await waitFor(
          () => (countEvents(events, 'reload-success') > 0 ? true : undefined),
          10000
        );
        expect(existsSync(generatedFile)).toBe(true);
        const lastGoodOutput = readFileSync(generatedFile, 'utf-8');
        expect(getRuntimeBridge()).toBe(createdBridges[0]);

        // Break the module so the IR extractor cannot produce IR -> GenerateFailure.
        await delay(1100);
        const reloadErrorsBefore = countEvents(events, 'reload-error');
        await writeModule(['def answer() -> int', '    return 2', ''].join('\n'));

        await waitFor(
          () => (countEvents(events, 'reload-error') > reloadErrorsBefore ? true : undefined),
          15000
        );
        const reloadError = [...events]
          .reverse()
          .find(
            (event): event is Extract<NodeWatchEvent, { type: 'reload-error' }> =>
              event.type === 'reload-error'
          );
        expect(reloadError?.error.message).toContain('Generation failed');

        // Last-known-good recovery: the previously generated output is untouched
        // and the original bridge is still active.
        expect(existsSync(generatedFile)).toBe(true);
        expect(readFileSync(generatedFile, 'utf-8')).toBe(lastGoodOutput);
        expect(getRuntimeBridge()).toBe(createdBridges[0]);
        expect(createdBridges.length).toBe(1);
      } finally {
        await session?.close();
        await rm(tempDir, { recursive: true, force: true });
      }
    },
    40000
  );
});
