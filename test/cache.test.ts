import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IntelligentCache } from '../src/utils/cache.js';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

let cache: IntelligentCache;
let dir: string;

describe('IntelligentCache async operations', () => {
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tywrap-cache-'));
    cache = new IntelligentCache({ baseDir: dir, persistToDisk: true });
    await cache.clear();
  });

  afterEach(async () => {
    await cache.clear();
    await rm(dir, { recursive: true, force: true });
  });

  it('should set and get values asynchronously', async () => {
    await cache.set('test-key', { value: 123 });
    const result = await cache.get<{ value: number }>('test-key');
    expect(result).toEqual({ value: 123 });
  });

  it('should handle I/O errors gracefully', async () => {
    // Spy on stderr since logger writes warnings there
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const fsModule = await import('node:fs');
    const writeSpy = vi
      .spyOn(fsModule.promises, 'writeFile')
      .mockRejectedValue(new Error('disk full'));

    await cache.set('fail-key', {});

    // Verify warning was logged (logger writes to stderr)
    expect(stderrSpy).toHaveBeenCalled();
    const calls = stderrSpy.mock.calls.map(c => String(c[0]));
    expect(calls.some(c => c.includes('WARN') && c.includes('fail-key'))).toBe(true);

    writeSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});
