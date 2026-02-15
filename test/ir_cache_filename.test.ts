import { describe, expect, it } from 'vitest';

import { computeIrCacheFilename } from '../src/utils/ir-cache.js';

describe('computeIrCacheFilename', () => {
  it('does not include module names in filenames (path traversal safe)', async () => {
    const filename = await computeIrCacheFilename({
      module: 'pkg.sub/../evil:a',
      moduleVersion: null,
      runtime: { pythonPath: '/usr/bin/python3', virtualEnv: null },
      output: { format: 'esm', declaration: false, sourceMap: false },
      performance: { caching: true, compression: 'none' },
      typeHints: 'strict',
    });

    expect(filename).toMatch(/^ir_[a-f0-9]{32}\.json$/);
    expect(filename).not.toContain('/');
    expect(filename).not.toContain('\\');
    expect(filename).not.toContain('..');
    expect(filename).not.toContain(':');
  });
});
