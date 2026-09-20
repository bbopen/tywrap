import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

import { loadPyodide } from 'pyodide';
import { afterEach, describe, expect, it } from 'vitest';

import { PyodideBridge } from '../src/runtime/pyodide.js';
import { clearRuntimeBridge, setRuntimeBridge } from '../src/runtime/index.js';
import { generate } from '../src/tywrap.js';

const indexURL = `${join(process.cwd(), 'node_modules', 'pyodide')}/`;

describe('real PyodideBridge', () => {
  let bridge: PyodideBridge | undefined;

  afterEach(async () => {
    clearRuntimeBridge();
    await bridge?.dispose();
    bridge = undefined;
  });

  it('runs standard library, byte envelope, scientific JSON, and Python error cases', async () => {
    bridge = new PyodideBridge({ indexURL, packages: ['numpy'] });

    await expect(bridge.call('math', 'sqrt', [81])).resolves.toBe(9);
    await expect(bridge.call('builtins', 'bytes', [[0, 1, 255]])).resolves.toEqual(
      new Uint8Array([0, 1, 255])
    );
    await expect(bridge.call('numpy', 'array', [[1.5, -2.25]])).resolves.toEqual([1.5, -2.25]);
    await expect(bridge.call('math', 'not_a_function', [])).rejects.toMatchObject({
      name: 'BridgeExecutionError',
    });
  }, 180_000);

  it('executes a generated asyncText wrapper through real Pyodide', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-pyodide-coroutine-'));
    const globals = globalThis as typeof globalThis & { loadPyodide?: typeof loadPyodide };
    const previousLoader = globals.loadPyodide;
    try {
      writeFileSync(
        join(tempDir, 'tywrap_async_text.py'),
        'import asyncio\nasync def async_text() -> str:\n    await asyncio.sleep(0)\n    return "awaited in WASM"\n',
        'utf8'
      );
      const generated = await generate({
        pythonModules: { tywrap_async_text: { runtime: 'pyodide', typeHints: 'strict' } },
        pythonImportPath: [tempDir],
        output: { dir: join(tempDir, 'generated'), format: 'esm', declaration: false },
        performance: { caching: false, batching: false, compression: 'none' },
      } as never);
      expect(generated.failures).toEqual([]);
      const generatedPath = generated.written.find(path => path.endsWith('.generated.ts'));
      expect(generatedPath).toBeDefined();

      globals.loadPyodide = async options => {
        const py = await loadPyodide(options);
        py.runPython(`
import sys, types, asyncio
tywrap_async_text = types.ModuleType('tywrap_async_text')
async def async_text():
    await asyncio.sleep(0)
    return 'awaited in WASM'
tywrap_async_text.async_text = async_text
sys.modules['tywrap_async_text'] = tywrap_async_text
`);
        return py;
      };

      bridge = new PyodideBridge({ indexURL });
      setRuntimeBridge(bridge);
      const wrapper = (await import(pathToFileURL(generatedPath as string).href)) as {
        asyncText: () => Promise<string>;
      };
      await expect(wrapper.asyncText()).resolves.toBe('awaited in WASM');
      await expect(bridge.call('math', 'sqrt', [16])).resolves.toBe(4);
    } finally {
      clearRuntimeBridge();
      await bridge?.dispose();
      bridge = undefined;
      if (previousLoader) globals.loadPyodide = previousLoader;
      else delete globals.loadPyodide;
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 180_000);

  it('fails explicitly when Pyodide cannot load a requested package', async () => {
    bridge = new PyodideBridge({ indexURL, packages: ['tywrap-package-that-does-not-exist'] });
    await expect(bridge.call('math', 'sqrt', [4])).rejects.toThrow();
  }, 180_000);

  it('requires local runtime assets before starting WASM', () => {
    for (const name of ['pyodide.mjs', 'pyodide.asm.wasm', 'pyodide-lock.json']) {
      if (!existsSync(join(indexURL, name))) {
        throw new Error(`Required Pyodide runtime asset is missing: ${name}`);
      }
    }
  });

  it('reports a bootstrap failure and disposes the failed bridge', async () => {
    const globals = globalThis as typeof globalThis & { loadPyodide?: typeof loadPyodide };
    const previousLoader = globals.loadPyodide;
    let wasmLoaded = false;
    let bootstrapAttempted = false;
    try {
      globals.loadPyodide = async options => {
        const py = await loadPyodide(options);
        wasmLoaded = true;
        return new Proxy(py, {
          get(target, property, receiver) {
            if (property === 'runPythonAsync') {
              return async (code: string) => {
                bootstrapAttempted = code.includes('tywrap_bridge_core');
                return target.runPythonAsync(
                  `raise RuntimeError("bootstrap failure fixture")\n${code}`
                );
              };
            }
            return Reflect.get(target, property, receiver);
          },
        });
      };
      bridge = new PyodideBridge({ indexURL });
      await expect(bridge.init()).rejects.toThrow('bootstrap failure fixture');
      expect(wasmLoaded).toBe(true);
      expect(bootstrapAttempted).toBe(true);
      expect(bridge.isReady).toBe(false);
      await bridge.dispose();
      expect(bridge.isDisposed).toBe(true);
    } finally {
      if (previousLoader) globals.loadPyodide = previousLoader;
      else delete globals.loadPyodide;
    }
  }, 180_000);

  it('rejects calls after disposal', async () => {
    bridge = new PyodideBridge({ indexURL });
    await expect(bridge.call('math', 'sqrt', [4])).resolves.toBe(2);
    await bridge.dispose();
    await expect(bridge.call('math', 'sqrt', [4])).rejects.toThrow();
  }, 180_000);
});
