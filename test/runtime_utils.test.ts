/**
 * Runtime detection and path utilities tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  detectRuntime,
  pathUtils,
  isNodejs,
  isDeno,
  isBun,
  isBrowser,
  clearRuntimeCache,
} from '../src/utils/runtime.js';

describe('Runtime Detection', () => {
  beforeEach(() => {
    // Clear runtime cache before each test
    clearRuntimeCache();
  });

  afterEach(() => {
    // Clear runtime cache after each test
    clearRuntimeCache();
  });

  it('should cache runtime detection results', () => {
    const first = detectRuntime();
    const second = detectRuntime();

    // Should return the same object reference due to caching
    expect(first).toBe(second);
  });

  it('should freeze runtime detection results', () => {
    const runtime = detectRuntime();

    // Should be frozen to prevent external mutation
    expect(Object.isFrozen(runtime)).toBe(true);
    expect(Object.isFrozen(runtime.capabilities)).toBe(true);
  });

  it('should detect Node.js correctly', () => {
    if (typeof process !== 'undefined' && process.versions?.node) {
      expect(isNodejs()).toBe(true);
      expect(detectRuntime().name).toBe('node');
    }
  });

  it('should detect Deno when available', () => {
    // Mock Deno global
    vi.stubGlobal('Deno', {
      version: { deno: '1.40.0' },
    });
    // Clear Node.js indicators
    vi.stubGlobal('process', undefined);
    vi.stubGlobal('Bun', undefined);

    const runtime = detectRuntime();
    expect(runtime.name).toBe('deno');
    expect(runtime.version).toBe('1.40.0');
    expect(isDeno()).toBe(true);

    vi.unstubAllGlobals();
  });

  it('should detect Bun when available', () => {
    // Mock Bun global
    vi.stubGlobal('Bun', {
      version: '1.1.0',
    });
    // Clear other runtime indicators
    vi.stubGlobal('process', undefined);
    vi.stubGlobal('Deno', undefined);

    const runtime = detectRuntime();
    expect(runtime.name).toBe('bun');
    expect(runtime.version).toBe('1.1.0');
    expect(isBun()).toBe(true);

    vi.unstubAllGlobals();
  });

  it('should detect browser environment', () => {
    // Mock browser environment
    vi.stubGlobal('window', {
      isSecureContext: true,
    });
    vi.stubGlobal('Worker', vi.fn());
    vi.stubGlobal('WebAssembly', {});
    vi.stubGlobal('fetch', vi.fn());
    // Clear server runtime indicators
    vi.stubGlobal('process', undefined);
    vi.stubGlobal('Deno', undefined);
    vi.stubGlobal('Bun', undefined);

    const runtime = detectRuntime();
    expect(runtime.name).toBe('browser');
    expect(isBrowser()).toBe(true);

    vi.unstubAllGlobals();
  });

  it('should return unknown for unrecognized environments', () => {
    // Clear all runtime indicators
    vi.stubGlobal('process', undefined);
    vi.stubGlobal('Deno', undefined);
    vi.stubGlobal('Bun', undefined);
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('self', undefined);

    const runtime = detectRuntime();
    expect(runtime.name).toBe('unknown');

    vi.unstubAllGlobals();
  });
});

describe('Path Utilities', () => {
  beforeEach(() => {
    clearRuntimeCache();
  });

  afterEach(() => {
    clearRuntimeCache();
    vi.unstubAllGlobals();
  });

  describe('Synchronous join', () => {
    it('should join paths correctly', () => {
      const joined = pathUtils.join('src', 'utils', 'runtime.ts');
      expect(joined).toBe('src/utils/runtime.ts');
    });

    it('should handle multiple slashes', () => {
      const joined = pathUtils.join('src//utils', 'runtime.ts');
      expect(joined).toBe('src/utils/runtime.ts');
    });

    it('should normalize backslashes', () => {
      const joined = pathUtils.join('src\\utils', 'runtime.ts');
      expect(joined).toBe('src/utils/runtime.ts');
    });

    it('should handle empty segments', () => {
      const joined = pathUtils.join('src', '', 'utils', 'runtime.ts');
      expect(joined).toBe('src/utils/runtime.ts');
    });

    it('should normalize dots and double dots', () => {
      const joined = pathUtils.join('src', '.', 'utils', '..', 'runtime.ts');
      expect(joined).toBe('src/runtime.ts');
    });

    it('should handle complex path normalization', () => {
      const testCases = [
        { input: ['./src', '../dist'], expected: 'dist' },
        { input: ['src', '.', 'utils'], expected: 'src/utils' },
        { input: ['src', '..', 'test'], expected: 'test' },
        { input: ['a', 'b', '..', 'c'], expected: 'a/c' },
      ];

      testCases.forEach(({ input, expected }) => {
        const result = pathUtils.join(...input);
        expect(result).toBe(expected);
      });
    });
  });

  describe('Async join', () => {
    it('should join paths asynchronously', async () => {
      const joined = await pathUtils.joinAsync('src', 'utils', 'runtime.ts');
      expect(joined).toBe('src/utils/runtime.ts');
    });

    it('should use Node.js path.posix when available', async () => {
      // Mock Node.js environment
      vi.stubGlobal('process', {
        versions: { node: '20.0.0' },
      });

      const joined = await pathUtils.joinAsync('src', 'utils');
      expect(joined).toBe('src/utils');
    });
  });

  describe('Resolve', () => {
    it('should resolve paths synchronously', () => {
      const resolved = pathUtils.resolve('./test-file');
      expect(typeof resolved).toBe('string');
      expect(resolved).toContain('test-file');
    });

    it('should resolve paths asynchronously with resolveAsync', async () => {
      const resolved = await pathUtils.resolveAsync('./test-file');
      expect(typeof resolved).toBe('string');
      expect(resolved).toContain('test-file');
    });
  });

  describe('Cross-platform compatibility', () => {
    it('should handle cross-platform path separators', () => {
      const testCases = [
        { input: ['C:', 'Users', 'dev'], expected: 'C:/Users/dev' },
        { input: ['/home', 'user', 'app'], expected: '/home/user/app' },
        { input: ['./src', '../dist'], expected: 'dist' },
      ];

      testCases.forEach(({ input, expected }) => {
        const result = pathUtils.join(...input);
        expect(result).toBe(expected);
      });
    });
  });

  describe('Browser compatibility', () => {
    beforeEach(() => {
      // Mock browser environment
      vi.stubGlobal('process', undefined);
      vi.stubGlobal('Deno', undefined);
      vi.stubGlobal('Bun', undefined);
      vi.stubGlobal('window', { isSecureContext: true });
      vi.stubGlobal('location', { href: 'https://example.com/app/' });
      clearRuntimeCache();
    });

    it('should normalize paths in browser runtime', () => {
      const joined = pathUtils.join('src', '.', 'utils', '..', 'components');
      expect(joined).toBe('src/components');
    });

    it('should resolve URLs in browser environment', () => {
      const resolved = pathUtils.resolve('./module.js');
      expect(resolved).toContain('module.js');
    });

    it('should resolve URLs asynchronously in browser environment', async () => {
      const resolved = await pathUtils.resolveAsync('./module.js');
      expect(resolved).toContain('module.js');
    });
  });
});
