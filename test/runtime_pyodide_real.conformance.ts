import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';

import { PyodideBridge } from '../src/runtime/pyodide.js';

const indexURL = `${join(process.cwd(), 'node_modules', 'pyodide')}/`;

describe('real PyodideBridge', () => {
  let bridge: PyodideBridge | undefined;

  afterEach(async () => {
    await bridge?.dispose();
    bridge = undefined;
  });

  it('runs standard library, byte envelope, scientific JSON, and Python error cases', async () => {
      bridge = new PyodideBridge({ indexURL });

    await expect(bridge.call('math', 'sqrt', [81])).resolves.toBe(9);
    await expect(bridge.call('builtins', 'bytes', [[0, 1, 255]])).resolves.toEqual(
      new Uint8Array([0, 1, 255])
    );
      await expect(bridge.call('decimal', 'Decimal', ['1.25'])).resolves.toBe('1.25');
    await expect(bridge.call('math', 'not_a_function', [])).rejects.toMatchObject({
      name: 'BridgeExecutionError',
    });
  }, 180_000);

  it('fails explicitly when Pyodide cannot load a requested package', async () => {
    bridge = new PyodideBridge({ indexURL, packages: ['tywrap-package-that-does-not-exist'] });
    await expect(bridge.call('math', 'sqrt', [4])).rejects.toThrow();
  }, 180_000);

  it('rejects calls after disposal', async () => {
    bridge = new PyodideBridge({ indexURL });
    await expect(bridge.call('math', 'sqrt', [4])).resolves.toBe(2);
    await bridge.dispose();
    await expect(bridge.call('math', 'sqrt', [4])).rejects.toThrow();
  }, 180_000);
});
