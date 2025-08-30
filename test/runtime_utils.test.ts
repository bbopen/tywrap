import { describe, it, expect, vi } from 'vitest';
import { detectRuntime, pathUtils } from '../src/utils/runtime.js';

describe('runtime utilities', () => {
  it('caches runtime detection', () => {
    const first = detectRuntime();
    const second = detectRuntime();
    expect(second).toBe(first);
  });

  it('normalizes joined paths', () => {
    const joined = pathUtils.join('/foo', '.', 'bar');
    expect(joined.includes('/./')).toBe(false);
    expect(joined.endsWith('/foo/bar')).toBe(true);
  });

  it('normalizes paths in browser-like runtime', async () => {
    try {
      vi.stubGlobal('process', undefined);
      vi.stubGlobal('window', {} as unknown);
      vi.resetModules();
      const { pathUtils: browserPathUtils } = await import('../src/utils/runtime.js');
      const joined = browserPathUtils.join('/foo', '.', 'bar', '..', 'baz');
      expect(joined).toBe('/foo/baz');
      const relative = browserPathUtils.join('foo', '..', 'bar');
      expect(relative).toBe('bar');
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});
