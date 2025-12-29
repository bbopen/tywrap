import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { isNodejs } from '../src/utils/runtime.js';

const execFileAsync = promisify(execFile);
const describeNodeOnly = isNodejs() ? describe : describe.skip;

const isCommandAvailable = async (cmd: string, args: string[]): Promise<boolean> => {
  try {
    await execFileAsync(cmd, args);
    return true;
  } catch {
    return false;
  }
};

describeNodeOnly('Package distribution', () => {
  it('exposes runtime entrypoints in package.json', async () => {
    const pkgPath = join(process.cwd(), 'package.json');
    const raw = await readFile(pkgPath, 'utf8');
    const pkg = JSON.parse(raw) as { exports?: Record<string, unknown> };
    const exportsMap = pkg.exports ?? {};

    expect(exportsMap).toHaveProperty('.');
    expect(exportsMap).toHaveProperty('./node');
    expect(exportsMap).toHaveProperty('./pyodide');
    expect(exportsMap).toHaveProperty('./http');
    expect(exportsMap).toHaveProperty('./runtime');
  });

  it('includes Python bridge in npm pack output', async () => {
    const npmAvailable = await isCommandAvailable('npm', ['--version']);
    const tarAvailable = await isCommandAvailable('tar', ['--version']);
    if (!npmAvailable || !tarAvailable) return;

    let tarball: string | undefined;
    try {
      const { stdout } = await execFileAsync('npm', ['pack', '--json'], {
        cwd: process.cwd(),
        timeout: 170_000,
        maxBuffer: 10 * 1024 * 1024,
      });
      const info = JSON.parse(stdout) as Array<{ filename?: string }>;
      const filename = info[0]?.filename;
      if (!filename) {
        throw new Error('npm pack did not return a filename');
      }
      tarball = join(process.cwd(), filename);
      if (!existsSync(tarball)) {
        throw new Error(`npm pack did not create tarball at ${tarball}`);
      }

      const { stdout: listing } = await execFileAsync('tar', ['-tf', tarball]);
      const entries = listing.split('\n').filter(Boolean);

      expect(entries).toContain('package/runtime/python_bridge.py');
      if (existsSync(join(process.cwd(), 'dist', 'index.js'))) {
        expect(entries).toContain('package/dist/index.js');
      }
    } finally {
      if (tarball) {
        await rm(tarball, { force: true });
      }
    }
  }, 180000);
});
