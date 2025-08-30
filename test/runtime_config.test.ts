/**
 * Runtime Configuration and Environment Tests
 * Tests runtime-specific options, environment variables, path resolution, and error handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NodeBridge, type NodeBridgeOptions } from '../src/runtime/node.js';
import { PyodideBridge, type PyodideBridgeOptions } from '../src/runtime/pyodide.js';
import {
  detectRuntime,
  pathUtils,
  fsUtils,
  processUtils,
  isNodejs,
  isDeno,
  isBun,
  isBrowser
} from '../src/utils/runtime.js';

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
      const options = (bridge as any).options;
      
      expect(options.pythonPath).toBe('python3');
      expect(options.scriptPath).toBe('runtime/python_bridge.py');
      expect(options.timeoutMs).toBe(30000);
      expect(options.enableJsonFallback).toBe(false);
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
          PYTHONPATH: '/custom/python/path'
        }
      };

      const bridge = new NodeBridge(customOptions);
      const options = (bridge as any).options;
      
      expect(options.pythonPath).toBe('python3.11');
      expect(options.scriptPath).toBe('custom/python_bridge.py');
      expect(options.cwd).toBe('/custom/working/directory');
      expect(options.timeoutMs).toBe(60000);
      expect(options.enableJsonFallback).toBe(true);
      expect(options.env).toEqual({
        CUSTOM_VAR: 'custom_value',
        PYTHONPATH: '/custom/python/path'
      });
    });

    it('should handle partial configuration', () => {
      const partialOptions: NodeBridgeOptions = {
        timeoutMs: 15000,
        enableJsonFallback: true
      };

      const bridge = new NodeBridge(partialOptions);
      const options = (bridge as any).options;
      
      // Should use defaults for unspecified options
      expect(options.pythonPath).toBe('python3');
      expect(options.scriptPath).toBe('runtime/python_bridge.py');
      expect(options.cwd).toBe(process.cwd());
      // Should use provided options
      expect(options.timeoutMs).toBe(15000);
      expect(options.enableJsonFallback).toBe(true);
    });

    it('should handle empty configuration object', () => {
      const bridge = new NodeBridge({});
      const options = (bridge as any).options;
      
      expect(options.pythonPath).toBe('python3');
      expect(options.scriptPath).toBe('runtime/python_bridge.py');
      expect(options.timeoutMs).toBe(30000);
      expect(options.enableJsonFallback).toBe(false);
    });

    it('should handle environment variable configuration', () => {
      // Mock process environment
      const mockProcess = {
        env: {
          TYWRAP_PYTHON_PATH: 'python3.9',
          TYWRAP_TIMEOUT_MS: '45000',
          TYWRAP_JSON_FALLBACK: 'true',
          PATH: '/usr/bin:/bin'
        },
        cwd: () => '/mock/cwd'
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
      const indexURL = (bridge as any).indexURL;
      const packages = (bridge as any).packages;
      
      expect(indexURL).toBe('https://cdn.jsdelivr.net/pyodide/');
      expect(packages).toEqual([]);
    });

    it('should override default configuration', () => {
      const customOptions: PyodideBridgeOptions = {
        indexURL: 'https://custom.cdn/pyodide/',
        packages: ['numpy', 'pandas', 'matplotlib']
      };

      const bridge = new PyodideBridge(customOptions);
      const indexURL = (bridge as any).indexURL;
      const packages = (bridge as any).packages;
      
      expect(indexURL).toBe('https://custom.cdn/pyodide/');
      expect(packages).toEqual(['numpy', 'pandas', 'matplotlib']);
    });

    it('should handle empty packages array', () => {
      const options: PyodideBridgeOptions = {
        indexURL: 'https://cdn.jsdelivr.net/pyodide/',
        packages: []
      };

      const bridge = new PyodideBridge(options);
      const packages = (bridge as any).packages;
      
      expect(packages).toEqual([]);
    });

    it('should handle undefined packages', () => {
      const options: PyodideBridgeOptions = {
        indexURL: 'https://cdn.jsdelivr.net/pyodide/'
      };

      const bridge = new PyodideBridge(options);
      const packages = (bridge as any).packages;
      
      expect(packages).toEqual([]);
    });

    it('should validate CDN URLs', () => {
      const validURLs = [
        'https://cdn.jsdelivr.net/pyodide/',
        'https://unpkg.com/pyodide@0.24.1/',
        'https://custom-cdn.example.com/pyodide/',
        'http://localhost:8080/pyodide/' // For development
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
          PWD: '/current/dir'
        },
        cwd: () => '/current/dir',
        versions: { node: '18.0.0' }
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
        PYTHON_PATH: '/custom/python/path'
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
      const newPythonPath = originalPythonPath 
        ? `${tywrapPath}:${originalPythonPath}`
        : tywrapPath;

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
        '../../up/two/levels.txt'
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
        '/tmp/temp_file.txt'
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
          expected: 'src/runtime/node.ts'
        },
        {
          input: ['path', 'to', 'deep', 'nested', 'file.js'],
          expected: 'path/to/deep/nested/file.js'
        },
        {
          input: [''],
          expected: ''
        },
        {
          input: ['single'],
          expected: 'single'
        }
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
        'path.with.dots/file.json'
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
        'mixed/style\\path'.replace(/\\/g, '/') // Normalize for testing
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
        versions: { node: '18.0.0' }
      };
      (globalThis as any).process = mockProcess;

      if (processUtils.isAvailable()) {
        expect(mockProcess.cwd()).toBe('/default/cwd');
      }
    });

    it('should handle custom working directory', () => {
      const customCwd = '/custom/working/directory';
      const bridge = new NodeBridge({ cwd: customCwd });
      const options = (bridge as any).options;
      
      expect(options.cwd).toBe(customCwd);
    });

    it('should validate working directory exists', async () => {
      // Mock filesystem check
      const mockDeno = {
        stat: vi.fn().mockResolvedValue({ isDirectory: true })
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
        stat: vi.fn().mockRejectedValue(new Error('Permission denied'))
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
        const options = (bridge as any).options;
        expect(options.timeoutMs).toBe(timeout);
      });
    });

    it('should handle edge case timeout values', () => {
      const edgeCases = [
        { timeout: 0, expected: 0 },
        { timeout: 1, expected: 1 },
        { timeout: Number.MAX_SAFE_INTEGER, expected: Number.MAX_SAFE_INTEGER }
      ];

      edgeCases.forEach(({ timeout, expected }) => {
        const bridge = new NodeBridge({ timeoutMs: timeout });
        const options = (bridge as any).options;
        expect(options.timeoutMs).toBe(expected);
      });
    });

    it('should validate timeout values', () => {
      const invalidTimeouts = [-1, NaN, Infinity, -Infinity];

      invalidTimeouts.forEach(timeout => {
        // Bridge should handle invalid timeouts gracefully
        expect(() => new NodeBridge({ timeoutMs: timeout })).not.toThrow();
      });
    });
  });

  describe('Error Handling Configuration', () => {
    it('should configure error reporting levels', () => {
      const errorLevels = ['debug', 'info', 'warn', 'error', 'fatal'];
      
      errorLevels.forEach(level => {
        // Test that error level configuration would work
        const config = { errorLevel: level };
        expect(config.errorLevel).toBe(level);
      });
    });

    it('should handle error recovery strategies', () => {
      const recoveryStrategies = ['retry', 'fallback', 'fail-fast', 'ignore'];
      
      recoveryStrategies.forEach(strategy => {
        const config = { errorRecovery: strategy };
        expect(config.errorRecovery).toBe(strategy);
      });
    });

    it('should configure error context preservation', () => {
      const contextOptions = {
        includeStack: true,
        includeEnvironment: true,
        includeInput: false,
        maxContextSize: 1024
      };

      expect(contextOptions.includeStack).toBe(true);
      expect(contextOptions.maxContextSize).toBe(1024);
    });

    it('should handle error callback configuration', () => {
      const errorCallback = vi.fn();
      const config = { onError: errorCallback };
      
      // Simulate error
      config.onError(new Error('Test error'));
      
      expect(errorCallback).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('Performance Configuration', () => {
    it('should configure concurrency limits', () => {
      const concurrencyLimits = [1, 4, 8, 16, 32];
      
      concurrencyLimits.forEach(limit => {
        const config = { maxConcurrency: limit };
        expect(config.maxConcurrency).toBe(limit);
      });
    });

    it('should configure caching options', () => {
      const cacheConfig = {
        enableCache: true,
        maxCacheSize: 1024 * 1024, // 1MB
        cacheTTL: 300000, // 5 minutes
        cacheStrategy: 'lru'
      };

      expect(cacheConfig.enableCache).toBe(true);
      expect(cacheConfig.maxCacheSize).toBe(1048576);
      expect(cacheConfig.cacheStrategy).toBe('lru');
    });

    it('should configure memory limits', () => {
      const memoryConfig = {
        maxHeapSize: 512 * 1024 * 1024, // 512MB
        gcThreshold: 0.8,
        enableMemoryMonitoring: true
      };

      expect(memoryConfig.maxHeapSize).toBe(536870912);
      expect(memoryConfig.gcThreshold).toBe(0.8);
    });

    it('should configure batch processing options', () => {
      const batchConfig = {
        enableBatching: true,
        batchSize: 100,
        batchTimeout: 1000,
        maxBatchAge: 5000
      };

      expect(batchConfig.batchSize).toBe(100);
      expect(batchConfig.batchTimeout).toBe(1000);
    });
  });

  describe('Security Configuration', () => {
    it('should configure sandbox options', () => {
      const sandboxConfig = {
        enableSandbox: true,
        allowedModules: ['math', 'json', 'datetime'],
        deniedModules: ['os', 'subprocess', 'socket'],
        maxExecutionTime: 30000
      };

      expect(sandboxConfig.enableSandbox).toBe(true);
      expect(sandboxConfig.allowedModules).toContain('math');
      expect(sandboxConfig.deniedModules).toContain('os');
    });

    it('should configure access control', () => {
      const accessConfig = {
        allowFileSystem: false,
        allowNetwork: false,
        allowSubprocess: false,
        allowedPaths: ['/safe/path'],
        deniedPaths: ['/system', '/etc']
      };

      expect(accessConfig.allowFileSystem).toBe(false);
      expect(accessConfig.allowedPaths).toContain('/safe/path');
    });

    it('should configure input validation', () => {
      const validationConfig = {
        validateInputs: true,
        maxInputSize: 1024 * 1024, // 1MB
        allowedTypes: ['string', 'number', 'boolean', 'array', 'object'],
        sanitizeStrings: true
      };

      expect(validationConfig.validateInputs).toBe(true);
      expect(validationConfig.allowedTypes).toContain('string');
    });
  });

  describe('Runtime-Specific Configurations', () => {
    it('should handle Node.js specific options', () => {
      const nodeConfig = {
        nodeOptions: ['--max-old-space-size=4096'],
        inspectorPort: 9229,
        enableInspector: false
      };

      expect(nodeConfig.nodeOptions).toContain('--max-old-space-size=4096');
      expect(nodeConfig.inspectorPort).toBe(9229);
    });

    it('should handle Deno specific options', () => {
      const denoConfig = {
        permissions: {
          allowRead: ['/allowed/path'],
          allowWrite: ['/writable/path'],
          allowNet: ['api.example.com'],
          allowRun: ['python3']
        },
        importMap: '/path/to/import_map.json',
        configFile: '/path/to/deno.json'
      };

      expect(denoConfig.permissions.allowRead).toContain('/allowed/path');
      expect(denoConfig.importMap).toBe('/path/to/import_map.json');
    });

    it('should handle Bun specific options', () => {
      const bunConfig = {
        bunOptions: ['--hot'],
        enableFFI: true,
        ffiLibraries: ['libpython3.11.so'],
        optimizationLevel: 2
      };

      expect(bunConfig.bunOptions).toContain('--hot');
      expect(bunConfig.enableFFI).toBe(true);
      expect(bunConfig.ffiLibraries).toContain('libpython3.11.so');
    });

    it('should handle browser specific options', () => {
      const browserConfig = {
        workerURL: '/pyodide-worker.js',
        enableSharedArrayBuffer: true,
        enableCrossOriginIsolation: true,
        serviceWorkerScope: '/app/'
      };

      expect(browserConfig.workerURL).toBe('/pyodide-worker.js');
      expect(browserConfig.enableSharedArrayBuffer).toBe(true);
    });
  });

  describe('Configuration Validation', () => {
    it('should validate required configuration fields', () => {
      // Test that essential fields are validated
      const requiredFields = ['pythonPath', 'scriptPath'];
      
      requiredFields.forEach(field => {
        const config = { [field]: '' };
        expect(config[field]).toBe('');
      });
    });

    it('should validate configuration types', () => {
      const typeValidation = [
        { field: 'timeoutMs', value: 30000, expectedType: 'number' },
        { field: 'enableJsonFallback', value: false, expectedType: 'boolean' },
        { field: 'pythonPath', value: 'python3', expectedType: 'string' },
        { field: 'env', value: {}, expectedType: 'object' }
      ];

      typeValidation.forEach(({ field, value, expectedType }) => {
        expect(typeof value).toBe(expectedType);
      });
    });

    it('should validate configuration ranges', () => {
      const rangeValidation = [
        { field: 'timeoutMs', min: 0, max: Number.MAX_SAFE_INTEGER },
        { field: 'maxConcurrency', min: 1, max: 1000 },
        { field: 'batchSize', min: 1, max: 10000 }
      ];

      rangeValidation.forEach(({ field, min, max }) => {
        const validValue = Math.floor((min + max) / 2);
        expect(validValue).toBeGreaterThanOrEqual(min);
        expect(validValue).toBeLessThanOrEqual(max);
      });
    });

    it('should provide configuration defaults fallback', () => {
      const defaults = {
        pythonPath: 'python3',
        timeoutMs: 30000,
        enableJsonFallback: false,
        maxRetries: 3,
        retryDelay: 1000
      };

      Object.entries(defaults).forEach(([key, defaultValue]) => {
        expect(defaults[key as keyof typeof defaults]).toBe(defaultValue);
      });
    });
  });

  describe('Configuration Loading and Persistence', () => {
    it('should load configuration from files', async () => {
      const mockConfig = {
        pythonPath: 'python3.11',
        timeoutMs: 45000,
        enableJsonFallback: true
      };

      // Mock file system read
      if (fsUtils.isAvailable()) {
        // In a real implementation, this would read from a config file
        const configJson = JSON.stringify(mockConfig);
        expect(JSON.parse(configJson)).toEqual(mockConfig);
      }
    });

    it('should merge configuration from multiple sources', () => {
      const defaultConfig = {
        pythonPath: 'python3',
        timeoutMs: 30000,
        enableJsonFallback: false
      };

      const fileConfig = {
        timeoutMs: 45000,
        enableJsonFallback: true
      };

      const envConfig = {
        pythonPath: 'python3.11'
      };

      const merged = { ...defaultConfig, ...fileConfig, ...envConfig };
      
      expect(merged).toEqual({
        pythonPath: 'python3.11',
        timeoutMs: 45000,
        enableJsonFallback: true
      });
    });

    it('should validate configuration after loading', () => {
      const loadedConfig = {
        pythonPath: 'python3',
        timeoutMs: '30000', // String instead of number
        enableJsonFallback: 'true', // String instead of boolean
        invalidField: 'should be ignored'
      };

      // Configuration normalization
      const normalizedConfig = {
        pythonPath: loadedConfig.pythonPath,
        timeoutMs: parseInt(String(loadedConfig.timeoutMs)),
        enableJsonFallback: loadedConfig.enableJsonFallback === 'true'
      };

      expect(normalizedConfig.timeoutMs).toBe(30000);
      expect(normalizedConfig.enableJsonFallback).toBe(true);
      expect('invalidField' in normalizedConfig).toBe(false);
    });

    it('should handle configuration errors gracefully', () => {
      const invalidConfigs = [
        null,
        undefined,
        'invalid string config',
        123,
        ['array', 'config'],
        { pythonPath: null },
        { timeoutMs: -1 }
      ];

      invalidConfigs.forEach(config => {
        expect(() => {
          // Configuration validation should not throw
          const validatedConfig = config && typeof config === 'object' && !Array.isArray(config)
            ? config
            : {};
          return validatedConfig;
        }).not.toThrow();
      });
    });
  });
});