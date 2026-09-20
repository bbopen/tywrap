import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { loadPyodide } from 'pyodide';
import { afterEach, describe, expect, it } from 'vitest';

import { PyodideBridge } from '../src/runtime/pyodide.js';

const indexURL = `${join(process.cwd(), 'node_modules', 'pyodide')}/`;

describe('real PyodideBridge', () => {
  let bridge: PyodideBridge | undefined;

  afterEach(async () => {
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

  it('fails explicitly when Pyodide cannot load a requested package', async () => {
    bridge = new PyodideBridge({ indexURL, packages: ['tywrap-package-that-does-not-exist'] });
    await expect(bridge.call('math', 'sqrt', [4])).rejects.toThrow();
  }, 180_000);

  it('requires local runtime assets before starting WASM', () => {
    for (const name of [
      'pyodide.mjs',
      'pyodide.asm.js',
      'pyodide.asm.wasm',
      'python_stdlib.zip',
      'pyodide-lock.json',
    ]) {
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
