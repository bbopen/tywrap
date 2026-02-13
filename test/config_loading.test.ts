import { describe, expect, it } from 'vitest';
import { chmod, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { loadConfigFile } from '../src/config/index.js';

describe('config loading', () => {
  it('loads a .ts config that imports defineConfig from tywrap', async () => {
    // Why: tywrap is published as ESM, so TS configs that import from 'tywrap' must be evaluated
    // as ESM as well (CommonJS transpilation would try `require('tywrap')` and fail).
    const dir = await mkdtemp(join(process.cwd(), '.tmp-tywrap-config-'));
    const configPath = join(dir, 'tywrap.config.ts');

    await writeFile(
      configPath,
      `import { defineConfig } from 'tywrap';

export default defineConfig({ debug: true });
`,
      'utf-8'
    );

    try {
      const cfg = await loadConfigFile(configPath);
      expect(cfg).toEqual({ debug: true });

      // Why: ESM evaluation writes a temporary `.mjs` file to allow Node to import the transpiled
      // config without a custom loader; it must be cleaned up after loading.
      const entries = await readdir(dir);
      expect(entries.some(name => name.startsWith('.tywrap.config.'))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('loads a .ts config from a read-only directory', async () => {
    const dir = await mkdtemp(join(process.cwd(), '.tmp-tywrap-config-ro-'));
    const configPath = join(dir, 'tywrap.config.ts');

    await writeFile(configPath, `export default { debug: true };
`, 'utf-8');
    await chmod(dir, 0o555);

    try {
      const cfg = await loadConfigFile(configPath);
      expect(cfg).toEqual({ debug: true });
    } finally {
      await chmod(dir, 0o755);
      await rm(dir, { recursive: true, force: true });
    }
  });

});
