import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { detectRuntime, pathUtils } from '../src/utils/runtime.js';

describe('runtime utilities', () => {
  it('caches runtime detection', () => {
    const first = detectRuntime();
    const second = detectRuntime();
    expect(second).toBe(first);
  });

  it('normalizes joined paths', () => {
    const joined = pathUtils.join('/foo', '.', 'bar');
    const expected =
      path.posix?.join('/foo', 'bar') ??
      path.join('/foo', 'bar').replace(/\\/g, '/');
    expect(joined.includes('/./')).toBe(false);
    expect(joined).toBe(expected);
  });
});
