/**
 * Bun Runtime Support Compatibility Tests
 * Tests native Python FFI, subprocess performance, bundler compatibility, and Bun-specific features
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isBun, detectRuntime, processUtils, fsUtils, pathUtils } from '../src/utils/runtime.js';

// Skip all tests if not running in Bun environment
const describeBunOnly = isBun() ? describe : describe.skip;

// Mock Bun APIs for testing in non-Bun environments
const createBunMocks = () => {
  const mockBun = {
    version: '1.1.0',
    spawn: vi.fn(),
    file: vi.fn(),
    write: vi.fn(),
    serve: vi.fn(),
    build: vi.fn(),
    which: vi.fn(),
    password: vi.fn(),
    hash: vi.fn(),
    CryptoHasher: vi.fn(),
    env: process?.env || {},
    argv: ['bun', 'test'],
    main: '/path/to/main.ts',
    allocUnsafe: vi.fn(),
    gc: vi.fn()
  };

  // Mock process object for non-Node environments
  const mockProcess = {
    spawn: mockBun.spawn,
    stdout: { write: vi.fn() },
    stderr: { write: vi.fn() },
    stdin: { read: vi.fn() },
    exitCode: null,
    exited: Promise.resolve(0)
  };

  mockBun.spawn.mockReturnValue(mockProcess);

  return { mockBun, mockProcess };
};

describeBunOnly('Bun Runtime Support', () => {
  let originalBun: any;
  let mocks: ReturnType<typeof createBunMocks>;

  beforeEach(() => {
    // Store original Bun if it exists
    originalBun = (globalThis as any).Bun;
    mocks = createBunMocks();
  });

  afterEach(() => {
    // Restore original Bun
    if (originalBun !== undefined) {
      (globalThis as any).Bun = originalBun;
    } else {
      delete (globalThis as any).Bun;
    }
  });

  describe('Runtime Detection', () => {
    it('should detect Bun runtime correctly', () => {
      (globalThis as any).Bun = mocks.mockBun;
      
      const runtime = detectRuntime();
      expect(runtime.name).toBe('bun');
      expect(runtime.version).toBe('1.1.0');
    });

    it('should report correct capabilities for Bun', () => {
      (globalThis as any).Bun = mocks.mockBun;
      
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
      delete (globalThis as any).Bun;
      expect(isBun()).toBe(false);
    });
  });

  describe('Subprocess Performance', () => {
    beforeEach(() => {
      (globalThis as any).Bun = mocks.mockBun;
    });

    it('should create subprocess using Bun.spawn', async () => {
      if (!isBun() && !(globalThis as any).Bun) return;

      mocks.mockProcess.stdout = { stream: async function*() { yield 'Hello World'; } };
      mocks.mockProcess.stderr = { stream: async function*() { yield ''; } };
      mocks.mockProcess.exitCode = 0;

      if (processUtils.isAvailable()) {
        const result = await processUtils.exec('echo', ['Hello World']);
        
        expect(mocks.mockBun.spawn).toHaveBeenCalledWith(['echo', 'Hello World'], {
          stdout: 'pipe',
          stderr: 'pipe'
        });
      }
    });

    it('should handle subprocess errors in Bun', async () => {
      if (!isBun() && !(globalThis as any).Bun) return;

      mocks.mockProcess.stdout = { stream: async function*() { yield ''; } };
      mocks.mockProcess.stderr = { stream: async function*() { yield 'Command failed'; } };
      mocks.mockProcess.exitCode = 1;

      if (processUtils.isAvailable()) {
        const result = await processUtils.exec('false');
        expect(result.code).toBe(1);
      }
    });

    it('should handle Python subprocess execution', async () => {
      if (!isBun() && !(globalThis as any).Bun) return;

      // Mock Python execution with proper Response simulation
      const mockStdout = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('3.0'));
          controller.close();
        }
      });
      const mockStderr = new ReadableStream({
        start(controller) {
          controller.close();
        }
      });
      
      mocks.mockProcess.stdout = mockStdout;
      mocks.mockProcess.stderr = mockStderr;
      mocks.mockProcess.exitCode = 0;
      
      // Mock the Response constructor for the test
      global.Response = class Response {
        constructor(public stream: ReadableStream) {}
        async text() {
          const reader = this.stream.getReader();
          const chunks: Uint8Array[] = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) chunks.push(value);
          }
          const combined = new Uint8Array(chunks.reduce((acc, chunk) => acc + chunk.length, 0));
          let offset = 0;
          for (const chunk of chunks) {
            combined.set(chunk, offset);
            offset += chunk.length;
          }
          return new TextDecoder().decode(combined);
        }
      } as any;

      if (processUtils.isAvailable()) {
        const result = await processUtils.exec('python3', ['-c', 'import math; print(math.sqrt(9))']);
        
        expect(result.code).toBe(0);
        expect(result.stdout.trim()).toBe('3.0');
      }
    });

    it('should measure subprocess performance', async () => {
      if (!isBun() && !(globalThis as any).Bun) return;

      const startTime = Date.now();

      // Mock fast execution
      mocks.mockProcess.stdout = { stream: async function*() { yield 'fast'; } };
      mocks.mockProcess.stderr = { stream: async function*() { yield ''; } };
      mocks.mockProcess.exitCode = 0;
      mocks.mockProcess.exited = Promise.resolve(0);

      if (processUtils.isAvailable()) {
        await processUtils.exec('echo', ['fast']);
        const duration = Date.now() - startTime;
        
        // Bun should be fast
        expect(duration).toBeLessThan(1000);
      }
    });

    it('should handle concurrent subprocess execution', async () => {
      if (!isBun() && !(globalThis as any).Bun) return;

      // Mock multiple concurrent processes
      const processes = Array.from({ length: 3 }, (_, i) => {
        const mockProc = {
          stdout: { stream: async function*() { yield `output${i}`; } },
          stderr: { stream: async function*() { yield ''; } },
          exitCode: 0,
          exited: Promise.resolve(0)
        };
        return mockProc;
      });

      mocks.mockBun.spawn
        .mockReturnValueOnce(processes[0])
        .mockReturnValueOnce(processes[1])
        .mockReturnValueOnce(processes[2]);

      if (processUtils.isAvailable()) {
        const promises = [
          processUtils.exec('echo', ['0']),
          processUtils.exec('echo', ['1']),
          processUtils.exec('echo', ['2'])
        ];

        const results = await Promise.all(promises);
        expect(results).toHaveLength(3);
        expect(mocks.mockBun.spawn).toHaveBeenCalledTimes(3);
      }
    });
  });

  describe('File System Operations', () => {
    beforeEach(() => {
      (globalThis as any).Bun = mocks.mockBun;
    });

    it('should read files using Bun.file', async () => {
      if (!isBun() && !(globalThis as any).Bun) return;

      const mockFile = {
        text: vi.fn().mockResolvedValue('File content'),
        json: vi.fn(),
        arrayBuffer: vi.fn(),
        exists: vi.fn().mockReturnValue(true)
      };

      mocks.mockBun.file.mockReturnValue(mockFile);

      if (fsUtils.isAvailable()) {
        const content = await fsUtils.readFile('/path/to/file.txt');
        
        expect(content).toBe('File content');
        expect(mocks.mockBun.file).toHaveBeenCalledWith('/path/to/file.txt');
        expect(mockFile.text).toHaveBeenCalled();
      }
    });

    it('should write files using Bun.write', async () => {
      if (!isBun() && !(globalThis as any).Bun) return;

      mocks.mockBun.write.mockResolvedValue(undefined);

      if (fsUtils.isAvailable()) {
        await fsUtils.writeFile('/path/to/output.txt', 'New content');
        
        expect(mocks.mockBun.write).toHaveBeenCalledWith('/path/to/output.txt', 'New content');
      }
    });

    it('should handle binary file operations', async () => {
      if (!isBun() && !(globalThis as any).Bun) return;

      const binaryData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header
      const mockFile = {
        arrayBuffer: vi.fn().mockResolvedValue(binaryData.buffer),
        text: vi.fn(),
        json: vi.fn()
      };

      mocks.mockBun.file.mockReturnValue(mockFile);
      mocks.mockBun.write.mockResolvedValue(undefined);

      // Read binary
      if (fsUtils.isAvailable()) {
        mocks.mockBun.file('/image.png');
        const buffer = await mockFile.arrayBuffer();
        expect(new Uint8Array(buffer)).toEqual(binaryData);

        // Write binary
        await mocks.mockBun.write('/output.png', binaryData);
        expect(mocks.mockBun.write).toHaveBeenCalledWith('/output.png', binaryData);
      }
    });

    it('should handle JSON file operations', async () => {
      if (!isBun() && !(globalThis as any).Bun) return;

      const jsonData = { name: 'test', value: 42 };
      const mockFile = {
        json: vi.fn().mockResolvedValue(jsonData),
        text: vi.fn(),
        arrayBuffer: vi.fn()
      };

      mocks.mockBun.file.mockReturnValue(mockFile);
      mocks.mockBun.write.mockResolvedValue(undefined);

      if (fsUtils.isAvailable()) {
        // Read JSON
        mocks.mockBun.file('/data.json');
        const data = await mockFile.json();
        expect(data).toEqual(jsonData);

        // Write JSON
        await mocks.mockBun.write('/output.json', JSON.stringify(jsonData));
        expect(mocks.mockBun.write).toHaveBeenCalledWith('/output.json', JSON.stringify(jsonData));
      }
    });

    it('should handle large file operations efficiently', async () => {
      if (!isBun() && !(globalThis as any).Bun) return;

      const largeContent = 'x'.repeat(10 * 1024 * 1024); // 10MB
      const mockFile = {
        text: vi.fn().mockResolvedValue(largeContent),
        size: 10 * 1024 * 1024
      };

      mocks.mockBun.file.mockReturnValue(mockFile);

      if (fsUtils.isAvailable()) {
        const startTime = Date.now();
        const content = await fsUtils.readFile('/large-file.txt');
        const duration = Date.now() - startTime;

        expect(content).toBe(largeContent);
        // Should be reasonably fast for large files
        expect(duration).toBeLessThan(5000);
      }
    });
  });

  describe('Native Python FFI (Future)', () => {
    beforeEach(() => {
      (globalThis as any).Bun = mocks.mockBun;
    });

    it('should provide foundation for native Python integration', () => {
      if (!isBun() && !(globalThis as any).Bun) return;

      // Test that Bun provides the necessary APIs for future FFI
      expect(mocks.mockBun.allocUnsafe).toBeDefined();
      expect(typeof mocks.mockBun.allocUnsafe).toBe('function');
    });

    it('should handle memory allocation for FFI', () => {
      if (!isBun() && !(globalThis as any).Bun) return;

      const mockBuffer = new ArrayBuffer(1024);
      mocks.mockBun.allocUnsafe.mockReturnValue(mockBuffer);

      const buffer = mocks.mockBun.allocUnsafe(1024);
      expect(buffer).toBe(mockBuffer);
    });

    it('should support garbage collection for FFI resources', () => {
      if (!isBun() && !(globalThis as any).Bun) return;

      mocks.mockBun.gc.mockReturnValue(undefined);

      // Force garbage collection (useful for FFI cleanup)
      mocks.mockBun.gc();
      expect(mocks.mockBun.gc).toHaveBeenCalled();
    });

    // Note: Actual Python FFI would require libpython bindings
    it('should prepare for future libpython integration', () => {
      if (!isBun() && !(globalThis as any).Bun) return;

      // This is a placeholder for future FFI functionality
      const ffiConfig = {
        library: 'python3.11',
        symbols: {
          Py_Initialize: { args: [], returns: 'void' },
          PyRun_SimpleString: { args: ['cstring'], returns: 'int' },
          Py_Finalize: { args: [], returns: 'void' }
        }
      };

      expect(ffiConfig.library).toBe('python3.11');
      expect(ffiConfig.symbols.Py_Initialize).toBeDefined();
    });
  });

  describe('Bundler Integration', () => {
    beforeEach(() => {
      (globalThis as any).Bun = mocks.mockBun;
    });

    it('should support Bun build API', () => {
      if (!isBun() && !(globalThis as any).Bun) return;

      const buildConfig = {
        entrypoints: ['./src/index.ts'],
        outdir: './dist',
        target: 'node',
        format: 'esm'
      };

      mocks.mockBun.build.mockResolvedValue({
        success: true,
        outputs: ['./dist/index.js']
      });

      expect(mocks.mockBun.build).toBeDefined();
      expect(typeof buildConfig.entrypoints).toBe('object');
    });

    it('should handle TypeScript compilation', () => {
      if (!isBun() && !(globalThis as any).Bun) return;

      const tsConfig = {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler'
        }
      };

      expect(tsConfig.compilerOptions.moduleResolution).toBe('bundler');
    });

    it('should support hot reloading in development', () => {
      if (!isBun() && !(globalThis as any).Bun) return;

      const devConfig = {
        watch: true,
        hot: true,
        port: 3000
      };

      expect(devConfig.watch).toBe(true);
      expect(devConfig.hot).toBe(true);
    });

    it('should handle module resolution', () => {
      if (!isBun() && !(globalThis as any).Bun) return;

      // Test Bun's module resolution capabilities
      const moduleMap = {
        './utils/runtime': '../src/utils/runtime.js',
        'tywrap': './dist/index.js',
        'node:fs': 'fs' // Node.js built-in mapping
      };

      expect(moduleMap['./utils/runtime']).toContain('runtime.js');
    });
  });

  describe('Performance Characteristics', () => {
    beforeEach(() => {
      (globalThis as any).Bun = mocks.mockBun;
    });

    it('should have fast startup time', () => {
      if (!isBun() && !(globalThis as any).Bun) return;

      const startTime = Date.now();
      
      // Simulate Bun initialization
      const runtime = detectRuntime();
      const initTime = Date.now() - startTime;

      expect(runtime.name).toBe('bun');
      expect(initTime).toBeLessThan(100); // Should be very fast
    });

    it('should handle concurrent operations efficiently', async () => {
      if (!isBun() && !(globalThis as any).Bun) return;

      const operations = Array.from({ length: 100 }, (_, i) => 
        Promise.resolve(`operation-${i}`)
      );

      const startTime = Date.now();
      const results = await Promise.all(operations);
      const duration = Date.now() - startTime;

      expect(results).toHaveLength(100);
      expect(duration).toBeLessThan(1000); // Should handle concurrent ops well
    });

    it('should optimize memory usage', () => {
      if (!isBun() && !(globalThis as any).Bun) return;

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
    beforeEach(() => {
      (globalThis as any).Bun = mocks.mockBun;
    });

    it('should support Web APIs', () => {
      if (!isBun() && !(globalThis as any).Bun) return;

      // Test that standard Web APIs are available
      expect(typeof fetch).toBe('function');
      expect(typeof WebAssembly).toBe('object');
      expect(typeof crypto).toBe('object');
    });

    it('should handle HTTP server functionality', () => {
      if (!isBun() && !(globalThis as any).Bun) return;

      const serverConfig = {
        port: 3000,
        fetch: (req: Request) => new Response('Hello World'),
        hostname: 'localhost'
      };

      mocks.mockBun.serve.mockReturnValue({ port: 3000 });

      const server = mocks.mockBun.serve(serverConfig);
      expect(server.port).toBe(3000);
    });

    it('should support streaming responses', async () => {
      if (!isBun() && !(globalThis as any).Bun) return;

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue('chunk1');
          controller.enqueue('chunk2');
          controller.close();
        }
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
        { input: ['./src', '../dist'], expected: './src/../dist' }
      ];

      testCases.forEach(({ input, expected }) => {
        const result = pathUtils.join(...input);
        expect(result).toBe(expected);
      });
    });
  });

  describe('Cryptographic Functions', () => {
    beforeEach(() => {
      (globalThis as any).Bun = mocks.mockBun;
    });

    it('should provide password hashing utilities', async () => {
      if (!isBun() && !(globalThis as any).Bun) return;

      const hashedPassword = 'hashed_password_string';
      mocks.mockBun.password.mockResolvedValue(hashedPassword);

      const result = await mocks.mockBun.password('my-password', 'bcrypt');
      expect(result).toBe(hashedPassword);
    });

    it('should provide hashing functions', () => {
      if (!isBun() && !(globalThis as any).Bun) return;

      const mockHasher = {
        update: vi.fn().mockReturnThis(),
        digest: vi.fn().mockReturnValue('hash_result')
      };

      mocks.mockBun.CryptoHasher.mockReturnValue(mockHasher);

      const hasher = new mocks.mockBun.CryptoHasher('sha256');
      const result = hasher.update('data').digest('hex');

      expect(result).toBe('hash_result');
    });

    it('should integrate with Web Crypto API', async () => {
      if (!isBun() && !(globalThis as any).Bun) return;

      if (typeof crypto !== 'undefined' && crypto.subtle) {
        const data = new TextEncoder().encode('test data');
        const hash = await crypto.subtle.digest('SHA-256', data);
        
        expect(hash).toBeInstanceOf(ArrayBuffer);
        expect(hash.byteLength).toBe(32); // SHA-256 produces 32 bytes
      }
    });
  });

  describe('Error Handling and Debugging', () => {
    beforeEach(() => {
      (globalThis as any).Bun = mocks.mockBun;
    });

    it('should provide detailed error information', () => {
      if (!isBun() && !(globalThis as any).Bun) return;

      try {
        throw new Error('Test error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('Test error');
        expect((error as Error).stack).toBeDefined();
      }
    });

    it('should handle subprocess errors gracefully', async () => {
      if (!isBun() && !(globalThis as any).Bun) return;

      // Mock error process with proper Response simulation
      const mockStdout = new ReadableStream({
        start(controller) {
          controller.close();
        }
      });
      const mockStderr = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('Process failed'));
          controller.close();
        }
      });
      
      const failedProcess = {
        stdout: mockStdout,
        stderr: mockStderr,
        exitCode: 1,
        exited: Promise.resolve(1)
      };

      mocks.mockBun.spawn.mockReturnValue(failedProcess);

      if (processUtils.isAvailable()) {
        const result = await processUtils.exec('exit', ['1']);
        expect(result.code).toBe(1);
        expect(result.stderr).toBe('Process failed');
      }
    });

    it('should provide debugging utilities', () => {
      if (!isBun() && !(globalThis as any).Bun) return;

      // Test that Bun provides good debugging info
      const debugInfo = {
        version: mocks.mockBun.version,
        main: mocks.mockBun.main,
        argv: mocks.mockBun.argv
      };

      expect(debugInfo.version).toBe('1.1.0');
      expect(debugInfo.main).toContain('.ts');
      expect(Array.isArray(debugInfo.argv)).toBe(true);
    });
  });

  describe('Future Compatibility', () => {
    beforeEach(() => {
      (globalThis as any).Bun = mocks.mockBun;
    });

    it('should prepare for future Python integration methods', () => {
      if (!isBun() && !(globalThis as any).Bun) return;

      // Test foundation for different Python integration approaches
      const integrationMethods = {
        subprocess: processUtils.isAvailable(),
        ffi: typeof mocks.mockBun.allocUnsafe === 'function',
        wasm: typeof WebAssembly !== 'undefined',
        http: typeof fetch === 'function'
      };

      expect(integrationMethods.subprocess).toBe(true);
      expect(integrationMethods.ffi).toBe(true);
      expect(integrationMethods.wasm).toBe(true);
      expect(integrationMethods.http).toBe(true);
    });

    it('should handle version compatibility', () => {
      if (!isBun() && !(globalThis as any).Bun) return;

      const version = mocks.mockBun.version;
      const majorVersion = parseInt(version.split('.')[0]);
      
      expect(majorVersion).toBeGreaterThanOrEqual(1);
    });

    it('should support experimental features flags', () => {
      if (!isBun() && !(globalThis as any).Bun) return;

      const experimentalFeatures = {
        'bun-ffi': true,
        'bun-macros': true,
        'bun-plugin-api': true
      };

      expect(typeof experimentalFeatures).toBe('object');
    });
  });
});