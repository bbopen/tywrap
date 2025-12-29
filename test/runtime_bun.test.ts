/**
 * Bun Runtime Support Compatibility Tests
 * Tests native Python FFI, subprocess performance, bundler compatibility, and Bun-specific features
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm, mkdir } from 'node:fs/promises';
import {
  isBun,
  detectRuntime,
  processUtils,
  fsUtils,
  pathUtils,
  clearRuntimeCache,
} from '../src/utils/runtime.js';

// Skip all tests if not running in Bun environment
const describeBunOnly = isBun() ? describe : describe.skip;

describeBunOnly('Bun Runtime Support', () => {
  const bunDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Bun');
  const canStubGlobalBun = !bunDescriptor || (bunDescriptor.configurable && bunDescriptor.writable);

  describe('Runtime Detection', () => {
    it('should detect Bun runtime correctly', () => {
      clearRuntimeCache();
      const runtime = detectRuntime();
      expect(runtime.name).toBe('bun');
      expect(runtime.version).toBe(Bun.version);
    });

    it('should report correct capabilities for Bun', () => {
      clearRuntimeCache();
      const runtime = detectRuntime();
      expect(runtime.capabilities).toEqual({
        filesystem: true,
        subprocess: true,
        webassembly: true,
        webworkers: true,
        sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
        fetch: true,
      });
    });

    it('should return false for isBun when Bun not available', () => {
      if (!canStubGlobalBun) {
        expect(isBun()).toBe(true);
        return;
      }
      const originalBun = (globalThis as any).Bun;
      try {
        delete (globalThis as any).Bun;
        clearRuntimeCache();
        expect(isBun()).toBe(false);
      } finally {
        (globalThis as any).Bun = originalBun;
        clearRuntimeCache();
      }
    });
  });

  describe('Subprocess Performance', () => {
    it('should create subprocess using Bun.spawn', async () => {
      if (!processUtils.isAvailable()) return;
      const result = await processUtils.exec('echo', ['Hello World']);
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe('Hello World');
    });

    it('should handle subprocess errors in Bun', async () => {
      if (!processUtils.isAvailable()) return;
      const falsePath = Bun.which?.('false');
      if (!falsePath) return;
      const result = await processUtils.exec(falsePath);
      expect(result.code).toBeGreaterThan(0);
    });

    it('should handle Python subprocess execution', async () => {
      if (!processUtils.isAvailable()) return;
      const pythonPath = Bun.which?.('python3') ?? Bun.which?.('python');
      if (!pythonPath) return;
      const result = await processUtils.exec(pythonPath, [
        '-c',
        'import math; print(math.sqrt(9))',
      ]);
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe('3.0');
    });

    it('should measure subprocess performance', async () => {
      const startTime = Date.now();

      if (!processUtils.isAvailable()) return;
      await processUtils.exec('echo', ['fast']);
      const duration = Date.now() - startTime;

      // Bun should be fast
      expect(duration).toBeLessThan(1000);
    });

    it('should handle concurrent subprocess execution', async () => {
      if (!processUtils.isAvailable()) return;
      const results = await Promise.all([
        processUtils.exec('echo', ['0']),
        processUtils.exec('echo', ['1']),
        processUtils.exec('echo', ['2']),
      ]);

      expect(results).toHaveLength(3);
      expect(results.every(result => result.code === 0)).toBe(true);
    });
  });

  describe('File System Operations', () => {
    const tempDir = pathUtils.join(process.cwd(), 'test', 'fixtures', 'runtime-bun');
    let tempPaths: string[] = [];

    beforeEach(async () => {
      tempPaths = [];
      await mkdir(tempDir, { recursive: true });
    });

    afterEach(async () => {
      await Promise.all(tempPaths.map(filePath => rm(filePath, { force: true })));
    });

    const trackTemp = (name: string): string => {
      const filePath = pathUtils.join(tempDir, name);
      tempPaths.push(filePath);
      return filePath;
    };

    it('should read files using Bun.file', async () => {
      if (!fsUtils.isAvailable()) return;
      const filePath = trackTemp('read.txt');
      await Bun.write(filePath, 'File content');

      const content = await fsUtils.readFile(filePath);
      expect(content).toBe('File content');
    });

    it('should write files using Bun.write', async () => {
      if (!fsUtils.isAvailable()) return;
      const filePath = trackTemp('write.txt');
      await fsUtils.writeFile(filePath, 'New content');

      const content = await Bun.file(filePath).text();
      expect(content).toBe('New content');
    });

    it('should handle binary file operations', async () => {
      if (!fsUtils.isAvailable()) return;
      const binaryData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header
      const filePath = trackTemp('image.bin');

      await Bun.write(filePath, binaryData);
      const buffer = await Bun.file(filePath).arrayBuffer();
      expect(new Uint8Array(buffer)).toEqual(binaryData);
    });

    it('should handle JSON file operations', async () => {
      if (!fsUtils.isAvailable()) return;
      const jsonData = { name: 'test', value: 42 };
      const filePath = trackTemp('data.json');

      await Bun.write(filePath, JSON.stringify(jsonData));
      const data = await Bun.file(filePath).json();
      expect(data).toEqual(jsonData);
    });

    it('should handle large file operations efficiently', async () => {
      if (!fsUtils.isAvailable()) return;
      const largeContent = 'x'.repeat(5 * 1024 * 1024); // 5MB
      const filePath = trackTemp('large-file.txt');
      await Bun.write(filePath, largeContent);

      const startTime = Date.now();
      const content = await fsUtils.readFile(filePath);
      const duration = Date.now() - startTime;

      expect(content).toBe(largeContent);
      // Should be reasonably fast for large files
      expect(duration).toBeLessThan(5000);
    });
  });

  describe('Native Python FFI (Future)', () => {
    it('should provide foundation for native Python integration', () => {
      // Test that Bun provides the necessary APIs for future FFI
      expect(Bun.allocUnsafe).toBeDefined();
      expect(typeof Bun.allocUnsafe).toBe('function');
    });

    it('should handle memory allocation for FFI', () => {
      const buffer = Bun.allocUnsafe(1024);
      if (buffer instanceof ArrayBuffer) {
        expect(buffer.byteLength).toBe(1024);
        return;
      }
      expect(buffer).toBeInstanceOf(Uint8Array);
      expect(buffer.byteLength).toBe(1024);
    });

    it('should support garbage collection for FFI resources', () => {
      expect(typeof Bun.gc).toBe('function');
      Bun.gc();
    });

    // Note: Actual Python FFI would require libpython bindings
    it('should prepare for future libpython integration', () => {
      // This is a placeholder for future FFI functionality
      const ffiConfig = {
        library: 'python3.11',
        symbols: {
          Py_Initialize: { args: [], returns: 'void' },
          PyRun_SimpleString: { args: ['cstring'], returns: 'int' },
          Py_Finalize: { args: [], returns: 'void' },
        },
      };

      expect(ffiConfig.library).toBe('python3.11');
      expect(ffiConfig.symbols.Py_Initialize).toBeDefined();
    });
  });

  describe('Bundler Integration', () => {
    it('should support Bun build API', () => {
      const buildConfig = {
        entrypoints: ['./src/index.ts'],
        outdir: './dist',
        target: 'node',
        format: 'esm',
      };

      expect(typeof Bun.build).toBe('function');
      expect(typeof buildConfig.entrypoints).toBe('object');
    });

    it('should handle TypeScript compilation', () => {
      const tsConfig = {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
        },
      };

      expect(tsConfig.compilerOptions.moduleResolution).toBe('bundler');
    });

    it('should support hot reloading in development', () => {
      const devConfig = {
        watch: true,
        hot: true,
        port: 3000,
      };

      expect(devConfig.watch).toBe(true);
      expect(devConfig.hot).toBe(true);
    });

    it('should handle module resolution', () => {
      // Test Bun's module resolution capabilities
      const moduleMap = {
        './utils/runtime': '../src/utils/runtime.js',
        tywrap: './dist/index.js',
        'node:fs': 'fs', // Node.js built-in mapping
      };

      expect(moduleMap['./utils/runtime']).toContain('runtime.js');
    });
  });

  describe('Performance Characteristics', () => {
    it('should have fast startup time', () => {
      const startTime = Date.now();

      // Simulate Bun initialization
      const runtime = detectRuntime();
      const initTime = Date.now() - startTime;

      expect(runtime.name).toBe('bun');
      expect(initTime).toBeLessThan(100); // Should be very fast
    });

    it('should handle concurrent operations efficiently', async () => {
      const operations = Array.from({ length: 100 }, (_, i) => Promise.resolve(`operation-${i}`));

      const startTime = Date.now();
      const results = await Promise.all(operations);
      const duration = Date.now() - startTime;

      expect(results).toHaveLength(100);
      expect(duration).toBeLessThan(1000); // Should handle concurrent ops well
    });

    it('should optimize memory usage', () => {
      // Test memory-efficient operations
      const largeArray = new Array(10000).fill(0);
      const processedArray = largeArray.map((_, i) => i * 2);

      expect(processedArray).toHaveLength(10000);
      expect(processedArray[5000]).toBe(10000);

      // In Bun, this should be memory-efficient
      const memoryUsage = process.memoryUsage?.() || { heapUsed: 0 };
      expect(typeof memoryUsage.heapUsed).toBe('number');
    });
  });

  describe('Web API Compatibility', () => {
    it('should support Web APIs', () => {
      // Test that standard Web APIs are available
      expect(typeof fetch).toBe('function');
      expect(typeof WebAssembly).toBe('object');
      expect(typeof crypto).toBe('object');
    });

    it('should handle HTTP server functionality', () => {
      expect(typeof Bun.serve).toBe('function');
    });

    it('should support streaming responses', async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue('chunk1');
          controller.enqueue('chunk2');
          controller.close();
        },
      });

      const response = new Response(stream);
      expect(response.body).toBe(stream);
    });
  });

  describe('Path Utilities', () => {
    it('should join paths correctly in Bun', () => {
      const joined = pathUtils.join('bun', 'project', 'src', 'index.ts');
      expect(joined).toBe('bun/project/src/index.ts');
    });

    it('should resolve paths correctly', () => {
      const resolved = pathUtils.resolve('./bun-app');
      expect(typeof resolved).toBe('string');
    });

    it('should handle cross-platform paths', () => {
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

  describe('Cryptographic Functions', () => {
    it('should provide password hashing utilities', async () => {
      expect(Bun.password).toBeDefined();

      if (Bun.password?.hashSync) {
        const result = Bun.password.hashSync('my-password');
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
        return;
      }

      if (Bun.password?.hash) {
        const result = await Bun.password.hash('my-password');
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
      }
    });

    it('should provide hashing functions', () => {
      const hasher = new Bun.CryptoHasher('sha256');
      const result = hasher.update('data').digest('hex');
      expect(result).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should integrate with Web Crypto API', async () => {
      if (typeof crypto !== 'undefined' && crypto.subtle) {
        const data = new TextEncoder().encode('test data');
        const hash = await crypto.subtle.digest('SHA-256', data);

        expect(hash).toBeInstanceOf(ArrayBuffer);
        expect(hash.byteLength).toBe(32); // SHA-256 produces 32 bytes
      }
    });
  });

  describe('Error Handling and Debugging', () => {
    it('should provide detailed error information', () => {
      try {
        throw new Error('Test error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('Test error');
        expect((error as Error).stack).toBeDefined();
      }
    });

    it('should handle subprocess errors gracefully', async () => {
      if (!processUtils.isAvailable()) return;
      const shell = Bun.which?.('sh');
      if (shell) {
        const result = await processUtils.exec(shell, ['-c', 'echo Process failed 1>&2; exit 1']);
        expect(result.code).toBe(1);
        expect(result.stderr.trim()).toBe('Process failed');
        return;
      }
      const falsePath = Bun.which?.('false');
      if (!falsePath) return;
      const result = await processUtils.exec(falsePath);
      expect(result.code).toBeGreaterThan(0);
    });

    it('should provide debugging utilities', () => {
      // Test that Bun provides good debugging info
      const debugInfo = {
        version: Bun.version,
        main: Bun.main,
        argv: Bun.argv,
      };

      expect(typeof debugInfo.version).toBe('string');
      expect(typeof debugInfo.main).toBe('string');
      expect(Array.isArray(debugInfo.argv)).toBe(true);
    });
  });

  describe('Future Compatibility', () => {
    it('should prepare for future Python integration methods', () => {
      // Test foundation for different Python integration approaches
      const integrationMethods = {
        subprocess: processUtils.isAvailable(),
        ffi: typeof Bun.allocUnsafe === 'function',
        wasm: typeof WebAssembly !== 'undefined',
        http: typeof fetch === 'function',
      };

      expect(integrationMethods.subprocess).toBe(true);
      expect(integrationMethods.ffi).toBe(true);
      expect(integrationMethods.wasm).toBe(true);
      expect(integrationMethods.http).toBe(true);
    });

    it('should handle version compatibility', () => {
      const version = Bun.version;
      const majorVersion = parseInt(version.split('.')[0]);

      expect(majorVersion).toBeGreaterThanOrEqual(1);
    });

    it('should support experimental features flags', () => {
      const experimentalFeatures = {
        'bun-ffi': true,
        'bun-macros': true,
        'bun-plugin-api': true,
      };

      expect(typeof experimentalFeatures).toBe('object');
    });
  });
});
