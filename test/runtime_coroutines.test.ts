import { afterEach, describe, expect, it, vi } from 'vitest';
import { delimiter, join } from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { EventEmitter } from 'node:events';
import { NodeBridge } from '../src/runtime/node.js';
import { PyodideTransport } from '../src/runtime/pyodide-transport.js';
import { PooledTransport } from '../src/runtime/pooled-transport.js';
import { SubprocessTransport } from '../src/runtime/subprocess-transport.js';
import { RpcClient } from '../src/runtime/rpc-client.js';
import type { Transport } from '../src/runtime/transport.js';
import { clearRuntimeBridge, setRuntimeBridge } from '../src/runtime/index.js';
import {
  BridgeDisposedError,
  BridgeExecutionError,
  BridgeTimeoutError,
} from '../src/runtime/errors.js';
import { generate } from '../src/tywrap.js';
import { isNodejs } from '../src/utils/runtime.js';
import { PYTHON, PYTHON_AVAILABLE } from './helpers/python-probe.js';

const pythonPath = [
  join(process.cwd(), 'test/menagerie'),
  join(process.cwd(), 'test/fixtures/python'),
].join(delimiter);
const nodeSuite = isNodejs() && PYTHON_AVAILABLE ? describe : describe.skip;

nodeSuite('Coroutine RPC through Node', () => {
  let bridge: NodeBridge | undefined;

  const createBridge = (timeoutMs = 5000): NodeBridge =>
    new NodeBridge({
      scriptPath: 'runtime/python_bridge.py',
      pythonPath: PYTHON ?? undefined,
      timeoutMs,
      env: { PYTHONPATH: pythonPath },
    });

  afterEach(async () => {
    clearRuntimeBridge();
    await bridge?.dispose();
    bridge = undefined;
  });

  it('generates, imports, and executes asyncText', async () => {
    const tempDir = await mkdtemp(join(process.cwd(), '.tmp-coroutine-'));
    try {
      await writeFile(
        join(tempDir, 'coroutine_fixture.py'),
        'async def async_text() -> str:\n    return "awaited"\n',
        'utf8'
      );
      const outputDir = join(tempDir, 'generated');
      const generated = await generate({
        pythonModules: { coroutine_fixture: { runtime: 'node', typeHints: 'strict' } },
        pythonImportPath: [tempDir],
        output: { dir: outputDir, format: 'esm', declaration: false, sourceMap: false },
        runtime: { node: { pythonPath: PYTHON ?? 'python3' } },
        performance: { caching: false, batching: false, compression: 'none' },
      } as never);
      expect(generated.failures).toEqual([]);
      const generatedPath = generated.written.find(path => path.endsWith('.generated.ts'));
      expect(generatedPath).toBeDefined();

      bridge = new NodeBridge({
        scriptPath: 'runtime/python_bridge.py',
        pythonPath: PYTHON ?? undefined,
        env: { PYTHONPATH: [tempDir, pythonPath].join(delimiter) },
      });
      setRuntimeBridge(bridge);
      const mod = (await import(pathToFileURL(generatedPath as string).href)) as {
        asyncText: () => Promise<string>;
      };
      expect(await mod.asyncText()).toBe('awaited');
      expect(await bridge.call<number>('math', 'sqrt', [16])).toBe(4);
    } finally {
      await bridge?.dispose();
      bridge = undefined;
      clearRuntimeBridge();
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 120000);

  it('preserves the Python exception envelope and traceback', async () => {
    bridge = createBridge();
    try {
      await bridge.call('async_module', 'raise_after_await', []);
      throw new Error('Expected the async call to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(BridgeExecutionError);
      expect((error as Error).message).toContain('ValueError: async failure');
      expect((error as BridgeExecutionError).traceback).toContain('raise_after_await');
    }
  });

  it('rejects both generator kinds without starting iteration', async () => {
    bridge = createBridge();
    await expect(bridge.call('async_module', 'sync_generator', [2])).rejects.toThrow(
      'Generator results are not supported'
    );
    await expect(bridge.call('async_module', 'async_generator', [2])).rejects.toThrow(
      'Async generator results are not supported'
    );
    expect(await bridge.call<number>('math', 'sqrt', [9])).toBe(3);
  });

  it('retires a timed-out worker and succeeds on a fresh process', async () => {
    bridge = createBridge(1000);
    const firstPid = await bridge.call<number>('os', 'getpid', []);
    await expect(bridge.call('async_module', 'delayed_value', [2])).rejects.toBeInstanceOf(
      BridgeTimeoutError
    );
    const nextPid = await bridge.call<number>('os', 'getpid', []);
    expect(nextPid).not.toBe(firstPid);
    expect(await bridge.call('async_module', 'delayed_value', [0])).toBe('finished');
  }, 20000);

  it('disposes the process while a coroutine awaits', async () => {
    bridge = createBridge();
    await bridge.call('os', 'getpid', []);
    const pending = bridge.call('async_module', 'delayed_value', [3]);
    const settled = pending.then(
      () => new Error('Expected disposal to reject the call'),
      error => error as Error
    );
    await new Promise(resolve => setTimeout(resolve, 100));
    await bridge.dispose();
    expect(await settled).toBeInstanceOf(BridgeDisposedError);
  }, 10000);
});

nodeSuite('Subprocess retirement boundary', () => {
  it('keeps the process after an abort before send', async () => {
    const transport = new SubprocessTransport({
      bridgeScript: 'runtime/python_bridge.py',
      pythonPath: PYTHON ?? 'python3',
    });
    const pidRequest = (id: number): string =>
      JSON.stringify({
        id,
        protocol: 'tywrap/1',
        method: 'call',
        params: { module: 'os', functionName: 'getpid', args: [], kwargs: {} },
      });
    try {
      const first = JSON.parse(await transport.send(pidRequest(1), 5000)) as { result: number };
      const controller = new AbortController();
      controller.abort();
      await expect(transport.send(pidRequest(2), 5000, controller.signal)).rejects.toBeInstanceOf(
        BridgeTimeoutError
      );
      expect(transport.requiresReplacement).toBe(false);
      const second = JSON.parse(await transport.send(pidRequest(3), 5000)) as { result: number };
      expect(second.result).toBe(first.result);
    } finally {
      await transport.dispose();
    }
  }, 15000);
});

describe('Subprocess partial-write abort', () => {
  it('retires after the first frame, independent of timeout tombstones', async () => {
    const controller = new AbortController();
    const write = vi.fn(() => {
      controller.abort();
      return true;
    });
    const stdin = Object.assign(new EventEmitter(), { write, end: () => undefined });
    const child = Object.assign(new EventEmitter(), {
      stdin,
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      killed: false,
      kill: () => {
        child.killed = true;
        queueMicrotask(() => child.emit('exit', 0, null));
        return true;
      },
    });
    const transport = new SubprocessTransport({ bridgeScript: 'unused', maxLineLength: 64 });
    const internals = transport as unknown as {
      _state: 'ready';
      process: unknown;
      processExited: boolean;
      timedOutRequests: { mark: (id: number) => void };
    };
    internals._state = 'ready';
    internals.processExited = false;
    internals.process = child;
    try {
      await expect(transport.send(request, 1000, controller.signal)).rejects.toBeInstanceOf(
        BridgeTimeoutError
      );
      expect(write).toHaveBeenCalledTimes(1);
      expect(transport.requiresReplacement).toBe(true);

      const baseline = Date.now();
      const clock = vi.spyOn(Date, 'now').mockReturnValue(baseline);
      try {
        for (let id = 0; id < 1001; id += 1) internals.timedOutRequests.mark(id);
        clock.mockReturnValue(baseline + 11 * 60_000);
        internals.timedOutRequests.mark(2000);
        expect(internals.process).toBeNull();
        expect(transport.requiresReplacement).toBe(true);
      } finally {
        clock.mockRestore();
      }
    } finally {
      await transport.dispose();
    }
  });
});

describe('RPC default timeout', () => {
  it('uses the configured default beyond 30 seconds', async () => {
    vi.useFakeTimers();
    const transport: Transport = {
      init: async () => undefined,
      dispose: async () => undefined,
      send: async () =>
        new Promise<string>(resolve => {
          setTimeout(
            () => resolve(JSON.stringify({ id: 1, protocol: 'tywrap/1', result: 'ok' })),
            31_000
          );
        }),
      capabilities: () => ({
        backend: 'subprocess',
        supportsArrow: false,
        supportsBinary: true,
        supportsChunking: false,
        supportsStreaming: false,
        maxFrameBytes: Number.POSITIVE_INFINITY,
      }),
      get isReady() {
        return true;
      },
      get isDisposed() {
        return false;
      },
    };
    const client = new RpcClient({ transport, defaultTimeoutMs: 40_000 });
    try {
      const call = client.sendMessage<string>({ method: 'call', params: {} });
      await vi.advanceTimersByTimeAsync(31_000);
      await expect(call).resolves.toBe('ok');
    } finally {
      await client.dispose();
      vi.useRealTimers();
    }
  });
});

describe('Retired worker leases', () => {
  function createFakePool(onReplacementWorkerReady?: () => Promise<void>) {
    let created = 0;
    const disposals: Array<ReturnType<typeof vi.fn>> = [];
    const pool = new PooledTransport({
      minWorkers: 1,
      maxWorkers: 1,
      onReplacementWorkerReady,
      createTransport: () => {
        const index = created++;
        const dispose = vi.fn(async () => undefined);
        disposals.push(dispose);
        const worker: Transport & { requiresReplacement: boolean } = {
          requiresReplacement: false,
          init: async () => undefined,
          dispose,
          send: async () => {
            if (index === 0) {
              worker.requiresReplacement = true;
              throw new BridgeTimeoutError('Operation timed out');
            }
            return response;
          },
          get isReady() {
            return true;
          },
          capabilities: () => ({
            backend: 'subprocess',
            supportsArrow: false,
            supportsBinary: true,
            supportsChunking: false,
            supportsStreaming: false,
            maxFrameBytes: Number.POSITIVE_INFINITY,
          }),
        };
        return worker;
      },
    });
    return { pool, disposals, count: () => created };
  }

  it('replaces a retired lease before serving the next request', async () => {
    const warmup = vi.fn(async () => undefined);
    const { pool, disposals, count } = createFakePool(warmup);
    try {
      await pool.init();
      await expect(pool.send(request, 100)).rejects.toBeInstanceOf(BridgeTimeoutError);
      await vi.waitFor(() => expect(count()).toBe(2));
      expect(await pool.send(request, 100)).toBe(response);
      expect(warmup).toHaveBeenCalledTimes(1);
      expect(disposals[0]).toHaveBeenCalledTimes(1);
    } finally {
      await pool.dispose();
    }
  });

  it('does not publish a replacement after disposal', async () => {
    const started = deferred<void>();
    const gate = deferred<void>();
    const { pool, disposals } = createFakePool(async () => {
      started.resolve(undefined);
      await gate.promise;
    });
    await pool.init();
    await expect(pool.send(request, 100)).rejects.toBeInstanceOf(BridgeTimeoutError);
    await started.promise;
    await pool.dispose();
    gate.resolve(undefined);
    await vi.waitFor(() => expect(disposals[1]).toHaveBeenCalledTimes(1));
    expect(pool.workerCount).toBe(0);
  });
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const request = JSON.stringify({
  id: 41,
  protocol: 'tywrap/1',
  method: 'call',
  params: { module: 'math', functionName: 'sqrt', args: [4], kwargs: {} },
});
const response = JSON.stringify({ id: 41, protocol: 'tywrap/1', result: 2 });

describe('Pyodide coroutine transport lifecycle', () => {
  let transport: PyodideTransport | undefined;

  afterEach(async () => {
    await transport?.dispose();
    transport = undefined;
    delete (globalThis as { loadPyodide?: unknown }).loadPyodide;
  });

  function installPyodide(result: string | PromiseLike<string>) {
    const destroyTask = vi.fn();
    const destroyDispatch = vi.fn();
    const cancel = vi.fn();
    const dispatch = Object.assign(() => result, { destroy: destroyDispatch });
    const task =
      typeof result === 'string' ? result : Object.assign(result, { destroy: destroyTask });
    const dispatchTask = Object.assign(() => task, { destroy: destroyDispatch });
    const globals = new Map<string, unknown>([
      ['__tywrap_dispatch', typeof result === 'string' ? dispatch : dispatchTask],
      ['__tywrap_cancel', cancel],
    ]);
    const loadPyodide = vi.fn(async () => ({
      runPython: () => undefined,
      runPythonAsync: async () => undefined,
      globals: {
        get: (key: string) => globals.get(key),
        set: (key: string, value: unknown) => globals.set(key, value),
      },
      toPy: (value: unknown) => value,
      loadPackage: async () => undefined,
    }));
    (globalThis as { loadPyodide?: unknown }).loadPyodide = loadPyodide;
    return { cancel, destroyTask, destroyDispatch, loadPyodide };
  }

  it('does not start a pre-aborted call', async () => {
    const mock = installPyodide(response);
    transport = new PyodideTransport();
    const controller = new AbortController();
    controller.abort();
    await expect(transport.send(request, 1000, controller.signal)).rejects.toBeInstanceOf(
      BridgeTimeoutError
    );
    expect(mock.destroyDispatch).not.toHaveBeenCalled();
    expect(mock.cancel).not.toHaveBeenCalled();
  });

  it('cancels on timeout and keeps proxies until the task settles', async () => {
    const pending = deferred<string>();
    const mock = installPyodide(pending.promise);
    transport = new PyodideTransport();
    await expect(transport.send(request, 20)).rejects.toBeInstanceOf(BridgeTimeoutError);
    expect(mock.cancel).toHaveBeenCalledWith(41);
    expect(mock.destroyTask).not.toHaveBeenCalled();
    pending.reject(new Error('CancelledError'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mock.destroyTask).toHaveBeenCalledTimes(1);
    expect(mock.destroyDispatch).toHaveBeenCalledTimes(1);
  });

  it('cancels only the aborted request', async () => {
    const pending = deferred<string>();
    const mock = installPyodide(pending.promise);
    transport = new PyodideTransport();
    await transport.init();
    const controller = new AbortController();
    const call = transport.send(request, 0, controller.signal);
    await new Promise(resolve => setTimeout(resolve, 0));
    controller.abort();
    await expect(call).rejects.toBeInstanceOf(BridgeTimeoutError);
    expect(mock.cancel).toHaveBeenCalledTimes(1);
    expect(mock.cancel).toHaveBeenCalledWith(41);
    pending.reject(new Error('CancelledError'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mock.destroyTask).toHaveBeenCalledTimes(1);
  });

  it('rejects disposal during await and cleans up after settlement', async () => {
    const pending = deferred<string>();
    const mock = installPyodide(pending.promise);
    transport = new PyodideTransport();
    await transport.init();
    const call = transport.send(request, 0);
    await new Promise(resolve => setTimeout(resolve, 0));
    await transport.dispose();
    await expect(call).rejects.toBeInstanceOf(BridgeDisposedError);
    expect(mock.cancel).toHaveBeenCalledWith(41);
    expect(mock.destroyTask).not.toHaveBeenCalled();
    pending.reject(new Error('CancelledError'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mock.destroyTask).toHaveBeenCalledTimes(1);
  });

  it('does not cancel a completed call at the timeout boundary', async () => {
    const mock = installPyodide(Promise.resolve(response));
    transport = new PyodideTransport();
    expect(await transport.send(request, 20)).toBe(response);
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(mock.cancel).not.toHaveBeenCalled();
    expect(mock.destroyTask).toHaveBeenCalledTimes(1);
  });
});
