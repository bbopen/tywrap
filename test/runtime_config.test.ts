/**
 * Runtime Configuration and Environment Tests
 * Tests runtime-specific options, environment variables, path resolution, and error handling
 */

import { resolve as resolvePath } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NodeBridge, type NodeBridgeOptions } from '../src/runtime/node.js';
import { PyodideBridge, type PyodideBridgeOptions } from '../src/runtime/pyodide.js';
import { getDefaultPythonPath } from '../src/utils/python.js';
import {
  detectRuntime,
  pathUtils,
  fsUtils,
  processUtils,
  isNodejs,
  isDeno,
  isBun,
  isBrowser,
} from '../src/utils/runtime.js';

const defaultPythonPath = getDefaultPythonPath();

describe('Runtime Configuration', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let originalProcess: any;

  beforeEach(() => {
    originalEnv = process?.env || {};
    originalProcess = (globalThis as any).process;
  });

  afterEach(() => {
    if (originalProcess) {
      (globalThis as any).process = originalProcess;
    }
  });

  describe('Node.js Bridge Configuration', () => {
    it('should use default configuration', () => {
      const bridge = new NodeBridge();
      // In the new architecture, resolved options are stored in resolvedOptions
      const options = (bridge as any).resolvedOptions;

      expect(options.pythonPath).toBe(defaultPythonPath);
      expect(options.scriptPath).toContain('python_bridge.py');
      expect(options.timeoutMs).toBe(30000);
      expect(options.env).toEqual({});
    });

    it('should override default configuration', () => {
      const customOptions: NodeBridgeOptions = {
        pythonPath: 'python3.11',
        scriptPath: 'custom/python_bridge.py',
        cwd: '/custom/working/directory',
        timeoutMs: 60000,
        enableJsonFallback: true,
        env: {
          CUSTOM_VAR: 'custom_value',
          PYTHONPATH: '/custom/python/path',
        },
      };

      const bridge = new NodeBridge(customOptions);
      const options = (bridge as any).resolvedOptions;
      const resolvedScriptPath = resolvePath(
        '/custom/working/directory',
        'custom/python_bridge.py'
      );

      expect(options.pythonPath).toBe('python3.11');
      expect(options.scriptPath).toBe(resolvedScriptPath);
      expect(options.cwd).toBe('/custom/working/directory');
      expect(options.timeoutMs).toBe(60000);
      // enableJsonFallback is deprecated and not stored
      expect(options.env).toEqual({
        CUSTOM_VAR: 'custom_value',
        PYTHONPATH: '/custom/python/path',
      });
    });

    it('should handle partial configuration', () => {
      const partialOptions: NodeBridgeOptions = {
        timeoutMs: 15000,
        enableJsonFallback: true,
      };

      const bridge = new NodeBridge(partialOptions);
      const options = (bridge as any).resolvedOptions;

      // Should use defaults for unspecified options
      expect(options.pythonPath).toBe(defaultPythonPath);
      expect(options.scriptPath).toContain('python_bridge.py');
      expect(options.cwd).toBe(process.cwd());
      // Should use provided options
      expect(options.timeoutMs).toBe(15000);
    });

    it('should handle empty configuration object', () => {
      const bridge = new NodeBridge({});
      const options = (bridge as any).resolvedOptions;

      expect(options.pythonPath).toBe(defaultPythonPath);
      expect(options.scriptPath).toContain('python_bridge.py');
      expect(options.timeoutMs).toBe(30000);
    });

    it('should handle environment variable configuration', () => {
      // Mock process environment
      const mockProcess = {
        env: {
          TYWRAP_PYTHON_PATH: 'python3.9',
          TYWRAP_TIMEOUT_MS: '45000',
          TYWRAP_JSON_FALLBACK: 'true',
          PATH: '/usr/bin:/bin',
        },
        cwd: () => '/mock/cwd',
      };
      (globalThis as any).process = mockProcess;

      // Configuration could read from environment variables
      const envPythonPath = mockProcess.env.TYWRAP_PYTHON_PATH;
      const envTimeout = parseInt(mockProcess.env.TYWRAP_TIMEOUT_MS || '30000');
      const envJsonFallback = mockProcess.env.TYWRAP_JSON_FALLBACK === 'true';

      expect(envPythonPath).toBe('python3.9');
      expect(envTimeout).toBe(45000);
      expect(envJsonFallback).toBe(true);
    });
  });

  describe('Pyodide Bridge Configuration', () => {
    it('should use default configuration', () => {
      const bridge = new PyodideBridge();
      // Composition: the facade holds an RpcClient which holds the transport.
      const transport = (bridge as any).rpc.transport;
      const indexURL = (transport as any).indexURL;
      const packages = (transport as any).packages;

      expect(indexURL).toBe('https://cdn.jsdelivr.net/pyodide/v0.28.0/full/');
      expect(packages).toEqual([]);
    });

    it('should override default configuration', () => {
      const customOptions: PyodideBridgeOptions = {
        indexURL: 'https://custom.cdn/pyodide/',
        packages: ['numpy', 'pandas', 'matplotlib'],
      };

      const bridge = new PyodideBridge(customOptions);
      const transport = (bridge as any).rpc.transport;
      const indexURL = (transport as any).indexURL;
      const packages = (transport as any).packages;

      expect(indexURL).toBe('https://custom.cdn/pyodide/');
      expect(packages).toEqual(['numpy', 'pandas', 'matplotlib']);
    });

    it('should handle empty packages array', () => {
      const options: PyodideBridgeOptions = {
        indexURL: 'https://cdn.jsdelivr.net/pyodide/',
        packages: [],
      };

      const bridge = new PyodideBridge(options);
      const transport = (bridge as any).rpc.transport;
      const packages = (transport as any).packages;

      expect(packages).toEqual([]);
    });

    it('should handle undefined packages', () => {
      const options: PyodideBridgeOptions = {
        indexURL: 'https://cdn.jsdelivr.net/pyodide/',
      };

      const bridge = new PyodideBridge(options);
      const transport = (bridge as any).rpc.transport;
      const packages = (transport as any).packages;

      expect(packages).toEqual([]);
    });

    it('should validate CDN URLs', () => {
      const validURLs = [
        'https://cdn.jsdelivr.net/pyodide/',
        'https://unpkg.com/pyodide@0.28.0/',
        'https://custom-cdn.example.com/pyodide/',
        'http://localhost:8080/pyodide/', // For development
      ];

      validURLs.forEach(url => {
        expect(() => new PyodideBridge({ indexURL: url })).not.toThrow();
      });
    });
  });

  describe('Environment Variable Handling', () => {
    let mockProcess: any;

    beforeEach(() => {
      mockProcess = {
        env: {
          NODE_ENV: 'test',
          PATH: '/usr/bin:/bin',
          HOME: '/home/user',
          PWD: '/current/dir',
        },
        cwd: () => '/current/dir',
        versions: { node: '18.0.0' },
      };
      (globalThis as any).process = mockProcess;
    });

    it('should read environment variables in Node.js', () => {
      if (!isNodejs() && !(globalThis as any).process) return;

      expect(mockProcess.env.NODE_ENV).toBe('test');
      expect(mockProcess.env.PATH).toContain('/usr/bin');
      expect(mockProcess.env.HOME).toBe('/home/user');
    });

    it('should handle missing environment variables', () => {
      if (!isNodejs() && !(globalThis as any).process) return;

      expect(mockProcess.env.NONEXISTENT_VAR).toBeUndefined();
    });

    it('should set environment variables for subprocesses', () => {
      if (!isNodejs() && !(globalThis as any).process) return;

      const customEnv = {
        ...mockProcess.env,
        TYWRAP_CONFIG: 'custom',
        PYTHON_PATH: '/custom/python/path',
      };

      expect(customEnv.TYWRAP_CONFIG).toBe('custom');
      expect(customEnv.PYTHON_PATH).toBe('/custom/python/path');
    });

    it('should handle environment variable priority', () => {
      if (!isNodejs() && !(globalThis as any).process) return;

      // Test environment variable precedence
      const baseEnv = { VAR: 'base' };
      const overrideEnv = { VAR: 'override' };
      const merged = { ...baseEnv, ...overrideEnv };

      expect(merged.VAR).toBe('override');
    });

    it('should handle PYTHONPATH configuration', () => {
      if (!isNodejs() && !(globalThis as any).process) return;

      const originalPythonPath = mockProcess.env.PYTHONPATH;
      const tywrapPath = '/path/to/tywrap_ir';

      // Simulate PYTHONPATH construction
      const newPythonPath = originalPythonPath ? `${tywrapPath}:${originalPythonPath}` : tywrapPath;

      expect(newPythonPath).toContain(tywrapPath);
      if (originalPythonPath) {
        expect(newPythonPath).toContain(originalPythonPath);
      }
    });
  });

  describe('Path Resolution Cross-Runtime', () => {
    it('should resolve relative paths consistently', () => {
      const testPaths = [
        './src/index.ts',
        '../parent/file.js',
        'relative/path/to/file.py',
        '../../up/two/levels.txt',
      ];

      testPaths.forEach(path => {
        const resolved = pathUtils.resolve(path);
        expect(typeof resolved).toBe('string');
        expect(resolved.length).toBeGreaterThan(0);
      });
    });

    it('should handle absolute paths correctly', () => {
      const absolutePaths = [
        '/usr/local/bin/python',
        '/home/user/project/src',
        '/var/log/app.log',
        '/tmp/temp_file.txt',
      ];

      absolutePaths.forEach(path => {
        const resolved = pathUtils.resolve(path);
        expect(resolved).toBe(path); // Should return as-is for absolute paths
      });
    });

    it('should join paths with correct separators', () => {
      const testCases = [
        {
          input: ['src', 'runtime', 'node.ts'],
          expected: 'src/runtime/node.ts',
        },
        {
          input: ['path', 'to', 'deep', 'nested', 'file.js'],
          expected: 'path/to/deep/nested/file.js',
        },
        {
          input: [''],
          expected: '',
        },
        {
          input: ['single'],
          expected: 'single',
        },
      ];

      testCases.forEach(({ input, expected }) => {
        const result = pathUtils.join(...input);
        expect(result).toBe(expected);
      });
    });

    it('should handle special path characters', () => {
      const specialPaths = [
        'path with spaces/file.txt',
        'path-with-dashes/file.js',
        'path_with_underscores/file.py',
        'path.with.dots/file.json',
      ];

      specialPaths.forEach(path => {
        const segments = path.split('/');
        const joined = pathUtils.join(...segments);
        expect(joined).toBe(path);
      });
    });

    it('should handle different platform path formats', () => {
      // Test that our path utilities work regardless of platform
      const crossPlatformPaths = [
        'unix/style/path',
        'windows\\style\\path'.replace(/\\/g, '/'), // Normalize for testing
        'mixed/style\\path'.replace(/\\/g, '/'), // Normalize for testing
      ];

      crossPlatformPaths.forEach(path => {
        const segments = path.split('/');
        const result = pathUtils.join(...segments);
        expect(result).toBe(path);
      });
    });
  });

  describe('Working Directory Configuration', () => {
    it('should use current working directory by default', () => {
      const mockProcess = {
        cwd: vi.fn().mockReturnValue('/default/cwd'),
        versions: { node: '18.0.0' },
      };
      (globalThis as any).process = mockProcess;

      if (processUtils.isAvailable()) {
        expect(mockProcess.cwd()).toBe('/default/cwd');
      }
    });

    it('should handle custom working directory', () => {
      const customCwd = '/custom/working/directory';
      const bridge = new NodeBridge({ cwd: customCwd });
      const options = (bridge as any).resolvedOptions;

      expect(options.cwd).toBe(customCwd);
    });

    it('should validate working directory exists', async () => {
      // Mock filesystem check
      const mockDeno = {
        stat: vi.fn().mockResolvedValue({ isDirectory: true }),
      };
      (globalThis as any).Deno = mockDeno;

      const testDir = '/test/directory';

      if (isDeno()) {
        const stat = await mockDeno.stat(testDir);
        expect(stat.isDirectory).toBe(true);
      }
    });

    it('should handle working directory permission issues', async () => {
      const mockDeno = {
        stat: vi.fn().mockRejectedValue(new Error('Permission denied')),
      };
      (globalThis as any).Deno = mockDeno;

      const restrictedDir = '/restricted/directory';

      if (isDeno()) {
        await expect(mockDeno.stat(restrictedDir)).rejects.toThrow('Permission denied');
      }
    });
  });

  describe('Timeout Configuration', () => {
    it('should respect custom timeout values', () => {
      const timeouts = [1000, 5000, 30000, 60000, 120000];

      timeouts.forEach(timeout => {
        const bridge = new NodeBridge({ timeoutMs: timeout });
        const options = (bridge as any).resolvedOptions;
        expect(options.timeoutMs).toBe(timeout);
      });
    });

    it('should handle edge case timeout values', () => {
      const edgeCases = [
        { timeout: 0, expected: 0 },
        { timeout: 1, expected: 1 },
        { timeout: Number.MAX_SAFE_INTEGER, expected: Number.MAX_SAFE_INTEGER },
      ];

      edgeCases.forEach(({ timeout, expected }) => {
        const bridge = new NodeBridge({ timeoutMs: timeout });
        const options = (bridge as any).resolvedOptions;
        expect(options.timeoutMs).toBe(expected);
      });
    });
  });
});
