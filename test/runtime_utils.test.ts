import { describe, it, expect } from 'vitest';
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
});
